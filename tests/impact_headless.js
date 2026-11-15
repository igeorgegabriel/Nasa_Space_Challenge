"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("assert");

const root = path.join(__dirname, "..", "public");
const outDir = process.env.IMPACT_OUT || path.join(__dirname, "..", "impact_out");
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = Number(process.env.CDP_PORT || 9381);
const profile = path.join(outDir, "profile_" + Date.now());
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
fs.mkdirSync(outDir, { recursive: true });

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function readJson(name) { return JSON.parse(fs.readFileSync(path.join(root, "data", name + ".json"), "utf8")); }

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

function serve() {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      const file = path.join(root, path.normalize(rel));
      if (file.indexOf(root) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

async function main() {
  const health = readJson("data_health");
  const plan = readJson("test_plan");
  const pg = readJson("partial_g");
  const conditions = readJson("conditions");
  const readiness = readJson("model_readiness");
  const outside = readJson("outside_psi");
  const solidRows = conditions.filter(function (r) { return r.fuel_class === "solid"; }).length;
  const solidItem = readiness.environments.lunar.items.find(function (i) { return i.id === "solid_flammability"; });
  const flights = outside.tests.filter(function (t) { return /^Saffire (IV|V|VI)$/.test(t.flight); });
  const burned = flights.filter(function (t) { return t.outcome_short === "Burned"; }).length;

  const server = await serve();
  const site = "http://127.0.0.1:" + server.address().port + "/index.html";
  const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=" + debugPort, "--user-data-dir=" + profile,
    "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 40 && !target; i += 1) {
    await sleep(300);
    try { target = await getJson("http://127.0.0.1:" + debugPort + "/json/new?about:blank", "PUT"); } catch (e) { target = null; }
  }
  assert(target, "no chrome target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(function (r) { ws.addEventListener("open", r); });
  let id = 0;
  const pending = {};
  const errors = [];
  ws.addEventListener("message", function (ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; return; }
    if (msg.method === "Runtime.exceptionThrown") { errors.push("exception " + JSON.stringify(msg.params.exceptionDetails).slice(0, 300)); }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") { errors.push("console.error"); }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") { errors.push("log " + msg.params.entry.text); }
  });
  function cdp(method, params) {
    return new Promise(function (resolve, reject) {
      id += 1;
      pending[id] = function (m) { if (m.error) { reject(new Error(method + JSON.stringify(m.error))); } else { resolve(m.result); } };
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }
  async function evalJs(expr) {
    const r = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : undefined;
  }
  async function shot(name, w, h, selector, mobile) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
    await sleep(600);
    const box = JSON.parse(await evalJs("(function(){var n=document.querySelector(" + JSON.stringify(selector) + ");n.scrollIntoView();var r=n.getBoundingClientRect();return JSON.stringify({y:Math.max(0,r.top+window.scrollY-(r.height<400?120:0)),w:window.innerWidth,h:r.height+(r.height<400?200:0)})})()"));
    await sleep(2500);
    const s = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: box.y, width: box.w, height: Math.min(box.h, 2400), scale: 1 } });
    fs.writeFileSync(path.join(outDir, name + ".png"), Buffer.from(s.data, "base64"));
  }
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await cdp("Page.navigate", { url: site + "#/home" });
  await sleep(2500);
  const info = JSON.parse(await evalJs("JSON.stringify({cards:[].map.call(document.querySelectorAll('#s-act .act-card'),function(c){return c.querySelector('p').textContent}),links:[].map.call(document.querySelectorAll('#s-act .act-card a'),function(a){return a.getAttribute('href')}),h2:(document.querySelector('#s-act h2')||{}).textContent,gap:(document.querySelector('#s-act .act-gap')||{}).textContent,quote:(document.querySelector('#s-act .act-next blockquote')||{}).textContent,before:document.querySelector('#s-act').nextElementSibling.id})"));
  assert.strictEqual(info.cards.length, 3, "three cards");
  assert.strictEqual(info.cards[0], health.summary.flagged_rows + " PSI rows flagged for review");
  assert.strictEqual(info.cards[1], plan.headline.text);
  assert(/cabin air/.test(info.cards[2]));
  assert.strictEqual(info.gap, pg.summary.headline);
  assert(info.quote.indexOf("late 2026") > 0, "fm2 quote");
  assert.strictEqual(info.before, "s-quote");
  assert.strictEqual(info.h2, "Who acts on this");
  await shot("act_1440", 1440, 900, "#s-act", false);
  await shot("act_390", 390, 844, "#s-act", true);
  await shot("act_1074", 1074, 1740, "#s-act", false);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const hashes = JSON.parse(await evalJs("JSON.stringify(TOUR_STEPS.map(function(s){return s.hash}))"));
  assert.strictEqual(hashes.length, 5, "tour steps");
  const landed = [];
  await evalJs("tourStart()");
  for (let s = 0; s < 5; s += 1) {
    await sleep(1500);
    if (s === 0) { await evalJs("tourStopPlay()"); }
    const now = JSON.parse(await evalJs("JSON.stringify({step:tour.step,hash:location.hash,count:document.querySelector('.tour-count').textContent,text:document.querySelector('.tour-text').textContent,ring:!!document.querySelector('.tour-ring'),ringId:(document.querySelector('.tour-ring')||{}).id||(document.querySelector('.tour-ring')||{}).className||''})"));
    assert.strictEqual(now.step, s);
    assert.strictEqual(now.hash, hashes[s], "step " + s + " hash " + now.hash);
    assert(s === 0 || now.ring, "step " + s + " ring");
    landed.push(now.count + " | " + now.hash + " | ring " + now.ringId + " | " + now.text);
    if (s < 4) { await evalJs("document.querySelector('.tour-next').click()"); }
  }
  await evalJs("document.querySelector('.tour-next').click()");
  await sleep(300);
  assert.strictEqual(await evalJs("!!document.getElementById('tour')"), false, "tour closed");

  await evalJs("closeAskPanel(false)");
  await cdp("Page.navigate", { url: site + "#/data" });
  await sleep(2500);
  const solid = JSON.parse(await evalJs("JSON.stringify({h:(document.querySelector('#solid-evidence h3')||{}).textContent,p:[].map.call(document.querySelectorAll('#solid-evidence p'),function(p){return p.textContent})})"));
  assert.strictEqual(solid.h, "Why there is no solid-fuel model");
  assert.strictEqual(solid.p[0], solidRows + " PSI solid-fuel rows, " + solidItem.rows_with_response + " with a recorded outcome or burn time. Saffire IV to VI add " + flights.length + " flights outside PSI, " + burned + " of them burned.");
  await evalJs("window.scrollTo(0, document.getElementById('solid-evidence').getBoundingClientRect().top + window.scrollY - 300)");
  await sleep(1500);
  const sc = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(outDir, "solid_card.png"), Buffer.from(sc.data, "base64"));

  await cdp("Page.navigate", { url: site + "#/data?at=health" });
  await sleep(1500);
  assert.strictEqual(await evalJs("document.getElementById('health').open"), true, "health drawer opens");
  await cdp("Page.navigate", { url: site + "#/rank?habitat=lunar&at=test-plan" });
  await sleep(1500);
  assert(await evalJs("!!document.getElementById('test-plan')"), "plan present");
  assert.strictEqual(errors.length, 0, "console errors " + errors.join(";"));

  console.log(JSON.stringify(info, null, 1));
  console.log(landed.join("\n"));
  console.log(JSON.stringify(solid));
  ws.close();
  chrome.kill();
  server.close();
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
  process.exit(0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
