import json
import os
import re
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import scoring
from build_unified import to_ascii

UNIFIED_DIR = os.path.join(ROOT, "data", "unified")
META_PATH = os.path.join(ROOT, "data", "investigations", "investigations_meta.json")
SITE_DATA_DIR = os.path.join(ROOT, "public", "data")
CORPUS_PATH = os.path.join(ROOT, "api", "context", "corpus.json")

PSI_PAGE = "https://psi.nasa.gov/physci/repo/data/investigations/"
PSI_REPO_URL = "https://github.com/igeorgegabriel/Nasa_Space_Challenge"

PSIA_TO_ATM = 6894.757293168 / 101325.0
COUNTABLE_QUALITY = ("exact", "approximate")
FUEL_CLASS_ORDER = ["solid", "liquid_droplet", "gas", "smoke_sample", "aerosol_dust"]
MAIN_FUEL_CLASSES = ["solid", "liquid_droplet", "gas"]

POINT_TOLERANCE = {"o2": 0.005, "pressure_atm": 0.02, "flow_cm_s": 0.0}

ROUND_O2 = 3
ROUND_PRESSURE = 2
ROUND_FLOW = 1

VARIED_FIELDS = [
    ("fuel", "Fuel", None),
    ("sample_geometry", "Sample geometry or burner", None),
    ("o2_frac", "Oxygen (mole fraction)", ROUND_O2),
    ("o2_basis", "O2 basis (ambient or oxidizer stream)", None),
    ("diluent", "Diluent", None),
    ("pressure_atm", "Pressure (atm)", ROUND_PRESSURE),
    ("flow_cm_s", "Flow speed (cm/s)", ROUND_FLOW),
    ("flow_direction", "Flow direction", None),
    ("ignition", "Ignition", None),
]

SOURCES = OrderedDict([
    ("challenge", {
        "label": "Challenge statement, Space Apps 2026 Flame in Freefall",
        "url": "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/",
    }),
    ("urban", {
        "label": "Urban, NASA Materials Flammability Update, FLARE 2021 (NTRS 20210021181)",
        "url": "https://ntrs.nasa.gov/api/citations/20210021181/downloads/NASA%20Materials%20Flammability%20Update%20update%209.09.2021%20Final.pdf",
    }),
    ("ruff", {
        "label": "Ruff, Tech Dev for Spacecraft Fire Safety, FLARE 2021 (NTRS 20210021318)",
        "url": "https://ntrs.nasa.gov/api/citations/20210021318/downloads/Tech%20Dev%20for%20Spacecraft%20Fire%20Safety_Location_10-7-2021.pdf",
    }),
    ("fortenberry", {
        "label": "Fortenberry et al., fire detection white paper, NASEM decadal survey",
        "url": "https://science.nasa.gov/wp-content/uploads/2023/05/154_33f28c6ef0c27b92cf1f526cef0c44b4_Fire_detection_white_paper_final_211031.pdf",
    }),
    ("ucl", {
        "label": "UCL review of exploration atmospheres (search summary, not opened, lower confidence)",
        "url": "https://discovery.ucl.ac.uk/id/eprint/10146827/1/AA-D-21-01435-uploaded.pdf",
    }),
])

FLOW_ASSUMPTION = "Not documented for this environment in the loaded notes. The lunar habitat HVAC figure is reused as a placeholder."
LUNAR_FLOW = {"min": 10.0, "max": 20.0}


def psia_to_atm(psia):
    return round(psia * PSIA_TO_ATM, 4)


def quantity(lo, hi, display, sources, assumption, note=""):
    return {
        "min": lo,
        "max": hi,
        "display": display,
        "sources": sources,
        "assumption": assumption,
        "note": note,
    }


def lunar_pressure(sources, assumption, note=""):
    lo, hi = psia_to_atm(8.2), psia_to_atm(10.2)
    return quantity(lo, hi, "8.2 to 10.2 psia (56.5 to 70.3 kPa), %.3f to %.3f atm" % (lo, hi), sources, assumption, note)


def lunar_flow(assumption):
    if assumption:
        return quantity(LUNAR_FLOW["min"], LUNAR_FLOW["max"], "10 to 20 cm/s", [], True, FLOW_ASSUMPTION)
    return quantity(
        LUNAR_FLOW["min"], LUNAR_FLOW["max"], "about 10 to 20 cm/s HVAC flow",
        [{"ref": "urban", "detail": "lunar lander and habitat conditions, HVAC flows about 10-20 cm/s"}], False,
    )


