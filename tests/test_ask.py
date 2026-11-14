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


def load_ask(env=None):
    saved = sys.modules.get("anthropic")
    saved_env = {k: os.environ.pop(k, None) for k in ("ASK_MODEL", "ASK_EFFORT")}
    os.environ.update(env or {})
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
        for k, v in saved_env.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
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
        self.assertEqual(self.ask.MODEL, "claude-sonnet-5-5")
        self.assertEqual(self.ask.EFFORT, "low")

    def test_outside_psi_document_citation_maps_and_context_validates(self):
        corpus = self.ask.CORPUS
        index = next(i for i, d in enumerate(corpus) if d["psi_id"] == "NTRS-SAFFIRE-IV-VI")
        self.assertEqual(corpus[index]["psi_id"], "NTRS-SAFFIRE-IV-VI")
        dash = next(i for i, d in enumerate(corpus) if d["psi_id"] == "DASHBOARD-RESULTS")
        self.assertEqual(self.ask.psi_id_for(dash, corpus), "DASHBOARD-RESULTS")
        sentence, error = self.ask.validate_context({"context": {"page": "investigation", "psi_id": "DASHBOARD-RESULTS"}}, corpus)
        self.assertIsNone(error)
        self.assertEqual(self.ask.psi_id_for(index, corpus), "NTRS-SAFFIRE-IV-VI")
        self.assertEqual(self.ask.psi_id_for(0, corpus), corpus[0]["psi_id"])
        response = SimpleNamespace(content=[text_block("Saffire VI-2 burned at 31.0 percent O2.", [citation(index, "Saffire VI-2 (NTRS 20250002675)", corpus[index]["title"])])],
                                   stop_reason="end_turn", model="m")
        answer, citations = self.ask.parse_response(response, corpus)
        self.assertEqual(citations[0]["psi_id"], "NTRS-SAFFIRE-IV-VI")
        self.assertEqual(citations[0]["title"], corpus[index]["title"])
        sentence, error = self.ask.validate_context({"context": {"page": "investigation", "psi_id": corpus[0]["psi_id"]}}, corpus)
        self.assertIsNone(error)
        sentence, error = self.ask.validate_context({"context": {"page": "home"}}, corpus)
        self.assertIsNone(error)
        sentence, error = self.ask.validate_context({"context": {"page": "investigation", "psi_id": "PSI-9999"}}, corpus)
        self.assertIsNotNone(error)

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
            self.assertEqual(block["source"]["type"], "content")
            self.assertTrue(all(item["type"] == "text" and item["text"] for item in block["source"]["content"]))
            self.assertEqual(block["citations"], {"enabled": True})
        for block in docs[:-1]:
            self.assertNotIn("cache_control", block)
        self.assertEqual(docs[-1]["cache_control"], {"type": "ephemeral"})
        self.assertEqual(content[-1], {"type": "text", "text": "What is PSI-25?"})

    def test_cite_blocks_are_short_and_lossless(self):
        long_line = "Publications: " + "; ".join("Paper number %d about flames" % i for i in range(60))
        body = "Short line one.\n" + long_line + "\nSecond. Third sentence here."
        blocks = self.ask.cite_blocks(body)
        self.assertTrue(all(0 < len(b) <= self.ask.MAX_CITE_BLOCK_CHARS for b in blocks))
        self.assertEqual(" ".join(blocks).split(), body.split())
        for doc in self.ask.CORPUS:
            for block in self.ask.cite_blocks(doc["body"]):
                self.assertLessEqual(len(block), self.ask.MAX_CITE_BLOCK_CHARS + 120)

    def test_request_shape_has_no_sampling_params(self):
        response = SimpleNamespace(content=[text_block("ok")], stop_reason="end_turn", model="claude-opus-5-5")
        client = StubClient(response)
        status, body = self.ask.answer_question("q", client=client)
        self.assertEqual(status, 200)
        call = client.beta.messages.calls[0]
        self.assertEqual(call["model"], "claude-sonnet-5-5")
        self.assertEqual(call["max_tokens"], 4000)
        self.assertEqual(call["betas"], ["server-side-fallback-2026-07-01"])
        self.assertEqual(call["fallbacks"], "default")
        self.assertEqual(call["output_config"], {"effort": "low"})
        self.assertIsInstance(call["system"], str)
        for forbidden in ("temperature", "top_p", "top_k", "thinking"):
            self.assertNotIn(forbidden, call)
        messages = call["messages"]
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "user")

    def test_env_overrides_model_and_effort(self):
        module, _ = load_ask({"ASK_MODEL": "claude-opus-5-5", "ASK_EFFORT": "medium"})
        self.assertEqual(module.MODEL, "claude-opus-5-5")
        self.assertEqual(module.EFFORT, "medium")
        response = SimpleNamespace(content=[text_block("ok")], stop_reason="end_turn", model="claude-opus-5-5")
        client = StubClient(response)
        module.answer_question("q", client=client, use_cache=False)
        call = client.beta.messages.calls[0]
        self.assertEqual(call["model"], "claude-opus-5-5")
        self.assertEqual(call["output_config"], {"effort": "medium"})

    def test_haiku_has_no_fallback_params(self):
        options = self.ask.request_options("claude-haiku-5-5", "low")
        self.assertNotIn("betas", options)
        self.assertNotIn("fallbacks", options)
        self.assertEqual(options["output_config"], {"effort": "low"})

    def test_system_has_brevity_and_keeps_rules(self):
        self.assertIn("120 words", self.ask.SYSTEM)
        self.assertTrue(self.ask.SYSTEM.startswith(self.ask.SYSTEM_LEGACY))

    def test_normalize_question(self):
        n = self.ask.normalize_question
        self.assertEqual(n("  What did BASS-II find?? "), "what did bass ii find")
        self.assertEqual(n("What did BASS-II find"), n("what did bass ii find?"))

    def test_cache_hit_skips_client(self):
        cache = {"what did bass ii find": {"question": "What did BASS-II find?", "answer": "A [1]", "citations": [{"n": 1}], "model": "m"}}
        original = self.ask.ASK_CACHE
        self.ask.ASK_CACHE = cache
        try:
            client = StubClient(SimpleNamespace(content=[], stop_reason="end_turn", model="m"))
            status, body = self.ask.answer_question("what did BASS-II find?!", client=client)
            self.assertEqual(status, 200)
            self.assertTrue(body["cached"])
            self.assertEqual(body["answer"], "A [1]")
            self.assertEqual(body["citations"], [{"n": 1}])
            self.assertEqual(client.beta.messages.calls, [])
            status, body = self.ask.answer_question("What did BASS-II find?", client=client, history=[{"question": "x", "answer": "y"}])
            self.assertNotIn("cached", body)
            self.assertEqual(len(client.beta.messages.calls), 1)
            status, body = self.ask.answer_question("What did BASS-II find?", client=client, use_cache=False)
            self.assertNotIn("cached", body)
        finally:
            self.ask.ASK_CACHE = original

    def test_cache_miss_calls_client(self):
        original = self.ask.ASK_CACHE
        self.ask.ASK_CACHE = {"other": {"answer": "x", "citations": []}}
        try:
            response = SimpleNamespace(content=[text_block("Live.", [citation(0, "t")])], stop_reason="end_turn", model="m")
            client = StubClient(response)
            status, body = self.ask.answer_question("an uncached question", client=client)
            self.assertEqual(status, 200)
            self.assertNotIn("cached", body)
            self.assertEqual(len(client.beta.messages.calls), 1)
        finally:
            self.ask.ASK_CACHE = original

    def test_shipped_cache_file_is_valid(self):
        for key, entry in self.ask.load_ask_cache().items():
            self.assertEqual(key, self.ask.normalize_question(entry["question"]))
            self.assertTrue(entry["answer"])
            self.assertIsInstance(entry["citations"], list)

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
            content=[text_block("Yes.", [citation(0, "text")])], stop_reason="end_turn", model="claude-sonnet-5-5")
        status, body = self.ask.answer_question("q", client=StubClient(response), corpus=corpus)
        self.assertEqual(status, 200)
        self.assertEqual(body["answer"], "Yes. [1]")
        self.assertEqual(body["citations"][0]["psi_id"], "PSI-25")
        self.assertEqual(body["model"], "claude-sonnet-5-5")
        self.assertEqual(set(body), {"answer", "citations", "model", "steps", "actions", "followups"})

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

        def fake(question, client=None, corpus=None, context_sentence=None, history=None, **kwargs):
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



