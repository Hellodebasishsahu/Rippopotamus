# Rippopotamus Pre-Release Checklist

Use this before cutting any local test build or sharing a macOS/Windows app package.

## Current Run Status - 2026-07-06

- Automated gate: passed with `npm test` (72 Python tests, desktop build, 41 Node tests).
- Version bumped to `0.2.0` across root/desktop/website `package.json` and `pyproject.toml`; `CHANGELOG.md` added.
- Open-source prep landed: MIT LICENSE, public README (now documents both `rippo` and `rippo-engine` surfaces), CONTRIBUTING.md, test CI workflow, `docs/gtm/` untracked.
- Packaging hygiene fixed: `after-pack.cjs` prunes `__pycache__`/`.pyc`/`.pyo` from the packaged engine, `verify-package-artifact.mjs` fails on any compiled Python in the bundle, and the desktop `extraResources` entry filters bytecode at copy time.
- Dead-feature cleanup: sheet-link strings removed from intake status, unused `BrandIcon.tsx` deleted.
- Thumbnail scoring comment in `pageProbePolicy.ts` synced with behavior (thumbnails kept at score 10, not rejected).
- Remaining external release blockers (unchanged): Python/yt-dlp/gallery-dl runtime is not frozen into the package (`build-engine.sh`/PyInstaller path exists but is not wired into `package:mac`/`package:win`), no signing/notarization/installer, and no GUI smoke on real Windows hardware.

## Current Run Status - 2026-05-09

- Automated gate: passed with `npm test`.
- Desktop engine health: passed with Python, `yt-dlp 2026.03.17`, and `ffmpeg 8.0.1`.
- CLI smoke: passed for init, add, status, manifest, zip, fetch, dry-run, and readable metadata failure.
- Real media smoke: passed for `mp4-best`, `proxy`, `audio-mp3`, and `thumbnail` using public sample media.
- macOS package: passed for local test build at `release/mac-arm64/Rippopotamus.app`.
- Desktop dev boot: blocked. Port `5173` is already held by an existing Node/Vite process from this repo, Vite moved to `5174`, and Electron exited with `SIGABRT`.
- External release blockers remain: Python/yt-dlp is not frozen, signing is ad hoc, and notarization is skipped.

## Current Windows Support Status - 2026-05-13

- Windows x64 directory packaging is wired through `npm run package:win`.
- Expected Windows x64 local test build path is `release/win-unpacked/Rippopotamus.exe`.
- Packaged ffmpeg lookup uses `ffmpeg.exe` on Windows and unpacked `ffmpeg-static` resources.
- Windows package branding uses `public/brand-logo.ico`.
- Python runtime discovery now includes the Windows launcher/path commands: `py`, `python`, and `python3`.
- Remaining Windows release blockers: no frozen Python/provider runtime, no Windows signing, no installer target, and no real Windows-machine smoke yet.
- Mac-to-Windows cross-builds explicitly run `npm run prepare:ffmpeg:win` so the packaged directory contains `ffmpeg.exe`. Final Windows media smoke still needs a Windows install or Windows CI runner.
- Electron Builder runs `scripts/after-pack.cjs` to fail missing target ffmpeg binaries and prune wrong-platform ffmpeg binaries from packaged output.

## Current Run Status - 2026-05-13

