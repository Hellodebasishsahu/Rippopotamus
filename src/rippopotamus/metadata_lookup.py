from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

YEAR_PATTERN = re.compile(r"\b(19\d{2}|20\d{2})\b")

CINEMETA_BASE = "https://v3-cinemeta.strem.io"
USER_AGENT = "Rippopotamus/0.1 (+https://github.com/Hellodebasishsahu/Rippopotamus)"
TIMEOUT_SECONDS = 6


def lookup_media(query: str) -> dict[str, Any] | None:
    normalized = " ".join(query.split())[:120]
    if not normalized:
        return None

    year_hint = _extract_year_hint(normalized)
    title_query = YEAR_PATTERN.sub("", normalized).strip() if year_hint else normalized

    with ThreadPoolExecutor(max_workers=2) as pool:
        movie_future = pool.submit(_search_catalog, "movie", title_query)
        series_future = pool.submit(_search_catalog, "series", title_query)
        candidates = (movie_future.result() or []) + (series_future.result() or [])

    best = _pick_best(candidates, title_query, year_hint)
    if not best or not _is_plausible_match(best, title_query):
        return None

    detail = _fetch_meta(best["type"], best["id"]) or {}
    return _shape_payload(best, detail)


def _extract_year_hint(query: str) -> int | None:
    match = YEAR_PATTERN.search(query)
    return int(match.group(1)) if match else None


def _search_catalog(media_type: str, query: str) -> list[dict[str, Any]]:
    url = f"{CINEMETA_BASE}/catalog/{media_type}/top/search={quote(query)}.json"
    payload = _http_json(url)
    metas = payload.get("metas") if isinstance(payload, dict) else None
    return metas if isinstance(metas, list) else []


def _fetch_meta(media_type: str, imdb_id: str) -> dict[str, Any] | None:
    url = f"{CINEMETA_BASE}/meta/{media_type}/{imdb_id}.json"
    payload = _http_json(url)
    meta = payload.get("meta") if isinstance(payload, dict) else None
    return meta if isinstance(meta, dict) else None


def _http_json(url: str) -> Any:
    try:
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception:
        return None


def _pick_best(
    candidates: list[dict[str, Any]], query: str, year_hint: int | None
) -> dict[str, Any] | None:
    if not candidates:
        return None

    query_lower = query.lower()

    def score(meta: dict[str, Any]) -> tuple[int, int, int]:
        name = (meta.get("name") or "").lower()
        exact = 2 if name == query_lower else (1 if query_lower in name else 0)
        year = meta.get("releaseInfo") or ""
        year_int = int(year[:4]) if year[:4].isdigit() else 0
        year_match = 1 if year_hint and year_int == year_hint else 0
        return (year_match, exact, year_int)

    return max(candidates, key=score)


def _is_plausible_match(meta: dict[str, Any], query: str) -> bool:
    name = (meta.get("name") or "").lower().strip()
    if not name:
        return False
    query_lower = query.lower().strip()
    if name == query_lower or query_lower in name or name in query_lower:
        return True
    name_tokens = {t for t in re.split(r"\W+", name) if len(t) > 2}
    query_tokens = {t for t in re.split(r"\W+", query_lower) if len(t) > 2}
    if not query_tokens:
        return False
    return query_tokens.issubset(name_tokens)


def _shape_payload(summary: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    merged = {**summary, **detail}
    release = merged.get("releaseInfo") or ""
    year = release[:4] if release[:4].isdigit() else None
    genres = merged.get("genres")
    cast = merged.get("cast")
    return {
        "imdbId": merged.get("imdb_id") or merged.get("id"),
        "type": merged.get("type"),
        "title": merged.get("name"),
        "year": year,
        "releaseInfo": release or None,
        "poster": merged.get("poster"),
        "background": merged.get("background"),
        "synopsis": merged.get("description"),
        "runtime": merged.get("runtime"),
        "imdbRating": merged.get("imdbRating"),
        "genres": genres if isinstance(genres, list) else None,
        "cast": cast[:6] if isinstance(cast, list) else None,
        "source": "cinemeta",
    }
