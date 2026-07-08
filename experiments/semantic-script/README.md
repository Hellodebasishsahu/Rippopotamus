# Semantic Script Experiment

This experiment tests the cheaper default search path:

```text
video
-> timestamped visual script
-> timestamped audio transcript
-> timestamped visible text / tags
-> text embeddings + SQLite FTS
-> reranked editor moments
```

The point is to avoid direct video embeddings as the default. Direct video embeddings stay as a deep-scan mode.

## Target Output

Each chunk should produce strict JSON:

```json
{
  "asset_path": "/path/to/video.mp4",
  "moments": [
    {
      "start": 752.0,
      "end": 768.0,
      "visual": "A crowd waves flags near a lit stage at night.",
      "audio": "The speaker says the campaign will continue district by district.",
      "visible_text": ["WARD 12"],
      "tags": ["crowd", "flags", "stage", "night", "speech"],
      "shot_type": "wide",
      "people_count": "large crowd"
    }
  ]
}
```

## Prototype Steps

1. Generate timestamped scripts from a video chunk.
2. Store scripts as JSONL.
3. Build an FTS index over visual/audio/visible text/tags.
4. Add Gemini Embedding 2 text embeddings for semantic search.
5. Add reranking over the top search candidates.

## Experiment Lanes

The experiment environment is tracked in:

```text
experiments/semantic-script/EXPERIMENT_REGISTRY.md
```

Current lanes:

- `lanes/A-script-lite/`: validated baseline control lane
- `lanes/B-media-memory/`: Gemini-native media-memory challenger lane

Shared inputs and query sets live under `shared/`.

## Current CLI

Generate timestamped script JSONL from real video with Gemini:

```bash
GEMINI_API_KEY=... python experiments/semantic-script/gemini_narrate.py \
  --video /path/to/video.mp4 \
  --out experiments/out/video.semantic.jsonl \
  --model gemini-2.5-flash-lite \
  --chunk-duration 30 \
  --overlap 5
```

Or keep the key in a local env file and pass it explicitly:

```bash
python experiments/semantic-script/gemini_narrate.py \
  --env-file /path/to/.env \
  --video /path/to/video.mp4 \
  --out experiments/out/video.semantic.jsonl \
  --chunk-duration 30 \
  --overlap 5
```

Initialize the experiment database:

```bash
python experiments/semantic-script/semantic_script.py init --index-root /tmp/rippo-semantic
```

Import timestamped script JSONL:

```bash
python experiments/semantic-script/semantic_script.py import-jsonl \
  --index-root /tmp/rippo-semantic \
  --embedding-provider gemini \
  --embedding-model gemini-embedding-2 \
  --embedding-dimensions 768 \
  experiments/semantic-script/sample.jsonl
```

Search and rerank moments:

```bash
python experiments/semantic-script/semantic_script.py search \
  --index-root /tmp/rippo-semantic \
  --query "minister waving from car"
```

The CLI defaults to `--embedding-provider auto`: it uses Gemini Embedding 2 when `GEMINI_API_KEY` or `GOOGLE_API_KEY` is available, and falls back to deterministic local hashing only for offline tests.

## Cost Assumption

Use Gemini Flash-Lite or local models for narration first. Direct Gemini video embeddings are too expensive for default library indexing.
