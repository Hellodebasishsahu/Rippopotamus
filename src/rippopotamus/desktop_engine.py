from __future__ import annotations

import argparse
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
from rippopotamus.query_intelligence import PACK_LABELS, build_query_intelligence, effective_pack, openrouter_model_catalog
from rippopotamus.metadata_lookup import lookup_media
from rippopotamus.resolvers import ADAPTERS, resolve_all
from rippopotamus.search_evidence import search_evidence_status
from rippopotamus.source_registry import search_sources
from rippopotamus.footage_index import import_semantic_script_index, index_status, ingest_paths, search_index, upsert_moments
from rippopotamus.index_worker import SemanticIngestOptions, semantic_ingest_paths
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


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


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

    if spec["provider"] == "torrent":
        cmd = desktop_download_command(
            args.url,
            args.preset,
            output_template=output_template,
            output_dir=root / spec["folder"],
            context=provider_context(cookies_browser),
        )
        return run_torrent_download(args, root, cmd)

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
