from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rippopotamus.cli import main, slugify


class CliTests(unittest.TestCase):
    def test_slugify(self) -> None:
        self.assertEqual(slugify("Client Project!!"), "client-project")
        self.assertEqual(slugify(""), "untitled")

    def test_init_add_manifest_zip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            self.assertEqual(main(["init", "Client Project", "--path", str(root)]), 0)

            old_cwd = Path.cwd()
            try:
                import os

                os.chdir(root)
                self.assertEqual(main(["add", "https://example.com/a", "https://example.com/a"]), 0)
                self.assertEqual(main(["manifest"]), 0)
                self.assertEqual(main(["zip"]), 0)
            finally:
                os.chdir(old_cwd)

            manifest = json.loads((root / "manifest.json").read_text())
            self.assertEqual(manifest["project"]["name"], "Client Project")
            self.assertEqual(len(manifest["assets"]), 1)
            self.assertTrue((root / "Exports" / "client-project.zip").exists())


if __name__ == "__main__":
    unittest.main()
