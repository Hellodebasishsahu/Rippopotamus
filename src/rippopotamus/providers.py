from __future__ import annotations

import json
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PRESETS: dict[str, dict[str, Any]] = {
    "mp4-best": {
        "provider": "yt-dlp",
        "label": "MP4",
        "detail": "Best MP4",
        "folder": "Source",
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]",
        "extra": ["--merge-output-format", "mp4"],
        "extension": "mp4",
    },
    "audio-mp3": {
        "provider": "yt-dlp",
        "label": "MP3",
        "detail": "Audio only",
        "folder": "Audio",
        "format": "bestaudio/best",
        "extra": ["--extract-audio", "--audio-format", "mp3"],
        "extension": "mp3",
    },
    "thumbnail": {
        "provider": "yt-dlp",
        "label": "Thumb",
        "detail": "JPG cover",
        "folder": "Thumbnails",
        "format": None,
        "extra": ["--skip-download", "--write-thumbnail", "--convert-thumbnails", "jpg"],
        "extension": "jpg",
    },
    "proxy": {
        "provider": "yt-dlp",
        "label": "Proxy",
        "detail": "720p MP4",
        "folder": "Source",
        "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]",
        "extra": ["--merge-output-format", "mp4"],
        "extension": "mp4",
    },
    "gallery": {
        "provider": "gallery-dl",
        "label": "Images",
        "detail": "Image gallery",
        "folder": "Images",
        "format": None,
        "extra": [],
        "extension": None,
    },
    "torrent": {
        "provider": "torrent",
        "label": "Torrent",
        "detail": "Magnet or torrent file",
        "folder": "Files",
        "format": None,
        "extra": [],
        "extension": None,
    },
}

PROVIDER_CATALOG: dict[str, dict[str, Any]] = {
    "yt-dlp": {"id": "yt-dlp", "label": "Video", "defaultPreset": "mp4-best", "supportsBrowserAccess": True},
    "gallery-dl": {"id": "gallery-dl", "label": "Images", "defaultPreset": "gallery", "supportsBrowserAccess": False},
    "torrent": {"id": "torrent", "label": "Torrent", "defaultPreset": "torrent", "supportsBrowserAccess": False},
}

PROVIDERS = set(PROVIDER_CATALOG)
DEFAULT_PROVIDER = next(iter(PROVIDER_CATALOG))
DEFAULT_PRESET = PROVIDER_CATALOG[DEFAULT_PROVIDER]["defaultPreset"]


@dataclass(frozen=True)
class ProviderContext:
    yt_dlp_base: tuple[str, ...] | None = None
    cookies_browser: str | None = None
    ffmpeg_path: str | None = None


def provider_catalog() -> dict[str, list[dict[str, Any]]]:
    return {
        "providers": [dict(provider) for provider in PROVIDER_CATALOG.values()],
        "presets": [
            {
                "id": preset_id,
                "label": spec["label"],
                "detail": spec["detail"],
                "provider": spec["provider"],
            }
            for preset_id, spec in PRESETS.items()
        ],
    }


def gallery_dl_base() -> list[str]:
    try:
        import gallery_dl  # noqa: F401

        return [sys.executable, "-m", "gallery_dl"]
    except Exception:
        executable = shutil.which("gallery-dl")
        if executable:
            return [executable]
        raise SystemExit("Missing gallery-dl. Install the Python package or place gallery-dl on PATH.")


def aria2c_base() -> list[str]:
    executable = shutil.which("aria2c")
    if executable:
        return [executable]
    raise SystemExit("Missing aria2c. Install aria2c or place aria2c on PATH.")


def qbittorrent_nox_base() -> list[str]:
    configured = os.environ.get("RIPPO_QBITTORRENT_PATH", "").strip()
    if configured:
        path = Path(configured).expanduser()
        if path.exists() and path.is_file() and os.access(path, os.X_OK):
            return [str(path)]
        raise SystemExit("Configured qBittorrent is not executable.")

    for candidate in ["qbittorrent-nox", "qbittorrent-nox-static"]:
        executable = shutil.which(candidate)
        if executable:
            return [executable]
    raise SystemExit("Missing qBittorrent-nox. Install qBittorrent-nox or place it on PATH.")


