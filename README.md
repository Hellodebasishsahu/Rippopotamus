# Rippopotamus

Feed it links. It spits out assets.

Rippopotamus is a local desktop media ingest tool for editors, designers, and creative teams. It batch-ingests media links, downloads source assets, extracts audio/thumbnails/clips, and organizes everything into editor-ready project folders.

## Product Shape

Rippopotamus is not trying to beat `yt-dlp` as a downloader engine. It uses `yt-dlp` and `ffmpeg` as the low-level media tools, then adds the missing creative workflow layer:

- Batch link intake
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
3. Choose preset:
   - Best MP4
   - MP3 audio
   - Thumbnail only
   - Proxy MP4
4. Download into a structured project folder.
5. Generate `manifest.json` with source URLs and metadata.
6. Show failed links with readable errors and retry actions.

## First Architecture

- Core engine: Python CLI wrapping `yt-dlp` and `ffmpeg`
- Desktop shell: Electron or Tauri after the CLI engine is stable
- Local state: SQLite
- Output: normal folders on disk

## Project Folder Output

```text
Project Name/
  Source/
  Audio/
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
- `proxy`
