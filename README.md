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
npm run package:win
```

The macOS and Windows app packages currently include the renderer, Electron main process, Python engine source, and bundled `ffmpeg-static`. The remaining distribution step is freezing the Python engine/provider runtime into a standalone binary so friends do not need a local Python install. Windows x64 test builds land at `release/win-unpacked/Rippopotamus.exe`; Windows ARM64 test builds can be created with `npm run package:win:arm64`.

## Search Routing

Text searches use a small query scout before source adapters run. Preferred evidence providers are stable APIs:

- `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID`
- `SERPER_API_KEY`

Google Custom Search JSON API is closed to new customers, so fresh Google Cloud projects can still fail even with a valid key and search engine ID. Keep `SERPER_API_KEY` or the desktop browser scout as the practical fallback.

For local experiments, enable browser SERP scouting:

```bash
RIPPO_SERP_BROWSER=1 npm run dev
```

In the desktop app, that mode uses Electron's bundled Chromium to open Google Search, strips obvious sponsored/noise links, and passes only organic titles/URLs/snippets into the Python router. It is a fallback surface: CAPTCHA, consent pages, layout changes, and regional variance can still break it.

For CLI-only experiments outside Electron, `pip install -e ".[browser-serp]"` enables the older Crawl4AI provider only when explicitly forced with `RIPPO_SEARCH_PROVIDER=crawl4ai_google`.