def torrent_title(url: str) -> str:
    if url.startswith("magnet:"):
        from urllib.parse import parse_qs, unquote, urlsplit

        params = parse_qs(urlsplit(url).query)
        dn = params.get("dn", [""])[0]
        return unquote(dn).strip() or "Magnet download"
    try:
        from urllib.parse import unquote, urlsplit

        name = Path(unquote(urlsplit(url).path)).name
        return name or "Torrent download"
    except Exception:
        return "Torrent download"


def yt_dlp_base(context: ProviderContext | None = None) -> list[str]:
    if context and context.yt_dlp_base:
        return list(context.yt_dlp_base)

    try:
        import yt_dlp  # noqa: F401

        return [sys.executable, "-m", "yt_dlp"]
    except Exception:
        executable = shutil.which("yt-dlp")
        if executable:
            return [executable]
        raise SystemExit("Missing yt-dlp. Install the Python package or place yt-dlp on PATH.")


def yt_dlp_run(context: ProviderContext | None = None) -> list[str]:
    command = [*yt_dlp_base(context), "--ignore-config"]
    if context and context.cookies_browser:
        command += ["--cookies-from-browser", context.cookies_browser]
    return command


def yt_dlp_cookie_check_command(base: list[str], browser: str) -> list[str]:
    return [
        *base,
        "--ignore-config",
        "--cookies-from-browser",
        browser,
        "--simulate",
        "--skip-download",
        "--no-playlist",
        "--ignore-no-formats-error",
        "https://example.com/",
    ]


def metadata_command(provider: str, url: str, context: ProviderContext | None = None) -> list[str]:
    if provider == "yt-dlp":
        return [*yt_dlp_run(context), "--dump-single-json", "--skip-download", "--no-playlist", "--ignore-no-formats-error", url]
    if provider == "gallery-dl":
        return [*gallery_dl_base(), "--dump-json", url]
    if provider == "torrent":
        return []
    raise SystemExit(f"Unknown provider `{provider}`.")


def download_command(
    url: str,
    preset: str,
    *,
    output_template: str | None = None,
    output_dir: str | Path | None = None,
    context: ProviderContext | None = None,
) -> list[str]:
    if preset not in PRESETS:
        raise SystemExit(f"Unknown preset `{preset}`.")

    spec = PRESETS[preset]
    if spec["provider"] == "torrent":
        if output_dir is None:
            raise SystemExit("Torrent downloads need an output directory.")
        aria_state_dir = Path(output_dir).parent / ".aria2"
        aria_state_dir.mkdir(parents=True, exist_ok=True)
        return [
            *aria2c_base(),
            "--dir",
            str(output_dir),
            "--follow-torrent=mem",
            "--seed-time=0",
            "--dht-file-path",
            str(aria_state_dir / "dht.dat"),
            "--dht-file-path6",
            str(aria_state_dir / "dht6.dat"),
            "--max-tries=3",
            "--retry-wait=3",
            "--summary-interval=1",
            "--console-log-level=notice",
            "--enable-color=false",
            url,
        ]
    if spec["provider"] == "gallery-dl":
        if output_dir is None:
            raise SystemExit("Gallery downloads need an output directory.")
        return [*gallery_dl_base(), "--dest", str(output_dir), "--write-metadata", url]

    if output_template is None:
        raise SystemExit("yt-dlp downloads need an output template.")
    command = [*yt_dlp_run(context), "--no-playlist", "-o", output_template]
    if context and context.ffmpeg_path:
        command += ["--ffmpeg-location", str(Path(context.ffmpeg_path).parent)]
    if spec["format"]:
        command += ["-f", spec["format"]]
    command += spec["extra"]
    command.append(url)
    return command


def desktop_download_command(
    url: str,
    preset: str,
    *,
    output_template: str | None = None,
    output_dir: str | Path | None = None,
    context: ProviderContext | None = None,
) -> list[str]:
    command = download_command(url, preset, output_template=output_template, output_dir=output_dir, context=context)
    if PRESETS[preset]["provider"] == "yt-dlp":
        base_length = len(yt_dlp_run(context))
        return [*command[:base_length], "--newline", *command[base_length:]]
    return command


def thumbnail_candidates(raw: dict[str, Any]) -> list[str]:
    candidates: list[tuple[int, str]] = []

    primary = raw.get("thumbnail")
    if isinstance(primary, str) and primary.strip():
        candidates.append((10_000_000, primary.strip()))

    for item in raw.get("thumbnails") or []:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if not isinstance(url, str) or not url.strip():
            continue

        width = item.get("width")
        height = item.get("height")
        preference = item.get("preference")
        area = width * height if isinstance(width, int) and isinstance(height, int) else 0
        score = area + (preference * 1_000 if isinstance(preference, int) else 0)
        candidates.append((score, url.strip()))

    ordered: list[str] = []
    seen: set[str] = set()
    for _score, url in sorted(candidates, key=lambda entry: entry[0], reverse=True):
        if url in seen:
            continue
        seen.add(url)
        ordered.append(url)
    return ordered


