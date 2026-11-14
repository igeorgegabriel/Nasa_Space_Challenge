"use strict";

const REPO_URL = "https://github.com/igeorgegabriel/Nasa_Space_Challenge";
const TEAM_WHY = "";
const TEAM_URL = "https://www.spaceappschallenge.org/2026/find-a-team/kenyalang-blue-flame/?tab=details";

const NAV = [
  ["home", "Story"],
  ["rank", "Rank"],
  ["investigations", "Investigations"],
  ["data", "Data"]
];

const NAV_ACTIVE = {
  investigation: "investigations",
  compare: "investigations",
  earth: "investigations",
  equipment: "investigations",
  gravity: "data",
  verification: "data",
  brief: "rank"
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
const ASK_INTRO = "Ask about NASA's 24 combustion investigations. Numbers are checked against the data; quotes link to NASA sources.";
const ASK_DISCLOSURE = "AI answers (Claude) from NASA PSI and NTRS data only.";
const ASK_MAX_STEPS = 8;
const ASK_MAX_UNMATCHED = 12;
const ASK_MAX_ACTIONS = 2;
const ASK_MAX_FOLLOWUPS = 2;
const ASK_INPUT_MAX_PX = 120;

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
  timer: null,
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

function isFullBleed(node) {
  return !!(node && node.classList && (node.classList.contains("band") || node.classList.contains("story")));
}

function setView() {
  const view = document.getElementById("view");
  clear(view);
  let wrap = null;
  Array.prototype.slice.call(arguments).forEach(function (item) {
    if (item === null || item === undefined || item === false) {
      return;
    }
    if (isFullBleed(item)) {
      wrap = null;
      view.appendChild(item);
      return;
    }
    if (!wrap) {
      wrap = el("div", { class: "wrap" });
      view.appendChild(wrap);
    }
    appendKids(wrap, [item]);
  });
  return view;
}

function pageHead(title, sentence, extra) {
  return el("header", { class: "band page-head" },
    el("div", { class: "band-in" },
      el("h1", { text: title }),
      sentence ? el("p", { class: "lede", text: sentence }) : null,
      extra || null));
}

function expander(label, children, open, id) {
  return el("details", { class: "drawer", id: id || null, open: open ? true : null },
    el("summary", { text: label || "Details" }),
    el("div", { class: "drawer-body" }, children));
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
    nav.appendChild(el("a", { href: "#/" + item[0], class: item[0] === active ? "active" : "", "aria-current": item[0] === active ? "page" : null, text: item[1] }));
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
  const wrap = el("div", { class: "seg pills", role: "group", "aria-label": "Habitat" });
  state.data.environments.environments.forEach(function (env) {
    const button = el("button", {
      type: "button",
      class: "seg-btn pill" + (env.id === state.envId ? " active" : ""),
      "aria-pressed": env.id === state.envId ? "true" : "false",
      "data-env": env.id,
      text: HABITAT_SHORT[env.id] || env.name
    });
    button.addEventListener("click", function () {
      state.envId = env.id;
      Array.prototype.forEach.call(wrap.children, function (b) {
        const on = b.getAttribute("data-env") === env.id;
        b.className = "seg-btn pill" + (on ? " active" : "");
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      onPick(env);
      refreshAskPanel();
    });
    wrap.appendChild(button);
  });
  return wrap;
}

function sourcedPressure(r) {
  if (r.fuel_class !== "solid") {
    return null;
  }
  return state.data.outside_psi.solid_pressures[r.psi_id] || null;
}

function gapMapData() {
  const classes = {};
  const counts = { total: 0, plotted: 0, sourced: 0, lane: 0, stream: 0, quality: 0, noO2: 0 };
  const sourcedIds = {};
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
    const sourced = sourcedPressure(r);
    if (r.pressure_atm !== undefined && r.pressure_atm > 0) {
      classes[fc].points.push({ r: r, atm: r.pressure_atm, sourced: false });
      counts.plotted += 1;
    } else if (sourced) {
      classes[fc].points.push({ r: r, atm: sourced.pressure_atm, sourced: true });
      counts.sourced += 1;
      sourcedIds[r.psi_id] = true;
    } else {
      classes[fc].lane.push(r);
      counts.lane += 1;
    }
  });
  counts.sourcedIds = Object.keys(sourcedIds).sort(sortById);
  return { classes: classes, counts: counts };
}

const LANE_Y = 4;
const MOBILE_LABEL_SPLIT_O2 = 28;

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
        x: group.points.map(function (p) { return p.r.o2_frac * 100; }),
        y: group.points.map(function (p) { return psia(p.atm); }),
        text: group.points.map(function (p) { return p.r.psi_id + " | row " + p.r.source_row + (p.sourced ? " | pressure from a NASA report" : ""); }),
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
  const outside = state.data.outside_psi;
  const outsidePlotted = outside.tests.filter(function (t) { return t.plotted; });
  if (outsidePlotted.length) {
    traces.push({
      type: "scatter",
      mode: "markers",
      name: "NASA solid tests outside PSI (Saffire IV-VI)",
      x: outsidePlotted.map(function (t) { return t.o2_percent; }),
      y: outsidePlotted.map(function (t) { return t.pressure_psia; }),
      text: outsidePlotted.map(function (t) {
        return t.label + " | " + t.material_short + "<br>O2 " + t.o2_percent.toFixed(1) + " percent, " + t.pressure_psia.toFixed(2) + " psia<br>" +
          t.outcome_short + " | NTRS " + t.source_id;
      }),
      hovertemplate: "%{text}<extra></extra>",
      marker: { symbol: "diamond-open", size: 11, color: FUEL_COLORS.solid, line: { color: FUEL_COLORS.solid, width: 2 } }
    });
  }
  const solidGroup = info.classes.solid;
  const solidMax = solidGroup ? Math.max.apply(null, solidGroup.points.map(function (p) { return p.r; }).concat(solidGroup.lane).map(function (r) { return r.o2_frac * 100; })) : null;
  const shapes = [];
  if (info.counts.lane > 0) {
    shapes.push({
      type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: LANE_Y * 1.28, y1: LANE_Y * 1.28,
      line: { color: "#b8bec4", width: 1, dash: "dot" }
    });
  }
  const annotations = [];
  habitatBoxes().forEach(function (box) {
    shapes.push({
      type: "rect", xref: "x", yref: "y", x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1,
      line: { color: "#1b1f24", width: 2 }, fillcolor: "rgba(240,180,40,0.35)", layer: "above"
    });
    const label = box.ids.map(function (id) { return HABITAT_SHORT[id] || id; }).join(" / ");
    const below = box.ids.indexOf("lunar") >= 0;
    const edgeAlign = window.innerWidth < 640 && !below;
    const rightSide = (box.x0 + box.x1) / 2 >= MOBILE_LABEL_SPLIT_O2;
    annotations.push({
      x: edgeAlign ? (rightSide ? box.x0 : box.x1) : (box.x0 + box.x1) / 2, y: Math.log10(below ? box.y0 : box.y1), xref: "x", yref: "y",
      xanchor: edgeAlign ? (rightSide ? "left" : "right") : "center", yanchor: below ? "top" : "bottom", yshift: below ? -3 : 3,
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
      text: "PSI solids stop at " + solidMax.toFixed(1) + "% O2", showarrow: false,
      font: { size: 12, color: FUEL_COLORS.solid }, bgcolor: "rgba(255,255,255,0.9)"
    });
  }
  if (info.counts.lane > 0) {
    annotations.push({
      x: 1, y: Math.log10(LANE_Y), xref: "paper", yref: "y", xanchor: "right", yanchor: "middle",
      text: "pressure not recorded", showarrow: false, font: { size: 11, color: "#5b6672" }
    });
  }
  const small = window.innerWidth < 640;
  const layout = {
    margin: { l: small ? 48 : 60, r: 14, t: small ? 74 : 8, b: small ? 50 : 56 },
    xaxis: { title: { text: "Ambient oxygen (percent)", font: { size: 12 } }, range: [10, 42], zeroline: false },
    yaxis: {
      title: { text: "Total pressure (psia)", font: { size: 12 } }, type: "log",
      range: [Math.log10(3), Math.log10(90)],
      tickvals: [7, 10, 15, 30, 60], ticktext: ["7", "10", "15", "30", "60"],
      zeroline: false
    },
    shapes: shapes,
    annotations: annotations,
    legend: small ? { orientation: "h", y: 1.02, yanchor: "bottom", x: 0, font: { size: 12 } } : { orientation: "h", y: 1.08, x: 0, font: { size: 12 } },
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

function ntrsLink(url, text) {
  return el("a", { href: url, target: "_blank", rel: "noopener", text: text });
}

function outsideSolidRefs(counts) {
  const refs = state.data.outside_psi.solid_pressures;
  const parts = [];
  counts.sourcedIds.forEach(function (id) {
    const ref = refs[id];
    parts.push(parts.length ? "; " : "", id + " " + ref.name + " " + ref.pressure_text + " (", ntrsLink(ref.source_url, "NTRS " + ref.source_id), ")");
  });
  return parts.length ? parts.concat(["."]) : [];
}

function outsideTestsNote() {
  const out = state.data.outside_psi;
  const missing = out.tests.filter(function (t) { return !t.plotted; });
  const plotted = out.tests.length - missing.length;
  const kids = ["Hollow diamonds are NASA Saffire IV-VI solid tests that are not in PSI (" + plotted + " plotted). "];
  if (missing.length) {
    kids.push("Not plotted, pressure not stated: " + missing.map(function (t) {
      return t.label + " (" + t.material_short + ", " + t.o2_percent.toFixed(1) + "% O2, " + t.outcome_short.toLowerCase() + ")";
    }).join("; ") + ". ");
  }
  kids.push("The dashed line marks the highest O2 of any solid row in PSI.");
  return el("p", null, kids);
}

const ARTEMIS_QUOTE = "[If] you want to get somebody's attention really quick, make the fire alarm go off in your spacecraft when you're still about 80,000 miles from home.";

const STORY_INCIDENTS = [
  ["1967", "Apollo 1", "pre-launch fire", "https://sma.nasa.gov/sma-disciplines/accllp/apollo-1"],
  ["1997", "Mir", "oxygen generator fire", "https://www.nasa.gov/history/25-years-ago-fire-aboard-space-station-mir/"],
  ["Recent", "Artemis II", "smoke alarm", "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/"]
];

const HERO_VIDEO = {
  webm: "video/iss_flame_loop.webm",
  mp4: "video/iss_flame_loop.mp4",
  poster: "video/iss_flame_poster.jpg",
  caption: "Real flame on the ISS: acrylic rod, NASA BASS-II flight test, Feb 2014 (PSI-25)"
};

const HERO_FALLBACK = { src: "img/PSI-25/bass_ii_flame_testing.jpg", alt: "A flame burning in microgravity, photographed during NASA's BASS-II experiment" };

const CHALLENGE_URL = "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/";

let storyObserver = null;
let heroObserver = null;
let gapNode = null;
let gapWidth = 0;
let heroPlayed = false;
let playRun = null;

function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function stopStory() {
  playStop();
  if (storyObserver) {
    storyObserver.disconnect();
    storyObserver = null;
  }
  gapStop();
  if (heroObserver) {
    heroObserver.disconnect();
    heroObserver = null;
  }
}

function heroMedia(hero) {
  const quiet = reduceMotion();
  const video = el("video", { class: "hero-img hero-video", poster: HERO_VIDEO.poster, preload: "metadata", playsinline: "", "aria-hidden": "true", tabindex: "-1" },
    el("source", { src: HERO_VIDEO.webm, type: "video/webm" }),
    el("source", { src: HERO_VIDEO.mp4, type: "video/mp4" }));
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute("muted", "");
  video.loop = true;
  video.playsInline = true;
  let failed = false;
  function fallBack() {
    if (failed) {
      return;
    }
    failed = true;
    const img = el("img", { class: "hero-img hero-fallback", src: HERO_FALLBACK.src, alt: "", "aria-hidden": "true" });
    if (video.parentNode) {
      video.parentNode.replaceChild(img, video);
    }
  }
  video.addEventListener("error", fallBack);
  video.lastChild.addEventListener("error", fallBack);
  if (!quiet) {
    video.autoplay = true;
    video.setAttribute("autoplay", "");
    heroVideoWatch(hero, video);
  }
  return video;
}

function heroVideoWatch(hero, video) {
  if (!window.IntersectionObserver) {
    return;
  }
  heroObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        const p = video.play();
        if (p && p.catch) {
          p.catch(function () {});
        }
      } else {
        video.pause();
      }
    });
  }, { threshold: 0.05 });
  heroObserver.observe(hero);
}

function countUp(node, target, duration) {
  if (reduceMotion()) {
    node.textContent = fmt(target, 0);
    return;
  }
  const start = performance.now();
  const span = duration || 1300;
  function step(now) {
    const u = Math.min(1, (now - start) / span);
    node.textContent = fmt(target * (1 - Math.pow(1 - u, 3)), 0);
    if (u < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function revealSection(section) {
  section.classList.add("in");
  Array.prototype.forEach.call(section.querySelectorAll("[data-count]"), function (n) {
    countUp(n, parseFloat(n.getAttribute("data-count")));
  });
}

function watchStory(sections) {
  stopStory();
  if (reduceMotion() || !window.IntersectionObserver) {
    sections.forEach(revealSection);
    return;
  }
  storyObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        revealSection(entry.target);
        storyObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });
  sections.forEach(function (s) { storyObserver.observe(s); });
}

function rv(index, tagName, props) {
  const merged = Object.assign({}, props || {});
  merged.class = ((merged.class || "") + " rv").trim();
  merged.style = "--i:" + index;
  return el(tagName, merged, Array.prototype.slice.call(arguments, 3));
}

function gapChartData() {
  const all = state.data.conditions.filter(function (r) {
    return r.o2_frac !== undefined && r.o2_frac !== null && r.o2_basis === "ambient";
  });
  const byO2 = function (a, b) { return a.o2_frac - b.o2_frac; };
  const rows = all.filter(function (r) { return r.fuel_class === "solid"; }).sort(byO2);
  const others = all.filter(function (r) { return r.fuel_class !== "solid"; }).sort(byO2);
  const solid = rows.map(function (r) { return r.o2_frac * 100; });
  const lunar = envById("lunar");
  const lo = lunar.o2.window_min !== undefined ? lunar.o2.window_min : lunar.o2.min;
  const hi = lunar.o2.window_max !== undefined ? lunar.o2.window_max : lunar.o2.max;
  return {
    solid: solid,
    rows: rows,
    others: others,
    total: all.length,
    flights: state.data.outside_psi.tests,
    moonLo: lo * 100,
    moonHi: hi * 100,
    moon: envNumber(lunar),
    psiMax: Math.max.apply(null, solid)
  };
}

const GAP_COL = { psi: "#e06d34", fl: "#5b95e8", gray: "#8f9bb8", surf: "#0e152b" };
const GAP_DUR = 900;
const GAP_READ = 3000;
const GAP_FADE = 0.3;
const GAP_STAGES = [0.05, 0.5, 0.62];
let gapPlan = null;
let gapReady = false;
let gapWanted = false;
let gapPlayed = false;
let gapCancel = null;
let gapView = null;
let gapDrawId = 0;

function gapClamp(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function gapEaseOut(u) {
  return 1 - Math.pow(1 - u, 3);
}

function gapEaseIO(u) {
  return 0.5 - 0.5 * Math.cos(Math.PI * u);
}

function swarmPoints(values, xo, r) {
  const placed = [];
  const gap = 2 * r + 1.2;
  return values.map(function (v) {
    const x = xo(v);
    let up = r + 1;
    for (;;) {
      let free = true;
      for (let k = placed.length - 1; k >= 0; k -= 1) {
        const dx = placed[k].x - x;
        if (dx > gap || dx < -gap) {
          continue;
        }
        const dy = placed[k].up - up;
        if (dx * dx + dy * dy < gap * gap) {
          free = false;
          break;
        }
      }
      if (free) {
        break;
      }
      up += 0.5;
    }
    const p = { x: x, up: up, v: v };
    placed.push(p);
    return p;
  });
}

function gapRand(seed) {
  let a = (seed * 2654435761 + 1013904223) >>> 0;
  a = (a + 0x6D2B79F5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function gapKpa(atm) {
  return atm === undefined || atm === null ? null : fmt(atm * 101.325, 1) + " kPa";
}

function gapTipLines(mk) {
  if (mk.kind === "p" || mk.kind === "g") {
    const r = mk.row;
    const lines = [[fmt(r.o2_frac * 100, 1) + "% oxygen", "v"], [(r.investigation || "Unknown investigation") + (r.psi_id ? " (" + r.psi_id + ")" : ""), "n"]];
    if (r.fuel) {
      lines.push([r.fuel + (FUEL_LABELS[r.fuel_class] ? ", " + FUEL_LABELS[r.fuel_class].toLowerCase() : ""), "s"]);
    } else if (FUEL_LABELS[r.fuel_class]) {
      lines.push([FUEL_LABELS[r.fuel_class], "s"]);
    }
    const kpa = gapKpa(r.pressure_atm);
    if (kpa) {
      lines.push(["Pressure " + kpa, "s"]);
    }
    lines.push(["Source " + r.source_file + ", row " + r.source_row, "m"]);
    return lines;
  }
  const t = mk.row;
  const lines = [[fmt(t.o2_percent, 1) + "% oxygen, " + (t.outcome_short || "").toLowerCase(), "v"], [t.label, "n"]];
  if (t.material_short) {
    lines.push([t.material_short, "s"]);
  }
  if (t.pressure_kpa !== undefined && t.pressure_kpa !== null) {
    lines.push(["Pressure " + fmt(t.pressure_kpa, 1) + " kPa", "s"]);
  }
  lines.push(["NTRS " + t.source_id, "m"]);
  return lines;
}

function gapHover(mk) {
  return gapTipLines(mk).map(function (l) {
    const t = plotWrap(l[0], 46);
    return l[1] === "v" ? "<b>" + t + "</b>" : l[1] === "m" ? "<span style=\"color:" + GAP_COL.gray + "\">" + t + "</span>" : t;
  }).join("<br>");
}

function gapBuild(w) {
  const d = gapChartData();
  const small = w < 640;
  const vh = window.innerHeight || 800;
  const H = small ? Math.max(430, Math.min(520, Math.round(vh * 0.62))) : Math.max(420, Math.min(580, Math.round(vh * 0.6)));
  const m = { l: 14, r: 14, t: small ? 78 : 58, b: small ? 134 : 104, pad: 0, autoexpand: false };
  const plotW = Math.max(200, w - m.l - m.r);
  const plotH = H - m.t - m.b;
  const lo = 12;
  const hi = 41;
  const fs = small ? 11 : 12;
  const xo = function (v) { return (v - lo) / (hi - lo) * plotW; };
  const flights = d.flights.slice().sort(function (a, b) { return a.o2_percent - b.o2_percent; });
  const seen = {};
  let rows = 1;
  const fpts = flights.map(function (t) {
    const key = t.o2_percent.toFixed(1);
    seen[key] = seen[key] || 0;
    const row = seen[key];
    seen[key] += 1;
    rows = Math.max(rows, row + 1);
    return { t: t, x: t.o2_percent, y: plotH - 30 - row * 15 };
  });
  const flightsBottom = plotH - 30 - (rows - 1) * 15 - 8;
  const grayTop = flightsBottom - (small ? 38 : 34);
  const grayH = Math.max(34, Math.round(plotH * 0.12));
  const grayBot = grayTop - grayH;
  const gr = small ? 1.9 : 2.7;
  const limit = Math.max(40, grayBot - 12);
  let r = small ? 3 : 4.4;
  let swarm = swarmPoints(d.solid, xo, r);
  while (r > (small ? 2 : 2.6) && Math.max.apply(null, swarm.map(function (p) { return p.up; })) + r > limit) {
    r -= 0.2;
    swarm = swarmPoints(d.solid, xo, r);
  }
  const gray = d.others.map(function (row, i) {
    return { x: row.o2_frac * 100, y: grayBot + gr + gapRand(i + 11) * (grayH - 2 * gr), row: row };
  });
  const burned = fpts.filter(function (f) { return f.t.outcome_short === "Burned"; });
  const open = fpts.filter(function (f) { return f.t.outcome_short !== "Burned"; });
  const flightSize = small ? 9 : 10;
  const order = function (x) { return gapClamp((x - lo) / (hi - lo)); };
  const flightPts = function (list) {
    return list.map(function (f) { return { x: f.x, y: f.y, hover: gapHover({ kind: "f", row: f.t }) }; });
  };
  const series = [
    { name: "PSI solid-fuel tests", pts: swarm.map(function (p, i) { return { x: p.v, y: p.up, hover: gapHover({ kind: "p", row: d.rows[i] }) }; }),
      full: 2 * r, from: 0, span: 0.7, style: { color: GAP_COL.psi, line: { color: GAP_COL.surf, width: 1 } } },
    { name: "Droplet and gas-flame tests", pts: gray.map(function (p) { return { x: p.x, y: p.y, hover: gapHover({ kind: "g", row: p.row }) }; }),
      full: 2 * gr, from: 0, span: 0.7, style: { color: GAP_COL.gray, opacity: 0.78 } },
    { name: "Newest flights, burned", pts: flightPts(burned),
      full: flightSize, from: 0.3, span: 0.6, style: { color: GAP_COL.fl, line: { color: GAP_COL.fl, width: 2 } } },
    { name: "Newest flights, no ignition", pts: flightPts(open),
      full: flightSize, from: 0.3, span: 0.6, style: { color: "rgba(91,149,232,0)", line: { color: GAP_COL.fl, width: 2 } } }
  ].filter(function (s) { return s.pts.length > 0; });
  series.forEach(function (s, i) { s.idx = i; });
  const sizeAt = function (s, t) {
    return s.pts.map(function (p) {
      const e = gapEaseOut(gapClamp(((t - s.from) / s.span) * 1.8 - 0.8 * order(p.x)));
      return Math.round(s.full * e * 100) / 100;
    });
  };
  const fadeAt = function (t, g) {
    return Math.round(gapClamp((t - GAP_STAGES[g]) / GAP_FADE) * 3) / 3;
  };
  const dimY = 24;
  const line = function (x0, x1, y0, y1, color, ref) {
    return { type: "line", xref: "x", yref: ref || "y", x0: x0, x1: x1, y0: y0, y1: y1, line: { color: color, width: 1 } };
  };
  const strong = PLOT_DARK.strong;
  const shapeDefs = [
    { g: 1, s: { type: "rect", xref: "x", yref: "paper", x0: d.psiMax, x1: hi, y0: 0, y1: 1, fillcolor: "rgba(255,255,255,0.035)", line: { width: 0 }, layer: "below" } },
    { g: 1, s: Object.assign(line(d.psiMax, d.psiMax, 0, 1, PLOT_DARK.text, "paper"), { line: { color: PLOT_DARK.text, width: 1, dash: "dash" } }) },
    { g: 2, s: { type: "rect", xref: "x", yref: "paper", x0: d.moonLo, x1: d.moonHi, y0: 0, y1: 1, fillcolor: "rgba(255,255,255,0.08)", line: { width: 0 }, layer: "below" } },
    { g: 2, s: line(d.moonLo, d.moonLo, 0, 1, "rgba(255,255,255,0.45)", "paper") },
    { g: 2, s: line(d.moonHi, d.moonHi, 0, 1, "rgba(255,255,255,0.45)", "paper") },
    { g: 2, s: line(d.psiMax, d.moon, dimY, dimY, strong) },
    { g: 2, s: line(d.psiMax, d.psiMax, dimY - 5, dimY + 5, strong) },
    { g: 2, s: line(d.moon, d.moon, dimY - 5, dimY + 5, strong) }
  ];
  const note = function (g, a) {
    return { g: g, a: Object.assign({ showarrow: false, xref: "x", yref: "y", xanchor: "center", yanchor: "bottom" }, a) };
  };
  const labelFont = { size: fs + 1, color: strong };
  const pct = fmt(d.psiMax, 1) + "%";
  const annDefs = [
    note(0, { xref: "paper", x: 0, xanchor: "left", y: plotH, yanchor: "top", text: "Newest flights, not in PSI", font: { size: fs, color: PLOT_DARK.muted } }),
    note(0, { xref: "paper", x: 0, xanchor: "left", y: grayTop + 4, text: "Droplet and gas flames", font: { size: fs, color: PLOT_DARK.muted } }),
    note(1, { x: d.psiMax, yref: "paper", y: 1, yshift: 6, text: small ? "Highest PSI solid<br>test: " + pct : "<b>Highest PSI solid test: " + pct + "</b>", font: labelFont }),
    note(2, { x: d.moon, yref: "paper", y: 1, yshift: 6, text: small ? "Moon base air:<br>" + d.moon + "%" : "<b>Moon base air: " + d.moon + "%</b>", font: labelFont }),
    note(2, { x: (d.psiMax + d.moon) / 2, y: dimY + 8, text: small ? "Untested by PSI:<br>" + pct + " to " + d.moon + "%" : "<b>Untested by PSI: " + pct + " to " + d.moon + "%</b>", font: labelFont })
  ];
  const ticks = [];
  for (let v = lo; v <= 40; v += small ? 4 : 2) {
    ticks.push(v);
  }
  const label = "Oxygen axis from " + lo + " to " + hi + " percent: " + d.total + " NASA flame tests. " + d.solid.length + " PSI solid-fuel tests end at " + pct + " percent while droplet and gas flames go on to " + fmt(d.others[d.others.length - 1].o2_frac * 100, 0) +
    " percent. Newest NASA flights burned solids up to " + fmt(Math.max.apply(null, burned.map(function (f) { return f.x; })), 1) + " percent, Moon base air is " + d.moon + " percent. Hover a dot to read the test.";
  return {
    H: H,
    label: label,
    series: series,
    traces: function (t) {
      return series.map(function (s) {
        return {
          type: "scatter",
          mode: "markers",
          name: s.name,
          x: s.pts.map(function (p) { return p.x; }),
          y: s.pts.map(function (p) { return p.y; }),
          text: s.pts.map(function (p) { return p.hover; }),
          hovertemplate: "%{text}<extra></extra>",
          marker: Object.assign({ size: t >= 1 ? s.full : sizeAt(s, t) }, s.style)
        };
      });
    },
    layout: function (t) {
      return Object.assign(plotBase(PLOT_DARK), {
        height: H,
        margin: m,
        dragmode: small ? false : "zoom",
        hoverdistance: 14,
        xaxis: {
          range: [lo, hi], tickvals: ticks, fixedrange: small, zeroline: false, showgrid: true, gridcolor: PLOT_DARK.grid, gridwidth: 1,
          showline: true, linecolor: PLOT_DARK.axis, ticks: "", tickfont: { size: fs, color: PLOT_DARK.muted },
          title: { text: "Oxygen in the air (percent)", font: { size: fs, color: PLOT_DARK.muted }, standoff: 8 }
        },
        yaxis: { range: [0, plotH], visible: false, fixedrange: true, showgrid: false, zeroline: false },
        legend: { orientation: "h", x: 0, xref: "container", y: 0, yref: "container", yanchor: "bottom", font: { size: fs, color: PLOT_DARK.text }, bgcolor: "rgba(0,0,0,0)", itemsizing: "constant" },
        showlegend: true,
        shapes: shapeDefs.map(function (s) { return Object.assign({ opacity: fadeAt(t, s.g) }, s.s); }),
        annotations: annDefs.map(function (a) { return Object.assign({ opacity: fadeAt(t, a.g) }, a.a); })
      });
    },
    frame: function (t, prev) {
      const upd = {};
      [0, 1, 2].forEach(function (g) {
        const op = fadeAt(t, g);
        if (op === prev[g]) {
          return;
        }
        prev[g] = op;
        shapeDefs.forEach(function (s, i) { if (s.g === g) { upd["shapes[" + i + "].opacity"] = op; } });
        annDefs.forEach(function (a, i) { if (a.g === g) { upd["annotations[" + i + "].opacity"] = op; } });
      });
      return { sizes: series.map(function (s) { return t >= 1 ? s.full : sizeAt(s, t); }), layout: upd };
    }
  };
}

function gapPlay(node, plan) {
  gapPlayed = true;
  const idx = plan.series.map(function (s) { return s.idx; });
  const prev = [0, 0, 0];
  gapCancel = plotRun(GAP_DUR, function (t) {
    const f = plan.frame(t, prev);
    return window.Plotly.restyle(node, { "marker.size": f.sizes }, idx).then(function () {
      return Object.keys(f.layout).length ? window.Plotly.relayout(node, f.layout) : null;
    });
  }, function () { gapCancel = null; });
}

function drawGapChart(node) {
  const id = gapDrawId + 1;
  gapDrawId = id;
  gapWidth = node.clientWidth;
  const plan = gapBuild(Math.max(280, Math.floor(node.clientWidth || 320)));
  node.style.height = plan.H + "px";
  node.setAttribute("aria-label", plan.label);
  if (gapCancel) {
    gapCancel();
    gapCancel = null;
  }
  gapReady = false;
  loadPlotly().then(function () {
    if (id !== gapDrawId || gapNode !== node || !document.body.contains(node)) {
      return null;
    }
    if (reduceMotion()) {
      gapPlayed = true;
    }
    const t = gapPlayed ? 1 : 0;
    return window.Plotly.react(node, plan.traces(t), plan.layout(t), plotConfig()).then(function () {
      if (id !== gapDrawId) {
        return;
      }
      gapPlan = plan;
      gapReady = true;
      if (gapWanted && !gapPlayed) {
        gapPlay(node, plan);
      }
    });
  }).catch(function () {
    node.textContent = "Chart library not loaded.";
  });
}

function gapWatch(node) {
  gapView = plotWatch(node, 0.3, function () {
    gapView = null;
    gapWanted = true;
    if (gapReady && !gapPlayed) {
      gapPlay(node, gapPlan);
    }
  });
}

function gapStop() {
  if (gapCancel) {
    gapCancel();
    gapCancel = null;
  }
  if (gapView) {
    gapView.disconnect();
    gapView = null;
  }
  if (gapNode && window.Plotly) {
    window.Plotly.purge(gapNode);
  }
  gapDrawId += 1;
  gapNode = null;
  gapPlan = null;
  gapReady = false;
  gapWanted = false;
  gapPlayed = false;
}

function headerH() {
  const header = document.querySelector(".top");
  return header ? header.offsetHeight : 0;
}

function playStop(natural) {
  if (!playRun) {
    return;
  }
  const run = playRun;
  playRun = null;
  cancelAnimationFrame(run.raf);
  clearTimeout(run.timer);
  ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (t) {
    window.removeEventListener(t, run.stop, true);
  });
  window.removeEventListener("scroll", run.onScroll);
  if (run.onEnd) {
    run.onEnd(natural === true);
  }
}

function playWords(sel) {
  const words = [];
  sel.forEach(function (s) {
    const n = document.querySelector(s);
    if (n) {
      words.push(n.textContent.trim());
    }
  });
  const text = words.join(" ").trim();
  return text ? text.split(/\s+/).length : 0;
}

function playDwell(words) {
  return Math.max(2000, 700 + 200 * words);
}

function playPoints() {
  const hdr = headerH();
  const at = function (sel) {
    const n = document.querySelector(sel);
    return n ? Math.max(0, n.getBoundingClientRect().top + window.scrollY - hdr) : null;
  };
  const pts = [];
  [["#s-quote", ["#s-quote .big-quote p"]], ["#s-air", ["#s-air h2", "#s-air .story-line"]]].forEach(function (p) {
    const y = at(p[0]);
    if (y !== null) {
      pts.push({ y: y, dwell: playDwell(playWords(p[1])), settle: 600 });
    }
  });
  const gapY = at("#s-gap");
  const gapChart = document.querySelector("#s-gap .gap");
  const gapNote = document.querySelector("#s-gap .gap-note");
  if (gapY !== null && gapChart && gapNote) {
    const floor = tour.open && tour.node ? tour.node.getBoundingClientRect().top : window.innerHeight;
    const seen = Math.max(gapY, Math.min(gapChart.getBoundingClientRect().top + window.scrollY - hdr, gapNote.getBoundingClientRect().bottom + window.scrollY - floor + 12));
    pts.push({ y: seen, dwell: playDwell(playWords(["#s-gap h2", "#s-gap .story-sub", "#s-gap .gap-note"])) + GAP_READ, settle: GAP_DUR });
  }
  [["#s-grav", ["#s-grav h2", "#s-grav .story-line"]], ["#s-next", []]].forEach(function (p) {
    const y = at(p[0]);
    if (y !== null) {
      pts.push({ y: y, dwell: p[1].length ? playDwell(playWords(p[1])) : 0, settle: p[1].length ? 600 : 0 });
    }
  });
  return pts;
}

function playStory(onEnd) {
  if (playRun) {
    playStop();
  }
  const pts = playPoints();
  const run = { raf: 0, timer: 0, expect: window.scrollY, armed: false, asked: window.scrollY, stop: null, onScroll: null, onEnd: onEnd || null };
  run.stop = function (e) {
    if (e && e.target instanceof Node && tour.node && tour.node.contains(e.target)) {
      return;
    }
    playStop();
  };
  run.onScroll = function () {
    if (playRun === run && run.armed && Math.abs(window.scrollY - run.expect) > 6 && Math.abs(window.scrollY - run.asked) > 6) {
      playStop();
    }
  };
  playRun = run;
  ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (t) {
    window.addEventListener(t, run.stop, { capture: true, passive: true });
  });
  window.addEventListener("scroll", run.onScroll, { passive: true });
  function put(y) {
    run.asked = y;
    run.armed = true;
    window.scrollTo({ top: y, behavior: "instant" });
    run.expect = window.scrollY;
  }
  function next(i) {
    if (playRun !== run) {
      return;
    }
    if (i >= pts.length) {
      playStop(true);
      return;
    }
    const p = pts[i];
    const from = window.scrollY;
    const dist = Math.abs(p.y - from);
    function dwell() {
      if (i === pts.length - 1) {
        playStop(true);
        return;
      }
      run.timer = setTimeout(function () { next(i + 1); }, p.settle + p.dwell);
    }
    if (reduceMotion() || dist < 2) {
      put(p.y);
      dwell();
      return;
    }
    const dur = Math.max(700, Math.min(1600, 500 + 0.45 * dist));
    const t0 = performance.now();
    function step(now) {
      if (playRun !== run) {
        return;
      }
      const u = Math.min(1, (now - t0) / dur);
      put(from + (p.y - from) * gapEaseIO(u));
      if (u < 1) {
        run.raf = requestAnimationFrame(step);
      } else {
        dwell();
      }
    }
    run.raf = requestAnimationFrame(step);
  }
  run.timer = setTimeout(function () { next(0); }, 150);
}

function heroIntro(hero) {
  const nums = Array.prototype.slice.call(hero.querySelectorAll(".hv-num, .hv-tot"));
  const targets = nums.map(function (n) { return parseFloat(n.textContent.replace(/,/g, "")); });
  nums.forEach(function (n) { n.textContent = "0"; });
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      hero.classList.add("in");
      setTimeout(function () {
        nums.forEach(function (n, i) { countUp(n, targets[i], 700); });
      }, 250);
    });
  });
}

