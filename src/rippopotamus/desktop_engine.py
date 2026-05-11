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

from rippopotamus.cli import PRESETS, PROVIDERS, first_json_metadata, friendly_error, gallery_dl_base, metadata_from_media_raw, slugify


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


def verify_cookies_browser(base: list[str]) -> dict[str, Any]:
    browser = os.environ.get("RIPPO_COOKIES_FROM_BROWSER", "").strip()
    if not browser:
        return {"status": "off", "browser": None, "ok": None, "message": None}

    command = [
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
    return [*yt_dlp_base(), "--ignore-config", *cookies_browser_args()]


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
        raise SystemExit(cookie_error_message(message)) from exc
    return json.loads(result.stdout)


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
        "cookiesBrowser": os.environ.get("RIPPO_COOKIES_FROM_BROWSER", "") or None,
        "cookies": verify_cookies_browser(base),
    })
    return 0


def command_fetch(args: argparse.Namespace) -> int:
    if args.provider == "yt-dlp":
        raw = run_json([*yt_dlp_run(), "--dump-single-json", "--skip-download", "--no-playlist", "--ignore-no-formats-error", args.url])
        metadata = metadata_from_media_raw(raw, args.url, "yt-dlp")
    elif args.provider == "gallery-dl":
        raw = run_json_lines([*gallery_dl_base(), "--dump-json", args.url])
        metadata = metadata_from_media_raw(raw, args.url, "gallery-dl")
    else:
        raise SystemExit(f"Unknown provider `{args.provider}`.")
    emit({"ok": True, "url": args.url, "metadata": metadata})
    return 0


def run_json_lines(args: list[str]) -> dict[str, Any]:
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=True)
    except FileNotFoundError as exc:
        raise SystemExit(f"Missing required command: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or str(exc)).strip()
        raise SystemExit(cookie_error_message(message)) from exc
    return first_json_metadata(result.stdout)


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


def build_ytdlp_download_command(args: argparse.Namespace, spec: dict[str, Any], output_template: str) -> list[str]:
    cmd = [*yt_dlp_run(), "--newline", "--no-playlist", "-o", output_template]
    ffmpeg = ffmpeg_path()
    if ffmpeg:
        cmd += ["--ffmpeg-location", str(Path(ffmpeg).parent)]
    if spec["format"]:
        cmd += ["-f", spec["format"]]
    cmd += spec["extra"]
    cmd.append(args.url)
    return cmd


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
    for folder in ["Source", "Audio", "Images", "Thumbnails", "Clips", "Exports"]:
        (root / folder).mkdir(parents=True, exist_ok=True)

    spec = PRESETS[args.preset]
    if spec["provider"] == "gallery-dl":
        return command_gallery_download(args, root, spec)

    item_id = args.item_id or uuid.uuid4().hex[:10]
    title = slugify(args.title or item_id)
    output_template = str(root / spec["folder"] / f"{title}--{item_id}.%(ext)s")

    before = snapshot_files(root)
    emit({"type": "started", "url": args.url, "preset": args.preset})

    cmd = build_ytdlp_download_command(args, spec, output_template)
    code, last_line, notices = run_ytdlp_download_command(cmd, root, before)
    detail = next((n for n in notices if n.startswith("ERROR:")), last_line)

    if code != 0:
        emit({"type": "error", "error": cookie_error_message(detail)})
        return code

    return 0


def command_gallery_download(args: argparse.Namespace, root: Path, spec: dict[str, Any]) -> int:
    target = root / spec["folder"]
    target.mkdir(parents=True, exist_ok=True)
    cmd = [
        *gallery_dl_base(),
        "--dest",
        str(target),
        "--write-metadata",
        args.url,
    ]

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
    health.set_defaults(func=command_health)

    fetch = sub.add_parser("fetch")
    fetch.add_argument("--url", required=True)
    fetch.add_argument("--provider", choices=sorted(PROVIDERS), default="yt-dlp")
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
