#!/usr/bin/env bash
# Build a standalone rippo-engine app directory (macOS/Linux/Windows) for
# packaged apps. --onedir (not --onefile): onefile re-extracts ~22 MB to a
# temp dir on every spawn (~8s cold start); onedir spawns in ~0.4s.
# Requires: pip install -e ".[engine-build]"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
rm -rf release/bin/rippo-engine
mkdir -p release/bin
export PYTHONPATH="$ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
python -m PyInstaller \
  --onedir \
  --name rippo-engine \
  --distpath release/bin \
  --workpath .build/pyinstaller \
  --paths src \
  packaging/engine_entry.py
echo "Built: release/bin/rippo-engine/ (set RIPPO_ENGINE_BINARY to the rippo-engine executable inside it for local testing)"
