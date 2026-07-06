from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rippopotamus.cli import slugify
from rippopotamus.providers import (
    DEFAULT_PRESET,
    DEFAULT_PROVIDER,
    PRESETS,
    PROVIDERS,
    desktop_download_command,
    friendly_error,
    metadata_command,
    parse_metadata_output,
    provider_catalog,
)
from rippopotamus.google_drive import download_drive_file, drive_metadata, is_drive_file_url
from rippopotamus.desktop_runtime import (
    arg_cookies_browser,
    cookie_error_message,
    ffmpeg_path,
    gallery_dl_status,
    is_torrent_input,
    provider_context,
    run_text,
    torrent_engine_status,
    verify_cookies_browser,
    yt_dlp_base,
)
from rippopotamus.torrent_downloads import run_torrent_download
from rippopotamus.resolvers.generic_preview import preview_metadata
from rippopotamus.library import (
    LedgerLoadError,
    command_library_list,
    download_ledger_path,
    emit,
    failure_ledger_path,
    file_result,
    library_entry_from_record,
    load_download_ledger,
    load_failure_ledger,
    media_kind_for_path,
    title_from_relative_path,
)


def download_key(url: str, preset: str) -> str:
    basis = json.dumps({"preset": preset, "url": url.strip()}, sort_keys=True)
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:24]


def write_download_ledger(root: Path, ledger: dict[str, Any]) -> None:
    path = download_ledger_path(root)
    path.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def existing_download(root: Path, key: str) -> list[dict[str, Any]] | None:
    try:
        ledger = load_download_ledger(root)
    except LedgerLoadError:
        return None
    record = ledger.get(key)
    if not isinstance(record, dict):
        return None
    paths = record.get("files")
    if not isinstance(paths, list) or not paths:
        return None
    files: list[dict[str, Any]] = []
    for rel in paths:
        if not isinstance(rel, str) or Path(rel).is_absolute():
            return None
        path = (root / rel).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            return None
        if not path.is_file():
            return None
        files.append(file_result(root, path))
    return sorted(files, key=lambda item: item["path"])


def remember_download(root: Path, key: str, files: list[dict[str, Any]], *, url: str, preset: str) -> None:
    if not files:
        return
    ledger = load_download_ledger(root)
    ledger[key] = {
        "url": url,
        "preset": preset,
        "files": [item["path"] for item in files if isinstance(item.get("path"), str)],
    }
    write_download_ledger(root, ledger)
    # A URL that finally succeeded is no longer a failure.
    clear_failure(root, key)


def write_failure_ledger(root: Path, ledger: dict[str, Any]) -> None:
    try:
        failure_ledger_path(root).write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except OSError:
        # Diagnostic only — never let it break a download.
        pass


def remember_failure(root: Path, key: str, *, url: str, preset: str, error: str) -> None:
    ledger = load_failure_ledger(root)
    previous = ledger.get(key) if isinstance(ledger.get(key), dict) else {}
    attempts = previous.get("attempts", 0) if isinstance(previous.get("attempts"), int) else 0
    ledger[key] = {
        "url": url,
        "preset": preset,
        "error": (error or "Download failed.").strip()[:1000],
        "attempts": attempts + 1,
        "lastFailedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    write_failure_ledger(root, ledger)


def clear_failure(root: Path, key: str) -> None:
    ledger = load_failure_ledger(root)
    if key in ledger:
        del ledger[key]
        write_failure_ledger(root, ledger)


def emit_duplicate_download(root: Path, files: list[dict[str, Any]], *, url: str, preset: str) -> None:
    emit({"type": "started", "url": url, "preset": preset})
    emit({"type": "stage", "message": "Already saved", "finalizing": False})
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": ["Already saved; skipped duplicate download."]})


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
    aria = torrent["aria2c"]
    context = provider_context(cookies_browser)
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
        "torrentEngine": torrent["engine"],
        "torrentOk": torrent["ok"],
        "torrentError": torrent["error"],
        "ffmpeg": ffmpeg,
        "ffmpegOk": ffmpeg_ok,
        "ffmpegVersion": ffmpeg_version,
        "cookiesBrowser": cookies_browser,
        "cookies": verify_cookies_browser(base, cookies_browser),
        "aria2MaxConnections": context.aria2_max_connections,
        "aria2DownloadLimit": context.aria2_download_limit or "",
        "providers": catalog["providers"],
        "presets": catalog["presets"],
    })
    return 0


def command_fetch(args: argparse.Namespace) -> int:
    provider = args.provider
    cookies_browser = arg_cookies_browser(args)
    full = bool(getattr(args, "full", False))
    if provider == "auto":
        if is_torrent_input(args.url):
            provider = "torrent"
            output = ""
        elif is_drive_file_url(args.url):
            provider = "google-drive"
            metadata = drive_metadata(args.url, cookies_browser, yt_dlp_base=yt_dlp_base())
            emit({"ok": True, "url": args.url, "metadata": metadata})
            return 0
        else:
            metadata = None if full else preview_metadata(args.url)
            if metadata:
                emit({"ok": True, "url": args.url, "metadata": metadata})
                return 0
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
    elif provider == "google-drive":
        metadata = drive_metadata(args.url, cookies_browser, yt_dlp_base=yt_dlp_base())
        emit({"ok": True, "url": args.url, "metadata": metadata})
        return 0
    else:
        if provider == "yt-dlp" and not full:
            metadata = preview_metadata(args.url, provider=provider)
            if metadata:
                emit({"ok": True, "url": args.url, "metadata": metadata})
                return 0
        output = run_text(metadata_command(provider, args.url, provider_context(cookies_browser)))
    metadata = parse_metadata_output(provider, args.url, output)
    emit({"ok": True, "url": args.url, "metadata": metadata})
    return 0


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
        files = sorted((file_result(root, path) for path in after - before), key=lambda item: item["path"])
        emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": [n for n in notices if n.startswith("WARNING:")]})
    return code, last_line, notices


