#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.merge_wordfill_candidate_pools import merge_reports

class EnsembleMergeTests(unittest.TestCase):
    def setUp(self):
        self.roberta = {"results": [{
            "sentence_id": "s1", "target_index": 2, "gold_form": "берёза",
            "gold_normalized": "береза", "upos": "NOUN", "generator_piece_count": 2,
            "candidates": [
                {"original_rank": 1, "surface": "лес", "normalized": "лес"},
                {"original_rank": 2, "surface": "береза", "normalized": "береза"},
            ],
        }]}
        self.fred = {"results": [{
            "sentence_id": "s1", "target_index": 2, "gold_form": "берёза",
            "gold_normalized": "береза", "upos": "NOUN",
            "top_candidates": [
                {"sequence_rank": 1, "surface": "берёза", "normalized": "береза"},
                {"sequence_rank": 2, "surface": "дерево", "normalized": "дерево"},
            ],
        }]}

    def test_merge_and_normalized_deduplication(self):
        report = merge_reports(self.roberta, self.fred, expected_targets=1)
        row = report["results"][0]
        self.assertEqual(row["candidate_count"], 3)
        by_word = {c["normalized"]: c for c in row["top_candidates"]}
        self.assertEqual(by_word["береза"]["source_ranks"], {"roberta": 2, "fred": 1})
        self.assertEqual(by_word["лес"]["source_ranks"], {"roberta": 1})
        self.assertEqual(by_word["дерево"]["source_ranks"], {"fred": 2})
        self.assertEqual(report["metrics"]["union_candidate_coverage"]["correct"], 1)

    def test_gold_does_not_change_candidate_order(self):
        first = merge_reports(self.roberta, self.fred, expected_targets=1)
        rb = {"results": [dict(self.roberta["results"][0], gold_form="сосна", gold_normalized="сосна")]}
        fd = {"results": [dict(self.fred["results"][0], gold_form="сосна", gold_normalized="сосна")]}
        second = merge_reports(rb, fd, expected_targets=1)
        a = [c["normalized"] for c in first["results"][0]["top_candidates"]]
        b = [c["normalized"] for c in second["results"][0]["top_candidates"]]
        self.assertEqual(a, b)

    def test_target_mismatch_is_rejected(self):
        bad = {"results": [dict(self.fred["results"][0], target_index=9)]}
        with self.assertRaises(ValueError):
            merge_reports(self.roberta, bad, expected_targets=1)

    def test_shared_candidates_receive_two_rank_signals(self):
        report = merge_reports(self.roberta, self.fred, expected_targets=1)
        first = report["results"][0]["top_candidates"][0]
        self.assertEqual(first["normalized"], "береза")

if __name__ == "__main__":
    unittest.main()
