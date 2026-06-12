# Rippo Architecture And LLD Notes

Last updated: 2026-05-13

This is the pleasant lunch-read version.

Rippo should not become an architecture museum. It is a local media workbench. The goal is simple: keep the user flow obvious, keep provider weirdness contained, and stop giant files from becoming the place where every decision goes to hide.

The current repo already has the right rough bones:

```text
React renderer
-> Electron preload bridge
-> Electron main process
-> Python media engine
-> resolver tools, transfer tools, browser/cookie access
```

The senior-engineer version would not throw this away. It would mostly name the parts better, draw harder boundaries around them, and move workflow logic out of the biggest files.

## One-Sentence Architecture

Rippo is a local media ingestion workbench with an Electron host, React renderer, Python media engine, resolver adapters, and a locked transfer engine.

That sentence matters because it keeps the app from turning into vague soup.

Rippo is not just:

- a downloader
- a search app
- an AI app
- a file manager
- a video indexer

It is all of those only when they serve the active workbench flow:

```text
paste or sniff source
-> understand source
-> fetch/download asset
-> save asset
```

## Core Terms

Use these terms in code, docs, UI labels, tests, and IPC payloads. Do not invent five names for the same thing.

### Source

A remote thing the user gives Rippo or discovers through search.

Examples:

- YouTube URL
- Internet Archive item
- gallery page
- torrent magnet
- search result
- feed or playlist URL

Good code names:

- `Source`
- `SourceResult`
- `SourceResolver`

Bad drift:

- `thing`
- `item`
- `media` when it is not local yet
- `result` without saying result of what

### Asset

A local media file Rippo can manage.

Examples:

- downloaded MP4
- saved image
- audio file
- imported local video

Good code names:

- `Asset`
- `LocalAsset`
- `AssetRecord`
- `AssetIndex`

This is different from `Source`. A source becomes useful only after Rippo resolves it, downloads it, imports it, or indexes it.

### Resolver

Code that turns a source into useful metadata, playable links, or downloadable files.

Examples:

- `YtDlpResolver`
- `GalleryDlResolver`
- `InternetArchiveResolver`
- `TorrentResolver`

Resolver logic should know about provider weirdness. UI code should not.

### Provider

An outside tool, API, model, browser path, or service Rippo depends on.

Examples:

- `yt-dlp`
- `gallery-dl`
- `ffmpeg`
- `aria2c`
- Electron page probe

Provider code should answer:

```text
is it configured?
is it available?
what can it do?
what errors should the user see?
```

### Job

A long-running operation with states.

Examples:

- fetch metadata
- download source
- ingest local folder
- chunk video
- embed moments
- search provider catalog refresh

Good names:

- `DownloadJob`
- `IngestJob`
- `IndexJob`
- `ProviderHealthJob`

Jobs should have explicit states. Hidden boolean soup is where bugs breed.

### Queue Item

The renderer's display version of a job.

This is UI state, not the whole domain model.

Good rule:

```text
QueueItem is what the screen needs to render.
DownloadJob is what the workflow needs to execute.
Asset is what remains after the work is done.
```

### Index

The local searchable catalog of assets and moments.

Rippo currently uses SQLite for this, which is the right kind of boring.

Good names:

- `AssetIndex`
- `MomentIndex`
- `IndexRepository`
- `LibrarySearch`

### Moment

A time-bounded chunk inside an asset.

Examples:

- `00:12-00:22 crowd shot`
- `01:04-01:17 man speaking`
- full-file moment for an image or unchunked asset

Moments are what make footage searchable instead of just files searchable.

### Probe Candidate

Browser/page context used to find likely downloadable media links.

Probe candidates are not final source truth. They are hints that still go through provider fetch/download routing.

Examples:

- network media URL
- page metadata thumbnail
- torrent link
- document link

### Credential

Auth material used by a provider.

Examples:

- API key
- browser cookie
- selected browser profile
- OAuth-ish handoff later, if needed

Credentials should not leak into renderer business logic.

## Target Module Shape

This is not a demand to create folders for folder theater. It is the shape the repo should gradually move toward when touching files anyway.

```text
src/desktop/
  app/
    useDownloadQueue.ts
    useSettings.ts

  client/
    desktopClient.ts
    types.ts

  components/
    AppHeader.tsx
    QueueCard.tsx

  views/
    WorkbenchView.tsx
    SettingsView.tsx

electron/
  ipc/
    engineIpc.ts
    browserIpc.ts
    settingsIpc.ts

  host/
    appWindow.ts
    engineProcess.ts
    appPaths.ts

  browser/
    browserScout.ts
    cookieAccess.ts

src/rippopotamus/
  engine/
    desktop_engine.py
    commands.py
    health.py

  domain/
    assets.py
    sources.py
    jobs.py
    moments.py

  providers/
    catalog.py
    ytdlp.py
    gallerydl.py
    torrent.py
    ffmpeg.py

    video_chunker.py
    gemini_embeddings.py
```

The exact names can change. The important idea is:

```text
UI is not workflow.
Workflow is not provider plumbing.
Provider plumbing is not domain language.
Experiments are not runtime.
```

