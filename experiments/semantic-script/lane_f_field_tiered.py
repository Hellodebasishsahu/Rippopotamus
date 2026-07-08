from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = REPO_ROOT / "experiments" / "semantic-script"
RUN_ID = "2026-05-12-yt-batch"
RUN_DIR = ROOT / "lanes" / "F-field-tiered" / "runs" / RUN_ID
QUERY_SET = ROOT / "shared" / "query-set-v1.json"
B_JSONL = [
    REPO_ROOT / "experiments" / "out" / "yt-memory-samples" / "shorts.memory.jsonl",
    REPO_ROOT / "experiments" / "out" / "yt-memory-samples" / "long.memory.jsonl",
    REPO_ROOT / "experiments" / "out" / "yt-memory-samples" / "mix.memory.jsonl",
]

STOPWORDS = {
    "a",
    "an",
    "and",
    "for",
    "from",
    "in",
    "of",
    "on",
    "the",
    "to",
    "with",
}

GENERIC_LOW_TRUST = {
    "background",
    "broll",
    "b-roll",
    "clip",
    "content",
    "explanation",
    "intro",
    "narration",
    "presentation",
    "presenting",
    "scene",
    "shot",
    "stream",
    "transition",
    "video",
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = clean_text(item)
        if text and text not in out:
            out.append(text)
    return out


def tokenize(text: Any) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-zA-Z0-9]+", str(text or "").lower())
        if len(token) > 1 and token not in STOPWORDS
    }


def asset_id(path: str) -> str:
    name = Path(path).name.lower()
    for known in ("shorts", "long", "mix"):
        if known in name:
            return known
    return Path(path).stem


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def mapping_values(value: Any, keys: list[str]) -> list[str]:
    if not isinstance(value, dict):
        return []
    return [clean_text(value.get(key)) for key in keys if clean_text(value.get(key))]


def describes_no_people(text: Any) -> bool:
    normalized = clean_text(text).lower()
    if not normalized:
        return False
    return (
        normalized in {"none", "unknown", "no people", "no visible people"}
        or "no people" in normalized
        or "no visible people" in normalized
        or "no person" in normalized
        or "people are not visible" in normalized
    )


def people_values(value: Any) -> list[str]:
    if not isinstance(value, dict):
        return []
    values: list[str] = []
    count = clean_text(value.get("count"))
    description = clean_text(value.get("description"))
    if count and not describes_no_people(count):
        values.append(count)
    if description and not describes_no_people(description):
        values.append(description)
    return values


def moment_fields(payload: dict[str, Any], moment: dict[str, Any]) -> dict[str, Any]:
    people = people_values(moment.get("people"))
    shot = mapping_values(moment.get("shot"), ["type", "camera_motion", "composition"])
    high_parts = [
        clean_text(moment.get("summary")),
        clean_text(moment.get("visual")),
        clean_text(moment.get("audio")),
        " ".join(string_list(moment.get("visible_text"))),
        " ".join(string_list(moment.get("objects"))),
        " ".join(string_list(moment.get("actions"))),
    ]
    medium_parts = [
        " ".join(string_list(moment.get("setting"))),
        " ".join(string_list(moment.get("mood"))),
        " ".join(people),
        " ".join(shot),
    ]
    low_parts = [
        " ".join(string_list(moment.get("editor_use"))),
        " ".join(string_list(moment.get("search_phrases"))),
    ]
    return {
        "assetPath": payload["asset_path"],
        "asset": asset_id(payload["asset_path"]),
        "start": float(moment.get("start") or 0.0),
        "end": float(moment.get("end") or moment.get("start") or 0.0),
        "summary": clean_text(moment.get("summary")),
        "visual": clean_text(moment.get("visual")),
        "audio": clean_text(moment.get("audio")),
        "visibleText": string_list(moment.get("visible_text")),
        "highText": " ".join(part for part in high_parts if part),
        "mediumText": " ".join(part for part in medium_parts if part),
        "lowText": " ".join(part for part in low_parts if part),
        "editorUse": string_list(moment.get("editor_use")),
        "searchPhrases": string_list(moment.get("search_phrases")),
    }


