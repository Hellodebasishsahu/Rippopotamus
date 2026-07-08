# RIPPO Experiments

Experimental code lives here before it graduates into `src/rippopotamus`.

Rules:

- Keep experiments runnable from the command line.
- Do not import experiment modules from production code.
- Write outputs under `experiments/out/` or a caller-provided path.
- Keep secrets in environment variables or secure app storage, not files here.
- Promote only the small stable pieces into `src/rippopotamus`.

Current lanes:

- `semantic-script/`: timestamped visual/audio scripts, text indexing, and rerank prototypes.
