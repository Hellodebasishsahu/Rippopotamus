from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


DB_FILENAME = "semantic-script.sqlite3"
EMBED_DIM = 64
EMBED_MIN_SCORE = 0.2
SEMANTIC_ONLY_MIN_SCORE = 0.6
LOCAL_EMBED_PROVIDER = "local-hash"
LOCAL_EMBED_MODEL = "sha1-token-v1"
GEMINI_EMBED_PROVIDER = "gemini"
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "for",
    "from",
    "in",
    "inside",
    "is",
    "of",
    "on",
    "the",
    "to",
    "with",
}

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from rippopotamus.gemini_embeddings import (  # noqa: E402
    DEFAULT_EMBEDDING_DIMENSIONS,
    DEFAULT_GEMINI_EMBED_MODEL,
    GeminiEmbedder,
    GeminiEmbeddingUnavailable,
    gemini_embedding_status,
)


def nowless_id(parts: Iterable[Any]) -> str:
    payload = json.dumps(list(parts), sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:24]


def db_path(index_root: str | Path) -> Path:
    root = Path(index_root).expanduser().resolve()
    return root / ".rippo" / DB_FILENAME


def connect(index_root: str | Path) -> sqlite3.Connection:
    path = db_path(index_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scripts (
            id TEXT PRIMARY KEY,
            asset_path TEXT NOT NULL,
            start REAL NOT NULL,
            end REAL NOT NULL,
            visual TEXT NOT NULL,
            audio TEXT NOT NULL,
            visible_text_json TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            shot_type TEXT NOT NULL,
            people_count TEXT NOT NULL,
            source TEXT NOT NULL,
            embedding_json TEXT,
            embedding_provider TEXT,
            embedding_model TEXT,
            embedding_dim INTEGER
        )
    """)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(scripts)").fetchall()}
    if "embedding_provider" not in columns:
        conn.execute("ALTER TABLE scripts ADD COLUMN embedding_provider TEXT")
    if "embedding_model" not in columns:
        conn.execute("ALTER TABLE scripts ADD COLUMN embedding_model TEXT")
    if "embedding_dim" not in columns:
        conn.execute("ALTER TABLE scripts ADD COLUMN embedding_dim INTEGER")
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS scripts_fts USING fts5(
            script_id UNINDEXED,
            asset_path UNINDEXED,
            visual,
            audio,
            visible_text,
            tags,
            shot_type,
            people_count
        )
    """)
    conn.commit()


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


def text_from_mapping(value: Any, keys: Iterable[str]) -> list[str]:
    if not isinstance(value, dict):
        return []
    return [clean_text(value.get(key)) for key in keys if clean_text(value.get(key))]


def describes_no_people(text: Any) -> bool:
    normalized = clean_text(text).lower()
    if not normalized:
        return False
    return (
        normalized in {"none", "unknown", "no people", "no visible people"}
        or "no people" in normalized
        or "no visible people" in normalized
        or "no person" in normalized
        or "people are not visible" in normalized
        or "people are clearly visible" in normalized and "no people" in normalized
    )


def people_terms(value: Any) -> list[str]:
    if not isinstance(value, dict):
        return []
    terms: list[str] = []
    count = clean_text(value.get("count"))
    description = clean_text(value.get("description"))
    if count and not describes_no_people(count):
        terms.append(count)
    if description and not describes_no_people(description):
        terms.append(description)
    return terms


def rich_memory_terms(payload: dict[str, Any]) -> list[str]:
    terms: list[str] = []
    terms.extend(clean_string_list(payload.get("actions")))
    terms.extend(clean_string_list(payload.get("objects")))
    terms.extend(clean_string_list(payload.get("setting")))
    terms.extend(clean_string_list(payload.get("mood")))
    terms.extend(clean_string_list(payload.get("editor_use")))
    terms.extend(clean_string_list(payload.get("search_phrases")))
    terms.extend(people_terms(payload.get("people")))
    terms.extend(text_from_mapping(payload.get("shot"), ("type", "camera_motion", "composition")))
    out: list[str] = []
    for term in terms:
        if term and term not in out:
            out.append(term)
    return out


def safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def tokenize(text: str) -> list[str]:
    return [
        token.lower()
        for token in re.findall(r"[a-zA-Z0-9]+", text)
        if len(token) > 1 and token.lower() not in STOPWORDS
    ]


