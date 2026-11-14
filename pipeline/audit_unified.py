import csv
import glob
import io
import json
import os
import random
import re
import unicodedata
from collections import Counter, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "data", "psi_experimental_tables")
UNIFIED_CSV = os.path.join(ROOT, "data", "unified", "conditions.csv")
SUMMARY_JSON = os.path.join(ROOT, "data", "unified", "summary.json")
OUT_DIR = os.path.join(ROOT, "data", "audit")
SEED = 20261114
SAMPLE_SIZE = 200
SOLID_PSI = {"PSI-25", "PSI-26", "PSI-98", "PSI-99", "PSI-100"}
CLASS_OF = {
    "PSI-26": "solid", "PSI-25": "solid", "PSI-98": "solid", "PSI-99": "solid",
    "PSI-100": "solid", "PSI-69": "liquid_droplet", "PSI-68": "liquid_droplet",
    "PSI-39": "liquid_droplet", "PSI-20": "gas", "PSI-21": "gas", "PSI-22": "gas",
    "PSI-23": "gas", "PSI-10": "gas", "PSI-159": "gas", "PSI-107": "gas",
    "PSI-106": "gas", "PSI-102": "smoke_sample", "PSI-101": "smoke_sample",
    "PSI-47": "aerosol_dust", "PSI-142": "unclassified",
}

O2_COLUMN = {
    "PSI-25": ("Calibrated initial O2 % by vol", "percent"),
    "PSI-98": ("Percent O2", "percent"),
    "PSI-99": ("Percent O2 (Note 1)", "percent"),
    "PSI-69": ("O initial ambient composition; mole fraction", "fraction"),
    "PSI-68": ("Oxygen Mole Fraction", "fraction"),
    "PSI-39": ("Oxygen", "fraction"),
    "PSI-20": ("Oxygen Conc (percent)", "percent"),
    "PSI-23": ("Atmosphere*", "percent"),
    "PSI-10-normal": ("XO2 (init)", "fraction"),
    "PSI-10-inverse": ("XO2", "fraction"),
    "PSI-159-normal": ("XO2 before test", "fraction"),
    "PSI-159-inverse": ("XO2", "fraction"),
}

FUEL_COLUMN = {
    "PSI-26": ("Fuel Sample Material", "exact"),
    "PSI-25": ("Fuel Sample Material", "exact"),
    "PSI-98": ("Material", "exact"),
    "PSI-99": ("Material", "exact"),
    "PSI-100": ("Material", "exact"),
    "PSI-69": ("Fuel", "exact"),
    "PSI-68": ("Sample (Fuel Type)", "exact"),
    "PSI-39": ("Fuel", "exact"),
    "PSI-20": ("Fuel Bottle", "series"),
    "PSI-21": ("Fuel Bottle", "series"),
    "PSI-22": ("Fuel Bottle", "inherit"),
    "PSI-23": ("Fuel Bottle", "series"),
    "PSI-107": ("Fuel", "exact"),
    "PSI-106": ("Fuel Type", "prefix"),
    "PSI-102": ("Sample Material", "prefix"),
    "PSI-101": ("Sample Type", "exact"),
    "PSI-47": ("Sample Material", "exact"),
    "PSI-10-normal": ("Fuel", "exact"),
    "PSI-10-inverse": (None, "const:C2H4"),
    "PSI-159-normal": ("Fuel", "exact"),
    "PSI-159-inverse": ("Fuel", "exact"),
    "PSI-142": (None, "blank"),
}


def ascii_fold(text):
    text = (text or "").replace("\u00b5", "u").replace("\u03bc", "u")
    text = text.replace("\u00b0", " deg").replace("\u2013", "-").replace("\u2014", "-")
    text = unicodedata.normalize("NFKD", text)
    return text.encode("ascii", "ignore").decode("ascii")


def squash(text):
    text = re.sub(r"\s+", " ", ascii_fold(text)).strip()
    return "" if text in ("-", "") else text


def key_of(text):
    return re.sub(r"[^a-z0-9%.]", "", text.lower())


