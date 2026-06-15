from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


def download_ledger_path(root: Path) -> Path:
    return root / ".rippo-downloads.json"


class LedgerLoadError(Exception):
    """Raised when the download ledger exists but cannot be read as a dict."""


def load_download_ledger(root: Path) -> dict[str, Any]:
    path = download_ledger_path(root)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LedgerLoadError(str(exc)) from exc
    if not isinstance(payload, dict):
        raise LedgerLoadError("Ledger is not a JSON object.")
    return payload


def file_result(root: Path, path: Path) -> dict[str, Any]:
    relative = str(path.relative_to(root))
    try:
        size = path.stat().st_size
    except OSError:
        size = None
    return {"path": relative, "size": size}


def title_from_relative_path(rel_path: str) -> str:
    stem = Path(rel_path).stem
    if "--" in stem:
        stem = stem.rsplit("--", 1)[0]
    title = stem.replace("-", " ").strip()
    return title or stem or rel_path


def media_kind_for_path(rel_path: str) -> str:
    ext = Path(rel_path).suffix.lower()
    if ext in {".mp4", ".m4v", ".webm", ".mkv", ".mov", ".avi", ".ts", ".m2ts"}:
        return "video"
    if ext in {".mp3", ".m4a", ".aac", ".wav", ".flac", ".opus", ".ogg"}:
        return "audio"
    if ext in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".heic"}:
        return "image"
    if ext in {".pdf"}:
        return "document"
    return "file"


def library_entry_from_record(root: Path, key: str, record: dict[str, Any]) -> dict[str, Any] | None:
    url = record.get("url")
    preset = record.get("preset")
    paths = record.get("files")
    if not isinstance(url, str) or not isinstance(preset, str) or not isinstance(paths, list) or not paths:
        return None

    files: list[dict[str, Any]] = []
    saved_at = 0.0
    for rel in paths:
        if not isinstance(rel, str) or Path(rel).is_absolute():
            return None
        path = (root / rel).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            return None
        if not path.is_file():
            continue
        item = file_result(root, path)
        files.append(item)
        try:
            saved_at = max(saved_at, path.stat().st_mtime)
        except OSError:
            pass

    if not files:
        return None

    primary = max(files, key=lambda item: item.get("size") or 0)
    primary_path = str(primary.get("path") or files[0]["path"])
    total_size = sum(int(item["size"]) for item in files if isinstance(item.get("size"), int))
    return {
        "id": key,
        "url": url,
        "preset": preset,
        "title": title_from_relative_path(primary_path),
        "kind": media_kind_for_path(primary_path),
        "files": sorted(files, key=lambda item: item["path"]),
        "fileCount": len(files),
        "totalSize": total_size or None,
        "savedAt": saved_at or None,
        "primaryPath": primary_path,
    }


def _record_is_structurally_valid(root: Path, record: dict[str, Any]) -> bool:
    """True when a record has well-formed, in-root relative file paths.

    Such a record produces no entry only because the files have vanished from
    disk (counted as ``missing``), versus a malformed/escaping record
    (counted as ``skipped``).
    """
    url = record.get("url")
    preset = record.get("preset")
    paths = record.get("files")
    if not isinstance(url, str) or not isinstance(preset, str) or not isinstance(paths, list) or not paths:
        return False
    for rel in paths:
        if not isinstance(rel, str) or Path(rel).is_absolute():
            return False
        path = (root / rel).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            return False
    return True


def command_library_list(args: argparse.Namespace) -> int:
    root = Path(args.output_root).expanduser().resolve()
    try:
        ledger = load_download_ledger(root)
    except LedgerLoadError:
        emit({
            "ok": False,
            "outputRoot": str(root),
            "items": [],
            "total": 0,
            "error": "Library index is unreadable or corrupted.",
        })
        return 1

    items: list[dict[str, Any]] = []
    missing = 0
    skipped = 0
    for key, record in ledger.items():
        if not isinstance(record, dict):
            skipped += 1
            continue
        entry = library_entry_from_record(root, str(key), record)
        if entry:
            items.append(entry)
            continue
        if _record_is_structurally_valid(root, record):
            missing += 1
        else:
            skipped += 1

    items.sort(key=lambda item: item.get("savedAt") or 0, reverse=True)
    emit({
        "ok": True,
        "outputRoot": str(root),
        "items": items,
        "total": len(items),
        "missing": missing,
        "skipped": skipped,
    })
    return 0
