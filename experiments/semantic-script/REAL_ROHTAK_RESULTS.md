# Real Rohtak Probe

Date: 2026-05-12

Source sheet: `/Users/dev/Downloads/Rohtak OCC - Rohtak.csv`

## Input

Pulled the first three real Drive rows from the Rohtak sheet:

| File | Duration | Local preview |
| --- | ---: | --- |
| DJI_0857.MP4 | 45.98s | `experiments/out/rohtak-real/videos/DJI_0857.MP4.mp4` |
| DJI_0858.MP4 | 43.31s | `experiments/out/rohtak-real/videos/DJI_0858.MP4.mp4` |
| DJI_0859.MP4 | 12.75s | `experiments/out/rohtak-real/videos/DJI_0859.MP4.mp4` |

Downloaded via `yt-dlp --cookies-from-browser chrome` using Drive preview format `134` (`640x360`) to avoid dragging full drone masters into the experiment.

## Pipeline

```text
Drive CSV rows
-> yt-dlp preview downloads
-> Gemini 2.5 Flash-Lite media-memory narration
-> Gemini Embedding 2 text index, 768 dimensions
-> semantic search
-> F field-tiered search
```

Artifacts:

- `experiments/out/rohtak-real/DJI_0857.memory.jsonl`
- `experiments/out/rohtak-real/DJI_0858.memory.jsonl`
- `experiments/out/rohtak-real/DJI_0859.memory.jsonl`
- `experiments/out/rohtak-real/index/.rippo/semantic-script.sqlite3`
- `experiments/out/rohtak-real/search_probe.json`

## What Gemini Saw

The footage is mostly aerial drone footage of a large hospital or institutional complex.

Useful generated concepts:

- hospital complex
- institutional campus
- parking lot
- connecting skywalk
- circular road
- surrounding fields
- road leading to complex
- no people visible

## Search Results

| Query | Semantic Top Hit | F Field-Tiered Top Hit | Read |
| --- | --- | --- | --- |
| hospital complex aerial view | DJI_0857, 13-28s | DJI_0857, 0-14s | Both good |
| parking lot | DJI_0858, 13-28s | DJI_0858, 13-28s | Both good |
| skywalk between buildings | DJI_0857, 0-14s | DJI_0857, 0-14s | Both good |
| circular road | DJI_0858, 26-40s | DJI_0859, 0-12s | Semantic better |
| fields around hospital | DJI_0858, 39-42s | DJI_0857, 0-14s | Semantic better |
| road leading to complex | DJI_0859, 0-12s | DJI_0859, 0-12s | Both good |
| crowd of people | no result | no result | Correct hard negative |
| night rally stage | no result | no result | Correct hard negative |
| inside office meeting | no result | no result | Correct hard negative |

## Bugs Found

Real footage exposed two dumb-but-important bugs:

1. `No people are visible` was being treated like a positive `people` hit.
2. The semantic script tokenizer treated `of` as searchable, so `crowd of people` matched random campus shots.

Both are fixed in:

- `experiments/semantic-script/semantic_script.py`
- `experiments/semantic-script/lane_f_field_tiered.py`

## Verdict

This works better than expected for a tiny real batch.

The important bit: Gemini narration gives usable editor language from boring drone footage. Search can find real timestamps for `parking lot`, `skywalk`, `circular road`, and `road leading to complex`.

But F alone is not enough. It is too tie-breaker dumb on visually similar drone shots. Semantic retrieval is better at specific visual intent; F is better as the safety/rerank layer.

Product shape after real test:

```text
Gemini narration
+ Gemini Embedding 2 recall
+ F-style field trust / hard-negative gate
+ timestamp-window tightening
```

Next real test should use 15-30 mixed clips from the CSV, not just the first three. Drone-only footage is useful, but too visually similar to validate editor search fully.
