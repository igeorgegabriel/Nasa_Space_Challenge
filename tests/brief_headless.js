"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("assert");

const root = path.join(__dirname, "..", "public");
const outDir = process.env.BRIEF_OUT || path.join(__dirname, "..", "brief_out");
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = Number(process.env.CDP_PORT || 9344);
const profile = path.join(outDir, "profile_" + Date.now());
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
fs.mkdirSync(outDir, { recursive: true });

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

async function main() {
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
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });

  const habitats = ["iss", "gateway", "lunar", "rover", "mars"];
  const results = [];
  for (const h of habitats) {
    errors.length = 0;
    await cdp("Page.navigate", { url: "about:blank" });
    await sleep(150);
    await cdp("Page.navigate", { url: site + "#/brief?habitat=" + h });
    await sleep(1500);
    const info = JSON.parse(await evalJs("JSON.stringify({h1: (document.querySelector('h1')||{}).textContent, rows: document.querySelectorAll('.brief tbody tr').length, print: !!document.getElementById('brief-print'), back: !!document.querySelector('.brief-back'), basis: (document.querySelector('.brief-basis')||{}).textContent})"));
    assert(/^Fire-safety test request: /.test(info.h1), h + " title");
    assert(info.rows >= 7 && info.print && info.back, h + " structure");
    assert(/24 investigations, 2,009 test rows\. Generated \d{4}-\d{2}-\d{2} from https:\/\/flame-in-freefall-three\.vercel\.app/.test(info.basis), h + " basis");
    assert.strictEqual(errors.length, 0, h + " console errors " + errors.join(";"));
    const pdf = await cdp("Page.printToPDF", { preferCSSPageSize: true, printBackground: false });
    const buf = Buffer.from(pdf.data, "base64");
    fs.writeFileSync(path.join(outDir, "brief_" + h + ".pdf"), buf);
    const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.strictEqual(pages, 1, h + " pdf pages " + pages);
    results.push(h + ": pdf pages " + pages + ", console errors 0");
    if (h === "lunar") {
      const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1100, height: 1300, scale: 1 } });
      fs.writeFileSync(path.join(outDir, "brief_lunar_screen.png"), Buffer.from(shot.data, "base64"));
    }
  }

  errors.length = 0;
  await cdp("Page.navigate", { url: site + "#/rank" });
  await sleep(1500);
  const link = await evalJs("(document.querySelector('#test-next a.btn')||{}).textContent + ' ' + (document.querySelector('#test-next a.btn')||{}).getAttribute('href')");
  assert(/^Printable test brief #\/brief\?habitat=/.test(link), "rank link " + link);
  results.push("rank link: " + link);
  assert.strictEqual(errors.length, 0, "rank errors");

  console.log(results.join("\n"));
  ws.close();
  chrome.kill();
  server.close();
  process.exit(0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
