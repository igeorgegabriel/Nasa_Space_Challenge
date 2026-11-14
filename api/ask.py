import json
import os
import re
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler

import anthropic

MODEL = "claude-opus-5-5"
MAX_TOKENS = 4000
MAX_QUESTION_CHARS = 1000
MAX_BODY_BYTES = 16384
MAX_HISTORY_TURNS = 3
MAX_HISTORY_ANSWER_CHARS = 1500
CONTEXT_PAGES = ("home", "rank", "investigations", "investigation", "data")
NOT_IN_DATA = "Not in the data."
RATE_LIMIT_QUESTIONS = 10
RATE_LIMIT_WINDOW_SECONDS = 600
RATE_LIMIT_MAX_KEYS = 5000
RATE_LIMIT_MESSAGE = "Too many questions from your connection. Please wait a few minutes and ask again."

SYSTEM = (
    "You answer questions about NASA Physical Sciences Informatics (PSI) combustion investigations. "
    "Use only the provided documents; each document describes one investigation. "
    "Cite the documents that support every factual statement. "
    "If the documents do not contain the answer, reply exactly \"Not in the data.\" on its own line and then name what data would be needed. "
    "Never give partial-gravity numbers: all PSI data is microgravity, and results can only be bracketed between 0 g and 1 g. "
    "Never say a condition, material or atmosphere is safe. "
    "Keep MOC (minimum oxygen concentration), LOI (limiting oxygen index), ULOI (upper limit oxygen index) and extinction O2 as separate quantities. "
    "Keep ambient O2 and oxidizer-stream O2 separate. "
    "Be concise."
)

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


def build_content(question, corpus=None, context_sentence=None):
    documents = corpus if corpus is not None else CORPUS
    blocks = []
    for doc in documents:
        blocks.append({
            "type": "document",
            "source": {"type": "text", "media_type": "text/plain", "data": doc["body"]},
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


def answer_question(question, client=None, corpus=None, context_sentence=None, history=None):
    try:
        client = client or make_client()
    except anthropic.AnthropicError:
        return 500, {"error": "The Ask service is not configured on this deployment."}
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "medium"},
            system=SYSTEM,
            messages=build_messages(question, history, context_sentence, corpus),
        )
    except anthropic.RateLimitError:
        return 429, {"error": "The Ask service is busy. Wait a minute and try again."}
    except anthropic.APIConnectionError:
        return 503, {"error": "Could not reach the model service. Try again shortly."}
    except anthropic.APIStatusError as exc:
        return 502, {"error": "The model service returned an error (status %s)." % field(exc, "status_code", "unknown")}
    if field(response, "stop_reason") == "refusal":
        return 200, {
            "answer": "The model declined to answer this question. Try rephrasing it as a question about the loaded PSI investigations.",
            "citations": [],
            "model": field(response, "model", MODEL),
        }
    answer, citations = parse_response(response, corpus)
    if not answer:
        answer = NOT_IN_DATA
    return 200, {"answer": answer, "citations": citations, "model": field(response, "model", MODEL)}


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
        status, body = answer_question(question, context_sentence=context_sentence, history=history)
        self.send_json(status, body)

    def do_GET(self):
        self.send_json(405, {"error": "Use POST with a JSON body {\"question\": \"...\"}."})