function bandRow(label, value, scale, cls, index) {
  return rv(index, "div", { class: "bar-row " + cls },
    el("div", { class: "bar-label", text: label }),
    el("div", { class: "bar-line" },
      el("span", { class: "bar-fill", style: "--k:" + (value / scale).toFixed(4) }),
      el("span", { class: "bar-num" }, el("span", { "data-count": String(value), text: String(value) }), "%")));
}

function nearestText(entry) {
  const n = entry.nearest;
  if (!n) {
    return "nearest: no ambient O2 recorded";
  }
  const inv = invById(n.psi_id);
  return "nearest: " + (inv ? invLabel(inv) : n.psi_id) + ", " + percent(n.o2_frac) + "% O2" +
    (n.pressure_atm !== null && n.pressure_atm !== undefined ? ", " + fmt(psia(n.pressure_atm), 1) + " psia" : "");
}

const NEXT_LABELS = { solid: "Solid", liquid_droplet: "Liquid droplet", gas: "Gas" };

function nextCard(entry, index) {
  const o = entry.outside_nearest;
  return rv(index, "article", { class: "tcard" + (entry.inside === 0 ? " zero" : "") },
    el("h3", { text: NEXT_LABELS[entry.fuel_class] || FUEL_LABELS[entry.fuel_class] }),
    el("p", { class: "tcard-num", text: String(entry.inside) }),
    el("p", { class: "tcard-unit", text: entry.inside === 1 ? "test" : "tests" }),
    el("p", { class: "tcard-near", text: nearestText(entry) }),
    o ? el("p", { class: "tcard-out" }, o.label + " " + Math.round(o.o2_frac * 100) + "% (outside PSI)") : null);
}

function testNextSection(env) {
  const block = state.data.test_next.environments[env.id];
  const holder = el("section", { class: "test-next", id: "test-next" });
  if (!block) {
    return holder;
  }
  holder.appendChild(el("p", { class: "eyebrow", text: env.name }));
  holder.appendChild(el("h2", { text: "What NASA should test next" }));
  holder.appendChild(el("div", { class: "tcards" }, block.classes.map(nextCard)));
  holder.appendChild(el("p", { class: "cta" }, el("a", { class: "btn", href: "#/brief?habitat=" + encodeURIComponent(env.id), text: "Printable test request" })));
  holder.appendChild(expander("Details", el("div", null,
    el("p", { class: "small", text: "Window: " + testNextConditions(block.windows) + "." }),
    plainTable(TEST_NEXT_HEADERS, testNextRows(block, false)),
    el("p", { class: "small", text: "A test counts as inside when its ambient O2, its pressure and, where NASA specifies one, its flow speed all lie in the window. Rows of quality exact or approximate only. A row with no recorded pressure cannot count as inside." }),
    el("p", { class: "small", text: "Nearest tested condition is the row of that fuel class whose O2 is closest to the window, then pressure, then flow. Nearest NASA test outside PSI is shown for solids only and is never counted." }))));
  holder.appendChild(planSection());
  return holder;
}

const PLAN_COL = { solid: "#e06d34", liquid_droplet: "#5b95e8", gas: "#9fb0d6" };
const PLAN_ENV_COL = ["#f2c14e", "#7fd1b9", "#c792ea", "#82aaff", "#ff8a80"];
const PLAN_X = [12, 42];
const PLAN_Y = [3.4, 50];
const PLAN_DUR = 700;
const CLASS_ORDER_PLAN = ["solid", "liquid_droplet", "gas"];
const planUi = { fuel: "solid", played: false, node: null, pills: null, list: null, note: null, legend: null };

function planRange(block, scale, digits, unit) {
  return block ? dashSpan(block.min * scale, block.max * scale, digits, unit) : null;
}

function planWhere(t) {
  const parts = [planRange(t.o2, 100, 1, "%"), planRange(t.pressure_atm, PSIA_PER_ATM, 1, "psia")];
  parts.push(t.flow_cm_s ? planRange(t.flow_cm_s, 1, 1, "cm/s") : "flow " + NOT_SPECIFIED);
  return parts.join(", ");
}

function planNearText(t) {
  const n = t.nearest;
  if (!n) {
    return "No PSI test of this fuel class has an O2 value.";
  }
  const o2 = fmt(n.o2_frac * 100, 1) + "% O2";
  const p = n.pressure_atm === null ? "pressure not recorded" : fmt(psia(n.pressure_atm), 1) + " psia" + (n.pressure_sourced ? " (from a NASA report)" : "");
  const away = n.pressure_gap_psia === null ? fmt(n.o2_gap_points, 1) + " O2 points away" : fmt(n.o2_gap_points, 1) + " O2 points and " + fmt(n.pressure_gap_psia, 1) + " psia away";
  return "Nearest PSI test: " + n.psi_id + " " + (n.investigation || "") + ", row " + n.source_row + ", " + o2 + ", " + p + " (" + away + ").";
}

function planHover(t) {
  const lines = [
    "Test " + t.rank + " | " + (NEXT_LABELS[t.fuel_class] || t.fuel_class),
    planWhere(t),
    "Closes: " + t.habitat_names.join(", "),
    planNearText(t),
    t.gravity.note
  ];
  return lines.map(function (l) { return plotWrap(l, 56); }).join("<br>");
}

function planIsCountable(r, fc) {
  return r.fuel_class === fc && r.o2_basis === "ambient" && (r.value_quality === "exact" || r.value_quality === "approximate") && r.o2_frac !== null && r.o2_frac !== undefined;
}

function planAtm(r) {
  if (r.pressure_atm && r.pressure_atm > 0) {
    return r.pressure_atm;
  }
  const sourced = sourcedPressure(r);
  return sourced ? sourced.pressure_atm : null;
}

function planRows(fc) {
  return state.data.conditions.filter(function (r) {
    return planIsCountable(r, fc) && planAtm(r) !== null;
  });
}

function planLaneRows(fc) {
  return state.data.conditions.filter(function (r) {
    return planIsCountable(r, fc) && planAtm(r) === null;
  });
}

function planSourcedCount(fc) {
  return planRows(fc).filter(function (r) { return !(r.pressure_atm && r.pressure_atm > 0); }).length;
}

function planClassTotal(fc) {
  return state.data.conditions.filter(function (r) { return planIsCountable(r, fc); }).length;
}

function planTraces(fc, t) {
  const plan = state.data.test_plan;
  const rows = planRows(fc);
  const lane = planLaneRows(fc);
  const grow = function (full) { return Math.round(full * gapEaseOut(gapClamp(t)) * 100) / 100; };
  const traces = [{
    type: "scatter", mode: "markers", name: "PSI tests (" + rows.length + ")",
    x: rows.map(function (r) { return r.o2_frac * 100; }),
    y: rows.map(function (r) { return psia(planAtm(r)); }),
    text: rows.map(function (r) { return airRowHover(r, r.pressure_atm && r.pressure_atm > 0 ? "" : " | pressure from a NASA report", planAtm(r)); }),
    hovertemplate: "%{text}<extra></extra>",
    marker: { color: PLAN_COL[fc], size: grow(6), opacity: 0.35, line: { width: 0 } }
  }, {
    type: "scatter", mode: "markers", name: "No pressure (" + lane.length + ")",
    x: lane.map(function (r) { return r.o2_frac * 100; }),
    y: lane.map(function (r, i) { return AIR_LANE_Y * (1 + 0.06 * (((i * 7) % 11) - 5) / 5); }),
    text: lane.map(function (r) { return airRowHover(r, "", null); }),
    hovertemplate: "%{text}<extra></extra>",
    marker: { color: PLAN_COL[fc], size: grow(6), opacity: 0.5, line: { width: 0 } }
  }];
  Object.keys(plan.windows).forEach(function (id, i) {
    const w = plan.windows[id];
    const x0 = w.o2.min * 100;
    const x1 = w.o2.max * 100;
    const y0 = psia(w.pressure_atm.min);
    const y1 = psia(w.pressure_atm.max);
    const col = PLAN_ENV_COL[i % PLAN_ENV_COL.length];
    const flow = w.flow_cm_s ? ", flow " + dashSpan(w.flow_cm_s.min, w.flow_cm_s.max, 1, "cm/s") : ", flow not specified";
    traces.push({
      type: "scatter", mode: "lines", name: w.name,
      x: [x0, x1, x1, x0, x0], y: [y0, y0, y1, y1, y0],
      fill: "toself", fillcolor: plotRgba(col, 0.1), hoveron: "fills+points",
      line: { color: col, width: 2 },
      text: plotEscape(w.name) + "<br>O2 " + dashSpan(x0, x1, 1, "%") + ", " + dashSpan(y0, y1, 1, "psia") + flow + "<br>" + plotEscape(w.gravity),
      hovertemplate: "%{text}<extra></extra>"
    });
  });
  const tests = plan.tests.filter(function (x) { return x.fuel_class === fc; });
  traces.push({
    type: "scatter", mode: "markers+text", name: "Planned test",
    x: tests.map(function (x) { return x.point.o2 * 100; }),
    y: tests.map(function (x) { return psia(x.point.pressure_atm); }),
    text: tests.map(function (x) { return String(x.rank); }),
    textposition: "middle center", textfont: { color: "#0b1020", size: 11, family: PLOT_FONT },
    hovertext: tests.map(planHover),
    hovertemplate: "%{hovertext}<extra></extra>",
    marker: { symbol: "circle", color: "#ffffff", size: grow(20), line: { color: PLAN_COL[fc], width: 3 } }
  });
  return traces;
}

function planLayout() {
  const small = window.innerWidth < 640;
  const fs = small ? 11 : 12;
  const ticks = [4, 6, 8, 10, 15, 25, 45];
  return Object.assign(plotBase(PLOT_DARK), {
    height: small ? 400 : 440,
    margin: { l: small ? 42 : 52, r: 12, t: 12, b: small ? 46 : 52, pad: 0, autoexpand: false },
    dragmode: false,
    hoverdistance: 14,
    xaxis: {
      range: PLAN_X, fixedrange: true, zeroline: false, showgrid: true, gridcolor: PLOT_DARK.grid, showline: true, linecolor: PLOT_DARK.axis, ticks: "",
      tickvals: [15, 20, 25, 30, 35, 40], tickfont: { size: fs, color: PLOT_DARK.muted },
      title: { text: "Oxygen (percent)", font: { size: fs, color: PLOT_DARK.muted }, standoff: 8 }
    },
    yaxis: {
      type: "log", range: [Math.log10(PLAN_Y[0]), Math.log10(PLAN_Y[1])], fixedrange: true, zeroline: false, showgrid: true, gridcolor: PLOT_DARK.grid, showline: true, linecolor: PLOT_DARK.axis, ticks: "",
      tickvals: ticks, ticktext: ticks.map(String), tickfont: { size: fs, color: PLOT_DARK.muted },
      title: { text: "Pressure (psia)", font: { size: fs, color: PLOT_DARK.muted }, standoff: 6 }
    },
    showlegend: false
  });
}

function planLegend(fc) {
  const chip = function (kind, color, label) {
    return el("span", { class: "plan-key" }, el("span", { class: "plan-sw " + kind, style: kind === "box" ? "border-color:" + color : "background:" + color + (kind === "ring" ? ";border-color:" + PLAN_COL[fc] : "") }), label);
  };
  const items = [chip("dot", PLAN_COL[fc], "PSI tests (" + planRows(fc).length + ")")];
  if (planLaneRows(fc).length) {
    items.push(chip("dot faint", PLAN_COL[fc], "No pressure recorded (" + planLaneRows(fc).length + ")"));
  }
  Object.keys(state.data.test_plan.windows).forEach(function (id, i) {
    items.push(chip("box", PLAN_ENV_COL[i % PLAN_ENV_COL.length], state.data.test_plan.windows[id].name));
  });
  items.push(chip("ring", "#ffffff", "Planned test"));
  clear(planUi.legend);
  items.forEach(function (it) { planUi.legend.appendChild(it); });
}

function planDraw() {
  const node = planUi.node;
  if (!node || !document.body.contains(node)) {
    return;
  }
  const fc = planUi.fuel;
  const play = !planUi.played && !reduceMotion();
  planLegend(fc);
  const sourced = planSourcedCount(fc);
  const recorded = planRows(fc).length - sourced;
  const laneCount = planLaneRows(fc).length;
  planUi.note.textContent = planClassTotal(fc) + " " + (NEXT_LABELS[fc] || fc).toLowerCase() + " PSI rows have a single O2 value." +
    (recorded ? " " + recorded + " record a pressure in PSI." : "") +
    (sourced ? " " + sourced + " are plotted at the pressure NASA reports state." : "") +
    (laneCount ? " " + laneCount + " sit in the bottom lane." : "");
  window.Plotly.react(node, planTraces(fc, play ? 0 : 1), planLayout(), plotConfig()).then(function () {
    planUi.played = true;
    if (!play) {
      return;
    }
    const last = node.data.length - 1;
    plotRun(PLAN_DUR, function (t) {
      const k = gapEaseOut(gapClamp(t));
      return window.Plotly.restyle(node, { "marker.size": [Math.round(6 * k * 100) / 100, Math.round(6 * k * 100) / 100, Math.round(20 * k * 100) / 100] }, [0, 1, last]);
    });
  });
}

function planSelect(fc) {
  planUi.fuel = fc;
  Array.prototype.forEach.call(planUi.pills.children, function (b) {
    b.classList.toggle("active", b.getAttribute("data-key") === fc);
    b.setAttribute("aria-pressed", b.getAttribute("data-key") === fc ? "true" : "false");
  });
  Array.prototype.forEach.call(planUi.list.children, function (li) {
    li.classList.toggle("on", li.getAttribute("data-fuel") === fc);
  });
  planDraw();
}

const PLAN_COLUMNS = [
  "rank", "fuel_class", "o2_min_percent", "o2_max_percent", "pressure_min_psia", "pressure_max_psia", "pressure_min_atm", "pressure_max_atm",
  "flow_min_cm_s", "flow_max_cm_s", "flow_note", "habitats_closed", "habitat_ids", "gravity_note",
  "nearest_psi_id", "nearest_investigation", "nearest_source_file", "nearest_source_row", "nearest_o2_percent", "nearest_pressure_psia", "nearest_pressure_from_report",
  "nearest_o2_gap_points", "nearest_pressure_gap_psia", "nearest_distance", "source_ids"
];

function planCsvRow(t) {
  const n = t.nearest || {};
  const blank = function (v) { return v === null || v === undefined ? "" : v; };
  const rnd = function (v, d) { return v === null || v === undefined ? "" : Number(v.toFixed(d)); };
  return [
    t.rank, t.fuel_class, rnd(t.o2.min * 100, 2), rnd(t.o2.max * 100, 2), rnd(psia(t.pressure_atm.min), 2), rnd(psia(t.pressure_atm.max), 2), t.pressure_atm.min, t.pressure_atm.max,
    t.flow_cm_s ? t.flow_cm_s.min : "", t.flow_cm_s ? t.flow_cm_s.max : "", blank(t.flow_note), t.habitat_names.join("; "), t.habitats.join("; "), t.gravity.note,
    blank(n.psi_id), blank(n.investigation), blank(n.source_file), blank(n.source_row), n.o2_frac === undefined ? "" : rnd(n.o2_frac * 100, 2),
    n.pressure_atm === null || n.pressure_atm === undefined ? "" : rnd(psia(n.pressure_atm), 2), n.pressure_sourced ? "yes" : "no", blank(n.o2_gap_points),
    blank(n.pressure_gap_psia), blank(n.distance), t.source_refs.join("; ")
  ];
}

function planCsvText() {
  const plan = state.data.test_plan;
  const lines = [
    "# Derived test matrix: " + plan.headline.text + ". Boxes are overlaps of NASA habitat windows (environments.json); the nearest test is a PSI row of the unified table.",
    "# Distance is derived: sqrt(O2 gap in points squared + pressure gap in psia squared). Solid rows without a PSI pressure use the pressure in the NASA report for that flight.",
    PLAN_COLUMNS.join(",")
  ];
  plan.tests.forEach(function (t) {
    lines.push(planCsvRow(t).map(csvCell).join(","));
  });
  return lines.join("\r\n") + "\r\n";
}

function planSection() {
  const plan = state.data.test_plan;
  const holder = el("div", { class: "plan", id: "test-plan" });
  holder.appendChild(el("h3", { text: "Fly these tests first" }));
  holder.appendChild(el("p", { class: "plan-head", id: "plan-head", text: plan.headline.text }));
  const list = el("ol", { class: "plan-list" }, plan.tests.map(function (t) {
    return el("li", { class: "plan-item" + (t.fuel_class === planUi.fuel ? " on" : ""), "data-fuel": t.fuel_class, "data-id": t.id },
      el("button", { type: "button", class: "plan-pick", onclick: function () { planSelect(t.fuel_class); } },
        el("span", { class: "plan-rank", text: String(t.rank) }),
        el("span", { class: "plan-body" },
          el("span", { class: "plan-what" }, el("strong", { text: NEXT_LABELS[t.fuel_class] || t.fuel_class }), " " + t.habitat_names.join(", ")),
          el("span", { class: "plan-where", text: planWhere(t) }),
          el("span", { class: "plan-near", text: planNearText(t) }))));
  }));
  const pills = el("div", { class: "pills plan-pills", role: "group", "aria-label": "Fuel class" }, CLASS_ORDER_PLAN.map(function (fc) {
    return el("button", { type: "button", class: "pill" + (fc === planUi.fuel ? " active" : ""), "data-key": fc, "aria-pressed": fc === planUi.fuel ? "true" : "false", text: NEXT_LABELS[fc], onclick: function () { planSelect(fc); } });
  }));
  const node = el("div", { class: "plan-plot", role: "img", "aria-label": "Oxygen and pressure of existing PSI tests, habitat windows and planned tests" });
  const note = el("p", { class: "small muted plan-note" });
  const legend = el("div", { class: "plan-legend" });
  planUi.legend = legend;
  planUi.node = node;
  planUi.pills = pills;
  planUi.list = list;
  planUi.note = note;
  holder.appendChild(el("div", { class: "plan-grid" },
    el("div", { class: "plan-side" }, list),
    el("div", { class: "plan-viz" }, pills, legend, node, note)));
  holder.appendChild(el("p", { class: "cta" }, el("button", { type: "button", class: "btn", id: "plan-csv", text: "Download test matrix (CSV)", onclick: function () { download("flame_in_freefall_test_matrix.csv", planCsvText(), "text/csv"); } })));
  holder.appendChild(expander("How this is derived", el("div", null,
    plan.method.map(function (m) { return el("p", { class: "small", text: m }); }),
    plainTable(["Test", "Habitat", "Gravity", "Sources"], plan.tests.map(function (t) {
      return [t.rank + " " + (NEXT_LABELS[t.fuel_class] || t.fuel_class), t.habitat_names.join(", "), t.gravity.note, t.source_refs.join(", ")];
    })))));
  plotWhenVisible(node, planDraw);
  return holder;
}

