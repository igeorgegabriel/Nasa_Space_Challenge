import os
os.environ["ANTHROPIC_BASE_URL"] = "https://api.anthropic.com"
import sys
import json
import time
import datetime
import statistics
import threading
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "eval"))
from api import ask
import run_ask_eval as v1

EVAL_SET = os.path.join(ROOT, "eval", "ask_eval_set_v2.json")
RESULTS_DIR = os.path.join(ROOT, "eval", "results")
SUMMARY_PATH = os.path.join(RESULTS_DIR, "ask_eval_v2_summary.json")
PRICES = {
    "claude-sonnet-5-5": (2.0, 10.0, 0.10, 1.25),
    "claude-opus-5-5": (4.0, 20.0, 0.20, 1.25),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 1.25),
}
BUDGET_USD = 15.0
CONCURRENCY = 3
MAX_ATTEMPTS = 4
RETRY_STATUSES = (429, 502, 503)
BACKOFF_SECONDS = (5, 15, 40)

LOCK = threading.Lock()
SPEND = {"usd": 0.0, "stopped": False}


def usage_cost(model, usage):
    key = next((k for k in PRICES if model and model.startswith(k)), "claude-sonnet-5-5")
    pin, pout, pread, wmult = PRICES[key]
    fresh = usage.get("input_tokens", 0) or 0
    read = usage.get("cache_read_input_tokens", 0) or 0
    write = usage.get("cache_creation_input_tokens", 0) or 0
    out = usage.get("output_tokens", 0) or 0
    return (fresh * pin + read * pread + write * pin * wmult + out * pout) / 1e6


class Recorder:
    def __init__(self, client):
        self.client = client
        self.beta = self
        self.messages = self
        self.calls = 0
        self.latency_s = 0.0
        self.usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
        self.cost_usd = 0.0

    def create(self, **kwargs):
        start = time.time()
        response = self.client.beta.messages.create(**kwargs)
        self.latency_s += time.time() - start
        self.calls += 1
        raw = getattr(response, "usage", None)
        usage = raw.model_dump() if raw is not None and hasattr(raw, "model_dump") else {}
        for key in self.usage:
            self.usage[key] += usage.get(key, 0) or 0
        spent = usage_cost(kwargs.get("model"), usage)
        self.cost_usd += spent
        with LOCK:
            SPEND["usd"] += spent
        return response


def run_item(client, item):
    with LOCK:
        if SPEND["stopped"]:
            return None
    recorder = Recorder(client)
    wall = time.time()
    status, body = 0, {}
    attempts = 0
    for attempt in range(MAX_ATTEMPTS):
        attempts = attempt + 1
        status, body = ask.answer_question(item["question"], client=recorder, use_cache=False)
        if status not in RETRY_STATUSES:
            break
        time.sleep(BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)])
    ok = status == 200
    answer = body.get("answer", "") if ok else ""
    citations = body.get("citations", []) if ok else []
    checks = v1.run_checks(item, answer, citations)
    steps = body.get("steps", []) if ok else []
    tools_used = sorted({s.get("tool") for s in steps if s.get("tool")})
    expected_tool = item.get("expected_tool")
    return {
        "id": item["id"],
        "type": item["type"],
        "question": item["question"],
        "status": status,
        "attempts": attempts,
        "error": body.get("error") if not ok else None,
        "answer": answer,
        "citations": [{"psi_id": c.get("psi_id"), "cited_text": c.get("cited_text", "")[:300]} for c in citations],
        "citation_count": len(citations),
        "number_check": body.get("number_check") if ok else None,
        "tools_used": tools_used,
        "expected_tool": expected_tool,
        "used_expected_tool": (expected_tool in tools_used) if expected_tool else None,
        "model": body.get("model"),
        "api_calls": recorder.calls,
        "latency_s": round(time.time() - wall, 2),
        "api_latency_s": round(recorder.latency_s, 2),
        "usage": recorder.usage,
        "cost_usd": round(recorder.cost_usd, 4),
        "checks": checks,
        "passed": ok and all(checks.values()),
    }


def percentile(values, q):
    ordered = sorted(values)
    if not ordered:
        return None
    index = min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))
    return ordered[index]


def rate(passed, total):
    return round(passed / total, 4) if total else None


