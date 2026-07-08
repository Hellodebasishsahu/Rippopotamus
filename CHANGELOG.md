# Changelog

## 0.4.0 — 2026-07-08

- **Playlist & channel expansion:** paste a YouTube playlist or channel URL and Rippo fans it out into individual queue items (capped at 150, with a heads-up when a channel is larger).
- **Per-item quality picker:** each video shows its *real* available resolutions (Best / 1080p / 720p / … / Audio) pulled from the source, and downloads exactly the one you pick.
- Engine: `fetch --expand` for playlist resolution, `download --max-height` for resolution capping, and available resolutions surfaced in metadata.

## 0.3.2 — 2026-07-08

- The app is now **Rippo** (dock, window title, `Rippo.app`); Rippopotamus stays as the full brand.
- Real app icon: the hippo brand mark replaces the default Tauri icon.
- One-line installers (`curl … | bash` / `irm … | iex`) that verify SHA256 and clear Gatekeeper/SmartScreen; the website hero now leads with them.
- CI publishes `SHA256SUMS` with every release; Scoop manifest available at `/rippopotamus.json`.
- Updater signing key rotated — 0.3.1 and older cannot auto-update to this version; reinstall once via the installer.
- Website: SEO/meta overhaul (OG tags, JSON-LD, sitemap, robots).

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
