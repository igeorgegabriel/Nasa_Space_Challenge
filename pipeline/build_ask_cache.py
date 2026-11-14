import os
os.environ["ANTHROPIC_BASE_URL"] = "https://api.anthropic.com"
import sys
import json
import time
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from api import ask

OUT = os.path.join(ROOT, "public", "data", "ask_cache.json")

QUESTIONS = [
    "Which solid materials were tested and at what oxygen?",
    "What did FLEX learn about extinguishing flames?",
    "Which investigations studied smoke or fire detection?",
    "Which investigations used solid fuels?",
    "Which fire-modelling relationships do the PSI data support?",
    "What oxygen and pressure range do the solid-fuel tests cover?",
    "What data is missing to model a fire in a Moon base cabin?",
    "What is the highest oxygen any solid material was tested at in PSI?",
    "What is the highest oxygen at which NASA burned a solid, including tests outside PSI?",
    "What did BASS-II find?",
    "What did FLEX learn about putting out flames?",
    "Which experiments matter most for a Moon base?",
    "What should NASA test next for a Moon base?",
    "Which investigations studied smoke detection?",
    "Is there any partial-gravity data?",
]


def main():
    extra = [q for q in sys.argv[1:] if not q.startswith("--")]
    questions = QUESTIONS + extra
    cache = {}
    if os.path.exists(OUT) and "--fresh" not in sys.argv:
        with open(OUT, "r", encoding="utf-8") as handle:
            cache = json.load(handle)
    client = ask.make_client()
    for question in questions:
        key = ask.normalize_question(question)
        if key in cache and "--refresh" not in sys.argv:
            continue
        status, body = ask.answer_question(question, client=client, use_cache=False)
        if status != 200:
            print("skip", question, status, body.get("error"))
            continue
        cache[key] = {
            "question": question,
            "answer": body["answer"],
            "citations": body["citations"],
            "model": body["model"],
            "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        }
        print("ok", question, len(body["citations"]), flush=True)
        time.sleep(1)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(cache, handle, indent=1, ensure_ascii=True)


if __name__ == "__main__":
    main()
