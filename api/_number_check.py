import re

PSIA_PER_ATM = 14.696
KPA_PER_ATM = 101.325
EPS = 1e-9
MAX_DECIMALS = 9

PSIA_FACTOR = {"psia": 1.0, "atm": PSIA_PER_ATM, "kpa": PSIA_PER_ATM / KPA_PER_ATM}
SCALED_UNITS = (None, "percent", "fraction")

UNIT_ALIASES = {
    "%": "percent",
    "percent": "percent",
    "psia": "psia",
    "psi": "psia",
    "atm": "atm",
    "kpa": "kpa",
    "cm/s": "cm/s",
    "ppm": "ppm",
    "g": "g",
}
UNIT_LABELS = {"percent": "%", "g": " g", "kpa": " kPa", "psia": " psia", "atm": " atm", "cm/s": " cm/s", "ppm": " ppm"}

DASH_CHARS = "".join(chr(code) for code in range(0x2010, 0x2016)) + chr(0xFFFD)
NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9_])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?:\s*(%|percent\b|psia\b|psi\b|atm\b|kpa\b|cm/s|ppm\b|g\b(?!/)))?"
    r"(?![A-Za-z0-9])",
    re.IGNORECASE,
)
MARKER_RE = re.compile(r"\[\d+\]")
IDENTIFIER_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]*-\d+\b")
FRACTION_RE = re.compile(r"\b\d+/\d+\b")
LONG_DIGITS_RE = re.compile(r"\b\d{7,}\b")
LIST_NUMBER_RE = re.compile(r"(?m)^[ \t]*(?:[-*][ \t]+)?\d+[.)][ \t]+")
CONNECTOR_RE = re.compile(r"^\s*(?:-|to\b|[" + DASH_CHARS + r"]+)\s*$", re.IGNORECASE)
MIN_YEAR = 1950
MAX_YEAR = 2100
GRAVITY_BOUNDS = (0.0, 1.0)
HABITAT_WORDS = {"iss": ("iss",), "gateway": ("gateway",), "lunar": ("moon", "lunar"), "rover": ("rover",), "mars": ("mars",)}
HABITAT_FIELDS = ("o2", "pressure_atm", "flow_cm_s", "gravity")
HABITAT_NUMBER_KEYS = ("min", "max", "window_min", "window_max", "g")


def decimals_of(text):
    text = text.replace(",", "")
    return len(text.split(".")[1]) if "." in text else 0


def clean_text(text):
    text = MARKER_RE.sub(" ", text)
    text = LIST_NUMBER_RE.sub("", text)
    text = IDENTIFIER_RE.sub(" ", text)
    text = FRACTION_RE.sub(" ", text)
    text = LONG_DIGITS_RE.sub(" ", text)
    return text.replace("*", "")


def scan_numbers(text):
    found = []
    for match in NUMBER_RE.finditer(text):
        raw = match.group(1)
        unit = UNIT_ALIASES[match.group(2).lower()] if match.group(2) else None
        found.append({
            "text": raw,
            "value": float(raw.replace(",", "")),
            "decimals": decimals_of(raw),
            "unit": unit,
            "start": match.start(),
            "end": match.end(),
            "has_comma": "," in raw,
        })
    for current, following in zip(found, found[1:]):
        if current["unit"] is None and following["unit"] is not None:
            if CONNECTOR_RE.match(text[current["end"]:following["start"]]):
                current["unit"] = following["unit"]
    return found


def is_year(item):
    return item["unit"] is None and item["decimals"] == 0 and not item["has_comma"] and MIN_YEAR <= item["value"] <= MAX_YEAR


def is_gravity_bound(item):
    return item["unit"] == "g" and item["decimals"] == 0 and item["value"] in GRAVITY_BOUNDS


CONFIDENCE_RE = re.compile(r"\s*(?:percent\s+)?(?:confidence|CI\b|interval|credible)", re.I)
CONFIDENCE_LEVELS = (90.0, 95.0, 99.0)


def is_confidence_level(item, text):
    return item["unit"] == "percent" and item["value"] in CONFIDENCE_LEVELS and bool(CONFIDENCE_RE.match(text[item["end"]:item["end"] + 24]))


def claim_label(item):
    return item["text"] + UNIT_LABELS.get(item["unit"], "")


def extract_claims(answer):
    claims = []
    seen = set()
    text = clean_text(answer or "")
    for item in scan_numbers(text):
        if is_year(item) or is_gravity_bound(item) or is_confidence_level(item, text):
            continue
        label = claim_label(item)
        if label in seen:
            continue
        seen.add(label)
        item["label"] = label
        claims.append(item)
    return claims


def unit_from_key(key):
    key = (key or "").lower()
    for token, unit in (("psia", "psia"), ("kpa", "kpa"), ("atm", "atm"), ("cm_s", "cm/s"), ("pct", "percent"), ("percent", "percent"), ("frac", "fraction")):
        if token in key:
            return unit
    return None


def float_decimals(value):
    text = repr(float(value))
    if "e" in text:
        return MAX_DECIMALS
    return min(decimals_of(text), MAX_DECIMALS) if not text.endswith(".0") else 0


def reference_items_from_text(text):
    return [{"value": i["value"], "decimals": i["decimals"], "unit": i["unit"]} for i in scan_numbers(clean_text(text or ""))]


def reference_items_from_data(data, key=None):
    items = []
    if isinstance(data, dict):
        for name, value in data.items():
            items.extend(reference_items_from_data(value, name))
    elif isinstance(data, (list, tuple)):
        for value in data:
            items.extend(reference_items_from_data(value, key))
    elif isinstance(data, bool) or data is None:
        return items
    elif isinstance(data, (int, float)):
        decimals = 0 if isinstance(data, int) else float_decimals(data)
        items.append({"value": float(data), "decimals": decimals, "unit": unit_from_key(key)})
    elif isinstance(data, str):
        items.extend(reference_items_from_text(data))
    return items


