# Rippo Agent CLI

Use this skill when an agent needs to operate Rippopotamus from the terminal: inspect runtime health, fetch media metadata, download assets, search sources, ingest/search the local media library, or run the older stateful project workflow.

## First Command

Always start with discovery unless the user asked for one exact command:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli capabilities
```

This prints JSON for the available providers, presets, source packs, runtime env vars, and command routes.

## Command Shape

Run commands from the repo root:

```bash
cd "$(git rev-parse --show-toplevel)"
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
- `find-sources`: web/source pack search.
- `models`: OpenRouter model catalog.
- `library-status`: local media index status.
- `library-ingest`: filename/basic metadata file ingest.
- `library-search`: filename/basic metadata local media index search.
- `library-upsert`: write structured moments.

## Runtime Truth

Do not guess which binaries or providers are available. Run:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli doctor
```

This checks Python, `yt-dlp`, `gallery-dl`, qBittorrent, `aria2c`, `ffmpeg`, cookies, providers, presets, and search evidence.

Important env vars:

- `RIPPO_YTDLP_PATH`: explicit `yt-dlp` executable.
- `RIPPO_FFMPEG_PATH` or `RIPPO_FFMPEG_LOCATION`: explicit `ffmpeg`.
- `RIPPO_COOKIES_FROM_BROWSER`: default browser cookie source.
- `RIPPO_GALLERYDL_ROOT`: managed gallery-dl location.
- `RIPPO_QBITTORRENT_PATH`: explicit qBittorrent executable.
- `OPENROUTER_API_KEY`: query intelligence/model catalog.
- `GOOGLE_CSE_API_KEY` and `GOOGLE_CSE_ID`: Google search evidence.
- `SERPER_API_KEY`: Serper search evidence.

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

Search source packs:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli find-sources --query "moon landing footage" --pack all --limit 8
```

Search the local library:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli library-search \
  --index-root "$HOME/Library/Application Support/rippopotamus/library-index" \
  --query "city hall rally" \
  --limit 10
```

Basic ingest:

```bash
PYTHONPATH=src python -m rippopotamus.agent_cli library-ingest \
  --index-root "$HOME/Library/Application Support/rippopotamus/library-index" \
  "/path/to/media"
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
- Use `engine` or shortcuts for desktop/library/search work because they emit JSON.
- Use `project` only for the older folder-based project workflow.
- Keep downloaded media and generated indexes out of commits unless the user explicitly asks for them.
- If a command needs cookies, pass `--cookies-browser chrome` or the browser shown by the desktop cookie settings.
- Do not claim visual, object, transcript, or semantic search is enabled. The active library search is filename/basic metadata only.
