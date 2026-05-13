# Rippo Current Tech And Improvement Map

Last updated: 2026-05-12

This is the plain current-state doc. No fantasy architecture. This is what Rippo is today, what is weak, and what we can improve next.

## Current Shape

Rippo is still a local-first desktop app.

```text
Electron UI
-> preload IPC bridge
-> Electron main process
-> Python engine commands
-> local files + local SQLite index
-> Gemini for semantic ingest/search when configured
```

Main pieces:

- Desktop shell: `electron/main.ts`
- Renderer UI: `src/desktop/App.tsx`
- Preload bridge: `electron/preload.ts`
- Local footage index: `src/rippopotamus/footage_index.py`
- Semantic ingest worker: `src/rippopotamus/index_worker.py`
- Gemini embeddings: `src/rippopotamus/gemini_embeddings.py`
- Video chunking: `src/rippopotamus/video_chunker.py`
- CLI/router for engine commands: `src/rippopotamus/desktop_engine.py`
- Current local app index: `/Users/dev/Downloads/Rippo/.rippo/index.sqlite3`

The app has two search lanes:

- **Library**: search saved local footage.
- **Web**: search external/source adapters.

Ingestion is currently only in **Settings > Ingest**. That is the right UI boundary for now. The home screen should stay search-first, not ingest-first.

## Current Library Index

The local library index uses SQLite.

Tables:

- `assets`: one row per local file.
- `moments`: searchable timestamp windows.
- `moments_fts`: SQLite FTS5 text index when available.

Moment rows can store:

- file path
- start/end timestamp
- title
- description
- tags
- embedding vector JSON
- embedding provider/model/dim

Current search flow:

```text
query
-> Gemini query embedding, if key exists
-> vector search over embedded moments
-> score cutoff
-> fallback to lexical/FTS search
-> return timestamped moments
```

The recent important fix: vector search now has a minimum score cutoff. Without that, nonsense queries like `nuke` returned "nearest" drone footage because nearest-neighbor search always finds something.

Current default cutoff:

```text
RIPPO_INDEX_VECTOR_MIN_SCORE=0.2
```

That value is early and needs eval tuning. It is better than returning garbage.

## Current Ingest

There are two ingest modes in the codebase:

### Basic file ingest

```text
index-ingest
-> discover media files
-> create asset rows
-> create default full-file moments
```

This is cheap but weak. It mostly searches filenames and basic metadata.

### Visual search gap

```text
no active semantic ingest command
-> filename/basic metadata indexing only
-> rebuild later with captions, object tags, OCR, and transcripts
-> do not ship direct video embeddings as the product answer
```

This is real, but it can get expensive if used blindly on a lot of video.

### Old experiment import

The old experiment import bridge is not part of the active desktop/agent command surface anymore:

```text
no active import command
-> old rows should not be treated as product search truth
-> rebuild later from inspectable captions/tags/transcripts if we want this back
```

## Current Experiment Direction

The stronger direction is not direct video embeddings everywhere. It is script-first media memory:

```text
video/audio/image
-> Gemini visual/audio narration or structured media memory
-> timestamped text moments
-> Gemini Embedding 2 over normalized text
-> FTS + vector retrieval
-> optional rerank
```

Why this is better:

- cheaper to search repeatedly
- easier to debug
- users can read why a result matched
- timestamps stay visible
- can support transcripts, OCR, tags, and visual narration in one format

Direct multimodal embedding is still useful, but it should be an expensive mode, not the default for every company library.

## What Is Good Right Now

- The desktop loop is working.
- Local search has real timestamped results.
- Gemini Embedding 2 is wired.
- Settings has ingest controls and cost-ish presets.
- Search now has a Library/Web split.
- Home page no longer exposes ingest commands.
- The app can import experiment indexes into the real app DB.
- Tests cover a decent amount of backend behavior.

## What Is Weak Right Now

### 1. Search quality is not evaluated enough

We have examples, not a real benchmark.

Current failure mode:

- embedding search can look plausible while being wrong
- cutoff helps, but cutoff alone is not enough
- small sample sets make everything look better than it is

Need:

- query set
- expected timestamp windows
- pass/fail scoring
- top-k accuracy
- "no result" tests
- per-provider score calibration

### 2. Ingest is still too local and manual

The app can scan, but ingest is not yet a durable job system.

Need:

- job table
- resume failed jobs
- skip already indexed chunks
- per-file ingest status
- visible progress per phase
- retry policy for Gemini/quota/network errors

### 3. The data model is still prototype-shaped

SQLite is fine locally, but the schema needs to evolve.

Need clearer entities:

- `assets`
- `asset_versions`
- `moments`
- `tracks` for transcript/visual/OCR/audio
- `embeddings`
- `ingest_jobs`
- `provider_runs`
- `cost_events`

Right now too much meaning is packed into `moments.description` and `tags_json`.

### 4. Result UI needs to become editor-grade

Current result list is functional, not editor-grade.

Need:

