from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import quote, quote_plus
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class SourcePack:
    id: str
    label: str
    description: str


@dataclass(frozen=True)
class SourceEntry:
    id: str
    pack: str
    title: str
    description: str
    url: str
    search_url: str | None
    media_types: tuple[str, ...]
    usage: str
    tags: tuple[str, ...]
    action_label: str


JsonFetcher = Callable[[str], dict[str, Any]]


PACKS: tuple[SourcePack, ...] = (
    SourcePack(
        id="movies",
        label="Movies and shows",
        description="Legal watch, review, and title lookup sources.",
    ),
    SourcePack(
        id="starter",
        label="Best starting points",
        description="Broad, safer sources to search first for reusable media.",
    ),
    SourcePack(
        id="public",
        label="Public archives",
        description="Open and public-domain-friendly archives with strong media collections.",
    ),
    SourcePack(
        id="stock",
        label="Free stock media",
        description="Creator-friendly photo, video, vector, and audio libraries.",
    ),
    SourcePack(
        id="tools",
        label="Media tools",
        description="Useful FMHY tool directories for finding download, conversion, and file helpers.",
    ),
)


SOURCES: tuple[SourceEntry, ...] = (
    SourceEntry(
        id="justwatch",
        pack="movies",
        title="JustWatch",
        description="Find where a movie or show is streaming, renting, or buying in your region.",
        url="https://www.justwatch.com/us",
        search_url="https://www.justwatch.com/us/search?q={query}",
        media_types=("movies", "shows", "watch"),
        usage="Use this to find legal watch options; availability can vary by country.",
        tags=("movie", "movies", "show", "shows", "streaming", "watch", "rent", "buy", "legal", "availability"),
        action_label="Find Watch Options",
    ),
    SourceEntry(
        id="rotten-tomatoes",
        pack="movies",
        title="Rotten Tomatoes",
        description="Movie and show pages with summaries, cast, reviews, and watch-provider links.",
        url="https://www.rottentomatoes.com/",
        search_url="https://www.rottentomatoes.com/search?search={query}",
        media_types=("movies", "shows", "reviews"),
        usage="Use this for title confirmation and legal where-to-watch links.",
        tags=("movie", "movies", "show", "shows", "reviews", "ratings", "cast", "watch", "rent", "buy"),
        action_label="Search RT",
    ),
    SourceEntry(
        id="imdb",
        pack="movies",
        title="IMDb",
        description="Movie and show title search with cast, year, runtime, trailers, and official links.",
        url="https://www.imdb.com/",
        search_url="https://www.imdb.com/find/?q={query}",
        media_types=("movies", "shows", "metadata"),
        usage="Use this to disambiguate exact titles and release years.",
        tags=("movie", "movies", "show", "shows", "title", "cast", "year", "runtime", "trailer", "metadata"),
        action_label="Search IMDb",
    ),
    SourceEntry(
        id="tmdb",
        pack="movies",
        title="TMDB",
        description="Community movie and TV database with posters, metadata, trailers, and external IDs.",
        url="https://www.themoviedb.org/",
        search_url="https://www.themoviedb.org/search?query={query}",
        media_types=("movies", "shows", "metadata"),
        usage="Use this for title metadata and posters; check image rights before reuse.",
        tags=("movie", "movies", "tv", "shows", "metadata", "poster", "trailer", "cast", "year"),
        action_label="Search TMDB",
    ),
    SourceEntry(
        id="youtube",
        pack="movies",
        title="YouTube",
        description="Search official trailers, creator uploads, shorts, and legitimately posted full films.",
        url="https://www.youtube.com/",
        search_url="https://www.youtube.com/results?search_query={query}",
        media_types=("video", "trailers", "shorts"),
        usage="Prefer official channels and uploads where the owner clearly posted the video.",
        tags=("movie", "movies", "trailer", "official", "youtube", "video", "short", "full film"),
        action_label="Search YouTube",
    ),
    SourceEntry(
        id="short-of-the-week",
        pack="movies",
        title="Short of the Week",
        description="Curated short films with legal playback and editorial context.",
        url="https://www.shortoftheweek.com/",
        search_url="https://www.shortoftheweek.com/?s={query}",
        media_types=("shorts", "video", "films"),
        usage="Good for short films and festival-style releases that are legally playable.",
        tags=("movie", "film", "short", "shorts", "festival", "legal", "play", "watch"),
        action_label="Search Shorts",
    ),
    SourceEntry(
        id="wikimedia-commons",
        pack="starter",
        title="Wikimedia Commons",
        description="Huge library of freely usable images, audio, video, diagrams, and public-domain media.",
        url="https://commons.wikimedia.org/",
        search_url="https://commons.wikimedia.org/w/index.php?search={query}&title=Special:MediaSearch&type=image",
        media_types=("images", "audio", "video", "documents"),
        usage="Check the file page license and attribution requirements before publishing.",
        tags=("commons", "creative commons", "public domain", "wiki", "photos", "illustrations", "maps"),
        action_label="Search Commons",
    ),
    SourceEntry(
        id="internet-archive",
        pack="starter",
        title="Internet Archive",
        description="Search books, films, audio, software, community media, and historical collections.",
        url="https://archive.org/",
        search_url="https://archive.org/search?query={query}",
        media_types=("video", "audio", "books", "software", "images"),
        usage="Rights vary by item; review each item page before reuse.",
        tags=("archive", "historical", "books", "movies", "audio", "software", "old", "public domain"),
        action_label="Search Archive",
    ),
    SourceEntry(
        id="openverse",
        pack="starter",
        title="Openverse",
        description="Search Creative Commons and public-domain images and audio across many indexed collections.",
        url="https://openverse.org/",
        search_url="https://openverse.org/search/?q={query}",
        media_types=("images", "audio"),
        usage="Use the license filter and keep attribution details with the asset.",
        tags=("openverse", "creative commons", "cc", "public domain", "photos", "audio"),
        action_label="Search Openverse",
    ),
    SourceEntry(
        id="nasa-images",
        pack="public",
        title="NASA Images",
        description="NASA image and video library for space, missions, Earth, astronomy, and aeronautics media.",
        url="https://images.nasa.gov/",
        search_url="https://images.nasa.gov/search?q={query}",
        media_types=("images", "video", "audio"),
        usage="Most NASA media is usable with credit, but check item restrictions for people, logos, and partner content.",
        tags=("nasa", "space", "earth", "moon", "mars", "science", "astronomy", "rocket", "public domain"),
        action_label="Search NASA Images",
    ),
    SourceEntry(
        id="pexels",
        pack="stock",
        title="Pexels",
        description="Free stock photos and videos with creator-friendly browsing for editorial and design work.",
        url="https://www.pexels.com/",
        search_url="https://www.pexels.com/search/{path_query}/",
        media_types=("images", "video"),
        usage="Review the Pexels license and avoid implying endorsement by people or brands shown.",
        tags=("stock", "photos", "video", "b-roll", "creator", "social", "commercial"),
        action_label="Search Pexels",
    ),
    SourceEntry(
        id="pixabay",
        pack="stock",
        title="Pixabay",
        description="Photos, vectors, illustrations, videos, music, sound effects, and GIFs.",
        url="https://pixabay.com/",
        search_url="https://pixabay.com/images/search/{path_query}/",
        media_types=("images", "video", "audio", "vectors"),
        usage="Check Pixabay license notes and avoid protected trademarks or recognizable people misuse.",
        tags=("stock", "photos", "illustrations", "vectors", "music", "sound effects", "commercial"),
        action_label="Search Pixabay",
    ),
    SourceEntry(
        id="unsplash",
        pack="stock",
        title="Unsplash",
        description="High-quality free photography for backgrounds, moodboards, editorial, and product visuals.",
        url="https://unsplash.com/",
        search_url="https://unsplash.com/s/photos/{path_query}",
        media_types=("images",),
        usage="Review Unsplash license terms and credit photographers where appropriate.",
        tags=("stock", "photos", "photography", "backgrounds", "editorial", "creator"),
        action_label="Search Unsplash",
    ),
    SourceEntry(
        id="freesound",
        pack="stock",
        title="Freesound",
        description="Community sound effects, ambience, foley, loops, and samples with per-sound licenses.",
        url="https://freesound.org/",
        search_url="https://freesound.org/search/?q={query}",
        media_types=("audio",),
        usage="Licenses vary; filter and preserve attribution for each sound.",
        tags=("audio", "sfx", "sound effects", "foley", "ambience", "samples", "creative commons"),
        action_label="Search Freesound",
    ),
    SourceEntry(
        id="fmhy",
        pack="tools",
        title="FMHY",
        description="Community-maintained directory of media sites and internet tools.",
        url="https://fmhy.net/",
        search_url="https://fmhy.net/?q={query}",
        media_types=("directories", "tools"),
        usage="Directory links vary; prefer legal, licensed, and source-owned media.",
        tags=("fmhy", "directory", "media", "tools", "index", "find"),
        action_label="Search FMHY",
    ),
    SourceEntry(
        id="fmhy-video-tools",
        pack="tools",
        title="FMHY Video Tools",
        description="Directory page for video utilities, editors, converters, media servers, and related tools.",
        url="https://fmhy.net/video-tools",
        search_url=None,
        media_types=("video", "tools"),
        usage="Use tools against media you own or have permission to process.",
        tags=("fmhy", "video", "tools", "converter", "editor", "download", "media server"),
        action_label="Open Video Tools",
    ),
    SourceEntry(
        id="fmhy-file-tools",
        pack="tools",
        title="FMHY File Tools",
        description="Directory page for file utilities, conversion helpers, and multi-site media tools.",
        url="https://fmhy.net/file-tools",
        search_url=None,
        media_types=("files", "tools"),
        usage="Use tools against files and sources you have permission to access.",
        tags=("fmhy", "file", "tools", "converter", "download", "utility"),
        action_label="Open File Tools",
    ),
)


