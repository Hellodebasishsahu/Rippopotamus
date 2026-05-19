"""Gemini 2.5 Flash captioner — uploads video via File API, returns scene-level narration."""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rippopotamus.gemini_embeddings import gemini_api_key


DEFAULT_MODEL = "gemini-2.5-flash"


@dataclass
class Moment:
    start: float
    end: float
    visual: str
    audio: str = ""
    search_terms: list[str] = field(default_factory=list)


class CaptionerError(RuntimeError):
    pass


def _get_client() -> Any:
    api_key, _ = gemini_api_key()
    if not api_key:
        raise CaptionerError("Set GEMINI_API_KEY or GOOGLE_API_KEY.")
    from google import genai
    return genai.Client(api_key=api_key)


def _model_name() -> str:
    return os.environ.get("RIPPO_CAPTIONER_MODEL", "").strip() or DEFAULT_MODEL


def _retry(fn: Any, *, max_retries: int = 3, initial_delay: float = 2.0) -> Any:
    delay = initial_delay
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as exc:
            message = str(exc).lower()
            status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            retryable = status in {429, 503} or "resource exhausted" in message or "429" in message
            if not retryable or attempt == max_retries:
                raise
            time.sleep(min(delay, 60.0))
            delay *= 2
    raise CaptionerError("Gemini request failed after retries.")


def _parse_timestamp(ts: str) -> float:
    """Parse 'M:SS' or 'H:MM:SS' to seconds."""
    parts = ts.strip().split(":")
    parts = [float(p) for p in parts]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return parts[0] if parts else 0.0


def _upload_video(client: Any, path: Path, emit: Any = None) -> Any:
    """Upload video to Gemini File API and wait until ACTIVE."""
    if emit:
        emit({"type": "upload_start", "path": str(path), "size": path.stat().st_size})

    uploaded = client.files.upload(file=path)

    while uploaded.state.name == "PROCESSING":
        time.sleep(2)
        uploaded = client.files.get(name=uploaded.name)

    if uploaded.state.name != "ACTIVE":
        raise CaptionerError(f"File upload failed: state={uploaded.state.name}")

    if emit:
        emit({"type": "upload_done", "name": uploaded.name, "uri": uploaded.uri})

    return uploaded


NARRATE_PROMPT = (
    'You are indexing this video for an editorial search engine. '
    'Editors will search with phrases like "close-up of speaker on mic", '
    '"crowd clapping", "banner in frame", "drone shot of venue".\n\n'
    'Watch the full video and extract every visually distinct moment. For each moment:\n'
    '- One sentence describing exactly what is visible (camera angle, subjects, actions, objects, text).\n'
    '- Do NOT describe the same thing twice. If a scene continues unchanged, extend its end time.\n'
    '- Include audio context only if someone is speaking or there is a notable sound.\n\n'
    'JSON array only:\n'
    '[\n'
    '  {\n'
    '    "start": "0:00",\n'
    '    "end": "0:42",\n'
    '    "visual": "description here",\n'
    '    "audio": "speech or sound summary",\n'
    '    "searchTerms": ["tag1", "tag2"]\n'
    '  }\n'
    ']'
)


def narrate_video(
    path: Path,
    *,
    model: str | None = None,
    emit: Any = None,
) -> list[Moment]:
    """Upload video via File API and get scene-level narration in one pass."""
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(str(resolved))

    client = _get_client()
    model_name = model or _model_name()

    uploaded = _upload_video(client, resolved, emit=emit)

    if emit:
        emit({"type": "narrate_start", "model": model_name})

    from google.genai import types

    response = _retry(lambda: client.models.generate_content(
        model=model_name,
        contents=[
            types.Content(parts=[
                types.Part.from_uri(file_uri=uploaded.uri, mime_type=uploaded.mime_type),
                types.Part.from_text(text=NARRATE_PROMPT),
            ]),
        ],
        config=types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
        ),
    ))

    try:
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        items = json.loads(text)
    except (json.JSONDecodeError, AttributeError) as exc:
        raise CaptionerError(f"Failed to parse Gemini response: {exc}")

    if not isinstance(items, list):
        raise CaptionerError(f"Expected JSON array, got {type(items).__name__}")

    moments: list[Moment] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            moments.append(Moment(
                start=_parse_timestamp(str(item.get("start", "0:00"))),
                end=_parse_timestamp(str(item.get("end", "0:00"))),
                visual=str(item.get("visual", "")).strip(),
                audio=str(item.get("audio", "")).strip(),
                search_terms=[str(t).strip() for t in item.get("searchTerms", []) if str(t).strip()],
            ))
        except (TypeError, ValueError):
            continue

    moments = [m for m in moments if m.visual]

    if emit:
        emit({"type": "narrate_done", "moments": len(moments)})

    return moments