def hashed_embedding(text: str, dimensions: int = EMBED_DIM) -> list[float]:
    vector = [0.0] * dimensions
    for token in tokenize(text):
        digest = hashlib.sha1(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = -1.0 if digest[4] % 2 else 1.0
        vector[index] += sign
    magnitude = math.sqrt(sum(value * value for value in vector))
    if not magnitude:
        return vector
    return [value / magnitude for value in vector]


def load_env_file(path: str | Path | None) -> None:
    if not path:
        return
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


def cosine(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


@dataclass(frozen=True)
class ScriptMoment:
    asset_path: str
    start: float
    end: float
    visual: str
    audio: str
    visible_text: list[str]
    tags: list[str]
    shot_type: str
    people_count: str
    source: str = "manual"

    @property
    def id(self) -> str:
        return nowless_id([self.asset_path, self.start, self.end, self.visual, self.audio])

    @property
    def searchable_text(self) -> str:
        return " ".join([
            self.visual,
            self.audio,
            " ".join(self.visible_text),
            " ".join(self.tags),
            self.shot_type,
            self.people_count,
            self.asset_path,
        ]).strip()


@dataclass(frozen=True)
class EmbeddedText:
    vector: list[float]
    provider: str
    model: str
    dimensions: int


class LocalHashEmbedder:
    provider = LOCAL_EMBED_PROVIDER
    model = LOCAL_EMBED_MODEL
    dimensions = EMBED_DIM

    def embed_document(self, text: str) -> list[float]:
        return hashed_embedding(text, self.dimensions)

    def embed_query(self, text: str) -> list[float]:
        return hashed_embedding(text, self.dimensions)


class GeminiTextEmbedder:
    provider = GEMINI_EMBED_PROVIDER

    def __init__(self, *, model: str | None = None, dimensions: int | None = None) -> None:
        self._embedder = GeminiEmbedder(
            model=model or DEFAULT_GEMINI_EMBED_MODEL,
            dimensions=dimensions or DEFAULT_EMBEDDING_DIMENSIONS,
        )
        self.model = self._embedder.model
        self.dimensions = self._embedder.dimensions

    def embed_document(self, text: str) -> list[float]:
        return self._embedder.embed_text_document(text)

    def embed_query(self, text: str) -> list[float]:
        return self._embedder.embed_text_query(text)


def build_embedder(provider: str = "auto", *, model: str | None = None, dimensions: int | None = None) -> Any | None:
    normalized = provider.strip().lower()
    if normalized == "none":
        return None
    if normalized == "local":
        return LocalHashEmbedder()
    if normalized == "gemini":
        return GeminiTextEmbedder(model=model, dimensions=dimensions)
    if normalized == "auto":
        status = gemini_embedding_status()
        if status.configured:
            try:
                return GeminiTextEmbedder(model=model or status.model, dimensions=dimensions or status.dimensions)
            except GeminiEmbeddingUnavailable:
                return LocalHashEmbedder()
        return LocalHashEmbedder()
    raise ValueError(f"Unknown embedding provider: {provider}")


def embed_document_text(text: str, embedder: Any | None) -> EmbeddedText | None:
    if embedder is None:
        return None
    vector = embedder.embed_document(text)
    if not vector:
        return None
    return EmbeddedText(
        vector=[float(value) for value in vector],
        provider=str(embedder.provider),
        model=str(embedder.model),
        dimensions=int(embedder.dimensions),
    )


def moment_from_payload(payload: dict[str, Any], default_asset_path: str = "", default_source: str = "manual") -> ScriptMoment:
    asset_path = clean_text(payload.get("asset_path") or payload.get("path") or default_asset_path)
    if not asset_path:
        raise ValueError("script moment is missing asset_path")
    start = safe_float(payload.get("start"))
    end = safe_float(payload.get("end"), start)
    if end < start:
        end = start
    summary = clean_text(payload.get("summary"))
    visual = clean_text(payload.get("visual"))
    if summary and summary not in visual:
        visual = f"{summary} {visual}".strip()
    tags = clean_string_list(payload.get("tags"))
    for term in rich_memory_terms(payload):
        if term not in tags:
            tags.append(term)
    people_count = clean_text(payload.get("people_count"))
    if not people_count and isinstance(payload.get("people"), dict):
        people_count = clean_text(payload["people"].get("count"))
    shot_type = clean_text(payload.get("shot_type"))
    if not shot_type and isinstance(payload.get("shot"), dict):
        shot_type = clean_text(payload["shot"].get("type"))
    return ScriptMoment(
        asset_path=asset_path,
        start=start,
        end=end,
        visual=visual,
        audio=clean_text(payload.get("audio")),
        visible_text=clean_string_list(payload.get("visible_text")),
        tags=tags,
        shot_type=shot_type,
        people_count=people_count,
        source=clean_text(payload.get("source") or default_source) or default_source,
    )


def iter_moments_from_jsonl(path: str | Path) -> Iterable[ScriptMoment]:
    source_path = Path(path).expanduser()
    with source_path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            payload = json.loads(text)
            if not isinstance(payload, dict):
                raise ValueError(f"line {line_number}: expected JSON object")
            default_asset_path = clean_text(payload.get("asset_path") or payload.get("path"))
            source = clean_text(payload.get("source")) or "jsonl"
            moments = payload.get("moments")
            if isinstance(moments, list):
                for item in moments:
                    if not isinstance(item, dict):
                        raise ValueError(f"line {line_number}: moment must be an object")
                    yield moment_from_payload(item, default_asset_path=default_asset_path, default_source=source)
            else:
                yield moment_from_payload(payload, default_asset_path=default_asset_path, default_source=source)


def upsert_moment(conn: sqlite3.Connection, moment: ScriptMoment, *, embedder: Any | None = None) -> None:
    embedded = embed_document_text(moment.searchable_text, embedder)
    conn.execute(
        """
        INSERT INTO scripts(
            id,
            asset_path,
            start,
            end,
            visual,
            audio,
            visible_text_json,
            tags_json,
            shot_type,
            people_count,
            source,
            embedding_json,
            embedding_provider,
            embedding_model,
            embedding_dim
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            asset_path = excluded.asset_path,
            start = excluded.start,
            end = excluded.end,
            visual = excluded.visual,
            audio = excluded.audio,
            visible_text_json = excluded.visible_text_json,
            tags_json = excluded.tags_json,
            shot_type = excluded.shot_type,
            people_count = excluded.people_count,
            source = excluded.source,
            embedding_json = excluded.embedding_json,
            embedding_provider = excluded.embedding_provider,
            embedding_model = excluded.embedding_model,
            embedding_dim = excluded.embedding_dim
        """,
        (
            moment.id,
            moment.asset_path,
            moment.start,
            moment.end,
            moment.visual,
            moment.audio,
            json.dumps(moment.visible_text, ensure_ascii=True),
            json.dumps(moment.tags, ensure_ascii=True),
            moment.shot_type,
            moment.people_count,
            moment.source,
            json.dumps(embedded.vector, separators=(",", ":")) if embedded else None,
            embedded.provider if embedded else None,
            embedded.model if embedded else None,
            embedded.dimensions if embedded else None,
        ),
    )
    conn.execute("DELETE FROM scripts_fts WHERE script_id = ?", (moment.id,))
    conn.execute(
        """
        INSERT INTO scripts_fts(script_id, asset_path, visual, audio, visible_text, tags, shot_type, people_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            moment.id,
            moment.asset_path,
            moment.visual,
            moment.audio,
            " ".join(moment.visible_text),
            " ".join(moment.tags),
            moment.shot_type,
            moment.people_count,
        ),
    )


def import_jsonl(index_root: str | Path, jsonl_path: str | Path, *, embedder: Any | None = None) -> dict[str, Any]:
    imported = 0
    active_embedder = embedder if embedder is not None else LocalHashEmbedder()
    with closing(connect(index_root)) as conn:
        for moment in iter_moments_from_jsonl(jsonl_path):
            upsert_moment(conn, moment, embedder=active_embedder)
            imported += 1
        conn.commit()
    return {
        "ok": True,
        "indexRoot": str(Path(index_root).expanduser().resolve()),
        "dbPath": str(db_path(index_root)),
        "imported": imported,
        "embeddingProvider": active_embedder.provider if active_embedder else None,
        "embeddingModel": active_embedder.model if active_embedder else None,
        "embeddingDimensions": active_embedder.dimensions if active_embedder else None,
    }


def row_to_result(row: sqlite3.Row, score: float, match_type: str) -> dict[str, Any]:
    return {
        "id": row["id"],
        "assetPath": row["asset_path"],
        "start": row["start"],
        "end": row["end"],
        "visual": row["visual"],
        "audio": row["audio"],
        "visibleText": json.loads(row["visible_text_json"] or "[]"),
        "tags": json.loads(row["tags_json"] or "[]"),
        "shotType": row["shot_type"],
        "peopleCount": row["people_count"],
        "source": row["source"],
        "score": round(score, 6),
        "matchType": match_type,
        "embeddingProvider": row["embedding_provider"] if "embedding_provider" in row.keys() else None,
        "embeddingModel": row["embedding_model"] if "embedding_model" in row.keys() else None,
        "embeddingDimensions": row["embedding_dim"] if "embedding_dim" in row.keys() else None,
    }


def fts_query(query: str) -> str:
    tokens = tokenize(query)
    return " OR ".join(f"{token}*" for token in tokens)


def lexical_search(conn: sqlite3.Connection, query: str, limit: int) -> list[dict[str, Any]]:
    if not tokenize(query):
        rows = conn.execute("SELECT * FROM scripts ORDER BY start LIMIT ?", (limit,)).fetchall()
        return [row_to_result(row, 0.0, "recent") for row in rows]
    try:
        rows = conn.execute(
            """
            SELECT scripts.*, bm25(scripts_fts) AS rank
            FROM scripts_fts
            JOIN scripts ON scripts.id = scripts_fts.script_id
            WHERE scripts_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts_query(query), limit),
        ).fetchall()
        return [row_to_result(row, 1.0 / (index + 1), "text") for index, row in enumerate(rows)]
    except sqlite3.OperationalError:
        return []


def row_embedding_group(row: sqlite3.Row, vector: list[float]) -> tuple[str, str, int]:
    provider = clean_text(row["embedding_provider"] if "embedding_provider" in row.keys() else "") or LOCAL_EMBED_PROVIDER
    model = clean_text(row["embedding_model"] if "embedding_model" in row.keys() else "") or LOCAL_EMBED_MODEL
    dimensions = int(row["embedding_dim"] if "embedding_dim" in row.keys() and row["embedding_dim"] else len(vector))
    return provider, model, dimensions


def query_embedder_for_group(provider: str, model: str, dimensions: int, explicit_embedder: Any | None) -> Any | None:
    if explicit_embedder is not None:
        if provider == explicit_embedder.provider and model == explicit_embedder.model and dimensions == explicit_embedder.dimensions:
            return explicit_embedder
        return None
    if provider == LOCAL_EMBED_PROVIDER:
        return LocalHashEmbedder()
    if provider == GEMINI_EMBED_PROVIDER:
        try:
            return GeminiTextEmbedder(model=model, dimensions=dimensions)
        except GeminiEmbeddingUnavailable:
            return None
    return None


def embedding_search(conn: sqlite3.Connection, query: str, limit: int, *, query_embedder: Any | None = None) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM scripts WHERE embedding_json IS NOT NULL").fetchall()
    ranked: list[tuple[float, sqlite3.Row]] = []
    query_vectors: dict[tuple[str, str, int], list[float]] = {}
    for row in rows:
        try:
            vector = json.loads(row["embedding_json"] or "[]")
        except json.JSONDecodeError:
            vector = []
        if not vector:
            continue
        group = row_embedding_group(row, vector)
        if group not in query_vectors:
            embedder = query_embedder_for_group(*group, explicit_embedder=query_embedder)
            query_vectors[group] = embedder.embed_query(query) if embedder else []
        query_vector = query_vectors[group]
        if not query_vector:
            continue
        ranked.append((cosine(query_vector, vector), row))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [row_to_result(row, score, "embedding") for score, row in ranked[:limit] if score >= EMBED_MIN_SCORE]


def rerank(query: str, candidates: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    tokens = set(tokenize(query))
    reranked: list[tuple[float, dict[str, Any]]] = []
    for index, candidate in enumerate(candidates):
        visual = clean_text(candidate.get("visual"))
        audio = clean_text(candidate.get("audio"))
        visible_text = " ".join(clean_string_list(candidate.get("visibleText")))
        tags = " ".join(clean_string_list(candidate.get("tags")))
        fields = {
            "visual": visual,
            "audio": audio,
            "visible_text": visible_text,
            "tags": tags,
            "shot_type": clean_text(candidate.get("shotType")),
            "people_count": clean_text(candidate.get("peopleCount")),
        }
        field_score = 0.0
        matched_fields: list[str] = []
        for field, text in fields.items():
            field_tokens = set(tokenize(text))
            overlap = len(tokens & field_tokens)
            if overlap:
                matched_fields.append(field)
                weight = 1.5 if field in {"visual", "tags", "visible_text"} else 1.0
                field_score += overlap * weight
        base_score = float(candidate.get("score") or 0.0)
        if not matched_fields and candidate.get("matchType") == "embedding" and base_score < SEMANTIC_ONLY_MIN_SCORE:
            continue
        combined = field_score + base_score + max(0.0, 1.0 - index * 0.01)
        enriched = {**candidate, "rerankScore": round(combined, 6), "matchedFields": matched_fields}
        reranked.append((combined, enriched))
    reranked.sort(key=lambda item: item[0], reverse=True)
    return [candidate for _score, candidate in reranked[:limit]]


def search(
    index_root: str | Path,
    query: str,
    *,
    limit: int = 10,
    pool: int = 50,
    rerank_results: bool = True,
    query_embedder: Any | None = None,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 10), 100))
    safe_pool = max(safe_limit, min(int(pool or 50), 500))
    with closing(connect(index_root)) as conn:
        candidates_by_id: dict[str, dict[str, Any]] = {}
        for item in lexical_search(conn, query, safe_pool):
            candidates_by_id[item["id"]] = item
        for item in embedding_search(conn, query, safe_pool, query_embedder=query_embedder):
            current = candidates_by_id.get(item["id"])
            if not current or item["score"] > current["score"]:
                candidates_by_id[item["id"]] = item
        candidates = list(candidates_by_id.values())
    results = rerank(query, candidates, safe_limit) if rerank_results else candidates[:safe_limit]
    return {
        "ok": True,
        "query": query,
        "indexRoot": str(Path(index_root).expanduser().resolve()),
        "dbPath": str(db_path(index_root)),
        "candidateCount": len(candidates),
        "resultCount": len(results),
        "results": results,
    }


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True), flush=True)


