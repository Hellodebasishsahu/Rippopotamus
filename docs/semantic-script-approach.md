# Semantic Script Search Approach

Last updated: 2026-05-12.

## Short Verdict

The right default is script-first semantic search:

```text
video/audio/image source
-> chunked media
-> timestamped visual and audio narration
-> Gemini Embedding 2 over the generated script text
-> lexical + semantic retrieval
-> reranked timestamp results
-> editor jumps near the right moment
```

Direct video embeddings are still useful, but not as the default. They are too expensive and too opaque at library scale. The script layer gives us cheaper search, inspectable evidence, and editable metadata.

## Why A Normal Editor Cares

An editor does not want "AI search" as a concept. They want to type:

- `woman waving in kitchen`
- `wolf pups near den`
- `neon city night`
- `viral reel red text`
- `minister waving from car`

Then they want a usable timestamp and a reason:

```text
shorts.mp4 3.0s -> 5.0s
Matched: visual, audio, visible text, tags
Reason: "VIRAL REEL" appears on screen in red text
```

That is the product. Search should give jump points, not vibes.

## Current Prototype State

Validated locally:

- Real MP4 sample from Samplelib
- YouTube short slice
- YouTube long-video slice
- YouTube long music/mix slice
- Gemini Flash-Lite timestamp narration
- Gemini Embedding 2 text embeddings
- SQLite FTS + vector search
- Lightweight rerank
- Approximate timestamp results

Evidence lives in:

- `experiments/semantic-script/VALIDATION.md`
- `experiments/semantic-script/YT_BATCH_VALIDATION.md`
- `experiments/out/samplelib-5s.semantic.jsonl`
- `experiments/out/yt-samples/*.semantic.jsonl`

The current prototype is real, but not production-ready.

## The Data Contract

The important artifact is JSONL. Each line is one source chunk plus its extracted moments.

```json
{
  "asset_path": "/absolute/path/to/video.mp4",
  "source": "gemini:gemini-2.5-flash-lite",
  "chunk": {
    "start": 0.0,
    "end": 9.0,
    "path": "/tmp/rippo_chunks/chunk_0000.mp4"
  },
  "moments": [
    {
      "start": 3.0,
      "end": 5.0,
      "visual": "The words VIRAL REEL appear on screen in large red letters.",
      "audio": "viral reel recipes",
      "visible_text": ["VIRAL", "REEL"],
      "tags": ["viral", "reel", "recipe", "food", "cooking"],
      "shot_type": "medium",
      "people_count": "one person"
    }
  ]
}
```

This contract matters because it is:

- readable by humans
- cheap to re-embed
- easy to diff
- easy to repair manually
- portable from local SQLite to cloud storage
- good enough for rough editor jump points

## Local Architecture

Current local flow:

```text
yt-dlp / local file
-> ffmpeg chunking
-> Gemini narration
-> JSONL script file
-> SQLite scripts table
-> SQLite FTS table
-> Gemini Embedding 2 vector per moment
-> search query
-> Gemini query embedding
-> lexical candidates + vector candidates
-> rerank
-> timestamp result
```

Current implementation:

- `experiments/semantic-script/gemini_narrate.py`
- `experiments/semantic-script/semantic_script.py`
- `experiments/semantic-script/gemini_embeddings.py`

SQLite is good enough for the local prototype. It keeps the experiment simple and lets us test retrieval quality without setting up cloud plumbing too early.

## Search Behavior

Search should combine three things:

1. Exact-ish text matching
2. Gemini Embedding 2 semantic matching
3. Reranking using field overlap and source evidence

Good hits should expose what matched:

- `visual`
- `audio`
- `visible_text`
- `tags`
- `shot_type`
- `people_count`

Bad hits should not be shown just because vector similarity had a weak score. The current experiment filters low-confidence embedding-only results.

## Why Not Direct Multimodal Embeddings By Default

Direct multimodal embeddings sound cleaner:

```text
video -> embedding -> search
```

But the trap is scale.

Problems:

- Video embeddings can get expensive fast.
- They are harder to inspect.
- Bad results are harder to debug.
- You cannot easily edit the meaning of a clip.
- Different embedding model families cannot be mixed safely.
- Editors still need readable context, not only vector matches.

