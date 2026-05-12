from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request

from rippopotamus.gemini_embeddings import GeminiEmbedder, gemini_embedding_status


MEDIA_EXTENSIONS: dict[str, str] = {
    ".3gp": "video",
    ".avi": "video",
    ".m4v": "video",
    ".mkv": "video",
    ".mov": "video",
    ".mp4": "video",
    ".mpeg": "video",
    ".mpg": "video",
    ".webm": "video",
    ".aac": "audio",
    ".flac": "audio",
    ".m4a": "audio",
    ".mp3": "audio",
    ".ogg": "audio",
    ".wav": "audio",
    ".avif": "image",
    ".gif": "image",
    ".jpeg": "image",
    ".jpg": "image",
    ".png": "image",
    ".tif": "image",
    ".tiff": "image",
    ".webp": "image",
}

SKIPPED_DIRS = {".git", ".rippo", "node_modules", "__pycache__"}
DEFAULT_VECTOR_MIN_SCORE = 0.2


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def index_db_path(index_root: str | Path) -> Path:
    root = Path(index_root).expanduser().resolve()
    return root / ".rippo" / "index.sqlite3"


def media_kind(path: Path) -> str | None:
    return MEDIA_EXTENSIONS.get(path.suffix.lower())


def asset_id_for_path(path: Path) -> str:
    return hashlib.sha1(str(path.expanduser().resolve()).encode("utf-8")).hexdigest()[:20]


def moment_id(asset_id: str, start: float | int | None, end: float | int | None, description: str) -> str:
    basis = json.dumps([asset_id, start, end, description], sort_keys=True)
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:24]


def clean_title(path: Path) -> str:
    title = re.sub(r"[-_.]+", " ", path.stem).strip()
    title = re.sub(r"\s+", " ", title)
    return title or path.name


def safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def safe_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def safe_score(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(number):
        return fallback
    return max(-1.0, min(1.0, number))


def json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def decoded_json_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return [text]
        if isinstance(parsed, list):
            return parsed
        if parsed is None:
            return []
        return [parsed]
    return [value]


def normalized_tags(value: Any) -> list[str]:
    tags: list[str] = []
    for item in json_list(value):
        text = str(item).strip()
        if text and text not in tags:
            tags.append(text)
    return tags


def vector_from_value(value: Any) -> list[float] | None:
    if isinstance(value, dict):
        value = value.get("embedding") or value.get("vector")
    if not isinstance(value, list):
        return None
    vector: list[float] = []
    for item in value:
        try:
            number = float(item)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(number):
            return None
        vector.append(number)
    return vector or None


def ffprobe_path() -> str | None:
    configured = os.environ.get("RIPPO_FFPROBE_PATH", "").strip()
    if configured:
        return configured
    ffmpeg = os.environ.get("RIPPO_FFMPEG_PATH", "").strip() or os.environ.get("RIPPO_FFMPEG_LOCATION", "").strip()
    if ffmpeg:
        candidate = Path(ffmpeg).expanduser().with_name("ffprobe")
        if candidate.exists():
            return str(candidate)
    return shutil.which("ffprobe")


def ffprobe_metadata(path: Path) -> dict[str, Any]:
    probe = ffprobe_path()
    if not probe:
        return {}
    try:
        result = subprocess.run(
            [
                probe,
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=width,height,duration,codec_type",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=12,
        )
    except Exception:
        return {}
    if result.returncode != 0:
        return {}
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return {}

    streams = payload.get("streams") if isinstance(payload.get("streams"), list) else []
    video_stream = next((stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "video"), {})
    format_payload = payload.get("format") if isinstance(payload.get("format"), dict) else {}
    return {
        "duration": safe_float(format_payload.get("duration")) or safe_float(video_stream.get("duration")),
        "width": safe_int(video_stream.get("width")),
        "height": safe_int(video_stream.get("height")),
    }


def connect_index(index_root: str | Path) -> sqlite3.Connection:
    db_path = index_db_path(index_root)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            root TEXT NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            size INTEGER NOT NULL,
            mtime REAL NOT NULL,
            duration REAL,
            width INTEGER,
            height INTEGER,
            indexed_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS moments (
            id TEXT PRIMARY KEY,
            asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            start REAL,
            end REAL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            embedding_json TEXT,
            updated_at TEXT NOT NULL
        )
    """)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(moments)").fetchall()}
    if "embedding_provider" not in columns:
        conn.execute("ALTER TABLE moments ADD COLUMN embedding_provider TEXT")
    if "embedding_model" not in columns:
        conn.execute("ALTER TABLE moments ADD COLUMN embedding_model TEXT")
    if "embedding_dim" not in columns:
        conn.execute("ALTER TABLE moments ADD COLUMN embedding_dim INTEGER")
    try:
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS moments_fts USING fts5(
                moment_id UNINDEXED,
                asset_id UNINDEXED,
                path UNINDEXED,
                title,
                description,
                tags
            )
        """)
    except sqlite3.OperationalError:
        pass
    conn.commit()


def fts_available(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT name FROM sqlite_master WHERE name = 'moments_fts'").fetchone()
    return row is not None


def replace_fts(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    if not fts_available(conn):
        return
    conn.execute("DELETE FROM moments_fts WHERE moment_id = ?", (payload["id"],))
    conn.execute(
        "INSERT INTO moments_fts(moment_id, asset_id, path, title, description, tags) VALUES (?, ?, ?, ?, ?, ?)",
        (
            payload["id"],
            payload["asset_id"],
            payload["path"],
            payload["title"],
            payload["description"],
            " ".join(payload["tags"]),
        ),
    )


def delete_asset_moments(conn: sqlite3.Connection, asset_id: str) -> None:
    if fts_available(conn):
        for row in conn.execute("SELECT id FROM moments WHERE asset_id = ?", (asset_id,)):
            conn.execute("DELETE FROM moments_fts WHERE moment_id = ?", (row["id"],))
    conn.execute("DELETE FROM moments WHERE asset_id = ?", (asset_id,))


def upsert_asset(conn: sqlite3.Connection, root: Path, path: Path, *, replace_default_moment: bool) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    stat = resolved.stat()
    kind = media_kind(resolved) or "file"
    metadata = ffprobe_metadata(resolved) if kind in {"video", "audio", "image"} else {}
    asset_id = asset_id_for_path(resolved)
    title = clean_title(resolved)
    indexed_at = now_iso()
    existing = conn.execute("SELECT size, mtime FROM assets WHERE id = ?", (asset_id,)).fetchone()
    state = "added"
    if existing:
        if int(existing["size"]) == stat.st_size and float(existing["mtime"]) == stat.st_mtime:
            state = "unchanged"
        else:
            state = "updated"

    conn.execute(
        """
        INSERT INTO assets(id, path, root, kind, title, size, mtime, duration, width, height, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            path = excluded.path,
            root = excluded.root,
            kind = excluded.kind,
            title = excluded.title,
            size = excluded.size,
            mtime = excluded.mtime,
            duration = excluded.duration,
            width = excluded.width,
            height = excluded.height,
            indexed_at = excluded.indexed_at
        """,
        (
            asset_id,
            str(resolved),
            str(root),
            kind,
            title,
            stat.st_size,
            stat.st_mtime,
            metadata.get("duration"),
            metadata.get("width"),
            metadata.get("height"),
            indexed_at,
        ),
    )

    default_moments = conn.execute("SELECT COUNT(*) AS count FROM moments WHERE asset_id = ?", (asset_id,)).fetchone()["count"]
    should_replace = replace_default_moment and (state in {"added", "updated"} or default_moments == 0)
    if should_replace:
        delete_asset_moments(conn, asset_id)
        description = default_moment_description(resolved, kind, metadata)
        insert_moment(conn, {
            "id": f"{asset_id}:full",
            "asset_id": asset_id,
            "path": str(resolved),
            "start": 0.0,
            "end": metadata.get("duration"),
            "title": title,
            "description": description,
            "tags": [kind, resolved.suffix.lower().lstrip("."), *resolved.parent.name.split()],
            "embedding": None,
        })

    return {
        "id": asset_id,
        "path": str(resolved),
        "kind": kind,
        "title": title,
        "duration": metadata.get("duration"),
        "width": metadata.get("width"),
        "height": metadata.get("height"),
        "state": state,
    }


def default_moment_description(path: Path, kind: str, metadata: dict[str, Any]) -> str:
    parts = [clean_title(path), kind, path.suffix.lower().lstrip(".")]
    folder = path.parent.name
    if folder:
        parts.append(folder)
    width = metadata.get("width")
    height = metadata.get("height")
    if width and height:
        parts.append(f"{width}x{height}")
    duration = metadata.get("duration")
    if duration:
        parts.append(f"{round(float(duration), 1)} seconds")
    return " ".join(str(part) for part in parts if part)


def insert_moment(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    tags = normalized_tags(payload.get("tags"))
    embedding = vector_from_value(payload.get("embedding"))
    embedding_provider = str(payload.get("embeddingProvider") or payload.get("embedding_provider") or "").strip() or None
    embedding_model = str(payload.get("embeddingModel") or payload.get("embedding_model") or "").strip() or None
    embedding_dim = safe_int(payload.get("embeddingDimensions") or payload.get("embedding_dim")) or (len(embedding) if embedding else None)
    record = {
        "id": str(payload["id"]),
        "asset_id": str(payload["asset_id"]),
        "path": str(payload["path"]),
        "start": safe_float(payload.get("start")),
        "end": safe_float(payload.get("end")),
        "title": str(payload.get("title") or clean_title(Path(str(payload["path"])))),
        "description": str(payload.get("description") or ""),
        "tags": tags,
        "embedding_json": json.dumps(embedding, separators=(",", ":")) if embedding else None,
        "embedding_provider": embedding_provider,
        "embedding_model": embedding_model,
        "embedding_dim": embedding_dim,
        "updated_at": now_iso(),
    }
    conn.execute(
        """
        INSERT INTO moments(
            id,
            asset_id,
            path,
            start,
            end,
            title,
            description,
            tags_json,
            embedding_json,
            embedding_provider,
            embedding_model,
            embedding_dim,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            asset_id = excluded.asset_id,
            path = excluded.path,
            start = excluded.start,
            end = excluded.end,
            title = excluded.title,
            description = excluded.description,
            tags_json = excluded.tags_json,
            embedding_json = excluded.embedding_json,
            embedding_provider = excluded.embedding_provider,
            embedding_model = excluded.embedding_model,
            embedding_dim = excluded.embedding_dim,
            updated_at = excluded.updated_at
        """,
        (
            record["id"],
            record["asset_id"],
            record["path"],
            record["start"],
            record["end"],
            record["title"],
            record["description"],
            json.dumps(tags, ensure_ascii=True),
            record["embedding_json"],
            record["embedding_provider"],
            record["embedding_model"],
            record["embedding_dim"],
            record["updated_at"],
        ),
    )
    replace_fts(conn, record)


def discover_media(inputs: list[str | Path]) -> tuple[list[Path], list[dict[str, str]]]:
    paths: list[Path] = []
    skipped: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in inputs:
        candidate = Path(raw).expanduser()
        if not candidate.exists():
            skipped.append({"path": str(candidate), "reason": "missing"})
            continue
        if candidate.is_file():
            if media_kind(candidate):
                resolved = candidate.resolve()
                key = str(resolved)
                if key not in seen:
                    seen.add(key)
                    paths.append(resolved)
            else:
                skipped.append({"path": str(candidate), "reason": "unsupported file type"})
            continue
        if not candidate.is_dir():
            skipped.append({"path": str(candidate), "reason": "unsupported path"})
            continue
        for path in candidate.rglob("*"):
            rel_parts = path.relative_to(candidate).parts
            if any(part in SKIPPED_DIRS or part.startswith(".") for part in rel_parts):
                continue
            if not path.is_file() or not media_kind(path):
                continue
            resolved = path.resolve()
            key = str(resolved)
            if key in seen:
                continue
            seen.add(key)
            paths.append(resolved)
    return sorted(paths), skipped


def index_counts(conn: sqlite3.Connection) -> dict[str, int]:
    assets = conn.execute("SELECT COUNT(*) AS count FROM assets").fetchone()["count"]
    moments = conn.execute("SELECT COUNT(*) AS count FROM moments").fetchone()["count"]
    embeddings = conn.execute("SELECT COUNT(*) AS count FROM moments WHERE embedding_json IS NOT NULL").fetchone()["count"]
    return {"assetCount": int(assets), "momentCount": int(moments), "embeddedMomentCount": int(embeddings)}


def index_status(index_root: str | Path) -> dict[str, Any]:
    root = Path(index_root).expanduser().resolve()
    gemini_status = gemini_embedding_status()
    with closing(connect_index(root)) as conn:
        counts = index_counts(conn)
    return {
        "ok": True,
        "indexRoot": str(root),
        "dbPath": str(index_db_path(root)),
        "embeddingEndpointConfigured": bool(os.environ.get("RIPPO_INDEX_EMBEDDING_ENDPOINT", "").strip()),
        "geminiEmbeddingConfigured": gemini_status.configured,
        "geminiEmbeddingModel": gemini_status.model,
        "embeddingDimensions": gemini_status.dimensions,
        **counts,
    }


def ingest_paths(index_root: str | Path, inputs: list[str | Path]) -> dict[str, Any]:
    root = Path(index_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    media_paths, skipped_entries = discover_media(inputs)
    indexed: list[dict[str, Any]] = []
    with closing(connect_index(root)) as conn:
        for path in media_paths:
            indexed.append(upsert_asset(conn, root, path, replace_default_moment=True))
        conn.commit()
        counts = index_counts(conn)

    added = sum(1 for item in indexed if item["state"] == "added")
    updated = sum(1 for item in indexed if item["state"] == "updated")
    unchanged = sum(1 for item in indexed if item["state"] == "unchanged")
    return {
        "ok": True,
        "indexRoot": str(root),
        "dbPath": str(index_db_path(root)),
        "indexed": indexed,
        "added": added,
        "updated": updated,
        "unchanged": unchanged,
        "skipped": len(skipped_entries),
        "skippedEntries": skipped_entries,
        **counts,
    }


def upsert_moments(index_root: str | Path, payload: dict[str, Any]) -> dict[str, Any]:
    root = Path(index_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    items = payload.get("moments") if isinstance(payload.get("moments"), list) else []
    upserted = 0
    skipped: list[dict[str, str]] = []
    with closing(connect_index(root)) as conn:
        for item in items:
            if not isinstance(item, dict):
                skipped.append({"path": "", "reason": "moment is not an object"})
                continue
            raw_path = item.get("path") or item.get("assetPath")
            if not isinstance(raw_path, str) or not raw_path.strip():
                skipped.append({"path": "", "reason": "missing path"})
                continue
            path = Path(raw_path).expanduser()
            if not path.exists() or not path.is_file():
                skipped.append({"path": str(path), "reason": "missing file"})
                continue
            asset = upsert_asset(conn, root, path, replace_default_moment=False)
            start = safe_float(item.get("start"))
            end = safe_float(item.get("end"))
            description = str(item.get("description") or item.get("caption") or "")
            payload_id = item.get("id")
            insert_moment(conn, {
                "id": str(payload_id) if payload_id else moment_id(asset["id"], start, end, description),
                "asset_id": asset["id"],
                "path": asset["path"],
                "start": start,
                "end": end,
                "title": item.get("title") or asset["title"],
                "description": description,
                "tags": item.get("tags") or [],
                "embedding": item.get("embedding") or item.get("vector"),
                "embeddingProvider": item.get("embeddingProvider") or item.get("embedding_provider"),
                "embeddingModel": item.get("embeddingModel") or item.get("embedding_model"),
                "embeddingDimensions": item.get("embeddingDimensions") or item.get("embedding_dim"),
            })
            upserted += 1
        conn.commit()
        counts = index_counts(conn)
    return {
        "ok": True,
        "indexRoot": str(root),
        "dbPath": str(index_db_path(root)),
        "upserted": upserted,
        "skipped": len(skipped),
        "skippedEntries": skipped,
        **counts,
    }


def semantic_script_import_key(semantic_db: Path) -> str:
    return hashlib.sha1(str(semantic_db.expanduser().resolve()).encode("utf-8")).hexdigest()[:10]


def semantic_script_columns(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("PRAGMA table_info(scripts)").fetchall()
    return {str(row[1]) for row in rows}


def semantic_script_select_columns(columns: set[str]) -> str:
    required = [
        "id",
        "asset_path",
        "start",
        "end",
        "visual",
        "audio",
        "visible_text_json",
        "tags_json",
        "shot_type",
        "people_count",
        "source",
        "embedding_json",
    ]
    select = [name if name in columns else f"NULL AS {name}" for name in required]
    for name in ("embedding_provider", "embedding_model", "embedding_dim"):
        select.append(name if name in columns else f"NULL AS {name}")
    return ", ".join(select)


def semantic_script_moment_text(row: sqlite3.Row) -> tuple[str, list[str]]:
    visual = str(row["visual"] or "").strip()
    audio = str(row["audio"] or "").strip()
    visible_text = [str(item).strip() for item in decoded_json_list(row["visible_text_json"]) if str(item).strip()]
    tags = normalized_tags(decoded_json_list(row["tags_json"]))
    shot_type = str(row["shot_type"] or "").strip()
    people_count = str(row["people_count"] or "").strip()

    parts = []
    if visual:
        parts.append(visual)
    if audio:
        parts.append(f"Audio: {audio}")
    if visible_text:
        parts.append(f"Visible text: {'; '.join(visible_text)}")
    if shot_type:
        parts.append(f"Shot: {shot_type}")
    if people_count:
        parts.append(f"People: {people_count}")

    for item in [*visible_text, shot_type, people_count]:
        if item and item not in tags:
            tags.append(item)
    return " ".join(parts).strip(), tags


def import_semantic_script_index(index_root: str | Path, semantic_db: str | Path) -> dict[str, Any]:
    root = Path(index_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    source_db = Path(semantic_db).expanduser().resolve()
    if not source_db.exists():
        return {
            "ok": False,
            "error": f"Semantic script index not found: {source_db}",
            "indexRoot": str(root),
            "sourceDb": str(source_db),
            "imported": 0,
            "skipped": 0,
            "skippedEntries": [],
        }

    skipped: list[dict[str, str]] = []
    imported = 0
    source_key = semantic_script_import_key(source_db)
    with closing(sqlite3.connect(f"{source_db.as_uri()}?mode=ro", uri=True)) as source:
        source.row_factory = sqlite3.Row
        table = source.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scripts'").fetchone()
        if not table:
            return {
                "ok": False,
                "error": "Semantic script index has no scripts table.",
                "indexRoot": str(root),
                "sourceDb": str(source_db),
                "imported": 0,
                "skipped": 0,
                "skippedEntries": [],
            }
        columns = semantic_script_columns(source)
        rows = source.execute(f"SELECT {semantic_script_select_columns(columns)} FROM scripts").fetchall()

    with closing(connect_index(root)) as target:
        for row in rows:
            raw_path = str(row["asset_path"] or "").strip()
            if not raw_path:
                skipped.append({"path": "", "reason": "missing asset path"})
                continue
            path = Path(raw_path).expanduser()
            if not path.exists() or not path.is_file():
                skipped.append({"path": str(path), "reason": "missing file"})
                continue
            asset = upsert_asset(target, root, path, replace_default_moment=False)
            description, tags = semantic_script_moment_text(row)
            vector = vector_from_value(decoded_json_list(row["embedding_json"]))
            script_id = str(row["id"] or moment_id(asset["id"], row["start"], row["end"], description))
            insert_moment(target, {
                "id": f"semantic-script:{source_key}:{script_id}",
                "asset_id": asset["id"],
                "path": asset["path"],
                "start": row["start"],
                "end": row["end"],
                "title": asset["title"],
                "description": description or asset["title"],
                "tags": tags,
                "embedding": vector,
                "embeddingProvider": row["embedding_provider"],
                "embeddingModel": row["embedding_model"],
                "embeddingDimensions": row["embedding_dim"],
            })
            imported += 1
        target.commit()
        counts = index_counts(target)

    return {
        "ok": True,
        "indexRoot": str(root),
        "dbPath": str(index_db_path(root)),
        "sourceDb": str(source_db),
        "imported": imported,
        "skipped": len(skipped),
        "skippedEntries": skipped,
        **counts,
    }


def parse_embedding_response(payload: Any) -> list[float] | None:
    if isinstance(payload, list):
        return vector_from_value(payload)
    if not isinstance(payload, dict):
        return None
    direct = vector_from_value(payload.get("embedding") or payload.get("vector"))
    if direct:
        return direct
    data = payload.get("data")
    if isinstance(data, list) and data:
        return vector_from_value(data[0])
    return None


def query_embedding(query: str) -> list[float] | None:
    payload = query_embedding_payload(query)
    return payload.get("vector") if payload else None


def endpoint_query_embedding(query: str) -> list[float] | None:
    endpoint = os.environ.get("RIPPO_INDEX_EMBEDDING_ENDPOINT", "").strip()
    if not endpoint or not query.strip():
        return None
    body = json.dumps({"input": query, "kind": "text"}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "Rippopotamus/0.1 index"}
    token = os.environ.get("RIPPO_INDEX_EMBEDDING_KEY", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    timeout = safe_float(os.environ.get("RIPPO_INDEX_EMBEDDING_TIMEOUT")) or 20.0
    try:
        req = request.Request(endpoint, data=body, headers=headers, method="POST")
        with request.urlopen(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None
    return parse_embedding_response(payload)


def query_embedding_payload(query: str) -> dict[str, Any] | None:
    endpoint_vector = endpoint_query_embedding(query)
    if endpoint_vector:
        return {"vector": endpoint_vector, "provider": None, "model": None, "dimensions": len(endpoint_vector), "source": "endpoint"}
    if not query.strip():
        return None
    try:
        embedder = GeminiEmbedder()
        vector = embedder.embed_text_query(query)
    except Exception:
        return None
    if not vector:
        return None
    return {
        "vector": vector,
        "provider": embedder.provider,
        "model": embedder.model,
        "dimensions": len(vector),
        "source": "gemini",
    }


def cosine_similarity(left: list[float], right: list[float]) -> float | None:
    if not left or len(left) != len(right):
        return None
    dot = sum(a * b for a, b in zip(left, right))
    left_mag = math.sqrt(sum(a * a for a in left))
    right_mag = math.sqrt(sum(b * b for b in right))
    if left_mag == 0 or right_mag == 0:
        return None
    return dot / (left_mag * right_mag)


def row_payload(row: sqlite3.Row, score: float, match_type: str) -> dict[str, Any]:
    tags = json.loads(row["tags_json"] or "[]")
    return {
        "id": row["moment_id"],
        "assetId": row["asset_id"],
        "path": row["path"],
        "file": Path(row["path"]).name,
        "kind": row["kind"],
        "title": row["title"],
        "start": row["start"],
        "end": row["end"],
        "description": row["description"],
        "tags": tags if isinstance(tags, list) else [],
        "score": round(float(score), 6),
        "matchType": match_type,
        "duration": row["duration"],
        "width": row["width"],
        "height": row["height"],
        "embeddingProvider": row["embedding_provider"] if "embedding_provider" in row.keys() else None,
        "embeddingModel": row["embedding_model"] if "embedding_model" in row.keys() else None,
    }


def tokenize_query(query: str) -> list[str]:
    return [token.lower() for token in re.findall(r"[a-zA-Z0-9]+", query) if len(token) > 1]


def fts_query(tokens: list[str]) -> str:
    return " OR ".join(f"{token}*" for token in tokens)


def vector_search(
    conn: sqlite3.Connection,
    query_vector: list[float],
    limit: int,
    *,
    embedding_provider: str | None = None,
    embedding_model: str | None = None,
    min_score: float = DEFAULT_VECTOR_MIN_SCORE,
) -> list[dict[str, Any]]:
    filters = ["moments.embedding_json IS NOT NULL"]
    params: list[Any] = []
    if embedding_provider:
        filters.append("moments.embedding_provider = ?")
        params.append(embedding_provider)
    if embedding_model:
        filters.append("moments.embedding_model = ?")
        params.append(embedding_model)
    rows = conn.execute(
        f"""
        SELECT
            moments.id AS moment_id,
            moments.asset_id,
            moments.path,
            moments.start,
            moments.end,
            moments.title,
            moments.description,
            moments.tags_json,
            moments.embedding_json,
            moments.embedding_provider,
            moments.embedding_model,
            assets.kind,
            assets.duration,
            assets.width,
            assets.height
        FROM moments
        JOIN assets ON assets.id = moments.asset_id
        WHERE {" AND ".join(filters)}
        """,
        params,
    ).fetchall()
    ranked: list[tuple[float, sqlite3.Row]] = []
    for row in rows:
        try:
            vector = vector_from_value(json.loads(row["embedding_json"] or "null"))
        except json.JSONDecodeError:
            vector = None
        score = cosine_similarity(query_vector, vector or [])
        if score is not None and score >= min_score:
            ranked.append((score, row))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [row_payload(row, score, "embedding") for score, row in ranked[:limit]]


def lexical_search(conn: sqlite3.Connection, query: str, limit: int) -> list[dict[str, Any]]:
    tokens = tokenize_query(query)
    if not tokens:
        rows = conn.execute(
            """
            SELECT
                moments.id AS moment_id,
                moments.asset_id,
                moments.path,
                moments.start,
                moments.end,
                moments.title,
                moments.description,
                moments.tags_json,
                moments.embedding_provider,
                moments.embedding_model,
                assets.kind,
                assets.duration,
                assets.width,
                assets.height
            FROM moments
            JOIN assets ON assets.id = moments.asset_id
            ORDER BY moments.updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [row_payload(row, 0.0, "recent") for row in rows]

    if fts_available(conn):
        try:
            rows = conn.execute(
                """
                SELECT
                    moments.id AS moment_id,
                    moments.asset_id,
                    moments.path,
                    moments.start,
                    moments.end,
                    moments.title,
                    moments.description,
                    moments.tags_json,
                    moments.embedding_provider,
                    moments.embedding_model,
                    assets.kind,
                    assets.duration,
                    assets.width,
                    assets.height,
                    bm25(moments_fts) AS rank
                FROM moments_fts
                JOIN moments ON moments.id = moments_fts.moment_id
                JOIN assets ON assets.id = moments.asset_id
                WHERE moments_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (fts_query(tokens), limit),
            ).fetchall()
            return [row_payload(row, 1.0 / (index + 1), "text") for index, row in enumerate(rows)]
        except sqlite3.OperationalError:
            pass

    rows = conn.execute(
        """
        SELECT
            moments.id AS moment_id,
            moments.asset_id,
            moments.path,
            moments.start,
            moments.end,
            moments.title,
            moments.description,
            moments.tags_json,
            moments.embedding_provider,
            moments.embedding_model,
            assets.kind,
            assets.duration,
            assets.width,
            assets.height
        FROM moments
        JOIN assets ON assets.id = moments.asset_id
        """
    ).fetchall()
    ranked: list[tuple[int, sqlite3.Row]] = []
    for row in rows:
        haystack = " ".join([
            row["title"] or "",
            row["description"] or "",
            row["tags_json"] or "",
            row["path"] or "",
        ]).lower()
        score = sum(haystack.count(token) for token in tokens)
        if score > 0:
            ranked.append((score, row))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [row_payload(row, score, "text") for score, row in ranked[:limit]]


def search_index(index_root: str | Path, query: str, limit: int = 20, query_vector: list[float] | None = None) -> dict[str, Any]:
    root = Path(index_root).expanduser().resolve()
    safe_limit = max(1, min(int(limit or 20), 100))
    query_payload = None if query_vector else query_embedding_payload(query)
    vector = query_vector or (query_payload.get("vector") if query_payload else None)
    min_score = safe_score(os.environ.get("RIPPO_INDEX_VECTOR_MIN_SCORE"), DEFAULT_VECTOR_MIN_SCORE)
    with closing(connect_index(root)) as conn:
        results = (
            vector_search(
                conn,
                vector,
                safe_limit,
                embedding_provider=query_payload.get("provider") if query_payload else None,
                embedding_model=query_payload.get("model") if query_payload else None,
                min_score=min_score,
            )
            if vector
            else []
        )
        if not results:
            results = lexical_search(conn, query, safe_limit)
        counts = index_counts(conn)
    gemini_status = gemini_embedding_status()
    return {
        "ok": True,
        "query": query,
        "indexRoot": str(root),
        "dbPath": str(index_db_path(root)),
        "results": results,
        "resultCount": len(results),
        "embeddingEndpointConfigured": bool(os.environ.get("RIPPO_INDEX_EMBEDDING_ENDPOINT", "").strip()),
        "geminiEmbeddingConfigured": gemini_status.configured,
        "geminiEmbeddingModel": gemini_status.model,
        "embeddingDimensions": gemini_status.dimensions,
        "queryEmbeddingSource": query_payload.get("source") if query_payload else ("manual" if query_vector else None),
        "vectorMinScore": min_score,
        **counts,
    }
