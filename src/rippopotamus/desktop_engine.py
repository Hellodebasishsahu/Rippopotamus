from __future__ import annotations

import argparse
import hashlib
import json
import re
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
    network_proxy,
    provider_context,
    run_text,
    torrent_engine_status,
    verify_cookies_browser,
    yt_dlp_base,
)
from rippopotamus.torrent_downloads import run_torrent_download
from rippopotamus.sheet_import import run_sheet_import_pipeline
from rippopotamus.resolvers.generic_preview import preview_metadata


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


def download_ledger_path(root: Path) -> Path:
    return root / ".rippo-downloads.json"


def download_key(url: str, preset: str) -> str:
    basis = json.dumps({"preset": preset, "url": url.strip()}, sort_keys=True)
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:24]


def load_download_ledger(root: Path) -> dict[str, Any]:
    path = download_ledger_path(root)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def write_download_ledger(root: Path, ledger: dict[str, Any]) -> None:
    path = download_ledger_path(root)
    path.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def existing_download(root: Path, key: str) -> list[dict[str, Any]] | None:
    record = load_download_ledger(root).get(key)
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


def emit_duplicate_download(root: Path, files: list[dict[str, Any]], *, url: str, preset: str) -> None:
    emit({"type": "started", "url": url, "preset": preset})
    emit({"type": "stage", "message": "Already saved", "finalizing": False})
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": ["Already saved; skipped duplicate download."]})


def command_sheet_import(args: argparse.Namespace) -> int:
    job_id = (args.job_id or "").strip()
    cookies_browser = arg_cookies_browser(args)
    proxy = network_proxy()

    def sheet_emit(payload: dict[str, Any]) -> None:
        emit({"jobId": job_id, "type": "sheet-import", **payload})

    sheet_emit({"phase": "queued", "sheetUrl": args.sheet_url, "projectName": args.project_name})
    try:
        run_sheet_import_pipeline(
            sheet_url=args.sheet_url.strip(),
            output_root=Path(args.output_root),
            project_name=(args.project_name or "sheet-import").strip(),
            sheet_name=(args.sheet_name or "Tracker").strip(),
            browser=cookies_browser,
            yt_dlp_base=yt_dlp_base(),
            network_proxy=proxy,
            state_filter=(args.state or "").strip(),
            pc_filter=(args.pc or "").strip(),
            status_filter=(args.status or "").strip(),
            limit=int(args.limit or 0),
            require_master=bool(args.require_master),
            download_master=bool(args.download_master),
            emit=sheet_emit,
        )
    except SystemExit as exc:
        err = cookie_error_message(str(exc))
        sheet_emit({"phase": "error", "error": err, "ok": False})
        return 1
    return 0


def command_health(args: argparse.Namespace) -> int:
    base = yt_dlp_base()
    cookies_browser = arg_cookies_browser(args)
    proxy = network_proxy()
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
        "networkProxy": proxy,
        "networkProxyEnabled": bool(proxy),
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
            metadata = drive_metadata(args.url, cookies_browser, yt_dlp_base=yt_dlp_base(), network_proxy=network_proxy())
            emit({"ok": True, "url": args.url, "metadata": metadata})
            return 0
        else:
            metadata = None if full else preview_metadata(args.url, network_proxy())
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
        metadata = drive_metadata(args.url, cookies_browser, yt_dlp_base=yt_dlp_base(), network_proxy=network_proxy())
        emit({"ok": True, "url": args.url, "metadata": metadata})
        return 0
    else:
        if provider == "yt-dlp" and not full:
            metadata = preview_metadata(args.url, network_proxy(), provider=provider)
            if metadata:
                emit({"ok": True, "url": args.url, "metadata": metadata})
                return 0
        output = run_text(metadata_command(provider, args.url, provider_context(cookies_browser)))
    metadata = parse_metadata_output(provider, args.url, output)
    emit({"ok": True, "url": args.url, "metadata": metadata})
    return 0


def command_proxy_check(args: argparse.Namespace) -> int:
    proxy = (args.proxy or "").strip()
    if not proxy:
        emit({"ok": False, "proxy": "", "error": "Paste a proxy URL first."})
        return 1
    command = [
        "curl",
        "--silent",
        "--show-error",
        "--max-time",
        "12",
        "--proxy",
        proxy,
        "https://api.ipify.org?format=json",
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=15)
    except FileNotFoundError:
        emit({"ok": False, "proxy": proxy, "error": "curl is not available to test this proxy."})
        return 1
    except subprocess.TimeoutExpired:
        emit({"ok": False, "proxy": proxy, "error": "Proxy test timed out."})
        return 1

    output = (result.stdout or "").strip()
    if result.returncode != 0:
        detail = (result.stderr or output or "Proxy test failed.").strip()
        emit({"ok": False, "proxy": proxy, "error": friendly_error(detail)})
        return 1

    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        emit({"ok": True, "proxy": proxy, "ip": output[:120]})
        return 0

    emit({"ok": True, "proxy": proxy, "ip": payload.get("ip")})
    return 0


def snapshot_files(root: Path) -> set[Path]:
    return {path for path in root.rglob("*") if path.is_file() and not any(part.startswith(".") for part in path.relative_to(root).parts)}


def file_result(root: Path, path: Path) -> dict[str, Any]:
    relative = str(path.relative_to(root))
    try:
        size = path.stat().st_size
    except OSError:
        size = None
    return {"path": relative, "size": size}


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
    if args.preset not in PRESETS:
        raise SystemExit(f"Unknown preset `{args.preset}`.")

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
        return code

    if spec["provider"] == "google-drive":
        emit({"type": "started", "url": args.url, "preset": args.preset})
        try:
            files = download_drive_file(
                args.url,
                root / spec["folder"],
                cookie_browser=cookies_browser,
                yt_dlp_base=yt_dlp_base(),
                network_proxy=network_proxy(),
                emit=emit,
            )
        except SystemExit as exc:
            emit({"type": "error", "error": cookie_error_message(str(exc))})
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
        emit({"type": "error", "error": cookie_error_message(detail)})
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
        emit({"type": "error", "error": friendly_error(detail)})
        return code

    after = snapshot_files(root)
    files = sorted((file_result(root, path) for path in after - before), key=lambda item: item["path"])
    remember_download(root, download_key(args.url, args.preset), files, url=args.url, preset=args.preset)
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

    proxy_check = sub.add_parser("proxy-check")
    proxy_check.add_argument("--proxy", required=True)
    proxy_check.set_defaults(func=command_proxy_check)

    sheet_import_cmd = sub.add_parser("sheet-import")
    sheet_import_cmd.add_argument("--sheet-url", required=True)
    sheet_import_cmd.add_argument("--output-root", required=True)
    sheet_import_cmd.add_argument("--project-name", default="sheet-import")
    sheet_import_cmd.add_argument("--sheet-name", default="Tracker")
    sheet_import_cmd.add_argument("--job-id", default="")
    sheet_import_cmd.add_argument("--cookies-browser", default="")
    sheet_import_cmd.add_argument("--state", default="")
    sheet_import_cmd.add_argument("--pc", default="")
    sheet_import_cmd.add_argument("--status", default="")
    sheet_import_cmd.add_argument("--limit", type=int, default=0)
    sheet_import_cmd.add_argument("--require-master", action="store_true")
    sheet_import_cmd.add_argument("--download-master", action="store_true")
    sheet_import_cmd.set_defaults(func=command_sheet_import)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
