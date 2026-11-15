#!/usr/bin/env python3
"""Matched whole-word benchmark for deepvk/RuModernBERT-small.

The target words are selected from the same 349 multi-piece cases used by the
previous ruBert-base beam experiment. ruRoBERTa's byte-level BPE tokenizer is
handled explicitly: word-start tokens use the Ġ marker when preceded by space,
and continuation tokens do not. Gold token IDs are used only for evaluation.
"""

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
from transformers import AutoModelForMaskedLM, AutoTokenizer

MODEL_ID = "deepvk/RuModernBERT-small"
MODEL_REVISION = "patched-tokenizer"
BASE_MODEL_ID = "ai-forever/ruBert-base"
BASE_MODEL_REVISION = "05f37a2ca9e333fd18f30cd0c96c68d274793c69"
MAX_PIECES = 8
BEAM_WIDTH = 8
BRANCH_SIZE = 8
BATCH_SIZE = 8
MAX_LENGTH = 192
TOP_TOKEN_POOL = 512
WORD_RE = re.compile(r"[\w-]+", flags=re.UNICODE)


def normalize(value):
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    return unicodedata.normalize("NFKC", decomposed.replace("\u0301", "")).lower().replace("ё", "е")


assert normalize("й Й число\u0301 Число\u0301 ё Ё") == "й й число число е е"


def metric(hits, total):
    return {
        "correct": int(hits),
        "total": int(total),
        "accuracy": float(hits / total) if total else 0.0,
    }


def prepare_cases(source, base_tokenizer, tokenizer):
    """Select exactly the old ruBert-base multi-piece target population."""
    prepared = []
    excluded = []
    for case in source.get("cases", []):
        gold = str(case.get("gold_form", ""))
        base_ids = base_tokenizer(gold, add_special_tokens=False)["input_ids"]
        if len(base_ids) <= 1:
            continue

        masked_text = str(case.get("masked_sentence") or "")
        marker = "[MASK]"
        if masked_text.count(marker) != 1:
            tokens = list(case.get("tokens", []))
            target_index = int(case.get("target_index", -1))
            if target_index < 0 or target_index >= len(tokens):
                excluded.append({"sentence_id": case.get("sentence_id"), "gold_form": gold,
                                 "reason": "missing_single_mask_and_valid_target_index"})
                continue
            tokens[target_index] = marker
            masked_text = " ".join(tokens)

        mask_char = masked_text.index(marker)
        original_text = masked_text[:mask_char] + gold + masked_text[mask_char + len(marker):]
        leading_space = mask_char > 0 and masked_text[mask_char - 1].isspace()

        encoded_original = tokenizer(
            original_text,
            add_special_tokens=True,
            truncation=True,
            max_length=MAX_LENGTH,
            return_offsets_mapping=True,
        )
        offsets = encoded_original.get("offset_mapping")
        if offsets is None:
            raise RuntimeError("The selected tokenizer must expose offset_mapping.")
        target_end = mask_char + len(gold)
        gold_positions = [
            index for index, (start, end) in enumerate(offsets)
            if end > start and start < target_end and end > mask_char
        ]
        gold_ids = [int(encoded_original["input_ids"][index]) for index in gold_positions]
        if not gold_ids:
            excluded.append({"sentence_id": case.get("sentence_id"), "gold_form": gold,
                             "reason": "target_offsets_not_found"})
            continue

        prepared.append({
            "case": case,
            "masked_text_one": masked_text.replace(marker, tokenizer.mask_token, 1),
            "original_text": original_text,
            "gold_ids": gold_ids,
            "gold_tokens": tokenizer.convert_ids_to_tokens(gold_ids),
            "piece_count": len(gold_ids),
            "leading_space": leading_space,
        })

    return prepared, excluded


