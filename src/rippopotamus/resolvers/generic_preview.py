from __future__ import annotations

import html
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any


X_STATUS_RE = re.compile(r"^https?://(?:www\.)?(?:x|twitter)\.com/[^/?#]+/status/(\d+)", re.IGNORECASE)
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
META_RE = re.compile(
    r"<meta\s+([^>]*?(?:property|name)=[\"'][^\"']+[\"'][^>]*)>",
    re.IGNORECASE | re.DOTALL,
)
LINK_RE = re.compile(r"<link\s+([^>]*?rel=[\"'][^\"']+[\"'][^>]*)>", re.IGNORECASE | re.DOTALL)
ATTR_RE = re.compile(r"([a-zA-Z_:.-]+)\s*=\s*([\"'])(.*?)\2", re.DOTALL)
JSON_LD_RE = re.compile(
    r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)

META_TITLE_KEYS = {"og:title", "twitter:title", "title"}
META_DESCRIPTION_KEYS = {"og:description", "twitter:description", "description"}
META_IMAGE_KEYS = {"og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"}
META_VIDEO_KEYS = {"og:video", "og:video:url", "og:video:secure_url", "twitter:player", "twitter:player:stream"}
META_AUDIO_KEYS = {"og:audio", "og:audio:url", "og:audio:secure_url"}
OEMBED_TYPES = {"application/json+oembed", "text/json+oembed"}
X_THUMBNAIL_RE = re.compile(r"https://pbs\.twimg\.com/amplify_video_thumb/[^\"<> ]+?\.jpg(?:\?name=[^\"<> ]+)?")
X_MP4_RE = re.compile(r"https://video\.twimg\.com/[^\"\\<> ]+?\.mp4")
X_DURATION_RE = re.compile(r"duration_millis[:=](\d+)")
X_CREATED_AT_RE = re.compile(r"created_at_ms:(\d+)")


def _clean_text(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", html.unescape(value)).strip()
    return cleaned or None


def _attrs(raw: str) -> dict[str, str]:
    return {key.lower(): html.unescape(value.strip()) for key, _quote, value in ATTR_RE.findall(raw)}


_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
}


def _fetch_via_urllib(url: str, timeout: int, limit: int) -> str:
    opener = urllib.request.build_opener()
    request = urllib.request.Request(url, headers=_FETCH_HEADERS)
    with opener.open(request, timeout=timeout) as response:
        return response.read(limit).decode("utf-8", errors="ignore")


def _fetch_text(url: str, timeout: int = 6, limit: int = 2_000_000, attempts: int = 3) -> str:
    # Some networks reset ~1/3 of connections to certain domains (curl 35 /
    # ConnectionResetError); a couple of retries turns that into a success.
    last_error: Exception | None = None
    for attempt in range(max(1, attempts)):
        try:
            return _fetch_via_urllib(url, timeout, limit)
        except (ConnectionResetError, urllib.error.URLError, OSError, TimeoutError, subprocess.SubprocessError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(1)
    raise last_error if last_error else OSError("Failed to fetch page.")


def _is_previewable_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    return parsed.path not in {"", "/"} or bool(parsed.query)


def _absolute(url: str | None, base_url: str) -> str | None:
    if not url:
        return None
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme and parsed.scheme not in {"http", "https"}:
            return None
        return urllib.parse.urljoin(base_url, url)
    except ValueError:
        return None


def _first_meta(page: str, keys: set[str]) -> str | None:
    for tag in META_RE.finditer(page):
        attrs = _attrs(tag.group(1))
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        if key in keys:
            value = _clean_text(attrs.get("content"))
            if value:
                return value
    return None


def _all_meta_urls(page: str, keys: set[str], base_url: str) -> list[str]:
    urls: list[str] = []
    for tag in META_RE.finditer(page):
        attrs = _attrs(tag.group(1))
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        if key not in keys:
            continue
        url = _absolute(attrs.get("content"), base_url)
        if url and url not in urls:
            urls.append(url)
    return urls


def _page_title(page: str) -> str | None:
    match = TITLE_RE.search(page)
    return _clean_text(match.group(1)) if match else None


def _x_page_title(page: str) -> str | None:
    title = _page_title(page)
    return re.sub(r"\s*/\s*X$", "", title).strip() if title else None


def _x_uploader(title: str | None) -> str | None:
    if not title:
        return None
    match = re.match(r"(.+?)\s+on\s+X:", title)
    return match.group(1).strip() if match else None


def _x_card_title(title: str | None, description: str | None, uploader: str | None) -> str:
    if description and uploader:
        trimmed = description[:72].rstrip()
        if len(description) > len(trimmed):
            trimmed += "..."
        return f"{uploader} - {trimmed}"
    return title or "X media"


def _x_upload_date(page: str) -> str | None:
    match = X_CREATED_AT_RE.search(page)
    if not match:
        return None
    try:
        return datetime.fromtimestamp(int(match.group(1)) / 1000, tz=timezone.utc).strftime("%Y%m%d")
    except (OSError, ValueError):
        return None


def _x_preview_metadata(url: str, page: str, provider: str) -> dict[str, Any] | None:
    match = X_STATUS_RE.match(url.strip())
    if not match or not X_MP4_RE.search(page):
        return None

    title = _x_page_title(page)
    description = _first_meta(page, META_DESCRIPTION_KEYS)
    uploader = _x_uploader(title)
    thumbnails = list(dict.fromkeys(X_THUMBNAIL_RE.findall(page)))
    duration_match = X_DURATION_RE.search(page)
    duration = int(duration_match.group(1)) / 1000 if duration_match else None
    parsed = urllib.parse.urlparse(url)
    webpage_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))

    return {
        "id": match.group(1),
        "title": _x_card_title(title, description, uploader),
        "description": description,
        "duration": duration,
        "extractor": "Twitter",
        "filesize": None,
        "filesize_approx": None,
        "provider": provider,
        "thumbnail": thumbnails[0] if thumbnails else None,
        "thumbnails": thumbnails,
        "upload_date": _x_upload_date(page),
        "uploader": uploader,
        "webpage_url": webpage_url,
        "provisional": True,
    }


