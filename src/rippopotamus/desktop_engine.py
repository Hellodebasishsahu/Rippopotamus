from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
import base64
from pathlib import Path
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import parse, request

from rippopotamus.cli import slugify
from rippopotamus.providers import (
    DEFAULT_PROVIDER,
    PRESETS,
    PROVIDERS,
    ProviderContext,
    aria2c_base,
    desktop_download_command,
    friendly_error,
    gallery_dl_base,
    metadata_command,
    parse_metadata_output,
    provider_catalog,
    qbittorrent_nox_base,
    yt_dlp_cookie_check_command,
    yt_dlp_run as provider_yt_dlp_run,
)
from rippopotamus.query_intelligence import PACK_LABELS, build_query_intelligence, effective_pack, openrouter_model_catalog
from rippopotamus.metadata_lookup import lookup_media
from rippopotamus.resolvers import ADAPTERS, resolve_all
from rippopotamus.search_evidence import search_evidence_status
from rippopotamus.source_registry import search_sources
from rippopotamus.footage_index import import_semantic_script_index, index_status, ingest_paths, search_index, upsert_moments
from rippopotamus.index_worker import SemanticIngestOptions, semantic_ingest_paths


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


def configured_yt_dlp_path() -> str | None:
    configured = os.environ.get("RIPPO_YTDLP_PATH")
    if not configured:
        return None

    path = Path(configured).expanduser()
    if not path.exists():
        return None
    if not path.is_file() or not os.access(path, os.X_OK):
        raise SystemExit(f"Configured yt-dlp is not executable: {path}")
    return str(path)


def is_torrent_input(url: str) -> bool:
    lower = url.lower()
    return lower.startswith("magnet:") or lower.split("?", 1)[0].endswith(".torrent")


def cookies_browser_args() -> list[str]:
    value = os.environ.get("RIPPO_COOKIES_FROM_BROWSER", "").strip()
    if not value:
        return []
    return ["--cookies-from-browser", value]


def cookie_error_message(message: str) -> str:
    lower = message.lower()
    if "requested format is not available" in lower:
        return "Selected format is not available for this link."
    if "cookies" not in lower and "cookie" not in lower:
        return friendly_error(message)
    if "locked" in lower or "database is locked" in lower:
        return "Browser cookies are locked. Close the browser and retry."
    if "permission" in lower or "operation not permitted" in lower or "access is denied" in lower:
        return "Browser cookies are not readable. Grant access or choose another browser."
    if "could not find" in lower or "not found" in lower or "no such file" in lower:
        return "Browser cookies are unavailable. Open the browser once, then retry."
    if "decrypt" in lower or "keychain" in lower:
        return "Browser cookies could not be decrypted. Unlock the browser profile or keychain and retry."
    return "Browser cookies are unavailable. Choose another browser or turn cookies off."


def verify_cookies_browser(base: list[str], browser: str | None = None) -> dict[str, Any]:
    browser = (browser or "").strip()
    if not browser:
        return {"status": "off", "browser": None, "ok": None, "message": None}

    command = yt_dlp_cookie_check_command(base, browser)
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        return {"status": "error", "browser": browser, "ok": False, "message": "Browser cookie check timed out."}
    except Exception as exc:
        return {"status": "error", "browser": browser, "ok": False, "message": cookie_error_message(str(exc))}

    output = "\n".join(part for part in [result.stdout, result.stderr] if part)
    if re.search(r"Extracted\s+\d+\s+cookies?\s+from", output, flags=re.IGNORECASE):
        return {"status": "ok", "browser": browser, "ok": True, "message": "Browser cookies are readable."}
    if "Extracting cookies from" in output and result.returncode == 0:
        return {"status": "ok", "browser": browser, "ok": True, "message": "Browser cookies are readable."}

    detail = next((line for line in output.splitlines() if "cookie" in line.lower()), output)
    return {"status": "error", "browser": browser, "ok": False, "message": cookie_error_message(detail)}


def yt_dlp_base() -> list[str]:
    configured = configured_yt_dlp_path()
    if configured:
        return [configured]

    try:
        import yt_dlp  # noqa: F401

        return [sys.executable, "-m", "yt_dlp"]
    except Exception:
        executable = shutil.which("yt-dlp")
        if executable:
            return [executable]
        raise SystemExit("Missing yt-dlp. Install the Python package or place yt-dlp on PATH.")