def gallery_metadata_from_payload(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        if "error" in payload and "message" in payload:
            return None
        return payload

    if isinstance(payload, list):
        if len(payload) >= 3 and payload[0] == 3 and isinstance(payload[2], dict):
            metadata = dict(payload[2])
            if isinstance(payload[1], str):
                metadata.setdefault("url", payload[1])
            return metadata
        if len(payload) >= 2 and payload[0] == 2 and isinstance(payload[1], dict):
            return payload[1]
        preferred: dict[str, Any] | None = None
        for item in payload:
            metadata = gallery_metadata_from_payload(item)
            if not metadata:
                continue
            if isinstance(item, list) and item and item[0] == 3:
                return metadata
            preferred = preferred or metadata
        return preferred
    return None


def first_json_metadata(output: str) -> dict[str, Any]:
    try:
        metadata = gallery_metadata_from_payload(json.loads(output))
        if metadata:
            return metadata
    except json.JSONDecodeError:
        pass

    for line in output.splitlines():
        line = line.strip()
        if not line or not line.startswith(("{", "[")):
            continue
        try:
            metadata = gallery_metadata_from_payload(json.loads(line))
        except json.JSONDecodeError:
            continue
        if metadata:
            return metadata
    raise SystemExit("No JSON metadata was returned.")


def metadata_from_media_raw(raw: dict[str, Any], url: str, provider: str = "yt-dlp") -> dict[str, Any]:
    thumbnails = thumbnail_candidates(raw)
    uploader = raw.get("uploader") or raw.get("username") or raw.get("author") or raw.get("artist")
    if isinstance(uploader, dict):
        uploader = uploader.get("artistName") or uploader.get("name") or uploader.get("username")
    return {
        "id": raw.get("id") or raw.get("post_id") or raw.get("filename"),
        "title": raw.get("title") or raw.get("filename") or raw.get("id"),
        "extractor": raw.get("extractor_key") or raw.get("extractor") or raw.get("category") or provider,
        "webpage_url": raw.get("webpage_url") or raw.get("source") or raw.get("url") or url,
        "duration": raw.get("duration"),
        "uploader": uploader,
        "upload_date": raw.get("upload_date"),
        "thumbnail": thumbnails[0] if thumbnails else raw.get("thumbnail") or raw.get("thumb") or raw.get("preview") or raw.get("image"),
        "thumbnails": thumbnails,
        "description": raw.get("description"),
        "provider": provider,
    }


def parse_metadata_output(provider: str, url: str, output: str) -> dict[str, Any]:
    if provider == "yt-dlp":
        return metadata_from_media_raw(json.loads(output), url, provider)
    if provider == "gallery-dl":
        return metadata_from_media_raw(first_json_metadata(output), url, provider)
    if provider == "torrent":
        return metadata_from_media_raw({"title": torrent_title(url), "extractor": "Torrent", "webpage_url": url}, url, provider)
    raise SystemExit(f"Unknown provider `{provider}`.")


def friendly_error(message: str) -> str:
    lower = message.lower()
    if "Unsupported URL" in message:
        return "unsupported URL"
    if "Video unavailable" in message:
        return "video is unavailable or private"
    if "Private video" in message:
        return "private video"
    if "HTTP Error 403" in message:
        return "access denied by the platform"
    if "HTTP Error 404" in message:
        return "media not found"
    if "Requested format is not available" in message:
        return "selected format is not available for this link"
    if "status=500" in lower or "response status is not successful" in lower:
        return "The source is having trouble right now. Try again later or use another link."
    if "download aborted" in lower:
        return "The download stopped before it finished. Try again later or use another link."
    if "dht routing table" in lower:
        return "The download needs a retry before it can start."
    if "qbittorrent" in lower:
        return "Torrent support needs qBittorrent-nox or aria2c installed."
    if "aria2c" in lower:
        return "Torrent support needs qBittorrent-nox or aria2c installed."
    if "timed out" in lower:
        return "request timed out"
    return message.splitlines()[-1][:240] if message else "unknown error"
