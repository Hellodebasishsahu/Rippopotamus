# Tauri Migration — Low-Level Design

Migrate the desktop shell from **Electron** to **Tauri v2**. Goal: drop the
~261 MB bundled Chromium (72% of the app) while keeping the React frontend and
the Python engine untouched. Target DMG ~150 MB → ~55 MB.

## Principles

1. **The Python engine does not change.** It is already a stateless, per-invocation
   subprocess speaking JSON over stdio. Rust spawns it exactly as Node did. Any
   work already done on the engine (freeze, cookies, resolvers) carries over.
2. **The renderer barely changes.** All transport lives behind
   `apps/desktop/src/client/desktopClient.ts`. Swap its internals from
   `window.rippo.*` (Electron IPC) to Tauri `invoke()` + event `listen()`. Views,
   components, hooks stay as-is.
3. **Security-sensitive logic stays in the Rust backend** — path containment,
   settings, binary resolution. Not in the webview.
4. **Migrate on a branch; keep Electron working until parity; delete it last.**

## Layout

```
apps/desktop/
  src/            # React/Vite frontend — SHARED, mostly unchanged
  src-tauri/      # NEW — Rust backend (Cargo, tauri.conf.json)
  electron/       # kept until parity, DELETED in the teardown phase
```

Tauri points its `devUrl`/`frontendDist` at the existing Vite build.

## Transport mapping (Electron IPC → Tauri)

| Electron | Tauri |
|---|---|
| `ipcMain.handle("x", fn)` + `window.rippo.x()` | `#[tauri::command] async fn x()` + `invoke("x")` |
| `event.sender.send("progress", p)` + `ipcRenderer.on` | `app.emit("progress", p)` + `listen("progress")` |
| `preload.ts` bridge | deleted; `invoke`/`listen` imported in `desktopClient.ts` |

Request/response commands: `health`, `fetch`, `library_list`, `failures_list`,
`check_helpers`, `update_helpers`, `check_app_update`, `get/set_settings`,
`list_cookie_browsers`, `open_path`, `open_external`.
Streaming: `download` emits a single `engine:download-event` channel, with the
job id embedded in each event payload (`{ jobId, ...engineEvent }`) rather than
per-id event names — the frontend's one `listen("engine:download-event", ...)`
subscription demultiplexes by `event.payload.jobId`. (P1 implemented this
matching the real Electron code's single-channel + embedded-id shape; this
doc's earlier `download:progress:<id>` / `download:done:<id>` naming was
aspirational and never what either side actually did.) Cancellation is via a
`cancel_download(jobId)` command.

## Backend components (Rust rewrites)

| Electron file | Rust equivalent | Notes |
|---|---|---|
| `engineProcess.ts` | `engine.rs` | `tokio::process::Command`, stream stdout lines, parse JSON, emit events. Child handles in `Mutex<HashMap<String, Child>>` managed state for cancel. |
| `engineIpc.ts` | `commands/engine.rs` | argv + env assembly (`RIPPO_YTDLP_PATH`, `RIPPO_GALLERYDL_ROOT`, `RIPPO_ARIA2C_PATH`, ffmpeg loc). |
| `libraryIpc.ts` | `commands/library.rs` | calls engine `library-list` / `failures-list`; applies path guard. |
| `pathGuard.ts` | `path_guard.rs` | output-root containment. Security-critical → stays backend. Port the test too. |
| `settingsStore.ts` | `settings.rs` | JSON in Tauri `app_config_dir()`. |
| `helperRegistry.ts` | `helpers.rs` | `reqwest` to GitHub/PyPI, download to app data dir, atomic rename. Same descriptor table, same env contract. |
| `appUpdatesIpc.ts` | `app_update.rs` | GitHub `releases/latest`; match `.dmg`/`.exe` asset. Opens URL via `tauri-plugin-opener`. |
| `cookiesIpc.ts` | `cookies.rs` | list installed browsers only (actual cookie read stays yt-dlp `--cookies-from-browser`). |
| `appPaths.ts` | `paths.rs` | resolve bundled ffmpeg/aria2c/engine from Tauri resource dir. |
| `versionUtils.ts` | `version.rs` | numeric version compare. |
| `thumbnails.ts` | `commands/thumbnails.rs` | native + ffmpeg fallback, cache. |
| `browserIpc.ts` / `pageProbePolicy.ts` / `adBlocker.ts` | **DROPPED** | See `docs/deferred/page-probe/`. Intake falls back to yt-dlp/gallery-dl resolution. |

