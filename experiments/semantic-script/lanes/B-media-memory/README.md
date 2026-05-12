# Lane B: Gemini Media Memory

Status: challenger lane, ready for first run.

## Hypothesis

Gemini-native key-value media memory beats script-lite for normal editor intent queries.

## Use

Use this lane to test richer moment memory:

- summary
- visual
- audio
- visible text
- actions
- objects
- people
- setting
- shot
- mood
- editor use
- search phrases
- confidence

## Rule

Keep timestamps at moment level. Clip-level summaries are context only, not primary retrieval rows.

## Next Build

Create:

```text
experiments/semantic-script/gemini_memory.py
```

It should use this lane prompt/schema, write JSONL, index with Gemini Embedding 2, and compare against Lane A using `shared/query-set-v1.json`.
