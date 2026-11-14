import json
import os
import re
import shutil
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import outside_psi
import scoring
import verify_lunar_g
from build_unified import to_ascii

UNIFIED_DIR = os.path.join(ROOT, "data", "unified")
META_PATH = os.path.join(ROOT, "data", "investigations", "investigations_meta.json")
PROFILE_PATH = os.path.join(ROOT, "data", "environment_profiles.json")

PROFILE_ID_MAP = {
    "lunar_habitat": "lunar",
    "pressurized_rover": "rover",
    "mars_habitat": "mars",
}
SITE_DATA_DIR = os.path.join(ROOT, "public", "data")
SITE_IMG_DIR = os.path.join(ROOT, "public", "img")
FINDINGS_PATH = os.path.join(ROOT, "data", "findings", "key_findings.json")
FINDINGS_VERIFICATION_PATH = os.path.join(ROOT, "data", "findings", "verification.json")
IMAGES_PATH = os.path.join(ROOT, "data", "images", "images.json")
AUDIT_PATH = os.path.join(ROOT, "data", "audit", "audit.json")
CHALLENGE_NOTES_PATH = os.path.join(ROOT, "data", "challenge_notes.json")
NOT_SPECIFIED_TEXT = "not specified by NASA sources"
PSIA_PER_ATM = 14.6959
CORPUS_PATH = os.path.join(ROOT, "api", "context", "corpus.json")

PSI_PAGE = "https://psi.nasa.gov/physci/repo/data/investigations/"
PSI_REPO_URL = "https://github.com/igeorgegabriel/Nasa_Space_Challenge"
EVAL_SUMMARY_PATH = os.path.join(ROOT, "eval", "results", "ask_eval_summary.json")
EVAL_SET_PATH = os.path.join(ROOT, "eval", "ask_eval_set.json")
EVAL_URL = PSI_REPO_URL + "/tree/main/eval"

PSIA_TO_ATM = 6894.757293168 / 101325.0
COUNTABLE_QUALITY = ("exact", "approximate")
FUEL_CLASS_ORDER = ["solid", "liquid_droplet", "gas", "smoke_sample", "aerosol_dust"]
MAIN_FUEL_CLASSES = ["solid", "liquid_droplet", "gas"]

POINT_TOLERANCE = {"o2": 0.005, "pressure_atm": 0.02, "flow_cm_s": 0.0}

VALUE_DIGITS = 6
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


def builtin_environments():
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
    return envs


def fmt_display(lo, hi, unit):
    if lo == hi:
        return "%s %s" % (fmt_num(lo), unit)
    return "%s to %s %s" % (fmt_num(lo), fmt_num(hi), unit)


def normalize_quantity(block, unit):
    lo = float(block["min"])
    hi = float(block["max"])
    sources = list(block.get("sources") or [])
    if "assumption" in block:
        assumption = bool(block["assumption"])
    else:
        assumption = not sources
    return {
        "min": lo,
        "max": hi,
        "display": block.get("display") or fmt_display(lo, hi, unit),
        "sources": sources,
        "assumption": assumption,
        "note": block.get("note") or "",
    }


def normalize_gravity(block):
    g = float(block["g"])
    sources = list(block.get("sources") or [])
    return {
        "g": g,
        "display": block.get("display") or ("%s g" % fmt_num(g)),
        "sources": sources,
        "assumption": bool(block["assumption"]) if "assumption" in block else not sources,
        "note": block.get("note") or "",
    }


QUANTITY_UNITS = (("o2", "mole fraction O2"), ("pressure_atm", "atm"), ("flow_cm_s", "cm/s"))


def load_profile_file(path):
    if not path or not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8-sig") as handle:
        data = json.load(handle)
    data = ascii_deep(data)
    if isinstance(data, list):
        return {"environments": data, "sources": {}}
    return {"environments": data.get("environments") or [], "sources": data.get("sources") or {}}


def strip_placeholder_sentences(note):
    parts = re.split(r"(?<=[.])\s+", str(note or ""))
    kept = [p for p in parts if "placeholder" not in p.lower() and "borrowed" not in p.lower()]
    return " ".join(kept).strip()


def not_specified_block(block):
    return {
        "min": None,
        "max": None,
        "display": NOT_SPECIFIED_TEXT,
        "sources": list((block or {}).get("sources") or []),
        "not_specified": True,
        "note": strip_placeholder_sentences((block or {}).get("note")),
    }


def finalize_environment(env):
    for key, unit in QUANTITY_UNITS:
        block = env[key]
        if block.get("not_specified") or block.get("assumption") or block.get("min") is None or block.get("max") is None:
            env[key] = not_specified_block(block)
        else:
            block.pop("assumption", None)
            block["not_specified"] = False
    gravity = env["gravity"]
    if gravity.get("assumption") or gravity.get("g") is None:
        env["gravity"] = {
            "g": None, "display": NOT_SPECIFIED_TEXT, "sources": list(gravity.get("sources") or []),
            "not_specified": True, "note": strip_placeholder_sentences(gravity.get("note")),
        }
    else:
        gravity.pop("assumption", None)
        gravity["not_specified"] = False


def apply_profiles(envs, sources, profile):
    by_id = {env["id"]: env for env in envs}
    for entry in profile["environments"]:
        env_id = PROFILE_ID_MAP.get(entry.get("id"), entry.get("id"))
        env = by_id.get(env_id)
        if env is None:
            continue
        if entry.get("name"):
            env["name"] = entry["name"]
        for key, unit in QUANTITY_UNITS:
            block = entry.get(key)
            if isinstance(block, dict) and (block.get("not_specified") or block.get("min") is None or block.get("max") is None):
                env[key] = not_specified_block(block)
            elif isinstance(block, dict):
                env[key] = normalize_quantity(block, unit)
        if isinstance(entry.get("gravity"), dict) and entry["gravity"].get("g") is not None:
            env["gravity"] = normalize_gravity(entry["gravity"])
    merged = OrderedDict(sources)
    for key, value in profile["sources"].items():
        merged[key] = value
    for entry in profile["environments"]:
        for block in entry.values():
            if not isinstance(block, dict):
                continue
            for source in block.get("sources") or []:
                ref = source.get("ref")
                if ref and ref not in merged:
                    merged[ref] = {"label": source.get("title") or ref, "url": source.get("url") or ""}
    return merged


def build_environments(profile_path=PROFILE_PATH):
    envs = builtin_environments()
    sources = SOURCES
    profile = load_profile_file(profile_path)
    if profile:
        sources = apply_profiles(envs, SOURCES, profile)
    for env in envs:
        finalize_environment(env)
        for key, tol in POINT_TOLERANCE.items():
            block = env[key]
            if block["not_specified"]:
                block["window_min"] = None
                block["window_max"] = None
                block["point_value"] = False
                continue
            point = block["min"] == block["max"]
            block["window_min"] = round(block["min"] - tol, 6) if point else block["min"]
            block["window_max"] = round(block["max"] + tol, 6) if point else block["max"]
            block["point_value"] = point
        gravity = env["gravity"]
        if gravity["g"] is None:
            gravity["bracket_note"] = ""
        elif gravity["g"] > 0:
            gravity["bracket_note"] = (
                "All PSI data is microgravity (0 g). Results are bracketed between 0 g and 1 g; "
                "this gravity level lies in the bracket and no partial-gravity value is computed or implied."
            )
        else:
            gravity["bracket_note"] = "All PSI data is microgravity (0 g), the same gravity level as this environment."
    return {"environments": envs, "sources": sources}


def load_json(path):
    with open(path, "r", encoding="ascii") as handle:
        return json.load(handle)


def ascii_deep(value):
    if isinstance(value, str):
        return to_ascii(value.replace("\ufffd", "-"))
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


FUNCTION_NAMES = ("prevention", "detection", "suppression", "fundamental")
SOURCE_CHALLENGE = "challenge statement"
SOURCE_KEYWORD = "keyword match on PSI text"
EVIDENCE_QUOTES_SHOWN = 2

