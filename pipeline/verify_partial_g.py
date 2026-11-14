import hashlib
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "data", "partial_g", "partial_g.json")
OUT = os.path.join(ROOT, "data", "partial_g", "verification.json")
PAGE_MARK = re.compile(r"^=====PAGE (\d+)$", re.M)
TABLE = {
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-", "\u00a0": " ",
}
NUMBER = re.compile(r"(?<![\w.])-?(?:\d+\.\d+|\.\d+|\d+)(?![\w])")
MARGIN_TOLERANCE = 0.06


def normalize(text):
    text = unicodedata.normalize("NFKC", text)
    for src, dst in TABLE.items():
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()


def split_pages(raw):
    marks = list(PAGE_MARK.finditer(raw))
    pages = {}
    for i, mark in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(raw)
        pages[int(mark.group(1))] = normalize(raw[mark.end():end])
    return pages


def load_pages(source):
    path = os.path.join(ROOT, source["text_file"])
    if not os.path.isfile(path):
        return None, ["text snapshot not found: " + source["text_file"]]
    with open(path, "r", encoding="ascii") as handle:
        raw = handle.read()
    problems = []
    if source["ntrs_id"] not in raw[:400]:
        problems.append("snapshot header does not record the NTRS id")
    return split_pages(raw), problems


def check_source(source):
    problems = []
    for name in ("id", "ntrs_id", "title", "authors", "year", "url", "pdf_url", "pdf_file", "pdf_sha256", "text_file"):
        if not source.get(name):
            problems.append("missing field " + name)
    if problems:
        return problems
    if not source["url"].startswith("https://ntrs.nasa.gov/"):
        problems.append("url is not an NTRS address")
    if not source["pdf_url"].startswith("https://ntrs.nasa.gov/"):
        problems.append("pdf_url is not an NTRS address")
    if source["ntrs_id"] not in source["url"]:
        problems.append("url does not contain the NTRS id")
    path = os.path.join(ROOT, source["pdf_file"])
    if os.path.isfile(path):
        with open(path, "rb") as handle:
            if hashlib.sha256(handle.read()).hexdigest() != source["pdf_sha256"]:
                problems.append("pdf sha256 mismatch")
    return problems


def check_quote(name, quote, pages):
    if not isinstance(quote, dict) or not quote.get("text") or quote.get("page") is None:
        return ["quote %s malformed" % name]
    body = pages.get(quote["page"])
    if body is None:
        return ["quote %s: page %s not in snapshot" % (name, quote["page"])]
    if normalize(quote["text"]) not in body:
        return ["quote %s not found on page %s" % (name, quote["page"])]
    return []


def check_field(field, quotes):
    problems = []
    label = field.get("name", "?")
    for name in ("name", "raw", "quote"):
        if not field.get(name):
            return ["field %s missing %s" % (label, name)]
    quote = quotes.get(field["quote"])
    if quote is None:
        return ["field %s references unknown quote %s" % (label, field["quote"])]
    text = normalize(quote["text"])
    raw = field["raw"]
    if "token_index" in field:
        tokens = NUMBER.findall(text)
        index = field["token_index"]
        if index >= len(tokens) or tokens[index] != raw:
            problems.append("field %s: token %s of quote is not %s" % (label, index, raw))
        return problems
    if "as_stated" in field:
        if normalize(field["as_stated"]) not in text:
            problems.append("field %s: as_stated not inside quote" % label)
        if raw not in field["as_stated"]:
            problems.append("field %s: raw not inside as_stated" % label)
        return problems
    pattern = r"(?<![\w.])" + re.escape(raw) + r"(?![\w])"
    if not re.search(pattern, text):
        problems.append("field %s: raw %s not a whole token inside its quote" % (label, raw))
    return problems


def field_values(point, names):
    values = {f["name"]: float(f["raw"]) for f in point["fields"] if f["name"] in names}
    return values if len(values) == len(names) else None


