#!/usr/bin/env python3
"""Zero-shot Russian masked-word benchmark against the project's word-level model."""

import argparse
import json
import os
import re
import unicodedata
from pathlib import Path

import torch
from transformers import AutoModelForMaskedLM, AutoTokenizer

MODEL_ID = "ai-forever/ruBert-base"
MODEL_REVISION = "05f37a2ca9e333fd18f30cd0c96c68d274793c69"
MODEL_LICENSE = "apache-2.0"
BATCH_SIZE = 8
MAX_LENGTH = 192
TOP_TOKEN_POOL = 512
CONTENT_POS = {"NOUN", "PROPN", "VERB", "AUX", "ADJ", "ADV", "PRON", "NUM"}


def normalize(value):
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    # Remove acute stress marks only. Removing all combining marks also strips
    # the breve from Russian "й", incorrectly turning it into "и".
    without_stress = decomposed.replace("\u0301", "")
    return unicodedata.normalize("NFKC", without_stress).lower().replace("ё", "е")


assert normalize("й Й число\u0301 Число\u0301 ё Ё") == "й й число число е е", (
    "normalization must preserve й and remove stress marks"
)


def safe_word(tokenizer, token_id):
    piece = tokenizer.convert_ids_to_tokens(int(token_id))
    if not piece or piece in tokenizer.all_special_tokens:
        return None
    candidate = tokenizer.convert_tokens_to_string([piece]).strip()
    if not candidate or not re.fullmatch(r"[\w-]+", candidate, flags=re.UNICODE):
        return None
    encoded = tokenizer(candidate, add_special_tokens=False)["input_ids"]
    if len(encoded) != 1 or int(encoded[0]) != int(token_id):
        return None
    return candidate