def build_environments():
    lunar_o2 = quantity(
        0.28, 0.34, "28 to 34 percent O2",
        [
            {"ref": "ruff", "detail": "atmosphere trade: 10.2 psia with 28 percent O2 or 8.2 psia with 34 percent O2"},
            {"ref": "urban", "detail": "lunar lander and habitat: 8.2 psi, 34 percent or more O2"},
        ],
        False,
    )
    lunar_p = lunar_pressure(
        [
            {"ref": "urban", "detail": "8.2 psi / 56.5 kPa"},
            {"ref": "challenge", "detail": "pressure 10.2 psi or less with 30 percent or more O2"},
        ],
        False,
    )
    lunar_g = {
        "g": 0.16,
        "display": "0.16 g",
        "sources": [{"ref": "urban", "detail": "lunar lander and habitat, g = 0.16 g_earth"}],
        "assumption": False,
        "note": "",
    }
    envs = [
        {
            "id": "iss",
            "name": "ISS / spacecraft cabin",
            "o2": quantity(
                0.21, 0.22, "21 to 22 percent O2", [], True,
                "Air-like cabin. Not stated in the loaded notes; 22.0 percent matches the Saffire IV-1 test card (Urban 2021) as the nearest sourced air-like point.",
            ),
            "pressure_atm": quantity(
                1.0, 1.0, "14.7 psia, 1.000 atm",
                [{"ref": "challenge", "detail": "Earth sea-level pressure 14.7 psi"}], True,
                "ISS cabin pressure itself is not stated in the loaded notes; Earth sea-level pressure is used as a placeholder.",
            ),
            "flow_cm_s": lunar_flow(True),
            "gravity": {
                "g": 0.0, "display": "0 g (free fall)",
                "sources": [{"ref": "challenge", "detail": "flames in free fall (microgravity)"}],
                "assumption": False, "note": "Matches the PSI data directly.",
            },
        },
        {
            "id": "gateway",
            "name": "Gateway-class station",
            "o2": quantity(
                0.265, 0.265, "about 26.5 percent O2",
                [{"ref": "ucl", "detail": "Gateway about 26.5 percent O2 (search summary only)"}], False,
                "Single value, lower confidence: taken from a search summary of the source, not from the opened document.",
            ),
            "pressure_atm": quantity(
                1.0, 1.0, "14.7 psia, 1.000 atm", [], True,
                "Gateway pressure is not stated in the loaded notes; Earth sea-level pressure is used as a placeholder.",
            ),
            "flow_cm_s": lunar_flow(True),
            "gravity": {
                "g": 0.0, "display": "0 g (orbiting station)", "sources": [], "assumption": True,
                "note": "Assumed free-fall habitat; not stated in the loaded notes.",
            },
        },
        {
            "id": "lunar",
            "name": "Lunar surface habitat",
            "o2": lunar_o2,
            "pressure_atm": lunar_p,
            "flow_cm_s": lunar_flow(False),
            "gravity": lunar_g,
        },
        {
            "id": "rover",
            "name": "Pressurized rover",
            "o2": quantity(
                0.30, 0.34, "30 to 34 percent O2",
                [
                    {"ref": "challenge", "detail": "Moon base and pressurized rovers: O2 30 percent or greater"},
                    {"ref": "urban", "detail": "34 percent O2 upper value for lunar vehicles and habitats"},
                ],
                False,
            ),
            "pressure_atm": lunar_pressure(
                [
                    {"ref": "challenge", "detail": "10.2 psi or less for Moon base and pressurized rovers"},
                    {"ref": "urban", "detail": "8.2 psi lower value"},
                ],
                False,
            ),
            "flow_cm_s": lunar_flow(True),
            "gravity": lunar_g,
        },
        {
            "id": "mars",
            "name": "Mars surface habitat",
            "o2": quantity(
                0.28, 0.34, "28 to 34 percent O2", [], True,
                "No Mars habitat atmosphere is given in the loaded notes; the lunar exploration atmosphere range is reused as a placeholder.",
            ),
            "pressure_atm": lunar_pressure(
                [], True,
                "No Mars habitat pressure is given in the loaded notes; the lunar range is reused as a placeholder.",
            ),
            "flow_cm_s": lunar_flow(True),
            "gravity": {
                "g": 0.38, "display": "0.38 g", "sources": [], "assumption": True,
                "note": "Standard value, not stated in the loaded notes.",
            },
        },
    ]
    for env in envs:
        for key, tol in POINT_TOLERANCE.items():
            block = env[key]
            point = block["min"] == block["max"]
            block["window_min"] = round(block["min"] - tol, 6) if point else block["min"]
            block["window_max"] = round(block["max"] + tol, 6) if point else block["max"]
            block["point_value"] = point
        gravity = env["gravity"]
        gravity["bracket_note"] = (
            "All PSI data is microgravity (0 g). Results are bracketed between 0 g and 1 g; "
            "this gravity level lies in the bracket and no partial-gravity value is computed or implied."
            if gravity["g"] > 0 else
            "All PSI data is microgravity (0 g), the same gravity level as this environment."
        )
    return {"environments": envs, "sources": SOURCES}


def load_json(path):
    with open(path, "r", encoding="ascii") as handle:
        return json.load(handle)


def ascii_deep(value):
    if isinstance(value, str):
        return to_ascii(value)
    if isinstance(value, list):
        return [ascii_deep(item) for item in value]
    if isinstance(value, dict):
        return {to_ascii(str(key)): ascii_deep(item) for key, item in value.items()}
    return value


