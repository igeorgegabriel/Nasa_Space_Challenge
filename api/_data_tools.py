import json
import os
from collections import Counter

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")

HABITATS = ("iss", "gateway", "lunar", "rover", "mars")
HABITAT_NAMES = {
    "iss": "ISS cabin",
    "gateway": "Gateway",
    "lunar": "Moon base",
    "rover": "Pressurized rover",
    "mars": "Mars base",
}
PSIA_PER_ATM = 14.696
EPS = 1e-9
MAX_EXAMPLES = 5
MAX_ACTIONS = 2

_cache = {}


def load_json(name):
    if name not in _cache:
        with open(os.path.join(DATA_DIR, name), "r", encoding="utf-8") as handle:
            _cache[name] = json.load(handle)
    return _cache[name]


def condition_rows():
    return load_json("conditions.json")


def fuel_classes():
    return sorted({row["fuel_class"] for row in condition_rows() if row.get("fuel_class")})


def investigation_names():
    if "inv_names" not in _cache:
        _cache["inv_names"] = {
            inv["psi_id"]: (inv.get("acronym") or inv.get("name") or inv["psi_id"])
            for inv in load_json("investigations.json")["investigations"]
        }
    return _cache["inv_names"]


def inv_name(psi_id):
    return investigation_names().get(psi_id, psi_id)


def habitat_name(habitat):
    return HABITAT_NAMES.get(habitat, habitat)


def check_habitat(habitat):
    if habitat not in HABITATS:
        return {"error": "Unknown habitat %r. Use one of: %s." % (habitat, ", ".join(HABITATS))}
    return None