def safe_single_token_word(tokenizer, token_id, leading_space):
    token_id = int(token_id)
    piece = tokenizer.convert_ids_to_tokens(token_id)
    if not piece or piece in tokenizer.all_special_tokens:
        return None
    surface = tokenizer.decode(
        [token_id], skip_special_tokens=True, clean_up_tokenization_spaces=False
    ).strip()
    if not surface or not WORD_RE.fullmatch(surface):
        return None
    roundtrip_text = (" " if leading_space else "") + surface
    encoded = tokenizer(roundtrip_text, add_special_tokens=False)["input_ids"]
    if len(encoded) != 1 or int(encoded[0]) != token_id:
        return None
    return surface


def run_single_piece(model, tokenizer, prepared):
    rows = []
    with torch.inference_mode():
        for offset in range(0, len(prepared), BATCH_SIZE):
            chunk = prepared[offset:offset + BATCH_SIZE]
            encoded = tokenizer(
                [item["masked_text_one"] for item in chunk],
                return_tensors="pt", padding=True, truncation=True, max_length=MAX_LENGTH,
            )
            input_ids = encoded["input_ids"]
            attention_mask = encoded.get("attention_mask")
            mask_hits = input_ids.eq(tokenizer.mask_token_id)
            output = model(input_ids=input_ids, attention_mask=attention_mask)
            for row_index, item in enumerate(chunk):
                positions = mask_hits[row_index].nonzero(as_tuple=False).flatten()
                case = item["case"]
                gold = case["gold_normalized"]
                if len(item["gold_ids"]) != 1 or len(positions) != 1:
                    continue
                gold_id = item["gold_ids"][0]
                logits = output.logits[row_index, int(positions[0])].float()
                rank = int((logits > logits[gold_id]).sum().item()) + 1
                _, ids = torch.topk(logits, k=min(TOP_TOKEN_POOL, int(logits.numel())))
                candidates = []
                seen = set()
                for token_id in ids.tolist():
                    word = safe_single_token_word(tokenizer, token_id, item["leading_space"])
                    if not word:
                        continue
                    key = normalize(word)
                    if key in seen:
                        continue
                    seen.add(key)
                    candidates.append({"surface": word, "normalized": key,
                                       "token_id": int(token_id)})
                    if len(candidates) >= 8:
                        break
                rows.append({
                    "sentence_id": case.get("sentence_id"),
                    "gold_form": case["gold_form"],
                    "gold_normalized": gold,
                    "upos": case.get("upos"),
                    "ruRoberta_piece_count": 1,
                    "gold_token_rank_full_vocab": rank,
                    "top_candidates": candidates,
                    "candidate_count": len(candidates),
                    "gold_rank": next((rank for rank, candidate in enumerate(candidates, 1)
                                       if candidate["normalized"] == gold), None),
                    "top1": bool(candidates and candidates[0]["normalized"] == gold),
                    "top8": any(row["normalized"] == gold for row in candidates[:8]),
                    "masked_input": item["masked_text_one"],
                })
            print(f"single-piece inference: {min(offset + BATCH_SIZE, len(prepared))}/{len(prepared)}",
                  flush=True)
    return rows


def build_token_pools(tokenizer):
    """Classify byte-BPE token IDs by leading-space and continuation behavior."""
    special = set(tokenizer.all_special_ids)
    tokens = tokenizer.convert_ids_to_tokens(list(range(len(tokenizer))))
    with_space = []
    without_space = []
    boundary = []
    start_markers = ("Ġ", "▁")
    marker_counts = {marker: sum(token.startswith(marker) for token in tokens if token)
                     for marker in start_markers}
    marker = max(start_markers, key=lambda item: marker_counts[item])
    if marker_counts[marker] == 0:
        raise RuntimeError(
            "Could not identify a byte-BPE word-start marker. "
            f"Tokenizer class={type(tokenizer).__name__}; marker_counts={marker_counts}"
        )
    for token_id, piece in enumerate(tokens):
        if token_id in special or not piece:
            continue
        if piece.startswith(marker):
            with_space.append(token_id)
            boundary.append(token_id)
            continue
        without_space.append(token_id)
        decoded = tokenizer.decode(
            [token_id], skip_special_tokens=True, clean_up_tokenization_spaces=False
        )
        chars = [char for char in decoded if not char.isspace()]
        if chars and all(unicodedata.category(char)[0] in {"P", "S"} for char in chars):
            boundary.append(token_id)
    if not with_space or not without_space or not boundary:
        raise RuntimeError("Unable to identify byte-BPE start, continuation, or boundary token pools.")
    return {
        "with_space": torch.tensor(with_space, dtype=torch.long),
        "without_space": torch.tensor(without_space, dtype=torch.long),
        "boundary": torch.tensor(boundary, dtype=torch.long),
        "word_start_marker": marker,
        "word_start_token_count": len(with_space),
    }


