#!/usr/bin/env python3
"""Rerank ruRoBERTa candidate words with ruMorph contextual morphology.

This is a morphology-confidence heuristic, not a semantic language-model score:
ruMorph's contextual probability estimates confidence in the selected analysis
of a candidate in sentence context. The benchmark measures whether this signal
actually improves ranking; it must not be assumed to do so.
"""

import argparse
import json
import math
import statistics
from pathlib import Path

from rumorph import Analyzer


def normalize(value):
    import unicodedata
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    return unicodedata.normalize("NFKC", decomposed.replace("\u0301", "")).lower().replace("ё", "е")


def metric(hits, total):
    return {"correct": int(hits), "total": int(total),
            "accuracy": float(hits / total) if total else 0.0}


def summarize(rows, field):
    return metric(sum(bool(row.get(field)) for row in rows), len(rows))


def make_words(case):
    words = list(case.get("tokens", []))
    index = int(case.get("target_index", -1))
    if index < 0 or index >= len(words):
        return None, None
    return words, index


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Deterministic matched UD cases")
    parser.add_argument("--candidates", required=True, help="ruRoBERTa Top-32 candidate report")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    candidate_report = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    cases = source.get("cases", [])
    candidate_rows = candidate_report.get("results", [])
    if not cases or not candidate_rows:
        raise SystemExit("Benchmark cases or candidate rows are empty.")

    case_index = {
        (row.get("sentence_id"), row.get("gold_form"), row.get("upos")): row
        for row in cases
    }
    morph = Analyzer()
    reranked_rows = []
    excluded = []
    total_candidates = 0
    analysis_errors = 0

    for row_index, result in enumerate(candidate_rows):
        key = (result.get("sentence_id"), result.get("gold_form"), result.get("upos"))
        case = case_index.get(key)
        candidates = result.get("top_candidates", [])
        if case is None or not candidates:
            excluded.append({
                "sentence_id": result.get("sentence_id"),
                "gold_form": result.get("gold_form"),
                "reason": "missing_case_or_candidate_pool",
            })
            reranked_rows.append({
                "sentence_id": result.get("sentence_id"),
                "gold_form": result.get("gold_form"),
                "gold_normalized": result.get("gold_normalized"),
                "generator_gold_rank": result.get("gold_rank"),
                "generator_top1": bool(result.get("top1")),
                "generator_top8": bool(result.get("top8")),
                "generator_top32": result.get("gold_rank") is not None and result.get("gold_rank") <= 32,
                "morph_gold_rank": None,
                "morph_top1": False,
                "morph_top8": False,
                "morph_top32": False,
                "candidate_count": 0,
                "morph_error": "missing_case_or_candidate_pool",
            })
            continue

        base_words, target_index = make_words(case)
        if base_words is None:
            excluded.append({
                "sentence_id": result.get("sentence_id"),
                "gold_form": result.get("gold_form"),
                "reason": "invalid_target_index",
            })
            continue

        scored = []
        for original_rank, candidate in enumerate(candidates, start=1):
            surface = str(candidate.get("surface") or "")
            if not surface:
                continue
            words = base_words[:]
            words[target_index] = surface
            try:
                analyses_by_token = morph.analyze_sentence(words)
                token_analyses = analyses_by_token[target_index]
                if not token_analyses:
                    raise RuntimeError("ruMorph returned no analysis for candidate token")
                analysis = token_analyses[0]
                probability = float(analysis.prob)
                if not math.isfinite(probability):
                    raise RuntimeError("ruMorph returned non-finite probability")
                probability = max(0.0, min(1.0, probability))
                scored.append({
                    "surface": surface,
                    "normalized": candidate.get("normalized") or normalize(surface),
                    "original_rank": original_rank,
                    "morph_probability": probability,
                    "morph_pos": str(analysis.pos),
                    "morph_lemma": str(analysis.lemma),
                    "morph_features": dict(analysis.feats),
                    "morph_source": str(analysis.source),
                    "morph_labels": sorted(str(label) for label in analysis.labels),
                })
            except Exception as exc:
                analysis_errors += 1
                scored.append({
                    "surface": surface,
                    "normalized": candidate.get("normalized") or normalize(surface),
                    "original_rank": original_rank,
                    "morph_probability": 0.0,
                    "morph_pos": None,
                    "morph_lemma": None,
                    "morph_features": {},
                    "morph_source": "error",
                    "morph_labels": [],
                    "error": f"{type(exc).__name__}: {exc}",
                })
            total_candidates += 1

        scored.sort(key=lambda item: (-item["morph_probability"], item["original_rank"]))
        gold = result.get("gold_normalized") or normalize(result.get("gold_form"))
        morph_rank = next((rank for rank, candidate in enumerate(scored, start=1)
                           if candidate["normalized"] == gold), None)
        generator_rank = result.get("gold_rank")
        reranked_rows.append({
            "sentence_id": result.get("sentence_id"),
            "gold_form": result.get("gold_form"),
            "gold_normalized": gold,
            "upos_for_evaluation_only": case.get("upos"),
            "ruRoberta_piece_count": result.get("ruRoberta_piece_count"),
            "generator_gold_rank": generator_rank,
            "generator_top1": bool(result.get("top1")),
            "generator_top8": bool(result.get("top8")),
            "generator_top32": generator_rank is not None and generator_rank <= 32,
            "morph_gold_rank": morph_rank,
            "morph_top1": morph_rank == 1,
            "morph_top8": morph_rank is not None and morph_rank <= 8,
            "morph_top32": morph_rank is not None and morph_rank <= 32,
            "candidate_pool_size": len(scored),
            "top_candidates_after_morph_reranking": scored[:8],
        })
        if (row_index + 1) % 50 == 0:
            print(f"ruMorph reranking {row_index + 1}/{len(candidate_rows)} targets", flush=True)

    metrics = {
        "targets": len(reranked_rows),
        "candidate_analyses": total_candidates,
        "analysis_errors": analysis_errors,
        "generator_top1": summarize(reranked_rows, "generator_top1"),
        "generator_recall8": summarize(reranked_rows, "generator_top8"),
        "generator_recall32": summarize(reranked_rows, "generator_top32"),
        "morph_top1": summarize(reranked_rows, "morph_top1"),
        "morph_recall8": summarize(reranked_rows, "morph_top8"),
        "morph_recall32": summarize(reranked_rows, "morph_top32"),
        "mean_candidate_pool": statistics.mean(
            row.get("candidate_pool_size", 0) for row in reranked_rows
        ) if reranked_rows else 0.0,
    }

    by_piece_count = {}
    piece_counts = sorted({
        str(row["ruRoberta_piece_count"])
        for row in reranked_rows
        if row.get("ruRoberta_piece_count") is not None
    })
    for piece_count in piece_counts:
        subset = [row for row in reranked_rows
                  if str(row.get("ruRoberta_piece_count")) == piece_count]
        by_piece_count[piece_count] = {
            "targets": len(subset),
            "generator_top1": summarize(subset, "generator_top1"),
            "generator_recall8": summarize(subset, "generator_top8"),
            "morph_top1": summarize(subset, "morph_top1"),
            "morph_recall8": summarize(subset, "morph_top8"),
        }

    report = {
        "schema": "NEUROGENESIS_RUMORPH_CONTEXTUAL_RERANKER_V1",
        "model": {
            "id": "SergeyShk/ruMorph",
            "package": "rumorph",
            "package_version": "0.5.0",
            "context_model": "BiLSTM approximately 0.9 MB, bundled with package",
            "purpose": "Context-sensitive Russian morphology analysis and parse confidence",
            "score_interpretation": "Selected-analysis confidence for the candidate form in the supplied sentence; not a semantic probability that the candidate is the correct word.",
            "training_data_note": "The package states that its contextual model was trained on UD_Russian-Taiga, UD_Russian-GSD and OpenCorpora. GSD train/dev supervision is therefore declared; benchmark targets are drawn from the pinned GSD test portion.",
            "license_note": "Python/Rust code is MIT; bundled dictionary data is CC-BY-SA-4.0. This experiment does not redistribute or vendor the dependency separately.",
        },
        "methodology": {
            "candidate_generator": "ai-forever/ruRoberta-large",
            "candidate_pool": "Top 32 whole-word candidates per target, generated without exposing the gold target.",
            "reranking_input": "The target-hidden benchmark token sequence with one generated candidate substituted at the target position.",
            "gold_target_exposure": "Gold forms and UPOS are used for post-inference metrics only. Neither is passed to ruMorph.",
            "reranking_rule": "Sort by the contextual analyzer's probability for its top target-token analysis; original generator rank is only a tie-breaker.",
            "limitation": "This scorer reorders candidates but cannot recover a gold form absent from the generator's Top-32 pool. Morphological confidence does not measure semantic correctness.",
        },
        "metrics": metrics,
        "metrics_by_generator_piece_count": by_piece_count,
        "excluded": excluded,
        "results": reranked_rows,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"metrics": metrics, "output": str(output)},
                     ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
