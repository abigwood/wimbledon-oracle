import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class WimbledonOracleTests(unittest.TestCase):
    def test_required_files_exist(self):
        for name in (
            "index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js",
            "data/fixtures.json", "scripts/sync_official.py", "worker/src/worker.js",
        ):
            self.assertTrue((ROOT / name).exists(), name)

    def test_schedule_covers_official_dates(self):
        app = (ROOT / "app.js").read_text()
        self.assertIn('"2026-06-29"', app)
        self.assertIn('"2026-07-12"', app)

    def test_early_round_volume(self):
        app = (ROOT / "app.js").read_text()
        for date in ("2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"):
            self.assertRegex(app, rf'\["{date}", "[^"]+", 3, 3, "featured"\]')

    def test_last_32_has_every_match(self):
        app = (ROOT / "app.js").read_text()
        self.assertIn('["2026-07-03", "Last 32", 8, 8, "all"]', app)
        self.assertIn('["2026-07-04", "Last 32", 8, 8, "all"]', app)

    def test_valid_tennis_scores_only(self):
        app = (ROOT / "app.js").read_text()
        self.assertIn('["3–0", 3, 0]', app)
        self.assertIn('["3–2", 3, 2]', app)
        self.assertIn('["2–0", 2, 0]', app)
        self.assertIn('["2–1", 2, 1]', app)
        self.assertNotIn('["2–2"', app)

    def test_fixture_json_valid(self):
        data = json.loads((ROOT / "data/fixtures.json").read_text())
        self.assertIn(data["status"], ("draw-pending", "live"))
        self.assertIsInstance(data["fixtures"], list)
        ids = [fixture["id"] for fixture in data["fixtures"]]
        self.assertEqual(len(ids), len(set(ids)))
        for fixture in data["fixtures"]:
            self.assertIn(fixture["tour"], ("men", "women"))
            self.assertNotIn("TBC", fixture["player1"])
            self.assertNotIn("TBC", fixture["player2"])

    def test_html_asset_versions_match(self):
        html = (ROOT / "index.html").read_text()
        self.assertIn("styles.css?v=20260625a", html)
        self.assertIn("app.js?v=20260625a", html)
        self.assertIn("wimbledon-oracle-window.abigwood.workers.dev", html)

    def test_zero_cost_official_data_workflow(self):
        sync = (ROOT / "scripts/sync_official.py").read_text()
        self.assertIn("https://www.wimbledon.com/graphql", sync)
        self.assertNotIn("rapidapi", sync.lower())
        self.assertNotIn("api_key", sync.lower())

    def test_separate_backend_configuration(self):
        wrangler = (ROOT / "worker/wrangler.toml").read_text()
        self.assertIn('name = "wimbledon-oracle-window"', wrangler)
        self.assertIn("/wimbledon-oracle/data/fixtures.json", wrangler)
        self.assertNotIn("kickoff-oracle-window", wrangler)


if __name__ == "__main__":
    unittest.main()
