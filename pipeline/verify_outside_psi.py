import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "outside_psi"

REPL = {
    0x2018: "'",
    0x2019: "'",
    0x201C: '"',
    0x201D: '"',
    0x2013: "-",
    0x2014: "-",
    0x2212: "-",
    0x00AD: "",
    0x00BC: "1/4",
    0x00BD: "1/2",
    0x00BE: "3/4",
}


def norm(text):
    text = unicodedata.normalize("NFKC", text)
    for key, val in REPL.items():
        text = text.replace(chr(key), val)
    return re.sub(r"\s+", " ", text).strip()


def load_pages(path, cache):
    if path in cache:
        return cache[path]
    full = ROOT / path
    if not full.is_file():
        cache[path] = None
        return None
    raw = full.read_text(encoding="utf-8", errors="replace")
    parts = re.split(r"\[\[PAGE (\d+)( LAYOUT)?\]\]", raw)
    pages = {}
    for i in range(1, len(parts), 3):
        pages.setdefault(int(parts[i]), []).append(norm(parts[i + 2]))
    cache[path] = (norm(raw), pages)
    return cache[path]


def check(entry, label, cache, errors):
    path = entry.get("source_text_file")
    quote = entry.get("quote")
    if not path or not quote:
        errors.append("%s: missing source_text_file or quote" % label)
        return
    loaded = load_pages(path, cache)
    if loaded is None:
        errors.append("%s: source file not found %s" % (label, path))
        return
    full_text, pages = loaded
    target = norm(quote)
    page = entry.get("page")
    if pages and page is not None and page in pages:
        if not any(target in chunk for chunk in pages[page]):
            errors.append("%s: quote not on page %s of %s" % (label, page, path))
            return
    elif target not in full_text:
        errors.append("%s: quote not found in %s" % (label, path))
        return


def main():
    cache = {}
    errors = []
    count = 0

    tests = json.loads((DATA / "saffire_iv_vi.json").read_text(encoding="utf-8"))["tests"]
    for t in tests:
        label = "saffire %s" % t["sample_id"]
        check(t, label, cache, errors)
        count += 1
        for i, s in enumerate(t.get("supporting") or []):
            check(s, "%s support %d" % (label, i), cache, errors)
            count += 1

    recs = json.loads((DATA / "solid_pressure_sources.json").read_text(encoding="utf-8"))["records"]
    for psi, r in recs.items():
        if r.get("primary") is None:
            if r.get("pressure_atm") is not None or r.get("pressure_atm_range") is not None:
                errors.append("%s: pressure given without a quote" % psi)
            continue
        check(r["primary"], "%s primary" % psi, cache, errors)
        count += 1
        for i, s in enumerate(r.get("supporting") or []):
            check(s, "%s support %d" % (psi, i), cache, errors)
            count += 1

    for e in errors:
        print("FAIL " + e)
    print("%d quotes checked, %d failures" % (count, len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
