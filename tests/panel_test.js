"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.join(__dirname, "..", "public");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(root, "data", name + ".json"), "utf8"));
}

function makeStorage() {
  const map = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: function (k, v) { map[k] = String(v); },
    raw: map
  };
}

function makeSandbox(storage) {
  const sandbox = {
    document: {},
    window: { sessionStorage: storage },
    location: { hash: "" },
    console: console,
    fetch: function () { return new Promise(function () {}); },
    Node: function () {},
    setTimeout: setTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  vm.runInContext("state.data = " + JSON.stringify({
    investigations: readJson("investigations").investigations,
    environments: readJson("environments"),
    rank_reference: readJson("rank_reference")
  }) + "; state.weights = Object.assign({}, state.data.rank_reference.weights);", sandbox);
  return sandbox;
}

function run(sandbox, code) {
  return vm.runInContext(code, sandbox);
}

const storage = makeStorage();
const sb = makeSandbox(storage);

function suggestionsAt(hash, envId) {
  sb.location.hash = hash;
  return JSON.parse(run(sb, "JSON.stringify((function () { const c = contextFromRoute(parseHash(), " + JSON.stringify(envId || "lunar") + "); return { ctx: c, label: contextLabel(c), sug: suggestionsFor(c) }; })())"));
}

const home = suggestionsAt("#/home");
assert.deepStrictEqual(home.ctx, { page: "home" });
assert.strictEqual(home.label, "Home");
assert.strictEqual(home.sug.length, 3);

const legacyAsk = suggestionsAt("#/ask");
assert.deepStrictEqual(legacyAsk.ctx, { page: "home" });

const inv = suggestionsAt("#/investigation/PSI-25");
assert.deepStrictEqual(inv.ctx, { page: "investigation", psi_id: "PSI-25" });
assert.ok(/^BASS-II.*\(PSI-25\)$/.test(inv.label), inv.label);
assert.strictEqual(inv.sug.length, 3);
assert.ok(inv.sug[0].indexOf("What did BASS-II find?") === 0);
assert.ok(inv.sug[1].indexOf("What conditions did BASS-II test?") === 0);
assert.ok(inv.sug[2].indexOf("How is BASS-II relevant to a Moon base?") === 0);

const unknown = suggestionsAt("#/investigation/PSI-99999");
assert.deepStrictEqual(unknown.ctx, { page: "investigations" });

const rank = suggestionsAt("#/rank", "lunar");
assert.deepStrictEqual(rank.ctx, { page: "rank", habitat: "lunar" });
assert.strictEqual(rank.label, "Rank: Lunar surface habitat");
assert.ok(/^Why is .+ ranked first for Lunar surface habitat\?$/.test(rank.sug[0]), rank.sug[0]);
assert.strictEqual(rank.sug[1], "What should NASA test next for Lunar surface habitat?");
assert.strictEqual(rank.sug[2], "Which solid materials were tested for this habitat?");

const rankMars = suggestionsAt("#/rank", "mars");
assert.strictEqual(rankMars.ctx.habitat, "mars");
assert.ok(rankMars.sug[1].indexOf("Mars surface habitat") > 0);

const data = suggestionsAt("#/data");
assert.deepStrictEqual(data.ctx, { page: "data" });
assert.strictEqual(data.label, "Data & Models");

assert.deepStrictEqual(suggestionsAt("#/verification").ctx, { page: "data" });
assert.deepStrictEqual(suggestionsAt("#/compare?ids=PSI-25,PSI-69").ctx, { page: "investigations" });

const sets = [home.sug, inv.sug, rank.sug, data.sug].map(function (s) { return s.join("|"); });
assert.strictEqual(new Set(sets).size, 4);

const thread = [
  { question: "q1", answer: "a1 [1]", citations: [{ n: 1 }], error: null },
  { question: "q2", answer: null, error: "boom" },
  { question: "q3", answer: "a" .repeat(3000), citations: [], error: null },
  { question: "q4", answer: "a4", citations: [], error: null },
  { question: "q5", answer: "a5", citations: [], error: null },
  { question: "q6", pending: true }
];
sb.__thread = thread;
const body = JSON.parse(run(sb, "JSON.stringify(askRequestBody('now', { page: 'home' }, true, __thread))"));
assert.strictEqual(body.question, "now");
assert.deepStrictEqual(body.context, { page: "home" });
assert.strictEqual(body.history.length, 3);
assert.deepStrictEqual(body.history.map(function (t) { return t.question; }), ["q3", "q4", "q5"]);
assert.strictEqual(body.history[0].answer.length, 1500);

const noCtx = JSON.parse(run(sb, "JSON.stringify(askRequestBody('now', { page: 'home' }, false, []))"));
assert.deepStrictEqual(noCtx, { question: "now" });

run(sb, "askPanel.open = true; askPanel.useContext = false; askPanel.thread = [{ question: 'kept', answer: 'text [1]', citations: [{ n: 1, psi_id: 'PSI-25' }], steps: [{ tool: 't', label: 'Checked rows', detail: '24 of 24' }, { label: 5 }], actions: [{ label: 'Open rank', href: '#/rank?habitat=lunar' }, { label: 'Bad', href: 'http://x' }], followups: ['Next one?', 7, 'And this?', 'Third?'], error: null }, { question: 'wait', pending: true }]; saveAskState();");
const saved = JSON.parse(storage.raw["ask_panel_v1"]);
assert.strictEqual(saved.open, true);
assert.strictEqual(saved.useContext, false);
assert.strictEqual(saved.thread.length, 1);
assert.deepStrictEqual(saved.thread[0].steps, [{ tool: "t", label: "Checked rows", detail: "24 of 24" }]);
assert.deepStrictEqual(saved.thread[0].actions, [{ label: "Open rank", href: "#/rank?habitat=lunar" }]);
assert.deepStrictEqual(saved.thread[0].followups, ["Next one?", "And this?"]);

const sb2 = makeSandbox(storage);
run(sb2, "loadAskState()");
assert.strictEqual(run(sb2, "askPanel.open"), true);
assert.strictEqual(run(sb2, "askPanel.useContext"), false);
assert.strictEqual(run(sb2, "askPanel.thread.length"), 1);
assert.strictEqual(run(sb2, "askPanel.thread[0].question"), "kept");
assert.strictEqual(run(sb2, "askPanel.thread[0].steps[0].label"), "Checked rows");
assert.strictEqual(run(sb2, "askPanel.thread[0].actions[0].href"), "#/rank?habitat=lunar");
assert.strictEqual(run(sb2, "askPanel.thread[0].followups.length"), 2);

const legacy = makeStorage();
legacy.setItem("ask_panel_v1", JSON.stringify({ open: false, useContext: true, thread: [{ question: "old", answer: "a", citations: [], steps: "x", actions: { a: 1 }, followups: null, error: null }] }));
const sbLegacy = makeSandbox(legacy);
run(sbLegacy, "loadAskState()");
assert.strictEqual(run(sbLegacy, "askPanel.thread[0].steps.length"), 0);
assert.strictEqual(run(sbLegacy, "askPanel.thread[0].actions.length"), 0);
assert.strictEqual(run(sbLegacy, "askPanel.thread[0].followups.length"), 0);

const bad = makeStorage();
bad.setItem("ask_panel_v1", "{not json");
const sb3 = makeSandbox(bad);
run(sb3, "loadAskState()");
assert.strictEqual(run(sb3, "askPanel.thread.length"), 0);
assert.strictEqual(run(sb3, "askPanel.open"), false);

console.log("panel logic tests passed");
