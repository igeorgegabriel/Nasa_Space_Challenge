import json
import math
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

    def predict_raw(self, coef, o2, p_atm, fuel):
        z = coef[0] + coef[1] * o2 + coef[2] * math.log(p_atm) + coef[3] * (1.0 if fuel == "Heptane" else 0.0)
        return 1.0 / (1.0 + math.exp(-z))

    def percentile(self, values, q):
        ordered = sorted(values)
        pos = q / 100.0 * (len(ordered) - 1)
        lo = int(math.floor(pos))
        hi = min(lo + 1, len(ordered) - 1)
        return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)

    def in_polygon(self, poly, x, y):
        sign = 0
        for i in range(len(poly)):
            ax, ay = poly[i]
            bx, by = poly[(i + 1) % len(poly)]
            cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
            if abs(cross) < 1e-12:
                continue
            side = 1 if cross > 0 else -1
            if sign == 0:
                sign = side
            elif side != sign:
                return False
        return True

    def test_predictor_reproduces_habitat_predictions(self):
        pred = self.model["predictor"]
        self.assertEqual(len(pred["bootstrap_raw"]), 500)
        for h in self.model["habitats"]:
            for fuel, entry in h["fuels"].items():
                if entry["prediction"] is None:
                    continue
                o2 = h["o2"]["mid"]
                p = h["pressure_atm"]["mid"]
                est = self.predict_raw(pred["raw"], o2, p, fuel)
                self.assertAlmostEqual(est, entry["prediction"]["estimate"], delta=0.005)
                boot = [self.predict_raw(c, o2, p, fuel) for c in pred["bootstrap_raw"]]
                self.assertAlmostEqual(self.percentile(boot, 2.5), entry["prediction"]["lo"], delta=0.01)
                self.assertAlmostEqual(self.percentile(boot, 97.5), entry["prediction"]["hi"], delta=0.01)

    def test_standardised_form_matches_raw_form(self):
        pred = self.model["predictor"]
        s = pred["standardised"]
        for o2, p, heptane in ((0.21, 1.0, 1.0), (0.3, 0.8, 0.0), (0.25, 0.5, 1.0)):
            x = [o2, math.log(p), heptane]
            z = s["intercept"] + sum(c * (v - m) / sc for c, v, m, sc in zip(s["coef"], x, s["mean"], s["scale"]))
            raw = pred["raw"]
            zr = raw[0] + sum(c * v for c, v in zip(raw[1:], x))
            self.assertAlmostEqual(z, zr, places=4)

    def test_hull_agrees_with_habitat_statuses(self):
        pred = self.model["predictor"]
        for h in self.model["habitats"]:
            for fuel, entry in h["fuels"].items():
                poly = pred["hull"][fuel]
                inside = self.in_polygon(poly, h["o2"]["mid"], h["pressure_atm"]["mid"])
                if entry["status"] == "inside":
                    self.assertTrue(inside, (h["id"], fuel))
                if entry["status"] == "outside":
                    box = pred["box"][fuel]
                    o2_ex = max(0.0, box["o2"][0] - h["o2"]["mid"], h["o2"]["mid"] - box["o2"][1])
                    p_ex = max(0.0, box["pressure_atm"][0] - h["pressure_atm"]["mid"], h["pressure_atm"]["mid"] - box["pressure_atm"][1])
                    tol = self.model["domain"]["edge_tolerance"]
                    self.assertTrue((not inside) and (o2_ex > tol["o2"] or p_ex > tol["pressure_atm"]), (h["id"], fuel))
                if entry["status"] == "edge":
                    self.assertFalse(inside, (h["id"], fuel))

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