def command_init(args: argparse.Namespace) -> int:
    with closing(connect(args.index_root)) as conn:
        count = conn.execute("SELECT COUNT(*) AS count FROM scripts").fetchone()["count"]
    emit({"ok": True, "indexRoot": str(Path(args.index_root).expanduser().resolve()), "dbPath": str(db_path(args.index_root)), "scriptCount": int(count)})
    return 0


def command_import(args: argparse.Namespace) -> int:
    load_env_file(args.env_file or REPO_ROOT / ".env")
    embedder = build_embedder(args.embedding_provider, model=args.embedding_model, dimensions=args.embedding_dimensions)
    emit(import_jsonl(args.index_root, args.jsonl, embedder=embedder))
    return 0


def command_search(args: argparse.Namespace) -> int:
    load_env_file(args.env_file or REPO_ROOT / ".env")
    query_embedder = None
    if args.embedding_provider != "auto":
        query_embedder = build_embedder(args.embedding_provider, model=args.embedding_model, dimensions=args.embedding_dimensions)
    emit(search(args.index_root, args.query, limit=args.limit, pool=args.pool, rerank_results=not args.no_rerank, query_embedder=query_embedder))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="semantic_script.py")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init")
    init.add_argument("--index-root", required=True)
    init.set_defaults(func=command_init)

    import_cmd = sub.add_parser("import-jsonl")
    import_cmd.add_argument("--index-root", required=True)
    import_cmd.add_argument("--embedding-provider", choices=["auto", "gemini", "local", "none"], default="auto")
    import_cmd.add_argument("--embedding-model", default=None)
    import_cmd.add_argument("--embedding-dimensions", type=int, default=None)
    import_cmd.add_argument("--env-file", default=None)
    import_cmd.add_argument("jsonl")
    import_cmd.set_defaults(func=command_import)

    search_cmd = sub.add_parser("search")
    search_cmd.add_argument("--index-root", required=True)
    search_cmd.add_argument("--query", required=True)
    search_cmd.add_argument("--limit", type=int, default=10)
    search_cmd.add_argument("--pool", type=int, default=50)
    search_cmd.add_argument("--embedding-provider", choices=["auto", "gemini", "local", "none"], default="auto")
    search_cmd.add_argument("--embedding-model", default=None)
    search_cmd.add_argument("--embedding-dimensions", type=int, default=None)
    search_cmd.add_argument("--env-file", default=None)
    search_cmd.add_argument("--no-rerank", action="store_true")
    search_cmd.set_defaults(func=command_search)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
