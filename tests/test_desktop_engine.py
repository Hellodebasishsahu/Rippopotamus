from __future__ import annotations

import argparse
import io
import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing, redirect_stdout
from pathlib import Path
from unittest import mock

from rippopotamus import desktop_engine, desktop_runtime, google_drive, torrent_downloads
from rippopotamus.providers import ProviderContext, desktop_download_command

class FakeProcess:
    def __init__(self, lines: list[str], code: int) -> None:
        self.stdout = iter(lines)
        self._code = code

    def wait(self) -> int:
        return self._code


class DesktopEngineTests(unittest.TestCase):
    def test_yt_dlp_base_prefers_configured_executable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "yt-dlp"
            binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            binary.chmod(0o755)

            with mock.patch.dict(os.environ, {"RIPPO_YTDLP_PATH": str(binary)}):
                self.assertEqual(desktop_runtime.yt_dlp_base(), [str(binary)])

    def test_missing_configured_yt_dlp_path_falls_back(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_YTDLP_PATH": "/missing/yt-dlp"}):
            with mock.patch("rippopotamus.desktop_runtime.configured_yt_dlp_path", return_value=None):
                with mock.patch.dict("sys.modules", {"yt_dlp": object()}):
                    self.assertEqual(desktop_runtime.yt_dlp_base(), [desktop_runtime.sys.executable, "-m", "yt_dlp"])

    def test_configured_yt_dlp_path_rejects_non_executable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "yt-dlp"
            binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            binary.chmod(0o644)

            with mock.patch.dict(os.environ, {"RIPPO_YTDLP_PATH": str(binary)}):
                with mock.patch("os.access", return_value=False):
                    with self.assertRaises(SystemExit):
                        desktop_runtime.configured_yt_dlp_path()

    def test_cookies_browser_args_returns_yt_dlp_flag(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_COOKIES_FROM_BROWSER": "chrome"}):
            self.assertEqual(desktop_runtime.cookies_browser_args(), ["--cookies-from-browser", "chrome"])

    def test_cookies_browser_args_ignores_blank_value(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_COOKIES_FROM_BROWSER": "   "}):
            self.assertEqual(desktop_runtime.cookies_browser_args(), [])

    def test_verify_cookies_browser_reports_off_when_unset(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                desktop_runtime.verify_cookies_browser(["yt-dlp"]),
                {"status": "off", "browser": None, "ok": None, "message": None},
            )

    def test_verify_cookies_browser_accepts_extracted_cookie_output(self) -> None:
        completed = desktop_runtime.subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="Extracting cookies from chrome\nExtracted 12 cookies from chrome\n",
            stderr="ERROR: Unsupported URL: https://example.com/\n",
        )
        with mock.patch("rippopotamus.desktop_runtime.subprocess.run", return_value=completed):
            self.assertEqual(
                desktop_runtime.verify_cookies_browser(["yt-dlp"], "chrome"),
                {"status": "ok", "browser": "chrome", "ok": True, "message": "Browser cookies are readable."},
            )

    def test_cookie_error_message_maps_locked_database(self) -> None:
        self.assertEqual(
            desktop_runtime.cookie_error_message("ERROR: cookie database is locked"),
            "Browser cookies are locked. Close the browser and retry.",
        )

    def test_cookie_error_message_maps_unavailable_format(self) -> None:
        self.assertEqual(
            desktop_runtime.cookie_error_message("ERROR: Requested format is not available"),
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
        self.assertIn("bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/best", command)
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
        with mock.patch("rippopotamus.desktop_engine.provider_context", return_value=ProviderContext(yt_dlp_base=("yt-dlp",), cookies_browser="chrome")):
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
        completed = desktop_runtime.subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="Extracting cookies from chrome\nExtracted 12 cookies from chrome\n",
            stderr="",
        )
        with mock.patch.dict(os.environ, {"RIPPO_COOKIES_FROM_BROWSER": "safari"}):
            with mock.patch("rippopotamus.desktop_runtime.subprocess.run", return_value=completed) as run:
                desktop_runtime.verify_cookies_browser(["yt-dlp"], "chrome")

        self.assertIn("--ignore-config", run.call_args.args[0])
        self.assertIn("chrome", run.call_args.args[0])
        self.assertNotIn("safari", run.call_args.args[0])

    def test_gallery_dl_status_reports_image_provider_runtime(self) -> None:
        completed = desktop_runtime.subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="1.32.1\n",
            stderr="",
        )
        with mock.patch("rippopotamus.desktop_runtime.gallery_dl_base", return_value=["gallery-dl"]):
            with mock.patch("rippopotamus.desktop_runtime.subprocess.run", return_value=completed):
                self.assertEqual(
                    desktop_runtime.gallery_dl_status(),
                    {"ok": True, "version": "1.32.1", "path": "gallery-dl", "error": None},
                )

    def test_gallery_dl_status_reports_missing_runtime_without_failing_health(self) -> None:
        with mock.patch("rippopotamus.desktop_runtime.gallery_dl_base", side_effect=SystemExit("Missing gallery-dl.")):
            self.assertEqual(
                desktop_runtime.gallery_dl_status(),
                {"ok": False, "version": None, "path": None, "error": "Missing gallery-dl."},
            )

    def test_aria2c_status_reports_torrent_provider_runtime(self) -> None:
        completed = desktop_runtime.subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="aria2 version 1.37.0\n",
            stderr="",
        )
        with mock.patch("rippopotamus.desktop_runtime.aria2c_base", return_value=["aria2c"]):
            with mock.patch("rippopotamus.desktop_runtime.subprocess.run", return_value=completed):
                self.assertEqual(
                    desktop_runtime.aria2c_status(),
                    {"ok": True, "version": "1.37.0", "path": "aria2c", "error": None},
                )

    def test_aria2c_base_prefers_configured_executable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "aria2c"
            binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            binary.chmod(0o755)

            with mock.patch.dict(os.environ, {"RIPPO_ARIA2C_PATH": str(binary)}):
                self.assertEqual(desktop_runtime.aria2c_base(), [str(binary)])

    def test_aria2c_base_rejects_bad_configured_executable(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_ARIA2C_PATH": "/missing/aria2c"}):
            with self.assertRaises(SystemExit):
                desktop_runtime.aria2c_base()

    def test_build_download_command_keeps_cookies_explicit_after_config_ignore(self) -> None:
        command = desktop_download_command(
            "https://www.youtube.com/watch?v=TQd2k1pEXp4",
            "mp4-best",
            output_template="/tmp/out.%(ext)s",
            context=ProviderContext(yt_dlp_base=("yt-dlp",), cookies_browser="chrome"),
        )

        self.assertLess(command.index("--ignore-config"), command.index("--cookies-from-browser"))

    def test_build_download_command_adds_network_proxy_after_config_ignore(self) -> None:
        command = desktop_download_command(
            "https://www.youtube.com/watch?v=TQd2k1pEXp4",
            "mp4-best",
            output_template="/tmp/out.%(ext)s",
            context=ProviderContext(yt_dlp_base=("yt-dlp",), network_proxy="socks5://127.0.0.1:9050"),
        )

        self.assertIn("--proxy", command)
        self.assertLess(command.index("--ignore-config"), command.index("--proxy"))
        self.assertEqual(command[command.index("--proxy") + 1], "socks5://127.0.0.1:9050")

    def test_build_download_command_uses_ffmpeg_for_hls_when_available(self) -> None:
        command = desktop_download_command(
            "https://example.com/live",
            "mp4-best",
            output_template="/tmp/out.%(ext)s",
            context=ProviderContext(yt_dlp_base=("yt-dlp",), ffmpeg_path="/opt/ffmpeg/bin/ffmpeg"),
        )

        self.assertIn("--ffmpeg-location", command)
        self.assertEqual(command[command.index("--ffmpeg-location") + 1], "/opt/ffmpeg/bin")
        self.assertIn("--downloader", command)
        self.assertEqual(command[command.index("--downloader") + 1], "m3u8:ffmpeg")
        self.assertIn("--hls-use-mpegts", command)

    def test_build_download_command_delegates_http_transfers_to_aria2(self) -> None:
        command = desktop_download_command(
            "https://example.com/video.mp4",
            "mp4-best",
            output_template="/tmp/out.%(ext)s",
            context=ProviderContext(yt_dlp_base=("yt-dlp",), aria2c_path="/usr/local/bin/aria2c"),
        )

        self.assertIn("--downloader", command)
        self.assertEqual(command[command.index("--downloader") + 1], "http,https:/usr/local/bin/aria2c")
        self.assertIn("--downloader-args", command)
        self.assertIn("--continue=true", command[command.index("--downloader-args") + 1])

    def test_gallery_download_command_adds_network_proxy(self) -> None:
        with mock.patch("rippopotamus.providers.gallery_dl_base", return_value=["gallery-dl"]):
            command = desktop_download_command(
                "https://example.com/gallery",
                "gallery",
                output_dir="/tmp/images",
                context=ProviderContext(network_proxy="http://127.0.0.1:8080"),
            )

        self.assertEqual(command[:3], ["gallery-dl", "--proxy", "http://127.0.0.1:8080"])

    def test_file_result_includes_relative_path_and_size(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            asset = root / "Source" / "clip.mp4"
            asset.parent.mkdir()
            asset.write_bytes(b"12345")

            self.assertEqual(desktop_engine.file_result(root, asset), {"path": "Source/clip.mp4", "size": 5})

    def test_proxy_check_reports_exit_ip(self) -> None:
        args = argparse.Namespace(proxy="socks5://127.0.0.1:9050")
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout='{"ip":"203.0.113.7"}', stderr="")
        with mock.patch("rippopotamus.desktop_engine.subprocess.run", return_value=completed) as run:
            stream = io.StringIO()
            with redirect_stdout(stream):
                self.assertEqual(desktop_engine.command_proxy_check(args), 0)

        payload = json.loads(stream.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["ip"], "203.0.113.7")
        self.assertIn("--proxy", run.call_args.args[0])

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

    def test_fetch_auto_routes_magnet_to_torrent_provider(self) -> None:
        args = argparse.Namespace(url="magnet:?xt=urn:btih:abc&dn=Example", provider="auto")
        stream = io.StringIO()
        with redirect_stdout(stream):
            self.assertEqual(desktop_engine.command_fetch(args), 0)

        payload = json.loads(stream.getvalue())
        self.assertEqual(payload["metadata"]["provider"], "torrent")
        self.assertEqual(payload["metadata"]["title"], "Example")

    def test_fetch_auto_routes_drive_links_to_drive_provider(self) -> None:
        url = "https://drive.google.com/file/d/file-123/view?usp=drive_link"
        args = argparse.Namespace(url=url, provider="auto", cookies_browser="chrome")
        metadata = {"id": "file-123", "title": "Example", "provider": "google-drive"}
        with mock.patch("rippopotamus.desktop_engine.yt_dlp_base", return_value=["yt-dlp"]):
            with mock.patch("rippopotamus.desktop_engine.drive_metadata", return_value=metadata) as drive_metadata:
                stream = io.StringIO()
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_fetch(args), 0)

        payload = json.loads(stream.getvalue())
        self.assertEqual(payload["metadata"], metadata)
        drive_metadata.assert_called_once_with(url, "chrome", yt_dlp_base=["yt-dlp"], network_proxy=None)

    def test_drive_file_id_accepts_view_and_download_urls(self) -> None:
        self.assertEqual(
            google_drive.drive_file_id("https://drive.google.com/file/d/13Ied4_fnmxib2zr_ICxhDGZAp43MtSY1/view?usp=drive_link"),
            "13Ied4_fnmxib2zr_ICxhDGZAp43MtSY1",
        )
        self.assertEqual(
            google_drive.drive_file_id("https://drive.google.com/uc?export=download&id=13Ied4_fnmxib2zr_ICxhDGZAp43MtSY1"),
            "13Ied4_fnmxib2zr_ICxhDGZAp43MtSY1",
        )

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

    def test_drive_preset_uses_owned_download_path(self) -> None:
        args = argparse.Namespace(
            url="https://drive.google.com/file/d/file-123/view",
            preset="drive-file",
            output_root="",
            item_id="drive",
            title="Drive",
            cookies_browser="chrome",
        )

        with tempfile.TemporaryDirectory() as tmp:
            args.output_root = tmp
            saved = Path(tmp) / "Files" / "example.jpg"
            saved.parent.mkdir(parents=True, exist_ok=True)
            saved.write_bytes(b"drive")
            with mock.patch("rippopotamus.desktop_engine.yt_dlp_base", return_value=["yt-dlp"]):
                with mock.patch("rippopotamus.desktop_engine.download_drive_file", return_value=[str(saved)]) as download_drive_file:
                    stream = io.StringIO()
                    with redirect_stdout(stream):
                        self.assertEqual(desktop_engine.command_download(args), 0)

        events = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(events[-1]["type"], "success")
        self.assertEqual(events[-1]["files"], [{"path": "Files/example.jpg", "size": 5}])
        download_drive_file.assert_called_once()

    def test_download_skips_existing_ledger_match(self) -> None:
        args = argparse.Namespace(
            url="https://drive.google.com/file/d/file-123/view",
            preset="drive-file",
            output_root="",
            item_id="drive-again",
            title="Drive Again",
            cookies_browser="chrome",
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args.output_root = tmp
            saved = root / "Files" / "example.jpg"
            saved.parent.mkdir(parents=True, exist_ok=True)
            saved.write_bytes(b"drive")
            key = desktop_engine.download_key(args.url, args.preset)
            desktop_engine.write_download_ledger(root, {
                key: {"url": args.url, "preset": args.preset, "files": ["Files/example.jpg"]}
            })

            with mock.patch("rippopotamus.desktop_engine.download_drive_file") as download_drive_file:
                stream = io.StringIO()
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_download(args), 0)

        events = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertEqual(events[-1]["type"], "success")
        self.assertEqual(events[-1]["files"], [{"path": "Files/example.jpg", "size": 5}])
        self.assertEqual(events[-1]["warnings"], ["Already saved; skipped duplicate download."])
        download_drive_file.assert_not_called()

    def test_drive_download_records_ledger_for_later_dedupe(self) -> None:
        args = argparse.Namespace(
            url="https://drive.google.com/file/d/file-123/view",
            preset="drive-file",
            output_root="",
            item_id="drive",
            title="Drive",
            cookies_browser="chrome",
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            args.output_root = tmp
            saved = root / "Files" / "example.jpg"
            saved.parent.mkdir(parents=True, exist_ok=True)
            saved.write_bytes(b"drive")
            with mock.patch("rippopotamus.desktop_engine.yt_dlp_base", return_value=["yt-dlp"]):
                with mock.patch("rippopotamus.desktop_engine.download_drive_file", return_value=[str(saved)]):
                    stream = io.StringIO()
                    with redirect_stdout(stream):
                        self.assertEqual(desktop_engine.command_download(args), 0)

            ledger = desktop_engine.load_download_ledger(root)

        self.assertEqual(ledger[desktop_engine.download_key(args.url, args.preset)]["files"], ["Files/example.jpg"])

    def test_torrent_preset_uses_aria2_download_path(self) -> None:
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
                with mock.patch("rippopotamus.torrent_downloads.command_aria2_download", return_value=0) as aria_download:
                    self.assertEqual(desktop_engine.command_download(args), 0)

        aria_download.assert_called_once()

    def test_torrent_engine_status_is_aria2_only(self) -> None:
        with mock.patch("rippopotamus.desktop_runtime.aria2c_status", return_value={"ok": True, "version": "1.37.0", "path": "aria2c", "error": None}):
            self.assertEqual(
                desktop_runtime.torrent_engine_status(),
                {"ok": True, "engine": "aria2c", "error": None, "aria2c": {"ok": True, "version": "1.37.0", "path": "aria2c", "error": None}},
            )

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
        self.assertTrue(any(".aria2/dht.dat" in Path(value).as_posix() for value in command))
        self.assertTrue(any(".aria2/dht6.dat" in Path(value).as_posix() for value in command))

    def test_snapshot_files_ignores_hidden_runtime_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".aria2").mkdir()
            (root / ".aria2" / "dht.dat").write_text("cache", encoding="utf-8")
            (root / "Files").mkdir()
            media = root / "Files" / "movie.mp4"
            media.write_text("media", encoding="utf-8")

            self.assertEqual(desktop_engine.snapshot_files(root), {media})

    def test_torrent_success_suppresses_transient_retry_noise(self) -> None:
        args = argparse.Namespace(url="magnet:?xt=urn:btih:abc&dn=Example", preset="torrent")
        lines = [
            "05/11 16:25:54 [ERROR] Exception caught while loading DHT routing table from /Users/dev/.cache/aria2/dht.dat\n",
            "[HttpSkipResponseCommand.cc:240] errorCode=22 The response status is not successful. status=500\n",
            "[#abc 1.0MiB/2.0MiB(50%) CN:1 DL:1.0MiB ETA:1s]\n",
            "Download complete: Example.mp4\n",
        ]

        with tempfile.TemporaryDirectory() as tmp:
            stream = io.StringIO()
            with mock.patch("rippopotamus.torrent_downloads.subprocess.Popen", return_value=FakeProcess(lines, 0)):
                with redirect_stdout(stream):
                    self.assertEqual(torrent_downloads.command_aria2_download(args, Path(tmp), ["aria2c"]), 0)

        events = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertFalse([event for event in events if event["type"] == "notice"])
        self.assertEqual(events[-1]["type"], "success")

    def test_torrent_failure_reports_plain_error_only(self) -> None:
        args = argparse.Namespace(url="magnet:?xt=urn:btih:abc&dn=Example", preset="torrent")
        lines = [
            "05/11 16:25:54 [ERROR] Exception caught while loading DHT routing table from /Users/dev/.cache/aria2/dht.dat\n",
            "[HttpSkipResponseCommand.cc:240] errorCode=22 The response status is not successful. status=500\n",
        ]

        with tempfile.TemporaryDirectory() as tmp:
            stream = io.StringIO()
            with mock.patch("rippopotamus.torrent_downloads.subprocess.Popen", return_value=FakeProcess(lines, 1)):
                with redirect_stdout(stream):
                    self.assertEqual(torrent_downloads.command_aria2_download(args, Path(tmp), ["aria2c"]), 1)

        events = [json.loads(line) for line in stream.getvalue().splitlines()]
        self.assertFalse([event for event in events if event["type"] == "notice"])
        self.assertEqual(
            events[-1],
            {"type": "error", "error": "The source is having trouble right now. Try again later or use another link."},
        )

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
