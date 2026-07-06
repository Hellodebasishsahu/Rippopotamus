from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class VideoChunk:
    chunk_path: Path
    source_path: Path
    start: float
    end: float


def configured_ffmpeg_path() -> str | None:
    configured = os.environ.get("RIPPO_FFMPEG_PATH", "").strip() or os.environ.get("RIPPO_FFMPEG_LOCATION", "").strip()
    if configured:
        return str(Path(configured).expanduser())
    return shutil.which("ffmpeg")


def configured_ffprobe_path() -> str | None:
    configured = os.environ.get("RIPPO_FFPROBE_PATH", "").strip()
    if configured:
        return str(Path(configured).expanduser())
    ffmpeg = configured_ffmpeg_path()
    if ffmpeg:
        candidate = Path(ffmpeg).with_name("ffprobe")
        if candidate.exists():
            return str(candidate)
    return shutil.which("ffprobe")


def _ffmpeg_can_write(path: str) -> bool:
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as handle:
            output_path = handle.name
        try:
            result = subprocess.run(
                [path, "-y", "-f", "lavfi", "-i", "nullsrc=s=2x2:d=0.1", "-frames:v", "1", output_path],
                capture_output=True,
                timeout=8,
            )
            return result.returncode == 0 and Path(output_path).stat().st_size > 0
        finally:
            Path(output_path).unlink(missing_ok=True)
    except Exception:
        return False


@lru_cache(maxsize=1)
def ffmpeg_executable() -> str:
    ffmpeg = configured_ffmpeg_path()
    if ffmpeg and _ffmpeg_can_write(ffmpeg):
        return ffmpeg
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise RuntimeError("ffmpeg is required for semantic video ingestion.") from exc


def video_duration(path: str | Path) -> float:
    resolved = Path(path).expanduser().resolve()
    ffprobe = configured_ffprobe_path()
    if ffprobe:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", str(resolved)],
            capture_output=True,
            text=True,
            check=True,
        )
        payload = json.loads(result.stdout or "{}")
        return float(payload["format"]["duration"])

    result = subprocess.run([ffmpeg_executable(), "-i", str(resolved)], capture_output=True, text=True, check=False)
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if not match:
        raise RuntimeError("Could not read video duration.")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def expected_video_spans(duration: float, chunk_duration: int = 30, overlap: int = 5) -> list[tuple[float, float]]:
    if chunk_duration <= 0:
        raise ValueError("chunk_duration must be greater than 0.")
    if overlap < 0:
        raise ValueError("overlap must be 0 or greater.")
    if overlap >= chunk_duration:
        raise ValueError("overlap must be less than chunk_duration.")
    if duration <= chunk_duration:
        return [(0.0, max(0.0, float(duration)))]

    spans: list[tuple[float, float]] = []
    start = 0.0
    step = chunk_duration - overlap
    while start < duration:
        end = min(start + chunk_duration, duration)
        spans.append((start, end))
        start += step
        if start + overlap >= duration:
            break
    return spans


def chunk_video(path: str | Path, *, chunk_duration: int = 30, overlap: int = 5) -> Iterator[VideoChunk]:
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"Video file not found: {resolved}")
    spans = expected_video_spans(video_duration(resolved), chunk_duration, overlap)
    tmp_dir = Path(tempfile.mkdtemp(prefix="rippo_chunks_"))
    try:
        for index, (start, end) in enumerate(spans):
            chunk_path = tmp_dir / f"chunk_{index:04d}.mp4"
            subprocess.run(
                [
                    ffmpeg_executable(),
                    "-y",
                    "-ss",
                    str(start),
                    "-i",
                    str(resolved),
                    "-t",
                    str(end - start),
                    "-c",
                    "copy",
                    str(chunk_path),
                ],
                capture_output=True,
                check=True,
            )
            yield VideoChunk(chunk_path=chunk_path, source_path=resolved, start=start, end=end)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def is_still_frame_chunk(path: str | Path, *, threshold: float = 0.98) -> bool:
    resolved = Path(path).expanduser().resolve()
    tmp_dir = Path(tempfile.mkdtemp(prefix="rippo_still_"))
    try:
        result = subprocess.run(
            [ffmpeg_executable(), "-i", str(resolved), "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
            capture_output=True,
            text=True,
            check=False,
        )
        frame_match = re.search(r"frame=\s*(\d+)", result.stderr)
        fps_match = re.search(r"(\d+(?:\.\d+)?)\s+fps", result.stderr)
        duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
        if frame_match:
            total_frames = int(frame_match.group(1))
        elif fps_match and duration_match:
            hours, minutes, seconds = duration_match.groups()
            duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
            total_frames = int(float(fps_match.group(1)) * duration)
        else:
            return False
        if total_frames < 3:
            return False

        first = total_frames // 3
        second = 2 * total_frames // 3
        output_pattern = tmp_dir / "frame_%03d.jpg"
        subprocess.run(
            [
                ffmpeg_executable(),
                "-y",
                "-i",
                str(resolved),
                "-vf",
                f"select=eq(n\\,0)+eq(n\\,{first})+eq(n\\,{second})",
                "-vsync",
                "vfr",
                str(output_pattern),
            ],
            capture_output=True,
            check=True,
        )
        sizes = [item.stat().st_size for item in sorted(tmp_dir.glob("*.jpg"))]
        if len(sizes) < 2:
            return False
        return min(sizes) / max(sizes) >= threshold if max(sizes) else False
    except Exception:
        return False
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def preprocess_video_chunk(path: str | Path, *, target_resolution: int = 480, target_fps: int = 5) -> Path:
    resolved = Path(path).expanduser().resolve()
    output = resolved.with_name(f"{resolved.stem}_preprocessed{resolved.suffix}")
    try:
        subprocess.run(
            [
                ffmpeg_executable(),
                "-y",
                "-i",
                str(resolved),
                "-vf",
                f"scale=-2:{target_resolution},fps={target_fps}",
                "-c:v",
                "libx264",
                "-crf",
                "28",
                "-c:a",
                "aac",
                "-b:a",
                "64k",
                str(output),
            ],
            capture_output=True,
            check=True,
        )
        return output
    except Exception:
        return resolved