- Automated gate: passed with `npm test` after `npm ci`.
- Dependency install: `npm ci` passed with 0 vulnerabilities. Editable Python install passed in a temp Python 3.13 venv at `/tmp/rippo-prepod-venv`; the literal `/usr/bin/python3` path on this Mac is Python 3.9.6 and fails the repo's `>=3.11` requirement.
- Desktop engine health: passed with Homebrew Python 3.13, `yt-dlp 2026.03.17`, ffmpeg 8.0.1, and aria2c torrent support. `gallery-dl` remains missing from the host install.
- CLI smoke: passed for init, add, status, manifest, zip, dry-run, expected folders, and manifest contents using `/tmp/rippo-release-smoke`.
- Real media smoke: passed for `mp4-best`, `proxy`, `audio-mp3`, and `thumbnail` using `https://archive.org/details/SampleVideo1280x7205mb`. The previous YouTube test URL now returns "Video unavailable" for real downloads, so it is no longer a valid smoke URL.
- Readable failure smoke: passed. `https://example.com/not-a-video` returned `media not found` / `This source is no longer available`, not a stack trace.
- Desktop dev boot: passed. `npm run dev` opened a nonblank Electron window, showed Tools health for Python, yt-dlp, aria2c, and ffmpeg, accepted multiple pasted URLs, fetched good metadata, kept the failed link visible, showed download progress, saved one MP4, and opened `/Users/dev/Downloads/Rippo` in Finder.
- Native packages: passed for `npm run package:win` and `npm run package:mac`. Windows artifact is `release/win-unpacked/Rippopotamus.exe` and macOS artifact is `release/mac-arm64/Rippopotamus.app`.
- Package artifact verifier: `npm run verify:package:mac` passed and checks Mach-O executable headers. `npm run verify:package:win` passed and checks PE executable headers for both `Rippopotamus.exe` and bundled `ffmpeg.exe`.
- Packaged engine health: `npm run verify:package:mac:engine` passed locally and confirmed the packaged macOS engine uses the packaged ffmpeg path. `npm run verify:package:win:engine` is wired for Windows CI only because it must execute the packaged Windows `ffmpeg.exe` on Windows.
- Package binary hygiene: packaged macOS output must not include `ffmpeg.exe`, and packaged Windows output must not include the macOS/Linux `ffmpeg` binary.
- Artifact review: no `.env`, `manifest.json`, scratch, output, ChatGPT, appraisal, tests, docs, or experiment paths were found inside the packaged asar/resources scan. `release/win-unpacked/Rippopotamus.exe` is PE32+ x86-64 and the mac app binary is arm64.
- Windows CI: passed in GitHub Actions run `25819033019` on a real `windows-latest` runner. The job installed the Python engine, ran `npm ci`, ran `npm test`, ran `npm run package:win:ci`, ran packaged Windows engine health against bundled `ffmpeg.exe`, and uploaded `release/win-unpacked`.
- Important blocker: Windows packaging and packaged engine health are proven on Windows CI, but GUI launch/download smoke on an actual Windows desktop is still required before sharing broadly.
- External release blockers remain: Python/yt-dlp is not frozen, Windows installer/signing is not configured, macOS notarization is skipped, and real Windows-machine launch/download smoke is still required before sharing broadly.

## Audit - 2026-05-09

- `package.json` and `pyproject.toml` are both at version `0.1.0`.
- `package.json` now sets `build.mac.icon` to `public/brand-logo.png`.
- Latest packaged app has `CFBundleIconFile=icon.icns` and `Contents/Resources/icon.icns`.
- Latest packaged app is `arm64`, app id `app.rippopotamus.desktop`, and ad hoc signed.
- `npm test` was rerun after the icon config change and passed.
- Desktop engine health was rerun and passed.
- Port `5173` is still occupied by a Node process from this repo, so the desktop runtime checklist remains blocked.
- The working tree is dirty. Staged changes already include UI/image/lockfile work outside this checklist; unstaged release-checklist changes are `package.json`, `index.html`, and this file.
- The packaged bundle scan did not find downloaded media, scratch files, generated ChatGPT images, appraisal notes, or project manifests.
- The packaged engine currently includes `__pycache__` files, so final artifact hygiene still needs an explicit decision or cleanup before external release.

## 1. Scope Freeze

- [ ] Confirm the release target: local CLI, desktop MVP, macOS packaged app, or Windows packaged app.
- [x] Confirm the release version in `package.json` and `pyproject.toml` matches.
- [x] Review `git status --short -b` and separate release changes from scratch files, generated images, and unrelated notes.
- [ ] Confirm no local-only paths, test downloads, personal output folders, or credentials are staged.
- [ ] Update `README.md` if install, run, packaging, or known limitation notes changed.

## 2. Dependency And Tooling Health

- [ ] Run `npm install` or `npm ci` from a clean checkout.
- [x] Confirm Python runtime is available with `python3 --version` and is `>=3.11`.
- [ ] Install the Python engine in editable mode with `python3 -m pip install -e .`.
- [x] Confirm `yt-dlp` is available through the Python package or `yt-dlp --version`.
- [x] Confirm ffmpeg is available through `ffmpeg-static`, `RIPPO_FFMPEG_PATH`, or system `ffmpeg`.
- [x] Run desktop engine health:

```bash
PYTHONPATH=src python3 -m rippopotamus.desktop_engine health
```

Expected: JSON with `"ok": true`, `ytDlp`, and `ffmpegOk: true` for desktop media download readiness.

## 3. Automated Checks

- [x] Run the full project check:

```bash
npm test
```