QUOTE_FLAMMABILITY = (
    "Flammability studies focus on solid materials such as fabrics and plastics, as studied in the Burning and "
    "Suppression of Solids (BASS and BASS-II) and Spacecraft Fire Safety Demonstration (Saffire-I, -II, and -III) investigations."
)
QUOTE_SAME = (
    "Fire detection was tested in microgravity through the Smoke and Aerosol Measurement Experiment studies (SAME and SAME-R)."
)
QUOTE_FLEX = (
    "Suppression was studied in the Flame Extinguishment Experiment (FLEX) through dilution of the chamber atmosphere "
    "with carbon dioxide and helium, both of which suppress fire."
)
QUOTE_BRE = (
    "While it burned gaseous fuels, the Burning Rate Emulator (BRE) experiment of the Advanced Combustion via Microgravity "
    "Experiments (ACME) project was a study of materials flammability in still atmospheres as a function of material properties."
)
QUOTE_DAFT = (
    "One of the instruments used for smoke detection in the SAME and SAME-R studies was instead used to detect dust in the "
    "Dust and Aerosol Measurement Feasibility Test (DAFT and DAFT-2) studies."
)

CHALLENGE_FUNCTIONS = {
    "PSI-26": [("prevention", QUOTE_FLAMMABILITY)],
    "PSI-25": [("prevention", QUOTE_FLAMMABILITY)],
    "PSI-98": [("prevention", QUOTE_FLAMMABILITY)],
    "PSI-99": [("prevention", QUOTE_FLAMMABILITY)],
    "PSI-100": [("prevention", QUOTE_FLAMMABILITY)],
    "PSI-102": [("detection", QUOTE_SAME)],
    "PSI-101": [("detection", QUOTE_SAME)],
    "PSI-69": [("suppression", QUOTE_FLEX)],
    "PSI-20": [("prevention", QUOTE_BRE)],
    "PSI-47": [("detection", QUOTE_DAFT)],
}


def normalize_functions(raw):
    if raw is None:
        return []
    if isinstance(raw, list):
        text = " ".join(str(item) for item in raw)
    else:
        text = str(raw)
    text = text.lower()
    return [name for name in FUNCTION_NAMES if name in text]


def evidence_basis(candidate):
    quotes = []
    for item in (candidate.get("evidence") or [])[:EVIDENCE_QUOTES_SHOWN]:
        quote = str(item.get("quote") or "").strip()
        if quote:
            quotes.append("[%s] %s" % (item.get("source_field") or "text", quote))
    return " | ".join(quotes)


def derive_functions(psi_id, record):
    entries = []
    taken = set()
    for name, quote in CHALLENGE_FUNCTIONS.get(psi_id, []):
        entries.append({"function": name, "source": SOURCE_CHALLENGE, "basis": quote, "score": None, "counts": True})
        taken.add(name)
    candidates = [c for c in (record.get("fire_safety_function_candidates") or []) if isinstance(c, dict)]
    candidates.sort(key=lambda c: (-(c.get("score") or 0), str(c.get("function"))))
    for candidate in candidates:
        name = candidate.get("function")
        if name not in FUNCTION_NAMES or name in taken:
            continue
        taken.add(name)
        entries.append({
            "function": name,
            "source": SOURCE_KEYWORD,
            "basis": evidence_basis(candidate),
            "score": candidate.get("score"),
            "counts": candidate.get("score") is not None and candidate.get("score") >= scoring.KEYWORD_MIN_SCORE,
        })
    return entries


def primary_function(entries, record):
    for entry in entries:
        if entry["source"] == SOURCE_CHALLENGE:
            return entry["function"]
    for entry in entries:
        if entry["counts"] and entry["function"] in scoring.CORE_FUNCTIONS:
            return entry["function"]
    return "fundamental" if entries else "unassigned"


LEAD_IN_RE = re.compile(
    r"^(the )?(primary |main |major |two main |overall )?(goals?|objectives?|aims?)[^.:]{0,80}?\b(is|are|was|were)( to:?|:)\s*", re.I)
ITEM_NUMBER_RE = re.compile(r"^(objectives?\s*:\s*)?(\(?[0-9A-Ca-c][.)]+\)?\s*)?", re.I)
SENTENCE_END_RE = re.compile(r"(?<=[a-z0-9\)])\.(\s|$)|;|\s\(?2[.)]")
SUMMARY_LIMIT = 150


def one_line_summary(record):
    text = " ".join(str(record.get("objectives") or record.get("description") or "").split())
    text = LEAD_IN_RE.sub("", text)
    text = ITEM_NUMBER_RE.sub("", text).strip()
    match = SENTENCE_END_RE.search(text)
    if match:
        text = text[:match.start()]
    text = re.sub(r"\s+(and|or)$", "", text.strip(" :-,"))
    if len(text) > SUMMARY_LIMIT:
        text = text[:SUMMARY_LIMIT].rsplit(" ", 1)[0].rstrip(",;:- ") + "..."
    if not text:
        return ""
    return text[0].upper() + text[1:]


