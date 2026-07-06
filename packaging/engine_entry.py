"""PyInstaller entry: run desktop_engine CLI without python -m.

Also doubles as a yt-dlp / gallery-dl "interpreter" for its own subprocess
calls. `providers.py` resolves those tools as `[sys.executable, "-m",
"yt_dlp", ...]` / `[..., "-m", "gallery_dl", ...]`, which is correct when
sys.executable is a real Python interpreter. In a frozen PyInstaller build,
sys.executable IS this binary, so that command becomes
`rippo-engine -m yt_dlp ...` — this binary doesn't understand `-m` and the
call fails. Detect that argv shape here and dispatch to the bundled module
in-process instead, so the frozen binary can re-invoke "itself as yt-dlp".
"""

from __future__ import annotations

import sys


def _dispatch_module_shim() -> None:
    if len(sys.argv) < 3 or sys.argv[1] != "-m":
        return
    module, rest = sys.argv[2], sys.argv[3:]
    if module == "yt_dlp":
        import yt_dlp

        yt_dlp.main(rest)  # raises SystemExit; never returns
    if module == "gallery_dl":
        import gallery_dl

        sys.argv = [sys.argv[0], *rest]
        gallery_dl.main()  # raises SystemExit; never returns


if __name__ == "__main__":
    _dispatch_module_shim()

    from rippopotamus.desktop_engine import main

    raise SystemExit(main())