def search_sources(query: str, pack: str | None = None, limit: int = 12, fetch_json: JsonFetcher | None = None) -> dict[str, object]:
    normalized_query = " ".join(query.split())
    normalized_pack = (pack or "all").strip().lower() or "all"
    if limit < 1:
        limit = 1

    known_packs = {source_pack.id for source_pack in PACKS}
    if normalized_pack != "all" and normalized_pack not in known_packs:
        raise ValueError(f"Unknown source pack `{pack}`.")

    live_results = _live_results(normalized_query, normalized_pack, limit, fetch_json or _fetch_json)
    candidates = [source for source in SOURCES if normalized_pack == "all" or source.pack == normalized_pack]
    ranked = sorted(
        (_rank_source(source, normalized_query), index, source) for index, source in enumerate(candidates)
    )
    route_results = [
        _source_payload(source, score=-rank[0], query=normalized_query)
        for rank, _index, source in ranked[:limit]
    ]
    results = _dedupe_results([*live_results, *route_results])[:limit]
    actual_count = sum(1 for result in results if result.get("resultKind") == "item")
    route_count = sum(1 for result in results if result.get("resultKind") == "source")

    return {
        "ok": True,
        "query": normalized_query,
        "pack": normalized_pack,
        "packs": [_pack_payload(source_pack) for source_pack in PACKS],
        "results": results,
        "actualResultCount": actual_count,
        "routeResultCount": route_count,
        "searchedSources": sorted({str(result.get("sourceName") or result.get("packLabel")) for result in live_results}),
    }


