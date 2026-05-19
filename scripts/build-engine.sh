#!/usr/bin/env bash
# Build a standalone rippo-engine binary (macOS/Linux) for packaged apps.
# Requires: pip install -e ".[engine-build]"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p release/bin
export PYTHONPATH="$ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
python -m PyInstaller \
  --onefile \
  --name rippo-engine \
  --distpath release/bin \
  --workpath .build/pyinstaller \
  --paths src \
  packaging/engine_entry.py
echo "Built: release/bin/rippo-engine (set RIPPO_ENGINE_BINARY for local Electron)"
