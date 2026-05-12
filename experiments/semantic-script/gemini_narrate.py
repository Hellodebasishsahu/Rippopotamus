from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from rippopotamus.video_chunker import VideoChunk, chunk_video  # noqa: E402


DEFAULT_MODEL = "gemini-2.5-flash-lite"


NARRATION_PROMPT = """You are indexing footage for video editors.

Return strict JSON only. No markdown.

Describe the provided video chunk as timestamped searchable moments.
Use relative timestamps inside this chunk, starting from 0.
Prefer short, literal, searchable descriptions.
Capture visible actions, scene type, people count, shot type, readable text, audio/speech if understandable, and compact tags.

Schema:
{
  "moments": [
    {
      "start": number,
      "end": number,
      "visual": "one sentence visual description",
      "audio": "spoken words or audio summary, empty string if none",
      "visible_text": ["text visible on screen"],
      "tags": ["search", "tags"],
      "shot_type": "wide | medium | close | aerial | screen | unknown",
      "people_count": "none | one person | small group | large crowd | unknown"
    }
  ]
}
"""


def load_env_file(path: str | Path = ".env") -> None:
    env_path = Path(path).expanduser()
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass(frozen=True)
class NarrationChunk:
    chunk_path: Path
    source_path: Path
    start: float
    end: float


def chunk_to_narration_chunk(chunk: VideoChunk) -> NarrationChunk:
    return NarrationChunk(chunk_path=chunk.chunk_path, source_path=chunk.source_path, start=chunk.start, end=chunk.end)


def extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start < 0 or end <= start:
            raise
        payload = json.loads(stripped[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("Gemini narration response must be a JSON object.")
    return payload


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def clean_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = clean_text(item)
        if text and text not in out:
            out.append(text)
    return out


def safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number >= 0 else fallback


def normalize_moments(payload: dict[str, Any], chunk: NarrationChunk) -> list[dict[str, Any]]:
    raw_moments = payload.get("moments")
    if not isinstance(raw_moments, list):
        raw_moments = [payload]
    normalized: list[dict[str, Any]] = []
    chunk_duration = max(0.0, chunk.end - chunk.start)
    for raw in raw_moments:
        if not isinstance(raw, dict):
            continue
        rel_start = min(safe_float(raw.get("start")), chunk_duration)
        rel_end = min(safe_float(raw.get("end"), chunk_duration), chunk_duration)
        if rel_end < rel_start:
            rel_end = rel_start
        normalized.append({
            "start": round(chunk.start + rel_start, 3),
            "end": round(chunk.start + rel_end, 3),
            "visual": clean_text(raw.get("visual")),
            "audio": clean_text(raw.get("audio")),
            "visible_text": clean_string_list(raw.get("visible_text")),
            "tags": clean_string_list(raw.get("tags")),
            "shot_type": clean_text(raw.get("shot_type")) or "unknown",
            "people_count": clean_text(raw.get("people_count")) or "unknown",
        })
    if not normalized:
        normalized.append({
            "start": round(chunk.start, 3),
            "end": round(chunk.end, 3),
            "visual": "",
            "audio": "",
            "visible_text": [],
            "tags": [],
            "shot_type": "unknown",
            "people_count": "unknown",
        })
    return normalized


class GeminiNarrator:
    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        prompt: str = NARRATION_PROMPT,
        env_file: str | Path | None = None,
    ) -> None:
        load_env_file(env_file or REPO_ROOT / ".env")
        api_key = os.environ.get("GEMINI_API_KEY", "").strip() or os.environ.get("GOOGLE_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("Set GEMINI_API_KEY or GOOGLE_API_KEY to run Gemini narration.")
        try:
            from google import genai
            from google.genai import types
        except Exception as exc:
            raise RuntimeError("Install google-genai to run Gemini narration.") from exc

        self.model = model
        self.prompt = prompt
        self._client = genai.Client(api_key=api_key)
        self._types = types

    def narrate_chunk(self, chunk: NarrationChunk) -> dict[str, Any]:
        data = chunk.chunk_path.read_bytes()
        part = self._types.Part.from_bytes(data=data, mime_type="video/mp4")
        response = self._client.models.generate_content(
            model=self.model,
            contents=[self.prompt, part],
            config=self._types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        text = getattr(response, "text", "") or ""
        return extract_json_object(text)


def output_record(source_path: Path, chunk: NarrationChunk, payload: dict[str, Any], *, model: str) -> dict[str, Any]:
    return {
        "asset_path": str(source_path.expanduser().resolve()),
        "source": f"gemini:{model}",
        "chunk": {
            "start": round(chunk.start, 3),
            "end": round(chunk.end, 3),
            "path": str(chunk.chunk_path),
        },
        "moments": normalize_moments(payload, chunk),
    }


def narrate_video(
    video_path: str | Path,
    out_path: str | Path,
    *,
    narrator: GeminiNarrator,
    chunk_duration: int = 30,
    overlap: int = 5,
    limit_chunks: int | None = None,
) -> dict[str, Any]:
    source = Path(video_path).expanduser().resolve()
    out = Path(out_path).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = out.with_suffix(out.suffix + ".tmp")
    written = 0
    try:
        with tmp_out.open("w", encoding="utf-8") as handle:
            for index, raw_chunk in enumerate(chunk_video(source, chunk_duration=chunk_duration, overlap=overlap)):
                if limit_chunks is not None and index >= limit_chunks:
                    break
                chunk = chunk_to_narration_chunk(raw_chunk)
                payload = narrator.narrate_chunk(chunk)
                record = output_record(source, chunk, payload, model=narrator.model)
                handle.write(json.dumps(record, ensure_ascii=True, sort_keys=True) + "\n")
                written += 1
        tmp_out.replace(out)
    except Exception:
        tmp_out.unlink(missing_ok=True)
        raise
    return {
        "ok": True,
        "video": str(source),
        "out": str(out),
        "chunks": written,
        "model": narrator.model,
        "chunkDuration": chunk_duration,
        "overlap": overlap,
    }


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


def command_narrate(args: argparse.Namespace) -> int:
    narrator = GeminiNarrator(model=args.model, env_file=args.env_file)
    emit(narrate_video(
        args.video,
        args.out,
        narrator=narrator,
        chunk_duration=args.chunk_duration,
        overlap=args.overlap,
        limit_chunks=args.limit_chunks,
    ))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="gemini_narrate.py")
    parser.add_argument("--video", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--env-file", help="Optional .env file containing GEMINI_API_KEY or GOOGLE_API_KEY.")
    parser.add_argument("--chunk-duration", type=int, default=30)
    parser.add_argument("--overlap", type=int, default=5)
    parser.add_argument("--limit-chunks", type=int)
    parser.set_defaults(func=command_narrate)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
