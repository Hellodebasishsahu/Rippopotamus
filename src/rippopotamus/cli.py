from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STATE_DIR = ".rippo"
STATE_FILE = "project.json"
MANIFEST_FILE = "manifest.json"

PRESETS = {
    "mp4-best": {
        "folder": "Source",
        "format": "bv*+ba/b",
        "extra": ["--merge-output-format", "mp4"],
        "extension": "mp4",
    },
    "audio-mp3": {
        "folder": "Audio",
        "format": "bestaudio/best",
        "extra": ["--extract-audio", "--audio-format", "mp3"],
        "extension": "mp3",
    },
    "thumbnail": {
        "folder": "Thumbnails",
        "format": None,
        "extra": ["--skip-download", "--write-thumbnail", "--convert-thumbnails", "jpg"],
        "extension": "jpg",
    },
    "proxy": {
        "folder": "Source",
        "format": "bv*[height<=720]+ba/b[height<=720]/b",
        "extra": ["--merge-output-format", "mp4"],
        "extension": "mp4",
    },
}


@dataclass(frozen=True)
class RippoProject:
    root: Path
    state_path: Path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "untitled"


def run_checked(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True)
    except FileNotFoundError as exc:
        raise SystemExit(f"Missing required command: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or str(exc)).strip()
        raise SystemExit(f"{args[0]} failed: {friendly_error(message)}") from exc


def friendly_error(message: str) -> str:
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
    if "timed out" in message.lower():
        return "request timed out"
    return message.splitlines()[-1][:240] if message else "unknown error"


def load_project(start: Path | None = None) -> RippoProject:
    current = (start or Path.cwd()).resolve()
    for candidate in [current, *current.parents]:
        state_path = candidate / STATE_DIR / STATE_FILE
        if state_path.exists():
            return RippoProject(root=candidate, state_path=state_path)
    raise SystemExit("Not inside a Rippopotamus project. Run `rippo init \"Project Name\"` first.")


def read_state(project: RippoProject) -> dict[str, Any]:
    with project.state_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_state(project: RippoProject, state: dict[str, Any]) -> None:
    project.state_path.parent.mkdir(parents=True, exist_ok=True)
    with project.state_path.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
        handle.write("\n")


def write_manifest(project: RippoProject, state: dict[str, Any]) -> None:
    manifest = {
        "project": {
            "name": state["name"],
            "slug": state["slug"],
            "created_at": state["created_at"],
            "updated_at": state["updated_at"],
        },
        "assets": state["items"],
    }
    with (project.root / MANIFEST_FILE).open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")


def ensure_project_dirs(root: Path) -> None:
    for name in ["Source", "Audio", "Thumbnails", "Clips", "Exports", STATE_DIR]:
        (root / name).mkdir(parents=True, exist_ok=True)


def command_init(args: argparse.Namespace) -> int:
    root = Path(args.path or slugify(args.name)).resolve()
    if root.exists() and any(root.iterdir()) and not (root / STATE_DIR / STATE_FILE).exists():
        raise SystemExit(f"Refusing to initialize non-empty folder without project state: {root}")

    root.mkdir(parents=True, exist_ok=True)
    ensure_project_dirs(root)
    project = RippoProject(root=root, state_path=root / STATE_DIR / STATE_FILE)

    if project.state_path.exists() and not args.force:
        raise SystemExit(f"Rippopotamus project already exists: {root}")

    state = {
        "name": args.name,
        "slug": slugify(args.name),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "items": [],
    }
    write_state(project, state)
    write_manifest(project, state)
    print(f"Created Rippopotamus project: {root}")
    return 0


def normalize_urls(values: list[str]) -> list[str]:
    urls: list[str] = []
    for value in values:
        urls.extend(part.strip() for part in re.split(r"[\s,]+", value) if part.strip())
    return [url for url in urls if url.startswith(("http://", "https://"))]


def command_add(args: argparse.Namespace) -> int:
    project = load_project()
    state = read_state(project)
    urls = normalize_urls(args.urls)
    if not urls:
        raise SystemExit("No valid URLs provided.")

    existing = {item["url"] for item in state["items"]}
    added = 0
    for url in urls:
        if url in existing:
            continue
        state["items"].append({
            "id": uuid.uuid4().hex[:10],
            "url": url,
            "status": "queued",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "metadata": None,
            "outputs": [],
            "error": None,
        })
        existing.add(url)
        added += 1

    state["updated_at"] = now_iso()
    write_state(project, state)
    write_manifest(project, state)
    print(f"Added {added} URL(s).")
    return 0


def fetch_metadata(url: str) -> dict[str, Any]:
    result = run_checked(["yt-dlp", "--dump-single-json", "--skip-download", "--no-playlist", url])
    raw = json.loads(result.stdout)
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


def command_fetch(args: argparse.Namespace) -> int:
    project = load_project()
    state = read_state(project)
    count = 0

    for item in state["items"]:
        if item["status"] not in {"queued", "metadata_failed"} and not args.refresh:
            continue
        try:
            item["metadata"] = fetch_metadata(item["url"])
            item["status"] = "fetched"
            item["error"] = None
            count += 1
        except SystemExit as exc:
            item["status"] = "metadata_failed"
            item["error"] = str(exc)
        item["updated_at"] = now_iso()

    state["updated_at"] = now_iso()
    write_state(project, state)
    write_manifest(project, state)
    print(f"Fetched metadata for {count} item(s).")
    return 0


def output_template(project: RippoProject, item: dict[str, Any], preset: str) -> str:
    spec = PRESETS[preset]
    metadata = item.get("metadata") or {}
    title = slugify(metadata.get("title") or item["id"])
    folder = project.root / spec["folder"]
    return str(folder / f"{title}--{item['id']}.%(ext)s")


def command_download(args: argparse.Namespace) -> int:
    if args.preset not in PRESETS:
        raise SystemExit(f"Unknown preset `{args.preset}`. Choose one of: {', '.join(PRESETS)}")

    project = load_project()
    state = read_state(project)
    downloaded = 0

    for item in state["items"]:
        if item["status"] not in {"fetched", "download_failed"}:
            continue

        spec = PRESETS[args.preset]
        cmd = ["yt-dlp", "--no-playlist", "-o", output_template(project, item, args.preset)]
        if spec["format"]:
            cmd += ["-f", spec["format"]]
        cmd += spec["extra"]
        cmd.append(item["url"])

        try:
            before = snapshot_files(project.root)
            if args.dry_run:
                print(" ".join(cmd))
                continue
            run_checked(cmd)
            after = snapshot_files(project.root)
            outputs = sorted(str(path.relative_to(project.root)) for path in after - before)
            item["outputs"].append({
                "preset": args.preset,
                "created_at": now_iso(),
                "files": outputs,
            })
            item["status"] = "downloaded"
            item["error"] = None
            downloaded += 1
        except SystemExit as exc:
            item["status"] = "download_failed"
            item["error"] = str(exc)
        item["updated_at"] = now_iso()

    state["updated_at"] = now_iso()
    write_state(project, state)
    write_manifest(project, state)
    print(f"Downloaded {downloaded} item(s).")
    return 0


def snapshot_files(root: Path) -> set[Path]:
    ignored = {STATE_DIR}
    return {
        path
        for path in root.rglob("*")
        if path.is_file() and not any(part in ignored for part in path.relative_to(root).parts)
    }


def command_manifest(args: argparse.Namespace) -> int:
    project = load_project()
    state = read_state(project)
    write_manifest(project, state)
    print(project.root / MANIFEST_FILE)
    return 0


def command_status(args: argparse.Namespace) -> int:
    project = load_project()
    state = read_state(project)
    totals: dict[str, int] = {}
    for item in state["items"]:
        totals[item["status"]] = totals.get(item["status"], 0) + 1

    print(f"{state['name']} ({project.root})")
    if not totals:
        print("No queued items.")
        return 0

    for status, count in sorted(totals.items()):
        print(f"{status}: {count}")
    return 0


def command_zip(args: argparse.Namespace) -> int:
    project = load_project()
    state = read_state(project)
    write_manifest(project, state)

    output = Path(args.output).resolve() if args.output else project.root / "Exports" / f"{state['slug']}.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    included_roots = {"Source", "Audio", "Thumbnails", "Clips", "manifest.json"}
    with tempfile.TemporaryDirectory(prefix="rippo-zip-") as tmp:
        tmp_zip = Path(tmp) / output.name
        with zipfile.ZipFile(tmp_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(project.root.rglob("*")):
                rel = path.relative_to(project.root)
                if not rel.parts or rel.parts[0] not in included_roots:
                    continue
                if path.is_file():
                    archive.write(path, rel)
        shutil.move(tmp_zip, output)
    print(output)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rippo", description="Rippopotamus local media ingest engine")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="create a project workspace")
    init.add_argument("name")
    init.add_argument("--path")
    init.add_argument("--force", action="store_true")
    init.set_defaults(func=command_init)

    add = sub.add_parser("add", help="add one or more media URLs")
    add.add_argument("urls", nargs="+")
    add.set_defaults(func=command_add)

    fetch = sub.add_parser("fetch", help="fetch metadata for queued URLs")
    fetch.add_argument("--refresh", action="store_true")
    fetch.set_defaults(func=command_fetch)

    download = sub.add_parser("download", help="download fetched items")
    download.add_argument("--preset", default="mp4-best", choices=sorted(PRESETS))
    download.add_argument("--dry-run", action="store_true")
    download.set_defaults(func=command_download)

    manifest = sub.add_parser("manifest", help="write manifest.json")
    manifest.set_defaults(func=command_manifest)

    status = sub.add_parser("status", help="show project status")
    status.set_defaults(func=command_status)

    zip_cmd = sub.add_parser("zip", help="zip the project folder")
    zip_cmd.add_argument("--output")
    zip_cmd.set_defaults(func=command_zip)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
