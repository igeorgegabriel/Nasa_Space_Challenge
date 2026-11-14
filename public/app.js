"use strict";

const REPO_URL = "https://github.com/igeorgegabriel/Nasa_Space_Challenge";

const NAV = [
  ["home", "Home"],
  ["rank", "Rank for a habitat"],
  ["investigations", "Investigations"],
  ["data", "Data & Models"]
];

const NAV_ACTIVE = {
  investigation: "investigations",
  compare: "investigations",
  earth: "investigations",
  verification: "data"
};

const PSIA_PER_ATM = 14.6959;
const KEYWORD_SOURCE = "keyword match on PSI text";
const KEYWORD_MIN_SCORE = 3;
const NOT_SPECIFIED = "not specified by NASA sources";

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

const FUNCTION_ORDER = ["prevention", "detection", "suppression", "fundamental"];

const COMPONENTS = [
  ["fuel", "Fuel realism"],
  ["function", "Fire-safety function"],
  ["richness", "Data richness"],
  ["o2", "O2 coverage"],
  ["pressure", "Pressure coverage"],
  ["flow", "Flow coverage"]
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

const HABITAT_SHORT = {
  iss: "ISS cabin",
  gateway: "Gateway",
  lunar: "Moon base",
  rover: "Pressurized rover",
  mars: "Mars base"
};

const ASK_STORAGE_KEY = "ask_panel_v1";
const ASK_NARROW_PX = 900;
const ASK_HISTORY_TURNS = 3;
const ASK_ANSWER_SEND_CHARS = 1500;
const ASK_MAX_STORED_TURNS = 20;
const ASK_DISCLOSURE = "Answers by an SI model (Claude) from NASA PSI and NTRS documents only, with citations. Says 'Not in the data' when it is not.";

const ASK_SUGGESTIONS = {
  home: [
    "Which solid materials were tested and at what oxygen?",
    "What did FLEX learn about extinguishing flames?",
    "Which investigations studied smoke or fire detection?"
  ],
  investigations: [
    "Which investigations used solid fuels?",
    "What did FLEX learn about extinguishing flames?",
    "Which investigations studied smoke or fire detection?"
  ],
  data: [
    "Which fire-modelling relationships do the PSI data support?",
    "What oxygen and pressure range do the solid-fuel tests cover?",
    "What data is missing to model a fire in a Moon base cabin?"
  ]
};

const askPanel = {
  built: false,
  open: false,
  useContext: true,
  busy: false,
  generation: 0,
  thread: [],
  nodes: {}
};

const RANK_PREVIEW = 10;
const EXTRACT_PREVIEW = 20;

const state = {
  data: null,
  envId: "lunar",
  weights: null,
  includeStream: false,
  showAllRanks: false,
  extractor: null
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

function percent(frac) {
  return fmt(frac * 100, 1);
}

function psia(atm) {
  return atm * PSIA_PER_ATM;
}

function spanText(lo, hi, digits, unit) {
  const a = fmt(lo, digits);
  const b = fmt(hi, digits);
  return (a === b ? a : a + " to " + b) + (unit ? (unit === "%" ? unit : " " + unit) : "");
}

function dashSpan(lo, hi, digits, unit) {
  const a = fmt(lo, digits);
  const b = fmt(hi, digits);
  return (a === b ? a : a + "-" + b) + (unit ? (unit === "%" ? unit : " " + unit) : "");
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
  return inv.name && inv.name !== inv.psi_id ? inv.name : inv.psi_id;
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
  const parts = (split[0] || "home").split("/");
  return { name: parts[0] || "home", arg: parts[1] || null, params: params };
}

function fuelClassOf(inv) {
  return inv.fuel_class || "unclassified";
}

function shownFunctions(inv) {
  const counted = inv.functions.filter(function (f) { return f.counts; }).map(function (f) { return f.function; });
  if (counted.length) {
    return counted;
  }
  return inv.functions.length ? ["fundamental"] : [];
}

function whatStudied(inv) {
  return inv.title && inv.title !== inv.name ? inv.title : inv.summary;
}

function rangeText(block, unit) {
  if (!block) {
    return "not recorded";
  }
  return spanText(block.min, block.max, 4, unit);
}

function o2Text(block) {
  if (!block) {
    return "not recorded";
  }
  return spanText(block.min * 100, block.max * 100, 1, "%");
}

function pressureText(block) {
  if (!block) {
    return "not recorded";
  }
  return spanText(psia(block.min), psia(block.max), 1, "psia");
}

function isSpecified(env, key) {
  const block = env[key];
  if (!block || block.not_specified) {
    return false;
  }
  const lo = block.window_min !== undefined ? block.window_min : block.min;
  const hi = block.window_max !== undefined ? block.window_max : block.max;
  return lo !== null && lo !== undefined && hi !== null && hi !== undefined;
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

function functionCounts(f) {
  if (f.source !== KEYWORD_SOURCE) {
    return true;
  }
  return f.score !== null && f.score !== undefined && f.score >= KEYWORD_MIN_SCORE;
}

function functionRelevance(funcs) {
  const core = ["prevention", "detection", "suppression"];
  const counted = funcs.filter(functionCounts).map(function (f) { return f.function; });
  if (counted.some(function (f) { return core.indexOf(f) >= 0; })) {
    return { value: 1, label: "core" };
  }
  if (funcs.length) {
    const weak = funcs.some(function (f) { return core.indexOf(f.function) >= 0; });
    return { value: 0.4, label: weak ? "weak" : "fundamental" };
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
  let amb = null;
  let stream = null;
  let o2 = null;
  if (isSpecified(env, "o2")) {
    const w = windowOf(env, "o2");
    amb = coverage(w[0], w[1], r.o2_ambient);
    stream = coverage(w[0], w[1], r.o2_oxidizer_stream);
    o2 = includeStream ? Math.max(amb, stream) : amb;
  }
  let pressure = null;
  if (isSpecified(env, "pressure_atm")) {
    const w = windowOf(env, "pressure_atm");
    pressure = coverage(w[0], w[1], r.pressure_atm);
  }
  let flow = null;
  if (isSpecified(env, "flow_cm_s")) {
    const w = windowOf(env, "flow_cm_s");
    flow = coverage(w[0], w[1], r.flow_cm_s);
  }
  const fr = functionRelevance(inv.functions);
  return {
    fuel: fuelRealism(inv.fuel_class),
    function: fr.value,
    function_label: fr.label,
    richness: richness(inv.row_count, inv.outcome_rows),
    o2: o2,
    o2_ambient: amb,
    o2_stream: stream,
    pressure: pressure,
    flow: flow
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

function pageHead(title, sentence) {
  return el("header", { class: "page-head" },
    el("h1", { text: title }),
    sentence ? el("p", { class: "lede", text: sentence }) : null);
}

function expander(label, children, open) {
  return el("details", { class: "exp", open: open ? true : null },
    el("summary", { text: label }),
    el("div", { class: "exp-body" }, children));
}

function tableWrap(table) {
  return el("div", { class: "table-wrap" }, table);
}

function plainTable(headers, rows) {
  return tableWrap(el("table", null,
    el("thead", null, el("tr", null, headers.map(function (h) { return el("th", { text: h }); }))),
    el("tbody", null, rows.map(function (r) {
      return el("tr", null, r.map(function (c) { return el("td", null, c); }));
    }))));
}

function subNav(items, active) {
  return el("nav", { class: "subnav", "aria-label": "Sub-sections" }, items.map(function (item) {
    return el("a", { href: item[0], class: item[2] === active ? "active" : "", text: item[1] });
  }));
}

function buildNav(active) {
  const nav = document.getElementById("nav");
  clear(nav);
  NAV.forEach(function (item) {
    nav.appendChild(el("a", { href: "#/" + item[0], class: item[0] === active ? "active" : "", text: item[1] }));
  });
}

function envSummary(env) {
  const parts = [];
  parts.push(isSpecified(env, "o2") ? "O2 " + dashSpan(env.o2.min * 100, env.o2.max * 100, 1, "%") : "O2 " + NOT_SPECIFIED);
  parts.push(isSpecified(env, "pressure_atm") ? "pressure " + dashSpan(psia(env.pressure_atm.min), psia(env.pressure_atm.max), 1, "psia") : "pressure " + NOT_SPECIFIED);
  parts.push(isSpecified(env, "flow_cm_s") ? "flow " + dashSpan(env.flow_cm_s.min, env.flow_cm_s.max, 1, "cm/s") : "flow " + NOT_SPECIFIED);
  parts.push(env.gravity.g === null || env.gravity.g === undefined ? "gravity " + NOT_SPECIFIED : "gravity " + fmt(env.gravity.g, 3) + " g");
  return parts.join(", ");
}

function envButtons(onPick) {
  const wrap = el("div", { class: "seg", role: "group", "aria-label": "Habitat" });
  state.data.environments.environments.forEach(function (env) {
    const button = el("button", {
      type: "button",
      class: "seg-btn" + (env.id === state.envId ? " active" : ""),
      "aria-pressed": env.id === state.envId ? "true" : "false",
      "data-env": env.id,
      text: env.name
    });
    button.addEventListener("click", function () {
      state.envId = env.id;
      Array.prototype.forEach.call(wrap.children, function (b) {
        const on = b.getAttribute("data-env") === env.id;
        b.className = "seg-btn" + (on ? " active" : "");
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      onPick(env);
      refreshAskPanel();
    });
    wrap.appendChild(button);
  });
  return wrap;
}

function gapMapData() {
  const classes = {};
  const counts = { total: 0, plotted: 0, lane: 0, stream: 0, quality: 0, noO2: 0 };
  state.data.conditions.forEach(function (r) {
    counts.total += 1;
    if (r.o2_frac === undefined) {
      counts.noO2 += 1;
      return;
    }
    if (r.o2_basis !== "ambient") {
      counts.stream += 1;
      return;
    }
    if (COUNTABLE_QUALITY.indexOf(r.value_quality) < 0) {
      counts.quality += 1;
      return;
    }
    const fc = r.fuel_class || "unclassified";
    if (!classes[fc]) {
      classes[fc] = { points: [], lane: [] };
    }
    if (r.pressure_atm !== undefined && r.pressure_atm > 0) {
      classes[fc].points.push(r);
      counts.plotted += 1;
    } else {
      classes[fc].lane.push(r);
      counts.lane += 1;
    }
  });
  return { classes: classes, counts: counts };
}

const LANE_Y = 4;

function habitatBoxes() {
  const groups = [];
  state.data.environments.environments.forEach(function (env) {
    if (!isSpecified(env, "o2") || !isSpecified(env, "pressure_atm")) {
      return;
    }
    const box = {
      x0: env.o2.window_min * 100,
      x1: env.o2.window_max * 100,
      y0: psia(env.pressure_atm.window_min),
      y1: psia(env.pressure_atm.window_max)
    };
    const same = groups.find(function (g) {
      return Math.abs(g.x0 - box.x0) < 1e-6 && Math.abs(g.x1 - box.x1) < 1e-6 && Math.abs(g.y0 - box.y0) < 1e-6 && Math.abs(g.y1 - box.y1) < 1e-6;
    });
    if (same) {
      same.ids.push(env.id);
    } else {
      box.ids = [env.id];
      groups.push(box);
    }
  });
  return groups;
}

function drawGapMap(node) {
  const info = gapMapData();
  const traces = [];
  Object.keys(FUEL_LABELS).forEach(function (fc) {
    const group = info.classes[fc];
    if (!group) {
      return;
    }
    if (group.points.length) {
      traces.push({
        type: "scatter",
        mode: "markers",
        name: FUEL_LABELS[fc],
        legendgroup: fc,
        x: group.points.map(function (r) { return r.o2_frac * 100; }),
        y: group.points.map(function (r) { return psia(r.pressure_atm); }),
        text: group.points.map(function (r) { return r.psi_id + " | row " + r.source_row; }),
        hovertemplate: "%{text}<br>O2 %{x:.1f} percent<br>%{y:.1f} psia<extra></extra>",
        marker: fc === "solid" ? { color: FUEL_COLORS[fc], size: 9, opacity: 0.9 } : { color: FUEL_COLORS[fc], size: 5, opacity: 0.35 }
      });
    }
    if (group.lane.length) {
      traces.push({
        type: "scatter",
        mode: "markers",
        name: FUEL_LABELS[fc],
        legendgroup: fc,
        showlegend: group.points.length === 0,
        x: group.lane.map(function (r) { return r.o2_frac * 100; }),
        y: group.lane.map(function (r, i) { return LANE_Y * (1 + 0.14 * (((i * 7) % 11) - 5) / 5); }),
        text: group.lane.map(function (r) { return r.psi_id + " | row " + r.source_row; }),
        hovertemplate: "%{text}<br>O2 %{x:.1f} percent<br>pressure not recorded<extra></extra>",
        marker: fc === "solid" ? { color: FUEL_COLORS[fc], size: 9, opacity: 0.9 } : { color: FUEL_COLORS[fc], size: 5, opacity: 0.35 }
      });
    }
  });
  const solidGroup = info.classes.solid;
  const solidMax = solidGroup ? Math.max.apply(null, solidGroup.points.concat(solidGroup.lane).map(function (r) { return r.o2_frac * 100; })) : null;
  const shapes = [{
    type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: LANE_Y * 1.28, y1: LANE_Y * 1.28,
    line: { color: "#b8bec4", width: 1, dash: "dot" }
  }];
  const annotations = [];
  habitatBoxes().forEach(function (box) {
    shapes.push({
      type: "rect", xref: "x", yref: "y", x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1,
      line: { color: "#1b1f24", width: 2 }, fillcolor: "rgba(240,180,40,0.35)", layer: "above"
    });
    const label = box.ids.map(function (id) { return HABITAT_SHORT[id] || id; }).join(" / ");
    const below = box.ids.indexOf("lunar") >= 0;
    annotations.push({
      x: (box.x0 + box.x1) / 2, y: Math.log10(below ? box.y0 : box.y1), xref: "x", yref: "y",
      xanchor: "center", yanchor: below ? "top" : "bottom", yshift: below ? -3 : 3,
      text: "<b>" + label + "</b>", showarrow: false, font: { size: 12, color: "#1b1f24" }, bgcolor: "rgba(255,255,255,0.9)"
    });
  });
  if (solidMax !== null && isFinite(solidMax)) {
    shapes.push({
      type: "line", xref: "x", yref: "paper", x0: solidMax, x1: solidMax, y0: 0, y1: 1,
      line: { color: FUEL_COLORS.solid, width: 2, dash: "dash" }
    });
    annotations.push({
      x: solidMax, y: 1, xref: "x", yref: "paper", xanchor: "left", yanchor: "top", xshift: 4,
      text: window.innerWidth < 640 ? "Solids stop at " + solidMax.toFixed(1) + "%" : "Solid materials: none tested above " + solidMax.toFixed(1) + "% O2", showarrow: false,
      font: { size: 12, color: FUEL_COLORS.solid }, bgcolor: "rgba(255,255,255,0.9)"
    });
  }
  annotations.push({
    x: 1, y: Math.log10(LANE_Y), xref: "paper", yref: "y", xanchor: "right", yanchor: "middle",
    text: "pressure not recorded", showarrow: false, font: { size: 11, color: "#5b6672" }
  });
  const small = window.innerWidth < 640;
  const layout = {
    margin: { l: small ? 48 : 60, r: 14, t: 8, b: small ? 50 : 56 },
    xaxis: { title: { text: "Ambient oxygen (percent)", font: { size: 12 } }, range: [10, 42], zeroline: false },
    yaxis: {
      title: { text: "Total pressure (psia)", font: { size: 12 } }, type: "log",
      range: [Math.log10(3), Math.log10(90)],
      tickvals: [7, 10, 15, 30, 60], ticktext: ["7", "10", "15", "30", "60"],
      zeroline: false
    },
    shapes: shapes,
    annotations: annotations,
    legend: { orientation: "h", y: 1.08, x: 0, font: { size: 12 } },
    hovermode: "closest",
    showlegend: true
  };
  if (window.Plotly) {
    window.Plotly.react(node, traces, layout, { responsive: true, displaylogo: false, displayModeBar: false });
  } else {
    node.textContent = "Chart library not loaded.";
  }
  return info.counts;
}

function renderHome() {
  const data = state.data;
  const insight = data.insights.insights.find(function (i) { return i.id === "max_o2_by_fuel_class"; });
  const solid = insight.numbers.max_by_fuel_class.solid;
  const lunar = data.environments.environments.find(function (e) { return e.id === "lunar"; });
  const chart = el("div", { class: "chart hero-chart", id: "gap-map", role: "img", "aria-label": "Oxygen versus pressure of every PSI test, with habitat windows" });
  const notes = el("div");
  const view = setView(
    pageHead("Which NASA fire experiments matter for crews on the Moon and Mars?",
      "Every PSI flame test, placed against the air a crew will breathe."),
    chart,
    el("div", { class: "callout" },
      el("div", { class: "big", text: percent(solid.max_o2) + "%" }),
      el("p", { class: "big-text", text: "highest oxygen any solid material was tested at in PSI. A Moon base runs at " +
        dashSpan(lunar.o2.min * 100, lunar.o2.max * 100, 1, "") + "%." })),
    el("div", { class: "cta" },
      el("a", { class: "btn primary", href: "#/rank", text: "Rank for my habitat" }),
      el("a", { class: "btn", href: "#/investigations", text: "Explore " + data.investigations.length + " investigations" }),
      el("button", { type: "button", class: "btn secondary", text: "Ask the data", onclick: function () { openAskPanel(true); } })),
    expander("How this map is computed", notes)
  );
  const counts = drawGapMap(chart);
  notes.appendChild(el("p", { text: "Each dot is one row of the unified PSI table with an ambient O2 value: " + (counts.plotted + counts.lane) + " rows. " +
    counts.plotted + " also record pressure. " + counts.lane + " record no pressure and sit in the bottom lane." }));
  notes.appendChild(el("p", { text: "Not plotted: " + counts.noO2 + " rows with no O2 value (smoke and dust tests have none), " + counts.stream +
    " rows that give burner-stream O2 (a different quantity from cabin air) and " + counts.quality + " rows that give a range or summary instead of one value." }));
  notes.appendChild(el("p", { text: "Boxes are the habitat atmospheres from NASA sources. A habitat with no box has no sourced O2 and pressure. Highest solid O2: " +
    solid.psi_id + ", " + solid.source_file + ", row " + solid.source_row + "." }));
  return view;
}

function whyLine(inv, item, env) {
  const c = item.components;
  const w = state.weights;
  const r = inv.ranges;
  const phrases = {
    fuel: function () {
      const fc = fuelClassOf(inv);
      return fc === "solid" ? "tests solid fuel" : fc === "liquid_droplet" ? "tests liquid droplets" : fc === "gas" ? "tests gas flames" : "tests " + (FUEL_LABELS[fc] || fc).toLowerCase();
    },
    function: function () {
      const names = shownFunctions(inv);
      return c.function_label === "core" ? "informs " + names.filter(function (n) { return n !== "fundamental"; }).join(" and ") : "supports fundamental science";
    },
    richness: function () {
      return "has " + inv.row_count + " recorded rows";
    },
    o2: function () {
      return "tested ambient O2 " + o2Text(r.o2_ambient) + " near the habitat window";
    },
    pressure: function () {
      return "tested pressure " + pressureText(r.pressure_atm) + " reaching the habitat window";
    },
    flow: function () {
      return "tested flow " + rangeText(r.flow_cm_s, "cm/s") + " reaching the habitat window";
    }
  };
  const strong = COMPONENTS.map(function (comp) { return comp[0]; }).filter(function (name) {
    return c[name] !== null && c[name] !== undefined && w[name] > 0 && c[name] >= 0.5 && !(name === "richness" && c[name] < 0.7);
  }).sort(function (a, b) { return c[b] * w[b] - c[a] * w[a]; }).slice(0, 2);
  let gap = null;
  if (isSpecified(env, "o2") && c.o2 === 0) {
    gap = r.o2_ambient ? "No ambient O2 test reaches the habitat window; the highest is " + percent(r.o2_ambient.max) + "%." : "It records no ambient O2.";
  } else if (isSpecified(env, "pressure_atm") && c.pressure === 0) {
    gap = r.pressure_atm ? "No test lies in the habitat pressure window." : "It records no pressure.";
  } else if (isSpecified(env, "flow_cm_s") && c.flow === 0) {
    gap = r.flow_cm_s ? "No test lies in the habitat flow window." : "It records no flow speed.";
  }
  let text = strong.length ? strong.map(function (n) { return phrases[n](); }).join(" and ") : "has weak topic and condition matches";
  text = text.charAt(0).toUpperCase() + text.slice(1) + ".";
  return gap ? text + " " + gap : text;
}

function rankDetails(inv, item, stability, weights) {
  const c = item.components;
  const rows = COMPONENTS.map(function (comp) {
    const value = c[comp[0]];
    let shown;
    if (value === null || value === undefined) {
      shown = comp[0] === "fuel" ? "not applicable to this fuel class" : NOT_SPECIFIED + ", excluded";
    } else {
      shown = fmt(value, 2) + (comp[0] === "function" ? " (" + c.function_label + ")" : "");
    }
    return [comp[1], shown, fmt(weights[comp[0]], 2)];
  });
  return el("div", { class: "rank-details" },
    el("p", { class: "small" },
      "Topic relevance " + fmt(item.topic, 2) + ", condition match " + fmt(item.condition, 2) + ", overall " + fmt(item.score, 2) +
      ". Rank " + (stability.min === stability.max ? "stays " + item.rank : "ranges " + stability.min + " to " + stability.max) + " when each weight moves 20 percent."),
    plainTable(["Component", "Value", "Weight"], rows),
    c.function_label === "weak" ? el("p", { class: "small muted", text: "Function evidence is a weak keyword match (score below " + KEYWORD_MIN_SCORE + "), so it is scored as fundamental (0.4)." }) : null,
    el("p", { class: "small" }, invLink(inv, "Open " + invLabel(inv))));
}

function envSourcesTable(env) {
  const refs = state.data.environments.sources;
  const row = function (label, block) {
    if (block.not_specified) {
      return [label, NOT_SPECIFIED, block.note ? block.note : "No NASA source found."];
    }
    return [label, block.display, el("span", null, block.sources.map(function (s, i) {
      const ref = refs[s.ref];
      return el("span", { class: "src" }, ref && ref.url ? el("a", { href: ref.url, text: ref.label }) : (ref ? ref.label : s.ref), " - " + s.detail);
    }))];
  };
  return plainTable(["Quantity", "Value", "Source"], [
    row("Oxygen", env.o2),
    row("Total pressure", env.pressure_atm),
    row("Cabin flow speed", env.flow_cm_s),
    row("Gravity", env.gravity)
  ]);
}

function renderTestNext(env) {
  const block = state.data.test_next.environments[env.id];
  const holder = el("section", { class: "test-next", id: "test-next" });
  if (!block) {
    return holder;
  }
  const win = block.windows;
  const conditions = "O2 " + dashSpan(win.o2.min * 100, win.o2.max * 100, 1, "%") + ", " +
    dashSpan(psia(win.pressure_atm.min), psia(win.pressure_atm.max), 1, "psia") +
    (win.flow_cm_s ? ", " + dashSpan(win.flow_cm_s.min, win.flow_cm_s.max, 1, "cm/s") : "");
  let priority = 0;
  const rows = block.classes.map(function (entry) {
    let nearest = "No ambient O2 value recorded for this fuel class.";
    if (entry.nearest) {
      const n = entry.nearest;
      const dir = n.o2_frac < win.o2.min ? "below" : n.o2_frac > win.o2.max ? "above" : "inside";
      const o2 = "O2 " + percent(n.o2_frac) + "%" + (n.o2_gap > 0 ? " (" + fmt(n.o2_gap * 100, 1) + " points " + dir + ")" : " (inside)");
      const pr = n.pressure_atm === null ? "pressure not recorded" : fmt(psia(n.pressure_atm), 1) + " psia";
      const inv = invById(n.psi_id);
      nearest = el("span", null, o2 + ", " + pr + ". ", inv ? invLink(inv, n.psi_id) : n.psi_id, ", row " + n.source_row);
    }
    const inside = el("span", null, String(entry.inside),
      entry.o2_window_no_pressure_rows > 0 ? el("span", { class: "src", text: entry.o2_window_no_pressure_rows + " more match O2 but record no pressure" }) : null);
    const label = entry.inside === 0 ? String(++priority) : "-";
    return [label, FUEL_LABELS[entry.fuel_class], inside, nearest];
  });
  holder.appendChild(el("h2", { text: "What NASA should test next for " + env.name }));
  holder.appendChild(el("p", { class: "lede", text: block.zero_count > 0 ?
    "Conditions this habitat will run at that PSI has never tested." :
    "Every fuel class has at least one PSI test inside this habitat window." }));
  holder.appendChild(el("p", { class: "small muted", text: "Window: " + conditions + "." }));
  holder.appendChild(plainTable(["Priority", "Fuel class", "Tests inside the window", "Nearest tested condition"], rows));
  holder.appendChild(expander("How this table is computed", el("div", null,
    el("p", { text: "A test counts as inside when its ambient O2, its pressure and, where NASA specifies one, its flow speed all lie in the window above. Rows of quality exact or approximate only. A row with no recorded pressure cannot count as inside." }),
    el("p", { text: "Nearest tested condition is the row of that fuel class whose O2 is closest to the window, then pressure, then flow. Priority runs solid, liquid droplet, gas among classes with zero tests." }))));
  return holder;
}

function renderRank() {
  const data = state.data;
  const holder = el("div", { class: "rank-holder" });
  const summary = el("p", { class: "env-line" });
  const testHolder = el("div");
  const sliderHolder = el("div");
  const sourcesHolder = el("div");
  const howHolder = el("div");

  function drawSummary() {
    const env = currentEnv();
    summary.textContent = env.name + " runs at " + envSummary(env) + ".";
  }

  function drawRanking() {
    const env = currentEnv();
    const ranking = rankAll(data.investigations, env, state.weights, state.includeStream);
    const stability = rankStability(data.investigations, env, state.weights, state.includeStream);
    clear(holder);
    const shown = state.showAllRanks ? ranking : ranking.slice(0, RANK_PREVIEW);
    const list = el("ol", { class: "rank-list" }, shown.map(function (item) {
      const inv = invById(item.psi_id);
      return el("li", { class: "rank-item" },
        el("details", { class: "rank-row" },
          el("summary", null,
            el("span", { class: "rank-num", text: String(item.rank) }),
            el("span", { class: "rank-main" },
              el("span", { class: "rank-name", text: invLabel(inv) }),
              el("span", { class: "rank-line", text: whatStudied(inv) }),
              el("span", { class: "rank-why", text: whyLine(inv, item, env) })),
            el("span", { class: "rank-score" },
              el("span", { class: "bar", role: "img", "aria-label": "Overall score " + fmt(item.score, 2) },
                el("span", { class: "bar-fill", style: "width:" + Math.round(item.score * 100) + "%" })),
              el("span", { class: "score-num", text: fmt(item.score, 2) }))),
          rankDetails(inv, item, stability[item.psi_id], state.weights)));
    }));
    holder.appendChild(list);
    if (ranking.length > RANK_PREVIEW) {
      holder.appendChild(el("p", null, el("button", { type: "button", class: "secondary", text: state.showAllRanks ? "Show top " + RANK_PREVIEW : "Show all " + ranking.length, onclick: function () {
        state.showAllRanks = !state.showAllRanks;
        drawRanking();
      } })));
    }
    drawHow(ranking, stability);
  }

  function drawHow(ranking, stability) {
    clear(howHolder);
    const stableCount = ranking.filter(function (i) { return stability[i.psi_id].min === stability[i.psi_id].max; }).length;
    const unscored = data.investigations.filter(function (inv) { return !inv.row_count; });
    const env = currentEnv();
    const unspec = COMPONENTS.filter(function (c) { return CONDITION_NAMES.indexOf(c[0]) >= 0 && !isSpecified(env, c[0] === "pressure" ? "pressure_atm" : c[0] === "flow" ? "flow_cm_s" : "o2"); });
    howHolder.appendChild(expander("How this is computed", el("div", null,
      el("p", { text: "Overall is the weighted average of six components, each 0 to 1: fuel realism (solid 1, liquid droplet 0.5, gas 0.3), fire-safety function, data richness, and how much of the habitat's O2, pressure and flow window the investigation's tests cover." }),
      el("p", { text: "Fire-safety function is 1 for prevention, detection or suppression assigned by the challenge statement or by a keyword match with score " + KEYWORD_MIN_SCORE + " or more. A weaker keyword match or a fundamental-only investigation scores 0.4. No function scores 0.2." }),
      el("p", { text: unspec.length ? "Not specified by NASA sources for this habitat and left out of the score: " + unspec.map(function (c) { return c[1].toLowerCase(); }).join(", ") + ". The remaining weights are renormalized." : "Every condition for this habitat is specified, so all six components count." }),
      el("p", { text: "With each weight moved by 20 percent in turn, " + stableCount + " of " + ranking.length + " investigations keep the same rank." }),
      unscored.length ? el("p", { class: "muted", text: "Not scored, no rows in the unified table: " + unscored.map(invLabel).join(", ") + "." }) : null,
      el("p", { class: "muted", text: "All PSI data is microgravity. This ranks relevance and condition match, not how a fire behaves in the habitat." }))));
  }

  function drawSliders() {
    clear(sliderHolder);
    const env = currentEnv();
    const body = el("div");
    COMPONENTS.forEach(function (c) {
      const key = c[0] === "pressure" ? "pressure_atm" : c[0] === "flow" ? "flow_cm_s" : c[0];
      const off = CONDITION_NAMES.indexOf(c[0]) >= 0 && !isSpecified(env, key);
      const out = el("span", { text: fmt(state.weights[c[0]], 2) });
      const input = el("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(state.weights[c[0]]), "aria-label": c[1] + " weight", disabled: off ? true : null });
      input.addEventListener("input", function () {
        state.weights[c[0]] = parseFloat(input.value);
        out.textContent = fmt(state.weights[c[0]], 2);
        drawRanking();
      });
      body.appendChild(el("div", { class: "slider-row" }, el("label", { text: c[1] + (off ? " (not specified, excluded)" : "") }), input, out));
    });
    body.appendChild(el("label", { class: "check" }, el("input", { type: "checkbox", id: "stream-box", checked: state.includeStream, onchange: function (e) {
      state.includeStream = e.target.checked;
      drawRanking();
    } }), " Count burner-stream O2 as well (a different quantity from ambient O2)"));
    body.appendChild(el("p", null, el("button", { type: "button", class: "secondary", text: "Reset weights", onclick: function () {
      state.weights = Object.assign({}, data.rank_reference.weights);
      state.includeStream = false;
      drawSliders();
      drawRanking();
    } })));
    sliderHolder.appendChild(expander("Adjust weights", body));
  }

  function drawSources() {
    clear(sourcesHolder);
    sourcesHolder.appendChild(expander("Sources for this habitat", envSourcesTable(currentEnv())));
  }

  function drawTest() {
    clear(testHolder);
    testHolder.appendChild(renderTestNext(currentEnv()));
  }

  function drawAll() {
    drawSummary();
    drawRanking();
    drawSliders();
    drawSources();
    drawTest();
  }

  const buttons = envButtons(drawAll);
  const root = setView(
    pageHead("Which fire experiments matter most for this habitat?",
      "Ranked by how closely each PSI test matches the habitat and how useful it is for fire safety."),
    buttons,
    summary,
    holder,
    testHolder,
    sliderHolder,
    howHolder,
    sourcesHolder
  );
  drawAll();
  return root;
}

function keyFindingBlock(finding, compact) {
  const link = finding.url ? el("a", { href: finding.url, text: finding.source || finding.source_label || "source" }) : (finding.source || finding.source_label || "");
  return el("blockquote", { class: "quote" + (compact ? " clamp" : "") },
    el("p", { text: "\"" + finding.quote + "\"" }),
    el("cite", null, link));
}

function renderInvestigations(params) {
  const filters = { fuel: params.fuel || "", fn: params.fn || "" };
  const fuelOptions = Array.from(new Set(state.data.investigations.map(fuelClassOf))).sort();
  const grid = el("div", { class: "cards" });
  const count = el("p", { class: "small muted" });

  function draw() {
    const list = state.data.investigations.filter(function (inv) {
      if (filters.fuel && fuelClassOf(inv) !== filters.fuel) {
        return false;
      }
      if (filters.fn && shownFunctions(inv).indexOf(filters.fn) < 0) {
        return false;
      }
      return true;
    });
    count.textContent = list.length + " of " + state.data.investigations.length + " investigations";
    clear(grid);
    list.forEach(function (inv) {
      const fns = shownFunctions(inv);
      grid.appendChild(el("article", { class: "card" },
        el("h3", null, invLink(inv)),
        el("p", { class: "card-line", text: whatStudied(inv) }),
        el("p", { class: "card-tags" },
          tag(FUEL_LABELS[fuelClassOf(inv)]),
          fns.length ? el("span", { class: "fn-tags", text: fns.join(", ") }) : null,
          inv.row_count ? null : el("span", { class: "muted small", text: " no table rows" })),
        inv.key_findings.length ? keyFindingBlock(inv.key_findings[0], true) : null));
    });
  }

  function select(label, options, key, labelFn) {
    const node = el("select", { "aria-label": label, onchange: function (e) { filters[key] = e.target.value; draw(); } },
      el("option", { value: "", text: label + ": all" }),
      options.map(function (o) { return el("option", { value: o, text: labelFn ? labelFn(o) : o, selected: filters[key] === o }); }));
    return node;
  }

  const view = setView(
    pageHead("What has NASA tested, and what did it find?",
      "The PSI combustion investigations, with the key finding where one is verified."),
    subNav([["#/investigations", "All investigations", "investigations"], ["#/compare", "Compare", "compare"], ["#/earth", "On Earth", "earth"]], "investigations"),
    el("div", { class: "filters" },
      select("Fuel class", fuelOptions, "fuel", function (o) { return FUEL_LABELS[o]; }),
      select("Function", FUNCTION_ORDER, "fn")),
    count,
    grid
  );
  draw();
  return view;
}

function textBlock(value) {
  if (!value) {
    return el("p", { class: "muted", text: "not provided" });
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

function clipText(text, limit) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= limit) {
    return flat;
  }
  const cut = flat.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (stop > limit * 0.5 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(" ")) + " ...");
}

function variedLines(inv) {
  const varied = [];
  const held = [];
  Object.keys(inv.varied).forEach(function (key) {
    const v = inv.varied[key];
    if (v.status === "varied") {
      varied.push(v.label);
    } else if (v.status === "held constant") {
      held.push(v.label + (v.values.length ? " (" + v.values[0] + ")" : ""));
    }
  });
  return { varied: varied, held: held };
}

function renderInvestigation(psiId) {
  const inv = invById(psiId);
  if (!inv) {
    return setView(el("h1", { text: "Investigation not found" }), el("p", null, el("a", { href: "#/investigations", text: "Back to the list" })));
  }
  const r = inv.ranges;
  const vh = variedLines(inv);
  const fns = shownFunctions(inv);
  const objective = inv.objectives || inv.description;
  const pubs = inv.publications.slice(0, 5);
  const restPubs = inv.publications.slice(5);
  const pubItem = function (p) {
    return el("li", null, p.url ? el("a", { href: p.url, text: p.title || p.url }) : (p.title || "untitled"),
      el("span", { class: "src", text: [p.authors, p.year].filter(Boolean).join(" | ") }));
  };
  const ntrs = inv.ntrs_publications.map(function (p) {
    return el("li", null, p.url ? el("a", { href: p.url, text: p.title || p.id }) : p.title,
      el("span", { class: "src", text: "NTRS " + p.id + (p.year ? " | " + p.year : "") }));
  });

  return setView(
    el("p", { class: "small" }, el("a", { href: "#/investigations", text: "All investigations" })),
    pageHead(invLabel(inv), inv.title && inv.title !== invLabel(inv) ? inv.title : null),
    el("p", { class: "card-tags" }, tag(FUEL_LABELS[fuelClassOf(inv)]),
      fns.length ? el("span", { class: "fn-tags", text: fns.join(", ") }) : null,
      el("span", { class: "muted small", text: " " + inv.psi_id + " | " }),
      el("a", { class: "small", href: inv.psi_url, text: "PSI record" })),
    el("h2", { text: "What it studied" }),
    objective ? el("p", { class: "pre-line", text: clipText(objective, 520) }) : el("p", { class: "muted", text: "not provided" }),
    (objective && objective.length > 520) || inv.hypothesis || inv.approach ? expander("Full objective, hypothesis and approach", el("div", null,
      el("div", { class: "pre", text: objective || "" }),
      inv.hypothesis ? el("p", { class: "pre", text: "Hypothesis: " + inv.hypothesis }) : null,
      inv.approach ? el("p", { class: "pre", text: "Approach: " + inv.approach }) : null)) : null,
    inv.key_findings.length ? el("section", null,
      el("h2", { text: "Key findings" }),
      inv.key_findings.map(function (f) { return keyFindingBlock(f, false); }),
      el("p", { class: "small muted", text: "Verbatim from the source; each quote machine-checked against its text." })) : null,
    inv.images.length ? el("section", null,
      el("h2", { text: "NASA photos" }),
      el("div", { class: "photos" }, inv.images.map(function (img) {
        return el("figure", null,
          el("img", { src: img.file, alt: img.caption, loading: "lazy", width: img.width, height: img.height }),
          el("figcaption", { text: img.caption }));
      }))) : null,
    el("h2", { text: "Tested conditions" }),
    inv.row_count ? el("dl", { class: "facts" },
      el("dt", { text: "Ambient O2" }), el("dd", { text: o2Text(r.o2_ambient) }),
      el("dt", { text: "Pressure" }), el("dd", { text: pressureText(r.pressure_atm) }),
      el("dt", { text: "Flow speed" }), el("dd", { text: rangeText(r.flow_cm_s, "cm/s") }),
      el("dt", { text: "Table rows" }), el("dd", { text: inv.row_count + " (" + inv.outcome_rows + " with an outcome)" }))
      : el("p", { class: "muted", text: "No rows in the unified conditions table for this investigation." }),
    inv.row_count ? el("p", { class: "small" }, el("a", { href: "#/data?" + qs({ inv: inv.psi_id, at: "extractor" }), text: "Open these rows in the extractor" })) : null,
    inv.row_count ? el("div", null,
      el("h2", { text: "What varied and what was held constant" }),
      el("p", null, el("strong", { text: "Varied: " }), vh.varied.length ? vh.varied.join(", ") : "nothing recorded"),
      el("p", null, el("strong", { text: "Held constant: " }), vh.held.length ? vh.held.join(", ") : "nothing recorded")) : null,
    el("h2", { text: "Publications" }),
    pubs.length || ntrs.length ? el("ul", null, pubs.map(pubItem), ntrs) : el("p", { class: "muted", text: "none listed" }),
    restPubs.length ? expander("All " + inv.publications.length + " PSI publications", el("ul", null, inv.publications.map(pubItem))) : null,
    expander("Hardware, fuels and measurements", el("div", null,
      el("p", null, el("strong", { text: "Hardware: " }), inv.hardware || "not provided"),
      el("p", null, el("strong", { text: "Platform: " }), inv.platform || "not provided"),
      el("p", null, el("strong", { text: "Fuels in table rows: " }), inv.fuels_observed.length ? inv.fuels_observed.map(function (f) { return f.value + " (" + f.count + ")"; }).join("; ") : "not recorded"),
      el("p", null, el("strong", { text: "Sample geometry: " })), listBlock(inv.sample_geometry, 8),
      el("p", null, el("strong", { text: "Measurements: " })), listBlock(inv.diagnostics_measurements),
      el("p", null, el("strong", { text: "Outcomes: " }), inv.outcomes.length ? inv.outcomes.map(function (o) { return o.value + " (" + o.count + ")"; }).join(", ") : "none recorded"))),
    expander("Fire-safety function evidence", inv.functions.length ? el("ul", null, inv.functions.map(function (f) {
      return el("li", null, el("strong", { text: f.function }),
        f.source === "challenge statement" ? " (challenge statement)" : " (keyword match, score " + f.score + (f.counts ? "" : ", weak evidence") + ")",
        el("span", { class: "src", text: f.basis || "" }));
    })) : el("p", { class: "muted", text: "No function assigned." })),
    inv.row_count ? expander("Row sources and test conditions text", el("div", null,
      el("p", { class: "small", text: inv.psi_id + " | " + inv.source_files.join("; ") }),
      inv.value_quality.length ? el("p", { class: "small", text: "Value quality: " + inv.value_quality.map(function (q) { return q.value + " " + q.count; }).join(", ") }) : null,
      inv.test_conditions_text ? el("p", { class: "pre", text: inv.test_conditions_text }) : null,
      inv.license ? el("p", { class: "small muted", text: "License: " + inv.license }) : null)) : null
  );
}

function cmpFields() {
  const short = function (text, n) {
    return text && text.length > n ? text.slice(0, n) + " ..." : (text || "not provided");
  };
  return [
    ["What it studied", function (inv) { return whatStudied(inv) || "not provided"; }],
    ["Fuel class", function (inv) { return FUEL_LABELS[fuelClassOf(inv)]; }],
    ["Hardware", function (inv) { return inv.hardware || "not provided"; }],
    ["Ambient O2 tested", function (inv) { return o2Text(inv.ranges.o2_ambient); }],
    ["Pressure tested", function (inv) { return pressureText(inv.ranges.pressure_atm); }],
    ["Flow speed tested", function (inv) { return rangeText(inv.ranges.flow_cm_s, "cm/s"); }],
    ["Diluents seen", function (inv) {
      return inv.diluents_observed.length ? inv.diluents_observed.slice(0, 3).map(function (d) { return d.value; }).join("; ") : "not recorded";
    }],
    ["Varied", function (inv) {
      const list = variedLines(inv).varied;
      return inv.row_count ? (list.length ? list.join("; ") : "none") : "no rows";
    }],
    ["Held constant", function (inv) {
      const list = variedLines(inv).held;
      return inv.row_count ? (list.length ? list.join("; ") : "none") : "no rows";
    }],
    ["Measurements", function (inv) { return short(inv.diagnostics_measurements[0], 140); }],
    ["Fire-safety function", function (inv) { return shownFunctions(inv).join(", ") || "none"; }],
    ["Table rows", function (inv) { return String(inv.row_count); }]
  ];
}

function listParam(v) {
  return v ? v.split(",").filter(Boolean) : [];
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
  let table = el("p", { class: "muted", text: "Pick two to four investigations." });
  if (selected.length >= 2) {
    const invs = selected.map(invById);
    table = tableWrap(el("table", { class: "compare" },
      el("thead", null, el("tr", null, el("th", { text: "" }), invs.map(function (inv) { return el("th", null, invLink(inv)); }))),
      el("tbody", null, cmpFields().map(function (field) {
        const values = invs.map(field[1]);
        const same = values.every(function (v) { return v === values[0]; });
        return el("tr", { class: same ? "cmp-same" : "cmp-diff" },
          el("th", { text: field[0] }),
          values.map(function (v) { return el("td", { class: "small", text: v }); }));
      }))));
  }
  return setView(
    pageHead("How do two investigations differ?", "Pick two to four. Shaded rows are identical across your picks."),
    subNav([["#/investigations", "All investigations", "investigations"], ["#/compare", "Compare", "compare"], ["#/earth", "On Earth", "earth"]], "compare"),
    expander("Choose investigations", boxes, selected.length < 2),
    table
  );
}

function renderEarth() {
  const apps = state.data.earth.applications.map(function (app) {
    const ids = app.psi_ids.map(invById).filter(Boolean);
    const near = app.inference_psi_ids.map(invById).filter(Boolean);
    return el("article", { class: "card wide" },
      el("h3", { text: app.application }),
      el("p", { text: app.statement }),
      ids.length ? el("p", { class: "small" }, el("strong", { text: "PSI investigations: " }),
        ids.map(function (inv, i) { return [i ? ", " : "", invLink(inv)]; })) : null,
      near.length ? el("p", { class: "small" }, el("strong", { text: "Closest PSI data, not a direct test: " }),
        near.map(function (inv, i) { return [i ? ", " : "", invLink(inv)]; })) : null,
      el("p", { class: "small muted" }, "Source: ", app.sources.map(function (s, i) {
        return [i ? " | " : "", el("a", { href: s.url, text: s.label })];
      })));
  });
  const records = state.data.investigations.filter(function (inv) { return inv.earth_benefits; });
  return setView(
    pageHead("Where does this research help on Earth?", "Terrestrial uses named in the challenge resources."),
    subNav([["#/investigations", "All investigations", "investigations"], ["#/compare", "Compare", "compare"], ["#/earth", "On Earth", "earth"]], "earth"),
    el("div", { class: "cards" }, apps),
    expander("Earth benefits stated in the PSI records (" + records.length + ")", el("ul", null, records.map(function (inv) {
      return el("li", null, invLink(inv), ": " + clipText(inv.earth_benefits, 360));
    }))));
}

function numOrNull(v) {
  if (v === undefined || v === null || v === "") {
    return null;
  }
  const x = parseFloat(v);
  return Number.isNaN(x) ? null : x;
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
  const o2 = item.ranges.o2;
  const p = item.ranges.pressure;
  const fl = item.ranges.flow;
  parts.push("O2 " + (o2 ? spanText(o2.min * 100, o2.max * 100, 1, "%") : "not recorded"));
  parts.push("pressure " + (p ? spanText(psia(p.min), psia(p.max), 1, "psia") : "not recorded"));
  parts.push("flow " + (fl ? spanText(fl.min, fl.max, 1, "cm/s") : "not recorded"));
  return parts.join("; ");
}

function readinessPanel() {
  const mr = state.data.model_readiness;
  const holder = el("div");
  const titles = {};
  mr.relationships.forEach(function (rel) { titles[rel.id] = rel.title; });

  function draw() {
    clear(holder);
    const block = mr.environments[state.envId];
    holder.appendChild(plainTable(["Relationship", "Status", "Why"], block.items.map(function (item) {
      return [titles[item.id], tag(item.status, STATUS_CLASS[item.status]), item.short];
    })));
    holder.appendChild(expander("Details and what would close each gap", el("div", null, block.items.map(function (item) {
      const invList = item.investigations.length ? el("ul", null, item.investigations.map(function (i) {
        const inv = invById(i.psi_id);
        return el("li", null, inv ? invLink(inv) : i.psi_id,
          ": " + i.rows + " rows, " + i.response_rows + " with a response, " + i.counted_rows + " counted");
      })) : null;
      return el("div", { class: "detail-block", id: "ready-" + item.id },
        el("h3", { text: titles[item.id] }),
        el("p", { class: "small", text: item.reason }),
        invList,
        item.investigations.length ? el("p", { class: "small muted", text: readinessRanges(item) + (item.diluents && item.diluents.length ? "; diluents: " + item.diluents.join(", ") : "") + "." }) : null,
        el("p", { class: "small", text: item.gap }),
        item.investigations.length ? el("a", { class: "small", href: "#/data?" + qs(Object.assign({ at: "extractor" }, item.link)), text: "Open these rows in the extractor" }) : null);
    }))));
    holder.appendChild(expander("How this is computed", el("div", null,
      el("p", { text: mr.rule }),
      el("p", { text: mr.no_model_note }),
      el("p", { text: mr.grouped_validation_note }))));
  }

  const root = el("section", { id: "readiness", class: "section" },
    el("h2", { text: "Can the data support a predictive model for this habitat?" }),
    envButtons(draw),
    holder);
  draw();
  return root;
}

function extractorPanel(params) {
  const data = state.data;
  const f = filterFromParams(params);
  state.extractor = f;
  const summary = el("p", { class: "small" });
  const tableHolder = el("div");
  const filterSummaryNode = el("span");
  let filtered = [];

  function drawTable() {
    clear(tableHolder);
    const cols = ["psi_id", "fuel_class", "o2_frac", "pressure_atm", "flow_cm_s", "outcome", "value_quality", "source_row"];
    tableHolder.appendChild(tableWrap(el("table", { class: "preview" },
      el("thead", null, el("tr", null, cols.map(function (c) { return el("th", { text: c }); }))),
      el("tbody", null, filtered.slice(0, EXTRACT_PREVIEW).map(function (r) {
        return el("tr", null, cols.map(function (c) { return el("td", { class: "small", text: r[c] === undefined ? "" : String(r[c]) }); }));
      })))));
  }

  function update() {
    filtered = applyFilter(data.conditions, f);
    summary.textContent = filtered.length + " of " + data.conditions.length + " rows match. Showing the first " + Math.min(EXTRACT_PREVIEW, filtered.length) + ".";
    filterSummaryNode.textContent = filterSummary(f);
    drawTable();
  }

  const invOptions = data.investigations.filter(function (i) { return i.row_count > 0; }).map(function (i) { return i.psi_id; });
  const controls = el("details", { class: "filters-box", open: params.inv || params.fuel || params.o2min || params.pmin || params.fmin || params.basis ? true : null },
    el("summary", null, "Filters: ", filterSummaryNode),
    el("div", { class: "exp-body" },
      checkGroup("Fuel class", Object.keys(FUEL_LABELS), f.fuel, function (v) { f.fuel = v; update(); }, function (o) { return FUEL_LABELS[o]; }),
      checkGroup("O2 basis", ["ambient", "oxidizer_stream", "none"], f.basis, function (v) { f.basis = v; update(); }),
      checkGroup("Value quality", ["exact", "approximate", "summary_row", "range", "ramped"], f.quality, function (v) { f.quality = v; update(); }),
      checkGroup("Investigations (none checked means all)", invOptions, f.inv, function (v) { f.inv = v; update(); }, function (o) { const i = invById(o); return o + " " + (i ? i.name : ""); }),
      el("div", { class: "row-controls" },
        numberField("O2 min", f.o2min, function (v) { f.o2min = v; update(); }),
        numberField("O2 max", f.o2max, function (v) { f.o2max = v; update(); }),
        numberField("Pressure min (atm)", f.pmin, function (v) { f.pmin = v; update(); }),
        numberField("Pressure max (atm)", f.pmax, function (v) { f.pmax = v; update(); }),
        numberField("Flow min (cm/s)", f.fmin, function (v) { f.fmin = v; update(); }),
        numberField("Flow max (cm/s)", f.fmax, function (v) { f.fmax = v; update(); })),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: f.outcome, onchange: function (e) { f.outcome = e.target.checked; update(); } }), " Outcome present"),
      el("p", { class: "small muted", text: "A numeric range excludes rows with no value for that field." })));

  const root = el("section", { id: "extractor", class: "section" },
    el("h2", { text: "How do I take the data into a model?" }),
    controls,
    summary,
    el("p", { class: "buttons" },
      el("button", { type: "button", id: "download-csv", text: "Download CSV", onclick: function () { exportCsv(filtered, f); } }),
      el("button", { type: "button", id: "download-json", class: "secondary", text: "Download JSON", onclick: function () { exportJson(filtered, f); } })),
    tableHolder,
    expander("How this is computed", el("p", { text: "Every row is a microgravity test with its PSI file and row. The downloads carry units, provenance and a validity note. " + data.model_readiness.grouped_validation_note })));
  update();
  return root;
}

function insightsPanel() {
  const items = state.data.insights.insights.map(function (ins) {
    return el("li", { id: "insight-" + ins.id },
      el("details", { class: "exp" },
        el("summary", { text: ins.headline || ins.title }),
        el("div", { class: "exp-body" },
          el("p", { text: ins.text }),
          insightTable(ins),
          el("p", { class: "small" }, el("strong", { text: "Rows behind it: " }),
            ins.links.map(function (l, i) {
              return [i ? " | " : "", el("a", { href: "#/data?" + qs(Object.assign({ at: "extractor" }, l.params)), text: l.label })];
            })),
          el("p", { class: "small muted" }, el("strong", { text: "Limits: " }), ins.limits))));
  });
  return el("section", { id: "insights", class: "section" },
    el("h2", { text: "What do the numbers say?" }),
    el("ul", { class: "plain-list" }, items));
}

function insightTable(ins) {
  const n = ins.numbers;
  if (ins.id === "max_o2_by_fuel_class") {
    return plainTable(["Fuel class", "Highest ambient O2", "Rows with ambient O2", "Where"],
      Object.keys(n.max_by_fuel_class).map(function (fc) {
        const v = n.max_by_fuel_class[fc];
        return [FUEL_LABELS[fc], percent(v.max_o2) + "%", String(v.rows_with_o2), v.psi_id + " | " + v.source_file + " | row " + v.source_row];
      }));
  }
  if (ins.id === "rows_per_environment_window") {
    return plainTable(["Habitat", "Rows, O2 in window", "Rows, O2 and pressure in window", "Solid", "Liquid droplet", "Gas"],
      Object.keys(n.windows).map(function (id) {
        const w = n.windows[id];
        const byClass = function (fc) {
          return w.by_fuel_class[fc].o2_window + " / " + w.by_fuel_class[fc].o2_and_pressure_window;
        };
        return [w.name, String(w.o2_window_rows), String(w.o2_and_pressure_window_rows), byClass("solid"), byClass("liquid_droplet"), byClass("gas")];
      }));
  }
  if (ins.id === "coverage_gaps") {
    return plainTable(["Habitat", "Fuel classes with zero rows in O2 and pressure window", "Rows in O2 and flow window"],
      Object.keys(n.gaps).map(function (id) {
        const g = n.gaps[id];
        return [g.name, g.fuel_classes_zero_o2_pressure_window.map(function (c) { return FUEL_LABELS[c]; }).join(", ") || "none",
          g.rows_o2_and_flow_window === null ? NOT_SPECIFIED : String(g.rows_o2_and_flow_window)];
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

function verificationSummary() {
  const v = state.data.verification;
  if (!v.present) {
    return null;
  }
  const bits = [];
  if (v.audit) {
    bits.push(v.audit.passed + " of " + v.audit.checked + " audit checks passed against the original PSI files.");
  }
  if (v.quotes) {
    bits.push(v.quotes.verified + " of " + v.quotes.checked + " key-finding quotes found verbatim in their source.");
  }
  return el("section", { id: "verification", class: "section" },
    el("h2", { text: "How was this checked?" }),
    el("p", { text: bits.join(" ") }),
    el("p", null, el("a", { class: "btn", href: "#/verification", text: "Open the full verification" })));
}

function renderData(params) {
  const filterParams = Object.assign({}, params);
  delete filterParams.at;
  const extractor = extractorPanel(filterParams);
  const sections = [["#/data?at=readiness", "Model readiness", "readiness"], ["#/data?at=extractor", "Extractor", "extractor"], ["#/data?at=insights", "Insights", "insights"]];
  const verification = verificationSummary();
  if (verification) {
    sections.push(["#/data?at=verification", "Verification", "verification"]);
  }
  const view = setView(
    pageHead("What can the data support, and how do I use it?", "Model readiness per habitat, the extractor, insights and the verification record."),
    el("nav", { class: "subnav", "aria-label": "On this page" }, sections.map(function (s) {
      return el("a", { href: s[0], text: s[1] });
    })),
    readinessPanel(),
    extractor,
    insightsPanel(),
    verification
  );
  return view;
}

function renderVerification() {
  const v = state.data.verification;
  if (!v.present) {
    return setView(
      pageHead("How was this checked?", "Verification data is not part of this build."),
      el("p", null, el("a", { href: "#/data", text: "Back to Data & Models" })));
  }
  const parts = [pageHead("How was this checked?", "Every unified row is re-read from its original PSI file, and every quote is matched to its source text."),
    el("p", { class: "small" }, el("a", { href: "#/data?at=verification", text: "Back to Data & Models" }))];
  if (v.audit) {
    parts.push(el("h2", { text: "Audit of the unified table" }));
    parts.push(el("p", { text: v.audit.passed + " of " + v.audit.checked + " checks passed, " + v.audit.failed + " failed." + (v.audit.seed ? " Random seed " + v.audit.seed + "." : "") }));
    parts.push(plainTable(["Check", "What it does", "Checked", "Passed", "Failed"], v.audit.checks.map(function (c) {
      return [c.title, c.description, String(c.checked), String(c.passed), String(c.failed)];
    })));
  }
  if (v.quotes) {
    parts.push(el("h2", { text: "Key-finding quotes" }));
    parts.push(el("p", { text: v.quotes.verified + " of " + v.quotes.checked + " quotes were found verbatim in their source text." }));
    parts.push(plainTable(["Investigation", "Source", "Quote", "Verified"], v.quotes.items.map(function (q) {
      const inv = invById(q.psi_id);
      return [inv ? invLink(inv, q.psi_id) : q.psi_id, q.url ? el("a", { href: q.url, text: q.source || "source" }) : q.source, q.quote, q.verified ? "yes" : "no"];
    })));
  }
  return setView.apply(null, parts);
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

function citationList(citations, scope) {
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
    return el("li", { value: c.n, id: "cite-" + scope + "-" + c.n, tabindex: "-1" },
      inv ? invLink(inv, c.title || invLabel(inv)) : (c.title || "document"), quote, toggle);
  }));
}

function answerView(answer, citations, scope) {
  const body = el("div", { class: "answer" });
  body.innerHTML = renderMarkdown(answer, citationMap(citations));
  body.addEventListener("click", function (e) {
    const n = e.target && e.target.getAttribute ? e.target.getAttribute("data-cite") : null;
    if (!n) {
      return;
    }
    e.preventDefault();
    const target = document.getElementById("cite-" + scope + "-" + n);
    if (target) {
      target.scrollIntoView({ block: "nearest" });
      target.focus();
    }
  });
  return body;
}

function contextFromRoute(r, envId) {
  if (r.name === "investigation" && r.arg && invById(r.arg)) {
    return { page: "investigation", psi_id: r.arg };
  }
  if (r.name === "rank") {
    return { page: "rank", habitat: envId };
  }
  if (r.name === "investigations" || r.name === "investigation" || r.name === "compare" || r.name === "earth") {
    return { page: "investigations" };
  }
  if (r.name === "data" || r.name === "verification") {
    return { page: "data" };
  }
  return { page: "home" };
}

function envById(id) {
  return state.data.environments.environments.find(function (e) {
    return e.id === id;
  });
}

function contextLabel(ctx) {
  if (ctx.page === "investigation") {
    return invLabel(invById(ctx.psi_id)) + " (" + ctx.psi_id + ")";
  }
  if (ctx.page === "rank") {
    return "Rank: " + envById(ctx.habitat).name;
  }
  if (ctx.page === "investigations") {
    return "Investigations";
  }
  if (ctx.page === "data") {
    return "Data & Models";
  }
  return "Home";
}

function suggestionsFor(ctx) {
  if (ctx.page === "investigation") {
    const name = invLabel(invById(ctx.psi_id));
    return [
      "What did " + name + " find?",
      "What conditions did " + name + " test?",
      "How is " + name + " relevant to a Moon base?"
    ];
  }
  if (ctx.page === "rank") {
    const env = envById(ctx.habitat);
    const ranking = rankAll(state.data.investigations, env, state.weights, state.includeStream);
    const top = ranking.length ? invLabel(invById(ranking[0].psi_id)) : null;
    return [
      top ? "Why is " + top + " ranked first for " + env.name + "?" : "Which investigations matter most for " + env.name + "?",
      "What should NASA test next for " + env.name + "?",
      "Which solid materials were tested for this habitat?"
    ];
  }
  return (ASK_SUGGESTIONS[ctx.page] || ASK_SUGGESTIONS.home).slice();
}

function askRequestBody(question, ctx, useContext, thread) {
  const body = { question: question };
  if (useContext) {
    body.context = ctx;
  }
  const turns = thread.filter(function (t) {
    return !t.pending && !t.error && typeof t.answer === "string" && t.answer;
  }).slice(-ASK_HISTORY_TURNS).map(function (t) {
    return { question: t.question, answer: t.answer.slice(0, ASK_ANSWER_SEND_CHARS) };
  });
  if (turns.length) {
    body.history = turns;
  }
  return body;
}

function askStorage() {
  try {
    return window.sessionStorage || null;
  } catch (err) {
    return null;
  }
}

function saveAskState() {
  const storage = askStorage();
  if (!storage) {
    return;
  }
  const thread = askPanel.thread.filter(function (t) {
    return !t.pending;
  }).slice(-ASK_MAX_STORED_TURNS).map(function (t) {
    return { question: t.question, answer: t.answer || null, citations: t.citations || [], error: t.error || null };
  });
  try {
    storage.setItem(ASK_STORAGE_KEY, JSON.stringify({ open: askPanel.open, useContext: askPanel.useContext, thread: thread }));
  } catch (err) {
    return;
  }
}

function loadAskState() {
  const storage = askStorage();
  if (!storage) {
    return;
  }
  try {
    const saved = JSON.parse(storage.getItem(ASK_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") {
      return;
    }
    askPanel.open = saved.open === true;
    askPanel.useContext = saved.useContext !== false;
    askPanel.thread = (Array.isArray(saved.thread) ? saved.thread : []).filter(function (t) {
      return t && typeof t.question === "string" && (typeof t.answer === "string" || typeof t.error === "string");
    }).map(function (t) {
      return {
        question: t.question,
        answer: typeof t.answer === "string" ? t.answer : null,
        citations: Array.isArray(t.citations) ? t.citations : [],
        error: typeof t.error === "string" ? t.error : null
      };
    });
  } catch (err) {
    askPanel.thread = [];
  }
}

function askTurnView(turn, index) {
  const scope = "t" + index;
  const kids = [el("div", { class: "ask-q", text: turn.question })];
  if (turn.pending) {
    kids.push(el("p", { class: "ask-status muted", text: "Searching NASA documents..." }));
  } else if (turn.error) {
    kids.push(el("p", { class: "ask-error", role: "alert", text: turn.error }));
  } else {
    const citations = turn.citations || [];
    kids.push(el("div", { class: "ask-a" },
      turn.answer.indexOf("Not in the data.") >= 0 ? el("p", null, tag("Not in the data")) : null,
      answerView(turn.answer, citations, scope),
      citations.length ? el("div", { class: "ask-cites" }, el("p", { class: "small muted", text: "Citations" }), citationList(citations, scope)) : null));
  }
  return el("div", { class: "ask-turn" }, kids);
}

function renderAskThread() {
  const holder = askPanel.nodes.thread;
  clear(holder);
  if (!askPanel.thread.length) {
    holder.appendChild(el("p", { class: "muted small", text: "Ask a question about the NASA PSI combustion investigations." }));
  }
  askPanel.thread.forEach(function (turn, index) {
    holder.appendChild(askTurnView(turn, index));
  });
  const turns = holder.querySelectorAll(".ask-turn");
  holder.scrollTop = turns.length ? turns[turns.length - 1].offsetTop - 4 : 0;
  askPanel.nodes.send.disabled = askPanel.busy;
}

function refreshAskPanel() {
  if (!askPanel.built || !state.data) {
    return;
  }
  const ctx = contextFromRoute(parseHash(), state.envId);
  askPanel.nodes.context.textContent = askPanel.useContext ? "Looking at: " + contextLabel(ctx) : "Page context is off.";
  const box = askPanel.nodes.suggestions;
  clear(box);
  suggestionsFor(ctx).forEach(function (q) {
    box.appendChild(el("button", { type: "button", class: "suggest secondary", text: q, onclick: function () { sendAsk(q); } }));
  });
}

function setAskOpen(open, focus) {
  askPanel.open = open;
  document.body.classList.toggle("ask-open", open);
  askPanel.nodes.toggle.setAttribute("aria-expanded", open ? "true" : "false");
  saveAskState();
  window.dispatchEvent(new Event("resize"));
  if (focus) {
    (open ? askPanel.nodes.input : askPanel.nodes.toggle).focus();
  }
}

function openAskPanel(focus) {
  if (askPanel.built) {
    setAskOpen(true, focus);
  }
}

function closeAskPanel(focus) {
  if (askPanel.built) {
    setAskOpen(false, focus);
  }
}

function newAskConversation() {
  askPanel.generation += 1;
  askPanel.busy = false;
  askPanel.thread = [];
  saveAskState();
  renderAskThread();
  askPanel.nodes.input.focus();
}

function askFailure(result) {
  if (result.json && result.json.error) {
    return result.json.error;
  }
  return "The Ask service is not available here (HTTP " + result.status + ").";
}

function sendAsk(text) {
  const question = String(text || "").trim();
  if (askPanel.busy || !question) {
    return;
  }
  const ctx = contextFromRoute(parseHash(), state.envId);
  const body = askRequestBody(question, ctx, askPanel.useContext, askPanel.thread);
  const turn = { question: question, pending: true, answer: null, citations: [], error: null };
  const generation = askPanel.generation;
  askPanel.thread.push(turn);
  askPanel.busy = true;
  askPanel.nodes.input.value = "";
  renderAskThread();
  function finish() {
    if (generation !== askPanel.generation) {
      return;
    }
    turn.pending = false;
    askPanel.busy = false;
    saveAskState();
    renderAskThread();
  }
  fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (res) {
    return res.text().then(function (raw) {
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch (err) {
        json = null;
      }
      return { ok: res.ok, status: res.status, json: json };
    });
  }).then(function (result) {
    if (!result.ok || !result.json || !result.json.answer) {
      turn.error = askFailure(result);
    } else {
      turn.answer = result.json.answer;
      turn.citations = result.json.citations || [];
    }
    finish();
  }).catch(function () {
    turn.error = "Could not reach the Ask service. Check your connection and try again.";
    finish();
  });
}

function buildAskPanel() {
  const node = document.getElementById("ask-panel");
  const toggle = document.getElementById("ask-open");
  const context = el("p", { class: "ask-context", id: "ask-context" });
  const checkbox = el("input", { type: "checkbox", id: "ask-use-context", checked: askPanel.useContext });
  const thread = el("div", { class: "ask-thread", id: "ask-thread", "aria-live": "polite" });
  const suggestions = el("div", { class: "ask-suggest", id: "ask-suggest" });
  const input = el("textarea", { id: "ask-input", maxlength: "1000", rows: "2", placeholder: "Ask about the PSI combustion investigations", "aria-label": "Your question" });
  const send = el("button", { type: "button", id: "ask-send", text: "Send" });
  askPanel.nodes = { toggle: toggle, context: context, thread: thread, suggestions: suggestions, input: input, send: send };
  checkbox.addEventListener("change", function () {
    askPanel.useContext = checkbox.checked;
    saveAskState();
    refreshAskPanel();
  });
  send.addEventListener("click", function () { sendAsk(input.value); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendAsk(input.value);
    }
  });
  toggle.addEventListener("click", function () { setAskOpen(!askPanel.open, true); });
  toggle.hidden = false;
  node.addEventListener("click", function (e) {
    const link = e.target && e.target.closest ? e.target.closest("a") : null;
    if (link && thread.contains(link) && window.innerWidth < ASK_NARROW_PX) {
      closeAskPanel(false);
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && askPanel.open) {
      closeAskPanel(true);
    }
  });
  appendKids(node, [
    el("div", { class: "ask-head" },
      el("h2", { text: "Ask the data" }),
      el("span", { class: "ask-head-buttons" },
        el("button", { type: "button", class: "secondary small-button", text: "New conversation", onclick: newAskConversation }),
        el("button", { type: "button", class: "secondary small-button", text: "Close", onclick: function () { closeAskPanel(true); } }))),
    context,
    el("label", { class: "ask-check small" }, checkbox, " Use this page as context"),
    thread,
    suggestions,
    el("div", { class: "ask-input-row" }, input, send),
    el("p", { class: "ask-disclosure small muted", text: ASK_DISCLOSURE })
  ]);
  askPanel.built = true;
  renderAskThread();
  document.body.classList.toggle("ask-open", askPanel.open);
  toggle.setAttribute("aria-expanded", askPanel.open ? "true" : "false");
}

function redirectLegacy(r) {
  const rest = qs(r.params);
  const map = {
    overview: "#/home",
    habitat: "#/rank",
    functions: "#/investigations",
    insights: "#/data?at=insights",
    readiness: "#/data?at=readiness",
    extractor: "#/data?" + (rest ? rest + "&" : "") + "at=extractor"
  };
  if (map[r.name]) {
    location.replace(map[r.name]);
    return true;
  }
  return false;
}

function route() {
  const r = parseHash();
  if (redirectLegacy(r)) {
    return;
  }
  if (r.name === "ask") {
    openAskPanel(false);
    location.replace("#/home");
    return;
  }
  buildNav(NAV_ACTIVE[r.name] || r.name);
  document.title = "Flame in Freefall";
  if (r.name === "investigation") {
    renderInvestigation(r.arg);
  } else if (r.name === "investigations") {
    renderInvestigations(r.params);
  } else if (r.name === "rank") {
    renderRank();
  } else if (r.name === "data") {
    renderData(r.params);
  } else if (r.name === "verification") {
    renderVerification();
  } else if (r.name === "compare") {
    renderCompare(r.params);
  } else if (r.name === "earth") {
    renderEarth();
  } else {
    renderHome();
  }
  refreshAskPanel();
  window.scrollTo(0, 0);
  if (r.params.at) {
    const target = document.getElementById(r.params.at);
    if (target) {
      target.scrollIntoView();
    }
  }
}

function init() {
  const names = ["investigations", "conditions", "environments", "insights", "earth", "rank_reference", "model_readiness", "test_next", "verification"];
  Promise.all(names.map(loadJson)).then(function (loaded) {
    state.data = {
      investigations: loaded[0].investigations,
      conditions: loaded[1],
      environments: loaded[2],
      insights: loaded[3],
      earth: loaded[4],
      rank_reference: loaded[5],
      model_readiness: loaded[6],
      test_next: loaded[7],
      verification: loaded[8]
    };
    state.weights = Object.assign({}, state.data.rank_reference.weights);
    parityCheck();
    loadAskState();
    buildAskPanel();
    window.addEventListener("hashchange", route);
    route();
  }).catch(function (err) {
    setView(el("h1", { text: "Data failed to load" }), el("p", { class: "muted", text: String(err.message || err) }));
  });
}

init();
