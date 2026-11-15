#!/usr/bin/env python3
"""Beam-search whole-word decoding for multi-piece Russian ruBert targets.

The target surface is hidden by a fixed block of MASK tokens. A WordPiece beam
expands one continuation token at a time. At every depth, a candidate word is
scored with the accumulated token log-probability plus the probability mass of
a non-continuation token at the next mask position (word-boundary estimate).
The gold word is used only to select/evaluate multi-piece cases and score output.
"""

import argparse
import json
import math
import os
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import torch
from transformers import AutoModelForMaskedLM, AutoTokenizer

MODEL_ID = "ai-forever/ruBert-base"
MODEL_REVISION = "05f37a2ca9e333fd18f30cd0c96c68d274793c69"
MAX_PIECES = 5
BEAM_WIDTH = 8
BRANCH_SIZE = 8
BATCH_SIZE = 8
MAX_LENGTH = 192
WORD_RE = re.compile(r"[\w-]+", flags=re.UNICODE)


def normalize(value):
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    without_stress = decomposed.replace("\u0301", "")
    return unicodedata.normalize("NFKC", without_stress).lower().replace("ё", "е")


assert normalize("й Й число\u0301 Число\u0301 ё Ё") == "й й число число е е"


def is_lexical_piece(piece):
    raw = piece[2:] if piece.startswith("##") else piece
    return bool(raw) and bool(re.search(r"[\w]", raw, flags=re.UNICODE))


def token_ids_for(tokenizer, continuation):
    ids = []
    special_ids = set(tokenizer.all_special_ids)
    pieces = tokenizer.convert_ids_to_tokens(list(range(len(tokenizer))))
    for token_id, piece in enumerate(pieces):
        if token_id in special_ids:
            continue
        if piece.startswith("##") == continuation and is_lexical_piece(piece):
            ids.append(token_id)
    return ids


def boundary_token_ids_for(tokenizer):
    special_ids = set(tokenizer.all_special_ids)
    pieces = tokenizer.convert_ids_to_tokens(list(range(len(tokenizer))))
    return [
        token_id for token_id, piece in enumerate(pieces)
        if token_id not in special_ids and not piece.startswith("##")
    ]


def decode_candidate(tokenizer, token_ids):
    if not token_ids:
        return None
    text = tokenizer.decode(
        token_ids,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    ).strip()
    text = re.sub(r"\s+", "", text)
    if not text or not WORD_RE.fullmatch(text):
        return None
    encoded = tokenizer(text, add_special_tokens=False)["input_ids"]
    if [int(value) for value in encoded] != [int(value) for value in token_ids]:
        return None
    return text


def metric(hits, total):
    return {
        "correct": int(hits),
        "total": int(total),
        "accuracy": float(hits / total) if total else 0.0,
    }