function gapCaption() {
  const d = gapChartData();
  return d.total + " tests by oxygen. PSI solids stop at " + fmt(d.psiMax, 1) + "%, Moon base air is " + d.moon + "%.";
}

function gapDetails(lunar) {
  const d = gapChartData();
  const insight = state.data.insights.insights.find(function (i) { return i.id === "max_o2_by_fuel_class"; });
  const solid = insight.numbers.max_by_fuel_class.solid;
  const tests = state.data.outside_psi.tests;
  return expander("Details", el("div", null,
    el("p", { text: "Each orange or gray dot is one row of the unified PSI table with an ambient O2 value: " + d.solid.length + " solid-fuel rows in orange, " + d.others.length + " droplet and gas-flame rows in gray. The dashed line marks the highest, " + solid.psi_id + ", " + solid.source_file + ", row " + solid.source_row + "." }),
    el("p", { text: "Blue dots are the " + tests.length + " NASA Saffire IV-VI solid tests that are not in PSI; a ring means it did not ignite. The band is the Moon base O2 window, " + dashSpan(d.moonLo, d.moonHi, 1, "%") + "." }),
    plainTable(["Test", "Material", "O2", "Pressure", "Outcome", "Source"], tests.map(function (t) {
      return [t.label, t.material_short, t.o2_percent.toFixed(1) + "%", t.pressure_psia === null ? "not stated" : t.pressure_psia.toFixed(2) + " psia",
        t.outcome_short, ntrsLink(t.source_url, "NTRS " + t.source_id)];
    })),
    el("p", { class: "small muted", text: "Solid pressures and outcomes come from NASA reports, not the PSI table. Air-composition sources are under Moon base air." })));
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tagName, attrs) {
  const node = document.createElementNS(SVG_NS, tagName);
  Object.keys(attrs || {}).forEach(function (key) {
    node.setAttribute(key, attrs[key]);
  });
  return node;
}

function scMark(kind) {
  const svg = svgEl("svg", { class: "sc-glyph", viewBox: "0 0 12 12", width: "14", height: "14", "aria-hidden": "true", focusable: "false" });
  const d = kind === "ok" ? "M2.5 6.5 L5 9 L9.5 3.5" : (kind === "no" ? "M3 3 L9 9 M9 3 L3 9" : "M3 6 L9 6");
  svg.appendChild(svgEl("path", { d: d }));
  return el("span", { class: "sc-mark " + kind, "aria-hidden": "true" }, svg);
}

function scRow(kind, name, kids, srcText) {
  const label = kind === "ok" ? "matches" : (kind === "no" ? "does not match" : "not recorded");
  return el("li", { class: "sc-row " + kind },
    scMark(kind),
    el("div", { class: "sc-row-body" },
      el("p", { class: "sc-row-line" },
        el("strong", { class: "sc-cond", text: name }),
        el("span", { class: "sc-sr", text: " (" + label + ") " }),
        kids),
      srcText ? el("p", { class: "sc-src", text: srcText }) : null));
}

function scenarioRows(entry, block) {
  const win = block.windows;
  const n = entry.nearest;
  const inv = n ? invById(n.psi_id) : null;
  const rows = [];
  const o2Here = dashSpan(win.o2.min * 100, win.o2.max * 100, 1, "%");
  if (!n) {
    rows.push(scRow("no", "Oxygen", o2Here + " here - no NASA test with an O2 value recorded", null));
  } else {
    rows.push(scRow(n.o2_gap === 0 ? "ok" : "no", "Oxygen",
      [o2Here + " here - closest NASA test " + percent(n.o2_frac) + "% (", inv ? invLink(inv) : n.psi_id, ")"],
      n.psi_id + " table, row " + n.source_row));
  }
  if (!win.pressure_atm) {
    rows.push(scRow("na", "Pressure", "not specified for this habitat", null));
  } else {
    const here = dashSpan(psia(win.pressure_atm.min), psia(win.pressure_atm.max), 1, "psia");
    if (!n || n.pressure_atm === null || n.pressure_atm === undefined) {
      rows.push(scRow("na", "Pressure", here + " here - not recorded in that test", null));
    } else {
      rows.push(scRow(n.pressure_gap_atm === 0 ? "ok" : "no", "Pressure", here + " here - closest test " + fmt(psia(n.pressure_atm), 1) + " psia", null));
    }
  }
  if (!win.flow_cm_s) {
    rows.push(scRow("na", "Airflow", "not specified for this habitat", null));
  } else {
    const here = dashSpan(win.flow_cm_s.min, win.flow_cm_s.max, 1, "cm/s");
    if (!n || n.flow_cm_s === null || n.flow_cm_s === undefined) {
      rows.push(scRow("na", "Airflow", here + " here - not recorded in that test", null));
    } else {
      const within = n.flow_cm_s >= win.flow_cm_s.min && n.flow_cm_s <= win.flow_cm_s.max;
      rows.push(scRow(within ? "ok" : "no", "Airflow", here + " here - closest test " + fmt(n.flow_cm_s, 1) + " cm/s", null));
    }
  }
  return rows;
}

function scenarioVerdict(entry, rows) {
  const kinds = rows.map(function (r) { return r.className.replace("sc-row ", ""); });
  const names = ["Oxygen", "pressure", "airflow"];
  const matched = names.filter(function (n, i) { return kinds[i] === "ok"; });
  const missing = names.filter(function (n, i) { return kinds[i] === "na"; });
  const partly = entry.inside === 0 && kinds.indexOf("no") < 0 && matched.length > 0;
  const listText = function (list) { return list.length > 1 ? list.slice(0, -1).join(", ") + " and " + list[list.length - 1] : list[0]; };
  const capital = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
  const word = entry.inside > 0 ? "Tested" : (partly ? "Partly tested" : "Not tested");
  const sub = entry.inside > 0 ? entry.inside + (entry.inside === 1 ? " NASA test matches this air" : " NASA tests match this air") :
    (partly ? capital(listText(matched).toLowerCase()) + (matched.length > 1 ? " match" : " matches") + "; " + listText(missing.map(function (m) { return m.toLowerCase(); })) + " not recorded." : "No NASA test matches all three conditions.");
  return { word: word, sub: sub, partly: partly };
}

const AIR_O2 = [15, 40];
const AIR_P = [4, 16];
const AIR_BOX = { o2: 0.5, p: 0.5 };
const AIR_FUELS = ["solid", "liquid_droplet", "gas"];
const AIR_NOUN = { solid: "solid-fuel", liquid_droplet: "droplet", gas: "gas-flame" };
const AIR_GRAVITY = [["micro", "Microgravity"], ["moon", "Moon"], ["mars", "Mars"]];
const AIR_FLEX = ["Heptane", "Methanol"];
const AIR_X = [14, 41];
const AIR_LANE_Y = 3.75;
const AIR_DUR = 600;
const AIR_TRACE = { rows: 0, lane: 1, flights: 2, hullA: 3, hullB: 4, box: 5, cross: 6, mark: 7 };
const AIR_HULL_COL = { Heptane: "#ff9a62", Methanol: "#5b95e8" };

const air = { o2: 34.25, p: 8.2, fuel: "solid", g: "moon", touched: false, raf: 0, ui: null, map: null };
let airData = null;

function airClamp(value, range) {
  return Math.min(range[1], Math.max(range[0], value));
}

function airRound(value) {
  return Math.round(value * 10) / 10;
}

function airClass(fc) {
  if (!airData) {
    airData = gapMapData();
  }
  return airData.classes[fc] || { points: [], lane: [] };
}

function airGravityOf(env) {
  const g = env.gravity.g;
  if (g === null || g === undefined || g < 0.05) {
    return "micro";
  }
  return g < 0.27 ? "moon" : "mars";
}

function airPresets() {
  return state.data.environments.environments.filter(function (e) {
    return isSpecified(e, "o2") && isSpecified(e, "pressure_atm");
  }).map(function (e) {
    return {
      id: e.id,
      label: envShort(e),
      o2: (e.o2.window_min + e.o2.window_max) / 2 * 100,
      p: psia((e.pressure_atm.window_min + e.pressure_atm.window_max) / 2),
      g: airGravityOf(e)
    };
  });
}

function airFromHash() {
  const r = parseHash();
  if (r.name !== "home" || r.params.o2 === undefined || r.params.p === undefined) {
    return false;
  }
  const o2 = parseFloat(r.params.o2);
  const p = parseFloat(r.params.p);
  if (!isFinite(o2) || !isFinite(p)) {
    return false;
  }
  air.o2 = airClamp(o2, AIR_O2);
  air.p = airClamp(p, AIR_P);
  air.fuel = AIR_FUELS.indexOf(r.params.fuel) >= 0 ? r.params.fuel : "solid";
  air.g = AIR_GRAVITY.some(function (g) { return g[0] === r.params.g; }) ? r.params.g : "micro";
  air.touched = true;
  return true;
}

function airReset() {
  const presets = airPresets();
  const start = presets.find(function (p) { return p.id === "lunar"; }) || presets[0];
  air.o2 = start.o2;
  air.p = start.p;
  air.g = start.g;
  air.fuel = "solid";
  air.touched = false;
}

function airHash() {
  return "#/home?" + qs({ o2: airRound(air.o2).toFixed(1), p: airRound(air.p).toFixed(1), fuel: air.fuel, g: air.g });
}

function airPreset() {
  return airPresets().find(function (pr) { return pr.g === air.g && Math.abs(pr.o2 - air.o2) < 0.05 && Math.abs(pr.p - air.p) < 0.05; }) || null;
}

function airBox() {
  const pr = airPreset();
  if (pr) {
    const env = envById(pr.id);
    return { preset: pr, o2: [env.o2.window_min * 100, env.o2.window_max * 100], p: [psia(env.pressure_atm.window_min), psia(env.pressure_atm.window_max)] };
  }
  return { preset: null, o2: [air.o2 - AIR_BOX.o2, air.o2 + AIR_BOX.o2], p: [Math.max(0.5, air.p - AIR_BOX.p), air.p + AIR_BOX.p] };
}

function airEvidence() {
  const group = airClass(air.fuel);
  const box = airBox();
  let full = 0;
  let lane = 0;
  let best = null;
  let bestD = Infinity;
  group.points.forEach(function (pt) {
    const x = pt.r.o2_frac * 100;
    const y = psia(pt.atm);
    if (x >= box.o2[0] - 1e-9 && x <= box.o2[1] + 1e-9 && y >= box.p[0] - 1e-9 && y <= box.p[1] + 1e-9) {
      full += 1;
    }
    const d = Math.hypot((x - air.o2) / 5, Math.log(y / air.p) / Math.LN2);
    if (d < bestD) {
      bestD = d;
      best = { pt: pt, o2: x, p: y };
    }
  });
  group.lane.forEach(function (r) {
    const x = r.o2_frac * 100;
    if (x >= box.o2[0] - 1e-9 && x <= box.o2[1] + 1e-9) {
      lane += 1;
    }
  });
  return { full: full, lane: lane, nearest: best };
}

function airFlight() {
  let best = null;
  let bestD = Infinity;
  const all = state.data.outside_psi.tests;
  const known = all.filter(function (t) { return t.pressure_psia !== null && t.pressure_psia !== undefined; });
  (known.length ? known : all).forEach(function (t) {
    const dy = t.pressure_psia === null || t.pressure_psia === undefined ? 0 : Math.log(t.pressure_psia / air.p) / Math.LN2;
    const d = Math.hypot((t.o2_percent - air.o2) / 5, dy);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  });
  return best;
}

function airInPolygon(poly, x, y) {
  let sign = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cross) < 1e-12) {
      continue;
    }
    const side = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = side;
    } else if (side !== sign) {
      return false;
    }
  }
  return true;
}

function airLogit(coef, o2, atm, heptane) {
  const z = coef[0] + coef[1] * o2 + coef[2] * Math.log(atm) + coef[3] * heptane;
  return 1 / (1 + Math.exp(-z));
}

function airQuantile(sorted, q) {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function airRefusal(fuel, ex, box) {
  const parts = [];
  if (ex.p > 0) {
    const below = air.p / PSIA_PER_ATM < box.pressure_atm[0];
    parts.push(fmt(ex.p, 2) + " atm " + (below ? "below the lowest" : "above the highest") + " tested pressure (" + fmt(box.pressure_atm[below ? 0 : 1], 3) + " atm)");
  }
  if (ex.o2 > 0) {
    const below = air.o2 / 100 < box.o2[0];
    parts.push(fmt(ex.o2 * 100, 1) + " points of O2 " + (below ? "below the lowest" : "above the highest") + " tested (" + fmt(box.o2[below ? 0 : 1] * 100, 0) + " percent)");
  }
  if (!parts.length) {
    parts.push("outside the region the " + fuel.toLowerCase() + " tests covered");
  }
  return parts.join("; ");
}

function airFlex() {
  const model = state.data.models.models[0];
  const pred = model.predictor;
  const tol = model.domain.edge_tolerance;
  const o2 = air.o2 / 100;
  const atm = air.p / PSIA_PER_ATM;
  return AIR_FLEX.map(function (fuel) {
    const box = pred.box[fuel];
    const ex = {
      o2: Math.max(0, box.o2[0] - o2, o2 - box.o2[1]),
      p: Math.max(0, box.pressure_atm[0] - atm, atm - box.pressure_atm[1])
    };
    const inside = airInPolygon(pred.hull[fuel], o2, atm);
    const status = inside ? "inside" : (ex.o2 <= tol.o2 && ex.p <= tol.pressure_atm ? "edge" : "outside");
    if (status === "outside") {
      return { fuel: fuel, status: status, refusal: airRefusal(fuel, ex, box) };
    }
    const heptane = fuel === "Heptane" ? 1 : 0;
    const boot = pred.bootstrap_raw.map(function (c) { return airLogit(c, o2, atm, heptane); }).sort(function (a, b) { return a - b; });
    return { fuel: fuel, status: status, est: airLogit(pred.raw, o2, atm, heptane), lo: airQuantile(boot, 0.025), hi: airQuantile(boot, 0.975) };
  });
}

function airRowHover(r, extra, atm) {
  const where = atm === null ? "pressure not recorded" : fmt(psia(atm), 1) + " psia";
  return plotEscape(r.psi_id + " | " + r.source_file + " | row " + r.source_row + (extra || "")) + "<br>O2 " + fmt(r.o2_frac * 100, 1) + " percent, " + where;
}

function airYMax() {
  return air.fuel === "liquid_droplet" ? 50 : 18;
}

function airHere() {
  const o2 = air.o2;
  const p = air.p;
  const b = airBox();
  return {
    box: { x: [b.o2[0], b.o2[1], b.o2[1], b.o2[0], b.o2[0]], y: [b.p[0], b.p[0], b.p[1], b.p[1], b.p[0]] },
    cross: { x: [AIR_X[0], AIR_X[1], null, o2, o2], y: [p, p, null, 3.4, airYMax()] }
  };
}

function airMapTraces(t) {
  const fc = air.fuel;
  const group = airClass(fc);
  const solid = fc === "solid";
  const rowSize = solid ? 9 : 5;
  const rowColor = solid ? GAP_COL.psi : GAP_COL.gray;
  const grow = function (full) { return Math.round(full * gapEaseOut(gapClamp(t)) * 100) / 100; };
  const flights = solid ? state.data.outside_psi.tests.filter(function (f) { return f.plotted; }) : [];
  const empty = function (name) {
    return { type: "scatter", mode: "markers", name: name, x: [], y: [], showlegend: false, hoverinfo: "skip" };
  };
  const traces = [];
  traces[AIR_TRACE.rows] = {
    type: "scatter", mode: "markers", name: "PSI " + AIR_NOUN[fc] + " tests",
    x: group.points.map(function (p) { return p.r.o2_frac * 100; }),
    y: group.points.map(function (p) { return psia(p.atm); }),
    text: group.points.map(function (p) { return airRowHover(p.r, p.sourced ? " | pressure from a NASA report" : "", p.atm); }),
    hovertemplate: "%{text}<extra></extra>",
    marker: { color: rowColor, size: grow(rowSize), opacity: solid ? 0.95 : 0.5, line: { color: GAP_COL.surf, width: solid ? 1 : 0 } }
  };
  traces[AIR_TRACE.lane] = group.lane.length ? {
    type: "scatter", mode: "markers", name: "Pressure not recorded",
    x: group.lane.map(function (r) { return r.o2_frac * 100; }),
    y: group.lane.map(function (r, i) { return AIR_LANE_Y * (1 + 0.06 * (((i * 7) % 11) - 5) / 5); }),
    text: group.lane.map(function (r) { return airRowHover(r, "", null); }),
    hovertemplate: "%{text}<extra></extra>",
    marker: { color: rowColor, size: grow(rowSize), opacity: 0.6, line: { color: GAP_COL.surf, width: 1 } }
  } : empty("Pressure not recorded");
  traces[AIR_TRACE.flights] = flights.length ? {
    type: "scatter", mode: "markers", name: "Saffire flights, not in PSI",
    x: flights.map(function (f) { return f.o2_percent; }),
    y: flights.map(function (f) { return f.pressure_psia; }),
    text: flights.map(function (f) {
      return plotEscape(f.label + " | " + f.material_short) + "<br>O2 " + fmt(f.o2_percent, 1) + " percent, " + fmt(f.pressure_psia, 2) + " psia<br>" + plotEscape(f.outcome_short) + " | NTRS " + f.source_id;
    }),
    hovertemplate: "%{text}<extra></extra>",
    marker: { symbol: "diamond-open", color: GAP_COL.fl, size: grow(11), line: { color: GAP_COL.fl, width: 2 } }
  } : empty("Saffire flights, not in PSI");
  const hulls = fc === "liquid_droplet" ? state.data.models.models[0].predictor.hull : null;
  [["hullA", AIR_FLEX[0]], ["hullB", AIR_FLEX[1]]].forEach(function (pair) {
    const fuel = pair[1];
    if (!hulls) {
      traces[AIR_TRACE[pair[0]]] = { type: "scatter", mode: "lines", name: fuel, x: [], y: [], showlegend: false, hoverinfo: "skip" };
      return;
    }
    const poly = hulls[fuel].concat([hulls[fuel][0]]);
    traces[AIR_TRACE[pair[0]]] = {
      type: "scatter", mode: "lines", name: fuel + " tested region",
      x: poly.map(function (v) { return v[0] * 100; }),
      y: poly.map(function (v) { return psia(v[1]); }),
      fill: "toself", fillcolor: plotRgba(AIR_HULL_COL[fuel], 0.07),
      line: { color: AIR_HULL_COL[fuel], width: 1.6, dash: "dot" }, hoverinfo: "skip"
    };
  });
  const here = airHere();
  traces[AIR_TRACE.box] = { type: "scatter", mode: "lines", name: "Counting window", x: here.box.x, y: here.box.y, showlegend: false, hoverinfo: "skip", line: { color: "rgba(238,241,248,0.7)", width: 1.2, dash: "dash" } };
  traces[AIR_TRACE.cross] = { type: "scatter", mode: "lines", name: "Crosshair", x: here.cross.x, y: here.cross.y, showlegend: false, hoverinfo: "skip", line: { color: "rgba(238,241,248,0.3)", width: 1 } };
  traces[AIR_TRACE.mark] = {
    type: "scatter", mode: "markers", name: "This air", x: [air.o2], y: [air.p], showlegend: false, hoverinfo: "skip",
    marker: { symbol: "circle", color: "#ffffff", size: grow(15), line: { color: "#e8743b", width: 3 } }
  };
  return traces;
}

function airMapLayout() {
  const small = window.innerWidth < 640;
  const ticks = air.fuel === "liquid_droplet" ? [4, 7, 10, 15, 25, 45] : [4, 6, 8, 10, 12, 15];
  const fs = small ? 11 : 12;
  return Object.assign(plotBase(PLOT_DARK), {
    height: small ? 340 : 430,
    margin: { l: small ? 42 : 52, r: 12, t: small ? 84 : 64, b: small ? 46 : 52, pad: 0, autoexpand: false },
    dragmode: false,
    hoverdistance: 12,
    xaxis: {
      range: AIR_X, fixedrange: true, zeroline: false, showgrid: true, gridcolor: PLOT_DARK.grid, showline: true, linecolor: PLOT_DARK.axis, ticks: "",
      tickvals: [15, 20, 25, 30, 35, 40], tickfont: { size: fs, color: PLOT_DARK.muted },
      title: { text: "Oxygen (percent)", font: { size: fs, color: PLOT_DARK.muted }, standoff: 8 }
    },
    yaxis: {
      type: "log", range: [Math.log10(3.4), Math.log10(airYMax())], fixedrange: true, zeroline: false, showgrid: true, gridcolor: PLOT_DARK.grid, showline: true, linecolor: PLOT_DARK.axis, ticks: "",
      tickvals: ticks, ticktext: ticks.map(String), tickfont: { size: fs, color: PLOT_DARK.muted },
      title: { text: "Pressure (psia)", font: { size: fs, color: PLOT_DARK.muted }, standoff: 6 }
    },
    legend: { orientation: "h", x: 0, y: 1.03, yanchor: "bottom", font: { size: fs, color: PLOT_DARK.text }, bgcolor: "rgba(0,0,0,0)", itemsizing: "constant" },
    showlegend: true
  });
}

function airMapClick(e) {
  const m = air.map;
  if (!m) {
    return;
  }
  const drag = m.node.querySelector(".nsewdrag");
  const full = m.node._fullLayout;
  if (!drag || !full) {
    return;
  }
  const box = drag.getBoundingClientRect();
  if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) {
    return;
  }
  const o2 = full.xaxis.p2d(e.clientX - box.left);
  const p = full.yaxis.p2d(e.clientY - box.top);
  if (!isFinite(o2) || !isFinite(p)) {
    return;
  }
  air.o2 = airRound(airClamp(o2, AIR_O2));
  air.p = airRound(airClamp(p, AIR_P));
  air.touched = true;
  airSchedule();
}

function airMapDraw(animate) {
  const m = air.map;
  if (!m || !window.Plotly || !document.body.contains(m.node)) {
    return Promise.resolve();
  }
  const t = animate && !reduceMotion() ? 0 : 1;
  m.fuel = air.fuel;
  return window.Plotly.react(m.node, airMapTraces(t), airMapLayout(), plotConfig()).then(function () {
    m.ready = true;
    if (!m.wired) {
      m.wired = true;
      m.node.addEventListener("click", airMapClick);
    }
    if (t === 0) {
      m.pending = true;
      m.watch = plotWatch(m.node, 0.3, function () {
        m.watch = null;
        airMapPlay();
      });
    }
  });
}

function airMapPlay() {
  const m = air.map;
  if (!m || !m.pending) {
    return;
  }
  m.pending = false;
  const full = air.fuel === "solid" ? 9 : 5;
  const idx = [AIR_TRACE.rows, AIR_TRACE.lane, AIR_TRACE.flights, AIR_TRACE.mark];
  const sizes = [full, full, 11, 15];
  m.cancel = plotRun(AIR_DUR, function (t) {
    const k = gapEaseOut(gapClamp(t));
    return window.Plotly.restyle(m.node, { "marker.size": sizes.map(function (s) { return Math.round(s * k * 100) / 100; }) }, idx);
  }, function () { m.cancel = null; });
}

function airMapMove() {
  const m = air.map;
  if (!m || !m.ready) {
    return;
  }
  if (m.busy) {
    m.dirty = true;
    return;
  }
  m.busy = true;
  m.dirty = false;
  const here = airHere();
  window.Plotly.restyle(m.node, {
    x: [here.box.x, here.cross.x, [air.o2]],
    y: [here.box.y, here.cross.y, [air.p]]
  }, [AIR_TRACE.box, AIR_TRACE.cross, AIR_TRACE.mark]).then(function () {
    m.busy = false;
    if (m.dirty) {
      airMapMove();
    }
  });
}

function airStop() {
  const m = air.map;
  if (air.raf) {
    cancelAnimationFrame(air.raf);
    air.raf = 0;
  }
  if (m) {
    if (m.cancel) {
      m.cancel();
    }
    if (m.watch) {
      m.watch.disconnect();
    }
    if (window.Plotly) {
      window.Plotly.purge(m.node);
    }
  }
  air.map = null;
  air.ui = null;
}

function airSchedule() {
  if (air.raf) {
    return;
  }
  air.raf = requestAnimationFrame(function () {
    air.raf = 0;
    airRefresh();
  });
}

function airQuestion() {
  const noun = { solid: "solid fuel", liquid_droplet: "liquid droplet fuel", gas: "gas fuel" }[air.fuel];
  const gravity = { micro: "in microgravity", moon: "at Moon gravity", mars: "at Mars gravity" }[air.g];
  return "Has NASA tested " + noun + " in air with " + airRound(air.o2).toFixed(1) + "% oxygen at " + airRound(air.p).toFixed(1) + " psia, " + gravity + "? What is the closest test?";
}

function airVerdict() {
  const ev = airEvidence();
  const noun = AIR_NOUN[air.fuel];
  const pr = airBox().preset;
  const block = pr ? state.data.test_next.environments[pr.id] : null;
  const entry = block ? block.classes.find(function (c) { return c.fuel_class === air.fuel; }) : null;
  const hab = entry ? scenarioVerdict(entry, scenarioRows(entry, block)) : null;
  let word = ev.full > 0 ? "Tested" : (ev.lane > 0 ? "Partly tested" : "Not tested");
  const within = "within " + AIR_BOX.o2 + " O2 points and " + AIR_BOX.p + " psia";
  let sub;
  if (hab) {
    word = hab.word;
    sub = pr.label + " window: " + hab.sub.charAt(0).toLowerCase() + hab.sub.slice(1) + (/[.]$/.test(hab.sub) ? "" : ".");
  } else if (ev.full > 0) {
    sub = ev.full + " NASA " + noun + (ev.full === 1 ? " test " : " tests ") + within + ". Airflow is not set here.";
  } else if (ev.lane > 0) {
    sub = ev.lane + " NASA " + noun + (ev.lane === 1 ? " test" : " tests") + " at this oxygen, pressure not recorded.";
  } else {
    sub = "No NASA " + noun + " test " + within + ".";
  }
  const tone = word === "Tested" ? "ok" : (word === "Partly tested" ? "part" : "none");
  const lane = !hab && ev.full > 0 && ev.lane > 0 ? el("p", { class: "air-note", text: ev.lane + " more at this oxygen, pressure not recorded." }) : null;
  let near = null;
  if (ev.nearest) {
    const r = ev.nearest.pt.r;
    const inv = invById(r.psi_id);
    near = el("p", { class: "air-near" },
      "Closest with a known pressure: ", inv ? invLabel(inv) : r.psi_id, " at " + fmt(ev.nearest.o2, 1) + "% O2, " + fmt(ev.nearest.p, 1) + " psia" + (sourcedPressure(r) ? " (from a NASA report)" : "") + ". ",
      el("a", { href: "#/data?" + qs({ inv: r.psi_id, at: "extractor" }), text: r.source_file + ", row " + r.source_row }));
  }
  return el("div", { class: "air-verdict" },
    el("p", { class: "air-word " + tone, text: word }),
    el("p", { class: "air-sub", text: sub }),
    lane,
    near);
}

