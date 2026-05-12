from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class PlayableLink:
    url: str
    host: str
    label: str
    kind: str
    size: str | None = None
    quality: str | None = None
    extension: str | None = None
    source_adapter: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v not in (None, "")}


class IndexAdapter(Protocol):
    name: str

    def search(self, title: str, year: int | None, imdb_id: str | None) -> list[PlayableLink]: ...


def resolve_all(
    adapters: list[IndexAdapter],
    title: str,
    year: int | None,
    imdb_id: str | None,
    timeout_seconds: float = 8.0,
) -> list[PlayableLink]:
    if not title:
        return []

    with ThreadPoolExecutor(max_workers=max(1, len(adapters))) as pool:
        futures = [pool.submit(_safe_search, a, title, year, imdb_id) for a in adapters]
        results: list[PlayableLink] = []
        for future in futures:
            try:
                results.extend(future.result(timeout=timeout_seconds))
            except Exception:
                continue
    return results


def _safe_search(
    adapter: IndexAdapter, title: str, year: int | None, imdb_id: str | None
) -> list[PlayableLink]:
    try:
        return adapter.search(title, year, imdb_id)
    except Exception:
        return []
