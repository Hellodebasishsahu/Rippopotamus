from __future__ import annotations

import os
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_GEMINI_EMBED_MODEL = "gemini-embedding-2"
DEFAULT_EMBEDDING_DIMENSIONS = 768
DEFAULT_REQUESTS_PER_MINUTE = 55
GEMINI_EMBEDDING_VIDEO_MAX_SECONDS = 120
GEMINI_EMBEDDING_RECOMMENDED_DIMENSIONS = (768, 1536, 3072)


class GeminiEmbeddingError(RuntimeError):
    pass


class GeminiEmbeddingUnavailable(GeminiEmbeddingError):
    pass


class GeminiEmbeddingQuotaError(GeminiEmbeddingError):
    pass


@dataclass(frozen=True)
class GeminiEmbeddingStatus:
    configured: bool
    model: str
    dimensions: int
    api_key_env: str | None


class _RateLimiter:
    def __init__(self, max_per_minute: int = DEFAULT_REQUESTS_PER_MINUTE) -> None:
        self.max_per_minute = max_per_minute
        self.timestamps: deque[float] = deque()

    def wait(self) -> None:
        now = time.monotonic()
        while self.timestamps and now - self.timestamps[0] >= 60:
            self.timestamps.popleft()
        if len(self.timestamps) >= self.max_per_minute:
            sleep_for = 60.0 - (now - self.timestamps[0])
            if sleep_for > 0:
                time.sleep(sleep_for)
        self.timestamps.append(time.monotonic())


def embedding_model() -> str:
    return os.environ.get("RIPPO_GEMINI_EMBED_MODEL", "").strip() or DEFAULT_GEMINI_EMBED_MODEL


def embedding_dimensions() -> int:
    raw = os.environ.get("RIPPO_GEMINI_EMBED_DIMENSIONS", "").strip()
    if not raw:
        return DEFAULT_EMBEDDING_DIMENSIONS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_EMBEDDING_DIMENSIONS
    return value if value > 0 else DEFAULT_EMBEDDING_DIMENSIONS


def gemini_api_key() -> tuple[str | None, str | None]:
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value, name
    return None, None


def gemini_embedding_status() -> GeminiEmbeddingStatus:
    _api_key, env_name = gemini_api_key()
    return GeminiEmbeddingStatus(
        configured=env_name is not None,
        model=embedding_model(),
        dimensions=embedding_dimensions(),
        api_key_env=env_name,
    )


def _retry(fn: Any, *, max_retries: int = 5, initial_delay: float = 2.0, max_delay: float = 60.0) -> Any:
    delay = initial_delay
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as exc:
            message = str(exc).lower()
            status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            retryable = status in {429, 503} or "resource exhausted" in message or "429" in message or "503" in message
            if not retryable or attempt == max_retries:
                if status == 429 or "resource exhausted" in message:
                    raise GeminiEmbeddingQuotaError("Gemini Embedding rate limit exceeded. Wait and retry.") from exc
                raise
            time.sleep(min(delay, max_delay))
            delay *= 2
    raise GeminiEmbeddingError("Gemini embedding request failed.")


class GeminiEmbedder:
    provider = "gemini"

    def __init__(self, *, model: str | None = None, dimensions: int | None = None, requests_per_minute: int = DEFAULT_REQUESTS_PER_MINUTE) -> None:
        api_key, env_name = gemini_api_key()
        if not api_key:
            raise GeminiEmbeddingUnavailable("Set GEMINI_API_KEY or GOOGLE_API_KEY to enable semantic ingestion.")
        try:
            from google import genai
            from google.genai import types
        except Exception as exc:
            raise GeminiEmbeddingUnavailable("Install google-genai to enable Gemini semantic ingestion.") from exc

        self.model = model or embedding_model()
        self.dimensions = dimensions or embedding_dimensions()
        self.api_key_env = env_name
        self._client = genai.Client(api_key=api_key)
        self._types = types
        self._limiter = _RateLimiter(max_per_minute=requests_per_minute)

    def embed_text_query(self, query: str) -> list[float]:
        text = query.strip()
        if not text:
            return []
        return self._embed(
            text,
            task_type="RETRIEVAL_QUERY",
        )

    def embed_text_document(self, text: str) -> list[float]:
        document = text.strip()
        if not document:
            return []
        return self._embed(
            document,
            task_type="RETRIEVAL_DOCUMENT",
        )

    def embed_image_document(self, path: str | Path) -> list[float]:
        return self._embed_file(path, task_type="RETRIEVAL_DOCUMENT")

    def embed_image_query(self, path: str | Path) -> list[float]:
        return self._embed_file(path, task_type="RETRIEVAL_QUERY")

    def embed_video_document(self, path: str | Path) -> list[float]:
        return self._embed_file(path, task_type="RETRIEVAL_DOCUMENT", mime_type="video/mp4")

    def _embed_file(self, path: str | Path, *, task_type: str, mime_type: str | None = None) -> list[float]:
        resolved = Path(path).expanduser().resolve()
        if not resolved.is_file():
            raise FileNotFoundError(f"File not found: {resolved}")
        data = resolved.read_bytes()
        part = self._part_from_bytes(data, mime_type or mime_type_for_path(resolved))
        return self._embed(self._types.Content(parts=[part]), task_type=task_type)

    def _embed(self, contents: Any, *, task_type: str) -> list[float]:
        self._limiter.wait()
        response = _retry(
            lambda: self._client.models.embed_content(
                model=self.model,
                contents=contents,
                config=self._types.EmbedContentConfig(
                    task_type=task_type,
                    output_dimensionality=self.dimensions,
                ),
            )
        )
        values = response.embeddings[0].values
        return [float(value) for value in values]

    def _part_from_bytes(self, data: bytes, mime_type: str) -> Any:
        if hasattr(self._types.Part, "from_bytes"):
            return self._types.Part.from_bytes(data=data, mime_type=mime_type)
        return self._types.Part(inline_data=self._types.Blob(data=data, mime_type=mime_type))


def mime_type_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    if suffix == ".heic":
        return "image/heic"
    if suffix == ".heif":
        return "image/heif"
    if suffix == ".mov":
        return "video/quicktime"
    if suffix == ".mp4":
        return "video/mp4"
    if suffix == ".mp3":
        return "audio/mpeg"
    if suffix == ".m4a":
        return "audio/mp4"
    if suffix == ".wav":
        return "audio/wav"
    return "application/octet-stream"
