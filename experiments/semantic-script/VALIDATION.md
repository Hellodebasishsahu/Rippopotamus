# Semantic Script Validation

Last checked: 2026-05-12.

## Success Criteria

- Obtain a small real video.
- Generate timestamped narration JSONL with Gemini.
- Import the JSONL into the experiment index.
- Search and rerank indexed moments.
- Keep the exact command path documented.

## Current Evidence

### Real Video

Downloaded a 5.76s public sample MP4:

```bash
curl -L --fail --max-time 30 \
  -o experiments/out/samplelib-5s.mp4 \
  https://download.samplelib.com/mp4/sample-5s.mp4

ffprobe -v error \
  -show_entries format=duration:stream=codec_type,width,height \
  -of json \
  experiments/out/samplelib-5s.mp4
```

Observed: one 1920x1080 video stream, one audio stream, duration `5.758549`.

### Gemini Narration

Command path:

```bash
python3 experiments/semantic-script/gemini_narrate.py \
  --env-file /path/to/.env \
  --video experiments/out/samplelib-5s.mp4 \
  --out experiments/out/samplelib-5s.semantic.jsonl \
  --chunk-duration 6 \
  --overlap 0 \
  --limit-chunks 1
```

Expected env file format:

```bash
GEMINI_API_KEY=...
```

Observed after providing a fresh key:

- output: `experiments/out/samplelib-5s.semantic.jsonl`
- chunks: `1`
- model: `gemini-2.5-flash-lite`
- source: `gemini:gemini-2.5-flash-lite`
- moment count: `1`
- generated visual: `A park scene with large trees and a path, with traffic visible on a street to the left.`
- generated tags: `park`, `trees`, `street`, `traffic`, `daylight`

### Import And Search

The import/search/rerank path is validated with the Gemini-generated JSONL:

```bash
rm -rf experiments/out/samplelib-semantic-index

python3 experiments/semantic-script/semantic_script.py init \
  --index-root experiments/out/samplelib-semantic-index

python3 experiments/semantic-script/semantic_script.py import-jsonl \
  --index-root experiments/out/samplelib-semantic-index \
  experiments/out/samplelib-5s.semantic.jsonl

python3 experiments/semantic-script/semantic_script.py search \
  --index-root experiments/out/samplelib-semantic-index \
  --query "park trees traffic street" \
  --limit 5
```

Observed:

- imported `1` moment
- returned `1` result
- top result matched `visual` and `tags`
- top result described a park scene with trees, a path, and traffic on a street

### Tests

```bash
PYTHONPATH=src python3 -m unittest tests.test_gemini_narrate_experiment tests.test_semantic_script_experiment
PYTHONPATH=src python3 -m unittest discover -s tests
npm run build
```

Observed:

- targeted experiment tests: `7` passed
- full Python tests: `73` passed
- UI/Electron build: passed

## Completion State

Complete for the prototype path: real MP4, Gemini-generated timestamped JSONL, import, search, and rerank all ran successfully.
