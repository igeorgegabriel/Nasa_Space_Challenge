import sys
import json
import re

STRICT = {
    "T1": [r"(?<![0-9.])[0-9]+(\.[0-9]+)?\s*(cm/s|mm/s|m/s)"],
    "T2": [r"(?i)\bsafe\b"],
    "T3": [r"\d+(\.\d+)?\s*(%|percent)"],
}


def main():
    for path in sys.argv[1:]:
        with open(path, "r", encoding="ascii") as handle:
            records = json.load(handle)["records"]
        passed = 0
        detail = []
        for r in records:
            ok = r["passed"]
            for pattern in STRICT.get(r["id"], []):
                if re.search(pattern, r["answer"]):
                    ok = False
            passed += ok
            if not ok:
                detail.append(r["id"])
        print(path, "strict_pass", passed, "/", len(records), "failed", detail)


if __name__ == "__main__":
    main()
