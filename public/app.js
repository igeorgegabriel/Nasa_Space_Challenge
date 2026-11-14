"use strict";

const REPO_URL = "https://github.com/igeorgegabriel/Nasa_Space_Challenge";

const NAV = [
  ["overview", "Overview"],
  ["investigations", "Investigations"],
  ["habitat", "Habitat Relevance"],
  ["insights", "Insights"],
  ["extractor", "Data Extractor"],
  ["functions", "Prevention / Detection / Suppression"],
  ["compare", "Compare"],
  ["earth", "On Earth"],
  ["ask", "Ask"]
];

const OBJECTIVES = {
  investigations: "summarizes ... combustion science investigations",
  habitat: "Identify investigations most relevant to the fire safety needs of habitable crew environments, including spacecraft, space stations, bases on the lunar and Martian surfaces, and pressurized rovers.",
  insights: "ranks, and interprets ... to deliver critical foundational insights for fire safety",
  extractor: "Extract data that supports predictive modeling of flammability and fire scenarios in space exploration.",
  readiness: "Extract data that supports predictive modeling of flammability and fire scenarios in space exploration.",
  functions: "Highlight research that informs the development of next-generation fire safety controls and equipment.",
  compare: "Consider how to summarize and display similarities and differences between different investigations.",
  earth: "Your dashboard could also address potential applications of the PSI data to fire safety on Earth.",
  ask: "an interactive, super intelligence (SI) powered dashboard"
};

const SECTION_BLURB = {
  investigations: "One page per PSI investigation: objective, hardware, fuels, test conditions, what varied, measurements, outcomes, publications.",
  habitat: "Pick an environment and see investigations ranked by a visible score you can re-weight.",
  insights: "Computed findings, each with its numbers, the rows behind it and its limits.",
  extractor: "Filter the unified table, see coverage, download CSV or JSON with units and provenance.",
  readiness: "Which predictive flammability relationships the PSI data supports for each environment, and what data would close the gaps.",
  functions: "Investigations grouped by the fire-safety function they inform.",
  compare: "Side-by-side view of two to four investigations.",
  earth: "Terrestrial applications, marked as documented spinoff or inference.",
  ask: "Questions answered only from the loaded investigations, with citations."
};

const FUEL_LABELS = {
  solid: "Solid",
  liquid_droplet: "Liquid droplet",
  gas: "Gas burner",
  smoke_sample: "Smoke sample",
  aerosol_dust: "Aerosol or dust",
  unclassified: "Unclassified"
};

const FUEL_COLORS = {
  solid: "#b04a2a",
  liquid_droplet: "#1f5fa8",
  gas: "#2f855a",
  smoke_sample: "#7b4bb0",
  aerosol_dust: "#8a8f96",
  unclassified: "#555555"
};

const FUNCTION_INFO = {
  prevention: "Material selection and flammability screening of spacecraft materials",
  detection: "Smoke detectors and particulate monitors",
  suppression: "Suppressant systems: CO2, helium, water mist",
  fundamental: "Foundation for combustion models; no equipment area assigned",
  unassigned: "No fire-safety function assigned in the metadata"
};

const COMPONENTS = [
  ["fuel", "Fuel realism", "a"],
  ["function", "Fire-safety function", "b"],
  ["richness", "Data richness", "c"],
  ["o2", "O2 coverage", "d"],
  ["pressure", "Pressure coverage", "e"],
  ["flow", "Flow coverage", "f"]
];

const TOPIC_NAMES = ["fuel", "function", "richness"];
const CONDITION_NAMES = ["o2", "pressure", "flow"];

const COLUMNS = [
  "row_id", "psi_id", "group", "investigation", "source_file", "source_row", "fuel_class", "fuel",
  "sample_geometry", "o2_frac", "o2_min_frac", "o2_raw", "o2_basis", "diluent", "pressure_atm",
  "flow_cm_s", "flow_direction", "ignition", "outcome", "burn_time_s", "extinction_diameter_mm",
  "measurement_notes", "value_quality", "notes"
];

const STATUS_CLASS = { "Supported": "supported", "Partly": "partly", "Not supported": "notsupported" };

const COUNTABLE_QUALITY = ["exact", "approximate"];

const state = {
  data: null,
  envId: "lunar",
  weights: null,
  includeStream: false,
  extractor: null,
  extractorFilteredCount: 0
};

function el(tag, props) {
  const node = document.createElement(tag);
  const kids = Array.prototype.slice.call(arguments, 2);
  if (Array.isArray(props) || props instanceof Node || typeof props === "string") {
    kids.unshift(props);
    props = {};
  }
  Object.keys(props || {}).forEach(function (key) {
    const value = props[key];
    if (value === null || value === undefined || value === false) {
      return;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key.indexOf("on") === 0) {
      node.addEventListener(key.slice(2), value);
    } else if (key === "value") {
      node.value = value;
    } else if (key === "checked") {
      node.checked = true;
    } else if (value === true) {
      node.setAttribute(key, key);
    } else {
      node.setAttribute(key, value);
    }
  });
  appendKids(node, kids);
  return node;
}

function appendKids(node, kids) {
  kids.forEach(function (kid) {
    if (kid === null || kid === undefined || kid === false) {
      return;
    }
    if (Array.isArray(kid)) {
      appendKids(node, kid);
    } else if (typeof kid === "string" || typeof kid === "number") {
      node.appendChild(document.createTextNode(String(kid)));
    } else {
      node.appendChild(kid);
    }
  });
}

function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function fmt(value, digits) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  const text = Number(value).toFixed(digits === undefined ? 3 : digits);
  return text.indexOf(".") >= 0 ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

function pct(value) {
  return Math.round(value * 100) + "%";
}

function sortById(a, b) {
  return numericId(a) - numericId(b);
}
function numericId(psiId) {
  const m = /\d+/.exec(psiId);
  return m ? parseInt(m[0], 10) : 0;
}

function invById(id) {
  return state.data.investigations.find(function (inv) {
    return inv.psi_id === id;
  });
}

function invLabel(inv) {
  return inv.acronym && inv.acronym !== inv.psi_id ? inv.psi_id + " " + inv.acronym : inv.psi_id;
}

function invLink(inv, text) {
  return el("a", { href: "#/investigation/" + inv.psi_id, text: text || invLabel(inv) });
}

function tag(text, cls) {
  return el("span", { class: "tag " + (cls || ""), text: text });
}

function qs(params) {
  return Object.keys(params).map(function (key) {
    return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
  }).join("&");
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const split = raw.split("?");
  const params = {};
  (split[1] || "").split("&").filter(Boolean).forEach(function (pair) {
    const kv = pair.split("=");
    params[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join("=") || "");
  });
  const parts = (split[0] || "overview").split("/");
  return { name: parts[0] || "overview", arg: parts[1] || null, params: params };
}

function fuelClassOf(inv) {
  return inv.fuel_class || "unclassified";
}

function functionLabel(inv) {
  return inv.primary_function || "unassigned";
}

function functionNames(inv) {
  return inv.functions.map(function (f) { return f.function; });
}

function srcText(psiId, block) {
  if (!block) {
    return "no recorded values";
  }
  return psiId + " | " + block.files.join("; ") + " | rows " + block.source_rows[0] + "-" + block.source_rows[1] + " (n=" + block.n + ")";
}

function rangeText(block, unit) {
  if (!block) {
    return "not recorded";
  }
  const lo = fmt(block.min, 4);
  const hi = fmt(block.max, 4);
  return (lo === hi ? lo : lo + " to " + hi) + (unit ? " " + unit : "");
}

function overlap(elo, ehi, lo, hi) {
  if (lo === null || lo === undefined || hi === null || hi === undefined) {
    return 0;
  }
  if (ehi === elo) {
    return lo <= elo && elo <= hi ? 1 : 0;
  }
  const inter = Math.min(ehi, hi) - Math.max(elo, lo);
  if (inter <= 0) {
    return 0;
  }
  return Math.min(1, inter / (ehi - elo));
}

function valueInside(elo, ehi, block) {
  const values = block.values || [];
  const spans = block.spans || [];
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] >= elo && values[i] <= ehi) {
      return true;
    }
  }
  for (let j = 0; j < spans.length; j += 1) {
    if (spans[j][0] <= ehi && spans[j][1] >= elo) {
      return true;
    }
  }
  return false;
}

function round9(x) {
  return Math.round(x * 1e9) / 1e9;
}

function coverage(elo, ehi, block) {
  if (!block) {
    return 0;
  }
  const span = overlap(elo, ehi, block.min, block.max);
  const hit = valueInside(elo, ehi, block) ? 1 : 0;
  return round9(0.5 * span + 0.5 * hit);
}

function windowOf(env, key) {
  const block = env[key];
  return [block.window_min !== undefined ? block.window_min : block.min, block.window_max !== undefined ? block.window_max : block.max];
}

function fuelRealism(fc) {
  if (fc === "solid") {
    return 1;
  }
  if (fc === "liquid_droplet") {
    return 0.5;
  }
  if (fc === "gas") {
    return 0.3;
  }
  return null;
}

function functionRelevance(funcs) {
  const core = ["prevention", "detection", "suppression"];
  const names = funcs.map(function (f) { return f.function; });
  if (names.some(function (f) { return core.indexOf(f) >= 0; })) {
    return { value: 1, label: "core" };
  }
  if (names.indexOf("fundamental") >= 0) {
    return { value: 0.4, label: "fundamental" };
  }
  return { value: 0.2, label: "unassigned" };
}

function richness(rows, outcomeRows) {
  if (!rows) {
    return 0;
  }
  const size = Math.min(1, Math.log10(1 + rows) / Math.log10(1 + 500));
  return 0.6 * size + 0.4 * (outcomeRows / rows);
}