def _pack_payload(source_pack: SourcePack) -> dict[str, object]:
    return {
        "id": source_pack.id,
        "label": source_pack.label,
        "description": source_pack.description,
        "count": sum(1 for source in SOURCES if source.pack == source_pack.id),
    }


def _source_payload(source: SourceEntry, score: int, query: str) -> dict[str, object]:
    pack = next(source_pack for source_pack in PACKS if source_pack.id == source.pack)
    return {
        "id": source.id,
        "pack": source.pack,
        "packLabel": pack.label,
        "title": source.title,
        "description": source.description,
        "url": source.url,
        "openUrl": _open_url(source, query),
        "mediaTypes": list(source.media_types),
        "usage": source.usage,
        "actionLabel": source.action_label,
        "score": score,
        "resultKind": "source",
        "sourceName": source.title,
    }


def _open_url(source: SourceEntry, query: str) -> str:
    if not query or source.search_url is None:
        return source.url
    return source.search_url.format(query=quote_plus(query), path_query=quote(query))


def _rank_source(source: SourceEntry, query: str) -> tuple[int, int]:
    if not query:
        return (-_default_weight(source), 0)

    words = [word for word in re_split(query.lower()) if len(word) > 1]
    haystacks = {
        "title": source.title.lower(),
        "tags": " ".join(source.tags).lower(),
        "description": source.description.lower(),
        "media": " ".join(source.media_types).lower(),
    }
    score = _default_weight(source)
    for word in words:
        if word in haystacks["title"]:
            score += 30
        if word in haystacks["tags"]:
            score += 20
        if word in haystacks["media"]:
            score += 14
        if word in haystacks["description"]:
            score += 8
    return (-score, 0)


