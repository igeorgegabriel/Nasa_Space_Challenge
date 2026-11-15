import importlib.util
import json
import os
import re
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler

import anthropic

MODEL = os.environ.get("ASK_MODEL") or "claude-sonnet-5-5"
EFFORT = os.environ.get("ASK_EFFORT") or "low"
MAX_TOKENS = 4000
MAX_QUESTION_CHARS = 1000
MAX_BODY_BYTES = 16384
MAX_HISTORY_TURNS = 3
MAX_HISTORY_ANSWER_CHARS = 1500
CONTEXT_PAGES = ("home", "rank", "investigations", "investigation", "equipment", "data")
NOT_IN_DATA = "Not in the data."
RATE_LIMIT_QUESTIONS = 30
RATE_LIMIT_WINDOW_SECONDS = 600
RATE_LIMIT_MAX_KEYS = 5000
RATE_LIMIT_MESSAGE = "Too many questions from your connection. Please wait a few minutes and ask again."

SYSTEM = (
    "You answer questions about NASA Physical Sciences Informatics (PSI) combustion investigations. "
    "Use only the provided documents; each document describes one investigation. "
    "Cite the documents that support every factual statement. "
    "If nothing in the documents answers the question, reply exactly \"Not in the data.\" on its own line and then name what data would be needed. "
    "Say \"Not in the data.\" only when nothing in the documents answers the question. If the documents answer part of it, answer that part first and then state briefly what is not covered. "
    "If a document covers the material asked about (including a named blend that contains it, stated as a blend), the mission or the condition, answer from that document. "
    "Only when the exact material, mission or gravity level asked about appears in no document, reply \"Not in the data.\" and name the data needed, and do not quote numbers from other materials, missions or conditions as a substitute: give only that line, one sentence on why, and the data needed, with no bullets and no numbers. "
    "All PSI data is microgravity. Give a partial-gravity number only when it is a measured value stated in the lunar gravity or partial gravity documents, with its source and test conditions; never compute, combine or interpolate a partial-gravity value. "
    "When asked what to test next, give the dashboard test plan (how many tests close how many habitat gaps) as well as the gap for each fuel class. "
    "For a PSI solid test with no pressure in PSI, give the pressure the NASA report states, from the dashboard results document. "
    "Questions about \"this project\", \"the dashboard\", \"the app\", \"the site\", \"the team\", \"the 3D chart\" or \"the assistant\" and its accuracy are answered from the About this project document. "
    "Never say a condition, material or atmosphere is safe. "
    "Keep MOC (minimum oxygen concentration), LOI (limiting oxygen index), ULOI (upper limit oxygen index) and extinction O2 as separate quantities. "
    "Keep ambient O2 and oxidizer-stream O2 separate. "
    "Be concise."
)

BREVITY = (
    " Keep every answer to at most 120 words: a one-line direct answer first, then up to 3 short bullets. "
    "Do not add preamble or a closing summary."
)

TOOLS_NOTE = (
    " You also have data tools that read the same JSON the website shows. "
    "Use them for any count, ranking, window, test-next or readiness number instead of estimating; use the documents for findings and quotes. "
    "The tool results are the website's own data. "
    "Never mention tools, tool names or classification in the answer; write as a person reporting what the data shows, for example \"0 of 137 solid-fuel tests fall inside the window\". "
    "End every answer with one final line exactly \"FOLLOWUPS: <question 1> | <question 2>\" giving two short follow-up questions (each under 70 characters) that this data can answer."
)

SYSTEM_LEGACY = SYSTEM
SYSTEM = SYSTEM_LEGACY + BREVITY + TOOLS_NOTE

MAX_TOOL_ROUNDS = 4
TOOL_TIME_BUDGET_SECONDS = 40
MAX_FOLLOWUP_CHARS = 120

def load_sibling(file_name, module_name):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), file_name)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_data_tools():
    return load_sibling("_data_tools.py", "ask_data_tools")


