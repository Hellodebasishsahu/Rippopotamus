"""Tests for the eval harness scoring logic."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from rippopotamus import footage_index
from rippopotamus.eval_harness import run_eval, format_table, score_result


class TestScoreResult(unittest.TestCase):
    def test_empty_expected_always_matches(self) -> None:
        self.assertTrue(score_result({"start": 0, "end": 10, "path": "/a.mp4"}, []))

    def test_path_match_without_time_range(self) -> None:
        self.assertTrue(score_result(
            {"start": 0, "end": 10, "path": "/foo/bar.mp4"},
            [{"path": "bar.mp4", "start": 0, "end": 0}],
        ))

    def test_time_overlap_match(self) -> None:
        self.assertTrue(score_result(
            {"start": 5, "end": 15, "path": "/a.mp4"},
            [{"start": 10, "end": 20}],
        ))

    def test_no_overlap_no_match(self) -> None:
        self.assertFalse(score_result(
            {"start": 0, "end": 5, "path": "/a.mp4"},
            [{"start": 50, "end": 60}],
        ))


class TestRunEval(unittest.TestCase):
    def test_eval_on_known_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "index"
            media = Path(tmp) / "media"
            media.mkdir()
            video = media / "drone-aerial-rally-crowd.mp4"
            video.write_bytes(b"fake")

            footage_index.ingest_paths(root, [media])

            queries = [
                {"query": "drone aerial", "expected": [{"path": "drone-aerial-rally-crowd.mp4"}]},
                {"query": "nonexistent topic xyz", "expected": [{"path": "missing.mp4"}]},
                {"query": "no expectation", "expected": [], "allowZero": True},
            ]

            result = run_eval(root, queries, limit=5)

            self.assertEqual(result["queryCount"], 3)
            self.assertEqual(result["scorableQueries"], 2)
            self.assertEqual(result["hits"], 1)
            self.assertGreater(result["recall_at_k"], 0)
            self.assertGreater(result["mrr"], 0)


class TestFormatTable(unittest.TestCase):
    def test_format_produces_string(self) -> None:
        run = {
            "recall_at_k": 0.5,
            "mrr": 0.3333,
            "hits": 1,
            "scorableQueries": 2,
            "limit": 5,
            "results": [
                {"query": "test query", "found": True, "rank": 1, "resultCount": 3},
                {"query": "miss query", "found": False, "rank": None, "resultCount": 0},
            ],
        }
        table = format_table(run)
        self.assertIn("test query", table)
        self.assertIn("recall@5", table)
        self.assertIn("0.5000", table)


if __name__ == "__main__":
    unittest.main()