def display_name(record, base, psi_id):
    name = record.get("acronym") or record.get("short_name") or base.get("investigation") or psi_id
    title = record.get("title") or base.get("title") or ""
    if name == psi_id and title:
        name = title if len(title) <= 60 else title[:60].rsplit(" ", 1)[0] + "..."
    return name


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
    values = sorted({round(lo, VALUE_DIGITS) for lo, hi, row in pairs if lo == hi})
    spans = sorted({(round(lo, VALUE_DIGITS), round(hi, VALUE_DIGITS)) for lo, hi, row in pairs if lo != hi})
    return {
        "min": min(los),
        "max": max(his),
        "n": len(pairs),
        "files": files,
        "source_rows": [min(source_rows), max(source_rows)],
        "values": values,
        "spans": [list(span) for span in spans],
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


def load_challenge_notes():
    data = read_json_file(CHALLENGE_NOTES_PATH) or {}
    return data.get("hardware_families") or [], data.get("notes") or []


def build_investigations(rows, unified, meta, images=None, findings=None):
    families, notes = load_challenge_notes()
    by_psi = {}
    for row in rows:
        by_psi.setdefault(row["psi_id"], []).append(row)
    ids = set(unified) | set(meta)
    out = []
    for psi_id in sorted(ids, key=numeric_psi_key):
        base = unified.get(psi_id, {})
        record = meta.get(psi_id, {})
        inv_rows = by_psi.get(psi_id, [])
        functions = derive_functions(psi_id, record)
        fuel_class = base.get("fuel_class") if base.get("fuel_class") else None
        if fuel_class is None and inv_rows:
            classes = {r["fuel_class"] for r in inv_rows if r.get("fuel_class")}
            fuel_class = sorted(classes)[0] if len(classes) == 1 else None
        outcome_rows = sum(1 for r in inv_rows if r.get("outcome") is not None)
        entry = {
            "psi_id": psi_id,
            "name": display_name(record, base, psi_id),
            "summary": one_line_summary(record),
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
            "primary_function": primary_function(functions, record),
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
            "images": (images or {}).get(psi_id, []),
            "key_findings": (findings or {}).get(psi_id, []),
            "hardware_family": next(({"id": f["id"], "label": f["label"], "source": f["source"], "quote": f["quote"]}
                                    for f in families if psi_id in f["psi_ids"]), None),
            "challenge_notes": [n["quote"] for n in notes if psi_id in n["psi_ids"]],
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


def specified(env, key):
    return not env[key].get("not_specified") and env[key]["window_min"] is not None


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


def build_insights(rows, environments, outside=None):
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
        if not (specified(env, "o2") and specified(env, "pressure_atm")):
            continue
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
        if env["id"] not in window_counts:
            continue
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
            for env in environments["environments"] if env["id"] in ("lunar", "iss") and specified(env, "o2")
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
        if env["id"] not in window_counts:
            continue
        wc = window_counts[env["id"]]
        zero_o2 = [fc for fc in MAIN_FUEL_CLASSES if wc["by_fuel_class"][fc]["o2_window"] == 0]
        zero_both = [fc for fc in MAIN_FUEL_CLASSES if wc["by_fuel_class"][fc]["o2_and_pressure_window"] == 0]
        flow_rows = None
        if specified(env, "flow_cm_s"):
            flo, fhi = win(env, "flow_cm_s")
            o2lo, o2hi = win(env, "o2")
            flow_rows = len([r for r in ambient if in_window(r["o2_frac"], o2lo, o2hi) and in_window(r.get("flow_cm_s"), flo, fhi)])
        gaps[env["id"]] = {
            "name": env["name"],
            "fuel_classes_zero_o2_window": zero_o2,
            "fuel_classes_zero_o2_pressure_window": zero_both,
            "rows_o2_and_flow_window": flow_rows,
        }
    all_three = [r for r in ok_rows if r.get("o2_frac") is not None and r.get("pressure_atm") is not None
                 and r["pressure_atm"] > 0 and r.get("flow_cm_s") is not None]
    gap_sentences = []
    for env in environments["environments"]:
        if env["id"] not in gaps:
            continue
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
    if outside and outside["tests"]:
        insights.append(outside_insight(outside))
    add_headlines(insights, environments)
    return {"insights": insights}


def range_text(lo, hi, digits):
    fmt = "%%.%df" % digits
    return fmt % lo if lo == hi else (fmt + "-" + fmt) % (lo, hi)


def outside_insight(outside):
    s = outside["summary"]
    psi_max = s["psi_solid_max_o2"]
    unplotted = [t for t in outside["tests"] if not t["plotted"]]
    text = (
        "%d Saffire IV-VI solid tests in Cygnus are published on NTRS but are not in PSI. %d of them ran above the %s%% O2 where PSI solids stop, "
        "at %s%% O2 and %s psia (%s)."
        % (s["tests"], len(s["above_psi_max"]), pct_text(psi_max), range_text(s["above_o2_min"], s["above_o2_max"], 1),
           range_text(s["above_psia_min"], s["above_psia_max"], 2), ", ".join(s["above_psi_max"]))
    )
    if unplotted:
        text += " " + "; ".join(
            "%s (%s, %.1f%% O2, %s) has no stated pressure" % (t["sample_id"], t["material_short"], t["o2_percent"], t["outcome_short"].lower())
            for t in unplotted) + "."
    columns = ("label", "sample_id", "material_short", "o2_percent", "pressure_psia", "outcome_short", "source_id", "source_url")
    return {
        "id": "outside_psi_solids",
        "title": "NASA's most habitat-relevant solid fire tests are not in PSI",
        "text": text,
        "numbers": {
            "tests": s["tests"],
            "plotted": s["plotted"],
            "psi_solid_max_o2": psi_max,
            "above_psi_max": s["above_psi_max"],
            "o2_percent_range_above_psi_max": [s["above_o2_min"], s["above_o2_max"]],
            "psia_range_above_psi_max": [s["above_psia_min"], s["above_psia_max"]],
            "tests_table": [{k: t[k] for k in columns} for t in outside["tests"]],
        },
        "links": [],
        "sources": sorted(
            [{"label": "NTRS " + sid, "url": outside_psi.NTRS_URL + sid} for sid in {t["source_id"] for t in outside["tests"]}],
            key=lambda item: item["label"]),
        "limits": (
            "Adding Saffire IV-VI to PSI would extend solid coverage toward exploration atmospheres. "
            "Quotes behind each test are machine-checked against the NTRS text, but these tests are not PSI rows and are not counted anywhere else "
            "in this dashboard except where labelled."
        ),
    }


def pct_text(value):
    return fmt_num(round(value * 100, 3))


def add_headlines(insights, environments):
    lunar = next(e for e in environments["environments"] if e["id"] == "lunar")
    by_id = {i["id"]: i for i in insights}
    n = by_id["max_o2_by_fuel_class"]["numbers"]
    by_id["max_o2_by_fuel_class"]["headline"] = (
        "Solid fuels were tested in PSI up to %s%% O2; a Moon base runs at %s-%s%%."
        % (pct_text(n["max_by_fuel_class"]["solid"]["max_o2"]), pct_text(lunar["o2"]["min"]), pct_text(lunar["o2"]["max"])))
    n = by_id["stream_vs_ambient_o2"]["numbers"]
    by_id["stream_vs_ambient_o2"]["headline"] = (
        "Highest ambient O2 is %s%%; highest burner-stream O2 is %s%% and is not a cabin atmosphere."
        % (pct_text(n["max_ambient_o2"]), pct_text(n["max_stream_o2"])))
    n = by_id["rows_per_environment_window"]["numbers"]["windows"]
    by_id["rows_per_environment_window"]["headline"] = (
        "Rows inside both the O2 and pressure window: " + ", ".join(
            "%s %d" % (w["name"], w["o2_and_pressure_window_rows"]) for w in n.values()) + ".")
    n = by_id["coverage_gaps"]["numbers"]
    by_id["coverage_gaps"]["headline"] = (
        "Only %d rows record O2, pressure and flow speed together." % n["rows_o2_pressure_flow_all_recorded"])
    n = by_id["o2_with_outcome"]["numbers"]
    by_id["o2_with_outcome"]["headline"] = (
        "%d rows in %d investigations record both an O2 value and an outcome." % (n["rows"], n["investigations"]))
    if "outside_psi_solids" in by_id:
        n = by_id["outside_psi_solids"]["numbers"]
        by_id["outside_psi_solids"]["headline"] = (
            "NASA's most habitat-relevant solid fire tests are not in PSI: Saffire IV-VI reached %s%% O2 at %s psia, PSI solids stop at %s%%."
            % (range_text(n["o2_percent_range_above_psi_max"][0], n["o2_percent_range_above_psi_max"][1], 1),
               range_text(n["psia_range_above_psi_max"][0], n["psia_range_above_psi_max"][1], 2), pct_text(n["psi_solid_max_o2"])))


EARTH_SPINOFF_LABEL = "NASA spinoff technology, not a PSI combustion test."
EARTH_QUOTES_PATH = os.path.join(ROOT, "data", "earth", "earth_quotes.json")


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
        "label": EARTH_SPINOFF_LABEL,
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
        "label": EARTH_SPINOFF_LABEL,
        "inference": "No PSI combustion investigation is linked: this is spacesuit materials history. Fabric flammability tests in the PSI tables (Saffire, BASS) address spacecraft materials, not firefighter clothing.",
        "sources": [{"label": "NASA Spinoff: New Technology for the Fire Attire", "url": "https://spinoff.nasa.gov/node/9918"}],
    },
]


def build_earth():
    quotes = {}
    if os.path.isfile(EARTH_QUOTES_PATH):
        with open(EARTH_QUOTES_PATH, "r", encoding="ascii") as handle:
            quotes = {q["id"]: q for q in json.load(handle)["quotes"]}
    applications = []
    for entry in EARTH:
        item = dict(entry)
        q = quotes.get(entry["id"])
        if q:
            item["quote"] = {
                "text": q["quote"],
                "source_title": q["source_title"],
                "source_publisher": q["source_publisher"],
                "url": q["source_url"],
                "status": "verbatim, machine-checked against a saved copy of the page",
            }
        applications.append(item)
    return applications