class SequenceMessages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(dict(kwargs, messages=list(kwargs["messages"])))
        return self.responses.pop(0)


class SequenceClient:
    def __init__(self, responses):
        self.beta = SimpleNamespace(messages=SequenceMessages(responses))


def tool_use(tool_id, name, tool_input):
    return SimpleNamespace(type="tool_use", id=tool_id, name=name, input=tool_input)


def load_json_file(name):
    with open(os.path.join(ROOT, "public", "data", name), "r", encoding="utf-8") as handle:
        return json.load(handle)


class AskToolsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ask, cls.fake = load_ask()
        cls.tools = cls.ask.DATA_TOOLS

    def test_rank_matches_site_reference(self):
        result = self.tools.rank_investigations("lunar", 3)
        reference = load_json_file("rank_reference.json")["variants"]["default"]["lunar"]["ranking"]
        self.assertEqual(len(result["ranking"]), 3)
        self.assertEqual(result["ranking"][0]["psi_id"], reference[0]["psi_id"])
        self.assertEqual(result["ranking"][0]["rank"], 1)
        self.assertEqual(result["ranking"][0]["score"], round(reference[0]["score"], 2))
        self.assertEqual(result["total_ranked"], len(reference))
        self.assertLess(len(json.dumps(result)), 4096)

    def test_find_tests_filters(self):
        none = self.tools.find_tests(fuel_class="solid", o2_min_pct=33.5)
        self.assertEqual(none["matched"], 0)
        self.assertEqual(none["rows_searched"], 2009)
        hit = self.tools.find_tests(fuel_class="solid", o2_min_pct=22.2, o2_max_pct=22.2)
        self.assertGreaterEqual(hit["matched"], 1)
        self.assertEqual(hit["o2_max_pct"], 22.2)
        self.assertEqual(hit["o2_min_pct"], 22.2)
        self.assertTrue(hit["examples"])
        self.assertIn("source_file", hit["examples"][0])
        self.assertLess(len(json.dumps(hit)), 4096)

    def test_find_tests_missing_values_do_not_match(self):
        everything = self.tools.find_tests()
        self.assertEqual(everything["matched"], 2009)
        rows = load_json_file("conditions.json")
        ambient = self.tools.find_tests(o2_min_pct=0)
        stream = self.tools.find_tests(o2_min_pct=0, o2_basis="oxidizer_stream")
        self.assertEqual(ambient["matched"], sum(1 for r in rows if r.get("o2_frac") is not None and r["o2_basis"] == "ambient"))
        self.assertEqual(stream["matched"], sum(1 for r in rows if r.get("o2_frac") is not None and r["o2_basis"] == "oxidizer_stream"))
        with_pressure = self.tools.find_tests(pressure_min_psia=0)
        self.assertEqual(with_pressure["matched"], sum(1 for r in rows if r.get("pressure_atm") is not None))

    def test_find_tests_psia_conversion(self):
        rows = load_json_file("conditions.json")
        target = next(r for r in rows if r.get("pressure_atm"))
        psia = target["pressure_atm"] * 14.696
        result = self.tools.find_tests(pressure_min_psia=psia, pressure_max_psia=psia)
        self.assertGreaterEqual(result["matched"], 1)

    def test_find_tests_validation(self):
        self.assertIn("error", self.tools.find_tests(fuel_class="plasma"))
        self.assertIn("error", self.tools.find_tests(psi_id="PSI-99999"))
        self.assertIn("error", self.tools.find_tests(o2_min_pct="high"))
        self.assertIn("error", self.tools.find_tests(o2_basis="x"))

    def test_test_next(self):
        result = self.tools.test_next("lunar")
        reference = load_json_file("test_next.json")["environments"]["lunar"]
        self.assertEqual(len(result["fuel_classes"]), len(reference["classes"]))
        solid = next(c for c in result["fuel_classes"] if c["fuel_class"] == "solid")
        self.assertEqual(solid["tests_inside_window"], 0)
        self.assertTrue(solid["nearest_tested"]["psi_id"].startswith("PSI-"))
        self.assertTrue(solid["nearest_tested"]["source_file"])
        self.assertEqual(result["window"]["o2_pct"], [33.5, 35.0])
        self.assertLess(len(json.dumps(result)), 4096)

    def test_model_readiness(self):
        result = self.tools.model_readiness("lunar")
        reference = load_json_file("model_readiness.json")["environments"]["lunar"]["items"]
        self.assertEqual(len(result["relationships"]), len(reference))
        self.assertEqual(result["relationships"][0]["status"], reference[0]["status"])
        self.assertTrue(result["relationships"][0]["relationship"])
        self.assertLess(len(json.dumps(result)), 4096)

    def test_habitat_profile(self):
        result = self.tools.habitat_profile("lunar")
        self.assertIn("8.2 psia", result["pressure"]["value"])
        self.assertTrue(result["o2"]["sources"])
        self.assertLess(len(json.dumps(result)), 4096)
        for habitat in self.tools.HABITATS:
            profile = self.tools.habitat_profile(habitat)
            for key in ("o2", "pressure", "flow", "gravity"):
                self.assertTrue(profile[key]["value"])

    def test_invalid_habitat_is_error_not_crash(self):
        for name in ("rank_investigations", "test_next", "model_readiness", "habitat_profile"):
            self.assertIn("error", self.tools.run_tool(name, {"habitat": "venus"}))
        self.assertIn("error", self.tools.run_tool("rank_investigations", {}))
        self.assertIn("error", self.tools.run_tool("nope", {}))
        self.assertIn("error", self.tools.run_tool("find_tests", "x"))

    def test_tool_definitions(self):
        definitions = self.tools.tool_definitions()
        self.assertEqual({d["name"] for d in definitions}, set(self.tools.TOOL_FUNCTIONS))
        find = next(d for d in definitions if d["name"] == "find_tests")
        enum = find["input_schema"]["properties"]["fuel_class"]["enum"]
        self.assertIn("solid", enum)
        self.assertIn("liquid_droplet", enum)
        nxt = next(d for d in definitions if d["name"] == "test_next")
        self.assertEqual(nxt["input_schema"]["properties"]["habitat"]["enum"], list(self.tools.HABITATS))

    def test_split_followups(self):
        split = self.ask.split_followups
        text, follow = split("Answer here. [1]\nFOLLOWUPS: What is next? | Where else? [2]")
        self.assertEqual(text, "Answer here. [1] [2]")
        self.assertEqual(follow, ["What is next?", "Where else?"])
        text, follow = split("Answer.\n**FOLLOWUPS:** one | two | three")
        self.assertEqual(text, "Answer.")
        self.assertEqual(follow, ["one", "two"])
        text, follow = split("Answer.\nFOLLOWUPS:")
        self.assertEqual(text, "Answer.")
        self.assertEqual(follow, [])
        text, follow = split("Answer only.")
        self.assertEqual(text, "Answer only.")
        self.assertEqual(follow, [])

    def test_steps_and_actions(self):
        log = [
            ("rank_investigations", {"habitat": "lunar"}, self.tools.rank_investigations("lunar")),
            ("find_tests", {"fuel_class": "solid", "o2_min_pct": 33.5, "o2_max_pct": 35}, self.tools.find_tests(fuel_class="solid", o2_min_pct=33.5, o2_max_pct=35)),
            ("test_next", {"habitat": "lunar"}, self.tools.test_next("lunar")),
            ("model_readiness", {"habitat": "lunar"}, self.tools.model_readiness("lunar")),
            ("habitat_profile", {"habitat": "venus"}, {"error": "x"}),
        ]
        steps, actions = self.tools.build_steps_and_actions(log)
        self.assertEqual([s["tool"] for s in steps], ["rank_investigations", "find_tests", "test_next", "model_readiness"])
        self.assertTrue(steps[0]["label"].startswith("Ranked "))
        self.assertTrue(steps[0]["label"].endswith("for Moon base"))
        self.assertEqual(steps[1]["label"], "Searched 2,009 test rows")
        self.assertEqual(steps[1]["detail"], "solid, ambient O2 33.5 to 35%: 0 matches")
        self.assertEqual(actions, [
            {"label": "Open the Moon base ranking", "href": "#/rank?habitat=lunar"},
            {"label": "Open the data extractor", "href": "#/data?at=extractor"},
        ])

    def test_actions_psi_and_context(self):
        result = self.tools.find_tests(psi_id="PSI-69")
        _, actions = self.tools.build_steps_and_actions([("find_tests", {"psi_id": "PSI-69"}, result)])
        self.assertEqual(actions[0]["href"], "#/data?inv=PSI-69&at=extractor")
        self.assertEqual(actions[0]["label"], "Open FLEX rows")
        _, actions = self.tools.build_steps_and_actions([], "PSI-69", {"PSI-69"})
        self.assertEqual(actions, [{"label": "Open FLEX", "href": "#/investigation/PSI-69"}])
        _, actions = self.tools.build_steps_and_actions([], "PSI-69", {"PSI-25"})
        self.assertEqual(actions, [])

    def test_agent_loop_runs_tools_then_answers(self):
        first = SimpleNamespace(
            content=[text_block("thinking"), tool_use("t1", "rank_investigations", {"habitat": "lunar", "top_n": 2}), tool_use("t2", "habitat_profile", {"habitat": "venus"})],
            stop_reason="tool_use", model="m")
        final = SimpleNamespace(
            content=[text_block("FLEX leads.\nFOLLOWUPS: What next? | Why FLEX?", [citation(0, "t")])],
            stop_reason="end_turn", model="m")
        client = SequenceClient([first, final])
        corpus = [{"psi_id": "PSI-69", "title": "PSI-69 FLEX - Droplets", "body": "a"}]
        status, body = self.ask.answer_question("q", client=client, corpus=corpus, context_psi_id="PSI-69", use_cache=False)
        self.assertEqual(status, 200)
        calls = client.beta.messages.calls
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0]["tools"])
        self.assertNotIn("tool_choice", calls[0])
        self.assertEqual(calls[0]["messages"][0]["content"][0]["type"], "document")
        follow = calls[1]["messages"]
        self.assertEqual(follow[-2]["role"], "assistant")
        results = follow[-1]["content"]
        self.assertEqual([r["tool_use_id"] for r in results], ["t1", "t2"])
        self.assertNotIn("is_error", results[0])
        self.assertTrue(results[1]["is_error"])
        self.assertEqual(body["answer"], "FLEX leads. [1]")
        self.assertEqual(body["followups"], ["What next?", "Why FLEX?"])
        self.assertEqual([s["tool"] for s in body["steps"]], ["rank_investigations"])
        self.assertEqual([a["href"] for a in body["actions"]], ["#/rank?habitat=lunar", "#/investigation/PSI-69"])

    def test_agent_loop_caps_rounds(self):
        def looping():
            return SimpleNamespace(content=[tool_use("t", "habitat_profile", {"habitat": "mars"})], stop_reason="tool_use", model="m")
        final = SimpleNamespace(content=[text_block("Done.")], stop_reason="end_turn", model="m")
        client = SequenceClient([looping() for _ in range(self.ask.MAX_TOOL_ROUNDS)] + [final])
        status, body = self.ask.answer_question("q", client=client, use_cache=False)
        calls = client.beta.messages.calls
        self.assertEqual(len(calls), self.ask.MAX_TOOL_ROUNDS + 1)
        self.assertEqual(calls[-1]["tool_choice"], {"type": "none"})
        self.assertEqual(body["answer"], "Done.")
        self.assertEqual(len(body["steps"]), self.ask.MAX_TOOL_ROUNDS)
        self.assertEqual(len(body["actions"]), 1)

    def test_agent_loop_time_budget_forces_final(self):
        final = SimpleNamespace(content=[text_block("Late.")], stop_reason="end_turn", model="m")
        client = SequenceClient([final])
        original = self.ask.TOOL_TIME_BUDGET_SECONDS
        self.ask.TOOL_TIME_BUDGET_SECONDS = -1
        try:
            status, body = self.ask.answer_question("q", client=client, use_cache=False)
        finally:
            self.ask.TOOL_TIME_BUDGET_SECONDS = original
        self.assertEqual(client.beta.messages.calls[0]["tool_choice"], {"type": "none"})
        self.assertEqual(body["answer"], "Late.")

    def test_cached_answer_has_empty_agent_fields(self):
        cache = {"hello": {"question": "hello", "answer": "A", "citations": []}}
        hit = self.ask.cached_answer("Hello?", cache=cache)
        self.assertEqual((hit["steps"], hit["actions"], hit["followups"]), ([], [], []))

    def test_system_mentions_tools_and_followups(self):
        self.assertIn("FOLLOWUPS:", self.ask.SYSTEM)
        self.assertIn("data tools", self.ask.SYSTEM)
        self.assertIn("Not in the data.", self.ask.SYSTEM)


if __name__ == "__main__":
    unittest.main()
