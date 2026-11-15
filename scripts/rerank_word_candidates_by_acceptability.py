#!/usr/bin/env python3
"""Rerank ruRoBERTa candidate whole words using a Russian acceptability model."""

import argparse
import json
import os
import statistics
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

DEFAULT_MODEL = "s-nlp/ruRoberta-large-RuCoLa-v1"
BATCH_SIZE = 16
MAX_LENGTH = 192


def normalize(value):
    import unicodedata
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    return unicodedata.normalize("NFKC", decomposed.replace("\u0301", "")).lower().replace("ё", "е")


def positive_label_index(config):
    mapping = getattr(config, "id2label", {}) or {}
    for index, label in mapping.items():
        lowered = str(label).strip().lower()
        if any(key in lowered for key in (
            "acceptable", "natural", "real", "human", "fluent", "positive", "clean"
        )):
            return int(index), str(label)
    raise RuntimeError(f"Cannot identify an acceptability/naturalness class from id2label={mapping!r}")


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


def metric(hits, total):
    return {"correct": int(hits), "total": int(total),
            "accuracy": float(hits / total) if total else 0.0}


def summarize(rows, field):
    total = len(rows)
    hits = sum(bool(row.get(field)) for row in rows)
    return metric(hits, total)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Original matched UD benchmark cases JSON")
    parser.add_argument("--candidates", required=True, help="ruRoBERTa whole-word candidate report JSON")
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    candidate_report = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    cases = source.get("cases", [])
    result_rows = candidate_report.get("results", [])
    if not cases or not result_rows:
        raise SystemExit("Input cases or candidate results are empty.")

    case_index = {
        (row.get("sentence_id"), row.get("gold_form"), row.get("upos")): row
        for row in cases
    }
    prepared = []
    excluded = []
    for result in result_rows:
        key = (result.get("sentence_id"), result.get("gold_form"), result.get("upos"))
        case = case_index.get(key)
        candidates = result.get("top_candidates", [])
        if case is None or not candidates:
            excluded.append({
                "sentence_id": result.get("sentence_id"),
                "gold_form": result.get("gold_form"),
                "reason": "missing_case_or_candidate_pool",
            })
            continue
        masked = make_masked_sentence(case)
        if not masked:
            excluded.append({
                "sentence_id": result.get("sentence_id"),
                "gold_form": result.get("gold_form"),
                "reason": "cannot_reconstruct_masked_sentence",
            })
            continue
        for original_rank, candidate in enumerate(candidates, start=1):
            surface = str(candidate.get("surface") or "")
            if not surface:
                continue
            text = masked.replace("[MASK]", surface, 1)
            if "[MASK]" in text:
                raise RuntimeError("Candidate sentence still contains a mask token.")
            prepared.append({
                "key": key,
                "case": case,
                "result": result,
                "candidate": candidate,
                "original_rank": original_rank,
                "text": text,
            })

    if not prepared:
        raise SystemExit("No usable generated candidate sentences were found.")

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(args.model)
    model.to("cpu")
    model.eval()
    positive_index, positive_label = positive_label_index(model.config)

    scored_by_key = {}
    with torch.inference_mode():
        for start in range(0, len(prepared), BATCH_SIZE):
            chunk = prepared[start:start + BATCH_SIZE]
            encoded = tokenizer(
                [row["text"] for row in chunk],
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=MAX_LENGTH,
            )
            output = model(**encoded)
            probabilities = torch.softmax(output.logits.float(), dim=-1)
            scores = probabilities[:, positive_index].tolist()
            for row, score in zip(chunk, scores):
                key = row["key"]
                scored_by_key.setdefault(key, []).append({
                    "surface": row["candidate"]["surface"],
                    "normalized": row["candidate"]["normalized"],
                    "original_rank": row["original_rank"],
                    "generator_score": row["candidate"].get("score"),
                    "acceptability_probability": float(score),
                    "text": row["text"],
                })
            completed = min(start + BATCH_SIZE, len(prepared))
            if completed % 256 < BATCH_SIZE or completed == len(prepared):
                print(f"Scored {completed}/{len(prepared)} candidate sentences", flush=True)

    reranked_rows = []
    grouped_by_piece = {}
    for result in result_rows:
        key = (result.get("sentence_id"), result.get("gold_form"), result.get("upos"))
        scored = scored_by_key.get(key, [])
        scored.sort(key=lambda row: (-row["acceptability_probability"], row["original_rank"]))
        gold = result.get("gold_normalized") or normalize(result.get("gold_form"))
        rank = next((position for position, row in enumerate(scored, 1)
                     if row["normalized"] == gold), None)
        original_rank = result.get("gold_rank")
        row = {
            "sentence_id": result.get("sentence_id"),
            "gold_form": result.get("gold_form"),
            "gold_normalized": gold,
            "upos": result.get("upos"),
            "gold_piece_count": result.get("ruRoberta_piece_count"),
            "generator_gold_rank": original_rank,
            "generator_top1": bool(result.get("top1")),
            "generator_top8": bool(result.get("top8")),
            "generator_top32": original_rank is not None and original_rank <= 32,
            "reranker_gold_rank": rank,
            "reranker_top1": rank == 1,
            "reranker_top8": rank is not None and rank <= 8,
            "reranker_top32": rank is not None and rank <= 32,
            "candidate_pool_size": len(scored),
            "top_candidates_after_reranking": scored[:8],
        }
        reranked_rows.append(row)

        piece_count = str(row["gold_piece_count"] or "unknown")
        grouped_by_piece.setdefault(piece_count, []).append(row)

    metrics = {
        "targets": len(reranked_rows),
        "candidate_sentences_scored": len(prepared),
        "generator_top1": summarize(reranked_rows, "generator_top1"),
        "generator_recall8": summarize(reranked_rows, "generator_top8"),
        "generator_recall32": summarize(reranked_rows, "generator_top32"),
        "reranker_top1": summarize(reranked_rows, "reranker_top1"),
        "reranker_recall8": summarize(reranked_rows, "reranker_top8"),
        "reranker_recall32": summarize(reranked_rows, "reranker_top32"),
        "mean_candidates_per_target": statistics.mean(
            row["candidate_pool_size"] for row in reranked_rows
        ) if reranked_rows else 0.0,
    }
    by_piece_count = {}
    for piece_count, subset in sorted(grouped_by_piece.items()):
        by_piece_count[piece_count] = {
            "targets": len(subset),
            "generator_top1": summarize(subset, "generator_top1"),
            "generator_recall8": summarize(subset, "generator_top8"),
            "reranker_top1": summarize(subset, "reranker_top1"),
            "reranker_recall8": summarize(subset, "reranker_top8"),
        }

    report = {
        "schema": "NEUROGENESIS_RUSSIAN_ACCEPTABILITY_RERANKER_V1",
        "model": {
            "id": args.model,
            "resolved_revision": getattr(model.config, "_commit_hash", None),
            "positive_class": positive_label,
            "positive_class_index": positive_index,
            "purpose": "Rank generated whole-word substitutions by Russian sentence acceptability/naturalness.",
            "fine_tuned_on_ud_for_this_benchmark": False,
        },
        "methodology": {
            "candidate_generator": "ai-forever/ruRoberta-large",
            "candidate_pool": "Top 32 whole-word candidates from the fixed RuRoBERTa-large generator for every target.",
            "reranking_input": "The original target-hidden UD sentence with exactly one generated candidate substituted at the target slot.",
            "gold_target_exposure": "Gold forms are used only for post-inference evaluation; no gold candidate is inserted into classifier input.",
            "candidate_recall_constraint": "The reranker can reorder candidates inside the generator pool but cannot recover a gold word absent from that pool.",
            "scoring": f"Softmax probability of the model's {positive_label!r} class; original generator rank is used only as a tie-breaker.",
        },
        "metrics": metrics,
        "metrics_by_generator_piece_count": by_piece_count,
        "excluded": excluded,
        "results": reranked_rows,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"model": args.model, "metrics": metrics, "output": str(output)},
                     ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