function airCardFlight() {
  const t = airFlight();
  if (air.fuel !== "solid" || !t) {
    return null;
  }
  const pressure = t.pressure_psia === null || t.pressure_psia === undefined ? ", pressure not stated" : ", " + fmt(t.pressure_psia, 2) + " psia";
  const did = /not/i.test(t.outcome_short) ? "did not ignite" : "burned";
  return el("div", { class: "air-card" },
    el("p", { class: "air-card-title", text: "Nearest flight outside PSI" }),
    el("p", { class: "air-card-body" }, t.label + " " + did + " " + t.material_short + " at " + percent(t.o2_frac) + "% O2" + pressure + ". ", ntrsLink(t.source_url, "NTRS " + t.source_id)));
}

function airPercent(value) {
  return Math.round(Math.round(value * 1000) / 10);
}

function airCardModel() {
  const title = el("p", { class: "air-card-title", text: "Chance the flame goes out on its own" });
  if (air.fuel !== "liquid_droplet") {
    return el("div", { class: "air-card" }, title,
      el("p", { class: "air-card-body", text: "The model covers droplet flames only." }));
  }
  const rows = airFlex().map(function (f) {
    if (f.status === "outside") {
      return el("div", { class: "air-flex out" },
        el("p", { class: "air-flex-name", text: f.fuel + " droplet" }),
        el("p", { class: "air-flex-text", text: "No prediction: " + f.refusal + "." }));
    }
    return el("div", { class: "air-flex" },
      el("p", { class: "air-flex-name", text: f.fuel + " droplet" }),
      el("p", { class: "air-flex-num", text: airPercent(f.est) + "%" }),
      el("p", { class: "air-flex-text", text: "95% range " + airPercent(f.lo) + "-" + airPercent(f.hi) + "%" + (f.status === "edge" ? ". At the edge of the tested range." : "") }));
  });
  return el("div", { class: "air-card" }, title, el("div", { class: "air-flex-list" }, rows),
    el("p", { class: "air-card-foot" }, el("a", { href: "#/data?at=model", text: "How the model was checked" })));
}

function gravityFacts() {
  const lg = state.data.lunar_g;
  const d = state.data.partial_g.summary.largest_drop;
  return {
    allow: fmt(lg.paper.worst_case_delta_o2_points, 1),
    count: lg.materials.length,
    drop: fmt(d.points, 1),
    material: d.material.split(" (")[0],
    psia: d.pressure_psia_raw
  };
}

function airCardGravity() {
  const lg = state.data.lunar_g;
  const title = el("p", { class: "air-card-title", text: "Gravity" });
  let body;
  if (air.g === "micro") {
    body = [el("p", { class: "air-card-body", text: "PSI tests are microgravity, so no adjustment." })];
  } else if (air.g === "moon") {
    const other = lg.materials.filter(function (m) { return m.direction === "less_flammable"; }).map(function (m) { return m.name; });
    body = [
      el("p", { class: "air-card-body", text: "NASA Glenn allows up to " + gravityFacts().allow + " O2 points for " + gravityFacts().count + " materials; lunar drop tests measured up to " + gravityFacts().drop + " (" + gravityFacts().material + ")." }),
      other.length ? el("p", { class: "air-card-body", text: "At lunar gravity " + other.join(" and ") + " burned only at higher oxygen." }) : null
    ];
  } else {
    body = [el("p", { class: "air-card-body", text: "No NASA partial-g flammability data for Mars gravity in these sources." })];
  }
  return el("div", { class: "air-card" }, title, body, el("p", { class: "air-card-foot" }, el("a", { href: "#/gravity", text: "See the lunar gravity check" })));
}

function airToggle(list, active) {
  list.forEach(function (b) {
    const on = active(b);
    b.node.classList.toggle("active", on);
    b.node.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function airRefresh() {
  if (air.ui && document.body.contains(air.ui.root)) {
    airPaint();
  }
}

function airPaint() {
  const ui = air.ui;
  const o2 = airRound(air.o2);
  const p = airRound(air.p);
  ui.o2Value.firstChild.textContent = o2.toFixed(1);
  ui.pValue.firstChild.textContent = p.toFixed(1);
  if (Math.abs(parseFloat(ui.o2Input.value) - o2) > 0.049) {
    ui.o2Input.value = o2;
  }
  if (Math.abs(parseFloat(ui.pInput.value) - p) > 0.049) {
    ui.pInput.value = p;
  }
  airToggle(ui.presets, function (b) { return b.preset.g === air.g && Math.abs(b.preset.o2 - air.o2) < 0.05 && Math.abs(b.preset.p - air.p) < 0.05; });
  airToggle(ui.fuels, function (b) { return b.id === air.fuel; });
  airToggle(ui.gravity, function (b) { return b.id === air.g; });
  clear(ui.verdict);
  ui.verdict.appendChild(airVerdict());
  clear(ui.cards);
  appendKids(ui.cards, [airCardFlight(), airCardModel(), airCardGravity()]);
  if (air.map && air.map.ready && air.map.fuel !== air.fuel) {
    airMapDraw(false);
  } else {
    airMapMove();
  }
  if (air.touched) {
    history.replaceState(null, "", airHash());
  }
}

function airSlider(label, unit, range, key) {
  const value = el("p", { class: "air-value" }, document.createTextNode(""), el("small", { text: unit }));
  const input = el("input", { type: "range", class: "air-range", min: range[0], max: range[1], step: "0.1", "aria-label": label, value: airRound(air[key]) });
  input.addEventListener("input", function () {
    air[key] = parseFloat(input.value);
    air.touched = true;
    airSchedule();
  });
  const end = function (v) { return v + (unit === "%" ? "%" : " psia"); };
  const field = el("div", { class: "air-field" },
    el("p", { class: "air-label", text: label }),
    value,
    input,
    el("p", { class: "air-ends" }, el("span", { text: end(range[0]) }), el("span", { text: end(range[1]) })));
  return { field: field, value: value, input: input };
}

function scenarioCard() {
  if (!airFromHash()) {
    airReset();
  }
  const ui = { presets: [], fuels: [], gravity: [] };
  function pill(list, key, label, pick, extra) {
    const node = el("button", { type: "button", class: "pill", "aria-pressed": "false", "data-key": key, text: label, onclick: function () {
      pick();
      air.touched = true;
      airSchedule();
    } });
    list.push(Object.assign({ node: node, key: key }, extra || {}));
    return node;
  }
  const presetRow = el("div", { class: "pills air-seg", role: "group", "aria-label": "Habitat air" }, airPresets().map(function (pr) {
    return pill(ui.presets, "env-" + pr.id, pr.label, function () {
      air.o2 = pr.o2;
      air.p = pr.p;
      air.g = pr.g;
    }, { preset: pr });
  }));
  const fuelRow = el("div", { class: "pills air-seg", role: "group", "aria-label": "Fuel type" }, AIR_FUELS.map(function (fc) {
    return pill(ui.fuels, "fuel-" + fc, NEXT_LABELS[fc], function () { air.fuel = fc; }, { id: fc });
  }));
  const gravityRow = el("div", { class: "pills air-seg", role: "group", "aria-label": "Gravity" }, AIR_GRAVITY.map(function (g) {
    return pill(ui.gravity, "g-" + g[0], g[1], function () { air.g = g[0]; }, { id: g[0] });
  }));
  const o2 = airSlider("Oxygen", "%", AIR_O2, "o2");
  const pr = airSlider("Pressure", "psia", AIR_P, "p");
  ui.o2Value = o2.value;
  ui.pValue = pr.value;
  ui.o2Input = o2.input;
  ui.pInput = pr.input;
  ui.verdict = el("div", { class: "air-verdict-wrap", "aria-live": "polite" });
  ui.cards = el("div", { class: "air-cards" });
  const mapNode = el("div", { class: "air-map", role: "img", "aria-label": "Map of NASA flame tests by oxygen and pressure with a marker for the chosen air. Click the map to move the marker." });
  const ask = el("button", { type: "button", class: "btn air-ask", text: "Ask about this air", onclick: function () {
    openAskPanel(false);
    askPanel.nodes.input.value = airQuestion();
    resizeAskInput();
    askPanel.nodes.input.focus();
  } });
  ui.root = el("div", { class: "air" },
    el("div", { class: "air-main" },
      el("div", { class: "air-left" }, presetRow, fuelRow, o2.field, pr.field, gravityRow),
      el("div", { class: "air-out" }, ui.verdict, el("p", { class: "air-actions" }, ask)),
      el("div", { class: "air-right" },
        mapNode,
        el("p", { class: "air-hint small muted", text: "Each dot is one NASA test row. Click the map to move the marker." }))),
    ui.cards);
  air.ui = ui;
  air.map = { node: mapNode, busy: false, dirty: false, wired: false, pending: false, ready: false, watch: null, cancel: null, fuel: null };
  airPaint();
  loadPlotly().then(function () {
    airMapDraw(true);
  }).catch(function () {
    mapNode.textContent = "Chart library not loaded.";
  });
  return ui.root;
}

const TOUR_QUESTION = "How many solid-fuel tests were run inside Moon base oxygen levels?";

const tour = { open: false, step: 0, node: null, nodes: null, waiting: false, playing: false, openedAsk: false, ring: null, ringTimer: null };

const TOUR_STEPS = [
  {
    hash: "#/home", scroll: null, ring: null, story: true,
    text: function () { return "The story: what NASA has tested, and the gap a Moon base leaves. It plays by itself; scroll to take over."; }
  },
  {
    hash: "#/home", scroll: "#s-next", ring: ".scenario",
    text: function () { return "Pick a habitat or drag the oxygen and pressure. See what NASA has tested, and what the model says."; }
  },
  {
    hash: "#/rank?habitat=lunar", scroll: null, ring: ".rank-cards",
    text: function () { return "Every investigation, scored for the " + envShort(envById("lunar")) + ". The weights are adjustable."; }
  },
  {
    hash: "#/rank?habitat=lunar", scroll: null, ring: "#ask-panel", ask: true,
    text: function () { return "Ask anything. Each answer shows its sources and how it checked the data."; }
  },
  {
    hash: "#/equipment", scroll: null, ring: "#view .page-head, #view h1",
    text: function () { return "Research mapped to prevention, detection and suppression equipment."; }
  }
];

function tourClearRing() {
  clearTimeout(tour.ringTimer);
  if (tour.ring) {
    tour.ring.classList.remove("tour-ring");
    tour.ring = null;
  }
}

function tourBuild() {
  if (tour.node) {
    return;
  }
  const count = el("p", { class: "tour-count" });
  const text = el("p", { class: "tour-text" });
  const back = el("button", { type: "button", class: "tour-btn", text: "Back", onclick: function () { tourMove(-1); } });
  const next = el("button", { type: "button", class: "tour-btn tour-next", onclick: function () { tourMove(1); } });
  const close = el("button", { type: "button", class: "tour-close", text: "Close", "aria-label": "Close tour", onclick: tourClose });
  tour.nodes = { count: count, text: text, back: back, next: next };
  tour.node = el("div", { id: "tour", class: "tour", role: "dialog", "aria-label": "60-second tour" },
    count, text, el("div", { class: "tour-bar" }, back, next, close));
  document.body.appendChild(tour.node);
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && tour.open) {
      e.stopPropagation();
      tourClose();
    }
  }, true);
}

function tourStart() {
  if (!state.data) {
    return;
  }
  tourBuild();
  tour.open = true;
  tour.step = 0;
  tour.openedAsk = false;
  document.body.classList.add("tour-open");
  tourShow();
  tour.nodes.next.focus();
}

function tourStopPlay() {
  if (playRun) {
    playRun.onEnd = null;
    playStop();
  }
  tour.playing = false;
}

function tourClose() {
  tourStopPlay();
  tour.open = false;
  tour.waiting = false;
  tourClearRing();
  document.body.classList.remove("tour-open");
  document.documentElement.style.removeProperty("--tour-h");
  window.dispatchEvent(new Event("resize"));
  if (tour.node) {
    tour.node.remove();
    tour.node = null;
    tour.nodes = null;
  }
}

function tourMove(delta) {
  tourStopPlay();
  const target = tour.step + delta;
  if (target >= TOUR_STEPS.length) {
    tourClose();
    return;
  }
  if (target < 0) {
    return;
  }
  if (TOUR_STEPS[tour.step].ask && tour.openedAsk) {
    closeAskPanel(false);
    tour.openedAsk = false;
  }
  tour.step = target;
  tourShow();
}

function tourShow() {
  const s = TOUR_STEPS[tour.step];
  tour.nodes.count.textContent = "Step " + (tour.step + 1) + " of " + TOUR_STEPS.length;
  tour.nodes.text.textContent = s.text();
  tour.nodes.next.textContent = tour.step === TOUR_STEPS.length - 1 ? "Done" : "Next";
  tour.nodes.back.disabled = tour.step === 0;
  document.documentElement.style.setProperty("--tour-h", tour.node.offsetHeight + "px");
  window.dispatchEvent(new Event("resize"));
  tourClearRing();
  const here = location.hash === "" || location.hash === "#" || location.hash === "#/" ? "#/home" : location.hash;
  if (here === s.hash || (s.hash === "#/home" && here.split("?")[0] === "#/home")) {
    if (s.hash.indexOf("#/rank") === 0) {
      route();
    }
    setTimeout(tourFocus, 60);
    return;
  }
  tour.waiting = true;
  location.hash = s.hash;
}

function tourStory() {
  window.scrollTo({ top: 0, behavior: "instant" });
  if (reduceMotion()) {
    const gap = document.querySelector("#s-gap");
    if (gap) {
      window.scrollTo({ top: Math.max(0, gap.getBoundingClientRect().top + window.scrollY - headerH()), behavior: "instant" });
    }
    return;
  }
  tour.playing = true;
  tour.nodes.next.textContent = "Skip";
  playStory(function (natural) {
    tour.playing = false;
    if (!tour.open || !tour.nodes) {
      return;
    }
    if (natural) {
      tourMove(1);
    } else {
      tour.nodes.next.textContent = "Next";
    }
  });
}

function tourFocus() {
  if (!tour.open) {
    return;
  }
  const s = TOUR_STEPS[tour.step];
  if (s.story) {
    tourStory();
    return;
  }
  const behavior = reduceMotion() ? "auto" : "smooth";
  const anchor = s.scroll ? document.querySelector(s.scroll) : null;
  const header = document.querySelector(".top");
  const headerH = header ? header.offsetHeight : 0;
  let top = anchor ? Math.max(0, anchor.getBoundingClientRect().top + window.scrollY - headerH) : 0;
  const ringNode = document.querySelector(s.ring);
  if (anchor && ringNode && tour.node) {
    const box = ringNode.getBoundingClientRect();
    const ringTop = box.top + window.scrollY;
    const over = ringTop + box.height - (top + window.innerHeight - tour.node.offsetHeight - 24);
    if (over > 0) {
      top = Math.max(top, Math.min(top + over, ringTop - headerH - 12));
    }
  }
  window.scrollTo({ top: top, behavior: behavior });
  if (s.ask) {
    openAskPanel(false);
    tour.openedAsk = true;
    const asked = askPanel.thread.some(function (t) { return normalizeQuestion(t.question) === normalizeQuestion(TOUR_QUESTION); });
    if (!asked) {
      sendAsk(TOUR_QUESTION, true, true);
    }
    setTimeout(function () {
      const thread = askPanel.nodes.thread;
      const all = thread.querySelectorAll(".ask-steps");
      const steps = all.length ? all[all.length - 1] : null;
      if (steps) {
        steps.open = true;
        thread.scrollTop += steps.getBoundingClientRect().top - thread.getBoundingClientRect().top - 140;
      }
    }, 60);
  }
  const ring = ringNode;
  if (ring) {
    ring.classList.add("tour-ring");
    tour.ring = ring;
    tour.ringTimer = setTimeout(tourClearRing, 2600);
  }
}

function tourRouted() {
  if (tour.open && tour.waiting) {
    tour.waiting = false;
    setTimeout(tourFocus, 80);
  }
}

function buildTourToggle() {
  const ask = document.getElementById("ask-open");
  const button = el("button", { type: "button", id: "tour-open", class: "ask-toggle tour-toggle", text: "Tour", onclick: tourStart });
  ask.parentNode.insertBefore(button, ask);
}

function heroSolidEntry(block) {
  return block.classes.find(function (c) { return c.fuel_class === "solid"; }) || block.classes[0];
}

function heroAir(block) {
  const win = block.windows;
  const parts = ["O2 " + dashSpan(win.o2.min * 100, win.o2.max * 100, 1, "%")];
  if (win.pressure_atm) {
    parts.push(dashSpan(psia(win.pressure_atm.min), psia(win.pressure_atm.max), 1, "psia"));
  }
  return parts.join(", ");
}

function heroVerdict() {
  const envs = state.data.environments.environments.filter(function (e) { return state.data.test_next.environments[e.id]; });
  let envId = envs.some(function (e) { return e.id === "lunar"; }) ? "lunar" : envs[0].id;
  const chips = el("div", { class: "pills hv-chips", role: "group", "aria-label": "Habitat" });
  const body = el("div", { class: "hv-body", "aria-live": "polite" });
  const go = el("a", { class: "btn hv-go", text: "See what NASA should test next" });
  function draw(animate) {
    const env = envs.find(function (e) { return e.id === envId; });
    const block = state.data.test_next.environments[envId];
    const entry = heroSolidEntry(block);
    const verdict = scenarioVerdict(entry, scenarioRows(entry, block));
    const n = entry.nearest;
    const inv = n ? invById(n.psi_id) : null;
    const o = entry.fuel_class === "solid" ? entry.outside_nearest : null;
    const num = el("span", { class: "hv-num", text: fmt(entry.inside, 0) });
    const tone = entry.inside > 0 ? "ok" : (verdict.partly ? "part" : "none");
    clear(chips);
    envs.forEach(function (e) {
      chips.appendChild(el("button", { type: "button", class: "pill" + (e.id === envId ? " active" : ""), "aria-pressed": e.id === envId ? "true" : "false", "data-env": e.id, text: envShort(e), onclick: function () {
        envId = e.id;
        draw(true);
        const again = chips.querySelector("[data-env=\"" + e.id + "\"]");
        if (again) {
          again.focus();
        }
      } }));
    });
    clear(body);
    appendKids(body, [
      el("p", { class: "hv-air", text: envShort(env) + " air: " + heroAir(block) }),
      el("div", { class: "hv-main" },
        el("p", { class: "hv-big" }, num, el("span", { class: "hv-of" }, " of ", el("span", { class: "hv-tot", text: fmt(entry.classified_rows, 0) }))),
        el("div", { class: "hv-side" },
          el("p", { class: "hv-unit", text: "solid-fuel NASA tests ran in this air" }),
          el("span", { class: "hv-word " + tone, text: verdict.word }))),
      n ? el("p", { class: "hv-line", text: "Closest: " + (inv ? invLabel(inv) : n.psi_id) + " at " + percent(n.o2_frac) + "% O2" }) : null,
      o ? el("p", { class: "hv-line hv-out", text: o.label + " " + (/not/i.test(o.outcome_short) ? "did not ignite" : "burned") + " at " + percent(o.o2_frac) + "% O2 - not in the PSI database" }) : null
    ]);
    go.setAttribute("href", "#/rank?habitat=" + encodeURIComponent(envId) + "&at=test-next");
    if (animate) {
      countUp(num, entry.inside);
      body.classList.remove("swap");
      void body.offsetWidth;
      body.classList.add("swap");
    }
  }
  draw(false);
  const card = el("div", { class: "hv", role: "group", "aria-label": "Verdict for a habitat" },
    el("p", { class: "hv-label", text: "Computed from NASA PSI data" }), chips, body);
  return { card: card, go: go };
}

function heroStats() {
  const data = state.data;
  const v = data.verification;
  const rows = data.investigations.reduce(function (sum, inv) { return sum + inv.row_count; }, 0);
  const items = [
    [data.investigations.length.toLocaleString("en-US"), "investigations"],
    [rows.toLocaleString("en-US"), "test rows"]
  ];
  if (v.present && (v.quotes_total || v.quotes)) {
    items.push([(v.quotes_total || v.quotes.verified).toLocaleString("en-US"), "quotes verified"]);
  }
  if (v.present && v.audit) {
    items.push([v.audit.passed.toLocaleString("en-US") + " of " + v.audit.checked.toLocaleString("en-US"), "audit checks passed"]);
  }
  return el("ul", { class: "hero-stats" }, items.map(function (it) {
    return el("li", null, el("strong", { text: it[0] }), el("span", { text: it[1] }));
  }));
}

function renderHome() {
  loadPlotly().catch(function () {});
  const data = state.data;
  const lunar = envById("lunar");
  const moon = envNumber(lunar);
  const sections = [];
  function story(cls, id, kids) {
    const section = el("section", { class: "story " + cls, id: id }, el("div", { class: "story-in" }, kids));
    sections.push(section);
    return section;
  }
  const verdictBox = heroVerdict();
  const intro = !heroPlayed && !reduceMotion();
  heroPlayed = true;
  const hero = el("section", { class: "story hero" + (intro ? " intro" : " in"), id: "s-hero" },
    el("div", { class: "hero-copy" },
      rv(0, "h1", { text: "Flame in Freefall" }),
      rv(1, "p", { class: "hero-line", text: "Fire behaves differently in space. We checked every NASA test so Moon crews know where the evidence stops." }),
      rv(2, "div", { class: "hv-wrap" }, verdictBox.card),
      rv(3, "p", { class: "hero-cta" }, verdictBox.go, el("button", { type: "button", class: "btn ghost hero-play", text: "Take the tour", onclick: tourStart })),
      rv(4, "div", { class: "hv-stats" }, heroStats())),
    el("button", { type: "button", class: "scroll-cue", "aria-label": "Scroll to the next section", onclick: function () {
      document.getElementById("s-quote").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
    } }, el("span", { text: "Scroll" }), el("i")),
    el("span", { class: "hero-alt", text: HERO_FALLBACK.alt }),
    el("span", { class: "credit", text: HERO_VIDEO.caption }));
  const quote = story("st-quote", "s-quote", [
    rv(0, "blockquote", { class: "big-quote" }, el("p", { text: ARTEMIS_QUOTE }), el("footer", { text: "Artemis II commander" })),
    rv(1, "ul", { class: "incidents" }, STORY_INCIDENTS.map(function (i) {
      return el("li", null, el("span", { class: "inc-year", text: i[0] }), el("span", { class: "inc-text" }, el("strong", { text: i[1] }), " " + i[2]));
    })),
    expander("Details", el("div", null,
      el("p", { text: "Quote and incidents as described in the NASA Space Apps challenge statement." }),
      el("ul", null,
        el("li", null, ntrsLink(CHALLENGE_URL, "Flame in Freefall challenge statement")),
        el("li", null, ntrsLink(STORY_INCIDENTS[0][3], "NASA: Apollo 1")),
        el("li", null, ntrsLink(STORY_INCIDENTS[1][3], "NASA: Fire aboard space station Mir")))))
  ]);
  const air = story("st-air", "s-air", [
    rv(0, "h2", { text: "Moon base air" }),
    el("div", { class: "bars" }, bandRow("Earth air", 21, 40, "earth", 1), bandRow("Moon base", moon, 40, "moon", 2)),
    rv(3, "p", { class: "story-line", text: "More oxygen means materials burn more easily." }),
    rv(3, "p", { class: "story-sub" }, "Moon gravity can change the answer too. ", el("a", { href: "#/gravity", text: "See the lunar gravity check" })),
    rv(4, "p", { class: "story-sub", text: "Why so high? Spacesuits run on pure oxygen at 4.3 psi. Base air sits between suit and Earth to cut pre-breathing time." }),
    expander("Details", el("div", null,
      el("p", { class: "small", text: "Source, challenge statement: spacesuits hold 100% oxygen at 4.3 psi against 14.7 psi at sea level, and the Moon base and rovers are expected to sit between the spacesuit and Earth's atmosphere to reduce pre-breathing." }),
      el("p", { class: "small", text: "Moon base oxygen is " + lunar.o2.display + ". Earth air is about 21 percent." }),
      envSourcesTable(lunar)))
  ]);
  const chart = el("div", { class: "gap", role: "img" });
  const gap = story("st-gap", "s-gap", [
    rv(0, "h2", { text: "Has NASA tested that air?" }),
    rv(1, "p", { class: "story-sub", text: "Every ambient-oxygen flame test in the PSI database" }),
    chart,
    el("p", { class: "gap-note" }, gapCaption(), " ", el("a", { href: "#/data?at=extractor", text: "See the rows" })),
    el("div", { class: "gap-more" }, gapDetails(lunar))
  ]);
  const grav = story("st-grav", "s-grav", [
    rv(0, "h2", { text: "Gravity changes it too" }),
    el("div", { class: "grav-wrap" },
      rv(1, "figure", { class: "gm gm-home" }, gravityMap(true),
        el("figcaption", { class: "small", text: "Concept drawing, not data." })),
      el("div", { class: "grav-copy" },
        rv(2, "p", { class: "story-line", text: "On the Moon, NASA Glenn's allowance for a 1-g test margin is up to " + gravityFacts().allow + " oxygen points, and drop tests measured up to " + gravityFacts().drop + "." }),
        rv(3, "p", { class: "story-sub" }, el("a", { class: "btn ghost", href: "#/gravity", text: "See the lunar gravity check" }))))
  ]);
  const next = story("st-next", "s-next", [
    rv(0, "h2", { text: "Check any cabin air" }),
    rv(1, "div", { class: "scenario" }, scenarioCard())
  ]);
  const tile = function (href, title, index) {
    return rv(index, "a", { class: "tile", href: href }, el("span", { text: title }));
  };
  const explore = story("st-explore", "s-explore", [
    el("div", { class: "tiles" },
      tile("#/rank", "Rank experiments for a habitat", 0),
      tile("#/investigations", "Browse the " + data.investigations.length + " investigations", 1),
      tile("#/equipment", "Research for fire-safety equipment", 2),
      tile("#/data?at=extractor", "Download the data", 3)),
    rv(4, "p", { class: "ask-link" }, el("button", { type: "button", class: "textlink", text: "Ask the data", onclick: function () { openAskPanel(true); } })),
    rv(5, "div", { class: "who" },
      el("h2", { text: "Who we are" }),
      el("p", { class: "who-name" }, el("strong", { text: "Kenyalang Blue Flame" }), " - Bintulu, Sarawak, Malaysia."),
      TEAM_WHY ? el("blockquote", { id: "team-why", class: "team-why", text: TEAM_WHY }) : null,
      el("p", { class: "who-link" }, ntrsLink(TEAM_URL, "Meet the team on NASA Space Apps")))
  ]);
  const view = setView(hero, quote, air, gap, grav, next, explore);
  watchStory(sections);
  gapNode = chart;
  drawGapChart(chart);
  gapWatch(chart);
  if (intro) {
    heroIntro(hero);
  }
  hero.insertBefore(heroMedia(hero), hero.firstChild);
  if (parseHash().params.o2 !== undefined) {
    setTimeout(function () {
      const target = document.getElementById("s-next");
      if (target) {
        window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerH()), behavior: "instant" });
      }
    }, 0);
  }
  return view;
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

