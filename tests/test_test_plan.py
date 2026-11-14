import itertools
import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import build_site_data
import test_plan

SITE = os.path.join(ROOT, "public", "data")
PLAN_PATH = os.path.join(SITE, "test_plan.json")


def read_json(path):
    with open(path, "r", encoding="ascii") as handle:
        return json.load(handle)


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def env(env_id, o2, pressure, flow, g, name=None):
    def block(window, sources):
        if window is None:
            return {"not_specified": True, "window_min": None, "window_max": None, "sources": []}
        return {"not_specified": False, "window_min": window[0], "window_max": window[1], "sources": sources}
    return {
        "id": env_id,
        "name": name or env_id,
        "o2": block(o2, [{"ref": "R-" + env_id}]),
        "pressure_atm": block(pressure, []),
        "flow_cm_s": block(flow, []),
        "gravity": {"g": g, "display": "g=%s" % g, "sources": []},
    }


def zero_next(env_ids, classes=("solid", "liquid_droplet", "gas"), inside=None):
    inside = inside or {}
    return {"environments": {
        e: {"classes": [{"fuel_class": c, "inside": inside.get((e, c), 0)} for c in classes]}
        for e in env_ids
    }}


def row(psi, source_row, fuel_class, o2, pressure):
    return {"psi_id": psi, "source_file": psi + ".csv", "source_row": source_row, "fuel_class": fuel_class,
            "o2_frac": o2, "pressure_atm": pressure, "investigation": psi}