def earth_corpus_document(applications):
    lines = ["Earth applications of space fire-safety technology, as listed in the Flame in Freefall challenge statement and NASA Spinoff pages."]
    lines.append("Firefighter gear is covered here: NASA Spinoff documents firefighter air tanks and breathing gear (1976) and firefighter protective clothing (Project FIRES, 1982).")
    for app in applications:
        lines.append("Earth application: %s. Status: %s." % (app["application"], app["status"]))
        lines.append("Statement: %s" % app["statement"])
        if app.get("label"):
            lines.append("Label: %s" % app["label"])
        if app.get("quote"):
            q = app["quote"]
            lines.append("Verbatim from %s (%s, %s): \"%s\"" % (q["source_title"], q["source_publisher"], q["url"], q["text"]))
        if app.get("psi_ids"):
            lines.append("Linked PSI investigations: %s." % ", ".join(app["psi_ids"]))
        if app.get("inference_psi_ids"):
            lines.append("Nearest PSI investigations (inference): %s." % ", ".join(app["inference_psi_ids"]))
        lines.append("Link to PSI: %s" % app["inference"])
        lines.append("Sources: %s." % "; ".join("%s (%s)" % (src["label"], src["url"]) for src in app["sources"]))
    return {"psi_id": EARTH_CORPUS_ID, "title": EARTH_CORPUS_TITLE, "body": "\n".join(lines)}


EARTH_CORPUS_ID = "EARTH-APPLICATIONS"
EARTH_CORPUS_TITLE = "Earth applications - water mist, smoke detection, firefighter gear"


LUNAR_G_PATH = os.path.join(ROOT, "data", "lunar_g", "compensation.json")
LUNAR_G_CORPUS_ID = "LUNAR-GRAVITY"
LUNAR_G_CORPUS_TITLE = "Lunar gravity check - measured 1-g to lunar-g flammability deltas"
LUNAR_G_DIRECTION_TEXT = {
    "more_flammable": "lunar-g test: burned at lower O2 than the 1-g data predicts",
    "less_flammable": "lunar-g test: burned only at higher O2 than the 1-g data predicts",
    "not_stated": "lunar-g test direction not stated in the paper",
}


def build_lunar_g():
    with open(LUNAR_G_PATH, "r", encoding="ascii") as handle:
        data = json.load(handle)
    errors = verify_lunar_g.verify(data)
    if errors:
        raise SystemExit("lunar_g quotes failed verification: " + "; ".join(errors))
    quotes = {q["id"]: q for q in data["quotes"]}
    materials = []
    for item in data["materials"]:
        row = dict(item)
        row["direction_text"] = LUNAR_G_DIRECTION_TEXT[item["direction"]]
        materials.append(row)
    out = {
        "paper": data["paper"],
        "materials": materials,
        "quotes": [
            {"id": q["id"], "text": q["quote"], "page": q["page"], "source_title": q["source_title"], "url": q["source_url"]}
            for q in data["quotes"]
        ],
        "verification": {"checked": len(data["quotes"]), "failed": 0},
    }
    out["quote_ids"] = sorted(quotes)
    return out


def lunar_g_corpus_document(lunar):
    paper = lunar["paper"]
    quotes = {q["id"]: q for q in lunar["quotes"]}
    lines = ["Does lunar gravity change flammability? Measured answer from %s (%s). Partial gravity cannot be interpolated between 0 g and 1 g: the flammability map has a low-flow quenching branch and a high-flow blowoff branch." % (paper["authors"], paper["url"])]
    lines.append("Table 2, Flammability Compensation Factors: best-fit slope and 95 percent confidence interval slope of the oxygen limit against flow velocity (s/cm), and the conservative 1-g to lunar-g delta in oxygen percentage points at the presumed 1-g buoyant velocity of %s cm/s." % paper["reference_velocity_cm_s"])
    for m in lunar["materials"]:
        lines.append("%s: best-fit slope %s, 95 percent slope %s, delta %s O2 points; %s." % (
            m["name"], format(m["best_fit_slope_s_per_cm"], "g"), format(m["ci95_slope_s_per_cm"], "g"), format(m["delta_o2_points"], "g"), m["direction_text"]))
    lines.append("The 35 cm/s 1-g buoyant velocity is a conservatively high estimate and the lunar-g velocity is not known, so no lunar-g flammability limit is stated for any material and nothing is interpolated.")
    lines.append("Habitat reading: the paper's conservative allowance is that a 1-g test margin may be read as up to %s oxygen points smaller (worst case across these materials). The allowance extrapolates the 1-g forced-flow slope from 35 cm/s to zero flow and is not a measured lunar-g limit. In the lunar-g tests themselves, PMMA, P 213 and flaming Beefy-T burned at lower oxygen, while polycarbonate and Nomex Velcro burned only at higher oxygen." % format(paper["worst_case_delta_o2_points"], "g"))
    for qid in ("worst_case", "velocity_unknown", "lower_extinction", "higher_extinction", "conclusion", "bass_blowoff", "fm2_plan"):
        q = quotes[qid]
        page = (", page %s" % q["page"]) if q["page"] else ""
        lines.append("Verbatim from %s%s (%s): \"%s\"" % (q["source_title"], page, q["url"], q["text"]))
    lines.append("Cross-check: BASS-II reported 16 percent oxygen as the 1-g blowoff limit and steady spread at 13.6 percent in microgravity, a different configuration (quarter-inch PMMA rod), so only order-of-magnitude agreement is claimed.")
    lines.append("Flammability of Materials on the Moon (FM2) will burn samples in actual lunar gravity, planned launch late 2026 (Ferkul, Kralik and Liao, LPSC 2026).")
    return {"psi_id": LUNAR_G_CORPUS_ID, "title": LUNAR_G_CORPUS_TITLE, "body": "\n".join(lines)}


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


def build_corpus(investigations, rankings, outside=None, psi_max=None, environments=None, test_next=None, earth=None, lunar=None):
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
        lines.append("Primary fire-safety function: %s." % inv["primary_function"])
        for entry in inv["functions"]:
            lines.append("Supports %s (%s): %s" % (entry["function"], entry["source"], entry["basis"] or "no basis text"))
        if not inv["functions"]:
            lines.append("Fire-safety function: unassigned.")
        for env_id, ranking in rankings.items():
            for item in ranking:
                if item["psi_id"] == inv["psi_id"]:
                    lines.append("Habitat relevance, default weights, environment %s: rank %d of %d, score %.3f."
                                 % (env_id, item["rank"], len(ranking), item["score"]))
        for finding in inv.get("key_findings") or []:
            lines.append("Key result, verbatim from %s (%s): \"%s\"" % (finding.get("source", ""), finding.get("source_label", ""), finding.get("quote", "")))
        if inv["earth_benefits"]:
            lines.append("Research impact and Earth benefits (PSI record): %s" % inv["earth_benefits"])
        if inv["doi"]:
            lines.append("DOI: %s." % inv["doi"])
        if inv.get("hardware_family"):
            lines.append("Hardware family: %s (%s)" % (inv["hardware_family"]["label"], inv["hardware_family"]["source"]))
        for note in inv.get("challenge_notes") or []:
            lines.append("Challenge statement, verbatim: \"%s\"" % note)
        lines.append("PSI record: %s." % inv["psi_url"])
        docs.append({
            "psi_id": inv["psi_id"],
            "title": "%s %s - %s" % (inv["psi_id"], inv["acronym"], inv["title"]),
            "body": "\n".join(lines),
        })
    if lunar:
        docs.append(lunar_g_corpus_document(lunar))
    if outside and outside["tests"]:
        docs.append(outside_psi.corpus_document(outside, psi_max))
    if environments and test_next:
        docs.append(dashboard_results_document(environments, test_next, rankings))
    if earth:
        docs.append(earth_corpus_document(earth))
    return {"documents": docs}


DASHBOARD_RESULTS_TITLE = "Dashboard results - habitat windows, test-next and solid test pressures"
SOLID_PRESSURE_PATH = os.path.join(ROOT, "data", "outside_psi", "solid_pressure_sources.json")
FUEL_CLASS_LABELS = {"solid": "solid", "liquid_droplet": "liquid droplet", "gas": "gas"}


