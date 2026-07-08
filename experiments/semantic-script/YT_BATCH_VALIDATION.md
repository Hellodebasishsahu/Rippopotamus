# YouTube Batch Validation

Last checked: 2026-05-12.

## Samples

Downloaded short slices with `yt-dlp`:

```bash
mkdir -p experiments/out/yt-samples

yt-dlp --no-playlist --match-filter '!is_live' \
  -f 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[height<=720]' \
  --download-sections '*00:00-00:18' \
  --force-keyframes-at-cuts \
  --merge-output-format mp4 \
  -o 'experiments/out/yt-samples/shorts.%(ext)s' \
  'ytsearch1:youtube shorts street food cooking'

yt-dlp --no-playlist --match-filter '!is_live' \
  -f 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[height<=720]' \
  --download-sections '*00:30-00:50' \
  --force-keyframes-at-cuts \
  --merge-output-format mp4 \
  -o 'experiments/out/yt-samples/long.%(ext)s' \
  'ytsearch1:nature documentary forest animals 4k'

yt-dlp --no-playlist --match-filter '!is_live' \
  -f 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/best[height<=720]' \
  --download-sections '*00:15-00:30' \
  --force-keyframes-at-cuts \
  --merge-output-format mp4 \
  -o 'experiments/out/yt-samples/mix.%(ext)s' \
  'ytsearch1:lofi beats animated city night'
```

Observed:

- `shorts.mp4`: 18.0s, 1280x720, audio
- `long.mp4`: 20.053s, 1280x720, audio
- `mix.mp4`: 15s slice, 1280x720, audio

One earlier mix query hit YouTube bot protection; a second query worked.

## Narration

```bash
GEMINI_API_KEY=... python3 experiments/semantic-script/gemini_narrate.py \
  --video experiments/out/yt-samples/shorts.mp4 \
  --out experiments/out/yt-samples/shorts.semantic.jsonl \
  --chunk-duration 9 \
  --overlap 0

GEMINI_API_KEY=... python3 experiments/semantic-script/gemini_narrate.py \
  --video experiments/out/yt-samples/long.mp4 \
  --out experiments/out/yt-samples/long.semantic.jsonl \
  --chunk-duration 10 \
  --overlap 0

GEMINI_API_KEY=... python3 experiments/semantic-script/gemini_narrate.py \
  --video experiments/out/yt-samples/mix.mp4 \
  --out experiments/out/yt-samples/mix.semantic.jsonl \
  --chunk-duration 8 \
  --overlap 0
```

Observed:

- `shorts.semantic.jsonl`: 2 chunk records, 14 searchable moments
- `long.semantic.jsonl`: 3 chunk records, 12 searchable moments
- `mix.semantic.jsonl`: 2 chunk records, 2 searchable moments

## Combined Index

```bash
rm -rf experiments/out/yt-gemini-index

python3 experiments/semantic-script/semantic_script.py init \
  --index-root experiments/out/yt-gemini-index

for f in experiments/out/yt-samples/*.semantic.jsonl; do
  python3 experiments/semantic-script/semantic_script.py import-jsonl \
    --index-root experiments/out/yt-gemini-index \
    --embedding-provider gemini \
    --embedding-model gemini-embedding-2 \
    --embedding-dimensions 768 \
    "$f"
done
```

Observed:

- `28` total searchable timestamp rows
- embedding provider: `gemini`
- embedding model: `gemini-embedding-2`
- embedding dimensions: `768`

## Search Checks

```bash
python3 experiments/semantic-script/semantic_script.py search \
  --index-root experiments/out/yt-gemini-index \
  --query "woman waving kitchen" \
  --limit 3
```

Top hit: `shorts.mp4` at `0.0->1.0`, matched `visual,tags`.

```bash
python3 experiments/semantic-script/semantic_script.py search \
  --index-root experiments/out/yt-gemini-index \
  --query "viral reel red text" \
  --limit 3
```

Top hit: `shorts.mp4` at `3.0->5.0`, matched `visual,audio,visible_text,tags`. Low-confidence embedding-only noise was filtered, so this query returns only the real hit.

```bash
python3 experiments/semantic-script/semantic_script.py search \
  --index-root experiments/out/yt-gemini-index \
  --query "burger India flag" \
  --limit 3
```

Top hit: `shorts.mp4` at `9.5->10.0`, matched `visual,tags`.

```bash
python3 experiments/semantic-script/semantic_script.py search \
  --index-root experiments/out/yt-gemini-index \
  --query "wolf pups den" \
  --limit 3
```

Top hit: `long.mp4` at `10.0->11.0`, matched `visual,tags`.

```bash
python3 experiments/semantic-script/semantic_script.py search \
  --index-root experiments/out/yt-gemini-index \
  --query "mother wolf licking pup" \
  --limit 3
```

Top hit: `long.mp4` at `12.0->13.0`; second hit: `14.0->15.0`. The second hit is the better semantic interpretation for `kisses puppy` because Gemini maps it to `licks the head of one of the pups`.

```bash
python3 experiments/semantic-script/semantic_script.py search \
  --index-root experiments/out/yt-gemini-index \
  --query "neon city night synthwave" \
  --limit 3
```

Top hit: `mix.mp4` at `0.0->7.0`, matched `visual,audio,tags`.

```bash
python3 experiments/semantic-script/semantic_script.py search \
  --index-root experiments/out/yt-gemini-index \
  --query "next gen gaming text" \
  --limit 3
```

Top hit: `mix.mp4` at `8.0->14.0`, matched `visible_text,tags`.

## Verdict

The timestamp path works well enough for prototype use. Gemini can produce sub-second to multi-second moments from short chunks, and search returns usable approximate edit points.

Gemini Embedding 2 is now used for the script text. Deterministic local hashing remains only as an offline/test fallback. The reranker filters weak embedding-only noise, so no-match queries return empty instead of junk.
