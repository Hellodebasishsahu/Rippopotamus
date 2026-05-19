"""Eval harness: run editor-style queries against the index and score retrieval quality."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rippopotamus.footage_index import search_index


def load_queries(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("queries file must be a JSON array")
    return data


def overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    start = max(a_start, b_start)
    end = min(a_end, b_end)
    return max(0.0, end - start)


def score_result(result: dict[str, Any], expected: list[dict[str, Any]]) -> bool:
    if not expected:
        return True
    r_start = float(result.get("start") or 0)
    r_end = float(result.get("end") or r_start)
    r_path = result.get("path", "")
    for exp in expected:
        exp_path = exp.get("path", "")
        if exp_path and exp_path not in r_path:
            continue
        exp_start = float(exp.get("start", 0))
        exp_end = float(exp.get("end", exp_start))
        if exp_end <= exp_start:
            if exp_path and exp_path in r_path:
                return True
            continue
        span = exp_end - exp_start
        if span > 0 and overlap(r_start, r_end, exp_start, exp_end) / span >= 0.3:
            return True
    return False


def run_eval(
    index_root: str | Path,
    queries: list[dict[str, Any]],
    limit: int = 5,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    hits = 0
    reciprocal_ranks: list[float] = []

    for entry in queries:
        query = entry.get("query", "")
        expected = entry.get("expected", [])
        allow_zero = entry.get("allowZero", False)

        search = search_index(index_root, query, limit=limit, use_vector=False)
        search_results = search.get("results", [])

        found = False
        rank = 0
        matched_results: list[dict[str, Any]] = []
        for idx, sr in enumerate(search_results):
            is_match = score_result(sr, expected)
            matched_results.append({**sr, "_match": is_match})
            if is_match and not found:
                found = True
                rank = idx + 1

        is_scorable = bool(expected) and not allow_zero
        if found:
            if is_scorable:
                hits += 1
            reciprocal_ranks.append(1.0 / rank)
        else:
            reciprocal_ranks.append(0.0)

        results.append({
            "query": query,
            "found": found,
            "rank": rank if found else None,
            "resultCount": len(search_results),
            "topResults": [{"id": r.get("id"), "title": r.get("title"), "score": r.get("score"), "match": r.get("_match")} for r in matched_results[:limit]],
        })

    scorable = [q for q in queries if q.get("expected") and not q.get("allowZero")]
    recall = hits / len(scorable) if scorable else 0.0
    mrr = sum(reciprocal_ranks) / len(reciprocal_ranks) if reciprocal_ranks else 0.0

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "indexRoot": str(index_root),
        "queryCount": len(queries),
        "scorableQueries": len(scorable),
        "hits": hits,
        "recall_at_k": round(recall, 4),
        "mrr": round(mrr, 4),
        "limit": limit,
        "results": results,
    }


def format_table(run: dict[str, Any]) -> str:
    lines = [
        f"{'Query':<45s} {'Found':>6s} {'Rank':>5s} {'Results':>8s}",
        "-" * 70,
    ]
    for r in run["results"]:
        found = "Y" if r["found"] else "-"
        rank = str(r["rank"]) if r["rank"] else "-"
        lines.append(f"{r['query'][:44]:<45s} {found:>6s} {rank:>5s} {r['resultCount']:>8d}")
    lines.append("-" * 70)
    lines.append(f"recall@{run['limit']}: {run['recall_at_k']:.4f}   MRR: {run['mrr']:.4f}   ({run['hits']}/{run['scorableQueries']} scorable)")
    return "\n".join(lines)