class PlanFixtureTest(unittest.TestCase):
    def setUp(self):
        self.envs = {"environments": [
            env("a", (0.30, 0.35), (0.5, 0.6), (10, 20), 0.16),
            env("b", (0.33, 0.40), (0.55, 0.7), None, 0.38),
            env("c", (0.20, 0.22), (1.0, 1.1), None, 0.0),
        ]}

    def test_overlap_shares_one_test(self):
        plan = test_plan.build_test_plan([], self.envs, zero_next(["a", "b", "c"], ("solid",)))
        self.assertEqual(plan["headline"]["tests"], 2)
        self.assertEqual(plan["headline"]["closed"], 3)
        self.assertEqual(plan["headline"]["gaps"], 3)
        joined = [t for t in plan["tests"] if len(t["habitats"]) == 2][0]
        self.assertEqual(joined["habitats"], ["a", "b"])
        self.assertEqual(joined["o2"], {"min": 0.33, "max": 0.35})
        self.assertEqual(joined["pressure_atm"], {"min": 0.55, "max": 0.6})
        self.assertEqual(joined["flow_cm_s"], {"min": 10, "max": 20})
        self.assertIsNone(joined["flow_note"])

    def test_no_flow_window_says_not_specified(self):
        plan = test_plan.build_test_plan([], self.envs, zero_next(["c"], ("solid",)))
        only = plan["tests"][0]
        self.assertIsNone(only["flow_cm_s"])
        self.assertEqual(only["flow_note"], "not specified by NASA sources")

    def test_covered_habitat_is_not_a_gap(self):
        plan = test_plan.build_test_plan([], self.envs, zero_next(["a", "b", "c"], ("solid",), {("c", "solid"): 3}))
        self.assertEqual(plan["headline"]["gaps"], 2)
        self.assertEqual(plan["headline"]["tests"], 1)
        self.assertNotIn("c", plan["tests"][0]["habitats"])

    def test_flow_conflict_blocks_a_shared_box(self):
        envs = {"environments": [
            env("a", (0.30, 0.35), (0.5, 0.6), (10, 20), 0.16),
            env("b", (0.30, 0.35), (0.5, 0.6), (30, 40), 0.16),
        ]}
        plan = test_plan.build_test_plan([], envs, zero_next(["a", "b"], ("gas",)))
        self.assertEqual(plan["headline"]["tests"], 2)

    def test_tie_goes_to_the_test_furthest_from_existing_rows(self):
        envs = {"environments": [
            env("a", (0.30, 0.35), (0.5, 0.6), None, 0.16),
            env("b", (0.60, 0.70), (0.5, 0.6), None, 0.16),
            env("c", (0.30, 0.35), (1.5, 1.6), None, 0.16),
        ]}
        rows = [row("PSI-1", 1, "gas", 0.325, 0.55)]
        plan = test_plan.build_test_plan(rows, envs, zero_next(["a", "b", "c"], ("gas",)))
        ranks = [t["habitats"] for t in plan["tests"]]
        self.assertEqual(len(ranks), 3)
        self.assertEqual(ranks[0], ["b"])
        self.assertEqual(plan["tests"][-1]["habitats"], ["a"])

    def test_nearest_row_and_distance_are_traced(self):
        rows = [row("PSI-1", 4, "solid", 0.20, 0.55), row("PSI-2", 9, "solid", 0.34, 0.9)]
        plan = test_plan.build_test_plan(rows, self.envs, zero_next(["a"], ("solid",)))
        near = plan["tests"][0]["nearest"]
        self.assertEqual((near["psi_id"], near["source_row"]), ("PSI-2", 9))
        self.assertAlmostEqual(near["o2_gap_points"], abs(0.34 - 0.325) * 100, places=3)
        self.assertAlmostEqual(near["pressure_gap_psia"], abs(0.9 - 0.55) * 14.6959, places=3)

    def test_class_without_pressure_uses_o2_gap_only(self):
        rows = [{"psi_id": "PSI-1", "source_file": "x.csv", "source_row": 2, "fuel_class": "solid", "o2_frac": 0.2, "pressure_atm": None}]
        plan = test_plan.build_test_plan(rows, self.envs, zero_next(["a"], ("solid",)))
        near = plan["tests"][0]["nearest"]
        self.assertIsNone(near["pressure_atm"])
        self.assertIsNone(near["pressure_gap_psia"])
        self.assertAlmostEqual(near["distance"], 12.5, places=3)

    def test_solid_row_without_pressure_uses_the_sourced_pressure(self):
        rows = [
            {"psi_id": "PSI-25", "source_file": "x.csv", "source_row": 1, "fuel_class": "solid", "o2_frac": 0.222, "pressure_atm": None},
            {"psi_id": "PSI-7", "source_file": "y.csv", "source_row": 2, "fuel_class": "solid", "o2_frac": 0.22, "pressure_atm": None},
        ]
        sourced = {"PSI-25": {"pressure_atm": 0.9805, "source_url": "https://ntrs.nasa.gov/citations/20210011385"}}
        plan = test_plan.build_test_plan(rows, self.envs, zero_next(["a"], ("solid",)), sourced)
        near = plan["tests"][0]["nearest"]
        self.assertEqual(near["psi_id"], "PSI-25")
        self.assertEqual(near["pressure_atm"], 0.9805)
        self.assertTrue(near["pressure_sourced"])
        self.assertEqual(near["pressure_source_url"], "https://ntrs.nasa.gov/citations/20210011385")
        self.assertAlmostEqual(near["pressure_gap_psia"], abs(0.9805 - 0.55) * 14.6959, places=3)
        expected = (near["o2_gap_points"] ** 2 + near["pressure_gap_psia"] ** 2) ** 0.5
        self.assertAlmostEqual(near["distance"], expected, places=2)

    def test_recorded_pressure_is_never_replaced_by_a_sourced_one(self):
        rows = [{"psi_id": "PSI-25", "source_file": "x.csv", "source_row": 1, "fuel_class": "solid", "o2_frac": 0.33, "pressure_atm": 0.5}]
        sourced = {"PSI-25": {"pressure_atm": 0.9805, "source_url": "u"}}
        near = test_plan.build_test_plan(rows, self.envs, zero_next(["a"], ("solid",)), sourced)["tests"][0]["nearest"]
        self.assertEqual(near["pressure_atm"], 0.5)
        self.assertFalse(near["pressure_sourced"])

    def test_habitat_names_are_the_short_names(self):
        envs = {"environments": [env("lunar", (0.30, 0.35), (0.5, 0.6), None, 0.16, "Lunar surface habitat")]}
        plan = test_plan.build_test_plan([], envs, zero_next(["lunar"], ("solid",)))
        self.assertEqual(plan["tests"][0]["habitat_names"], ["Moon base"])
        self.assertEqual(plan["windows"]["lunar"]["name"], "Moon base")

    def test_gravity_note_names_the_limit(self):
        plan = test_plan.build_test_plan([], self.envs, zero_next(["a", "b", "c"], ("solid",)))
        by_habitats = {tuple(t["habitats"]): t for t in plan["tests"]}
        self.assertIn("cannot be reproduced on the ISS", by_habitats[("a", "b")]["gravity"]["note"])
        self.assertIn("reproduces this gravity", by_habitats[("c",)]["gravity"]["note"])

    def test_is_deterministic(self):
        rows = [row("PSI-1", 1, "gas", 0.25, 0.8), row("PSI-2", 2, "gas", 0.4, 0.6)]
        first = test_plan.build_test_plan(rows, self.envs, zero_next(["a", "b", "c"]))
        second = test_plan.build_test_plan(list(reversed(rows)), self.envs, zero_next(["a", "b", "c"]))
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))


class PlanRealDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_site_data.main()
        cls.plan = read_json(PLAN_PATH)
        cls.environments = read_json(os.path.join(SITE, "environments.json"))
        cls.env_by_id = {e["id"]: e for e in cls.environments["environments"]}
        cls.test_next = read_json(os.path.join(SITE, "test_next.json"))
        cls.conditions = read_json(os.path.join(ROOT, "data", "unified", "conditions.json"))
        cls.by_key = {(r["source_file"], r["source_row"]): r for r in cls.conditions}
        cls.solid_pressures = read_json(os.path.join(SITE, "outside_psi.json"))["solid_pressures"]

    def window(self, env_id, key):
        block = self.env_by_id[env_id][key]
        if block.get("not_specified") or block["window_min"] is None:
            return None
        return block["window_min"], block["window_max"]

    def test_file_is_ascii_and_rerun_is_byte_identical(self):
        before = read_bytes(PLAN_PATH)
        before.decode("ascii")
        build_site_data.main()
        self.assertEqual(before, read_bytes(PLAN_PATH))

    def test_gaps_are_the_zero_entries_of_test_next(self):
        expected = sorted(
            (e, c["fuel_class"]) for e, block in self.test_next["environments"].items()
            for c in block["classes"] if c["inside"] == 0)
        got = sorted((g["habitat"], g["fuel_class"]) for g in self.plan["gaps"])
        self.assertEqual(expected, got)

    def test_every_gap_is_closed_by_a_test_that_covers_it(self):
        tests = {t["id"]: t for t in self.plan["tests"]}
        self.assertEqual(self.plan["unplanned"], [])
        for gap in self.plan["gaps"]:
            test = tests[gap["test"]]
            self.assertEqual(test["fuel_class"], gap["fuel_class"])
            self.assertIn(gap["habitat"], test["habitats"])

    def test_headline_counts(self):
        head = self.plan["headline"]
        self.assertEqual(head["tests"], len(self.plan["tests"]))
        self.assertEqual(head["gaps"], len(self.plan["gaps"]))
        self.assertEqual(head["closed"], sum(1 for g in self.plan["gaps"] if g["test"]))
        self.assertEqual(head["text"], "%d tests would close %d of %d habitat gaps" % (head["tests"], head["closed"], head["gaps"]))
        self.assertEqual(sum(len(t["habitats"]) for t in self.plan["tests"]), head["closed"])

    def test_boxes_lie_inside_every_covered_habitat_window(self):
        for t in self.plan["tests"]:
            for env_id in t["habitats"]:
                o2 = self.window(env_id, "o2")
                p = self.window(env_id, "pressure_atm")
                flow = self.window(env_id, "flow_cm_s")
                self.assertTrue(o2[0] <= t["o2"]["min"] and t["o2"]["max"] <= o2[1], t["id"])
                self.assertTrue(p[0] <= t["pressure_atm"]["min"] and t["pressure_atm"]["max"] <= p[1], t["id"])
                if flow is not None:
                    self.assertTrue(flow[0] <= t["flow_cm_s"]["min"] and t["flow_cm_s"]["max"] <= flow[1], t["id"])

    def test_boxes_are_exact_intersections_of_environment_windows(self):
        for t in self.plan["tests"]:
            o2 = [self.window(e, "o2") for e in t["habitats"]]
            p = [self.window(e, "pressure_atm") for e in t["habitats"]]
            flows = [w for w in (self.window(e, "flow_cm_s") for e in t["habitats"]) if w]
            self.assertEqual(t["o2"], {"min": max(w[0] for w in o2), "max": min(w[1] for w in o2)})
            self.assertEqual(t["pressure_atm"], {"min": max(w[0] for w in p), "max": min(w[1] for w in p)})
            if flows:
                self.assertEqual(t["flow_cm_s"], {"min": max(w[0] for w in flows), "max": min(w[1] for w in flows)})
            else:
                self.assertIsNone(t["flow_cm_s"])
                self.assertEqual(t["flow_note"], "not specified by NASA sources")

    def test_nearest_rows_trace_to_conditions_and_are_not_inside_a_window(self):
        for t in self.plan["tests"]:
            near = t["nearest"]
            row_ = self.by_key[(near["source_file"], near["source_row"])]
            self.assertEqual(row_["psi_id"], near["psi_id"])
            self.assertEqual(row_["fuel_class"], t["fuel_class"])
            self.assertEqual(row_["o2_frac"], near["o2_frac"])
            if near["pressure_sourced"]:
                self.assertFalse(row_["pressure_atm"])
                self.assertEqual(near["pressure_atm"], self.solid_pressures[near["psi_id"]]["pressure_atm"])
            else:
                self.assertEqual(row_["pressure_atm"] if row_["pressure_atm"] else None, near["pressure_atm"])
            o2_gap = abs(row_["o2_frac"] - t["point"]["o2"]) * 100
            self.assertAlmostEqual(o2_gap, near["o2_gap_points"], places=3)

    def test_nearest_is_really_the_nearest(self):
        for t in self.plan["tests"]:
            rows = [r for r in self.conditions
                    if r["fuel_class"] == t["fuel_class"] and r["o2_basis"] == "ambient" and r["value_quality"] in ("exact", "approximate") and r["o2_frac"] is not None]
            rows = test_plan.with_sourced_pressure(rows, self.solid_pressures)
            with_p = [r for r in rows if r["pressure_atm"]]
            pool = with_p or rows
            best = min(test_plan.distance_to(t["point"], r)[0] for r in pool)
            self.assertAlmostEqual(best, t["nearest"]["distance"], places=2)

    def test_bass_ii_is_the_solid_nearest_at_its_report_pressure(self):
        solids = [t for t in self.plan["tests"] if t["fuel_class"] == "solid"]
        self.assertTrue(solids)
        for t in solids:
            near = t["nearest"]
            self.assertEqual(near["investigation"], "BASS-II")
            self.assertTrue(near["pressure_sourced"])
            self.assertEqual(round(near["pressure_atm"] * test_plan.PSIA_PER_ATM, 1), 14.4)
            self.assertIsNotNone(near["pressure_gap_psia"])
            self.assertGreater(near["distance"], near["o2_gap_points"])

    def test_habitat_names_match_the_app_short_names(self):
        with open(os.path.join(ROOT, "public", "app.js"), "r", encoding="utf-8") as handle:
            source = handle.read()
        block = re.search(r"const HABITAT_SHORT = \{(.*?)\};", source, re.S).group(1)
        app = dict(re.findall(r'(\w+): "([^"]+)"', block))
        self.assertEqual(app, test_plan.HABITAT_SHORT)
        for t in self.plan["tests"]:
            self.assertEqual(t["habitat_names"], [app[e] for e in t["habitats"]])
        for env_id, w in self.plan["windows"].items():
            self.assertEqual(w["name"], app[env_id])

    def test_greedy_matches_the_exhaustive_minimum_per_fuel_class(self):
        windows = {}
        for env_id in self.test_next["environments"]:
            windows[env_id] = test_plan.env_windows(self.env_by_id[env_id])
        for fc in ("solid", "liquid_droplet", "gas"):
            gap_envs = sorted(g["habitat"] for g in self.plan["gaps"] if g["fuel_class"] == fc)
            cands = test_plan.class_candidates(gap_envs, windows)
            best = None
            for size in range(1, len(gap_envs) + 1):
                for combo in itertools.combinations(cands, size):
                    if set().union(*[c["covers"] for c in combo]) >= set(gap_envs):
                        best = size
                        break
                if best:
                    break
            used = len([t for t in self.plan["tests"] if t["fuel_class"] == fc])
            self.assertEqual(used, best, fc)

    def test_free_fall_habitats_never_share_a_gravity_claim_with_moon_or_mars(self):
        for t in self.plan["tests"]:
            g = t["gravity"]
            for env_id in g["micro"]:
                self.assertTrue(self.env_by_id[env_id]["gravity"]["g"] < 0.05)
            for env_id in g["partial"]:
                self.assertTrue(self.env_by_id[env_id]["gravity"]["g"] >= 0.05)
            if g["partial"]:
                self.assertIn("cannot be reproduced on the ISS", g["note"])

    def test_source_refs_come_from_environment_sources(self):
        for t in self.plan["tests"]:
            allowed = set()
            for env_id in t["habitats"]:
                for key in ("o2", "pressure_atm", "flow_cm_s"):
                    for src in self.env_by_id[env_id][key].get("sources", []):
                        allowed.add(src.get("ref"))
            for ref in t["source_refs"]:
                self.assertIn(ref, allowed)
            self.assertTrue(t["source_refs"])


if __name__ == "__main__":
    unittest.main()