def load_meta():
    if not os.path.exists(META_PATH):
        return {}
    with open(META_PATH, "r", encoding="utf-8-sig") as handle:
        data = json.load(handle)
    if isinstance(data, dict) and "investigations" in data:
        data = data["investigations"]
    if isinstance(data, dict):
        records = []
        for key, value in data.items():
            if isinstance(value, dict):
                value = dict(value)
                value.setdefault("psi_id", key)
                records.append(value)
        data = records
    meta = {}
    for record in data:
        if isinstance(record, dict) and record.get("psi_id"):
            meta[record["psi_id"]] = ascii_deep(record)
    return meta


def strings(value):
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        value = [value]
    out = []
    for item in value:
        if isinstance(item, str):
            if item:
                out.append(item)
        elif isinstance(item, dict):
            if item.get("text"):
                out.append(str(item["text"]))
            elif item.get("value"):
                suffix = " (%s rows)" % item["rows"] if item.get("rows") else ""
                out.append(str(item["value"]) + suffix)
            elif item.get("name"):
                out.append(str(item["name"]))
    return out


def license_text(value):
    if isinstance(value, dict):
        parts = [value.get("id"), value.get("name")]
        return " - ".join(str(p) for p in parts if p)
    return str(value) if value else ""


def slim_publication(pub):
    if isinstance(pub, str):
        return {"title": pub}
    authors = pub.get("authors") or ""
    if isinstance(authors, list):
        authors = ", ".join(str(a) for a in authors)
    url = pub.get("url") or ""
    if not url and pub.get("doi"):
        url = "https://doi.org/" + str(pub["doi"])
    return {
        "title": str(pub.get("title") or ""),
        "authors": str(authors),
        "year": str(pub.get("year") or ""),
        "url": url,
    }


def slim_ntrs(pub):
    if isinstance(pub, str):
        return {"title": pub, "id": "", "url": ""}
    ident = str(pub.get("id") or "")
    authors = pub.get("authors") or ""
    if isinstance(authors, list):
        authors = ", ".join(str(a) for a in authors)
    return {
        "id": ident,
        "title": str(pub.get("title") or ""),
        "authors": str(authors),
        "year": str(pub.get("year") or ""),
        "url": "https://ntrs.nasa.gov/citations/" + ident if ident else "",
    }


def normalize_functions(raw):
    if raw is None:
        return []
    if isinstance(raw, list):
        text = " ".join(str(item) for item in raw)
    else:
        text = str(raw)
    text = text.lower()
    found = []
    for name in ("prevention", "detection", "suppression", "fundamental"):
        if name in text:
            found.append(name)
    return found


def numeric_psi_key(psi_id):
    match = re.search(r"\d+", psi_id)
    return int(match.group()) if match else 0


def range_block(pairs):
    if not pairs:
        return None
    los = [lo for lo, hi, row in pairs]
    his = [hi for lo, hi, row in pairs]
    files = sorted({row["source_file"] for lo, hi, row in pairs})
    source_rows = [row["source_row"] for lo, hi, row in pairs]
    return {
        "min": min(los),
        "max": max(his),
        "n": len(pairs),
        "files": files,
        "source_rows": [min(source_rows), max(source_rows)],
    }


def compute_ranges(rows):
    o2_amb, o2_stream, pressure, flow = [], [], [], []
    for row in rows:
        o2 = row.get("o2_frac")
        if o2 is not None:
            lo = row["o2_min_frac"] if row.get("o2_min_frac") is not None else o2
            if row.get("o2_basis") == "ambient":
                o2_amb.append((lo, o2, row))
            elif row.get("o2_basis") == "oxidizer_stream":
                o2_stream.append((lo, o2, row))
        p = row.get("pressure_atm")
        if p is not None and p > 0:
            pressure.append((p, p, row))
        f = row.get("flow_cm_s")
        if f is not None:
            flow.append((f, f, row))
    return {
        "o2_ambient": range_block(o2_amb),
        "o2_oxidizer_stream": range_block(o2_stream),
        "pressure_atm": range_block(pressure),
        "flow_cm_s": range_block(flow),
    }


def varied_held(rows):
    result = OrderedDict()
    for field, label, rounding in VARIED_FIELDS:
        values = []
        for row in rows:
            value = row.get(field)
            if value is None or (field == "o2_basis" and value == "none"):
                continue
            if rounding is not None:
                value = round(value, rounding)
            values.append(value)
        distinct = sorted({str(v) if rounding is None else v for v in values}, key=lambda v: (isinstance(v, str), v))
        if not values:
            status = "not recorded"
        elif len(distinct) > 1:
            status = "varied"
        else:
            status = "held constant"
        shown = [str(v) for v in distinct[:6]]
        entry = {
            "label": label,
            "status": status,
            "distinct": len(distinct),
            "n": len(values),
            "values": shown,
        }
        if rounding is not None and distinct:
            entry["min"] = distinct[0]
            entry["max"] = distinct[-1]
        result[field] = entry
    return result


def top_values(rows, field, limit):
    counter = Counter(r[field] for r in rows if r.get(field) is not None)
    ordered = sorted(counter.items(), key=lambda item: (-item[1], str(item[0])))
    return [{"value": value, "count": count} for value, count in ordered[:limit]]


