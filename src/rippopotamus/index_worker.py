from __future__ import annotations

import hashlib
import json
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from rippopotamus.footage_index import (
    clean_title,
    connect_index,
    delete_asset_moments,
    discover_media,
    index_counts,
    index_db_path,
    insert_moment,
    media_kind,
    upsert_asset,
)
from rippopotamus.gemini_embeddings import GEMINI_EMBEDDING_VIDEO_MAX_SECONDS, GeminiEmbedder, gemini_embedding_status
from rippopotamus.video_chunker import (
    chunk_video,
    expected_video_spans,
    is_still_frame_chunk,
    preprocess_video_chunk,
)


SEMANTIC_IMAGE_KINDS = {"image"}
SEMANTIC_VIDEO_KINDS = {"video"}


@dataclass(frozen=True)
class SemanticIngestOptions:
    chunk_duration: int = 30
    overlap: int = 5
    preprocess: bool = True
    target_resolution: int = 480
    target_fps: int = 5
    skip_still: bool = True


def format_time(seconds: float | int | None) -> str:
    if seconds is None:
        return "00:00"
    total = max(0, int(float(seconds)))
    minutes, secs = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def semantic_moment_id(asset_id: str, start: float | None, end: float | None, kind: str, provider: str, model: str, dimensions: int) -> str:
    basis = json.dumps([asset_id, start, end, kind, provider, model, dimensions], sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:24]


def append_dlq(index_root: Path, payload: dict[str, Any]) -> None:
    dlq_path = index_root / ".rippo" / "index-dlq.jsonl"
    dlq_path.parent.mkdir(parents=True, exist_ok=True)
    with dlq_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True, sort_keys=True) + "\n")


def moment_exists(conn: Any, moment_id: str) -> bool:
    row = conn.execute("SELECT 1 FROM moments WHERE id = ?", (moment_id,)).fetchone()
    return row is not None


def semantic_image_moment_payload(asset: dict[str, Any], path: Path, embedding: list[float], embedder: GeminiEmbedder) -> dict[str, Any]:
    title = clean_title(path)
    return {
        "id": semantic_moment_id(asset["id"], 0.0, None, "image", embedder.provider, embedder.model, embedder.dimensions),
        "asset_id": asset["id"],
        "path": asset["path"],
        "start": 0.0,
        "end": None,
        "title": title,
        "description": f"{title} image {path.suffix.lower().lstrip('.')}",
        "tags": ["image", path.suffix.lower().lstrip("."), path.parent.name],
        "embedding": embedding,
        "embeddingProvider": embedder.provider,
        "embeddingModel": embedder.model,
        "embeddingDimensions": embedder.dimensions,
    }


def semantic_video_moment_payload(
    asset: dict[str, Any],
    path: Path,
    start: float,
    end: float,
    embedding: list[float],
    embedder: GeminiEmbedder,
) -> dict[str, Any]:
    title = clean_title(path)
    return {
        "id": semantic_moment_id(asset["id"], start, end, "video", embedder.provider, embedder.model, embedder.dimensions),
        "asset_id": asset["id"],
        "path": asset["path"],
        "start": start,
        "end": end,
        "title": title,
        "description": f"{title} video moment {format_time(start)} to {format_time(end)}",
        "tags": ["video", "clip", path.suffix.lower().lstrip("."), path.parent.name],
        "embedding": embedding,
        "embeddingProvider": embedder.provider,
        "embeddingModel": embedder.model,
        "embeddingDimensions": embedder.dimensions,
    }


def existing_video_moment_ids(asset: dict[str, Any], embedder: GeminiEmbedder, options: SemanticIngestOptions) -> list[str]:
    duration = asset.get("duration")
    if not isinstance(duration, (int, float)) or duration <= 0:
        return []
    return [
        semantic_moment_id(asset["id"], start, end, "video", embedder.provider, embedder.model, embedder.dimensions)
        for start, end in expected_video_spans(float(duration), options.chunk_duration, options.overlap)
    ]


def semantic_options_error(options: SemanticIngestOptions, provider: str) -> str | None:
    if options.chunk_duration <= 0:
        return "Chunk duration must be greater than 0."
    if options.overlap < 0:
        return "Overlap must be 0 or greater."
    if options.overlap >= options.chunk_duration:
        return "Overlap must be less than chunk duration."
    if provider == "gemini" and options.chunk_duration > GEMINI_EMBEDDING_VIDEO_MAX_SECONDS:
        return f"Gemini Embedding 2 supports video chunks up to {GEMINI_EMBEDDING_VIDEO_MAX_SECONDS} seconds."
    return None


