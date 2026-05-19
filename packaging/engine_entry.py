"""PyInstaller entry: run desktop_engine CLI without python -m."""

from __future__ import annotations

from rippopotamus.desktop_engine import main

if __name__ == "__main__":
    raise SystemExit(main())