DATA_TOOLS = load_data_tools()
NUMBER_CHECK = load_sibling("_number_check.py", "ask_number_check")

FOLLOWUPS_RE = re.compile(r"(?im)^[ \t>*_#-]*FOLLOWUPS[ \t]*[*_]*[ \t]*:?[ \t]*[*_]*(.*)$")
CITE_TAIL_RE = re.compile(r"(\s*\[\d+\])+\s*$")

CACHE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data", "ask_cache.json")


def normalize_question(text):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def load_ask_cache():
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


ASK_CACHE = load_ask_cache()


def cached_answer(question, history=None, cache=None):
    if history:
        return None
    entries = ASK_CACHE if cache is None else cache
    entry = entries.get(normalize_question(question))
    if not entry or not entry.get("answer"):
        return None
    steps = [s for s in entry.get("steps") or [] if isinstance(s, dict)][:8]
    return {
        "answer": entry["answer"],
        "citations": entry.get("citations", []),
        "model": entry.get("model", MODEL),
        "cached": True,
        "number_check": entry.get("number_check") or cached_number_check(entry, steps),
        "steps": steps,
        "actions": [a for a in entry.get("actions") or [] if isinstance(a, dict) and str(a.get("href", "")).startswith("#/")][:2],
        "followups": [f for f in entry.get("followups") or [] if isinstance(f, str)][:2],
    }


def cached_number_check(entry, steps):
    return NUMBER_CHECK.check_cached(entry.get("question", ""), entry["answer"], entry.get("citations", []), steps, DATA_TOOLS)


def split_followups(answer):
    match = FOLLOWUPS_RE.search(answer)
    if not match:
        return answer, []
    raw = match.group(1)
    markers = CITE_TAIL_RE.search(raw)
    tail = CITE_TAIL_RE.sub("", raw).strip().strip("*_").strip()
    followups = []
    for part in tail.split("|"):
        part = part.strip().strip("*_\"'").strip()
        if part and len(part) <= MAX_FOLLOWUP_CHARS:
            followups.append(part)
    cleaned = (answer[:match.start()] + answer[match.end():]).strip()
    if markers and cleaned:
        cleaned = cleaned + " " + markers.group(0).strip()
    return cleaned, followups[:2]


def request_options(model, effort):
    options = {"model": model}
    if model.startswith("claude-haiku"):
        options["output_config"] = {"effort": effort}
        return options
    options["betas"] = ["server-side-fallback-2026-07-01"]
    options["fallbacks"] = "default"
    options["output_config"] = {"effort": effort}
    return options


CORPUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "context", "corpus.json")


def load_corpus():
    with open(CORPUS_PATH, "r", encoding="ascii") as handle:
        return json.load(handle)["documents"]


CORPUS = load_corpus()

ENVIRONMENTS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data", "environments.json")


def load_environments():
    with open(ENVIRONMENTS_PATH, "r", encoding="utf-8") as handle:
        return {env["id"]: env.get("name", "") for env in json.load(handle)["environments"]}


ENVIRONMENTS = load_environments()


class RateLimiter:
    def __init__(self, limit=RATE_LIMIT_QUESTIONS, window=RATE_LIMIT_WINDOW_SECONDS, max_keys=RATE_LIMIT_MAX_KEYS):
        self.limit = limit
        self.window = window
        self.max_keys = max_keys
        self.hits = {}
        self.lock = threading.Lock()

    def prune(self, now):
        for key in [k for k, q in self.hits.items() if not q or q[-1] <= now - self.window]:
            del self.hits[key]

    def check(self, key, now=None):
        now = time.time() if now is None else now
        with self.lock:
            if len(self.hits) >= self.max_keys:
                self.prune(now)
            queue = self.hits.setdefault(key, deque())
            while queue and queue[0] <= now - self.window:
                queue.popleft()
            if len(queue) >= self.limit:
                return False, max(1, int(queue[0] + self.window - now) + 1)
            queue.append(now)
            return True, 0


