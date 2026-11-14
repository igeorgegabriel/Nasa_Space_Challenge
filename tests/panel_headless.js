"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const assert = require("assert");

const ROOT = path.join(__dirname, "..", "public");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = process.env.SHOTS_DIR || "";
const SITE_PORT = 8791;
const DEBUG_PORT = 9334;
const SITE = "http://127.0.0.1:" + SITE_PORT + "/index.html";
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webm": "video/webm", ".mp4": "video/mp4" };

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function serve() {
  const server = http.createServer(function (req, res) {
    if (req.method === "POST" && req.url.split("?")[0] === "/api/ask") {
      handleAsk(req, res);
      return;
    }
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/data/ask_cache.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(CACHE));
      return;
    }
    const file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) { server.listen(SITE_PORT, "127.0.0.1", function () { resolve(server); }); });
}

function getJson(url, method) {
  return new Promise(function (resolve, reject) {
    const req = http.request(url, { method: method || "GET" }, function (res) {
      let body = "";
      res.on("data", function (c) { body += c; });
      res.on("end", function () { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(body)); } });
    });
    req.on("error", reject);
    req.end();
  });
}

const CACHE = {
  "which solid materials were tested and at what oxygen": {
    answer: "Cached: PSI solid tests top out at 22.2 percent ambient O2 [1].",
    number_check: { total: 2, matched: 1, unmatched: ["41%"] },
    citations: [{ n: 1, psi_id: "PSI-25", title: "PSI-25 BASS-II", cited_text: "Rows in the BASS-II table record ambient O2 up to 0.222." }],
    model: "cache"
  },
  "how many solid fuel tests were run inside moon base oxygen levels": {
    answer: "None. No PSI solid-fuel row reaches Moon base oxygen [1].",
    citations: [{ n: 1, psi_id: "PSI-25", title: "PSI-25 BASS-II", cited_text: "Rows in the BASS-II table record ambient O2 up to 0.222." }],
    steps: [{ tool: "psi", label: "Counted solid rows in the Moon base window", detail: "0 rows" }],
    actions: [{ label: "Open the lunar ranking", href: "#/rank?habitat=lunar" }],
    followups: ["What is the nearest solid test?"],
    model: "cache"
  }
};

const mock = { asks: [], mode: "ok" };

const MOCK_ANSWER = {
  answer: ["BASS-II tested cotton-fiberglass fabric up to 0.222 ambient O2 [1].", "", "| Investigation | Highest ambient O2 |", "|---|---|", "| BASS-II | 0.222 [1] |", "| BASS | 0.209 [2] |", "", "No solid-fuel row exceeds this value."].join(String.fromCharCode(10)),
  citations: [
    { n: 1, psi_id: "PSI-25", title: "PSI-25 BASS-II", cited_text: "Rows in the BASS-II table record ambient O2 up to 0.222." },
    { n: 2, psi_id: "PSI-26", title: "PSI-26 BASS", cited_text: "BASS tested cotton-fiberglass fabric at ambient O2 between 0.17 and 0.21." }
  ],
  steps: [
    { tool: "rank", label: "Read the ranking table", detail: "24 investigations, lunar weights" },
    { tool: "psi", label: "Matched ambient O2 rows", detail: "BASS-II 0.222, BASS 0.209" }
  ],
  actions: [{ label: "Open the lunar ranking", href: "#/rank?habitat=lunar" }],
  followups: ["What did BASS find?", "Which rows exceed 0.21?"],
  number_check: { total: 3, matched: 3, unmatched: [] },
  model: "mock"
};

