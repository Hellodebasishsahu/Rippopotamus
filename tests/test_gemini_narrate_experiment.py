from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "experiments" / "semantic-script" / "gemini_narrate.py"
SPEC = importlib.util.spec_from_file_location("gemini_narrate_experiment", MODULE_PATH)
assert SPEC and SPEC.loader
gemini_narrate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gemini_narrate
SPEC.loader.exec_module(gemini_narrate)


class FakeNarrator:
    model = "fake-gemini"

    def narrate_chunk(self, _chunk: object) -> dict[str, object]:
        return {
            "moments": [
                {
                    "start": 1,
                    "end": 4,
                    "visual": "A minister waves from a car.",
                    "audio": "Crowd chanting.",
                    "visible_text": ["WARD 12"],
                    "tags": ["minister", "car", "crowd"],
                    "shot_type": "medium",
                    "people_count": "street crowd",
                }
            ]
        }


class GeminiNarrateExperimentTests(unittest.TestCase):
    def test_extract_json_object_accepts_fenced_json(self) -> None:
        payload = gemini_narrate.extract_json_object('```json\n{"moments": []}\n```')

        self.assertEqual(payload, {"moments": []})

    def test_normalize_moments_offsets_chunk_timestamps(self) -> None:
        chunk = gemini_narrate.NarrationChunk(
            chunk_path=Path("/tmp/chunk.mp4"),
            source_path=Path("/tmp/source.mp4"),
            start=30.0,
            end=60.0,
        )

        moments = gemini_narrate.normalize_moments({
            "moments": [{
                "start": 2,
                "end": 8,
                "visual": "Crowd near stage.",
                "visible_text": "WARD 12",
                "tags": ["crowd", "stage"],
            }]
        }, chunk)

        self.assertEqual(moments[0]["start"], 32.0)
        self.assertEqual(moments[0]["end"], 38.0)
        self.assertEqual(moments[0]["visible_text"], ["WARD 12"])
        self.assertEqual(moments[0]["shot_type"], "unknown")

    def test_narrate_video_writes_jsonl_with_fake_narrator(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / "source.mp4"
            chunk = Path(tmp) / "chunk.mp4"
            out = Path(tmp) / "out.jsonl"
            video.write_bytes(b"video")
            chunk.write_bytes(b"chunk")
            fake_chunk = gemini_narrate.VideoChunk(chunk_path=chunk, source_path=video.resolve(), start=10.0, end=20.0)

            with mock.patch("gemini_narrate_experiment.chunk_video", return_value=[fake_chunk]):
                result = gemini_narrate.narrate_video(video, out, narrator=FakeNarrator())

            line = json.loads(out.read_text(encoding="utf-8"))
            self.assertTrue(result["ok"])
            self.assertEqual(result["chunks"], 1)
            self.assertEqual(line["source"], "gemini:fake-gemini")
            self.assertEqual(line["moments"][0]["start"], 11.0)
            self.assertEqual(line["moments"][0]["visual"], "A minister waves from a car.")

    def test_parser_accepts_narrate_shape(self) -> None:
        parser = gemini_narrate.build_parser()
        args = parser.parse_args([
            "--video",
            "/tmp/a.mp4",
            "--out",
            "/tmp/a.jsonl",
            "--chunk-duration",
            "60",
            "--limit-chunks",
            "1",
        ])

        self.assertIs(args.func, gemini_narrate.command_narrate)
        self.assertEqual(args.chunk_duration, 60)
        self.assertEqual(args.limit_chunks, 1)


if __name__ == "__main__":
    unittest.main()