def build_investigations(rows, unified, meta):
    by_psi = {}
    for row in rows:
        by_psi.setdefault(row["psi_id"], []).append(row)
    ids = set(unified) | set(meta)
    out = []
    for psi_id in sorted(ids, key=numeric_psi_key):
        base = unified.get(psi_id, {})
        record = meta.get(psi_id, {})
        inv_rows = by_psi.get(psi_id, [])
        functions = normalize_functions(record.get("fire_safety_function"))
        fuel_class = base.get("fuel_class") if base.get("fuel_class") else None
        if fuel_class is None and inv_rows:
            classes = {r["fuel_class"] for r in inv_rows if r.get("fuel_class")}
            fuel_class = sorted(classes)[0] if len(classes) == 1 else None
        outcome_rows = sum(1 for r in inv_rows if r.get("outcome") is not None)
        entry = {
            "psi_id": psi_id,
            "acronym": record.get("acronym") or record.get("short_name") or base.get("investigation") or psi_id,
            "title": record.get("title") or base.get("title") or "",
            "table_name": base.get("investigation") or "",
            "description": record.get("description") or "",
            "objectives": record.get("objectives") or "",
            "hypothesis": record.get("hypothesis") or "",
            "approach": record.get("approach") or "",
            "earth_benefits": record.get("research_impacts_earth_benefits") or "",
            "principal_investigators": strings(record.get("principal_investigators")),
            "platform": record.get("platform") or "",
            "hardware": record.get("hardware") or base.get("hardware") or "",
            "hardware_link": record.get("hardware_link") or base.get("hardware_link") or "",
            "fuel_class": fuel_class,
            "fuels": strings(record.get("fuels")),
            "sample_geometry": strings(record.get("sample_geometry"))[:8],
            "test_conditions_text": record.get("test_conditions_text") or "",
            "diagnostics_measurements": strings(record.get("diagnostics_measurements")),
            "doi": record.get("doi") or "",
            "license": license_text(record.get("license")),
            "psi_url": record.get("psi_url") or (PSI_PAGE + psi_id),
            "publications": [slim_publication(p) for p in (record.get("publications") or [])],
            "ntrs_publications": [slim_ntrs(p) for p in (record.get("ntrs_publications") or [])],
            "fire_safety_function_raw": record.get("fire_safety_function") or "",
            "functions": functions,
            "fire_safety_function_basis": record.get("fire_safety_function_basis") or "",
            "meta_present": psi_id in meta,
            "row_count": len(inv_rows),
            "outcome_rows": outcome_rows,
            "source_files": sorted({r["source_file"] for r in inv_rows}) or base.get("source_files", []),
            "ranges": compute_ranges(inv_rows),
            "varied": varied_held(inv_rows),
            "outcomes": top_values(inv_rows, "outcome", 12),
            "fuels_observed": top_values(inv_rows, "fuel", 8),
            "diluents_observed": top_values(inv_rows, "diluent", 6),
            "value_quality": top_values(inv_rows, "value_quality", 6),
        }
        out.append(entry)
    return out


def slim_conditions(rows):
    slim = []
    for row in rows:
        slim.append({k: v for k, v in row.items() if v is not None})
    return slim


def in_window(value, lo, hi):
    return value is not None and lo <= value <= hi


def countable(rows):
    return [r for r in rows if r.get("value_quality") in COUNTABLE_QUALITY]


def fmt_o2(value):
    return ("%.3f" % value).rstrip("0").rstrip(".") if value is not None else "n/a"


def win(env, key):
    return env[key]["window_min"], env[key]["window_max"]


def window_filter_params(env, with_pressure):
    params = {
        "env": env["id"],
        "basis": "ambient",
        "quality": ",".join(COUNTABLE_QUALITY),
        "o2min": env["o2"]["window_min"],
        "o2max": env["o2"]["window_max"],
    }
    if with_pressure:
        params["pmin"] = env["pressure_atm"]["window_min"]
        params["pmax"] = env["pressure_atm"]["window_max"]
    return params


