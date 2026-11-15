#!/usr/bin/env python3
"""Pseudo-log-likelihood reranking for ruRoBERTa whole-word candidate pools.

For each candidate word, insert it in the original masked sentence, identify
the candidate's BPE token span via offsets, and score each token while masking
that token in turn. No gold target is provided to the model. The script
compares sum, mean and length-normalized PLL ranking signals.
"""

import argparse
import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

import torch
from transformers import AutoModelForMaskedLM, AutoTokenizer

MODEL_ID = "ai-forever/ruRoberta-large"
BATCH_SIZE = 16
MAX_LENGTH = 192
LENGTH_ALPHAS = (0.0, 0.5, 1.0)


def normalize(value):
    import unicodedata
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    return unicodedata.normalize("NFKC", decomposed.replace("\u0301", "")).lower().replace("ё", "е")


def metric(hits, total):
    return {"correct": int(hits), "total": int(total),
            "accuracy": float(hits / total) if total else 0.0}


def make_masked_sentence(case):
    text = str(case.get("masked_sentence") or "")
    if text.count("[MASK]") == 1:
        return text
    tokens = list(case.get("tokens", []))
    target_index = int(case.get("target_index", -1))
    if target_index < 0 or target_index >= len(tokens):
        return None
    tokens[target_index] = "[MASK]"
    return " ".join(tokens)


def prepare_tasks(cases, candidate_rows, tokenizer):
    case_index = {
        (row.get("sentence_id"), int(row.get("target_index", -1))): row
        for row in cases
    }
    tasks = []
    per_target = {}
    excluded = []
    for result_index, result in enumerate(candidate_rows):
        key = (result.get("sentence_id"), int(result.get("target_index", -1)))
        case = case_index.get(key)
        candidates = result.get("top_candidates", [])
        if case is None or not candidates:
            excluded.append({
                "sentence_id": result.get("sentence_id"),
                "gold_form": result.get("gold_form"),
                "reason": "missing_case_or_candidate_pool",
            })
            per_target[key] = []
            continue

        masked = make_masked_sentence(case)
        if not masked or masked.count("[MASK]") != 1:
            excluded.append({
                "sentence_id": result.get("sentence_id"),
                "gold_form": result.get("gold_form"),
                "reason": "cannot_reconstruct_single_mask",
            })
            per_target[key] = []
            continue

        marker_start = masked.index("[MASK]")
        marker_end = marker_start + len("[MASK]")
        target_rows = []
        for original_rank, candidate in enumerate(candidates, start=1):
            surface = str(candidate.get("surface") or "")
            if not surface:
                continue
            sentence = masked[:marker_start] + surface + masked[marker_end:]
            char_start = marker_start
            char_end = marker_start + len(surface)
            try:
                encoded = tokenizer(
                    sentence,
                    return_tensors=None,
                    truncation=True,
                    max_length=MAX_LENGTH,
                    add_special_tokens=True,
                    return_offsets_mapping=True,
                )
                offsets = encoded.get("offset_mapping")
                input_ids = encoded.get("input_ids")
                if offsets is None or input_ids is None:
                    raise RuntimeError("Tokenizer did not return token offsets and input IDs")
                positions = [
                    i for i, (start, end) in enumerate(offsets)
                    if end > start and start < char_end and end > char_start
                ]
                if not positions:
                    raise RuntimeError("Candidate has no overlapping tokenizer offsets")
                covered_start = min(offsets[i][0] for i in positions)
                covered_end = max(offsets[i][1] for i in positions)
                if covered_start > char_start or covered_end < char_end:
                    raise RuntimeError("Candidate token offsets do not cover the entire word")
                if len(input_ids) > MAX_LENGTH:
                    raise RuntimeError("Candidate sequence exceeded maximum length")
                task_row = {
                    "key": key,
                    "result_index": result_index,
                    "original_rank": original_rank,
                    "surface": surface,
                    "normalized": candidate.get("normalized") or normalize(surface),
                    "generator_score": candidate.get("score"),
                    "generator_piece_count": candidate.get("pieces"),
                    "sentence": sentence,
                    "input_ids": [int(value) for value in input_ids],
                    "attention_mask": [int(value) for value in encoded.get("attention_mask", [1] * len(input_ids))],
                    "positions": positions,
                    "gold_normalized": result.get("gold_normalized") or normalize(result.get("gold_form")),
                    "rrf_score": float(candidate.get("rrf_score", 0.0)),
                    "source_ranks": candidate.get("source_ranks", {}),
                }
                tasks.append(task_row)
                target_rows.append(task_row)
            except Exception as exc:
                excluded.append({
                    "sentence_id": result.get("sentence_id"),
                    "gold_form": result.get("gold_form"),
                    "candidate": surface,
                    "reason": f"{type(exc).__name__}: {exc}",
                })
        per_target[key] = target_rows
    return tasks, per_target, excluded


