# Changelog

## 0.3.1 — 2026-07-07

- Branded macOS DMG install window (background art + drag-to-Applications arrow).
- Website download buttons use stable, direct URLs (no GitHub API call); Windows download enabled.
- Release workflow publishes stable-named `dmg`/`setup.exe` assets automatically.

## 0.3.0 — 2026-07-06

- Redesigned the queue: user-centric cards (thumbnail, title, state-aware meta) replacing the telemetry table.
- Per-card controls — each item has its own Save; bulk selection is now an opt-in accelerator, not the default.
- State-scoped affordances: format chips + Save (ready), inline progress bar (downloading), Open/reveal (done), Retry (failed).
- Wired the queue thumbnail bridge (previously unused); killed the empty-void layout.
- Friendlier download errors: strip yt-dlp `[extractor] id:` noise, map "no video" to guidance.

## 0.2.0 — 2026-07-06

- Rebuilt Library view: thumbnails, filters, incremental rendering, ledger-backed reads via `library.py`.
- Hardened library IPC with output-root path guards (`pathGuard.ts`).
- Refreshed intake shell, settings, and queue chrome; polished library layout and composer focus outlines.
- Fixed desktop dev launch across npm and pnpm workspaces.
- Removed dead features: sheet import, in-tree Gemini/semantic script.
- Open-source prep: MIT license, public README, CONTRIBUTING, test CI workflow.
- Packaging hygiene: `__pycache__`/`.pyc` pruned from packaged engine and verified absent by the artifact checker.

## 0.1.0

- Initial prototype: `rippo` CLI (init/add/fetch/download/manifest/zip), Electron desktop shell, yt-dlp/gallery-dl/aria2c/ffmpeg providers, macOS and Windows packaging.