def _default_weight(source: SourceEntry) -> int:
    if source.pack == "movies":
        return 46
    if source.pack == "starter":
        return 40
    if source.pack == "public":
        return 34
    if source.pack == "stock":
        return 30
    return 20


def re_split(value: str) -> list[str]:
    return value.replace("-", " ").replace("_", " ").split()


def _live_results(query: str, pack: str, limit: int, fetch_json: JsonFetcher) -> list[dict[str, object]]:
    if not query:
        return []

    adapters = _adapters_for(query, pack)
    results: list[dict[str, object]] = []
    per_adapter_limit = max(3, min(8, limit))
    for adapter in adapters:
        try:
            results.extend(adapter(query, per_adapter_limit, fetch_json))
        except Exception:
            continue
        if len(results) >= limit:
            break
    return results


def _adapters_for(query: str, pack: str) -> list[Callable[[str, int, JsonFetcher], list[dict[str, object]]]]:
    if pack == "movies":
        return [_search_imdb]
    if pack == "starter":
        return [_search_archive, _search_commons, _search_openverse]
    if pack == "public":
        return [_search_nasa, _search_commons, _search_archive]
    if pack == "stock":
        return [_search_openverse]
    if pack == "tools":
        return []
    if _looks_like_movie_query(query):
        return [_search_imdb]
    return [_search_archive, _search_nasa, _search_commons, _search_openverse]


def _looks_like_movie_query(query: str) -> bool:
    words = {word.lower().strip(".,:;!?()[]{}") for word in query.split()}
    return bool(words & {"movie", "movies", "film", "films", "show", "shows", "tv", "series", "episode", "watch"})


def _search_imdb(query: str, limit: int, fetch_json: JsonFetcher) -> list[dict[str, object]]:
    core = _movie_query_core(query)
    if not core:
        return []

    first = next((char for char in core.lower() if char.isalnum()), "x")
    payload = fetch_json(f"https://v3.sg.media-imdb.com/suggestion/{quote(first)}/{quote(core.lower())}.json")
    results = []
    for index, item in enumerate(payload.get("d", []) if isinstance(payload, dict) else []):
        imdb_id = _string(item.get("id"))
        title = _string(item.get("l"))
        if not imdb_id or not title or not imdb_id.startswith("tt"):
            continue
        qid = _string(item.get("qid"))
        label = _string(item.get("q")) or qid or "title"
        if qid and qid not in {"movie", "tvMovie", "tvSeries", "tvMiniSeries", "tvEpisode", "video"}:
            continue
        year = _string(item.get("y"))
        cast = _string(item.get("s"))
        image = item.get("i") if isinstance(item.get("i"), dict) else {}
        description = " - ".join(part for part in [year, label, cast] if part) or "IMDb title result."
        media_types = [label, year] if year else [label]
        results.append(_item_payload(
            result_id=f"imdb:{imdb_id}",
            pack="movies",
            pack_label="IMDb",
            source_name="IMDb",
            title=title,
            description=description,
            open_url=f"https://www.imdb.com/title/{imdb_id}/",
            media_types=media_types,
            usage="Actual IMDb title suggestion result. Use linked watch options or official sources for playback.",
            action_label="Open IMDb",
            score=120 - (index * 5),
            thumbnail_url=_string(image.get("imageUrl")),
        ))
        if len(results) >= limit:
            break
    return results


