import os
os.environ["ANTHROPIC_BASE_URL"] = "https://api.anthropic.com"
import sys
import json
import re
import time
import datetime

import anthropic

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from api import ask

EVAL_SET = os.path.join(ROOT, "eval", "ask_eval_set.json")
RESULTS_DIR = os.path.join(ROOT, "eval", "results")
CHECKER_FIXES = []
RUN_AT = datetime.datetime.now().isoformat(timespec="seconds")


class Recorder:
    def __init__(self, client):
        self.client = client
        self.beta = self
        self.messages = self
        self.last = None

    def create(self, **kwargs):
        start = time.time()
        response = self.client.beta.messages.create(**kwargs)
        usage = getattr(response, "usage", None)
        self.last = {
            "latency_s": round(time.time() - start, 2),
            "usage": usage.model_dump() if usage is not None and hasattr(usage, "model_dump") else None,
            "stop_reason": getattr(response, "stop_reason", None),
        }
        return response


def run_checks(item, answer, citations):
    checks = {}
    answer_l = answer.lower()
    cited = {c.get("psi_id") for c in citations}
    if item["type"] == "answerable":
        checks["not_refused"] = not answer_l.startswith("not in the data")
    if item.get("must_cite_psi"):
        checks["cites_expected_psi"] = bool(cited & set(item["must_cite_psi"]))
    if item.get("must_contain_any"):
        checks["contains_any"] = any(s.lower() in answer_l for s in item["must_contain_any"])
    for pattern in item.get("must_contain_all_regex", []):
        checks["regex_" + pattern] = re.search(pattern, answer) is not None
    scope = item.get("forbidden_scope")
    scoped = answer
    if scope:
        scoped = " ".join(s for s in split_sentences(answer) if re.search(scope, s))
    for pattern in item.get("forbidden_patterns", []):
        checks["forbidden_absent_" + pattern] = re.search(pattern, scoped) is None
    for pattern in item.get("forbidden_unnegated", []):
        unneg = " ".join(s for s in split_sentences(answer) if not NEGATION.search(s))
        checks["forbidden_unnegated_" + pattern] = re.search(pattern, unneg) is None
    return checks


NEGATION = re.compile(r"(?i)\b(whether|cannot|not|no|never|unable)\b|n't")


def split_sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def finish(records):
    os.makedirs(RESULTS_DIR, exist_ok=True)
    stamp = datetime.date.today().isoformat()
    models = sorted({r["model"] for r in records if r["model"]})
    summary = {
        "run_at": RUN_AT,
        "model": models,
        "total": len(records),
        "passed": sum(r["passed"] for r in records),
        "answerable_passed": sum(r["passed"] for r in records if r["type"] == "answerable"),
        "traps_refused": sum(r["passed"] for r in records if r["type"] == "trap"),
        "failures": [{"id": r["id"], "failed_checks": [k for k, v in r["checks"].items() if not v], "status": r["status"]} for r in records if not r["passed"]],
        "checker_fixes": CHECKER_FIXES,
    }
    with open(os.path.join(RESULTS_DIR, "ask_eval_%s.json" % stamp), "w", encoding="ascii") as handle:
        json.dump({"summary": summary, "records": records}, handle, indent=2)
    with open(os.path.join(RESULTS_DIR, "ask_eval_summary.json"), "w", encoding="ascii") as handle:
        json.dump(summary, handle, indent=2)
    print(json.dumps(summary, indent=2))


def rescore():
    with open(EVAL_SET, "r", encoding="ascii") as handle:
        items = {q["id"]: q for q in json.load(handle)["questions"]}
    stamp = datetime.date.today().isoformat()
    path = os.path.join(RESULTS_DIR, "ask_eval_%s.json" % stamp)
    with open(path, "r", encoding="ascii") as handle:
        stored = json.load(handle)
    global RUN_AT
    RUN_AT = stored["summary"]["run_at"]
    records = stored["records"]
    for record in records:
        item = items[record["id"]]
        if "initial_checks" not in record:
            record["initial_checks"] = record["checks"]
            record["initial_passed"] = record["passed"]
        citations = record["citations"]
        record["checks"] = run_checks(item, record["answer"], citations)
        record["passed"] = record["status"] == 200 and all(record["checks"].values())
        if item.get("checker_fix"):
            CHECKER_FIXES.append({"id": record["id"], "fix": item["checker_fix"], "initial_passed": record["initial_passed"], "passed_after": record["passed"]})
    finish(records)


def main():
    if "--rescore" in sys.argv:
        rescore()
        return
    with open(EVAL_SET, "r", encoding="ascii") as handle:
        items = json.load(handle)["questions"]
    recorder = Recorder(ask.make_client())
    records = []
    for index, item in enumerate(items):
        if index:
            time.sleep(2)
        status, body = ask.answer_question(item["question"], client=recorder)
        answer = body.get("answer", "") if status == 200 else ""
        citations = body.get("citations", []) if status == 200 else []
        checks = run_checks(item, answer, citations)
        passed = status == 200 and all(checks.values())
        meta = recorder.last or {}
        recorder.last = None
        records.append({
            "id": item["id"],
            "type": item["type"],
            "question": item["question"],
            "status": status,
            "error": body.get("error") if status != 200 else None,
            "answer": answer,
            "citations": [{"psi_id": c.get("psi_id"), "cited_text": c.get("cited_text", "")[:300]} for c in citations],
            "model": body.get("model"),
            "latency_s": meta.get("latency_s"),
            "usage": meta.get("usage"),
            "checks": checks,
            "passed": passed,
        })
        print(item["id"], "PASS" if passed else "FAIL", flush=True)
    finish(records)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("runner error:", type(exc).__name__, str(exc)[:200])
    sys.exit(0)
