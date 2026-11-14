import os
os.environ["ANTHROPIC_BASE_URL"] = "https://api.anthropic.com"
import sys
import json
import time
import datetime
import statistics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from api import ask

QUESTIONS = [
    "What is the highest ambient oxygen mole fraction tested for solid fuels in the dataset?",
    "What did BASS-II find?",
    "Which investigations in the data studied smoke detection?",
    "What should NASA test next for a Moon base?",
]
PRICES = {
    "claude-opus-5-5": (4.0, 20.0, 0.20, 1.25),
    "claude-sonnet-5-5": (2.0, 10.0, 0.10, 1.25),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 1.25),
}
CONFIGS = {
    "baseline_opus_medium_legacy": ("claude-opus-5-5", "medium", ask.SYSTEM_LEGACY),
    "opus_low_brief": ("claude-opus-5-5", "low", ask.SYSTEM),
    "sonnet_low_brief": ("claude-sonnet-5-5", "low", ask.SYSTEM),
    "haiku_low_brief": ("claude-haiku-5-5", "low", ask.SYSTEM),
}


class Recorder:
    def __init__(self, client):
        self.client = client
        self.beta = self
        self.messages = self
        self.last = None

    def create(self, **kwargs):
        start = time.time()
        response = self.client.beta.messages.create(**kwargs)
        usage = response.usage
        self.last = {"latency_s": round(time.time() - start, 2), "usage": usage.model_dump()}
        return response


def cost(model, usage):
    pin, pout, pread, wmult = PRICES[model]
    fresh = usage.get("input_tokens", 0) or 0
    read = usage.get("cache_read_input_tokens", 0) or 0
    write = usage.get("cache_creation_input_tokens", 0) or 0
    out = usage.get("output_tokens", 0) or 0
    return (fresh * pin + read * pread + write * pin * wmult + out * pout) / 1e6


def run(name, repeat_first=True):
    model, effort, system = CONFIGS[name]
    rec = Recorder(ask.make_client())
    rows = []
    for phase, question in [("cold", QUESTIONS[0])] + [("warm", q) for q in QUESTIONS]:
        status, body = ask.answer_question(question, client=rec, model=model, effort=effort, system=system, use_cache=False)
        meta = rec.last or {}
        rows.append({
            "phase": phase, "question": question, "status": status,
            "latency_s": meta.get("latency_s"), "usage": meta.get("usage"),
            "cost_usd": round(cost(model, meta["usage"]), 4) if meta.get("usage") else None,
            "words": len(body.get("answer", "").split()), "answer": body.get("answer", body.get("error")),
        })
        print(name, phase, rows[-1]["latency_s"], rows[-1]["cost_usd"], rows[-1]["words"], flush=True)
        rec.last = None
        time.sleep(1)
    warm = [r["latency_s"] for r in rows if r["phase"] == "warm" and r["latency_s"]]
    return {"model": model, "effort": effort, "cold_s": rows[0]["latency_s"], "warm_median_s": statistics.median(warm) if warm else None,
            "warm_cost_avg_usd": round(statistics.mean(r["cost_usd"] for r in rows[1:] if r["cost_usd"] is not None), 4), "rows": rows}


def main():
    names = sys.argv[1:] or list(CONFIGS)
    out = {}
    path = os.path.join(ROOT, "eval", "results", "latency_%s.json" % datetime.date.today().isoformat())
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            out = json.load(handle)
    for name in names:
        try:
            out[name] = run(name)
        except Exception as exc:
            out[name] = {"error": type(exc).__name__ + ": " + str(exc)[:300]}
            print(name, "error", out[name]["error"], flush=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(out, handle, indent=2)


if __name__ == "__main__":
    main()
