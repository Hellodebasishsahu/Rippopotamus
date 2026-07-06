from __future__ import annotations

import argparse
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from rippopotamus import library
from rippopotamus.library import LedgerLoadError, download_ledger_path, load_download_ledger


def _run_library_list(root: str) -> dict:
    args = argparse.Namespace(output_root=root)
    stream = io.StringIO()
    with redirect_stdout(stream):
        code = library.command_library_list(args)
    payload = json.loads(stream.getvalue())
    return {"code": code, "payload": payload}


class LoadDownloadLedgerTests(unittest.TestCase):
    def test_missing_ledger_returns_empty_dict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(load_download_ledger(Path(tmp)), {})

    def test_corrupt_ledger_raises_ledger_load_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            download_ledger_path(root).write_text("{not valid json", encoding="utf-8")
            with self.assertRaises(LedgerLoadError):
                load_download_ledger(root)

    def test_non_dict_ledger_raises_ledger_load_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            download_ledger_path(root).write_text("[1, 2, 3]", encoding="utf-8")
            with self.assertRaises(LedgerLoadError):
                load_download_ledger(root)


class CommandLibraryListTests(unittest.TestCase):
    def _write_ledger(self, root: Path, ledger: dict) -> None:
        download_ledger_path(root).write_text(json.dumps(ledger), encoding="utf-8")

    def test_missing_ledger_returns_empty_library(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = _run_library_list(tmp)

        self.assertEqual(result["code"], 0)
        payload = result["payload"]
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["items"], [])
        self.assertEqual(payload["total"], 0)

    def test_happy_path_reports_largest_file_as_primary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            small = root / "Audio" / "track.mp3"
            large = root / "Source" / "clip.mp4"
            small.parent.mkdir(parents=True, exist_ok=True)
            large.parent.mkdir(parents=True, exist_ok=True)
            small.write_bytes(b"a" * 10)
            large.write_bytes(b"b" * 100)
            self._write_ledger(root, {
                "key1": {
                    "url": "https://example.com/video",
                    "preset": "mp4-best",
                    "files": ["Audio/track.mp3", "Source/clip.mp4"],
                }
            })

            result = _run_library_list(tmp)

        payload = result["payload"]
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["total"], 1)
        item = payload["items"][0]
        self.assertEqual(item["primaryPath"], "Source/clip.mp4")
        self.assertEqual(item["fileCount"], 2)
        self.assertEqual(item["totalSize"], 110)
        self.assertEqual(item["kind"], "video")

    def test_corrupt_ledger_reports_error_and_returns_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            download_ledger_path(root).write_text("{broken", encoding="utf-8")

            result = _run_library_list(tmp)

        self.assertEqual(result["code"], 1)
        payload = result["payload"]
        self.assertFalse(payload["ok"])
        self.assertIn("error", payload)
        self.assertEqual(payload["items"], [])

    def test_missing_files_drop_entry_and_count_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_ledger(root, {
                "gone": {
                    "url": "https://example.com/gone",
                    "preset": "mp4-best",
                    "files": ["Source/vanished.mp4"],
                }
            })

            result = _run_library_list(tmp)

        payload = result["payload"]
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["total"], 0)
        self.assertGreaterEqual(payload["missing"], 1)
        self.assertEqual(payload["items"], [])

    def test_path_escape_entry_dropped_and_counted_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_ledger(root, {
                "escape": {
                    "url": "https://example.com/escape",
                    "preset": "mp4-best",
                    "files": ["../escape.mp4"],
                },
                "absolute": {
                    "url": "https://example.com/absolute",
                    "preset": "mp4-best",
                    "files": ["/etc/passwd"],
                },
            })

            result = _run_library_list(tmp)

        payload = result["payload"]
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["total"], 0)
        self.assertGreaterEqual(payload["skipped"], 2)
        self.assertEqual(payload["items"], [])

    def test_items_sorted_by_saved_at_descending(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            older = root / "Source" / "older.mp4"
            newer = root / "Source" / "newer.mp4"
            older.parent.mkdir(parents=True, exist_ok=True)
            older.write_bytes(b"old")
            newer.write_bytes(b"new")
            os.utime(older, (1000, 1000))
            os.utime(newer, (2000, 2000))
            self._write_ledger(root, {
                "old": {"url": "https://example.com/old", "preset": "mp4-best", "files": ["Source/older.mp4"]},
                "new": {"url": "https://example.com/new", "preset": "mp4-best", "files": ["Source/newer.mp4"]},
            })

            result = _run_library_list(tmp)

        payload = result["payload"]
        self.assertEqual(payload["total"], 2)
        self.assertEqual(payload["items"][0]["primaryPath"], "Source/newer.mp4")
        self.assertEqual(payload["items"][1]["primaryPath"], "Source/older.mp4")


if __name__ == "__main__":
    unittest.main()