def decode_candidate(tokenizer, token_ids, leading_space):
    if not token_ids:
        return None
    decoded = tokenizer.decode(
        list(token_ids), skip_special_tokens=True, clean_up_tokenization_spaces=False
    )
    surface = re.sub(r"\s+", "", decoded.strip())
    if not surface or not WORD_RE.fullmatch(surface):
        return None
    roundtrip_text = (" " if leading_space else "") + surface
    encoded = tokenizer(roundtrip_text, add_special_tokens=False)["input_ids"]
    if [int(value) for value in encoded] != [int(value) for value in token_ids]:
        return None
    return surface


def prepare_multi_piece(tokenizer, prepared):
    multi = []
    excluded = []
    mask_count = MAX_PIECES + 1
    mask_span = " ".join([tokenizer.mask_token] * mask_count)
    for item in prepared:
        if item["piece_count"] <= 1:
            continue
        if item["piece_count"] > MAX_PIECES:
            excluded.append({"sentence_id": item["case"].get("sentence_id"),
                             "gold_form": item["case"]["gold_form"],
                             "piece_count": item["piece_count"],
                             "reason": "over_max_pieces"})
            continue
        masked_text = item["masked_text_one"].replace(tokenizer.mask_token, mask_span, 1)
        encoded = tokenizer(
            masked_text, add_special_tokens=True, truncation=True,
            max_length=MAX_LENGTH, padding=False,
        )
        input_ids = [int(value) for value in encoded["input_ids"]]
        positions = [index for index, value in enumerate(input_ids)
                     if value == tokenizer.mask_token_id]
        if len(positions) != mask_count:
            excluded.append({"sentence_id": item["case"].get("sentence_id"),
                             "gold_form": item["case"]["gold_form"],
                             "piece_count": item["piece_count"],
                             "reason": "mask_span_truncated_or_not_tokenized"})
            continue
        if positions != list(range(positions[0], positions[0] + mask_count)):
            excluded.append({"sentence_id": item["case"].get("sentence_id"),
                             "gold_form": item["case"]["gold_form"],
                             "piece_count": item["piece_count"],
                             "reason": "mask_positions_not_contiguous"})
            continue
        multi.append({
            **item,
            "masked_text": masked_text,
            "input_ids": input_ids,
            "mask_positions": positions,
        })
    return multi, excluded