## The LLD Pattern To Use

Use a modular monolith with light ports and adapters at the edges.

That is the boring, correct answer.

Rippo does not need a microservice architecture. It does not need a full clean-architecture shrine. It needs a local app that is easy to reason about when something breaks.

The basic flow should look like this:

```text
UI action
-> application service / use case
-> domain model
-> adapter / repository / engine client
-> provider, filesystem, browser, model, or SQLite
```

## Pattern 1: Use Cases

Use cases own workflows.

Examples:

- `SearchSourcesUseCase`
- `FetchSourceMetadataUseCase`
- `DownloadAssetUseCase`
- `IngestLibraryUseCase`
- `SearchLibraryUseCase`
- `RefreshProviderCatalogUseCase`

A use case should read like a recipe:

```text
validate input
choose provider or resolver
start job
collect result
normalize errors
return user-facing response
```

This is where the app should answer "what happens when the user clicks this?"

Bad version:

```text
button handler does validation, provider picking, state transitions,
IPC call formatting, error translation, and UI toast copy
```

Good version:

```text
button handler calls a use case or hook
use case owns the workflow
UI renders the result
```

## Pattern 2: Adapter Pattern

Adapters contain outside-world weirdness.

Use adapters for:

- `yt-dlp`
- `gallery-dl`
- torrents
- Internet Archive
- `aria2c`
- `ffmpeg`
- Google Drive
- Electron page probe
- browser cookies
- filesystem dialogs

An adapter should hide:

- command-line flags
- provider-specific error messages
- API response shape
- retry/backoff rules
- config/env variable names
- browser-specific behavior

The rest of the app should not care whether a link came from DOM metadata, a network response, or a pasted URL unless that distinction matters to the user.

## Pattern 3: Light Repository Pattern

Use repositories for local state and persistence.

Good places:

- settings
- asset index
- download history
- provider cache
- model catalog cache
- cookies, through a safe wrapper

Bad places:

- tiny constants
- simple formatting helpers
- one-off UI state
- experiment output

Do not turn every file into `AbstractFactoryRepositoryManager`. Keep it normal.

## Pattern 4: Explicit Job State Machines

Downloads and ingest flows should be state machines, not a pile of booleans.

Example download states:

```text
queued
-> resolving
-> ready
-> downloading
-> finalizing
-> done
```

Failure path:

```text
queued
-> resolving
-> failed
```

Retry path:

```text
failed
-> resolving
```

Useful state fields:

```text
jobId
sourceId
assetId
status
stage
progress
provider
startedAt
updatedAt
errorCode
userMessage
debugMessage
```

The UI can simplify this. The engine should not.

## Pattern 5: Facade For IPC

Renderer code should not talk to raw Electron methods all over the place.

Use a single renderer-side client:

```ts
desktopClient.sources.search(...)
desktopClient.sources.fetch(...)
desktopClient.downloads.start(...)
desktopClient.library.search(...)
desktopClient.library.ingest(...)
desktopClient.settings.read(...)
desktopClient.settings.update(...)
desktopClient.providers.health(...)
```

That gives the renderer one clean door into the host.

The Electron preload bridge can still expose the underlying methods, but `App.tsx` should not be the place where the whole IPC vocabulary lives.

## About Hexagonal Architecture

The meme is true in a boring way.

Most serious architecture discussions eventually land on:

```text
put stable app logic in the middle
put weird external systems around the outside
talk through ports/adapters
```

That is basically hexagonal architecture.

For Rippo, the right move is not "do hexagonal architecture" as a religion. The right move is:

```text
use hexagonal thinking at the boundaries
keep simple internal code simple
```

Good places for ports/adapters:

- provider execution
- source resolution
- embedding providers
- query intelligence providers
- browser/cookie access
- filesystem and app paths
- SQLite index access
- Electron IPC
- Python engine command execution

Bad places to overdo it:

- React presentational components
- formatting helpers
- button labels
- tiny settings panels
- experiment scripts
- simple constants

The senior version is not more ceremony. It is clearer pressure control.

## What Should Move Out Of Giant Files

The current smell is not that the project is fake. The smell is that a few files are doing too many jobs.

### Renderer

`src/desktop/App.tsx` should eventually stop owning:

- queue workflow
- provider health interpretation
- browser/cookie control UI
- all screen layout

Target split:

```text
App.tsx
-> app shell and top-level composition only

useDownloadQueue.ts
-> queue actions and queue state

desktopClient.ts
-> all renderer-to-Electron calls
```

### Electron

`electron/main.ts` should eventually stop being the whole host.

Target split:

```text
appWindow.ts
-> create and manage windows

engineProcess.ts
-> spawn Python engine commands

engineIpc.ts
-> engine IPC handlers

browserScout.ts
-> browser-backed search/evidence flow

cookieAccess.ts
-> browser cookie reading and validation

appPaths.ts
-> userData, binary paths, engine paths
```

### Python Engine

The Python side should keep the CLI command surface obvious, but move domain pieces behind it.

Target split:

