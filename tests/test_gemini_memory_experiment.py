from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "experiments" / "semantic-script" / "gemini_memory.py"
SPEC = importlib.util.spec_from_file_location("gemini_memory_experiment", MODULE_PATH)
assert SPEC and SPEC.loader
gemini_memory = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gemini_memory
SPEC.loader.exec_module(gemini_memory)


class GeminiMemoryExperimentTests(unittest.TestCase):
    def test_normalize_moments_preserves_rich_fields_and_absolute_time(self) -> None:
        chunk = gemini_memory.MemoryChunk(
            chunk_path=Path("/tmp/chunk.mp4"),
            source_path=Path("/tmp/source.mp4"),
            start=20.0,
            end=30.0,
        )
        moments = gemini_memory.normalize_moments({
            "moments": [{
                "start": 1,
                "end": 4,
                "summary": "Wolf parent cares for pups.",
                "visual": "Adult wolf licks a pup near a den.",
                "audio": "",
                "visible_text": [],
                "actions": ["licking"],
                "objects": ["den"],
                "people": {"count": "none", "description": ""},
                "setting": ["forest"],
                "shot": {"type": "wide", "camera_motion": "static", "composition": "b-roll"},
                "mood": ["tender"],
                "editor_use": ["animal family moment"],
                "search_phrases": ["wolf parent caring for babies"],
                "confidence": 1.5,
            }]
        }, chunk)

        self.assertEqual(moments[0]["start"], 21.0)
        self.assertEqual(moments[0]["end"], 24.0)
        self.assertEqual(moments[0]["summary"], "Wolf parent cares for pups.")
        self.assertEqual(moments[0]["actions"], ["licking"])
        self.assertEqual(moments[0]["shot"]["composition"], "b-roll")
        self.assertEqual(moments[0]["confidence"], 1.0)

    def test_parser_accepts_required_args(self) -> None:
        parser = gemini_memory.build_parser()
        args = parser.parse_args(["--video", "/tmp/a.mp4", "--out", "/tmp/a.jsonl", "--chunk-duration", "8"])

        self.assertEqual(args.video, "/tmp/a.mp4")
        self.assertEqual(args.out, "/tmp/a.jsonl")
        self.assertEqual(args.chunk_duration, 8)
        self.assertIs(args.func, gemini_memory.command_narrate)


if __name__ == "__main__":
    unittest.main()