def score_tasks(model, tokenizer, tasks):
    # Each task produces one masked context per subtoken, scored independently.
    expanded = []
    for task_index, task in enumerate(tasks):
        for position in task["positions"]:
            ids = list(task["input_ids"])
            ids[position] = tokenizer.mask_token_id
            expanded.append({
                "task_index": task_index,
                "position": position,
                "input_ids": ids,
                "attention_mask": task["attention_mask"],
                "gold_token_id": task["input_ids"][position],
            })

    piece_scores = [[] for _ in tasks]
    with torch.inference_mode():
        for start in range(0, len(expanded), BATCH_SIZE):
            chunk = expanded[start:start + BATCH_SIZE]
            max_len = max(len(row["input_ids"]) for row in chunk)
            input_ids = torch.full(
                (len(chunk), max_len), tokenizer.pad_token_id, dtype=torch.long
            )
            attention = torch.zeros((len(chunk), max_len), dtype=torch.long)
            query_positions = []
            for row_index, row in enumerate(chunk):
                length = len(row["input_ids"])
                input_ids[row_index, :length] = torch.tensor(row["input_ids"], dtype=torch.long)
                attention[row_index, :length] = torch.tensor(row["attention_mask"], dtype=torch.long)
                query_positions.append(row["position"])
            logits = model(input_ids=input_ids, attention_mask=attention).logits
            for row_index, row in enumerate(chunk):
                log_probs = torch.log_softmax(
                    logits[row_index, query_positions[row_index]].float(), dim=-1
                )
                value = float(log_probs[row["gold_token_id"]].item())
                piece_scores[row["task_index"]].append(value)
            completed = min(start + BATCH_SIZE, len(expanded))
            if completed % 1024 < BATCH_SIZE or completed == len(expanded):
                print(f"PLL masked-token scores {completed}/{len(expanded)}", flush=True)

    results = []
    for task, scores in zip(tasks, piece_scores):
        if len(scores) != len(task["positions"]):
            raise RuntimeError("Missing one or more masked-token scores for a candidate")
        total = float(sum(scores))
        mean = float(total / len(scores))
        row = {
            "original_rank": task["original_rank"],
            "surface": task["surface"],
            "normalized": task["normalized"],
            "subtoken_count": len(scores),
            "pll_sum": total,
            "pll_mean": mean,
            "generator_score": task["generator_score"],
            "rrf_score": task["rrf_score"],
            "source_ranks": task["source_ranks"],
            "sentence": task["sentence"],
        }
        for alpha in LENGTH_ALPHAS:
            row[f"pll_length_alpha_{alpha}"] = float(total / (len(scores) ** alpha))
        results.append(row)
    return results


def rank_by(rows, score_field):
    if score_field == "pll_rrf_fusion":
        pll_order = sorted(rows, key=lambda row: (-row["pll_sum"], row["original_rank"]))
        rrf_order = sorted(rows, key=lambda row: (-row.get("rrf_score", 0.0), row["original_rank"]))
        pll_rank = {row["normalized"]: rank for rank, row in enumerate(pll_order, 1)}
        rrf_rank = {row["normalized"]: rank for rank, row in enumerate(rrf_order, 1)}
        def fused_score(row):
            key = row["normalized"]
            return 1.0 / (60 + rrf_rank[key]) + 1.0 / (60 + pll_rank[key])
        return sorted(rows, key=lambda row: (-fused_score(row), row["original_rank"]))
    return sorted(
        rows,
        key=lambda row: (-float(row.get(score_field, 0.0) or 0.0), row["original_rank"]),
    )


