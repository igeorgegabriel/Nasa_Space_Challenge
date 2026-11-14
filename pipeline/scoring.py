import math

TOPIC_COMPONENTS = ["fuel", "function", "richness"]
CONDITION_COMPONENTS = ["o2", "pressure", "flow"]
COMPONENTS = TOPIC_COMPONENTS + CONDITION_COMPONENTS

COMPONENT_LABELS = {
    "fuel": "Fuel realism",
    "function": "Fire-safety function",
    "richness": "Data richness",
    "o2": "O2 coverage",
    "pressure": "Pressure coverage",
    "flow": "Flow coverage",
}

DEFAULT_WEIGHTS = {
    "fuel": 0.25,
    "function": 0.25,
    "richness": 0.10,
    "o2": 0.20,
    "pressure": 0.10,
    "flow": 0.10,
}

FUEL_REALISM = {"solid": 1.0, "liquid_droplet": 0.5, "gas": 0.3}

CORE_FUNCTIONS = ("prevention", "detection", "suppression")
FUNDAMENTAL_ONLY_VALUE = 0.4
KEYWORD_SOURCE = "keyword match on PSI text"
KEYWORD_MIN_SCORE = 3
UNASSIGNED_VALUE = 0.2

RICHNESS_ROWS_CAP = 500
RICHNESS_ROW_WEIGHT = 0.6
PERTURBATION = 0.2
ROUND_DIGITS = 9
SPAN_SHARE = 0.5


def overlap(env_lo, env_hi, lo, hi):
    if lo is None or hi is None:
        return 0.0
    if env_hi == env_lo:
        return 1.0 if lo <= env_lo <= hi else 0.0
    inter = min(env_hi, hi) - max(env_lo, lo)
    if inter <= 0:
        return 0.0
    return min(1.0, inter / (env_hi - env_lo))


def value_inside(env_lo, env_hi, block):
    for value in block.get("values") or []:
        if env_lo <= value <= env_hi:
            return True
    for lo, hi in block.get("spans") or []:
        if lo <= env_hi and hi >= env_lo:
            return True
    return False


def coverage(env_lo, env_hi, block):
    if not block:
        return 0.0
    span = overlap(env_lo, env_hi, block.get("min"), block.get("max"))
    hit = 1.0 if value_inside(env_lo, env_hi, block) else 0.0
    return round(SPAN_SHARE * span + (1.0 - SPAN_SHARE) * hit, ROUND_DIGITS)


def is_specified(env, key):
    block = env.get(key) or {}
    if block.get("not_specified"):
        return False
    lo = block["window_min"] if "window_min" in block else block.get("min")
    hi = block["window_max"] if "window_max" in block else block.get("max")
    return lo is not None and hi is not None


def window_of(env, key):
    block = env[key]
    lo = block["window_min"] if "window_min" in block else block["min"]
    hi = block["window_max"] if "window_max" in block else block["max"]
    return lo, hi


def fuel_realism(fuel_class):
    return FUEL_REALISM.get(fuel_class)


def function_names(functions):
    names = set()
    for item in functions or []:
        names.add(item["function"] if isinstance(item, dict) else item)
    return names


def function_counts(item):
    if not isinstance(item, dict):
        return True
    if item.get("source") != KEYWORD_SOURCE:
        return True
    score = item.get("score")
    return score is not None and score >= KEYWORD_MIN_SCORE


def function_relevance(functions):
    items = list(functions or [])
    counted = {i["function"] if isinstance(i, dict) else i for i in items if function_counts(i)}
    if counted & set(CORE_FUNCTIONS):
        return 1.0, "core"
    if items:
        weak_core = {i["function"] if isinstance(i, dict) else i for i in items} & set(CORE_FUNCTIONS)
        return FUNDAMENTAL_ONLY_VALUE, "weak" if weak_core else "fundamental"
    return UNASSIGNED_VALUE, "unassigned"


def richness(row_count, outcome_rows):
    if not row_count:
        return 0.0
    size = min(1.0, math.log10(1 + row_count) / math.log10(1 + RICHNESS_ROWS_CAP))
    share = outcome_rows / row_count
    return RICHNESS_ROW_WEIGHT * size + (1.0 - RICHNESS_ROW_WEIGHT) * share


def components(inv, env, include_stream=False):
    ranges = inv.get("ranges", {})
    amb = None
    stream = None
    o2 = None
    if is_specified(env, "o2"):
        o2_lo, o2_hi = window_of(env, "o2")
        amb = coverage(o2_lo, o2_hi, ranges.get("o2_ambient"))
        stream = coverage(o2_lo, o2_hi, ranges.get("o2_oxidizer_stream"))
        o2 = max(amb, stream) if include_stream else amb
    pressure = None
    if is_specified(env, "pressure_atm"):
        p_lo, p_hi = window_of(env, "pressure_atm")
        pressure = coverage(p_lo, p_hi, ranges.get("pressure_atm"))
    flow = None
    if is_specified(env, "flow_cm_s"):
        f_lo, f_hi = window_of(env, "flow_cm_s")
        flow = coverage(f_lo, f_hi, ranges.get("flow_cm_s"))
    func_value, func_label = function_relevance(inv.get("functions"))
    return {
        "fuel": fuel_realism(inv.get("fuel_class")),
        "function": func_value,
        "function_label": func_label,
        "richness": richness(inv.get("row_count", 0), inv.get("outcome_rows", 0)),
        "o2": o2,
        "o2_ambient": amb,
        "o2_stream": stream,
        "pressure": pressure,
        "flow": flow,
    }


def weighted_average(comps, weights, names):
    total = 0.0
    used = 0.0
    for name in names:
        value = comps.get(name)
        weight = weights.get(name, 0.0)
        if value is None or weight <= 0:
            continue
        total += weight * value
        used += weight
    if used == 0:
        return 0.0
    return round(total / used, ROUND_DIGITS)


def weighted_score(comps, weights):
    return weighted_average(comps, weights, COMPONENTS)


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
            "topic": weighted_average(comps, weights, TOPIC_COMPONENTS),
            "condition": weighted_average(comps, weights, CONDITION_COMPONENTS),
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
