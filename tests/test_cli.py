from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rippopotamus.cli import main, slugify
from rippopotamus.providers import PRESETS, first_json_metadata, friendly_error, metadata_from_media_raw, provider_catalog


class CliTests(unittest.TestCase):
    def test_slugify(self) -> None:
        self.assertEqual(slugify("Client Project!!"), "client-project")
        self.assertEqual(slugify(""), "untitled")

    def test_presets_are_provider_explicit(self) -> None:
        self.assertEqual(sorted(PRESETS), ["audio-mp3", "drive-file", "gallery", "mp4-best", "proxy", "thumbnail", "torrent"])
        self.assertEqual(PRESETS["mp4-best"]["provider"], "yt-dlp")
        self.assertEqual(PRESETS["drive-file"]["provider"], "google-drive")
        self.assertEqual(PRESETS["gallery"]["provider"], "gallery-dl")
        self.assertEqual(PRESETS["torrent"]["provider"], "torrent")

    def test_provider_catalog_is_ui_ready(self) -> None:
        catalog = provider_catalog()
        self.assertIn({"id": "yt-dlp", "label": "Video", "defaultPreset": "mp4-best", "supportsBrowserAccess": True}, catalog["providers"])
        self.assertIn({"id": "google-drive", "label": "Drive", "defaultPreset": "drive-file", "supportsBrowserAccess": True}, catalog["providers"])
        self.assertIn({"id": "gallery-dl", "label": "Images", "defaultPreset": "gallery", "supportsBrowserAccess": False}, catalog["providers"])
        self.assertIn({"id": "torrent", "label": "Torrent", "defaultPreset": "torrent", "supportsBrowserAccess": False}, catalog["providers"])
        self.assertIn({"id": "drive-file", "label": "Drive", "detail": "Google Drive file", "provider": "google-drive"}, catalog["presets"])
        self.assertIn({"id": "gallery", "label": "Images", "detail": "Image gallery", "provider": "gallery-dl"}, catalog["presets"])
        self.assertIn({"id": "torrent", "label": "Torrent", "detail": "Magnet or torrent file", "provider": "torrent"}, catalog["presets"])

    def test_metadata_uses_best_thumbnail_candidate(self) -> None:
        metadata = metadata_from_media_raw({
            "thumbnail": "https://img.example/small.jpg",
            "thumbnails": [
                {"url": "https://img.example/medium.jpg", "width": 640, "height": 360},
                {"url": "https://img.example/large.jpg", "width": 1280, "height": 720},
            ],
        }, "https://example.com/video", "yt-dlp")

        self.assertEqual(metadata["thumbnail"], "https://img.example/small.jpg")
        self.assertEqual(metadata["provider"], "yt-dlp")
        self.assertEqual(
            metadata["thumbnails"],
            [
                "https://img.example/small.jpg",
                "https://img.example/large.jpg",
                "https://img.example/medium.jpg",
            ],
        )

    def test_metadata_estimates_size_from_formats(self) -> None:
        metadata = metadata_from_media_raw({
            "formats": [
                {"format_id": "low", "filesize_approx": 12_000_000},
                {"format_id": "high", "filesize": 45_000_000},
            ],
        }, "https://example.com/video", "yt-dlp")

        self.assertIsNone(metadata["filesize"])
        self.assertEqual(metadata["filesize_approx"], 45_000_000)

    def test_metadata_sums_requested_format_sizes(self) -> None:
        metadata = metadata_from_media_raw({
            "requested_formats": [
                {"format_id": "video", "filesize": 40_000_000},
                {"format_id": "audio", "filesize": 5_000_000},
            ],
        }, "https://example.com/video", "yt-dlp")

        self.assertEqual(metadata["filesize"], 45_000_000)

    def test_metadata_ignores_missing_requested_format_sizes(self) -> None:
        metadata = metadata_from_media_raw({
            "requested_formats": [
                {"format_id": "video", "filesize": None, "filesize_approx": 40_000_000},
                {"format_id": "audio", "filesize": None},
            ],
        }, "https://x.com/example/status/1", "yt-dlp")

        self.assertIsNone(metadata["filesize"])
        self.assertEqual(metadata["filesize_approx"], 40_000_000)

    def test_gallery_metadata_accepts_event_output(self) -> None:
        self.assertEqual(
            first_json_metadata('[[2, {"category": "wikiart"}], [3, "https://img.example/a.jpg", {"filename": "asset"}]]'),
            {"filename": "asset", "url": "https://img.example/a.jpg"},
        )

    def test_friendly_error_maps_unavailable_format(self) -> None:
        self.assertEqual(
            friendly_error("ERROR: [youtube] abc: Requested format is not available. Use --list-formats"),
            "selected format is not available for this link",
        )

    def test_friendly_error_maps_aria_server_error(self) -> None:
        self.assertEqual(
            friendly_error("[HttpSkipResponseCommand.cc:240] errorCode=22 The response status is not successful. status=500"),
            "The source is having trouble right now. Try again later or use another link.",
        )

    def test_init_add_manifest_zip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            self.assertEqual(main(["init", "Client Project", "--path", str(root)]), 0)
            self.assertTrue((root / "Source").exists())
            self.assertTrue((root / "Audio").exists())
            self.assertTrue((root / "Images").exists())
            self.assertTrue((root / "Thumbnails").exists())

            old_cwd = Path.cwd()
            try:
                import os

                os.chdir(root)
                self.assertEqual(main(["add", "https://example.com/a", "https://example.com/a"]), 0)
                self.assertEqual(main(["manifest"]), 0)
                self.assertEqual(main(["zip"]), 0)
            finally:
                os.chdir(old_cwd)

            manifest = json.loads((root / "manifest.json").read_text())
            self.assertEqual(manifest["project"]["name"], "Client Project")
            self.assertEqual(len(manifest["assets"]), 1)
            self.assertTrue((root / "Exports" / "client-project.zip").exists())


if __name__ == "__main__":
    unittest.main()