def summarize_targets(target_results, score_field):
    ranked = []
    for target in target_results:
        candidates = rank_by(target["candidates"], score_field)
        gold = target["gold_normalized"]
        rank = next((i for i, row in enumerate(candidates, 1)
                     if row["normalized"] == gold), None)
        ranked.append({
            **target,
            "reranked_candidates": candidates,
            "gold_rank": rank,
            "top1": rank == 1,
            "top8": rank is not None and rank <= 8,
            "top32": rank is not None and rank <= 32,
        })
    return ranked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--candidates", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    candidate_report = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    cases = source.get("cases", [])
    candidate_rows = candidate_report.get("results", [])
    if not cases or not candidate_rows:
        raise SystemExit("Benchmark cases or candidate rows are empty.")

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, use_fast=True)
    model = AutoModelForMaskedLM.from_pretrained(MODEL_ID)
    model.to("cpu")
    model.eval()
    if tokenizer.mask_token_id is None or tokenizer.pad_token_id is None:
        raise RuntimeError("ruRoBERTa tokenizer must define mask and pad token IDs.")

    tasks, grouped, excluded = prepare_tasks(cases, candidate_rows, tokenizer)
    if not tasks:
        raise SystemExit("No candidates could be tokenized for PLL scoring.")
    scored_candidates = score_tasks(model, tokenizer, tasks)
    for task, scored in zip(tasks, scored_candidates):
        # Preserve the original generator rank and attach each scorer's signal.
        task.update({k: v for k, v in scored.items()
                     if k not in {"sentence", "original_rank", "surface", "normalized"}})

    targets = []
    for result in candidate_rows:
        # Candidate groups are keyed by the stable case identity (sentence_id, target_index).
        # Gold form and UPOS are evaluation metadata, not the key used by prepare_tasks().
        key = (result.get("sentence_id"), int(result.get("target_index", -1)))
        target_tasks = grouped.get(key, [])
        if result.get("top_candidates") and not target_tasks:
            raise RuntimeError(
                f"Candidate pool failed to join for sentence_id={key[0]} target_index={key[1]}"
            )
        candidate_rows_scored = []
        for task in target_tasks:
            candidate_rows_scored.append({
                "original_rank": task["original_rank"],
                "surface": task["surface"],
                "normalized": task["normalized"],
                "subtoken_count": task["subtoken_count"],
                "generator_score": task["generator_score"],
                "pll_sum": task["pll_sum"],
                "pll_mean": task["pll_mean"],
                "pll_length_alpha_0.0": task["pll_length_alpha_0.0"],
                "pll_length_alpha_0.5": task["pll_length_alpha_0.5"],
                "pll_length_alpha_1.0": task["pll_length_alpha_1.0"],
                "rrf_score": task["rrf_score"],
                "source_ranks": task["source_ranks"],
            })
        targets.append({
            "sentence_id": result.get("sentence_id"),
            "target_index": result.get("target_index"),
            "gold_form": result.get("gold_form"),
            "gold_normalized": result.get("gold_normalized") or normalize(result.get("gold_form")),
            "upos": result.get("upos"),
            "generator_piece_count": result.get("ruRoberta_piece_count"),
            "generator_gold_rank": result.get("gold_rank"),
            "generator_top1": bool(result.get("top1")),
            "generator_top8": bool(result.get("top8")),
            "generator_top32": result.get("gold_rank") is not None and result.get("gold_rank") <= 32,
            "candidates": candidate_rows_scored,
        })

    reports = {}
    for score_field in ("rrf_score", "pll_sum", "pll_mean",
                        "pll_length_alpha_0.5", "pll_length_alpha_1.0", "pll_rrf_fusion"):
        reranked = summarize_targets(targets, score_field)
        total = len(reranked)
        hits1 = sum(bool(row["top1"]) for row in reranked)
        hits8 = sum(bool(row["top8"]) for row in reranked)
        hits32 = sum(bool(row["top32"]) for row in reranked)
        reports[score_field] = {
            "score_field": score_field,
            "top1": metric(hits1, total),
            "recall8": metric(hits8, total),
            "recall32": metric(hits32, total),
            "gold_generated_anywhere": sum(row["gold_rank"] is not None for row in reranked),
            "targets_with_candidate_pool": sum(bool(row["candidates"]) for row in reranked),
        }

    generator_summary = {
        "top1": metric(sum(bool(row.get("top1")) for row in candidate_rows), len(candidate_rows)),
        "recall8": metric(sum(bool(row.get("top8")) for row in candidate_rows), len(candidate_rows)),
        "recall32": metric(sum(
            row.get("gold_rank") is not None and row["gold_rank"] <= 32 for row in candidate_rows
        ), len(candidate_rows)),
    }

    report = {
        "schema": "NEUROGENESIS_RUROBERTA_FRED_RRF_PLL_ENSEMBLE_V1",
        "model": {
            "id": MODEL_ID,
            "resolved_revision": getattr(model.config, "_commit_hash", None),
            "purpose": "Gold-free contextual pseudo-log-likelihood re-ranking of generated whole-word candidates.",
            "license": "apache-2.0",
        },
        "methodology": {
            "candidate_generator": "Deduplicated union of ruRoBERTa-large Top-32 and FRED-T5-large Top-8 candidates, ordered by reciprocal-rank fusion (RRF, k=60).",
            "reranking": "Insert every union candidate into the original masked sentence. Identify its byte-BPE token span via offset_mapping. Mask each candidate subtoken independently and score it with ruRoBERTa-large pseudo-log-likelihood. Compare RRF-only, PLL-only, and fixed RRF+PLL rank fusion.",
            "gold_target_exposure": "Gold words are used only for final evaluation. They are never inserted into a candidate sentence or passed to the scorer.",
            "length_bias": "Reports PLL sum, mean per subtoken, and sum divided by token-count^alpha for alpha 0.5 and 1.0.",
            "limitation": "The scorer can reorder only candidates present in the fixed ruRoBERTa Top-32 union FRED-T5 Top-8 pool. It cannot recover candidates absent from both generators.",
            "baseline": "The candidate generator's original order is reported beside each PLL-based ranker.",
        },
        "metrics": {
            "generator": generator_summary,
            "candidate_pool": candidate_report.get("metrics", {}),
            "pseudo_log_likelihood_rerankers": reports,
            "targets": len(candidate_rows),
            "candidate_sentences_scored": len(tasks),
            "masked_candidate_subtokens_scored": sum(len(task["positions"]) for task in tasks),
        },
        "excluded": excluded[:80],
        "results": targets,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"metrics": report["metrics"], "output": str(output)},
                     ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
