import json
import os
import re
from collections import OrderedDict

import verify_partial_g

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCE_PATH = os.path.join(ROOT, "data", "partial_g", "partial_g.json")

CORPUS_ID = "PARTIAL-GRAVITY"
CORPUS_TITLE = "Partial gravity - measured lunar, Martian and microgravity flammability points from 7 NASA sources"
MAX_LINE_CHARS = 420

LEVELS = [
    OrderedDict([("id", "1g"), ("label", "1 g")]),
    OrderedDict([("id", "mars"), ("label", "Mars (0.38 g)")]),
    OrderedDict([("id", "moon"), ("label", "Moon")]),
    OrderedDict([("id", "0g"), ("label", "0 g")]),
]
LEVEL_TOKEN = {"1g": "1g", "martian": "mars", "lunar": "moon", "0g": "0g"}
CHART_FIELD = {"olson2013": "ulois_percent_o2", "schechter2025": "loc_percent_o2"}
CITE = {
    "olson2013": "Olson and Ferkul",
    "luci2025": "LUCI, Ferkul et al.",
    "schechter2025": "Schechter et al.",
    "ferkul2026": "Ferkul et al.",
    "zayac2024": "Zayac et al.",
    "urban2025": "Urban et al.",
    "sacksteder2003": "Sacksteder et al.",
}
MOON_O2_PERCENT = 34
MOON_PRESSURE_PSIA = 8.2
HEADLINE_O2_FLOOR = 33.5
HEADLINE_PRESSURE_CEILING = 8.3
PSIA_PER_ATM = 14.696

PLAIN_LINES = OrderedDict([
    ("luci_pmma_lunar", "LUCI sounding rocket, PMMA rod, simulated lunar gravity: chamber O2 fell from 20% to 14.3% and the flame died after about 6 cm. Not a controlled-O2 limit."),
    ("luci_pmma_1g", "LUCI ground reference, same rod, 1 g: chamber O2 fell from 21% to 14.5% during the burn."),
    ("luci_sibal_lunar", "LUCI, SIBAL fabric, simulated lunar gravity, downward in air: steady spread, flame base 0.92 mm/s."),
    ("ferkul2026_sibal_lunar_aircraft", "Ferkul 2026, SIBAL fabric, aircraft at 0.165 g, 21% O2: steady downward spread for the full 20 s test, 0.086 cm/s."),
    ("ferkul2026_sibal_lunar_centrifuge", "Ferkul 2026, SIBAL fabric, centrifuge drop rig, air at 1 atm: downward spread at 0.11 cm/s."),
    ("zayac2024_sibal_lunar_air", "Zayac 2024, SIBAL fabric burns downward in lunar-gravity air but goes out right after ignition in 1 g. No O2 value is given."),
    ("urban2025_pmma_p213_beefyt_lunar", "Urban 2025, PMMA, tape and cotton T-shirt at 8.2 psia in lunar gravity: a lower O2 limit than extrapolated from 1 g. Values are plot only."),
    ("urban2025_polycarbonate_nomexvelcro_lunar", "Urban 2025, polycarbonate and Nomex Velcro at 8.2 psia in lunar gravity: needed higher O2 than the 1 g data predict. Values are plot only."),
    ("sacksteder2003_kimwipes_kc135", "Sacksteder 2003, thin cellulose tissue on aircraft flights at 0.1, 0.16 and 0.38 g in 21% O2: upward spread varied linearly with gravity. Reduced-pressure air, not a spacecraft material."),
])

NUMBER_RE = re.compile(r"(?<![\w.-])\d+(?:\.\d+)?")


def load_source(path=SOURCE_PATH):
    with open(path, "r", encoding="ascii") as handle:
        return json.load(handle)


def fnum(raw):
    try:
        return float(raw)
    except ValueError:
        return None


def level_of(point_id):
    parts = point_id.split("_")
    if parts[0] == "olson2013":
        return LEVEL_TOKEN[parts[1]], "olson2013_" + "_".join(parts[2:])
    if parts[0] == "schechter":
        return LEVEL_TOKEN[parts[2]], "schechter_nomex"
    return None, None


def primary_quote(point):
    quotes = point["quotes"]
    chart_field = CHART_FIELD.get(point["source_id"])
    for f in point["fields"]:
        if f["name"] == chart_field and f["quote"] in quotes:
            return quotes[f["quote"]]
    if point["fields"] and point["fields"][0]["quote"] in quotes:
        return quotes[point["fields"][0]["quote"]]
    return next(iter(quotes.values()))


def flags_of(point, source):
    flags = []
    kind = source["kind"]
    if "preliminary" in kind:
        flags.append("preliminary")
    if "not peer reviewed" in kind:
        flags.append("not peer reviewed")
    text = point["outcome"] + " " + " ".join(point.get("notes", []))
    if "depletion trace" in text:
        flags.append("chamber O2 depletion trace, not a controlled-O2 limit")
    if "plot only" in text:
        flags.append("values are plot only, not extracted")
    if point["kind"] == "qualitative":
        flags.append("qualitative")
    return flags