def num(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def rank_investigations(habitat, top_n=5):
    bad = check_habitat(habitat)
    if bad:
        return bad
    top = num(top_n)
    top = 5 if top is None else max(1, min(int(top), 10))
    ranking = load_json("rank_reference.json")["variants"]["default"][habitat]["ranking"]
    items = []
    for entry in ranking[:top]:
        items.append({
            "rank": entry["rank"],
            "psi_id": entry["psi_id"],
            "investigation": inv_name(entry["psi_id"]),
            "score": round(entry["score"], 2),
            "condition": round(entry["condition"], 2),
            "topic": round(entry["topic"], 2),
        })
    return {"habitat": habitat, "habitat_name": habitat_name(habitat), "total_ranked": len(ranking), "ranking": items}


def find_tests(fuel_class=None, psi_id=None, o2_min_pct=None, o2_max_pct=None, pressure_min_psia=None, pressure_max_psia=None, o2_basis="ambient"):
    if fuel_class is not None and fuel_class not in fuel_classes():
        return {"error": "Unknown fuel_class %r. Use one of: %s." % (fuel_class, ", ".join(fuel_classes()))}
    if psi_id is not None and psi_id not in investigation_names():
        return {"error": "Unknown psi_id %r." % (psi_id,)}
    if o2_basis not in ("ambient", "oxidizer_stream"):
        return {"error": "o2_basis must be ambient or oxidizer_stream."}
    bounds = {}
    for name, value in (("o2_min_pct", o2_min_pct), ("o2_max_pct", o2_max_pct), ("pressure_min_psia", pressure_min_psia), ("pressure_max_psia", pressure_max_psia)):
        if value is None:
            bounds[name] = None
            continue
        parsed = num(value)
        if parsed is None:
            return {"error": "%s must be a number." % name}
        bounds[name] = parsed
    o2_filtered = bounds["o2_min_pct"] is not None or bounds["o2_max_pct"] is not None
    p_filtered = bounds["pressure_min_psia"] is not None or bounds["pressure_max_psia"] is not None
    rows = condition_rows()
    matched = []
    for row in rows:
        if fuel_class is not None and row.get("fuel_class") != fuel_class:
            continue
        if psi_id is not None and row.get("psi_id") != psi_id:
            continue
        if o2_filtered:
            frac = row.get("o2_frac")
            if frac is None or row.get("o2_basis") != o2_basis:
                continue
            pct = round(frac * 100, 6)
            if bounds["o2_min_pct"] is not None and pct < bounds["o2_min_pct"] - EPS:
                continue
            if bounds["o2_max_pct"] is not None and pct > bounds["o2_max_pct"] + EPS:
                continue
        if p_filtered:
            atm = row.get("pressure_atm")
            if atm is None:
                continue
            psia = atm * PSIA_PER_ATM
            if bounds["pressure_min_psia"] is not None and psia < bounds["pressure_min_psia"] - EPS:
                continue
            if bounds["pressure_max_psia"] is not None and psia > bounds["pressure_max_psia"] + EPS:
                continue
        matched.append(row)
    per_inv = Counter(row["psi_id"] for row in matched)
    o2_values = [round(row["o2_frac"] * 100, 2) for row in matched if row.get("o2_frac") is not None and (not o2_filtered or row.get("o2_basis") == o2_basis)]
    examples = []
    for row in matched[:MAX_EXAMPLES]:
        frac = row.get("o2_frac")
        atm = row.get("pressure_atm")
        examples.append({
            "psi_id": row["psi_id"],
            "source_file": row["source_file"],
            "source_row": row["source_row"],
            "o2_pct": None if frac is None else round(frac * 100, 2),
            "o2_basis": row.get("o2_basis"),
            "pressure_psia": None if atm is None else round(atm * PSIA_PER_ATM, 2),
            "fuel": row.get("fuel"),
            "outcome": row.get("outcome"),
        })
    return {
        "rows_searched": len(rows),
        "matched": len(matched),
        "o2_basis_used": o2_basis if o2_filtered else None,
        "per_investigation": [{"psi_id": pid, "investigation": inv_name(pid), "rows": count} for pid, count in per_inv.most_common(8)],
        "matched_investigations": len(per_inv),
        "o2_min_pct": min(o2_values) if o2_values else None,
        "o2_max_pct": max(o2_values) if o2_values else None,
        "examples": examples,
    }


def pct_range(window):
    if not window or window.get("min") is None or window.get("max") is None:
        return None
    return [round(window["min"] * 100, 2), round(window["max"] * 100, 2)]


def psia_range(window):
    if not window or window.get("min") is None or window.get("max") is None:
        return None
    return [round(window["min"] * PSIA_PER_ATM, 2), round(window["max"] * PSIA_PER_ATM, 2)]


def test_next(habitat):
    bad = check_habitat(habitat)
    if bad:
        return bad
    env = load_json("test_next.json")["environments"][habitat]
    windows = env.get("windows", {})
    classes = []
    for entry in env.get("classes", []):
        nearest = entry.get("nearest") or {}
        frac = nearest.get("o2_frac")
        atm = nearest.get("pressure_atm")
        classes.append({
            "fuel_class": entry.get("fuel_class"),
            "classified_rows": entry.get("classified_rows"),
            "tests_inside_window": entry.get("inside"),
            "nearest_tested": {
                "psi_id": nearest.get("psi_id"),
                "source_file": nearest.get("source_file"),
                "source_row": nearest.get("source_row"),
                "o2_pct": None if frac is None else round(frac * 100, 2),
                "pressure_psia": None if atm is None else round(atm * PSIA_PER_ATM, 2),
            },
        })
    flow = windows.get("flow_cm_s")
    return {
        "habitat": habitat,
        "habitat_name": habitat_name(habitat),
        "window": {
            "o2_pct": pct_range(windows.get("o2")),
            "pressure_psia": psia_range(windows.get("pressure_atm")),
            "flow_cm_s": [flow.get("min"), flow.get("max")] if flow else None,
        },
        "fuel_classes": classes,
    }


def model_readiness(habitat):
    bad = check_habitat(habitat)
    if bad:
        return bad
    data = load_json("model_readiness.json")
    titles = {rel["id"]: rel.get("title", rel["id"]) for rel in data.get("relationships", [])}
    items = []
    for item in data["environments"][habitat].get("items", []):
        items.append({
            "relationship": titles.get(item["id"], item["id"]),
            "status": item.get("status"),
            "reason": item.get("short") or item.get("reason"),
        })
    return {"habitat": habitat, "habitat_name": habitat_name(habitat), "relationships": items}


def profile_field(spec):
    if not spec or spec.get("not_specified"):
        return {"value": "not specified", "sources": []}
    refs = []
    for source in spec.get("sources", []):
        ref = source.get("ref")
        if ref and ref not in refs:
            refs.append(ref)
    return {"value": spec.get("display") or "not specified", "sources": refs[:3]}


def habitat_profile(habitat):
    bad = check_habitat(habitat)
    if bad:
        return bad
    env = next(item for item in load_json("environments.json")["environments"] if item["id"] == habitat)
    return {
        "habitat": habitat,
        "name": env.get("name"),
        "o2": profile_field(env.get("o2")),
        "pressure": profile_field(env.get("pressure_atm")),
        "flow": profile_field(env.get("flow_cm_s")),
        "gravity": profile_field(env.get("gravity")),
    }


def flex_model(habitat):
    bad = check_habitat(habitat)
    if bad:
        return bad
    model = load_json("models.json")["models"][0]
    hab = next(h for h in model["habitats"] if h["id"] == habitat)
    val = model["validation"]
    fuels = []
    for fuel, out in sorted(hab["fuels"].items()):
        entry = {"fuel": fuel, "status": out["status"]}
        if out.get("prediction"):
            entry["chance_flame_goes_out_on_its_own"] = out["prediction"]
        if out.get("refusal"):
            entry["refusal"] = out["refusal"]
        fuels.append(entry)
    return {
        "habitat": habitat,
        "habitat_name": habitat_name(habitat),
        "model": model["name"],
        "target": model["target"],
        "rows_used": model["rows_used"],
        "validation": {"scheme": "held-out test days", "auc": val["auc"], "auc_ci95": val["auc_ci95"], "brier_skill": val["brier_skill"], "brier_skill_ci95": val["brier_skill_ci95"]},
        "habitat_status": hab["status"],
        "fuels": fuels,
    }


TOOL_FUNCTIONS = {
    "rank_investigations": rank_investigations,
    "find_tests": find_tests,
    "test_next": test_next,
    "model_readiness": model_readiness,
    "habitat_profile": habitat_profile,
    "flex_model": flex_model,
}


def habitat_property():
    return {"type": "string", "enum": list(HABITATS), "description": "Habitat id: iss (ISS cabin), gateway, lunar (Moon base), rover (pressurized rover), mars (Mars base)."}


def tool_definitions():
    return [
        {
            "name": "rank_investigations",
            "description": "Ranking of PSI investigations for a habitat using the website's default weights. Returns rank, psi_id, short name, score, condition and topic components. Use for any 'which investigations matter most' question.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "habitat": habitat_property(),
                    "top_n": {"type": "integer", "minimum": 1, "maximum": 10, "description": "How many top entries to return. Default 5."},
                },
                "required": ["habitat"],
            },
        },
        {
            "name": "find_tests",
            "description": "Count and filter the 2,009 PSI test rows the website shows. Filters are optional and combine. A row with no recorded value for a filtered quantity does not match. Returns rows searched, matches, matches per investigation, min and max O2 among matches and up to 5 example rows with source file and row. Use for any 'how many tests' or 'was X ever tested at Y' question.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "fuel_class": {"type": "string", "enum": fuel_classes(), "description": "Fuel class of the test row."},
                    "psi_id": {"type": "string", "description": "Investigation id such as PSI-69."},
                    "o2_min_pct": {"type": "number", "description": "Minimum O2 in percent (mole fraction times 100)."},
                    "o2_max_pct": {"type": "number", "description": "Maximum O2 in percent."},
                    "pressure_min_psia": {"type": "number", "description": "Minimum pressure in psia."},
                    "pressure_max_psia": {"type": "number", "description": "Maximum pressure in psia."},
                    "o2_basis": {"type": "string", "enum": ["ambient", "oxidizer_stream"], "description": "Which O2 quantity the O2 bounds apply to. Default ambient."},
                },
            },
        },
        {
            "name": "test_next",
            "description": "For a habitat: per fuel class, the habitat's O2, pressure and flow window, how many tests lie inside it, and the nearest tested condition with its investigation, source file and row. Use for 'what should NASA test next' questions.",
            "input_schema": {"type": "object", "properties": {"habitat": habitat_property()}, "required": ["habitat"]},
        },
        {
            "name": "model_readiness",
            "description": "For a habitat: each fire-modelling relationship with its support status (Supported, Partly, Not supported) and a short reason. Use for 'can a model be trained or validated here' questions.",
            "input_schema": {"type": "object", "properties": {"habitat": habitat_property()}, "required": ["habitat"]},
        },
        {
            "name": "habitat_profile",
            "description": "The atmosphere definition used for a habitat: O2, pressure, flow and gravity display strings with source labels, or 'not specified'.",
            "input_schema": {"type": "object", "properties": {"habitat": habitat_property()}, "required": ["habitat"]},
        },
        {
            "name": "flex_model",
            "description": "The dashboard's FLEX droplet-flame model for a habitat: chance that a heptane or methanol droplet flame goes out on its own (radiative extinction), with 95 percent interval, validated on held-out test days; or the refusal and how far the habitat lies outside the tested range. Use for any prediction or 'what would happen in this habitat' question.",
            "input_schema": {"type": "object", "properties": {"habitat": habitat_property()}, "required": ["habitat"]},
        },
    ]


