import json
import os
import sys
import unittest
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import data_health
from build_models import MIN_PRESSURE

FILE = "PSI-99_Experimental table_Fixture.csv"


def rows_of(header, *cells):
    return [OrderedDict(zip(header, c)) for c in cells]


def rules(items):
    return sorted(i["rule"] for i in items)


class RuleFixtureTest(unittest.TestCase):
    def test_duplicate_row_flags_only_the_later_copy(self):
        header = ["a", "b", "c", "d", "e"]
        rows = rows_of(header, ("1", "x", "y", "z", "w"), ("2", "x", "y", "z", "w"), ("1", "x", "y", "z", "w"))
        items = data_health.scan_duplicates(FILE, rows)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["source_row"], 3)
        self.assertIn("row 1", items[0]["why"])

    def test_sparse_continuation_rows_are_not_duplicates(self):
        header = ["a", "b", "c", "d", "e"]
        rows = rows_of(header, ("", "", "", "", "100%"), ("", "", "", "", "100%"))
        self.assertEqual(data_health.scan_duplicates(FILE, rows), [])

    def test_fraction_column_with_percent_magnitude(self):
        rows = rows_of(["o2"], ("0.21",), ("21",), ("1",), ("0",))
        items = data_health.o2_items(FILE, rows, ("o2", data_health.FRACTION))
        self.assertEqual(rules(items), ["o2_scale_mismatch"])
        self.assertEqual(items[0]["source_row"], 2)

    def test_fraction_column_above_100_is_out_of_bounds(self):
        rows = rows_of(["o2"], ("250",))
        self.assertEqual(rules(data_health.o2_items(FILE, rows, ("o2", data_health.FRACTION))), ["o2_out_of_bounds"])

    def test_negative_o2_is_out_of_bounds(self):
        rows = rows_of(["o2"], ("-0.2",))
        self.assertEqual(rules(data_health.o2_items(FILE, rows, ("o2", data_health.FRACTION))), ["o2_out_of_bounds"])

    def test_percent_column_values(self):
        rows = rows_of(["o2"], ("21.5",), ("~ 21.5",), ("21.5 - 21.7",), ("0.6",), ("3400%",), ("100",), ("250",))
        items = data_health.o2_items(FILE, rows, ("o2", data_health.PERCENT))
        got = {i["source_row"]: i["rule"] for i in items}
        self.assertEqual(got, {5: "o2_scale_mismatch", 7: "o2_out_of_bounds"})

    def test_percent_column_below_one_is_not_flagged(self):
        rows = rows_of(["o2"], ("0.6",), ("0.9",))
        self.assertEqual(data_health.o2_items(FILE, rows, ("o2", data_health.PERCENT)), [])

    def test_pressure_bounds_after_unit_conversion(self):
        spec = {"pressure": ("p", data_health.MMHG)}
        rows = rows_of(["p"], ("760",), ("0",), ("100",), ("3800",), ("4000",), ("",))
        items = data_health.pressure_items(FILE, rows, spec)
        self.assertEqual({i["source_row"] for i in items}, {2, 3, 5})
        self.assertTrue(all(i["rule"] == "pressure_out_of_bounds" for i in items))

    def test_pressure_floor_is_the_one_build_models_uses(self):
        self.assertEqual(data_health.MIN_PRESSURE, MIN_PRESSURE)
        spec = {"pressure": ("p", data_health.ATM)}
        rows = rows_of(["p"], (str(MIN_PRESSURE),), (str(MIN_PRESSURE - 0.01),))
        self.assertEqual([i["source_row"] for i in data_health.pressure_items(FILE, rows, spec)], [2])

    def test_pressure_bar_is_converted(self):
        spec = {"pressure": ("p", data_health.BAR)}
        rows = rows_of(["p"], ("0.2",), ("5.1",), ("5.0",), ("1 atm",))
        self.assertEqual([i["source_row"] for i in data_health.pressure_items(FILE, rows, spec)], [1, 2])

    def test_high_pressure_inside_bound_is_not_flagged(self):
        spec = {"pressure": ("p", data_health.ATM)}
        rows = rows_of(["p"], ("3 atm",), ("5 atm",), ("3.0076332",))
        self.assertEqual(data_health.pressure_items(FILE, rows, spec), [])

    def test_negative_flow_reads_the_raw_sign(self):
        spec = {"flow": "f"}
        rows = rows_of(["f"], ("5",), ("-0.28",), ("0",), ("0.1 - 5",), ("30 cm/s",))
        items = data_health.flow_items(FILE, rows, spec)
        self.assertEqual([i["source_row"] for i in items], [2])
        self.assertEqual(items[0]["raw_value"], "-0.28")

    def test_non_numeric_token_only_for_cells_without_a_number(self):
        spec = {"o2": ("o2", data_health.FRACTION), "pressure": ("p", data_health.ATM), "flow": "f"}
        header = ["o2", "p", "f"]
        rows = rows_of(header, ("RAMP", "1 atm", "30 cm/s"), ("LOW O2", "", ""), ("0.21", "n/a", "-"), ("", "", ""))
        items = data_health.non_numeric_items(FILE, rows, spec)
        got = [(i["source_row"], i["column"], i["raw_value"]) for i in items]
        self.assertEqual(got, [(1, "o2", "RAMP"), (2, "o2", "LOW O2"), (3, "p", "n/a"), (3, "f", "-")])

    def test_cells_outside_the_spec_are_ignored(self):
        rows = rows_of(["other"], ("RAMP",))
        self.assertEqual(data_health.non_numeric_items(FILE, rows, {}), [])

    def test_row_ids_attach_from_unified(self):
        items = [data_health.item("negative_flow", FILE, 2, "f", "-1", "why")]
        data_health.attach_row_ids(items, {FILE: {2: {"row_id": "U00002"}}})
        self.assertEqual(items[0]["row_id"], "U00002")

    def test_build_reads_a_raw_directory(self):
        import tempfile
        name = "PSI-99_Experimental table_Fixture.csv"
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, name), "w", encoding="ascii", newline="") as handle:
                handle.write("o2,f,x,y,z\n21,5,a,b,c\n0.21,-1,a,b,c\n0.21,-1,a,b,c\n")
            specs = {name: {"o2": ("o2", data_health.FRACTION), "flow": "f"}}
            unified = [{"source_file": name, "source_row": i, "row_id": "U%05d" % i} for i in (1, 2, 3)]
            result = data_health.build(tmp, unified, specs)
        got = [(i["rule"], i["source_row"]) for i in result["items"]]
        self.assertEqual(got, [("o2_scale_mismatch", 1), ("negative_flow", 2), ("duplicate_row", 3), ("negative_flow", 3)])
        self.assertEqual(result["rules"]["negative_flow"]["count"], 2)
        self.assertEqual(result["summary"]["flagged_items"], 4)
        self.assertEqual(result["summary"]["flagged_rows"], 3)
        self.assertTrue(all(i["row_id"] for i in result["items"]))


class RealDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data_health.main()
        with open(data_health.OUT_PATH, "rb") as handle:
            cls.raw = handle.read()
        cls.data = json.loads(cls.raw.decode("ascii"))
        with open(os.path.join(ROOT, "data", "unified", "conditions.json"), "r", encoding="ascii") as handle:
            cls.conditions = json.load(handle)

    def test_output_is_ascii_and_rerun_is_byte_identical(self):
        data_health.main()
        with open(data_health.OUT_PATH, "rb") as handle:
            self.assertEqual(self.raw, handle.read())

    def test_counts_match_items(self):
        counts = {}
        for it in self.data["items"]:
            counts[it["rule"]] = counts.get(it["rule"], 0) + 1
        for rule, block in self.data["rules"].items():
            self.assertEqual(block["count"], counts.get(rule, 0), rule)
        self.assertEqual(self.data["summary"]["flagged_items"], len(self.data["items"]))
        self.assertEqual(self.data["summary"]["rows_scanned"], len(self.conditions))

    def test_every_item_points_at_a_real_row(self):
        by_key = {(r["source_file"], r["source_row"]): r for r in self.conditions}
        for it in self.data["items"]:
            row = by_key[(it["source_file"], it["source_row"])]
            self.assertEqual(row["row_id"], it["row_id"])
            self.assertEqual(row["psi_id"], it["psi_id"])

    def test_raw_values_are_in_the_csv(self):
        import build_unified
        cache = {}
        for it in self.data["items"]:
            if it["column"] == "all columns":
                continue
            if it["source_file"] not in cache:
                cache[it["source_file"]] = build_unified.read_table(os.path.join(build_unified.SRC_DIR, it["source_file"]))
            self.assertEqual(cache[it["source_file"]][it["source_row"] - 1][it["column"]], it["raw_value"])

    def test_duplicates_really_are_identical_rows(self):
        import build_unified
        cache = {}
        for it in self.data["items"]:
            if it["rule"] != "duplicate_row":
                continue
            if it["source_file"] not in cache:
                cache[it["source_file"]] = build_unified.read_table(os.path.join(build_unified.SRC_DIR, it["source_file"]))
            rows = cache[it["source_file"]]
            earlier = int(it["raw_value"].split()[-1])
            self.assertEqual(list(rows[it["source_row"] - 1].values()), list(rows[earlier - 1].values()))
            self.assertLess(earlier, it["source_row"])

    def test_the_known_flex_row_is_flagged(self):
        hits = [i for i in self.data["items"] if i["rule"] == "pressure_out_of_bounds" and i["psi_id"] == "PSI-69"]
        self.assertEqual([h["source_row"] for h in hits], [114])
        self.assertEqual(hits[0]["raw_value"], "0")

    def test_every_rule_has_a_description(self):
        for block in self.data["rules"].values():
            self.assertTrue(block["description"])


if __name__ == "__main__":
    unittest.main()