function components(inv, env, includeStream) {
  const r = inv.ranges;
  const o2w = windowOf(env, "o2");
  const pw = windowOf(env, "pressure_atm");
  const fw = windowOf(env, "flow_cm_s");
  const amb = coverage(o2w[0], o2w[1], r.o2_ambient);
  const stream = coverage(o2w[0], o2w[1], r.o2_oxidizer_stream);
  const fr = functionRelevance(inv.functions);
  return {
    fuel: fuelRealism(inv.fuel_class),
    function: fr.value,
    function_label: fr.label,
    richness: richness(inv.row_count, inv.outcome_rows),
    o2: includeStream ? Math.max(amb, stream) : amb,
    o2_ambient: amb,
    o2_stream: stream,
    pressure: coverage(pw[0], pw[1], r.pressure_atm),
    flow: coverage(fw[0], fw[1], r.flow_cm_s)
  };
}

function weightedAverage(comps, weights, names) {
  let total = 0;
  let used = 0;
  names.forEach(function (name) {
    const value = comps[name];
    const w = weights[name];
    if (value === null || value === undefined || !(w > 0)) {
      return;
    }
    total += w * value;
    used += w;
  });
  return used === 0 ? 0 : round9(total / used);
}

function weightedScore(comps, weights) {
  return weightedAverage(comps, weights, TOPIC_NAMES.concat(CONDITION_NAMES));
}

function rankAll(investigations, env, weights, includeStream) {
  const scored = investigations.filter(function (inv) {
    return inv.row_count > 0;
  }).map(function (inv) {
    const comps = components(inv, env, includeStream);
    return {
      psi_id: inv.psi_id,
      components: comps,
      topic: weightedAverage(comps, weights, TOPIC_NAMES),
      condition: weightedAverage(comps, weights, CONDITION_NAMES),
      score: weightedScore(comps, weights)
    };
  });
  scored.sort(function (a, b) {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.psi_id < b.psi_id ? -1 : a.psi_id > b.psi_id ? 1 : 0;
  });
  scored.forEach(function (item, index) {
    item.rank = index + 1;
  });
  return scored;
}

function rankStability(investigations, env, weights, includeStream) {
  const base = rankAll(investigations, env, weights, includeStream);
  const low = {};
  const high = {};
  base.forEach(function (item) {
    low[item.psi_id] = item.rank;
    high[item.psi_id] = item.rank;
  });
  const factor = state.data.rank_reference.perturbation;
  COMPONENTS.forEach(function (c) {
    [1 - factor, 1 + factor].forEach(function (mult) {
      const changed = Object.assign({}, weights);
      changed[c[0]] = weights[c[0]] * mult;
      rankAll(investigations, env, changed, includeStream).forEach(function (item) {
        low[item.psi_id] = Math.min(low[item.psi_id], item.rank);
        high[item.psi_id] = Math.max(high[item.psi_id], item.rank);
      });
    });
  });
  const out = {};
  Object.keys(low).forEach(function (id) {
    out[id] = { min: low[id], max: high[id] };
  });
  return out;
}

function parityCheck() {
  const ref = state.data.rank_reference;
  const investigations = state.data.investigations;
  let checks = 0;
  let failures = 0;
  Object.keys(ref.variants).forEach(function (variant) {
    const includeStream = variant === "with_stream";
    state.data.environments.environments.forEach(function (env) {
      const expected = ref.variants[variant][env.id];
      const ranking = rankAll(investigations, env, ref.weights, includeStream);
      const stability = rankStability(investigations, env, ref.weights, includeStream);
      expected.ranking.forEach(function (exp, index) {
        const got = ranking[index];
        checks += 1;
        const same = got && got.psi_id === exp.psi_id && got.rank === exp.rank && Math.abs(got.score - exp.score) < 2e-9 &&
          Math.abs(got.topic - exp.topic) < 2e-9 && Math.abs(got.condition - exp.condition) < 2e-9;
        const st = stability[exp.psi_id];
        const stable = st && st.min === expected.stability[exp.psi_id].min && st.max === expected.stability[exp.psi_id].max;
        if (!same || !stable) {
          failures += 1;
          console.error("rank parity mismatch", variant, env.id, exp.psi_id, exp, got);
        }
      });
    });
  });
  if (failures === 0) {
    console.log("rank parity OK: " + checks + " checks against rank_reference.json");
  } else {
    console.error("rank parity FAILED: " + failures + " of " + checks);
  }
}

function loadJson(name) {
  return fetch("data/" + name + ".json").then(function (res) {
    if (!res.ok) {
      throw new Error(name + ": HTTP " + res.status);
    }
    return res.json();
  });
}

function currentEnv() {
  return state.data.environments.environments.find(function (e) {
    return e.id === state.envId;
  });
}

function setView() {
  const view = document.getElementById("view");
  clear(view);
  appendKids(view, Array.prototype.slice.call(arguments));
  return view;
}

function pageHead(key, title) {
  return [
    el("h1", { text: title }),
    el("div", { class: "objective" },
      el("strong", { text: "Objective line this answers: " }),
      "\"" + OBJECTIVES[key] + "\"")
  ];
}

function buildNav(active) {
  const nav = document.getElementById("nav");
  clear(nav);
  NAV.forEach(function (item) {
    nav.appendChild(el("a", { href: "#/" + item[0], class: item[0] === active ? "active" : "", text: item[1] }));
  });
}

function renderOverview() {
  const lead = state.data.insights.insights[0];
  const stats = state.data.investigations;
  const withRows = stats.filter(function (i) { return i.row_count > 0; }).length;
  const sections = [];
  NAV.slice(1).forEach(function (item) {
    sections.push(item);
    if (item[0] === "extractor") {
      sections.push(["readiness", "Model Readiness"]);
    }
  });
  const cards = sections.map(function (item) {
    return el("div", { class: "card" },
      el("h3", null, el("a", { href: "#/" + item[0], text: item[1] })),
      el("p", { class: "obj", text: "\"" + OBJECTIVES[item[0]] + "\"" }),
      el("p", { class: "small", text: SECTION_BLURB[item[0]] }));
  });
  return setView(
    el("h1", { text: "Flame in Freefall" }),
    el("p", { class: "lede", text: "A fire-safety dashboard over NASA Physical Sciences Informatics (PSI) microgravity combustion data. It summarizes the investigations, ranks them for habitat environments with a visible score, computes findings with the rows behind them, and lets you extract the data." }),
    el("div", { class: "panel" },
      el("h2", { text: "Lead finding" }),
      el("p", { text: lead.text }),
      el("p", { class: "small muted", text: lead.limits }),
      el("a", { href: "#/insights", text: "See all insights" })),
    el("p", { class: "small muted", text: stats.length + " investigations loaded, " + withRows + " with rows in the unified conditions table (" + state.data.conditions.length + " rows). All PSI data is microgravity; PSI holds no partial-gravity data." }),
    el("h2", { text: "Sections and the objective line each one answers" }),
    el("div", { class: "grid" }, cards)
  );
}

function distinctHardware() {
  const set = {};
  state.data.investigations.forEach(function (inv) {
    hardwareTokens(inv).forEach(function (t) { set[t] = true; });
  });
  return Object.keys(set).sort();
}

function hardwareTokens(inv) {
  return (inv.hardware || "").split(/,\s+|\s{2,}/).map(function (t) { return t.trim(); }).filter(Boolean);
}

function renderInvestigations() {
  const filters = { fuel: "", hardware: "", fn: "" };
  const fuelOptions = Array.from(new Set(state.data.investigations.map(fuelClassOf))).sort();
  const fnOptions = ["prevention", "detection", "suppression", "fundamental", "unassigned"];
  const tableHolder = el("div", { class: "table-wrap" });
  const count = el("p", { class: "small muted" });

  function draw() {
    const list = state.data.investigations.filter(function (inv) {
      if (filters.fuel && fuelClassOf(inv) !== filters.fuel) {
        return false;
      }
      if (filters.hardware && hardwareTokens(inv).indexOf(filters.hardware) < 0) {
        return false;
      }
      if (filters.fn) {
        const fns = inv.functions.length ? functionNames(inv) : ["unassigned"];
        if (fns.indexOf(filters.fn) < 0) {
          return false;
        }
      }
      return true;
    });
    count.textContent = list.length + " of " + state.data.investigations.length + " investigations";
    clear(tableHolder);
    tableHolder.appendChild(el("table", null,
      el("thead", null, el("tr", null,
        ["Investigation", "Fuel class", "Hardware", "Function", "Rows", "Ambient O2 tested", "Pressure tested (atm)"].map(function (h) {
          return el("th", { text: h });
        }))),
      el("tbody", null, list.map(function (inv) {
        return el("tr", null,
          el("td", null, invLink(inv), el("span", { class: "src", text: inv.title })),
          el("td", { text: FUEL_LABELS[fuelClassOf(inv)] }),
          el("td", { class: "small", text: inv.hardware || "n/a" }),
          el("td", null, tag(functionLabel(inv), inv.functions.length ? "" : "unassigned")),
          el("td", { class: "num", text: inv.row_count }),
          el("td", { text: rangeText(inv.ranges.o2_ambient) }),
          el("td", { text: rangeText(inv.ranges.pressure_atm) }));
      }))));
  }

  function select(label, options, key, labelFn) {
    const node = el("select", { onchange: function (e) { filters[key] = e.target.value; draw(); } },
      el("option", { value: "", text: "All" }),
      options.map(function (o) { return el("option", { value: o, text: labelFn ? labelFn(o) : o }); }));
    return el("label", { class: "field" }, label, node);
  }

  const view = setView(
    pageHead("investigations", "Investigations"),
    el("p", { class: "lede", text: "Every PSI combustion investigation in the dataset. Rows counts and test ranges are computed from the unified conditions table; investigations without rows are listed with zero rows." }),
    el("div", { class: "row-controls" },
      select("Fuel class", fuelOptions, "fuel", function (o) { return FUEL_LABELS[o]; }),
      select("Hardware", distinctHardware(), "hardware"),
      select("Fire-safety function", fnOptions, "fn")),
    count,
    tableHolder
  );
  draw();
  return view;
}