def _search_archive(query: str, limit: int, fetch_json: JsonFetcher) -> list[dict[str, object]]:
    payload = fetch_json(
        "https://archive.org/advancedsearch.php?"
        f"q={quote_plus(query)}"
        "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=mediatype&fl%5B%5D=description"
        f"&rows={limit}&page=1&output=json"
    )
    docs = ((payload.get("response") or {}).get("docs") or []) if isinstance(payload, dict) else []
    results = []
    for index, doc in enumerate(docs):
        identifier = _string(doc.get("identifier"))
        title = _string(doc.get("title")) or identifier
        if not identifier or not title:
            continue
        mediatype = _string(doc.get("mediatype")) or "archive"
        description = _clean_text(_text_value(doc.get("description"))) or f"Internet Archive {mediatype} item."
        results.append(_item_payload(
            result_id=f"archive:{identifier}",
            pack="starter",
            pack_label="Internet Archive",
            source_name="Internet Archive",
            title=title,
            description=description,
            open_url=f"https://archive.org/details/{quote(identifier)}",
            media_types=[mediatype],
            usage="Actual Internet Archive search result. Rights vary by item; check the item page.",
            action_label="Open Archive",
            score=105 - (index * 4),
        ))
    return results


def _search_nasa(query: str, limit: int, fetch_json: JsonFetcher) -> list[dict[str, object]]:
    payload = fetch_json(f"https://images-api.nasa.gov/search?q={quote_plus(query)}&page_size={limit}")
    items = ((payload.get("collection") or {}).get("items") or []) if isinstance(payload, dict) else []
    results = []
    for index, item in enumerate(items):
        data = (item.get("data") or [{}])[0] if isinstance(item, dict) else {}
        nasa_id = _string(data.get("nasa_id"))
        title = _string(data.get("title")) or nasa_id
        if not nasa_id or not title:
            continue
        media_type = _string(data.get("media_type")) or "media"
        date = _string(data.get("date_created"))[:10]
        description = _clean_text(_string(data.get("description"))) or "NASA media library result."
        thumbnail = _first_link(item.get("links") or [], rel="preview") if isinstance(item, dict) else ""
        results.append(_item_payload(
            result_id=f"nasa:{nasa_id}",
            pack="public",
            pack_label="NASA Images",
            source_name="NASA Images",
            title=title,
            description=description,
            open_url=f"https://images.nasa.gov/details/{quote(nasa_id)}",
            media_types=[media_type, date] if date else [media_type],
            usage="Actual NASA Images result. Check item restrictions and credit guidance.",
            action_label="Open NASA",
            score=104 - (index * 4),
            thumbnail_url=thumbnail,
        ))
    return results


def _search_commons(query: str, limit: int, fetch_json: JsonFetcher) -> list[dict[str, object]]:
    payload = fetch_json(
        "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search"
        f"&gsrsearch={quote_plus(query)}&gsrnamespace=6&gsrlimit={limit}"
        "&prop=imageinfo&iiprop=url%7Cmime%7Csize%7Cextmetadata"
    )
    pages = ((payload.get("query") or {}).get("pages") or {}) if isinstance(payload, dict) else {}
    ordered = sorted(pages.values(), key=lambda page: page.get("index", 999))
    results = []
    for index, page in enumerate(ordered):
        info = (page.get("imageinfo") or [{}])[0]
        raw_title = _string(page.get("title"))
        title = raw_title.replace("File:", "", 1)
        open_url = _string(info.get("descriptionurl")) or f"https://commons.wikimedia.org/wiki/{quote(raw_title.replace(' ', '_'))}"
        metadata = info.get("extmetadata") if isinstance(info.get("extmetadata"), dict) else {}
        description = _clean_text(_metadata_value(metadata, "ImageDescription")) or "Wikimedia Commons media result."
        mime = _string(info.get("mime")) or "media"
        results.append(_item_payload(
            result_id=f"commons:{page.get('pageid')}",
            pack="starter",
            pack_label="Wikimedia Commons",
            source_name="Wikimedia Commons",
            title=title,
            description=description,
            open_url=open_url,
            media_types=[mime],
            usage="Actual Commons search result. Check the file page license and attribution.",
            action_label="Open Commons",
            score=102 - (index * 4),
            thumbnail_url=_string(info.get("url")),
        ))
    return results


