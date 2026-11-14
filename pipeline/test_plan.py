import itertools
import math
import re
from collections import OrderedDict

PSIA_PER_ATM = 14.6959
CLASS_PRIORITY = ["solid", "liquid_droplet", "gas"]
NOT_SPECIFIED_TEXT = "not specified by NASA sources"
MICRO_G_LIMIT = 0.05
DIGITS = 6


def psi_number(psi_id):
    match = re.search(r"\d+", psi_id or "")
    return int(match.group()) if match else 0


def window_of(env, key):
    block = env[key]
    if block.get("not_specified") or block.get("window_min") is None:
        return None
    return (block["window_min"], block["window_max"])


def env_windows(env):
    return {
        "o2": window_of(env, "o2"),
        "pressure_atm": window_of(env, "pressure_atm"),
        "flow_cm_s": window_of(env, "flow_cm_s"),
    }


def intersect(a, b):
    lo = max(a[0], b[0])
    hi = min(a[1], b[1])
    return (lo, hi) if lo <= hi else None


def box_for(subset, windows):
    o2 = None
    pressure = None
    flow = None
    for env_id in subset:
        w = windows[env_id]
        o2 = w["o2"] if o2 is None else intersect(o2, w["o2"])
        pressure = w["pressure_atm"] if pressure is None else intersect(pressure, w["pressure_atm"])
        if o2 is None or pressure is None:
            return None
        if w["flow_cm_s"] is not None:
            flow = w["flow_cm_s"] if flow is None else intersect(flow, w["flow_cm_s"])
            if flow is None:
                return None
    return {"o2": o2, "pressure_atm": pressure, "flow_cm_s": flow}


def contains(window, inner):
    return window[0] <= inner[0] and inner[1] <= window[1]


def box_inside(box, w):
    if not (contains(w["o2"], box["o2"]) and contains(w["pressure_atm"], box["pressure_atm"])):
        return False
    if w["flow_cm_s"] is None:
        return True
    return box["flow_cm_s"] is not None and contains(w["flow_cm_s"], box["flow_cm_s"])


def center(window):
    return round((window[0] + window[1]) / 2.0, DIGITS)


def point_of(box):
    return {
        "o2": center(box["o2"]),
        "pressure_atm": center(box["pressure_atm"]),
        "flow_cm_s": center(box["flow_cm_s"]) if box["flow_cm_s"] is not None else None,
    }


def distance_to(point, row):
    o2_gap = abs(row["o2_frac"] - point["o2"]) * 100.0
    if not row.get("pressure_atm") or row["pressure_atm"] <= 0:
        return o2_gap, o2_gap, None
    p_gap = abs(row["pressure_atm"] - point["pressure_atm"]) * PSIA_PER_ATM
    return math.hypot(o2_gap, p_gap), o2_gap, p_gap


def nearest_test(point, rows):
    best = None
    best_key = None
    for row in rows:
        dist, o2_gap, p_gap = distance_to(point, row)
        key = (round(dist, 9), psi_number(row["psi_id"]), row["source_row"])
        if best_key is None or key < best_key:
            best_key = key
            best = (row, dist, o2_gap, p_gap)
    if best is None:
        return None, None
    row, dist, o2_gap, p_gap = best
    return {
        "psi_id": row["psi_id"],
        "investigation": row.get("investigation"),
        "source_file": row["source_file"],
        "source_row": row["source_row"],
        "o2_frac": row["o2_frac"],
        "pressure_atm": row["pressure_atm"] if row.get("pressure_atm") and row["pressure_atm"] > 0 else None,
        "flow_cm_s": row.get("flow_cm_s"),
        "o2_gap_points": round(o2_gap, 3),
        "pressure_gap_psia": round(p_gap, 3) if p_gap is not None else None,
        "distance": round(dist, 3),
    }, dist


def range_block(window):
    return {"min": round(window[0], DIGITS), "max": round(window[1], DIGITS)} if window else None


def gravity_info(env_ids, envs_by_id):
    levels = OrderedDict()
    micro = []
    partial = []
    for env_id in env_ids:
        g = envs_by_id[env_id]["gravity"]
        levels[env_id] = g["display"]
        if g.get("g") is None or g["g"] < MICRO_G_LIMIT:
            micro.append(env_id)
        else:
            partial.append(env_id)
    if not partial:
        note = "A microgravity facility such as the ISS reproduces this gravity."
    elif not micro:
        note = "Moon and Mars gravity cannot be reproduced on the ISS; a microgravity run covers the air only."
    else:
        note = "A microgravity run covers the free-fall habitats; Moon and Mars gravity cannot be reproduced on the ISS."
    return OrderedDict([("levels", levels), ("micro", micro), ("partial", partial), ("note", note)])


def source_refs(env_ids, envs_by_id):
    refs = []
    for env_id in env_ids:
        env = envs_by_id[env_id]
        for key in ("o2", "pressure_atm", "flow_cm_s"):
            for src in env[key].get("sources", []):
                ref = src.get("ref")
                if ref and ref != "challenge" and ref not in refs:
                    refs.append(ref)
    return refs


def class_candidates(gap_envs, windows):
    out = []
    ordered = sorted(gap_envs)
    for size in range(1, len(ordered) + 1):
        for subset in itertools.combinations(ordered, size):
            box = box_for(subset, windows)
            if box is None:
                continue
            covers = frozenset(e for e in ordered if box_inside(box, windows[e]))
            out.append({"subset": subset, "box": box, "covers": covers, "point": point_of(box)})
    return out