function kv(label, content, source) {
  return el("tr", null,
    el("th", { text: label }),
    el("td", null, content, source ? el("span", { class: "src", text: source }) : null));
}

function textBlock(value) {
  if (!value) {
    return el("span", { class: "muted", text: "not provided" });
  }
  return el("div", { class: "pre", text: value });
}

function listBlock(items, limit) {
  if (!items || !items.length) {
    return el("span", { class: "muted", text: "not provided" });
  }
  const shown = limit ? items.slice(0, limit) : items;
  return el("ul", null, shown.map(function (t) { return el("li", { text: t }); }),
    limit && items.length > limit ? el("li", { class: "muted", text: "and " + (items.length - limit) + " more" }) : null);
}

function renderInvestigation(psiId) {
  const inv = invById(psiId);
  if (!inv) {
    return setView(el("h1", { text: "Investigation not found" }), el("p", null, el("a", { href: "#/investigations", text: "Back to the list" })));
  }
  const r = inv.ranges;
  const conditionRows = [
    ["Ambient O2 (mole fraction)", rangeText(r.o2_ambient), srcText(inv.psi_id, r.o2_ambient)],
    ["Oxidizer-stream O2 (mole fraction, a different quantity)", rangeText(r.o2_oxidizer_stream), srcText(inv.psi_id, r.o2_oxidizer_stream)],
    ["Pressure (atm)", rangeText(r.pressure_atm), srcText(inv.psi_id, r.pressure_atm)],
    ["Flow speed (cm/s)", rangeText(r.flow_cm_s), srcText(inv.psi_id, r.flow_cm_s)]
  ];
  const varied = Object.keys(inv.varied).map(function (key) {
    const v = inv.varied[key];
    let values;
    if (v.status === "not recorded") {
      values = "";
    } else if (v.min !== undefined && v.status === "varied") {
      values = fmt(v.min, 4) + " to " + fmt(v.max, 4) + " (" + v.distinct + " distinct)";
    } else if (v.status === "varied") {
      values = v.values.join("; ") + (v.distinct > v.values.length ? " ... (" + v.distinct + " distinct)" : "");
    } else {
      values = v.values.join("; ");
    }
    return el("tr", null,
      el("td", { text: v.label }),
      el("td", null, tag(v.status, v.status === "varied" ? "varied" : "held")),
      el("td", { text: values }),
      el("td", { class: "num", text: v.n }));
  });
  const pubs = inv.publications.length ? el("ul", null, inv.publications.slice(0, 15).map(function (p) {
    return el("li", null, p.url ? el("a", { href: p.url, text: p.title || p.url }) : (p.title || "untitled"),
      el("span", { class: "src", text: [p.authors, p.year].filter(Boolean).join(" | ") }));
  }), inv.publications.length > 15 ? el("li", { class: "muted", text: "and " + (inv.publications.length - 15) + " more on the PSI record" }) : null)
    : el("span", { class: "muted", text: "none listed" });
  const ntrs = inv.ntrs_publications.length ? el("ul", null, inv.ntrs_publications.map(function (p) {
    return el("li", null, p.url ? el("a", { href: p.url, text: p.title || p.id }) : p.title,
      el("span", { class: "src", text: "NTRS " + p.id + (p.year ? " | " + p.year : "") }));
  })) : el("span", { class: "muted", text: "none found" });
  const quality = inv.value_quality.map(function (q) { return q.value + " " + q.count; }).join(", ");

  return setView(
    el("p", { class: "small" }, el("a", { href: "#/investigations", text: "All investigations" })),
    el("h1", { text: invLabel(inv) }),
    el("p", { class: "lede", text: inv.title }),
    inv.meta_present ? null : el("div", { class: "notice", text: "PSI metadata record not loaded for this build; showing fields computed from the unified table only." }),
    el("div", { class: "panel" },
      el("p", null, tag(FUEL_LABELS[fuelClassOf(inv)]), " ", tag(functionLabel(inv), inv.functions.length ? "" : "unassigned"), " ",
        inv.platform ? tag(inv.platform) : null, " ", tag(inv.row_count + " rows")),
      el("p", { class: "small" }, el("a", { href: inv.psi_url, text: "PSI record " + inv.psi_id }),
        inv.doi ? [" | DOI ", el("a", { href: "https://doi.org/" + inv.doi, text: inv.doi })] : null,
        inv.license ? " | License: " + inv.license : null)),
    el("h2", { text: "Objective" }),
    textBlock(inv.objectives || inv.description),
    (inv.hypothesis || inv.approach) ? el("details", null, el("summary", { text: "Hypothesis and approach" }),
      inv.hypothesis ? el("p", { class: "pre", text: inv.hypothesis }) : null,
      inv.approach ? el("p", { class: "pre", text: inv.approach }) : null) : null,
    el("h2", { text: "Hardware, fuels and samples" }),
    el("div", { class: "table-wrap" }, el("table", null, el("tbody", null,
      kv("Hardware", inv.hardware || "not provided", inv.hardware_link ? "Link: " + inv.hardware_link : null),
      kv("Principal investigators", listBlock(inv.principal_investigators)),
      kv("Fuels in table rows", inv.fuels_observed.length ? inv.fuels_observed.map(function (f) { return f.value + " (" + f.count + ")"; }).join("; ") : "not recorded", inv.row_count ? inv.psi_id + " | " + inv.source_files.join("; ") : null),
      kv("Sample geometry or burner", listBlock(inv.sample_geometry, 8), inv.sample_geometry.length ? inv.psi_id + " | PSI record, from the table rows" : null)))),
    el("h2", { text: "Test conditions" }),
    inv.row_count ? el("div", { class: "table-wrap" }, el("table", null, el("tbody", conditionRows.map(function (c) {
      return kv(c[0], c[1], c[2]);
    }), kv("Diluents seen", inv.diluents_observed.length ? inv.diluents_observed.map(function (d) { return d.value + " (" + d.count + ")"; }).join("; ") : "not recorded", null)))) : el("p", { class: "muted", text: "No rows in the unified conditions table for this investigation." }),
    inv.test_conditions_text ? el("details", null, el("summary", { text: "Test conditions text from the PSI record" }), el("p", { class: "pre", text: inv.test_conditions_text })) : null,
    el("h2", { text: "What varied and what was held constant" }),
    inv.row_count ? el("div", { class: "table-wrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Field", "Status", "Values", "Rows with a value"].map(function (h) { return el("th", { text: h }); }))),
      el("tbody", varied)),
      el("p", { class: "small muted", text: "Varied means more than one distinct non-blank value across this investigation's rows; held constant means exactly one; not recorded means none. O2 is compared at 0.001, pressure at 0.01 atm and flow at 0.1 cm/s. Source: " + inv.psi_id + " | " + inv.source_files.join("; ") + " | " + inv.row_count + " rows." })) : el("p", { class: "muted", text: "Not computed: no rows." }),
    el("h2", { text: "Measurements and sensors" }),
    listBlock(inv.diagnostics_measurements),
    el("h2", { text: "Outcomes recorded" }),
    inv.outcomes.length ? el("p", { text: inv.outcomes.map(function (o) { return o.value + " (" + o.count + ")"; }).join(", ") + ". " + inv.outcome_rows + " of " + inv.row_count + " rows carry an outcome label." }) : el("p", { class: "muted", text: "No outcome column in the table rows." }),
    inv.row_count ? el("p", { class: "small muted", text: "Value quality of rows: " + quality + "." }) : null,
    el("h2", { text: "Fire-safety function" }),
    el("p", null, "Primary label: ", tag(functionLabel(inv), inv.functions.length ? "" : "unassigned")),
    inv.functions.length ? el("div", { class: "table-wrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Function", "Source", "Basis"].map(function (h) { return el("th", { text: h }); }))),
      el("tbody", null, inv.functions.map(function (f) {
        return el("tr", null,
          el("td", { text: f.function }),
          el("td", null, tag(f.source, f.source === "challenge statement" ? "documented" : "inference")),
          el("td", { class: "small pre", text: f.basis || "No basis text." }));
      })))) : el("p", { class: "muted", text: "No function assigned." }),
    el("h2", { text: "Publications" }),
    el("h3", { text: "PSI record" }), pubs,
    el("h3", { text: "NTRS" }), ntrs,
    inv.row_count ? el("p", null, el("a", { href: "#/extractor?" + qs({ inv: inv.psi_id }), text: "Open these " + inv.row_count + " rows in the Data Extractor" })) : null
  );
}

function sourceRefs(block) {
  const refs = state.data.environments.sources;
  return block.sources.map(function (s) {
    const ref = refs[s.ref];
    return el("span", { class: "src" }, ref ? el("a", { href: ref.url, text: ref.label }) : s.ref, " - " + s.detail);
  });
}

function envRow(label, block) {
  return el("tr", null,
    el("th", { text: label }),
    el("td", null, block.display),
    el("td", null, tag(block.assumption ? "assumption" : "sourced", block.assumption ? "assumption" : "sourced"),
      block.note ? el("span", { class: "src", text: block.note }) : null,
      sourceRefs(block)));
}

