from __future__ import annotations

import argparse
import json
from typing import Any

from rippopotamus import cli, desktop_engine
from rippopotamus.providers import PRESETS, provider_catalog


PROJECT_COMMANDS = (
    "init",
    "add",
    "fetch",
    "download",
    "manifest",
    "status",
    "zip",
)

ENGINE_COMMANDS = (
    "health",
    "fetch",
    "download",
)

SHORTCUTS: dict[str, tuple[str, str]] = {
    "doctor": ("health", "Check local Python/media tools, cookies, providers, and presets."),
    "fetch-metadata": ("fetch", "Return JSON metadata for one URL using auto/provider routing."),
    "download-asset": ("download", "Download one URL into a desktop-style output root."),
}


def command_capabilities(_argv: list[str]) -> int:
    payload: dict[str, Any] = {
        "ok": True,
        "entrypoint": "PYTHONPATH=src python -m rippopotamus.agent_cli",
        "project": {
            "route": "project",
            "commands": list(PROJECT_COMMANDS),
            "description": "Stateful project workspace workflow backed by src/rippopotamus/cli.py.",
        },
        "engine": {
            "route": "engine",
            "commands": list(ENGINE_COMMANDS),
            "description": "Desktop JSON engine workflow backed by src/rippopotamus/desktop_engine.py.",
        },
        "shortcuts": [
            {"command": name, "forwardsTo": target, "description": description}
            for name, (target, description) in SHORTCUTS.items()
        ],
        "providers": provider_catalog()["providers"],
        "presets": [
            {
                "id": preset_id,
                "provider": spec["provider"],
                "folder": spec["folder"],
                "label": spec["label"],
                "detail": spec["detail"],
            }
            for preset_id, spec in PRESETS.items()
        ],
        "runtimeEnv": [
            "RIPPO_YTDLP_PATH",
            "RIPPO_FFMPEG_PATH",
            "RIPPO_FFMPEG_LOCATION",
            "RIPPO_COOKIES_FROM_BROWSER",
            "RIPPO_GALLERYDL_ROOT",
            "RIPPO_ARIA2C_PATH",
        ],
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rippo-agent",
        description="Agent-facing router for the full Rippopotamus CLI and desktop engine surface.",
    )
    parser.add_argument(
        "command",
        choices=["capabilities", "project", "engine", *SHORTCUTS.keys()],
        help="Use capabilities for discovery, project for rippo workflow commands, engine for desktop JSON commands, or a shortcut.",
    )
    parser.add_argument("args", nargs=argparse.REMAINDER)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    forwarded_args = list(args.args)

    if args.command == "capabilities":
        return command_capabilities(forwarded_args)
    if args.command == "project":
        if not forwarded_args:
            raise SystemExit("Usage: rippo-agent project <rippo-command> [args...]")
        return cli.main(forwarded_args)
    if args.command == "engine":
        if not forwarded_args:
            raise SystemExit("Usage: rippo-agent engine <engine-command> [args...]")
        return desktop_engine.main(forwarded_args)

    target_command, _description = SHORTCUTS[args.command]
    return desktop_engine.main([target_command, *forwarded_args])


if __name__ == "__main__":
    raise SystemExit(main())
