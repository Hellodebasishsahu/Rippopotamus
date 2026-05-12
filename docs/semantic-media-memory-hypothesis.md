# Semantic Media Memory Hypothesis

Last updated: 2026-05-12.

## Short Verdict

We now have two search hypotheses.

Hypothesis A is already validated as a working prototype:

```text
video
-> timestamped script-lite narration
-> Gemini Embedding 2 over script text
-> search/rerank
-> approximate editor timestamp
```

Hypothesis B is the next thing to test:

```text
video
-> Gemini-native structured media memory
-> Gemini Embedding 2 over key-value moment memory
-> search/rerank/filters
-> better editor timestamp
```

The bet is simple: Gemini is capable enough to create richer media memory than plain narration, and that richer memory should search better for normal editor queries.

## The Hypothesis

**B: Gemini-native media memory beats script-lite for editor search.**

Sub-hypotheses:

- **B1:** Rich key-value moment memory embeds better than plain `visual/audio/tags`.
- **B2:** Moment-level embeddings preserve timestamp accuracy better than one stitched clip-level embedding.
- **B3:** Clip-level stitched summaries are useful for browsing and context, not primary search.
- **B4:** Gemini can generate editor-useful labels without making the data too noisy.

## Why This Might Win

Editors do not always search literally.

They search like:

- `good cooking intro`
- `cute animal family moment`
- `wolf parent caring for babies`
- `cyberpunk background for gaming stream`
- `reaction shot`
- `establishing shot`
- `social hook`

Script-lite can catch exact things:

```text
visual: Woman in kitchen talks about recipes.
audio: viral reel recipes
tags: kitchen, woman, recipe
```

Media memory can catch intent:

```text
summary: Woman in kitchen introduces viral reel recipes.
actions: greeting, presenting, gesturing
objects: kitchen counter, ingredients, text overlay
visible text: VIRAL REEL
editor use: recipe intro, social hook, talking head
search phrases: good cooking intro, viral recipe hook
```

That should improve recall without losing inspectability.

## The Trap

Gemini can over-help.

Risks:

- too many fields
- inflated confidence
- invented `editor_use`
- noisy tags
- higher narration token cost
- worse consistency across videos
- more difficult dedupe
- search phrases becoming generic spam

The test should not ask "does this look smarter?" That is bait.

The test should ask:

```text
For real editor queries, does Hypothesis B return better timestamps than Hypothesis A?
```

## Data Shape

Keep JSON as storage. Embed normalized key-value text.

Do not embed raw JSON braces. Embed a text block like this:

```text
summary: Woman in kitchen introduces viral reel recipes.
visual: Woman gestures beside ingredients on a kitchen counter.
audio: "viral reel recipes"
visible text: VIRAL REEL
actions: greeting, presenting, gesturing
objects: kitchen counter, ingredients, text overlay
people: one woman
setting: kitchen
shot: medium talking head, static camera
mood: casual, energetic
editor use: recipe intro, social hook, talking head
search phrases: good cooking intro; viral recipe hook; social recipe opener
```

Reason: embeddings handle labeled natural language well. Raw JSON syntax is mostly noise.

## Proposed Moment Schema

```json
{
  "start": 3.0,
  "end": 5.0,
  "summary": "Woman in kitchen points at large VIRAL REEL text.",
  "visual": "The woman makes an okay gesture while large red text appears on screen.",
  "audio": "viral reel recipes",
  "visible_text": ["VIRAL", "REEL"],
  "actions": ["presenting", "gesturing"],
  "objects": ["kitchen counter", "ingredients", "text overlay"],
  "people": {
    "count": "one person",
    "description": "woman host"
  },
  "setting": ["kitchen", "home cooking setup"],
  "shot": {
    "type": "medium",
    "camera_motion": "static",
    "composition": "talking head"
  },
  "mood": ["casual", "energetic"],
  "editor_use": ["recipe intro", "social hook", "talking head"],
  "search_phrases": [
    "good cooking intro",
    "viral recipe hook",
    "woman presenting recipe in kitchen"
  ],
  "confidence": 0.86
}
```

## Timestamp Strategy

Do not embed a whole 100s clip as one search row.

For a 100s clip:

```text
0-20s chunk
18-38s chunk
36-56s chunk
54-74s chunk
72-92s chunk
90-100s chunk
```

Gemini returns moments relative to each chunk. Convert immediately:

```text
absolute_start = chunk_start + gemini_start
absolute_end = chunk_start + gemini_end
```

Store one row per moment:

