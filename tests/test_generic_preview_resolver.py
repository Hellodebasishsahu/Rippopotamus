from __future__ import annotations

import io
import unittest
from unittest import mock

from rippopotamus.resolvers.generic_preview import preview_metadata


class GenericPreviewResolverTests(unittest.TestCase):
    def test_preview_metadata_extracts_open_graph_card(self) -> None:
        page = """
        <html>
          <head>
            <title>Fallback title</title>
            <meta property="og:title" content="OpenGraph title"/>
            <meta property="og:description" content="OpenGraph description"/>
            <meta property="og:image" content="/thumb.jpg"/>
            <meta property="og:video" content="https://cdn.example/video.mp4"/>
          </head>
        </html>
        """.encode()
        response = io.BytesIO(page)
        response.__enter__ = lambda value: value
        response.__exit__ = lambda *args: None

        with mock.patch("urllib.request.OpenerDirector.open", return_value=response):
            metadata = preview_metadata("https://example.com/watch/123")

        assert metadata is not None
        self.assertEqual(metadata["title"], "OpenGraph title")
        self.assertEqual(metadata["description"], "OpenGraph description")
        self.assertEqual(metadata["thumbnail"], "https://example.com/thumb.jpg")
        self.assertEqual(metadata["extractor"], "example.com")
        self.assertEqual(metadata["provider"], "yt-dlp")
        self.assertTrue(metadata["provisional"])

    def test_preview_metadata_skips_site_homepages(self) -> None:
        self.assertIsNone(preview_metadata("https://example.com/"))

    def test_preview_metadata_extracts_x_embedded_media_summary(self) -> None:
        page = """
        <html>
          <head>
            <title>AilaunchX on X: &quot;Post text&quot; / X</title>
            <meta property="og:description" content="Post text"/>
            <link rel="preload" as="image" href="https://pbs.twimg.com/amplify_video_thumb/1/img/thumb.jpg?name=orig"/>
          </head>
          <body>
            duration_millis:3591244
            created_at_ms:1781227800000
            url:"https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/video.mp4"
          </body>
        </html>
        """.encode()
        response = io.BytesIO(page)
        response.__enter__ = lambda value: value
        response.__exit__ = lambda *args: None

        with mock.patch("urllib.request.OpenerDirector.open", return_value=response):
            metadata = preview_metadata("https://x.com/Ai_Tech_tool/status/2065245198972809253")

        assert metadata is not None
        self.assertEqual(metadata["id"], "2065245198972809253")
        self.assertEqual(metadata["title"], "AilaunchX - Post text")
        self.assertEqual(metadata["description"], "Post text")
        self.assertEqual(metadata["duration"], 3591.244)
        self.assertEqual(metadata["thumbnail"], "https://pbs.twimg.com/amplify_video_thumb/1/img/thumb.jpg?name=orig")
        self.assertEqual(metadata["uploader"], "AilaunchX")
        self.assertEqual(metadata["upload_date"], "20260612")
        self.assertEqual(metadata["provider"], "yt-dlp")
        self.assertTrue(metadata["provisional"])


if __name__ == "__main__":
    unittest.main()
