from __future__ import annotations

import argparse
import io
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from rippopotamus import desktop_engine, desktop_runtime, footage_index, google_drive, index_worker, query_intelligence, search_evidence, source_registry, torrent_downloads
from rippopotamus.providers import ProviderContext, desktop_download_command
from rippopotamus.video_chunker import VideoChunk, expected_video_spans


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
        with mock.patch("rippopotamus.desktop_engine.provider_context", return_value=ProviderContext(yt_dlp_base=("yt-dlp",), cookies_browser="chrome")):
            with mock.patch("rippopotamus.desktop_engine.run_text", return_value='{"id": "TQd2k1pEXp4", "title": "Video"}') as run_text:
                stream = io.StringIO()
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_fetch(args), 0)

        command = run_text.call_args.args[0]
        self.assertIn("--cookies-from-browser", command)
        self.assertLess(command.index("--ignore-config"), command.index("--cookies-from-browser"))
        self.assertEqual(command[command.index("--cookies-from-browser") + 1], "chrome")

    def test_source_search_returns_renderer_facing_response_shape(self) -> None:
        args = argparse.Namespace(query="moon landing", pack="all", limit=3)
        payload = {
            "ok": True,
            "query": "moon landing",
            "pack": "all",
            "packs": [{"id": "public", "label": "Public archives"}],
            "results": [{
                "id": "nasa:moon",
                "pack": "public",
                "packLabel": "NASA Images",
                "title": "Moon landing",
                "description": "Actual NASA media result.",
                "url": "https://images.nasa.gov/details/moon",
                "openUrl": "https://images.nasa.gov/details/moon",
                "mediaTypes": ["image"],
                "usage": "Actual NASA Images result.",
                "actionLabel": "Open NASA",
                "score": 104,
                "resultKind": "item",
                "sourceName": "NASA Images",
            }],
            "actualResultCount": 1,
            "routeResultCount": 0,
            "searchedSources": ["NASA Images"],
        }
        stream = io.StringIO()
        intelligence = query_intelligence.build_query_intelligence("moon landing", "all")
        with mock.patch("rippopotamus.desktop_engine.build_query_intelligence", return_value=intelligence):
            with mock.patch("rippopotamus.desktop_engine.search_sources", return_value=payload) as search_sources:
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_source_search(args), 0)

        search_sources.assert_called_once_with("moon landing", "all", 3)
        response = json.loads(stream.getvalue())
        self.assertEqual(response["results"], payload["results"])
        self.assertEqual(response["requestedPack"], "all")
        self.assertEqual(response["intelligence"], intelligence)

    def test_source_search_result_shape_has_real_result_metadata(self) -> None:
        response = source_registry.search_sources(
            "wrapped movie",
            "movies",
            2,
            fetch_json=lambda _url: {
                "d": [{
                    "id": "tt8924522",
                    "l": "Wrapped",
                    "q": "feature",
                    "qid": "movie",
                    "s": "Mike Markoff, Barbara Ackles",
                    "y": 2019,
                    "i": {"imageUrl": "https://images.example/wrapped.jpg"},
                }],
            },
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["query"], "wrapped movie")
        self.assertEqual(response["pack"], "movies")
        self.assertEqual(response["actualResultCount"], 1)
        self.assertGreaterEqual(response["routeResultCount"], 1)

        result = response["results"][0]
        self.assertEqual(result["id"], "imdb:tt8924522")
        self.assertEqual(result["title"], "Wrapped")
        self.assertEqual(result["resultKind"], "item")
        self.assertEqual(result["sourceName"], "IMDb")
        self.assertEqual(result["openUrl"], "https://www.imdb.com/title/tt8924522/")
        self.assertEqual(result["actionLabel"], "Open IMDb")
        self.assertEqual(result["thumbnailUrl"], "https://images.example/wrapped.jpg")

    def test_source_search_command_emits_registry_payload(self) -> None:
        args = argparse.Namespace(query="moon landing", pack="all", limit=3)
        stream = io.StringIO()
        intelligence = query_intelligence.build_query_intelligence("moon landing", "all")
        with mock.patch("rippopotamus.desktop_engine.build_query_intelligence", return_value=intelligence):
            with mock.patch("rippopotamus.desktop_engine.search_sources") as search_sources:
                search_sources.return_value = {
                    "ok": True,
                    "query": "moon landing",
                    "pack": "all",
                    "packs": [{"id": "public", "label": "Public archives"}],
                    "results": [],
                    "actualResultCount": 0,
                    "routeResultCount": 0,
                    "searchedSources": [],
                }
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_source_search(args), 0)

        search_sources.assert_called_once_with("moon landing", "all", 3)

    def test_source_search_ai_can_route_all_pack_to_specific_adapter(self) -> None:
        args = argparse.Namespace(query="wrapped", pack="all", limit=3)
        intelligence = {
            "enabled": True,
            "source": "openrouter",
            "requestedPack": "all",
            "pack": "movies",
            "packLabel": "Movies and shows",
            "confidence": 0.9,
            "reason": "Looks like an entertainment title.",
            "searchTerms": ["wrapped"],
            "ui": "result-list",
            "query": "wrapped",
        }
        with mock.patch("rippopotamus.desktop_engine.build_query_intelligence", return_value=intelligence):
            with mock.patch("rippopotamus.desktop_engine.search_sources", return_value={"ok": True, "query": "wrapped", "pack": "movies", "packs": [], "results": []}) as search_sources:
                stream = io.StringIO()
                with redirect_stdout(stream):
                    self.assertEqual(desktop_engine.command_source_search(args), 0)

        search_sources.assert_called_once_with("wrapped", "movies", 3)
        response = json.loads(stream.getvalue())
        self.assertEqual(response["requestedPack"], "all")
        self.assertEqual(response["intelligence"]["pack"], "movies")

    def test_query_intelligence_stays_off_without_openrouter_key(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            intelligence = query_intelligence.build_query_intelligence("wrapped", "all")

        self.assertFalse(intelligence["enabled"])
        self.assertEqual(intelligence["pack"], "all")

    def test_query_intelligence_normalizes_openrouter_payload(self) -> None:
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}):
            with mock.patch("rippopotamus.query_intelligence._call_openrouter", return_value={
                "pack": "movies",
                "confidence": 0.88,
                "reason": "Likely movie title.",
                "searchTerms": ["wrapped"],
                "ui": "result-list",
            }):
                intelligence = query_intelligence.build_query_intelligence("wrapped", "all")

        self.assertTrue(intelligence["enabled"])
        self.assertEqual(intelligence["source"], "openrouter")
        self.assertEqual(intelligence["pack"], "movies")
        self.assertEqual(intelligence["packLabel"], "Movies and shows")
        self.assertEqual(intelligence["searchTerms"], ["wrapped"])

    def test_query_intelligence_passes_search_evidence_to_openrouter(self) -> None:
        evidence = {
            "enabled": True,
            "source": "google_cse",
            "label": "Google Programmable Search",
            "query": "wrapped",
            "results": [{
                "title": "Wrapped movie",
                "url": "https://www.imdb.com/title/tt8924522/",
                "displayUrl": "imdb.com",
                "snippet": "Wrapped is a feature film.",
            }],
            "resultCount": 1,
        }
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}, clear=True):
            with mock.patch("rippopotamus.query_intelligence.collect_search_evidence", return_value=evidence):
                with mock.patch("rippopotamus.query_intelligence._call_openrouter", return_value={
                    "pack": "movies",
                    "confidence": 0.91,
                    "reason": "Search evidence points to a film title.",
                    "searchTerms": ["wrapped movie"],
                }) as call_openrouter:
                    intelligence = query_intelligence.build_query_intelligence("wrapped", "all")

        call_openrouter.assert_called_once()
        self.assertEqual(call_openrouter.call_args.args[3], evidence)
        self.assertEqual(intelligence["webEvidence"], evidence)
        self.assertEqual(intelligence["pack"], "movies")

    def test_search_evidence_collects_google_cse_results(self) -> None:
        with mock.patch.dict(os.environ, {"GOOGLE_CSE_API_KEY": "key", "GOOGLE_CSE_ID": "cx"}, clear=True):
            with mock.patch("rippopotamus.search_evidence._fetch_json", return_value={
                "items": [{
                    "title": "Wrapped - IMDb",
                    "link": "https://www.imdb.com/title/tt8924522/",
                    "displayLink": "www.imdb.com",
                    "snippet": "Wrapped is a feature film.",
                }],
            }) as fetch_json:
                evidence = search_evidence.collect_search_evidence("wrapped", "all", limit=3)

        fetch_json.assert_called_once()
        self.assertIn("customsearch/v1", fetch_json.call_args.args[0])
        self.assertTrue(evidence["enabled"])
        self.assertEqual(evidence["source"], "google_cse")
        self.assertEqual(evidence["resultCount"], 1)
        self.assertEqual(evidence["results"][0]["displayUrl"], "www.imdb.com")

    def test_search_evidence_accepts_renderer_collected_evidence(self) -> None:
        renderer_payload = json.dumps({
            "enabled": True,
            "source": "electron_google",
            "provider": "electron_google",
            "label": "Electron Google",
            "query": "wrapped",
            "requestedPack": "all",
            "results": [{
                "title": "Wrapped - IMDb",
                "url": "https://www.imdb.com/title/tt8924522/",
                "displayUrl": "imdb.com",
                "snippet": "",
                "position": 1,
            }],
            "resultCount": 1,
            "reason": "Read Google search-result context through Electron Chromium before routing.",
        })
        with mock.patch.dict(os.environ, {
            "RIPPO_SEARCH_EVIDENCE_JSON": renderer_payload,
            "RIPPO_SERP_BROWSER": "1",
        }, clear=True):
            with mock.patch("rippopotamus.search_evidence._crawl4ai_google_search") as crawl:
                evidence = search_evidence.collect_search_evidence("wrapped", "all", limit=3)

        crawl.assert_not_called()
        self.assertTrue(evidence["enabled"])
        self.assertEqual(evidence["source"], "electron_google")
        self.assertEqual(evidence["results"][0]["title"], "Wrapped - IMDb")

    def test_search_evidence_uses_crawl4ai_google_when_provider_forced(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_SEARCH_PROVIDER": "crawl4ai_google"}, clear=True):
            with mock.patch("rippopotamus.search_evidence._crawl4ai_google_search", return_value=[{
                "title": "Wrapped - IMDb",
                "url": "https://www.imdb.com/title/tt8924522/",
                "displayUrl": "imdb.com",
                "snippet": "",
                "position": 1,
            }]) as crawl:
                evidence = search_evidence.collect_search_evidence("wrapped", "all", limit=3)

        crawl.assert_called_once_with("wrapped", 3)
        self.assertTrue(evidence["enabled"])
        self.assertEqual(evidence["source"], "crawl4ai_google")
        self.assertEqual(evidence["results"][0]["title"], "Wrapped - IMDb")

    def test_search_evidence_does_not_use_crawl4ai_for_electron_browser_flag(self) -> None:
        with mock.patch.dict(os.environ, {"RIPPO_SERP_BROWSER": "1"}, clear=True):
            with mock.patch("rippopotamus.search_evidence._crawl4ai_google_search") as crawl:
                evidence = search_evidence.collect_search_evidence("wrapped", "all", limit=3)

        crawl.assert_not_called()
        self.assertFalse(evidence["enabled"])
        self.assertEqual(evidence["source"], "off")

    def test_search_evidence_falls_through_when_google_cse_is_blocked(self) -> None:
        with mock.patch.dict(os.environ, {
            "GOOGLE_CSE_API_KEY": "key",
            "GOOGLE_CSE_ID": "cx",
            "SERPER_API_KEY": "serper-key",
            "RIPPO_SERP_BROWSER": "1",
        }, clear=True):
            with mock.patch("rippopotamus.search_evidence._google_cse_search", side_effect=RuntimeError("Custom Search JSON API is closed")) as cse:
                with mock.patch("rippopotamus.search_evidence._serper_search", return_value=[{
                    "title": "Wrapped - IMDb",
                    "url": "https://www.imdb.com/title/tt8924522/",
                    "displayUrl": "imdb.com",
                    "snippet": "",
                    "position": 1,
                }]) as serper:
                    with mock.patch("rippopotamus.search_evidence._crawl4ai_google_search") as crawl:
                        evidence = search_evidence.collect_search_evidence("wrapped", "all", limit=3)

        cse.assert_called_once_with("wrapped", 3)
        serper.assert_called_once_with("wrapped", 3)
        crawl.assert_not_called()
        self.assertTrue(evidence["enabled"])
        self.assertEqual(evidence["source"], "serper")
        self.assertEqual(evidence["providers"], ["google_cse", "serper"])
        self.assertEqual(evidence["fallbackErrors"][0]["provider"], "google_cse")

    def test_google_serp_parser_skips_obvious_sponsored_links(self) -> None:
        html = """
        <html><body>
          <div data-text-ad="1">
            <a href="/url?q=https://ads.example/buy&sa=U"><h3>Sponsored Result</h3></a>
          </div>
          <div class="g">
            <a href="/url?q=https://www.imdb.com/title/tt8924522/&sa=U"><h3>Wrapped - IMDb</h3></a>
          </div>
          <div class="g">
            <a href="https://www.google.com/search?q=wrapped+cast"><h3>More Google</h3></a>
          </div>
          <div class="g">
            <a href="/url?q=https://www.themoviedb.org/movie/123-wrapped&sa=U"><h3>Wrapped - TMDB</h3></a>
          </div>
        </body></html>
        """

        results = search_evidence._parse_google_serp_html(html, limit=5)

        self.assertEqual([result["title"] for result in results], ["Wrapped - IMDb", "Wrapped - TMDB"])
        self.assertEqual(results[0]["displayUrl"], "imdb.com")

    def test_openrouter_model_catalog_filters_and_caches_free_models(self) -> None:
        payload = {
            "data": [
                {
                    "id": "provider/free-one:free",
                    "name": "Free One",
                    "context_length": 8192,
                    "pricing": {"prompt": "0", "completion": "0", "request": "0", "web_search": "0", "internal_reasoning": "0"},
                    "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
                },
                {
                    "id": "provider/paid",
                    "name": "Paid",
                    "pricing": {"prompt": "0.01", "completion": "0", "request": "0"},
                    "architecture": {"output_modalities": ["text"]},
                },
                {
                    "id": "provider/mixed-output:free",
                    "name": "Mixed Output",
                    "pricing": {"prompt": "0", "completion": "0", "request": "0"},
                    "architecture": {"input_modalities": ["text"], "output_modalities": ["text", "image"]},
                },
                {
                    "id": "provider/unknown-output:free",
                    "name": "Unknown Output",
                    "pricing": {"prompt": "0", "completion": "0", "request": "0"},
                    "architecture": {"input_modalities": ["text"]},
                },
            ]
        }

        with tempfile.TemporaryDirectory() as tmp:
            cache = str(Path(tmp) / "models.json")
            with mock.patch.dict(os.environ, {"RIPPO_OPENROUTER_MODELS_CACHE": cache}, clear=True):
                with mock.patch("rippopotamus.query_intelligence._fetch_models_payload", return_value=payload):
                    catalog = query_intelligence.openrouter_model_catalog(refresh=True, selected_model="provider/free-one:free")

        self.assertEqual(catalog["selectedModel"], "provider/free-one:free")
        self.assertIn("openrouter/free", [model["id"] for model in catalog["models"]])
        self.assertIn("provider/free-one:free", [model["id"] for model in catalog["models"]])
        self.assertNotIn("provider/paid", [model["id"] for model in catalog["models"]])
        self.assertNotIn("provider/mixed-output:free", [model["id"] for model in catalog["models"]])
        self.assertNotIn("provider/unknown-output:free", [model["id"] for model in catalog["models"]])
        self.assertTrue(all(model["outputModalities"] == ["text"] for model in catalog["models"]))

    def test_ai_models_command_emits_selected_catalog(self) -> None:
        args = argparse.Namespace(refresh=False, selected_model="openrouter/free")
        with mock.patch("rippopotamus.desktop_engine.openrouter_model_catalog", return_value={"ok": True, "selectedModel": "openrouter/free", "models": []}) as catalog:
            stream = io.StringIO()
            with redirect_stdout(stream):
                self.assertEqual(desktop_engine.command_ai_models(args), 0)

        catalog.assert_called_once_with(refresh=False, selected_model="openrouter/free")
        self.assertEqual(json.loads(stream.getvalue())["selectedModel"], "openrouter/free")

    def test_source_search_pack_limit_and_query_url_are_applied(self) -> None:
        def fake_fetch_json(url: str) -> dict[str, object]:
            self.assertIn("images-api.nasa.gov/search", url)
            self.assertIn("q=space+shuttle", url)
            return {
                "collection": {
                    "items": [{
                        "data": [{
                            "nasa_id": "KSC-1",
                            "title": "Space Shuttle Launch",
                            "description": "A shuttle launch.",
                            "media_type": "image",
                            "date_created": "2011-07-08T00:00:00Z",
                        }],
                        "links": [{"rel": "preview", "href": "https://images.example/shuttle.jpg"}],
                    }],
                },
            }

        response = source_registry.search_sources("space shuttle", "public", 1, fetch_json=fake_fetch_json)

        self.assertEqual(response["pack"], "public")
        self.assertEqual(len(response["results"]), 1)
        self.assertEqual(response["results"][0]["id"], "nasa:KSC-1")
        self.assertEqual(response["results"][0]["openUrl"], "https://images.nasa.gov/details/KSC-1")
        self.assertEqual(response["results"][0]["actionLabel"], "Open NASA")
        self.assertEqual(response["results"][0]["resultKind"], "item")

    def test_source_search_movie_queries_return_actual_title_results_first(self) -> None:
        response = source_registry.search_sources(
            "wrapped movie",
            "all",
            3,
            fetch_json=lambda _url: {
                "d": [
                    {"id": "tt8924522", "l": "Wrapped", "q": "feature", "qid": "movie", "s": "Mike Markoff", "y": 2019},
                    {"id": "tt7605066", "l": "Wrapped Up in Christmas", "q": "TV movie", "qid": "tvMovie", "y": 2017},
                ],
            },
        )

        self.assertEqual(response["results"][0]["id"], "imdb:tt8924522")
        self.assertEqual(response["results"][0]["packLabel"], "IMDb")
        self.assertEqual(response["results"][0]["resultKind"], "item")
        self.assertEqual(response["results"][0]["openUrl"], "https://www.imdb.com/title/tt8924522/")
        self.assertIn("movies", [pack["id"] for pack in response["packs"]])

    def test_source_search_parser_accepts_electron_command_shape(self) -> None:
        parser = desktop_engine.build_parser()
        args = parser.parse_args(["source-search", "--query", "city skyline", "--pack", "stock", "--limit", "2"])

        self.assertEqual(args.query, "city skyline")
        self.assertEqual(args.pack, "stock")
        self.assertEqual(args.limit, 2)
        self.assertIs(args.func, desktop_engine.command_source_search)

    def test_source_search_rejects_unknown_pack(self) -> None:
        args = argparse.Namespace(query="", pack="private", limit=3)

        with self.assertRaises(SystemExit):
            desktop_engine.command_source_search(args)

    def test_index_ingest_indexes_media_and_searches_by_filename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            media = Path(tmp) / "footage"
            media.mkdir()
            video = media / "night-rally-flag.mp4"
            video.write_bytes(b"not a real video")

            response = footage_index.ingest_paths(root, [media])

            self.assertTrue(response["ok"])
            self.assertEqual(response["added"], 1)
            self.assertEqual(response["assetCount"], 1)
            self.assertEqual(response["momentCount"], 1)

            results = footage_index.search_index(root, "rally flag", 5)

            self.assertEqual(results["resultCount"], 1)
            self.assertEqual(results["results"][0]["path"], str(video.resolve()))
            self.assertEqual(results["results"][0]["matchType"], "text")
            self.assertEqual(results["results"][0]["assetId"], response["indexed"][0]["id"])
            self.assertEqual(results["results"][0]["file"], "night-rally-flag.mp4")
            self.assertEqual(results["results"][0]["kind"], "video")
            self.assertEqual(results["results"][0]["title"], "night rally flag")
            self.assertEqual(results["results"][0]["start"], 0.0)
            self.assertIn("score", results["results"][0])

    def test_index_cli_ingest_and_search_emit_ui_result_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            media = Path(tmp) / "footage"
            media.mkdir()
            video = media / "booth-crowd-line.mp4"
            image = media / "booth-map.png"
            video.write_bytes(b"not a real video")
            image.write_bytes(b"not a real image")

            ingest_stream = io.StringIO()
            ingest_args = argparse.Namespace(index_root=str(root), paths=[str(media)])
            with redirect_stdout(ingest_stream):
                self.assertEqual(desktop_engine.command_index_ingest(ingest_args), 0)
            ingest_response = json.loads(ingest_stream.getvalue())

            self.assertTrue(ingest_response["ok"])
            self.assertEqual(ingest_response["assetCount"], 2)
            self.assertEqual(ingest_response["momentCount"], 2)

            search_stream = io.StringIO()
            search_args = argparse.Namespace(index_root=str(root), query="booth", limit=10)
            with redirect_stdout(search_stream):
                self.assertEqual(desktop_engine.command_index_search(search_args), 0)
            search_response = json.loads(search_stream.getvalue())

            self.assertTrue(search_response["ok"])
            self.assertEqual(search_response["query"], "booth")
            self.assertEqual(search_response["resultCount"], 2)
            for result in search_response["results"]:
                self.assertTrue(result["id"])
                self.assertTrue(result["assetId"])
                self.assertIn(result["kind"], {"image", "video"})
                self.assertIn(result["file"], {"booth-crowd-line.mp4", "booth-map.png"})
                self.assertEqual(result["matchType"], "text")
                self.assertTrue(Path(result["path"]).is_absolute())
                self.assertIn("score", result)

    def test_expected_video_spans_keep_overlap_and_tail_stable(self) -> None:
        self.assertEqual(expected_video_spans(5, chunk_duration=30, overlap=5), [(0.0, 5.0)])
        self.assertEqual(
            expected_video_spans(65, chunk_duration=30, overlap=5),
            [(0.0, 30.0), (25.0, 55.0), (50.0, 65.0)],
        )
        with self.assertRaises(ValueError):
            expected_video_spans(60, chunk_duration=30, overlap=30)

    def test_index_upsert_moments_supports_embedding_search(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            media = Path(tmp) / "footage"
            media.mkdir()
            flag = media / "flag-shot.mp4"
            crowd = media / "crowd-shot.mp4"
            flag.write_bytes(b"flag")
            crowd.write_bytes(b"crowd")

            footage_index.upsert_moments(root, {
                "moments": [
                    {
                        "path": str(flag),
                        "start": 12,
                        "end": 18,
                        "description": "man holding saffron flag in crowd",
                        "tags": ["flag", "crowd"],
                        "embedding": [1.0, 0.0],
                    },
                    {
                        "path": str(crowd),
                        "start": 4,
                        "end": 10,
                        "description": "wide crowd shot near stage",
                        "tags": ["crowd", "stage"],
                        "embedding": [0.0, 1.0],
                    },
                ],
            })

            results = footage_index.search_index(root, "flag", 5, query_vector=[0.95, 0.05])

            self.assertEqual(results["resultCount"], 1)
            self.assertEqual(results["results"][0]["path"], str(flag.resolve()))
            self.assertEqual(results["results"][0]["matchType"], "embedding")

    def test_index_search_can_disable_vector_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            media = Path(tmp) / "footage"
            media.mkdir()
            video = media / "wide-crowd.mp4"
            video.write_bytes(b"fake video")

            footage_index.upsert_moments(root, {
                "moments": [{
                    "path": str(video),
                    "start": 0,
                    "end": 5,
                    "description": "wide crowd shot near stage",
                    "tags": ["crowd"],
                    "embedding": [1.0, 0.0],
                }],
            })

            embedded = footage_index.search_index(root, "zeppelin", 5, query_vector=[1.0, 0.0])
            no_vector = footage_index.search_index(root, "zeppelin", 5, query_vector=[1.0, 0.0], use_vector=False)

            self.assertEqual(embedded["resultCount"], 1)
            self.assertEqual(embedded["results"][0]["matchType"], "embedding")
            self.assertEqual(no_vector["resultCount"], 0)
            self.assertIsNone(no_vector["queryEmbeddingSource"])

    def test_lexical_search_hides_full_asset_moment_when_better_moments_exist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            media = Path(tmp) / "footage"
            media.mkdir()
            video = media / "booth-crowd-line.mp4"
            video.write_bytes(b"fake video")

            footage_index.ingest_paths(root, [media])
            footage_index.upsert_moments(root, {
                "moments": [{
                    "path": str(video),
                    "start": 0,
                    "end": 4,
                    "title": "booth crowd line",
                    "description": "booth crowd line semantic moment",
                    "tags": ["booth"],
                    "embedding": [1.0, 0.0],
                    "embeddingProvider": "gemini",
                    "embeddingModel": "gemini-embedding-2",
                    "embeddingDimensions": 2,
                }],
            })

            results = footage_index.search_index(root, "booth", 5)

            self.assertEqual(results["resultCount"], 1)
            self.assertNotEqual(results["results"][0]["id"], f"{results['results'][0]['assetId']}:full")
            self.assertEqual(results["results"][0]["embeddingProvider"], "gemini")

    def test_recent_search_hides_full_asset_moment_when_better_moments_exist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            media = Path(tmp) / "footage"
            media.mkdir()
            video = media / "booth-crowd-line.mp4"
            video.write_bytes(b"fake video")

            footage_index.ingest_paths(root, [media])
            footage_index.upsert_moments(root, {
                "moments": [{
                    "path": str(video),
                    "start": 0,
                    "end": 4,
                    "title": "booth crowd line",
                    "description": "booth crowd line semantic moment",
                    "tags": ["booth"],
                    "embedding": [1.0, 0.0],
                    "embeddingProvider": "gemini",
                    "embeddingModel": "gemini-embedding-2",
                    "embeddingDimensions": 2,
                }],
            })

            results = footage_index.search_index(root, "", 5)

            self.assertEqual(results["resultCount"], 1)
            self.assertEqual(results["results"][0]["matchType"], "recent")
            self.assertNotEqual(results["results"][0]["id"], f"{results['results'][0]['assetId']}:full")
            self.assertEqual(results["results"][0]["embeddingProvider"], "gemini")

    def test_index_search_does_not_return_low_score_vector_noise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            media = Path(tmp) / "footage"
            media.mkdir()
            video = media / "hospital-building.mp4"
            video.write_bytes(b"fake video")

            footage_index.upsert_moments(root, {
                "moments": [
                    {
                        "path": str(video),
                        "start": 0,
                        "end": 10,
                        "description": "aerial hospital building with parking lot",
                        "tags": ["hospital", "building"],
                        "embedding": [1.0, 0.0],
                    },
                ],
            })

            miss = footage_index.search_index(root, "nuke", 5, query_vector=[0.0, 1.0])
            lexical_fallback = footage_index.search_index(root, "building", 5, query_vector=[0.0, 1.0])

            self.assertEqual(miss["resultCount"], 0)
            self.assertEqual(lexical_fallback["resultCount"], 1)
            self.assertEqual(lexical_fallback["results"][0]["matchType"], "text")

    def test_import_semantic_script_index_bridges_experiment_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            media = Path(tmp) / "footage"
            media.mkdir()
            video = media / "parking-lot.mp4"
            video.write_bytes(b"fake video")
            semantic_db = Path(tmp) / "semantic-script.sqlite3"
            with sqlite3.connect(semantic_db) as conn:
                conn.execute("""
                    CREATE TABLE scripts (
                        id TEXT PRIMARY KEY,
                        asset_path TEXT NOT NULL,
                        start REAL NOT NULL,
                        end REAL NOT NULL,
                        visual TEXT NOT NULL,
                        audio TEXT NOT NULL,
                        visible_text_json TEXT NOT NULL,
                        tags_json TEXT NOT NULL,
                        shot_type TEXT NOT NULL,
                        people_count TEXT NOT NULL,
                        source TEXT NOT NULL,
                        embedding_json TEXT,
                        embedding_provider TEXT,
                        embedding_model TEXT,
                        embedding_dim INTEGER
                    )
                """)
                conn.execute(
                    """
                    INSERT INTO scripts(
                        id,
                        asset_path,
                        start,
                        end,
                        visual,
                        audio,
                        visible_text_json,
                        tags_json,
                        shot_type,
                        people_count,
                        source,
                        embedding_json,
                        embedding_provider,
                        embedding_model,
                        embedding_dim
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "clip-1",
                        str(video),
                        13.0,
                        28.0,
                        "Aerial view of a hospital building and parking lot.",
                        "ambient drone audio",
                        json.dumps(["hospital entrance"]),
                        json.dumps(["building", "parking lot"]),
                        "aerial",
                        "none",
                        "test",
                        json.dumps([1.0, 0.0]),
                        "gemini",
                        "gemini-embedding-2",
                        2,
                    ),
                )

            response = footage_index.import_semantic_script_index(root, semantic_db)

            self.assertTrue(response["ok"])
            self.assertEqual(response["imported"], 1)
            self.assertEqual(response["embeddedMomentCount"], 1)

            results = footage_index.search_index(root, "parking lot", 5, query_vector=[0.95, 0.05])

            self.assertEqual(results["resultCount"], 1)
            self.assertEqual(results["results"][0]["path"], str(video.resolve()))
            self.assertEqual(results["results"][0]["start"], 13.0)
            self.assertEqual(results["results"][0]["end"], 28.0)
            self.assertEqual(results["results"][0]["matchType"], "embedding")
            self.assertEqual(results["results"][0]["embeddingProvider"], "gemini")

    def test_semantic_ingest_indexes_image_embedding(self) -> None:
        class FakeEmbedder:
            provider = "gemini"
            model = "gemini-embedding-2"
            dimensions = 2

            def embed_image_document(self, _path: Path) -> list[float]:
                return [1.0, 0.0]

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            image = Path(tmp) / "green-field.jpg"
            image.write_bytes(b"fake jpg")

            response = index_worker.semantic_ingest_paths(root, [image], embedder=FakeEmbedder())

            self.assertTrue(response["ok"])
            self.assertEqual(response["embedded"], 1)
            self.assertEqual(response["imageCount"], 1)
            self.assertEqual(response["embeddedMomentCount"], 1)

            results = footage_index.search_index(root, "field", 5, query_vector=[0.9, 0.1])

            self.assertEqual(results["resultCount"], 1)
            self.assertEqual(results["results"][0]["path"], str(image.resolve()))
            self.assertEqual(results["results"][0]["kind"], "image")
            self.assertEqual(results["results"][0]["matchType"], "embedding")
            self.assertEqual(results["results"][0]["embeddingModel"], "gemini-embedding-2")

    def test_semantic_ingest_indexes_video_chunks(self) -> None:
        class FakeEmbedder:
            provider = "gemini"
            model = "gemini-embedding-2"
            dimensions = 2

            def embed_video_document(self, path: Path) -> list[float]:
                return [0.0, 1.0] if "0000" in path.name else [0.2, 0.8]

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            video = Path(tmp) / "night-rally.mp4"
            chunk_a = Path(tmp) / "chunk_0000.mp4"
            chunk_b = Path(tmp) / "chunk_0001.mp4"
            video.write_bytes(b"fake video")
            chunk_a.write_bytes(b"chunk a")
            chunk_b.write_bytes(b"chunk b")
            chunks = [
                VideoChunk(chunk_path=chunk_a, source_path=video.resolve(), start=0.0, end=30.0),
                VideoChunk(chunk_path=chunk_b, source_path=video.resolve(), start=25.0, end=55.0),
            ]

            with mock.patch("rippopotamus.index_worker.chunk_video", return_value=chunks):
                with mock.patch("rippopotamus.index_worker.is_still_frame_chunk", return_value=False):
                    with mock.patch("rippopotamus.index_worker.preprocess_video_chunk", side_effect=lambda path, **_kwargs: path):
                        response = index_worker.semantic_ingest_paths(root, [video], embedder=FakeEmbedder())

            self.assertTrue(response["ok"])
            self.assertEqual(response["embedded"], 2)
            self.assertEqual(response["videoChunks"], 2)
            self.assertEqual(response["embeddedMomentCount"], 2)

            results = footage_index.search_index(root, "rally", 5, query_vector=[0.0, 1.0])

            self.assertEqual(results["resultCount"], 2)
            self.assertEqual(results["results"][0]["path"], str(video.resolve()))
            self.assertEqual(results["results"][0]["start"], 0.0)
            self.assertEqual(results["results"][0]["matchType"], "embedding")

    def test_semantic_ingest_rejects_gemini_chunk_over_provider_limit(self) -> None:
        class FakeEmbedder:
            provider = "gemini"
            model = "gemini-embedding-2"
            dimensions = 2

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            video = Path(tmp) / "night-rally.mp4"
            video.write_bytes(b"fake video")

            response = index_worker.semantic_ingest_paths(
                root,
                [video],
                embedder=FakeEmbedder(),
                options=index_worker.SemanticIngestOptions(chunk_duration=121, overlap=5),
            )

            self.assertFalse(response["ok"])
            self.assertIn("up to 120 seconds", response["error"])
            self.assertEqual(response["embedded"], 0)

    def test_semantic_ingest_without_key_returns_setup_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            image = Path(tmp) / "field-team.png"
            image.write_bytes(b"fake image")

            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}, clear=False):
                response = index_worker.semantic_ingest_paths(root, [image])

            self.assertFalse(response["ok"])
            self.assertEqual(response["semantic"], True)
            self.assertEqual(response["embedded"], 0)
            self.assertIn("Set GEMINI_API_KEY or GOOGLE_API_KEY", response["error"])

    def test_semantic_ingest_writes_dlq_for_file_failure(self) -> None:
        class FailingEmbedder:
            provider = "gemini"
            model = "gemini-embedding-2"
            dimensions = 2

            def embed_image_document(self, _path: Path) -> list[float]:
                raise RuntimeError("provider refused image")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            image = Path(tmp) / "field-team.png"
            image.write_bytes(b"fake image")

            response = index_worker.semantic_ingest_paths(root, [image], embedder=FailingEmbedder())
            dlq_path = root / ".rippo" / "index-dlq.jsonl"
            failures = [json.loads(line) for line in dlq_path.read_text(encoding="utf-8").splitlines()]

            self.assertTrue(response["ok"])
            self.assertEqual(response["failed"], 1)
            self.assertEqual(response["failedEntries"], [{"path": str(image.resolve()), "reason": "provider refused image"}])
            self.assertEqual(failures, response["failedEntries"])

    def test_index_commands_parse_backend_routes(self) -> None:
        parser = desktop_engine.build_parser()
        ingest = parser.parse_args(["index-ingest", "--index-root", "/tmp/rippo", "/tmp/media"])
        search = parser.parse_args(["index-search", "--index-root", "/tmp/rippo", "--query", "red car", "--limit", "7"])
        search_no_vector = parser.parse_args(["index-search", "--no-vector", "--index-root", "/tmp/rippo", "--query", "red car"])
        upsert = parser.parse_args(["index-upsert", "--index-root", "/tmp/rippo", "--payload-json", '{"moments": []}'])

        self.assertIs(ingest.func, desktop_engine.command_index_ingest)
        self.assertIs(search.func, desktop_engine.command_index_search)
        self.assertEqual(search.limit, 7)
        self.assertFalse(search.no_vector)
        self.assertTrue(search_no_vector.no_vector)
        self.assertIs(upsert.func, desktop_engine.command_index_upsert)

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
        drive_metadata.assert_called_once_with(url, "chrome", yt_dlp_base=["yt-dlp"])

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
        self.assertEqual(events[-1]["files"], ["Files/example.jpg"])
        download_drive_file.assert_called_once()

    def test_torrent_preset_prefers_qbittorrent_when_available(self) -> None:
        args = argparse.Namespace(
            url="magnet:?xt=urn:btih:abc&dn=Example",
            preset="torrent",
            output_root="",
            item_id="torrent",
            title="Torrent",
        )

        with tempfile.TemporaryDirectory() as tmp:
            args.output_root = tmp
            with mock.patch("rippopotamus.torrent_downloads.qbittorrent_status", return_value={"ok": True}):
                with mock.patch("rippopotamus.torrent_downloads.command_qbittorrent_download", return_value=0) as qbit_download:
                    self.assertEqual(desktop_engine.command_download(args), 0)

        qbit_download.assert_called_once()

    def test_torrent_preset_falls_back_to_aria2_download_path(self) -> None:
        args = argparse.Namespace(
            url="magnet:?xt=urn:btih:abc&dn=Example",
            preset="torrent",
            output_root="",
            item_id="torrent",
            title="Torrent",
        )

        with tempfile.TemporaryDirectory() as tmp:
            args.output_root = tmp
            with mock.patch("rippopotamus.torrent_downloads.qbittorrent_status", return_value={"ok": False}):
                with mock.patch("rippopotamus.providers.aria2c_base", return_value=["aria2c"]):
                    with mock.patch("rippopotamus.torrent_downloads.command_aria2_download", return_value=0) as aria_download:
                        self.assertEqual(desktop_engine.command_download(args), 0)

        aria_download.assert_called_once()

    def test_qbittorrent_status_reports_torrent_runtime(self) -> None:
        completed = desktop_runtime.subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="qBittorrent v5.1.4\n",
            stderr="",
        )
        with mock.patch("rippopotamus.desktop_runtime.qbittorrent_nox_base", return_value=["qbittorrent-nox"]):
            with mock.patch("rippopotamus.desktop_runtime.subprocess.run", return_value=completed):
                self.assertEqual(
                    desktop_runtime.qbittorrent_status(),
                    {"ok": True, "version": "5.1.4", "path": "qbittorrent-nox", "error": None},
                )

    def test_torrent_engine_status_prefers_qbittorrent_over_aria2(self) -> None:
        with mock.patch("rippopotamus.desktop_runtime.qbittorrent_status", return_value={"ok": True, "version": "5.1.4"}):
            with mock.patch("rippopotamus.desktop_runtime.aria2c_status", return_value={"ok": True, "version": "1.37.0"}):
                self.assertEqual(desktop_runtime.torrent_engine_status()["engine"], "qbittorrent")

    def test_qbittorrent_config_uses_app_owned_profile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            profile = Path(tmp) / "qbt"
            output = Path(tmp) / "out"
            torrent_downloads.write_qbt_config(profile, 39080, output)
            config = profile / "qBittorrent_rippo" / "config" / "qBittorrent.conf"

            text = config.read_text(encoding="utf-8")
            self.assertIn("Accepted=true", text)
            self.assertIn("WebUI\\LocalHostAuth=false", text)
            self.assertIn("WebUI\\Port=39080", text)
            self.assertIn(f"Downloads\\SavePath={(output / 'Files').resolve()}", text)

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