```json
{
  "asset_id": "clip_123",
  "chunk_start": 36.0,
  "chunk_end": 56.0,
  "moment_start": 41.2,
  "moment_end": 46.8,
  "summary": "Wolf pup nudges adult wolf near den.",
  "embedding_text": "summary: Wolf pup nudges adult wolf near den..."
}
```

Search returns the moment row. UI jumps to `41.2s`.

## What To Stitch

Stitch clip summaries only for overview:

```text
0-20s: woman introduces recipe
20-40s: ingredients shown
40-60s: cooking steps
60-80s: plating
80-100s: tasting reaction
```

Use stitched summaries for:

- asset browsing
- "summarize this footage"
- showing context around a result
- fallback when no moment is strong
- picking which clip to open

Do not use stitched clip summaries as the primary search index. They blur timestamps.

## Dedupe With Overlap

Overlapping chunks will create duplicate moments.

Example:

```text
18.0-22.0 "woman starts cooking"
18.5-22.3 "woman begins cooking"
```

Merge if:

- timestamps overlap heavily
- embedding similarity is high
- same visible text/actions/objects

Merged row:

```json
{
  "start": 18.0,
  "end": 22.3,
  "sources": ["chunk_0000", "chunk_0001"]
}
```

## Test Plan

Use the existing YouTube batch:

- `shorts.mp4`
- `long.mp4`
- `mix.mp4`

Run both pipelines:

### A: Script-Lite

Current schema:

- `visual`
- `audio`
- `visible_text`
- `tags`
- `shot_type`
- `people_count`

### B: Media Memory

Expanded schema:

- `summary`
- `visual`
- `audio`
- `visible_text`
- `actions`
- `objects`
- `people`
- `setting`
- `shot`
- `mood`
- `editor_use`
- `search_phrases`
- `confidence`

Use Gemini Embedding 2 for both.

## Query Set

Literal queries:

- `woman waving kitchen`
- `viral reel red text`
- `burger India flag`
- `wolf pups den`
- `neon city night`
- `next gen gaming text`

Intent queries:

- `good cooking intro`
- `food from different countries`
- `cute animal family moment`
- `wolf parent caring for babies`
- `cyberpunk background for gaming stream`
- `text overlay for gaming`
- `social media recipe hook`
- `calm nature animal b-roll`

Hard negative queries:

- `traffic street park`
- `office meeting presentation`
- `sports crowd stadium`

Hard negatives matter. If the system returns junk with confidence, it is not ready.

## Metrics

Keep it simple.

For each query:

- top result asset
- top result timestamp
- whether timestamp is usable
- whether explanation is inspectable
- number of junk results
- whether no-match returns empty

Score:

```text
2 = good timestamp, useful result
1 = related clip but timestamp weak
0 = wrong or junk
```

Compare:

```text
A score vs B score
```

Switch default to B only if:

- B improves intent-query recall
- B does not hurt literal-query precision
- B does not increase junk hard-negative results
- B cost stays acceptable
- B JSON is stable enough to validate

## Cost Notes

Media memory costs more than script-lite because Gemini writes more output.

But the important cost move stays the same:

```text
Gemini watches/listens once
-> store media memory JSONL
-> embed text cheaply
-> search many times
```

Do not re-run media understanding for every search.

Cache by:

- asset fingerprint
- chunk start/end
- prompt version
- model
- schema version

Embed by:

- normalized embedding text hash
- embedding provider
- embedding model
- embedding dimensions

## Cloud Relevance

This hypothesis is cloud-friendly if we keep JSONL as the source of truth.

Cloud storage shape:

- media in object storage
- chunks in object storage or short-lived worker cache
- media memory JSONL in object storage
- moment rows in relational DB
- embeddings in vector DB
- job status and cost events in relational/append-only logs

The cloud system should not hide the memory layer. The memory is the evidence.

## Decision Gate

After testing:

Keep A as default if:

- B adds noise
- B costs meaningfully more without better timestamps
- B creates unstable schemas
- B over-invents editor labels

Move to B as default if:

- B handles normal editor intent queries better
- B keeps timestamp precision
- B hard negatives stay clean
- B gives better explanations in UI

Most likely final product:

```text
A-lite fields for baseline precision
+ B media memory fields for recall and editor language
+ Gemini Embedding 2 over normalized key-value text
+ reranker that punishes weak evidence
```

## Next Experiment

Build:

```text
experiments/semantic-script/gemini_memory.py
```

It should:

1. use the same chunker as `gemini_narrate.py`
2. ask Gemini for the expanded media memory schema
3. normalize timestamps to absolute source time
4. write JSONL
5. embed normalized key-value text with Gemini Embedding 2
6. index into a separate SQLite DB
7. run the query set against A and B
8. output a small comparison table

No UI work needed for this test. This is retrieval quality first.
