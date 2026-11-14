import csv
import glob
import io
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import build_unified

SRC_DIR = os.path.join(ROOT, "data", "psi_experimental_tables")
OUT_DIR = os.path.join(ROOT, "data", "unified")


def source_data_rows(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    return len(rows) - 1


class BuildUnifiedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_unified.main()
        with open(os.path.join(OUT_DIR, "conditions.json"), "r", encoding="ascii") as handle:
            cls.rows = json.load(handle)
        with open(os.path.join(OUT_DIR, "summary.json"), "r", encoding="ascii") as handle:
            cls.summary = json.load(handle)

    def by_file(self, fragment):
        return [r for r in self.rows if fragment in r["source_file"]]

    def test_total_rows_match_sources(self):
        paths = glob.glob(os.path.join(SRC_DIR, "PSI-*_Experimental table_*.csv"))
        self.assertEqual(len(paths), 22)
        expected = sum(source_data_rows(p) for p in paths)
        self.assertEqual(len(self.rows), expected)

    def test_rows_per_source_file_match(self):
        for path in glob.glob(os.path.join(SRC_DIR, "PSI-*_Experimental table_*.csv")):
            name = os.path.basename(path)
            self.assertEqual(len(self.by_file(name)), source_data_rows(path), name)

    def test_csv_and_json_same_rows(self):
        with open(os.path.join(OUT_DIR, "conditions.csv"), "r", encoding="ascii", newline="") as handle:
            csv_rows = list(csv.DictReader(handle))
        self.assertEqual(len(csv_rows), len(self.rows))
        self.assertEqual([r["row_id"] for r in csv_rows], [r["row_id"] for r in self.rows])
        self.assertEqual(list(csv_rows[0].keys()), build_unified.COLUMNS)
        self.assertEqual(list(self.rows[0].keys()), build_unified.COLUMNS)

    def test_flex_first_row(self):
        flex = self.by_file("FLEX.csv")
        self.assertEqual(len(flex), 274)
        first = flex[0]
        self.assertAlmostEqual(first["o2_frac"], 0.21, places=6)
        self.assertAlmostEqual(first["pressure_atm"], 757.7 / 760.0, places=5)
        self.assertEqual(first["outcome"], "disruption")
        self.assertEqual(first["fuel_class"], "liquid_droplet")
        self.assertEqual(first["o2_basis"], "ambient")

    def test_cfig_normal_row_ambient(self):
        normal = self.by_file("CFI-G_Normal")
        match = [r for r in normal if r["o2_frac"] is not None and abs(r["o2_frac"] - 0.3939) < 1e-6]
        self.assertTrue(match)
        self.assertEqual(match[0]["o2_basis"], "ambient")
        self.assertEqual(match[0]["fuel_class"], "gas")

    def test_cfig_inverse_oxidizer_stream(self):
        inverse = self.by_file("CFI-G_Inverse")
        with_o2 = [r for r in inverse if r["o2_frac"] is not None]
        self.assertTrue(with_o2)
        self.assertTrue(all(r["o2_basis"] == "oxidizer_stream" for r in with_o2))

    def test_flame_design_inverse_oxidizer_stream(self):
        inverse = self.by_file("Flame Design_Inverse")
        self.assertTrue(all(r["o2_basis"] == "oxidizer_stream" for r in inverse if r["o2_frac"] is not None))
        normal = self.by_file("Flame Design_Normal")
        self.assertTrue(all(r["o2_basis"] == "ambient" for r in normal if r["o2_frac"] is not None))

    def test_saffire1_s1_range(self):
        s1 = self.by_file("SAFFIRE-1")[0]
        self.assertEqual(s1["value_quality"], "range")
        self.assertEqual(s1["o2_raw"], "21.5 - 21.7")
        self.assertAlmostEqual(s1["o2_frac"], 0.217, places=6)
        self.assertAlmostEqual(s1["o2_min_frac"], 0.215, places=6)
        self.assertLessEqual(s1["o2_min_frac"], 0.216)
        self.assertGreaterEqual(s1["o2_frac"], 0.216)

    def test_flex2_list_uses_max(self):
        row = self.by_file("Flex2")[0]
        self.assertAlmostEqual(row["o2_frac"], 0.3, places=6)
        self.assertAlmostEqual(row["o2_min_frac"], 0.17, places=6)
        self.assertEqual(row["value_quality"], "summary_row")
        self.assertIsNone(row["pressure_atm"])

    def test_bre_list_and_percent_artifact(self):
        bre = self.by_file("ACME BRE")
        self.assertAlmostEqual(bre[0]["o2_frac"], 0.40, places=6)
        self.assertAlmostEqual(bre[0]["o2_min_frac"], 0.21, places=6)
        artifact = [r for r in bre if r["o2_raw"] == "3400%"]
        self.assertEqual(len(artifact), 1)
        self.assertAlmostEqual(artifact[0]["o2_frac"], 0.34, places=6)

    def test_bass2_has_no_outcome(self):
        bass2 = self.by_file("BASS-II")
        self.assertTrue(all(r["outcome"] is None for r in bass2))

    def test_summary_table_row(self):
        rows = self.by_file("Data Summary Table")
        self.assertEqual(len(rows), 8)
        for r in rows:
            self.assertIsNone(r["fuel_class"])
            self.assertEqual(r["value_quality"], "summary_row")

    def test_required_fields_present(self):
        for r in self.rows:
            self.assertTrue(r["psi_id"])
            self.assertTrue(r["source_file"])
            self.assertIsNotNone(r["source_row"])
            self.assertGreaterEqual(r["source_row"], 1)

    def test_o2_within_unit_interval(self):
        for r in self.rows:
            if r["o2_frac"] is not None:
                self.assertGreaterEqual(r["o2_frac"], 0.0)
                self.assertLessEqual(r["o2_frac"], 1.0)
                self.assertIsNotNone(r["o2_min_frac"])
                self.assertLessEqual(r["o2_min_frac"], r["o2_frac"])
                self.assertIn(r["o2_basis"], ("ambient", "oxidizer_stream"))
            else:
                self.assertEqual(r["o2_basis"], "none")

    def test_controlled_vocabularies(self):
        for r in self.rows:
            self.assertIn(r["fuel_class"], (None, "solid", "liquid_droplet", "gas",
                                            "aerosol_dust", "smoke_sample"))
            self.assertIn(r["value_quality"], ("exact", "approximate", "range", "ramped", "summary_row"))
            self.assertIn(r["flow_direction"], (None, "concurrent", "opposed"))
            self.assertIn(r["ignition"], (None, "yes", "no"))

    def test_summary_o2_ge_030_matches_recount(self):
        ge = [r for r in self.rows if r["o2_frac"] is not None and r["o2_frac"] >= 0.30]
        block = self.summary["o2_ge_030"]
        self.assertEqual(block["total"], len(ge))
        by_class = {}
        by_inv = {}
        for r in ge:
            key = r["fuel_class"] or "unclassified"
            by_class[key] = by_class.get(key, 0) + 1
            by_inv[r["psi_id"]] = by_inv.get(r["psi_id"], 0) + 1
        self.assertEqual(block["by_fuel_class"], by_class)
        self.assertEqual(block["by_investigation"], by_inv)
        self.assertEqual(sum(block["by_o2_basis"].values()), len(ge))

    def test_summary_totals_and_bins(self):
        self.assertEqual(self.summary["total_rows"], len(self.rows))
        self.assertEqual(sum(self.summary["counts_by_investigation"].values()), len(self.rows))
        self.assertEqual(sum(self.summary["counts_by_fuel_class"].values()), len(self.rows))
        overall = self.summary["o2_overall"]
        known = [r["o2_frac"] for r in self.rows if r["o2_frac"] is not None]
        self.assertEqual(overall["o2_known"], len(known))
        self.assertEqual(sum(overall["bins"].values()), len(known))
        both = [r for r in self.rows if r["o2_frac"] is not None and r["outcome"] is not None]
        self.assertEqual(self.summary["rows_with_o2_and_outcome"], len(both))

    def test_investigations_json(self):
        with open(os.path.join(OUT_DIR, "investigations.json"), "r", encoding="ascii") as handle:
            inv = json.load(handle)
        self.assertEqual(len(inv), 20)
        self.assertEqual(sum(v["row_count"] for v in inv.values()), len(self.rows))
        self.assertEqual(inv["PSI-10"]["row_count"], 327)
        self.assertEqual(len(inv["PSI-10"]["source_files"]), 2)
        self.assertIn("o2_frac", inv["PSI-69"]["coverage"])

    def test_outputs_are_ascii(self):
        for name in ("conditions.csv", "conditions.json", "investigations.json", "summary.json"):
            with open(os.path.join(OUT_DIR, name), "rb") as handle:
                handle.read().decode("ascii")


if __name__ == "__main__":
    unittest.main()