def yt_dlp_run() -> list[str]:
    return provider_yt_dlp_run(provider_context())


def ffmpeg_path() -> str | None:
    configured = os.environ.get("RIPPO_FFMPEG_PATH") or os.environ.get("RIPPO_FFMPEG_LOCATION")
    if configured:
        return configured
    return shutil.which("ffmpeg")


def provider_context(cookies_browser: str | None = None) -> ProviderContext:
    return ProviderContext(
        yt_dlp_base=tuple(yt_dlp_base()),
        cookies_browser=(cookies_browser or "").strip() or None,
        ffmpeg_path=ffmpeg_path(),
    )


def arg_cookies_browser(args: argparse.Namespace) -> str | None:
    return (getattr(args, "cookies_browser", "") or "").strip() or None


def gallery_dl_status() -> dict[str, Any]:
    try:
        base = gallery_dl_base()
    except SystemExit as exc:
        return {
            "ok": False,
            "version": None,
            "path": None,
            "error": friendly_error(str(exc)),
        }

    managed_root = os.environ.get("RIPPO_GALLERYDL_ROOT", "").strip() or None
    path = base[0] if len(base) == 1 else managed_root
    try:
        result = subprocess.run([*base, "--version"], capture_output=True, text=True, check=True)
        return {
            "ok": True,
            "version": result.stdout.strip() or "installed",
            "path": path,
            "error": None,
        }
    except Exception as exc:
        return {
            "ok": False,
            "version": None,
            "path": path,
            "error": friendly_error(str(exc)),
        }


def aria2c_status() -> dict[str, Any]:
    try:
        base = aria2c_base()
    except SystemExit as exc:
        return {"ok": False, "version": None, "path": None, "error": friendly_error(str(exc))}

    try:
        result = subprocess.run([*base, "--version"], capture_output=True, text=True, check=True)
        first = result.stdout.splitlines()[0] if result.stdout else "aria2c"
        version_match = re.search(r"aria2 version\s+([^\s]+)", first)
        return {"ok": True, "version": version_match.group(1) if version_match else first, "path": base[0], "error": None}
    except Exception as exc:
        return {"ok": False, "version": None, "path": base[0], "error": friendly_error(str(exc))}


def qbittorrent_status() -> dict[str, Any]:
    try:
        base = qbittorrent_nox_base()
    except SystemExit as exc:
        return {"ok": False, "version": None, "path": None, "error": friendly_error(str(exc))}

    try:
        result = subprocess.run([*base, "--version"], capture_output=True, text=True, check=True)
        first = result.stdout.splitlines()[0] if result.stdout else "qBittorrent"
        version_match = re.search(r"qBittorrent\s+v?([^\s]+)", first)
        return {"ok": True, "version": version_match.group(1) if version_match else first, "path": base[0], "error": None}
    except Exception as exc:
        return {"ok": False, "version": None, "path": base[0], "error": friendly_error(str(exc))}


def torrent_engine_status() -> dict[str, Any]:
    qbit = qbittorrent_status()
    aria = aria2c_status()
    if qbit["ok"]:
        return {"ok": True, "engine": "qbittorrent", "error": None, "qbittorrent": qbit, "aria2c": aria}
    if aria["ok"]:
        return {"ok": True, "engine": "aria2c", "error": None, "qbittorrent": qbit, "aria2c": aria}
    return {"ok": False, "engine": None, "error": qbit["error"] or aria["error"], "qbittorrent": qbit, "aria2c": aria}


