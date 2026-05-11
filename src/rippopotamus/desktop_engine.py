from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

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
    yt_dlp_cookie_check_command,
    yt_dlp_run as provider_yt_dlp_run,
)
from rippopotamus.query_intelligence import PACK_LABELS, build_query_intelligence, effective_pack, openrouter_model_catalog
from rippopotamus.search_evidence import search_evidence_status
from rippopotamus.source_registry import search_sources


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
    aria = aria2c_status()
    emit({
        "ok": True,
        "python": sys.executable,
        "ytDlp": yt_dlp_version,
        "ytDlpPath": base[0] if len(base) == 1 else None,
        "galleryDl": gallery["version"],
        "galleryDlPath": gallery["path"],
        "galleryDlOk": gallery["ok"],
        "galleryDlError": gallery["error"],
        "aria2c": aria["version"],
        "aria2cPath": aria["path"],
        "aria2cOk": aria["ok"],
        "aria2cError": aria["error"],
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
            provider = "aria2c"
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
    elif provider == "aria2c":
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
    emit(payload)
    return 0


def command_ai_models(args: argparse.Namespace) -> int:
    emit(openrouter_model_catalog(refresh=args.refresh, selected_model=args.selected_model))
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
    cmd = desktop_download_command(
        args.url,
        args.preset,
        output_template=output_template,
        output_dir=root / spec["folder"],
        context=provider_context(cookies_browser),
    )

    if spec["provider"] == "gallery-dl":
        return command_gallery_download(args, root, cmd)
    if spec["provider"] == "aria2c":
        return command_aria2_download(args, root, cmd)

    before = snapshot_files(root)
    emit({"type": "started", "url": args.url, "preset": args.preset})

    code, last_line, notices = run_ytdlp_download_command(cmd, root, before)
    detail = next((n for n in notices if n.startswith("ERROR:")), last_line)

    if code != 0:
        emit({"type": "error", "error": cookie_error_message(detail)})
        return code

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
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