RATE_LIMITER = RateLimiter()


def client_ip(headers, fallback):
    forwarded = headers.get("X-Forwarded-For") or ""
    first = forwarded.split(",")[0].strip()
    return first or fallback or "unknown"


MAX_CITE_BLOCK_CHARS = 420
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\[(\"])")
CLAUSE_SPLIT_RE = re.compile(r"(?<=[;|])\s+")


def pack_pieces(pieces, limit):
    blocks = []
    current = ""
    for piece in pieces:
        if current and len(current) + 1 + len(piece) > limit:
            blocks.append(current)
            current = piece
        else:
            current = (current + " " + piece) if current else piece
    if current:
        blocks.append(current)
    return blocks


def hard_wrap(text, limit):
    words = text.split(" ")
    blocks = []
    current = ""
    for word in words:
        if current and len(current) + 1 + len(word) > limit:
            blocks.append(current)
            current = word
        else:
            current = (current + " " + word) if current else word
    if current:
        blocks.append(current)
    return blocks


def split_line(line, limit=MAX_CITE_BLOCK_CHARS):
    if len(line) <= limit:
        return [line]
    pieces = []
    for sentence in SENTENCE_SPLIT_RE.split(line):
        if len(sentence) <= limit:
            pieces.append(sentence)
            continue
        for clause in CLAUSE_SPLIT_RE.split(sentence):
            pieces.extend(hard_wrap(clause, limit) if len(clause) > limit else [clause])
    return pack_pieces(pieces, limit)


def cite_blocks(body):
    blocks = []
    for line in body.split("\n"):
        line = line.strip()
        if line:
            blocks.extend(split_line(line))
    return blocks


def build_content(question, corpus=None, context_sentence=None):
    documents = corpus if corpus is not None else CORPUS
    blocks = []
    for doc in documents:
        blocks.append({
            "type": "document",
            "source": {"type": "content", "content": [{"type": "text", "text": text} for text in cite_blocks(doc["body"])]},
            "title": doc["title"],
            "citations": {"enabled": True},
        })
    if blocks:
        blocks[-1]["cache_control"] = {"type": "ephemeral"}
    if context_sentence:
        blocks.append({"type": "text", "text": context_sentence})
    blocks.append({"type": "text", "text": question})
    return blocks


def build_messages(question, history=None, context_sentence=None, corpus=None):
    turns = history or []
    first_question = turns[0]["question"] if turns else question
    messages = [{"role": "user", "content": build_content(first_question, corpus, context_sentence)}]
    for index, turn in enumerate(turns):
        next_question = turns[index + 1]["question"] if index + 1 < len(turns) else question
        messages.append({"role": "assistant", "content": [{"type": "text", "text": turn["answer"]}]})
        messages.append({"role": "user", "content": [{"type": "text", "text": next_question}]})
    return messages


def validate_question(payload):
    if not isinstance(payload, dict):
        return None, "Request body must be a JSON object with a question."
    return clean_question(payload.get("question"), "question")


def clean_question(value, name):
    if not isinstance(value, str):
        return None, "Field %s must be a string." % name
    value = value.strip()
    if not value:
        return None, "Question is empty."
    if len(value) > MAX_QUESTION_CHARS:
        return None, "Question is longer than %d characters." % MAX_QUESTION_CHARS
    return value, None


def corpus_psi_ids(corpus=None):
    documents = corpus if corpus is not None else CORPUS
    ids = {}
    for index, doc in enumerate(documents):
        psi_id = psi_id_for(index, documents)
        if psi_id:
            ids[psi_id] = doc.get("title", "")
    return ids


def short_name(psi_id, title):
    rest = title[len(psi_id):].strip() if title.startswith(psi_id) else title.strip()
    return rest.split(" - ")[0].strip()


def validate_context(payload, corpus=None):
    context = payload.get("context")
    if context is None:
        return None, None
    if not isinstance(context, dict):
        return None, "Field context must be an object."
    page = context.get("page")
    if page not in CONTEXT_PAGES:
        return None, "Field context.page is not a known page."
    psi_id = context.get("psi_id")
    habitat = context.get("habitat")
    ids = corpus_psi_ids(corpus)
    if psi_id is not None and (not isinstance(psi_id, str) or psi_id not in ids):
        return None, "Field context.psi_id is not a known investigation."
    if habitat is not None and (not isinstance(habitat, str) or habitat not in ENVIRONMENTS):
        return None, "Field context.habitat is not a known habitat."
    if page == "investigation" and psi_id:
        name = short_name(psi_id, ids[psi_id])
        label = "%s (%s)" % (psi_id, name) if name else psi_id
        return "The user is viewing investigation %s in the dashboard." % label, None
    if page == "rank" and habitat:
        return "The user is viewing the habitat ranking for %s." % habitat, None
    sentences = {
        "home": "The user is viewing the home page of the dashboard.",
        "rank": "The user is viewing the habitat ranking page of the dashboard.",
        "investigations": "The user is viewing the list of investigations in the dashboard.",
        "investigation": "The user is viewing an investigation page in the dashboard.",
        "equipment": "The user is viewing the fire-safety equipment page of the dashboard.",
        "data": "The user is viewing the data and models page of the dashboard.",
    }
    return sentences[page], None


def validate_history(payload):
    history = payload.get("history")
    if history is None:
        return [], None
    if not isinstance(history, list):
        return None, "Field history must be a list."
    if len(history) > MAX_HISTORY_TURNS:
        return None, "Field history has more than %d turns." % MAX_HISTORY_TURNS
    turns = []
    for turn in history:
        if not isinstance(turn, dict):
            return None, "Each history turn must be an object."
        question, error = clean_question(turn.get("question"), "history.question")
        if error:
            return None, error
        answer = turn.get("answer")
        if not isinstance(answer, str) or not answer.strip():
            return None, "Field history.answer must be a non-empty string."
        turns.append({"question": question, "answer": answer.strip()[:MAX_HISTORY_ANSWER_CHARS]})
    return turns, None


def field(obj, name, default=None):
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def psi_id_for(document_index, corpus):
    if document_index is None or not 0 <= document_index < len(corpus):
        return None
    doc = corpus[document_index]
    if doc.get("psi_id"):
        return doc["psi_id"]
    match = re.match(r"(PSI-\d+)", doc.get("title", ""))
    return match.group(1) if match else None


def parse_response(response, corpus=None):
    documents = corpus if corpus is not None else CORPUS
    answer_parts = []
    citations = []
    seen = {}
    for block in field(response, "content", []) or []:
        if field(block, "type") != "text":
            continue
        text = field(block, "text", "") or ""
        markers = []
        for cite in field(block, "citations", None) or []:
            index = field(cite, "document_index")
            cited = field(cite, "cited_text", "") or ""
            key = (index, cited)
            if key not in seen:
                seen[key] = len(citations) + 1
                citations.append({
                    "n": seen[key],
                    "psi_id": psi_id_for(index, documents),
                    "title": field(cite, "document_title", "") or "",
                    "cited_text": cited,
                })
            if seen[key] not in markers:
                markers.append(seen[key])
        if markers:
            text = text + "".join(" [%d]" % n for n in markers)
        answer_parts.append(text)
    return "".join(answer_parts).strip(), citations


def make_client():
    return anthropic.Anthropic()


def call_model(client, model, effort, system, messages, tools, force_final):
    kwargs = dict(
        max_tokens=MAX_TOKENS,
        system=system,
        **request_options(model, effort),
        messages=messages,
    )
    if tools:
        kwargs["tools"] = tools
        if force_final:
            kwargs["tool_choice"] = {"type": "none"}
    try:
        return client.beta.messages.create(**kwargs), None
    except anthropic.RateLimitError:
        return None, (429, {"error": "The Ask service is busy. Wait a minute and try again."})
    except anthropic.APIConnectionError:
        return None, (503, {"error": "Could not reach the model service. Try again shortly."})
    except anthropic.APIStatusError as exc:
        return None, (502, {"error": "The model service returned an error (status %s)." % field(exc, "status_code", "unknown")})


def execute_tool_blocks(response, messages, log):
    results = []
    for block in field(response, "content", []) or []:
        if field(block, "type") != "tool_use":
            continue
        name = field(block, "name")
        tool_input = field(block, "input", {}) or {}
        result = DATA_TOOLS.run_tool(name, tool_input)
        log.append((name, tool_input, result))
        entry = {
            "type": "tool_result",
            "tool_use_id": field(block, "id"),
            "content": json.dumps(result, separators=(",", ":")),
        }
        if isinstance(result, dict) and "error" in result:
            entry["is_error"] = True
        results.append(entry)
    messages.append({"role": "assistant", "content": field(response, "content", [])})
    messages.append({"role": "user", "content": results})


def answer_question(question, client=None, corpus=None, context_sentence=None, history=None, model=None, effort=None, system=None, use_cache=True, context_psi_id=None, use_tools=True):
    if use_cache:
        hit = cached_answer(question, history)
        if hit:
            return 200, hit
    started = time.time()
    model = model or MODEL
    effort = effort or EFFORT
    try:
        client = client or make_client()
    except anthropic.AnthropicError:
        return 500, {"error": "The Ask service is not configured on this deployment."}
    messages = build_messages(question, history, context_sentence, corpus)
    tools = DATA_TOOLS.tool_definitions() if use_tools else None
    log = []
    rounds = 0
    while True:
        force_final = rounds >= MAX_TOOL_ROUNDS or time.time() - started > TOOL_TIME_BUDGET_SECONDS
        response, failure = call_model(client, model, effort, system or SYSTEM, messages, tools, force_final)
        if failure:
            return failure
        if field(response, "stop_reason") == "tool_use" and tools and not force_final:
            execute_tool_blocks(response, messages, log)
            rounds += 1
            continue
        break
    if field(response, "stop_reason") == "refusal":
        return 200, {
            "answer": "The model declined to answer this question. Try rephrasing it as a question about the loaded PSI investigations.",
            "citations": [],
            "model": field(response, "model", model),
            "steps": [],
            "actions": [],
            "followups": [],
        }
    answer, citations = parse_response(response, corpus)
    answer, followups = split_followups(answer)
    if not answer:
        answer = NOT_IN_DATA
    cited = {c["psi_id"] for c in citations if c.get("psi_id")}
    steps, actions = DATA_TOOLS.build_steps_and_actions(log, context_psi_id, cited)
    return 200, {
        "answer": answer,
        "citations": citations,
        "model": field(response, "model", model),
        "number_check": NUMBER_CHECK.check_live(answer, citations, log, DATA_TOOLS),
        "steps": steps,
        "actions": actions,
        "followups": followups,
    }


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(400, {"error": "Request body is missing or too large."})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self.send_json(400, {"error": "Request body is not valid JSON."})
            return
        question, error = validate_question(payload)
        if error:
            self.send_json(400, {"error": error})
            return
        context_sentence, error = validate_context(payload)
        if error:
            self.send_json(400, {"error": error})
            return
        history, error = validate_history(payload)
        if error:
            self.send_json(400, {"error": error})
            return
        allowed, retry_after = RATE_LIMITER.check(client_ip(self.headers, self.client_address[0]))
        if not allowed:
            self.send_json(429, {"error": RATE_LIMIT_MESSAGE}, {"Retry-After": str(retry_after)})
            return
        context = payload.get("context")
        context_psi_id = context.get("psi_id") if isinstance(context, dict) else None
        status, body = answer_question(question, context_sentence=context_sentence, history=history, context_psi_id=context_psi_id)
        self.send_json(status, body)

    def do_GET(self):
        self.send_json(405, {"error": "Use POST with a JSON body {\"question\": \"...\"}."})
