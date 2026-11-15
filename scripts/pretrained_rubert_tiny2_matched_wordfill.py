#!/usr/bin/env python3
"""Matched cointegrated/rubert-tiny2 whole-word fill-mask benchmark."""

import argparse
import json
import math
import os
import re
import statistics
import unicodedata
from collections import defaultdict
from pathlib import Path

import torch
from transformers import AutoModelForPreTraining, AutoTokenizer

MODEL_ID = "cointegrated/rubert-tiny2"
BASE_MODEL_ID = "ai-forever/ruBert-base"
BASE_MODEL_REVISION = "05f37a2ca9e333fd18f30cd0c96c68d274793c69"
MAX_PIECES = 8
BEAM_WIDTH = 8
BRANCH_SIZE = 8
BATCH_SIZE = 8
MAX_LENGTH = 192
WORD_RE = re.compile(r"[\w-]+", flags=re.UNICODE)


def normalize(value):
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    return unicodedata.normalize("NFKC", decomposed.replace("\u0301", "")).lower().replace("ё", "е")


def metric(hits, total):
    return {"correct": int(hits), "total": int(total),
            "accuracy": float(hits / total) if total else 0.0}


def token_pools(tokenizer):
    tokens = tokenizer.convert_ids_to_tokens(list(range(len(tokenizer))))
    special = set(tokenizer.all_special_ids)
    start, continuation = [], []
    for token_id, token in enumerate(tokens):
        if token_id in special or not token:
            continue
        if token.startswith("##"):
            continuation.append(token_id)
        else:
            # Keep lexical pieces, including a few punctuation fragments only
            # for the word-boundary probability mass.
            raw = token
            if re.search(r"[\w]", raw, flags=re.UNICODE):
                start.append(token_id)
    if not start:
        raise RuntimeError("ruBERT-tiny2 tokenizer exposes no start-word tokens.")
    return torch.tensor(start, dtype=torch.long), torch.tensor(continuation, dtype=torch.long)


def decode_candidate(tokenizer, ids):
    if not ids:
        return None
    surface = tokenizer.decode(
        list(ids), skip_special_tokens=True, clean_up_tokenization_spaces=False
    )
    surface = re.sub(r"\s+", "", surface.strip())
    if not surface or not WORD_RE.fullmatch(surface):
        return None
    encoded = tokenizer(surface, add_special_tokens=False)["input_ids"]
    if [int(x) for x in encoded] != [int(x) for x in ids]:
        return None
    return surface


def prepare(tokenizer, base_tokenizer, cases):
    prepared, excluded = [], []
    for case in cases:
        gold = str(case["gold_form"])
        base_ids = base_tokenizer(gold, add_special_tokens=False)["input_ids"]
        if len(base_ids) <= 1:
            continue
        gold_ids = [int(x) for x in tokenizer(gold, add_special_tokens=False)["input_ids"]]
        if not gold_ids or tokenizer.unk_token_id in gold_ids or len(gold_ids) > MAX_PIECES:
            excluded.append({"sentence_id":case.get("sentence_id"),"gold_form":gold,
                             "piece_count":len(gold_ids),"reason":"unk_or_over_max_pieces"})
            continue
        tokens = tokenizer.convert_ids_to_tokens(gold_ids)
        if len(gold_ids) > 1 and (
            not tokens[0] or tokens[0].startswith("##") or
            any(not token.startswith("##") for token in tokens[1:])
        ):
            excluded.append({"sentence_id":case.get("sentence_id"),"gold_form":gold,
                             "piece_count":len(gold_ids),"reason":"not_wordpiece_continuation_pattern"})
            continue
        masked = str(case.get("masked_sentence") or "")
        if masked.count("[MASK]") != 1:
            words = list(case.get("tokens", []))
            index = int(case.get("target_index", -1))
            if index < 0 or index >= len(words):
                excluded.append({"sentence_id":case.get("sentence_id"),"gold_form":gold,
                                 "piece_count":len(gold_ids),"reason":"invalid_target_index"})
                continue
            words[index] = "[MASK]"
            masked = " ".join(words)
        prepared.append({
            "case":case, "gold_ids":gold_ids, "gold_tokens":tokens,
            "gold_piece_count":len(gold_ids), "gold_normalized":case["gold_normalized"],
            "masked_text":masked,
        })
    return prepared, excluded