def run_text(args: list[str]) -> str:
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=True)
    except FileNotFoundError as exc:
        raise SystemExit(f"Missing required command: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or str(exc)).strip()
        raise SystemExit(cookie_error_message(message)) from exc
    return result.stdout


def run_json(args: list[str]) -> dict[str, Any]:
    return json.loads(run_text(args))


def command_health(args: argparse.Namespace) -> int:
    base = yt_dlp_base()
    cookies_browser = arg_cookies_browser(args)
    ffmpeg = ffmpeg_path()
    yt_dlp_version = "unknown"
    try:
        result = subprocess.run([*base, "--version"], capture_output=True, text=True, check=True)
        yt_dlp_version = result.stdout.strip()
    except Exception as exc:
        emit({"ok": False, "error": friendly_error(str(exc))})
        return 1

    ffmpeg_ok = False
    ffmpeg_version = None
    if ffmpeg:
        try:
            result = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True, check=True)
            ffmpeg_ok = True
            ffmpeg_version = result.stdout.splitlines()[0] if result.stdout else "ffmpeg"
        except Exception:
            ffmpeg_ok = False

    catalog = provider_catalog()
    gallery = gallery_dl_status()
    torrent = torrent_engine_status()
    qbit = torrent["qbittorrent"]
    aria = torrent["aria2c"]
    emit({
        "ok": True,
        "python": sys.executable,
        "ytDlp": yt_dlp_version,
        "ytDlpPath": base[0] if len(base) == 1 else None,
        "galleryDl": gallery["version"],
        "galleryDlPath": gallery["path"],
        "galleryDlOk": gallery["ok"],
        "galleryDlError": gallery["error"],
        "qBittorrent": qbit["version"],
        "qBittorrentPath": qbit["path"],
        "qBittorrentOk": qbit["ok"],
        "qBittorrentError": qbit["error"],
        "aria2c": aria["version"],
        "aria2cPath": aria["path"],
        "aria2cOk": aria["ok"],
        "aria2cError": aria["error"],
        "torrentEngine": torrent["engine"],
        "torrentOk": torrent["ok"],
        "torrentError": torrent["error"],
        "ffmpeg": ffmpeg,
        "ffmpegOk": ffmpeg_ok,
        "ffmpegVersion": ffmpeg_version,
        "cookiesBrowser": cookies_browser,
        "cookies": verify_cookies_browser(base, cookies_browser),
        "providers": catalog["providers"],
        "presets": catalog["presets"],
        "searchEvidence": search_evidence_status(),
    })
    return 0


def command_fetch(args: argparse.Namespace) -> int:
    provider = args.provider
    cookies_browser = arg_cookies_browser(args)
    if provider == "auto":
        if is_torrent_input(args.url):
            provider = "torrent"
            output = ""
        else:
            try:
                output = run_text(metadata_command("yt-dlp", args.url, provider_context(cookies_browser)))
                provider = "yt-dlp"
            except SystemExit as exc:
                if friendly_error(str(exc)) != "unsupported URL":
                    raise
                output = run_text(metadata_command("gallery-dl", args.url, provider_context(cookies_browser)))
                provider = "gallery-dl"
    elif provider == "torrent":
        output = ""
    else:
        output = run_text(metadata_command(provider, args.url, provider_context(cookies_browser)))
    metadata = parse_metadata_output(provider, args.url, output)
    emit({"ok": True, "url": args.url, "metadata": metadata})
    return 0


def command_source_search(args: argparse.Namespace) -> int:
    requested_pack = args.pack or "all"
    if requested_pack != "all" and requested_pack not in PACK_LABELS:
        raise SystemExit(f"Unknown source pack `{requested_pack}`.")
    intelligence = build_query_intelligence(args.query or "", requested_pack)
    search_pack = effective_pack(requested_pack, intelligence)
    try:
        payload = search_sources(args.query or "", search_pack, args.limit)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    payload["requestedPack"] = requested_pack
    payload["intelligence"] = intelligence
    media = lookup_media(args.query or "")
    payload["media"] = media
    payload["playable"] = _resolve_playable(media, args.query or "")
    emit(payload)
    return 0


def _resolve_playable(media: dict[str, Any] | None, query: str) -> list[dict[str, Any]]:
    if media:
        title = media.get("title") or query
        year_raw = media.get("year")
        year = int(year_raw) if isinstance(year_raw, str) and year_raw.isdigit() else None
        imdb_id = media.get("imdbId")
    else:
        title = query
        year = None
        imdb_id = None
    links = resolve_all(ADAPTERS, title, year, imdb_id)
    return [link.to_dict() for link in links]


def command_ai_models(args: argparse.Namespace) -> int:
    emit(openrouter_model_catalog(refresh=args.refresh, selected_model=args.selected_model))
    return 0


def command_index_status(args: argparse.Namespace) -> int:
    emit(index_status(args.index_root))
    return 0


def command_index_ingest(args: argparse.Namespace) -> int:
    emit(ingest_paths(args.index_root, args.paths))
    return 0


def command_index_semantic_ingest(args: argparse.Namespace) -> int:
    options = SemanticIngestOptions(
        chunk_duration=args.chunk_duration,
        overlap=args.overlap,
        preprocess=not args.no_preprocess,
        target_resolution=args.target_resolution,
        target_fps=args.target_fps,
        skip_still=not args.no_skip_still,
    )
    emit(semantic_ingest_paths(args.index_root, args.paths, options=options))
    return 0


