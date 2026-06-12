"""Unit tests for sheet import module and engine command."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rippopotamus.sheet_import import (
    TrackerRecord,
    filtered_records,
    spreadsheet_id,
    write_sheet_manifest,
)


class SheetImportHelpersTests(unittest.TestCase):
    def test_spreadsheet_id(self) -> None:
        url = "https://docs.google.com/spreadsheets/d/abc123XYZ/edit?gid=0#gid=0"
        self.assertEqual(spreadsheet_id(url), "abc123XYZ")

    def test_spreadsheet_id_rejects_bad_url(self) -> None:
        with self.assertRaises(SystemExit):
            spreadsheet_id("https://example.com/")

    def test_filtered_records(self) -> None:
        rows = [
            TrackerRecord(3, "1", "Haryana", "v", "#", "pc-a", "ok", "", "https://drive.example.com/1"),
            TrackerRecord(4, "2", "Punjab", "v", "#", "pc-b", "ok", "", ""),
        ]
        out = filtered_records(rows, state="haryana", pc="", status="", require_master=True, limit=10)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].pc_name, "pc-a")

    def test_write_sheet_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "manifest.json"
            rec = TrackerRecord(3, "1", "S", "v", "#", "pc", "ok", "", "https://x")
            write_sheet_manifest(
                p,
                sheet_url="https://docs.google.com/spreadsheets/d/x",
                project_name="Test",
                records=[rec],
                selected=[rec],
                row_jobs=[{"row": 3, "jobStatus": "done"}],
            )
            data = json.loads(p.read_text(encoding="utf-8"))
            self.assertEqual(data["kind"], "sheet-import")
            self.assertEqual(data["selectedRows"], 1)
            self.assertEqual(len(data["rowJobs"]), 1)


class DesktopEngineSheetImportTests(unittest.TestCase):
    def test_sheet_import_parser_accepts_flags(self) -> None:
        from rippopotamus.desktop_engine import build_parser

        parser = build_parser()
        args = parser.parse_args(
            [
                "sheet-import",
                "--sheet-url",
                "https://docs.google.com/spreadsheets/d/abc/edit",
                "--output-root",
                "/tmp/out",
                "--project-name",
                "demo",
                "--job-id",
                "job1",
                "--require-master",
                "--download-master",
            ]
        )
        self.assertEqual(args.command, "sheet-import")
        self.assertTrue(args.require_master)
        self.assertTrue(args.download_master)
        self.assertEqual(args.job_id, "job1")

    @mock.patch("rippopotamus.desktop_engine.run_sheet_import_pipeline")
    def test_sheet_import_command_invokes_pipeline(self, mock_run: mock.MagicMock) -> None:
        from rippopotamus.desktop_engine import build_parser, command_sheet_import

        mock_run.return_value = {"ok": True}
        parser = build_parser()
        args = parser.parse_args(
            [
                "sheet-import",
                "--sheet-url",
                "https://docs.google.com/spreadsheets/d/abc/edit",
                "--output-root",
                "/tmp/out",
                "--cookies-browser",
                "",
            ]
        )
        code = command_sheet_import(args)
        self.assertEqual(code, 0)
        self.assertTrue(mock_run.called)
        kwargs = mock_run.call_args.kwargs
        self.assertIn("sheet_url", kwargs)
        self.assertIn("emit", kwargs)


if __name__ == "__main__":
    unittest.main()
