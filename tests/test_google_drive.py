from __future__ import annotations

import unittest

from rippopotamus.google_drive import confirmed_download_url_from_warning_page


class GoogleDriveTests(unittest.TestCase):
    def test_confirmed_download_url_preserves_warning_form_params(self) -> None:
        page = """
        <form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
          <input type="submit" value="Download anyway"/>
          <input type="hidden" name="id" value="file-123">
          <input type="hidden" name="export" value="download">
          <input type="hidden" name="authuser" value="0">
          <input type="hidden" name="confirm" value="t">
          <input type="hidden" name="uuid" value="uuid-1">
          <input type="hidden" name="at" value="token:123">
        </form>
        """

        url = confirmed_download_url_from_warning_page(page)

        self.assertEqual(
            url,
            "https://drive.usercontent.google.com/download?id=file-123&export=download&authuser=0&confirm=t&uuid=uuid-1&at=token%3A123",
        )


if __name__ == "__main__":
    unittest.main()