function envProfile(env) {
  const g = env.gravity;
  return el("div", { class: "table-wrap" }, el("table", null,
    el("thead", null, el("tr", null, ["Quantity", "Value", "Basis"].map(function (h) { return el("th", { text: h }); }))),
    el("tbody", null,
      envRow("Oxygen (mole fraction)", env.o2),
      envRow("Total pressure", env.pressure_atm),
      envRow("Cabin flow speed", env.flow_cm_s),
      el("tr", null,
        el("th", { text: "Gravity" }),
        el("td", { text: g.display }),
        el("td", null, tag(g.assumption ? "assumption" : "sourced", g.assumption ? "assumption" : "sourced"),
          g.note ? el("span", { class: "src", text: g.note }) : null,
          sourceRefs(g))))));
}

function windowCounts(env, includeStream) {
  const lo = env.o2.window_min;
  const hi = env.o2.window_max;
  const counts = {};
  state.data.conditions.forEach(function (r) {
    if (COUNTABLE_QUALITY.indexOf(r.value_quality) < 0 || r.o2_frac === undefined) {
      return;
    }
    const basisOk = r.o2_basis === "ambient" || (includeStream && r.o2_basis === "oxidizer_stream");
    if (basisOk && r.o2_frac >= lo && r.o2_frac <= hi) {
      counts[r.psi_id] = (counts[r.psi_id] || 0) + 1;
    }
  });
  return counts;
}

function whyLine(inv, item, counts) {
  const c = item.components;
  const r = inv.ranges;
  const parts = [];
  parts.push(c.fuel === null ? "fuel realism not applicable (" + FUEL_LABELS[fuelClassOf(inv)] + ")" : FUEL_LABELS[fuelClassOf(inv)] + " fuel = " + fmt(c.fuel, 1));
  parts.push("function " + (inv.functions.length ? functionNames(inv).join("/") : "unassigned") + " = " + fmt(c.function, 1));
  parts.push(inv.row_count + " rows, " + inv.outcome_rows + " with an outcome");
  parts.push("O2 " + (r.o2_ambient ? "tested " + rangeText(r.o2_ambient) + ", coverage " + fmt(c.o2_ambient, 2) : "ambient not recorded"));
  if (state.includeStream && r.o2_oxidizer_stream) {
    parts.push("oxidizer-stream tested " + rangeText(r.o2_oxidizer_stream) + ", coverage " + fmt(c.o2_stream, 2));
  }
  parts.push(r.pressure_atm ? "pressure tested " + rangeText(r.pressure_atm) + ", coverage " + fmt(c.pressure, 2) : "pressure not recorded");
  parts.push(r.flow_cm_s ? "flow tested " + rangeText(r.flow_cm_s) + ", coverage " + fmt(c.flow, 2) : "flow not recorded");
  parts.push((counts[inv.psi_id] || 0) + " rows inside the O2 window");
  return parts.join("; ") + ".";
}

function barGroup(item, weights, names) {
  const wrap = el("div", { class: "bars" });
  COMPONENTS.filter(function (c) { return names.indexOf(c[0]) >= 0; }).forEach(function (c) {
    const value = item.components[c[0]];
    const na = value === null || value === undefined;
    const title = c[1] + ": " + (na ? "not applicable" : fmt(value, 2)) + " (weight " + fmt(weights[c[0]], 2) + ")";
    const fill = el("div", { class: "bar-fill" + (na ? " na" : ""), style: na ? null : "height:" + Math.round(value * 100) + "%" });
    wrap.appendChild(el("div", { class: "bar-col", title: title },
      el("div", { class: "bar-track" }, fill),
      el("div", { class: "bar-letter", text: c[2] })));
  });
  return wrap;
}

function barCell(item, weights) {
  return el("div", { class: "bar-groups" }, barGroup(item, weights, TOPIC_NAMES), barGroup(item, weights, CONDITION_NAMES));
}

function renderHabitat() {
  const data = state.data;
  const holder = el("div");
  const profileHolder = el("div");
  const sliderHolder = el("div", { class: "panel" });

  function drawProfile() {
    const env = currentEnv();
    clear(profileHolder);
    profileHolder.appendChild(envProfile(env));
    profileHolder.appendChild(el("div", { class: "notice" }, el("strong", { text: "Gravity: " }), env.gravity.bracket_note,
      " Values marked assumption are not in the loaded sources; check them before using this ranking for that environment."));
  }

  function drawRanking() {
    const env = currentEnv();
    const ranking = rankAll(data.investigations, env, state.weights, state.includeStream);
    const stability = rankStability(data.investigations, env, state.weights, state.includeStream);
    const counts = windowCounts(env, state.includeStream);
    clear(holder);
    const stableCount = ranking.filter(function (i) { return stability[i.psi_id].min === stability[i.psi_id].max; }).length;
    let swing = null;
    ranking.forEach(function (i) {
      const span = stability[i.psi_id].max - stability[i.psi_id].min;
      if (!swing || span > swing.span) {
        swing = { id: i.psi_id, span: span, min: stability[i.psi_id].min, max: stability[i.psi_id].max };
      }
    });
    const unscored = data.investigations.filter(function (inv) { return !inv.row_count; });
    holder.appendChild(el("p", { id: "score-explainer", text: "Topic relevance is how relevant the investigation is to fire safety (fuel, fire-safety function, data richness), condition match is how close its tests are to this environment's O2, pressure and flow, and overall combines both using the weights above." }));
    holder.appendChild(el("p", { class: "legend", text: "Bars, each 0 to 1, left group is topic relevance: a fuel realism, b fire-safety function, c data richness; right group is condition match: d O2 coverage, e pressure coverage, f flow coverage. Hatched means not applicable and is left out of that investigation's weighted average. Coverage is half the share of the environment window spanned by the tested range plus half credit if at least one tested value lies inside the window." }));
    holder.appendChild(el("div", { class: "table-wrap" }, el("table", null,
      el("thead", null, el("tr", null, ["Rank", "Investigation", "Overall", "Topic relevance", "Condition match", "Components (a-c topic, d-f condition)", "Rank range (+/-20% weights)", "Why"].map(function (h) { return el("th", { text: h }); }))),
      el("tbody", null, ranking.map(function (item) {
        const inv = invById(item.psi_id);
        const st = stability[item.psi_id];
        return el("tr", null,
          el("td", { class: "num", text: item.rank }),
          el("td", null, invLink(inv), el("span", { class: "src", text: FUEL_LABELS[fuelClassOf(inv)] + " | " + functionLabel(inv) })),
          el("td", { class: "num", text: fmt(item.score, 3) }),
          el("td", { class: "num", text: fmt(item.topic, 3) }),
          el("td", { class: "num", text: fmt(item.condition, 3) }),
          el("td", null, barCell(item, state.weights)),
          el("td", { class: "num", text: st.min === st.max ? String(st.min) : st.min + " to " + st.max }),
          el("td", { class: "small", text: whyLine(inv, item, counts) }));
      })))));
    holder.appendChild(el("p", { class: "small", text: "Rank stability: with each of the six weights moved by -20% and +20% in turn (12 variants), " + stableCount + " of " + ranking.length + " investigations keep exactly the same rank" + (swing && swing.span > 0 ? "; the widest swing is " + invById(swing.id).acronym + " (" + swing.id + "), rank " + swing.min + " to " + swing.max + "." : ".") }));
    if (unscored.length) {
      holder.appendChild(el("p", { class: "small muted", text: "Not scored, no rows in the unified conditions table: " + unscored.map(function (i) { return invLabel(i); }).join(", ") + "." }));
    }
  }

  function drawSliders() {
    clear(sliderHolder);
    sliderHolder.appendChild(el("h3", { text: "Score weights" }));
    sliderHolder.appendChild(el("p", { class: "small muted", text: "Overall is the weighted average of all six components. Defaults: fuel realism 0.25, fire-safety function 0.25, data richness 0.10, O2 0.20, pressure 0.10, flow 0.10. O2 is the heaviest condition weight because NASA sources state that O2 matters far more than pressure for flammability (Ruff and Urban, FLARE 2021). Move the sliders to test other priorities." }));
    COMPONENTS.forEach(function (c) {
      const out = el("span", { text: fmt(state.weights[c[0]], 2) });
      const input = el("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(state.weights[c[0]]), "aria-label": c[1] + " weight" });
      input.addEventListener("input", function () {
        state.weights[c[0]] = parseFloat(input.value);
        out.textContent = fmt(state.weights[c[0]], 2);
        drawRanking();
      });
      sliderHolder.appendChild(el("div", { class: "slider-row" }, el("label", { text: c[2] + ". " + c[1] }), input, out));
    });
    sliderHolder.appendChild(el("p", null, el("button", { class: "secondary", type: "button", text: "Reset weights", onclick: function () {
      state.weights = Object.assign({}, data.rank_reference.weights);
      drawSliders();
      drawRanking();
    } })));
  }

  const envSelect = el("select", { id: "env-select", onchange: function (e) {
    state.envId = e.target.value;
    drawProfile();
    drawRanking();
  } }, data.environments.environments.map(function (env) {
    return el("option", { value: env.id, text: env.name, selected: env.id === state.envId });
  }));
  const streamBox = el("input", { type: "checkbox", id: "stream-box", checked: state.includeStream, onchange: function (e) {
    state.includeStream = e.target.checked;
    drawRanking();
  } });

  const root = setView(
    pageHead("habitat", "Habitat Relevance"),
    el("p", { class: "lede", text: "Choose an environment. Each investigation is scored for it from six visible components and ranked. All PSI data is microgravity, so this ranks how relevant each investigation is and how closely its tested O2, pressure and flow match the environment, not how a fire would behave there." }),
    el("div", { class: "row-controls" },
      el("label", { class: "field" }, "Environment", envSelect),
      el("label", { class: "checks" }, streamBox, " Count oxidizer-stream O2 as well (a different quantity from ambient O2, off by default)")),
    profileHolder,
    sliderHolder,
    holder
  );
  drawProfile();
  drawSliders();
  drawRanking();
  return root;
}

function renderInsights() {
  const items = state.data.insights.insights.map(function (ins) {
    return el("div", { class: "panel", id: "insight-" + ins.id },
      el("h3", { text: ins.title }),
      el("p", { text: ins.text }),
      insightTable(ins),
      el("p", { class: "small" }, el("strong", { text: "Rows behind it: " }),
        ins.links.map(function (l, i) {
          return [i ? " | " : "", el("a", { href: "#/extractor?" + qs(l.params), text: l.label })];
        })),
      el("p", { class: "small muted" }, el("strong", { text: "Limits: " }), ins.limits));
  });
  return setView(
    pageHead("insights", "Insights"),
    el("p", { class: "lede", text: "Findings computed directly from the unified conditions table. Each one states its numbers, links to the rows behind it and says what it cannot show. The test suite recounts every number from the table." }),
    items
  );
}

function plainTable(headers, rows) {
  return el("div", { class: "table-wrap" }, el("table", null,
    el("thead", null, el("tr", null, headers.map(function (h) { return el("th", { text: h }); }))),
    el("tbody", null, rows.map(function (r) {
      return el("tr", null, r.map(function (c) { return el("td", null, c); }));
    }))));
}

function insightTable(ins) {
  const n = ins.numbers;
  if (ins.id === "max_o2_by_fuel_class") {
    return plainTable(["Fuel class", "Highest ambient O2", "Rows with ambient O2", "Where"],
      Object.keys(n.max_by_fuel_class).map(function (fc) {
        const v = n.max_by_fuel_class[fc];
        return [FUEL_LABELS[fc], fmt(v.max_o2, 3), String(v.rows_with_o2), v.psi_id + " | " + v.source_file + " | row " + v.source_row];
      }));
  }
  if (ins.id === "rows_per_environment_window") {
    return plainTable(["Environment", "Rows, O2 in window", "Rows, O2 and pressure in window", "Solid (O2 / both)", "Liquid droplet (O2 / both)", "Gas (O2 / both)"],
      Object.keys(n.windows).map(function (id) {
        const w = n.windows[id];
        const byClass = function (fc) {
          return w.by_fuel_class[fc].o2_window + " / " + w.by_fuel_class[fc].o2_and_pressure_window;
        };
        return [w.name, String(w.o2_window_rows), String(w.o2_and_pressure_window_rows), byClass("solid"), byClass("liquid_droplet"), byClass("gas")];
      }));
  }
  if (ins.id === "coverage_gaps") {
    return plainTable(["Environment", "Fuel classes with zero rows in O2 window", "Fuel classes with zero rows in O2 and pressure window", "Rows in O2 and flow window"],
      Object.keys(n.gaps).map(function (id) {
        const g = n.gaps[id];
        const names = function (list) { return list.length ? list.map(function (c) { return FUEL_LABELS[c]; }).join(", ") : "none"; };
        return [g.name, names(g.fuel_classes_zero_o2_window), names(g.fuel_classes_zero_o2_pressure_window), String(g.rows_o2_and_flow_window)];
      }));
  }
  if (ins.id === "o2_with_outcome") {
    return plainTable(["Investigation", "Rows with O2 and outcome"], Object.keys(n.by_investigation).sort(sortById).map(function (id) {
      const inv = invById(id);
      return [inv ? invLink(inv) : id, String(n.by_investigation[id])];
    }));
  }
  return null;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === "") {
    return null;
  }
  const x = parseFloat(v);
  return Number.isNaN(x) ? null : x;
}

