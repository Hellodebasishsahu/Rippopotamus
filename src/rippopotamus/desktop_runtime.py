from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from rippopotamus.providers import (
    NETWORK_BLOCKED_MESSAGE,
    ProviderContext,
    aria2c_base,
    friendly_error,
    gallery_dl_base,
    looks_network_blocked,
    yt_dlp_cookie_check_command,
    yt_dlp_run as provider_yt_dlp_run,
)


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
    if looks_network_blocked(message):
        return NETWORK_BLOCKED_MESSAGE
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
    aria = aria2c_status()
    return ProviderContext(
        yt_dlp_base=tuple(yt_dlp_base()),
        cookies_browser=(cookies_browser or "").strip() or None,
        ffmpeg_path=ffmpeg_path(),
        aria2c_path=aria["path"] if aria["ok"] else None,
        aria2_max_connections=aria2_max_connections(),
        aria2_download_limit=aria2_download_limit(),
    )


def arg_cookies_browser(args: argparse.Namespace) -> str | None:
    return (getattr(args, "cookies_browser", "") or "").strip() or None


def aria2_max_connections() -> int:
    try:
        value = int(os.environ.get("RIPPO_ARIA2_MAX_CONNECTIONS", "8") or 8)
    except ValueError:
        value = 8
    return max(1, min(16, value))


def aria2_download_limit() -> str | None:
    value = os.environ.get("RIPPO_ARIA2_DOWNLOAD_LIMIT", "").strip().upper()
    if not value:
        return None
    return value if re.match(r"^\d+(?:K|M)?$", value) else None


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


def torrent_engine_status() -> dict[str, Any]:
    aria = aria2c_status()
    if aria["ok"]:
        return {"ok": True, "engine": "aria2c", "error": None, "aria2c": aria}
    return {"ok": False, "engine": None, "error": aria["error"], "aria2c": aria}


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
