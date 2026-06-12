# Rippopotamus

Feed it links. It spits out assets.

Rippopotamus is a local desktop media ingest tool for editors, designers, and creative teams. It batch-ingests media links, downloads source assets, extracts audio/thumbnails/clips, and organizes everything into editor-ready project folders.

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
   - Best MP4
   - MP3 audio
   - Thumbnail only
   - Image gallery
   - Proxy MP4
4. Download into a structured project folder.
5. Generate `manifest.json` with source URLs and metadata.
6. Show failed links with readable errors and retry actions.

## First Architecture

- Core engine: Python CLI routing resolvers (`yt-dlp`, `gallery-dl`, Drive) into transfer engines (`aria2c`, `ffmpeg`, owned Drive stream)
- Desktop shell: Electron or Tauri after the CLI engine is stable
- Local state: SQLite
- Output: normal folders on disk

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

## Prototype CLI

Run from the repo:

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

## Desktop MVP

The first native shell is Electron + Vite calling the Python media engine over local subprocess IPC. It is intentionally focused on link intake, metadata, presets, queue state, readable failures, local output, and opening the output folder.

```bash
npm install
npm run dev
npm run package:mac
open release/mac-arm64/Rippopotamus.app
npm run package:win
```

The macOS and Windows app packages currently include the renderer, Electron main process, Python engine source, bundled `ffmpeg-static`, and a bundled `aria2c` resource. Set `RIPPO_ENGINE_BINARY` to a `rippo-engine` PyInstaller binary (see `scripts/build-engine.sh` and `pip install -e ".[engine-build]"`) to run without a system Python install. Rippo reads bundled `aria2c` from `resources/bin/aria2c` or `resources/bin/aria2c.exe`; `RIPPO_ARIA2C_PATH` overrides that. The remaining distribution step is freezing provider runtimes (`yt-dlp`, `gallery-dl`) for friends who do not already use them.