def run_tool(name, tool_input):
    function = TOOL_FUNCTIONS.get(name)
    if function is None:
        return {"error": "Unknown tool %r." % (name,)}
    if not isinstance(tool_input, dict):
        return {"error": "Tool input must be an object."}
    try:
        return function(**tool_input)
    except TypeError as exc:
        return {"error": "Invalid arguments: %s" % exc}
    except (KeyError, ValueError, StopIteration):
        return {"error": "Tool failed on the website data."}


def format_o2_filter(inputs):
    low = inputs.get("o2_min_pct")
    high = inputs.get("o2_max_pct")
    basis = "ambient" if inputs.get("o2_basis", "ambient") == "ambient" else "oxidizer-stream"
    if low is None and high is None:
        return None
    if low is not None and high is not None:
        return "%s O2 %g to %g%%" % (basis, low, high)
    if low is not None:
        return "%s O2 at least %g%%" % (basis, low)
    return "%s O2 at most %g%%" % (basis, high)


def format_pressure_filter(inputs):
    low = inputs.get("pressure_min_psia")
    high = inputs.get("pressure_max_psia")
    if low is None and high is None:
        return None
    if low is not None and high is not None:
        return "pressure %g to %g psia" % (low, high)
    if low is not None:
        return "pressure at least %g psia" % low
    return "pressure at most %g psia" % high


