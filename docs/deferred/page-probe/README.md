# Deferred: in-app webpage probing

Removed from the app during the Tauri migration (2026-07-06). The feature was
also misbehaving at the time it was shelved, so this was a deliberate drop, not
a straight port.

## What it did

"Paste any webpage, find the video inside it" — the intake path that worked on
sites `yt-dlp`/`gallery-dl` can't parse. Implemented in Electron's main process:

- `browserIpc.ts` — loaded the target URL in a **hidden Electron `BrowserWindow`**,
  intercepted every network request via `session.webRequest.onBeforeRequest` /
  `onHeadersReceived` to catch media URLs (HLS manifests, MP4s, images), ran a
  "play provoke" script to force lazy video players to start loading, extracted
  DOM/meta candidates, and returned scored candidates. Also housed an optional
  SERP scraper (`browser-serp` / `crawl4ai`).
- `pageProbePolicy.ts` — pure scoring: tiered candidate ranking (master playlists
  > direct media > by-extension > images > rejected). Portable to any language.
- `adBlocker.ts` — request filtering for the probe session.

The `.txt` copies here are the verbatim source at removal (recover exact code
from git history at the last commit before the Tauri branch, too).

## Why it can't port to Tauri as-is

Tauri renders through the OS **native webview** (WKWebView / WebView2), which
does **not** expose Electron's `session.webRequest` passive network
interception. There is no API to sniff a page's subresource traffic. The scoring
logic ports fine; the *capture mechanism* does not.

## Revival path (when a design partner asks for it)

Move probing into the **Python engine** using Playwright (already in reach via
the `browser-serp` / `crawl4ai` optional dependency):

1. New engine subcommand `probe --url <U>` → launches Playwright Chromium
   headless, `page.on("request")` gives full network interception (the exact
   capability Electron provided), run the same provoke + DOM-extract scripts.
2. Reimplement `pageProbePolicy.ts` tiered scoring in Python (it's ~380 lines of
   pure logic).
3. Emit the same candidate JSON the renderer already understands.

Benefit over the old design: it becomes **shell-agnostic** (survives any future
frontend), and Playwright's Chromium is an **on-demand download** (only if the
user enables probe), so the base app stays small instead of always shipping a
browser engine.