def build_insights(rows, environments):
    ok_rows = countable(rows)
    insights = []

    ambient = [r for r in ok_rows if r.get("o2_basis") == "ambient" and r.get("o2_frac") is not None]
    max_by_class = OrderedDict()
    for fc in FUEL_CLASS_ORDER:
        subset = [r for r in ambient if r.get("fuel_class") == fc]
        if not subset:
            continue
        top = max(subset, key=lambda r: (r["o2_frac"], r["psi_id"], r["source_row"]))
        max_by_class[fc] = {
            "max_o2": top["o2_frac"],
            "rows_with_o2": len(subset),
            "psi_id": top["psi_id"],
            "source_file": top["source_file"],
            "source_row": top["source_row"],
        }
    solid_total = sum(1 for r in rows if r.get("fuel_class") == "solid")
    solid_with_o2 = sum(1 for r in rows if r.get("fuel_class") == "solid" and r.get("o2_frac") is not None)
    lunar = next(e for e in environments["environments"] if e["id"] == "lunar")
    solid_max = max_by_class["solid"]["max_o2"]
    parts = ["%s %s (%s row %d)" % (
        fc.replace("_", " "), fmt_o2(v["max_o2"]), v["psi_id"], v["source_row"]) for fc, v in max_by_class.items()]
    text = (
        "Highest ambient O2 tested per fuel class: " + "; ".join(parts) + ". "
        "No solid-fuel row in the table has ambient O2 above %s, which is below the %s to %s range of the lunar surface habitat profile."
        % (fmt_o2(solid_max), fmt_o2(lunar["o2"]["min"]), fmt_o2(lunar["o2"]["max"]))
    )
    excluded = len(rows) - len(ok_rows)
    insights.append({
        "id": "max_o2_by_fuel_class",
        "title": "Highest ambient O2 tested, by fuel class",
        "text": text,
        "numbers": {
            "max_by_fuel_class": max_by_class,
            "solid_rows": solid_total,
            "solid_rows_with_o2": solid_with_o2,
            "lunar_o2_min": lunar["o2"]["min"],
            "rows_excluded_quality": excluded,
        },
        "links": [
            {"label": "Solid fuel rows with ambient O2", "params": {
                "fuel": "solid", "basis": "ambient", "o2min": 0, "o2max": 1, "quality": ",".join(COUNTABLE_QUALITY)}},
            {"label": "All ambient O2 rows", "params": {
                "basis": "ambient", "o2min": 0, "o2max": 1, "quality": ",".join(COUNTABLE_QUALITY)}},
        ],
        "limits": (
            "Ambient O2 only (burner and oxidizer-stream O2 is a different quantity). Rows of quality exact or approximate; "
            "%d summary_row, ramped and range rows are excluded because one number cannot represent them. "
            "Only %d of %d solid-fuel rows record an O2 value. Flights outside the PSI tables (for example Saffire IV to VI) are not counted."
            % (excluded, solid_with_o2, solid_total)
        ),
    })

    stream = [r for r in ok_rows if r.get("o2_basis") == "oxidizer_stream" and r.get("o2_frac") is not None]
    top_stream = max(stream, key=lambda r: (r["o2_frac"], r["psi_id"], r["source_row"]))
    top_ambient = max(ambient, key=lambda r: (r["o2_frac"], r["psi_id"], r["source_row"]))
    hi_amb = sum(1 for r in ambient if r["o2_frac"] >= 0.30)
    hi_stream = sum(1 for r in stream if r["o2_frac"] >= 0.30)
    insights.append({
        "id": "stream_vs_ambient_o2",
        "title": "Ambient and oxidizer-stream O2 are different quantities",
        "text": (
            "Highest ambient O2 in the table is %s (%s row %d); highest oxidizer-stream O2 is %s (%s row %d). "
            "Rows at 0.30 or above: %d ambient, %d oxidizer-stream."
            % (fmt_o2(top_ambient["o2_frac"]), top_ambient["psi_id"], top_ambient["source_row"],
               fmt_o2(top_stream["o2_frac"]), top_stream["psi_id"], top_stream["source_row"], hi_amb, hi_stream)
        ),
        "numbers": {
            "max_ambient_o2": top_ambient["o2_frac"],
            "max_stream_o2": top_stream["o2_frac"],
            "rows_ge_030_ambient": hi_amb,
            "rows_ge_030_stream": hi_stream,
        },
        "links": [
            {"label": "Oxidizer-stream rows", "params": {"basis": "oxidizer_stream", "quality": ",".join(COUNTABLE_QUALITY)}},
            {"label": "Ambient rows at 0.30 or above", "params": {
                "basis": "ambient", "o2min": 0.3, "o2max": 1, "quality": ",".join(COUNTABLE_QUALITY)}},
        ],
        "limits": (
            "Oxidizer-stream O2 is the O2 fraction in the gas flowing out of a burner into a different chamber gas, "
            "so it does not describe a cabin atmosphere. It is never mixed with ambient O2 in the ranking unless the user switches it on."
        ),
    })

    window_counts = OrderedDict()
    for env in environments["environments"]:
        o2lo, o2hi = win(env, "o2")
        plo, phi = win(env, "pressure_atm")
        o2_rows = [r for r in ambient if in_window(r["o2_frac"], o2lo, o2hi)]
        both = [r for r in o2_rows if r.get("pressure_atm") is not None and r["pressure_atm"] > 0
                and in_window(r["pressure_atm"], plo, phi)]
        by_class = OrderedDict()
        for fc in MAIN_FUEL_CLASSES:
            by_class[fc] = {
                "o2_window": sum(1 for r in o2_rows if r.get("fuel_class") == fc),
                "o2_and_pressure_window": sum(1 for r in both if r.get("fuel_class") == fc),
            }
        window_counts[env["id"]] = {
            "name": env["name"],
            "o2_window_rows": len(o2_rows),
            "o2_and_pressure_window_rows": len(both),
            "o2_window_investigations": sorted({r["psi_id"] for r in o2_rows}, key=numeric_psi_key),
            "by_fuel_class": by_class,
        }
    sentences = []
    for env in environments["environments"]:
        wc = window_counts[env["id"]]
        sentences.append("%s: %d rows with ambient O2 inside the window, %d also inside the pressure window"
                         % (wc["name"], wc["o2_window_rows"], wc["o2_and_pressure_window_rows"]))
    insights.append({
        "id": "rows_per_environment_window",
        "title": "Rows inside each environment window",
        "text": "; ".join(sentences) + ".",
        "numbers": {"windows": window_counts},
        "links": [
            {"label": "%s: O2 window" % env["name"], "params": window_filter_params(env, False)}
            for env in environments["environments"] if env["id"] in ("lunar", "iss")
        ] + [
            {"label": "Lunar surface habitat: O2 and pressure window",
             "params": window_filter_params(lunar, True)},
        ],
        "limits": (
            "A window is the O2 range and pressure range of the environment profile, which for some environments is an assumption "
            "(see Habitat Relevance). Counts use ambient O2 rows of quality exact or approximate. "
            "A row inside the window is a test at that condition in microgravity, not evidence about a partial-gravity fire."
        ),
    })

    gaps = OrderedDict()
    for env in environments["environments"]:
        wc = window_counts[env["id"]]
        zero_o2 = [fc for fc in MAIN_FUEL_CLASSES if wc["by_fuel_class"][fc]["o2_window"] == 0]
        zero_both = [fc for fc in MAIN_FUEL_CLASSES if wc["by_fuel_class"][fc]["o2_and_pressure_window"] == 0]
        flo, fhi = win(env, "flow_cm_s")
        o2lo, o2hi = win(env, "o2")
        flow_rows = [r for r in ambient if in_window(r["o2_frac"], o2lo, o2hi) and in_window(r.get("flow_cm_s"), flo, fhi)]
        gaps[env["id"]] = {
            "name": env["name"],
            "fuel_classes_zero_o2_window": zero_o2,
            "fuel_classes_zero_o2_pressure_window": zero_both,
            "rows_o2_and_flow_window": len(flow_rows),
        }
    all_three = [r for r in ok_rows if r.get("o2_frac") is not None and r.get("pressure_atm") is not None
                 and r["pressure_atm"] > 0 and r.get("flow_cm_s") is not None]
    gap_sentences = []
    for env in environments["environments"]:
        g = gaps[env["id"]]
        zero = g["fuel_classes_zero_o2_pressure_window"]
        if len(zero) == len(MAIN_FUEL_CLASSES):
            zero_text = "every main fuel class (solid, liquid droplet, gas)"
        else:
            zero_text = ", ".join(c.replace("_", " ") for c in zero) or "no main fuel class"
        gap_sentences.append("%s: zero rows inside both the O2 and pressure window for %s" % (g["name"], zero_text))
    insights.append({
        "id": "coverage_gaps",
        "title": "Coverage gaps per environment",
        "text": "; ".join(gap_sentences) + ". Rows that record O2, pressure and flow speed together: %d." % len(all_three),
        "numbers": {"gaps": gaps, "rows_o2_pressure_flow_all_recorded": len(all_three)},
        "links": [
            {"label": "Lunar surface habitat: O2 and pressure window", "params": window_filter_params(lunar, True)},
            {"label": "Rows with a flow speed", "params": {"fmin": 0, "fmax": 1000, "quality": ",".join(COUNTABLE_QUALITY)}},
        ],
        "limits": (
            "Zero rows means no test in the PSI tables at that combination, not that the combination is unsafe or safe. "
            "O2, pressure and flow are recorded in different investigations, so a joint window rarely has any rows."
        ),
    })

    with_both = [r for r in rows if r.get("o2_frac") is not None and r.get("outcome") is not None]
    by_inv = Counter(r["psi_id"] for r in with_both)
    inv_list = sorted(by_inv.items(), key=lambda item: (-item[1], numeric_psi_key(item[0])))
    by_inv_text = ", ".join("%s %d" % (pid, n) for pid, n in inv_list)
    insights.append({
        "id": "o2_with_outcome",
        "title": "Investigations with both an O2 value and an outcome",
        "text": "%d rows in %d investigations record both an O2 value and an outcome label (%s)."
                % (len(with_both), len(by_inv), by_inv_text),
        "numbers": {
            "rows": len(with_both),
            "investigations": len(by_inv),
            "by_investigation": OrderedDict(inv_list),
            "by_o2_basis": dict(sorted(Counter(r.get("o2_basis") for r in with_both).items())),
        },
        "links": [{"label": "Rows with O2 and an outcome", "params": {"o2min": 0, "o2max": 1, "outcome": 1}}],
        "limits": (
            "Outcome labels are those given in each PSI table (for example extinction, self-extinguished, flow-terminated) "
            "and are not harmonized into one quantity such as MOC, LOI or ULOI. Only rows with both fields can feed a flammability model."
        ),
    })
    return {"insights": insights}