def build_step(name, tool_input, result):
    if not isinstance(result, dict) or "error" in result or not isinstance(tool_input, dict):
        return None
    habitat = tool_input.get("habitat")
    hname = habitat_name(habitat)
    if name == "rank_investigations":
        top = result["ranking"][:3]
        detail = ", ".join("%d %s %.2f" % (item["rank"], item["investigation"], item["score"]) for item in top)
        return {"tool": name, "label": "Ranked %d investigations for %s" % (result["total_ranked"], hname), "detail": detail}
    if name == "find_tests":
        parts = []
        if tool_input.get("fuel_class"):
            parts.append(tool_input["fuel_class"].replace("_", " "))
        if tool_input.get("psi_id"):
            parts.append(inv_name(tool_input["psi_id"]))
        for text in (format_o2_filter(tool_input), format_pressure_filter(tool_input)):
            if text:
                parts.append(text)
        count = result["matched"]
        tail = "%d match%s" % (count, "" if count == 1 else "es")
        detail = "%s: %s" % (", ".join(parts), tail) if parts else tail
        return {"tool": name, "label": "Searched {:,} test rows".format(result["rows_searched"]), "detail": detail}
    if name == "test_next":
        detail = ", ".join("%s %s inside" % ((entry["fuel_class"] or "unclassified").replace("_", " "), entry["tests_inside_window"]) for entry in result["fuel_classes"])
        return {"tool": name, "label": "Checked test-next windows for %s" % hname, "detail": detail}
    if name == "model_readiness":
        counts = Counter(item["status"] for item in result["relationships"])
        detail = ", ".join("%d %s" % (count, status) for status, count in counts.items())
        return {"tool": name, "label": "Checked model readiness for %s" % hname, "detail": detail}
    if name == "habitat_profile":
        detail = "O2 %s; pressure %s" % (result["o2"]["value"], result["pressure"]["value"])
        return {"tool": name, "label": "Read the %s atmosphere profile" % hname, "detail": detail}
    if name == "flex_model":
        parts = []
        for entry in result["fuels"]:
            pred = entry.get("chance_flame_goes_out_on_its_own")
            parts.append("%s %s" % (entry["fuel"].lower(), "%.0f%%" % (pred["estimate"] * 100) if pred else "no prediction"))
        return {"tool": name, "label": "Ran the FLEX model for %s" % hname, "detail": ", ".join(parts)}
    return None


def build_action(name, tool_input, result):
    if not isinstance(result, dict) or "error" in result or not isinstance(tool_input, dict):
        return None
    habitat = tool_input.get("habitat")
    if name in ("rank_investigations", "test_next", "habitat_profile"):
        return {"label": "Open the %s ranking" % habitat_name(habitat), "href": "#/rank?habitat=%s" % habitat}
    if name == "find_tests":
        psi_id = tool_input.get("psi_id")
        if psi_id:
            return {"label": "Open %s rows" % inv_name(psi_id), "href": "#/data?inv=%s&at=extractor" % psi_id}
        return {"label": "Open the data extractor", "href": "#/data?at=extractor"}
    if name == "model_readiness":
        return {"label": "Open model readiness", "href": "#/data?at=readiness"}
    if name == "flex_model":
        return {"label": "Open the FLEX model", "href": "#/data?at=model"}
    return None


def build_steps_and_actions(log, context_psi_id=None, cited_psi_ids=()):
    steps = []
    actions = []
    seen = set()
    for name, tool_input, result in log:
        step = build_step(name, tool_input, result)
        if step:
            steps.append(step)
        action = build_action(name, tool_input, result)
        if action and action["href"] not in seen:
            seen.add(action["href"])
            actions.append(action)
    if context_psi_id and context_psi_id in cited_psi_ids:
        href = "#/investigation/%s" % context_psi_id
        if href not in seen:
            actions.append({"label": "Open %s" % inv_name(context_psi_id), "href": href})
    return steps, actions[:MAX_ACTIONS]
