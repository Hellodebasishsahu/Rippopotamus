# C Editor Queries

Experimental Lane C turns existing media-memory moments into search rows that over-index on editor query phrases.

It intentionally does not call Gemini by default. The first run uses Lane B `search_phrases`, light local aliases, and generic-label filtering so phrases like `presentation` do not become false-positive magnets.

Run:

```bash
python experiments/semantic-script/editor_queries.py run --clean
```

Outputs land under `runs/<run-id>/`.