function listParam(v) {
  return v ? v.split(",").filter(Boolean) : [];
}

function filterFromParams(p) {
  return {
    fuel: listParam(p.fuel),
    inv: listParam(p.inv),
    basis: listParam(p.basis),
    quality: listParam(p.quality),
    o2min: numOrNull(p.o2min),
    o2max: numOrNull(p.o2max),
    pmin: numOrNull(p.pmin),
    pmax: numOrNull(p.pmax),
    fmin: numOrNull(p.fmin),
    fmax: numOrNull(p.fmax),
    outcome: p.outcome === "1",
    env: p.env || state.envId
  };
}

function inRange(v, lo, hi) {
  if (lo === null && hi === null) {
    return true;
  }
  if (v === undefined || v === null) {
    return false;
  }
  if (lo !== null && v < lo) {
    return false;
  }
  if (hi !== null && v > hi) {
    return false;
  }
  return true;
}

function applyFilter(rows, f) {
  return rows.filter(function (r) {
    if (f.fuel.length && f.fuel.indexOf(r.fuel_class || "unclassified") < 0) {
      return false;
    }
    if (f.inv.length && f.inv.indexOf(r.psi_id) < 0) {
      return false;
    }
    if (f.basis.length && f.basis.indexOf(r.o2_basis) < 0) {
      return false;
    }
    if (f.quality.length && f.quality.indexOf(r.value_quality) < 0) {
      return false;
    }
    if (!inRange(r.o2_frac, f.o2min, f.o2max)) {
      return false;
    }
    if (!inRange(r.pressure_atm, f.pmin, f.pmax)) {
      return false;
    }
    if (!inRange(r.flow_cm_s, f.fmin, f.fmax)) {
      return false;
    }
    if (f.outcome && (r.outcome === undefined || r.outcome === null)) {
      return false;
    }
    return true;
  });
}

function filterSummary(f) {
  const parts = [];
  if (f.fuel.length) { parts.push("fuel_class in " + f.fuel.join("|")); }
  if (f.inv.length) { parts.push("psi_id in " + f.inv.join("|")); }
  if (f.basis.length) { parts.push("o2_basis in " + f.basis.join("|")); }
  if (f.quality.length) { parts.push("value_quality in " + f.quality.join("|")); }
  if (f.o2min !== null || f.o2max !== null) { parts.push("o2_frac " + fmt(f.o2min) + " to " + fmt(f.o2max)); }
  if (f.pmin !== null || f.pmax !== null) { parts.push("pressure_atm " + fmt(f.pmin) + " to " + fmt(f.pmax)); }
  if (f.fmin !== null || f.fmax !== null) { parts.push("flow_cm_s " + fmt(f.fmin) + " to " + fmt(f.fmax)); }
  if (f.outcome) { parts.push("outcome present"); }
  return parts.length ? parts.join("; ") : "none (all rows)";
}

function noteLines(f, count, total) {
  return [
    "Flame in Freefall extract of the NASA PSI unified conditions table",
    "Source: NASA Physical Sciences Informatics (PSI) combustion experimental tables, one row per source table row; source_file and source_row give the origin of every record. Repository: " + REPO_URL,
    "Units: o2_frac and o2_min_frac are mole fractions; pressure_atm is atm; flow_cm_s is cm/s; burn_time_s is s; extinction_diameter_mm is mm.",
    "Validity domain: every row is a microgravity (0 g) test; PSI holds no partial-gravity data, so do not interpolate to lunar or Mars gravity.",
    "o2_basis: ambient is chamber O2; oxidizer_stream is the O2 fraction in the burner flow and is not a cabin atmosphere; none means no O2 value.",
    "value_quality: exact and approximate are single values; summary_row, range and ramped rows hold a bound or a list, with o2_frac the upper bound and o2_min_frac the lower.",
    "outcome labels are specific to each investigation table and are not harmonized into MOC, LOI or ULOI. pressure_atm at or below 0 is not physical and should be treated as not recorded.",
    "group column: equals psi_id. " + state.data.model_readiness.grouped_validation_note,
    "Filters applied: " + filterSummary(f),
    "Rows: " + count + " of " + total + ". Generated " + new Date().toISOString().slice(0, 10) + ". Each PSI investigation record states its own license."
  ];
}