def _jsonld_values(page: str) -> dict[str, Any]:
    found: dict[str, Any] = {}

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return
        graph = value.get("@graph")
        if isinstance(graph, list):
            visit(graph)
        title = value.get("name") or value.get("headline")
        description = value.get("description")
        thumbnail = value.get("thumbnailUrl") or value.get("image")
        duration = value.get("duration")
        content_url = value.get("contentUrl") or value.get("embedUrl")
        if "title" not in found and isinstance(title, str):
            found["title"] = _clean_text(title)
        if "description" not in found and isinstance(description, str):
            found["description"] = _clean_text(description)
        if "thumbnail" not in found:
            if isinstance(thumbnail, str):
                found["thumbnail"] = thumbnail
            elif isinstance(thumbnail, list) and thumbnail and isinstance(thumbnail[0], str):
                found["thumbnail"] = thumbnail[0]
            elif isinstance(thumbnail, dict) and isinstance(thumbnail.get("url"), str):
                found["thumbnail"] = thumbnail["url"]
        if "duration" not in found and isinstance(duration, str):
            found["duration"] = duration
        if "media_url" not in found and isinstance(content_url, str):
            found["media_url"] = content_url
        for child in value.values():
            if isinstance(child, (dict, list)):
                visit(child)

    for script in JSON_LD_RE.finditer(page):
        try:
            visit(json.loads(html.unescape(script.group(1)).strip()))
        except (json.JSONDecodeError, TypeError):
            continue
    return found


def _oembed_url(page: str, base_url: str) -> str | None:
    for tag in LINK_RE.finditer(page):
        attrs = _attrs(tag.group(1))
        rel = attrs.get("rel", "").lower()
        typ = attrs.get("type", "").lower()
        if "alternate" not in rel or typ not in OEMBED_TYPES:
            continue
        url = _absolute(attrs.get("href"), base_url)
        if url:
            return url
    return None


def _oembed_values(page: str, base_url: str) -> dict[str, Any]:
    url = _oembed_url(page, base_url)
    if not url:
        return {}
    try:
        payload = json.loads(_fetch_text(url, timeout=4, limit=200_000))
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return {
        "title": _clean_text(payload.get("title") if isinstance(payload.get("title"), str) else None),
        "description": _clean_text(payload.get("description") if isinstance(payload.get("description"), str) else None),
        "thumbnail": payload.get("thumbnail_url") if isinstance(payload.get("thumbnail_url"), str) else None,
        "uploader": _clean_text(payload.get("author_name") if isinstance(payload.get("author_name"), str) else None),
    }


def preview_metadata(url: str, provider: str = "yt-dlp") -> dict[str, Any] | None:
    if not _is_previewable_url(url):
        return None
    try:
        page = _fetch_text(url)
    except (OSError, TimeoutError, urllib.error.URLError):
        return None

    x_metadata = _x_preview_metadata(url, page, provider)
    if x_metadata:
        return x_metadata

    jsonld = _jsonld_values(page)
    oembed = _oembed_values(page, url)
    title = _first_meta(page, META_TITLE_KEYS) or oembed.get("title") or jsonld.get("title") or _page_title(page)
    description = _first_meta(page, META_DESCRIPTION_KEYS) or oembed.get("description") or jsonld.get("description")
    thumbnails = _all_meta_urls(page, META_IMAGE_KEYS, url)
    if oembed.get("thumbnail"):
        thumb = _absolute(oembed.get("thumbnail"), url)
        if thumb and thumb not in thumbnails:
            thumbnails.append(thumb)
    if jsonld.get("thumbnail"):
        thumb = _absolute(str(jsonld["thumbnail"]), url)
        if thumb and thumb not in thumbnails:
            thumbnails.append(thumb)
    media_urls = _all_meta_urls(page, META_VIDEO_KEYS | META_AUDIO_KEYS, url)
    if jsonld.get("media_url"):
        media_url = _absolute(str(jsonld["media_url"]), url)
        if media_url and media_url not in media_urls:
            media_urls.append(media_url)

    if not any([title, description, thumbnails, media_urls]):
        return None

    parsed = urllib.parse.urlparse(url)
    webpage_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", parsed.query, ""))
    extractor = parsed.netloc.removeprefix("www.")

    return {
        "id": None,
        "title": title or description or webpage_url,
        "description": description,
        "duration": None,
        "extractor": extractor,
        "filesize": None,
        "filesize_approx": None,
        "provider": provider,
        "thumbnail": thumbnails[0] if thumbnails else None,
        "thumbnails": thumbnails,
        "upload_date": None,
        "uploader": oembed.get("uploader"),
        "webpage_url": webpage_url,
        "provisional": True,
    }