def check_olson_margins(points):
    problems = []
    by_material = {}
    for point in points:
        if point["source_id"] != "olson2013":
            continue
        parts = point["id"].split("_", 2)
        by_material.setdefault(parts[2], {})[parts[1]] = point
    pair = ("ulois_percent_o2", "moc_percent_o2")
    for material, groups in by_material.items():
        base = field_values(groups["1g"], pair) if "1g" in groups else None
        if base is None:
            problems.append("%s: no 1g baseline" % material)
            continue
        base_mean = (base[pair[0]] + base[pair[1]]) / 2.0
        for gravity in ("martian", "lunar", "0g"):
            values = field_values(groups[gravity], pair + ("o2_margin_vs_1g",)) if gravity in groups else None
            if values is None:
                problems.append("%s %s: margin fields missing" % (material, gravity))
                continue
            expected = (values[pair[0]] + values[pair[1]]) / 2.0 - base_mean
            if abs(expected - values["o2_margin_vs_1g"]) > MARGIN_TOLERANCE:
                problems.append("%s %s: stated margin %s but table values give %.3f" % (material, gravity, values["o2_margin_vs_1g"], expected))
    return problems


def verify(data):
    errors = []
    counts = {"sources": 0, "points": 0, "quotes": 0, "fields": 0}
    cache = {}
    sources = {s.get("id"): s for s in data["sources"]}
    for source in data["sources"]:
        counts["sources"] += 1
        for problem in check_source(source):
            errors.append("source %s: %s" % (source.get("id", "?"), problem))
        if source.get("text_file") and source.get("ntrs_id"):
            pages, problems = load_pages(source)
        else:
            pages, problems = None, ["no text file"]
        cache[source.get("id")] = pages
        for problem in problems:
            errors.append("source %s: %s" % (source.get("id", "?"), problem))
    for sid, group in data.get("definitions", {}).items():
        for name, quote in group.items():
            counts["quotes"] += 1
            pages = cache.get(sid)
            if pages is None:
                errors.append("definition %s.%s: source text unavailable" % (sid, name))
                continue
            for problem in check_quote(name, quote, pages):
                errors.append("definition %s.%s: %s" % (sid, name, problem))
    seen = set()
    for point in data["points"]:
        counts["points"] += 1
        pid = point.get("id", "?")
        if pid in seen:
            errors.append("%s: duplicate id" % pid)
        seen.add(pid)
        for name in ("source_id", "kind", "material", "gravity_label", "outcome", "quotes"):
            if not point.get(name):
                errors.append("%s: missing %s" % (pid, name))
        if "fields" not in point:
            errors.append("%s: missing fields" % pid)
        if point.get("source_id") not in sources:
            errors.append("%s: unknown source" % pid)
            continue
        pages = cache.get(point["source_id"])
        if pages is None:
            errors.append("%s: source text unavailable" % pid)
            continue
        for name, quote in point.get("quotes", {}).items():
            counts["quotes"] += 1
            for problem in check_quote(name, quote, pages):
                errors.append("%s: %s" % (pid, problem))
        for field in point.get("fields", []):
            counts["fields"] += 1
            for problem in check_field(field, point.get("quotes", {})):
                errors.append("%s: %s" % (pid, problem))
    for problem in check_olson_margins(data["points"]):
        errors.append("olson2013 margins: " + problem)
    return errors, counts


def main():
    with open(SOURCE, "r", encoding="ascii") as handle:
        data = json.load(handle)
    errors, counts = verify(data)
    for line in errors:
        print("FAIL " + line)
    result = {"checked": counts, "failed": len(errors), "errors": errors, "sources": ["data/partial_g/partial_g.json"]}
    with open(OUT, "w", encoding="ascii", newline="\n") as handle:
        handle.write(json.dumps(result, indent=1, sort_keys=True, ensure_ascii=True) + "\n")
    print("%d sources, %d points, %d quotes, %d numeric fields checked, %d failures" % (counts["sources"], counts["points"], counts["quotes"], counts["fields"], len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