def public_source(source):
    keys = ("id", "ntrs_id", "title", "authors", "year", "kind", "url")
    out = OrderedDict((k, source[k]) for k in keys)
    out["cite"] = "%s %d" % (CITE[source["id"]], source["year"])
    return out


def public_field(field):
    out = OrderedDict([("name", field["name"]), ("raw", field["raw"]), ("value", fnum(field["raw"])), ("unit", field["unit"]), ("quote", field["quote"])])
    if field.get("as_stated"):
        out["as_stated"] = field["as_stated"]
    return out


def public_point(point, source):
    level, series = level_of(point["id"])
    quote = primary_quote(point)
    out = OrderedDict()
    out["id"] = point["id"]
    out["kind"] = point["kind"]
    out["source"] = public_source(source)
    out["material"] = point["material"]
    out["gravity_label"] = point["gravity_label"]
    out["flame_direction"] = point["flame_direction"]
    out["sample"] = point["sample"]
    out["outcome"] = point["outcome"]
    out["flags"] = flags_of(point, source)
    out["level"] = level
    out["series"] = series
    out["fields"] = [public_field(f) for f in point["fields"]]
    out["quote"] = OrderedDict([("text", quote["text"]), ("page", quote["page"])])
    out["quotes"] = OrderedDict((name, OrderedDict([("text", q["text"]), ("page", q["page"])])) for name, q in point["quotes"].items())
    out["notes"] = list(point.get("notes", []))
    return out


def field_of(point, name):
    return next((f for f in point["fields"] if f["name"] == name), None)


def pressure_psia(point):
    f = field_of(point, "total_pressure")
    if f is None:
        return None
    if f["unit"] in ("psi", "psia"):
        return fnum(f["raw"])
    if f["unit"] == "atm":
        return fnum(f["raw"]) * PSIA_PER_ATM
    return None


def o2_values(point):
    return [(f, fnum(f["raw"])) for f in point["fields"] if f["unit"] == "percent O2"]


def build_chart(points):
    series = OrderedDict()
    for p in points:
        if p["level"] is None:
            continue
        entry = series.setdefault(p["series"], OrderedDict([
            ("id", p["series"]),
            ("source_id", p["source"]["id"]),
            ("material", p["material"]),
            ("field", CHART_FIELD[p["source"]["id"]]),
            ("preliminary", "preliminary" in p["flags"]),
            ("points", OrderedDict()),
        ]))
        entry["points"][p["level"]] = p["id"]
    out = []
    for entry in series.values():
        entry["points"] = OrderedDict((lv["id"], entry["points"][lv["id"]]) for lv in LEVELS if lv["id"] in entry["points"])
        out.append(entry)
    return out


def build_summary(points, chart):
    by_id = {p["id"]: p for p in points}
    lunar = [p for p in points if "lunar" in p["gravity_label"].lower()]
    best = None
    for p in lunar:
        for f, v in o2_values(p):
            if best is None or v > best[0]:
                best = (v, p, f)
    hits = []
    for p in lunar:
        pr = pressure_psia(p)
        if pr is None or pr > HEADLINE_PRESSURE_CEILING:
            continue
        for f, v in o2_values(p):
            if v >= HEADLINE_O2_FLOOR:
                hits.append(p["id"])
    drops = []
    for s in chart:
        if s["source_id"] != "olson2013":
            continue
        one = by_id[s["points"]["1g"]]
        moon = by_id[s["points"]["moon"]]
        a = field_of(one, s["field"])
        b = field_of(moon, s["field"])
        pr = field_of(one, "total_pressure")
        drops.append(OrderedDict([
            ("material", one["material"]),
            ("one_g_raw", a["raw"]),
            ("lunar_raw", b["raw"]),
            ("points", round(fnum(a["raw"]) - fnum(b["raw"]), 2)),
            ("pressure_psia_raw", pr["raw"]),
            ("point_ids", [one["id"], moon["id"]]),
        ]))
    largest = max(drops, key=lambda d: (d["points"], d["material"]))
    if hits:
        headline = "A measured lunar-gravity test reaches %d%% O2 at %s psia." % (MOON_O2_PERCENT, format(MOON_PRESSURE_PSIA, "g"))
    else:
        headline = "No measured test reaches %d%% O2 at %s psia in lunar gravity." % (MOON_O2_PERCENT, format(MOON_PRESSURE_PSIA, "g"))
    top = best[1]
    top_f = best[2]
    where = top["material"].split(" (")[0]
    if pressure_psia(top) is not None:
        where += ", " + format(pressure_psia(top), "g") + " psi"
    if "preliminary" in top["flags"]:
        where += ", preliminary"
    shown = (top_f["as_stated"].replace("~", "about ")) if top_f.get("as_stated") else top_f["raw"] + "%"
    detail = "Highest lunar-gravity O2 figure in these sources: %s (%s)." % (shown, where)
    return OrderedDict([
        ("headline", headline),
        ("headline_detail", detail),
        ("lunar_o2_max", OrderedDict([("raw", top_f["raw"]), ("value", fnum(top_f["raw"])), ("point_id", top["id"])])),
        ("hits_at_or_below_pressure", hits),
        ("moon_o2_percent", MOON_O2_PERCENT),
        ("threshold", OrderedDict([("o2_percent_min", HEADLINE_O2_FLOOR), ("pressure_psia_max", HEADLINE_PRESSURE_CEILING)])),
        ("ulois_drops_1g_to_lunar", drops),
        ("largest_drop", largest),
    ])


