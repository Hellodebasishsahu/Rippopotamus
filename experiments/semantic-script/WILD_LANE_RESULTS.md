# Wild Lane Experiment Results

Last updated: 2026-05-12.

## Short Verdict

F-field-tiered tied the A baseline at 29 / 30.

No lane beat A yet, but F is now the best product-shaped challenger.

But the experiment was still useful:

- raw B media memory is too noisy
- C editor-query text is cleaner than raw B, but still not better than A
- D dual-gating fixes B's hard-negative failure
- E negative judge also fixes B's hard-negative failure
- F field-tiered rerank preserves A-level score while using B-style rich memory more safely

So the product lesson is not "add more memory fields." The lesson is:

```text
A/F-style high-trust evidence is the spine.
Field-tiered B memory is the rerank layer.
E-style negative judging is the cheap safety belt.
```

## Scoreboard

Same inputs:

- `shorts.mp4`
- `long.mp4`
- `mix.mp4`

Same query set:

- `experiments/semantic-script/shared/query-set-v1.json`

| Lane | Literal | Intent | Hard Negative | Total | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| A-script-lite | 11 / 12 | 12 / 12 | 6 / 6 | 29 / 30 | Still baseline |
| B-media-memory | 10 / 12 | 12 / 12 | 4 / 6 | 26 / 30 | Too noisy raw |
| C-editor-queries | 10 / 12 | 12 / 12 | 6 / 6 | 28 / 30 | Keep as challenger |
| D-dual-gated | 10 / 12 | 12 / 12 | 6 / 6 | 28 / 30 | Useful safety policy |
| E-negative-judge | 10 / 12 | 12 / 12 | 6 / 6 | 28 / 30 | Useful safety gate |
| F-field-tiered | 11 / 12 | 12 / 12 | 6 / 6 | 29 / 30 | Promote for rerank testing |

## Lane A: Script-Lite Baseline

Path:

```text
experiments/semantic-script/lanes/A-script-lite/
```

Approach:

```text
visual + audio + visible_text + tags
-> Gemini Embedding 2
-> lexical/vector search
```

Result:

```text
29 / 30
```

Read:

A is annoyingly strong. It is not fancy, but it has clean evidence and fewer generic labels.

## Lane B: Media Memory

Path:

```text
experiments/semantic-script/lanes/B-media-memory/
```

Approach:

```text
summary/actions/objects/setting/editor_use/search_phrases
-> Gemini Embedding 2
-> search
```

Result:

```text
26 / 30
```

Read:

B adds richer editor language, but raw rich fields create false positives.

The bad failure:

```text
query: office meeting presentation
bad hit: woman in kitchen explaining recipe
cause: generic terms like presentation/presenting
```

## Lane C: Editor Queries

Path:

```text
experiments/semantic-script/lanes/C-editor-queries/
experiments/semantic-script/editor_queries.py
```

Approach:

```text
existing B memory JSONL
-> extract/generated editor query phrases
-> filter generic phrases
-> Gemini Embedding 2
-> search
```

Result:

```text
28 / 30
```

Read:

C is the cleanest "wild" idea. It avoids another Gemini generation pass and converts rich memory into query-like text.

But it did not beat A. Keep it as a challenger, not default.

## Lane D: Dual Gated

Path:

```text
experiments/semantic-script/lanes/D-dual-gated/
experiments/semantic-script/lane_d_dual_gated.py
```

Approach:

```text
A high-trust result gates B media-memory result
```

Result:

```text
28 / 30
```

Read:

D is product-shaped.

It says:

```text
Do not let rich memory return a result unless high-trust script evidence supports the asset.
```

This fixed the `office meeting presentation` false positive.

## Lane E: Negative Judge

Path:

```text
experiments/semantic-script/lanes/E-negative-judge/
experiments/semantic-script/lane_e_negative_judge.py
```

Approach:

```text
B search results
-> deterministic post-search judge
-> reject hard negatives and weak evidence
```

Result:

```text
28 / 30
```

Read:

E is a cheap safety filter. It is useful, but it is not a better ranker.

It rejects obvious junk, but it does not fix wrong timestamp preference.

## Lane F: Field Tiered

Path:

```text
experiments/semantic-script/lanes/F-field-tiered/
experiments/semantic-script/lane_f_field_tiered.py
```

Approach:

```text
existing B memory JSONL
-> split fields by trust tier
-> deterministic lexical rank
-> low-trust fields can boost, not create hits alone
```

Result:

```text
29 / 30
```

Read:

F tied A without making embedding calls. This is the most product-shaped wild lane so far.

It still missed one timestamp case:

```text
query: wolf pups den
expected: long 10.0-11.0
top hit: long 4.0-9.0
reason: top hit literally contains wolf + pups + den, but it is a broader nearby moment
```

That is not a disaster. It means F is good at rejecting junk and ranking evidence, but timestamp precision still needs a second pass.

## What We Learned

More Gemini memory is not automatically better.

The better product architecture is probably:

```text
A/F-style high-trust evidence spine
+ field-tiered B memory
+ optional E-style negative judge
```

Not:

```text
throw every rich Gemini field into one embedding blob
```

## Next Experiment

Do not add more random lanes yet.

Next useful test:

```text
run F on a bigger fixture, then test F + E as the product reranker path
```

Also test timestamp tightening:

```text
- rerank adjacent moments together
- prefer shorter matching windows when scores are close
- return a timestamp range plus neighboring context
```

The stupid-simple first product version is:

```text
embedding for recall, field-tiered rerank for trust, timestamp window for editor UX
```

That is the actual product-shaped next step.
