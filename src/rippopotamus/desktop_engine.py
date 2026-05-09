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

from rippopotamus.cli import PRESETS, friendly_error, slugify


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


def ffmpeg_path() -> str | None:
    configured = os.environ.get("RIPPO_FFMPEG_PATH") or os.environ.get("RIPPO_FFMPEG_LOCATION")
    if configured:
        return configured
    return shutil.which("ffmpeg")


def run_json(args: list[str]) -> dict[str, Any]:
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=True)
    except FileNotFoundError as exc:
        raise SystemExit(f"Missing required command: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or str(exc)).strip()
        raise SystemExit(friendly_error(message)) from exc
    return json.loads(result.stdout)


def metadata_from_raw(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "title": raw.get("title"),
        "extractor": raw.get("extractor_key") or raw.get("extractor"),
        "webpage_url": raw.get("webpage_url"),
        "duration": raw.get("duration"),
        "uploader": raw.get("uploader"),
        "upload_date": raw.get("upload_date"),
        "thumbnail": raw.get("thumbnail"),
        "description": raw.get("description"),
    }


def command_health(_args: argparse.Namespace) -> int:
    base = yt_dlp_base()
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

    emit({
        "ok": True,
        "python": sys.executable,
        "ytDlp": yt_dlp_version,
        "ytDlpPath": base[0] if len(base) == 1 else None,
        "ffmpeg": ffmpeg,
        "ffmpegOk": ffmpeg_ok,
        "ffmpegVersion": ffmpeg_version,
    })
    return 0


def command_fetch(args: argparse.Namespace) -> int:
    raw = run_json([*yt_dlp_base(), "--dump-single-json", "--skip-download", "--no-playlist", args.url])
    emit({"ok": True, "url": args.url, "metadata": metadata_from_raw(raw)})
    return 0


def snapshot_files(root: Path) -> set[Path]:
    return {path for path in root.rglob("*") if path.is_file()}


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


def command_download(args: argparse.Namespace) -> int:
    if args.preset not in PRESETS:
        raise SystemExit(f"Unknown preset `{args.preset}`.")

    root = Path(args.output_root).expanduser().resolve()
    for folder in ["Source", "Audio", "Thumbnails", "Clips", "Exports"]:
        (root / folder).mkdir(parents=True, exist_ok=True)

    spec = PRESETS[args.preset]
    item_id = args.item_id or uuid.uuid4().hex[:10]
    title = slugify(args.title or item_id)
    output_template = str(root / spec["folder"] / f"{title}--{item_id}.%(ext)s")

    cmd = [*yt_dlp_base(), "--newline", "--no-playlist", "-o", output_template]
    ffmpeg = ffmpeg_path()
    if ffmpeg:
        cmd += ["--ffmpeg-location", str(Path(ffmpeg).parent)]
    if spec["format"]:
        cmd += ["-f", spec["format"]]
    cmd += spec["extra"]
    cmd.append(args.url)

    before = snapshot_files(root)
    emit({"type": "started", "url": args.url, "preset": args.preset})

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    last_line = ""
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        last_line = line
        progress = parse_progress(line)
        if progress:
            emit({"type": "progress", **progress})
        elif line.startswith("[ExtractAudio]") or line.startswith("[Merger]") or line.startswith("[ThumbnailsConvertor]"):
            emit({"type": "stage", "message": line})

    code = process.wait()
    if code != 0:
        emit({"type": "error", "error": friendly_error(last_line)})
        return code

    after = snapshot_files(root)
    files = sorted(str(path.relative_to(root)) for path in after - before)
    emit({"type": "success", "files": files, "outputRoot": str(root)})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rippo-engine")
    sub = parser.add_subparsers(dest="command", required=True)

    health = sub.add_parser("health")
    health.set_defaults(func=command_health)

    fetch = sub.add_parser("fetch")
    fetch.add_argument("--url", required=True)
    fetch.set_defaults(func=command_fetch)

    download = sub.add_parser("download")
    download.add_argument("--url", required=True)
    download.add_argument("--preset", required=True)
    download.add_argument("--output-root", required=True)
    download.add_argument("--item-id")
    download.add_argument("--title")
    download.set_defaults(func=command_download)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
