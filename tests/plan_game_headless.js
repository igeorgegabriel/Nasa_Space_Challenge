"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const assert = require("assert");

const root = path.join(__dirname, "..", "public");
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = Number(process.env.CDP_PORT || 9371);
const shots = process.env.SHOTS_DIR || "";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webm": "video/webm", ".mp4": "video/mp4" };
const plan = JSON.parse(fs.readFileSync(path.join(root, "data", "test_plan.json"), "utf8"));

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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

function covered(ids) {
  const gaps = {};
  plan.gaps.forEach(function (g) { gaps[g.fuel_class + "|" + g.habitat] = true; });
  const seen = {};
  plan.tests.forEach(function (t) {
    if (ids.indexOf(t.id) < 0) { return; }
    t.habitats.forEach(function (h) { if (gaps[t.fuel_class + "|" + h]) { seen[t.fuel_class + "|" + h] = true; } });
  });
  return Object.keys(seen).length;
}

function average(n) {
  const ids = plan.tests.map(function (t) { return t.id; });
  let sum = 0;
  let count = 0;
  const pick = [];
  (function walk(start) {
    if (pick.length === n) { sum += covered(pick); count += 1; return; }
    for (let i = start; i < ids.length; i += 1) { pick.push(ids[i]); walk(i + 1); pick.pop(); }
  })(0);
  return sum / count;
}

async function main() {
  const server = await serve();
  const site = "http://127.0.0.1:" + server.address().port + "/index.html";
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "plan_game_"));
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
  async function js(expr) {
    const r = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) { throw new Error("eval " + expr + " " + JSON.stringify(r.exceptionDetails).slice(0, 300)); }
    return r.result ? r.result.value : undefined;
  }
  async function shot(name, w, h) {
    if (!shots) { return; }
    fs.mkdirSync(shots, { recursive: true });
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await js("location.hash = '#/rank'");
    await sleep(500);
    await js("document.getElementById('test-plan').scrollIntoView()");
    await sleep(1600);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(shots, name + ".png"), Buffer.from(r.data, "base64"));
    await js("document.getElementById('plan-game').scrollIntoView()");
    await sleep(800);
    const r2 = await cdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(shots, name + "_game.png"), Buffer.from(r2.data, "base64"));
  }

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: site + "#/rank" });
  for (let i = 0; i < 60 && !(await js("!!document.getElementById('plan-game')")); i += 1) { await sleep(200); }
  assert(await js("!!document.getElementById('plan-game')"), "game block missing");

  const total = plan.gaps.length;
  const greedy3 = covered(["T01", "T02", "T03"]);
  assert.strictEqual(await js("planGameClosedCount(state.data.test_plan, planGameGreedy(state.data.test_plan, 3))"), greedy3);
  assert.strictEqual(await js("planGameClosedCount(state.data.test_plan, planGameGreedy(state.data.test_plan, " + plan.tests.length + "))"), total);

  const rows = [];
  for (let n = 1; n <= 4; n += 1) {
    const g = covered(plan.tests.slice(0, n).map(function (t) { return t.id; }));
    const a = average(n);
    const live = await js("JSON.stringify(planGameAverage(state.data.test_plan, " + n + "))");
    assert(Math.abs(JSON.parse(live).mean - a) < 1e-9, "average n=" + n);
    rows.push("N=" + n + ": planner " + g + ", average " + a.toFixed(1));
  }
  assert.strictEqual(JSON.parse(await js("JSON.stringify(planGameAverage(state.data.test_plan, 1))")).count, plan.tests.length);
  assert.strictEqual(JSON.parse(await js("JSON.stringify(planGameAverage(state.data.test_plan, 2))")).count, 36);

  assert.strictEqual(await js("document.getElementById('pg-count').textContent"), "3");
  assert.strictEqual(await js("document.querySelector('.pg-meter').textContent"), "0 of " + total + " habitat gaps closed");
  await js("document.querySelector('.pg-card[data-id=T01]').click()");
  assert.strictEqual(await js("document.querySelector('.pg-card[data-id=T01]').getAttribute('aria-pressed')"), "true");
  assert.strictEqual(await js("document.querySelector('.pg-meter').textContent"), covered(["T01"]) + " of " + total + " habitat gaps closed");
  await js("['T02','T03','T04'].forEach(function (i) { document.querySelector('.pg-card[data-id=' + i + ']').click(); })");
  assert.strictEqual(await js("planGame.picked.length"), 3, "budget cap");
  assert.strictEqual(await js("document.querySelector('.pg-card[data-id=T04]').getAttribute('aria-pressed')"), "false");
  assert.strictEqual(await js("document.querySelector('.pg-meter').textContent"), greedy3 + " of " + total + " habitat gaps closed");
  assert.strictEqual(await js("document.getElementById('pg-choose').click(), planGame.picked.join(',')"), "T01,T02,T03");
  await js("var r = document.getElementById('pg-budget'); r.value = '2'; r.dispatchEvent(new Event('input'))");
  assert.strictEqual(await js("planGame.picked.length"), 2, "budget shrink trims picks");
  assert.strictEqual(await js("document.getElementById('pg-count').textContent"), "2");
  assert.strictEqual(await js("document.querySelector('.pg-compare').textContent"),
    "Planner's first 2: " + covered(["T01", "T02"]) + " gaps; average of all possible 2 picks: " + average(2).toFixed(1) + " gaps");
  assert.strictEqual(await js("document.querySelector('.pg-gravity').textContent"), plan.tests[0].gravity.note);
  assert.strictEqual(await js("document.getElementById('pg-clear').click(), planGame.picked.length"), 0);
  assert.strictEqual(await js("document.querySelector('.pg-meter').getAttribute('aria-live')"), "polite");

  await js("document.getElementById('pg-choose').click()");
  await shot("plan_game_1440x900", 1440, 900);
  await shot("plan_game_390x844", 390, 844);
  await shot("plan_game_1074x1740", 1074, 1740);
  const overflow = await js("document.documentElement.scrollWidth > innerWidth");
  assert.strictEqual(overflow, false, "horizontal overflow at last viewport");
  assert.strictEqual(errors.length, 0, errors.join(";"));

  console.log(rows.join("\n"));
  console.log("plan game ok");
  ws.close();
  chrome.kill();
  server.close();
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
  process.exit(0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
