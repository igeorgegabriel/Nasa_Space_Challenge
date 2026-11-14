import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUTSIDE_DIR = os.path.join(ROOT, "data", "outside_psi")
SAFFIRE_PATH = os.path.join(OUTSIDE_DIR, "saffire_iv_vi.json")
PRESSURE_PATH = os.path.join(OUTSIDE_DIR, "solid_pressure_sources.json")
VERIFICATION_PATH = os.path.join(OUTSIDE_DIR, "verification.json")
CORPUS_ID = "NTRS-SAFFIRE-IV-VI"
CORPUS_TITLE = "Outside PSI - Saffire IV-VI (NTRS)"
KPA_PER_ATM = 101.325
NTRS_URL = "https://ntrs.nasa.gov/citations/"


def read_json(path):
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def material_short(material):
    return material.split(" (")[0].split(",")[0].strip()


def outcome_short(outcome):
    return outcome.split(".")[0].strip()


def load_tests():
    data = read_json(SAFFIRE_PATH)
    if not data:
        return []
    tests = []
    for t in data["tests"]:
        kpa = t.get("pressure_kpa")
        psia = t.get("pressure_psia")
        tests.append({
            "flight": t["flight"],
            "sample_id": t["sample_id"],
            "label": "Saffire " + t["sample_id"],
            "material": t["material"],
            "material_short": material_short(t["material"]),
            "o2_percent": t["o2_percent"],
            "o2_frac": round(t["o2_percent"] / 100.0, 6),
            "pressure_kpa": kpa,
            "pressure_psia": psia,
            "pressure_atm": round(kpa / KPA_PER_ATM, 6) if kpa is not None else None,
            "flow_cm_s": t.get("flow_cm_s"),
            "flow_direction": t.get("flow_direction"),
            "outcome": t["outcome"],
            "outcome_short": outcome_short(t["outcome"]),
            "source_id": t["source_id"],
            "source_url": t["source_url"],
            "page": t.get("page"),
            "quote": t["quote"],
            "plotted": kpa is not None and psia is not None,
        })
    return tests


def load_solid_pressures():
    data = read_json(PRESSURE_PATH)
    if not data:
        return {}
    out = {}
    for psi_id, rec in data["records"].items():
        primary = rec.get("primary")
        if primary is None:
            continue
        rng = rec.get("pressure_atm_range")
        atm = rec.get("pressure_atm")
        if atm is None and rng:
            atm = round((rng[0] + rng[1]) / 2.0, 6)
        if atm is None:
            continue
        kpa = rec.get("pressure_kpa")
        kpa_rng = rec.get("pressure_kpa_range")
        if kpa_rng:
            text = "%.1f-%.1f kPa" % (kpa_rng[0], kpa_rng[1])
        elif kpa is not None:
            text = "%.1f kPa" % kpa
        else:
            text = "%.3f atm" % atm
        out[psi_id] = {
            "name": rec.get("name", ""),
            "pressure_atm": atm,
            "pressure_atm_range": rng,
            "pressure_text": text,
            "source_id": primary["source_id"],
            "source_url": primary["source_url"],
        }
    return out


def solid_max_o2(rows):
    values = [r["o2_frac"] for r in rows
              if r.get("fuel_class") == "solid" and r.get("o2_basis") == "ambient"
              and r.get("o2_frac") is not None and r.get("value_quality") in ("exact", "approximate")]
    return max(values) if values else None


def build_outside(rows):
    tests = load_tests()
    pressures = load_solid_pressures()
    psi_max = solid_max_o2(rows)
    plotted = [t for t in tests if t["plotted"]]
    unplotted = [t for t in tests if not t["plotted"]]
    above = [t for t in plotted if psi_max is not None and t["o2_frac"] > psi_max]
    burned = [t for t in plotted if t["outcome_short"].lower().startswith("burned")]
    top = max(burned, key=lambda t: (t["o2_frac"], t["sample_id"])) if burned else None
    summary = {
        "tests": len(tests),
        "plotted": len(plotted),
        "unplotted": [t["sample_id"] for t in unplotted],
        "psi_solid_max_o2": psi_max,
        "above_psi_max": [t["sample_id"] for t in above],
        "above_o2_min": min((t["o2_percent"] for t in above), default=None),
        "above_o2_max": max((t["o2_percent"] for t in above), default=None),
        "above_psia_min": min((t["pressure_psia"] for t in above), default=None),
        "above_psia_max": max((t["pressure_psia"] for t in above), default=None),
        "highest_burned": top["sample_id"] if top else None,
    }
    return {"tests": tests, "solid_pressures": pressures, "summary": summary}


def nearest_outside(outside, env_o2, env_p, psi_key):
    best = None
    best_key = None
    for t in outside["tests"]:
        if not t["plotted"]:
            continue
        o2_gap = gap(t["o2_frac"], env_o2)
        p_gap = gap(t["pressure_atm"], env_p)
        key = (o2_gap, p_gap, t["sample_id"])
        if best_key is None or key < best_key:
            best_key = key
            best = (t, o2_gap, p_gap)
    if best is None:
        return None
    t, o2_gap, p_gap = best
    if psi_key is not None and (o2_gap, p_gap) >= psi_key:
        return None
    return {
        "sample_id": t["sample_id"],
        "label": t["label"],
        "material_short": t["material_short"],
        "o2_frac": t["o2_frac"],
        "pressure_psia": t["pressure_psia"],
        "pressure_atm": t["pressure_atm"],
        "outcome_short": t["outcome_short"],
        "source_id": t["source_id"],
        "source_url": t["source_url"],
        "o2_gap": o2_gap,
        "pressure_gap_atm": p_gap,
        "inside": o2_gap == 0.0 and p_gap == 0.0,
    }


def gap(value, window):
    lo, hi = window
    if value < lo:
        return round(lo - value, 6)
    if value > hi:
        return round(value - hi, 6)
    return 0.0


def corpus_document(outside, psi_max):
    tests = outside["tests"]
    lines = [
        "Saffire IV-VI solid flammability tests published by NASA on NTRS. These tests are not in the PSI repository "
        "and are not part of the unified PSI conditions table.",
    ]
    if psi_max is not None:
        lines.append("For comparison, PSI solid-fuel tests stop at %s percent ambient O2." % fmt_pct(psi_max * 100))
    for t in tests:
        parts = ["%s (NTRS %s): %s" % (t["label"], t["source_id"], t["material"])]
        parts.append("%s percent O2" % fmt_pct(t["o2_percent"]))
        if t["pressure_kpa"] is not None:
            parts.append("%s kPa (%s psia)" % (fmt_pct(t["pressure_kpa"]), fmt_pct(t["pressure_psia"], 2)))
        else:
            parts.append("pressure not stated in the extracted text")
        if t["flow_cm_s"] is not None:
            parts.append("%s cm/s %s flow" % (t["flow_cm_s"], t["flow_direction"] or ""))
        lines.append(", ".join(p.strip() for p in parts) + ". Outcome: " + t["outcome"].rstrip(".") + ".")
    for t in tests:
        lines.append("Verbatim quote for %s (NTRS %s, page %s): \"%s\"" % (t["label"], t["source_id"], t["page"], t["quote"]))
    return {
        "psi_id": CORPUS_ID,
        "title": CORPUS_TITLE,
        "body": "\n".join(lines),
    }


def fmt_pct(value, digits=1):
    return ("%." + str(digits) + "f") % value
