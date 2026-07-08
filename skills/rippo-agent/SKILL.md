# Rippo Agent CLI

Use this skill when an agent needs to operate Rippopotamus from the terminal: inspect runtime health, fetch media metadata, download assets, or run the older stateful project workflow.

This is the repo-neutral copy. Claude can read `.claude/skills/rippo-agent/SKILL.md`; other agents should read this file.

## First Command

Always start with discovery unless the user asked for one exact command:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli capabilities
```

This prints JSON for the available providers, presets, runtime env vars, and command routes.

## Command Shape

Run commands from the repo root:

```bash
cd /Users/dev/Documents/Rippopotamus
PYTHONPATH=src python -m rippopotamus.agent_cli <command> [args...]
```

There are three surfaces:

- `capabilities`: machine-readable inventory.
- `project <args...>`: forwards to the original `rippo` project workflow in `src/rippopotamus/cli.py`.
- `engine <args...>`: forwards to the desktop JSON engine in `src/rippopotamus/desktop_engine.py`.

Shortcuts exist for common agent work:

- `doctor`: runtime health.
- `fetch-metadata`: metadata for one URL.
- `download-asset`: download one URL to an output root.

## Runtime Truth

Do not guess which binaries or providers are available. Run:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli doctor
```

This checks Python, `yt-dlp`, `gallery-dl`, `aria2c`, `ffmpeg`, cookies, providers, and presets.

Important env vars:

- `RIPPO_YTDLP_PATH`: explicit `yt-dlp` executable.
- `RIPPO_FFMPEG_PATH` or `RIPPO_FFMPEG_LOCATION`: explicit `ffmpeg`.
- `RIPPO_COOKIES_FROM_BROWSER`: default browser cookie source.
- `RIPPO_GALLERYDL_ROOT`: managed gallery-dl location.
- `RIPPO_ARIA2C_PATH`: explicit aria2c executable.

## Examples

Fetch metadata:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli fetch-metadata --url "https://example.com/video" --provider auto
```

Download one asset:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli download-asset \
  --url "https://example.com/video" \
  --preset mp4-best \
  --output-root "$HOME/Downloads/Rippo" \
  --title "example-video"
```

Stateful project workflow:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli project init "Client Project" --path .prototype/client-project
PYTHONPATH=src python -m rippopotamus.agent_cli project add "https://example.com/video"
PYTHONPATH=src python -m rippopotamus.agent_cli project fetch
PYTHONPATH=src python -m rippopotamus.agent_cli project download --preset mp4-best
PYTHONPATH=src python -m rippopotamus.agent_cli project manifest
PYTHONPATH=src python -m rippopotamus.agent_cli project zip
```

## Agent Rules

- Prefer `capabilities` and `doctor` before making repo claims.
- Use `engine` or shortcuts for desktop download work because they emit JSON.
- Use `project` only for the older folder-based project workflow.
- Keep downloaded media out of commits unless the user explicitly asks for it.
- If a command needs cookies, pass `--cookies-browser chrome` or the browser shown by the desktop cookie settings.
- Do not claim visual, object, transcript, source search, or semantic search is enabled.