function csvCell(v) {
  if (v === undefined || v === null) {
    return "";
  }
  const s = String(v);
  return /[",\n\r]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
}

function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function cellValue(r, column) {
  return column === "group" ? r.psi_id : r[column];
}

function exportCsv(rows, f) {
  const lines = noteLines(f, rows.length, state.data.conditions.length).map(function (l) { return "# " + l; });
  lines.push(COLUMNS.join(","));
  rows.forEach(function (r) {
    lines.push(COLUMNS.map(function (c) { return csvCell(cellValue(r, c)); }).join(","));
  });
  download("flame_in_freefall_extract.csv", lines.join("\r\n") + "\r\n", "text/csv");
}

function exportJson(rows, f) {
  const out = {
    note: noteLines(f, rows.length, state.data.conditions.length),
    filters: f,
    columns: COLUMNS,
    rows: rows.map(function (r) {
      const o = {};
      COLUMNS.forEach(function (c) {
        const v = cellValue(r, c);
        o[c] = v === undefined ? null : v;
      });
      return o;
    })
  };
  download("flame_in_freefall_extract.json", JSON.stringify(out, null, 1), "application/json");
}

function checkGroup(label, options, selected, onChange, labelFn) {
  const group = el("div", { class: "checks" });
  options.forEach(function (opt) {
    const box = el("input", { type: "checkbox", value: opt, checked: selected.indexOf(opt) >= 0 });
    box.addEventListener("change", function () {
      const picked = Array.from(group.querySelectorAll("input:checked")).map(function (b) { return b.value; });
      onChange(picked);
    });
    group.appendChild(el("label", null, box, " " + (labelFn ? labelFn(opt) : opt)));
  });
  return el("div", null, label ? el("strong", { class: "small", text: label }) : null, group);
}

function numberField(label, value, onChange) {
  const input = el("input", { type: "number", step: "any", value: value === null ? "" : String(value) });
  input.addEventListener("input", function () { onChange(numOrNull(input.value)); });
  return el("label", { class: "field" }, label, input);
}

function readinessRanges(item) {
  const parts = [];
  [["o2", "Ambient O2", ""], ["pressure", "Pressure", "atm"], ["flow", "Flow", "cm/s"]].forEach(function (a) {
    const r = item.ranges[a[0]];
    parts.push(a[1] + ": " + (r ? rangeText(r, a[2]) : "not recorded"));
  });
  return parts.join("; ");
}

function readinessPanel() {
  const mr = state.data.model_readiness;
  const holder = el("div");
  let envId = state.envId;

  function draw() {
    clear(holder);
    const block = mr.environments[envId];
    const titles = {};
    mr.relationships.forEach(function (rel) { titles[rel.id] = rel.title; });
    const win = block.window;
    holder.appendChild(el("p", { class: "small muted", text: "Window used for " + block.name + ": ambient O2 " + fmt(win.o2.min, 3) + " to " + fmt(win.o2.max, 3) + ", pressure " + fmt(win.pressure_atm.min, 4) + " to " + fmt(win.pressure_atm.max, 4) + " atm, flow " + fmt(win.flow_cm_s.min, 1) + " to " + fmt(win.flow_cm_s.max, 1) + " cm/s, gravity " + fmt(block.gravity_g, 2) + " g." }));
    holder.appendChild(el("div", { class: "table-wrap" }, el("table", { class: "readiness" },
      el("thead", null, el("tr", null, ["Relationship", "Status", "Data behind it", "What would close the gap"].map(function (h) { return el("th", { text: h }); }))),
      el("tbody", null, block.items.map(function (item) {
        const invList = item.investigations.length ? el("ul", null, item.investigations.map(function (i) {
          const inv = invById(i.psi_id);
          return el("li", null, inv ? invLink(inv) : i.psi_id,
            ": " + i.rows + " rows, " + i.response_rows + " with a response, " + i.counted_rows + " counted");
        })) : el("p", { class: "muted", text: "No investigations." });
        return el("tr", { id: "ready-" + item.id },
          el("td", null, el("strong", { text: titles[item.id] })),
          el("td", null, tag(item.status, STATUS_CLASS[item.status]), el("span", { class: "src", text: item.reason })),
          el("td", { class: "small" },
            invList,
            item.investigations.length ? el("p", { class: "small muted", text: readinessRanges(item) + (item.diluents && item.diluents.length ? "; diluents: " + item.diluents.join(", ") : "") + "." }) : null,
            item.investigations.length ? el("a", { href: "#/extractor?" + qs(item.link), text: "Open these rows in the extractor" }) : null),
          el("td", { class: "small", text: item.gap }));
      })))));
  }

  const select = el("select", { id: "readiness-env", onchange: function (e) { envId = e.target.value; draw(); } },
    state.data.environments.environments.map(function (env) {
      return el("option", { value: env.id, text: env.name, selected: env.id === envId });
    }));
  const root = el("div", { class: "panel", id: "model-readiness" },
    el("h2", { text: "Model readiness" }),
    el("p", { text: "Which predictive relationships of flammability and fire scenarios the PSI data can support for each environment, from the data in the unified table." }),
    el("p", { class: "small", text: mr.rule }),
    el("p", { class: "notice", text: mr.no_model_note }),
    el("div", { class: "row-controls" }, el("label", { class: "field" }, "Environment", select)),
    holder);
  draw();
  return root;
}

function renderExtractor(params) {
  const data = state.data;
  const f = filterFromParams(params);
  state.extractor = f;
  const summary = el("p", { class: "small" });
  const chart = el("div", { class: "chart", id: "coverage-chart" });
  const chartNote = el("p", { class: "small muted" });
  const tableHolder = el("div", { class: "table-wrap" });
  let filtered = [];

  function drawChart() {
    const env = data.environments.environments.find(function (e) { return e.id === f.env; });
    const plotRows = filtered.filter(function (r) {
      return COUNTABLE_QUALITY.indexOf(r.value_quality) >= 0 && r.o2_frac !== undefined && r.pressure_atm !== undefined && r.pressure_atm > 0;
    });
    const traces = [];
    Object.keys(FUEL_LABELS).forEach(function (fc) {
      ["ambient", "oxidizer_stream"].forEach(function (basis) {
        const subset = plotRows.filter(function (r) { return (r.fuel_class || "unclassified") === fc && r.o2_basis === basis; });
        if (!subset.length) {
          return;
        }
        traces.push({
          type: "scatter",
          mode: "markers",
          name: FUEL_LABELS[fc] + (basis === "ambient" ? " (ambient O2)" : " (oxidizer-stream O2)"),
          x: subset.map(function (r) { return r.o2_frac; }),
          y: subset.map(function (r) { return r.pressure_atm; }),
          text: subset.map(function (r) { return r.psi_id + " | " + r.source_file + " row " + r.source_row; }),
          hovertemplate: "%{text}<br>O2 %{x}<br>pressure %{y} atm<extra></extra>",
          marker: basis === "ambient"
            ? { color: FUEL_COLORS[fc], size: 6, opacity: 0.7 }
            : { color: FUEL_COLORS[fc], size: 8, symbol: "diamond-open", line: { width: 1.5, color: FUEL_COLORS[fc] } }
        });
      });
    });
    const shapes = [];
    const annotations = [];
    if (env) {
      shapes.push({
        type: "rect", xref: "x", yref: "y",
        x0: env.o2.window_min, x1: env.o2.window_max, y0: env.pressure_atm.window_min, y1: env.pressure_atm.window_max,
        line: { color: "#000000", width: 2, dash: "dash" }, fillcolor: "rgba(0,0,0,0.06)"
      });
      annotations.push({
        x: env.o2.window_max, y: env.pressure_atm.window_max, xref: "x", yref: "y", xanchor: "left", yanchor: "bottom",
        text: env.name + (env.o2.assumption || env.pressure_atm.assumption ? " window (contains assumptions)" : " window"),
        showarrow: false, font: { size: 11 }
      });
    }
    const layout = {
      margin: { l: 60, r: 20, t: 20, b: 60 },
      xaxis: { title: "Oxygen mole fraction (filled: ambient, open diamonds: oxidizer stream)", range: [0.1, 0.9] },
      yaxis: { title: "Pressure (atm)", rangemode: "tozero" },
      shapes: shapes,
      annotations: annotations,
      legend: { orientation: "h", y: -0.25 },
      hovermode: "closest"
    };
    if (window.Plotly) {
      window.Plotly.react(chart, traces, layout, { responsive: true, displaylogo: false });
    } else {
      chart.textContent = "Chart library not loaded.";
    }
    chartNote.textContent = plotRows.length + " rows plotted. " + (filtered.length - plotRows.length) + " matching rows are not plotted because they lack O2 or pressure, or are summary_row, range or ramped rows (a bound or list, not a point).";
  }

  function drawTable() {
    clear(tableHolder);
    const cols = ["psi_id", "fuel_class", "fuel", "o2_frac", "o2_basis", "pressure_atm", "flow_cm_s", "outcome", "value_quality", "source_file", "source_row"];
    tableHolder.appendChild(el("table", null,
      el("thead", null, el("tr", null, cols.map(function (c) { return el("th", { text: c }); }))),
      el("tbody", null, filtered.slice(0, 50).map(function (r) {
        return el("tr", null, cols.map(function (c) { return el("td", { class: "small", text: r[c] === undefined ? "" : String(r[c]) }); }));
      }))));
  }

  function update() {
    filtered = applyFilter(data.conditions, f);
    summary.textContent = filtered.length + " of " + data.conditions.length + " rows match. Filters: " + filterSummary(f) + ".";
    drawChart();
    drawTable();
  }

  const envSelect = el("select", { onchange: function (e) { f.env = e.target.value; drawChart(); } },
    el("option", { value: "none", text: "No window" }),
    data.environments.environments.map(function (env) {
      return el("option", { value: env.id, text: env.name, selected: env.id === f.env });
    }));

  const invOptions = data.investigations.filter(function (i) { return i.row_count > 0; }).map(function (i) { return i.psi_id; });
  const controls = el("div", { class: "panel" },
    el("div", { class: "row-controls" },
      checkGroup("Fuel class", Object.keys(FUEL_LABELS), f.fuel, function (v) { f.fuel = v; update(); }, function (o) { return FUEL_LABELS[o]; }),
      checkGroup("O2 basis", ["ambient", "oxidizer_stream", "none"], f.basis, function (v) { f.basis = v; update(); }),
      checkGroup("Value quality", ["exact", "approximate", "summary_row", "range", "ramped"], f.quality, function (v) { f.quality = v; update(); })),
    el("details", null, el("summary", { text: "Investigations (leave all unchecked for every investigation)" }),
      checkGroup("", invOptions, f.inv, function (v) { f.inv = v; update(); }, function (o) { const i = invById(o); return o + " " + (i ? i.acronym : ""); })),
    el("div", { class: "row-controls" },
      numberField("O2 min", f.o2min, function (v) { f.o2min = v; update(); }),
      numberField("O2 max", f.o2max, function (v) { f.o2max = v; update(); }),
      numberField("Pressure min (atm)", f.pmin, function (v) { f.pmin = v; update(); }),
      numberField("Pressure max (atm)", f.pmax, function (v) { f.pmax = v; update(); }),
      numberField("Flow min (cm/s)", f.fmin, function (v) { f.fmin = v; update(); }),
      numberField("Flow max (cm/s)", f.fmax, function (v) { f.fmax = v; update(); })),
    el("div", { class: "row-controls" },
      el("label", { class: "checks" }, el("input", { type: "checkbox", checked: f.outcome, onchange: function (e) { f.outcome = e.target.checked; update(); } }), " Outcome present"),
      el("label", { class: "field" }, "Environment window on the plot", envSelect)),
    el("p", { class: "small muted", text: "A numeric range excludes rows that have no value for that field. Leave a box empty for no limit." }));

  const root = setView(
    pageHead("extractor", "Data Extractor"),
    el("p", { class: "lede", text: "Filter the unified conditions table, check coverage against an environment window, and download the filtered rows with units, provenance and a validity-domain note. Model readiness below says which modelling relationships the data can support." }),
    readinessPanel(),
    controls,
    summary,
    el("div", { class: "row-controls" },
      el("button", { type: "button", id: "download-csv", text: "Download CSV", onclick: function () { exportCsv(filtered, f); } }),
      el("button", { type: "button", id: "download-json", class: "secondary", text: "Download JSON", onclick: function () { exportJson(filtered, f); } })),
    el("p", { class: "small muted", text: "The group column equals the investigation id. " + data.model_readiness.grouped_validation_note }),
    el("h2", { text: "Coverage: O2 versus pressure" }),
    chart,
    chartNote,
    el("h2", { text: "Table preview (first 50 rows)" }),
    tableHolder
  );
  update();
  return root;
}

function renderFunctions() {
  const order = ["prevention", "detection", "suppression", "fundamental", "unassigned"];
  const sections = order.map(function (fn) {
    const members = state.data.investigations.filter(function (inv) {
      const fns = inv.functions.length ? functionNames(inv) : ["unassigned"];
      return fns.indexOf(fn) >= 0;
    }).sort(function (a, b) {
      const sa = a.functions.some(function (f) { return f.function === fn && f.source === "challenge statement"; }) ? 0 : 1;
      const sb = b.functions.some(function (f) { return f.function === fn && f.source === "challenge statement"; }) ? 0 : 1;
      return sa !== sb ? sa - sb : sortById(a.psi_id, b.psi_id);
    });
    return el("div", { class: "panel" },
      el("h2", { text: fn.charAt(0).toUpperCase() + fn.slice(1) + " (" + members.length + ")" }),
      el("p", { class: "small muted", text: "Equipment area: " + FUNCTION_INFO[fn] + (fn === "unassigned" ? "" : ". This area is the dashboard's mapping, not a PSI field.") }),
      members.length ? el("div", { class: "grid" }, members.map(function (inv) {
        const entry = inv.functions.find(function (f) { return f.function === fn; });
        const basis = entry ? (entry.basis || "No basis text.") : "";
        const trimmed = basis.length > 320 ? basis.slice(0, 320) + " ..." : basis;
        const isPrimary = functionLabel(inv) === fn;
        return el("div", { class: "card" },
          el("h3", null, invLink(inv)),
          el("p", { class: "obj", text: inv.title }),
          el("p", { class: "small" }, tag(FUEL_LABELS[fuelClassOf(inv)]), " ", tag(inv.row_count + " rows"), " ",
            entry ? tag(entry.source, entry.source === "challenge statement" ? "documented" : "inference") : null, " ",
            isPrimary ? tag("primary label", "same") : null),
          fn === "unassigned" ? el("p", { class: "small muted", text: "No fire-safety function has been assigned to this investigation." }) : el("p", { class: "small pre", text: (entry && entry.source === "challenge statement" ? "Challenge statement: \"" + trimmed + "\"" : "Basis: " + trimmed) }),
          inv.functions.length > 1 ? el("p", { class: "small muted", text: "Also listed under: " + functionNames(inv).filter(function (x) { return x !== fn; }).join(", ") + "." }) : null);
      })) : el("p", { class: "muted", text: "No investigations in this group." }));
  });
  return setView(
    pageHead("functions", "Prevention / Detection / Suppression"),
    el("p", { class: "lede", text: "NASA spacecraft fire safety work is organized around prevention, detection and suppression. An investigation is listed under every function it supports. Assignments quoted from the challenge statement come first; the rest are keyword matches on the PSI text and are weaker. The primary label is the challenge-statement assignment if there is one, otherwise the metadata's primary function." }),
    sections
  );
}

function cmpFields() {
  const short = function (text, n) {
    return text && text.length > n ? text.slice(0, n) + " ..." : (text || "not provided");
  };
  return [
    ["Title", function (inv) { return inv.title; }],
    ["Platform", function (inv) { return inv.platform || "not provided"; }],
    ["Hardware", function (inv) { return inv.hardware || "not provided"; }],
    ["Fuel class", function (inv) { return FUEL_LABELS[fuelClassOf(inv)]; }],
    ["Fuels in table rows", function (inv) {
      return inv.fuels_observed.length ? inv.fuels_observed.slice(0, 4).map(function (f) { return f.value; }).join("; ") : "not recorded";
    }],
    ["Sample geometry or burner", function (inv) {
      return inv.sample_geometry.length ? inv.sample_geometry.slice(0, 3).join("; ") : "not recorded";
    }],
    ["Ambient O2 tested", function (inv) { return rangeText(inv.ranges.o2_ambient); }],
    ["Oxidizer-stream O2 tested", function (inv) { return rangeText(inv.ranges.o2_oxidizer_stream); }],
    ["Pressure tested (atm)", function (inv) { return rangeText(inv.ranges.pressure_atm); }],
    ["Flow speed tested (cm/s)", function (inv) { return rangeText(inv.ranges.flow_cm_s); }],
    ["Diluents seen", function (inv) {
      return inv.diluents_observed.length ? inv.diluents_observed.slice(0, 3).map(function (d) { return d.value; }).join("; ") : "not recorded";
    }],
    ["Fields that varied", function (inv) {
      const list = Object.keys(inv.varied).filter(function (k) { return inv.varied[k].status === "varied"; }).map(function (k) { return inv.varied[k].label; });
      return inv.row_count ? (list.length ? list.join("; ") : "none") : "no rows";
    }],
    ["Fields held constant", function (inv) {
      const list = Object.keys(inv.varied).filter(function (k) { return inv.varied[k].status === "held constant"; }).map(function (k) { return inv.varied[k].label; });
      return inv.row_count ? (list.length ? list.join("; ") : "none") : "no rows";
    }],
    ["Measurements", function (inv) { return short(inv.diagnostics_measurements[0], 180); }],
    ["Outcomes recorded", function (inv) {
      return inv.outcomes.length ? inv.outcomes.slice(0, 5).map(function (o) { return o.value; }).join("; ") : "none";
    }],
    ["Fire-safety function", function (inv) { return functionLabel(inv); }],
    ["Rows in unified table", function (inv) { return String(inv.row_count); }]
  ];
}

function renderCompare(params) {
  const selected = listParam(params.ids).filter(function (id) { return invById(id); }).slice(0, 4);
  const boxes = el("div", { class: "checks" });
  state.data.investigations.forEach(function (inv) {
    const box = el("input", { type: "checkbox", value: inv.psi_id, checked: selected.indexOf(inv.psi_id) >= 0 });
    box.addEventListener("change", function () {
      const picked = Array.from(boxes.querySelectorAll("input:checked")).map(function (b) { return b.value; });
      if (picked.length > 4) {
        box.checked = false;
        return;
      }
      location.hash = "#/compare?" + qs({ ids: picked.join(",") });
    });
    boxes.appendChild(el("label", null, box, " " + invLabel(inv)));
  });
  let table = el("p", { class: "muted", text: "Pick at least two investigations (up to four)." });
  if (selected.length >= 2) {
    const invs = selected.map(invById);
    table = el("div", { class: "table-wrap" }, el("table", null,
      el("thead", null, el("tr", null, el("th", { text: "Field" }), invs.map(function (inv) { return el("th", null, invLink(inv)); }), el("th", { text: "Shared or different" }))),
      el("tbody", null, cmpFields().map(function (field) {
        const values = invs.map(field[1]);
        const same = values.every(function (v) { return v === values[0]; });
        return el("tr", { class: same ? "cmp-same" : "cmp-diff" },
          el("th", { text: field[0] }),
          values.map(function (v) { return el("td", { class: "small", text: v }); }),
          el("td", null, tag(same ? "shared" : "different", same ? "same" : "diff")));
      }))));
  }
  return setView(
    pageHead("compare", "Compare"),
    el("p", { class: "lede", text: "Select two to four investigations. Rows are marked shared when every selected investigation has the same value and different otherwise. Test ranges are computed from the unified conditions table." }),
    el("div", { class: "panel" }, boxes),
    table
  );
}

function renderEarth() {
  const apps = state.data.earth.applications.map(function (app) {
    const ids = app.psi_ids.map(invById).filter(Boolean);
    const inferred = app.inference_psi_ids.map(invById).filter(Boolean);
    return el("div", { class: "panel" },
      el("h3", { text: app.application }),
      el("p", null, tag(app.status, "documented")),
      el("p", { text: app.statement }),
      ids.length ? el("p", { class: "small" }, el("strong", { text: "Linked PSI investigations (documented): " }),
        ids.map(function (inv, i) { return [i ? ", " : "", invLink(inv)]; })) : el("p", { class: "small muted", text: "No PSI investigation is documented as the source of this spinoff." }),
      el("p", { class: "small" }, tag("inference", "inference"), " ", app.inference,
        inferred.length ? [" Nearest PSI data: ", inferred.map(function (inv, i) { return [i ? ", " : "", invLink(inv)]; }), "."] : null),
      el("p", { class: "small muted" }, "Sources: ", app.sources.map(function (s, i) {
        return [i ? " | " : "", el("a", { href: s.url, text: s.label })];
      })));
  });
  const records = state.data.investigations.filter(function (inv) { return inv.earth_benefits; });
  const recordList = el("details", null,
    el("summary", { text: "Earth-benefit statements in the PSI records (" + records.length + " investigations)" }),
    el("p", { class: "small muted", text: "These sentences are quoted from each investigation's PSI record, so they are documented by the investigators, not inferred here." }),
    el("ul", null, records.map(function (inv) {
      const text = inv.earth_benefits.length > 360 ? inv.earth_benefits.slice(0, 360) + " ..." : inv.earth_benefits;
      return el("li", null, invLink(inv), ": " + text);
    })));
  return setView(
    pageHead("earth", "On Earth"),
    el("p", { class: "lede", text: "Terrestrial fire-safety applications named in the challenge resources. Each is marked as a documented spinoff or an inference, and tied to a PSI investigation only where a source supports it." }),
    apps,
    recordList
  );
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineMarkdown(raw, citeMap) {
  let out = escapeHtml(raw);
  out = out.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[(\d{1,3})\]/g, function (whole, n) {
    if (!citeMap || !citeMap[n]) {
      return whole;
    }
    return "<a class=\"cite-link\" href=\"#\" data-cite=\"" + n + "\">[" + n + "]</a>";
  });
  return out;
}

function splitTableRow(line) {
  let t = line.trim();
  if (t.charAt(0) === "|") {
    t = t.slice(1);
  }
  if (t.charAt(t.length - 1) === "|") {
    t = t.slice(0, -1);
  }
  return t.split("|").map(function (cell) { return cell.trim(); });
}

function isTableSep(line) {
  if (line === undefined || line.indexOf("|") < 0 || line.indexOf("-") < 0) {
    return false;
  }
  return splitTableRow(line).every(function (cell) { return /^:?-{2,}:?$/.test(cell); });
}

const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;

function startsBlock(line, next) {
  return BULLET_RE.test(line) || ORDERED_RE.test(line) || HEADING_RE.test(line) || (line.indexOf("|") >= 0 && isTableSep(next));
}

function renderMarkdown(text, citeMap) {
  const lines = String(text === undefined || text === null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.indexOf("|") >= 0 && isTableSep(lines[i + 1])) {
      const head = splitTableRow(line);
      const body = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") >= 0) {
        body.push(splitTableRow(lines[i]));
        i += 1;
      }
      html.push("<table><thead><tr>" + head.map(function (c) { return "<th>" + inlineMarkdown(c, citeMap) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        body.map(function (row) {
          return "<tr>" + row.map(function (c) { return "<td>" + inlineMarkdown(c, citeMap) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table>");
      continue;
    }
    const listRe = BULLET_RE.test(line) ? BULLET_RE : ORDERED_RE.test(line) ? ORDERED_RE : null;
    if (listRe) {
      const tagName = listRe === BULLET_RE ? "ul" : "ol";
      const items = [];
      while (i < lines.length && listRe.test(lines[i])) {
        items.push("<li>" + inlineMarkdown(listRe.exec(lines[i])[1], citeMap) + "</li>");
        i += 1;
      }
      html.push("<" + tagName + ">" + items.join("") + "</" + tagName + ">");
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      html.push("<h4>" + inlineMarkdown(heading[1], citeMap) + "</h4>");
      i += 1;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i], lines[i + 1]))) {
      para.push(lines[i].trim());
      i += 1;
    }
    html.push("<p>" + inlineMarkdown(para.join(" "), citeMap) + "</p>");
  }
  return html.join("");
}

function citationMap(citations) {
  const map = {};
  citations.forEach(function (c) { map[String(c.n)] = c; });
  return map;
}

const CITE_PREVIEW_CHARS = 300;

function citationList(citations) {
  return el("ol", { class: "citations" }, citations.map(function (c) {
    const inv = c.psi_id ? invById(c.psi_id) : null;
    const full = String(c.cited_text || "");
    const long = full.length > CITE_PREVIEW_CHARS;
    const quote = el("span", { class: "src cite-quote", text: "\"" + (long ? full.slice(0, CITE_PREVIEW_CHARS) + " ..." : full) + "\"" });
    let open = false;
    const toggle = long ? el("button", { type: "button", class: "secondary small-button", text: "Show more", onclick: function (e) {
      open = !open;
      quote.textContent = "\"" + (open ? full : full.slice(0, CITE_PREVIEW_CHARS) + " ...") + "\"";
      e.target.textContent = open ? "Show less" : "Show more";
    } }) : null;
    return el("li", { value: c.n, id: "cite-" + c.n, tabindex: "-1" },
      inv ? invLink(inv, c.title || invLabel(inv)) : (c.title || "document"), quote, toggle);
  }));
}

function answerView(answer, citations) {
  const body = el("div", { class: "answer" });
  body.innerHTML = renderMarkdown(answer, citationMap(citations));
  body.addEventListener("click", function (e) {
    const n = e.target && e.target.getAttribute ? e.target.getAttribute("data-cite") : null;
    if (!n) {
      return;
    }
    e.preventDefault();
    const target = document.getElementById("cite-" + n);
    if (target) {
      target.scrollIntoView();
      target.focus();
    }
  });
  return body;
}

function renderAsk() {
  const input = el("textarea", { id: "ask-input", maxlength: "1000", placeholder: "For example: Which investigations tested oxygen above 30 percent, and in what fuel class?" });
  const out = el("div", { class: "panel", "aria-live": "polite" }, el("p", { class: "muted", text: "Answers appear here." }));
  const button = el("button", { type: "button", text: "Ask" });

  function show(node) {
    clear(out);
    out.appendChild(node);
  }

  button.addEventListener("click", function () {
    const question = input.value.trim();
    if (!question) {
      show(el("p", { class: "notice", text: "Type a question first." }));
      return;
    }
    button.disabled = true;
    show(el("p", { class: "muted", text: "Reading the investigation documents..." }));
    fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question })
    }).then(function (res) {
      return res.text().then(function (text) {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (err) {
          json = null;
        }
        return { ok: res.ok, status: res.status, json: json };
      });
    }).then(function (result) {
      button.disabled = false;
      if (!result.ok || !result.json || !result.json.answer) {
        const message = result.json && result.json.error ? result.json.error : "The Ask service is not available here (HTTP " + result.status + ").";
        show(el("p", { class: "notice", text: message }));
        return;
      }
      const answer = result.json.answer;
      const citations = result.json.citations || [];
      const notIn = answer.indexOf("Not in the data.") >= 0;
      show(el("div", null,
        notIn ? el("p", null, tag("Not in the data", "assumption")) : null,
        answerView(answer, citations),
        citations.length ? el("div", null, el("h3", { text: "Citations" }), citationList(citations)) : null,
        el("p", { class: "small muted", text: "Model: " + (result.json.model || "unknown") + "." })));
    }).catch(function () {
      button.disabled = false;
      show(el("p", { class: "notice", text: "Could not reach the Ask service. Check your connection and try again." }));
    });
  });

  return setView(
    pageHead("ask", "Ask"),
    el("p", { class: "lede", text: "Ask a question about the PSI combustion investigations. The answer is written only from the loaded investigation documents and cites them; if they do not contain the answer it says so." }),
    el("div", { class: "notice", text: "Disclosure: answers are generated by a super intelligence (SI) model, Claude, restricted to the loaded documents. Check each citation. The model is told never to give partial-gravity numbers or call a condition safe." }),
    input,
    el("p", null, button),
    out
  );
}

