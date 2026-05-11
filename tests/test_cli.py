from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rippopotamus.cli import PRESETS, first_json_metadata, friendly_error, main, metadata_from_media_raw, slugify


class CliTests(unittest.TestCase):
    def test_slugify(self) -> None:
        self.assertEqual(slugify("Client Project!!"), "client-project")
        self.assertEqual(slugify(""), "untitled")

    def test_presets_are_provider_explicit(self) -> None:
        self.assertEqual(sorted(PRESETS), ["audio-mp3", "gallery", "mp4-best", "proxy", "thumbnail"])
        self.assertEqual(PRESETS["mp4-best"]["provider"], "yt-dlp")
        self.assertEqual(PRESETS["gallery"]["provider"], "gallery-dl")

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
