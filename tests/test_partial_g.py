import copy
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import verify_partial_g

DATA_PATH = os.path.join(ROOT, "data", "partial_g", "partial_g.json")
KINDS = {"limit_value", "o2_observed", "spread_rate", "qualitative"}


def load():
    with open(DATA_PATH, "r", encoding="ascii") as handle:
        return json.load(handle)


def field(point, name):
    return next(f for f in point["fields"] if f["name"] == name)


class PartialGTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load()
        cls.points = {p["id"]: p for p in cls.data["points"]}

    def test_every_quote_and_field_verifies(self):
        errors, counts = verify_partial_g.verify(self.data)
        self.assertEqual(errors, [])
        self.assertGreaterEqual(counts["points"], 20)
        self.assertGreater(counts["fields"], 100)

    def test_kinds_and_sources_are_known(self):
        sources = {s["id"] for s in self.data["sources"]}
        for point in self.data["points"]:
            self.assertIn(point["kind"], KINDS)
            self.assertIn(point["source_id"], sources)
            self.assertTrue(point["quotes"])

    def test_sources_are_ntrs(self):
        for source in self.data["sources"]:
            self.assertTrue(source["url"].startswith("https://ntrs.nasa.gov/citations/"))
            self.assertIn(source["ntrs_id"], source["url"])
            self.assertEqual(len(source["pdf_sha256"]), 64)

    def test_olson_table_values(self):
        martian = self.points["olson2013_martian_mylar_g"]
        self.assertEqual(field(martian, "ulois_percent_o2")["raw"], "18.0")
        self.assertEqual(field(martian, "moc_percent_o2")["raw"], "17.0")
        self.assertEqual(field(martian, "gravity_g")["raw"], "0.38")
        self.assertEqual(field(martian, "total_pressure")["raw"], "10.2")
        lunar = self.points["olson2013_lunar_mylar_g"]
        self.assertEqual(field(lunar, "o2_margin_vs_1g")["raw"], "-5.75")
        nomex = self.points["olson2013_1g_nomex_ht90_40"]
        self.assertEqual(field(nomex, "total_pressure")["raw"], "14.7")

    def test_olson_margins_recompute_from_table(self):
        self.assertEqual(verify_partial_g.check_olson_margins(self.data["points"]), [])

    def test_olson_covers_four_gravity_levels_and_three_materials(self):
        ids = [i for i in self.points if i.startswith("olson2013_")]
        self.assertEqual(len(ids), 12)
        for g in ("1g", "martian", "lunar", "0g"):
            for m in ("mylar_g", "ultem_1000", "nomex_ht90_40"):
                self.assertIn("olson2013_%s_%s" % (g, m), ids)

    def test_no_lunar_gravity_number_invented_for_olson(self):
        for m in ("mylar_g", "ultem_1000", "nomex_ht90_40"):
            point = self.points["olson2013_lunar_" + m]
            self.assertFalse([f for f in point["fields"] if f["name"] == "gravity_g"])

    def test_chamber_depletion_traces_are_flagged(self):
        for pid in ("luci_pmma_lunar", "luci_pmma_1g"):
            joined = " ".join(self.points[pid]["notes"] + [self.points[pid]["outcome"]])
            self.assertIn("not a controlled", joined)

    def test_plot_only_values_are_listed_not_extracted(self):
        self.assertTrue(self.data["rejected_or_plot_only"])
        for pid in ("urban2025_pmma_p213_beefyt_lunar", "sacksteder2003_kimwipes_kc135"):
            self.assertIn("plot only", self.points[pid]["outcome"])
            self.assertFalse([f for f in self.points[pid]["fields"] if f["name"].startswith("o2_limit")])

    def test_altered_quote_is_rejected(self):
        broken = copy.deepcopy(self.data)
        point = next(p for p in broken["points"] if p["id"] == "olson2013_martian_mylar_g")
        point["quotes"]["ulois_row"]["text"] = "Martian ULOI* 18.1 22.0 19.9"
        errors, _ = verify_partial_g.verify(broken)
        self.assertTrue(any("olson2013_martian_mylar_g" in e for e in errors))

    def test_altered_page_is_rejected(self):
        broken = copy.deepcopy(self.data)
        point = next(p for p in broken["points"] if p["id"] == "olson2013_martian_mylar_g")
        point["quotes"]["ulois_row"]["page"] = 5
        errors, _ = verify_partial_g.verify(broken)
        self.assertTrue(errors)

    def test_altered_number_is_rejected(self):
        broken = copy.deepcopy(self.data)
        point = next(p for p in broken["points"] if p["id"] == "schechter_nomex_lunar")
        field(point, "loc_percent_o2")["raw"] = "31"
        errors, _ = verify_partial_g.verify(broken)
        self.assertTrue(any("schechter_nomex_lunar" in e for e in errors))

    def test_altered_margin_is_rejected(self):
        broken = copy.deepcopy(self.data)
        point = next(p for p in broken["points"] if p["id"] == "olson2013_lunar_ultem_1000")
        field(point, "ulois_percent_o2")["raw"] = "25.0"
        self.assertTrue(verify_partial_g.check_olson_margins(broken["points"]))

    def test_data_files_are_ascii(self):
        folder = os.path.join(ROOT, "data", "partial_g")
        for name in ("partial_g.json", "verification.json"):
            with open(os.path.join(folder, name), "rb") as handle:
                self.assertTrue(all(b < 128 for b in handle.read()))
        for source in self.data["sources"]:
            with open(os.path.join(ROOT, source["text_file"]), "rb") as handle:
                self.assertTrue(all(b < 128 for b in handle.read()))


if __name__ == "__main__":
    unittest.main()