def command_index_import_semantic_script(args: argparse.Namespace) -> int:
    emit(import_semantic_script_index(args.index_root, args.semantic_db))
    return 0


def command_index_search(args: argparse.Namespace) -> int:
    emit(search_index(args.index_root, args.query or "", args.limit))
    return 0


def command_index_upsert(args: argparse.Namespace) -> int:
    if args.payload_json:
        payload = json.loads(args.payload_json)
    elif args.input == "-":
        payload = json.load(sys.stdin)
    else:
        with Path(args.input).expanduser().open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    if not isinstance(payload, dict):
        raise SystemExit("Index upsert payload must be a JSON object.")
    emit(upsert_moments(args.index_root, payload))
    return 0


def parse_aria2_progress(line: str) -> dict[str, Any] | None:
    percent_match = re.search(r"\((\d+)%\)", line)
    if not percent_match:
        return None
    speed_match = re.search(r"DL:([^\s\]]+)", line)
    eta_match = re.search(r"ETA:([^\s\]]+)", line)
    return {
        "percent": float(percent_match.group(1)),
        "speed": speed_match.group(1) if speed_match else None,
        "eta": eta_match.group(1) if eta_match else None,
    }


def snapshot_files(root: Path) -> set[Path]:
    return {path for path in root.rglob("*") if path.is_file() and not any(part.startswith(".") for part in path.relative_to(root).parts)}


@dataclass
class QBitSession:
    base_url: str
    cookie: str | None = None


class QBitUnavailable(RuntimeError):
    pass


def qbt_profile_root() -> Path:
    configured = os.environ.get("RIPPO_QBITTORRENT_PROFILE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".cache" / "rippopotamus" / "qbittorrent"


def qbt_webui_port() -> int:
    raw = os.environ.get("RIPPO_QBITTORRENT_WEBUI_PORT", "").strip()
    if not raw:
        return 39080
    try:
        port = int(raw)
    except ValueError as exc:
        raise QBitUnavailable("Torrent support has an invalid local port setting.") from exc
    if port < 1024 or port > 65535:
        raise QBitUnavailable("Torrent support has an invalid local port setting.")
    return port


def qbt_config_dir(profile: Path) -> Path:
    return profile / "qBittorrent_rippo" / "config"


def write_qbt_config(profile: Path, port: int, output_root: Path) -> None:
    save_path = (output_root / "Files").resolve()
    temp_path = (profile / "incomplete").resolve()
    config_path = qbt_config_dir(profile) / "qBittorrent.conf"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        "\n".join([
            "[LegalNotice]",
            "Accepted=true",
            "",
            "[Preferences]",
            "Bittorrent\\DHT=true",
            "Bittorrent\\LSD=true",
            "Bittorrent\\PeX=true",
            "Downloads\\SavePath=" + str(save_path),
            "Downloads\\TempPath=" + str(temp_path),
            "Downloads\\TempPathEnabled=true",
            "Queueing\\QueueingEnabled=false",
            "WebUI\\Address=127.0.0.1",
            "WebUI\\AuthSubnetWhitelist=127.0.0.1",
            "WebUI\\AuthSubnetWhitelistEnabled=true",
            "WebUI\\Enabled=true",
            "WebUI\\LocalHostAuth=false",
            "WebUI\\Port=" + str(port),
            "",
        ]),
        encoding="utf-8",
    )


