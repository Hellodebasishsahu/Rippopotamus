from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "experiments" / "semantic-script" / "semantic_script.py"
SPEC = importlib.util.spec_from_file_location("semantic_script_experiment", MODULE_PATH)
assert SPEC and SPEC.loader
semantic_script = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = semantic_script
SPEC.loader.exec_module(semantic_script)


class SemanticScriptExperimentTests(unittest.TestCase):
    def test_import_jsonl_and_searches_visual_audio_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "index"
            payload = {
                "asset_path": "/footage/rally.mp4",
                "source": "test",
                "moments": [
                    {
                        "start": 10,
                        "end": 20,
                        "visual": "A minister waves from a car while supporters walk beside it.",
                        "audio": "Crowd chanting near the road.",
                        "visible_text": [],
                        "tags": ["minister", "car", "wave"],
                        "shot_type": "medium",
                        "people_count": "street crowd",
                    },
                    {
                        "start": 30,
                        "end": 40,
                        "visual": "Wide shot of a lit stage at night.",
                        "audio": "The speaker says campaign will continue district by district.",
                        "visible_text": ["WARD 12"],
                        "tags": ["stage", "night", "speech"],
                        "shot_type": "wide",
                        "people_count": "large crowd",
                    },
                ],
            }
            jsonl = Path(tmp) / "moments.jsonl"
            jsonl.write_text(json.dumps(payload) + "\n", encoding="utf-8")

            imported = semantic_script.import_jsonl(root, jsonl)
            results = semantic_script.search(root, "minister waving from car", limit=3)

            self.assertTrue(imported["ok"])
            self.assertEqual(imported["imported"], 2)
            self.assertGreaterEqual(results["candidateCount"], 1)
            self.assertGreaterEqual(results["resultCount"], 1)
            self.assertIn("minister waves", results["results"][0]["visual"])
            self.assertIn("visual", results["results"][0]["matchedFields"])

    def test_embedding_search_finds_related_generated_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "index"
            jsonl = Path(tmp) / "moments.jsonl"
            jsonl.write_text(
                "\n".join([
                    json.dumps({
                        "asset_path": "/footage/a.mp4",
                        "start": 0,
                        "end": 8,
                        "visual": "People record a speech on phones near a stage.",
                        "audio": "",
                        "visible_text": [],
                        "tags": ["speech", "phones", "stage"],
                    }),
                    json.dumps({
                        "asset_path": "/footage/b.mp4",
                        "start": 0,
                        "end": 8,
                        "visual": "Drone shot of traffic crossing a bridge.",
                        "audio": "",
                        "visible_text": [],
                        "tags": ["drone", "traffic", "bridge"],
                    }),
                ])
                + "\n",
                encoding="utf-8",
            )

            semantic_script.import_jsonl(root, jsonl)
            results = semantic_script.search(root, "stage speech phones", limit=1)

            self.assertEqual(results["resultCount"], 1)
            self.assertEqual(results["results"][0]["assetPath"], "/footage/a.mp4")
            self.assertGreater(results["results"][0]["rerankScore"], 0)

    def test_search_does_not_return_weak_embedding_noise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "index"
            jsonl = Path(tmp) / "moments.jsonl"
            jsonl.write_text(
                json.dumps({
                    "asset_path": "/footage/wolves.mp4",
                    "start": 0,
                    "end": 8,
                    "visual": "A wolf lies beside pups near a den.",
                    "audio": "",
                    "visible_text": [],
                    "tags": ["wolf", "pups", "den"],
                })
                + "\n",
                encoding="utf-8",
            )

            semantic_script.import_jsonl(root, jsonl)
            results = semantic_script.search(root, "burger kitchen recipe", limit=3)

            self.assertEqual(results["candidateCount"], 0)
            self.assertEqual(results["resultCount"], 0)

    def test_rerank_drops_weak_embedding_only_hits(self) -> None:
        candidates = [{
            "id": "noise",
            "assetPath": "/footage/city.mp4",
            "start": 0,
            "end": 8,
            "visual": "A neon city skyline at night.",
            "audio": "",
            "visibleText": [],
            "tags": ["city", "night"],
            "shotType": "wide",
            "peopleCount": "none",
            "source": "test",
            "score": 0.4,
            "matchType": "embedding",
        }]

        results = semantic_script.rerank("traffic street park", candidates, limit=3)

        self.assertEqual(results, [])

    def test_tokenize_ignores_stopwords(self) -> None:
        self.assertEqual(semantic_script.tokenize("crowd of people"), ["crowd", "people"])

    def test_media_memory_fields_feed_searchable_text(self) -> None:
        moment = semantic_script.moment_from_payload({
            "asset_path": "/footage/cooking.mp4",
            "start": 3,
            "end": 5,
            "summary": "Woman introduces viral recipe.",
            "visual": "Woman stands in a kitchen.",
            "audio": "",
            "visible_text": ["VIRAL REEL"],
            "actions": ["presenting"],
            "objects": ["ingredients"],
            "people": {"count": "one person", "description": "woman host"},
            "setting": ["kitchen"],
            "shot": {"type": "medium", "camera_motion": "static", "composition": "talking head"},
            "mood": ["energetic"],
            "editor_use": ["social hook"],
            "search_phrases": ["good cooking intro"],
        })

        self.assertIn("Woman introduces viral recipe.", moment.visual)
        self.assertIn("good cooking intro", moment.tags)
        self.assertIn("social hook", moment.tags)
        self.assertEqual(moment.people_count, "one person")
        self.assertEqual(moment.shot_type, "medium")

    def test_no_people_description_does_not_create_people_tag(self) -> None:
        moment = semantic_script.moment_from_payload({
            "asset_path": "/footage/drone.mp4",
            "start": 0,
            "end": 8,
            "summary": "Aerial view of a hospital campus.",
            "visual": "Drone shot over buildings.",
            "people": {"count": "none", "description": "No people are visible in the shot."},
        })

        self.assertEqual(moment.people_count, "none")
        self.assertNotIn("No people are visible in the shot.", moment.tags)

    def test_cli_parser_accepts_commands(self) -> None:
        parser = semantic_script.build_parser()
        init = parser.parse_args(["init", "--index-root", "/tmp/rippo"])
        import_cmd = parser.parse_args(["import-jsonl", "--index-root", "/tmp/rippo", "/tmp/moments.jsonl"])
        search = parser.parse_args(["search", "--index-root", "/tmp/rippo", "--query", "crowd flags", "--limit", "5"])

        self.assertIs(init.func, semantic_script.command_init)
        self.assertIs(import_cmd.func, semantic_script.command_import)
        self.assertIs(search.func, semantic_script.command_search)
        self.assertEqual(search.limit, 5)


if __name__ == "__main__":
    unittest.main()