def load_rows(paths: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            payload = json.loads(line)
            for moment in payload.get("moments", []):
                if isinstance(moment, dict):
                    rows.append(moment_fields(payload, moment))
    return rows


def useful_low_terms(tokens: set[str]) -> set[str]:
    return {token for token in tokens if token not in GENERIC_LOW_TRUST}


def useful_phrase(phrase: str) -> bool:
    return len(useful_low_terms(tokenize(phrase))) >= 2


def score_row(query: str, row: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    q_tokens = tokenize(query)
    high_hits = q_tokens & tokenize(row["highText"])
    medium_hits = q_tokens & tokenize(row["mediumText"])
    low_hits = useful_low_terms(q_tokens & tokenize(row["lowText"]))
    query_lower = query.lower()
    phrase_hits = [
        phrase for phrase in row["searchPhrases"]
        if phrase
        and useful_phrase(phrase)
        and (phrase.lower() in query_lower or query_lower in phrase.lower())
    ]

    high_score = len(high_hits) * 6.0
    medium_score = len(medium_hits) * 3.0
    low_score = len(low_hits) * 1.0
    phrase_score = len(phrase_hits) * 10.0

    # Low-trust fields cannot create a hit by themselves unless they match a
    # non-generic full phrase. This is the whole experiment.
    if high_score + medium_score == 0 and phrase_score == 0:
        return 0.0, {
            "highHits": sorted(high_hits),
            "mediumHits": sorted(medium_hits),
            "lowHits": sorted(low_hits),
            "phraseHits": phrase_hits,
        }
    score = high_score + medium_score + low_score + phrase_score
    return score, {
        "highHits": sorted(high_hits),
        "mediumHits": sorted(medium_hits),
        "lowHits": sorted(low_hits),
        "phraseHits": phrase_hits,
    }


def search_rows(query: str, rows: list[dict[str, Any]], limit: int = 3) -> dict[str, Any]:
    scored: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
    for row in rows:
        score, evidence = score_row(query, row)
        if score > 0:
            scored.append((score, row, evidence))
    scored.sort(key=lambda item: (item[0], -item[1]["start"]), reverse=True)
    results = []
    for score, row, evidence in scored[:limit]:
        results.append({
            "asset": row["asset"],
            "assetPath": row["assetPath"],
            "start": row["start"],
            "end": row["end"],
            "visual": row["summary"] or row["visual"],
            "audio": row["audio"],
            "score": round(score, 3),
            "evidence": evidence,
        })
    return {
        "candidateCount": len(scored),
        "resultCount": len(results),
        "results": results,
    }


def overlaps(result: dict[str, Any], window: list[Any] | None) -> bool:
    if not window:
        return True
    return float(result["start"]) <= float(window[1]) and float(result["end"]) >= float(window[0])


def score_query(query_case: dict[str, Any], result: dict[str, Any] | None) -> int:
    expected = set(query_case.get("expected_assets") or [])
    if query_case["type"] == "hard-negative":
        return 2 if result is None else 0
    if result is None:
        return 0
    if result["asset"] not in expected:
        return 0
    if query_case["type"] == "literal":
        return 2 if overlaps(result, query_case.get("expected_window_seconds")) else 1
    return 2


def summarize(query_rows: list[dict[str, Any]]) -> dict[str, Any]:
    summary: dict[str, Any] = defaultdict(lambda: {"score": 0, "max": 0, "count": 0})
    for row in query_rows:
        score = int(row["lane"]["score"])
        bucket = summary[row["type"]]
        bucket["score"] += score
        bucket["max"] += 2
        bucket["count"] += 1
        total = summary["total"]
        total["score"] += score
        total["max"] += 2
        total["count"] += 1
    return {key: dict(value) for key, value in summary.items()}


def run_experiment(run_dir: Path = RUN_DIR) -> dict[str, Any]:
    rows = load_rows(B_JSONL)
    query_set = json.loads(QUERY_SET.read_text(encoding="utf-8"))
    query_rows = []
    for query_case in query_set["queries"]:
        result = search_rows(query_case["query"], rows)
        top = result["results"][0] if result["results"] else None
        result["score"] = score_query(query_case, top)
        query_rows.append({
            "id": query_case["id"],
            "query": query_case["query"],
            "type": query_case["type"],
            "expectedAssets": query_case.get("expected_assets", []),
            "expectedWindowSeconds": query_case.get("expected_window_seconds"),
            "lane": result,
        })

    summary = summarize(query_rows)
    decision = decision_for_summary(summary)
    comparison = {
        "id": RUN_ID,
        "lane": "F-field-tiered",
        "querySet": str(QUERY_SET.relative_to(REPO_ROOT)),
        "summary": {"F-field-tiered": summary},
        "queries": query_rows,
    }
    run = {
        "id": RUN_ID,
        "lane": "F-field-tiered",
        "status": "complete",
        "created": "2026-05-12",
        "hypothesis": "Field-tiered search should preserve rich media-memory recall while preventing low-trust fields from creating hits alone.",
        "inputs": {
            "source_jsonl": [str(path.relative_to(REPO_ROOT)) for path in B_JSONL],
            "query_set": str(QUERY_SET.relative_to(REPO_ROOT)),
        },
        "embedding": {
            "provider": "none",
            "model": "deterministic-field-tiered-v1",
            "dimensions": 0,
        },
        "outputs": {
            "comparison": display_path(run_dir / "comparison.json"),
            "run": display_path(run_dir / "run.json"),
            "verdict": display_path(run_dir / "verdict.md"),
        },
        "results": {
            "scores": {
                "literal": summary["literal"]["score"],
                "intent": summary["intent"]["score"],
                "hard_negative": summary["hard-negative"]["score"],
                "total": summary["total"]["score"],
            },
            "summary": f"F scored {summary['total']['score']}/{summary['total']['max']} with deterministic field-tiered search.",
        },
        "verdict": {
            "path": display_path(run_dir / "verdict.md"),
            "decision": decision,
        },
    }

    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "comparison.json").write_text(json.dumps(comparison, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (run_dir / "run.json").write_text(json.dumps(run, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_verdict(run_dir / "verdict.md", summary, query_rows)
    return {"ok": True, "summary": summary, "run": str(run_dir / "run.json")}


def write_verdict(path: Path, summary: dict[str, Any], query_rows: list[dict[str, Any]]) -> None:
    decision = decision_for_summary(summary)
    misses = [row for row in query_rows if row["lane"]["score"] < 2]
    miss_text = "None."
    if misses:
        miss_lines = []
        for row in misses:
            top = row["lane"]["results"][0] if row["lane"]["results"] else None
            expected_window = row.get("expectedWindowSeconds")
            if top:
                actual = f'{top["asset"]} {top["start"]}-{top["end"]}'
            else:
                actual = "no result"
            miss_lines.append(
                f'- `{row["id"]}`: `{row["query"]}` expected `{row["expectedAssets"]}` '
                f'at `{expected_window}`, got `{actual}`.'
            )
        miss_text = "\n".join(miss_lines)
    text = f"""# F Field Tiered Verdict

Run: `{RUN_ID}`

## Verdict

{decision}.

## Score

| Query Type | F Score |
| --- | ---: |
| Literal | {summary["literal"]["score"]} / {summary["literal"]["max"]} |
| Intent | {summary["intent"]["score"]} / {summary["intent"]["max"]} |
| Hard negative | {summary["hard-negative"]["score"]} / {summary["hard-negative"]["max"]} |
| Total | {summary["total"]["score"]} / {summary["total"]["max"]} |

## Read

F keeps B's fields separated by trust:

- high: summary, visual, audio, visible text, objects, actions
- medium: setting, mood, people, shot
- low: editor use, search phrases

Low-trust fields can boost a result, but cannot create a result alone unless a non-generic phrase matches.

## Misses

{miss_text}

## Decision

Use this idea inside the product reranker, not as a standalone search engine.
"""
    path.write_text(text, encoding="utf-8")


def decision_for_summary(summary: dict[str, Any]) -> str:
    if summary["total"]["score"] >= 29:
        return "promote for product rerank testing"
    return "keep as safety/rerank idea"


def command_run(args: argparse.Namespace) -> int:
    print(json.dumps(run_experiment(Path(args.run_dir)), sort_keys=True))
    return 0


def command_self_test(args: argparse.Namespace) -> int:
    office = {
        "asset_path": "/tmp/shorts.mp4",
        "moments": [{
            "start": 0,
            "end": 1,
            "summary": "Woman in kitchen explains a recipe.",
            "visual": "Woman in kitchen.",
            "audio": "",
            "visible_text": [],
            "actions": ["speaking"],
            "objects": ["ingredients"],
            "setting": ["kitchen"],
            "editor_use": ["presentation"],
            "search_phrases": ["kitchen presentation"],
        }],
    }
    row = moment_fields(office, office["moments"][0])
    score, evidence = score_row("office meeting presentation", row)
    assert score == 0, (score, evidence)
    score, evidence = score_row("woman kitchen recipe", row)
    assert score > 0, (score, evidence)
    drone = {
        "asset_path": "/tmp/drone.mp4",
        "moments": [{
            "start": 0,
            "end": 8,
            "summary": "Aerial view of a hospital campus.",
            "visual": "Drone shot over buildings.",
            "audio": "",
            "visible_text": [],
            "actions": [],
            "objects": ["buildings"],
            "setting": ["hospital campus"],
            "people": {"count": "none", "description": "No people are visible in the shot."},
            "editor_use": ["establishing shot"],
            "search_phrases": ["hospital campus"],
        }],
    }
    row = moment_fields(drone, drone["moments"][0])
    score, evidence = score_row("crowd of people", row)
    assert score == 0, (score, evidence)
    print(json.dumps({"ok": True}, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lane_f_field_tiered.py")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--run-dir", default=str(RUN_DIR))
    run.set_defaults(func=command_run)
    self_test = sub.add_parser("self-test")
    self_test.set_defaults(func=command_self_test)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