def _search_openverse(query: str, limit: int, fetch_json: JsonFetcher) -> list[dict[str, object]]:
    payload = fetch_json(f"https://api.openverse.org/v1/images?q={quote_plus(query)}&page_size={limit}")
    items = payload.get("results", []) if isinstance(payload, dict) else []
    results = []
    for index, item in enumerate(items):
        item_id = _string(item.get("id"))
        title = _string(item.get("title")) or item_id
        open_url = _string(item.get("foreign_landing_url")) or _string(item.get("url"))
        if not item_id or not title or not open_url:
            continue
        provider = _string(item.get("provider")) or _string(item.get("source")) or "Openverse"
        creator = _string(item.get("creator"))
        license_code = _string(item.get("license"))
        description = " - ".join(part for part in [creator, provider, license_code.upper()] if part) or "Openverse image result."
        results.append(_item_payload(
            result_id=f"openverse:{item_id}",
            pack="starter",
            pack_label="Openverse",
            source_name="Openverse",
            title=title,
            description=description,
            open_url=open_url,
            media_types=["image", license_code] if license_code else ["image"],
            usage="Actual Openverse result. Preserve license and attribution details.",
            action_label="Open Source",
            score=100 - (index * 4),
            thumbnail_url=_string(item.get("thumbnail")) or _string(item.get("url")),
        ))
    return results


def _item_payload(
    *,
    result_id: str,
    pack: str,
    pack_label: str,
    source_name: str,
    title: str,
    description: str,
    open_url: str,
    media_types: list[str],
    usage: str,
    action_label: str,
    score: int,
    thumbnail_url: str = "",
) -> dict[str, object]:
    return {
        "id": result_id,
        "pack": pack,
        "packLabel": pack_label,
        "title": title,
        "description": _truncate(description, 260),
        "url": open_url,
        "openUrl": open_url,
        "mediaTypes": [item for item in media_types if item],
        "usage": usage,
        "actionLabel": action_label,
        "score": score,
        "resultKind": "item",
        "sourceName": source_name,
        "thumbnailUrl": thumbnail_url,
    }


def _dedupe_results(results: list[dict[str, object]]) -> list[dict[str, object]]:
    seen: set[str] = set()
    deduped = []
    for result in results:
        key = str(result.get("openUrl") or result.get("url") or result.get("id"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(result)
    return deduped


def _fetch_json(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": "Rippopotamus/0.1 source-search"})
    with urlopen(request, timeout=4) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def _movie_query_core(query: str) -> str:
    stop = {"movie", "movies", "film", "films", "show", "shows", "tv", "series", "watch", "streaming"}
    words = [word.strip(".,:;!?()[]{}") for word in query.split()]
    kept = [word for word in words if word.lower() not in stop]
    return " ".join(kept or words).strip()[:80]


def _string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _text_value(value: object) -> str:
    if isinstance(value, list):
        return " ".join(_string(item) for item in value)
    return _string(value)


def _clean_text(value: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", value))
    return " ".join(text.split())


def _truncate(value: str, length: int) -> str:
    value = _clean_text(value)
    if len(value) <= length:
        return value
    return value[: length - 3].rstrip() + "..."


def _metadata_value(metadata: dict[str, object], key: str) -> str:
    value = metadata.get(key)
    if isinstance(value, dict):
        return _string(value.get("value"))
    return _string(value)


def _first_link(links: list[object], rel: str) -> str:
    for link in links:
        if isinstance(link, dict) and link.get("rel") == rel:
            return _string(link.get("href"))
    return ""
