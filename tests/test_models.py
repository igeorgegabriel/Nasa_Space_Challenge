import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import build_models


class ModelsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = build_models.build()
        cls.model = cls.result["models"][0]
        cls.hab = {h["id"]: h for h in cls.model["habitats"]}

    def test_metrics_beat_baseline(self):
        v = self.model["validation"]
        self.assertLess(v["brier_model"], v["brier_baseline"])
        self.assertGreater(v["brier_skill"], 0.2)
        self.assertGreater(v["auc"], 0.75)
        self.assertGreater(v["brier_gain_ci95"][0], 0.0)
        self.assertGreater(v["auc_ci95"][0], 0.5)

    def test_validation_holds_out_whole_days(self):
        v = self.model["validation"]
        self.assertEqual(v["folds"], 10)
        self.assertGreater(v["groups"], 50)
        self.assertLessEqual(v["bootstrap_resamples"], 1000)

    def test_moon_base_is_refused(self):
        moon = self.hab["lunar"]
        self.assertEqual(moon["status"], "outside")
        for fuel, entry in moon["fuels"].items():
            self.assertEqual(entry["status"], "outside")
            self.assertIsNone(entry["prediction"])
            self.assertIn("below the lowest tested pressure", entry["refusal"])
            self.assertGreater(entry["margin"]["pressure_atm"], 0.1)

    def test_mars_and_rover_are_refused(self):
        for key in ("mars", "rover"):
            self.assertEqual(self.hab[key]["status"], "outside")

    def test_iss_is_predicted_with_interval(self):
        iss = self.hab["iss"]
        self.assertEqual(iss["status"], "inside")
        for fuel, entry in iss["fuels"].items():
            p = entry["prediction"]
            self.assertIsNotNone(p)
            self.assertLessEqual(p["lo"], p["estimate"])
            self.assertLessEqual(p["estimate"], p["hi"])
            self.assertGreater(p["hi"] - p["lo"], 0.0)
            self.assertIsNone(entry["refusal"])
        heptane = iss["fuels"]["Heptane"]["prediction"]["estimate"]
        methanol = iss["fuels"]["Methanol"]["prediction"]["estimate"]
        self.assertLess(heptane, methanol)

    def test_every_habitat_is_predicted_or_refused_never_both(self):
        for h in self.model["habitats"]:
            for entry in h["fuels"].values():
                self.assertNotEqual(entry["prediction"] is None, entry["refusal"] is None)
                self.assertEqual(entry["prediction"] is None, entry["status"] == "outside")

    def test_curve_stays_inside_tested_range(self):
        for fuel, c in self.model["curve"]["fuels"].items():
            dom = self.model["domain"]["fuels"][fuel]
            self.assertGreaterEqual(min(c["o2"]), dom["o2"][0])
            self.assertLessEqual(max(c["o2"]), dom["o2"][1])
            for lo, mid, hi in zip(c["lo"], c["p"], c["hi"]):
                self.assertLessEqual(lo, mid + 1e-9)
                self.assertLessEqual(mid, hi + 1e-9)

    def test_limiting_oxygen_block(self):
        fuels = self.result["limiting_oxygen"]["fuels"]
        self.assertAlmostEqual(fuels["Methanol"]["lowest_o2_with_flame_n2_only"], 0.12)
        self.assertTrue(fuels["Methanol"]["published"]["verified_in_repo"])
        self.assertFalse(fuels["Heptane"]["published"]["verified_in_repo"])
        self.assertEqual(fuels["Heptane"]["published"]["quote"], "")

    def test_diluent_counts_match_rows(self):
        rows, _ = build_models.load_flex()
        total = sum(t["rows"] for t in self.result["diluents"]["table"])
        self.assertEqual(total, len(rows))

    def test_deterministic(self):
        again = build_models.build()
        self.assertEqual(json.dumps(self.result, sort_keys=True), json.dumps(again, sort_keys=True))

    def test_exported_file_is_ascii_and_current(self):
        build_models.main()
        with open(build_models.OUT, "rb") as handle:
            raw = handle.read()
        raw.decode("ascii")
        self.assertEqual(json.loads(raw)["models"][0]["id"], self.model["id"])


if __name__ == "__main__":
    unittest.main()
