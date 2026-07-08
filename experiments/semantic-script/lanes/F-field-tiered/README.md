# F: Field-Tiered Search

This lane tests whether rich media-memory fields work better when ranked by trust tier instead of dumped into one embedding blob.

## Input

- `experiments/out/yt-memory-samples/shorts.memory.jsonl`
- `experiments/out/yt-memory-samples/long.memory.jsonl`
- `experiments/out/yt-memory-samples/mix.memory.jsonl`

## Ranking

- high: summary, visual, audio, visible text, objects, actions
- medium: setting, mood, people, shot
- low: editor use, search phrases

Low-trust fields can boost a result, but cannot create a hit alone unless a useful multi-word phrase matches.

## Result

Run: `runs/2026-05-12-yt-batch/`

Score: `29 / 30`

F tied the A baseline on the tiny fixture without making embedding calls. It should be treated as a product rerank policy, not a standalone search engine.
