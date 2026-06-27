import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class WimbledonOracleTests(unittest.TestCase):
    def test_required_files_exist(self):
        for name in (
            "index.html", "reset-cache.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js",
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
            self.assertRegex(app, rf'\["{date}", "[^"]+", 4, 4, "featured"\]')

    def test_last_32_stays_featured_until_round_of_16(self):
        app = (ROOT / "app.js").read_text()
        self.assertIn('["2026-07-03", "Last 32", 4, 4, "featured"]', app)
        self.assertIn('["2026-07-04", "Last 32", 4, 4, "featured"]', app)
        self.assertIn('["2026-07-05", "Last 16", 4, 4, "all"]', app)

    def test_valid_tennis_scores_only(self):
        app = (ROOT / "app.js").read_text()
        self.assertIn('["3–0", 3, 0]', app)
        self.assertIn('["3–2", 3, 2]', app)
        self.assertIn('["2–0", 2, 0]', app)
        self.assertIn('["2–1", 2, 1]', app)
        self.assertNotIn('["2–2"', app)

    def test_saved_pick_locked_ui_and_update_button(self):
        app = (ROOT / "app.js").read_text()
        css = (ROOT / "styles.css").read_text()
        self.assertIn("function pickStatus", app)
        self.assertIn("Your pick is locked in", app)
        self.assertIn("data-update-pick", app)
        self.assertIn("Update pick", app)
        self.assertIn("editingPick = updatePick.dataset.updatePick", app)
        self.assertIn("const showOptions = ready && (!pick || open)", app)
        self.assertIn("locked-summary", app)
        self.assertIn(".pick-lock-card", css)
        self.assertIn(".update-pick-button", css)

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
        self.assertIn("styles.css?v=20260627b", html)
        self.assertIn("app.js?v=20260627b", html)
        self.assertIn("wimbledon-oracle-window.abigwood.workers.dev", html)

    def test_service_worker_updates_app_shell_network_first(self):
        sw = (ROOT / "sw.js").read_text()
        app = (ROOT / "app.js").read_text()
        self.assertIn("wimbledon-oracle-v9-20260627", sw)
        self.assertIn("networkFirst", sw)
        self.assertIn('event.data?.type === "SKIP_WAITING"', sw)
        self.assertIn("controllerchange", app)
        self.assertIn("registration.update()", app)

    def test_zero_cost_official_data_workflow(self):
        sync = (ROOT / "scripts/sync_official.py").read_text()
        self.assertIn("https://www.wimbledon.com/graphql", sync)
        self.assertIn("FEATURED_DATES", sync)
        self.assertIn("FEATURED_PER_TOUR = 4", sync)
        self.assertNotIn("rapidapi", sync.lower())
        self.assertNotIn("api_key", sync.lower())

    def test_featured_selection_policy_is_explicit(self):
        sync = (ROOT / "scripts/sync_official.py").read_text()
        self.assertIn('SHOW_COURTS = ("Centre Court", "No. 1 Court", "No. 2 Court", "No. 3 Court")', sync)
        self.assertIn("def featured_sort_key", sync)
        self.assertIn('"tieBreakers": ["seeded players", "official order of play"]', sync)

    def test_separate_backend_configuration(self):
        wrangler = (ROOT / "worker/wrangler.toml").read_text()
        self.assertIn('name = "wimbledon-oracle-window"', wrangler)
        self.assertIn("/wimbledon-oracle/data/fixtures.json", wrangler)
        self.assertNotIn("kickoff-oracle-window", wrangler)


if __name__ == "__main__":
    unittest.main()
