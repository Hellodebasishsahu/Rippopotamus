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
5. Generate `manifest.json` with source URLs and metadata.
6. Show failed links with readable errors and retry actions.

## Architecture

- Core engine: Python CLI routing resolvers (`yt-dlp`, `gallery-dl`, Drive, Torrent) into transfer engines (`aria2c`, `ffmpeg`, Drive API)
- Desktop shell: Electron + Vite calling the Python media engine over local IPC
- Local state: JSON ledgers (`.rippo-downloads.json`)
- Output: normal folders on disk

See [`docs/rippo-architecture-lld.md`](docs/rippo-architecture-lld.md) for the full architecture writeup.

## Requirements

- Python >= 3.11
- Node.js (CI runs on Node 24)
- `ffmpeg` — pulled in for CLI use via the `imageio-ffmpeg` Python dependency; the packaged desktop app bundles its own binary
- `aria2c` on your `PATH` — only needed for torrent transfers when running the CLI directly; the packaged desktop app bundles its own binary
- `yt-dlp` and `gallery-dl` install automatically as Python dependencies

## Project Layout

```text
apps/desktop/        Electron + Vite desktop app (renderer + main process)
apps/website/        Marketing site workspace
src/rippopotamus/    Python engine: CLI, resolvers, providers, desktop IPC bridge
tests/               Python (unittest) and Node (node:test) test suites
docs/                Architecture and design notes
scripts/             Build, packaging, and dev-workflow scripts
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

The desktop shell is Electron + Vite calling the Python media engine over local subprocess IPC. It focuses on link intake, metadata, presets, queue state, readable failures, local output, and opening the output folder.

```bash
npm install
npm run dev
```

Other useful scripts from the repo root:

```bash
npm run build            # build the desktop app
npm run package:mac      # package a macOS .dmg (macOS only)
npm run package:win      # package a Windows build (Windows only)
```

The macOS and Windows app packages currently include the renderer, Electron main process, Python engine source, bundled `ffmpeg-static`, and a bundled `aria2c` resource. Set `RIPPO_ENGINE_BINARY` to a `rippo-engine` PyInstaller binary (see `scripts/build-engine.sh` and `pip install -e ".[engine-build]"`) to run without a system Python install. Rippo reads bundled `aria2c` from `resources/bin/aria2c` or `resources/bin/aria2c.exe`; `RIPPO_ARIA2C_PATH` overrides that. The remaining distribution step is freezing provider runtimes (`yt-dlp`, `gallery-dl`) for friends who do not already use them.

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