EARTH = [
    {
        "id": "water_mist",
        "application": "Fine-water-mist extinguishers",
        "status": "documented spinoff",
        "statement": "Fine-water-mist extinguishers developed for use on the ISS have practical applications on Earth.",
        "psi_ids": [],
        "inference_psi_ids": ["PSI-69", "PSI-68"],
        "inference": "FLEX and FLEX-2 measure how diluents extinguish burning droplets and are the nearest PSI suppression data. No PSI table is a water-mist test, so this link is an inference.",
        "sources": [{"label": "Challenge statement", "url": "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/"}],
    },
    {
        "id": "smoke_dust_detector",
        "application": "Smoke detector that tells smoke from dust",
        "status": "documented spinoff",
        "statement": "A 1970s smoke detector developed for the shuttle discriminates smoke from dust, giving fewer nuisance alarms, with industrial uses such as mining.",
        "psi_ids": ["PSI-102", "PSI-101", "PSI-47"],
        "inference_psi_ids": [],
        "inference": "Documented in the challenge statement: an instrument used for smoke detection in SAME and SAME-R was used to detect dust in DAFT and DAFT-2. The 1970s shuttle detector itself predates these investigations, so the spinoff is historical and the link to the PSI tables is the instrument reuse only.",
        "sources": [
            {"label": "NASA Spinoff: Fire Detector", "url": "https://spinoff.nasa.gov/node/9407"},
            {"label": "Challenge statement", "url": "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/"},
        ],
    },
    {
        "id": "firefighter_air_tanks",
        "application": "Firefighter air tanks and breathing gear",
        "status": "documented spinoff",
        "statement": "A 1970s adaptation of spacesuit technology improved firefighter air tanks and breathing gear.",
        "psi_ids": [],
        "inference_psi_ids": [],
        "inference": "No PSI combustion investigation is linked: this is spacesuit hardware history, not combustion data.",
        "sources": [{"label": "NASA Spinoff: Fireman's Air Tanks", "url": "https://spinoff.nasa.gov/node/9582"}],
    },
    {
        "id": "firefighter_clothing",
        "application": "Firefighter protective clothing",
        "status": "documented spinoff",
        "statement": "A 1980s application of NASA spacesuit technology improved firefighter clothing.",
        "psi_ids": [],
        "inference_psi_ids": [],
        "inference": "No PSI combustion investigation is linked: this is spacesuit materials history. Fabric flammability tests in the PSI tables (Saffire, BASS) address spacecraft materials, not firefighter clothing.",
        "sources": [{"label": "NASA Spinoff: New Technology for the Fire Attire", "url": "https://spinoff.nasa.gov/node/9918"}],
    },
]


