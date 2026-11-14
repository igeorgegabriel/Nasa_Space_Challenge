import glob
import json
import os
import re
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import build_unified
from build_models import MIN_PRESSURE

UNIFIED_PATH = os.path.join(ROOT, "data", "unified", "conditions.json")
OUT_PATH = os.path.join(ROOT, "public", "data", "data_health.json")

MAX_PRESSURE = 5.0
MIN_FILLED_CELLS = 4
FRACTION = "fraction"
PERCENT = "percent"
ATM = "atm"
BAR = "bar"
MMHG = "mmHg"
ANY_NUMBER = re.compile(r"(?<![A-Za-z\d.])-?\d+(?:\.\d+)?(?![A-Za-z])")
TO_ATM = {ATM: 1.0, BAR: 1.0 / 1.01325, MMHG: 1.0 / 760.0}

RULES = OrderedDict([
    ("duplicate_row", "Every cell of the row is identical to an earlier row of the same table."),
    ("o2_scale_mismatch", "An oxygen value is written on the other scale from its column: above 1 in a mole-fraction column, or above 100 in a percent column."),
    ("o2_out_of_bounds", "An oxygen value is below 0 or still above 1 after unit handling, and the scale rule does not explain it."),
    ("pressure_out_of_bounds", "Total pressure after conversion to atm is below %s atm or above %s atm." % (MIN_PRESSURE, MAX_PRESSURE)),
    ("negative_flow", "Air flow speed is negative."),
    ("non_numeric_token", "A column the build reads as a number holds text with no number in it, so the build leaves that value empty."),
])

SPECS = {
    "PSI-100_Experimental table_SAFFIRE-3.csv": {"flow": "Air Flow"},
    "PSI-101_Experimental table_SAME-R.csv": {"flow": "Inlet velocity (cm/s)"},
    "PSI-102_Experimental table_SAME.csv": {"flow": "Air Flow (cm/s)"},
    "PSI-107_Experimental table_Spice.csv": {"flow": "Air Rate (cm/s)"},
    "PSI-10_Experimental table_Flame Design_Inverse Flame.csv": {"o2": ("XO2", FRACTION), "pressure": ("pinit (atm)", ATM)},
    "PSI-10_Experimental table_Flame Design_Normal Flame.csv": {"o2": ("XO2 (init)", FRACTION), "pressure": ("pinit (atm)", ATM)},
    "PSI-159_Experimental table_CFI-G_Inverse Flames.csv": {"o2": ("XO2", FRACTION), "pressure": ("approx p (bar)", BAR)},
    "PSI-159_Experimental table_CFI-G_Normal Flames.csv": {"o2": ("XO2 before test", FRACTION), "pressure": ("approx p (bar)", BAR)},
    "PSI-20_Experimental table_ACME BRE.csv": {"o2": ("Oxygen Conc (percent)", PERCENT)},
    "PSI-25_Experimental table_BASS-II.csv": {"o2": ("Calibrated initial O2 % by vol", PERCENT)},
    "PSI-39_Experimental table_CFI.csv": {"o2": ("Oxygen", FRACTION), "pressure": ("Pressure", ATM)},
    "PSI-68_Experimental table_Flex2.csv": {"o2": ("Oxygen Mole Fraction", FRACTION)},
    "PSI-69_Experimental table_FLEX.csv": {"o2": ("O initial ambient composition; mole fraction", FRACTION), "pressure": ("Ambient pressure; mmHg", MMHG)},
    "PSI-98_Experimental table_SAFFIRE-1.csv": {"o2": ("Percent O2", PERCENT), "flow": "Air Flow (cm/s)"},
    "PSI-99_Experimental table_SAFFIRE-2.csv": {"o2": ("Percent O2 (Note 1)", PERCENT), "flow": "Air Flow (cm/s)"},
}


def item(rule, source_file, source_row, column, raw_value, why, psi_id=None, row_id=None):
    return OrderedDict([
        ("rule", rule),
        ("psi_id", psi_id or psi_of(source_file)),
        ("source_file", source_file),
        ("source_row", source_row),
        ("column", column),
        ("raw_value", raw_value),
        ("why", why),
        ("row_id", row_id),
    ])


def psi_of(source_file):
    match = re.match(r"(PSI-\d+)_", source_file)
    return match.group(1) if match else None


def numbers_in(cell):
    return [float(v) for v in ANY_NUMBER.findall(cell or "")]


def scan_duplicates(source_file, rows):
    first = {}
    items = []
    for index, row in enumerate(rows, 1):
        values = tuple(row.values())
        if sum(1 for v in values if v != "") < MIN_FILLED_CELLS:
            continue
        if values in first:
            items.append(item(
                "duplicate_row", source_file, index, "all columns", "same as row %d" % first[values],
                "Every cell matches row %d of the same table." % first[values]))
        else:
            first[values] = index
    return items


def o2_items(source_file, rows, spec):
    column, kind = spec
    items = []
    for index, row in enumerate(rows, 1):
        cell = row.get(column, "")
        if cell == "":
            continue
        values = numbers_in(cell)
        if not values:
            continue
        has_percent_sign = "%" in cell
        for value in values:
            if value < 0:
                items.append(item("o2_out_of_bounds", source_file, index, column, cell,
                                  "Oxygen value %s is negative." % cell))
                break
            if kind == FRACTION:
                if value > 1.0 and value <= 100.0:
                    items.append(item("o2_scale_mismatch", source_file, index, column, cell,
                                      "%s is above 1 in a mole-fraction column; it reads like a percent." % cell))
                    break
                if value > 100.0:
                    items.append(item("o2_out_of_bounds", source_file, index, column, cell,
                                      "%s is above 100 in a mole-fraction column." % cell))
                    break
            else:
                if value > 100.0 and has_percent_sign and value / 100.0 <= 100.0:
                    items.append(item("o2_scale_mismatch", source_file, index, column, cell,
                                      "%s is above 100 percent; it reads like a percent value multiplied by 100 (%g percent)." % (cell, value / 100.0)))
                    break
                if value > 100.0:
                    items.append(item("o2_out_of_bounds", source_file, index, column, cell,
                                      "%s is above 100 percent." % cell))
                    break
    return items


