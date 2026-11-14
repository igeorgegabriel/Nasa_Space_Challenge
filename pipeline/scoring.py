import math

COMPONENTS = ["o2", "pressure", "flow", "fuel", "function", "richness"]

COMPONENT_LABELS = {
    "o2": "O2 coverage",
    "pressure": "Pressure coverage",
    "flow": "Flow coverage",
    "fuel": "Fuel realism",
    "function": "Fire-safety function",
    "richness": "Data richness",
}

DEFAULT_WEIGHTS = {
    "o2": 0.30,
    "pressure": 0.15,
    "flow": 0.10,
    "fuel": 0.15,
    "function": 0.15,
    "richness": 0.15,
}

FUEL_REALISM = {"solid": 1.0, "liquid_droplet": 0.5, "gas": 0.3}

CORE_FUNCTIONS = ("prevention", "detection", "suppression")

RICHNESS_ROWS_CAP = 500
RICHNESS_ROW_WEIGHT = 0.6
PERTURBATION = 0.2
ROUND_DIGITS = 9


def overlap(env_lo, env_hi, lo, hi):
    if lo is None or hi is None:
        return 0.0
    if env_hi == env_lo:
        return 1.0 if lo <= env_lo <= hi else 0.0
    inter = min(env_hi, hi) - max(env_lo, lo)
    if inter <= 0:
        return 0.0
    return min(1.0, inter / (env_hi - env_lo))


def range_pair(block):
    if not block:
        return None, None
    return block.get("min"), block.get("max")


def fuel_realism(fuel_class):
    return FUEL_REALISM.get(fuel_class)


def function_relevance(functions):
    funcs = list(functions or [])
    if any(f in CORE_FUNCTIONS for f in funcs):
        return 1.0, "core"
    if "fundamental" in funcs:
        return 0.5, "fundamental"
    return 0.5, "unassigned"


def richness(row_count, outcome_rows):
    if not row_count:
        return 0.0
    size = min(1.0, math.log10(1 + row_count) / math.log10(1 + RICHNESS_ROWS_CAP))
    share = outcome_rows / row_count
    return RICHNESS_ROW_WEIGHT * size + (1.0 - RICHNESS_ROW_WEIGHT) * share


def components(inv, env, include_stream=False):
    ranges = inv.get("ranges", {})
    o2_lo, o2_hi = env["o2"]["min"], env["o2"]["max"]
    p_lo, p_hi = env["pressure_atm"]["min"], env["pressure_atm"]["max"]
    f_lo, f_hi = env["flow_cm_s"]["min"], env["flow_cm_s"]["max"]
    amb = overlap(o2_lo, o2_hi, *range_pair(ranges.get("o2_ambient")))
    stream = overlap(o2_lo, o2_hi, *range_pair(ranges.get("o2_oxidizer_stream")))
    o2 = max(amb, stream) if include_stream else amb
    func_value, func_label = function_relevance(inv.get("functions"))
    return {
        "o2": o2,
        "o2_ambient": amb,
        "o2_stream": stream,
        "pressure": overlap(p_lo, p_hi, *range_pair(ranges.get("pressure_atm"))),
        "flow": overlap(f_lo, f_hi, *range_pair(ranges.get("flow_cm_s"))),
        "fuel": fuel_realism(inv.get("fuel_class")),
        "function": func_value,
        "function_label": func_label,
        "richness": richness(inv.get("row_count", 0), inv.get("outcome_rows", 0)),
    }


def weighted_score(comps, weights):
    total = 0.0
    used = 0.0
    for name in COMPONENTS:
        value = comps.get(name)
        weight = weights.get(name, 0.0)
        if value is None or weight <= 0:
            continue
        total += weight * value
        used += weight
    if used == 0:
        return 0.0
    return round(total / used, ROUND_DIGITS)


def rank_all(investigations, env, weights=None, include_stream=False):
    weights = weights or DEFAULT_WEIGHTS
    scored = []
    for inv in investigations:
        if not inv.get("row_count"):
            continue
        comps = components(inv, env, include_stream)
        scored.append({
            "psi_id": inv["psi_id"],
            "components": comps,
            "score": weighted_score(comps, weights),
        })
    scored.sort(key=lambda item: (-item["score"], item["psi_id"]))
    for index, item in enumerate(scored):
        item["rank"] = index + 1
    return scored


def perturbed_weight_sets(weights):
    sets = []
    for name in COMPONENTS:
        for factor in (1.0 - PERTURBATION, 1.0 + PERTURBATION):
            changed = dict(weights)
            changed[name] = weights[name] * factor
            sets.append(changed)
    return sets


def rank_stability(investigations, env, weights=None, include_stream=False):
    weights = weights or DEFAULT_WEIGHTS
    base = rank_all(investigations, env, weights, include_stream)
    low = {item["psi_id"]: item["rank"] for item in base}
    high = dict(low)
    for changed in perturbed_weight_sets(weights):
        for item in rank_all(investigations, env, changed, include_stream):
            pid = item["psi_id"]
            low[pid] = min(low[pid], item["rank"])
            high[pid] = max(high[pid], item["rank"])
    return {pid: {"min": low[pid], "max": high[pid]} for pid in low}