def window_phrase(block, unit):
    if block.get("not_specified"):
        return "not specified"
    refs = ", ".join(src["ref"] for src in block.get("sources", []) if src.get("ref"))
    return "%s (source: %s)" % (block.get("display", ""), refs or "none")


def nearest_phrase(entry):
    if not entry:
        return "none"
    parts = []
    if entry.get("psi_id"):
        parts.append(entry["psi_id"])
    elif entry.get("label"):
        parts.append("%s %s" % (entry["label"], entry.get("material_short", "")))
    if entry.get("o2_frac") is not None:
        parts.append("O2 %.3f" % entry["o2_frac"])
    if entry.get("pressure_atm") is not None:
        parts.append("%.3f atm" % entry["pressure_atm"])
    else:
        parts.append("pressure not recorded")
    if entry.get("o2_gap") is not None:
        parts.append("O2 gap %.3f" % entry["o2_gap"])
    if entry.get("inside"):
        parts.append("inside the window")
    if entry.get("source_id"):
        parts.append("NTRS %s" % entry["source_id"])
    return ", ".join(parts)


def dashboard_results_document(environments, test_next, rankings):
    if isinstance(environments, dict):
        environments = environments["environments"]
    lines = [
        "Results computed by this dashboard from the PSI conditions table and NASA documents. "
        "All PSI data is microgravity; no partial-gravity values exist or are implied."
    ]
    lines.append("Habitat windows (O2 as mole fraction, pressure, flow, gravity):")
    for env in environments:
        lines.append("Environment %s (%s): O2 %s; pressure %s; flow %s; gravity %s." % (
            env["id"], env["name"], window_phrase(env["o2"], ""), window_phrase(env["pressure_atm"], ""),
            window_phrase(env["flow_cm_s"], ""), window_phrase(env["gravity"], "")))
    lines.append("Test next, by environment and fuel class (tests inside the habitat window, nearest PSI test, nearest outside-PSI NASA test):")
    for env in environments:
        block = test_next["environments"].get(env["id"])
        if not block:
            continue
        for cls in block["classes"]:
            lines.append("Test next, %s, %s fuel: %d PSI tests inside the window (%d rows classified); nearest PSI test: %s; nearest outside-PSI NASA test: %s." % (
                env["id"], FUEL_CLASS_LABELS.get(cls["fuel_class"], cls["fuel_class"]), cls["inside"], cls["classified_rows"],
                nearest_phrase(cls.get("nearest")), nearest_phrase(cls.get("outside_nearest")) if cls.get("outside_nearest") else "none checked"))
    lines.append("NASA-sourced ambient pressures of the PSI solid-fuel tests. The PSI tables do not record pressure for these tests, but NASA reports do:")
    with open(SOLID_PRESSURE_PATH, "r", encoding="utf-8") as handle:
        records = json.load(handle)["records"]
    for psi_id, rec in records.items():
        primary = rec["primary"]
        if rec.get("pressure_atm") is not None:
            value = "%.3f atm (%.1f kPa)" % (rec["pressure_atm"], rec["pressure_kpa"])
        else:
            value = "%.3f to %.3f atm (%.1f to %.1f kPa)" % (tuple(rec["pressure_atm_range"]) + tuple(rec["pressure_kpa_range"]))
        lines.append("Solid test pressure, %s %s (%s): %s. Quote from NTRS %s page %s: \"%s\"" % (
            psi_id, rec["name"], rec["platform"], value, primary["source_id"], primary["page"], primary["quote"]))
    ranking = rankings.get("lunar") or []
    if ranking:
        lines.append("Default lunar habitat ranking, top 5 of %d: %s." % (len(ranking), "; ".join(
            "rank %d %s (score %.3f)" % (item["rank"], item["psi_id"], item["score"]) for item in ranking[:5])))
    return {"psi_id": "DASHBOARD-RESULTS", "title": DASHBOARD_RESULTS_TITLE, "body": chr(10).join(lines)}


MIN_SUPPORTED_ROWS = 10
STATUS_SUPPORTED = "Supported"
STATUS_PARTLY = "Partly"
STATUS_NOT = "Not supported"

AXIS_LABELS = {"o2": "ambient O2", "pressure": "pressure", "flow": "flow speed"}
AXIS_TITLES = {"o2": "Ambient O2", "pressure": "Pressure", "flow": "Flow speed"}
AXIS_FIELDS = {"o2": "o2_frac", "pressure": "pressure_atm", "flow": "flow_cm_s"}
AXIS_KEYS = {"o2": "o2", "pressure": "pressure_atm", "flow": "flow_cm_s"}
AXIS_PARAMS = {"o2": ("o2min", "o2max"), "pressure": ("pmin", "pmax"), "flow": ("fmin", "fmax")}
AXIS_UNITS = {"o2": "", "pressure": " atm", "flow": " cm/s"}

RULE_TEXT = (
    "Status is computed from the unified table for the selected environment. A relationship counts a row only if the row has a recorded "
    "response (the measured outcome the model would predict), has value quality exact or approximate, and lies inside the environment window "
    "on every axis the relationship uses (ambient O2 only, pressure above 0). Supported: at least %d such rows. "
    "Partly: some rows exist but fewer than %d count, because they lie outside the window or carry no response column. "
    "Not supported: no rows at all." % (MIN_SUPPORTED_ROWS, MIN_SUPPORTED_ROWS)
)

NO_MODEL_NOTE = (
    "No trained model is shipped. A model fitted to this table would be asked for predictions outside the tested range, "
    "which would not be valid. The downloads are model-ready instead: units, provenance, a group column and a validity note."
)

GROUPED_VALIDATION_NOTE = (
    "Validate any model with grouped (leave-one-investigation-out) splits on the group column. Rows within one investigation share "
    "hardware, fuel and procedure, so a random row split leaks information and overstates accuracy."
)

RELATIONSHIPS = [
    {
        "id": "droplet_extinction",
        "title": "Droplet extinction diameter and burn time versus O2, diluent and pressure",
        "psi_ids": ["PSI-69", "PSI-68", "PSI-39"],
        "axes": ["o2", "pressure"],
        "response_keys": ["extinction_diameter_mm", "burn_time_s"],
        "response_label": "extinction diameter or burn time",
        "needs": "Droplet extinction runs (extinction diameter, burn time) at the window O2 and pressure with the CO2, helium and nitrogen diluent set.",
    },
    {
        "id": "gas_flame_limits",
        "title": "Gas-flame ignition and self-extinction versus O2",
        "psi_ids": ["PSI-159", "PSI-10", "PSI-20"],
        "axes": ["o2"],
        "response_keys": ["outcome", "note:flames_ignited"],
        "response_label": "ignition or extinction outcome",
        "needs": "Ignition and self-extinction outcomes for gas flames at ambient O2 inside the window, with the outcome recorded per test.",
    },
    {
        "id": "solid_flammability",
        "title": "Solid-material ignition and burn versus O2 and flow",
        "psi_ids": ["PSI-26", "PSI-25", "PSI-98", "PSI-99", "PSI-100"],
        "axes": ["o2"],
        "response_keys": ["outcome", "burn_time_s", "note:burn_time_text", "note:ug_burn_length"],
        "response_label": "burn outcome or burn time",
        "needs": "Solid-material ignition and burn results at ambient O2 inside the window, recorded with the flow speed of each test.",
    },
    {
        "id": "smoke_particle_size",
        "title": "Smoke particle size versus flow and aging",
        "psi_ids": ["PSI-102", "PSI-101"],
        "axes": ["flow"],
        "response_keys": [],
        "response_label": "particle size",
        "needs": "The measured particle-size results of each SAME and SAME-R test, joined to the flow speed and aging times already in the table.",
    },
    {
        "id": "partial_gravity",
        "title": "Any relationship at partial gravity (lunar 0.16 g, Mars 0.38 g)",
        "psi_ids": [],
        "axes": [],
        "response_keys": [],
        "response_label": "any response",
        "needs": "Partial-gravity flight data such as LUCI (Lunar-g Combustion Investigation) and FM2 (Flammability of Materials on the Moon), both named in the challenge statement as expected additions to PSI.",
    },
]


