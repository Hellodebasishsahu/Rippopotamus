from __future__ import annotations

import json
import subprocess
from typing import Any

from rippopotamus.providers import yt_dlp_base
from rippopotamus.resolvers.base import PlayableLink

SEARCH_LIMIT = 6
SUBPROCESS_TIMEOUT = 12


class YtDlpYouTubeAdapter:
    name = "yt_dlp_youtube"

    def search(self, title: str, year: int | None, imdb_id: str | None) -> list[PlayableLink]:
        query = f"{title} {year}".strip() if year else title
        if not query:
            return []

        try:
            base = yt_dlp_base()
        except SystemExit:
            return []

        command = [
            *base,
            "--ignore-config",
            "--flat-playlist",
            "--dump-json",
            "--skip-download",
            "--no-warnings",
            "--quiet",
            "--default-search",
            "ytsearch",
            f"ytsearch{SEARCH_LIMIT}:{query}",
        ]

        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=SUBPROCESS_TIMEOUT)
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return []

        links: list[PlayableLink] = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            link = _entry_to_link(entry)
            if link:
                links.append(link)
        return links


def _entry_to_link(entry: dict[str, Any]) -> PlayableLink | None:
    video_id = entry.get("id")
    if not isinstance(video_id, str) or not video_id:
        return None
    title = entry.get("title") or video_id
    duration = entry.get("duration")
    uploader = entry.get("uploader") or entry.get("channel")
    parts = [str(uploader)] if uploader else []
    if isinstance(duration, (int, float)) and duration > 0:
        parts.append(_format_duration(int(duration)))
    quality_label = " · ".join(parts) if parts else None

    return PlayableLink(
        url=f"https://www.youtube.com/watch?v={video_id}",
        host="youtube.com",
        label=str(title),
        kind="video",
        quality=quality_label,
        extension=None,
        source_adapter="yt_dlp_youtube",
    )


def _format_duration(seconds: int) -> str:
    if seconds >= 3600:
        return f"{seconds // 3600}h {seconds % 3600 // 60}m"
    if seconds >= 60:
        return f"{seconds // 60}m"
    return f"{seconds}s"