```text
desktop_engine.py
-> command entrypoint and response formatting

providers/
-> provider catalog and command builders

search/
-> source search, evidence, AI query routing

indexing/
-> SQLite index, video chunking, embedding, ingest

domain/
-> asset/source/job/moment terms
```

## Error Model

Rippo needs two error layers:

```text
userMessage
debugMessage
```

The user message says what a normal person can do:

```text
This provider needs browser access. Try with cookies enabled.
```

The debug message keeps the real failure:

```text
yt-dlp exited 1: HTTP Error 403, extractor youtube
```

Do not show raw provider dumps as the main UI copy. Also do not throw away the raw provider dump. Both extremes are bad.

## Provider Catalog

Provider truth should come from one catalog.

A provider entry should answer:

```text
id
label
kind
configured
available
capabilities
defaultPreset
authModes
healthReason
```

Examples:

```text
yt-dlp
gallery-dl
torrent
gemini
openrouter
serper
google_cse
electron_google
```

The UI should not guess provider capability from scattered strings.

## Experiments Boundary

Experiments are useful. They should stay honest.

Good experiment behavior:

- lives under `experiments/`
- has a README
- records input/output assumptions
- can be deleted without breaking runtime
- gets promoted only when a real app surface needs it

Bad experiment behavior:

- runtime imports experiment files
- product docs describe experiments as shipped features
- generated outputs sneak into commits
- the UI depends on experiment-only language

## What Good Looks Like

Good Rippo architecture feels boring in the best way.

When a download fails, you know whether it failed in:

- UI validation
- IPC
- Python engine command
- provider execution
- auth/cookie handoff
- filesystem write
- final asset indexing

When source search is weird, you know whether the problem is:

- query routing
- web evidence
- source adapter
- provider availability
- result normalization
- UI display

When semantic search returns garbage, you know whether the problem is:

- ingestion
- chunking
- embedding
- score cutoff
- lexical fallback
- query embedding
- provider mismatch

That is the whole point. Not pretty folders. Faster truth.

## Practical Refactor Order

Do this gradually. Big rewrites are how local apps get haunted by half-finished architecture.

1. Create `desktopClient.ts` and make renderer calls go through it.
2. Pull queue logic out of `App.tsx` into `useDownloadQueue.ts`.
3. Split Electron IPC handlers by active domain.
4. Split Python runtime by `providers`, download routing, and sheet import.
5. Add job state types and test the transitions.
6. Tighten provider catalog truth so UI stops guessing.

Each step should preserve behavior and keep tests passing.

## Current Refactor Status

Started on 2026-05-13.

Completed renderer slices:

- `src/desktop/app/downloadQueueModel.ts` owns queue/job status vocabulary, display labels, progress text, and edit/refetch/remove lock rules.
- `src/desktop/client/desktopClient.ts` is now the renderer-side facade over Electron IPC.
- `src/desktop/app/useDownloadQueue.ts` owns queue state, fetch/refetch, download events, and item mutation.
- `src/desktop/app/useDownloadQueue.ts` now reads browser-access support from provider catalog data instead of hard-coding provider ids.

Completed Electron slices:

- `electron/appPaths.ts` owns app-managed binary paths and bundled tool discovery.
- `electron/settingsStore.ts` owns persisted desktop settings, output root, and network proxy settings.
- `electron/engineProcess.ts` owns Python runtime selection, engine env construction, and JSON-line engine execution.
- `electron/cookiesIpc.ts` owns browser detection, default cookie source resolution, cookie-source CLI args, and cookie settings IPC handlers.
- `electron/toolUpdatesIpc.ts` owns yt-dlp/gallery-dl update checks, app-managed installs, and tool-update IPC handlers.
- `electron/shellOutputIpc.ts` owns folder opening, external URL opening, and output-root chooser/reset IPC handlers.
- `electron/libraryIpc.ts` owns remote thumbnail loading IPC.
- `electron/engineIpc.ts` owns engine health payloads, fetch IPC, download IPC, and download event forwarding.
- `electron/browserIpc.ts` owns page probing.
- `electron/main.ts` is now the app bootstrapper: privileged protocol registration, window creation, lifecycle events, and IPC registrar wiring.

Completed Python slices:

- `src/rippopotamus/providers.py` now exposes provider capability data such as `supportsBrowserAccess` through `provider_catalog()`.
- `src/rippopotamus/desktop_runtime.py` owns desktop tool discovery, cookie checks, provider context creation, runtime health helpers, and subprocess JSON/text execution.
- `src/rippopotamus/torrent_downloads.py` owns aria2 torrent execution, progress parsing, and torrent-specific output events.
- `src/rippopotamus/desktop_engine.py` now stays closer to command orchestration: health, fetch, sheet import, and provider download routing.

Current verification:

```text
npm test
PYTHONPATH=src python -m unittest tests.test_desktop_engine
```

`npm test` currently runs Python unit tests, renderer build, Electron build, and the Node validation tests. The focused desktop-engine test command is useful while cutting the Python file down in smaller slices.

## The Final Rule

Use hexagonal architecture where Rippo touches messy reality.

Use plain modules everywhere else.

The app should feel like this:

```text
clear words
clear workflows
clear adapters
clear failures
boring tests
```

That is the senior version.