def expand_reference(item):
    value, decimals, unit = item["value"], item["decimals"], item["unit"]
    if unit in PSIA_FACTOR:
        return [{"psia": value * PSIA_FACTOR[unit]}]
    variants = [(value, decimals)]
    if unit in SCALED_UNITS:
        if 0 <= value <= 1:
            variants.append((value * 100, max(decimals - 2, 0)))
        variants.append((value / 100, decimals + 2))
    return [{"value": v, "decimals": d} for v, d in variants]


def close(claim, ref_value, ref_decimals):
    diff = abs(claim["value"] - ref_value)
    if diff <= EPS:
        return True
    counts_exactly = claim["unit"] is None and claim["decimals"] == 0
    if counts_exactly or ref_decimals <= claim["decimals"]:
        return False
    return diff <= 0.5 * 10 ** (-claim["decimals"]) + EPS


def claim_matches(claim, references):
    if claim["unit"] in PSIA_FACTOR:
        factor = PSIA_FACTOR[claim["unit"]]
        target = claim["value"] * factor
        half = 0.5 * 10 ** (-claim["decimals"]) * factor + EPS
        return any("psia" in ref and abs(ref["psia"] - target) <= half for ref in references)
    return any("value" in ref and close(claim, ref["value"], ref["decimals"]) for ref in references)


def collect_reference_items(tool_results=(), texts=(), items=()):
    collected = list(items)
    for result in tool_results:
        collected.extend(reference_items_from_data(result))
    for text in texts:
        collected.extend(reference_items_from_text(text))
    return collected


def check_answer(answer, tool_results=(), texts=(), items=()):
    claims = extract_claims(answer)
    references = []
    for item in collect_reference_items(tool_results, texts, items):
        references.extend(expand_reference(item))
    unmatched = [claim["label"] for claim in claims if not claim_matches(claim, references)]
    return {"total": len(claims), "matched": len(claims) - len(unmatched), "unmatched": unmatched}


def citation_texts(citations):
    return [c.get("cited_text", "") for c in citations or [] if isinstance(c, dict)]


def step_texts(steps):
    return ["%s. %s" % (s.get("label", ""), s.get("detail", "")) for s in steps or [] if isinstance(s, dict)]


def mentioned_habitats(text, data_tools):
    lowered = (text or "").lower()
    return [h for h in data_tools.HABITATS if any(re.search(r"\b%s" % word, lowered) for word in HABITAT_WORDS[h])]


def habitat_results(data_tools, habitats):
    results = []
    for habitat in habitats:
        results.append(data_tools.rank_investigations(habitat, 5))
        results.append(data_tools.test_next(habitat))
        results.append(data_tools.model_readiness(habitat))
        results.append(data_tools.habitat_profile(habitat))
    return results


def habitat_reference(data_tools):
    items = []
    for env in data_tools.load_json("environments.json")["environments"]:
        for name in HABITAT_FIELDS:
            spec = env.get(name) or {}
            items.extend(reference_items_from_text(spec.get("display", "")))
            for field in HABITAT_NUMBER_KEYS:
                if isinstance(spec.get(field), (int, float)):
                    items.extend(reference_items_from_data(spec[field], name))
    return items


OUTSIDE_KEYS = ("o2_frac", "o2_percent", "pressure_atm", "pressure_kpa", "pressure_psia", "flow_cm_s")


def outside_reference(data_tools):
    items = []
    try:
        tests = data_tools.load_json("outside_psi.json").get("tests", [])
    except (OSError, ValueError):
        return items
    for test in tests:
        for key in OUTSIDE_KEYS:
            if isinstance(test.get(key), (int, float)) and not isinstance(test.get(key), bool):
                items.extend(reference_items_from_data(test[key], key))
    return items


PARTIAL_UNITS = {"percent O2": "percent", "psia": "psia", "psi": "psia", "atm": "atm", "kPa": "kpa", "g": "g", "cm/s": "cm/s"}


def partial_g_reference(data_tools):
    items = []
    try:
        partial = data_tools.load_json("partial_g.json")
    except (OSError, ValueError):
        return items
    for point in partial.get("points", []):
        for field in point.get("fields", []):
            value = field.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            unit = PARTIAL_UNITS.get(field.get("unit"))
            items.append({"value": float(value), "decimals": decimals_of(field.get("raw", "")), "unit": unit})
    summary = partial.get("summary", {})
    for drop in summary.get("ulois_drops_1g_to_lunar", []):
        items.append({"value": float(drop["points"]), "decimals": decimals_of(str(drop["points"])), "unit": None})
    for key in ("moon_o2_percent",):
        if isinstance(summary.get(key), (int, float)):
            items.append({"value": float(summary[key]), "decimals": 0, "unit": "percent"})
    return items


def reference_extras(data_tools):
    return habitat_reference(data_tools) + outside_reference(data_tools) + partial_g_reference(data_tools)


def check_live(answer, citations, log, data_tools):
    return check_answer(
        answer,
        tool_results=[result for _, _, result in log],
        texts=citation_texts(citations),
        items=reference_extras(data_tools),
    )


def check_cached(question, answer, citations, steps, data_tools):
    habitats = mentioned_habitats("%s %s" % (question, answer), data_tools)
    return check_answer(
        answer,
        tool_results=habitat_results(data_tools, habitats),
        texts=citation_texts(citations) + step_texts(steps),
        items=reference_extras(data_tools),
    )