def source_text(block):
    if not block:
        return "no recorded values"
    rows = block["source_rows"]
    return "n=%d, rows %d-%d, %s" % (block["n"], rows[0], rows[1], "; ".join(block["files"]))


def as_text(value):
    if isinstance(value, list):
        return "; ".join(as_text(v) for v in value if v)
    if isinstance(value, dict):
        return "; ".join("%s: %s" % (k, as_text(v)) for k, v in value.items() if v)
    return str(value) if value else ""


def range_line(label, block, unit):
    if not block:
        return "%s: not recorded." % label
    return "%s: %s to %s %s (%s)." % (label, fmt_num(block["min"]), fmt_num(block["max"]), unit, source_text(block))


def fmt_num(value):
    return ("%.4f" % value).rstrip("0").rstrip(".")


def build_corpus(investigations, rankings):
    docs = []
    for inv in investigations:
        lines = []
        lines.append("Investigation %s (%s): %s." % (inv["psi_id"], inv["acronym"], inv["title"]))
        for key, label in (
            ("description", "Description"), ("objectives", "Objectives"),
            ("hypothesis", "Hypothesis"), ("approach", "Approach"),
            ("principal_investigators", "Principal investigators"), ("platform", "Platform"),
            ("hardware", "Hardware"), ("fuels", "Fuels"), ("sample_geometry", "Sample geometry"),
            ("test_conditions_text", "Test conditions"), ("diagnostics_measurements", "Diagnostics and measurements"),
        ):
            text = as_text(inv.get(key))
            if text:
                lines.append("%s: %s" % (label, text))
        lines.append("Fuel class in the unified table: %s." % (inv["fuel_class"] or "unclassified"))
        if inv["fuels_observed"]:
            lines.append("Fuels observed in table rows: %s." % ", ".join(
                "%s (%d)" % (f["value"], f["count"]) for f in inv["fuels_observed"]))
        if inv["row_count"]:
            lines.append("Rows in the unified conditions table: %d (outcome recorded in %d)." % (inv["row_count"], inv["outcome_rows"]))
            lines.append(range_line("Ambient O2 tested (mole fraction)", inv["ranges"]["o2_ambient"], ""))
            lines.append(range_line("Oxidizer-stream O2 tested (mole fraction, a different quantity)", inv["ranges"]["o2_oxidizer_stream"], ""))
            lines.append(range_line("Pressure tested", inv["ranges"]["pressure_atm"], "atm"))
            lines.append(range_line("Flow speed tested", inv["ranges"]["flow_cm_s"], "cm/s"))
            for field, entry in inv["varied"].items():
                if entry["status"] == "varied":
                    lines.append("%s: varied, %d distinct values (%s)." % (entry["label"], entry["distinct"], ", ".join(entry["values"])))
                elif entry["status"] == "held constant":
                    lines.append("%s: held constant at %s." % (entry["label"], entry["values"][0]))
                else:
                    lines.append("%s: not recorded in the table." % entry["label"])
            if inv["outcomes"]:
                lines.append("Outcomes recorded: %s." % ", ".join("%s (%d)" % (o["value"], o["count"]) for o in inv["outcomes"]))
        else:
            lines.append("This investigation has no rows in the unified conditions table.")
        if inv["functions"]:
            lines.append("Fire-safety function: %s. Basis: %s" % (", ".join(inv["functions"]), inv["fire_safety_function_basis"]))
        else:
            lines.append("Fire-safety function: unassigned.")
        for env_id, ranking in rankings.items():
            for item in ranking:
                if item["psi_id"] == inv["psi_id"]:
                    lines.append("Habitat relevance, default weights, environment %s: rank %d of %d, score %.3f."
                                 % (env_id, item["rank"], len(ranking), item["score"]))
        pubs = ["%s (%s)" % (p["title"], p["year"] or "year n/a") for p in inv["publications"][:12]]
        pubs += ["%s [NTRS %s]" % (p["title"], p["id"]) for p in inv["ntrs_publications"]]
        pubs = [p for p in pubs if p.strip()]
        if pubs:
            lines.append("Publications: " + "; ".join(pubs))
        if inv["earth_benefits"]:
            lines.append("Research impact and Earth benefits (PSI record): %s" % inv["earth_benefits"])
        if inv["doi"]:
            lines.append("DOI: %s." % inv["doi"])
        lines.append("PSI record: %s." % inv["psi_url"])
        docs.append({
            "psi_id": inv["psi_id"],
            "title": "%s %s - %s" % (inv["psi_id"], inv["acronym"], inv["title"]),
            "body": "\n".join(lines),
        })
    return {"documents": docs}


