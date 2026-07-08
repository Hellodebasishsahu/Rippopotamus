# Lane A: Script-Lite Baseline

Status: validated control lane.

## Hypothesis

Timestamped `visual/audio/visible_text/tags` plus Gemini Embedding 2 is enough for approximate editor search.

## Use

Use this lane as the baseline. It should stay boring and stable.

Do not add richer media-memory fields here. That belongs in `B-media-memory`.

## Artifacts

- `prompt.md`: current narration prompt shape
- `schema.json`: script-lite moment schema
- `runs/2026-05-12-yt-batch/`: validated YouTube batch run

## Commands

Generate JSONL:

```bash
GEMINI_API_KEY=... python3 experiments/semantic-script/gemini_narrate.py \
  --video experiments/out/yt-samples/shorts.mp4 \
  --out experiments/out/yt-samples/shorts.semantic.jsonl \
  --chunk-duration 9 \
  --overlap 0
```

Import with Gemini Embedding 2:

```bash
python3 experiments/semantic-script/semantic_script.py import-jsonl \
  --index-root experiments/out/yt-gemini-index \
  --embedding-provider gemini \
  --embedding-model gemini-embedding-2 \
  --embedding-dimensions 768 \
  experiments/out/yt-samples/shorts.semantic.jsonl
```