- stable thumbnail per moment
- click-to-play at timestamp
- result reason: "matched visual narration", "matched transcript", "matched OCR"
- exact timestamp confidence
- copy/export marker
- open source file in Finder
- batch select moments

Editors care about finding and reusing clips, not admiring an AI result list.

### 5. Cost controls are not strict enough

The settings UI estimates cost, but backend enforcement is still thin.

Need:

- preflight cost estimate before scanning
- per-scan cost cap
- per-day budget cap
- provider-specific limits
- dry-run mode
- cached media understanding
- never reprocess unchanged chunks

### 6. Provider abstraction is incomplete

Gemini is the current main provider.

Need:

- provider capability table
- provider-specific max video length, file size, fps, pricing
- provider-specific score calibration
- local model lane for offline/private ingest
- BYOK vs app-managed key modes

### 7. Security is local-dev level

For local desktop this is fine-ish. For cloud or teams, no.

Need:

- no raw local paths in shared search APIs
- signed media URLs
- org/user scoping
- permission checks on every search
- encrypted secrets
- audit logs for downloads/search/export

### 8. Observability is missing

When search is wrong, we need to know why.

Need:

- per-query logs: query, embedding model, top scores, cutoff, fallback used
- per-ingest logs: chunk count, skipped count, provider calls, cost estimate
- debug result mode
- small admin/eval dashboard

## Improvement Fields

### Field 1: Retrieval Quality

Best next work:

- hybrid ranking: FTS + vector, not vector-only
- query rewrite for editor phrases
- rerank top 20 using a cheap LLM or cross-encoder
- no-result confidence gates
- synonyms and domain labels
- per-field boosts: visual, transcript, OCR, tags

Stupid-simple first version:

```text
FTS candidates + vector candidates
-> merge
-> score cutoff
-> sort with field boosts
-> show why matched
```

### Field 2: Media Understanding

Best next work:

- transcript audio separately
- OCR visible text separately
- visual narration separately
- normalize all into timestamped moment records

Do not only store one generic paragraph. Store fields.

Example:

```json
{
  "start": 13.0,
  "end": 28.0,
  "visual": "aerial view of hospital buildings and parking lot",
  "speech": "",
  "ocr": [],
  "objects": ["building", "parking lot", "cars"],
  "scene": "hospital campus",
  "camera": "aerial wide"
}
```

Then embed normalized text derived from this, not random prompt prose.

### Field 3: Ingest Reliability

Best next work:

- chunk fingerprints
- ingest job table
- resumable phases
- provider call retry/backoff
- visible errors per file
- scan summary: files scanned, chunks created, chunks skipped, cost

### Field 4: Cost And Performance

Best next work:

- default to script/text embeddings
- direct video embedding only on premium/detail mode
- downscale and fps reduction before expensive calls
- skip still chunks
- cache everything by file hash + chunk config
- batch where provider supports it

### Field 5: Product UX

Best next work:

- search page stays clean
- settings owns ingest
- results show thumbnails and timestamp jump
- settings shows cost before scan
- no debug words like "semantic index" for normal users
- names should be normal: Quick scan, Balanced, Detail search, Fast action

### Field 6: Cloud/Team Readiness

If this becomes a central server for teams:

```text
object storage
-> job queue
-> worker fleet
-> Postgres truth DB
-> pgvector/Qdrant/OpenSearch vector index
-> search API
-> signed playback URLs
-> org/user permissions
```

Local SQLite should not be the shared team index.

### Field 7: Evaluation

Need a boring eval harness.

Dataset shape:

```json
{
  "query": "parking lot",
  "expected": [
    { "asset": "DJI_0857.MP4.mp4", "start": 13, "end": 28 }
  ],
  "should_match": true
}
```

Track:

- top-1 hit
- top-3 hit
- timestamp overlap
- false positive rate
- no-result accuracy
- median search latency

This is the only way to stop vibe-testing search.

## Recommended Next Moves

### Next 1: Make Search Honest

- Keep vector cutoff.
- Add hybrid merge.
- Add result explanations.
- Add no-result tests.

### Next 2: Make Ingest Boring

- Add job records.
- Add file/chunk fingerprints.
- Show per-file progress.
- Avoid reprocessing unchanged chunks.

### Next 3: Move From Paragraphs To Media Memory

- Store visual, speech, OCR, objects, scene, camera separately.
- Embed a normalized string built from those fields.
- Keep the raw fields for filtering and explanations.

### Next 4: Add Eval Harness

- Start with 30-50 manually judged queries.
- Include obvious misses like `nuke`.
- Run it after every retrieval change.

### Next 5: Improve Result UI

- Moment thumbnails.
- Player jumps to timestamp.
- Why matched.
- Copy/export selected moment.

## Prod Version In One Line

For real teams, Rippo should become:

```text
cloud media memory + hybrid timestamp search for editors
```

Not "AI video search" as a vague toy. The product promise is simple:

```text
Type what you need.
Get the exact clip moment.
Trust why it matched.
Use it immediately.
```