def summarize(records, run_at, budget_stopped):
    by_type = {}
    for kind in ("answerable", "trap", "multistep"):
        group = [r for r in records if r["type"] == kind]
        by_type[kind] = {"total": len(group), "passed": sum(r["passed"] for r in group), "rate": rate(sum(r["passed"] for r in group), len(group))}
    checks_ok = [r for r in records if r["number_check"]]
    matched = sum(r["number_check"]["matched"] for r in checks_ok)
    claimed = sum(r["number_check"]["total"] for r in checks_ok)
    with_numbers = [r for r in checks_ok if r["number_check"]["total"] > 0]
    all_matched = sum(1 for r in with_numbers if r["number_check"]["matched"] == r["number_check"]["total"])
    answerable = [r for r in records if r["type"] == "answerable"]
    cited = sum(1 for r in answerable if r["citation_count"] > 0)
    expected_cite = [r for r in answerable if "cites_expected_psi" in r["checks"]]
    expected_cite_ok = sum(1 for r in expected_cite if r["checks"]["cites_expected_psi"])
    traps = [r for r in records if r["type"] == "trap"]
    refused = sum(1 for r in traps if r["checks"].get("contains_any"))
    clean = sum(1 for r in traps if r["passed"])
    tool_items = [r for r in records if r["expected_tool"]]
    latencies = [r["latency_s"] for r in records if r["status"] == 200]
    usage_total = {key: sum(r["usage"][key] for r in records) for key in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}
    failures = [{"id": r["id"], "type": r["type"], "failed_checks": [k for k, v in r["checks"].items() if not v], "status": r["status"]} for r in records if not r["passed"]]
    return {
        "version": 2,
        "run_at": run_at,
        "model": sorted({r["model"] for r in records if r["model"]}),
        "effort": ask.EFFORT,
        "total": len(records),
        "passed": sum(r["passed"] for r in records),
        "pass_rate": rate(sum(r["passed"] for r in records), len(records)),
        "by_type": by_type,
        "trap_refusal_rate": rate(refused, len(traps)),
        "trap_refused": refused,
        "trap_total": len(traps),
        "trap_clean": clean,
        "numeric_fidelity": rate(matched, claimed),
        "numbers_matched": matched,
        "numbers_claimed": claimed,
        "answers_with_numbers": len(with_numbers),
        "answers_all_numbers_matched": all_matched,
        "all_numbers_matched_rate": rate(all_matched, len(with_numbers)),
        "answerable_cited": cited,
        "answerable_total": len(answerable),
        "citation_rate": rate(cited, len(answerable)),
        "expected_psi_cited": expected_cite_ok,
        "expected_psi_total": len(expected_cite),
        "expected_tool_used": sum(1 for r in tool_items if r["used_expected_tool"]),
        "expected_tool_total": len(tool_items),
        "latency_median_s": round(statistics.median(latencies), 2) if latencies else None,
        "latency_p90_s": percentile(latencies, 0.9),
        "api_calls": sum(r["api_calls"] for r in records),
        "usage": usage_total,
        "estimated_cost_usd": round(sum(r["cost_usd"] for r in records), 2),
        "pricing_per_million_usd": dict(zip(("input", "output", "cache_read", "cache_write_multiplier"), PRICES["claude-sonnet-5-5"])),
        "budget_stopped": budget_stopped,
        "errors": [r["id"] for r in records if r["status"] != 200],
        "failures": failures,
    }


def main():
    with open(EVAL_SET, "r", encoding="ascii") as handle:
        items = json.load(handle)["questions"]
    run_at = datetime.datetime.now().isoformat(timespec="seconds")
    client = ask.make_client()
    records = {}
    first = run_item(client, items[0])
    records[first["id"]] = first
    print(first["id"], "PASS" if first["passed"] else "FAIL", first["cost_usd"], flush=True)

    def work(item):
        record = run_item(client, item)
        if record is None:
            return None
        with LOCK:
            if SPEND["usd"] > BUDGET_USD:
                SPEND["stopped"] = True
        print(record["id"], "PASS" if record["passed"] else "FAIL", record["status"], record["cost_usd"], round(SPEND["usd"], 2), flush=True)
        return record

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        for record in pool.map(work, items[1:]):
            if record is not None:
                records[record["id"]] = record
    ordered = [records[i["id"]] for i in items if i["id"] in records]
    summary = summarize(ordered, run_at, SPEND["stopped"])
    os.makedirs(RESULTS_DIR, exist_ok=True)
    stamp = datetime.date.today().isoformat()
    with open(os.path.join(RESULTS_DIR, "ask_eval_v2_%s.json" % stamp), "w", encoding="ascii") as handle:
        json.dump({"summary": summary, "records": ordered}, handle, indent=2)
    with open(SUMMARY_PATH, "w", encoding="ascii") as handle:
        json.dump(summary, handle, indent=2)
    print(json.dumps({k: v for k, v in summary.items() if k != "failures"}, indent=2))


if __name__ == "__main__":
    main()
