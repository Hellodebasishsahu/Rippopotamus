# Rippo Agent CLI Surface

Last updated: 2026-05-13

This is the repo-grounded command map for agents. It does not invent a second product API. It wraps the two real Python surfaces already in the codebase.

## What Exists

Rippo has two CLI layers:

- `src/rippopotamus/cli.py`: older stateful project workflow.
- `src/rippopotamus/desktop_engine.py`: desktop JSON engine used by Electron for health, metadata, and downloads.

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
```

## Shortcuts

The shortcut commands are just readable names for engine commands:

| Shortcut | Forwards to |
| --- | --- |
| `doctor` | `engine health` |
| `fetch-metadata` | `engine fetch` |
| `download-asset` | `engine download` |

## Local Skills

The repo-neutral agent skill lives at:

```text
skills/rippo-agent/SKILL.md
```

Claude also has a mirror at:

```text
.claude/skills/rippo-agent/SKILL.md
```

Both tell agents to discover capabilities first, use JSON engine routes for desktop download work, and avoid committing generated media unless explicitly asked.
