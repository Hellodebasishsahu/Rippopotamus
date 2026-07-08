from __future__ import annotations

import json
import os
import re
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
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/best",
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
        "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/best",
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
    "drive-file": {
        "provider": "google-drive",
        "label": "Drive",
        "detail": "Google Drive file",
        "folder": "Files",
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
    "google-drive": {"id": "google-drive", "label": "Drive", "defaultPreset": "drive-file", "supportsBrowserAccess": True},
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
    aria2c_path: str | None = None
    aria2_max_connections: int = 8
    aria2_download_limit: str | None = None


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


def gallery_dl_run(context: ProviderContext | None = None) -> list[str]:
    return gallery_dl_base()


def aria2c_base() -> list[str]:
    configured = os.environ.get("RIPPO_ARIA2C_PATH", "").strip()
    if configured:
        path = Path(configured).expanduser()
        if path.exists() and path.is_file() and os.access(path, os.X_OK):
            return [str(path)]
        raise SystemExit("Configured aria2c is not executable.")

    executable = shutil.which("aria2c")
    if executable:
        return [executable]
    raise SystemExit("Missing aria2c. Install aria2c or place aria2c on PATH.")


def aria2_max_connections(context: ProviderContext | None = None) -> int:
    raw = context.aria2_max_connections if context else os.environ.get("RIPPO_ARIA2_MAX_CONNECTIONS", "8")
    try:
        value = int(raw or 8)
    except (TypeError, ValueError):
        value = 8
    return max(1, min(16, value))


def aria2_download_limit(context: ProviderContext | None = None) -> str | None:
    raw = (context.aria2_download_limit if context else os.environ.get("RIPPO_ARIA2_DOWNLOAD_LIMIT", "")) or ""
    value = str(raw).strip().upper()
    if not value:
        return None
    return value if re.match(r"^\d+(?:K|M)?$", value) else None


def aria2_transfer_args(context: ProviderContext | None = None) -> list[str]:
    connections = aria2_max_connections(context)
    args = [
        "-x",
        str(connections),
        "-s",
        str(connections),
        "-k",
        "1M",
        "--continue=true",
        "--max-tries=5",
        "--retry-wait=3",
    ]
    limit = aria2_download_limit(context)
    if limit:
        args.append(f"--max-download-limit={limit}")
    return args


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


# Some networks (DPI/ISP interference on certain domains) reset ~1/3 of
# connections mid-handshake (curl error 35). These retries cover both the
# extraction webpage fetch and the file download so a single reset no longer
# fails the whole job.
YT_DLP_RETRY_ARGS = [
    "--socket-timeout", "15",
    "--retries", "5",
    "--extractor-retries", "5",
    "--retry-sleep", "3",
]


def yt_dlp_run(context: ProviderContext | None = None) -> list[str]:
    command = [*yt_dlp_base(context), "--ignore-config", *YT_DLP_RETRY_ARGS]
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
        return [*gallery_dl_run(context), "--dump-json", url]
    if provider == "google-drive":
        return []
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
            *aria2_transfer_args(context),
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
        return [*gallery_dl_run(context), "--dest", str(output_dir), "--write-metadata", url]

    if output_template is None:
        raise SystemExit("yt-dlp downloads need an output template.")
    command = [*yt_dlp_run(context), "--no-playlist", "-o", output_template]
    if context and context.ffmpeg_path:
        command += ["--ffmpeg-location", str(Path(context.ffmpeg_path).parent)]
        if "--skip-download" not in spec["extra"]:
            command += ["--downloader", "m3u8:ffmpeg", "--hls-use-mpegts"]
    use_aria2 = bool(context and context.aria2c_path) and "--skip-download" not in spec["extra"]
    if use_aria2:
        command += [
            "--downloader",
            f"http,https:{context.aria2c_path}",
            "--downloader-args",
            f"aria2c:{' '.join(aria2_transfer_args(context))}",
        ]
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


def numeric_size(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float) and value > 0:
        return int(value)
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        return parsed if parsed > 0 else None
    return None


def format_size_fields(raw: dict[str, Any]) -> tuple[int | None, int | None]:
    exact = numeric_size(raw.get("filesize") or raw.get("file_size") or raw.get("size"))
    approx = numeric_size(raw.get("filesize_approx") or raw.get("size_approx"))
    if exact:
        return exact, approx

    requested = raw.get("requested_formats")
    if isinstance(requested, list) and requested:
        exact_parts = [
            numeric_size(item.get("filesize"))
            for item in requested
            if isinstance(item, dict)
        ]
        approx_parts = [
            numeric_size(item.get("filesize") or item.get("filesize_approx"))
            for item in requested
            if isinstance(item, dict)
        ]
        if exact_parts and all(size is not None for size in exact_parts) and len(exact_parts) == len(requested):
            return sum(exact_parts), approx
        approx_parts = [size for size in approx_parts if size is not None]
        if approx_parts:
            return None, sum(approx_parts)

    formats = raw.get("formats")
    if isinstance(formats, list):
        sizes = [
            numeric_size(item.get("filesize") or item.get("filesize_approx"))
            for item in formats
            if isinstance(item, dict)
        ]
        sizes = [size for size in sizes if size]
        if sizes:
            return None, max(sizes)

    return None, approx


def metadata_from_media_raw(raw: dict[str, Any], url: str, provider: str = "yt-dlp") -> dict[str, Any]:
    thumbnails = thumbnail_candidates(raw)
    uploader = raw.get("uploader") or raw.get("username") or raw.get("author") or raw.get("artist")
    if isinstance(uploader, dict):
        uploader = uploader.get("artistName") or uploader.get("name") or uploader.get("username")
    filesize, filesize_approx = format_size_fields(raw)
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
        "filesize": filesize,
        "filesize_approx": filesize_approx,
    }


def parse_metadata_output(provider: str, url: str, output: str) -> dict[str, Any]:
    if provider == "yt-dlp":
        return metadata_from_media_raw(json.loads(output), url, provider)
    if provider == "gallery-dl":
        return metadata_from_media_raw(first_json_metadata(output), url, provider)
    if provider == "google-drive":
        return metadata_from_media_raw(json.loads(output), url, provider)
    if provider == "torrent":
        return metadata_from_media_raw({"title": torrent_title(url), "extractor": "Torrent", "webpage_url": url}, url, provider)
    raise SystemExit(f"Unknown provider `{provider}`.")


# When an ISP/network blocks a domain (e.g. India DoT block via Airtel), the
# request is either reset (curl 35) or served a tiny block-page stub. This is
# the canonical, actionable message; the UI keys off it to point at the VPN.
NETWORK_BLOCKED_MESSAGE = "Your network is blocking this site. Turn on a VPN (Settings → Network access) and try again."

_NETWORK_BLOCK_PATTERNS = (
    "recv failure: connection reset by peer",
    "connection reset by peer",
    "curl: (35)",
    "airtel.in/dot",
    "/dot/",
    "department of telecommunications",
    "blocked as per",
)


def looks_network_blocked(text: str) -> bool:
    lower = (text or "").lower()
    return any(pattern in lower for pattern in _NETWORK_BLOCK_PATTERNS)


def friendly_error(message: str) -> str:
    lower = message.lower()
    if looks_network_blocked(message):
        return NETWORK_BLOCKED_MESSAGE
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
    if "aria2c" in lower:
        return "Torrent support needs aria2c installed."
    if "timed out" in lower:
        return "request timed out"
    return message.splitlines()[-1][:240] if message else "unknown error"