def read_source(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    parsed = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    headers = [squash(h) for h in parsed[0]]
    rows = []
    for r in parsed[1:]:
        r = list(r) + [""] * (len(headers) - len(r))
        rows.append(dict(zip(headers, [squash(c) for c in r])))
    return headers, rows


def variant_of(name, psi_id):
    if psi_id in ("PSI-10", "PSI-159"):
        return psi_id + ("-inverse" if "inverse" in name.lower() else "-normal")
    return psi_id


def expected_o2(row, variant):
    spec = O2_COLUMN.get(variant)
    if not spec:
        return None
    raw = row.get(spec[0], "")
    if not raw:
        return None
    default_percent = spec[1] == "percent"
    if "%" in raw:
        values = []
        for v in re.findall(r"(\d+(?:\.\d+)?)\s*%", raw):
            v = float(v)
            if v > 100:
                v = v / 100.0
            values.append(v)
        scale = 0.01
    else:
        values = [float(v) for v in re.findall(r"\d+\.\d+|\.\d+|\d+", raw)]
        scale = 0.01 if default_percent else 1.0
    if not values:
        return None
    fracs = [v * scale for v in values]
    if max(fracs) > 1.0:
        return None
    return max(fracs), min(fracs)


def first_number(text):
    found = re.search(r"\d+\.\d+|\.\d+|\d+", text or "")
    return float(found.group()) if found else None


def expected_pressure(row, variant):
    if variant in ("PSI-10-normal", "PSI-10-inverse"):
        return first_number(row.get("pinit (atm)", ""))
    if variant == "PSI-39":
        return first_number(row.get("Pressure", ""))
    if variant == "PSI-69":
        v = first_number(row.get("Ambient pressure; mmHg", ""))
        return None if v is None else v / 760.0
    if variant in ("PSI-159-normal", "PSI-159-inverse"):
        v = first_number(row.get("approx p (bar)", ""))
        return None if v is None else v / 1.01325
    if variant == "PSI-23":
        return 1.0
    return None


def expected_outcome(row, variant):
    if variant == "PSI-69":
        return row.get("Test end", "").lower()
    if variant == "PSI-99":
        burn = row.get("Burn Time (s)", "")
        return "insignificant burn" if burn.lower() == "insignificant" else ""
    if variant in ("PSI-159-normal", "PSI-159-inverse"):
        code = (row.get("Self-ext or flow term") or row.get("Self -ext or flow term") or "").upper()
        if code == "SE":
            return "self-extinguished"
        if code == "FT":
            return "flow-terminated"
        low = row.get("Comments", "").lower()
        if "failed to ignite" in low or "not ignited" in low or "no ignition" in low:
            return "failed to ignite"
        if "aborted" in low:
            return "aborted"
        return ""
    return ""


def fuel_ok(unified_fuel, source_row, variant, inherited):
    column, mode = FUEL_COLUMN[variant]
    u = key_of(unified_fuel)
    if mode == "blank":
        return u == "", ""
    if mode.startswith("const:"):
        want = mode.split(":", 1)[1]
        return u == key_of(want), want
    if variant in ("PSI-98", "PSI-99"):
        if source_row.get("Material", "").lower().startswith("pre-test") or \
                source_row.get("Sample Number", "").startswith("Note "):
            return u == "", ""
    src = source_row.get(column, "")
    if mode == "inherit":
        if source_row.get("Test Day"):
            return u == key_of(src), src
        return u == key_of(inherited), inherited
    if mode == "prefix":
        k = key_of(src)
        return (u != "" and k.startswith(u)), src
    if mode == "series":
        k = key_of(re.sub(r"\bCH[5-9]\b", "CH4", re.sub(r"with N[3-9]", "with N2", src)))
        return u == k, src
    return u == key_of(src), src


def load_unified():
    with open(UNIFIED_CSV, "r", encoding="ascii", newline="") as handle:
        return list(csv.DictReader(handle))


def close(a, b, tol):
    return abs(a - b) <= tol


def check_row(urow, sources):
    name = urow["source_file"]
    headers, rows, variant = sources[name]
    index = int(urow["source_row"]) - 1
    problems = []
    if index < 0 or index >= len(rows):
        return ["source_row %s outside source file" % urow["source_row"]]
    srow = rows[index]
    exp = expected_o2(srow, variant)
    if exp is None:
        if urow["o2_frac"] != "":
            problems.append("o2: source has none, unified %s" % urow["o2_frac"])
    else:
        if urow["o2_frac"] == "":
            problems.append("o2: source %s, unified blank" % (exp,))
        else:
            if not close(float(urow["o2_frac"]), exp[0], 2e-6):
                problems.append("o2_frac unified %s expected %.6f" % (urow["o2_frac"], exp[0]))
            if urow["o2_min_frac"] == "" or not close(float(urow["o2_min_frac"]), exp[1], 2e-6):
                problems.append("o2_min_frac unified %s expected %.6f" % (urow["o2_min_frac"], exp[1]))
    pressure = expected_pressure(srow, variant)
    if pressure is None:
        if urow["pressure_atm"] != "":
            problems.append("pressure: source has none, unified %s" % urow["pressure_atm"])
    else:
        if urow["pressure_atm"] == "":
            problems.append("pressure: expected %.6f, unified blank" % pressure)
        elif not close(float(urow["pressure_atm"]), pressure, 2e-6 + 1e-6 * abs(pressure)):
            problems.append("pressure unified %s expected %.6f" % (urow["pressure_atm"], pressure))
    inherited = ""
    if FUEL_COLUMN[variant][1] == "inherit":
        for k in range(index, -1, -1):
            if rows[k].get("Test Day"):
                inherited = rows[k].get("Fuel Bottle", "")
                break
    ok, src = fuel_ok(urow["fuel"], srow, variant, inherited)
    if not ok:
        problems.append("fuel unified '%s' source '%s'" % (urow["fuel"], src))
    outcome = expected_outcome(srow, variant)
    if urow["outcome"] != outcome:
        problems.append("outcome unified '%s' expected '%s'" % (urow["outcome"], outcome))
    return problems


def main():
    unified = load_unified()
    sources = {}
    for path in sorted(glob.glob(os.path.join(SRC_DIR, "PSI-*_Experimental table_*.csv"))):
        name = os.path.basename(path)
        psi_id = re.match(r"(PSI-\d+)_", name).group(1)
        headers, rows = read_source(path)
        sources[name] = (headers, rows, variant_of(name, psi_id))

    checks = OrderedDict()

    per_file = Counter(u["source_file"] for u in unified)
    mism = []
    for name, (headers, rows, variant) in sources.items():
        if per_file.get(name, 0) != len(rows):
            mism.append({"source_file": name, "source_rows": len(rows),
                         "unified_rows": per_file.get(name, 0)})
    for name in per_file:
        if name not in sources:
            mism.append({"source_file": name, "source_rows": None, "unified_rows": per_file[name]})
    checks["1_row_counts_per_source_file"] = {
        "description": "source CSV data rows equal unified rows per source_file",
        "source_rows_total": sum(len(s[1]) for s in sources.values()),
        "unified_rows_total": len(unified), "checked": len(sources),
        "passed": len(sources) - len(mism), "failed": len(mism), "mismatches": mism}

    rng = random.Random(SEED)
    sample_idx = set(rng.sample(range(len(unified)), SAMPLE_SIZE))
    high_o2 = {i for i, u in enumerate(unified) if u["o2_frac"] != "" and float(u["o2_frac"]) >= 0.30}
    solid = {i for i, u in enumerate(unified) if u["fuel_class"] == "solid"}
    groups = OrderedDict([
        ("2a_random_sample_200_seed_%d" % SEED, sample_idx),
        ("2b_all_rows_o2_frac_ge_0.30", high_o2),
        ("2c_all_solid_fuel_rows", solid),
    ])
    union = sample_idx | high_o2 | solid
    union_mism = {}
    for i in sorted(union):
        problems = check_row(unified[i], sources)
        if problems:
            union_mism[i] = problems
    for label, members in groups.items():
        bad = [{"row_id": unified[i]["row_id"], "source_file": unified[i]["source_file"],
                "source_row": int(unified[i]["source_row"]), "problems": union_mism[i]}
               for i in sorted(members) if i in union_mism]
        checks[label] = {
            "description": "re-parse cited source row; compare o2, pressure, fuel, outcome",
            "checked": len(members), "passed": len(members) - len(bad),
            "failed": len(bad), "mismatches": bad}
    checks["2_union_distinct_rows"] = {
        "checked": len(union), "passed": len(union) - len(union_mism), "failed": len(union_mism)}

    with open(SUMMARY_JSON, "r", encoding="ascii") as handle:
        summary = json.load(handle)

    solid_values = []
    class_counts = Counter()
    for name, (headers, rows, variant) in sources.items():
        psi_id = re.match(r"(PSI-\d+)_", name).group(1)
        class_counts[CLASS_OF[psi_id]] += len(rows)
        if psi_id in SOLID_PSI:
            for number, r in enumerate(rows, 1):
                e = expected_o2(r, variant)
                if e is not None:
                    solid_values.append((round(e[0], 6), name, number))
    top_value = max(v for v, n, i in solid_values)
    top_rows = [(n, i) for v, n, i in solid_values if v == top_value]
    unified_solid_o2 = [u for u in unified if u["fuel_class"] == "solid" and u["o2_frac"] != ""]
    unified_top = [u for u in unified_solid_o2 if abs(float(u["o2_frac"]) - top_value) < 1e-9]

    headline = []

    def record(label, source_value, unified_value, summary_value, extra=None):
        entry = {"quantity": label, "recomputed_from_source": source_value,
                 "recomputed_from_unified_csv": unified_value,
                 "summary_json": summary_value,
                 "match": source_value == unified_value == summary_value}
        if extra:
            entry.update(extra)
        headline.append(entry)

    solid_summary = summary["o2_by_fuel_class"]["solid"]
    record("solid_fuel_max_ambient_o2_frac", top_value,
           max(float(u["o2_frac"]) for u in unified_solid_o2), solid_summary["o2_max"],
           {"source_rows_at_max": [{"source_file": n, "source_row": i} for n, i in top_rows],
            "unified_rows_at_max": [{"row_id": u["row_id"], "source_file": u["source_file"],
                                     "source_row": int(u["source_row"]), "o2_raw": u["o2_raw"],
                                     "o2_basis": u["o2_basis"]} for u in unified_top]})
    record("solid_rows_with_o2_recorded", len(solid_values), len(unified_solid_o2),
           solid_summary["o2_known"])
    unified_classes = Counter(u["fuel_class"] or "unclassified" for u in unified)
    for cls in sorted(set(class_counts) | set(unified_classes) | set(summary["counts_by_fuel_class"])):
        record("rows_fuel_class_" + cls, class_counts.get(cls, 0), unified_classes.get(cls, 0),
               summary["counts_by_fuel_class"].get(cls, 0))
    record("total_rows", sum(class_counts.values()), len(unified), summary["total_rows"])
    failed = [h for h in headline if not h["match"]]
    checks["3_headline_numbers"] = {
        "description": "recompute headline numbers from source and compare with summary.json",
        "checked": len(headline), "passed": len(headline) - len(failed), "failed": len(failed),
        "results": headline, "mismatches": failed}

    totals = {"checked": 0, "passed": 0, "failed": 0}
    for key in ("1_row_counts_per_source_file", "2a_random_sample_200_seed_%d" % SEED,
                "2b_all_rows_o2_frac_ge_0.30", "2c_all_solid_fuel_rows", "3_headline_numbers"):
        for field in totals:
            totals[field] += checks[key][field]
    result = OrderedDict([("seed", SEED), ("totals_excluding_union_line", totals), ("checks", checks)])
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "audit.json"), "w", encoding="ascii", newline="\n") as handle:
        json.dump(result, handle, indent=1, ensure_ascii=True)
        handle.write("\n")
    for key, value in checks.items():
        print(key, value.get("checked"), value.get("passed"), value.get("failed"))


if __name__ == "__main__":
    main()