def command_download(args: argparse.Namespace) -> int:
    # An empty preset reaches here when a queue item is resumed before it ever
    # fetched successfully; fall back to the default rather than crashing.
    if not args.preset:
        args.preset = DEFAULT_PRESET
    if args.preset not in PRESETS:
        raise SystemExit(f"Unknown preset `{args.preset}`. Choose one of: {', '.join(PRESETS)}")

    root = Path(args.output_root).expanduser().resolve()
    for folder in ["Source", "Audio", "Images", "Files", "Thumbnails", "Clips", "Exports"]:
        (root / folder).mkdir(parents=True, exist_ok=True)

    dedupe_key = download_key(args.url, args.preset)
    duplicate_files = existing_download(root, dedupe_key)
    if duplicate_files:
        emit_duplicate_download(root, duplicate_files, url=args.url, preset=args.preset)
        return 0

    item_id = args.item_id or uuid.uuid4().hex[:10]
    spec = PRESETS[args.preset]
    cookies_browser = arg_cookies_browser(args)
    title = slugify(args.title or item_id)
    output_template = str(root / spec["folder"] / f"{title}--{item_id}.%(ext)s")

    if spec["provider"] == "torrent":
        before = snapshot_files(root)
        cmd = desktop_download_command(
            args.url,
            args.preset,
            output_template=output_template,
            output_dir=root / spec["folder"],
            context=provider_context(cookies_browser),
        )
        code = run_torrent_download(args, root, cmd)
        if code == 0:
            after = snapshot_files(root)
            files = sorted((file_result(root, path) for path in after - before), key=lambda item: item["path"])
            remember_download(root, dedupe_key, files, url=args.url, preset=args.preset)
        else:
            remember_failure(root, dedupe_key, url=args.url, preset=args.preset, error=f"Torrent download exited with code {code}.")
        return code

    if spec["provider"] == "google-drive":
        emit({"type": "started", "url": args.url, "preset": args.preset})
        try:
            files = download_drive_file(
                args.url,
                root / spec["folder"],
                cookie_browser=cookies_browser,
                yt_dlp_base=yt_dlp_base(),
                emit=emit,
            )
        except SystemExit as exc:
            message = cookie_error_message(str(exc))
            remember_failure(root, dedupe_key, url=args.url, preset=args.preset, error=message)
            emit({"type": "error", "error": message})
            return 1
        relative = sorted((file_result(root, Path(path).resolve()) for path in files), key=lambda item: item["path"])
        remember_download(root, dedupe_key, relative, url=args.url, preset=args.preset)
        emit({"type": "success", "files": relative, "outputRoot": str(root), "warnings": []})
        return 0

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
        message = cookie_error_message(detail)
        remember_failure(root, dedupe_key, url=args.url, preset=args.preset, error=message)
        emit({"type": "error", "error": message})
        return code

    after = snapshot_files(root)
    files = sorted((file_result(root, path) for path in after - before), key=lambda item: item["path"])
    remember_download(root, dedupe_key, files, url=args.url, preset=args.preset)
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
        message = friendly_error(detail)
        remember_failure(root, download_key(args.url, args.preset), url=args.url, preset=args.preset, error=message)
        emit({"type": "error", "error": message})
        return code

    after = snapshot_files(root)
    files = sorted((file_result(root, path) for path in after - before), key=lambda item: item["path"])
    remember_download(root, download_key(args.url, args.preset), files, url=args.url, preset=args.preset)
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": [n for n in notices if n.startswith("WARNING:")]})
    return 0


def command_failures_list(args: argparse.Namespace) -> int:
    root = Path(args.output_root).expanduser().resolve()
    ledger = load_failure_ledger(root)
    failures = sorted(
        (
            {"key": key, **record}
            for key, record in ledger.items()
            if isinstance(record, dict)
        ),
        key=lambda item: item.get("lastFailedAt", ""),
        reverse=True,
    )
    emit({"type": "failures", "failures": failures, "outputRoot": str(root)})
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
    fetch.add_argument("--full", action="store_true")
    fetch.set_defaults(func=command_fetch)

    download = sub.add_parser("download")
    download.add_argument("--url", required=True)
    download.add_argument("--preset", required=True)
    download.add_argument("--output-root", required=True)
    download.add_argument("--item-id")
    download.add_argument("--title")
    download.add_argument("--cookies-browser", default="")
    download.set_defaults(func=command_download)

    failures_list = sub.add_parser("failures-list")
    failures_list.add_argument("--output-root", required=True)
    failures_list.set_defaults(func=command_failures_list)

    library_list = sub.add_parser("library-list")
    library_list.add_argument("--output-root", required=True)
    library_list.set_defaults(func=command_library_list)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
