import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "api"))

import build_site_data
import partial_g_site
import _data_tools
import _number_check

SOURCE = os.path.join(ROOT, "data", "partial_g", "partial_g.json")
PUBLIC = os.path.join(ROOT, "public", "data", "partial_g.json")
CORPUS = os.path.join(ROOT, "api", "context", "corpus.json")
NUMBER = re.compile(r"(?<![\w.-])\d+(?:\.\d+)?")


def read_json(path):
    with open(path, "r", encoding="ascii") as handle:
        return json.load(handle)


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def numeric_leaves(node, skip=()):
    if isinstance(node, dict):
        for key, value in node.items():
            if key in skip:
                continue
            for leaf in numeric_leaves(value, skip):
                yield leaf
    elif isinstance(node, list):
        for value in node:
            for leaf in numeric_leaves(value, skip):
                yield leaf
    elif isinstance(node, (int, float)) and not isinstance(node, bool):
        yield float(node)


def source_numbers(data):
    allowed = set()
    for point in data["points"]:
        for field in point["fields"]:
            try:
                allowed.add(float(field["raw"]))
            except ValueError:
                pass
        for quote in point["quotes"].values():
            allowed.add(float(quote["page"]))
    for source in data["sources"]:
        allowed.add(float(source["year"]))
    for quotes in data["definitions"].values():
        for quote in quotes.values():
            allowed.add(float(quote["page"]))
    return allowed


class PartialGSiteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_site_data.main()
        cls.source = read_json(SOURCE)
        cls.public = read_json(PUBLIC)
        cls.corpus = read_json(CORPUS)["documents"]

    def test_file_is_ascii_and_rebuild_is_byte_identical(self):
        before = read_bytes(PUBLIC)
        before.decode("ascii")
        corpus_before = read_bytes(CORPUS)
        build_site_data.main()
        self.assertEqual(before, read_bytes(PUBLIC))
        self.assertEqual(corpus_before, read_bytes(CORPUS))

    def test_build_function_is_deterministic(self):
        first = json.dumps(partial_g_site.build_partial_g(), sort_keys=True)
        second = json.dumps(partial_g_site.build_partial_g(), sort_keys=True)
        self.assertEqual(first, second)

    def test_every_point_is_published_with_its_source_and_quote(self):
        self.assertEqual([p["id"] for p in self.public["points"]], [p["id"] for p in self.source["points"]])
        sources = {s["id"]: s for s in self.source["sources"]}
        for pub, src in zip(self.public["points"], self.source["points"]):
            s = sources[src["source_id"]]
            for key in ("ntrs_id", "title", "authors", "year", "url"):
                self.assertEqual(pub["source"][key], s[key])
            self.assertEqual(pub["quotes"], {k: {"text": v["text"], "page": v["page"]} for k, v in src["quotes"].items()})
            self.assertIn(pub["quote"]["text"], [q["text"] for q in src["quotes"].values()])

    def test_every_number_in_the_public_file_is_in_the_source_file(self):
        allowed = source_numbers(self.source)
        leaves = list(numeric_leaves(self.public, skip=("summary", "meta")))
        self.assertGreater(len(leaves), 100)
        for value in leaves:
            self.assertIn(value, allowed)
        for point in self.public["points"]:
            src = next(p for p in self.source["points"] if p["id"] == point["id"])
            raws = {f["name"]: f["raw"] for f in src["fields"]}
            for field in point["fields"]:
                self.assertEqual(field["raw"], raws[field["name"]])

    def test_summary_numbers_are_derived_from_source_values(self):
        allowed = source_numbers(self.source)
        summary = self.public["summary"]
        by_id = {p["id"]: p for p in self.source["points"]}
        for drop in summary["ulois_drops_1g_to_lunar"]:
            a, b = (next(float(f["raw"]) for f in by_id[i]["fields"] if f["name"] == "ulois_percent_o2") for i in drop["point_ids"])
            self.assertAlmostEqual(drop["points"], a - b, places=6)
            self.assertIn(float(drop["one_g_raw"]), allowed)
            self.assertIn(float(drop["lunar_raw"]), allowed)
        self.assertEqual(summary["largest_drop"]["material"], "Mylar G (5 mil film)")
        self.assertEqual(summary["largest_drop"]["points"], 5.6)
        self.assertEqual(max(d["points"] for d in summary["ulois_drops_1g_to_lunar"]), summary["largest_drop"]["points"])
        self.assertIn(summary["lunar_o2_max"]["value"], allowed)

    def test_headline_is_computed_not_typed(self):
        lunar = []
        for point in self.source["points"]:
            if "lunar" not in point["gravity_label"].lower():
                continue
            pressure = next((float(f["raw"]) for f in point["fields"] if f["name"] == "total_pressure" and f["unit"] in ("psi", "psia")), None)
            for field in point["fields"]:
                if field["unit"] == "percent O2":
                    lunar.append((float(field["raw"]), pressure))
        top = max(v for v, _ in lunar)
        self.assertEqual(self.public["summary"]["lunar_o2_max"]["value"], top)
        hits = [v for v, p in lunar if p is not None and p <= 8.3 and v >= 33.5]
        self.assertEqual(bool(self.public["summary"]["hits_at_or_below_pressure"]), bool(hits))
        self.assertEqual(hits, [])
        self.assertEqual(self.public["summary"]["headline"], "No measured test reaches 34% O2 at 8.2 psia in lunar gravity.")

    def test_chart_series_cover_every_limit_point(self):
        chart = self.public["chart"]
        ids = {p["id"]: p for p in self.public["points"]}
        charted = [pid for s in chart for pid in s["points"].values()]
        limit = [p["id"] for p in self.public["points"] if p["kind"] == "limit_value"]
        self.assertEqual(sorted(charted), sorted(limit))
        self.assertEqual([s["id"] for s in chart if s["preliminary"]], ["schechter_nomex"])
        levels = [lv["id"] for lv in self.public["levels"]]
        self.assertEqual(levels, ["1g", "mars", "moon", "0g"])
        for s in chart:
            for level, pid in s["points"].items():
                self.assertEqual(ids[pid]["level"], level)
                self.assertTrue(any(f["name"] == s["field"] for f in ids[pid]["fields"]))

    def test_qualitative_lines_use_only_source_numbers(self):
        allowed = source_numbers(self.source)
        ids = {p["id"] for p in self.public["points"]}
        for line in self.public["qualitative"]:
            self.assertIn(line["point_id"], ids)
            self.assertTrue(line["url"].startswith("https://ntrs.nasa.gov/"))
            for token in NUMBER.findall(line["text"]):
                self.assertIn(float(token), allowed, line["text"])

    def test_corpus_document_carries_quote_and_source_on_every_line(self):
        docs = [d for d in self.corpus if d["psi_id"] == partial_g_site.CORPUS_ID]
        self.assertEqual(len(docs), 1)
        lines = docs[0]["body"].split("\n")
        point_lines = [l for l in lines if "Quote: " in l]
        self.assertEqual(len(point_lines), len(self.public["points"]))
        for line, point in zip(point_lines, self.public["points"]):
            self.assertIn("NTRS " + point["source"]["ntrs_id"], line)
            self.assertIn(point["source"]["url"], line)
            self.assertIn("page %s" % point["quote"]["page"], line)
            self.assertIn(point["quote"]["text"], line)
        for line in lines:
            self.assertLessEqual(len(line), partial_g_site.MAX_LINE_CHARS)
        body = docs[0]["body"]
        self.assertIn("5.6 O2 points", body)
        self.assertIn("not a maximum", body)
        body.encode("ascii")

    def test_lunar_corpus_document_no_longer_reads_the_allowance_as_a_maximum(self):
        lunar = next(d for d in self.corpus if d["psi_id"] == build_site_data.LUNAR_G_CORPUS_ID)
        self.assertNotIn("worst case across these materials", lunar["body"])
        self.assertIn("not a maximum", lunar["body"])

    def test_number_check_reference_covers_partial_g_numbers(self):
        items = _number_check.partial_g_reference(_data_tools)
        self.assertGreater(len(items), 50)
        answer = "Mylar G needs 21.2% O2 at 1 g and 15.6% in lunar gravity, a drop of 5.6 points at 10.2 psia. Nomex has a preliminary LOC of 29% at 8.2 psi."
        result = _number_check.check_answer(answer, items=_number_check.reference_extras(_data_tools))
        self.assertEqual(result["unmatched"], [])
        self.assertEqual(result["matched"], result["total"])
        bad = _number_check.check_answer("Mylar G needs 17.7% O2 on the Moon.", items=_number_check.reference_extras(_data_tools))
        self.assertEqual(bad["unmatched"], ["17.7%"])

    def test_vercel_include_files_stays_short(self):
        with open(os.path.join(ROOT, "vercel.json"), "r", encoding="ascii") as handle:
            config = json.load(handle)
        self.assertLess(len(config["functions"]["api/ask.py"]["includeFiles"]), 256)


if __name__ == "__main__":
    unittest.main()
