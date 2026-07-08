# Provider and resolver boundaries

Last updated: 2026-05-19

## Rules

1. **Resolvers** (`src/rippopotamus/resolvers/`) own host-specific URL logic and adapter calls. The React renderer must not branch on YouTube vs Drive vs Archive hostnames.
2. **`electron/browserIpc.ts`** is a **SERP/browser adapter** only. Do not add download queues or manifest logic there.
3. **`desktop_engine.py`** stays a **thin router**: new workflows live in their own modules (e.g. `torrent_downloads.py`) with one subparser registration each.
4. **IPC payloads** are typed in `electron/types.d.ts`. Breaking field changes need a version bump or dual-read in the engine.

## Downloader Engine Contract

Rippo has one reliability-first transfer engine: `aria2c`.

- `yt-dlp` resolves video/audio pages and may still perform site-specific downloads when a stream cannot be delegated safely.
- `gallery-dl` resolves and saves image galleries through its provider-specific path.
- `aria2c` handles torrent links directly and is passed to `yt-dlp` for safe HTTP(S) transfers.
- `ffmpeg` handles HLS/DASH/media merge and conversion work.
- Google Drive uses Rippo's owned stream downloader because Drive confirmation and cookie behavior are special.

Runtime lookup order for `aria2c`: `RIPPO_ARIA2C_PATH`, bundled `resources/bin/aria2c(.exe)`, then PATH.

Do not add another full download manager path unless it replaces this contract end to end.

## SearchRuntime (future)

Library search should call a single `SearchRuntime` port: today only **lexical** (filename/metadata) is active in the desktop product. Semantic adapters remain in `experiments/` until promoted.
