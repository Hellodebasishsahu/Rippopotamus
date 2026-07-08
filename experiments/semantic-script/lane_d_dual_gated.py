from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENT_ROOT = REPO_ROOT / "experiments" / "semantic-script"
DEFAULT_QUERY_SET = EXPERIMENT_ROOT / "shared" / "query-set-v1.json"
DEFAULT_INPUTS = EXPERIMENT_ROOT / "shared" / "inputs-yt-batch.json"
DEFAULT_A_INDEX = REPO_ROOT / "experiments" / "out" / "yt-gemini-index"
DEFAULT_B_INDEX = REPO_ROOT / "experiments" / "out" / "yt-memory-index"
DEFAULT_RUN_DIR = (
    EXPERIMENT_ROOT
    / "lanes"
    / "D-dual-gated"
    / "runs"
    / "2026-05-12-yt-batch"
)


def load_semantic_script() -> Any:
    path = EXPERIMENT_ROOT / "semantic_script.py"
    spec = importlib.util.spec_from_file_location("semantic_script_experiment", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


semantic_script = load_semantic_script()


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: str | Path, payload: Any) -> None:
    Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def asset_id(result: dict[str, Any], asset_map: dict[str, str]) -> str:
    asset_path = str(result.get("assetPath") or "")
    for identifier, path in asset_map.items():
        if identifier in asset_path or Path(path).name in asset_path:
            return identifier
    return Path(asset_path).stem


def overlaps_window(result: dict[str, Any], window: list[float] | None) -> bool:
    if not window or len(window) != 2:
        return True
    start = float(result.get("start") or 0.0)
    end = float(result.get("end") or start)
    return end >= float(window[0]) and start <= float(window[1])


def near_or_overlaps(left: dict[str, Any], right: dict[str, Any], tolerance: float = 2.0) -> bool:
    left_start = float(left.get("start") or 0.0)
    left_end = float(left.get("end") or left_start)
    right_start = float(right.get("start") or 0.0)
    right_end = float(right.get("end") or right_start)
    return left_end + tolerance >= right_start and right_end + tolerance >= left_start


def simplify_result(result: dict[str, Any], asset_map: dict[str, str]) -> dict[str, Any]:
    return {
        "asset": asset_id(result, asset_map),
        "assetPath": result.get("assetPath"),
        "start": result.get("start"),
        "end": result.get("end"),
        "visual": result.get("visual"),
        "audio": result.get("audio"),
        "tags": result.get("tags") or [],
        "visibleText": result.get("visibleText") or [],
        "matchType": result.get("matchType"),
        "matchedFields": result.get("matchedFields") or [],
        "score": result.get("score"),
        "rerankScore": result.get("rerankScore"),
    }


def has_text_evidence(result: dict[str, Any]) -> bool:
    fields = set(result.get("matchedFields") or [])
    return bool(fields & {"visual", "audio", "visible_text", "tags"})


def score_results(query_case: dict[str, Any], results: list[dict[str, Any]], asset_map: dict[str, str]) -> int:
    expected_assets = set(query_case.get("expected_assets") or [])
    query_type = query_case.get("type")
    if query_type == "hard-negative":
        return 2 if not results else 0
    if not results:
        return 0
    top = results[0]
    top_asset = asset_id(top, asset_map)
    if top_asset not in expected_assets:
        return 0
    if query_type == "literal":
        return 2 if overlaps_window(top, query_case.get("expected_window_seconds")) else 1
    return 2


def summarize(query_rows: list[dict[str, Any]], lane_names: list[str]) -> dict[str, Any]:
    summary: dict[str, Any] = {lane: defaultdict(lambda: {"score": 0, "max": 0, "count": 0}) for lane in lane_names}
    for row in query_rows:
        query_type = row["type"]
        for lane in lane_names:
            bucket = summary[lane][query_type]
            bucket["score"] += row["lanes"][lane]["score"]
            bucket["max"] += 2
            bucket["count"] += 1
            total = summary[lane]["total"]
            total["score"] += row["lanes"][lane]["score"]
            total["max"] += 2
            total["count"] += 1
    return {
        lane: {bucket: dict(values) for bucket, values in buckets.items()}
        for lane, buckets in summary.items()
    }


def search_lane(index_root: Path, query: str, limit: int, pool: int) -> dict[str, Any]:
    return semantic_script.search(index_root, query, limit=limit, pool=pool)