function handleAsk(req, res) {
  let raw = "";
  req.on("data", function (c) { raw += c; });
  req.on("end", function () {
    mock.asks.push(JSON.parse(raw));
    setTimeout(function () {
      if (mock.mode === "limit") {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Too many questions from your connection. Please wait a few minutes and ask again." }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(MOCK_ANSWER));
    }, 250);
  });
}

async function main() {
  const server = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "panel_headless_"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + profile,
    "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"
  ], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 40 && !target; i += 1) {
    await sleep(300);
    try { target = await getJson("http://127.0.0.1:" + DEBUG_PORT + "/json/new?about:blank", "PUT"); } catch (e) { target = null; }
  }
  assert.ok(target, "no chrome target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(function (r) { ws.addEventListener("open", r); });
  let id = 0;
  const pending = {};
  const errors = [];
  ws.addEventListener("message", function (ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; return; }
    if (msg.method === "Runtime.exceptionThrown") { errors.push("exception: " + JSON.stringify(msg.params.exceptionDetails.exception || msg.params.exceptionDetails.text).slice(0, 300)); }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") { errors.push("console.error: " + msg.params.args.map(function (a) { return a.value || a.description; }).join(" ").slice(0, 300)); }
  });
  function cdp(method, params) {
    return new Promise(function (resolve, reject) {
      id += 1;
      pending[id] = function (m) { return m.error ? reject(new Error(method + ": " + JSON.stringify(m.error))) : resolve(m.result); };
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }
  async function js(expr) {
    const r = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) { throw new Error("eval failed: " + expr + " -> " + JSON.stringify(r.exceptionDetails).slice(0, 300)); }
    return r.result ? r.result.value : undefined;
  }
  async function waitFor(expr, label) {
    for (let i = 0; i < 60; i += 1) {
      if (await js(expr)) { return; }
      await sleep(100);
    }
    throw new Error("timeout waiting for " + (label || expr));
  }
  async function viewport(w, h, mobile) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
  }
  async function shot(name) {
    if (!SHOTS) { return; }
    fs.mkdirSync(SHOTS, { recursive: true });
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.data, "base64"));
  }
  async function go(hash) {
    await js("location.hash = " + JSON.stringify(hash));
    await sleep(500);
  }

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await viewport(1366, 900, false);
  await cdp("Page.navigate", { url: SITE + "#/home" });
  await waitFor("document.querySelectorAll('#nav a').length > 0", "nav");
  await sleep(1200);

  const navLabels = JSON.parse(await js("JSON.stringify(Array.from(document.querySelectorAll('#nav a')).map(a => a.textContent))"));
  assert.deepStrictEqual(navLabels, ["Story", "Rank", "Investigations", "Data"]);
  assert.strictEqual(await js("document.getElementById('ask-open').hidden"), false);
  assert.strictEqual(await js("getComputedStyle(document.getElementById('ask-panel')).display"), "none");
  const mainBefore = await js("document.getElementById('view').getBoundingClientRect().width");

  await js("document.getElementById('ask-open').click()");
  await sleep(300);
  assert.ok(await js("document.body.classList.contains('ask-open')"));
  const geo = JSON.parse(await js("JSON.stringify({ panel: document.getElementById('ask-panel').getBoundingClientRect(), main: document.getElementById('view').getBoundingClientRect() })"));
  assert.ok(geo.panel.width >= 395 && geo.panel.width <= 405, "panel width " + geo.panel.width);
  assert.strictEqual(await js("getComputedStyle(document.getElementById('ask-panel')).position"), "fixed");
  assert.ok(geo.panel.right >= 1365, "drawer is not on the right edge");
  assert.strictEqual(await js("document.getElementById('ask-open').getAttribute('aria-expanded')"), "true");
  assert.strictEqual(await js("document.querySelectorAll('#ask-use-context').length"), 0);
  assert.strictEqual(await js("document.querySelectorAll('.ask-context-x').length"), 1);
  assert.strictEqual(await js("document.querySelectorAll('.ask-intro').length"), 1);
  assert.strictEqual(await js("document.querySelector('#ask-panel h2').textContent"), "Ask the data");
  assert.ok((await js("document.querySelector('.ask-disclosure').textContent")).indexOf("AI answers (Claude) from NASA PSI and NTRS data only.") === 0);
  assert.strictEqual(await js("document.querySelector('.ask-disclosure a').getAttribute('href')"), "#/verification");
  assert.strictEqual(await js("document.getElementById('ask-input').rows"), 1);
  await shot("home_panel_1366");

  const routes = [
    ["#/home", "Using this page: Home"],
    ["#/rank", "Using this page: Rank: Lunar surface habitat"],
    ["#/investigations", "Using this page: Investigations"],
    ["#/investigation/PSI-25", "Using this page: BASS-II (PSI-25)"],
    ["#/data", "Using this page: Data & Models"],
    ["#/verification", "Using this page: Data & Models"],
    ["#/compare?ids=PSI-25,PSI-69", "Using this page: Investigations"],
    ["#/earth", "Using this page: Investigations"]
  ];
  const suggestionSets = {};
  for (const [hash, expected] of routes) {
    await go(hash);
    assert.ok(await js("document.body.classList.contains('ask-open')"), "panel closed on " + hash);
    assert.strictEqual(await js("getComputedStyle(document.getElementById('ask-panel')).display"), "flex", hash);
    assert.strictEqual(await js("document.querySelector('.ask-context-label').textContent"), expected, hash);
    const sug = JSON.parse(await js("JSON.stringify(Array.from(document.querySelectorAll('#ask-suggest .ask-row-text')).map(b => b.textContent))"));
    assert.strictEqual(sug.length, 3, hash);
    suggestionSets[hash] = sug.join("|");
  }
  assert.notStrictEqual(suggestionSets["#/home"], suggestionSets["#/rank"]);
  assert.notStrictEqual(suggestionSets["#/rank"], suggestionSets["#/investigation/PSI-25"]);
  assert.notStrictEqual(suggestionSets["#/investigation/PSI-25"], suggestionSets["#/data"]);
  assert.notStrictEqual(suggestionSets["#/home"], suggestionSets["#/data"]);
  assert.ok(suggestionSets["#/investigation/PSI-25"].indexOf("What did BASS-II find?") === 0);

  await go("#/rank");
  await js("document.querySelector('.seg-btn[data-env=\"mars\"]').click()");
  await sleep(300);
  assert.strictEqual(await js("document.querySelector('.ask-context-label').textContent"), "Using this page: Rank: Mars surface habitat");
  await js("document.querySelector('.seg-btn[data-env=\"lunar\"]').click()");
  await sleep(300);

  await go("#/investigation/PSI-25");
  await js("document.querySelector('#ask-suggest .ask-suggest-row').click()");
  await waitFor("document.querySelectorAll('.ask-turn .ask-a').length === 1", "first answer");
  let asks = mock.asks;
  assert.deepStrictEqual(asks[0].context, { page: "investigation", psi_id: "PSI-25" });
  assert.strictEqual(asks[0].history, undefined);
  assert.strictEqual(await js("document.querySelectorAll('.ask-a .cite-link').length"), 3);
  assert.strictEqual(await js("document.querySelectorAll('.ask-cites li').length"), 2);
  assert.strictEqual(await js("document.querySelectorAll('.ask-a table').length"), 1);
  assert.strictEqual(await js("document.querySelectorAll('.ask-intro').length"), 0, "intro must hide once there are turns");
  assert.strictEqual(await js("document.querySelectorAll('.ask-more-title').length"), 1);
  assert.deepStrictEqual(JSON.parse(await js("JSON.stringify(Array.from(document.querySelectorAll('#ask-suggest .ask-row-text')).map(b => b.textContent))")), ["What did BASS find?", "Which rows exceed 0.21?"]);
  assert.strictEqual(await js("document.querySelectorAll('.ask-steps li').length"), 2);
  assert.strictEqual(await js("document.querySelector('.ask-steps summary').textContent"), "How I checked (2)");
  assert.strictEqual(await js("document.querySelector('.ask-numcheck').textContent"), "Numbers checked: 3 of 3 match the NASA data");
  assert.strictEqual(await js("document.querySelectorAll('.ask-numcheck.warn').length"), 0);
  assert.strictEqual(await js("document.querySelector('.ask-sources summary').textContent"), "Sources (2)");
  assert.strictEqual(await js("document.querySelector('.ask-sources').open"), false);
  assert.strictEqual(await js("document.querySelector('.ask-action').getAttribute('href')"), "#/rank?habitat=lunar");
  await js("document.querySelector('.ask-a .cite-link').click()");
  assert.strictEqual(await js("document.querySelector('.ask-sources').open"), true, "marker click must open sources");
  await js("document.querySelector('.ask-sources').open = false");
  await shot("investigation_panel_1366");

  await go("#/rank");
  assert.strictEqual(await js("document.querySelectorAll('.ask-turn').length"), 1, "thread lost on navigation");
  await js("document.getElementById('ask-input').value = 'Why is it ranked first?'");
  await js("document.getElementById('ask-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
  await waitFor("document.querySelectorAll('.ask-turn .ask-a').length === 2", "second answer");
  asks = mock.asks;
  assert.deepStrictEqual(asks[1].context, { page: "rank", habitat: "lunar" });
  assert.strictEqual(asks[1].history.length, 1);
  assert.strictEqual(asks[1].history[0].question, asks[0].question);
  await shot("rank_panel_1366");

  await js("document.querySelector('.ask-context-x').click()");
  assert.strictEqual(await js("document.querySelectorAll('.ask-context-on').length"), 1);
  await js("document.getElementById('ask-input').value = 'line one'");
  await js("document.getElementById('ask-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))");
  await sleep(300);
  assert.strictEqual(mock.asks.length, 2, "shift+enter must not send");
  await js("document.getElementById('ask-send').click()");
  await waitFor("document.querySelectorAll('.ask-turn .ask-a').length === 3", "third answer");
  asks = mock.asks;
  assert.strictEqual(asks[2].context, undefined);
  assert.strictEqual(asks[2].history.length, 2);
  await js("document.querySelector('.ask-context-on').click()");
  assert.strictEqual(await js("document.querySelectorAll('.ask-context-x').length"), 1);

  mock.mode = "limit";
  await js("document.getElementById('ask-input').value = 'too many'");
  await js("document.getElementById('ask-send').click()");
  await waitFor("document.querySelectorAll('.ask-error').length === 1", "inline error");
  assert.ok((await js("document.querySelector('.ask-error').textContent")).indexOf("Too many questions") === 0);
  mock.mode = "ok";
  await js("document.getElementById('ask-input').value = 'after error'");
  await js("document.getElementById('ask-send').click()");
  await waitFor("document.querySelectorAll('.ask-turn .ask-a').length === 4", "fourth answer");
  asks = mock.asks;
  assert.strictEqual(asks[asks.length - 1].history.length, 3);

  await go("#/home");
  await js("document.querySelector('.ask-sources').open = true; document.querySelector('.ask-cites a').click()");
  await sleep(500);
  assert.ok((await js("location.hash")).indexOf("#/investigation/PSI-") === 0, "citation did not navigate");
  assert.ok(await js("document.body.classList.contains('ask-open')"), "panel closed after citation click");
  assert.strictEqual(await js("document.querySelectorAll('.ask-turn').length"), 5);

  await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(300);
  assert.strictEqual(await js("document.body.classList.contains('ask-open')"), false, "Esc did not close");
  assert.strictEqual(await js("getComputedStyle(document.getElementById('ask-panel')).display"), "none");
  await go("#/data");
  assert.strictEqual(await js("document.body.classList.contains('ask-open')"), false, "closed state not kept across route");
  await js("document.getElementById('ask-open').click()");
  await sleep(300);
  assert.strictEqual(await js("document.querySelectorAll('.ask-turn').length"), 5, "thread lost after reopen");

  await cdp("Page.reload");
  await waitFor("document.querySelectorAll('#nav a').length > 0", "nav after reload");
  await sleep(1200);
  assert.ok(await js("document.body.classList.contains('ask-open')"), "open state not restored");
  assert.strictEqual(await js("document.querySelectorAll('.ask-turn').length"), 5, "thread not restored from sessionStorage");

  await js("document.getElementById('ask-open').click()");
  await sleep(200);
  await js("location.hash = '#/ask'");
  await sleep(700);
  assert.strictEqual(await js("location.hash"), "#/home");
  assert.ok(await js("document.body.classList.contains('ask-open')"), "#/ask did not open panel");
  assert.strictEqual(await js("document.querySelector('.ask-context-label').textContent"), "Using this page: Home");

  await js("Array.from(document.querySelectorAll('.ask-head button')).find(b => b.getAttribute('aria-label') === 'Close Ask panel').click()");
  await sleep(200);
  assert.strictEqual(await js("document.body.classList.contains('ask-open')"), false, "close button");
  await js("document.getElementById('ask-open').click()");
  await js("Array.from(document.querySelectorAll('#ask-panel button')).find(b => b.getAttribute('aria-label') === 'New conversation').click()");
  await sleep(200);
  assert.strictEqual(await js("document.querySelectorAll('.ask-turn').length"), 0, "new conversation did not clear");

  const asksBefore = mock.asks.length;
  await go("#/home");
  await js("document.querySelector('#ask-suggest .ask-suggest-row').click()");
  await waitFor("document.querySelectorAll('.ask-turn .ask-a').length === 1", "cached answer");
  assert.strictEqual(mock.asks.length, asksBefore, "cached chip must not call the API");
  assert.ok((await js("document.querySelector('.ask-a').textContent")).indexOf("Cached: PSI solid tests") === 0, "cached text");
  assert.strictEqual(await js("document.querySelector('.ask-numcheck.warn').textContent"), "1 of 2 numbers match; 1 not found in the sources: 41%");
  assert.strictEqual(await js("document.querySelector('.ask-steps summary').textContent"), "How I checked (1)");
  assert.strictEqual(await js("document.querySelector('.ask-step-warn .ask-step-detail').textContent"), "41%");
  await js("Array.from(document.querySelectorAll('#ask-panel button')).find(b => b.getAttribute('aria-label') === 'New conversation').click()");
  await sleep(200);

  await go("#/investigation/PSI-25");
  await js("document.querySelector('#ask-suggest .ask-suggest-row').click()");
  await waitFor("document.querySelectorAll('.ask-turn .ask-a').length === 1", "answer for mobile shot");
  await js("Array.from(document.querySelectorAll('.ask-head button')).find(b => b.getAttribute('aria-label') === 'Close Ask panel').click()");
  await sleep(200);

  await viewport(390, 844, true);
  await sleep(300);
  await js("document.getElementById('ask-open').click()");
  await sleep(300);
  const mob = JSON.parse(await js("JSON.stringify(document.getElementById('ask-panel').getBoundingClientRect())"));
  assert.ok(mob.width >= 389 && mob.height >= 843, "mobile panel is not full screen: " + JSON.stringify(mob));
  assert.strictEqual(await js("getComputedStyle(document.getElementById('ask-panel')).position"), "fixed");
  await shot("investigation_panel_390");
  await js("document.querySelector('.ask-sources').open = true; document.querySelector('.ask-cites a').click()");
  await sleep(400);
  assert.strictEqual(await js("document.body.classList.contains('ask-open')"), false, "mobile panel should close after citation navigation");
  await js("document.getElementById('ask-open').click()");
  await sleep(200);
  await js("Array.from(document.querySelectorAll('.ask-head button')).find(b => b.getAttribute('aria-label') === 'Close Ask panel').click()");
  await sleep(200);
  assert.strictEqual(await js("document.body.classList.contains('ask-open')"), false);

  await viewport(1366, 900, false);
  await go("#/home");
  await waitFor("document.querySelectorAll('.scenario .air-word').length === 1 && !!document.querySelector('.air-map .main-svg')", "air card");
  const airWord = async function () { return await js("document.querySelector('.air-word').textContent"); };
  const airCards = async function () { return await js("Array.from(document.querySelectorAll('.air-card')).map(function (x) { return x.textContent; }).join('|')"); };
  const airSet = async function (o2, p) {
    await js("(function () { var r = document.querySelectorAll('.air-range'); r[0].value = " + o2 + "; r[0].dispatchEvent(new Event('input')); r[1].value = " + p + "; r[1].dispatchEvent(new Event('input')); })()");
    await sleep(200);
  };
  assert.strictEqual(await js("document.querySelector('#s-next h2').textContent"), "Check any cabin air");
  assert.deepStrictEqual(JSON.parse(await js("JSON.stringify(Array.from(document.querySelectorAll('.scenario .pill.active')).map(function (b) { return b.getAttribute('data-key'); }))")), ["env-lunar", "fuel-solid", "g-moon"]);
  assert.strictEqual(await airWord(), "Not tested");
  assert.ok((await airCards()).indexOf("up to 2.3 O2 points") >= 0, "Moon gravity allowance");
  assert.ok((await airCards()).indexOf("Polycarbonate") >= 0);
  assert.strictEqual(await js("location.hash"), "#/home", "hash stays clean until the user touches the card");
  await airSet(22.2, 14.4);
  assert.strictEqual(await airWord(), "Tested");
  assert.ok((await js("document.querySelector('.air-sub').textContent")).indexOf("NASA solid-fuel tests within 0.5 O2 points and 0.5 psia") > 0);
  assert.ok((await js("location.hash")).indexOf("#/home?o2=22.2&p=14.4&fuel=solid&g=moon") === 0);
  assert.ok((await js("document.querySelector('.air-near a').getAttribute('href')")).indexOf("#/data?inv=PSI-") === 0);
  await js("document.querySelector('.scenario [data-key=\"env-iss\"]').click()");
  await js("document.querySelector('.scenario [data-key=\"fuel-liquid_droplet\"]').click()");
  await sleep(200);
  const issCard = await airCards();
  assert.ok(issCard.indexOf("Heptane droplet34%95% range 21-47%") >= 0, issCard);
  assert.ok(issCard.indexOf("no adjustment") >= 0);
  await js("document.querySelector('.scenario [data-key=\"env-lunar\"]').click()");
  await sleep(200);
  assert.ok((await airCards()).indexOf("0.14 atm below the lowest tested pressure") >= 0, "Moon droplet is refused");
  await js("document.querySelector('.scenario [data-key=\"env-mars\"]').click()");
  await sleep(200);
  assert.ok((await airCards()).indexOf("No NASA partial-g flammability data for Mars gravity in these sources.") >= 0);
  await js("document.querySelector('.scenario [data-key=\"env-lunar\"]').click()");
  await js("document.querySelector('.scenario [data-key=\"fuel-solid\"]').click()");
  await sleep(200);
  assert.strictEqual(await airWord(), "Not tested");
  const asksBeforeWhy = mock.asks.length;
  await js("document.querySelector('.air-ask').click()");
  await waitFor("document.body.classList.contains('ask-open')", "ask panel opens");
  assert.ok((await js("document.getElementById('ask-input').value")).indexOf("Has NASA tested solid fuel in air with ") === 0);
  await sleep(300);
  assert.strictEqual(mock.asks.length, asksBeforeWhy, "Ask about this air only prefills, never sends");
  await js("Array.from(document.querySelectorAll('#ask-panel button')).find(b => b.getAttribute('aria-label') === 'New conversation').click()");
  await sleep(200);
  await js("Array.from(document.querySelectorAll('.ask-head button')).find(b => b.getAttribute('aria-label') === 'Close Ask panel').click()");
  await sleep(200);
  assert.strictEqual(await js("document.body.classList.contains('ask-open')"), false);

  assert.strictEqual(await js("document.querySelectorAll('#tour').length"), 0);
  assert.strictEqual(await js("document.getElementById('tour-open').textContent"), "Tour");
  assert.strictEqual(await js("document.querySelector('.hero-play').textContent"), "Take the tour");
  await js("document.getElementById('tour-open').click()");
  assert.strictEqual(await js("document.querySelector('.tour-count').textContent"), "Step 1 of 5");
  assert.strictEqual(await js("document.querySelector('.tour-text').textContent"), "The story: what NASA has tested, and the gap a Moon base leaves. It plays by itself; scroll to take over.");
  await waitFor("document.querySelector('.tour-next').textContent === 'Skip'", "story playing");
  await waitFor("document.querySelector('.tour-next').textContent === 'Skip'", "story playing");
  assert.strictEqual(await js("document.querySelector('.tour-btn').disabled"), true);
  await waitFor("window.scrollY > 200", "story playback scrolls");
  assert.strictEqual(await js("document.querySelectorAll('.tour-ring').length"), 0);
  await shot("tour_1_1366");
  await js("document.querySelector('.tour-next').click()");
  assert.strictEqual(await js("document.querySelector('.tour-count').textContent"), "Step 2 of 5");
  await sleep(600);
  assert.strictEqual(await js("document.querySelectorAll('.scenario.tour-ring').length"), 1);
  await js("window.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }))");
  await js("document.querySelector('.tour-btn').click()");
  assert.strictEqual(await js("document.querySelector('.tour-count').textContent"), "Step 1 of 5");
  await waitFor("document.querySelector('.tour-next').textContent === 'Skip'", "story replays"); await sleep(400);
  await js("window.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }))");
  await sleep(200);
  assert.strictEqual(await js("document.querySelector('.tour-next').textContent"), "Next");
  assert.strictEqual(await js("document.querySelector('.tour-count').textContent"), "Step 1 of 5");
  await js("document.querySelector('.tour-next').click()");
  assert.strictEqual(await js("document.querySelector('.tour-count').textContent"), "Step 2 of 5");
  await sleep(600);
  await js("document.querySelector('.tour-next').click()");
  await waitFor("location.hash === '#/rank?habitat=lunar'", "rank hash");
  assert.strictEqual(await js("document.querySelector('.tour-count').textContent"), "Step 3 of 5");
  await sleep(600);
  assert.strictEqual(await js("document.querySelectorAll('.rank-cards.tour-ring').length"), 1);
  const asksBeforeTour = mock.asks.length;
  await js("document.querySelector('.tour-next').click()");
  await waitFor("document.querySelectorAll('.ask-turn .ask-a').length === 1", "tour answer");
  assert.ok(await js("document.body.classList.contains('ask-open')"));
  assert.strictEqual(mock.asks.length, asksBeforeTour, "tour answer must come from the cache");
  assert.ok((await js("document.querySelector('.ask-a').textContent")).indexOf("None. No PSI solid-fuel row") === 0);
  assert.strictEqual(await js("document.querySelector('.ask-steps').open"), true, "tour answer opens How I checked");
  assert.strictEqual(await js("document.querySelectorAll('.ask-action').length"), 1);
  assert.strictEqual(await js("document.querySelector('.ask-more-title').textContent"), "Follow up");
  assert.ok(await js("document.querySelectorAll('.ask-steps-list li').length") > 0);
  assert.strictEqual(await js("document.querySelectorAll('.ask-steps-list li .tick').length"), await js("document.querySelectorAll('.ask-steps-list li').length"), "each step has a tick");
  await sleep(1500);
  assert.strictEqual(await js("document.querySelectorAll('.ask-steps-list li.step-hide').length"), 0, "steps revealed");
  await shot("tour_4_1366");
  await js("document.querySelector('.tour-next').click()");
  await waitFor("location.hash === '#/equipment'", "equipment hash");
  assert.strictEqual(await js("document.body.classList.contains('ask-open')"), false, "tour closes the panel it opened");
  assert.strictEqual(await js("document.querySelector('.tour-count').textContent"), "Step 5 of 5");
  assert.strictEqual(await js("document.querySelector('.tour-next').textContent"), "Done");
  await sleep(600);
  await js("document.querySelector('.tour-next').click()");
  assert.strictEqual(await js("document.querySelectorAll('#tour').length"), 0, "Done closes the tour");
  assert.strictEqual(await js("document.body.classList.contains('tour-open')"), false);
  assert.strictEqual(await js("document.querySelectorAll('.tour-ring').length"), 0);

  await js("document.getElementById('tour-open').click()");
  assert.strictEqual(await js("document.querySelectorAll('#tour').length"), 1);
  await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.strictEqual(await js("document.querySelectorAll('#tour').length"), 0, "Esc closes the tour");

  await viewport(390, 844, true);
  await go("#/home");
  await sleep(300);
  assert.strictEqual(await js("document.documentElement.scrollWidth > window.innerWidth"), false, "home overflows at 390");
  assert.ok(await js("document.querySelector('.air-cards').getBoundingClientRect().right <= window.innerWidth"), "cards overflow at 390");
  await js("document.querySelector('.scenario [data-key=\"env-iss\"]').click()");
  await js("document.querySelector('.scenario [data-key=\"fuel-solid\"]').click()");
  assert.strictEqual(await js("document.documentElement.scrollWidth > window.innerWidth"), false, "scenario overflows at 390");
  await js("document.getElementById('tour-open').click()");
  for (let i = 1; i < 5; i += 1) {
    await sleep(600);
    await js("document.querySelector('.tour-next').click()");
  }
  await waitFor("document.querySelector('.tour-count').textContent === 'Step 5 of 5'", "mobile step 5");
  await js("document.querySelector('.tour-close').click()");
  assert.strictEqual(await js("document.querySelectorAll('#tour').length"), 0);

  assert.deepStrictEqual(errors, [], "page errors: " + JSON.stringify(errors));
  console.log("panel headless checks passed");
  ws.close();
  chrome.kill();
  server.close();
  process.exit(0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
