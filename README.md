# Rippopotamus

Feed it links. It spits out assets.

Rippopotamus is a local-first desktop media ingest tool for editors, designers, and creative teams. It batch-ingests media links, downloads source assets, extracts audio/thumbnails/clips, and organizes everything into editor-ready project folders. Everything runs on your machine — no accounts, no cloud upload.

<!-- ![Rippopotamus screenshot](docs/screenshot.png) -->

## Product Shape

Rippopotamus is not trying to beat downloader engines. It uses `yt-dlp` and `gallery-dl` to resolve messy source links, `aria2c` as the reliable transfer engine where URLs can be handed off safely, and `ffmpeg` for media stream/merge work. Rippo owns the creative workflow layer:

- Batch link intake
- Explicit source provider choice
- Metadata and thumbnail preview
- Editor-friendly presets
- Clean file naming
- Project folder organization
- Source manifests
- Retryable failed links
- Local-first privacy

## MVP

1. Paste many URLs.
2. Fetch metadata: title, thumbnail, duration, platform, available formats.
3. Choose provider and preset:
   - Video / audio resolved through `yt-dlp`
   - Images resolved through `gallery-dl`
   - Torrents resolved through `aria2c`
   - Google Drive files
   - Best MP4
   - MP3 audio
   - Thumbnail only
   - Image gallery
   - Proxy MP4
   - Drive file
   - Torrent
4. Download into a structured project folder.
5. Track sources and outcomes: the desktop app keeps download/failure ledgers; the `rippo` prototype CLI generates `manifest.json` with source URLs and metadata.
6. Show failed links with readable errors and retry actions.

## Architecture

- Core engine: Python CLI routing resolvers (`yt-dlp`, `gallery-dl`, Drive, Torrent) into transfer engines (`aria2c`, `ffmpeg`, Drive API)
- Desktop shell: Tauri (Rust) + Vite/React calling the Python media engine as a spawned subprocess
- Local state: JSON ledgers (`.rippo-downloads.json`, `.rippo-failures.json`) for the desktop engine; `.rippo/project.json` + `manifest.json` for the `rippo` prototype CLI
- Output: normal folders on disk

There are two CLI surfaces:

- `rippo` — the stateful prototype workspace CLI (`init`/`add`/`fetch`/`download`/`manifest`/`status`/`zip`), which owns `manifest.json`
- `rippo-engine` (`python -m rippopotamus.desktop_engine`) — the stateless JSON-emitting engine the desktop app drives (`health`/`fetch`/`download`/`failures-list`/`library-list`/`proxy-check`)

See [`docs/rippo-architecture-lld.md`](docs/rippo-architecture-lld.md) for the full architecture writeup.

## Requirements

- Python >= 3.11
- Node.js (CI runs on Node 24)
- Rust stable + the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (Xcode command line tools on macOS, WebView2 on Windows) — only needed to build/run the desktop app from source; the packaged app bundles a frozen engine and needs none of this on the end user's machine
- `ffmpeg` — pulled in for CLI use via the `imageio-ffmpeg` Python dependency; the packaged desktop app bundles its own binary
- `aria2c` on your `PATH` — only needed for torrent transfers when running the CLI directly; the packaged desktop app bundles its own binary
- `yt-dlp` and `gallery-dl` install automatically as Python dependencies

## Project Layout

```text
apps/desktop/         Desktop app: Tauri (Rust) shell + shared Vite/React frontend
apps/desktop/src-tauri/  Rust backend (Tauri commands, engine spawn, packaging config)
apps/desktop/src/     Shared React frontend
apps/website/         Marketing site workspace
src/rippopotamus/     Python engine: CLI, resolvers, providers, desktop IPC bridge
tests/                Python (unittest) and Node (node:test) test suites
docs/                 Architecture and design notes
scripts/              Build, packaging, and dev-workflow scripts
```

## Project Folder Output

```text
Project Name/
  Source/
  Audio/
  Images/
  Thumbnails/
  Clips/
  Exports/
  manifest.json
```

## Development Principle

Build the ingest engine first. Keep the desktop app thin until the core media workflow is reliable.

## Quickstart: `rippo` CLI

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e .

rippo init "Client Project" --path .prototype/client-project
cd .prototype/client-project
rippo add https://example.com/video
rippo fetch
rippo download --preset mp4-best
rippo manifest
rippo zip
```

Available presets:

- `mp4-best`
- `audio-mp3`
- `thumbnail`
- `gallery`
- `proxy`
- `drive-file`
- `torrent`

## Quickstart: Desktop app (dev)

The desktop shell is Tauri (Rust) + Vite/React calling the Python media engine as a spawned subprocess. It focuses on link intake, metadata, presets, queue state, readable failures, local output, and opening the output folder.

```bash
npm install
npm run dev
```

This starts the Vite dev server and launches `tauri dev`, which opens a native window pointed at it and runs the Rust backend against your local Python engine and system `ffmpeg`/`aria2c` (or `RIPPO_*_PATH` overrides — see below).

Other useful scripts from the repo root:

```bash
npm run build            # typecheck + build the shared frontend
npm run package:tauri:mac  # build the frozen engine + package a macOS .app/.dmg (macOS only)
npm run package:tauri:win  # build the frozen engine + package a Windows NSIS installer (Windows only)
```

The macOS and Windows packaged apps bundle a frozen `rippo-engine` binary (PyInstaller `--onedir`, built via `scripts/build-engine.sh` / `npm run build:engine`), a bundled `ffmpeg-static` binary, and a bundled `aria2c` resource — end users need no system Python, ffmpeg, or aria2c install. Rippo reads the bundled `aria2c` from `resources/bin/aria2c` or `resources/bin/aria2c.exe` (`RIPPO_ARIA2C_PATH` overrides that) and the frozen engine from `resources/bin/rippo-engine/` (`RIPPO_ENGINE_BINARY` overrides that for local dev). Signed, in-place auto-update ships via `tauri-plugin-updater` (see `.github/workflows/release.yml`).

## Running Tests

```bash
npm test
```

This runs the full suite: Python `unittest` discovery over `tests/`, a desktop build, and the Node (`node:test`) suites in `tests/`. It requires a Python 3.11+ interpreter on `PATH`.

To run just the Python tests:

```bash
python -m unittest discover -s tests
```

## License

MIT.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for dev setup, test instructions, and PR conventions.
