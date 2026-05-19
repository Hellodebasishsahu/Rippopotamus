"""Tests for the gemini captioner module (unit tests with mocked API)."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from rippopotamus.gemini_captioner import (
    Moment,
    _parse_timestamp,
    narrate_video,
)


class FakeResponse:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeFile:
    def __init__(self) -> None:
        self.name = "files/abc123"
        self.uri = "https://generativelanguage.googleapis.com/v1beta/files/abc123"
        self.mime_type = "video/mp4"
        self.state = MagicMock()
        self.state.name = "ACTIVE"


class TestParseTimestamp(unittest.TestCase):
    def test_minutes_seconds(self) -> None:
        self.assertAlmostEqual(_parse_timestamp("1:30"), 90.0)

    def test_hours_minutes_seconds(self) -> None:
        self.assertAlmostEqual(_parse_timestamp("1:02:30"), 3750.0)

    def test_zero(self) -> None:
        self.assertAlmostEqual(_parse_timestamp("0:00"), 0.0)


class TestNarrateVideo(unittest.TestCase):
    @patch("rippopotamus.gemini_captioner.gemini_api_key", return_value=("fake-key", "GOOGLE_API_KEY"))
    @patch("rippopotamus.gemini_captioner._get_client")
    def test_parses_moments_from_response(self, mock_get_client: MagicMock, _mock_key: MagicMock) -> None:
        response_data = [
            {
                "start": "0:00",
                "end": "0:30",
                "visual": "A man in a black jacket sitting against a white brick wall.",
                "audio": "Man introduces himself as Mukesh Kumar.",
                "searchTerms": ["man sitting", "black jacket", "brick wall"],
            },
            {
                "start": "0:30",
                "end": "1:30",
                "visual": "The man speaks using hand gestures about hospital benefits.",
                "audio": "Discussion about cancer hospital and emergency services.",
                "searchTerms": ["man speaking", "hand gestures", "hospital"],
            },
        ]

        client = MagicMock()
        client.files.upload.return_value = FakeFile()
        client.models.generate_content.return_value = FakeResponse(json.dumps(response_data))
        mock_get_client.return_value = client

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"fake video data")
            path = Path(f.name)

        try:
            moments = narrate_video(path)
        finally:
            path.unlink(missing_ok=True)

        self.assertEqual(len(moments), 2)
        self.assertAlmostEqual(moments[0].start, 0.0)
        self.assertAlmostEqual(moments[0].end, 30.0)
        self.assertIn("black jacket", moments[0].visual)
        self.assertEqual(moments[0].search_terms, ["man sitting", "black jacket", "brick wall"])
        self.assertAlmostEqual(moments[1].start, 30.0)
        self.assertAlmostEqual(moments[1].end, 90.0)

    @patch("rippopotamus.gemini_captioner.gemini_api_key", return_value=("fake-key", "GOOGLE_API_KEY"))
    @patch("rippopotamus.gemini_captioner._get_client")
    def test_handles_empty_array(self, mock_get_client: MagicMock, _mock_key: MagicMock) -> None:
        client = MagicMock()
        client.files.upload.return_value = FakeFile()
        client.models.generate_content.return_value = FakeResponse("[]")
        mock_get_client.return_value = client

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"fake")
            path = Path(f.name)

        try:
            moments = narrate_video(path)
        finally:
            path.unlink(missing_ok=True)

        self.assertEqual(moments, [])


if __name__ == "__main__":
    unittest.main()
