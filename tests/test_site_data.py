import json
import os
import sys
import unittest
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import build_site_data
import scoring

UNIFIED = os.path.join(ROOT, "data", "unified")
SITE = os.path.join(ROOT, "public", "data")
CORPUS = os.path.join(ROOT, "api", "context", "corpus.json")
COUNTABLE = ("exact", "approximate")


def read_json(path):
    with open(path, "r", encoding="ascii") as handle:
        return json.load(handle)


def window(env, key):
    return env[key]["window_min"], env[key]["window_max"]


class SiteDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_site_data.main()
        cls.conditions = read_json(os.path.join(UNIFIED, "conditions.json"))
        cls.summary = read_json(os.path.join(UNIFIED, "summary.json"))
        cls.investigations = read_json(os.path.join(SITE, "investigations.json"))["investigations"]
        cls.site_conditions = read_json(os.path.join(SITE, "conditions.json"))
        cls.environments = read_json(os.path.join(SITE, "environments.json"))
        cls.insights = {i["id"]: i for i in read_json(os.path.join(SITE, "insights.json"))["insights"]}
        cls.reference = read_json(os.path.join(SITE, "rank_reference.json"))
        cls.corpus = read_json(CORPUS)["documents"]

    def test_site_files_exist_and_are_ascii(self):
        for name in ("investigations", "conditions", "environments", "insights", "earth", "rank_reference"):
            path = os.path.join(SITE, name + ".json")
            self.assertTrue(os.path.exists(path), name)
            with open(path, "rb") as handle:
                handle.read().decode("ascii")
        with open(CORPUS, "rb") as handle:
            handle.read().decode("ascii")

    def test_build_is_deterministic(self):
        paths = [os.path.join(SITE, n + ".json") for n in ("investigations", "conditions", "environments", "insights", "rank_reference")]
        paths.append(CORPUS)
        before = []
        for path in paths:
            with open(path, "rb") as handle:
                before.append(handle.read())
        build_site_data.main()
        for path, old in zip(paths, before):
            with open(path, "rb") as handle:
                self.assertEqual(handle.read(), old, path)

    def test_conditions_slim_keeps_every_row_and_provenance(self):
        self.assertEqual(len(self.site_conditions), len(self.conditions))
        for raw, slim in zip(self.conditions, self.site_conditions):
            self.assertEqual(raw["row_id"], slim["row_id"])
            self.assertEqual(raw["psi_id"], slim["psi_id"])
            self.assertEqual(raw["source_file"], slim["source_file"])
            self.assertEqual(raw["source_row"], slim["source_row"])

    def test_every_condition_investigation_in_investigations(self):
        ids = {inv["psi_id"] for inv in self.investigations}
        for psi_id in {row["psi_id"] for row in self.conditions}:
            self.assertIn(psi_id, ids)
        counts = Counter(row["psi_id"] for row in self.conditions)
        for inv in self.investigations:
            self.assertEqual(inv["row_count"], counts.get(inv["psi_id"], 0))

    def test_environments_have_sources_or_assumption_flags(self):
        envs = self.environments["environments"]
        self.assertEqual([e["id"] for e in envs], ["iss", "gateway", "lunar", "rover", "mars"])
        refs = self.environments["sources"]
        for env in envs:
            for key in ("o2", "pressure_atm", "flow_cm_s", "gravity"):
                block = env[key]
                self.assertTrue(block["assumption"] or block["sources"], (env["id"], key))
                for source in block["sources"]:
                    self.assertIn(source["ref"], refs)
            for key in ("o2", "pressure_atm", "flow_cm_s"):
                self.assertLessEqual(env[key]["min"], env[key]["max"])
                self.assertLessEqual(env[key]["window_min"], env[key]["min"])
                self.assertGreaterEqual(env[key]["window_max"], env[key]["max"])
            self.assertIn("bracket_note", env["gravity"])
        lunar = next(e for e in envs if e["id"] == "lunar")
        self.assertFalse(lunar["o2"]["assumption"])
        self.assertFalse(lunar["pressure_atm"]["assumption"])
        self.assertAlmostEqual(lunar["pressure_atm"]["min"], 0.558, places=3)
        mars = next(e for e in envs if e["id"] == "mars")
        self.assertTrue(mars["o2"]["assumption"])

    def test_overlap_function(self):
        self.assertEqual(scoring.overlap(0.28, 0.34, 0.1, 0.5), 1.0)
        self.assertEqual(scoring.overlap(0.28, 0.34, 0.1, 0.2), 0.0)
        self.assertAlmostEqual(scoring.overlap(0.28, 0.34, 0.1, 0.31), 0.5)
        self.assertEqual(scoring.overlap(0.265, 0.265, 0.2, 0.3), 1.0)
        self.assertEqual(scoring.overlap(0.265, 0.265, 0.27, 0.3), 0.0)
        self.assertEqual(scoring.overlap(0.28, 0.34, None, None), 0.0)

    def test_default_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(scoring.DEFAULT_WEIGHTS.values()), 1.0)
        self.assertEqual(set(scoring.DEFAULT_WEIGHTS), set(scoring.COMPONENTS))

    def test_ranking_components_within_unit_interval(self):
        for variant, per_env in self.reference["variants"].items():
            for env_id, block in per_env.items():
                ranking = block["ranking"]
                self.assertEqual([i["rank"] for i in ranking], list(range(1, len(ranking) + 1)))
                for item in ranking:
                    self.assertGreaterEqual(item["score"], 0.0)
                    self.assertLessEqual(item["score"], 1.0)
                    for name in scoring.COMPONENTS:
                        value = item["components"][name]
                        if name == "fuel" and value is None:
                            continue
                        self.assertIsNotNone(value, (variant, env_id, item["psi_id"], name))
                        self.assertGreaterEqual(value, 0.0)
                        self.assertLessEqual(value, 1.0)
                    stab = block["stability"][item["psi_id"]]
                    self.assertLessEqual(stab["min"], item["rank"])
                    self.assertGreaterEqual(stab["max"], item["rank"])

    def test_rank_reference_matches_fresh_scoring(self):
        for env in self.environments["environments"]:
            fresh = scoring.rank_all(self.investigations, env, scoring.DEFAULT_WEIGHTS, False)
            stored = self.reference["variants"]["default"][env["id"]]["ranking"]
            self.assertEqual([i["psi_id"] for i in fresh], [i["psi_id"] for i in stored])
            for a, b in zip(fresh, stored):
                self.assertAlmostEqual(a["score"], b["score"], places=9)

    def test_only_investigations_with_rows_are_ranked(self):
        ranked = {i["psi_id"] for i in self.reference["variants"]["default"]["lunar"]["ranking"]}
        with_rows = {inv["psi_id"] for inv in self.investigations if inv["row_count"] > 0}
        self.assertEqual(ranked, with_rows)

    def test_function_and_fuel_components(self):
        self.assertEqual(scoring.function_relevance(["prevention"]), (1.0, "core"))
        self.assertEqual(scoring.function_relevance(["fundamental"]), (0.5, "fundamental"))
        self.assertEqual(scoring.function_relevance([]), (0.5, "unassigned"))
        self.assertEqual(scoring.fuel_realism("solid"), 1.0)
        self.assertEqual(scoring.fuel_realism("liquid_droplet"), 0.5)
        self.assertEqual(scoring.fuel_realism("gas"), 0.3)
        self.assertIsNone(scoring.fuel_realism("smoke_sample"))
        self.assertIsNone(scoring.fuel_realism("aerosol_dust"))

    def test_weighted_score_skips_not_applicable_components(self):
        comps = {"o2": 1.0, "pressure": 0.0, "flow": 0.0, "fuel": None, "function": 1.0, "richness": 0.0}
        weights = {"o2": 1.0, "pressure": 1.0, "flow": 1.0, "fuel": 1.0, "function": 1.0, "richness": 1.0}
        self.assertAlmostEqual(scoring.weighted_score(comps, weights), 2.0 / 5.0)

    def test_varied_held_semantics(self):
        rows = [
            {"fuel": "A", "sample_geometry": None, "o2_frac": 0.21, "o2_basis": "ambient", "pressure_atm": 1.0001, "diluent": "N2"},
            {"fuel": "B", "sample_geometry": None, "o2_frac": 0.21, "o2_basis": "ambient", "pressure_atm": 1.0004, "diluent": "N2"},
        ]
        result = build_site_data.varied_held(rows)
        self.assertEqual(result["fuel"]["status"], "varied")
        self.assertEqual(result["sample_geometry"]["status"], "not recorded")
        self.assertEqual(result["o2_frac"]["status"], "held constant")
        self.assertEqual(result["pressure_atm"]["status"], "held constant")
        self.assertEqual(result["diluent"]["status"], "held constant")

    def test_insight_max_o2_matches_recount(self):
        numbers = self.insights["max_o2_by_fuel_class"]["numbers"]["max_by_fuel_class"]
        for fc, block in numbers.items():
            values = [r["o2_frac"] for r in self.conditions
                      if r["fuel_class"] == fc and r["o2_basis"] == "ambient" and r["o2_frac"] is not None
                      and r["value_quality"] in COUNTABLE]
            self.assertEqual(block["max_o2"], max(values))
            self.assertEqual(block["rows_with_o2"], len(values))
        self.assertEqual(numbers["solid"]["max_o2"], 0.222)
        solid_all = [r["o2_frac"] for r in self.conditions if r["fuel_class"] == "solid" and r["o2_frac"] is not None]
        self.assertEqual(max(solid_all), 0.222)
        self.assertEqual(self.summary["o2_by_fuel_class"]["solid"]["o2_max"], 0.222)

    def test_insight_window_counts_match_recount(self):
        windows = self.insights["rows_per_environment_window"]["numbers"]["windows"]
        for env in self.environments["environments"]:
            o2lo, o2hi = window(env, "o2")
            plo, phi = window(env, "pressure_atm")
            o2_rows = [r for r in self.conditions
                       if r["value_quality"] in COUNTABLE and r["o2_basis"] == "ambient"
                       and r["o2_frac"] is not None and o2lo <= r["o2_frac"] <= o2hi]
            both = [r for r in o2_rows if r["pressure_atm"] is not None and r["pressure_atm"] > 0
                    and plo <= r["pressure_atm"] <= phi]
            self.assertEqual(windows[env["id"]]["o2_window_rows"], len(o2_rows), env["id"])
            self.assertEqual(windows[env["id"]]["o2_and_pressure_window_rows"], len(both), env["id"])

    def test_insight_gaps_and_outcome_counts_match_recount(self):
        gaps = self.insights["coverage_gaps"]["numbers"]
        all_three = [r for r in self.conditions if r["value_quality"] in COUNTABLE and r["o2_frac"] is not None
                     and r["pressure_atm"] is not None and r["pressure_atm"] > 0 and r["flow_cm_s"] is not None]
        self.assertEqual(gaps["rows_o2_pressure_flow_all_recorded"], len(all_three))
        for env in self.environments["environments"]:
            o2lo, o2hi = window(env, "o2")
            plo, phi = window(env, "pressure_atm")
            for fc in ("solid", "liquid_droplet", "gas"):
                count = sum(1 for r in self.conditions
                            if r["value_quality"] in COUNTABLE and r["o2_basis"] == "ambient" and r["fuel_class"] == fc
                            and r["o2_frac"] is not None and o2lo <= r["o2_frac"] <= o2hi
                            and r["pressure_atm"] is not None and plo <= r["pressure_atm"] <= phi)
                listed = fc in gaps["gaps"][env["id"]]["fuel_classes_zero_o2_pressure_window"]
                self.assertEqual(count == 0, listed, (env["id"], fc))
        both = self.insights["o2_with_outcome"]["numbers"]
        recount = [r for r in self.conditions if r["o2_frac"] is not None and r["outcome"] is not None]
        self.assertEqual(both["rows"], len(recount))
        self.assertEqual(both["rows"], self.summary["rows_with_o2_and_outcome"])
        self.assertEqual(both["investigations"], len({r["psi_id"] for r in recount}))
        self.assertEqual(sum(both["by_investigation"].values()), len(recount))

    def test_insight_text_contains_its_numbers(self):
        text = self.insights["max_o2_by_fuel_class"]["text"]
        self.assertIn("0.222", text)
        text = self.insights["o2_with_outcome"]["text"]
        self.assertIn(str(self.insights["o2_with_outcome"]["numbers"]["rows"]), text)
        for insight in self.insights.values():
            self.assertTrue(insight["limits"])
            self.assertTrue(insight["links"])

    def test_corpus_has_one_document_per_investigation(self):
        self.assertEqual(len(self.corpus), len(self.investigations))
        ids = [d["psi_id"] for d in self.corpus]
        self.assertEqual(ids, [inv["psi_id"] for inv in self.investigations])
        self.assertEqual(len(set(ids)), len(ids))
        for doc in self.corpus:
            self.assertTrue(doc["title"].startswith(doc["psi_id"] + " "))
            self.assertIn(" - ", doc["title"])
            self.assertGreater(len(doc["body"]), 100)
        with_rows = [d for d in self.corpus if "no rows in the unified" not in d["body"]]
        self.assertTrue(with_rows)
        self.assertIn("Ambient O2 tested", with_rows[0]["body"])

    def test_every_investigation_card_field_present(self):
        required = ["psi_id", "acronym", "title", "objectives", "hardware", "fuel_class", "ranges", "varied",
                    "outcomes", "publications", "psi_url", "row_count", "functions", "fire_safety_function_basis"]
        for inv in self.investigations:
            for key in required:
                self.assertIn(key, inv)
            self.assertTrue(inv["psi_url"].startswith("https://"))

    def test_builds_without_metadata_file(self):
        original = build_site_data.META_PATH
        build_site_data.META_PATH = os.path.join(ROOT, "data", "investigations", "does_not_exist.json")
        try:
            result = build_site_data.build()
        finally:
            build_site_data.META_PATH = original
        self.assertFalse(result["meta_present"])
        unified = read_json(os.path.join(UNIFIED, "investigations.json"))
        self.assertEqual({i["psi_id"] for i in result["investigations"]}, set(unified))
        self.assertEqual(len(result["corpus"]["documents"]), len(unified))
        for inv in result["investigations"]:
            self.assertEqual(inv["functions"], [])
            self.assertFalse(inv["meta_present"])


if __name__ == "__main__":
    unittest.main()