def build_partial_g(path=SOURCE_PATH):
    data = load_source(path)
    errors, counts = verify_partial_g.verify(data)
    if errors:
        raise SystemExit("partial_g quotes failed verification: " + "; ".join(errors))
    sources = {s["id"]: s for s in data["sources"]}
    points = [public_point(p, sources[p["source_id"]]) for p in data["points"]]
    chart = build_chart(points)
    plain = []
    by_id = {p["id"]: p for p in points}
    for pid, text in PLAIN_LINES.items():
        plain.append(OrderedDict([("point_id", pid), ("text", text), ("url", by_id[pid]["source"]["url"]), ("cite", by_id[pid]["source"]["cite"])]))
    return OrderedDict([
        ("meta", OrderedDict([
            ("title", data["meta"]["title"]),
            ("verified_by", data["meta"]["verified_by"]),
            ("points", counts["points"]),
            ("fields", counts["fields"]),
            ("page_numbering", data["meta"]["page_numbering"]),
        ])),
        ("definitions", data["definitions"]),
        ("levels", LEVELS),
        ("points", points),
        ("chart", chart),
        ("qualitative", plain),
        ("summary", build_summary(points, chart)),
    ])


FIELD_LABEL = {"ulois_percent_o2": "ULOI*", "moc_percent_o2": "MOC*", "loc_percent_o2": "LOC"}


def field_text(field):
    name = FIELD_LABEL.get(field["name"], field["name"].replace("_", " "))
    if field.get("as_stated"):
        return "%s = %s" % (name, field["as_stated"])
    return "%s = %s %s" % (name, field["raw"], field["unit"])


def point_line(p, full):
    s = p["source"]
    shown = [field_text(f) for f in p["fields"] if f["name"] not in ("text_ulois_o2", "text_extinguished_o2")]
    flags = ("; flags: " + ", ".join(p["flags"])) if p["flags"] else ""
    material = p["material"] if full else p["material"].split(" (")[0]
    label = p["gravity_label"] if full else p["gravity_label"].split(" (")[0]
    values = "; ".join(shown if full else shown[:4]) if shown else "no numeric value"
    return "%s, %s (NTRS %s, page %s, %s): %s; %s%s. Quote: \"%s\"" % (
        s["cite"], material, s["ntrs_id"], p["quote"]["page"], s["url"], label, values, flags, p["quote"]["text"])


def corpus_document(partial, allowance_points, allowance_materials):
    summary = partial["summary"]
    source_count = len({p["source"]["id"] for p in partial["points"]})
    lines = [
        "Partial-gravity flammability: %d measured points from %d NASA sources (Olson and Ferkul 2012, LUCI 2025, Schechter 2025, Ferkul 2026, Zayac 2024, Urban 2025, Sacksteder 2003). Every number below was checked word for word against its source page. Tests differ in pressure, flow and limit definitions, so the values are never combined or interpolated." % (partial["meta"]["points"], source_count),
        "Definitions (Olson and Ferkul 2012, NTRS 20130010991, page 4): ULOI* is the minimum oxygen concentration where the flame survived the full drop time; MOC* is the maximum oxygen concentration at which the flame self-extinguished during the drop time; the paper calls the limits conservative.",
        summary["headline"] + " " + summary["headline_detail"],
    ]
    d = summary["largest_drop"]
    lines.append("Largest measured 1 g to lunar ULOI* drop: %s, %s to %s percent O2 = %s O2 points at %s psia (Olson and Ferkul 2012, NTRS 20130010991, page 6). NASA Glenn's 2025 allowance for %d materials is up to %s O2 points, so that allowance is not a maximum." % (
        d["material"], d["one_g_raw"], d["lunar_raw"], format(d["points"], "g"), d["pressure_psia_raw"], allowance_materials, format(allowance_points, "g")))
    for p in partial["points"]:
        line = point_line(p, True)
        lines.append(line if len(line) <= MAX_LINE_CHARS else point_line(p, False))
    return {"psi_id": CORPUS_ID, "title": CORPUS_TITLE, "body": "\n".join(lines)}