def has_response(row, keys):
    for key in keys:
        if key.startswith("note:"):
            if ("%s=" % key[5:]) in (row.get("measurement_notes") or ""):
                return True
        elif row.get(key) is not None:
            return True
    return False


def axis_inside(row, axis, env):
    lo, hi = win(env, AXIS_KEYS[axis])
    value = row.get(AXIS_FIELDS[axis])
    if axis == "o2" and row.get("o2_basis") != "ambient":
        return False
    if axis == "pressure" and (value is None or value <= 0):
        return False
    return in_window(value, lo, hi)


def window_text(axes, env):
    parts = []
    for axis in axes:
        lo, hi = win(env, AXIS_KEYS[axis])
        parts.append("%s %s to %s%s" % (AXIS_LABELS[axis], fmt_num(lo), fmt_num(hi), AXIS_UNITS[axis]))
    return " and ".join(parts)


def value_range(rows, axis):
    values = []
    for row in rows:
        if axis == "o2" and row.get("o2_basis") != "ambient":
            continue
        value = row.get(AXIS_FIELDS[axis])
        if value is None or (axis == "pressure" and value <= 0):
            continue
        values.append(value)
        if axis == "o2" and row.get("o2_min_frac") is not None:
            values.append(row["o2_min_frac"])
    if not values:
        return None
    return {"min": min(values), "max": max(values), "n": len(values)}


def diluent_names(rows):
    names = set()
    for row in rows:
        for part in str(row.get("diluent") or "").split(";"):
            token = part.strip().split(" ")[0]
            if token and re.match(r"^[A-Za-z][A-Za-z0-9]*$", token):
                names.add(token)
    return sorted(names)


def skipped_text(skipped):
    names = " and ".join(AXIS_LABELS[a] for a in skipped)
    return "The %s window is not specified by NASA sources for this environment, so it is not used to match rows." % names


def readiness_gap(rel, env, rows, response_rows, counted, status, skipped=()):
    if status == STATUS_NOT:
        return rel["needs"]
    if status == STATUS_SUPPORTED:
        if (env["gravity"]["g"] or 0) > 0:
            return "No gap inside this window for the rows counted. All rows are 0 g, so this says nothing about a fire at the environment's own gravity."
        return "No gap inside this window for the rows counted. All rows are 0 g, the same gravity level as this environment."
    parts = []
    if skipped:
        parts.append(skipped_text(skipped))
    if not response_rows:
        parts.append("No %s is recorded in the table for these rows." % rel["response_label"])
    else:
        for axis in rel["axes"]:
            axis_rows = [r for r in response_rows if countable([r]) and axis_inside(r, axis, env)]
            lo, hi = win(env, AXIS_KEYS[axis])
            rng = value_range(response_rows, axis)
            if not axis_rows:
                if rng and rng["max"] < lo:
                    parts.append("%s tested with a response only reaches %s, below the window (%s to %s)." % (
                        AXIS_TITLES[axis], fmt_num(rng["max"]), fmt_num(lo), fmt_num(hi)))
                elif rng and rng["min"] > hi:
                    parts.append("%s tested with a response starts at %s, above the window (%s to %s)." % (
                        AXIS_TITLES[axis], fmt_num(rng["min"]), fmt_num(lo), fmt_num(hi)))
                else:
                    parts.append("No row with a response lies inside the %s window (%s to %s)." % (
                        AXIS_LABELS[axis], fmt_num(lo), fmt_num(hi)))
            elif len(axis_rows) < MIN_SUPPORTED_ROWS:
                parts.append("Only %d %s with a response lie inside the %s window." % (
                    len(axis_rows), "row" if len(axis_rows) == 1 else "rows", AXIS_LABELS[axis]))
        if not parts or (skipped and len(parts) == 1):
            parts.append("Only %d rows with a response lie inside the full window (%d needed)." % (len(counted), MIN_SUPPORTED_ROWS))
    parts.append("To close it: " + rel["needs"])
    return " ".join(parts)


def short_reason(rel, status, rows, response_rows, counted, skipped):
    if rel["id"] == "partial_gravity":
        return "PSI holds no partial-gravity data."
    if status == STATUS_NOT:
        return "No rows."
    if status == STATUS_SUPPORTED:
        return "%d rows with a recorded response lie inside the window." % len(counted)
    if skipped and not rel["axes"]:
        return "The %s window is not specified by NASA sources, so rows cannot be matched." % " and ".join(AXIS_LABELS[a] for a in skipped)
    if not response_rows:
        return "Rows exist but none records %s." % rel["response_label"]
    if not counted:
        return "None of %d rows with a response lies inside the window." % len(response_rows)
    return "Only %d of the %d needed rows lie inside the window." % (len(counted), MIN_SUPPORTED_ROWS)


def readiness_item(rel, env, rows_all, e_field_rows):
    skipped = [a for a in rel["axes"] if not specified(env, AXIS_KEYS[a])]
    rel = dict(rel)
    rel["axes"] = [a for a in rel["axes"] if a not in skipped]
    ids = rel["psi_ids"]
    rows = [r for r in rows_all if r["psi_id"] in ids]
    response_rows = [r for r in rows if has_response(r, rel["response_keys"])]
    counted = [r for r in countable(response_rows) if all(axis_inside(r, a, env) for a in rel["axes"])] if rel["axes"] else []
    if not rows:
        status = STATUS_NOT
    elif len(counted) >= MIN_SUPPORTED_ROWS:
        status = STATUS_SUPPORTED
    else:
        status = STATUS_PARTLY
    per_inv = []
    for psi_id in ids:
        inv_rows = [r for r in rows if r["psi_id"] == psi_id]
        if not inv_rows:
            continue
        inv_resp = [r for r in inv_rows if has_response(r, rel["response_keys"])]
        inv_counted = [r for r in counted if r["psi_id"] == psi_id]
        per_inv.append({
            "psi_id": psi_id,
            "investigation": inv_rows[0].get("investigation") or psi_id,
            "rows": len(inv_rows),
            "response_rows": len(inv_resp),
            "counted_rows": len(inv_counted),
        })
    if rel["id"] == "partial_gravity":
        reason = (
            "No PSI table has a gravity column and every row is a 0 g test. The challenge statement says partial gravity was mimicked in "
            "ACME E-FIELD Flames (PSI-22, %d rows in the table) through an electric field acting on flame ions; that is not a partial-gravity measurement."
            " The challenge statement adds: \"Microgravity and normal-gravity results could bound what occurs at intermediate gravity levels.\""
            " PSI holds only the 0 g side; normal-gravity tests are outside PSI."
            % e_field_rows
        )
    elif not ids:
        reason = "No rows."
    else:
        reason = (
            "%d rows in %d investigations; %d carry a recorded %s; %d of those count inside the window (%s). Rule: at least %d."
            % (len(rows), len(per_inv), len(response_rows), rel["response_label"], len(counted), window_text(rel["axes"], env), MIN_SUPPORTED_ROWS)
        )
    link = {"env": env["id"]}
    if ids:
        link["inv"] = ",".join(ids)
    if "o2" in rel["axes"]:
        link["basis"] = "ambient"
    for axis in rel["axes"]:
        lo, hi = win(env, AXIS_KEYS[axis])
        link[AXIS_PARAMS[axis][0]] = lo
        link[AXIS_PARAMS[axis][1]] = hi
    item = {
        "id": rel["id"],
        "status": status,
        "rows_total": len(rows),
        "rows_with_response": len(response_rows),
        "rows_counted": len(counted),
        "investigations": per_inv,
        "ranges": {axis: value_range(rows, axis) for axis in ("o2", "pressure", "flow")},
        "reason": reason,
        "gap": readiness_gap(rel, env, rows, response_rows, counted, status, skipped),
        "short": short_reason(rel, status, rows, response_rows, counted, skipped),
        "skipped_axes": skipped,
        "link": link,
    }
    if rel["id"] == "droplet_extinction":
        item["diluents"] = diluent_names(rows)
    return item