def semantic_ingest_paths(
    index_root: str | Path,
    inputs: list[str | Path],
    *,
    options: SemanticIngestOptions | None = None,
    embedder: GeminiEmbedder | None = None,
) -> dict[str, Any]:
    root = Path(index_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    options = options or SemanticIngestOptions()
    status = gemini_embedding_status()
    try:
        active_embedder = embedder or GeminiEmbedder(model=status.model, dimensions=status.dimensions)
    except Exception as exc:
        with closing(connect_index(root)) as conn:
            counts = index_counts(conn)
        return {
            "ok": False,
            "indexRoot": str(root),
            "dbPath": str(index_db_path(root)),
            "semantic": True,
            "embedded": 0,
            "videoChunks": 0,
            "imageCount": 0,
            "failed": 1,
            "skipped": 0,
            "skippedEntries": [],
            "embeddingProvider": "gemini",
            "embeddingModel": status.model,
            "embeddingDimensions": status.dimensions,
            "error": str(exc),
            **counts,
        }

    option_error = semantic_options_error(options, active_embedder.provider)
    if option_error:
        with closing(connect_index(root)) as conn:
            counts = index_counts(conn)
        return {
            "ok": False,
            "indexRoot": str(root),
            "dbPath": str(index_db_path(root)),
            "semantic": True,
            "embedded": 0,
            "videoChunks": 0,
            "imageCount": 0,
            "failed": 0,
            "skipped": 0,
            "skippedEntries": [],
            "embeddingProvider": active_embedder.provider,
            "embeddingModel": active_embedder.model,
            "embeddingDimensions": active_embedder.dimensions,
            "error": option_error,
            **counts,
        }

    media_paths, skipped_entries = discover_media(inputs)
    embedded = 0
    video_chunks = 0
    image_count = 0
    failed_entries: list[dict[str, str]] = []

    with closing(connect_index(root)) as conn:
        for path in media_paths:
            kind = media_kind(path)
            if kind not in SEMANTIC_IMAGE_KINDS | SEMANTIC_VIDEO_KINDS:
                skipped_entries.append({"path": str(path), "reason": f"{kind or 'file'} semantic ingestion is not supported yet"})
                continue

            try:
                asset = upsert_asset(conn, root, path, replace_default_moment=False)
                if asset["state"] == "updated":
                    delete_asset_moments(conn, asset["id"])

                if kind == "image":
                    moment_id = semantic_moment_id(asset["id"], 0.0, None, "image", active_embedder.provider, active_embedder.model, active_embedder.dimensions)
                    if asset["state"] == "unchanged" and moment_exists(conn, moment_id):
                        skipped_entries.append({"path": str(path), "reason": "already embedded"})
                        continue
                    embedding = active_embedder.embed_image_document(path)
                    insert_moment(conn, semantic_image_moment_payload(asset, path, embedding, active_embedder))
                    embedded += 1
                    image_count += 1
                    conn.commit()
                    continue

                known_ids = existing_video_moment_ids(asset, active_embedder, options)
                if asset["state"] == "unchanged" and known_ids and all(moment_exists(conn, moment_id) for moment_id in known_ids):
                    skipped_entries.append({"path": str(path), "reason": "already embedded"})
                    continue

                for chunk in chunk_video(path, chunk_duration=options.chunk_duration, overlap=options.overlap):
                    moment_id = semantic_moment_id(asset["id"], chunk.start, chunk.end, "video", active_embedder.provider, active_embedder.model, active_embedder.dimensions)
                    if asset["state"] == "unchanged" and moment_exists(conn, moment_id):
                        skipped_entries.append({"path": str(path), "reason": f"chunk {format_time(chunk.start)} already embedded"})
                        continue
                    if options.skip_still and is_still_frame_chunk(chunk.chunk_path):
                        skipped_entries.append({"path": str(path), "reason": f"chunk {format_time(chunk.start)} looked still"})
                        continue
                    embed_path = (
                        preprocess_video_chunk(
                            chunk.chunk_path,
                            target_resolution=options.target_resolution,
                            target_fps=options.target_fps,
                        )
                        if options.preprocess
                        else chunk.chunk_path
                    )
                    embedding = active_embedder.embed_video_document(embed_path)
                    insert_moment(conn, semantic_video_moment_payload(asset, path, chunk.start, chunk.end, embedding, active_embedder))
                    embedded += 1
                    video_chunks += 1
                    conn.commit()
            except Exception as exc:
                failure = {"path": str(path), "reason": str(exc)}
                failed_entries.append(failure)
                append_dlq(root, failure)

        counts = index_counts(conn)

    return {
        "ok": True,
        "indexRoot": str(root),
        "dbPath": str(index_db_path(root)),
        "semantic": True,
        "embedded": embedded,
        "videoChunks": video_chunks,
        "imageCount": image_count,
        "failed": len(failed_entries),
        "failedEntries": failed_entries,
        "skipped": len(skipped_entries),
        "skippedEntries": skipped_entries,
        "embeddingProvider": active_embedder.provider,
        "embeddingModel": active_embedder.model,
        "embeddingDimensions": active_embedder.dimensions,
        "chunkDuration": options.chunk_duration,
        "overlap": options.overlap,
        **counts,
    }
