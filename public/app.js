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

const CHALLENGE_URL = "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/";

let storyObserver = null;
let gapNode = null;
let gapWidth = 0;

function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function stopStory() {
  if (storyObserver) {
    storyObserver.disconnect();
    storyObserver = null;
  }
  gapNode = null;
}

function countUp(node, target) {
  if (reduceMotion()) {
    node.textContent = fmt(target, 0);
    return;
  }
  const start = performance.now();
  function step(now) {
    const u = Math.min(1, (now - start) / 1300);
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
  const solid = state.data.conditions.filter(function (r) {
    return r.fuel_class === "solid" && r.o2_frac !== undefined && r.o2_basis === "ambient";
  }).map(function (r) { return r.o2_frac * 100; }).sort(function (a, b) { return a - b; });
  const lunar = envById("lunar");
  const lo = lunar.o2.window_min !== undefined ? lunar.o2.window_min : lunar.o2.min;
  const hi = lunar.o2.window_max !== undefined ? lunar.o2.window_max : lunar.o2.max;
  return {
    solid: solid,
    flights: state.data.outside_psi.tests,
    moonLo: lo * 100,
    moonHi: hi * 100,
    moon: envNumber(lunar),
    psiMax: Math.max.apply(null, solid)
  };
}

function swarmPoints(values, xo, r) {
  const placed = [];
  return values.map(function (v) {
    const x = xo(v);
    let up = r + 2;
    for (;;) {
      let free = true;
      for (let k = 0; k < placed.length; k += 1) {
        const dx = placed[k].x - x;
        const dy = placed[k].up - up;
        if (dx * dx + dy * dy < (2 * r + 0.6) * (2 * r + 0.6)) {
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

function drawGapChart(node) {
  const d = gapChartData();
  const w = Math.max(280, Math.floor(node.clientWidth || 320));
  const small = w < 640;
  const LF = small ? 13 : Math.max(20, Math.min(30, Math.round(w * 0.024)));
  const TF = small ? 11 : 16;
  const lo = 12;
  const hi = 36;
  const pad = small ? 10 : 20;
  const px = (w - 2 * pad) / (hi - lo);
  const xo = function (v) { return pad + (v - lo) * px; };
  const r = Math.max(2.2, Math.min(7, px * 0.095));
  const dm = small ? 7 : Math.max(10, Math.min(14, px * 0.26));
  const swarm = swarmPoints(d.solid, xo, r);
  const peak = Math.max.apply(null, swarm.map(function (p) { return p.up; })) + r;
  const labelH = LF * 4.9;
  const rowStep = 2 * dm + 4;
  const seen = {};
  const flights = d.flights.map(function (t) {
    const key = t.o2_percent.toFixed(1);
    seen[key] = seen[key] || 0;
    const row = seen[key];
    seen[key] += 1;
    return { t: t, row: row, x: xo(t.o2_percent) };
  });
  const rows = Math.max.apply(null, flights.map(function (f) { return f.row + 1; }));
  const diamondsBottom = labelH + 6 + rows * rowStep + dm;
  const axisY = Math.max(diamondsBottom + 26 + peak, labelH + 260);
  const H = Math.round(axisY + (small ? 38 : 52));
  const n = swarm.length;
  const bandX = xo(d.moonLo);
  const bandW = xo(d.moonHi) - xo(d.moonLo);
  const bandTop = LF * 1.7;
  let s = "";
  s += "<defs><filter id=\"gapglow\" x=\"-80%\" y=\"-10%\" width=\"260%\" height=\"120%\"><feGaussianBlur stdDeviation=\"" + (small ? 6 : 12) + "\"/></filter></defs>";
  s += "<rect class=\"gglow\" x=\"" + bandX + "\" y=\"" + bandTop + "\" width=\"" + bandW + "\" height=\"" + (axisY - bandTop) + "\" fill=\"#e8743b\" filter=\"url(#gapglow)\"/>";
  s += "<rect class=\"gx\" style=\"transition-delay:5000ms\" x=\"" + bandX + "\" y=\"" + bandTop + "\" width=\"" + bandW + "\" height=\"" + (axisY - bandTop) + "\" fill=\"#e8743b\" fill-opacity=\"0.24\" stroke=\"#e8743b\" stroke-width=\"" + (small ? 1.5 : 2.5) + "\"/>";
  s += "<line x1=\"" + pad + "\" y1=\"" + axisY + "\" x2=\"" + (w - pad) + "\" y2=\"" + axisY + "\" stroke=\"#6b7898\" stroke-width=\"2\"/>";
  const step = small ? 4 : 2;
  for (let v = lo; v <= hi; v += step) {
    s += "<line x1=\"" + xo(v) + "\" y1=\"" + axisY + "\" x2=\"" + xo(v) + "\" y2=\"" + (axisY + 8) + "\" stroke=\"#6b7898\" stroke-width=\"2\"/>";
    s += "<text x=\"" + xo(v) + "\" y=\"" + (axisY + 10 + TF * 1.3) + "\" font-size=\"" + TF + "\" text-anchor=\"middle\" fill=\"#b8c2db\">" + v + "%</text>";
  }
  swarm.forEach(function (p, i) {
    const delay = Math.round(400 + 2500 * (i / n));
    s += "<circle class=\"gd\" style=\"transition-delay:" + delay + "ms\" cx=\"" + p.x.toFixed(1) + "\" cy=\"" + (axisY - p.up).toFixed(1) + "\" r=\"" + r.toFixed(1) + "\" fill=\"#e8743b\"/>";
  });
  const lineX = xo(d.psiMax);
  s += "<line class=\"gx\" style=\"transition-delay:3000ms\" x1=\"" + lineX + "\" y1=\"" + (LF * 1.9) + "\" x2=\"" + lineX + "\" y2=\"" + axisY + "\" stroke=\"#e8743b\" stroke-width=\"" + (small ? 2 : 3.5) + "\" stroke-dasharray=\"" + (small ? "7 5" : "14 9") + "\"/>";
  s += "<text class=\"gx\" style=\"transition-delay:3100ms\" font-size=\"" + LF + "\" font-weight=\"700\" fill=\"#ff8a50\" text-anchor=\"end\"><tspan x=\"" + (lineX - (small ? 8 : 14)) + "\" y=\"" + (LF * 3.05) + "\">PSI solid tests</tspan><tspan x=\"" + (lineX - (small ? 8 : 14)) + "\" y=\"" + (LF * 4.35) + "\">stop at " + fmt(d.psiMax, 1) + "%</tspan></text>";
  flights.forEach(function (f, i) {
    const y = labelH + 6 + dm + f.row * rowStep;
    const t = f.t;
    s += "<path class=\"gx\" style=\"transition-delay:" + (3700 + i * 110) + "ms\" d=\"M" + f.x + " " + (y - dm) + " L" + (f.x + dm) + " " + y + " L" + f.x + " " + (y + dm) + " L" + (f.x - dm) + " " + y + " Z\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"" + (small ? 1.6 : 2.6) + "\"><title>" + t.label + ": " + t.material_short + ", " + t.o2_percent.toFixed(1) + "% O2</title></path>";
  });
  s += "<text class=\"gx\" style=\"transition-delay:4700ms\" font-size=\"" + LF + "\" font-weight=\"700\" fill=\"#ffffff\"><tspan x=\"" + xo(22.9) + "\" y=\"" + (LF * 3.05) + "\">Newest NASA flights</tspan><tspan x=\"" + xo(22.9) + "\" y=\"" + (LF * 4.35) + "\">not in PSI</tspan></text>";
  s += "<text class=\"gx\" style=\"transition-delay:5000ms\" x=\"" + xo(hi - 0.1) + "\" y=\"" + (LF * 1.1) + "\" font-size=\"" + LF + "\" font-weight=\"700\" fill=\"#ff8a50\" text-anchor=\"end\">Moon base " + d.moon + "%</text>";
  node.innerHTML = "<svg viewBox=\"0 0 " + w + " " + H + "\" width=\"" + w + "\" height=\"" + H + "\" role=\"img\" aria-label=\"Oxygen axis: " + d.solid.length + " PSI solid-fuel tests end at " + fmt(d.psiMax, 1) + " percent, newest NASA flights reach " + fmt(Math.max.apply(null, d.flights.map(function (t) { return t.o2_percent; })), 0) + " percent, Moon base air is " + d.moon + " percent\">" + s + "</svg>";
  gapWidth = node.clientWidth;
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
  return holder;
}

function gapDetails(lunar) {
  const d = gapChartData();
  const insight = state.data.insights.insights.find(function (i) { return i.id === "max_o2_by_fuel_class"; });
  const solid = insight.numbers.max_by_fuel_class.solid;
  const tests = state.data.outside_psi.tests;
  return expander("Details", el("div", null,
    el("p", { text: "Each dot is one row of the unified PSI table: a solid fuel with an ambient O2 value (" + d.solid.length + " rows). The dashed line marks the highest, " + solid.psi_id + ", " + solid.source_file + ", row " + solid.source_row + "." }),
    el("p", { text: "Hollow diamonds are the " + tests.length + " NASA Saffire IV-VI solid tests that are not in PSI. The band is the Moon base O2 window, " + dashSpan(d.moonLo, d.moonHi, 1, "%") + "." }),
    plainTable(["Test", "Material", "O2", "Pressure", "Outcome", "Source"], tests.map(function (t) {
      return [t.label, t.material_short, t.o2_percent.toFixed(1) + "%", t.pressure_psia === null ? "not stated" : t.pressure_psia.toFixed(2) + " psia",
        t.outcome_short, ntrsLink(t.source_url, "NTRS " + t.source_id)];
    })),
    el("p", { class: "small muted", text: "Solid pressures and outcomes come from NASA reports, not the PSI table. Air-composition sources are under Moon base air." })));
}

function renderHome() {
  const data = state.data;
  const lunar = envById("lunar");
  const moon = envNumber(lunar);
  const sections = [];
  function story(cls, id, kids) {
    const section = el("section", { class: "story " + cls, id: id }, el("div", { class: "story-in" }, kids));
    sections.push(section);
    return section;
  }
  const hero = el("section", { class: "story hero in", id: "s-hero" },
    el("img", { class: "hero-img", src: "img/PSI-25/bass_ii_flame_testing.jpg", alt: "A flame burning in microgravity, photographed during NASA's BASS-II experiment" }),
    el("div", { class: "hero-copy" },
      rv(0, "h1", { text: "Flame in Freefall" }),
      rv(1, "p", { class: "hero-line", text: "Fire behaves differently in space. Crews on the Moon will need to know how." })),
    el("button", { type: "button", class: "scroll-cue", "aria-label": "Scroll to the next section", onclick: function () {
      document.getElementById("s-quote").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
    } }, el("span", { text: "Scroll" }), el("i")),
    el("span", { class: "credit", text: "NASA / PSI" }));
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
    rv(4, "p", { class: "story-sub", text: "Why so high? Spacesuits run on pure oxygen at 4.3 psi. Base air sits between suit and Earth to cut pre-breathing time." }),
    expander("Details", el("div", null,
      el("p", { class: "small", text: "Source, challenge statement: spacesuits hold 100% oxygen at 4.3 psi against 14.7 psi at sea level, and the Moon base and rovers are expected to sit between the spacesuit and Earth's atmosphere to reduce pre-breathing." }),
      el("p", { class: "small", text: "Moon base oxygen is " + lunar.o2.display + ". Earth air is about 21 percent." }),
      envSourcesTable(lunar)))
  ]);
  const chart = el("div", { class: "gap" });
  const gap = story("st-gap", "s-gap", [
    rv(0, "h2", { text: "Has NASA tested that air?" }),
    rv(1, "p", { class: "story-sub", text: "Solid-material tests in the PSI database" }),
    chart,
    gapDetails(lunar)
  ]);
  const next = story("st-next", "s-next", [testNextSection(lunar)]);
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
  const view = setView(hero, quote, air, gap, next, explore);
  drawGapChart(chart);
  gapNode = chart;
  watchStory(sections);
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
      const pr = n.pressure_atm === null ? "pressure not recorded" : fmt(psia(n.pressure_atm), 1) + " psia";
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
          el("p", { class: "rank-why", text: shortReason(inv, item, env) })),
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
    drawRanking();
    drawSliders();
    drawSources();
    drawTest();
  }

  const buttons = envButtons(drawAll);
  const root = setView(
    pageHead("Rank experiments for a habitat", null, buttons),
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
    holder.appendChild(el("h3", { text: "What would close each gap" }));
    holder.appendChild(el("div", null, block.items.map(function (item) {
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
    })));
    holder.appendChild(el("p", { class: "small muted", text: mr.rule }));
    holder.appendChild(el("p", { class: "small muted", text: mr.no_model_note }));
    holder.appendChild(el("p", { class: "small muted", text: mr.grouped_validation_note }));
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
    bits.push("Ask check: " + v.ask_eval.preregistered_passed + " of " + v.ask_eval.total + " passed on pre-registered checks.");
  }
  return bits;
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
  const drawers = {};
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
    drawer("readiness", "Model readiness", readinessPanel()),
    drawer("extractor", "Filter and download", extractor),
    bits ? drawer("verification", "How we checked it", el("div", null, el("ul", null, bits.map(function (b) { return el("li", { text: b }); })),
      el("p", null, el("a", { class: "btn", href: "#/verification", text: "Open the full verification" })))) : null,
    drawer("map", "Oxygen and pressure map", map.body, map.draw),
    drawer("insights", "What the numbers say", insightsPanel())
  ];
  return setView(
    pageHead("Data and models", "What the data can support, and how to use it."),
    el("div", { class: "dcards" }, cards),
    el("div", { class: "drawer-list" }, list)
  );
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
  if (v.ask_eval) {
    list.push(checkDrawer("ask-accuracy", "Ask accuracy: " + v.ask_eval.preregistered_passed + " of " + v.ask_eval.total + " passed on pre-registered checks", askEvalBlock(v.ask_eval)));
  }
  return setView(
    pageHead("How we checked it", "Every row and every quote is matched to its NASA source."),
    el("p", { class: "small" }, el("a", { href: "#/data", text: "Back to Data" })),
    el("div", { class: "drawer-list" }, list)
  );
}

function outsideVerificationBlock(o) {
  return el("div", null,
    el("p", { text: "Every quote behind the Saffire IV-VI tests and the NASA-sourced solid pressures was matched to its NTRS text" + (o.failed ? ", except " + o.failed + " that failed." : ".") }),
    el("p", { class: "small", text: "pipeline/verify_outside_psi.py reads data/outside_psi/saffire_iv_vi.json and data/outside_psi/solid_pressure_sources.json. Each quote is normalized and searched on its stated page of the downloaded NTRS text; the result is written to data/outside_psi/verification.json." }),
    o.errors.length ? el("ul", null, o.errors.map(function (e) { return el("li", { text: e }); })) : el("p", { class: "small", text: "No failures." }),
    el("p", null, el("a", { href: REPO_URL + "/tree/main/data/outside_psi", target: "_blank", rel: "noopener", text: "data/outside_psi on GitHub" })));
}

function askEvalBlock(a) {
  const failedCount = a.checker_fixes.length;
  return el("div", null,
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
        actions: cleanAskActions(t.actions),
        followups: cleanAskFollowups(t.followups),
        error: typeof t.error === "string" ? t.error : null
      };
    });
  } catch (err) {
    askPanel.thread = [];
  }
}