def run_gold_prefix_diagnostics(model, tokenizer, prepared, pools):
    tasks = []
    for item_index, item in enumerate(prepared):
        for depth, gold_id in enumerate(item["gold_ids"]):
            ids = list(item["input_ids"])
            for prefix_index, token_id in enumerate(item["gold_ids"][:depth]):
                ids[item["mask_positions"][prefix_index]] = int(token_id)
            tasks.append({
                "item_index": item_index, "depth": depth, "ids": ids,
                "query_position": item["mask_positions"][depth], "gold_id": int(gold_id),
            })
    rows = []
    with torch.inference_mode():
        for start in range(0, len(tasks), BATCH_SIZE):
            chunk = tasks[start:start + BATCH_SIZE]
            max_len = max(len(task["ids"]) for task in chunk)
            batch_ids = torch.full((len(chunk), max_len), tokenizer.pad_token_id, dtype=torch.long)
            batch_attention = torch.zeros((len(chunk), max_len), dtype=torch.long)
            for row_index, task in enumerate(chunk):
                batch_ids[row_index, :len(task["ids"])] = torch.tensor(task["ids"], dtype=torch.long)
                batch_attention[row_index, :len(task["ids"])] = 1
            output = model(input_ids=batch_ids, attention_mask=batch_attention)
            for row_index, task in enumerate(chunk):
                item = prepared[task["item_index"]]
                allowed = pools["with_space"] if task["depth"] == 0 and item["leading_space"] else (
                    pools["without_space"] if task["depth"] == 0 else pools["without_space"]
                )
                logits = output.logits[row_index, task["query_position"]].float()
                allowed_logits = logits.index_select(0, allowed)
                gold_logit = logits[task["gold_id"]]
                rank = int((allowed_logits > gold_logit).sum().item()) + 1
                rows.append({
                    "sentence_id": item["case"].get("sentence_id"),
                    "gold_form": item["case"]["gold_form"],
                    "position": task["depth"] + 1,
                    "gold_piece": tokenizer.convert_ids_to_tokens([task["gold_id"]])[0],
                    "gold_rank_given_correct_prefix": rank,
                    "gold_in_top1": rank == 1,
                    "gold_in_top8": rank <= 8,
                    "gold_in_top32": rank <= 32,
                })
    by_position = {}
    for position in sorted({row["position"] for row in rows}):
        group = [row for row in rows if row["position"] == position]
        ranks = [row["gold_rank_given_correct_prefix"] for row in group]
        by_position[str(position)] = {
            "targets": len(group),
            "top1": metric(sum(rank <= 1 for rank in ranks), len(group)),
            "top8": metric(sum(rank <= 8 for rank in ranks), len(group)),
            "top32": metric(sum(rank <= 32 for rank in ranks), len(group)),
            "median_gold_rank": statistics.median(ranks) if ranks else None,
        }
    return {"method": "teacher-forced correct prefix used for diagnostics only",
            "by_position": by_position, "piece_steps": rows}


