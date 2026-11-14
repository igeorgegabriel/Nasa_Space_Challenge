import http.client
import importlib.util
import json
import os
import sys
import threading
import types
import unittest
from http.server import HTTPServer
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASK_PATH = os.path.join(ROOT, "api", "ask.py")


def make_fake_anthropic():
    module = types.ModuleType("anthropic")

    class AnthropicError(Exception):
        pass

    class APIConnectionError(AnthropicError):
        pass

    class APIStatusError(AnthropicError):
        def __init__(self, message="status", status_code=500):
            super().__init__(message)
            self.status_code = status_code

    class RateLimitError(APIStatusError):
        pass

    def anthropic_factory():
        raise AnthropicError("no key")

    module.AnthropicError = AnthropicError
    module.APIConnectionError = APIConnectionError
    module.APIStatusError = APIStatusError
    module.RateLimitError = RateLimitError
    module.Anthropic = anthropic_factory
    return module


def load_ask():
    saved = sys.modules.get("anthropic")
    fake = make_fake_anthropic()
    sys.modules["anthropic"] = fake
    try:
        spec = importlib.util.spec_from_file_location("ask_under_test", ASK_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        if saved is None:
            del sys.modules["anthropic"]
        else:
            sys.modules["anthropic"] = saved
    return module, fake


class StubMessages:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


class StubClient:
    def __init__(self, response=None, error=None):
        self.beta = SimpleNamespace(messages=StubMessages(response, error))


def text_block(text, citations=None):
    return SimpleNamespace(type="text", text=text, citations=citations)


def citation(index, cited, title="doc"):
    return SimpleNamespace(type="char_location", cited_text=cited, document_index=index, document_title=title)


class AskTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ask, cls.fake = load_ask()

    def test_corpus_loaded(self):
        self.assertGreater(len(self.ask.CORPUS), 0)
        self.assertEqual(self.ask.MODEL, "claude-opus-5-5")

    def test_validate_question(self):
        v = self.ask.validate_question
        self.assertEqual(v({"question": "  hello  "}), ("hello", None))
        self.assertIsNone(v({"question": ""})[0])
        self.assertIsNone(v({"question": "   "})[0])
        self.assertIsNone(v({})[0])
        self.assertIsNone(v({"question": 5})[0])
        self.assertIsNone(v([1])[0])
        self.assertIsNone(v({"question": "x" * 1001})[0])
        self.assertEqual(v({"question": "x" * 1000})[0], "x" * 1000)

    def test_build_content_blocks(self):
        content = self.ask.build_content("What is PSI-25?")
        docs = content[:-1]
        self.assertEqual(len(docs), len(self.ask.CORPUS))
        for block in docs:
            self.assertEqual(block["type"], "document")
            self.assertEqual(block["source"]["media_type"], "text/plain")
            self.assertEqual(block["citations"], {"enabled": True})
        for block in docs[:-1]:
            self.assertNotIn("cache_control", block)
        self.assertEqual(docs[-1]["cache_control"], {"type": "ephemeral"})
        self.assertEqual(content[-1], {"type": "text", "text": "What is PSI-25?"})

    def test_request_shape_has_no_sampling_params(self):
        response = SimpleNamespace(content=[text_block("ok")], stop_reason="end_turn", model="claude-opus-5-5")
        client = StubClient(response)
        status, body = self.ask.answer_question("q", client=client)
        self.assertEqual(status, 200)
        call = client.beta.messages.calls[0]
        self.assertEqual(call["model"], "claude-opus-5-5")
        self.assertEqual(call["max_tokens"], 4000)
        self.assertEqual(call["betas"], ["server-side-fallback-2026-07-01"])
        self.assertEqual(call["fallbacks"], "default")
        self.assertEqual(call["output_config"], {"effort": "medium"})
        self.assertIsInstance(call["system"], str)
        for forbidden in ("temperature", "top_p", "top_k", "thinking"):
            self.assertNotIn(forbidden, call)
        messages = call["messages"]
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "user")

    def test_system_prompt_rules(self):
        system = self.ask.SYSTEM
        self.assertIn("Not in the data.", system)
        self.assertIn("partial-gravity", system)
        self.assertIn("safe", system)
        self.assertIn("MOC", system)
        self.assertIn("ULOI", system)
        self.assertIn("LOI", system)

    def test_parse_response_numbers_citations(self):
        corpus = [
            {"psi_id": "PSI-25", "title": "PSI-25 BASS-II - Burning", "body": "a"},
            {"psi_id": "PSI-69", "title": "PSI-69 FLEX - Flame", "body": "b"},
        ]
        response = SimpleNamespace(content=[
            text_block("BASS-II tested up to 0.222.", [citation(0, "ambient O2 0.136 to 0.222", "PSI-25 BASS-II - Burning")]),
            SimpleNamespace(type="thinking", thinking="hidden"),
            text_block(" FLEX reached 0.34.", [citation(1, "0.12 to 0.34", "PSI-69 FLEX - Flame"), citation(0, "ambient O2 0.136 to 0.222")]),
        ], stop_reason="end_turn", model="m")
        answer, citations = self.ask.parse_response(response, corpus)
        self.assertEqual(answer, "BASS-II tested up to 0.222. [1] FLEX reached 0.34. [2] [1]")
        self.assertEqual([c["n"] for c in citations], [1, 2])
        self.assertEqual([c["psi_id"] for c in citations], ["PSI-25", "PSI-69"])
        self.assertEqual(citations[0]["cited_text"], "ambient O2 0.136 to 0.222")

    def test_answer_question_returns_structure(self):
        corpus = [{"psi_id": "PSI-25", "title": "PSI-25 BASS-II - Burning", "body": "a"}]
        response = SimpleNamespace(
            content=[text_block("Yes.", [citation(0, "text")])], stop_reason="end_turn", model="claude-opus-5-5")
        status, body = self.ask.answer_question("q", client=StubClient(response), corpus=corpus)
        self.assertEqual(status, 200)
        self.assertEqual(body["answer"], "Yes. [1]")
        self.assertEqual(body["citations"][0]["psi_id"], "PSI-25")
        self.assertEqual(body["model"], "claude-opus-5-5")
        self.assertEqual(set(body), {"answer", "citations", "model"})

    def test_refusal_is_polite(self):
        response = SimpleNamespace(content=[], stop_reason="refusal", model="m")
        status, body = self.ask.answer_question("q", client=StubClient(response))
        self.assertEqual(status, 200)
        self.assertEqual(body["citations"], [])
        self.assertIn("declined", body["answer"])

    def test_errors_are_separated(self):
        cases = [
            (self.fake.RateLimitError("limit", 429), 429),
            (self.fake.APIConnectionError("net"), 503),
            (self.fake.APIStatusError("bad", 529), 502),
        ]
        for error, expected in cases:
            status, body = self.ask.answer_question("q", client=StubClient(error=error))
            self.assertEqual(status, expected)
            self.assertIn("error", body)

    def test_missing_key_is_reported(self):
        status, body = self.ask.answer_question("q")
        self.assertEqual(status, 500)
        self.assertIn("not configured", body["error"])

    def test_rate_limiter_window_and_keys(self):
        limiter = self.ask.RateLimiter(limit=3, window=100)
        for second in (0, 1, 2):
            self.assertEqual(limiter.check("a", now=1000 + second), (True, 0))
        allowed, retry = limiter.check("a", now=1003)
        self.assertFalse(allowed)
        self.assertGreaterEqual(retry, 1)
        self.assertLessEqual(retry, 100)
        self.assertEqual(limiter.check("b", now=1003), (True, 0))
        self.assertEqual(limiter.check("a", now=1100), (True, 0))
        self.assertFalse(limiter.check("a", now=1100)[0])

    def test_rate_limiter_defaults_and_pruning(self):
        self.assertEqual(self.ask.RATE_LIMIT_QUESTIONS, 10)
        self.assertEqual(self.ask.RATE_LIMIT_WINDOW_SECONDS, 600)
        limiter = self.ask.RateLimiter(limit=1, window=10, max_keys=3)
        for index in range(3):
            limiter.check("ip%d" % index, now=100)
        limiter.check("ip9", now=500)
        self.assertLessEqual(len(limiter.hits), 2)

    def test_client_ip_prefers_forwarded_for(self):
        self.assertEqual(self.ask.client_ip({"X-Forwarded-For": "1.2.3.4, 10.0.0.1"}, "127.0.0.1"), "1.2.3.4")
        self.assertEqual(self.ask.client_ip({}, "127.0.0.1"), "127.0.0.1")
        self.assertEqual(self.ask.client_ip({"X-Forwarded-For": ""}, "127.0.0.1"), "127.0.0.1")

    def test_http_rate_limit_returns_429(self):
        original = self.ask.answer_question
        original_limiter = self.ask.RATE_LIMITER
        self.ask.RATE_LIMITER = self.ask.RateLimiter(limit=2, window=600)
        self.ask.answer_question = lambda question, client=None, corpus=None, **kwargs: (200, {"answer": "ok", "citations": [], "model": "m"})
        server = HTTPServer(("127.0.0.1", 0), self.ask.handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]

            def post(ip, question="hello"):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("POST", "/api/ask", body=json.dumps({"question": question}),
                             headers={"Content-Type": "application/json", "X-Forwarded-For": ip})
                res = conn.getresponse()
                payload = json.loads(res.read().decode("utf-8"))
                retry = res.getheader("Retry-After")
                conn.close()
                return res.status, payload, retry

            self.assertEqual(post("9.9.9.9")[0], 200)
            self.assertEqual(post("9.9.9.9")[0], 200)
            status, payload, retry = post("9.9.9.9")
            self.assertEqual(status, 429)
            self.assertIn("Too many questions", payload["error"])
            self.assertTrue(retry and int(retry) >= 1)
            self.assertEqual(post("8.8.8.8")[0], 200)
            self.assertEqual(post("9.9.9.9", question="")[0], 400)
        finally:
            server.shutdown()
            server.server_close()
            self.ask.answer_question = original
            self.ask.RATE_LIMITER = original_limiter

    def test_http_handler_validation(self):
        original = self.ask.answer_question
        self.ask.answer_question = lambda question, client=None, corpus=None, **kwargs: (200, {"answer": "echo " + question, "citations": [], "model": "m"})
        server = HTTPServer(("127.0.0.1", 0), self.ask.handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]

            def post(raw, content_type="application/json"):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("POST", "/api/ask", body=raw, headers={"Content-Type": content_type})
                res = conn.getresponse()
                payload = json.loads(res.read().decode("utf-8"))
                conn.close()
                return res.status, payload

            self.assertEqual(post(json.dumps({"question": ""}))[0], 400)
            self.assertEqual(post(json.dumps({"question": "x" * 1001}))[0], 400)
            self.assertEqual(post("not json")[0], 400)
            self.assertEqual(post(json.dumps(["list"]))[0], 400)
            status, payload = post(json.dumps({"question": "hello"}))
            self.assertEqual(status, 200)
            self.assertEqual(payload["answer"], "echo hello")
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.request("GET", "/api/ask")
            self.assertEqual(conn.getresponse().status, 405)
            conn.close()
        finally:
            server.shutdown()
            server.server_close()
            self.ask.answer_question = original


    def test_context_validation(self):
        v = self.ask.validate_context
        self.assertEqual(v({}), (None, None))
        self.assertIsNotNone(v({"context": "home"})[1])
        self.assertIsNotNone(v({"context": {"page": "settings"}})[1])
        self.assertIsNotNone(v({"context": {}})[1])
        self.assertIsNotNone(v({"context": {"page": "investigation", "psi_id": "PSI-99999"}})[1])
        self.assertIsNotNone(v({"context": {"page": "investigation", "psi_id": 25}})[1])
        self.assertIsNotNone(v({"context": {"page": "rank", "habitat": "venus"}})[1])
        self.assertIsNotNone(v({"context": {"page": "rank", "habitat": ["lunar"]}})[1])
        sentence, error = v({"context": {"page": "investigation", "psi_id": "PSI-25"}})
        self.assertIsNone(error)
        self.assertTrue(sentence.startswith("The user is viewing investigation PSI-25 ("))
        self.assertTrue(sentence.endswith(" in the dashboard."))
        sentence, error = v({"context": {"page": "rank", "habitat": "lunar"}})
        self.assertEqual(sentence, "The user is viewing the habitat ranking for lunar.")
        for page in self.ask.CONTEXT_PAGES:
            self.assertIsNone(v({"context": {"page": page}})[1])

    def test_history_validation(self):
        v = self.ask.validate_history
        self.assertEqual(v({}), ([], None))
        self.assertIsNotNone(v({"history": "x"})[1])
        self.assertIsNotNone(v({"history": [{"question": "q", "answer": "a"}] * 4})[1])
        self.assertIsNotNone(v({"history": ["x"]})[1])
        self.assertIsNotNone(v({"history": [{"question": "", "answer": "a"}]})[1])
        self.assertIsNotNone(v({"history": [{"question": "q" * 1001, "answer": "a"}]})[1])
        self.assertIsNotNone(v({"history": [{"question": "q", "answer": 5}]})[1])
        self.assertIsNotNone(v({"history": [{"question": "q", "answer": "  "}]})[1])
        turns, error = v({"history": [{"question": " q ", "answer": "a" * 5000}]})
        self.assertIsNone(error)
        self.assertEqual(turns[0]["question"], "q")
        self.assertEqual(len(turns[0]["answer"]), 1500)

    def test_message_structure_with_history_and_context(self):
        corpus = [
            {"psi_id": "PSI-25", "title": "PSI-25 BASS-II - Burning", "body": "a"},
            {"psi_id": "PSI-69", "title": "PSI-69 FLEX - Flame", "body": "b"},
        ]
        history = [
            {"question": "first q", "answer": "first a"},
            {"question": "second q", "answer": "second a"},
        ]
        sentence = "The user is viewing the home page of the dashboard."
        messages = self.ask.build_messages("third q", history, sentence, corpus)
        self.assertEqual([m["role"] for m in messages], ["user", "assistant", "user", "assistant", "user"])
        first = messages[0]["content"]
        docs = [b for b in first if b["type"] == "document"]
        self.assertEqual(len(docs), 2)
        self.assertNotIn("cache_control", docs[0])
        self.assertEqual(docs[1]["cache_control"], {"type": "ephemeral"})
        self.assertEqual(first[:2], docs)
        self.assertEqual(first[2], {"type": "text", "text": sentence})
        self.assertEqual(first[3], {"type": "text", "text": "first q"})
        self.assertEqual(len(first), 4)
        for message in messages[1:]:
            self.assertEqual([b["type"] for b in message["content"]], ["text"])
            self.assertNotIn("cache_control", message["content"][0])
        self.assertEqual(messages[1]["content"][0]["text"], "first a")
        self.assertEqual(messages[2]["content"][0]["text"], "second q")
        self.assertEqual(messages[3]["content"][0]["text"], "second a")
        self.assertEqual(messages[4]["content"][0]["text"], "third q")

    def test_message_structure_without_history_or_context(self):
        corpus = [{"psi_id": "PSI-25", "title": "PSI-25 X", "body": "a"}]
        messages = self.ask.build_messages("only q", None, None, corpus)
        self.assertEqual(len(messages), 1)
        types = [b["type"] for b in messages[0]["content"]]
        self.assertEqual(types, ["document", "text"])
        self.assertEqual(messages[0]["content"][-1]["text"], "only q")

    def test_answer_question_passes_history_and_context(self):
        corpus = [{"psi_id": "PSI-25", "title": "PSI-25 X", "body": "a"}]
        response = SimpleNamespace(content=[text_block("ok")], stop_reason="end_turn", model="m")
        client = StubClient(response)
        history = [{"question": "q1", "answer": "a1"}]
        status, _ = self.ask.answer_question("q2", client=client, corpus=corpus, context_sentence="ctx sentence", history=history)
        self.assertEqual(status, 200)
        messages = client.beta.messages.calls[0]["messages"]
        self.assertEqual([m["role"] for m in messages], ["user", "assistant", "user"])
        self.assertEqual(messages[-1]["content"][0]["text"], "q2")
        self.assertIn({"type": "text", "text": "ctx sentence"}, messages[0]["content"])
        client2 = StubClient(response)
        self.ask.answer_question("q", client=client2, corpus=corpus)
        texts = [b["text"] for b in client2.beta.messages.calls[0]["messages"][0]["content"] if b["type"] == "text"]
        self.assertEqual(texts, ["q"])

    def test_http_context_and_history_validation(self):
        original = self.ask.answer_question
        seen = {}

        def fake(question, client=None, corpus=None, context_sentence=None, history=None):
            seen["context"] = context_sentence
            seen["history"] = history
            return 200, {"answer": "ok", "citations": [], "model": "m"}

        self.ask.answer_question = fake
        original_limiter = self.ask.RATE_LIMITER
        self.ask.RATE_LIMITER = self.ask.RateLimiter(limit=100, window=600)
        server = HTTPServer(("127.0.0.1", 0), self.ask.handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]

            def post(body):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("POST", "/api/ask", body=json.dumps(body), headers={"Content-Type": "application/json"})
                res = conn.getresponse()
                payload = json.loads(res.read().decode("utf-8"))
                conn.close()
                return res.status, payload

            self.assertEqual(post({"question": "q", "context": {"page": "investigation", "psi_id": "PSI-99999"}})[0], 400)
            self.assertEqual(post({"question": "q", "context": {"page": "rank", "habitat": "venus"}})[0], 400)
            self.assertEqual(post({"question": "q", "context": {"page": "nowhere"}})[0], 400)
            self.assertEqual(post({"question": "q", "history": [{"question": "a", "answer": "b"}] * 4})[0], 400)
            self.assertEqual(post({"question": "q", "history": "no"})[0], 400)
            self.assertEqual(post({"question": "q", "history": [{"question": "a" * 1001, "answer": "b"}]})[0], 400)
            seen.clear()
            self.assertEqual(post({"question": "q"})[0], 200)
            self.assertIsNone(seen["context"])
            self.assertEqual(seen["history"], [])
            status, _ = post({"question": "q", "context": {"page": "rank", "habitat": "mars"},
                              "history": [{"question": "a", "answer": "b" * 3000}]})
            self.assertEqual(status, 200)
            self.assertEqual(seen["context"], "The user is viewing the habitat ranking for mars.")
            self.assertEqual(len(seen["history"][0]["answer"]), 1500)
            big = {"question": "q", "history": [{"question": "a" * 1000, "answer": "b" * 3000}] * 3}
            self.assertEqual(post(big)[0], 200)
        finally:
            server.shutdown()
            server.server_close()
            self.ask.answer_question = original
            self.ask.RATE_LIMITER = original_limiter



if __name__ == "__main__":
    unittest.main()