function testNextConditions(win) {
  return "O2 " + dashSpan(win.o2.min * 100, win.o2.max * 100, 1, "%") + ", " +
    dashSpan(psia(win.pressure_atm.min), psia(win.pressure_atm.max), 1, "psia") +
    (win.flow_cm_s ? ", " + dashSpan(win.flow_cm_s.min, win.flow_cm_s.max, 1, "cm/s") : "");
}

function testNextRows(block, plain) {
  const win = block.windows;
  let priority = 0;
  return block.classes.map(function (entry) {
    let nearest = "No ambient O2 value recorded for this fuel class.";
    if (entry.nearest) {
      const n = entry.nearest;
      const dir = n.o2_frac < win.o2.min ? "below" : n.o2_frac > win.o2.max ? "above" : "inside";
      const o2 = "O2 " + percent(n.o2_frac) + "%" + (n.o2_gap > 0 ? " (" + fmt(n.o2_gap * 100, 1) + " points " + dir + ")" : " (inside)");
      const reported = n.pressure_atm === null ? state.data.outside_psi.solid_pressures[n.psi_id] : null;
      const pr = n.pressure_atm !== null ? fmt(psia(n.pressure_atm), 1) + " psia" :
        reported ? "pressure not in PSI, " + fmt(psia(reported.pressure_atm), 1) + " psia in the NASA report" : "pressure not recorded";
      const inv = invById(n.psi_id);
      nearest = el("span", null, o2 + ", " + pr + ". ", inv && !plain ? invLink(inv, n.psi_id) : n.psi_id, ", row " + n.source_row);
    }
    const outsideNearest = outsideCell(entry, plain);
    const inside = el("span", null, String(entry.inside),
      entry.o2_window_no_pressure_rows > 0 ? el("span", { class: "src", text: entry.o2_window_no_pressure_rows + " more match O2 but record no pressure" }) : null);
    const label = entry.inside === 0 ? String(++priority) : "-";
    return [label, FUEL_LABELS[entry.fuel_class], inside, nearest, outsideNearest];
  });
}

const TEST_NEXT_HEADERS = ["Priority", "Fuel class", "Tests inside the window", "Nearest tested condition", "Nearest NASA test outside PSI"];

function outsideCell(entry, plain) {
  const o = entry.outside_nearest;
  if (!o) {
    return "-";
  }
  const head = o.label + ": " + o.material_short + ", " + (o.o2_frac * 100).toFixed(1) + "% O2, " + o.pressure_psia.toFixed(2) + " psia, " +
    o.outcome_short.toLowerCase() + " (";
  return el("span", null, head, plain ? "NTRS " + o.source_id : ntrsLink(o.source_url, "NTRS " + o.source_id), ")", o.inside ? " Inside the window." : "");
}

function briefSources(block, refList) {
  if (block.not_specified) {
    return el("span", { class: "small" }, NOT_SPECIFIED + (block.note ? ". " + block.note : "."));
  }
  const marks = [];
  (block.sources || []).slice(0, 1).forEach(function (src) {
    const url = src.url || "";
    const key = url || src.ref;
    let idx = refList.findIndex(function (r) { return r.key === key; });
    if (idx < 0) {
      refList.push({ key: key, label: url ? src.ref : (src.title || src.ref), url: url });
      idx = refList.length - 1;
    }
    if (marks.indexOf(idx + 1) < 0) {
      marks.push(idx + 1);
    }
  });
  return el("span", null, marks.map(function (n) { return "[" + n + "]"; }).join(""));
}

function briefDate() {
  return new Date().toISOString().slice(0, 10);
}

function renderBrief(params) {
  const env = envById(params.habitat || "");
  const back = el("a", { class: "brief-back", href: "#/rank", text: "Back" });
  if (!env || !state.data.test_next.environments[env.id]) {
    setView(el("h1", { text: "Test request brief" }), el("p", { text: "No habitat selected." }), el("p", null, back));
    return;
  }
  state.envId = env.id;
  const block = state.data.test_next.environments[env.id];
  const invCount = state.data.investigations.length;
  const rowCount = state.data.investigations.reduce(function (sum, inv) { return sum + inv.row_count; }, 0);
  const refList = [];
  const windowRows = [
    ["Oxygen", env.o2.not_specified ? NOT_SPECIFIED : env.o2.display, briefSources(env.o2, refList)],
    ["Total pressure", env.pressure_atm.not_specified ? NOT_SPECIFIED : env.pressure_atm.display, briefSources(env.pressure_atm, refList)],
    ["Cabin flow speed", env.flow_cm_s.not_specified ? NOT_SPECIFIED : env.flow_cm_s.display, briefSources(env.flow_cm_s, refList)],
    ["Gravity", env.gravity.display, briefSources(env.gravity, refList)]
  ];
  const view = setView(el("article", { class: "brief" },
    el("div", { class: "brief-actions" },
      back,
      el("button", { type: "button", id: "brief-print", text: "Print / Save as PDF", onclick: function () { window.print(); } })),
    el("h1", { text: "Fire-safety test request: " + env.name }),
    el("p", { class: "brief-purpose", text: "These conditions are planned for " + env.name + " but have never been tested in NASA's PSI combustion data." }),
    plainTable(TEST_NEXT_HEADERS, testNextRows(block, true)),
    el("h2", { text: "Habitat atmosphere" }),
    plainTable(["Quantity", "Value", "Source"], windowRows),
    el("p", { class: "brief-basis", text: "Basis: NASA PSI combustion data, " + invCount + " investigations, " + rowCount.toLocaleString("en-US") + " test rows. Generated " + briefDate() + " from https://flame-in-freefall-three.vercel.app" }),
    el("p", { class: "brief-limits", text: "Counts cover PSI only; NASA tests published outside PSI are not counted. Nearest outside-PSI NASA tests are shown for context." }),
    el("h2", { text: "References" }),
    el("ol", { class: "brief-refs" }, refList.map(function (r, i) {
      return el("li", { value: i + 1, text: "[" + (i + 1) + "] " + r.label + (r.url ? " - " + r.url : "") });
    }))));
  document.title = "Fire-safety test request: " + env.name;
  return view;
}