def run_beam(model, tokenizer, prepared, pools):
    beam_width = BEAM_WIDTH
    branch_size = BRANCH_SIZE
    completed = [dict() for _ in prepared]
    active = {index: [{"ids": (), "logp": 0.0}] for index in range(len(prepared))}
    path_rows = [{
        "sentence_id": item["case"].get("sentence_id"),
        "gold_form": item["case"]["gold_form"],
        "gold_piece_count": item["piece_count"],
        "steps": [],
    } for item in prepared]

    with_space = pools["with_space"]
    without_space = pools["without_space"]
    boundary = pools["boundary"]

    for depth in range(MAX_PIECES + 1):
        states = [(index, beam) for index, beams in active.items() for beam in beams]
        if not states:
            break
        expansions = defaultdict(list)
        local_gold = {}

        for start in range(0, len(states), BATCH_SIZE):
            chunk = states[start:start + BATCH_SIZE]
            max_len = max(len(prepared[index]["input_ids"]) for index, _ in chunk)
            batch_ids = torch.full((len(chunk), max_len), tokenizer.pad_token_id, dtype=torch.long)
            batch_attention = torch.zeros((len(chunk), max_len), dtype=torch.long)
            query_positions = []
            for row_index, (item_index, beam) in enumerate(chunk):
                item = prepared[item_index]
                ids = list(item["input_ids"])
                for piece_index, token_id in enumerate(beam["ids"]):
                    ids[item["mask_positions"][piece_index]] = int(token_id)
                batch_ids[row_index, :len(ids)] = torch.tensor(ids, dtype=torch.long)
                batch_attention[row_index, :len(ids)] = 1
                query_positions.append(item["mask_positions"][depth])

            with torch.inference_mode():
                output = model(input_ids=batch_ids, attention_mask=batch_attention)

            for row_index, (item_index, beam) in enumerate(chunk):
                item = prepared[item_index]
                logits = output.logits[row_index, query_positions[row_index]].float()
                log_probs = torch.log_softmax(logits, dim=-1)
                gold_ids = item["gold_ids"]

                if depth < len(gold_ids) and tuple(beam["ids"]) == tuple(gold_ids[:depth]):
                    allowed = (with_space if item["leading_space"] else without_space) if depth == 0 else without_space
                    gold_logp = float(log_probs[int(gold_ids[depth])].item())
                    allowed_logp = log_probs.index_select(0, allowed)
                    local_gold[item_index] = {
                        "depth": depth + 1,
                        "gold_piece": tokenizer.convert_ids_to_tokens([int(gold_ids[depth])])[0],
                        "gold_local_rank": int((allowed_logp > gold_logp).sum().item()) + 1,
                    }

                if depth > 0:
                    boundary_logp = float(torch.logsumexp(log_probs.index_select(0, boundary), dim=0).item())
                    surface = decode_candidate(tokenizer, beam["ids"], item["leading_space"])
                    if surface:
                        normalized = normalize(surface)
                        score = float(beam["logp"] + boundary_logp)
                        old = completed[item_index].get(normalized)
                        if old is None or score > old["score"]:
                            completed[item_index][normalized] = {
                                "surface": surface, "normalized": normalized, "score": score,
                                "piece_log_probability": float(beam["logp"]),
                                "boundary_log_probability": boundary_logp,
                                "pieces": len(beam["ids"]),
                            }

                if depth >= MAX_PIECES:
                    continue
                allowed = (with_space if item["leading_space"] else without_space) if depth == 0 else without_space
                allowed_logits = log_probs.index_select(0, allowed)
                take = min(branch_size, int(allowed_logits.numel()))
                values, offsets = torch.topk(allowed_logits, k=take)
                for value, offset in zip(values.tolist(), offsets.tolist()):
                    token_id = int(allowed[int(offset)].item())
                    expansions[item_index].append({
                        "ids": tuple(beam["ids"]) + (token_id,),
                        "logp": float(beam["logp"] + value),
                    })

        next_active = {}
        for item_index, candidates in expansions.items():
            candidates.sort(key=lambda row: row["logp"], reverse=True)
            unique = []
            seen = set()
            for candidate in candidates:
                if candidate["ids"] in seen:
                    continue
                seen.add(candidate["ids"])
                unique.append(candidate)
            gold_ids = prepared[item_index]["gold_ids"]
            expanded_rank = None
            if depth < len(gold_ids):
                gold_prefix = tuple(gold_ids[:depth + 1])
                expanded_rank = next((rank for rank, candidate in enumerate(unique, 1)
                                      if candidate["ids"] == gold_prefix), None)
                step = local_gold.get(item_index, {
                    "depth": depth + 1,
                    "gold_piece": tokenizer.convert_ids_to_tokens([int(gold_ids[depth])])[0],
                    "gold_local_rank": None,
                })
                step["expanded_prefix_rank_before_beam_prune"] = expanded_rank
                step["survived_global_beam"] = expanded_rank is not None and expanded_rank <= beam_width
                step["beam_width"] = beam_width
                step["branch_size"] = branch_size
                path_rows[item_index]["steps"].append(step)
            keep = unique[:beam_width]
            if keep:
                next_active[item_index] = keep
        active = next_active
        print(f"ruRoberta beam depth {depth}: active_states={sum(map(len, active.values()))}",
              flush=True)

    results = []
    for index, item in enumerate(prepared):
        candidates = list(completed[index].values())
        candidates.sort(key=lambda row: row["score"], reverse=True)
        gold = item["case"]["gold_normalized"]
        ranks = {}
        for boundary_weight in (0.0, 0.5, 1.0, 2.0):
            ranked = sorted(
                candidates,
                key=lambda row: row["piece_log_probability"] +
                                boundary_weight * row["boundary_log_probability"],
                reverse=True,
            )
            ranks[str(boundary_weight)] = next(
                (rank for rank, row in enumerate(ranked, 1) if row["normalized"] == gold), None
            )
        rank = ranks["1.0"]
        results.append({
            "sentence_id": item["case"].get("sentence_id"),
            "gold_form": item["case"]["gold_form"],
            "gold_normalized": gold,
            "upos": item["case"].get("upos"),
            "ruRoberta_piece_count": item["piece_count"],
            "gold_tokens": item["gold_tokens"],
            "candidate_count": len(candidates),
            "gold_rank": rank,
            "top1": rank == 1,
            "top8": rank is not None and rank <= 8,
            "ranker_ranks_by_boundary_weight": ranks,
            "top_candidates": candidates[:8],
            "masked_input": item["masked_text"],
        })
    return results, path_rows