def score_single_piece(model, tokenizer, prepared, start_ids):
    ids_allowed = start_ids
    results = []
    with torch.inference_mode():
        for start in range(0, len(prepared), BATCH_SIZE):
            chunk=prepared[start:start+BATCH_SIZE]
            texts=[row["masked_text"].replace("[MASK]",tokenizer.mask_token,1) for row in chunk]
            enc=tokenizer(texts,return_tensors="pt",padding=True,truncation=True,max_length=MAX_LENGTH)
            hits=enc["input_ids"].eq(tokenizer.mask_token_id)
            out=model(input_ids=enc["input_ids"],attention_mask=enc.get("attention_mask"))
            for offset,item in enumerate(chunk):
                if item["gold_piece_count"] != 1:
                    continue
                positions=hits[offset].nonzero(as_tuple=False).flatten()
                if len(positions)!=1:
                    continue
                logits=out.prediction_logits[offset,int(positions[0])].float()
                allowed=logits.index_select(0,ids_allowed)
                take=min(512,int(allowed.numel()))
                values,offsets=torch.topk(allowed,k=take)
                candidates=[]
                seen=set()
                for value,ix in zip(values.tolist(),offsets.tolist()):
                    token_id=int(ids_allowed[ix].item())
                    word=decode_candidate(tokenizer,[token_id])
                    if not word:
                        continue
                    norm=normalize(word)
                    if norm in seen:
                        continue
                    seen.add(norm)
                    candidates.append({"surface":word,"normalized":norm,"score":float(value)})
                    if len(candidates)>=8:
                        break
                gold=item["gold_normalized"]
                rank=next((i for i,row in enumerate(candidates,1) if row["normalized"]==gold),None)
                results.append({
                    "sentence_id":item["case"].get("sentence_id"),
                    "gold_form":item["case"]["gold_form"],"gold_normalized":gold,
                    "upos":item["case"].get("upos"),"gold_piece_count":1,
                    "candidate_count":len(candidates),"gold_rank":rank,
                    "top1":rank==1,"top8":rank is not None and rank<=8,
                    "top_candidates":candidates[:8],"masked_input":texts[len(results)%len(chunk)] if chunk else "",
                })
            print(f"ruBERT-tiny2 one-piece: {min(start+BATCH_SIZE,len(prepared))}/{len(prepared)}",flush=True)
    return results


