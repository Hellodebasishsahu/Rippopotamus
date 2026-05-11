from __future__ import annotations

import argparse
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from rippopotamus import desktop_engine
from rippopotamus.providers import ProviderContext, desktop_download_command


class DesktopEngineTests(unittest.TestCase):
    def test_yt_dlp_base_prefers_configured_executable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "yt-dlp"
            binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            binary.chmod(0o755)

            with mock.patch.dict(os.environ, {"RIPPO_YTDLP_PATH": str(binary)}):
                self.assertEqual(desktop_engine.yt_dlp_base(), [str(binary)])

    def test_missing_configured_yt_dlp_path_falls_back(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_YTDLP_PATH": "/missing/yt-dlp"}):
            with mock.patch("rippopotamus.desktop_engine.configured_yt_dlp_path", return_value=None):
                with mock.patch.dict("sys.modules", {"yt_dlp": object()}):
                    self.assertEqual(desktop_engine.yt_dlp_base(), [desktop_engine.sys.executable, "-m", "yt_dlp"])

    def test_configured_yt_dlp_path_rejects_non_executable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "yt-dlp"
            binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            binary.chmod(0o644)

            with mock.patch.dict(os.environ, {"RIPPO_YTDLP_PATH": str(binary)}):
                with self.assertRaises(SystemExit):
                    desktop_engine.configured_yt_dlp_path()

    def test_cookies_browser_args_returns_yt_dlp_flag(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_COOKIES_FROM_BROWSER": "chrome"}):
            self.assertEqual(desktop_engine.cookies_browser_args(), ["--cookies-from-browser", "chrome"])

    def test_cookies_browser_args_ignores_blank_value(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_COOKIES_FROM_BROWSER": "   "}):
            self.assertEqual(desktop_engine.cookies_browser_args(), [])

    def test_verify_cookies_browser_reports_off_when_unset(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                desktop_engine.verify_cookies_browser(["yt-dlp"]),
                {"status": "off", "browser": None, "ok": None, "message": None},
            )

    def test_verify_cookies_browser_accepts_extracted_cookie_output(self) -> None:
        completed = desktop_engine.subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="Extracting cookies from chrome\nExtracted 12 cookies from chrome\n",
            stderr="ERROR: Unsupported URL: https://example.com/\n",
        )
        with mock.patch("rippopotamus.desktop_engine.subprocess.run", return_value=completed):
            self.assertEqual(
                desktop_engine.verify_cookies_browser(["yt-dlp"], "chrome"),
                {"status": "ok", "browser": "chrome", "ok": True, "message": "Browser cookies are readable."},
            )

    def test_cookie_error_message_maps_locked_database(self) -> None:
        self.assertEqual(
            desktop_engine.cookie_error_message("ERROR: cookie database is locked"),
            "Browser cookies are locked. Close the browser and retry.",
        )

    def test_cookie_error_message_maps_unavailable_format(self) -> None:
        self.assertEqual(
            desktop_engine.cookie_error_message("ERROR: Requested format is not available"),
            "Selected format is not available for this link.",
        )

    def test_build_download_command_has_one_selected_format(self) -> None:
        command = desktop_download_command(
            "https://www.youtube.com/watch?v=TQd2k1pEXp4",
            "mp4-best",
            output_template="/tmp/out.%(ext)s",
            context=ProviderContext(yt_dlp_base=("yt-dlp",)),
        )

        self.assertIn("--ignore-config", command)
        self.assertIn("--newline", command)
        self.assertEqual(command.count("-f"), 1)
        self.assertIn("bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]", command)
        self.assertEqual(command[-1], "https://www.youtube.com/watch?v=TQd2k1pEXp4")

    def test_fetch_metadata_ignores_formats_and_external_config(self) -> None:
        args = argparse.Namespace(url="https://www.youtube.com/watch?v=TQd2k1pEXp4", provider="yt-dlp")
        with mock.patch("rippopotamus.desktop_engine.provider_context", return_value=ProviderContext(yt_dlp_base=("yt-dlp",))):
            with mock.patch("rippopotamus.desktop_engine.run_text", return_value='{"id": "TQd2k1pEXp4", "title": "Video"}') as run_text:
                stream = io.StringIO()
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_fetch(args), 0)

        command = run_text.call_args.args[0]
        self.assertIn("--ignore-config", command)
        self.assertIn("--ignore-no-formats-error", command)

    def test_fetch_metadata_uses_explicit_cookie_source(self) -> None:
        args = argparse.Namespace(url="https://www.youtube.com/watch?v=TQd2k1pEXp4", provider="yt-dlp", cookies_browser="chrome")
        with mock.patch("rippopotamus.desktop_engine.yt_dlp_base", return_value=["yt-dlp"]):
            with mock.patch("rippopotamus.desktop_engine.run_text", return_value='{"id": "TQd2k1pEXp4", "title": "Video"}') as run_text:
                stream = io.StringIO()
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_fetch(args), 0)

        command = run_text.call_args.args[0]
        self.assertIn("--cookies-from-browser", command)
        self.assertLess(command.index("--ignore-config"), command.index("--cookies-from-browser"))
        self.assertEqual(command[command.index("--cookies-from-browser") + 1], "chrome")

    def test_fetch_auto_uses_yt_dlp_when_supported(self) -> None:
        args = argparse.Namespace(url="https://www.youtube.com/watch?v=TQd2k1pEXp4", provider="auto")
        with mock.patch("rippopotamus.desktop_engine.provider_context", return_value=ProviderContext(yt_dlp_base=("yt-dlp",))):
            with mock.patch("rippopotamus.desktop_engine.run_text", return_value='{"id": "TQd2k1pEXp4", "title": "Video"}') as run_text:
                stream = io.StringIO()
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_fetch(args), 0)

        payload = json.loads(stream.getvalue())
        self.assertEqual(payload["metadata"]["provider"], "yt-dlp")
        self.assertIn("--dump-single-json", run_text.call_args.args[0])

    def test_fetch_auto_falls_back_to_gallery_only_for_unsupported_urls(self) -> None:
        args = argparse.Namespace(url="https://example.com/gallery", provider="auto")

        def fake_run_text(command: list[str]) -> str:
            if "--dump-single-json" in command:
                raise SystemExit("ERROR: Unsupported URL: https://example.com/gallery")
            return '[3, "https://img.example/a.jpg", {"filename": "asset"}]'

        with mock.patch("rippopotamus.desktop_engine.provider_context", return_value=ProviderContext(yt_dlp_base=("yt-dlp",))):
            with mock.patch("rippopotamus.providers.gallery_dl_base", return_value=["gallery-dl"]):
                with mock.patch("rippopotamus.desktop_engine.run_text", side_effect=fake_run_text) as run_text:
                    stream = io.StringIO()
                    with redirect_stdout(stream):
                        self.assertEqual(desktop_engine.command_fetch(args), 0)

        payload = json.loads(stream.getvalue())
        self.assertEqual(payload["metadata"]["provider"], "gallery-dl")
        self.assertEqual(run_text.call_count, 2)

    def test_fetch_auto_does_not_hide_yt_dlp_non_support_errors(self) -> None:
        args = argparse.Namespace(url="https://example.com/private-video", provider="auto")
        with mock.patch("rippopotamus.desktop_engine.provider_context", return_value=ProviderContext(yt_dlp_base=("yt-dlp",))):
            with mock.patch("rippopotamus.desktop_engine.run_text", side_effect=SystemExit("ERROR: Video unavailable")):
                with self.assertRaises(SystemExit):
                    desktop_engine.command_fetch(args)

    def test_cookies_health_ignores_external_config(self) -> None:
        completed = desktop_engine.subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="Extracting cookies from chrome\nExtracted 12 cookies from chrome\n",
            stderr="",
        )
        with mock.patch.dict(os.environ, {"RIPPO_COOKIES_FROM_BROWSER": "safari"}):
            with mock.patch("rippopotamus.desktop_engine.subprocess.run", return_value=completed) as run:
                desktop_engine.verify_cookies_browser(["yt-dlp"], "chrome")

        self.assertIn("--ignore-config", run.call_args.args[0])
        self.assertIn("chrome", run.call_args.args[0])
        self.assertNotIn("safari", run.call_args.args[0])

    def test_gallery_dl_status_reports_image_provider_runtime(self) -> None:
        completed = desktop_engine.subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="1.32.1\n",
            stderr="",
        )
        with mock.patch("rippopotamus.desktop_engine.gallery_dl_base", return_value=["gallery-dl"]):
            with mock.patch("rippopotamus.desktop_engine.subprocess.run", return_value=completed):
                self.assertEqual(
                    desktop_engine.gallery_dl_status(),
                    {"ok": True, "version": "1.32.1", "path": "gallery-dl", "error": None},
                )

    def test_gallery_dl_status_reports_missing_runtime_without_failing_health(self) -> None:
        with mock.patch("rippopotamus.desktop_engine.gallery_dl_base", side_effect=SystemExit("Missing gallery-dl.")):
            self.assertEqual(
                desktop_engine.gallery_dl_status(),
                {"ok": False, "version": None, "path": None, "error": "Missing gallery-dl."},
            )

    def test_aria2c_status_reports_torrent_provider_runtime(self) -> None:
        completed = desktop_engine.subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="aria2 version 1.37.0\n",
            stderr="",
        )
        with mock.patch("rippopotamus.desktop_engine.aria2c_base", return_value=["aria2c"]):
            with mock.patch("rippopotamus.desktop_engine.subprocess.run", return_value=completed):
                self.assertEqual(
                    desktop_engine.aria2c_status(),
                    {"ok": True, "version": "1.37.0", "path": "aria2c", "error": None},
                )

    def test_build_download_command_keeps_cookies_explicit_after_config_ignore(self) -> None:
        command = desktop_download_command(
            "https://www.youtube.com/watch?v=TQd2k1pEXp4",
            "mp4-best",
            output_template="/tmp/out.%(ext)s",
            context=ProviderContext(yt_dlp_base=("yt-dlp",), cookies_browser="chrome"),
        )

        self.assertLess(command.index("--ignore-config"), command.index("--cookies-from-browser"))

    def test_fetch_uses_explicit_gallery_provider(self) -> None:
        args = argparse.Namespace(url="https://example.com/gallery", provider="gallery-dl")
        with mock.patch("rippopotamus.providers.gallery_dl_base", return_value=["gallery-dl"]):
            with mock.patch("rippopotamus.desktop_engine.run_text", return_value='[3, "https://img.example/a.jpg", {"filename": "asset"}]'):
                stream = io.StringIO()
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_fetch(args), 0)

        payload = json.loads(stream.getvalue())
        self.assertEqual(payload["metadata"]["provider"], "gallery-dl")
        self.assertEqual(payload["metadata"]["title"], "asset")

    def test_fetch_auto_routes_magnet_to_aria2c(self) -> None:
        args = argparse.Namespace(url="magnet:?xt=urn:btih:abc&dn=Example", provider="auto")
        stream = io.StringIO()
        with redirect_stdout(stream):
            self.assertEqual(desktop_engine.command_fetch(args), 0)

        payload = json.loads(stream.getvalue())
        self.assertEqual(payload["metadata"]["provider"], "aria2c")
        self.assertEqual(payload["metadata"]["title"], "Example")

    def test_gallery_preset_is_explicit_download_path(self) -> None:
        args = argparse.Namespace(
            url="https://example.com/gallery",
            preset="gallery",
            output_root="",
            item_id="gallery",
            title="Gallery",
        )

        with tempfile.TemporaryDirectory() as tmp:
            args.output_root = tmp
            with mock.patch("rippopotamus.providers.gallery_dl_base", return_value=["gallery-dl"]):
                with mock.patch("rippopotamus.desktop_engine.command_gallery_download", return_value=0) as gallery_download:
                    self.assertEqual(desktop_engine.command_download(args), 0)

        gallery_download.assert_called_once()

    def test_torrent_preset_is_explicit_aria2_download_path(self) -> None:
        args = argparse.Namespace(
            url="magnet:?xt=urn:btih:abc&dn=Example",
            preset="torrent",
            output_root="",
            item_id="torrent",
            title="Torrent",
        )

        with tempfile.TemporaryDirectory() as tmp:
            args.output_root = tmp
            with mock.patch("rippopotamus.providers.aria2c_base", return_value=["aria2c"]):
                with mock.patch("rippopotamus.desktop_engine.command_aria2_download", return_value=0) as aria_download:
                    self.assertEqual(desktop_engine.command_download(args), 0)

        aria_download.assert_called_once()

    def test_torrent_command_uses_app_owned_dht_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch("rippopotamus.providers.aria2c_base", return_value=["aria2c"]):
                command = desktop_download_command(
                    "magnet:?xt=urn:btih:abc&dn=Example",
                    "torrent",
                    output_dir=Path(tmp) / "Files",
                )

        self.assertIn("--dht-file-path", command)
        self.assertIn("--dht-file-path6", command)
        self.assertTrue(any(".aria2/dht.dat" in value for value in command))
        self.assertTrue(any(".aria2/dht6.dat" in value for value in command))

    def test_snapshot_files_ignores_hidden_runtime_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".aria2").mkdir()
            (root / ".aria2" / "dht.dat").write_text("cache", encoding="utf-8")
            (root / "Files").mkdir()
            media = root / "Files" / "movie.mp4"
            media.write_text("media", encoding="utf-8")

            self.assertEqual(desktop_engine.snapshot_files(root), {media})

    def test_download_failure_reports_once_without_retry(self) -> None:
        args = argparse.Namespace(
            url="https://www.youtube.com/watch?v=TQd2k1pEXp4",
            preset="mp4-best",
            output_root="",
            item_id="video",
            title="Video",
        )

        with tempfile.TemporaryDirectory() as tmp:
            args.output_root = tmp
            with mock.patch("rippopotamus.desktop_engine.desktop_download_command", return_value=["yt-dlp"]):
                with mock.patch(
                    "rippopotamus.desktop_engine.run_ytdlp_download_command",
                    return_value=(1, "ERROR: Requested format is not available", ["ERROR: Requested format is not available"]),
                ) as run_command:
                    stream = io.StringIO()
                    with redirect_stdout(stream):
                        self.assertEqual(desktop_engine.command_download(args), 1)

        events = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(run_command.call_count, 1)
        self.assertEqual(events[-1], {"type": "error", "error": "Selected format is not available for this link."})


if __name__ == "__main__":
    unittest.main()
