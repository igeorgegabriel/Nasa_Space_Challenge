import json
import os
import re
from http.server import BaseHTTPRequestHandler

import anthropic

MODEL = "claude-opus-5-5"
MAX_TOKENS = 4000
MAX_QUESTION_CHARS = 1000
MAX_BODY_BYTES = 8192
NOT_IN_DATA = "Not in the data."

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


def build_content(question, corpus=None):
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
    blocks.append({"type": "text", "text": question})
    return blocks


def validate_question(payload):
    if not isinstance(payload, dict):
        return None, "Request body must be a JSON object with a question."
    question = payload.get("question")
    if not isinstance(question, str):
        return None, "Field question must be a string."
    question = question.strip()
    if not question:
        return None, "Question is empty."
    if len(question) > MAX_QUESTION_CHARS:
        return None, "Question is longer than %d characters." % MAX_QUESTION_CHARS
    return question, None


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


def answer_question(question, client=None, corpus=None):
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
            messages=[{"role": "user", "content": build_content(question, corpus)}],
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
    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
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
        status, body = answer_question(question)
        self.send_json(status, body)

    def do_GET(self):
        self.send_json(405, {"error": "Use POST with a JSON body {\"question\": \"...\"}."})