def build_model_readiness(rows, environments):
    e_field_rows = sum(1 for r in rows if r["psi_id"] == "PSI-22")
    per_env = OrderedDict()
    for env in environments["environments"]:
        per_env[env["id"]] = {
            "name": env["name"],
            "gravity_g": env["gravity"]["g"],
            "window": {
                key: {"min": win(env, key)[0], "max": win(env, key)[1]}
                for key in ("o2", "pressure_atm", "flow_cm_s")
            },
            "items": [readiness_item(rel, env, rows, e_field_rows) for rel in RELATIONSHIPS],
        }
    return {
        "rule": RULE_TEXT,
        "min_rows": MIN_SUPPORTED_ROWS,
        "no_model_note": NO_MODEL_NOTE,
        "grouped_validation_note": GROUPED_VALIDATION_NOTE,
        "relationships": [
            {"id": r["id"], "title": r["title"], "psi_ids": r["psi_ids"], "axes": r["axes"], "response_label": r["response_label"]}
            for r in RELATIONSHIPS
        ],
        "environments": per_env,
    }


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


CLASS_PRIORITY = ["solid", "liquid_droplet", "gas"]


def gap_of(value, lo, hi):
    if value is None:
        return None
    if value < lo:
        return round(lo - value, 6)
    if value > hi:
        return round(value - hi, 6)
    return 0.0


def nearest_condition(eligible, env):
    o2lo, o2hi = win(env, "o2")
    plo, phi = win(env, "pressure_atm")
    flow_window = win(env, "flow_cm_s") if specified(env, "flow_cm_s") else None
    best = None
    best_key = None
    for row in eligible:
        o2_gap = gap_of(row["o2_frac"], o2lo, o2hi)
        pressure = row.get("pressure_atm")
        p_gap = gap_of(pressure, plo, phi) if pressure is not None and pressure > 0 else None
        f_gap = gap_of(row.get("flow_cm_s"), flow_window[0], flow_window[1]) if flow_window else 0.0
        key = (
            o2_gap,
            p_gap if p_gap is not None else float("inf"),
            f_gap if f_gap is not None else float("inf"),
            numeric_psi_key(row["psi_id"]),
            row["source_row"],
        )
        if best_key is None or key < best_key:
            best_key = key
            best = (row, o2_gap, p_gap)
    if best is None:
        return None
    row, o2_gap, p_gap = best
    return {
        "psi_id": row["psi_id"],
        "source_file": row["source_file"],
        "source_row": row["source_row"],
        "o2_frac": row["o2_frac"],
        "pressure_atm": row.get("pressure_atm") if row.get("pressure_atm") and row["pressure_atm"] > 0 else None,
        "flow_cm_s": row.get("flow_cm_s"),
        "o2_gap": o2_gap,
        "pressure_gap_atm": p_gap,
    }


def build_test_next(rows, environments, outside=None):
    ambient = [r for r in countable(rows) if r.get("o2_basis") == "ambient" and r.get("o2_frac") is not None]
    out = OrderedDict()
    for env in environments["environments"]:
        if not (specified(env, "o2") and specified(env, "pressure_atm")):
            continue
        o2lo, o2hi = win(env, "o2")
        plo, phi = win(env, "pressure_atm")
        flow_window = win(env, "flow_cm_s") if specified(env, "flow_cm_s") else None
        entries = []
        for fc in CLASS_PRIORITY:
            eligible = [r for r in ambient if r.get("fuel_class") == fc]
            o2_rows = [r for r in eligible if in_window(r["o2_frac"], o2lo, o2hi)]
            inside = [
                r for r in o2_rows
                if r.get("pressure_atm") is not None and r["pressure_atm"] > 0 and in_window(r["pressure_atm"], plo, phi)
                and (flow_window is None or in_window(r.get("flow_cm_s"), flow_window[0], flow_window[1]))
            ]
            no_pressure = [r for r in o2_rows if r.get("pressure_atm") is None or r["pressure_atm"] <= 0]
            nearest = nearest_condition(eligible, env)
            entry = {
                "fuel_class": fc,
                "inside": len(inside),
                "o2_window_rows": len(o2_rows),
                "o2_window_no_pressure_rows": len(no_pressure),
                "classified_rows": len(eligible),
                "nearest": nearest,
            }
            if fc == "solid" and outside and outside["tests"]:
                psi_key = None
                if nearest is not None:
                    p_gap = nearest["pressure_gap_atm"]
                    psi_key = (nearest["o2_gap"], p_gap if p_gap is not None else float("inf"))
                entry["outside_nearest"] = outside_psi.nearest_outside(outside, (o2lo, o2hi), (plo, phi), psi_key)
            entries.append(entry)
        entries.sort(key=lambda e: (e["inside"] > 0, CLASS_PRIORITY.index(e["fuel_class"])))
        out[env["id"]] = {
            "name": env["name"],
            "windows": {
                "o2": {"min": o2lo, "max": o2hi},
                "pressure_atm": {"min": plo, "max": phi},
                "flow_cm_s": {"min": flow_window[0], "max": flow_window[1]} if flow_window else None,
            },
            "classes": entries,
            "zero_count": sum(1 for e in entries if e["inside"] == 0),
        }
    return {"environments": out}