function elapsedText(turn) {
  return Math.max(0, Math.floor((Date.now() - (turn.startedAt || Date.now())) / 1000)) + " s";
}

function askStepsView(steps) {
  return el("details", { class: "ask-steps" },
    el("summary", { text: "How I checked (" + steps.length + ")" }),
    el("ul", { class: "ask-steps-list" }, steps.map(function (s) {
      return el("li", null, el("span", { class: "ask-step-label", text: s.label }), s.detail ? el("span", { class: "ask-step-detail", text: s.detail }) : null);
    })));
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
      actions.length ? el("div", { class: "ask-actions" }, actions.map(function (a) {
        return el("a", { class: "ask-action", href: a.href, text: a.label });
      })) : null,
      steps.length ? askStepsView(steps) : null,
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

function sendAsk(text, fromChip) {
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
      steps: cleanAskSteps(hit.steps), actions: cleanAskActions(hit.actions), followups: cleanAskFollowups(hit.followups), error: null
    });
    clearAskInput();
    saveAskState();
    renderAskThread();
    return;
  }
  const turn = { question: question, pending: true, startedAt: Date.now(), answer: null, citations: [], steps: [], actions: [], followups: [], error: null };
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
}

function init() {
  const names = ["investigations", "conditions", "environments", "insights", "earth", "rank_reference", "model_readiness", "test_next", "verification", "outside_psi"];
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
      outside_psi: loaded[9]
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
  return { body: el("div", null, chart, notes), draw: draw };
}

init();
