# Provider and resolver boundaries

Last updated: 2026-05-19

## Rules

1. **Resolvers** (`src/rippopotamus/resolvers/`) own host-specific URL logic and adapter calls. The React renderer must not branch on YouTube vs Drive vs Archive hostnames.
2. **`electron/browserIpc.ts`** is a **SERP/browser adapter** only. Do not add download queues, sheet workflows, or manifest logic there.
3. **`desktop_engine.py`** stays a **thin router**: new workflows live in modules (e.g. `sheet_import.py`) with one subparser registration each.
4. **IPC payloads** are typed in `electron/types.d.ts`. Breaking field changes need a version bump or dual-read in the engine.

## SearchRuntime (future)

Library search should call a single `SearchRuntime` port: today only **lexical** (filename/metadata) is active in the desktop product. Semantic adapters remain in `experiments/` until promoted.
