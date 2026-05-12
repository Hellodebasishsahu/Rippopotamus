from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from rippopotamus.resolvers.base import PlayableLink

VIDEO_EXTS = {"mp4", "mkv", "webm", "avi", "mov", "m4v", "ogv"}
AUDIO_EXTS = {"mp3", "flac", "wav", "ogg", "m4a", "opus"}
TIMEOUT = 6


class InternetArchiveAdapter:
    name = "internet_archive"

    def search(self, title: str, year: int | None, imdb_id: str | None) -> list[PlayableLink]:
        identifiers = _search_identifiers(title, year, limit=5)
        if not identifiers:
            return []

        with ThreadPoolExecutor(max_workers=min(5, len(identifiers))) as pool:
            metas = list(pool.map(_fetch_metadata, identifiers))

        links: list[PlayableLink] = []
        for identifier, meta in zip(identifiers, metas):
            if not meta:
                continue
            links.extend(_extract_links(identifier, meta))
        return links


def _search_identifiers(title: str, year: int | None, limit: int) -> list[str]:
    parts = [f'title:("{title}")', "(mediatype:movies OR mediatype:audio)"]
    if year:
        parts.append(f"year:{year}")
    params = {
        "q": " AND ".join(parts),
        "fl[]": "identifier",
        "rows": str(limit),
        "page": "1",
        "output": "json",
    }
    url = "https://archive.org/advancedsearch.php?" + urlencode(params, doseq=True)
    payload = _http_json(url)
    if not isinstance(payload, dict):
        return []
    docs = payload.get("response", {}).get("docs") or []
    return [d["identifier"] for d in docs if isinstance(d, dict) and "identifier" in d]


def _fetch_metadata(identifier: str) -> dict[str, Any] | None:
    url = f"https://archive.org/metadata/{quote(identifier, safe='')}"
    payload = _http_json(url)
    return payload if isinstance(payload, dict) else None


def _extract_links(identifier: str, meta: dict[str, Any]) -> list[PlayableLink]:
    files = meta.get("files") or []
    metadata = meta.get("metadata") or {}
    title = _first_str(metadata.get("title")) or identifier

    candidates: list[PlayableLink] = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name:
            continue
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext not in VIDEO_EXTS and ext not in AUDIO_EXTS:
            continue
        kind = "video" if ext in VIDEO_EXTS else "audio"
        url = f"https://archive.org/download/{quote(identifier, safe='')}/{quote(name)}"
        size = _human_size(entry.get("size"))
        candidates.append(
            PlayableLink(
                url=url,
                host="archive.org",
                label=title,
                kind=kind,
                size=size,
                extension=ext,
                source_adapter="internet_archive",
            )
        )

    candidates.sort(key=lambda link: _quality_rank(link), reverse=True)
    return candidates[:3]


def _quality_rank(link: PlayableLink) -> tuple[int, int]:
    ext_priority = {"mkv": 4, "mp4": 3, "webm": 2, "mov": 1}.get(link.extension or "", 0)
    size_bytes = 0
    if link.size and link.size.endswith(("MB", "GB")):
        try:
            num = float(link.size[:-2].strip())
            size_bytes = int(num * (1024 if link.size.endswith("GB") else 1))
        except ValueError:
            pass
    return (ext_priority, size_bytes)


def _human_size(raw: Any) -> str | None:
    try:
        size = int(raw)
    except (TypeError, ValueError):
        return None
    if size <= 0:
        return None
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f}{unit}" if unit != "B" else f"{size}B"
        size /= 1024
    return None


def _first_str(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list) and value and isinstance(value[0], str):
        return value[0]
    return None


def _http_json(url: str) -> Any:
    try:
        request = Request(url, headers={"User-Agent": "Rippopotamus/0.1", "Accept": "application/json"})
        with urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception:
        return None