def qbt_request(
    session: QBitSession,
    path: str,
    *,
    data: bytes | None = None,
    content_type: str | None = None,
    timeout: float = 8,
) -> tuple[int, str, dict[str, str]]:
    headers = {
        "Accept": "*/*",
        "Origin": session.base_url,
        "Referer": f"{session.base_url}/",
        "User-Agent": "Rippopotamus",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if session.cookie:
        headers["Cookie"] = session.cookie
    req = request.Request(f"{session.base_url}{path}", data=data, headers=headers, method="POST" if data is not None else "GET")
    with request.urlopen(req, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8", errors="replace"), dict(response.headers)


def qbt_login(session: QBitSession) -> bool:
    payload = parse.urlencode({"username": "admin", "password": "adminadmin"}).encode("utf-8")
    try:
        _status, body, headers = qbt_request(
            session,
            "/api/v2/auth/login",
            data=payload,
            content_type="application/x-www-form-urlencoded",
        )
    except Exception:
        return False
    cookie = headers.get("Set-Cookie")
    if cookie:
        session.cookie = cookie.split(";", 1)[0]
    return body.strip().lower() == "ok."


def qbt_api_ready(session: QBitSession) -> bool:
    try:
        qbt_request(session, "/api/v2/app/version", timeout=2)
        return True
    except urlerror.HTTPError as exc:
        if exc.code in {401, 403} and qbt_login(session):
            try:
                qbt_request(session, "/api/v2/app/version", timeout=2)
                return True
            except Exception:
                return False
        return False
    except Exception:
        return False


def ensure_qbt_daemon(output_root: Path) -> QBitSession:
    profile = qbt_profile_root()
    port = qbt_webui_port()
    session = QBitSession(f"http://127.0.0.1:{port}")
    if qbt_api_ready(session):
        return session

    write_qbt_config(profile, port, output_root)
    try:
        subprocess.Popen(
            [
                *qbittorrent_nox_base(),
                "--daemon",
                f"--webui-port={port}",
                f"--profile={profile}",
                "--configuration=rippo",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:
        raise QBitUnavailable("Torrent support could not start.") from exc

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if qbt_api_ready(session):
            return session
        time.sleep(0.5)
    raise QBitUnavailable("Torrent support did not start in time.")


def qbt_json(session: QBitSession, path: str) -> Any:
    _status, body, _headers = qbt_request(session, path)
    return json.loads(body or "null")


def multipart_form(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = f"----rippo-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
            str(value).encode("utf-8"),
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def qbt_post_form(session: QBitSession, path: str, fields: dict[str, str]) -> str:
    data, content_type = multipart_form(fields)
    _status, body, _headers = qbt_request(session, path, data=data, content_type=content_type)
    return body


def qbt_post_urlencoded(session: QBitSession, path: str, fields: dict[str, str]) -> str:
    data = parse.urlencode(fields).encode("utf-8")
    _status, body, _headers = qbt_request(session, path, data=data, content_type="application/x-www-form-urlencoded")
    return body


def qbt_torrents(session: QBitSession) -> list[dict[str, Any]]:
    payload = qbt_json(session, "/api/v2/torrents/info")
    return payload if isinstance(payload, list) else []


def magnet_info_hash(url: str) -> str | None:
    if not url.lower().startswith("magnet:"):
        return None
    params = parse.parse_qs(parse.urlsplit(url).query)
    for xt in params.get("xt", []):
        if not xt.lower().startswith("urn:btih:"):
            continue
        value = xt.rsplit(":", 1)[-1].strip()
        if re.fullmatch(r"[0-9a-fA-F]{40}", value):
            return value.lower()
        if re.fullmatch(r"[A-Z2-7a-z]{32}", value):
            padded = value.upper() + "=" * ((8 - len(value) % 8) % 8)
            return base64.b32decode(padded).hex()
    return None


def qbt_find_torrent(session: QBitSession, target_hash: str | None, before_hashes: set[str], item_id: str) -> dict[str, Any] | None:
    torrents = qbt_torrents(session)
    if target_hash:
        for torrent in torrents:
            if str(torrent.get("hash", "")).lower() == target_hash:
                return torrent
    for torrent in torrents:
        hash_value = str(torrent.get("hash", "")).lower()
        tags = {tag.strip() for tag in str(torrent.get("tags", "")).split(",")}
        if hash_value and hash_value not in before_hashes and (item_id in tags or "rippo" in tags):
            return torrent
    return None


def format_rate(bytes_per_second: Any) -> str | None:
    if not isinstance(bytes_per_second, (int, float)) or bytes_per_second <= 0:
        return None
    units = ["B/s", "KB/s", "MB/s", "GB/s"]
    value = float(bytes_per_second)
    unit = units[0]
    for unit in units:
        if value < 1024 or unit == units[-1]:
            break
        value /= 1024
    return f"{value:.1f}{unit}" if value < 10 and unit != "B/s" else f"{value:.0f}{unit}"


def format_eta(seconds: Any) -> str | None:
    if not isinstance(seconds, (int, float)) or seconds < 0 or seconds >= 86_400_000:
        return None
    seconds = int(seconds)
    if seconds >= 3600:
        return f"{seconds // 3600}h {(seconds % 3600) // 60}m"
    if seconds >= 60:
        return f"{seconds // 60}m {seconds % 60}s"
    return f"{seconds}s"


def parse_progress(line: str) -> dict[str, Any] | None:
    percent_match = re.search(r"\[download\]\s+([0-9.]+)%", line)
    if not percent_match:
        return None
    eta_match = re.search(r"ETA\s+([0-9:]+)", line)
    speed_match = re.search(r"at\s+([^\s]+)", line)
    return {
        "percent": float(percent_match.group(1)),
        "eta": eta_match.group(1) if eta_match else None,
        "speed": speed_match.group(1) if speed_match else None,
    }


def run_ytdlp_download_command(cmd: list[str], root: Path, before: set[Path]) -> tuple[int, str, list[str]]:
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    last_line = ""
    notices: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        last_line = line
        if line.startswith("WARNING:") or line.startswith("ERROR:"):
            notices.append(line)
            level = "error" if line.startswith("ERROR:") else "warning"
            emit({"type": "notice", "level": level, "message": line})
            continue
        dest_match = re.match(r"\[download\]\s+Destination:\s+(.+)$", line)
        if dest_match:
            dest_path = Path(dest_match.group(1))
            stem = dest_path.stem.lower()
            if ".f" in stem:
                fmt = stem.rsplit(".f", 1)[-1]
                kind = "audio" if any(c.isalpha() for c in fmt[:2]) else "video"
            else:
                kind = dest_path.suffix.lstrip(".") or "file"
            emit({"type": "phase", "kind": kind, "destination": str(dest_path)})
            continue
        progress = parse_progress(line)
        if progress:
            emit({"type": "progress", **progress})
        elif line.startswith("[ExtractAudio]") or line.startswith("[Merger]") or line.startswith("[ThumbnailsConvertor]") or line.startswith("[VideoConvertor]"):
            tag = line.split("]", 1)[0].lstrip("[")
            label = {"Merger": "Merging", "ExtractAudio": "Extracting audio", "ThumbnailsConvertor": "Converting thumbnail", "VideoConvertor": "Converting video"}.get(tag, tag)
            emit({"type": "stage", "message": label, "finalizing": True})

    code = process.wait()
    if code == 0:
        after = snapshot_files(root)
        files = sorted(str(path.relative_to(root)) for path in after - before)
        emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": [n for n in notices if n.startswith("WARNING:")]})
    return code, last_line, notices


def command_download(args: argparse.Namespace) -> int:
    if args.preset not in PRESETS:
        raise SystemExit(f"Unknown preset `{args.preset}`.")

    root = Path(args.output_root).expanduser().resolve()
    for folder in ["Source", "Audio", "Images", "Files", "Thumbnails", "Clips", "Exports"]:
        (root / folder).mkdir(parents=True, exist_ok=True)

    item_id = args.item_id or uuid.uuid4().hex[:10]
    spec = PRESETS[args.preset]
    cookies_browser = arg_cookies_browser(args)
    title = slugify(args.title or item_id)
    output_template = str(root / spec["folder"] / f"{title}--{item_id}.%(ext)s")

    if spec["provider"] == "torrent":
        if qbittorrent_status()["ok"]:
            try:
                return command_qbittorrent_download(args, root)
            except QBitUnavailable:
                pass
        cmd = desktop_download_command(
            args.url,
            args.preset,
            output_template=output_template,
            output_dir=root / spec["folder"],
            context=provider_context(cookies_browser),
        )
        return command_aria2_download(args, root, cmd)

    cmd = desktop_download_command(
        args.url,
        args.preset,
        output_template=output_template,
        output_dir=root / spec["folder"],
        context=provider_context(cookies_browser),
    )

    if spec["provider"] == "gallery-dl":
        return command_gallery_download(args, root, cmd)

    before = snapshot_files(root)
    emit({"type": "started", "url": args.url, "preset": args.preset})

    code, last_line, notices = run_ytdlp_download_command(cmd, root, before)
    detail = next((n for n in notices if n.startswith("ERROR:")), last_line)

    if code != 0:
        emit({"type": "error", "error": cookie_error_message(detail)})
        return code

    return 0


def command_qbittorrent_download(args: argparse.Namespace, root: Path) -> int:
    before = snapshot_files(root)
    item_id = args.item_id or uuid.uuid4().hex[:10]
    files_dir = root / "Files"
    files_dir.mkdir(parents=True, exist_ok=True)
    emit({"type": "started", "url": args.url, "preset": args.preset})
    emit({"type": "stage", "message": "Finding peers", "finalizing": False})

    session = ensure_qbt_daemon(root)
    before_hashes = {str(torrent.get("hash", "")).lower() for torrent in qbt_torrents(session) if torrent.get("hash")}
    target_hash = magnet_info_hash(args.url)

    try:
        add_result = qbt_post_form(
            session,
            "/api/v2/torrents/add",
            {
                "urls": args.url,
                "savepath": str(files_dir),
                "category": "Rippo",
                "tags": f"rippo,{item_id}",
                "paused": "false",
                "skip_checking": "false",
                "sequentialDownload": "false",
                "firstLastPiecePrio": "false",
                "autoTMM": "false",
            },
        )
        if add_result.strip().lower().startswith("fails"):
            raise QBitUnavailable("Torrent support could not add this link.")
    except Exception as exc:
        raise QBitUnavailable("Torrent support could not add this link.") from exc

    torrent: dict[str, Any] | None = None
    start_deadline = time.monotonic() + 45
    last_stage = "Finding peers"
    last_percent = -1
    while time.monotonic() < start_deadline:
        torrent = qbt_find_torrent(session, target_hash, before_hashes, item_id)
        if torrent:
            break
        time.sleep(1)
    if not torrent:
        emit({"type": "error", "error": "Torrent did not start. Try again or use another link."})
        return 1

    while True:
        torrent_hash = str(torrent.get("hash", "")).lower()
        latest = qbt_find_torrent(session, torrent_hash or target_hash, before_hashes, item_id)
        if latest:
            torrent = latest

        state = str(torrent.get("state", ""))
        progress = max(0.0, min(100.0, float(torrent.get("progress") or 0) * 100))
        speed = format_rate(torrent.get("dlspeed"))
        eta = format_eta(torrent.get("eta"))
        stage = "Finding peers" if state in {"metaDL", "stalledDL"} and progress < 1 else "Downloading"
        if state in {"checkingDL", "checkingUP", "checkingResumeData"}:
            stage = "Checking files"
        if progress >= 99.9:
            stage = "Saving"
        if stage != last_stage:
            last_stage = stage
            emit({"type": "stage", "message": stage, "finalizing": stage == "Saving"})
        rounded = round(progress)
        if rounded != last_percent:
            last_percent = rounded
            emit({"type": "progress", "percent": progress, "speed": speed, "eta": eta})

        if state in {"error", "missingFiles"}:
            emit({"type": "error", "error": "Torrent could not finish. Try again or use another link."})
            return 1
        if progress >= 99.9 and state in {"uploading", "stalledUP", "forcedUP", "pausedUP", "checkingUP"}:
            break
        time.sleep(1)

    torrent_hash = str(torrent.get("hash", "")).lower()
    if torrent_hash:
        try:
            qbt_post_urlencoded(session, "/api/v2/torrents/stop", {"hashes": torrent_hash})
        except Exception:
            try:
                qbt_post_urlencoded(session, "/api/v2/torrents/pause", {"hashes": torrent_hash})
            except Exception:
                pass
        try:
            qbt_post_urlencoded(session, "/api/v2/torrents/delete", {"hashes": torrent_hash, "deleteFiles": "false"})
        except Exception:
            pass

    after = snapshot_files(root)
    files = sorted(str(path.relative_to(root)) for path in after - before)
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": []})
    return 0


def command_aria2_download(args: argparse.Namespace, root: Path, cmd: list[str]) -> int:
    before = snapshot_files(root)
    emit({"type": "started", "url": args.url, "preset": args.preset})
    emit({"type": "stage", "message": "Downloading torrent", "finalizing": False})

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    last_line = ""
    notices: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        last_line = line
        lower = line.lower()
        if "dht routing table" in lower:
            continue
        if "error" in lower or "failed" in lower or "download aborted" in lower:
            notices.append(line)
            continue
        if "download complete" in lower:
            emit({"type": "stage", "message": "Downloaded file", "finalizing": False})
            continue
        progress = parse_aria2_progress(line)
        if progress:
            emit({"type": "progress", **progress})

    code = process.wait()
    if code != 0:
        detail = next((n for n in reversed(notices) if "status=500" in n.lower()), notices[-1] if notices else last_line)
        emit({"type": "error", "error": friendly_error(detail)})
        return code

    after = snapshot_files(root)
    files = sorted(str(path.relative_to(root)) for path in after - before)
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": []})
    return 0


def command_gallery_download(args: argparse.Namespace, root: Path, cmd: list[str]) -> int:
    before = snapshot_files(root)
    emit({"type": "started", "url": args.url, "preset": args.preset})
    emit({"type": "stage", "message": "Downloading images", "finalizing": False})

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    last_line = ""
    notices: list[str] = []
    saved = 0
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        last_line = line
        if line.startswith("WARNING:") or line.startswith("ERROR:"):
            notices.append(line)
            level = "error" if line.startswith("ERROR:") else "warning"
            emit({"type": "notice", "level": level, "message": line})
            continue
        saved += 1
        emit({"type": "stage", "message": f"Saved {saved} file{'s' if saved != 1 else ''}", "finalizing": False})

    code = process.wait()
    if code != 0:
        detail = next((n for n in notices if n.startswith("ERROR:")), last_line)
        emit({"type": "error", "error": friendly_error(detail)})
        return code

    after = snapshot_files(root)
    files = sorted(str(path.relative_to(root)) for path in after - before)
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": [n for n in notices if n.startswith("WARNING:")]})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rippo-engine")
    sub = parser.add_subparsers(dest="command", required=True)

    health = sub.add_parser("health")
    health.add_argument("--cookies-browser", default="")
    health.set_defaults(func=command_health)

    fetch = sub.add_parser("fetch")
    fetch.add_argument("--url", required=True)
    fetch.add_argument("--provider", choices=["auto", *sorted(PROVIDERS)], default="auto")
    fetch.add_argument("--cookies-browser", default="")
    fetch.set_defaults(func=command_fetch)

    download = sub.add_parser("download")
    download.add_argument("--url", required=True)
    download.add_argument("--preset", required=True)
    download.add_argument("--output-root", required=True)
    download.add_argument("--item-id")
    download.add_argument("--title")
    download.add_argument("--cookies-browser", default="")
    download.set_defaults(func=command_download)

    source_search = sub.add_parser("source-search")
    source_search.add_argument("--query", default="")
    source_search.add_argument("--pack", default="all")
    source_search.add_argument("--limit", type=int, default=12)
    source_search.set_defaults(func=command_source_search)

    ai_models = sub.add_parser("ai-models")
    ai_models.add_argument("--refresh", action="store_true")
    ai_models.add_argument("--selected-model", default="")
    ai_models.set_defaults(func=command_ai_models)

    index_status_cmd = sub.add_parser("index-status")
    index_status_cmd.add_argument("--index-root", required=True)
    index_status_cmd.set_defaults(func=command_index_status)

    index_ingest = sub.add_parser("index-ingest")
    index_ingest.add_argument("--index-root", required=True)
    index_ingest.add_argument("paths", nargs="+")
    index_ingest.set_defaults(func=command_index_ingest)

    index_semantic_ingest = sub.add_parser("index-semantic-ingest")
    index_semantic_ingest.add_argument("--index-root", required=True)
    index_semantic_ingest.add_argument("--chunk-duration", type=int, default=30)
    index_semantic_ingest.add_argument("--overlap", type=int, default=5)
    index_semantic_ingest.add_argument("--target-resolution", type=int, default=480)
    index_semantic_ingest.add_argument("--target-fps", type=int, default=5)
    index_semantic_ingest.add_argument("--no-preprocess", action="store_true")
    index_semantic_ingest.add_argument("--no-skip-still", action="store_true")
    index_semantic_ingest.add_argument("paths", nargs="+")
    index_semantic_ingest.set_defaults(func=command_index_semantic_ingest)

    index_import_semantic = sub.add_parser("index-import-semantic-script")
    index_import_semantic.add_argument("--index-root", required=True)
    index_import_semantic.add_argument("--semantic-db", required=True)
    index_import_semantic.set_defaults(func=command_index_import_semantic_script)

    index_search = sub.add_parser("index-search")
    index_search.add_argument("--index-root", required=True)
    index_search.add_argument("--query", default="")
    index_search.add_argument("--limit", type=int, default=20)
    index_search.set_defaults(func=command_index_search)

    index_upsert = sub.add_parser("index-upsert")
    index_upsert.add_argument("--index-root", required=True)
    index_upsert.add_argument("--input", default="-")
    index_upsert.add_argument("--payload-json", default="")
    index_upsert.set_defaults(func=command_index_upsert)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