def build_rank_reference(investigations, environments):
    reference = OrderedDict()
    reference["weights"] = scoring.DEFAULT_WEIGHTS
    reference["perturbation"] = scoring.PERTURBATION
    variants = OrderedDict()
    for name, include_stream in (("default", False), ("with_stream", True)):
        per_env = OrderedDict()
        for env in environments["environments"]:
            ranking = scoring.rank_all(investigations, env, scoring.DEFAULT_WEIGHTS, include_stream)
            stability = scoring.rank_stability(investigations, env, scoring.DEFAULT_WEIGHTS, include_stream)
            per_env[env["id"]] = {"ranking": ranking, "stability": stability}
        variants[name] = per_env
    reference["variants"] = variants
    return reference


def dump(path, obj, indent=1):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = json.dumps(obj, sort_keys=True, ensure_ascii=True, indent=indent, separators=(",", ": ") if indent else (",", ":"))
    with open(path, "w", encoding="ascii", newline="\n") as handle:
        handle.write(text + "\n")


def dump_rows(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = [json.dumps(r, sort_keys=True, ensure_ascii=True, separators=(",", ":")) for r in rows]
    with open(path, "w", encoding="ascii", newline="\n") as handle:
        handle.write("[\n" + ",\n".join(lines) + "\n]\n")


def build():
    rows = load_json(os.path.join(UNIFIED_DIR, "conditions.json"))
    unified = load_json(os.path.join(UNIFIED_DIR, "investigations.json"))
    meta = load_meta()
    environments = build_environments()
    investigations = build_investigations(rows, unified, meta)
    insights = build_insights(rows, environments)
    reference = build_rank_reference(investigations, environments)
    default_rankings = {
        env_id: data["ranking"] for env_id, data in reference["variants"]["default"].items()
    }
    corpus = build_corpus(investigations, default_rankings)
    return {
        "investigations": investigations,
        "conditions": slim_conditions(rows),
        "environments": environments,
        "insights": insights,
        "earth": {"applications": EARTH},
        "rank_reference": reference,
        "corpus": corpus,
        "meta_present": bool(meta),
    }


def main():
    result = build()
    dump(os.path.join(SITE_DATA_DIR, "investigations.json"), {"investigations": result["investigations"], "meta_present": result["meta_present"], "repo_url": PSI_REPO_URL})
    dump_rows(os.path.join(SITE_DATA_DIR, "conditions.json"), result["conditions"])
    dump(os.path.join(SITE_DATA_DIR, "environments.json"), result["environments"])
    dump(os.path.join(SITE_DATA_DIR, "insights.json"), result["insights"])
    dump(os.path.join(SITE_DATA_DIR, "earth.json"), result["earth"])
    dump(os.path.join(SITE_DATA_DIR, "rank_reference.json"), result["rank_reference"])
    dump(CORPUS_PATH, result["corpus"])
    print("investigations=%d rows=%d meta=%s documents=%d" % (
        len(result["investigations"]), len(result["conditions"]), result["meta_present"], len(result["corpus"]["documents"])))


if __name__ == "__main__":
    main()
