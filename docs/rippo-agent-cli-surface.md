# Rippo Agent CLI Surface

Last updated: 2026-05-13

This is the repo-grounded command map for agents. It does not invent a second product API. It wraps the two real Python surfaces already in the codebase.

## What Exists

Rippo has two CLI layers:

- `src/rippopotamus/cli.py`: older stateful project workflow.
- `src/rippopotamus/desktop_engine.py`: desktop JSON engine used by Electron for health, metadata, downloads, source search, model catalog, and local library indexing/search.

The agent entrypoint is:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli
```

Agents should start with:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli capabilities
PYTHONPATH=src python -m rippopotamus.agent_cli doctor
```

`capabilities` prints machine-readable command/provider/preset/env inventory. `doctor` runs the real desktop health command.

## Routes

### `project`

Forwards to `src/rippopotamus/cli.py`.

Use it for the older folder project workflow:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli project init "Client Project" --path .prototype/client-project
PYTHONPATH=src python -m rippopotamus.agent_cli project add "https://example.com/video"
PYTHONPATH=src python -m rippopotamus.agent_cli project fetch
PYTHONPATH=src python -m rippopotamus.agent_cli project download --preset mp4-best
PYTHONPATH=src python -m rippopotamus.agent_cli project manifest
PYTHONPATH=src python -m rippopotamus.agent_cli project zip
```

### `engine`

Forwards to `src/rippopotamus/desktop_engine.py`.

Use it when agents need the same feature set Electron uses:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli engine health
PYTHONPATH=src python -m rippopotamus.agent_cli engine fetch --url "https://example.com/video" --provider auto
PYTHONPATH=src python -m rippopotamus.agent_cli engine download --url "https://example.com/video" --preset mp4-best --output-root "$HOME/Downloads/Rippo"
PYTHONPATH=src python -m rippopotamus.agent_cli engine source-search --query "moon landing footage" --pack all --limit 8
PYTHONPATH=src python -m rippopotamus.agent_cli engine ai-models
PYTHONPATH=src python -m rippopotamus.agent_cli engine index-status --index-root "$HOME/Library/Application Support/rippopotamus/library-index"
PYTHONPATH=src python -m rippopotamus.agent_cli engine index-ingest --index-root "$HOME/Library/Application Support/rippopotamus/library-index" "/path/to/media"
PYTHONPATH=src python -m rippopotamus.agent_cli engine index-search --no-vector --index-root "$HOME/Library/Application Support/rippopotamus/library-index" --query "Rohtak Modi"
```

## Shortcuts

The shortcut commands are just readable names for engine commands:

| Shortcut | Forwards to |
| --- | --- |
| `doctor` | `engine health` |
| `fetch-metadata` | `engine fetch` |
| `download-asset` | `engine download` |
| `find-sources` | `engine source-search` |
| `models` | `engine ai-models` |
| `library-status` | `engine index-status` |
| `library-ingest` | `engine index-ingest` |
| `library-search` | `engine index-search` |
| `library-upsert` | `engine index-upsert` |

## Local Skill

The repo-local agent skill lives at:

```text
.claude/skills/rippo-agent/SKILL.md
```

That skill tells agents to discover capabilities first, use JSON engine routes for desktop/library/search work, and avoid committing generated media/index files unless explicitly asked.
