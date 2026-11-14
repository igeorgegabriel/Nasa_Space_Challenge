import json
import os
import re
import sys
import tempfile
import unittest
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import build_site_data
import outside_psi
import partial_g_site
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
        cls.env_by_id = {e["id"]: e for e in cls.environments["environments"]}
        cls.test_next = read_json(os.path.join(SITE, "test_next.json"))
        cls.verification = read_json(os.path.join(SITE, "verification.json"))
        cls.outside = read_json(os.path.join(SITE, "outside_psi.json"))
        cls.saffire = read_json(os.path.join(ROOT, "data", "outside_psi", "saffire_iv_vi.json"))["tests"]
        cls.pressure_sources = read_json(os.path.join(ROOT, "data", "outside_psi", "solid_pressure_sources.json"))["records"]

    def test_site_files_exist_and_are_ascii(self):
        for name in ("investigations", "conditions", "environments", "insights", "earth", "rank_reference", "model_readiness"):
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

    def test_environments_have_sources_or_are_not_specified(self):
        envs = self.environments["environments"]
        self.assertEqual([e["id"] for e in envs], ["iss", "gateway", "lunar", "rover", "mars"])
        refs = self.environments["sources"]
        for env in envs:
            for key in ("o2", "pressure_atm", "flow_cm_s", "gravity"):
                block = env[key]
                self.assertNotIn("assumption", block)
                self.assertTrue(block["not_specified"] or block["sources"], (env["id"], key))
                for source in block["sources"]:
                    self.assertIn(source["ref"], refs)
            for key in ("o2", "pressure_atm", "flow_cm_s"):
                block = env[key]
                if block["not_specified"]:
                    self.assertIsNone(block["min"])
                    self.assertIsNone(block["max"])
                    self.assertIsNone(block["window_min"])
                    self.assertEqual(block["display"], "not specified by NASA sources")
                    self.assertNotIn("laceholder", block["note"])
                    continue
                self.assertLessEqual(block["min"], block["max"])
                self.assertLessEqual(block["window_min"], block["min"])
                self.assertGreaterEqual(block["window_max"], block["max"])
            self.assertIn("bracket_note", env["gravity"])

    def test_builtin_environment_values_without_profile_file(self):
        envs = build_site_data.build_environments(profile_path=None)["environments"]
        self.assertEqual([e["id"] for e in envs], ["iss", "gateway", "lunar", "rover", "mars"])
        lunar = next(e for e in envs if e["id"] == "lunar")
        self.assertFalse(lunar["o2"]["not_specified"])
        self.assertFalse(lunar["pressure_atm"]["not_specified"])
        self.assertAlmostEqual(lunar["pressure_atm"]["min"], 0.558, places=3)
        mars = next(e for e in envs if e["id"] == "mars")
        self.assertTrue(mars["o2"]["not_specified"])
        self.assertIsNone(mars["o2"]["min"])

    def test_profile_file_overrides_builtin_and_maps_ids(self):
        profile = {
            "sources": {"probe": {"label": "Probe source", "url": "https://example.org/probe"}},
            "environments": [
                {
                    "id": "lunar_habitat",
                    "name": "Lunar habitat (profile)",
                    "o2": {"min": 0.3, "max": 0.32, "sources": [{"ref": "probe", "detail": "d"}], "assumption": False, "note": "n"},
                    "pressure_atm": {"min": 0.6, "max": 0.6, "sources": [{"ref": "probe", "detail": "d"}]},
                    "flow_cm_s": {"min": None, "max": None, "not_specified": True, "note": "Searched X. Placeholder borrowed from Y."},
                    "gravity": {"g": 0.16},
                },
                {"id": "unknown_env", "o2": {"min": 0.1, "max": 0.2}},
            ],
        }
        path = os.path.join(tempfile.mkdtemp(), "profiles.json")
        with open(path, "w", encoding="ascii") as handle:
            json.dump(profile, handle)
        result = build_site_data.build_environments(profile_path=path)
        envs = {e["id"]: e for e in result["environments"]}
        self.assertEqual(list(envs), ["iss", "gateway", "lunar", "rover", "mars"])
        lunar = envs["lunar"]
        self.assertEqual(lunar["name"], "Lunar habitat (profile)")
        self.assertEqual((lunar["o2"]["min"], lunar["o2"]["max"]), (0.3, 0.32))
        self.assertIn("probe", result["sources"])
        self.assertTrue(lunar["pressure_atm"]["point_value"])
        self.assertLess(lunar["pressure_atm"]["window_min"], 0.6)
        self.assertTrue(lunar["flow_cm_s"]["not_specified"])
        self.assertIsNone(lunar["flow_cm_s"]["min"])
        self.assertIsNone(lunar["flow_cm_s"]["window_min"])
        self.assertNotIn("laceholder", lunar["flow_cm_s"]["note"])
        self.assertTrue(envs["mars"]["o2"]["not_specified"])
        self.assertIsNone(envs["mars"]["o2"]["min"])
        self.assertIsNone(build_site_data.load_profile_file(os.path.join(tempfile.gettempdir(), "no_such_profile.json")))

    def test_coverage_formula(self):
        block = {"min": 20.0, "max": 20.0, "values": [20.0], "spans": []}
        self.assertAlmostEqual(scoring.coverage(10.0, 20.0, block), 0.5)
        self.assertAlmostEqual(scoring.coverage(10.0, 15.0, block), 0.0)
        full = {"min": 5.0, "max": 30.0, "values": [5.0, 30.0], "spans": []}
        self.assertAlmostEqual(scoring.coverage(10.0, 20.0, full), 0.5)
        inside = {"min": 5.0, "max": 30.0, "values": [5.0, 12.0, 30.0], "spans": []}
        self.assertAlmostEqual(scoring.coverage(10.0, 20.0, inside), 1.0)
        half = {"min": 10.0, "max": 15.0, "values": [10.0, 15.0], "spans": []}
        self.assertAlmostEqual(scoring.coverage(10.0, 20.0, half), 0.5 * 0.5 + 0.5)
        span_only = {"min": 0.1, "max": 0.5, "values": [], "spans": [[0.1, 0.5]]}
        self.assertAlmostEqual(scoring.coverage(0.28, 0.34, span_only), 1.0)
        self.assertEqual(scoring.coverage(10.0, 20.0, None), 0.0)
        far = {"min": 1.0, "max": 3.0, "values": [1.0, 3.0], "spans": []}
        self.assertEqual(scoring.coverage(10.0, 20.0, far), 0.0)

    def test_saffire_single_value_in_window_gets_credit(self):
        saffire = next(i for i in self.investigations if i["psi_id"] == "PSI-99")
        env = next(e for e in self.environments["environments"] if e["id"] == "lunar")
        comps = scoring.components(saffire, env)
        self.assertEqual(saffire["ranges"]["flow_cm_s"]["values"], [20.0])
        self.assertAlmostEqual(comps["flow"], 0.5)

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
        self.assertEqual(scoring.DEFAULT_WEIGHTS, {
            "fuel": 0.25, "function": 0.25, "richness": 0.10, "o2": 0.20, "pressure": 0.10, "flow": 0.10})

    def test_topic_and_condition_subscores(self):
        for env in self.environments["environments"]:
            ranking = self.reference["variants"]["default"][env["id"]]["ranking"]
            for item in ranking:
                for key in ("topic", "condition", "score"):
                    self.assertGreaterEqual(item[key], 0.0)
                    self.assertLessEqual(item[key], 1.0)
                c = item["components"]
                topic = scoring.weighted_average(c, scoring.DEFAULT_WEIGHTS, scoring.TOPIC_COMPONENTS)
                cond = scoring.weighted_average(c, scoring.DEFAULT_WEIGHTS, scoring.CONDITION_COMPONENTS)
                self.assertAlmostEqual(item["topic"], topic, places=9)
                self.assertAlmostEqual(item["condition"], cond, places=9)
        comps = {"fuel": None, "function": 1.0, "richness": 0.5, "o2": 1.0, "pressure": 0.0, "flow": 0.0}
        self.assertAlmostEqual(scoring.weighted_average(comps, scoring.DEFAULT_WEIGHTS, scoring.TOPIC_COMPONENTS), (0.25 * 1.0 + 0.10 * 0.5) / 0.35)

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
                        if value is None and name in ("o2", "pressure", "flow"):
                            key = {"o2": "o2", "pressure": "pressure_atm", "flow": "flow_cm_s"}[name]
                            self.assertTrue(self.env_by_id[env_id][key]["not_specified"])
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
        self.assertEqual(scoring.function_relevance([{"function": "detection"}, {"function": "fundamental"}]), (1.0, "core"))
        self.assertEqual(scoring.function_relevance([{"function": "fundamental"}]), (0.4, "fundamental"))
        self.assertEqual(scoring.function_relevance([]), (0.2, "unassigned"))
        kw = "keyword match on PSI text"
        self.assertEqual(scoring.function_relevance([{"function": "prevention", "source": kw, "score": 3}]), (1.0, "core"))
        self.assertEqual(scoring.function_relevance([{"function": "prevention", "source": kw, "score": 2}]), (0.4, "weak"))
        self.assertEqual(scoring.function_relevance([{"function": "prevention", "source": "challenge statement", "score": None}]), (1.0, "core"))
        self.assertEqual(scoring.function_relevance([
            {"function": "suppression", "source": kw, "score": 1}, {"function": "fundamental", "source": kw, "score": 9}]), (0.4, "weak"))
        self.assertEqual(scoring.fuel_realism("solid"), 1.0)
        self.assertEqual(scoring.fuel_realism("liquid_droplet"), 0.5)
        self.assertEqual(scoring.fuel_realism("gas"), 0.3)
        self.assertIsNone(scoring.fuel_realism("smoke_sample"))
        self.assertIsNone(scoring.fuel_realism("aerosol_dust"))

    def test_not_specified_condition_is_excluded_and_weights_renormalize(self):
        rover = self.env_by_id["rover"]
        lunar = self.env_by_id["lunar"]
        inv = next(i for i in self.investigations if i["psi_id"] == "PSI-99")
        comps = scoring.components(inv, rover)
        self.assertIsNone(comps["flow"])
        self.assertIsNotNone(comps["o2"])
        self.assertIsNotNone(scoring.components(inv, lunar)["flow"])
        weights = scoring.DEFAULT_WEIGHTS
        total = 0.0
        used = 0.0
        for name in scoring.COMPONENTS:
            if comps[name] is None:
                continue
            total += weights[name] * comps[name]
            used += weights[name]
        self.assertAlmostEqual(scoring.weighted_score(comps, weights), total / used, places=8)
        self.assertLess(used, 1.0)

    def test_no_fallback_for_null_profile_values(self):
        for env_id in ("gateway", "rover", "mars"):
            block = self.env_by_id[env_id]["flow_cm_s"]
            self.assertTrue(block["not_specified"])
            self.assertIsNone(block["min"])

    def test_test_next_counts_match_recount(self):
        for env in self.environments["environments"]:
            block = self.test_next["environments"][env["id"]]
            o2lo, o2hi = window(env, "o2")
            plo, phi = window(env, "pressure_atm")
            flow = None if env["flow_cm_s"]["not_specified"] else window(env, "flow_cm_s")
            zero = 0
            for entry in block["classes"]:
                inside = [
                    r for r in self.conditions
                    if r["fuel_class"] == entry["fuel_class"] and r["value_quality"] in COUNTABLE and r["o2_basis"] == "ambient"
                    and r["o2_frac"] is not None and o2lo <= r["o2_frac"] <= o2hi
                    and r["pressure_atm"] is not None and r["pressure_atm"] > 0 and plo <= r["pressure_atm"] <= phi
                    and (flow is None or (r["flow_cm_s"] is not None and flow[0] <= r["flow_cm_s"] <= flow[1]))
                ]
                self.assertEqual(entry["inside"], len(inside), (env["id"], entry["fuel_class"]))
                zero += 1 if not inside else 0
                near = entry["nearest"]
                if near:
                    row = next(r for r in self.conditions if r["psi_id"] == near["psi_id"] and r["source_row"] == near["source_row"]
                               and r["source_file"] == near["source_file"])
                    self.assertEqual(row["o2_frac"], near["o2_frac"])
            self.assertEqual(block["zero_count"], zero)
            order = [e["fuel_class"] for e in block["classes"]]
            zeros = [e["fuel_class"] for e in block["classes"] if e["inside"] == 0]
            self.assertEqual(order[:len(zeros)], zeros)
            self.assertEqual(zeros, [c for c in ("solid", "liquid_droplet", "gas") if c in zeros])
        lunar = self.test_next["environments"]["lunar"]
        solid = next(e for e in lunar["classes"] if e["fuel_class"] == "solid")
        self.assertEqual(solid["inside"], 0)
        self.assertEqual(solid["nearest"]["o2_frac"], 0.222)

    def test_verification_json_present_when_sources_exist(self):
        have_audit = os.path.exists(build_site_data.AUDIT_PATH)
        have_quotes = os.path.exists(build_site_data.FINDINGS_VERIFICATION_PATH)
        self.assertEqual(self.verification["present"], have_audit or have_quotes)
        if have_audit:
            audit = read_json(build_site_data.AUDIT_PATH)
            self.assertEqual(self.verification["audit"]["checked"], audit["totals_excluding_union_line"]["checked"])
            self.assertEqual(self.verification["audit"]["passed"], audit["totals_excluding_union_line"]["passed"])
            self.assertEqual(len(self.verification["audit"]["checks"]), len(audit["checks"]))

    def test_verification_absent_degrades(self):
        saved = (build_site_data.AUDIT_PATH, build_site_data.FINDINGS_VERIFICATION_PATH, build_site_data.FINDINGS_PATH, build_site_data.IMAGES_PATH,
                 outside_psi.VERIFICATION_PATH, build_site_data.EVAL_SUMMARY_PATH)
        missing = os.path.join(tempfile.gettempdir(), "no_such_file.json")
        build_site_data.AUDIT_PATH = build_site_data.FINDINGS_VERIFICATION_PATH = build_site_data.FINDINGS_PATH = build_site_data.IMAGES_PATH = missing
        outside_psi.VERIFICATION_PATH = build_site_data.EVAL_SUMMARY_PATH = missing
        try:
            result = build_site_data.build()
        finally:
            (build_site_data.AUDIT_PATH, build_site_data.FINDINGS_VERIFICATION_PATH,
             build_site_data.FINDINGS_PATH, build_site_data.IMAGES_PATH,
             outside_psi.VERIFICATION_PATH, build_site_data.EVAL_SUMMARY_PATH) = saved
        self.assertFalse(result["verification"]["present"])
        for inv in result["investigations"]:
            self.assertEqual(inv["images"], [])
            self.assertEqual(inv["key_findings"], [])

    def test_findings_loader_keeps_verified_quotes_only(self):
        tmp = tempfile.mkdtemp()
        kf = os.path.join(tmp, "key_findings.json")
        vf = os.path.join(tmp, "verification.json")
        with open(kf, "w", encoding="ascii") as handle:
            json.dump({"findings": [
                {"psi_id": "PSI-25", "quote": "Good quote.", "source": "NTRS 1", "url": "https://ntrs.nasa.gov/citations/1"},
                {"psi_id": "PSI-25", "quote": "Bad quote.", "source": "NTRS 2"}]}, handle)
        with open(vf, "w", encoding="ascii") as handle:
            json.dump({"quotes": [
                {"psi_id": "PSI-25", "quote": "Good quote.", "verified": True},
                {"psi_id": "PSI-25", "quote": "Bad quote.", "verified": False}]}, handle)
        saved = (build_site_data.FINDINGS_PATH, build_site_data.FINDINGS_VERIFICATION_PATH)
        build_site_data.FINDINGS_PATH, build_site_data.FINDINGS_VERIFICATION_PATH = kf, vf
        try:
            summary, items = build_site_data.load_verification_items()
            findings = build_site_data.load_findings(items)
            verification = build_site_data.build_verification(summary, items)
        finally:
            build_site_data.FINDINGS_PATH, build_site_data.FINDINGS_VERIFICATION_PATH = saved
        self.assertEqual([f["quote"] for f in findings["PSI-25"]], ["Good quote."])
        self.assertEqual(verification["quotes"]["checked"], 2)
        self.assertEqual(verification["quotes"]["verified"], 1)

    def test_images_are_published_with_captions(self):
        if not os.path.exists(build_site_data.IMAGES_PATH):
            self.skipTest("no images")
        inv = next(i for i in self.investigations if i["psi_id"] == "PSI-25")
        self.assertTrue(inv["images"])
        for img in inv["images"]:
            self.assertTrue(os.path.exists(os.path.join(ROOT, "public", *img["file"].split("/"))))
            self.assertTrue(img["caption"].startswith("NASA / PSI PSI-25: "))

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
            self.assertTrue(insight["links"] or insight.get("sources"))

    def test_corpus_has_one_document_per_investigation(self):
        self.assertEqual(len(self.corpus), len(self.investigations) + 5)
        ids = [d["psi_id"] for d in self.corpus]
        self.assertEqual(ids, [inv["psi_id"] for inv in self.investigations] + [build_site_data.LUNAR_G_CORPUS_ID, partial_g_site.CORPUS_ID, outside_psi.CORPUS_ID, "DASHBOARD-RESULTS", build_site_data.EARTH_CORPUS_ID])
        self.assertEqual(len(set(ids)), len(ids))
        for doc in self.corpus[:-5]:
            self.assertTrue(doc["title"].startswith(doc["psi_id"] + " "))
            self.assertIn(" - ", doc["title"])
            self.assertGreater(len(doc["body"]), 100)
        with_rows = [d for d in self.corpus if "no rows in the unified" not in d["body"]]
        self.assertTrue(with_rows)
        self.assertIn("Ambient O2 tested", with_rows[0]["body"])

    def test_challenge_notes_quotes_are_verbatim(self):
        notes = read_json(os.path.join(ROOT, "data", "challenge_notes.json"))
        with open(os.path.join(ROOT, "docs", "challenge_statement.md"), "r", encoding="ascii") as handle:
            statement = handle.read()
        quotes = [f["quote"] for f in notes["hardware_families"] if f["quote"]] + [n["quote"] for n in notes["notes"]]
        self.assertTrue(quotes)
        for quote in quotes:
            self.assertIn(quote, statement)

    def test_challenge_notes_psi_ids_exist_and_families_are_disjoint(self):
        notes = read_json(os.path.join(ROOT, "data", "challenge_notes.json"))
        known = {inv["psi_id"] for inv in self.investigations}
        seen = Counter()
        for family in notes["hardware_families"]:
            for psi_id in family["psi_ids"]:
                self.assertIn(psi_id, known)
                seen[psi_id] += 1
        for note in notes["notes"]:
            for psi_id in note["psi_ids"]:
                self.assertIn(psi_id, known)
        self.assertTrue(all(count == 1 for count in seen.values()))

    def test_acme_family_has_six_investigations(self):
        members = [i for i in self.investigations if i["hardware_family"] and i["hardware_family"]["id"] == "acme_cir"]
        self.assertEqual(len(members), 6)

    def test_investigations_carry_hardware_family_and_notes(self):
        by_id = {i["psi_id"]: i for i in self.investigations}
        e_field = by_id["PSI-22"]
        self.assertEqual(e_field["hardware_family"]["id"], "acme_cir")
        self.assertTrue(any(n.startswith("Partial gravity was mimicked") for n in e_field["challenge_notes"]))
        for inv in self.investigations:
            self.assertIn("hardware_family", inv)
            self.assertIsInstance(inv["challenge_notes"], list)

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
        self.assertEqual(len(result["corpus"]["documents"]), len(unified) + 5)
        for inv in result["investigations"]:
            self.assertFalse(inv["meta_present"])
            for entry in inv["functions"]:
                self.assertEqual(entry["source"], "challenge statement")
            if inv["psi_id"] not in build_site_data.CHALLENGE_FUNCTIONS:
                self.assertEqual(inv["functions"], [])
                self.assertEqual(inv["primary_function"], "unassigned")

    def function_map(self, psi_id):
        inv = next(i for i in self.investigations if i["psi_id"] == psi_id)
        return {f["function"]: f for f in inv["functions"]}, inv

    def test_function_lists_carry_challenge_statement_overrides(self):
        expected = {
            "PSI-26": "prevention", "PSI-25": "prevention", "PSI-98": "prevention", "PSI-99": "prevention",
            "PSI-100": "prevention", "PSI-102": "detection", "PSI-101": "detection", "PSI-69": "suppression",
            "PSI-20": "prevention", "PSI-47": "detection",
        }
        with open(os.path.join(ROOT, "docs", "challenge_statement.md"), "r", encoding="utf-8") as handle:
            challenge = handle.read()
        flat = " ".join(challenge.split())
        for psi_id, name in expected.items():
            funcs, inv = self.function_map(psi_id)
            self.assertIn(name, funcs, psi_id)
            self.assertEqual(funcs[name]["source"], "challenge statement")
            self.assertEqual(inv["primary_function"], name)
            self.assertIn(funcs[name]["basis"], flat, psi_id)

    def test_function_lists_include_keyword_candidates(self):
        meta = build_site_data.load_meta()
        for inv in self.investigations:
            candidates = {c["function"] for c in meta.get(inv["psi_id"], {}).get("fire_safety_function_candidates", [])}
            names = {f["function"] for f in inv["functions"]}
            self.assertTrue(candidates <= names, inv["psi_id"])
            for entry in inv["functions"]:
                self.assertIn(entry["source"], ("challenge statement", "keyword match on PSI text"))
                if entry["source"] == "keyword match on PSI text":
                    self.assertIsNotNone(entry["score"])
        funcs, inv = self.function_map("PSI-69")
        self.assertEqual(funcs["suppression"]["source"], "challenge statement")
        funcs, inv = self.function_map("PSI-25")
        self.assertIn("suppression", funcs)
        self.assertEqual(funcs["suppression"]["source"], "keyword match on PSI text")
        self.assertEqual(inv["primary_function"], "prevention")
        funcs, inv = self.function_map("PSI-10")
        self.assertTrue(all(f["source"] == "keyword match on PSI text" for f in funcs.values()))
        for entry in inv["functions"]:
            self.assertEqual(entry["counts"], entry["score"] >= 3)
        funcs, inv = self.function_map("PSI-22")
        self.assertEqual(inv["primary_function"], "fundamental")

    def test_derive_functions_merges_same_function(self):
        record = {"fire_safety_function_candidates": [
            {"function": "prevention", "score": 9, "evidence": [{"source_field": "objective", "quote": "kw quote"}]},
            {"function": "suppression", "score": 4, "evidence": [{"source_field": "objective", "quote": "sup quote"}]},
        ]}
        entries = build_site_data.derive_functions("PSI-25", record)
        self.assertEqual([e["function"] for e in entries], ["prevention", "suppression"])
        self.assertEqual(entries[0]["source"], "challenge statement")
        self.assertEqual(entries[1]["source"], "keyword match on PSI text")
        self.assertIn("sup quote", entries[1]["basis"])
        self.assertEqual(build_site_data.primary_function(entries, record), "prevention")

    def test_replacement_characters_become_hyphens(self):
        cleaned = build_site_data.ascii_deep({"a": "NASA\ufffdSTD\ufffd6001", "b": ["x\ufffdy"]})
        self.assertEqual(cleaned["a"], "NASA-STD-6001")
        self.assertEqual(cleaned["b"], ["x-y"])

    def test_every_published_string_is_ascii(self):
        def walk(value):
            if isinstance(value, str):
                value.encode("ascii")
                self.assertNotIn("\ufffd", value)
            elif isinstance(value, list):
                for item in value:
                    walk(item)
            elif isinstance(value, dict):
                for key, item in value.items():
                    walk(key)
                    walk(item)
        for name in ("investigations", "conditions", "environments", "insights", "earth", "rank_reference", "model_readiness"):
            walk(read_json(os.path.join(SITE, name + ".json")))
        walk(read_json(CORPUS))

    def readiness_recount(self, rel_id, env):
        rel = next(r for r in build_site_data.RELATIONSHIPS if r["id"] == rel_id)
        total = 0
        counted = 0
        for r in self.conditions:
            if r["psi_id"] not in rel["psi_ids"]:
                continue
            total += 1
            has = False
            for key in rel["response_keys"]:
                if key.startswith("note:"):
                    has = has or (key[5:] + "=") in (r["measurement_notes"] or "")
                else:
                    has = has or r[key] is not None
            if not has or r["value_quality"] not in COUNTABLE:
                continue
            ok = True
            for axis in rel["axes"]:
                if env[{"o2": "o2", "pressure": "pressure_atm", "flow": "flow_cm_s"}[axis]]["not_specified"]:
                    continue
                key = {"o2": "o2_frac", "pressure": "pressure_atm", "flow": "flow_cm_s"}[axis]
                wkey = {"o2": "o2", "pressure": "pressure_atm", "flow": "flow_cm_s"}[axis]
                lo, hi = window(env, wkey)
                value = r[key]
                if value is None or not lo <= value <= hi:
                    ok = False
                if axis == "o2" and r["o2_basis"] != "ambient":
                    ok = False
                if axis == "pressure" and value is not None and value <= 0:
                    ok = False
            if ok:
                counted += 1
        return total, counted

    def test_model_readiness_status_is_computed_from_rows(self):
        readiness = read_json(os.path.join(SITE, "model_readiness.json"))
        self.assertEqual(readiness["min_rows"], 10)
        self.assertIn("grouped", readiness["grouped_validation_note"])
        self.assertIn("No trained model", readiness["no_model_note"])
        self.assertEqual(set(readiness["environments"]), {e["id"] for e in self.environments["environments"]})
        for env in self.environments["environments"]:
            items = {i["id"]: i for i in readiness["environments"][env["id"]]["items"]}
            self.assertEqual(
                list(items), ["droplet_extinction", "gas_flame_limits", "solid_flammability", "smoke_particle_size", "partial_gravity"])
            for rel_id, item in items.items():
                if rel_id == "partial_gravity":
                    self.assertEqual(item["status"], "Not supported")
                    self.assertEqual(item["rows_total"], 0)
                    self.assertIn("LUCI", item["gap"])
                    self.assertIn("FM2", item["gap"])
                    continue
                total, counted = self.readiness_recount(rel_id, env)
                self.assertEqual(item["rows_total"], total, (env["id"], rel_id))
                self.assertEqual(item["rows_counted"], counted, (env["id"], rel_id))
                if counted >= 10:
                    expected = "Supported"
                elif total:
                    expected = "Partly"
                else:
                    expected = "Not supported"
                self.assertEqual(item["status"], expected, (env["id"], rel_id))
                self.assertEqual(sum(i["rows"] for i in item["investigations"]), total)
                self.assertTrue(item["gap"])

    def test_model_readiness_status_rule_boundaries(self):
        env = next(e for e in build_site_data.build_environments(profile_path=None)["environments"] if e["id"] == "lunar")
        rel = {
            "id": "probe", "title": "probe", "psi_ids": ["PSI-X"], "axes": ["o2"], "response_keys": ["outcome"],
            "response_label": "outcome", "needs": "more data",
        }
        def row(i, o2, outcome):
            return {"psi_id": "PSI-X", "investigation": "X", "o2_frac": o2, "o2_basis": "ambient", "outcome": outcome,
                    "value_quality": "exact", "pressure_atm": 0.6, "flow_cm_s": None, "measurement_notes": None}
        nine = [row(i, 0.3, "ok") for i in range(9)]
        ten = [row(i, 0.3, "ok") for i in range(10)]
        outside = [row(i, 0.2, "ok") for i in range(12)]
        no_outcome = [row(i, 0.3, None) for i in range(12)]
        self.assertEqual(build_site_data.readiness_item(rel, env, nine, 0)["status"], "Partly")
        self.assertEqual(build_site_data.readiness_item(rel, env, ten, 0)["status"], "Supported")
        self.assertEqual(build_site_data.readiness_item(rel, env, outside, 0)["status"], "Partly")
        self.assertEqual(build_site_data.readiness_item(rel, env, no_outcome, 0)["status"], "Partly")
        self.assertEqual(build_site_data.readiness_item(rel, env, [], 0)["status"], "Not supported")
        self.assertIn("below the window", build_site_data.readiness_item(rel, env, outside, 0)["gap"])
        self.assertIn("No outcome", build_site_data.readiness_item(rel, env, no_outcome, 0)["gap"])

    def test_solid_flammability_is_not_supported_above_max_solid_o2(self):
        readiness = read_json(os.path.join(SITE, "model_readiness.json"))
        solid = next(i for i in readiness["environments"]["lunar"]["items"] if i["id"] == "solid_flammability")
        self.assertEqual(solid["status"], "Partly")
        self.assertEqual(solid["rows_counted"], 0)
        self.assertIn("0.221", solid["gap"])

    def test_sourced_solid_pressures_match_source_file(self):
        sourced = self.outside["solid_pressures"]
        self.assertEqual(set(sourced), set(self.pressure_sources))
        self.assertEqual(sourced["PSI-26"]["pressure_atm"], 1.0)
        self.assertEqual(sourced["PSI-98"]["pressure_atm"], 0.987)
        low, high = self.pressure_sources["PSI-25"]["pressure_atm_range"]
        self.assertAlmostEqual(sourced["PSI-25"]["pressure_atm"], (low + high) / 2.0, places=6)
        for psi_id, rec in sourced.items():
            self.assertTrue(rec["source_url"].startswith("https://ntrs.nasa.gov/citations/" + rec["source_id"]))

    def test_every_plotted_solid_row_has_a_pressure_after_sourcing(self):
        sourced = self.outside["solid_pressures"]
        missing = [
            r for r in self.conditions
            if r["fuel_class"] == "solid" and r["o2_basis"] == "ambient" and r["o2_frac"] is not None and r["value_quality"] in COUNTABLE
            and not (r["pressure_atm"] is not None and r["pressure_atm"] > 0) and r["psi_id"] not in sourced
        ]
        self.assertEqual(missing, [])
        unified = read_json(os.path.join(UNIFIED, "conditions.json"))
        self.assertTrue(any(r["fuel_class"] == "solid" and not r["pressure_atm"] for r in unified))

    def test_outside_psi_trace_data_matches_source(self):
        tests = self.outside["tests"]
        self.assertEqual(len(tests), len(self.saffire))
        by_id = {t["sample_id"]: t for t in tests}
        for src in self.saffire:
            t = by_id[src["sample_id"]]
            self.assertEqual(t["o2_percent"], src["o2_percent"])
            self.assertEqual(t["pressure_psia"], src["pressure_psia"])
            self.assertEqual(t["plotted"], src["pressure_psia"] is not None)
            self.assertEqual(t["source_url"], src["source_url"])
        self.assertFalse(by_id["VI-1"]["plotted"])
        self.assertEqual(by_id["VI-2"]["pressure_psia"], 7.85)
        self.assertEqual(by_id["VI-2"]["o2_percent"], 31.0)
        self.assertEqual(self.outside["summary"]["unplotted"], ["VI-1"])
        self.assertEqual(self.outside["summary"]["highest_burned"], "VI-2")

    def test_callout_numbers_are_computed(self):
        solid = self.insights["max_o2_by_fuel_class"]["numbers"]["max_by_fuel_class"]["solid"]["max_o2"]
        self.assertEqual(self.outside["summary"]["psi_solid_max_o2"], solid)
        best = max((t for t in self.saffire if t["pressure_psia"] is not None and t["outcome"].startswith("Burned")), key=lambda t: t["o2_percent"])
        self.assertEqual(best["sample_id"], self.outside["summary"]["highest_burned"])
        self.assertEqual(best["o2_percent"], 31.0)

    def test_outside_insight_numbers_come_from_the_json(self):
        ins = self.insights["outside_psi_solids"]
        above = [t for t in self.saffire if t["pressure_psia"] is not None and t["o2_percent"] / 100.0 > self.outside["summary"]["psi_solid_max_o2"]]
        n = ins["numbers"]
        self.assertEqual(n["o2_percent_range_above_psi_max"], [min(t["o2_percent"] for t in above), max(t["o2_percent"] for t in above)])
        self.assertEqual(n["psia_range_above_psi_max"], [min(t["pressure_psia"] for t in above), max(t["pressure_psia"] for t in above)])
        self.assertEqual(n["above_psi_max"], [t["sample_id"] for t in above])
        self.assertIn("25.4-31.0", ins["headline"])
        self.assertIn("7.85-10.53", ins["headline"])
        self.assertTrue(ins["sources"])
        self.assertEqual(len(n["tests_table"]), len(self.saffire))

    def test_test_next_outside_column_selection(self):
        for env_id, block in self.test_next["environments"].items():
            env = self.env_by_id[env_id]
            o2lo, o2hi = window(env, "o2")
            plo, phi = window(env, "pressure_atm")

            def gaps(o2, atm):
                return (max(o2lo - o2, o2 - o2hi, 0.0), max(plo - atm, atm - phi, 0.0))

            for entry in block["classes"]:
                if entry["fuel_class"] != "solid":
                    self.assertNotIn("outside_nearest", entry)
                    continue
                candidates = [(gaps(t["o2_percent"] / 100.0, t["pressure_kpa"] / 101.325), t["sample_id"]) for t in self.saffire if t["pressure_kpa"] is not None]
                best_gap, best_id = min(candidates)
                near = entry["nearest"]
                psi_gap = (near["o2_gap"], near["pressure_gap_atm"] if near["pressure_gap_atm"] is not None else float("inf")) if near else None
                chosen = entry["outside_nearest"]
                if psi_gap is not None and (round(best_gap[0], 6), round(best_gap[1], 6)) >= psi_gap:
                    self.assertIsNone(chosen, env_id)
                else:
                    self.assertEqual(chosen["sample_id"], best_id, env_id)
                    self.assertEqual(chosen["inside"], best_gap == (0.0, 0.0))
        lunar = next(e for e in self.test_next["environments"]["lunar"]["classes"] if e["fuel_class"] == "solid")
        self.assertEqual(lunar["outside_nearest"]["sample_id"], "VI-2")
        self.assertEqual(lunar["inside"], 0)

    def test_dashboard_results_document(self):
        doc = self.corpus[-2]
        self.assertEqual(doc["psi_id"], "DASHBOARD-RESULTS")
        self.assertEqual(doc["title"], build_site_data.DASHBOARD_RESULTS_TITLE)
        for token in ("Environment lunar", "Test next, lunar, solid", "Solid test pressure, PSI-25", "20210011385", "Default lunar habitat ranking"):
            self.assertIn(token, doc["body"])

    def test_corpus_has_no_publication_lists(self):
        for doc in self.corpus:
            self.assertNotIn("\nPublications:", "\n" + doc["body"])

    def test_earth_firefighter_entries_and_corpus_document(self):
        apps = {a["id"]: a for a in read_json(os.path.join(SITE, "earth.json"))["applications"]}
        quotes = {q["id"]: q for q in read_json(os.path.join(ROOT, "data", "earth", "earth_quotes.json"))["quotes"]}
        verification = read_json(os.path.join(ROOT, "data", "earth", "verification.json"))
        self.assertEqual(verification["failed"], 0)
        self.assertEqual(verification["checked"], len(quotes))
        doc = self.corpus[-1]
        self.assertEqual(doc["psi_id"], build_site_data.EARTH_CORPUS_ID)
        for key in ("firefighter_air_tanks", "firefighter_clothing"):
            self.assertEqual(apps[key]["label"], "NASA spinoff technology, not a PSI combustion test.")
            self.assertEqual(apps[key]["quote"]["text"], quotes[key]["quote"])
            self.assertTrue(apps[key]["quote"]["url"].startswith("https://spinoff.nasa.gov/node/"))
            self.assertIn(quotes[key]["quote"], doc["body"])
        self.assertIn("firefighter", doc["body"].lower())

    def test_lunar_gravity_table_matches_paper(self):
        lg = read_json(os.path.join(SITE, "lunar_g.json"))
        got = {m["name"]: (m["best_fit_slope_s_per_cm"], m["ci95_slope_s_per_cm"], m["delta_o2_points"], m["direction"]) for m in lg["materials"]}
        self.assertEqual(got, {
            "PMMA": (0.00022, 0.00056, 1.9, "more_flammable"),
            "Polycarbonate": (0.00040, 0.00065, 2.3, "less_flammable"),
            "Nomex Velcro": (0.000016, 0.000090, 0.32, "less_flammable"),
            "P 213": (0.00030, 0.00040, 1.4, "more_flammable"),
            "Beefy-T (flaming)": (0.00017, 0.00023, 0.82, "more_flammable"),
            "Beefy-T (smolder)": (0.00034, 0.00050, 1.8, "not_stated"),
        })
        self.assertEqual(lg["paper"]["worst_case_delta_o2_points"], 2.3)
        self.assertEqual(max(m["delta_o2_points"] for m in lg["materials"]), 2.3)
        for m in lg["materials"]:
            self.assertAlmostEqual(m["ci95_slope_s_per_cm"] * 35 * 100, m["delta_o2_points"], delta=0.1)
        with open(os.path.join(SITE, "lunar_g.json"), "rb") as handle:
            handle.read().decode("ascii")

    def test_lunar_gravity_quotes_verify_and_reach_corpus(self):
        import verify_lunar_g
        data = read_json(os.path.join(ROOT, "data", "lunar_g", "compensation.json"))
        self.assertEqual(verify_lunar_g.verify(data), [])
        bad = dict(data["quotes"][0])
        bad["quote"] = bad["quote"] + " not in source"
        self.assertTrue(verify_lunar_g.check(bad))
        wrong_page = dict(data["quotes"][0])
        wrong_page["page"] = 9
        self.assertTrue(verify_lunar_g.check(wrong_page))
        docs = {d["psi_id"]: d for d in self.corpus}
        body = docs[build_site_data.LUNAR_G_CORPUS_ID]["body"]
        cited = ("worst_case", "velocity_unknown", "lower_extinction", "higher_extinction", "conclusion", "bass_blowoff", "fm2_plan")
        for q in data["quotes"]:
            if q["id"] in cited:
                self.assertIn(q["quote"], body)
        self.assertIn("not a measured lunar-g limit", body)

    def test_outside_corpus_document_and_citation_mapping(self):
        doc = self.corpus[-3]
        self.assertEqual(doc["psi_id"], outside_psi.CORPUS_ID)
        self.assertEqual(doc["title"], outside_psi.CORPUS_TITLE)
        self.assertIn("not in the PSI repository", doc["body"])
        for src in self.saffire:
            self.assertIn(src["sample_id"], doc["body"])
            self.assertIn(src["source_id"], doc["body"])
            self.assertIn(src["quote"], doc["body"])

    def test_verification_json_has_outside_psi_and_ask_eval(self):
        out = self.verification["outside_psi"]
        recorded = read_json(os.path.join(ROOT, "data", "outside_psi", "verification.json"))
        self.assertEqual(out["checked"], recorded["checked"])
        self.assertEqual(out["failed"], recorded["failed"])
        self.assertEqual(out["checked"], 57)
        self.assertEqual(out["failed"], 0)
        ev = self.verification["ask_eval"]
        summary = read_json(os.path.join(ROOT, "eval", "results", "ask_eval_summary.json"))
        self.assertEqual(ev["total"], summary["total"])
        self.assertEqual(ev["final_passed"], summary["passed"])
        self.assertEqual(ev["answerable_passed"], 8)
        self.assertEqual(ev["answerable_total"], 8)
        self.assertEqual(ev["preregistered_passed"], 9)
        self.assertEqual([f["id"] for f in ev["checker_fixes"]], ["T1", "T2", "T3"])
        self.assertTrue(ev["url"].endswith("/tree/main/eval"))

    def test_ask_eval_v2_block_and_question_checks(self):
        ev = self.verification["ask_eval"]["v2"]
        summary = read_json(os.path.join(ROOT, "eval", "results", "ask_eval_v2_summary.json"))
        eval_set = read_json(os.path.join(ROOT, "eval", "ask_eval_set_v2.json"))
        questions = eval_set["questions"]
        self.assertTrue(eval_set["written_before_run"])
        self.assertEqual(eval_set["version"], 2)
        self.assertEqual(len(questions), 100)
        self.assertEqual(ev["total"], len(questions))
        self.assertEqual(ev["total"], summary["total"])
        self.assertEqual(ev["passed"], summary["passed"])
        self.assertEqual(ev["numeric_fidelity"], summary["numeric_fidelity"])
        self.assertEqual(ev["trap_total"], sum(1 for q in questions if q["type"] == "trap"))
        self.assertGreaterEqual(ev["passed_after_review"], ev["passed"])
        self.assertTrue(ev["url"].endswith("/tree/main/eval"))
        ids = [q["id"] for q in questions]
        self.assertEqual(len(ids), len(set(ids)))
        broken = []
        for q in questions:
            self.assertIn(q["type"], ("answerable", "trap", "multistep"))
            self.assertTrue(q["question"].strip())
            self.assertTrue(q["basis"].strip())
            has_check = q.get("must_contain_any") or q.get("must_contain_all_regex") or q.get("must_cite_psi")
            self.assertTrue(has_check, q["id"])
            if q["type"] == "trap":
                self.assertEqual(q["must_contain_any"], ["Not in the data"], q["id"])
                self.assertTrue(q.get("forbidden_patterns") or q.get("forbidden_unnegated"), q["id"])
            for pattern in q.get("must_contain_all_regex", []) + q.get("forbidden_patterns", []) + q.get("forbidden_unnegated", []):
                re.compile(pattern)
                if chr(8) in pattern:
                    broken.append(q["id"])
        reviewed = [r["id"] for r in ev["reviewed"]]
        self.assertEqual(broken, ["A43"])
        self.assertIn("A43", reviewed)


if __name__ == "__main__":
    unittest.main()
