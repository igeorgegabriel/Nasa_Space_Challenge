"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const sandbox = {
  document: {},
  window: {},
  location: { hash: "" },
  console: console,
  fetch: function () { return new Promise(function () {}); },
  Node: function () {},
  setTimeout: setTimeout
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const render = sandbox.renderMarkdown;
const cites = { "1": { n: 1, psi_id: "PSI-25" }, "2": { n: 2, psi_id: "PSI-69" } };

assert.strictEqual(typeof render, "function");

assert.strictEqual(render("Hello world", cites), "<p>Hello world</p>");
assert.strictEqual(render("one\ntwo\n\nthree", cites), "<p>one two</p><p>three</p>");
assert.strictEqual(render("", cites), "");

assert.strictEqual(render("a **bold** word", cites), "<p>a <strong>bold</strong> word</p>");

const escaped = render("<script>alert(1)</script> & \"q\" 'x' **<b>y</b>**", cites);
assert.ok(escaped.indexOf("<script>") < 0);
assert.ok(escaped.indexOf("<b>") < 0);
assert.ok(escaped.indexOf("&lt;script&gt;") >= 0);
assert.ok(escaped.indexOf("<strong>&lt;b&gt;y&lt;/b&gt;</strong>") >= 0);
assert.ok(escaped.indexOf("&amp;") >= 0);

const img = render("![x](javascript:alert(1)) <img src=x onerror=alert(1)>", cites);
assert.ok(img.indexOf("<img") < 0);
assert.ok(img.indexOf("<a ") < 0);

assert.strictEqual(render("- first\n- second **b**\n* third", cites),
  "<ul><li>first</li><li>second <strong>b</strong></li><li>third</li></ul>");
assert.strictEqual(render("1. one\n2. two\n3) three", cites), "<ol><li>one</li><li>two</li><li>three</li></ol>");
assert.strictEqual(render("Intro line\n- item", cites), "<p>Intro line</p><ul><li>item</li></ul>");

const table = render("| Name | O2 |\n|---|---|\n| BASS-II | 0.222 [1] |\n| FLEX | 0.34 |", cites);
assert.ok(table.indexOf("<table><thead><tr><th>Name</th><th>O2</th></tr></thead><tbody>") === 0);
assert.ok(table.indexOf("<td>BASS-II</td><td>0.222 <a class=\"cite-link\" href=\"#\" data-cite=\"1\">[1]</a></td>") > 0);
assert.ok(table.indexOf("<td>FLEX</td><td>0.34</td>") > 0);

const withCite = render("Tested up to 0.222 [1]. Also FLEX [2] and unknown [9].", cites);
assert.ok(withCite.indexOf("<a class=\"cite-link\" href=\"#\" data-cite=\"1\">[1]</a>") > 0);
assert.ok(withCite.indexOf("<a class=\"cite-link\" href=\"#\" data-cite=\"2\">[2]</a>") > 0);
assert.ok(withCite.indexOf("[9]") > 0 && withCite.indexOf("data-cite=\"9\"") < 0);

const evil = render("[1\"><script>] [1]", { "1": { n: 1 } });
assert.ok(evil.indexOf("<script>") < 0);

const heading = render("## Result\ntext", cites);
assert.strictEqual(heading, "<h4>Result</h4><p>text</p>");

const mixed = render("Summary:\n\n1. **A** [1]\n2. B\n\n| x | y |\n|:--|--:|\n| 1 | 2 |\n\nDone.", cites);
assert.ok(mixed.indexOf("<ol>") >= 0 && mixed.indexOf("<table>") >= 0 && mixed.lastIndexOf("<p>Done.</p>") > 0);

assert.strictEqual(render("a | b without separator", cites), "<p>a | b without separator</p>");

console.log("markdown renderer tests passed");