This currently covers:

- Python CLI unit tests in `tests/`
- Vite renderer production build
- Electron TypeScript build

- [x] If `npm test` fails, fix the failing check before packaging.
- [x] Confirm `dist/renderer/` and `dist-electron/` are regenerated from current source.

## 4. CLI Smoke Test

- [x] Create a fresh throwaway project:

```bash
rm -rf /tmp/rippo-release-smoke
rippo init "Release Smoke" --path /tmp/rippo-release-smoke
cd /tmp/rippo-release-smoke
rippo add https://example.com/video
rippo status
rippo manifest
rippo zip
```

- [x] Confirm project folders exist: `Source/`, `Audio/`, `Thumbnails/`, `Clips/`, `Exports/`.
- [x] Confirm `manifest.json` contains the queued URL and project metadata.
- [x] Confirm `Exports/release-smoke.zip` is created.
- [x] Run `rippo download --preset mp4-best --dry-run` on a fetched item before any real download smoke.

## 5. Real Media Smoke Test

Use one short public test URL that is safe to download.

- [x] Fetch metadata successfully from the desktop engine:

```bash
PYTHONPATH=src python3 -m rippopotamus.desktop_engine fetch --url "<public-test-url>"
```

- [x] Download each release-critical preset at least once:
  - [x] `mp4-best`
  - [x] `audio-mp3`
  - [x] `thumbnail`
  - [x] `proxy`
- [x] Confirm files land in the expected folders.
- [x] Confirm filenames are slugged and include the item id.
- [x] Confirm failed or unsupported URLs return readable errors, not raw stack traces.

## 6. Desktop Runtime Check

- [x] Start the desktop app:

```bash
npm run dev
```

- [ ] Confirm the app opens without a blank window.
- [ ] Confirm health/status shows usable Python, `yt-dlp`, and ffmpeg state.
- [ ] Paste multiple URLs and verify queue behavior.
- [ ] Fetch metadata and confirm title, thumbnail, duration, and platform display correctly.
- [ ] Download one short media item and verify progress events update the UI.
- [ ] Confirm failed links stay visible with retryable, readable errors.
- [ ] Confirm the output folder button opens the correct download folder.
- [ ] Confirm app reload/close behavior does not lose visible queue state unexpectedly.

## 7. Native Package Check

- [x] Build the packaged app:

```bash
npm run package:mac
```

- [ ] Open `release/mac-arm64/Rippopotamus.app`.
- [ ] For Windows test builds, run:

```bash
npm run package:win
```

- [ ] Open `release/win-unpacked/Rippopotamus.exe` on a Windows x64 machine.
- [x] Confirm packaged renderer loads from `dist/renderer/index.html`.
- [x] Confirm packaged Electron main loads from `dist-electron/main.js`.
- [ ] Confirm packaged app can run `engine:health`.
- [x] Confirm bundled ffmpeg path resolves in packaged mode.
- [x] Confirm the app still needs local Python/yt-dlp unless the release explicitly includes a frozen engine.
- [x] If sharing with non-developers, do not release until the Python/yt-dlp runtime is frozen into the app or clearly documented as required.

## 8. Release Artifact Review

- [ ] Inspect `release/` and remove stale builds before final packaging.
- [ ] Confirm artifact name, version, and target architecture.
- [x] Confirm app icon, title, and visible branding are correct.
- [ ] Confirm no downloaded media, scratch files, logs, or personal files are inside the app bundle.
- [x] Confirm `.asar` packaging includes only expected renderer, Electron, package metadata, and engine resources.
- [ ] Confirm license state is acceptable for an `UNLICENSED` app before sharing outside trusted testers.

## 9. Final Git Review

- [x] Run `git diff --stat`.
- [ ] Review staged diff with `git diff --staged`.
- [ ] Confirm lockfile changes are intentional and match the package manager being used.
- [ ] Confirm generated assets are intentionally included.
- [ ] Commit only the coherent release batch.
- [ ] Tag only after the packaged app and smoke tests pass.

## 10. Known Release Blockers

- [ ] Python engine is not yet frozen into a standalone binary.
- [ ] `yt-dlp` availability still depends on Python package or system PATH.
- [ ] macOS signing and notarization are not configured.
- [ ] Windows packaging has only a local directory target; installer, signing, and real Windows smoke are still required before sharing broadly.
- [ ] Real-platform downloads can break when upstream platforms change; run the real media smoke test on release day.