Script-first gives us an inspectable middle layer:

```text
video -> script -> text embedding -> searchable timestamp
```

That is cheaper, more debuggable, and more product-shaped.

## Cost Direction

Default cost strategy:

- Use Gemini Flash-Lite style narration for visual/audio script generation.
- Use Gemini Embedding 2 for text script embeddings.
- Avoid direct video embeddings except for explicit deep scan.
- Store scripts so re-embedding does not require re-watching media.
- Cache embeddings by text hash, model, provider, and dimension.

Cost controls needed before cloud:

- per-provider budgets
- per-job estimated cost
- hard stop limits
- retry caps
- chunk-size presets
- duplicate asset detection
- skip still/frozen chunks
- skip already indexed scripts
- batch pricing support where possible

The cheap path is not "never use Gemini." The cheap path is "make Gemini read the media once, then search text."

## Accuracy Direction

Current accuracy is good enough for approximate jumps. It is not frame-perfect.

Improvements to make before cloud:

- better narration prompt variants per content type
- chunk overlap with de-duplication
- scene-boundary chunking instead of only fixed seconds
- visible text OCR confidence
- separate speech transcript when audio matters
- merge repeated adjacent moments
- confidence score per moment
- source previews around the returned timestamp
- feedback loop: user marks result good/bad
- reranker that uses query intent, not just token overlap

The big accuracy question is not "can Gemini describe the clip?" It can. The real question is whether the timestamp windows are tight enough for editors to trust.

## Local First, Then Cloud

Stay local until the ingestion runner is boring.

Local-first benefits:

- fewer moving pieces
- easy to inspect files
- lower infra cost
- safer while prompts and chunking change
- works for private editor libraries
- easier to compare model outputs

Move pieces to cloud only when we know what has to scale.

Good cloud candidates later:

- job queue
- object storage for media and chunks
- script JSONL storage
- embedding cache
- vector database
- project/team search API
- hosted preview thumbnails
- shared review UI

Bad cloud move right now:

- uploading everything before we know chunking/cost behavior
- turning this into a big backend before the ingestion loop is reliable
- using expensive direct video embeddings as the default

## Cloud Shape Later

Likely cloud architecture:

```text
Client app
-> upload/import request
-> ingest job queue
-> media object storage
-> chunk worker
-> narration worker
-> transcript/OCR worker
-> script JSONL store
-> embedding worker
-> vector index + relational metadata
-> search API
-> editor UI with timestamp previews
```

Suggested storage split:

- Media files: object storage
- Script JSONL: object storage plus metadata DB pointer
- Assets/jobs/users: relational DB
- Embeddings: vector DB or Postgres vector extension
- Search evidence: relational rows or document store
- Logs/costs: append-only job events

Do not throw away JSONL in cloud. It is the audit trail.

## Production Readiness Checklist

Before calling this production-ready:

- Durable ingest jobs
- Resume after crash
- Retry with backoff
- Per-job cost estimate before run
- Per-job cost actual after run
- Model/provider recorded on every artifact
- Embedding compatibility enforced
- Asset fingerprinting and dedupe
- Chunk manifest
- JSONL schema validation
- Prompt versioning
- Index migration/versioning
- Search quality test set
- Failure UI
- Secret storage outside plain repo files
- Exportable result format

Until then, call it a validated prototype.

## Next Build Step

Build the local production-shaped runner:

```text
rippo ingest <file-or-url>
```

It should:

1. create a durable job row
2. download or copy the source
3. fingerprint the asset
4. chunk the media
5. run Gemini narration
6. write JSONL
7. embed script text with Gemini Embedding 2
8. update the SQLite index
9. record cost and model metadata
10. expose searchable timestamp results

That runner is the bridge. Once it is stable locally, moving the same job model to cloud becomes straightforward instead of a rewrite.

## Decision

Keep the product script-first.

Use Gemini for:

- narration
- speech/audio summaries when transcript is not enough
- Gemini Embedding 2 over generated script text

Use direct multimodal embeddings only as:

- deep scan
- premium mode
- rescue path for footage where narration is too lossy

The near-term goal is not a huge AI platform. It is a boring ingest-and-search loop that editors can trust.
