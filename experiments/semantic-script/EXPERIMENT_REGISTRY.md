# Semantic Script Experiment Registry

Last updated: 2026-05-12.

## Purpose

Keep retrieval experiments clean. No more random JSONL files with unclear prompts.

Every lane must record:

- hypothesis
- prompt version
- schema version
- input sample set
- query set
- generated JSONL
- index path
- embedding provider/model/dimensions
- search results
- cost notes
- verdict

## Lanes

### A-script-lite

Status: validated baseline.

Hypothesis:

```text
Timestamped visual/audio/tags + Gemini Embedding 2 is enough for approximate editor search.
```

Use this as the control lane. Do not mutate the schema casually.

Files:

- `lanes/A-script-lite/README.md`
- `lanes/A-script-lite/prompt.md`
- `lanes/A-script-lite/schema.json`
- `lanes/A-script-lite/runs/2026-05-12-yt-batch/run.json`
- `lanes/A-script-lite/runs/2026-05-12-yt-batch/verdict.md`

### B-media-memory

Status: ready for next run.

Hypothesis:

```text
Gemini-native key-value media memory beats script-lite for normal editor intent queries.
```

Use this as the challenger lane.

Files:

- `lanes/B-media-memory/README.md`
- `lanes/B-media-memory/prompt.md`
- `lanes/B-media-memory/schema.json`
- `lanes/B-media-memory/runs/.template/run.json`
- `lanes/B-media-memory/runs/.template/verdict.md`

## Shared Fixtures

- `shared/inputs-yt-batch.json`
- `shared/query-set-v1.json`
- `shared/run-manifest.schema.json`

## Rule

Same inputs, same query set, separate outputs.

If a lane changes prompt or schema, create a new run folder. Do not overwrite old run evidence.