def summarize(rows):
    return {
        "targets": len(rows),
        "top1": metric(sum(bool(row["top1"]) for row in rows), len(rows)),
        "recall8": metric(sum(bool(row["top8"]) for row in rows), len(rows)),
        "gold_generated_anywhere": sum(row.get("gold_rank") is not None for row in rows),
        "candidate_count_mean": statistics.mean(row.get("candidate_count", 0) for row in rows) if rows else 0.0,
        "targets_with_no_candidates": sum(row.get("candidate_count", 0) == 0 for row in rows),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--baseline-report", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    baseline = json.loads(Path(args.baseline_report).read_text(encoding="utf-8"))
    cases = source.get("cases", [])
    if not cases:
        raise SystemExit("No benchmark cases found in the pinned baseline artifact.")

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    base_tokenizer = AutoTokenizer.from_pretrained(
        BASE_MODEL_ID, revision=BASE_MODEL_REVISION
    )
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model = AutoModelForMaskedLM.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model.to("cpu")
    model.eval()

    prepared, offset_excluded = prepare_cases(source, base_tokenizer, tokenizer)
    expected_total = int(baseline.get("coverage", {}).get("all_multi_piece_targets", 0))
    if expected_total and len(prepared) != expected_total:
        raise RuntimeError(
            f"Matched sample drift: selected {len(prepared)} cases, baseline contains {expected_total}."
        )

    one_piece = [item for item in prepared if item["piece_count"] == 1]
    multi_source = [item for item in prepared if item["piece_count"] > 1]
    one_results = run_single_piece(model, tokenizer, one_piece)
    pools = build_token_pools(tokenizer)
    multi_prepared, multi_excluded = prepare_multi_piece(tokenizer, prepared)
    gold_prefix = run_gold_prefix_diagnostics(model, tokenizer, multi_prepared, pools)
    multi_results, path_rows = run_beam(model, tokenizer, multi_prepared, pools)

    if len(one_results) != len(one_piece):
        raise RuntimeError(f"Single-mask evaluation lost cases: {len(one_results)} of {len(one_piece)}")
    excluded_combined = [{
        "sentence_id": row.get("sentence_id"),
        "gold_form": row.get("gold_form"),
        "gold_normalized": normalize(row.get("gold_form")),
        "upos": None,
        "ruRoberta_piece_count": row.get("piece_count"),
        "candidate_count": 0,
        "gold_rank": None,
        "top1": False,
        "top8": False,
        "top_candidates": [],
        "excluded_reason": row.get("reason"),
    } for row in multi_excluded]
    combined = one_results + multi_results + excluded_combined
    if len(combined) != len(prepared):
        raise RuntimeError(f"Combined output count mismatch: {len(combined)} != {len(prepared)}")
    combined_summary = summarize(combined)
    piece_summary = {}
    for piece_count in sorted({item["piece_count"] for item in prepared}):
        subset = [row for row in combined if row["ruRoberta_piece_count"] == piece_count]
        piece_summary[str(piece_count)] = summarize(subset)

    baseline_metrics = baseline.get("metrics", {})
    model_info = {
        "id": MODEL_ID,
        "resolved_revision": getattr(model.config, "_commit_hash", None),
        "tokenizer_revision": MODEL_REVISION,
        "parameters": 35000000,
        "weights_size_on_hugging_face": "143 MB",
        "license": "apache-2.0",
        "pretrained_task": "masked language modeling / fill-mask",
        "training_data_volume": "approximately 2 trillion tokens, Russian / English / code",
        "tokenizer": type(tokenizer).__name__,
        "word_start_marker": pools["word_start_marker"],
        "word_start_token_count": pools["word_start_token_count"],
        "fine_tuned_on_ud_for_this_benchmark": False,
    }
    report = {
        "schema": "NEUROGENESIS_RUROBERTA_LARGE_WORDFILL_V1",
        "model": model_info,
        "methodology": {
            "matched_population": "Exactly the targets whose gold form had multiple WordPiece tokens under the previous pinned ai-forever/ruBert-base tokenizer.",
            "matched_target_count": len(prepared),
            "baseline_run": "GitHub Actions run 43733165091; old ruBert-base multi-piece WordPiece beam result.",
            "proven_generator_reference": {
                "model": "ai-forever/ruRoberta-large",
                "top1": {"correct": 78, "total": 349, "accuracy": 78 / 349},
                "recall8": {"correct": 118, "total": 349, "accuracy": 118 / 349}
            },
            "gold_target_exposure": "The target string is replaced by MASK tokens for inference. Gold token IDs are used only for candidate scoring and teacher-forced diagnostics.",
            "variable_length_leakage": "Every target receives the same fixed block of nine masks; its true byte-BPE piece count is not revealed to the search.",
            "word_decoder": "One-piece RuRoBERTa words use a single-mask filtered token ranking; multi-piece words use an 8-wide beam with 8 branches and a next-token word-boundary probability.",
            "byte_bpe_rules": "Word starts are selected using the tokenizer's Ġ prefix when the masked position follows whitespace; continuation pieces do not use Ġ. Candidate surfaces must round-trip to the exact generated token IDs.",
            "max_generated_pieces": MAX_PIECES,
            "tokenizer_note": "Uses the patched-tokenizer revision that makes six frequent Russian lowercase letters single tokens."
            "beam_width": BEAM_WIDTH,
            "branch_size": BRANCH_SIZE,
            "max_sequence_length": MAX_LENGTH,
            "batch_size": BATCH_SIZE,
        },
        "coverage": {
            "matched_old_baseline_targets": len(prepared),
            "ruRoberta_single_piece_targets": len(one_piece),
            "ruRoberta_multi_piece_targets": len(multi_source),
            "multi_piece_decoded_targets": len(multi_prepared),
            "multi_piece_excluded_targets": len(multi_excluded),
            "offset_excluded_targets": len(offset_excluded),
        },
        "comparison": {
            "previous_ruBert_base_top1_all_multi_piece": baseline_metrics.get("top1_all_multi_piece_with_excluded_as_miss"),
            "previous_ruBert_base_recall8_all_multi_piece": baseline_metrics.get("recall8_all_multi_piece_with_excluded_as_miss"),
            "ruRoberta_large_combined_word_top1": combined_summary["top1"],
            "ruRoberta_large_combined_word_recall8": combined_summary["recall8"],
            "ruRoberta_large_word_metrics_by_piece_count": piece_summary,
        },
        "metrics": {
            "combined_word_prediction": combined_summary,
            "single_piece_masked_word": summarize(one_results),
            "multi_piece_beam": summarize(multi_results),
        },
        "diagnostics": {
            "gold_prefix_teacher_forced": gold_prefix,
            "beam_path_survival": {
                "targets": len(path_rows),
                "gold_prefix_survived_all_steps": sum(
                    bool(row["steps"]) and all(step["survived_global_beam"] for step in row["steps"])
                    for row in path_rows
                ),
                "by_position": {
                    str(position): {
                        "targets": sum(len(row["steps"]) >= position for row in path_rows),
                        "prefix_active": sum(
                            len(row["steps"]) >= position and
                            row["steps"][position - 1]["gold_local_rank"] is not None
                            for row in path_rows
                        ),
                        "survived_global_beam": sum(
                            len(row["steps"]) >= position and
                            row["steps"][position - 1]["survived_global_beam"]
                            for row in path_rows
                        ),
                    } for position in range(1, MAX_PIECES + 1)
                },
                "examples": path_rows[:30],
            },
            "excluded": (offset_excluded + multi_excluded)[:60],
        },
        "results": combined,
        "single_piece_results": one_results,
        "multi_piece_results": multi_results,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "coverage": report["coverage"],
        "comparison": report["comparison"],
        "output": str(out),
    }, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