def run_beam(model, tokenizer, prepared):
    vocab_size = len(tokenizer)
    special_ids = set(tokenizer.all_special_ids)
    start_ids = token_ids_for(tokenizer, continuation=False)
    continuation_ids = token_ids_for(tokenizer, continuation=True)
    boundary_ids = boundary_token_ids_for(tokenizer)
    if not start_ids or not continuation_ids or not boundary_ids:
        raise RuntimeError("Tokenizer does not expose usable WordPiece start/continuation tokens.")

    start_tensor = torch.tensor(start_ids, dtype=torch.long)
    continuation_tensor = torch.tensor(continuation_ids, dtype=torch.long)
    boundary_tensor = torch.tensor(boundary_ids, dtype=torch.long)
    pad_id = tokenizer.pad_token_id
    if pad_id is None:
        raise RuntimeError("Tokenizer has no pad token.")

    active = {
        index: [{"ids": (), "logp": 0.0}]
        for index in range(len(prepared))
    }
    completed = [dict() for _ in prepared]
    trace = []

    for depth in range(MAX_PIECES + 1):
        states = []
        for item_index, beams in active.items():
            for beam in beams:
                states.append((item_index, beam))

        if not states:
            break

        expansions = defaultdict(list)
        processed_states = 0
        for start in range(0, len(states), BATCH_SIZE):
            chunk = states[start:start + BATCH_SIZE]
            max_len = max(len(prepared[item_index]["input_ids"]) for item_index, _ in chunk)
            batch_ids = torch.full((len(chunk), max_len), pad_id, dtype=torch.long)
            batch_attention = torch.zeros((len(chunk), max_len), dtype=torch.long)
            query_positions = []

            for row_index, (item_index, beam) in enumerate(chunk):
                item = prepared[item_index]
                base_ids = item["input_ids"]
                ids = list(base_ids)
                for piece_index, token_id in enumerate(beam["ids"]):
                    ids[item["mask_positions"][piece_index]] = int(token_id)
                batch_ids[row_index, :len(ids)] = torch.tensor(ids, dtype=torch.long)
                batch_attention[row_index, :len(ids)] = 1
                query_positions.append(item["mask_positions"][depth])

            output = model(input_ids=batch_ids, attention_mask=batch_attention)
            logits_batch = output.logits
            for row_index, (item_index, beam) in enumerate(chunk):
                logits = logits_batch[row_index, query_positions[row_index]].float()
                log_probs = torch.log_softmax(logits, dim=-1)

                if depth > 0:
                    # A word is complete when the next WordPiece is a new word
                    # or punctuation. Include punctuation in the boundary mass.
                    stop_logp = float(torch.logsumexp(log_probs.index_select(0, boundary_tensor), dim=0).item())
                    token_ids = list(beam["ids"])
                    surface = decode_candidate(tokenizer, token_ids)
                    if surface:
                        normalized = normalize(surface)
                        score = float(beam["logp"] + stop_logp)
                        existing = completed[item_index].get(normalized)
                        if existing is None or score > existing["score"]:
                            completed[item_index][normalized] = {
                                "surface": surface,
                                "normalized": normalized,
                                "score": score,
                                "pieces": len(token_ids),
                            }

                if depth >= MAX_PIECES:
                    continue

                allowed = start_tensor if depth == 0 else continuation_tensor
                allowed_log_probs = log_probs.index_select(0, allowed)
                take = min(BRANCH_SIZE, int(allowed_log_probs.numel()))
                values, offsets = torch.topk(allowed_log_probs, k=take)
                for value, offset in zip(values.tolist(), offsets.tolist()):
                    token_id = int(allowed[offset].item())
                    new_ids = tuple(beam["ids"]) + (token_id,)
                    expansions[item_index].append({
                        "ids": new_ids,
                        "logp": float(beam["logp"] + value),
                    })
                processed_states += 1

        next_active = {}
        if depth < MAX_PIECES:
            for item_index, candidates in expansions.items():
                candidates.sort(key=lambda row: row["logp"], reverse=True)
                seen = set()
                keep = []
                for candidate in candidates:
                    if candidate["ids"] in seen:
                        continue
                    seen.add(candidate["ids"])
                    keep.append(candidate)
                    if len(keep) >= BEAM_WIDTH:
                        break
                if keep:
                    next_active[item_index] = keep
        active = next_active
        trace.append({
            "depth": depth,
            "active_states": len(states),
            "expanded_states": processed_states,
            "active_next_depth": sum(len(value) for value in active.values()),
        })
        print(
            f"beam depth {depth}: states={len(states)} "
            f"next={sum(len(value) for value in active.values())}",
            flush=True,
        )

    results = []
    for index, item in enumerate(prepared):
        candidates = list(completed[index].values())
        candidates.sort(key=lambda row: row["score"], reverse=True)
        top = candidates[:8]
        gold = item["gold_normalized"]
        rank = next((position for position, row in enumerate(candidates, start=1)
                     if row["normalized"] == gold), None)
        results.append({
            "sentence_id": item["case"].get("sentence_id"),
            "gold_form": item["case"]["gold_form"],
            "gold_normalized": gold,
            "upos": item["case"]["upos"],
            "gold_piece_count": item["gold_piece_count"],
            "gold_wordpiece_tokens": item["gold_wordpiece_tokens"],
            "candidate_count": len(candidates),
            "gold_rank": rank,
            "top1": rank == 1,
            "top8": rank is not None and rank <= 8,
            "top_candidates": top,
            "masked_input": item["masked_text"],
        })
    return results, trace, len(start_ids), len(continuation_ids)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    cases = source.get("cases", [])
    if not cases:
        raise SystemExit("No benchmark cases were provided.")

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model = AutoModelForMaskedLM.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model.to("cpu")
    model.eval()

    mask_token = tokenizer.mask_token
    if not mask_token or tokenizer.mask_token_id is None:
        raise RuntimeError("Selected tokenizer has no mask token.")

    prepared = []
    total_multi_piece = 0
    excluded = []
    for case_index, case in enumerate(cases):
        gold = str(case["gold_form"])
        gold_ids = tokenizer(gold, add_special_tokens=False)["input_ids"]
        if len(gold_ids) <= 1:
            continue
        total_multi_piece += 1
        pieces = tokenizer.convert_ids_to_tokens(gold_ids)
        if (len(gold_ids) > MAX_PIECES or
                tokenizer.unk_token_id in gold_ids or
                not pieces or pieces[0].startswith("##") or
                any(not piece.startswith("##") for piece in pieces[1:])):
            excluded.append({
                "sentence_id": case.get("sentence_id"),
                "gold_form": gold,
                "gold_piece_count": len(gold_ids),
                "reason": "unsupported_wordpiece_pattern_or_over_max_pieces",
            })
            continue

        masked_text = str(case.get("masked_sentence") or "")
        if masked_text.count("[MASK]") != 1:
            tokens = list(case["tokens"])
            target_index = int(case["target_index"])
            tokens[target_index] = "[MASK]"
            masked_text = " ".join(tokens)
        span = " ".join([mask_token] * (MAX_PIECES + 1))
        masked_text = masked_text.replace("[MASK]", span, 1)
        encoded = tokenizer(
            masked_text,
            add_special_tokens=True,
            truncation=True,
            max_length=MAX_LENGTH,
            padding=False,
        )
        input_ids = [int(value) for value in encoded["input_ids"]]
        mask_positions = [index for index, value in enumerate(input_ids)
                          if value == tokenizer.mask_token_id]
        if len(mask_positions) != MAX_PIECES + 1:
            excluded.append({
                "sentence_id": case.get("sentence_id"),
                "gold_form": gold,
                "gold_piece_count": len(gold_ids),
                "reason": "mask_span_truncated_or_not_tokenized",
            })
            continue
        if mask_positions != list(range(mask_positions[0], mask_positions[0] + MAX_PIECES + 1)):
            excluded.append({
                "sentence_id": case.get("sentence_id"),
                "gold_form": gold,
                "gold_piece_count": len(gold_ids),
                "reason": "mask_positions_not_contiguous",
            })
            continue
        prepared.append({
            "case": case,
            "gold_normalized": case["gold_normalized"],
            "gold_piece_count": len(gold_ids),
            "gold_wordpiece_tokens": pieces,
            "masked_text": masked_text,
            "input_ids": input_ids,
            "mask_positions": mask_positions,
        })

    if not prepared:
        raise SystemExit("No multi-piece targets were supported by the decoder.")
    results, trace, start_vocab, continuation_vocab = run_beam(model, tokenizer, prepared)

    piece_groups = {}
    all_piece_counts = sorted(
        {row["gold_piece_count"] for row in results} |
        {row["gold_piece_count"] for row in excluded}
    )
    for piece_count in all_piece_counts:
        supported_subset = [row for row in results if row["gold_piece_count"] == piece_count]
        excluded_count = sum(row["gold_piece_count"] == piece_count for row in excluded)
        total_count = len(supported_subset) + excluded_count
        piece_groups[str(piece_count)] = {
            "targets_all": total_count,
            "decoder_supported": len(supported_subset),
            "top1": metric(sum(row["top1"] for row in supported_subset), total_count),
            "recall8": metric(sum(row["top8"] for row in supported_subset), total_count),
            "top1_on_supported": metric(sum(row["top1"] for row in supported_subset), len(supported_subset)),
            "recall8_on_supported": metric(sum(row["top8"] for row in supported_subset), len(supported_subset)),
        }

    hit1 = sum(row["top1"] for row in results)
    hit8 = sum(row["top8"] for row in results)
    all_hit1 = hit1
    all_hit8 = hit8
    total_all_multi = total_multi_piece
    report = {
        "schema": "NEUROGENESIS_RUBERT_MULTI_PIECE_BEAM_V1",
        "model": {
            "id": MODEL_ID,
            "revision": MODEL_REVISION,
            "fine_tuned_on_ud": False,
            "mode": "zero-shot WordPiece continuation beam with end-boundary probability",
        },
        "methodology": {
            "task": "reconstruct whole target words represented by multiple WordPiece tokens",
            "target_surface_exposure": "Gold is used only to identify and score multi-piece test targets; the model input always contains a fixed block of six MASK tokens. Gold subtoken IDs are never inserted into the input or used to guide beam expansion.",
            "mask_span_slots": MAX_PIECES + 1,
            "max_generated_word_pieces": MAX_PIECES,
            "beam_width": BEAM_WIDTH,
            "continuation_branches_per_state": BRANCH_SIZE,
            "candidate_score": "sum of next-piece log probabilities plus log probability mass of a non-## token at the next mask slot as an estimated word boundary",
            "candidate_round_trip": "decoded candidates must re-tokenize to exactly the generated WordPiece IDs",
            "candidate_filter": "lexical Unicode words, numbers and hyphenated forms; continuation pieces must use the WordPiece ## prefix",
            "max_sequence_length": MAX_LENGTH,
            "batch_size": BATCH_SIZE,
        },
        "coverage": {
            "all_multi_piece_targets": total_all_multi,
            "decoder_supported_targets": len(prepared),
            "decoder_excluded_targets": len(excluded),
            "decoder_coverage": len(prepared) / total_all_multi if total_all_multi else 0.0,
            "excluded_reasons": {
                reason: sum(row["reason"] == reason for row in excluded)
                for reason in sorted({row["reason"] for row in excluded})
            },
        },
        "metrics": {
            "top1_supported_multi_piece": metric(hit1, len(results)),
            "recall8_supported_multi_piece": metric(hit8, len(results)),
            "top1_all_multi_piece_with_excluded_as_miss": metric(all_hit1, total_all_multi),
            "recall8_all_multi_piece_with_excluded_as_miss": metric(all_hit8, total_all_multi),
            "by_gold_piece_count": piece_groups,
        },
        "diagnostics": {
            "start_piece_vocabulary_size": start_vocab,
            "continuation_piece_vocabulary_size": continuation_vocab,
            "boundary_piece_vocabulary_size": len(boundary_ids),
            "beam_trace": trace,
            "excluded_examples": excluded[:50],
            "top_misses": [
                row for row in results if not row["top1"]
            ][:40],
        },
        "results": results,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "coverage": report["coverage"],
        "metrics": report["metrics"],
        "output": str(output),
    }, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