def plan_class(gap_envs, windows, class_rows):
    candidates = class_candidates(gap_envs, windows)
    for cand in candidates:
        cand["nearest"], cand["novelty"] = nearest_test(cand["point"], class_rows)
    uncovered = set(gap_envs)
    chosen = []
    while uncovered:
        best = None
        best_key = None
        for cand in candidates:
            newly = cand["covers"] & uncovered
            if not newly:
                continue
            novelty = cand["novelty"] if cand["novelty"] is not None else float("inf")
            key = (-len(newly), -round(novelty, 9), cand["subset"])
            if best_key is None or key < best_key:
                best_key = key
                best = (cand, newly)
        if best is None:
            break
        cand, newly = best
        chosen.append({"cand": cand, "closes": sorted(newly)})
        uncovered -= newly
    return chosen, sorted(uncovered)


def build_test_plan(rows, environments, test_next):
    envs_by_id = OrderedDict((e["id"], e) for e in environments["environments"])
    windows = {}
    for env_id in test_next["environments"]:
        w = env_windows(envs_by_id[env_id])
        if w["o2"] is not None and w["pressure_atm"] is not None:
            windows[env_id] = w
    gaps = []
    tests = []
    unplanned = []
    for fc in CLASS_PRIORITY:
        gap_envs = []
        for env_id, block in test_next["environments"].items():
            if env_id not in windows:
                continue
            entry = next((c for c in block["classes"] if c["fuel_class"] == fc), None)
            if entry is not None and entry["inside"] == 0:
                gap_envs.append(env_id)
        class_rows = [r for r in rows if r.get("fuel_class") == fc and r.get("o2_frac") is not None]
        with_pressure = [r for r in class_rows if r.get("pressure_atm") is not None and r["pressure_atm"] > 0]
        if with_pressure:
            class_rows = with_pressure
        chosen, left = plan_class(gap_envs, windows, class_rows)
        for env_id in left:
            unplanned.append({"habitat": env_id, "fuel_class": fc})
        for item in chosen:
            cand = item["cand"]
            tests.append({
                "fuel_class": fc,
                "closes": item["closes"],
                "box": cand["box"],
                "point": cand["point"],
                "nearest": cand["nearest"],
                "novelty": cand["novelty"] if cand["novelty"] is not None else 0.0,
            })
        for env_id in sorted(gap_envs):
            gaps.append({"habitat": env_id, "fuel_class": fc})
    tests.sort(key=lambda t: (-len(t["closes"]), CLASS_PRIORITY.index(t["fuel_class"]), -round(t["novelty"], 9), t["closes"]))
    out_tests = []
    owner = {}
    for rank, t in enumerate(tests, 1):
        test_id = "T%02d" % rank
        for env_id in t["closes"]:
            owner[(env_id, t["fuel_class"])] = test_id
        flow = t["box"]["flow_cm_s"]
        out_tests.append(OrderedDict([
            ("id", test_id),
            ("rank", rank),
            ("fuel_class", t["fuel_class"]),
            ("o2", range_block(t["box"]["o2"])),
            ("pressure_atm", range_block(t["box"]["pressure_atm"])),
            ("flow_cm_s", range_block(flow)),
            ("flow_note", None if flow else NOT_SPECIFIED_TEXT),
            ("point", t["point"]),
            ("habitats", t["closes"]),
            ("habitat_names", [envs_by_id[e]["name"] for e in t["closes"]]),
            ("gravity", gravity_info(t["closes"], envs_by_id)),
            ("nearest", t["nearest"]),
            ("source_refs", source_refs(t["closes"], envs_by_id)),
        ]))
    for g in gaps:
        g["test"] = owner.get((g["habitat"], g["fuel_class"]))
    closed = sum(1 for g in gaps if g["test"])
    headline = {
        "tests": len(out_tests),
        "closed": closed,
        "gaps": len(gaps),
        "text": "%d %s would close %d of %d habitat gaps" % (len(out_tests), "test" if len(out_tests) == 1 else "tests", closed, len(gaps)),
    }
    plan_windows = OrderedDict()
    for env_id, w in windows.items():
        plan_windows[env_id] = {
            "name": envs_by_id[env_id]["name"],
            "o2": range_block(w["o2"]),
            "pressure_atm": range_block(w["pressure_atm"]),
            "flow_cm_s": range_block(w["flow_cm_s"]),
            "gravity": envs_by_id[env_id]["gravity"]["display"],
        }
    return OrderedDict([
        ("headline", headline),
        ("tests", out_tests),
        ("gaps", gaps),
        ("unplanned", unplanned),
        ("windows", plan_windows),
        ("method", [
            "A gap is a habitat and fuel class with no PSI test inside the habitat window (the count in test_next.json is 0).",
            "Candidate tests are the habitat windows and every overlap of them; a planned test is a box that lies inside the windows it covers.",
            "Greedy cover per fuel class: pick the box that covers the most uncovered habitats; ties go to the box furthest from any existing PSI test.",
            "Distance is derived: sqrt(O2 gap in percentage points squared + pressure gap in psia squared) from the box centre to the nearest PSI row of that fuel class with a recorded pressure; where the class has no recorded pressure at all (solid fuels) it is the O2 gap alone.",
            "Gravity is not part of the cover: a microgravity facility matches the free-fall habitats only.",
        ]),
    ])
