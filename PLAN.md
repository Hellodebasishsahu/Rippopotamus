# Rippopotamus Build Plan

## Phase 1: Local CLI Engine

Goal: prove the workflow without desktop packaging.

Commands:

```bash
rippo init "Client Project"
rippo add <url>
rippo fetch
rippo download --preset mp4-best
rippo manifest
```

Deliverables:

- Project workspace creator
- URL queue
- Metadata fetcher
- Explicit provider routing
- Preset-based downloader
- Manifest writer
- Plain English errors

## Phase 2: Media Presets

Presets:

- `mp4-best`: best reasonable MP4
- `audio-mp3`: MP3 extraction
- `thumbnail`: best thumbnail
- `gallery`: image/gallery download through gallery-dl
- `proxy`: smaller H.264 MP4 for editing/reference
- `drive-file`: Google Drive file download
- `torrent`: torrent or magnet link download

## Phase 3: Desktop MVP

Views:

- Intake queue
- Metadata board
- Preset picker
- Download progress
- Failed links
- Project folder open button

Desktop should call the CLI/core engine instead of duplicating media logic.

## Phase 4: Distribution

Mac first:

- Bundle engine
- Bundle `yt-dlp`
- Bundle `gallery-dl`
- Bundle `ffmpeg`
- Sign/notarize when ready
- Ship `.dmg`

Windows later:

- Bundle engine
- Bundle `ffmpeg`
- Ship installer

## Product Moat

The moat is the creative workflow, not downloading:

- Organized handoff folders
- Source manifests
- Batch review before downloading
- Platform-specific failure recovery
- Editing presets
- Repeatable local project intake
