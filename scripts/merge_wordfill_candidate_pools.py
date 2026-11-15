#!/usr/bin/env python3
"""Merge ruRoBERTa and FRED-T5 word candidates without using gold labels in ranking."""
import argparse
import json
import statistics
import unicodedata
from pathlib import Path

def normalize(value):
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    return unicodedata.normalize("NFKC", decomposed.replace("\u0301", "")).lower().replace("ё", "е")

def case_key(row):
    if row.get("sentence_id") is None or row.get("target_index") is None:
        raise ValueError("Every source row needs sentence_id and target_index.")
    return str(row["sentence_id"]), int(row["target_index"])

def metric(hits, total):
    return {"correct": int(hits), "total": int(total),
            "accuracy": float(hits / total) if total else 0.0}

def index_rows(rows, label):
    result = {}
    for row in rows:
        key = case_key(row)
        if key in result:
            raise ValueError(f"Duplicate {label} target key: {key}")
        result[key] = row
    return result

def merge_reports(roberta_report, fred_report, rrf_k=60, expected_targets=None):
    roberta = index_rows(roberta_report.get("results", []), "RoBERTa")
    fred = index_rows(fred_report.get("results", []), "FRED")
    if set(roberta) != set(fred):
        raise ValueError(
            f"Target key mismatch: RoBERTa={len(roberta)}, FRED={len(fred)}; "
            f"missing FRED={sorted(set(roberta)-set(fred))[:5]}; "
            f"missing RoBERTa={sorted(set(fred)-set(roberta))[:5]}"
        )
    if expected_targets is not None and len(roberta) != expected_targets:
        raise ValueError(f"Expected {expected_targets} targets, found {len(roberta)}.")

    results = []
    rb_ranks, fred_ranks, rrf_ranks = [], [], []
    for key in sorted(roberta):
        rb, fd = roberta[key], fred[key]
        gold = normalize(rb.get("gold_normalized") or rb.get("gold_form"))
        if gold != normalize(fd.get("gold_normalized") or fd.get("gold_form")):
            raise ValueError(f"Gold mismatch for {key}")

        pool = {}
        for fallback_rank, candidate in enumerate(rb.get("candidates", []), 1):
            surface = str(candidate.get("surface") or "").strip()
            norm = candidate.get("normalized") or normalize(surface)
            if not surface or not norm:
                continue
            rank = int(candidate.get("original_rank", fallback_rank))
            item = pool.setdefault(norm, {"surface": surface, "normalized": norm, "source_ranks": {}})
            item["source_ranks"]["roberta"] = min(rank, item["source_ranks"].get("roberta", rank))

        for fallback_rank, candidate in enumerate(fd.get("top_candidates", []), 1):
            surface = str(candidate.get("surface") or "").strip()
            norm = candidate.get("normalized") or normalize(surface)
            if not surface or not norm:
                continue
            rank = int(candidate.get("sequence_rank", fallback_rank))
            item = pool.setdefault(norm, {"surface": surface, "normalized": norm, "source_ranks": {}})
            item["source_ranks"]["fred"] = min(rank, item["source_ranks"].get("fred", rank))
            item.setdefault("source_surfaces", {})["fred"] = surface

        union = []
        for candidate in pool.values():
            ranks = candidate["source_ranks"]
            candidate["rrf_score"] = sum(1.0 / (rrf_k + rank) for rank in ranks.values())
            candidate["sources"] = sorted(ranks)
            union.append(candidate)
        # Gold does not participate in this sort.
        union.sort(key=lambda row: (
            -row["rrf_score"], min(row["source_ranks"].values()), row["normalized"]
        ))

        def rank_for(rows):
            return next((rank for rank, item in enumerate(rows, 1)
                         if item["normalized"] == gold), None)

        rb_order = sorted(
            [c for c in union if "roberta" in c["source_ranks"]],
            key=lambda c: (c["source_ranks"]["roberta"], c["normalized"])
        )
        fred_order = sorted(
            [c for c in union if "fred" in c["source_ranks"]],
            key=lambda c: (c["source_ranks"]["fred"], c["normalized"])
        )
        rb_rank, fd_rank, rrf_rank = rank_for(rb_order), rank_for(fred_order), rank_for(union)
        rb_ranks.append(rb_rank)
        fred_ranks.append(fd_rank)
        rrf_ranks.append(rrf_rank)
        results.append({
            "sentence_id": key[0],
            "target_index": key[1],
            "gold_form": rb.get("gold_form"),
            "gold_normalized": gold,
            "upos": rb.get("upos") or fd.get("upos"),
            "generator_piece_count": rb.get("generator_piece_count"),
            "candidate_count": len(union),
            "gold_rank": rrf_rank,
            "top1": rrf_rank == 1,
            "top8": rrf_rank is not None and rrf_rank <= 8,
            "source_gold_ranks": {"roberta": rb_rank, "fred": fd_rank, "rrf_union": rrf_rank},
            "top_candidates": union,
        })

    total = len(results)
    metrics = {
        "target_count": total,
        "rrf_k": rrf_k,
        "roberta_top32": {
            "top1": metric(sum(r == 1 for r in rb_ranks), total),
            "recall8": metric(sum(r is not None and r <= 8 for r in rb_ranks), total),
            "recall32": metric(sum(r is not None and r <= 32 for r in rb_ranks), total),
            "gold_generated_anywhere": sum(r is not None for r in rb_ranks),
        },
        "fred_top8": {
            "top1": metric(sum(r == 1 for r in fred_ranks), total),
            "recall8": metric(sum(r is not None and r <= 8 for r in fred_ranks), total),
            "gold_generated_anywhere": sum(r is not None for r in fred_ranks),
        },
        "rrf_union": {
            "top1": metric(sum(r == 1 for r in rrf_ranks), total),
            "recall8": metric(sum(r is not None and r <= 8 for r in rrf_ranks), total),
            "gold_generated_anywhere": sum(r is not None for r in rrf_ranks),
            "candidate_count_mean": statistics.mean(row["candidate_count"] for row in results) if results else 0.0,
            "targets_with_no_candidates": sum(row["candidate_count"] == 0 for row in results),
        },
        "union_candidate_coverage": metric(sum(r is not None for r in rrf_ranks), total),
    }
    return {
        "schema": "NEUROGENESIS_ROBERTA_FRED_RRF_CANDIDATE_POOL_V1",
        "sources": {
            "roberta": "ruRoBERTa-large Top-32 candidate pool with original generator ranks",
            "fred": "FRED-T5-large matched Top-8 with sequence ranks",
        },
        "methodology": {
            "join_key": ["sentence_id", "target_index"],
            "deduplication": "Unicode-normalized surface form; ё/е and combining acute are normalized.",
            "fusion": "RRF score = sum(1 / (k + source_rank)); fixed k=60; absent source rank contributes zero.",
            "gold_exposure": "Gold forms are used only for evaluation after candidate ordering; not for candidate generation, deduplication, or ranking.",
            "candidate_limit": "At most 32 RoBERTa plus 8 FRED candidates before normalized deduplication.",
        },
        "metrics": metrics,
        "results": results,
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--roberta-report", required=True)
    parser.add_argument("--fred-report", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--rrf-k", type=int, default=60)
    parser.add_argument("--expected-targets", type=int, default=349)
    args = parser.parse_args()
    if args.rrf_k <= 0:
        raise SystemExit("--rrf-k must be positive.")
    rb = json.loads(Path(args.roberta_report).read_text(encoding="utf-8"))
    fd = json.loads(Path(args.fred_report).read_text(encoding="utf-8"))
    merged = merge_reports(rb, fd, rrf_k=args.rrf_k, expected_targets=args.expected_targets)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"metrics": merged["metrics"], "output": str(output)},
                     ensure_ascii=False, indent=2), flush=True)

if __name__ == "__main__":
    main()
