from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from unittest import mock

from rippopotamus import agent_cli


class AgentCliTests(unittest.TestCase):
    def test_capabilities_reports_agent_entrypoint_and_surfaces(self) -> None:
        stream = io.StringIO()
        with redirect_stdout(stream):
            self.assertEqual(agent_cli.main(["capabilities"]), 0)

        payload = json.loads(stream.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["entrypoint"], "PYTHONPATH=src python -m rippopotamus.agent_cli")
        self.assertIn("project", payload)
        self.assertIn("engine", payload)
        self.assertIn("health", payload["engine"]["commands"])
        self.assertIn("download", payload["project"]["commands"])
        self.assertIn("doctor", {item["command"] for item in payload["shortcuts"]})

    def test_project_route_forwards_to_project_cli(self) -> None:
        with mock.patch("rippopotamus.agent_cli.cli.main", return_value=0) as project_main:
            self.assertEqual(agent_cli.main(["project", "status"]), 0)

        project_main.assert_called_once_with(["status"])

    def test_engine_route_forwards_to_desktop_engine(self) -> None:
        with mock.patch("rippopotamus.agent_cli.desktop_engine.main", return_value=0) as engine_main:
            self.assertEqual(agent_cli.main(["engine", "health", "--cookies-browser", "chrome"]), 0)

        engine_main.assert_called_once_with(["health", "--cookies-browser", "chrome"])


if __name__ == "__main__":
    unittest.main()
