from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from rippopotamus.providers import friendly_error


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


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
    files = sorted(path.relative_to(root).as_posix() for path in after - before)
    emit({"type": "success", "files": files, "outputRoot": str(root), "warnings": []})
    return 0


def run_torrent_download(args: argparse.Namespace, root: Path, cmd: list[str]) -> int:
    return command_aria2_download(args, root, cmd)