function route() {
  const r = parseHash();
  buildNav(r.name === "investigation" ? "investigations" : r.name === "readiness" ? "extractor" : r.name);
  document.title = "Flame in Freefall";
  if (r.name === "investigation") {
    renderInvestigation(r.arg);
  } else if (r.name === "investigations") {
    renderInvestigations();
  } else if (r.name === "habitat") {
    renderHabitat();
  } else if (r.name === "insights") {
    renderInsights();
  } else if (r.name === "extractor") {
    renderExtractor(r.params);
  } else if (r.name === "readiness") {
    renderExtractor(r.params);
  } else if (r.name === "functions") {
    renderFunctions();
  } else if (r.name === "compare") {
    renderCompare(r.params);
  } else if (r.name === "earth") {
    renderEarth();
  } else if (r.name === "ask") {
    renderAsk();
  } else {
    renderOverview();
  }
  window.scrollTo(0, 0);
  if (r.name === "readiness") {
    const target = document.getElementById("model-readiness");
    if (target) {
      target.scrollIntoView();
    }
  }
}

function init() {
  const names = ["investigations", "conditions", "environments", "insights", "earth", "rank_reference", "model_readiness"];
  Promise.all(names.map(loadJson)).then(function (loaded) {
    state.data = {
      investigations: loaded[0].investigations,
      conditions: loaded[1],
      environments: loaded[2],
      insights: loaded[3],
      earth: loaded[4],
      rank_reference: loaded[5],
      model_readiness: loaded[6]
    };
    state.weights = Object.assign({}, state.data.rank_reference.weights);
    parityCheck();
    window.addEventListener("hashchange", route);
    route();
  }).catch(function (err) {
    setView(el("h1", { text: "Data failed to load" }), el("p", { class: "notice", text: String(err.message || err) }));
  });
}

init();
