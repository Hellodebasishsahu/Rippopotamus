# Changelog

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