function renderRank() {
  const data = state.data;
  const list = el("ol", { class: "rank-cards" });
  const noteHolder = el("div", { class: "rank-note-holder" });
  const moreHolder = el("div", { class: "more" });
  const nextHolder = el("div");
  const sourcesHolder = el("div");
  const sliderHolder = el("div");
  const tableHolder = el("div");
  const howHolder = el("div");

  function drawRanking() {
    const env = currentEnv();
    const ranking = rankAll(data.investigations, env, state.weights, state.includeStream);
    const stability = rankStability(data.investigations, env, state.weights, state.includeStream);
    clear(list);
    const shown = state.showAllRanks ? ranking : ranking.slice(0, RANK_PREVIEW);
    shown.forEach(function (item) {
      const inv = invById(item.psi_id);
      list.appendChild(el("li", { class: "rank-card rank-item" },
        el("span", { class: "rank-num", text: String(item.rank) }),
        el("div", { class: "rank-main" },
          el("h3", null, invLink(inv)),
          el("p", { class: "rank-why", text: shortReason(inv, item, env) }),
          el("span", { class: "rank-range", text: stability[item.psi_id].min === stability[item.psi_id].max ? "rank stable" : "rank " + stability[item.psi_id].min + "-" + stability[item.psi_id].max + " if weights move 20%" })),
        el("div", { class: "rank-score" },
          el("span", { class: "bar", role: "img", "aria-label": "Overall score " + fmt(item.score, 2) },
            el("span", { class: "bar-fill-s", style: "width:" + Math.round(item.score * 100) + "%" })),
          el("span", { class: "score-num", text: fmt(item.score, 2) }))));
    });
    clear(moreHolder);
    if (ranking.length > RANK_PREVIEW) {
      moreHolder.appendChild(el("button", { type: "button", class: "textlink", text: state.showAllRanks ? "Show top " + RANK_PREVIEW : "Show all " + ranking.length, onclick: function () {
        state.showAllRanks = !state.showAllRanks;
        drawRanking();
      } }));
    }
    clear(tableHolder);
    tableHolder.appendChild(expander("All scores", plainTable(
      ["Rank", "Investigation", "Score", "Fuel", "Function", "Richness", "O2", "Pressure", "Flow", "Rank range"],
      ranking.map(function (item) {
        const c = item.components;
        const cell = function (v) { return v === null || v === undefined ? "n/a" : fmt(v, 2); };
        const st = stability[item.psi_id];
        return [String(item.rank), invLink(invById(item.psi_id)), fmt(item.score, 2), cell(c.fuel), cell(c.function), cell(c.richness), cell(c.o2), cell(c.pressure), cell(c.flow),
          st.min === st.max ? String(item.rank) : st.min + " to " + st.max];
      }))));
    drawHow(ranking, stability);
  }

  function drawNote() {
    clear(noteHolder);
    const env = currentEnv();
    const block = state.data.test_next.environments[env.id];
    if (!block) {
      return;
    }
    const total = block.classes.reduce(function (sum, c) { return sum + c.inside; }, 0);
    const gap = total === 0 ? "No investigation has tests inside " + envShort(env) + " air." :
      "Only " + total + (total === 1 ? " NASA test lies" : " NASA tests lie") + " inside " + envShort(env) + " air.";
    noteHolder.appendChild(el("p", { class: "rank-note" },
      "Rank shows relevance: fuel, fire-safety role, data, and how close an investigation's tests come. " + gap + " ",
      el("button", { type: "button", class: "textlink", text: "See what NASA should test next", onclick: function () {
        const target = document.getElementById("test-next");
        if (target) {
          target.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
        }
      } })));
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
    const env = currentEnv();
    sourcesHolder.appendChild(expander("Habitat sources", el("div", null,
      el("p", { class: "small", text: env.name + " runs at " + envSummary(env) + "." }),
      envSourcesTable(env))));
  }

  function drawTest() {
    clear(nextHolder);
    nextHolder.appendChild(testNextSection(currentEnv()));
  }

  function drawAll() {
    drawNote();
    drawRanking();
    drawSliders();
    drawSources();
    drawTest();
  }

  const buttons = envButtons(drawAll);
  const root = setView(
    pageHead("Rank experiments for a habitat", null, buttons),
    noteHolder,
    list,
    moreHolder,
    expander("Details", el("div", null, sourcesHolder, sliderHolder, tableHolder, howHolder)),
    nextHolder
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

const HARDWARE_FILTER_LABELS = {
  acme_cir: "ACME in the CIR",
  mdca_cir: "MDCA in the CIR",
  msg_duct: "Glovebox flow duct",
  saffire_cygnus: "Saffire in Cygnus",
  other: "Other or not stated"
};

function hardwareFamilyId(inv) {
  return inv.hardware_family ? inv.hardware_family.id : "other";
}

function renderInvestigations(params) {
  const filters = { fuel: params.fuel || "", fn: params.fn || "", hw: params.hw || "" };
  const fuelOptions = Array.from(new Set(state.data.investigations.map(fuelClassOf))).sort();
  const grid = el("div", { class: "inv-grid" });
  const count = el("p", { class: "small muted count" });

  function draw() {
    const list = state.data.investigations.filter(function (inv) {
      if (filters.fuel && fuelClassOf(inv) !== filters.fuel) {
        return false;
      }
      if (filters.fn && shownFunctions(inv).indexOf(filters.fn) < 0) {
        return false;
      }
      if (filters.hw && hardwareFamilyId(inv) !== filters.hw) {
        return false;
      }
      return true;
    });
    count.textContent = list.length + " of " + state.data.investigations.length;
    clear(grid);
    list.forEach(function (inv) {
      grid.appendChild(el("a", { class: "inv-card", href: "#/investigation/" + inv.psi_id },
        invMedia(inv),
        el("div", { class: "inv-body" },
          el("h3", { text: invLabel(inv) }),
          el("p", { class: "inv-line", text: oneLine(inv, 12) }),
          el("span", { class: "tag", text: FUEL_LABELS[fuelClassOf(inv)] }))));
    });
  }

  function select(label, options, key, labelFn) {
    return el("select", { "aria-label": label, onchange: function (e) { filters[key] = e.target.value; draw(); } },
      el("option", { value: "", text: label + ": all" }),
      options.map(function (o) { return el("option", { value: o, text: labelFn ? labelFn(o) : o, selected: filters[key] === o }); }));
  }

  const view = setView(
    pageHead("What has NASA tested?", "Browse the " + state.data.investigations.length + " PSI combustion investigations."),
    subNav([["#/investigations", "All investigations", "investigations"], ["#/compare", "Compare", "compare"], ["#/equipment", "Equipment", "equipment"], ["#/earth", "On Earth", "earth"]], "investigations"),
    el("div", { class: "filters" },
      select("Fuel class", fuelOptions, "fuel", function (o) { return FUEL_LABELS[o]; }),
      select("Function", FUNCTION_ORDER, "fn"),
      select("Hardware", Object.keys(HARDWARE_FILTER_LABELS), "hw", function (o) { return HARDWARE_FILTER_LABELS[o]; }),
      count),
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
    return setView(
      pageHead("Investigation not found", null),
      el("p", null, el("a", { href: "#/investigations", text: "Back to the list" })));
  }
  const r = inv.ranges;
  const vh = variedLines(inv);
  const fns = shownFunctions(inv);
  const objective = inv.objectives || inv.description;
  const img = inv.images && inv.images.length ? inv.images[0] : null;
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
  const stat = function (value, label) {
    return el("div", { class: "stat" }, el("p", { class: "stat-num", text: value }), el("p", { class: "stat-label", text: label }));
  };
  const hero = el("header", { class: "band hero-band" + (img ? " has-photo" : "") },
    img ? el("img", { class: "band-photo", src: img.file, alt: "Flame photo from " + invLabel(inv) }) : null,
    el("div", { class: "band-in" },
      el("p", { class: "crumb" }, el("a", { href: "#/investigations", text: "All investigations" })),
      el("h1", { text: invLabel(inv) }),
      el("p", { class: "lede", text: oneLine(inv, 14) }),
      el("p", { class: "band-tags" }, el("span", { class: "tag", text: FUEL_LABELS[fuelClassOf(inv)] }), img ? el("span", { class: "photo-credit", text: "Photo: NASA / PSI" }) : null)));
  const finding = inv.key_findings.length ? inv.key_findings[0] : null;
  const pull = finding ? el("figure", { class: "pull" },
    el("p", { class: "eyebrow", text: "Key finding" }),
    el("blockquote", { class: "pull-quote" + (finding.quote.length > 170 ? " long" : ""), text: finding.quote }),
    el("figcaption", null, el("a", { href: finding.url, target: "_blank", rel: "noopener", text: finding.source }), " - quoted word for word")) :
    el("p", { class: "muted", text: "No verified finding quote for this investigation." });
  const stats = el("div", { class: "stats" },
    stat(r.o2_ambient ? dashSpan(r.o2_ambient.min * 100, r.o2_ambient.max * 100, 1, "%") : "n/a", "ambient oxygen tested"),
    stat(String(inv.row_count), "test rows"),
    stat(String(inv.outcome_rows), "rows with an outcome"));
  return setView(
    hero,
    pull,
    stats,
    expander("What it studied", el("div", null,
      inv.challenge_notes && inv.challenge_notes.length ? el("div", null,
        el("h3", { text: "From the challenge brief" }),
        inv.challenge_notes.map(function (note) { return el("blockquote", { class: "brief-note", text: note }); })) : null,
      objective ? el("div", { class: "pre", text: objective }) : el("p", { class: "muted", text: "not provided" }),
      inv.hypothesis ? el("p", { class: "pre", text: "Hypothesis: " + inv.hypothesis }) : null,
      inv.approach ? el("p", { class: "pre", text: "Approach: " + inv.approach }) : null,
      inv.key_findings.length > 1 ? el("div", null, el("h3", { text: "More findings" }), inv.key_findings.slice(1).map(function (f) { return keyFindingBlock(f, false); }),
        el("p", { class: "small muted", text: "Verbatim from the source; each quote machine-checked against its text." })) : null)),
    expander("Conditions and data", el("div", null,
      inv.row_count ? el("dl", { class: "facts" },
        el("dt", { text: "Ambient O2" }), el("dd", { text: o2Text(r.o2_ambient) }),
        el("dt", { text: "Pressure" }), el("dd", { text: pressureText(r.pressure_atm) }),
        el("dt", { text: "Flow speed" }), el("dd", { text: rangeText(r.flow_cm_s, "cm/s") }),
        el("dt", { text: "Table rows" }), el("dd", { text: inv.row_count + " (" + inv.outcome_rows + " with an outcome)" }))
        : el("p", { class: "muted", text: "No rows in the unified conditions table for this investigation." }),
      inv.row_count ? el("p", { class: "small" }, el("a", { href: "#/data?" + qs({ inv: inv.psi_id, at: "extractor" }), text: "Open these rows in the extractor" })) : null,
      inv.row_count ? el("div", null,
        el("p", null, el("strong", { text: "Varied: " }), vh.varied.length ? vh.varied.join(", ") : "nothing recorded"),
        el("p", null, el("strong", { text: "Held constant: " }), vh.held.length ? vh.held.join(", ") : "nothing recorded")) : null,
      el("p", null, el("strong", { text: "Hardware: " }), inv.hardware || "not provided"),
      el("p", null, el("strong", { text: "Hardware family: " }),
        inv.hardware_family ? inv.hardware_family.label + (inv.hardware_family.source === "challenge statement" ? " (challenge statement)" : " (PSI hardware field)") : "not grouped"),
      inv.hardware_family && inv.hardware_family.quote ? el("p", { class: "small src", text: inv.hardware_family.quote }) : null,
      el("p", null, el("strong", { text: "Platform: " }), inv.platform || "not provided"),
      el("p", null, el("strong", { text: "Fuels in table rows: " }), inv.fuels_observed.length ? inv.fuels_observed.map(function (f) { return f.value + " (" + f.count + ")"; }).join("; ") : "not recorded"),
      el("p", null, el("strong", { text: "Sample geometry: " })), listBlock(inv.sample_geometry, 8),
      el("p", null, el("strong", { text: "Measurements: " })), listBlock(inv.diagnostics_measurements),
      el("p", null, el("strong", { text: "Outcomes: " }), inv.outcomes.length ? inv.outcomes.map(function (o) { return o.value + " (" + o.count + ")"; }).join(", ") : "none recorded"),
      el("h3", { text: "Fire-safety function evidence" }),
      inv.functions.length ? el("ul", null, inv.functions.map(function (f) {
        return el("li", null, el("strong", { text: f.function }),
          f.source === "challenge statement" ? " (challenge statement)" : " (keyword match, score " + f.score + (f.counts ? "" : ", weak evidence") + ")",
          el("span", { class: "src", text: f.basis || "" }));
      })) : el("p", { class: "muted", text: "No function assigned." }),
      inv.row_count ? el("p", { class: "small" }, inv.psi_id + " | " + inv.source_files.join("; ")) : null,
      inv.row_count && inv.value_quality.length ? el("p", { class: "small", text: "Value quality: " + inv.value_quality.map(function (q) { return q.value + " " + q.count; }).join(", ") }) : null,
      inv.row_count && inv.test_conditions_text ? el("p", { class: "pre", text: inv.test_conditions_text }) : null)),
    expander("Sources and photos", el("div", null,
      el("p", { class: "small" }, el("a", { href: inv.psi_url, text: "PSI record " + inv.psi_id }), inv.license ? " | License: " + inv.license : ""),
      pubs.length || ntrs.length ? el("ul", null, pubs.map(pubItem), ntrs) : el("p", { class: "muted", text: "No publications listed." }),
      restPubs.length ? el("details", { class: "drawer nested" }, el("summary", { text: "All " + inv.publications.length + " PSI publications" }), el("div", { class: "drawer-body" }, el("ul", null, inv.publications.map(pubItem)))) : null,
      inv.images.length ? el("div", { class: "photos" }, inv.images.map(function (im) {
        return el("figure", null,
          el("img", { src: im.file, alt: im.caption, loading: "lazy", width: im.width, height: im.height }),
          el("figcaption", { text: im.caption }));
      })) : null))
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
    ["Hardware family", function (inv) { return inv.hardware_family ? inv.hardware_family.label : "not grouped"; }],
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
    subNav([["#/investigations", "All investigations", "investigations"], ["#/compare", "Compare", "compare"], ["#/equipment", "Equipment", "equipment"], ["#/earth", "On Earth", "earth"]], "compare"),
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
      app.label ? el("p", { class: "small muted", text: app.label }) : null,
      app.quote ? el("blockquote", { class: "quote" },
        el("p", { text: "\"" + app.quote.text + "\"" }),
        el("cite", null, el("a", { href: app.quote.url, text: app.quote.source_title + ", " + app.quote.source_publisher }))) : null,
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
    subNav([["#/investigations", "All investigations", "investigations"], ["#/compare", "Compare", "compare"], ["#/equipment", "Equipment", "equipment"], ["#/earth", "On Earth", "earth"]], "earth"),
    el("div", { class: "cards" }, apps),
    expander("Earth benefits stated in the PSI records (" + records.length + ")", el("ul", null, records.map(function (inv) {
      return el("li", null, invLink(inv), ": " + clipText(inv.earth_benefits, 360));
    }))));
}

const GRAVITY_TAGS = {
  more_flammable: { cls: "lower", label: "Lunar-g test: burned at lower O2" },
  less_flammable: { cls: "higher", label: "Lunar-g test: burned only at higher O2" },
  not_stated: { cls: "none", label: "Lunar-g test direction: not stated" }
};

const GRAVITY_AXIS_MAX = 2.5;

function gravityQuote(q) {
  return el("blockquote", { class: "quote" },
    el("p", { text: "\"" + q.text + "\"" }),
    el("cite", null, el("a", { href: q.url, text: q.source_title + (q.page ? ", page " + q.page : "") })));
}

const GRAVITY_COLORS = { lower: "#b04a2a", higher: "#1f5fa8", none: "#8a8f96" };

function gravityChart(lg) {
  const th = PLOT_LIGHT;
  const small = window.innerWidth < 640;
  const rows = lg.materials.slice().sort(function (a, b) { return b.delta_o2_points - a.delta_o2_points; });
  const series = Object.keys(GRAVITY_TAGS).map(function (key) {
    return { key: key, list: rows.filter(function (m) { return m.direction === key; }) };
  }).filter(function (s) { return s.list.length > 0; });
  const idx = series.map(function (s, i) { return i; });
  const bottom = small ? 150 : 108;
  const plot = el("div", { class: "gv-plot", role: "img",
    "aria-label": "Oxygen points to allow for each material: " + rows.map(function (m) { return m.name + " " + fmt(m.delta_o2_points, 2); }).join(", ") + "." });
  plot.style.height = (rows.length * 46 + 14 + bottom) + "px";
  function traces(e) {
    return series.map(function (s) {
      const tag = GRAVITY_TAGS[s.key];
      return {
        type: "bar",
        orientation: "h",
        name: tag.label,
        y: s.list.map(function (m) { return m.name; }),
        x: s.list.map(function (m) { return m.delta_o2_points * e; }),
        text: s.list.map(function (m) { return fmt(m.delta_o2_points, 2); }),
        textposition: "outside",
        cliponaxis: false,
        textfont: { size: 13, color: th.strong },
        marker: { color: GRAVITY_COLORS[tag.cls] },
        customdata: s.list.map(function (m) { return [m.best_fit_slope_s_per_cm, m.ci95_slope_s_per_cm, plotWrap(m.direction_text, 44)]; }),
        hovertemplate: "<b>%{y}</b><br>Allowance %{text} O2 points<br>Best-fit slope %{customdata[0]} s/cm<br>95% slope %{customdata[1]} s/cm<br>%{customdata[2]}<extra></extra>"
      };
    });
  }
  const layout = Object.assign(plotBase(th), {
    height: rows.length * 46 + 14 + bottom,
    margin: { l: 8, r: 24, t: 14, b: bottom, pad: 0 },
    barmode: "overlay",
    bargap: 0.4,
    dragmode: false,
    xaxis: {
      range: [0, GRAVITY_AXIS_MAX + 0.45], tickvals: [0, 0.5, 1, 1.5, 2, 2.5], fixedrange: true, zeroline: false, showgrid: true, gridcolor: th.grid,
      showline: true, linecolor: th.axis, ticks: "", tickfont: { size: 12, color: th.muted },
      title: { text: small ? "Oxygen points to allow" : "Oxygen points to allow (percentage points of O2)", font: { size: 12, color: th.muted }, standoff: 8 }
    },
    yaxis: {
      type: "category", categoryorder: "array", categoryarray: rows.map(function (m) { return m.name; }), autorange: "reversed", fixedrange: true,
      automargin: true, showgrid: false, zeroline: false, ticks: "", tickfont: { size: 13, color: th.strong }
    },
    showlegend: true,
    legend: { orientation: "h", x: 0, xref: "container", y: 0, yref: "container", yanchor: "bottom", font: { size: 12, color: th.text }, bgcolor: "rgba(0,0,0,0)" }
  });
  plotWhenVisible(plot, function () {
    const play = !reduceMotion();
    window.Plotly.newPlot(plot, traces(play ? 0 : 1), layout, plotConfig()).then(function () {
      if (!play) {
        return;
      }
      plotRun(900, function (t) {
        const e = gapEaseOut(t);
        return window.Plotly.restyle(plot, { x: series.map(function (s) { return s.list.map(function (m) { return m.delta_o2_points * e; }); }) }, idx);
      });
    });
  });
  return el("figure", { class: "gv-chart" },
    plot,
    el("figcaption", { class: "small muted", text: "Conservative allowance from the paper, in oxygen points (percentage points of O2). Colour marks what the lunar-g tests showed, not the size of the bar." }));
}

const GV_MEAS_COLORS = ["#b04a2a", "#1f5fa8", "#2f8f5b"];
const GV_MEAS_PRELIM = "#4a4f5c";
const GV_MEAS_Y = [12, 40];
const GV_MEAS_DUR = 700;

function gravityField(p, name) {
  return p.fields.filter(function (f) { return f.name === name; })[0] || null;
}

function gravityMeasValue(f) {
  return f.as_stated ? f.as_stated.replace("~", "about ") : f.raw + "%";
}

function gravityMeasHover(p, series) {
  const f = gravityField(p, series.field);
  const press = gravityField(p, "total_pressure");
  const flow = gravityField(p, "forced_flow");
  const lines = [
    p.material,
    (series.field === "ulois_percent_o2" ? "ULOI* " : "LOC ") + gravityMeasValue(f) + " O2",
    "Pressure " + (press ? press.raw + " " + press.unit : "not stated"),
    "Flow " + (flow ? flow.raw + " " + flow.unit + " forced" : "not stated for this point"),
    "Test: " + p.gravity_label,
    "Source: " + p.source.cite + ", NTRS " + p.source.ntrs_id + ", page " + p.quote.page
  ];
  if (series.preliminary) {
    lines.push("Preliminary poster, not peer reviewed");
  }
  return lines.map(function (l, i) { return i === 0 ? "<b>" + plotEscape(l) + "</b>" : plotWrap(l, 50); }).join("<br>");
}

function gravityMeasSeries(pg) {
  const byId = {};
  pg.points.forEach(function (p) { byId[p.id] = p; });
  const labels = {};
  pg.levels.forEach(function (lv) { labels[lv.id] = lv.label; });
  let color = 0;
  return pg.chart.map(function (s) {
    const ids = pg.levels.map(function (lv) { return s.points[lv.id]; }).filter(Boolean);
    const pts = ids.map(function (id) { return byId[id]; });
    const press = gravityField(pts[0], "total_pressure");
    const mat = pts[0].material.split(" (")[0];
    const col = s.preliminary ? GV_MEAS_PRELIM : GV_MEAS_COLORS[color++ % GV_MEAS_COLORS.length];
    return {
      series: s,
      points: pts,
      color: col,
      name: mat + ", " + press.raw + " " + press.unit + (s.preliminary ? " (preliminary)" : ""),
      x: pg.levels.map(function (lv) { return lv.label; }),
      y: pg.levels.map(function (lv) { const p = byId[s.points[lv.id]]; return p ? gravityField(p, s.field).value : null; }),
      hover: pg.levels.map(function (lv) { const p = byId[s.points[lv.id]]; return p ? gravityMeasHover(p, s) : ""; })
    };
  });
}

function gravityMeasured(pg) {
  const th = PLOT_LIGHT;
  const small = window.innerWidth < 640;
  const list = gravityMeasSeries(pg);
  const moon = envById("lunar");
  const moonO2 = moon ? envNumber(moon) : pg.summary.moon_o2_percent;
  const order = pg.levels.map(function (lv) { return lv.label; });
  const base = GV_MEAS_Y[0];
  const bottom = small ? 150 : 84;
  const height = (small ? 330 : 360) + bottom;
  const plot = el("div", { class: "gv-plot gv-meas", role: "img",
    "aria-label": "Limiting oxygen by gravity level: " + list.map(function (s) { return s.name + " " + s.y.filter(function (v) { return v !== null; }).join(", "); }).join("; ") + ". Moon base air is " + moonO2 + " percent." });
  plot.style.height = height + "px";
  function traces(e) {
    const out = list.map(function (s) {
      const preliminary = s.series.preliminary;
      return {
        type: "scatter",
        mode: "lines+markers",
        name: s.name,
        x: s.x,
        y: s.y.map(function (v) { return v === null ? null : base + (v - base) * e; }),
        line: { color: s.color, width: 2.5, dash: preliminary ? "dash" : "solid" },
        marker: { color: preliminary ? "#fffdfa" : s.color, size: 9, line: { color: s.color, width: 2 } },
        hovertext: s.hover,
        hovertemplate: "%{hovertext}<extra></extra>"
      };
    });
    out.push({
      type: "scatter",
      mode: "lines",
      name: "Moon base air",
      x: [order[0], order[order.length - 1]],
      y: [moonO2, moonO2],
      line: { color: "#c2410c", width: 1.5, dash: "dot" },
      showlegend: false,
      hovertemplate: "Moon base air: " + moonO2 + "% O2<extra></extra>"
    });
    return out;
  }
  const layout = Object.assign(plotBase(th), {
    height: height,
    margin: { l: small ? 40 : 52, r: 16, t: 14, b: bottom, pad: 0 },
    dragmode: false,
    hoverdistance: 16,
    xaxis: {
      type: "category", categoryorder: "array", categoryarray: order, fixedrange: true, zeroline: false, showgrid: true, gridcolor: th.grid,
      showline: true, linecolor: th.axis, ticks: "", tickfont: { size: small ? 11 : 13, color: th.strong }, range: [-0.3, order.length - 0.7]
    },
    yaxis: {
      range: GV_MEAS_Y, tickvals: [15, 20, 25, 30, 35, 40], fixedrange: true, zeroline: false, showgrid: true, gridcolor: th.grid,
      showline: true, linecolor: th.axis, ticks: "", tickfont: { size: 12, color: th.muted },
      title: { text: "Limiting O2 (percent)", font: { size: 12, color: th.muted }, standoff: 6 }
    },
    annotations: [{ x: order[0], y: moonO2, xref: "x", yref: "y", xanchor: "left", yanchor: "bottom", showarrow: false, text: "Moon base air " + moonO2 + "%", font: { size: 12, color: "#c2410c" } }],
    showlegend: true,
    legend: { orientation: "h", x: 0, xref: "container", y: 0, yref: "container", yanchor: "bottom", font: { size: 12, color: th.text }, bgcolor: "rgba(0,0,0,0)", itemsizing: "constant" }
  });
  const idx = list.map(function (s, i) { return i; });
  plotWhenVisible(plot, function () {
    const play = !reduceMotion();
    window.Plotly.newPlot(plot, traces(play ? 0 : 1), layout, plotConfig()).then(function () {
      if (!play) {
        return;
      }
      plotRun(GV_MEAS_DUR, function (t) {
        const e = gapEaseOut(gapClamp(t));
        return window.Plotly.restyle(plot, { y: list.map(function (s) { return s.y.map(function (v) { return v === null ? null : base + (v - base) * e; }); }) }, idx);
      });
    });
  });
  const items = pg.qualitative.map(function (q) {
    return el("li", null, q.text + " ", el("a", { href: q.url, text: q.cite }));
  });
  return el("section", { class: "gv-block gv-meas-block" },
    el("h2", { text: "Measured at lunar and Martian gravity" }),
    el("p", { class: "gv-meas-head", text: pg.summary.headline + " " + pg.summary.headline_detail }),
    el("figure", { class: "gv-chart gv-meas-chart" },
      plot,
      el("figcaption", { class: "small muted", text: "Limiting oxygen at each gravity level: lower means a flame survives at less oxygen. Tests differ in pressure, flow and definitions, so they are not combined." })),
    el("h3", { text: "Other measurements" }),
    el("ul", { class: "gv-meas-list small" }, items));
}

function gravityMap(glide) {
  const reduced = reduceMotion();
  const svg = svgEl("svg", { class: "gm-svg", viewBox: "0 0 380 270", role: "img", "aria-label": "Concept drawing of a flammability map: oxygen needed against flow speed, with a quenching branch at low flow and a blowoff branch at high flow." });
  function text(x, y, str, cls, anchor) {
    const t = svgEl("text", { x: x, y: y, class: "gm-t " + (cls || ""), "text-anchor": anchor || "start" });
    t.textContent = str;
    svg.appendChild(t);
    return t;
  }
  svg.appendChild(svgEl("path", { d: "M52 24 C 62 150, 92 202, 170 206 C 240 208, 312 172, 356 112 L 356 24 Z", class: "gm-zone" }));
  svg.appendChild(svgEl("path", { d: "M52 24 C 62 150, 92 202, 170 206 C 240 208, 312 172, 356 112", class: "gm-curve" }));
  svg.appendChild(svgEl("line", { x1: 52, y1: 232, x2: 360, y2: 232, class: "gm-axis" }));
  svg.appendChild(svgEl("line", { x1: 52, y1: 232, x2: 52, y2: 18, class: "gm-axis" }));
  text(206, 256, "Flow speed over the flame", "gm-axl", "middle");
  text(0, 0, "Oxygen needed to burn", "gm-axl", "middle").setAttribute("transform", "translate(16 128) rotate(-90)");
  text(236, 70, "Burns here", "gm-zl", "middle");
  text(72, 40, "Quenching", "gm-br");
  text(72, 54, "branch", "gm-br");
  text(352, 78, "Blowoff", "gm-br", "end");
  text(352, 92, "branch", "gm-br", "end");
  svg.appendChild(svgEl("line", { x1: 262, y1: 128, x2: 262, y2: 232, class: "gm-mark" }));
  text(262, 120, "1 g: about 35 cm/s", "gm-ml", "middle");
  svg.appendChild(svgEl("rect", { x: 100, y: 162, width: 86, height: 70, class: "gm-unknown" }));
  text(143, 142, "Lunar g: lower,", "gm-ml", "middle");
  text(143, 155, "not known", "gm-ml", "middle");
  svg.appendChild(svgEl("path", { d: "M248 184 L 158 184", class: "gm-arrow" }));
  svg.appendChild(svgEl("path", { d: "M168 178 L 158 184 L 168 190", class: "gm-arrow" }));
  const flame = svgEl("g", { class: "gm-flame" + (glide ? " glide" : "") + (reduced ? " still" : "") });
  flame.appendChild(svgEl("circle", { cx: 262, cy: 184, r: 7, class: "gm-dot" }));
  svg.appendChild(flame);
  return svg;
}

function gravityHabitat(lg) {
  const lunar = envById("lunar");
  const o2 = lunar ? envNumber(lunar) : null;
  const gf = gravityFacts();
  return el("section", { class: "gv-habitat" },
    el("p", { class: "gv-hab-big", text: o2 !== null ? "Moon base air: " + o2 + "% O2" : "Moon base air" }),
    el("p", { class: "gv-hab-line", text: "NASA Glenn's 2025 allowance for " + gf.count + " materials is up to " + gf.allow + " O2 points." }),
    el("p", { class: "small muted", text: "It is a conservative allowance, not a maximum and not a measured lunar-g limit. Drop tests measured " + gf.drop + " points for " + gf.material + " at " + gf.psia + " psia. Polycarbonate and Nomex Velcro went the other way in the lunar-g tests: they burned only at higher oxygen." }));
}

function gravityDetails(lg) {
  const q = {};
  lg.quotes.forEach(function (item) { q[item.id] = item; });
  const table = plainTable(
    ["Material", "Best-fit slope (s/cm)", "95% slope (s/cm)", "Allowance (O2 points)", "Lunar-g test"],
    lg.materials.map(function (m) {
      return [m.name, String(m.best_fit_slope_s_per_cm), String(m.ci95_slope_s_per_cm), fmt(m.delta_o2_points, 2), GRAVITY_TAGS[m.direction].label.replace("Lunar-g test: ", "").replace("Lunar-g test direction: ", "")];
    }));
  return expander("Details", el("div", null,
    el("p", { class: "small" }, "Source: ", ntrsLink(lg.paper.url, lg.paper.authors + ", " + lg.paper.title), ". " + lg.paper.table + "."),
    el("p", { class: "small", text: "How the allowance is built: the paper fits the oxygen limit against forced-flow speed in 1-g testing, takes the one-tailed 95 percent confidence slope, and extends it from the presumed 1-g buoyant speed of 35 cm/s to zero flow. The lunar-g speed is not known, so no lunar-g limit is given for any material and nothing here is interpolated." }),
    table,
    gravityQuote(q.worst_case),
    gravityQuote(q.velocity_1g),
    gravityQuote(q.velocity_unknown),
    gravityQuote(q.lower_extinction),
    gravityQuote(q.higher_extinction),
    gravityQuote(q.conclusion),
    el("h3", { text: "Cross-check: BASS-II" }),
    el("p", { class: "small", text: "BASS-II on the space station reported steady spread at 13.6% O2 in microgravity, against a 1-g blowoff limit of 16% O2. That is a different configuration (a quarter-inch PMMA rod), so only rough agreement in size is claimed." }),
    gravityQuote(q.bass_blowoff),
    el("h3", { text: "Next data" }),
    el("p", { class: "small", text: "NASA plans to burn samples in real lunar gravity on the Moon." }),
    gravityQuote(q.fm2_plan),
    el("p", { class: "small muted", text: "Quotes are copied word for word, including the paper's own typos, and machine-checked against saved copies of the source pages. " + lg.verification.checked + " of " + lg.verification.checked + " verified." + partialVerifiedText() })));
}

function renderGravity() {
  const lg = state.data.lunar_g;
  return setView(
    pageHead("Moon gravity can change the answer", "NASA Glenn's 2025 allowance for " + gravityFacts().count + " materials is up to " + gravityFacts().allow + " O2 points; drop tests measured up to " + gravityFacts().drop + " for " + gravityFacts().material + ". At lunar gravity some materials burned at lower oxygen, others only at higher."),
    el("section", { class: "gv-block" },
      el("h2", { text: "How much to allow" }),
      gravityChart(lg)),
    gravityHabitat(lg),
    gravityMeasured(state.data.partial_g),
    el("section", { class: "gv-block" },
      el("h2", { text: "Why it is not a straight line" }),
      el("p", { class: "data-cap", text: "Partial gravity cannot be read off between 0 g and 1 g. Flames can die at low flow or blow off at high flow." }),
      el("figure", { class: "gm" },
        gravityMap(),
        el("figcaption", { class: "small muted", text: "Concept drawing from the paper's theory, not data. The lunar-g flow speed is not known." }))),
    gravityDetails(lg),
    el("p", { class: "small" }, el("a", { href: "#/data", text: "Back to Data" })));
}

const EQUIPMENT_FUNCTIONS = [
  ["prevention", "Prevention", "Prevention is achieved by controlling ignition sources and through material selection, which depends on understanding flammability limits."],
  ["detection", "Detection", "Fire detection was tested in microgravity through the Smoke and Aerosol Measurement Experiment studies (SAME and SAME-R)."],
  ["suppression", "Suppression", "Suppression was studied in the Flame Extinguishment Experiment (FLEX) through dilution of the chamber atmosphere with carbon dioxide and helium, both of which suppress fire."]
];

function equipmentQuote(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= 140) {
    return flat;
  }
  return flat.slice(0, flat.slice(0, 140).lastIndexOf(" ")) + " ...";
}

function equipmentRank(a, b) {
  const ak = a.key_findings.length ? 1 : 0;
  const bk = b.key_findings.length ? 1 : 0;
  return bk - ak || b.row_count - a.row_count;
}

function equipmentOrder(fn) {
  const weight = function (inv) {
    const hit = inv.functions.filter(function (x) { return x.function === fn; })[0];
    if (!hit) {
      return [2, 1, 0];
    }
    return [hit.source === "challenge statement" ? 0 : 1, inv.key_findings.length ? 0 : 1, -(hit.score || 0)];
  };
  return function (a, b) {
    const wa = weight(a), wb = weight(b);
    return wa[0] - wb[0] || wa[1] - wb[1] || wa[2] - wb[2] || equipmentRank(a, b);
  };
}

function renderEquipment() {
  const all = state.data.investigations;
  const cards = EQUIPMENT_FUNCTIONS.map(function (f) {
    const list = all.filter(function (inv) { return inv.primary_function === f[0]; }).sort(equipmentOrder(f[0]));
    const shown = list.slice(0, 4);
    return el("article", { class: "eq-card" },
      el("h2", { text: f[1] }),
      el("blockquote", { class: "eq-informs" }, el("p", { text: f[2] }), el("footer", { text: "Challenge statement" })),
      el("ul", { class: "eq-list" }, shown.map(function (inv) {
        const kf = inv.key_findings.length ? inv.key_findings[0] : null;
        return el("li", null,
          el("strong", null, invLink(inv)),
          kf ? el("p", { class: "eq-quote", text: equipmentQuote(kf.quote) }) : null,
          kf ? el("span", { class: "eq-src", text: kf.source }) : null);
      })),
      el("p", { class: "eq-all" }, el("a", { href: "#/investigations?fn=" + f[0], text: list.length > shown.length ? "All " + list.length + " " + f[0] + " investigations" : "See them in the list" })));
  });
  const basic = all.filter(function (inv) { return inv.primary_function === "fundamental"; }).length;
  return setView(
    pageHead("Research for fire-safety equipment", "NASA's spacecraft fire safety work is focused on prevention, detection, and suppression."),
    subNav([["#/investigations", "All investigations", "investigations"], ["#/compare", "Compare", "compare"], ["#/equipment", "Equipment", "equipment"], ["#/earth", "On Earth", "earth"]], "equipment"),
    el("div", { class: "eq-wrap" },
      el("div", { class: "eq-grid" }, cards),
      el("p", { class: "eq-foot muted" }, el("a", { href: "#/investigations?fn=fundamental", text: basic + " more investigations study the flame physics behind all three." }))));
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
    file: p.file || null,
    row: numOrNull(p.row),
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
    if (f.file && r.source_file !== f.file) {
      return false;
    }
    if (f.row !== null && f.row !== undefined && r.source_row !== f.row) {
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
  if (f.file) { parts.push("source_file = " + f.file); }
  if (f.row !== null && f.row !== undefined) { parts.push("source_row = " + f.row); }
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

function readinessPanel(compact) {
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
    const detail = el("div", null, block.items.map(function (item) {
      const invList = item.investigations.length ? el("ul", null, item.investigations.map(function (i) {
        const inv = invById(i.psi_id);
        return el("li", null, inv ? invLink(inv) : i.psi_id,
          ": " + i.rows + " rows, " + i.response_rows + " with a response, " + i.counted_rows + " counted");
      })) : null;
      return el("div", { class: "detail-block", id: "ready-" + item.id },
        el("h4", { text: titles[item.id] }),
        el("p", { class: "small", text: item.reason }),
        invList,
        item.investigations.length ? el("p", { class: "small muted", text: readinessRanges(item) + (item.diluents && item.diluents.length ? "; diluents: " + item.diluents.join(", ") : "") + "." }) : null,
        el("p", { class: "small", text: item.gap }),
        item.investigations.length ? el("a", { class: "small", href: "#/data?" + qs(Object.assign({ at: "extractor" }, item.link)), text: "Open these rows in the extractor" }) : null);
    }));
    const notes = el("div", null,
      el("p", { class: "small muted", text: mr.rule }),
      el("p", { class: "small muted", text: mr.no_model_note }),
      el("p", { class: "small muted", text: mr.grouped_validation_note }));
    if (compact) {
      holder.appendChild(expander("What would close each gap", el("div", null, detail, notes)));
    } else {
      holder.appendChild(el("h3", { text: "What would close each gap" }));
      holder.appendChild(detail);
      holder.appendChild(notes);
    }
  }

  const root = el("div", { class: "panel" }, envButtons(draw), holder);
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
  const controls = el("details", { class: "filters-box", open: params.inv || params.row || params.fuel || params.o2min || params.pmin || params.fmin || params.basis ? true : null },
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

  const root = el("div", { class: "panel" },
    controls,
    summary,
    el("p", { class: "buttons" },
      el("button", { type: "button", class: "btn", text: "Download CSV", onclick: function () { exportCsv(filtered, f); } }),
      el("button", { type: "button", class: "btn ghost", text: "Download JSON", onclick: function () { exportJson(filtered, f); } })),
    tableHolder,
    el("p", { class: "small muted", text: "Every row is a microgravity test with its PSI file and row. The downloads carry units, provenance and a validity note. " + data.model_readiness.grouped_validation_note }));
  update();
  return root;
}

function insightsPanel() {
  const items = state.data.insights.insights.map(function (ins) {
    return el("li", { id: "insight-" + ins.id },
      el("details", { class: "drawer nested" },
        el("summary", { text: ins.headline || ins.title }),
        el("div", { class: "drawer-body" },
          el("p", { text: ins.text }),
          insightTable(ins),
          ins.links.length ? el("p", { class: "small" }, el("strong", { text: "Rows behind it: " }),
            ins.links.map(function (l, i) {
              return [i ? " | " : "", el("a", { href: "#/data?" + qs(Object.assign({ at: "extractor" }, l.params)), text: l.label })];
            })) : null,
          ins.sources ? el("p", { class: "small" }, el("strong", { text: "Sources: " }),
            ins.sources.map(function (l, i) {
              return [i ? " | " : "", ntrsLink(l.url, l.label)];
            })) : null,
          el("p", { class: "small muted" }, el("strong", { text: "Limits: " }), ins.limits))));
  });
  return el("ul", { class: "plain-list" }, items);
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
  if (ins.id === "outside_psi_solids") {
    return plainTable(["Test", "Material", "O2", "Pressure", "Outcome", "Source"], n.tests_table.map(function (t) {
      return [t.label, t.material_short, t.o2_percent.toFixed(1) + "%", t.pressure_psia === null ? "not stated" : t.pressure_psia.toFixed(2) + " psia",
        t.outcome_short, ntrsLink(t.source_url, "NTRS " + t.source_id)];
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

function verificationFacts() {
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
  if (v.outside_psi) {
    bits.push((v.outside_psi.checked - v.outside_psi.failed) + " of " + v.outside_psi.checked + " outside-PSI quotes verified.");
  }
  if (v.ask_eval) {
    bits.push(v.ask_eval.v2 ? "Ask check: " + v.ask_eval.v2.passed + " of " + v.ask_eval.v2.total + " passed on pre-registered checks; " + Math.round(v.ask_eval.v2.numeric_fidelity * 1000) / 10 + "% of numbers matched the data." : "Ask check: " + v.ask_eval.preregistered_passed + " of " + v.ask_eval.total + " passed on pre-registered checks.");
  }
  return bits;
}

const HEALTH_LABELS = {
  duplicate_row: "Identical to an earlier row",
  o2_scale_mismatch: "O2 on the wrong scale",
  o2_out_of_bounds: "O2 out of bounds",
  pressure_out_of_bounds: "Pressure out of bounds",
  negative_flow: "Negative flow",
  non_numeric_token: "Text where a number is expected"
};
const HEALTH_SHOW = 12;

function healthLabel(rule) {
  return HEALTH_LABELS[rule] || rule;
}

function healthRowLink(it) {
  return el("a", { href: "#/data?" + qs({ inv: it.psi_id, file: it.source_file, row: it.source_row, at: "extractor" }), text: it.source_file + ", row " + it.source_row });
}

function healthPanel() {
  const h = state.data.data_health;
  const rules = Object.keys(h.rules).filter(function (k) { return h.rules[k].count > 0; });
  const view = { rule: "all", all: false };
  const pills = el("div", { class: "pills health-pills", role: "group", "aria-label": "Rule" });
  const tableHolder = el("div");
  function shown() {
    return h.items.filter(function (it) { return view.rule === "all" || it.rule === view.rule; });
  }
  function draw() {
    Array.prototype.forEach.call(pills.children, function (b) {
      b.classList.toggle("active", b.getAttribute("data-key") === view.rule);
      b.setAttribute("aria-pressed", b.getAttribute("data-key") === view.rule ? "true" : "false");
    });
    clear(tableHolder);
    const items = shown();
    const rows = (view.all ? items : items.slice(0, HEALTH_SHOW)).map(function (it) {
      return [healthRowLink(it), it.column, it.raw_value, healthLabel(it.rule), it.why];
    });
    tableHolder.appendChild(plainTable(["File and row", "Column", "Value", "Rule", "Why flagged"], rows));
    if (items.length > HEALTH_SHOW) {
      tableHolder.appendChild(el("button", { type: "button", class: "textlink", id: "health-more", text: view.all ? "Show fewer" : "Show all " + items.length, onclick: function () { view.all = !view.all; draw(); } }));
    }
  }
  function pill(key, label) {
    return el("button", { type: "button", class: "pill", "data-key": key, "aria-pressed": "false", text: label, onclick: function () { view.rule = key; view.all = false; draw(); } });
  }
  pills.appendChild(pill("all", "All (" + h.items.length + ")"));
  rules.forEach(function (k) {
    pills.appendChild(pill(k, healthLabel(k) + " (" + h.rules[k].count + ")"));
  });
  draw();
  return el("div", { id: "health-panel" },
    el("p", { text: "Flagged by a rule, not confirmed errors. Nothing here guesses a corrected value." }),
    pills,
    tableHolder,
    el("p", { class: "small muted", text: h.summary.rows_scanned.toLocaleString("en-US") + " rows in " + h.summary.tables_scanned + " tables scanned. " + Object.keys(h.rules).map(function (k) { return healthLabel(k) + ": " + h.rules[k].description; }).join(" ") }));
}

function dataCard(num, line, extra) {
  return el("article", { class: "dcard" },
    el("p", { class: "dcard-num", text: num }),
    el("p", { class: "dcard-line", text: line }),
    extra || null);
}

function renderData(params) {
  const filterParams = Object.assign({}, params);
  delete filterParams.at;
  const data = state.data;
  const mr = data.model_readiness;
  const lunarItems = mr.environments.lunar.items;
  const partly = lunarItems.filter(function (i) { return i.status !== "Not supported"; }).length;
  const bits = verificationFacts();
  const v = data.verification;
  const map = mapPanel();
  const mapBlock = el("section", { class: "data-block", id: "map" },
    el("h2", { text: "Where a model built on this data can be trusted" }),
    el("p", { class: "data-cap", text: "Each dot is a NASA test. Boxes are habitat air. A model is only trustworthy inside the dots." }),
    map.body);
  const modelBlock = modelPanel();
  const readyBlock = el("section", { class: "data-block", id: "readiness" },
    el("h2", { text: "Model readiness" }),
    readinessPanel(true));
  const drawers = { readiness: readyBlock };
  function drawer(id, label, body, onOpen) {
    const node = expander(label, body, false, id);
    node.addEventListener("toggle", function () {
      if (node.open && onOpen) {
        onOpen();
      }
    });
    drawers[id] = node;
    return node;
  }
  const open = function (id) {
    return function () {
      const node = drawers[id];
      node.open = true;
      node.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    };
  };
  const link = function (id, text) {
    return el("button", { type: "button", class: "textlink", text: text, onclick: open(id) });
  };
  const extractor = extractorPanel(filterParams);
  const cards = [
    dataCard(fmt(data.lunar_g.paper.worst_case_delta_o2_points, 1), "O2 points: NASA Glenn's allowance for a 1-g margin on the Moon. Drop tests measured up to " + gravityFacts().drop + " for " + gravityFacts().material + ".", el("a", { class: "textlink", href: "#/gravity", text: "Lunar gravity check" })),
    dataCard(partly + " of " + lunarItems.length, "model relationships are at least partly supported for a Moon base.", link("readiness", "Details")),
    dataCard(data.conditions.length.toLocaleString("en-US"), "rows of test conditions, ready to download.",
      el("div", { class: "card-actions" },
        el("button", { type: "button", id: "download-csv", class: "btn", text: "CSV", onclick: function () { exportCsv(applyFilter(data.conditions, state.extractor), state.extractor); } }),
        el("button", { type: "button", id: "download-json", class: "btn ghost", text: "JSON", onclick: function () { exportJson(applyFilter(data.conditions, state.extractor), state.extractor); } }),
        link("extractor", "Filters")))
  ];
  if (bits && v.audit) {
    cards.push(dataCard(v.audit.passed.toLocaleString("en-US"), "of " + v.audit.checked.toLocaleString("en-US") + " audit checks passed against the original NASA files.",
      el("div", { class: "card-actions" }, link("verification", "Details"), el("a", { class: "textlink", href: "#/verification", text: "Full record" }))));
  }
  const list = [
    drawer("extractor", "Filter and download", extractor),
    bits ? drawer("verification", "How we checked it", el("div", null, el("ul", null, bits.map(function (b) { return el("li", { text: b }); })),
      el("p", null, el("a", { class: "btn", href: "#/verification", text: "Open the full verification" })))) : null,
    drawer("insights", "What the numbers say", insightsPanel()),
    state.data.data_health.items.length ? drawer("health", "For PSI curators: " + state.data.data_health.summary.flagged_rows + " rows to review", healthPanel()) : null
  ];
  const view = setView(
    pageHead("Data and models", "What the data can support, and how to use it."),
    el("div", { class: "dcards" }, cards),
    mapBlock,
    modelBlock,
    readyBlock,
    el("div", { class: "drawer-list" }, list)
  );
  map.draw();
  return view;
}

function checkDrawer(id, title, body) {
  return expander(title, body, false, id);
}

function renderVerification() {
  const v = state.data.verification;
  if (!v.present) {
    return setView(
      pageHead("How we checked it", "Verification data is not part of this build."),
      el("p", null, el("a", { href: "#/data", text: "Back to Data" })));
  }
  const list = [];
  if (v.audit) {
    list.push(checkDrawer("audit", "Audit of the unified table: " + v.audit.passed + " of " + v.audit.checked + " checks passed", el("div", null,
      el("p", { text: v.audit.failed + " failed." + (v.audit.seed ? " Random seed " + v.audit.seed + "." : "") }),
      plainTable(["Check", "What it does", "Checked", "Passed", "Failed"], v.audit.checks.map(function (c) {
        return [c.title, c.description, String(c.checked), String(c.passed), String(c.failed)];
      })))));
  }
  if (v.quotes) {
    const noFinding = v.quotes.no_finding || [];
    list.push(checkDrawer("quotes", "Key-finding quotes: " + v.quotes.verified + " of " + v.quotes.checked + " verified", el("div", null,
      el("p", { text: "Each quote was found word for word in its NASA source text." + (noFinding.length ? " " + noFinding.length + " investigations (" + noFinding.join(", ") + ") have no result statement in the NASA text we could retrieve, so they carry no quote." : "") }),
      plainTable(["Investigation", "Source", "Quote", "Verified"], v.quotes.items.map(function (q) {
        const inv = invById(q.psi_id);
        const text = q.quote.length > 160 ? q.quote.slice(0, 157) + "..." : q.quote;
        return [inv ? invLink(inv, q.psi_id) : q.psi_id, q.url ? el("a", { href: q.url, text: q.source || "source" }) : q.source, text, q.verified ? "yes" : "no"];
      })))));
  }
  if (v.outside_psi) {
    list.push(checkDrawer("outside-psi-quotes", "Outside-PSI quotes: " + (v.outside_psi.checked - v.outside_psi.failed) + " of " + v.outside_psi.checked + " verified", outsideVerificationBlock(v.outside_psi)));
  }
  if (v.lunar_g) {
    list.push(checkDrawer("lunar-g-quotes", "Lunar gravity quotes: " + (v.lunar_g.checked - v.lunar_g.failed) + " of " + v.lunar_g.checked + " verified",
      simpleVerificationBlock(v.lunar_g, "pipeline/verify_lunar_g.py", "data/lunar_g", "Every quote behind the lunar gravity check was matched to its saved source text")));
  }
  if (v.earth) {
    list.push(checkDrawer("earth-quotes", "Earth-use quotes: " + (v.earth.checked - v.earth.failed) + " of " + v.earth.checked + " verified",
      simpleVerificationBlock(v.earth, "pipeline/verify_earth.py", "data/earth", "Every quote behind the Earth uses was matched to its saved source text")));
  }
  if (v.partial_g) {
    list.push(checkDrawer("partial-g-sources", "Partial-gravity sources: " + (v.partial_g.quotes - v.partial_g.failed) + " quotes and " + v.partial_g.fields + " numbers verified", partialVerificationBlock(v.partial_g)));
  }
  if (v.ask_eval) {
    const evalV2 = v.ask_eval.v2;
    const askTitle = evalV2 ?
      "Ask accuracy: " + evalV2.passed + " of " + evalV2.total + " passed on checks fixed before the run" :
      "Ask accuracy: " + v.ask_eval.preregistered_passed + " of " + v.ask_eval.total + " passed on pre-registered checks";
    list.push(checkDrawer("ask-accuracy", askTitle, askEvalBlock(v.ask_eval)));
  }
  return setView(
    pageHead("How we checked it", "Every row and every quote is matched to its NASA source."),
    el("p", { class: "small" }, el("a", { href: "#/data", text: "Back to Data" })),
    v.quotes_total ? el("p", { text: v.quotes_total.toLocaleString("en-US") + " quotes checked word for word against saved NASA source text." }) : null,
    state.data.data_health.items.length ? el("p", { class: "small" }, "Data health: " + state.data.data_health.summary.flagged_rows + " PSI rows flagged for curator review. ", el("a", { href: "#/data?at=health", text: "See the rows" })) : null,
    el("div", { class: "drawer-list" }, list)
  );
}

function partialVerifiedText() {
  const pv = state.data.verification.partial_g;
  if (!pv) {
    return "";
  }
  return " The measured chart rests on " + pv.quotes + " more quotes and " + pv.fields + " numbers from " + pv.sources + " NASA sources, all verified.";
}

function simpleVerificationBlock(o, script, dir, what) {
  return el("div", null,
    el("p", { text: what + (o.failed ? ", except " + o.failed + " that failed." : ".") }),
    el("p", { class: "small", text: script + " writes its result to " + dir + "/verification.json." }),
    el("p", null, el("a", { href: REPO_URL + "/tree/main/" + dir, target: "_blank", rel: "noopener", text: dir + " on GitHub" })));
}

function partialVerificationBlock(p) {
  return el("div", null,
    el("p", { text: p.points + " points from " + p.sources + " NASA sources; " + p.quotes + " quotes and " + p.fields + " numbers were matched to saved source text" + (p.failed ? ", except " + p.failed + " that failed." : ".") }),
    el("p", { class: "small", text: "pipeline/verify_partial_g.py reads data/partial_g/partial_g.json and writes data/partial_g/verification.json." }),
    el("p", null, el("a", { href: REPO_URL + "/tree/main/data/partial_g", target: "_blank", rel: "noopener", text: "data/partial_g on GitHub" })));
}

function outsideVerificationBlock(o) {
  return el("div", null,
    el("p", { text: "Every quote behind the Saffire IV-VI tests and the NASA-sourced solid pressures was matched to its NTRS text" + (o.failed ? ", except " + o.failed + " that failed." : ".") }),
    el("p", { class: "small", text: "pipeline/verify_outside_psi.py reads data/outside_psi/saffire_iv_vi.json and data/outside_psi/solid_pressure_sources.json. Each quote is normalized and searched on its stated page of the downloaded NTRS text; the result is written to data/outside_psi/verification.json." }),
    o.errors.length ? el("ul", null, o.errors.map(function (e) { return el("li", { text: e }); })) : el("p", { class: "small", text: "No failures." }),
    el("p", null, el("a", { href: REPO_URL + "/tree/main/data/outside_psi", target: "_blank", rel: "noopener", text: "data/outside_psi on GitHub" })));
}

function askEvalV2Block(b) {
  const pct = function (x) { return x === null || x === undefined ? "n/a" : Math.round(x * 1000) / 10 + "%"; };
  const group = function (g) { return g.passed + " of " + g.total; };
  const rows = [
    ["Pass rate on pre-registered checks", b.passed + " of " + b.total + " (" + pct(b.pass_rate) + ")"],
    ["Answerable questions correct and cited", group(b.answerable)],
    ["Multi-step questions needing a data tool", group(b.multistep)],
    ["Trap questions refused with Not in the data", b.trap_refused + " of " + b.trap_total],
    ["Trap answers with no invented number", group(b.trap)],
    ["Numeric fidelity", b.numbers_matched + " of " + b.numbers_claimed + " numbers matched (" + pct(b.numeric_fidelity) + ")"],
    ["Citation rate on answerable questions", pct(b.citation_rate)],
    ["Latency, median and 90th percentile", b.latency_median_s + " s and " + b.latency_p90_s + " s"]
  ];
  return el("div", null,
    el("p", { text: b.passed + " of " + b.total + " questions passed checks written and committed before the run; all " + b.trap_total + " trap questions were refused." }),
    plainTable(["Measure", "Result"], rows),
    el("p", { class: "small", text: "Re-read afterwards, " + b.passed_after_review + " of " + b.total + " would pass. The headline stays at the pre-registered score; nothing was edited after the run." }),
    el("ul", null, b.reviewed.map(function (r) { return el("li", { text: r.id + " (" + r.after_review + "): " + r.reason }); })),
    el("p", null, el("a", { href: b.url, target: "_blank", rel: "noopener", text: "v2 question set, checks and raw answers on GitHub" })));
}

function askEvalBlock(a) {
  const failedCount = a.checker_fixes.length;
  return el("div", null,
    a.v2 ? askEvalV2Block(a.v2) : null,
    a.v2 ? el("p", { class: "small", text: "Earlier 12-question check:" }) : null,
    el("p", { text: a.preregistered_passed + " of " + a.total + " passed on checks fixed before the run: " + a.answerable_passed + " of " +
      a.answerable_total + " answerable questions correct and cited." }),
    el("p", { text: failedCount + " trap answers failed the original checks; on review each replied 'Not in the data' without inventing a value, and the checks were then loosened (listed)." }),
    el("ul", null, a.checker_fixes.map(function (f) { return el("li", { text: f.id + ": " + f.fix }); })),
    el("p", { text: "After the loosening: " + a.final_passed + " of " + a.total + " passed. The question set, checks and raw answers are in the eval folder." }),
    el("p", null, el("a", { href: a.url, target: "_blank", rel: "noopener", text: "eval files on GitHub" })));
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

const NTRS_ID_RE = /NTRS (\d{8,})/;
const NTRS_FALLBACK_URL = "https://ntrs.nasa.gov/citations/20250002675";

function externalCitation(c) {
  const title = c.title || "document";
  if (!c.psi_id || c.psi_id.indexOf("NTRS-") !== 0) {
    return title;
  }
  const match = NTRS_ID_RE.exec(String(c.cited_text || ""));
  return ntrsLink(match ? "https://ntrs.nasa.gov/citations/" + match[1] : NTRS_FALLBACK_URL, title);
}

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
      inv ? invLink(inv, c.title || invLabel(inv)) : externalCitation(c), quote, toggle);
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
      openAncestors(target);
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
  if (r.name === "equipment") {
    return { page: "equipment" };
  }
  if (r.name === "investigations" || r.name === "investigation" || r.name === "compare" || r.name === "earth" || r.name === "equipment") {
    return { page: "investigations" };
  }
  if (r.name === "data" || r.name === "verification" || r.name === "gravity") {
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
  if (ctx.page === "equipment") {
    return "Equipment";
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

function cleanAskSteps(list) {
  return (Array.isArray(list) ? list : []).filter(function (s) {
    return s && typeof s.label === "string" && s.label.trim();
  }).slice(0, ASK_MAX_STEPS).map(function (s) {
    return { tool: typeof s.tool === "string" ? s.tool : "", label: s.label, detail: typeof s.detail === "string" ? s.detail : "" };
  });
}

function cleanNumberCheck(value) {
  if (!value || typeof value !== "object" || !Number.isInteger(value.total) || !Number.isInteger(value.matched) || value.total < 0 || value.matched < 0 || value.matched > value.total) {
    return null;
  }
  const unmatched = (Array.isArray(value.unmatched) ? value.unmatched : []).filter(function (u) {
    return typeof u === "string" && u.trim();
  }).slice(0, ASK_MAX_UNMATCHED);
  return { total: value.total, matched: value.matched, unmatched: unmatched };
}

function cleanAskActions(list) {
  return (Array.isArray(list) ? list : []).filter(function (a) {
    return a && typeof a.label === "string" && a.label.trim() && typeof a.href === "string" && a.href.indexOf("#/") === 0;
  }).slice(0, ASK_MAX_ACTIONS).map(function (a) {
    return { label: a.label, href: a.href };
  });
}

function cleanAskFollowups(list) {
  return (Array.isArray(list) ? list : []).filter(function (q) {
    return typeof q === "string" && q.trim();
  }).slice(0, ASK_MAX_FOLLOWUPS);
}

function saveAskState() {
  const storage = askStorage();
  if (!storage) {
    return;
  }
  const thread = askPanel.thread.filter(function (t) {
    return !t.pending;
  }).slice(-ASK_MAX_STORED_TURNS).map(function (t) {
    return {
      question: t.question,
      answer: t.answer || null,
      citations: t.citations || [],
      steps: cleanAskSteps(t.steps),
      numberCheck: cleanNumberCheck(t.numberCheck),
      actions: cleanAskActions(t.actions),
      followups: cleanAskFollowups(t.followups),
      error: t.error || null
    };
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
        steps: cleanAskSteps(t.steps),
        numberCheck: cleanNumberCheck(t.numberCheck),
        actions: cleanAskActions(t.actions),
        followups: cleanAskFollowups(t.followups),
        error: typeof t.error === "string" ? t.error : null,
        stepsShown: true
      };
    });
  } catch (err) {
    askPanel.thread = [];
  }
}

function elapsedText(turn) {
  return Math.max(0, Math.floor((Date.now() - (turn.startedAt || Date.now())) / 1000)) + " s";
}

function stepTick() {
  const svg = svgEl("svg", { class: "tick", viewBox: "0 0 12 12", width: "12", height: "12", "aria-hidden": "true", focusable: "false" });
  svg.appendChild(svgEl("path", { d: "M2 6.5 L5 9.5 L10 3" }));
  return svg;
}

function playSteps(turn, items) {
  if (turn.stepsShown) {
    return;
  }
  turn.stepsShown = true;
  if (reduceMotion()) {
    return;
  }
  items.forEach(function (li) { li.classList.add("step-hide"); });
  items.forEach(function (li, i) {
    setTimeout(function () {
      li.classList.remove("step-hide");
      li.classList.add("step-in");
    }, 120 + i * 220);
  });
}

function numberCheckLine(check) {
  if (!check || !check.total) {
    return null;
  }
  const missing = check.total - check.matched;
  if (!missing) {
    return el("p", { class: "ask-numcheck" }, stepTick(), "Numbers checked: " + check.matched + " of " + check.total + " match the NASA data");
  }
  const shown = check.unmatched.slice(0, 3).join(", ");
  const more = check.unmatched.length > 3 ? " and " + (check.unmatched.length - 3) + " more" : "";
  return el("p", { class: "ask-numcheck warn" }, check.matched + " of " + check.total + " numbers match; " + missing + " not found in the sources" + (shown ? ": " + shown + more : ""));
}

function askStepsView(steps, open, turn, check) {
  const items = steps.map(function (s) {
    return el("li", null, stepTick(), el("span", { class: "ask-step-label", text: s.label }), s.detail ? el("span", { class: "ask-step-detail", text: s.detail }) : null);
  });
  const unmatched = check && check.unmatched.length ? check.unmatched : [];
  if (unmatched.length) {
    items.push(el("li", { class: "ask-step-warn" },
      el("span", { class: "ask-step-label", text: "Not found in the cited text or data tools" }),
      el("span", { class: "ask-step-detail", text: unmatched.join(", ") })));
  }
  const details = el("details", { class: "ask-steps", open: open ? true : null },
    el("summary", { text: "How I checked (" + items.length + ")" }),
    el("ul", { class: "ask-steps-list" }, items));
  if (open) {
    playSteps(turn, items);
  } else {
    details.addEventListener("toggle", function () {
      if (details.open) {
        playSteps(turn, items);
      }
    });
  }
  return details;
}

function askTurnView(turn, index) {
  const scope = "t" + index;
  const kids = [el("div", { class: "ask-q", text: turn.question })];
  if (turn.pending) {
    kids.push(el("p", { class: "ask-status muted" }, "Checking the data and NASA documents ", el("span", { class: "ask-elapsed", text: elapsedText(turn) })));
  } else if (turn.error) {
    kids.push(el("p", { class: "ask-error", role: "alert", text: turn.error }));
  } else {
    const citations = turn.citations || [];
    const steps = turn.steps || [];
    const actions = turn.actions || [];
    kids.push(el("div", { class: "ask-a" },
      turn.answer.indexOf("Not in the data.") >= 0 ? el("p", null, tag("Not in the data")) : null,
      answerView(turn.answer, citations, scope),
      numberCheckLine(turn.numberCheck),
      actions.length ? el("div", { class: "ask-actions" }, actions.map(function (a) {
        return el("a", { class: "ask-action", href: a.href, text: a.label });
      })) : null,
      steps.length || (turn.numberCheck && turn.numberCheck.unmatched.length) ? askStepsView(steps, turn.openSteps === true, turn, turn.numberCheck) : null,
      citations.length ? el("details", { class: "ask-sources" },
        el("summary", { text: "Sources (" + citations.length + ")" }),
        el("div", { class: "ask-cites" }, citationList(citations, scope))) : null));
  }
  return el("div", { class: "ask-turn" }, kids);
}

function askRows(questions) {
  return el("div", { class: "ask-suggest", id: "ask-suggest" }, questions.map(function (q) {
    return el("button", { type: "button", class: "ask-suggest-row", onclick: function () { sendAsk(q, true); } },
      el("span", { class: "ask-arrow", "aria-hidden": "true", text: "->" }),
      el("span", { class: "ask-row-text", text: q }));
  }));
}

function renderAskMore() {
  const box = askPanel.nodes.more;
  if (!box) {
    return;
  }
  clear(box);
  if (!state.data) {
    return;
  }
  const ctx = contextFromRoute(parseHash(), state.envId);
  const turns = askPanel.thread;
  if (!turns.length) {
    box.appendChild(el("p", { class: "ask-intro", text: ASK_INTRO }));
    box.appendChild(askRows(suggestionsFor(ctx)));
    return;
  }
  const last = turns[turns.length - 1];
  if (last.pending || last.error || !last.answer) {
    return;
  }
  let list = cleanAskFollowups(last.followups);
  if (!list.length) {
    const asked = {};
    turns.forEach(function (t) { asked[normalizeQuestion(t.question)] = true; });
    list = suggestionsFor(ctx).filter(function (q) { return !asked[normalizeQuestion(q)]; }).slice(0, ASK_MAX_FOLLOWUPS);
  }
  if (!list.length) {
    return;
  }
  box.appendChild(el("p", { class: "ask-more-title", text: "Follow up" }));
  box.appendChild(askRows(list));
}

function renderAskThread() {
  const holder = askPanel.nodes.thread;
  clear(holder);
  askPanel.thread.forEach(function (turn, index) {
    holder.appendChild(askTurnView(turn, index));
  });
  holder.appendChild(askPanel.nodes.more);
  renderAskMore();
  const turns = holder.querySelectorAll(".ask-turn");
  holder.scrollTop = turns.length ? turns[turns.length - 1].offsetTop - 4 : 0;
  askPanel.nodes.send.disabled = askPanel.busy;
}

const askCache = { promise: null, entries: {} };

function normalizeQuestion(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function loadAskCache() {
  if (!askCache.promise) {
    askCache.promise = fetch("data/ask_cache.json").then(function (res) {
      return res.ok ? res.json() : {};
    }).then(function (data) {
      askCache.entries = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    }).catch(function () {
      askCache.entries = {};
    });
  }
  return askCache.promise;
}

function cachedAnswer(question) {
  const hit = askCache.entries[normalizeQuestion(question)];
  return hit && typeof hit.answer === "string" && hit.answer ? hit : null;
}

function renderAskContext() {
  const box = askPanel.nodes.context;
  clear(box);
  if (!state.data) {
    return;
  }
  const ctx = contextFromRoute(parseHash(), state.envId);
  if (askPanel.useContext) {
    box.appendChild(el("span", { class: "ask-context-pill" },
      el("span", { class: "ask-context-label", text: "Using this page: " + contextLabel(ctx) }),
      el("button", { type: "button", class: "ask-context-x", "aria-label": "Stop using this page", text: "x", onclick: function () { setAskContext(false); } })));
  } else {
    box.appendChild(el("button", { type: "button", class: "ask-context-on", text: "Use this page", onclick: function () { setAskContext(true); } }));
  }
}

function setAskContext(on) {
  askPanel.useContext = on;
  saveAskState();
  renderAskContext();
}

function refreshAskPanel() {
  if (!askPanel.built || !state.data) {
    return;
  }
  renderAskContext();
  renderAskMore();
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

function stopAskTimer() {
  if (askPanel.timer) {
    clearInterval(askPanel.timer);
    askPanel.timer = null;
  }
}

function resizeAskInput() {
  const input = askPanel.nodes.input;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, ASK_INPUT_MAX_PX) + "px";
  input.style.overflowY = input.scrollHeight > ASK_INPUT_MAX_PX ? "auto" : "hidden";
}

function clearAskInput() {
  askPanel.nodes.input.value = "";
  resizeAskInput();
}

function newAskConversation() {
  askPanel.generation += 1;
  askPanel.busy = false;
  askPanel.thread = [];
  stopAskTimer();
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

function sendAsk(text, fromChip, openSteps) {
  const question = String(text || "").trim();
  if (askPanel.busy || !question) {
    return;
  }
  const ctx = contextFromRoute(parseHash(), state.envId);
  const body = askRequestBody(question, ctx, askPanel.useContext, askPanel.thread);
  const hit = fromChip === true ? cachedAnswer(question) : null;
  if (hit) {
    askPanel.thread.push({
      question: question, pending: false, answer: hit.answer, citations: hit.citations || [],
      steps: cleanAskSteps(hit.steps), numberCheck: cleanNumberCheck(hit.number_check), actions: cleanAskActions(hit.actions), followups: cleanAskFollowups(hit.followups), error: null,
      openSteps: openSteps === true
    });
    clearAskInput();
    saveAskState();
    renderAskThread();
    return;
  }
  const turn = { question: question, pending: true, startedAt: Date.now(), answer: null, citations: [], steps: [], actions: [], followups: [], error: null, openSteps: openSteps === true };
  const generation = askPanel.generation;
  askPanel.thread.push(turn);
  askPanel.busy = true;
  clearAskInput();
  renderAskThread();
  stopAskTimer();
  askPanel.timer = setInterval(function () {
    const node = askPanel.nodes.thread.querySelector(".ask-elapsed");
    if (node) {
      node.textContent = elapsedText(turn);
    }
  }, 1000);
  function finish() {
    if (generation !== askPanel.generation) {
      return;
    }
    stopAskTimer();
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
      turn.steps = cleanAskSteps(result.json.steps);
      turn.numberCheck = cleanNumberCheck(result.json.number_check);
      turn.actions = cleanAskActions(result.json.actions);
      turn.followups = cleanAskFollowups(result.json.followups);
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
  const context = el("div", { class: "ask-context", id: "ask-context" });
  const thread = el("div", { class: "ask-thread", id: "ask-thread", "aria-live": "polite" });
  const more = el("div", { class: "ask-more", id: "ask-more" });
  const input = el("textarea", { id: "ask-input", maxlength: "1000", rows: "1", placeholder: "Ask about the NASA data", "aria-label": "Your question" });
  const send = el("button", { type: "button", id: "ask-send", "aria-label": "Send", text: "->" });
  askPanel.nodes = { toggle: toggle, context: context, thread: thread, more: more, input: input, send: send };
  send.addEventListener("click", function () { sendAsk(input.value); });
  input.addEventListener("input", resizeAskInput);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendAsk(input.value);
    }
  });
  toggle.addEventListener("click", function () { setAskOpen(!askPanel.open, true); });
  toggle.hidden = false;
  buildTourToggle();
  node.addEventListener("click", function (e) {
    const link = e.target && e.target.closest ? e.target.closest("a") : null;
    if (link && window.innerWidth < ASK_NARROW_PX) {
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
        el("button", { type: "button", class: "ask-text-btn", text: "New", "aria-label": "New conversation", onclick: newAskConversation }),
        el("button", { type: "button", class: "ask-text-btn", text: "Close", "aria-label": "Close Ask panel", onclick: function () { closeAskPanel(true); } }))),
    context,
    thread,
    el("div", { class: "ask-input-row" }, input, send),
    el("p", { class: "ask-disclosure small muted" }, ASK_DISCLOSURE + " ", el("a", { href: "#/verification", text: "How we checked" }))
  ]);
  askPanel.built = true;
  renderAskContext();
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

function revealTarget(id) {
  const target = document.getElementById(id);
  if (!target) {
    return;
  }
  openAncestors(target);
  target.scrollIntoView();
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
  stopStory();
  airStop();
  if (r.name === "rank" && r.params.habitat && envById(r.params.habitat)) {
    state.envId = r.params.habitat;
  }
  buildNav(NAV_ACTIVE[r.name] || r.name);
  document.title = "Flame in Freefall";
  document.body.classList.toggle("brief-page", r.name === "brief");
  document.body.classList.toggle("home-page", r.name === "home" || !r.name);
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
  } else if (r.name === "gravity") {
    renderGravity();
  } else if (r.name === "equipment") {
    renderEquipment();
  } else if (r.name === "brief") {
    renderBrief(r.params);
  } else {
    renderHome();
  }
  refreshAskPanel();
  syncHeaderHeight();
  window.scrollTo(0, 0);
  if (r.params.at) {
    revealTarget(r.params.at);
  }
  tourRouted();
}

function init() {
  const names = ["investigations", "conditions", "environments", "insights", "earth", "rank_reference", "model_readiness", "test_next", "verification", "outside_psi", "models", "lunar_g", "test_plan", "data_health", "partial_g"];
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
      verification: loaded[8],
      outside_psi: loaded[9],
      models: loaded[10],
      lunar_g: loaded[11],
      test_plan: loaded[12],
      data_health: loaded[13],
      partial_g: loaded[14]
    };
    state.weights = Object.assign({}, state.data.rank_reference.weights);
    parityCheck();
    loadAskCache();
    loadAskState();
    buildAskPanel();
    let resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        syncHeaderHeight();
        if (gapNode && document.body.contains(gapNode) && Math.abs(gapNode.clientWidth - gapWidth) > 2) {
          drawGapChart(gapNode);
        }
      }, 120);
    });
    window.addEventListener("hashchange", route);
    route();
  }).catch(function (err) {
    setView(el("h1", { text: "Data failed to load" }), el("p", { class: "muted", text: String(err.message || err) }));
  });
}