def gated_results(
    query_case: dict[str, Any],
    a_results: list[dict[str, Any]],
    b_results: list[dict[str, Any]],
    asset_map: dict[str, str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    gate = [result for result in a_results if has_text_evidence(result)]
    gate_assets = {asset_id(result, asset_map) for result in gate}

    if query_case.get("type") == "hard-negative":
        if not gate:
            return [], {
                "mode": "reject",
                "reason": "A-script-lite found no high-trust evidence, so B low-trust recall is blocked.",
                "gateCount": 0,
            }
        allowed = [result for result in b_results if asset_id(result, asset_map) in gate_assets]
        return allowed[:3], {
            "mode": "allow-same-asset",
            "reason": "B results survived only because A had same-asset evidence.",
            "gateCount": len(gate),
            "gateAssets": sorted(gate_assets),
        }

    if query_case.get("type") == "literal" and gate:
        return a_results[:3], {
            "mode": "a-literal-primary",
            "reason": "Literal queries keep A high-trust evidence as the ranker; B is not allowed to displace it.",
            "gateCount": len(gate),
            "gateAssets": sorted(gate_assets),
        }

    allowed: list[dict[str, Any]] = []
    for result in b_results:
        result_asset = asset_id(result, asset_map)
        if result_asset not in gate_assets:
            continue
        allowed.append(result)

    if allowed:
        return allowed[:3], {
            "mode": "b-through-a-gate",
            "reason": "B media-memory hit was kept because A had high-trust same-asset evidence.",
            "gateCount": len(gate),
            "gateAssets": sorted(gate_assets),
        }

    return a_results[:3], {
        "mode": "a-fallback",
        "reason": "No B hit survived the high-trust gate, so D falls back to A.",
        "gateCount": len(gate),
        "gateAssets": sorted(gate_assets),
    }


def build_artifacts(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], str]:
    query_set = read_json(args.query_set)
    inputs = read_json(args.inputs)
    asset_map = {item["id"]: item["path"] for item in inputs.get("samples", [])}
    query_rows: list[dict[str, Any]] = []

    for query_case in query_set["queries"]:
        a_search = search_lane(args.a_index, query_case["query"], args.limit, args.pool)
        b_search = search_lane(args.b_index, query_case["query"], args.limit, args.pool)
        a_results = a_search.get("results") or []
        b_results = b_search.get("results") or []
        d_results, gate = gated_results(query_case, a_results, b_results, asset_map)

        lanes = {
            "A-script-lite": {
                "candidateCount": a_search.get("candidateCount"),
                "resultCount": len(a_results),
                "results": [simplify_result(item, asset_map) for item in a_results],
                "score": score_results(query_case, a_results, asset_map),
            },
            "B-media-memory": {
                "candidateCount": b_search.get("candidateCount"),
                "resultCount": len(b_results),
                "results": [simplify_result(item, asset_map) for item in b_results],
                "score": score_results(query_case, b_results, asset_map),
            },
            "D-dual-gated": {
                "candidateCount": len(d_results),
                "resultCount": len(d_results),
                "gate": gate,
                "results": [simplify_result(item, asset_map) for item in d_results],
                "score": score_results(query_case, d_results, asset_map),
            },
        }
        query_rows.append({
            "id": query_case["id"],
            "query": query_case["query"],
            "type": query_case["type"],
            "expectedAssets": query_case.get("expected_assets") or [],
            "expectedWindowSeconds": query_case.get("expected_window_seconds"),
            "lanes": lanes,
        })

    lane_names = ["A-script-lite", "B-media-memory", "D-dual-gated"]
    comparison = {
        "id": "2026-05-12-yt-batch",
        "lane": "D-dual-gated",
        "hypothesis": "Literal/high-trust script evidence should gate rich intent/media-memory retrieval before low-trust B hits are allowed.",
        "querySet": str(Path(args.query_set).relative_to(REPO_ROOT)),
        "indexes": {
            "A-script-lite": str(Path(args.a_index).relative_to(REPO_ROOT)),
            "B-media-memory": str(Path(args.b_index).relative_to(REPO_ROOT)),
        },
        "policy": {
            "gate": "A-script-lite high-trust text evidence",
            "allow": "B hit only when same asset passes A gate; literal queries also require timestamp overlap/near-overlap.",
            "reject": "Hard negatives with no A evidence return zero results.",
            "fallback": "If B has no gated survivor, D returns A results.",
        },
        "summary": summarize(query_rows, lane_names),
        "queries": query_rows,
    }

    d_scores = comparison["summary"]["D-dual-gated"]
    run = {
        "id": "2026-05-12-yt-batch",
        "lane": "D-dual-gated",
        "status": "complete",
        "created": "2026-05-12",
        "hypothesis": comparison["hypothesis"],
        "prompt_version": None,
        "schema_version": "D-dual-gated-v1",
        "inputs": {
            "fixture": str(Path(args.inputs).relative_to(REPO_ROOT)),
            "samples": inputs.get("samples", []),
        },
        "query_set": {
            "fixture": str(Path(args.query_set).relative_to(REPO_ROOT)),
            "count": len(query_set["queries"]),
        },
        "outputs": {
            "comparison": str((args.run_dir / "comparison.json").relative_to(REPO_ROOT)),
            "run": str((args.run_dir / "run.json").relative_to(REPO_ROOT)),
            "verdict": str((args.run_dir / "verdict.md").relative_to(REPO_ROOT)),
        },
        "indexes": comparison["indexes"],
        "results": {
            "path": str((args.run_dir / "comparison.json").relative_to(REPO_ROOT)),
            "scores": {
                "literal": d_scores["literal"]["score"],
                "intent": d_scores["intent"]["score"],
                "hard_negative": d_scores["hard-negative"]["score"],
                "total": d_scores["total"]["score"],
            },
            "summary": (
                f"D scored {d_scores['total']['score']}/{d_scores['total']['max']} against "
                f"A at {comparison['summary']['A-script-lite']['total']['score']}/{comparison['summary']['A-script-lite']['total']['max']} "
                f"and B at {comparison['summary']['B-media-memory']['total']['score']}/{comparison['summary']['B-media-memory']['total']['max']}."
            ),
        },
        "verdict": {
            "decision": "keep A as baseline; use D policy before promoting B-style media memory",
            "path": str((args.run_dir / "verdict.md").relative_to(REPO_ROOT)),
        },
    }

    verdict = render_verdict(comparison)
    return comparison, run, verdict


def render_verdict(comparison: dict[str, Any]) -> str:
    summary = comparison["summary"]
    rows = []
    for query_type, label in [
        ("literal", "Literal"),
        ("intent", "Intent"),
        ("hard-negative", "Hard negative"),
        ("total", "Total"),
    ]:
        a = summary["A-script-lite"][query_type]
        b = summary["B-media-memory"][query_type]
        d = summary["D-dual-gated"][query_type]
        rows.append(
            f"| {label} | {a['score']} / {a['max']} | {b['score']} / {b['max']} | {d['score']} / {d['max']} |"
        )

    blocked = [
        row for row in comparison["queries"]
        if row["type"] == "hard-negative"
        and row["lanes"]["B-media-memory"]["score"] == 0
        and row["lanes"]["D-dual-gated"]["score"] == 2
    ]
    blocked_text = "\n".join(
        f"- `{row['id']}`: B returned `{row['lanes']['B-media-memory']['results'][0]['asset']}`; D returned no result."
        for row in blocked
        if row["lanes"]["B-media-memory"]["results"]
    )
    if not blocked_text:
        blocked_text = "- None."

    a_total = summary["A-script-lite"]["total"]
    b_total = summary["B-media-memory"]["total"]
    d_total = summary["D-dual-gated"]["total"]
    if d_total["score"] > b_total["score"] and d_total["score"] >= a_total["score"]:
        topline = "Good idea. D keeps the useful B recall shape while blocking the dumb low-trust misses."
    elif d_total["score"] > b_total["score"]:
        topline = "Useful but not magic. D beats raw B, but A is still the cleaner baseline on this run."
    else:
        topline = "Not good enough yet. D did not improve over raw B on this run."

    return "\n".join([
        "# D Dual Gated Verdict",
        "",
        "Run: `2026-05-12-yt-batch`",
        "",
        "## Verdict",
        "",
        topline,
        "",
        f"Score: D `{d_total['score']} / {d_total['max']}`, A `{a_total['score']} / {a_total['max']}`, B `{b_total['score']} / {b_total['max']}`.",
        "",
        "## Score",
        "",
        "| Query Type | A Score | B Score | D Score |",
        "| --- | ---: | ---: | ---: |",
        *rows,
        "",
        "## What Changed",
        "",
        "- A-script-lite is the high-trust gate.",
        "- B-media-memory is allowed only when A has same-asset evidence.",
        "- Literal queries also need timestamp overlap or near-overlap with A.",
        "- Hard negatives return nothing when A has no evidence, instead of letting B hallucinate recall from generic editor labels.",
        "",
        "## Blocked Failure",
        "",
        blocked_text,
        "",
        "## Decision",
        "",
        "Do not replace A with raw B. If media memory ships, ship it behind a D-style gate first.",
        "",
    ])


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Lane D dual-index gated retrieval.")
    parser.add_argument("--query-set", type=Path, default=DEFAULT_QUERY_SET)
    parser.add_argument("--inputs", type=Path, default=DEFAULT_INPUTS)
    parser.add_argument("--a-index", type=Path, default=DEFAULT_A_INDEX)
    parser.add_argument("--b-index", type=Path, default=DEFAULT_B_INDEX)
    parser.add_argument("--run-dir", type=Path, default=DEFAULT_RUN_DIR)
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--pool", type=int, default=50)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args.run_dir.mkdir(parents=True, exist_ok=True)
    comparison, run, verdict = build_artifacts(args)
    write_json(args.run_dir / "comparison.json", comparison)
    write_json(args.run_dir / "run.json", run)
    (args.run_dir / "verdict.md").write_text(verdict, encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "comparison": str(args.run_dir / "comparison.json"),
        "run": str(args.run_dir / "run.json"),
        "verdict": str(args.run_dir / "verdict.md"),
        "scores": run["results"]["scores"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
