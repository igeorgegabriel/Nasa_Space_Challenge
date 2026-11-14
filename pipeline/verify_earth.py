import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUOTES = os.path.join(ROOT, "data", "earth", "earth_quotes.json")
OUT = os.path.join(ROOT, "data", "earth", "verification.json")
TABLE = {
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-", "\u00a0": " ",
}


def normalize(text):
    text = unicodedata.normalize("NFKC", text)
    for src, dst in TABLE.items():
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()


def check(entry):
    problems = []
    for name in ("id", "quote", "source_title", "source_url", "source_text_file"):
        if not entry.get(name):
            problems.append("missing field " + name)
    if problems:
        return problems
    if not entry["source_url"].startswith("https://spinoff.nasa.gov/"):
        problems.append("source_url is not a NASA Spinoff page")
    path = os.path.join(ROOT, entry["source_text_file"])
    if not os.path.isfile(path):
        return problems + ["source_text_file not found"]
    with open(path, "r", encoding="utf-8") as handle:
        raw = handle.read()
    if entry["source_url"] not in raw:
        problems.append("snapshot does not record the source url")
    if normalize(entry["quote"]) not in normalize(raw):
        problems.append("quote not found in snapshot")
    return problems


def main():
    with open(QUOTES, "r", encoding="ascii") as handle:
        entries = json.load(handle)["quotes"]
    errors = []
    for entry in entries:
        for problem in check(entry):
            errors.append("%s: %s" % (entry.get("id", "?"), problem))
    for line in errors:
        print("FAIL " + line)
    result = {"checked": len(entries), "failed": len(errors), "errors": errors,
              "sources": ["data/earth/earth_quotes.json"]}
    with open(OUT, "w", encoding="ascii", newline="\n") as handle:
        handle.write(json.dumps(result, indent=1, sort_keys=True, ensure_ascii=True) + "\n")
    print("%d quotes checked, %d failures" % (len(entries), len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