## Bundled binaries (Tauri resources)

- **Frozen Python engine**: PyInstaller **`--onedir`** (NOT `--onefile` —
  onefile re-extracts 22 MB to temp on every spawn = ~8 s; onedir spawns in
  0.4 s). Ship the folder as a Tauri **resource** (`resources/engine/`), spawn by
  resolved path. Fixes the "install Python 3.11 first" blocker.
- **ffmpeg / aria2c**: reuse the existing static binaries as resources; pass paths
  to the engine via env, same as today.

## Self-update

**Decided: adopt `tauri-plugin-updater` (real signed, in-place auto-update).**
This is the marquee capability win of moving to Tauri — one-click download +
install + relaunch instead of Electron's "open the DMG in a browser, re-drag to
Applications."

- **Update-integrity signing** (Tauri's minisign, NOT Apple/Windows code signing):
  `tauri signer generate` once. Public key goes in `tauri.conf.json`; private key
  + password go in **GitHub Actions secrets** (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Requires a one-time human action to paste
  the key into repo secrets — flagged for the owner.
- **Endpoint:** GitHub releases. CI publishes a `latest.json` manifest (version,
  notes, per-platform signed artifact URLs) alongside the `.dmg`/`.exe`; the
  updater plugin reads it. Website CTA + the release ritual update to match.
- **Frontend:** `@tauri-apps/plugin-updater` `check()` → `downloadAndInstall()`,
  wired behind the existing `desktopClient` app-update methods so the Settings UI
  is unchanged.
- The P2 `check_app_update` command stays only as a lightweight version display /
  fallback; the actual update *action* is the plugin. This is P3 work (tied to the
  bundle + signing + release artifacts).

## Phases (each ends at a verifiable gate)

- **P0 — Scaffold.** Tauri v2 in the repo; existing React renders in a Tauri
  window; stub `desktopClient`. *Gate:* `tauri dev` opens a window showing the UI.
- **P1 — Core loop.** Engine commands (`health`, `fetch`, `download`+streaming,
  `library_list`, `failures_list`) in Rust; `desktopClient` rewired; frozen engine
  as a resource. *Gate (critical — STOP and report):* paste a real URL → fetch
  metadata → download a real MP4 → it shows in Library.
- **P2 — Supporting.** settings, path guard, cookie-browser list, helper registry,
  app-update check.
- **P3 — Packaging + auto-update.** Tauri bundler (dmg + nsis), engine/ffmpeg/aria2c
  resources, rewire GitHub Releases asset names + website + CI. **Adopt
  `tauri-plugin-updater`:** generate signing keypair, configure updater endpoint,
  CI signs artifacts + publishes `latest.json`, frontend uses the plugin. Use
  `tauri-plugin-dialog`/`tauri-plugin-opener` for pickers/opening (not hand-rolled).
  Cut a test build and verify an in-place update from v0.2.0.
- **P4 — Teardown.** Delete `electron/`, prune electron-only Node tests, update
  README / CONTRIBUTING / PRE_RELEASE_CHECKLIST / architecture docs.

## Risks

1. **Native webview CSS/JS differences** (WKWebView vs WebView2 vs the Chromium
   the UI was built against). Re-test the library grid, thumbnails, incremental
   render, focus outlines on both platforms.
2. **Windows needs the WebView2 runtime** — present on Win 11, bootstrapped by the
   Tauri NSIS installer on older Windows.
3. **Artifact renaming** — Tauri's bundle names differ from electron-builder's; the
   app-update asset matcher, website CTA, and release ritual must be updated together.
4. **Node tests that import electron/ files** must be pruned in P4, not left dangling.