def non_numeric_items(source_file, rows, spec):
    columns = []
    if "o2" in spec:
        columns.append(spec["o2"][0])
    if "pressure" in spec:
        columns.append(spec["pressure"][0])
    if "flow" in spec:
        columns.append(spec["flow"])
    items = []
    for index, row in enumerate(rows, 1):
        for column in columns:
            cell = row.get(column, "")
            if cell != "" and not numbers_in(cell):
                items.append(item("non_numeric_token", source_file, index, column, cell,
                                  "The cell holds text with no number, so the build reads no value for this row."))
    return items


def pressure_items(source_file, rows, spec):
    if "pressure" not in spec:
        return []
    column, unit = spec["pressure"]
    items = []
    for index, row in enumerate(rows, 1):
        cell = row.get(column, "")
        for value in numbers_in(cell):
            atm = value * TO_ATM[unit]
            if atm < MIN_PRESSURE:
                items.append(item("pressure_out_of_bounds", source_file, index, column, cell,
                                  "Recorded pressure %s is %s atm, below the %s atm floor that build_models.py already uses to leave such rows out of the models." % (cell, fmt_atm(atm), MIN_PRESSURE)))
                break
            if atm > MAX_PRESSURE:
                items.append(item("pressure_out_of_bounds", source_file, index, column, cell,
                                  "Recorded pressure %s is %s atm, above %s atm." % (cell, fmt_atm(atm), MAX_PRESSURE)))
                break
    return items


def fmt_atm(atm):
    return ("%.4f" % atm).rstrip("0").rstrip(".")


def flow_items(source_file, rows, spec):
    if "flow" not in spec:
        return []
    column = spec["flow"]
    items = []
    for index, row in enumerate(rows, 1):
        cell = row.get(column, "")
        if any(v < 0 for v in numbers_in(cell)):
            items.append(item("negative_flow", source_file, index, column, cell,
                              "Air flow %s is negative and the table states no sign convention, so its direction is unclear." % cell))
    return items


def scan_table(source_file, rows, spec):
    items = []
    items.extend(scan_duplicates(source_file, rows))
    if "o2" in spec:
        items.extend(o2_items(source_file, rows, spec["o2"]))
    items.extend(non_numeric_items(source_file, rows, spec))
    items.extend(pressure_items(source_file, rows, spec))
    items.extend(flow_items(source_file, rows, spec))
    return items


def attach_row_ids(items, by_file):
    for it in items:
        if it["row_id"] is None:
            urow = by_file.get(it["source_file"], {}).get(it["source_row"])
            it["row_id"] = urow.get("row_id") if urow else None
    return items


def sort_key(it):
    psi = int(re.search(r"\d+", it["psi_id"]).group()) if it["psi_id"] else 0
    return (psi, it["source_file"], it["source_row"], it["column"], it["rule"])


def build(raw_dir=None, unified_rows=None, specs=None):
    raw_dir = raw_dir or build_unified.SRC_DIR
    specs = SPECS if specs is None else specs
    if unified_rows is None:
        with open(UNIFIED_PATH, "r", encoding="ascii") as handle:
            unified_rows = json.load(handle)
    by_file = {}
    for urow in unified_rows:
        by_file.setdefault(urow["source_file"], {})[urow["source_row"]] = urow
    items = []
    tables = 0
    rows_scanned = 0
    for path in sorted(glob.glob(os.path.join(raw_dir, "PSI-*_Experimental table_*.csv"))):
        name = os.path.basename(path)
        rows = build_unified.read_table(path)
        tables += 1
        rows_scanned += len(rows)
        items.extend(scan_table(name, rows, specs.get(name, {})))
    attach_row_ids(items, by_file)
    items.sort(key=sort_key)
    counts = OrderedDict((rule, 0) for rule in RULES)
    for it in items:
        counts[it["rule"]] += 1
    return OrderedDict([
        ("summary", OrderedDict([
            ("tables_scanned", tables),
            ("rows_scanned", rows_scanned),
            ("flagged_items", len(items)),
            ("flagged_rows", len({(it["source_file"], it["source_row"]) for it in items})),
        ])),
        ("rules", OrderedDict((rule, OrderedDict([("description", RULES[rule]), ("count", counts[rule])])) for rule in RULES)),
        ("note", "Flagged by a rule, not confirmed errors. Nothing here guesses a corrected value."),
        ("items", items),
    ])


def dump(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = json.dumps(payload, ensure_ascii=True, indent=1, separators=(",", ": "))
    with open(path, "w", encoding="ascii", newline="\n") as handle:
        handle.write(text + "\n")


def main():
    payload = build()
    dump(OUT_PATH, payload)
    print("items=%d rows=%d %s" % (payload["summary"]["flagged_items"], payload["summary"]["flagged_rows"], dict(Counter(i["rule"] for i in payload["items"]))))


if __name__ == "__main__":
    main()