function clipWords(text, limit) {
  const words = String(text || "").replace(/\.\.\.?\s*$/, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= limit) {
    return words.join(" ");
  }
  return words.slice(0, limit).join(" ").replace(/[,;:(\/-]+$/, "") + " ...";
}

function oneLine(inv, limit) {
  const title = inv.title && inv.title !== inv.name ? inv.title : null;
  return clipWords(title || inv.summary || "", limit);
}

function envShort(env) {
  return HABITAT_SHORT[env.id] || env.name;
}

function envNumber(env) {
  const hit = /^(\d+(?:\.\d+)?)/.exec(env.o2.display || "");
  return hit ? parseFloat(hit[1]) : Math.round((env.o2.min + env.o2.max) * 50);
}

function openAncestors(target) {
  let node = target;
  while (node && node !== document.body) {
    if (node.tagName === "DETAILS") {
      node.open = true;
    }
    node = node.parentElement;
  }
}

function syncHeaderHeight() {
  const top = document.querySelector(".top");
  if (top) {
    document.documentElement.style.setProperty("--hdr", top.offsetHeight + "px");
  }
}

let plotlyPromise = null;

function loadPlotly() {
  if (window.Plotly) {
    return Promise.resolve();
  }
  if (!plotlyPromise) {
    plotlyPromise = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = "vendor/plotly-basic-2.35.2.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return plotlyPromise;
}

const PLOT_FONT = "Inter, system-ui, -apple-system, \"Segoe UI\", Roboto, Arial, sans-serif";
const PLOT_DARK = { text: "#c9d2e6", muted: "#8f9bb8", strong: "#eef2fb", grid: "#1a2340", axis: "#34405f", tipBg: "#18233f", tipBorder: "#34405f" };
const PLOT_LIGHT = { text: "#141a2e", muted: "#5a6275", strong: "#141a2e", grid: "#e6dfd5", axis: "#b9b1a5", tipBg: "#fffdfa", tipBorder: "#ddd5ca" };

function plotConfig() {
  return { responsive: true, displaylogo: false, displayModeBar: false, scrollZoom: false, doubleClick: "reset" };
}

function plotBase(theme) {
  return {
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: PLOT_FONT, color: theme.text, size: 12 },
    hovermode: "closest",
    hoverlabel: { bgcolor: theme.tipBg, bordercolor: theme.tipBorder, align: "left", font: { family: PLOT_FONT, color: theme.strong, size: 12 } }
  };
}

function plotRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
}

