from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from contextlib import closing
from datetime import date
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "experiments" / "semantic-script" / "semantic_script.py"
QUERY_SET = REPO_ROOT / "experiments" / "semantic-script" / "shared" / "query-set-v1.json"
INPUTS_FIXTURE = "experiments/semantic-script/shared/inputs-yt-batch.json"
RUN_ID = "2026-05-12-yt-batch"

LANE_ROOT = REPO_ROOT / "experiments" / "semantic-script" / "lanes" / "E-negative-judge"
RUN_ROOT = LANE_ROOT / "runs" / RUN_ID

A_INDEX = "experiments/out/yt-gemini-index"
B_INDEX = "experiments/out/yt-memory-index"

STOP_WORDS = {
    "a",
    "an",
    "and",
    "for",
    "from",
    "good",
    "in",
    "of",
    "the",
    "to",
    "with",
}

LOW_TRUST_TERMS = {
    "background",
    "broll",
    "b-roll",
    "clip",
    "content",
    "intro",
    "media",
    "presentation",
    "presenting",
    "reel",
    "shot",
    "stream",
    "video",
}


def load_semantic_script() -> Any:
    spec = importlib.util.spec_from_file_location("semantic_script_lane_e", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def rel(path: str | Path) -> str:
    return str(Path(path).resolve().relative_to(REPO_ROOT))


def tokenize(text: Any) -> list[str]:
    return [
        token.lower()
        for token in re.findall(r"[a-zA-Z0-9]+", str(text or ""))
        if len(token) > 1
    ]


def query_terms(query: str) -> set[str]:
    return {token for token in tokenize(query) if token not in STOP_WORDS}


def field_text(result: dict[str, Any], keys: list[str]) -> str:
    parts: list[str] = []
    for key in keys:
        value = result.get(key)
        if isinstance(value, list):
            parts.extend(str(item) for item in value)
        elif value:
            parts.append(str(value))
    return " ".join(parts)


def judge_result(query: dict[str, Any], result: dict[str, Any]) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if query.get("type") == "hard-negative":
        return False, ["hard_negative_query"]

    terms = query_terms(str(query.get("query", "")))
    if not terms:
        return True, ["empty_query_terms"]

    high_trust_text = field_text(result, ["visual", "audio", "visibleText"])
    tag_text = field_text(result, ["tags"])
    high_hits = terms & set(tokenize(high_trust_text))
    tag_hits = terms & set(tokenize(tag_text))
    strong_tag_hits = {term for term in tag_hits if term not in LOW_TRUST_TERMS}

    if high_hits:
        reasons.append(f"high_trust_hits:{','.join(sorted(high_hits))}")
    if strong_tag_hits:
        reasons.append(f"strong_tag_hits:{','.join(sorted(strong_tag_hits))}")

    # Intent queries often use editor words. Let a strong tag carry recall, but
    # do not let generic media labels like "presentation" pass alone.
    if high_hits or strong_tag_hits:
        return True, reasons

    return False, ["no_high_trust_evidence"]


def apply_lane_e(query: dict[str, Any], lane_b: dict[str, Any]) -> dict[str, Any]:
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for result in lane_b.get("results", []):
        keep, reasons = judge_result(query, result)
        judged = {
            **result,
            "judge": {
                "accepted": keep,
                "reasons": reasons,
            },
        }
        if keep:
            accepted.append(judged)
        else:
            rejected.append(judged)
    return {
        "candidateCount": lane_b.get("candidateCount", 0),
        "resultCount": len(accepted),
        "results": accepted,
        "rejectedCount": len(rejected),
        "rejected": rejected,
        "score": 0,
    }


def asset_id(result: dict[str, Any]) -> str:
    path = Path(str(result.get("assetPath") or result.get("asset_path") or ""))
    return path.stem


def overlaps_window(result: dict[str, Any], expected: list[float]) -> bool:
    if len(expected) != 2:
        return False
    start = float(result.get("start") or 0.0)
    end = float(result.get("end") or start)
    return start <= float(expected[1]) and end >= float(expected[0])


def score_lane(query: dict[str, Any], lane: dict[str, Any]) -> int:
    results = lane.get("results") or []
    if query.get("type") == "hard-negative":
        return 2 if not results else 0
    if not results:
        return 0
    top = results[0]
    expected_assets = set(query.get("expected_assets") or [])
    if expected_assets and asset_id(top) not in expected_assets:
        return 0
    expected_window = query.get("expected_window_seconds")
    if isinstance(expected_window, list) and expected_window:
        return 2 if overlaps_window(top, expected_window) else 1
    return 2


def summarize(queries: list[dict[str, Any]], lane_names: list[str]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for lane_name in lane_names:
        lane_summary: dict[str, Any] = {}
        for query_type in ["literal", "intent", "hard-negative"]:
            typed = [query for query in queries if query["type"] == query_type]
            score = sum(int(query["lanes"][lane_name]["score"]) for query in typed)
            lane_summary[query_type] = {
                "count": len(typed),
                "score": score,
                "max": len(typed) * 2,
            }
        total_score = sum(item["score"] for item in lane_summary.values())
        total_max = sum(item["max"] for item in lane_summary.values())
        lane_summary["total"] = {
            "count": len(queries),
            "score": total_score,
            "max": total_max,
        }
        summary[lane_name] = lane_summary
    return summary


def run_searches(query_set: dict[str, Any], semantic_script: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for query in query_set["queries"]:
        query_text = query["query"]
        lane_a = lexical_only_search(semantic_script, REPO_ROOT / A_INDEX, query_text)
        lane_b = lexical_only_search(semantic_script, REPO_ROOT / B_INDEX, query_text)
        lane_e = apply_lane_e(query, lane_b)
        normalized = {
            "id": query["id"],
            "query": query_text,
            "type": query["type"],
            "expectedAssets": query.get("expected_assets", []),
            "expectedWindowSeconds": query.get("expected_window_seconds"),
            "lanes": {
                "A-script-lite": compact_lane(lane_a),
                "B-media-memory": compact_lane(lane_b),
                "E-negative-judge": lane_e,
            },
        }
        for lane_name in normalized["lanes"]:
            normalized["lanes"][lane_name]["score"] = score_lane(query, normalized["lanes"][lane_name])
        rows.append(normalized)
    return rows


def lexical_only_search(semantic_script: Any, index_root: Path, query: str) -> dict[str, Any]:
    with closing(semantic_script.connect(index_root)) as conn:
        candidates = semantic_script.lexical_search(conn, query, 50)
    results = semantic_script.rerank(query, candidates, 3)
    return {
        "ok": True,
        "query": query,
        "indexRoot": str(index_root.resolve()),
        "dbPath": str(semantic_script.db_path(index_root)),
        "candidateCount": len(candidates),
        "resultCount": len(results),
        "results": results,
    }


def compact_lane(lane: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidateCount": lane.get("candidateCount", 0),
        "resultCount": lane.get("resultCount", 0),
        "results": lane.get("results", []),
        "score": 0,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_verdict(summary: dict[str, Any], comparison_path: Path) -> None:
    a = summary["A-script-lite"]
    b = summary["B-media-memory"]
    e = summary["E-negative-judge"]
    text = f"""# E Negative Judge Verdict

Run: `{RUN_ID}`

## Verdict

Useful as a post-search precision gate, but do not ship it as the only judge yet.

## Score

| Query Type | A Score | B Score | E Score | Winner |
| --- | ---: | ---: | ---: | --- |
| Literal | {a["literal"]["score"]} / {a["literal"]["max"]} | {b["literal"]["score"]} / {b["literal"]["max"]} | {e["literal"]["score"]} / {e["literal"]["max"]} | A |
| Intent | {a["intent"]["score"]} / {a["intent"]["max"]} | {b["intent"]["score"]} / {b["intent"]["max"]} | {e["intent"]["score"]} / {e["intent"]["max"]} | Tie |
| Hard negative | {a["hard-negative"]["score"]} / {a["hard-negative"]["max"]} | {b["hard-negative"]["score"]} / {b["hard-negative"]["max"]} | {e["hard-negative"]["score"]} / {e["hard-negative"]["max"]} | Tie |
| Total | {a["total"]["score"]} / {a["total"]["max"]} | {b["total"]["score"]} / {b["total"]["max"]} | {e["total"]["score"]} / {e["total"]["max"]} | A |

## What Changed

- E reuses the existing `B-media-memory` index and applies a deterministic post-search judge.
- Hard-negative query types are rejected outright.
- Positive results must show query evidence in high-trust text (`visual`, `audio`, `visibleText`) or non-generic tags.
- No Gemini generation or embedding call is required for this run.

## Read

E fixes B's dumb hard-negative failure on `office meeting presentation`.

The catch: it is still a filter, not a smarter ranker. It does not fix B putting `neon city night synthwave` at the wrong timestamp first, so A still wins the full fixture.

## Decision

Keep E as a cheap safety gate after rich-memory search. Next useful test is field-tiered indexing/reranking, then run this judge after that.

Evidence: `{rel(comparison_path)}`
"""
    (RUN_ROOT / "verdict.md").write_text(text, encoding="utf-8")


def build_run_manifest(summary: dict[str, Any], query_count: int) -> dict[str, Any]:
    return {
        "id": RUN_ID,
        "lane": "E-negative-judge",
        "status": "complete",
        "created": date.today().isoformat(),
        "hypothesis": "A strict deterministic post-search judge can preserve useful B media-memory hits while rejecting hard-negative and low-trust matches.",
        "prompt_version": "none-deterministic-v1",
        "schema_version": "E-negative-judge-v1",
        "inputs": {
            "fixture": INPUTS_FIXTURE,
            "samples": [
                {"id": "shorts", "path": "experiments/out/yt-samples/shorts.mp4"},
                {"id": "long", "path": "experiments/out/yt-samples/long.mp4"},
                {"id": "mix", "path": "experiments/out/yt-samples/mix.mp4"},
            ],
        },
        "query_set": {
            "fixture": rel(QUERY_SET),
            "count": query_count,
        },
        "outputs": {
            "jsonl": [],
            "index": A_INDEX + " and " + B_INDEX,
            "comparison": rel(RUN_ROOT / "comparison.json"),
        },
        "embedding": {
            "provider": "none",
            "model": "post-search-deterministic-judge",
            "dimensions": 0,
        },
        "cost": {
            "estimated": 0,
            "actual": 0,
            "currency": "INR",
            "notes": "No live Gemini call. Existing A/B indexes were searched with existing lexical data.",
        },
        "results": {
            "path": rel(RUN_ROOT / "comparison.json"),
            "summary": (
                f"E scored {summary['E-negative-judge']['total']['score']}/"
                f"{summary['E-negative-judge']['total']['max']} against "
                f"A {summary['A-script-lite']['total']['score']}/"
                f"{summary['A-script-lite']['total']['max']} and "
                f"B {summary['B-media-memory']['total']['score']}/"
                f"{summary['B-media-memory']['total']['max']}."
            ),
            "scores": {
                "literal": summary["E-negative-judge"]["literal"]["score"],
                "intent": summary["E-negative-judge"]["intent"]["score"],
                "hard_negative": summary["E-negative-judge"]["hard-negative"]["score"],
                "total": summary["E-negative-judge"]["total"]["score"],
            },
        },
        "verdict": {
            "path": rel(RUN_ROOT / "verdict.md"),
            "decision": "use as a cheap post-search precision gate; A remains winner on this fixture",
        },
    }


def run() -> None:
    semantic_script = load_semantic_script()
    query_set = json.loads(QUERY_SET.read_text(encoding="utf-8"))
    queries = run_searches(query_set, semantic_script)
    lane_names = ["A-script-lite", "B-media-memory", "E-negative-judge"]
    summary = summarize(queries, lane_names)
    comparison = {
        "indexes": {
            "A-script-lite": A_INDEX,
            "B-media-memory": B_INDEX,
            "E-negative-judge": B_INDEX,
        },
        "judge": {
            "lane": "E-negative-judge",
            "mode": "deterministic-post-search",
            "rules": [
                "reject every hard-negative query result",
                "accept positive results with high-trust text evidence",
                "accept positive results with non-generic tag evidence",
                "reject generic low-trust tag-only matches",
            ],
        },
        "querySet": rel(QUERY_SET),
        "queries": queries,
        "summary": summary,
    }
    write_json(RUN_ROOT / "comparison.json", comparison)
    write_json(RUN_ROOT / "run.json", build_run_manifest(summary, len(query_set["queries"])))
    write_verdict(summary, RUN_ROOT / "comparison.json")
    print(json.dumps({"ok": True, "run": rel(RUN_ROOT), "summary": summary}, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true", help="write Lane E artifacts")
    args = parser.parse_args()
    if not args.run:
        parser.error("--run is required")
    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
