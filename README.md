# Rippopotamus

Feed it links. It spits out assets.

Rippopotamus is a local desktop media ingest tool for editors, designers, and creative teams. It batch-ingests media links, downloads source assets, extracts audio/thumbnails/clips, and organizes everything into editor-ready project folders.

## Product Shape

Rippopotamus is not trying to beat downloader engines. It uses providers like `yt-dlp`, `gallery-dl`, and `ffmpeg` as low-level media tools, then adds the missing creative workflow layer:

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
   - Video / audio through `yt-dlp`
   - Images through `gallery-dl`
   - Best MP4
   - MP3 audio
   - Thumbnail only
   - Image gallery
   - Proxy MP4
4. Download into a structured project folder.
5. Generate `manifest.json` with source URLs and metadata.
6. Show failed links with readable errors and retry actions.

## First Architecture

- Core engine: Python CLI routing explicit providers like `yt-dlp`, `gallery-dl`, and `ffmpeg`
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
```

The macOS app package currently includes the renderer, Electron main process, Python engine source, and bundled `ffmpeg-static`. The remaining distribution step is freezing the Python engine/provider runtime into a standalone binary so friends do not need a local Python install.