function plotWrap(text, width) {
  const lines = [];
  let cur = "";
  String(text).split(" ").forEach(function (word) {
    if (cur && cur.length + 1 + word.length > width) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur ? cur + " " + word : word;
    }
  });
  if (cur) {
    lines.push(cur);
  }
  return lines.map(plotEscape).join("<br>");
}

function plotEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plotRun(duration, frame, done) {
  let alive = true;
  let busy = false;
  let raf = 0;
  const t0 = performance.now();
  function tick(now) {
    raf = 0;
    if (!alive) {
      return;
    }
    if (busy) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const t = Math.min(1, (now - t0) / duration);
    busy = true;
    Promise.resolve(frame(t)).then(function () {
      busy = false;
      if (!alive) {
        return;
      }
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else if (done) {
        done();
      }
    }).catch(function () {
      alive = false;
    });
  }
  raf = requestAnimationFrame(tick);
  return function () {
    alive = false;
    cancelAnimationFrame(raf);
  };
}

function plotWatch(node, threshold, fn) {
  if (!window.IntersectionObserver) {
    fn();
    return null;
  }
  const io = new IntersectionObserver(function (entries) {
    if (entries.some(function (e) { return e.isIntersecting; })) {
      io.disconnect();
      fn();
    }
  }, { threshold: threshold });
  io.observe(node);
  return io;
}

function plotWhenVisible(node, draw) {
  const seen = new Promise(function (resolve) {
    plotWatch(node, 0.3, resolve);
  });
  Promise.all([loadPlotly(), seen]).then(function () {
    if (document.body.contains(node)) {
      draw();
    }
  }).catch(function () {
    node.textContent = "Chart library not loaded.";
  });
}

function shortReason(inv, item, env) {
  const fuel = {
    solid: "Solid fuel",
    liquid_droplet: "Liquid droplets",
    gas: "Gas flames",
    smoke_sample: "Smoke sample",
    aerosol_dust: "Dust and aerosol"
  }[fuelClassOf(inv)] || null;
  const r = inv.ranges.o2_ambient;
  const c = item.components;
  let o2 = null;
  if (isSpecified(env, "o2")) {
    if (!r) {
      o2 = "no ambient O2 recorded";
    } else if (c.o2 > 0) {
      o2 = "tests O2 inside the habitat range";
    } else {
      o2 = "highest O2 tested " + percent(r.max) + "%";
    }
  }
  if (fuel && o2) {
    return fuel + ", " + o2;
  }
  return fuel || (o2 ? o2.charAt(0).toUpperCase() + o2.slice(1) : "No test rows in the table");
}

function invMedia(inv) {
  const img = inv.images && inv.images.length ? inv.images[0] : null;
  if (img) {
    return el("div", { class: "inv-media photo" },
      el("img", { src: img.file, alt: "Flame photo from " + invLabel(inv), loading: "lazy" }));
  }
  const label = inv.name.length <= 16 ? inv.name : inv.psi_id;
  return el("div", { class: "inv-media block fc-" + fuelClassOf(inv) }, el("span", { class: "inv-acr", text: label }));
}

const MODEL_COLORS = { Heptane: "#c2562a", Methanol: "#2f5f94" };
const MODEL_FUELS = ["Heptane", "Methanol"];

function modelTenths(value) {
  return Math.round(value * 10);
}

function modelVerdict(model, hab) {
  const name = envShort(hab);
  const fuels = MODEL_FUELS.filter(function (f) { return hab.fuels[f]; });
  const outside = fuels.filter(function (f) { return hab.fuels[f].status === "outside"; });
  const predicted = fuels.filter(function (f) { return hab.fuels[f].status !== "outside"; });
  const dom = model.domain.fuels;
  const lowest = Math.min.apply(null, fuels.map(function (f) { return dom[f].pressure_atm[0]; }));
  if (outside.length === fuels.length) {
    const pressureOut = outside.some(function (f) { return hab.fuels[f].margin.pressure_atm > 0; });
    const why = pressureOut
      ? "FLEX never ran below " + fmt(lowest, 2) + " atm; " + name + " air is " + fmt(hab.pressure_atm.mid, 2) + " atm."
      : name + " air lies outside the O2 range FLEX covered.";
    return { tone: "none", head: name + ": no prediction.", text: why };
  }
  const bits = predicted.map(function (f) {
    const p = hab.fuels[f].prediction;
    return "a " + f.toLowerCase() + " droplet flame goes out on its own in about " + modelTenths(p.estimate) + " of 10 tests (CI " + modelTenths(p.lo) + " to " + modelTenths(p.hi) + ")";
  });
  let text = bits.join("; ");
  const edge = predicted.some(function (f) { return hab.fuels[f].status === "edge"; });
  if (edge) {
    text += ". This air sits at the lower edge of the tested pressure range";
  }
  if (outside.length) {
    text += ". No prediction for " + outside.map(function (f) { return f.toLowerCase(); }).join(" and ") + ": outside the tested range";
  }
  return { tone: edge ? "part" : "ok", head: name + ":", text: text + "." };
}

function modelChart(model, selId, narrow, animate) {
  const th = PLOT_LIGHT;
  const H = narrow ? 350 : 390;
  const m = { l: 50, r: 14, t: 36, b: 96, pad: 0, autoexpand: false };
  const plotW = (narrow ? 340 : 680) - m.l - m.r;
  const x0 = 10;
  const x1 = 36;
  const px = function (o2) { return (o2 - x0) / (x1 - x0) * plotW; };
  const fs = narrow ? 11 : 12.5;
  const node = el("div", { class: "mdl-plot", role: "img", "aria-label": "Chance that a droplet flame goes out on its own against oxygen, with the tested oxygen range and habitat air" });
  node.style.height = H + "px";
  const curves = model.curve.fuels;
  const lo = Math.min.apply(null, MODEL_FUELS.map(function (f) { return curves[f].tested_o2_at_curve_pressure[0]; })) * 100;
  const hi = Math.max.apply(null, MODEL_FUELS.map(function (f) { return curves[f].tested_o2_at_curve_pressure[1]; })) * 100;
  const pct = function (v) { return Math.round(v * 100) + "%"; };
  const scale = function (arr, e) { return arr.map(function (v) { return v * e; }); };
  const defs = [];
  const sel = model.habitats.find(function (h) { return h.id === selId; });
  MODEL_FUELS.forEach(function (f) {
    const c = curves[f];
    const xs = c.o2.map(function (o) { return o * 100; });
    const poly = c.hi.concat(c.lo.slice().reverse());
    defs.push({
      kind: "line",
      base: { type: "scatter", mode: "lines", x: xs.concat(xs.slice().reverse()), fill: "toself", fillcolor: plotRgba(MODEL_COLORS[f], 0.16), line: { width: 0 }, hoverinfo: "skip", showlegend: false },
      ys: function (e) { return scale(poly, e); }
    });
    defs.push({
      kind: "line",
      base: {
        type: "scatter", mode: "lines", name: f + " droplet", x: xs, showlegend: false, line: { color: MODEL_COLORS[f], width: 2.6, shape: "spline", smoothing: 0.6 },
        customdata: c.lo.map(function (l, i) { return [l, c.hi[i]]; }),
        hovertemplate: "<b>" + f + " droplet</b><br>%{x:.1f}% oxygen<br>Chance it goes out: %{y:.0%}<br>95% range %{customdata[0]:.0%} to %{customdata[1]:.0%}<extra></extra>"
      },
      ys: function (e) { return scale(c.p, e); }
    });
  });
  MODEL_FUELS.forEach(function (f, k) {
    [true, false].forEach(function (active) {
      const list = model.habitats.filter(function (h) {
        return h.fuels[f].status !== "outside" && (h.o2.mid === sel.o2.mid && h.status === sel.status) === active;
      });
      if (!list.length) {
        return;
      }
      const est = list.map(function (h) { return h.fuels[f].prediction.estimate; });
      const up = list.map(function (h, i) { return h.fuels[f].prediction.hi - est[i]; });
      const down = list.map(function (h, i) { return est[i] - h.fuels[f].prediction.lo; });
      defs.push({
        kind: "mark",
        base: {
          type: "scatter", mode: "markers", name: f + " droplet", showlegend: false,
          x: list.map(function (h) { return h.o2.mid * 100 + (k === 0 ? -0.22 : 0.22); }),
          marker: { color: MODEL_COLORS[f], size: active ? 11 : 8, opacity: active ? 1 : 0.7, line: { color: "#fffdfa", width: 1.5 } },
          error_y: { type: "data", symmetric: false, color: MODEL_COLORS[f], thickness: active ? 2.2 : 1.4, width: 0 },
          customdata: list.map(function (h, i) { return [envShort(h), h.o2.mid * 100, pct(h.fuels[f].prediction.lo), pct(h.fuels[f].prediction.hi)]; }),
          text: est.map(function (v) { return pct(v); }),
          hovertemplate: "<b>%{customdata[0]}</b><br>" + f + " droplet at %{customdata[1]:.1f}% oxygen<br>Chance it goes out: %{text}<br>95% range %{customdata[2]} to %{customdata[3]}<extra></extra>"
        },
        ys: function (e) { return scale(est, e); },
        up: function (e) { return scale(up, e); },
        down: function (e) { return scale(down, e); }
      });
    });
  });
  const refused = model.habitats.filter(function (h) { return h.status === "outside"; });
  if (refused.length) {
    defs.push({
      kind: "fixed",
      base: {
        type: "scatter", mode: "markers", name: "No prediction", showlegend: false, cliponaxis: false,
        x: refused.map(function (h) { return h.o2.mid * 100; }), y: refused.map(function () { return 0; }),
        marker: { symbol: "circle-open", size: refused.map(function (h) { return h.id === selId ? 13 : 10; }), color: th.muted, line: { color: refused.map(function (h) { return h.id === selId ? th.strong : th.muted; }), width: 2 } },
        text: refused.map(function (h) { return envShort(h); }),
        hovertemplate: "<b>%{text}</b><br>%{x:.1f}% oxygen<br>Outside the tested range: no prediction<extra></extra>"
      }
    });
  }
  const groups = [];
  model.habitats.forEach(function (h) {
    const key = h.o2.mid + "|" + h.status;
    let g = groups.find(function (q) { return q.key === key; });
    if (!g) {
      g = { key: key, o2: h.o2.mid * 100, status: h.status, items: [] };
      groups.push(g);
    }
    g.items.push(h);
  });
  groups.sort(function (a, b) { return a.o2 - b.o2; });
  const annotations = [
    { xref: "paper", x: 0, xanchor: "left", xshift: 4 - m.l, yref: "paper", y: 1, yanchor: "bottom", yshift: 12, showarrow: false, text: "Chance the flame goes out on its own", font: { size: fs, color: th.strong } },
    { xref: "paper", x: 0.5, xanchor: "center", yref: "paper", y: 0, yanchor: "top", yshift: -66, showarrow: false, text: "Oxygen in the air, percent", font: { size: fs, color: th.strong } },
    { xref: "x", x: lo, xanchor: "left", xshift: 6, yref: "paper", y: 0, yanchor: "bottom", yshift: 6, showarrow: false, text: "tested at 1 atm", font: { size: fs - 1, color: th.muted } }
  ];
  const shapes = [{ type: "rect", xref: "x", yref: "paper", x0: lo, x1: hi, y0: 0, y1: 1, fillcolor: "rgba(20,26,46,0.04)", line: { width: 0 }, layer: "below" }];
  let prevX = -1000;
  let prevRow = 0;
  groups.forEach(function (g) {
    const active = g.items.some(function (h) { return h.id === selId; });
    const gx = px(g.o2);
    if (active) {
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: g.o2, x1: g.o2, y0: 0, y1: 1, line: { color: th.muted, width: 1, dash: "dot" } });
    }
    const row = gx - prevX < 78 && prevRow === 0 ? 1 : 0;
    prevX = gx;
    prevRow = row;
    if (!narrow || active) {
      const label = g.items.map(function (h) { return envShort(h); }).join(", ");
      const short = narrow ? label : label.replace("Pressurized rover", "Rover").replace("Moon base, Mars base", "Moon, Mars");
      const edge = gx > plotW - 56;
      annotations.push({
        xref: "x", x: g.o2, xanchor: edge ? "right" : "center", xshift: edge ? 8 : 0, yref: "paper", y: 0, yanchor: "top", yshift: -24 - row * 15, showarrow: false,
        text: active ? "<b>" + short + "</b>" : short, font: { size: fs - 0.5, color: active ? th.strong : th.muted }
      });
    }
  });
  if (sel && sel.status === "outside") {
    annotations.push({
      xref: "x", x: sel.o2.mid * 100, xanchor: "right", xshift: 8, yref: "y", y: 0.62, showarrow: false, align: "right",
      text: "<b>outside tested range:<br>no prediction</b>", font: { size: fs, color: th.strong }
    });
  }
  const ticks = [10, 15, 20, 25, 30, 35];
  const layout = Object.assign(plotBase(th), {
    height: H,
    margin: m,
    dragmode: false,
    xaxis: { range: [x0, x1], tickvals: ticks, fixedrange: true, zeroline: false, showgrid: false, showline: true, linecolor: th.axis, ticks: "outside", ticklen: 4, tickcolor: th.axis, tickfont: { size: fs - 1, color: th.muted } },
    yaxis: {
      range: [0, 1], tickvals: [0, 0.25, 0.5, 0.75, 1], ticktext: ["0%", "25%", "50%", "75%", "100%"], fixedrange: true, zeroline: false, showgrid: true, gridcolor: th.grid,
      ticks: "", tickfont: { size: fs - 1, color: th.muted }
    },
    shapes: shapes,
    annotations: annotations,
    showlegend: false
  });
  function traces(e) {
    return defs.map(function (d) {
      const t = Object.assign({}, d.base);
      if (d.kind === "line") {
        t.y = d.ys(e);
      } else if (d.kind === "mark") {
        t.y = d.ys(e);
        t.error_y = Object.assign({}, d.base.error_y, { array: d.up(e), arrayminus: d.down(e) });
      }
      return t;
    });
  }
  const lineIdx = [];
  const markIdx = [];
  defs.forEach(function (d, i) {
    if (d.kind === "line") {
      lineIdx.push(i);
    } else if (d.kind === "mark") {
      markIdx.push(i);
    }
  });
  plotWhenVisible(node, function () {
    const play = animate && !reduceMotion();
    window.Plotly.newPlot(node, traces(play ? 0 : 1), layout, plotConfig()).then(function () {
      if (!play) {
        return;
      }
      plotRun(900, function (t) {
        const e = gapEaseOut(t);
        const pick = function (idx, fn) { return idx.map(function (i) { return fn(defs[i]); }); };
        return window.Plotly.restyle(node, { y: pick(lineIdx, function (d) { return d.ys(e); }) }, lineIdx).then(function () {
          return window.Plotly.restyle(node, {
            y: pick(markIdx, function (d) { return d.ys(e); }),
            "error_y.array": pick(markIdx, function (d) { return d.up(e); }),
            "error_y.arrayminus": pick(markIdx, function (d) { return d.down(e); })
          }, markIdx);
        });
      });
    });
  });
  return node;
}

function modelPanel() {
  const bundle = state.data.models;
  const model = bundle.models[0];
  const v = model.validation;
  const habs = model.habitats;
  let selId = habs.some(function (h) { return h.id === state.envId; }) ? state.envId : habs[0].id;
  let narrowNow = window.innerWidth < 640;
  let modelPlayed = false;
  const chips = el("div", { class: "pills mdl-chips", role: "group", "aria-label": "Habitat" });
  const chart = el("div", { class: "mdl-chart" });
  const verdict = el("p", { class: "mdl-verdict", "aria-live": "polite" });
  function paint() {
    const hab = habs.find(function (h) { return h.id === selId; });
    const out = modelVerdict(model, hab);
    clear(chart);
    chart.appendChild(modelChart(model, selId, narrowNow, !modelPlayed));
    modelPlayed = true;
    clear(verdict);
    verdict.className = "mdl-verdict " + out.tone;
    appendKids(verdict, [el("strong", { text: out.head + " " }), out.text]);
    Array.prototype.forEach.call(chips.children, function (b) {
      const on = b.getAttribute("data-env") === selId;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  habs.forEach(function (h) {
    chips.appendChild(el("button", { type: "button", class: "pill", "data-env": h.id, text: envShort(h), onclick: function () {
      selId = h.id;
      paint();
    } }));
  });
  window.addEventListener("resize", function () {
    const now = window.innerWidth < 640;
    if (now !== narrowNow && document.body.contains(chart)) {
      narrowNow = now;
      paint();
    }
  });
  paint();
  const legend = el("p", { class: "mdl-legend" },
    MODEL_FUELS.map(function (f) { return el("span", { class: "mdl-key" }, el("i", { style: "background:" + MODEL_COLORS[f] }), f.toLowerCase() + " droplet"); }),
    el("span", { class: "mdl-key" }, el("i", { class: "band" }), "95% range"),
    el("span", { class: "mdl-key" }, el("i", { class: "hollow" }), "no prediction"));
  const card = el("p", { class: "mdl-card", text: "Tested on whole held-out test days: AUC " + v.auc.toFixed(2) + " against " + v.auc_baseline.toFixed(2) + " for guessing; Brier skill +" + fmt(v.brier_skill, 2) +
    " (95% CI +" + fmt(v.brier_skill_ci95[0], 2) + " to +" + fmt(v.brier_skill_ci95[1], 2) + "). " + model.rows_used.total + " droplet tests." });
  const lim = bundle.limiting_oxygen;
  const limRows = MODEL_FUELS.map(function (f) {
    const b = lim.fuels[f];
    const pub = b.published;
    const cite = pub.url ? el("a", { href: pub.url, text: pub.source }) : pub.source;
    return [f, fmt(b.lowest_o2_with_flame_any_diluent * 100, 0) + "%", b.lowest_o2_completion === null ? "none" : fmt(b.lowest_o2_completion * 100, 0) + "%",
      el("span", null, pub.value_text, pub.source ? ", " : "", cite)];
  });
  const dil = bundle.diluents;
  const dilRows = dil.table.map(function (t) {
    return [t.fuel, t.diluent, String(t.rows), fmt(t.o2_min * 100, 0) + " to " + fmt(t.o2_max * 100, 0) + "%", fmt(t.extinction_share * 100, 0) + "%",
      t.band_rows ? fmt(t.band_extinction_share * 100, 0) + "% of " + t.band_rows : "none"];
  });
  const calRows = v.calibration.map(function (c) {
    return [fmt(c.from * 100, 0) + " to " + fmt(c.to * 100, 0) + "%", String(c.rows), fmt(c.predicted * 100, 0) + "%", fmt(c.observed * 100, 0) + "%"];
  });
  const domRows = MODEL_FUELS.map(function (f) {
    const d = model.domain.fuels[f];
    return [f, String(d.rows), fmt(d.o2[0] * 100, 0) + " to " + fmt(d.o2[1] * 100, 0) + "%", fmt(d.pressure_atm[0], 2) + " to " + fmt(d.pressure_atm[1], 2), String(d.n2_only_rows), fmt(d.n2_only_pressure_atm[0], 2) + " to " + fmt(d.n2_only_pressure_atm[1], 2)];
  });
  const details = expander("How it was built and where it stops", el("div", null,
    el("h3", { text: "What it predicts" }),
    el("p", { text: model.target }),
    el("p", { class: "small muted", text: model.label_note }),
    el("h3", { text: "Data and method" }),
    el("p", { text: model.rows_used.total + " FLEX tests (" + model.rows_used.by_fuel.Heptane + " heptane, " + model.rows_used.by_fuel.Methanol + " methanol); " + model.rows_used.positive + " ended in radiative extinction, " + model.rows_used.negative + " did not. " +
      model.rows_excluded.count + " row left out: " + model.rows_excluded.reason + ". " + model.method }),
    el("p", { text: "Checked with " + v.scheme + " Guess to beat: " + v.baseline.toLowerCase() + ". Brier score " + fmt(v.brier_model, 3) + " against " + fmt(v.brier_baseline, 3) + "; the gain is " + fmt(v.brier_gain, 3) + " (95% CI " + fmt(v.brier_gain_ci95[0], 3) + " to " + fmt(v.brier_gain_ci95[1], 3) + ")." }),
    plainTable(["Predicted", "Tests", "Mean predicted", "Actually went out"], calRows),
    el("h3", { text: "When it refuses" }),
    el("p", { text: model.domain.rule }),
    plainTable(["Fuel", "Tests", "O2 tested", "Pressure tested (atm)", "N2-only tests", "N2-only pressure (atm)"], domRows),
    el("p", { class: "small muted", text: "The region uses every diluent mix. Tests in plain N2 stop near 1 atm, so air slightly above that is inside the region but above the N2-only tests." }),
    el("h3", { text: "Limits" }),
    el("ul", null, model.limits.map(function (t) { return el("li", { text: t }); })),
    el("h3", { text: "Limiting oxygen, reproduced from the rows" }),
    el("p", { text: lim.what_the_rows_show }),
    plainTable(["Fuel", "Lowest O2 with a flame in the rows", "Lowest O2 where the fuel burned out", "Published limit"], limRows),
    el("h3", { text: "Diluent comparison from the rows" }),
    plainTable(["Fuel", "Diluent", "Tests", "O2 range", "Went out on its own", "At 15 to 25% O2"], dilRows),
    el("p", { class: "small muted", text: dil.note })), false, "model-details");
  return el("section", { class: "data-block", id: "model" },
    el("h2", { text: "A model that knows its limits" }),
    el("p", { class: "data-cap", text: "Droplet flames only. It gives an answer where NASA tested, and says no where it did not." }),
    legend, chart, chips, verdict, card, details);
}

function mapPanel() {
  const chart = el("div", { class: "chart", id: "gap-map", role: "img", "aria-label": "Oxygen versus pressure of every PSI test, with habitat windows" });
  const notes = el("div", { class: "map-notes" });
  let drawn = false;
  function draw() {
    if (drawn) {
      return;
    }
    drawn = true;
    loadPlotly().then(function () {
      const counts = drawGapMap(chart);
      const sourcedLine = counts.sourced > 0 ? " " + counts.sourced + " solid rows record no pressure in PSI and are plotted at the pressure NASA reports state." : "";
      const laneLine = counts.lane > 0 ? " " + counts.lane + " record no pressure and sit in the bottom lane." : "";
      notes.appendChild(el("p", { class: "small", text: "Each dot is one row of the unified PSI table with an ambient O2 value: " + (counts.plotted + counts.sourced + counts.lane) + " rows. " +
        counts.plotted + " record pressure in PSI." + sourcedLine + laneLine }));
      const solidRefs = outsideSolidRefs(counts);
      if (solidRefs.length) {
        notes.appendChild(el("p", { class: "small" }, "Solid pressures come from NASA reports, not the PSI table: ", solidRefs));
      }
      notes.appendChild(outsideTestsNote());
      notes.appendChild(el("p", { class: "small", text: "Not plotted: " + counts.noO2 + " rows with no O2 value (smoke and dust tests have none), " + counts.stream +
        " rows that give burner-stream O2 (a different quantity from cabin air) and " + counts.quality + " rows that give a range or summary instead of one value." }));
    }).catch(function () {
      chart.textContent = "Chart library not loaded.";
    });
  }
  return { body: el("div", null, chart, expander("About this map", notes)), draw: draw };
}

init();