def run_multi_piece(model, tokenizer, prepared, start_ids, continuation_ids):
    if continuation_ids.numel() == 0:
        return [], {"method":"no ## continuation tokens in tokenizer; multi-piece beam unavailable"}
    boundary_ids=start_ids
    start_tensor=start_ids
    continuation_tensor=continuation_ids
    boundary_tensor=boundary_ids
    mask_span=" ".join([tokenizer.mask_token]*(MAX_PIECES+1))
    rows=[]
    for item in prepared:
        masked=item["masked_text"].replace("[MASK]",mask_span,1)
        enc=tokenizer(masked,add_special_tokens=True,truncation=True,max_length=MAX_LENGTH,padding=False)
        ids=[int(x) for x in enc["input_ids"]]
        positions=[i for i,x in enumerate(ids) if x==tokenizer.mask_token_id]
        if len(positions)!=MAX_PIECES+1 or positions!=list(range(positions[0],positions[0]+MAX_PIECES+1)):
            continue
        rows.append({**item,"input_ids":ids,"mask_positions":positions,"masked_span":masked})
    if not rows:
        return [], {"method":"no valid mask spans"}
    completed=[{} for _ in rows]
    active={i:[{"ids":(),"logp":0.0}] for i in range(len(rows))}
    path=[]
    for depth in range(MAX_PIECES+1):
        states=[(i,b) for i,beams in active.items() for b in beams]
        if not states: break
        expansions=defaultdict(list)
        with torch.inference_mode():
            for start in range(0,len(states),BATCH_SIZE):
                chunk=states[start:start+BATCH_SIZE]
                max_len=max(len(rows[i]["input_ids"]) for i,_ in chunk)
                batch_ids=torch.full((len(chunk),max_len),tokenizer.pad_token_id,dtype=torch.long)
                batch_att=torch.zeros_like(batch_ids)
                query=[]
                for r,(idx,beam) in enumerate(chunk):
                    values=list(rows[idx]["input_ids"])
                    for k,token_id in enumerate(beam["ids"]):
                        values[rows[idx]["mask_positions"][k]]=int(token_id)
                    batch_ids[r,:len(values)]=torch.tensor(values,dtype=torch.long)
                    batch_att[r,:len(values)]=1
                    query.append(rows[idx]["mask_positions"][depth])
                out=model(input_ids=batch_ids,attention_mask=batch_att)
                for r,(idx,beam) in enumerate(chunk):
                    item=rows[idx]
                    log_probs=torch.log_softmax(out.prediction_logits[r,query[r]].float(),dim=-1)
                    if depth>0:
                        surface=decode_candidate(tokenizer,beam["ids"])
                        if surface:
                            stop=float(torch.logsumexp(log_probs.index_select(0,boundary_tensor),dim=0).item())
                            norm=normalize(surface)
                            score=float(beam["logp"]+stop)
                            old=completed[idx].get(norm)
                            if old is None or score>old["score"]:
                                completed[idx][norm]={"surface":surface,"normalized":norm,
                                    "score":score,"piece_log_probability":float(beam["logp"]),
                                    "boundary_log_probability":stop,"pieces":len(beam["ids"])}
                    if depth>=MAX_PIECES: continue
                    allowed=start_tensor if depth==0 else continuation_tensor
                    allowed_log=log_probs.index_select(0,allowed)
                    take=min(BRANCH_SIZE,int(allowed_log.numel()))
                    vals,offs=torch.topk(allowed_log,k=take)
                    for value,off in zip(vals.tolist(),offs.tolist()):
                        token_id=int(allowed[int(off)].item())
                        expansions[idx].append({"ids":tuple(beam["ids"])+(token_id,),
                                                 "logp":float(beam["logp"]+value)})
        next_active={}
        for idx,candidates in expansions.items():
            candidates.sort(key=lambda row:row["logp"],reverse=True)
            unique=[];seen=set()
            for candidate in candidates:
                if candidate["ids"] in seen: continue
                seen.add(candidate["ids"]);unique.append(candidate)
            gold_ids=rows[idx]["gold_ids"]
            if depth<len(gold_ids):
                target=tuple(gold_ids[:depth+1])
                rank=next((i for i,c in enumerate(unique,1) if c["ids"]==target),None)
                path.append({"sentence_id":rows[idx]["case"].get("sentence_id"),
                             "gold_form":rows[idx]["case"]["gold_form"],"position":depth+1,
                             "local_gold_rank":rank,"survived_beam":rank is not None and rank<=BEAM_WIDTH})
            next_active[idx]=unique[:BEAM_WIDTH]
        active=next_active
        print(f"ruBERT-tiny2 beam depth {depth}: states={len(states)}",flush=True)

    results=[]
    for idx,item in enumerate(rows):
        candidates=sorted(completed[idx].values(),key=lambda x:x["score"],reverse=True)
        gold=item["gold_normalized"]
        rank=next((i for i,row in enumerate(candidates,1) if row["normalized"]==gold),None)
        results.append({
            "sentence_id":item["case"].get("sentence_id"),
            "gold_form":item["case"]["gold_form"],"gold_normalized":gold,
            "upos":item["case"].get("upos"),"gold_piece_count":item["gold_piece_count"],
            "candidate_count":len(candidates),"gold_rank":rank,
            "top1":rank==1,"top8":rank is not None and rank<=8,
            "top_candidates":candidates[:8],"masked_input":item["masked_span"],
        })
    return results,{"method":"WordPiece beam with ## continuation tokens","path_steps":path}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--input",required=True)
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    source=json.loads(Path(args.input).read_text(encoding="utf-8"))
    torch.set_num_threads(max(1,min(4,os.cpu_count() or 1)))
    base_tokenizer=AutoTokenizer.from_pretrained(BASE_MODEL_ID, revision=BASE_MODEL_REVISION)
    tokenizer=AutoTokenizer.from_pretrained(MODEL_ID)
    model=AutoModelForPreTraining.from_pretrained(MODEL_ID, use_safetensors=True)
    model.to("cpu");model.eval()
    if tokenizer.mask_token is None:
        raise RuntimeError("Model tokenizer has no mask token.")
    start_ids,continuation_ids=token_pools(tokenizer)
    matched_cases = [
        case for case in source.get("cases",[])
        if len(base_tokenizer(str(case["gold_form"]), add_special_tokens=False)["input_ids"]) > 1
    ]
    expected_targets = 349
    if len(matched_cases) != expected_targets:
        raise RuntimeError(f"Matched sample drift: selected {len(matched_cases)} old-ruBert multi-piece cases, expected {expected_targets}.")
    prepared,excluded=prepare(tokenizer,base_tokenizer,matched_cases)
    single=[x for x in prepared if x["gold_piece_count"]==1]
    multi=[x for x in prepared if x["gold_piece_count"]>1]
    one_results=score_single_piece(model,tokenizer,single,start_ids)
    multi_results,multi_diag=run_multi_piece(model,tokenizer,multi,start_ids,continuation_ids)
    by_id={(r["sentence_id"],r["gold_form"]):r for r in one_results+multi_results}
    excluded_by_id={(r.get("sentence_id"),r.get("gold_form")):r for r in excluded}
    combined=[]
    for case in matched_cases:
        key=(case.get("sentence_id"),case["gold_form"])
        row=by_id.get(key)
        if row is None:
            reason=excluded_by_id.get(key,{})
            piece_count=reason.get("piece_count")
            combined.append({"sentence_id":key[0],"gold_form":key[1],
                "gold_normalized":case["gold_normalized"],"upos":case.get("upos"),
                "gold_piece_count":piece_count,"top1":False,"top8":False,
                "gold_rank":None,"candidate_count":0,"top_candidates":[],
                "excluded_reason":reason.get("reason","no_decoder_result")})
        else:
            combined.append(row)
    def summary(rows):
        return {"targets":len(rows),
            "top1":metric(sum(x.get("top1",False) for x in rows),len(rows)),
            "recall8":metric(sum(x.get("top8",False) for x in rows),len(rows)),
            "gold_generated_anywhere":sum(x.get("gold_rank") is not None for x in rows)}
    groups={}
    for n in sorted({x["gold_piece_count"] for x in combined if x.get("gold_piece_count") is not None}):
        groups[str(n)]=summary([x for x in combined if x["gold_piece_count"]==n])
    baseline={"top1":{"correct":78,"total":349,"accuracy":78/349},
              "recall8":{"correct":118,"total":349,"accuracy":118/349}}
    report={
        "schema":"NEUROGENESIS_RUBERT_TINY2_MATCHED_WORDFILL_V1",
        "model":{"id":MODEL_ID,"parameters":29400000,"weights_size_hugging_face":"118 MB",
                 "task":"fill-mask","tokenizer_class":type(tokenizer).__name__,
                 "license":"mit",
                 "architecture":"BERT tiny, 3 layers, hidden size 312, vocab 83,828",
                 "tokenizer_vocab_size":len(tokenizer),"continuation_token_count":int(len(continuation_ids)),
                 "fine_tuned_on_ud_for_this_benchmark":False},
        "methodology":{"matched_sample":"Exactly the 349 targets selected by the previous pinned ruBert-base tokenizer as multi-piece words; identical to the ruRoberta-large challenge set.",
            "gold_target_exposure":"Gold is replaced by MASK tokens. Only tokenizer pieces are used for evaluation and decoding.",
            "decoder":"single-token filtered candidate ranking plus WordPiece ## beam for multi-piece targets.",
            "baseline_ruRoberta_large":baseline},
        "coverage":{"input_targets":len(source.get("cases",[])),"matched_old_multi_piece_targets":len(matched_cases),"prepared_targets":len(prepared),
            "excluded_targets":len(excluded),"single_piece_targets":len(single),
            "multi_piece_targets":sum(1 for case in matched_cases if len(tokenizer(case["gold_form"],add_special_tokens=False)["input_ids"])>1),"multi_piece_decoded":len(multi_results)},
        "metrics":{"all_targets":summary(combined),"by_gold_piece_count":groups,
            "single_piece":summary(one_results),"multi_piece":summary(multi_results)},
        "diagnostics":{"multi_piece_decoder":multi_diag,"excluded":excluded[:60]},
        "results":combined}
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"coverage":report["coverage"],"metrics":report["metrics"],"output":str(out)},
                     ensure_ascii=False,indent=2),flush=True)


if __name__=="__main__":
    main()
