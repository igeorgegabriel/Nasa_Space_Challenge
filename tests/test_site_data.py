import json
import os
import sys
import tempfile
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

    def test_builtin_environment_values_without_profile_file(self):
        envs = build_site_data.build_environments(profile_path=None)["environments"]
        self.assertEqual([e["id"] for e in envs], ["iss", "gateway", "lunar", "rover", "mars"])
        lunar = next(e for e in envs if e["id"] == "lunar")
        self.assertFalse(lunar["o2"]["assumption"])
        self.assertFalse(lunar["pressure_atm"]["assumption"])
        self.assertAlmostEqual(lunar["pressure_atm"]["min"], 0.558, places=3)
        mars = next(e for e in envs if e["id"] == "mars")
        self.assertTrue(mars["o2"]["assumption"])

    def test_profile_file_overrides_builtin_and_maps_ids(self):
        profile = {
            "sources": {"probe": {"label": "Probe source", "url": "https://example.org/probe"}},
            "environments": [
                {
                    "id": "lunar_habitat",
                    "name": "Lunar habitat (profile)",
                    "o2": {"min": 0.3, "max": 0.32, "sources": [{"ref": "probe", "detail": "d"}], "assumption": False, "note": "n"},
                    "pressure_atm": {"min": 0.6, "max": 0.6, "assumption": True},
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
        self.assertEqual(lunar["flow_cm_s"]["min"], 10.0)
        self.assertEqual(envs["mars"]["o2"]["min"], 0.28)
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
        self.assertEqual(inv["primary_function"], "fundamental")
        self.assertTrue(all(f["source"] == "keyword match on PSI text" for f in funcs.values()))

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
        cleaned = build_site_data.ascii_deep({"a": "NASA�STD�6001", "b": ["x�y"]})
        self.assertEqual(cleaned["a"], "NASA-STD-6001")
        self.assertEqual(cleaned["b"], ["x-y"])

    def test_every_published_string_is_ascii(self):
        def walk(value):
            if isinstance(value, str):
                value.encode("ascii")
                self.assertNotIn("�", value)
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


if __name__ == "__main__":
    unittest.main()
