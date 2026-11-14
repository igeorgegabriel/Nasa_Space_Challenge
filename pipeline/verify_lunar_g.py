import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "data", "lunar_g", "compensation.json")
OUT = os.path.join(ROOT, "data", "lunar_g", "verification.json")
PAGE_MARK = re.compile(r"^=====PAGE (\d+)$", re.M)
TABLE = {
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", " ": " ",
}


def normalize(text):
    text = unicodedata.normalize("NFKC", text)
    for src, dst in TABLE.items():
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()


def page_text(raw, page):
    marks = list(PAGE_MARK.finditer(raw))
    for i, mark in enumerate(marks):
        if int(mark.group(1)) == page:
            end = marks[i + 1].start() if i + 1 < len(marks) else len(raw)
            return raw[mark.end():end]
    return None


def check(entry):
    problems = []
    for name in ("id", "quote", "source_title", "source_url", "source_text_file"):
        if not entry.get(name):
            problems.append("missing field " + name)
    if problems:
        return problems
    if not entry["source_url"].startswith("https://ntrs.nasa.gov/"):
        problems.append("source_url is not an NTRS address")
    path = os.path.join(ROOT, entry["source_text_file"])
    if not os.path.isfile(path):
        return problems + ["source_text_file not found"]
    with open(path, "r", encoding="utf-8") as handle:
        raw = handle.read()
    stem = entry["source_url"].split("/downloads/")[0].split("/citations/")[-1]
    if stem not in raw and stem not in os.path.basename(path):
        problems.append("snapshot does not record the source id")
    scope = raw
    if entry.get("page") is not None:
        scope = page_text(raw, entry["page"])
        if scope is None:
            return problems + ["page %s not in snapshot" % entry["page"]]
    if normalize(entry["quote"]) not in normalize(scope):
        problems.append("quote not found in snapshot")
    return problems


def verify(data):
    errors = []
    for entry in data["quotes"]:
        for problem in check(entry):
            errors.append("%s: %s" % (entry.get("id", "?"), problem))
    return errors


def main():
    with open(SOURCE, "r", encoding="ascii") as handle:
        data = json.load(handle)
    errors = verify(data)
    for line in errors:
        print("FAIL " + line)
    result = {"checked": len(data["quotes"]), "failed": len(errors), "errors": errors,
              "sources": ["data/lunar_g/compensation.json"]}
    with open(OUT, "w", encoding="ascii", newline="\n") as handle:
        handle.write(json.dumps(result, indent=1, sort_keys=True, ensure_ascii=True) + "\n")
    print("%d quotes checked, %d failures" % (len(data["quotes"]), len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