def read_json_file(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8-sig") as handle:
        return ascii_deep(json.load(handle))


def load_images():
    data = read_json_file(IMAGES_PATH)
    out = {}
    if not isinstance(data, list):
        return out
    for item in data:
        psi_id = item.get("psi_id")
        rel = item.get("file")
        if not psi_id or not rel:
            continue
        source = os.path.join(ROOT, *rel.split("/"))
        if not os.path.exists(source):
            continue
        name = os.path.basename(rel)
        out.setdefault(psi_id, []).append({
            "file": "img/%s/%s" % (psi_id, name),
            "source_path": source,
            "caption": "NASA / PSI %s: %s" % (psi_id, item.get("original_name") or name),
            "width": item.get("width"),
            "height": item.get("height"),
        })
    for psi_id in out:
        out[psi_id].sort(key=lambda i: i["file"])
    return out


def publish_images(images):
    if not images:
        return
    if os.path.isdir(SITE_IMG_DIR):
        shutil.rmtree(SITE_IMG_DIR)
    for psi_id, items in images.items():
        for item in items:
            dest = os.path.join(ROOT, "public", *item["file"].split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(item["source_path"], dest)


def public_images(images):
    return {
        psi_id: [{k: v for k, v in item.items() if k != "source_path"} for item in items]
        for psi_id, items in images.items()
    }


def record_list(data, keys):
    if isinstance(data, dict):
        for key in keys:
            if isinstance(data.get(key), (list, dict)):
                data = data[key]
                break
    records = []
    if isinstance(data, dict):
        for key, value in data.items():
            values = value if isinstance(value, list) else [value]
            for item in values:
                if isinstance(item, dict):
                    item = dict(item)
                    item.setdefault("psi_id", key)
                    records.append(item)
                elif isinstance(item, str):
                    records.append({"psi_id": key, "quote": item})
    elif isinstance(data, list):
        records = [item for item in data if isinstance(item, dict)]
    return records


def first_value(item, keys):
    for key in keys:
        value = item.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def source_fields(item):
    raw = first_value(item, ["source", "source_id", "ntrs_id", "ref", "document"])
    label = ""
    ident = ""
    url = str(first_value(item, ["url", "source_url", "link"]) or "")
    if isinstance(raw, dict):
        ident = str(first_value(raw, ["id", "ntrs_id", "ref"]) or "")
        label = str(first_value(raw, ["title", "label", "name"]) or "")
        url = url or str(first_value(raw, ["url", "link"]) or "")
    elif raw is not None:
        ident = str(raw)
    label = label or str(first_value(item, ["source_title", "title"]) or "")
    return ident, label, url


def quote_key(psi_id, quote):
    return (str(psi_id), " ".join(str(quote).split()).lower())


def is_verified(item):
    for key in ("verified", "match", "found", "machine_checked", "ok", "passed"):
        if isinstance(item.get(key), bool):
            return item[key]
    status = str(item.get("status") or item.get("result") or "").lower()
    if status:
        return status in ("verified", "ok", "pass", "passed", "match", "found")
    return None


def load_verification_items():
    data = read_json_file(FINDINGS_VERIFICATION_PATH)
    if data is None:
        return None, []
    summary = data if isinstance(data, dict) else {}
    by_id = {}
    for finding in record_list(read_json_file(FINDINGS_PATH) or [], ["findings", "key_findings", "items"]):
        if finding.get("finding_id"):
            by_id[finding["finding_id"]] = finding
    items = []
    no_finding = []
    for item in record_list(data, ["quotes", "findings", "checks", "results", "items"]):
        if item.get("result") == "no_finding":
            no_finding.append(str(item.get("psi_id") or ""))
            continue
        merged = dict(by_id.get(item.get("finding_id"), {}))
        merged.update({k: v for k, v in item.items() if v not in (None, "", [], {})})
        item = merged
        quote = first_value(item, ["quote", "text", "finding"])
        verdict = is_verified(item)
        if verdict is None:
            continue
        ident, label, url = source_fields(item)
        items.append({
            "psi_id": str(item.get("psi_id") or ""),
            "quote": str(quote or ""),
            "source": ident or label,
            "url": url,
            "verified": verdict,
        })
    summary = dict(summary)
    summary["no_finding"] = sorted(set(p for p in no_finding if p))
    return summary, items


def load_findings(verification_items):
    data = read_json_file(FINDINGS_PATH)
    out = {}
    if data is None:
        return out
    failed = {quote_key(i["psi_id"], i["quote"]) for i in verification_items if i["quote"] and not i["verified"]}
    for item in record_list(data, ["findings", "key_findings", "items"]):
        psi_id = item.get("psi_id")
        quote = first_value(item, ["quote", "text", "finding"])
        if not psi_id or not quote:
            continue
        if item.get("verified") is False or quote_key(psi_id, quote) in failed:
            continue
        ident, label, url = source_fields(item)
        out.setdefault(str(psi_id), []).append({
            "quote": " ".join(str(quote).split()),
            "source": ident,
            "source_label": label,
            "url": url,
        })
    return out


AUDIT_TITLES = {
    "1_row_counts_per_source_file": "Row counts per source file",
    "2a_random_sample_200_seed_20261114": "Random sample of 200 rows re-parsed from source",
    "2b_all_rows_o2_frac_ge_0.30": "Every row with O2 at 0.30 or above re-parsed from source",
    "2c_all_solid_fuel_rows": "Every solid-fuel row re-parsed from source",
    "2_union_distinct_rows": "Distinct rows covered by checks 2a to 2c",
    "3_headline_numbers": "Headline numbers recomputed from source",
}


def build_outside_verification():
    data = read_json_file(outside_psi.VERIFICATION_PATH)
    if not isinstance(data, dict):
        return None
    return {"checked": data.get("checked", 0), "failed": data.get("failed", 0), "errors": data.get("errors", [])}


def build_ask_eval():
    summary = read_json_file(EVAL_SUMMARY_PATH)
    eval_set = read_json_file(EVAL_SET_PATH)
    if not isinstance(summary, dict) or not isinstance(eval_set, dict):
        return None
    questions = eval_set.get("questions") or []
    answerable = [q for q in questions if q.get("type") == "answerable"]
    fixes = summary.get("checker_fixes") or []
    initial_failed = [f for f in fixes if not f.get("initial_passed")]
    total = summary.get("total", len(questions))
    return {
        "total": total,
        "answerable_total": len(answerable),
        "answerable_passed": summary.get("answerable_passed", 0),
        "preregistered_passed": total - len(initial_failed),
        "final_passed": summary.get("passed", 0),
        "traps_total": len(questions) - len(answerable),
        "checker_fixes": [{"id": f.get("id"), "fix": f.get("fix")} for f in initial_failed],
        "url": EVAL_URL,
    }


def build_verification(verification_summary, verification_items):
    audit = read_json_file(AUDIT_PATH)
    result = {"present": False, "audit": None, "quotes": None, "outside_psi": build_outside_verification(), "ask_eval": build_ask_eval()}
    if result["outside_psi"] or result["ask_eval"]:
        result["present"] = True
    if isinstance(audit, dict) and isinstance(audit.get("checks"), dict):
        checks = []
        for key, value in audit["checks"].items():
            checks.append({
                "id": key,
                "title": AUDIT_TITLES.get(key) or key.replace("_", " "),
                "description": value.get("description") or "",
                "checked": value.get("checked", 0),
                "passed": value.get("passed", 0),
                "failed": value.get("failed", 0),
            })
        totals = audit.get("totals_excluding_union_line") or {}
        result["audit"] = {
            "seed": audit.get("seed"),
            "checked": totals.get("checked", sum(c["checked"] for c in checks)),
            "passed": totals.get("passed", sum(c["passed"] for c in checks)),
            "failed": totals.get("failed", sum(c["failed"] for c in checks)),
            "checks": checks,
        }
        result["present"] = True
    if verification_items:
        verified = sum(1 for i in verification_items if i["verified"])
        result["quotes"] = {
            "checked": len(verification_items),
            "verified": verified,
            "failed": len(verification_items) - verified,
            "items": verification_items,
            "no_finding": (verification_summary or {}).get("no_finding", []),
        }
        result["present"] = True
    return result


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
    images = load_images()
    verification_summary, verification_items = load_verification_items()
    findings = load_findings(verification_items)
    investigations = build_investigations(rows, unified, meta, public_images(images), findings)
    outside = outside_psi.build_outside(rows)
    insights = build_insights(rows, environments, outside)
    reference = build_rank_reference(investigations, environments)
    default_rankings = {
        env_id: data["ranking"] for env_id, data in reference["variants"]["default"].items()
    }
    test_next = build_test_next(rows, environments, outside)
    earth = build_earth()
    lunar = build_lunar_g()
    corpus = build_corpus(investigations, default_rankings, outside, outside["summary"]["psi_solid_max_o2"], environments, test_next, earth, lunar)
    return {
        "investigations": investigations,
        "conditions": slim_conditions(rows),
        "environments": environments,
        "insights": insights,
        "earth": {"applications": earth},
        "lunar_g": lunar,
        "model_readiness": build_model_readiness(rows, environments),
        "rank_reference": reference,
        "test_next": test_next,
        "outside_psi": outside,
        "verification": build_verification(verification_summary, verification_items),
        "images": images,
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
    dump(os.path.join(SITE_DATA_DIR, "lunar_g.json"), result["lunar_g"])
    dump(os.path.join(SITE_DATA_DIR, "model_readiness.json"), result["model_readiness"])
    dump(os.path.join(SITE_DATA_DIR, "rank_reference.json"), result["rank_reference"])
    dump(os.path.join(SITE_DATA_DIR, "test_next.json"), result["test_next"])
    dump(os.path.join(SITE_DATA_DIR, "outside_psi.json"), ascii_deep(result["outside_psi"]))
    dump(os.path.join(SITE_DATA_DIR, "verification.json"), result["verification"])
    publish_images(result["images"])
    dump(CORPUS_PATH, result["corpus"])
    print("investigations=%d rows=%d meta=%s documents=%d" % (
        len(result["investigations"]), len(result["conditions"]), result["meta_present"], len(result["corpus"]["documents"])))


if __name__ == "__main__":
    main()