def make_metrics(rows):
    total = len(rows)
    supported = [row for row in rows if row["rubert_supported_single_piece"]]
    result = {
        "targets_all": total,
        "targets_supported_single_piece": len(supported),
        "single_piece_coverage": len(supported) / total if total else 0.0,
    }
    for name, subset in (("all_targets", rows), ("single_piece_targets", supported)):
        denom = len(subset)
        for system in ("rubert", "internal"):
            for k in (1, 8):
                hits = sum(bool(row[f"{system}_top{k}"]) for row in subset)
                result[f"{system}_top{k}_{name}"] = {
                    "correct": hits,
                    "total": denom,
                    "accuracy": hits / denom if denom else 0.0,
                }
        for metric, field in (
            ("rubert_standalone_word_top1", "rubert_standalone_word_top1"),
            ("rubert_standalone_word_recall8", "rubert_standalone_word_recall8"),
        ):
            hits = sum(bool(row[field]) for row in subset)
            result[f"{metric}_{name}"] = {
                "correct": hits,
                "total": denom,
                "accuracy": hits / denom if denom else 0.0,
            }
    result["rubert_mask_available"] = sum(row["rubert_mask_available"] for row in rows)
    result["internal_prediction_available"] = sum(row["internal_prediction_available"] for row in rows)
    result["internal_train_vocab_oov_targets"] = sum(
        not row["in_internal_train_vocabulary"] for row in rows
    )
    return result


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
        raise RuntimeError("The selected tokenizer does not expose a mask token.")

    prepared = []
    for index, case in enumerate(cases):
        tokens = list(case["tokens"])
        target_index = int(case["target_index"])
        if target_index < 0 or target_index >= len(tokens):
            raise ValueError(f"Invalid target index in case {index}")
        masked = tokens[:]
        masked[target_index] = mask_token
        encoded_gold = tokenizer(case["gold_form"], add_special_tokens=False)["input_ids"]
        decoded_gold = tokenizer.decode(encoded_gold, skip_special_tokens=True,
                                         clean_up_tokenization_spaces=False).strip()
        exact_single_piece = (
            len(encoded_gold) == 1 and normalize(decoded_gold) == case["gold_normalized"]
            and int(encoded_gold[0]) != tokenizer.unk_token_id
        )
        masked_text = str(case.get("masked_sentence") or "")
        if masked_text.count("[MASK]") != 1:
            masked = tokens[:]
            masked[target_index] = mask_token
            masked_text = " ".join(masked)
        prepared.append({
            "case": case,
            "masked_text": masked_text,
            "gold_token_id": int(encoded_gold[0]) if exact_single_piece else None,
            "single_piece": exact_single_piece,
        })

    rows = []
    with torch.inference_mode():
        for start in range(0, len(prepared), BATCH_SIZE):
            chunk = prepared[start:start + BATCH_SIZE]
            encoded = tokenizer(
                [row["masked_text"] for row in chunk],
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=MAX_LENGTH,
            )
            input_ids = encoded["input_ids"]
            attention_mask = encoded.get("attention_mask")
            mask_hits = input_ids.eq(tokenizer.mask_token_id)
            output = model(input_ids=input_ids, attention_mask=attention_mask)
            for offset, item in enumerate(chunk):
                positions = mask_hits[offset].nonzero(as_tuple=False).flatten()
                case = item["case"]
                gold = case["gold_normalized"]
                internal = [normalize(value) for value in case.get("internal_candidates", [])]
                internal = [value for value in internal if value]
                internal_top1 = bool(internal and internal[0] == gold)
                internal_top8 = gold in internal[:8]
                internal_available = bool(internal)

                rubert_mask_available = len(positions) == 1
                gold_rank = None
                candidates = []
                supported = False
                if rubert_mask_available:
                    mask_position = int(positions[0])
                    logits = output.logits[offset, mask_position]
                    if item["single_piece"]:
                        gold_id = item["gold_token_id"]
                        gold_logit = logits[gold_id]
                        gold_rank = int((logits > gold_logit).sum().item())
                        supported = True
                    _, ids = torch.topk(
                        logits, k=min(TOP_TOKEN_POOL, int(logits.shape[-1]))
                    )
                    seen = set()
                    for token_id in ids.tolist():
                        candidate = safe_word(tokenizer, token_id)
                        if not candidate:
                            continue
                        candidate_norm = normalize(candidate)
                        if candidate_norm in seen:
                            continue
                        seen.add(candidate_norm)
                        candidates.append(candidate_norm)
                        if len(candidates) >= 8:
                            break

                rubert_top1 = supported and gold_rank == 0
                rubert_top8 = supported and gold_rank is not None and gold_rank < 8
                standalone_top1 = supported and bool(candidates) and candidates[0] == gold
                standalone_recall8 = supported and gold in candidates[:8]
                rows.append({
                    "sentence_id": case.get("sentence_id"),
                    "gold_form": case["gold_form"],
                    "gold_normalized": gold,
                    "upos": case["upos"],
                    "in_internal_train_vocabulary": bool(case["in_internal_train_vocabulary"]),
                    "rubert_supported_single_piece": supported,
                    "rubert_mask_available": rubert_mask_available,
                    "rubert_gold_rank_zero_based": gold_rank,
                    "rubert_candidates": candidates,
                    "rubert_top1": bool(rubert_top1),
                    "rubert_top8": bool(rubert_top8),
                    "rubert_standalone_word_top1": bool(standalone_top1),
                    "rubert_standalone_word_recall8": bool(standalone_recall8),
                    "internal_candidates": internal[:8],
                    "internal_prediction_available": internal_available,
                    "internal_top1": internal_top1,
                    "internal_top8": internal_top8,
                    "masked_input": item["masked_text"],
                })
            if (start // BATCH_SIZE) % 20 == 0:
                print(f"Processed {min(start + BATCH_SIZE, len(prepared))}/{len(prepared)} targets",
                      flush=True)

    groups = {
        "internal_train_vocab_seen": [row for row in rows if row["in_internal_train_vocabulary"]],
        "internal_train_vocab_oov": [row for row in rows if not row["in_internal_train_vocabulary"]],
    }
    by_pos = {
        pos: make_metrics([row for row in rows if row["upos"] == pos])
        for pos in sorted({row["upos"] for row in rows})
    }
    incorrect = [
        row for row in rows if not row["rubert_top1"] and row["rubert_mask_available"]
    ][:40]
    report = {
        "schema": "NEUROGENESIS_PRETRAINED_RUSSIAN_MLM_REPORT_V1",
        "model": {
            "id": MODEL_ID,
            "revision": MODEL_REVISION,
            "license": MODEL_LICENSE,
            "parameters": 178000000,
            "weights_size_approx_mb": 718,
            "fine_tuned_on_ud_for_this_benchmark": False,
            "mode": "zero-shot masked language modelling",
            "task": "fill exactly one [MASK] token with one standalone tokenizer token",
        },
        "methodology": {
            "corpus_revision": "UD_Russian-GSD@9acc9d677327043bd416fcc89e4b3407c620d885",
            "train_sample_sentences": source["corpus"]["sampledTrainSentences"],
            "test_sample_sentences": source["corpus"]["sampledTestSentences"],
            "train_test_sentence_overlap": source["corpus"]["normalizedSampleTrainTestOverlaps"],
            "masked_targets": len(rows),
            "target_pos": sorted(CONTENT_POS),
            "target_surface_exposure": "Gold form is replaced by [MASK] before every ruBert forward pass; gold is used only after inference for scoring.",
            "subword_constraint": "Primary comparable MLM accuracy is reported on targets represented by exactly one non-UNK BPE token. Multi-piece target words count as misses in all-target accuracy and are excluded only from the supported-single-piece metric.",
            "max_sequence_length": MAX_LENGTH,
            "batch_size": BATCH_SIZE,
            "top_candidate_filter": "Top 512 vocabulary logits are filtered to standalone round-trip single-token words. The report separates exact target-token rank in the full vocabulary from top-1/recall@8 of the filtered whole-word candidate list.",
            "internal_baseline": "The existing word-level contextual-attention model trained on the same sampled UD train partition; its target slot is replaced by a placeholder and is excluded from its context.",
        },
        "internal_model_training": source["internal_model"]["training"],
        "metrics": {
            "all": make_metrics(rows),
            "by_internal_train_vocabulary": {
                name: make_metrics(values) for name, values in groups.items()
            },
            "by_upos": by_pos,
        },
        "examples": {
            "incorrect_rubert_top1": incorrect,
            "first_cases": rows[:20],
        },
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["metrics"]["all"], ensure_ascii=False, indent=2))
    print(f"Saved report: {output}")


if __name__ == "__main__":
    main()
