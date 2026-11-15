#!/usr/bin/env python3
"""Whole-word infilling benchmark for FRED-T5-large on the matched UD cases."""

import argparse
import json
import os
import re
import statistics
import unicodedata
from pathlib import Path

import torch
from transformers import AutoTokenizer, GPT2Tokenizer, T5ForConditionalGeneration

MODEL_ID = "ai-forever/FRED-T5-large"
BATCH_LOG_EVERY = 10
MAX_INPUT_LENGTH = 192
MAX_NEW_TOKENS = 14
NUM_BEAMS = 8
WORD_RE = re.compile(r"[\w]+(?:[-'][\w]+)*", flags=re.UNICODE)


def normalize(value):
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    return unicodedata.normalize("NFKC", decomposed.replace("\u0301", "")).lower().replace("ё", "е")


def first_word_from_fill(decoded, tokenizer):
    text = str(decoded or "")
    # GPT2Tokenizer's decoder sequence starts with the T5 pad/decoder-start
    # token. Drop it from the left; never split at it (that would erase fills).
    text = re.sub(r"^<pad>\s*", "", text)
    if "<extra_id_0>" in text:
        text = text.split("<extra_id_0>", 1)[1]
    for sentinel in ("<extra_id_1>", "</s>"):
        if sentinel in text:
            text = text.split(sentinel, 1)[0]
    words = WORD_RE.findall(text)
    if not words:
        # Some tokenizer configurations may strip the sentinel on decode.
        # Retry after removing known control tokens.
        cleaned = re.sub(r"<[^>]+>", " ", text)
        words = WORD_RE.findall(cleaned)
    return words[0] if words else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--prefix", default="<SC1>")
    args = parser.parse_args()

    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    all_cases = source.get("cases", [])
    if not all_cases:
        raise SystemExit("No benchmark cases found.")
    base_tokenizer = AutoTokenizer.from_pretrained(
        "ai-forever/ruBert-base",
        revision="05f37a2ca9e333fd18f30cd0c96c68d274793c69",
    )
    cases = [
        case for case in all_cases
        if len(base_tokenizer(str(case["gold_form"]), add_special_tokens=False)["input_ids"]) > 1
    ]
    if len(cases) != 349:
        raise RuntimeError(f"Matched sample drift: selected {len(cases)} hard cases, expected 349.")

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    tokenizer = GPT2Tokenizer.from_pretrained(MODEL_ID, eos_token="</s>")
    model = T5ForConditionalGeneration.from_pretrained(MODEL_ID)
    model.to("cpu")
    model.eval()

    if "<extra_id_0>" not in tokenizer.get_vocab():
        raise RuntimeError("FRED tokenizer is missing <extra_id_0>.")
    if args.prefix not in tokenizer.get_vocab():
        raise RuntimeError(f"FRED tokenizer is missing requested task prefix {args.prefix}.")

    results = []
    debug_examples = []
    for index, case in enumerate(cases):
        masked = str(case.get("masked_sentence") or "")
        if masked.count("[MASK]") != 1:
            tokens = list(case.get("tokens", []))
            target_index = int(case.get("target_index", -1))
            if target_index < 0 or target_index >= len(tokens):
                results.append({
                    "sentence_id": case.get("sentence_id"),
                    "gold_form": case.get("gold_form"),
                    "gold_normalized": case.get("gold_normalized"),
                    "top_candidates": [],
                    "top1": False,
                    "top8": False,
                    "error": "could_not_reconstruct_single_mask",
                })
                continue
            tokens[target_index] = "[MASK]"
            masked = " ".join(tokens)

        # FRED's SC1 objective is an UL2-style span-corruption task.
        # The target is always represented by one sentinel; the gold form and
        # its tokenizer length are never inserted into the input.
        prompt = args.prefix + masked.replace("[MASK]", "<extra_id_0>", 1)
        encoded = tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=MAX_INPUT_LENGTH,
        )
        with torch.inference_mode():
            generated = model.generate(
                **encoded,
                num_beams=NUM_BEAMS,
                num_return_sequences=NUM_BEAMS,
                max_new_tokens=MAX_NEW_TOKENS,
                early_stopping=True,
                length_penalty=1.0,
                return_dict_in_generate=True,
                output_scores=True,
            )

        scores = generated.sequences_scores
        candidates = []
        seen = set()
        raw_decodes = []
        for rank, sequence in enumerate(generated.sequences):
            decoded = tokenizer.decode(
                sequence,
                skip_special_tokens=False,
                clean_up_tokenization_spaces=False,
            )
            raw_decodes.append(decoded)
            word = first_word_from_fill(decoded, tokenizer)
            if not word:
                continue
            key = normalize(word)
            if not key or key in seen:
                continue
            seen.add(key)
            candidates.append({
                "surface": word,
                "normalized": key,
                "sequence_rank": rank + 1,
                "sequence_score": float(scores[rank].item()) if scores is not None else None,
                "decoded_fill": decoded,
            })
            if len(candidates) >= 8:
                break

        gold = case["gold_normalized"]
        model_piece_count = len(tokenizer(case["gold_form"], add_special_tokens=False)["input_ids"])
        results.append({
            "sentence_id": case.get("sentence_id"),
            "gold_form": case["gold_form"],
            "model_piece_count": model_piece_count,
            "gold_normalized": gold,
            "upos": case.get("upos"),
            "top_candidates": candidates,
            "candidate_count": len(candidates),
            "gold_rank": next((rank for rank, row in enumerate(candidates, 1)
                               if row["normalized"] == gold), None),
            "top1": bool(candidates and candidates[0]["normalized"] == gold),
            "top8": any(row["normalized"] == gold for row in candidates[:8]),
            "masked_input": prompt,
        })
        if index < 8:
            debug_examples.append({
                "gold": case["gold_form"],
                "raw_generations": raw_decodes[:4],
                "parsed_candidates": candidates[:4],
            })
        if (index + 1) % BATCH_LOG_EVERY == 0:
            print(f"FRED-T5 infill {index + 1}/{len(cases)}", flush=True)

    def metric(field):
        hits = sum(bool(row.get(field)) for row in results)
        return {"correct": hits, "total": len(results),
                "accuracy": hits / len(results) if results else 0.0}

    summary = {
        "targets": len(results),
        "top1": metric("top1"),
        "recall8": metric("top8"),
        "gold_generated_anywhere": sum(row.get("gold_rank") is not None for row in results),
        "candidate_count_mean": statistics.mean(row.get("candidate_count", 0) for row in results) if results else 0.0,
        "targets_with_no_candidates": sum(row.get("candidate_count", 0) == 0 for row in results),
    }
    by_piece_count = {}
    for piece_count in sorted({row["model_piece_count"] for row in results}):
        subset = [row for row in results if row["model_piece_count"] == piece_count]
        by_piece_count[str(piece_count)] = {
            "targets": len(subset),
            "top1": metric("top1") if subset == results else {
                "correct": sum(bool(row.get("top1")) for row in subset),
                "total": len(subset),
                "accuracy": sum(bool(row.get("top1")) for row in subset) / len(subset)
            },
            "recall8": {
                "correct": sum(bool(row.get("top8")) for row in subset),
                "total": len(subset),
                "accuracy": sum(bool(row.get("top8")) for row in subset) / len(subset)
            }
        }
    report = {
        "schema": "NEUROGENESIS_FRED_T5_LARGE_WORDFILL_V1",
        "model": {
            "id": MODEL_ID,
            "prefix": args.prefix,
            "license": "apache-2.0",
            "weights_size_hugging_face": "3.29 GB",
            "architecture": "T5 encoder-decoder, 820M parameters",
            "pretraining": "7 denoising objectives in an UL2-like mixture, Russian corpus 300GB",
            "tokenizer": "byte-level BPE",
            "fine_tuned_on_ud_for_this_benchmark": False,
        },
        "methodology": {
            "task": "single-span word infilling; extract the first lexical word generated for the hidden target",
            "target_surface_exposure": "The gold word is always replaced by <extra_id_0>; no target characters or target subtoken count are visible to the model.",
            "generation": {
                "num_beams": NUM_BEAMS,
                "num_return_sequences": NUM_BEAMS,
                "max_new_tokens": MAX_NEW_TOKENS,
                "length_penalty": 1.0,
            },
            "sample": "Exactly the 349 target cases whose gold forms were multi-piece under the pinned previous ruBert-base tokenizer; same hard challenge set as ruRoBERTa-large.",
            "matched_target_count": len(cases),
            "all_ud_target_count_before_filter": len(all_cases),
            "baseline_reference": {
                "ruBert_base_top1": {"correct": 7, "total": 349, "accuracy": 7 / 349},
                "ruBert_base_recall8": {"correct": 22, "total": 349, "accuracy": 22 / 349},
                "ruRoBERTa_large_top1": {"correct": 78, "total": 349, "accuracy": 78 / 349},
                "ruRoBERTa_large_recall8": {"correct": 118, "total": 349, "accuracy": 118 / 349},
            },
        },
        "metrics": {"all_349_hard_targets": summary, "by_fred_token_piece_count": by_piece_count},
        "debug_examples": debug_examples,
        "results": results,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"metrics": summary, "output": str(output)}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
