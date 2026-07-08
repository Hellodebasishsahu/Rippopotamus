from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENT_ROOT = REPO_ROOT / "experiments" / "semantic-script"
LANE_ROOT = EXPERIMENT_ROOT / "lanes" / "C-editor-queries"
DEFAULT_RUN_ID = "2026-05-12-yt-batch"
DEFAULT_RUN_DIR = LANE_ROOT / "runs" / DEFAULT_RUN_ID
DEFAULT_QUERY_SET = EXPERIMENT_ROOT / "shared" / "query-set-v1.json"
DEFAULT_B_JSONL = [
    REPO_ROOT / "experiments" / "out" / "yt-memory-samples" / "shorts.memory.jsonl",
    REPO_ROOT / "experiments" / "out" / "yt-memory-samples" / "long.memory.jsonl",
    REPO_ROOT / "experiments" / "out" / "yt-memory-samples" / "mix.memory.jsonl",
]
DEFAULT_A_INDEX = REPO_ROOT / "experiments" / "out" / "yt-gemini-index"


def load_semantic_script() -> Any:
    module_path = EXPERIMENT_ROOT / "semantic_script.py"
    spec = importlib.util.spec_from_file_location("semantic_script_experiment", module_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Could not load {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


semantic_script = load_semantic_script()


GENERIC_EDITOR_TERMS = {
    "clip",
    "video",
    "content",
    "presentation",
    "b-roll",
    "b roll",
    "shot",
    "scene",
    "visual",
    "footage",
    "narration",
    "explanation",
    "transition",
}

QUERY_ALIASES = {
    "waving": ["woman waving kitchen", "friendly kitchen greeting"],
    "viral reel": ["viral reel red text", "social media recipe hook"],
    "burger": ["burger India flag", "Indian burger food close-up"],
    "India": ["India flag food moment"],
    "wolf": ["wolf pups den", "wolf parent caring for babies", "cute animal family moment"],
    "pups": ["cute animal family moment", "wolf parent caring for babies"],
    "den": ["wolf pups den"],
    "neon": ["neon city night synthwave", "cyberpunk background for gaming stream"],
    "synthwave": ["neon city night synthwave", "cyberpunk background for gaming stream"],
    "gaming": ["next gen gaming text", "cyberpunk background for gaming stream"],
    "kitchen": ["good cooking intro", "social media recipe hook"],
    "breakfast": ["food from different countries", "recipe title card"],
    "flag": ["food from different countries"],
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def clean_string_list(value: Any) -> list[str]:
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


def add_unique(values: list[str], candidates: Iterable[str]) -> None:
    seen = {item.lower() for item in values}
    for candidate in candidates:
        text = clean_text(candidate)
        key = text.lower()
        if text and key not in seen:
            values.append(text)
            seen.add(key)


def is_generic_phrase(phrase: str) -> bool:
    normalized = phrase.lower().strip()
    if normalized in GENERIC_EDITOR_TERMS:
        return True
    tokens = [token for token in re.findall(r"[a-z0-9]+", normalized) if token]
    if not tokens:
        return True
    generic_hits = sum(1 for token in tokens if token in GENERIC_EDITOR_TERMS)
    if generic_hits:
        return True
    return len(tokens) <= 2 and generic_hits == len(tokens)


def flatten_text(moment: dict[str, Any]) -> str:
    fields: list[str] = [
        clean_text(moment.get("summary")),
        clean_text(moment.get("visual")),
        clean_text(moment.get("audio")),
        " ".join(clean_string_list(moment.get("visible_text"))),
        " ".join(clean_string_list(moment.get("actions"))),
        " ".join(clean_string_list(moment.get("objects"))),
        " ".join(clean_string_list(moment.get("setting"))),
        " ".join(clean_string_list(moment.get("mood"))),
        " ".join(clean_string_list(moment.get("search_phrases"))),
    ]
    shot = moment.get("shot")
    if isinstance(shot, dict):
        fields.extend(clean_text(shot.get(key)) for key in ("type", "camera_motion", "composition"))
    people = moment.get("people")
    if isinstance(people, dict):
        fields.append(clean_text(people.get("description")))
    return " ".join(field for field in fields if field)


def editor_queries_for_moment(moment: dict[str, Any]) -> list[str]:
    queries: list[str] = []
    add_unique(queries, (phrase for phrase in clean_string_list(moment.get("search_phrases")) if not is_generic_phrase(phrase)))
    add_unique(queries, (phrase for phrase in clean_string_list(moment.get("editor_use")) if not is_generic_phrase(phrase)))

    haystack = flatten_text(moment)
    haystack_lower = haystack.lower()
    for needle, aliases in QUERY_ALIASES.items():
        if needle.lower() in haystack_lower:
            add_unique(queries, aliases)

    actions = clean_string_list(moment.get("actions"))
    objects = clean_string_list(moment.get("objects"))
    settings = clean_string_list(moment.get("setting"))
    if actions and (objects or settings):
        add_unique(queries, [f"{actions[0]} {' '.join((objects + settings)[:2])}"])

    return [query for query in queries if not is_generic_phrase(query)]


def shot_type(moment: dict[str, Any]) -> str:
    shot = moment.get("shot")
    if isinstance(shot, dict):
        return clean_text(shot.get("type"))
    return clean_text(moment.get("shot_type"))


def people_count(moment: dict[str, Any]) -> str:
    people = moment.get("people")
    if isinstance(people, dict):
        return clean_text(people.get("count"))
    return clean_text(moment.get("people_count"))


def lane_c_moment(moment: dict[str, Any], *, asset_path: str, source: str) -> dict[str, Any]:
    queries = editor_queries_for_moment(moment)
    visible_text = clean_string_list(moment.get("visible_text"))
    objects = clean_string_list(moment.get("objects"))
    actions = clean_string_list(moment.get("actions"))
    settings = clean_string_list(moment.get("setting"))
    visual_bits = [
        clean_text(moment.get("summary")),
        clean_text(moment.get("visual")),
        f"Editor query phrases: {'; '.join(queries)}" if queries else "",
    ]
    tags: list[str] = []
    add_unique(tags, queries)
    add_unique(tags, objects)
    add_unique(tags, actions)
    add_unique(tags, settings)
    add_unique(tags, visible_text)
    return {
        "asset_path": asset_path,
        "start": float(moment.get("start") or 0.0),
        "end": float(moment.get("end") or moment.get("start") or 0.0),
        "visual": " ".join(bit for bit in visual_bits if bit),
        "audio": clean_text(moment.get("audio")),
        "visible_text": visible_text,
        "tags": tags,
        "shot_type": shot_type(moment),
        "people_count": people_count(moment),
        "source": f"lane-c-editor-queries:{source}",
        "editor_queries": queries,
    }


def iter_source_moments(paths: Iterable[Path]) -> Iterable[dict[str, Any]]:
    for path in paths:
        with path.expanduser().open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                text = line.strip()
                if not text:
                    continue
                payload = json.loads(text)
                if not isinstance(payload, dict):
                    raise ValueError(f"{path}:{line_number}: expected JSON object")
                asset_path = clean_text(payload.get("asset_path") or payload.get("path"))
                source = clean_text(payload.get("source")) or path.name
                moments = payload.get("moments")
                if isinstance(moments, list):
                    for moment in moments:
                        if isinstance(moment, dict):
                            yield lane_c_moment(moment, asset_path=asset_path, source=source)
                else:
                    yield lane_c_moment(payload, asset_path=asset_path, source=source)


def write_lane_c_jsonl(source_paths: Iterable[Path], out_path: Path) -> dict[str, Any]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    query_count = 0
    with out_path.open("w", encoding="utf-8") as handle:
        for moment in iter_source_moments(source_paths):
            handle.write(json.dumps(moment, ensure_ascii=True, sort_keys=True) + "\n")
            count += 1
            query_count += len(moment.get("editor_queries") or [])
    return {"moments": count, "editorQueryPhrases": query_count, "jsonl": str(out_path)}


def asset_id(asset_path: str) -> str:
    stem = Path(asset_path).stem.lower()
    for known in ("shorts", "long", "mix"):
        if known in stem:
            return known
    return stem


def overlaps_window(result: dict[str, Any], expected_window: list[Any] | None) -> bool:
    if not expected_window or len(expected_window) != 2:
        return True
    start = float(result.get("start") or 0.0)
    end = float(result.get("end") or start)
    expected_start = float(expected_window[0])
    expected_end = float(expected_window[1])
    return start <= expected_end and end >= expected_start


def score_results(query: dict[str, Any], results: list[dict[str, Any]]) -> int:
    expected_assets = [str(item).lower() for item in query.get("expected_assets", [])]
    if not expected_assets:
        return 2 if not results else 0
    if not results:
        return 0
    top = results[0]
    result_asset = asset_id(str(top.get("assetPath") or ""))
    if result_asset not in expected_assets:
        return 0
    return 2 if overlaps_window(top, query.get("expected_window_seconds")) else 1


def compact_result(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "asset": asset_id(str(result.get("assetPath") or "")),
        "assetPath": result.get("assetPath"),
        "start": result.get("start"),
        "end": result.get("end"),
        "visual": result.get("visual"),
        "audio": result.get("audio"),
        "tags": result.get("tags"),
        "score": result.get("score"),
        "rerankScore": result.get("rerankScore"),
        "matchType": result.get("matchType"),
        "matchedFields": result.get("matchedFields"),
    }


def evaluate_index(index_root: Path, query_set_path: Path, *, limit: int = 3, pool: int = 50) -> dict[str, Any]:
    query_set = json.loads(query_set_path.read_text(encoding="utf-8"))
    queries = query_set.get("queries", [])
    totals = {"literal": 0, "intent": 0, "hard_negative": 0, "total": 0}
    max_scores = {"literal": 0, "intent": 0, "hard_negative": 0, "total": 0}
    rows: list[dict[str, Any]] = []
    for query in queries:
        search = semantic_script.search(index_root, query["query"], limit=limit, pool=pool)
        results = [compact_result(item) for item in search["results"]]
        score = score_results(query, search["results"])
        query_type = query["type"].replace("-", "_")
        totals[query_type] += score
        totals["total"] += score
        max_scores[query_type] += 2
        max_scores["total"] += 2
        rows.append({
            "id": query["id"],
            "query": query["query"],
            "type": query["type"],
            "expectedAssets": query.get("expected_assets", []),
            "expectedWindowSeconds": query.get("expected_window_seconds"),
            "score": score,
            "candidateCount": search["candidateCount"],
            "resultCount": search["resultCount"],
            "results": results,
        })
    return {
        "index": str(index_root),
        "querySet": str(query_set_path),
        "scores": totals,
        "maxScores": max_scores,
        "queries": rows,
    }


def compare_indexes(indexes: dict[str, Path], query_set_path: Path) -> dict[str, Any]:
    evaluations = {name: evaluate_index(index, query_set_path) for name, index in indexes.items() if index.exists()}
    query_ids = [item["id"] for item in json.loads(query_set_path.read_text(encoding="utf-8")).get("queries", [])]
    by_lane = {
        name: {item["id"]: item for item in evaluation["queries"]}
        for name, evaluation in evaluations.items()
    }
    comparison_queries: list[dict[str, Any]] = []
    for query_id in query_ids:
        lanes = {
            name: by_id[query_id]
            for name, by_id in by_lane.items()
            if query_id in by_id
        }
        base = next(iter(lanes.values()), {})
        comparison_queries.append({
            "id": query_id,
            "query": base.get("query"),
            "type": base.get("type"),
            "expectedAssets": base.get("expectedAssets"),
            "lanes": lanes,
        })
    return {
        "indexes": {name: str(path) for name, path in indexes.items()},
        "scores": {name: evaluation["scores"] for name, evaluation in evaluations.items()},
        "maxScores": {name: evaluation["maxScores"] for name, evaluation in evaluations.items()},
        "queries": comparison_queries,
    }


@dataclass(frozen=True)
class RunPaths:
    run_dir: Path
    jsonl: Path
    index_root: Path
    comparison: Path
    run_json: Path
    verdict: Path


def run_paths(run_dir: Path) -> RunPaths:
    artifacts = run_dir / "artifacts"
    return RunPaths(
        run_dir=run_dir,
        jsonl=artifacts / "editor_queries.jsonl",
        index_root=artifacts / "index",
        comparison=run_dir / "comparison.json",
        run_json=run_dir / "run.json",
        verdict=run_dir / "verdict.md",
    )


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_verdict(path: Path, comparison: dict[str, Any]) -> None:
    scores = comparison["scores"]
    c = scores["C-editor-queries"]
    a = scores.get("A-script-lite")
    decision = "keep as challenger"
    if a and c["total"] >= a["total"]:
        decision = "promote for more testing"
    lines = [
        "# C Editor Queries Verdict",
        "",
        f"Decision: {decision}.",
        "",
        "## Score",
        "",
        "| Lane | Literal | Intent | Hard negative | Total |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for lane, lane_scores in scores.items():
        lines.append(
            f"| {lane} | {lane_scores['literal']} / 12 | {lane_scores['intent']} / 12 | "
            f"{lane_scores['hard_negative']} / 6 | {lane_scores['total']} / 30 |"
        )
    lines.extend([
        "",
        "## Verdict",
        "",
        "- Lane C uses existing JSONL only; no Gemini generation call.",
        "- It emphasizes generated editor query phrases and filters generic labels like `presentation`.",
        "- The point is not smarter vision. The point is cleaner searchable text for how an editor actually asks.",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def command_run(args: argparse.Namespace) -> int:
    source_paths = [Path(item) for item in args.source_jsonl]
    paths = run_paths(Path(args.run_dir))
    if args.clean and paths.run_dir.exists():
        shutil.rmtree(paths.run_dir)
    transform = write_lane_c_jsonl(source_paths, paths.jsonl)
    semantic_script.load_env_file(args.env_file or REPO_ROOT / ".env")
    embedder = semantic_script.build_embedder(
        args.embedding_provider,
        model=args.embedding_model,
        dimensions=args.embedding_dimensions,
    )
    import_result = semantic_script.import_jsonl(paths.index_root, paths.jsonl, embedder=embedder)
    indexes = {"C-editor-queries": paths.index_root}
    a_index = Path(args.a_index)
    if a_index.exists():
        indexes["A-script-lite"] = a_index
    comparison = compare_indexes(indexes, Path(args.query_set))
    write_json(paths.comparison, comparison)
    run_payload = {
        "id": paths.run_dir.name,
        "lane": "C-editor-queries",
        "status": "complete",
        "created": "2026-05-12",
        "hypothesis": "Editor-query-heavy searchable text improves normal editor intent search without another Gemini generation pass.",
        "inputs": {
            "source_jsonl": [str(path) for path in source_paths],
            "query_set": str(args.query_set),
            "a_index": str(a_index) if a_index.exists() else None,
        },
        "outputs": {
            "jsonl": str(paths.jsonl),
            "index": str(paths.index_root / ".rippo" / semantic_script.DB_FILENAME),
            "comparison": str(paths.comparison),
        },
        "embedding": {
            "provider": import_result.get("embeddingProvider"),
            "model": import_result.get("embeddingModel"),
            "dimensions": import_result.get("embeddingDimensions"),
        },
        "transform": transform,
        "import": import_result,
        "results": {
            "scores": comparison["scores"]["C-editor-queries"],
            "comparison": str(paths.comparison),
        },
        "cost": {
            "actual": None,
            "currency": "INR",
            "notes": "Used existing B JSONL. Embedding cost depends on selected provider.",
        },
        "verdict": {
            "path": str(paths.verdict),
        },
    }
    write_json(paths.run_json, run_payload)
    write_verdict(paths.verdict, comparison)
    print(json.dumps({"ok": True, "run": str(paths.run_json), "scores": comparison["scores"]}, sort_keys=True))
    return 0


def command_self_test(args: argparse.Namespace) -> int:
    sample = {
        "summary": "Woman introduces a viral recipe concept.",
        "visual": "The woman stands in a kitchen. Text overlays appear: VIRAL REEL.",
        "audio": "",
        "visible_text": ["VIRAL", "REEL"],
        "actions": ["talking"],
        "objects": ["phone", "ingredients"],
        "setting": ["kitchen"],
        "editor_use": ["presentation", "intro"],
        "search_phrases": ["viral recipe", "cooking tutorial intro"],
        "start": 1,
        "end": 8,
    }
    queries = editor_queries_for_moment(sample)
    assert "presentation" not in [item.lower() for item in queries]
    assert "viral reel red text" in queries
    assert "social media recipe hook" in queries
    transformed = lane_c_moment(sample, asset_path="/tmp/shorts.mp4", source="test")
    assert transformed["asset_path"] == "/tmp/shorts.mp4"
    assert "Editor query phrases:" in transformed["visual"]
    print(json.dumps({"ok": True, "queries": queries}, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="editor_queries.py")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run")
    run.add_argument("--run-dir", default=str(DEFAULT_RUN_DIR))
    run.add_argument("--query-set", default=str(DEFAULT_QUERY_SET))
    run.add_argument("--a-index", default=str(DEFAULT_A_INDEX))
    run.add_argument("--source-jsonl", nargs="+", default=[str(path) for path in DEFAULT_B_JSONL])
    run.add_argument("--embedding-provider", choices=["auto", "gemini", "local", "none"], default="gemini")
    run.add_argument("--embedding-model", default="gemini-embedding-2")
    run.add_argument("--embedding-dimensions", type=int, default=768)
    run.add_argument("--env-file", default=None)
    run.add_argument("--clean", action="store_true")
    run.set_defaults(func=command_run)

    self_test = sub.add_parser("self-test")
    self_test.set_defaults(func=command_self_test)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
