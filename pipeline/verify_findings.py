import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FINDINGS = os.path.join(ROOT, "data", "findings", "key_findings.json")
OUT = os.path.join(ROOT, "data", "findings", "verification.json")
PAGE_MARK = re.compile(r"\[\[PAGE (\d+)\]\]")
REQUIRED = ["finding_id", "psi_id", "finding_short", "finding_short_is_paraphrase", "quote",
            "source_type", "source_id", "source_url", "page", "source_text_file",
            "relevance_tag"]
SOURCE_TYPES = ("ntrs_abstract", "ntrs_pdf", "psi_record")
TAGS = ("prevention", "detection", "suppression", "fundamental")

TABLE = {
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u2033": '"',
    "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-",
    "\u2015": "-", "\u2212": "-", "\u00a0": " ", "\u2009": " ", "\u202f": " ",
}


def normalize(text):
    text = unicodedata.normalize("NFKC", text)
    for src, dst in TABLE.items():
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()


def segments(raw):
    found = list(PAGE_MARK.finditer(raw))
    result = {}
    head = raw[:found[0].start()] if found else raw
    result["abstract"] = head
    for index, match in enumerate(found):
        end = found[index + 1].start() if index + 1 < len(found) else len(raw)
        result[int(match.group(1))] = raw[match.end():end]
    return result


def check(finding):
    problems = []
    for field in REQUIRED:
        if field not in finding:
            problems.append("missing field " + field)
    if problems:
        return problems
    if finding["source_type"] not in SOURCE_TYPES:
        problems.append("bad source_type")
    if finding["relevance_tag"] not in TAGS:
        problems.append("bad relevance_tag")
    if len(finding["finding_short"].split()) > 20:
        problems.append("finding_short longer than 20 words")
    if not finding["quote"].strip():
        problems.append("empty quote")
    path = os.path.join(ROOT, finding["source_text_file"])
    if not os.path.isfile(path):
        problems.append("source_text_file not found")
        return problems
    with open(path, "r", encoding="utf-8") as handle:
        raw = handle.read()
    quote = normalize(finding["quote"])
    parts = segments(raw)
    if finding["source_type"] == "ntrs_pdf":
        page = finding["page"]
        if not isinstance(page, int) or page not in parts:
            problems.append("page %r not in source file" % (page,))
        elif quote not in normalize(parts[page]):
            problems.append("quote not found on page %s" % page)
    else:
        if quote not in normalize(parts["abstract"]):
            problems.append("quote not found in text")
    return problems


def main():
    with open(FINDINGS, "r", encoding="ascii") as handle:
        records = json.load(handle)
    results = []
    passed = failed = skipped = 0
    for record in records:
        if record.get("status") == "no verified result found":
            skipped += 1
            results.append({"psi_id": record.get("psi_id"), "finding_id": None,
                            "result": "no_finding", "problems": []})
            continue
        problems = check(record)
        ok = not problems
        passed += 1 if ok else 0
        failed += 0 if ok else 1
        results.append({"psi_id": record.get("psi_id"), "finding_id": record.get("finding_id"),
                        "source_text_file": record.get("source_text_file"),
                        "result": "pass" if ok else "fail", "problems": problems})
    payload = {"totals": {"findings": passed + failed, "passed": passed, "failed": failed,
                          "investigations_without_finding": skipped},
               "results": results}
    with open(OUT, "w", encoding="ascii", newline="\n") as handle:
        json.dump(payload, handle, indent=1, ensure_ascii=True)
        handle.write("\n")
    print("findings %d passed %d failed %d no_finding %d" % (passed + failed, passed, failed, skipped))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
