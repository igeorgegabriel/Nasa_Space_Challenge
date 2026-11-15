(function () {
  "use strict";

  var FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  var COL = { solid: "#e06d34", other: "#8f9bb8", flight: "#5b95e8", measured: "#ffffff", accent: "#e8743b", muted: "#7d8aab", text: "#c9d2e6", grid: "#243052", bg: "#0b1020" };
  var SHORT = { iss: "ISS cabin", gateway: "Gateway", lunar: "Moon base", rover: "Pressurized rover", mars: "Mars base" };
  var PSIA_PER_ATM = 14.6959;
  var QUALITY = ["exact", "approximate"];
  var LABEL_BELOW = {};
  var LABEL_SIDE = { rover: true, gateway: true };
  var LEVEL_Z = { "0g": 0, moon: 1, mars: 2, "1g": 3 };
  var P_TICKS = [4, 8, 15, 30, 60];
  var P_RANGE = [3, 80];
  var ANIM_MS = 1600;
  var HALF_Z = 0.08;
  var plotNode = document.getElementById("plot");
  var resetBtn = document.getElementById("reset");
  var legendNode = document.getElementById("legend");
  var msgNode = document.getElementById("msg");
  var camStart = { eye: { x: 0, y: 0, z: 2.7 }, up: { x: 0, y: 1, z: 0 }, center: { x: 0, y: 0, z: 0 } };
  var camEnd = { eye: { x: 1.28, y: -1.32, z: 0.3 }, up: { x: 0, y: 0, z: 1 }, center: { x: -0.05, y: 0, z: -0.12 } };
  var raf = 0;
  var active = false;
  var ready = false;
  var wantPlay = false;
  var played = false;

  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmt(v, d) {
    return Number(v).toFixed(d);
  }

  function wrap(text, width) {
    var lines = [];
    var cur = "";
    String(text).split(" ").forEach(function (w) {
      if (cur && cur.length + 1 + w.length > width) {
        lines.push(cur);
        cur = w;
      } else {
        cur = cur ? cur + " " + w : w;
      }
    });
    if (cur) {
      lines.push(cur);
    }
    return lines.map(esc).join("<br>");
  }

  function field(p, name) {
    return p.fields.filter(function (f) { return f.name === name; })[0] || null;
  }

  function specified(env, key) {
    var b = env[key];
    return !!b && !b.not_specified && b.window_min !== undefined && b.window_max !== undefined;
  }

  function get(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) {
        throw new Error(url);
      }
      return r.json();
    });
  }

  function build(cond, outside, pg, envs) {
    var envById = {};
    envs.environments.forEach(function (e) { envById[e.id] = e; });
    var gravity = { "0g": 0 };
    gravity.moon = envById.lunar.gravity.g;
    gravity.mars = envById.mars.gravity.g;
    var earthPoint = pg.points.filter(function (p) { return p.level === "1g" && field(p, "gravity_g"); })[0];
    gravity["1g"] = field(earthPoint, "gravity_g").value;
    var levelLabel = {};
    pg.levels.forEach(function (lv) { levelLabel[lv.id] = lv.label; });

    var solidRows = { x: [], y: [], z: [], text: [] };
    var otherRows = { x: [], y: [], z: [], text: [] };
    cond.forEach(function (r) {
      if (r.o2_frac === undefined || r.o2_frac === null || r.o2_basis !== "ambient" || QUALITY.indexOf(r.value_quality) < 0) {
        return;
      }
      var atm = null;
      var from = "";
      if (r.pressure_atm !== undefined && r.pressure_atm > 0) {
        atm = r.pressure_atm;
      } else if (r.fuel_class === "solid" && outside.solid_pressures[r.psi_id]) {
        atm = outside.solid_pressures[r.psi_id].pressure_atm;
        from = " | pressure from a NASA report";
      }
      if (atm === null) {
        return;
      }
      var bucket = r.fuel_class === "solid" ? solidRows : otherRows;
      bucket.x.push(r.o2_frac * 100);
      bucket.y.push(atm * PSIA_PER_ATM);
      bucket.z.push(0);
      bucket.text.push(esc(r.investigation) + "<br>" + esc(r.fuel || r.fuel_class) + " | " + esc(r.psi_id) + "<br>O2 " + fmt(r.o2_frac * 100, 1) + " percent, " + fmt(atm * PSIA_PER_ATM, 1) + " psia" + esc(from) + "<br>" + esc(r.source_file) + ", row " + r.source_row);
    });

    var flights = outside.tests.filter(function (t) { return t.plotted && t.pressure_psia !== null && t.pressure_psia !== undefined; });
    var burned = flights.filter(function (t) { return /^burned/i.test(t.outcome_short); });
    var quiet = flights.filter(function (t) { return !/^burned/i.test(t.outcome_short); });
    function flightTrace(list, name, open) {
      return {
        type: "scatter3d", mode: "markers", name: name, showlegend: false,
        x: list.map(function (t) { return t.o2_percent; }),
        y: list.map(function (t) { return t.pressure_psia; }),
        z: list.map(function () { return 0; }),
        text: list.map(function (t) { return "<b>" + esc(t.label) + "</b><br>" + wrap(t.material_short, 44) + "<br>O2 " + fmt(t.o2_percent, 1) + " percent, " + fmt(t.pressure_psia, 2) + " psia<br>" + esc(t.outcome_short) + "<br>NTRS " + esc(t.source_id); }),
        hovertemplate: "%{text}<extra></extra>",
        marker: { symbol: open ? "diamond-open" : "diamond", size: 6, color: COL.flight, line: { color: COL.flight, width: 2 } }
      };
    }

    var byId = {};
    pg.points.forEach(function (p) { byId[p.id] = p; });
    var meas = { x: [], y: [], z: [], text: [] };
    pg.chart.forEach(function (s) {
      pg.levels.forEach(function (lv) {
        var p = byId[s.points[lv.id]];
        if (!p) {
          return;
        }
        var o2 = field(p, s.field);
        var press = field(p, "total_pressure");
        if (!o2 || !press || o2.value === null || press.value === null) {
          return;
        }
        meas.x.push(o2.value);
        meas.y.push(press.value);
        meas.z.push(LEVEL_Z[lv.id]);
        meas.text.push("<b>" + esc(p.material) + "</b><br>" + (s.field === "ulois_percent_o2" ? "ULOI* " : "LOC ") + fmt(o2.value, 1) + " percent O2, " + fmt(press.value, 1) + " psia<br>" + esc(levelLabel[lv.id]) + ", " + fmt(gravity[lv.id], 3) + " g<br>" + esc(p.source.cite) + ", NTRS " + esc(p.source.ntrs_id) + (s.preliminary ? "<br>Preliminary poster" : ""));
      });
    });

    var boxes = [];
    envs.environments.forEach(function (e) {
      if (!specified(e, "o2") || !specified(e, "pressure_atm") || e.gravity.not_specified) {
        return;
      }
      var level = ["0g", "moon", "mars", "1g"].filter(function (id) { return Math.abs(gravity[id] - e.gravity.g) < 1e-9; })[0];
      if (level === undefined) {
        return;
      }
      boxes.push({
        z: LEVEL_Z[level], id: e.id, name: SHORT[e.id] || e.name, g: e.gravity.g,
        x0: e.o2.window_min * 100, x1: e.o2.window_max * 100,
        y0: e.pressure_atm.window_min * PSIA_PER_ATM, y1: e.pressure_atm.window_max * PSIA_PER_ATM
      });
    });

    return { solid: solidRows, other: otherRows, burned: burned, quiet: quiet, flightTrace: flightTrace, meas: meas, boxes: boxes, gravity: gravity, levelLabel: levelLabel };
  }

  function boxMesh(b, half, color, opacity) {
    var z0 = b.z - half;
    var z1 = b.z + half;
    return {
      type: "mesh3d", name: b.name, showlegend: false,
      x: [b.x0, b.x1, b.x1, b.x0, b.x0, b.x1, b.x1, b.x0],
      y: [b.y0, b.y0, b.y1, b.y1, b.y0, b.y0, b.y1, b.y1],
      z: [z0, z0, z0, z0, z1, z1, z1, z1],
      i: [0, 0, 4, 4, 0, 0, 1, 1, 2, 2, 3, 3],
      j: [1, 2, 5, 6, 1, 5, 2, 6, 3, 7, 0, 4],
      k: [2, 3, 6, 7, 5, 4, 6, 5, 7, 6, 4, 7],
      color: color, opacity: opacity, flatshading: true,
      lighting: { ambient: 1, diffuse: 0, specular: 0, roughness: 1 },
      hoverinfo: "text",
      text: "<b>" + esc(b.name) + "</b><br>O2 " + fmt(b.x0, 1) + "-" + fmt(b.x1, 1) + " percent<br>" + fmt(b.y0, 1) + "-" + fmt(b.y1, 1) + " psia<br>" + fmt(b.g, 3) + " g"
    };
  }

  function boxEdges(b, half, color, width) {
    var z0 = b.z - half;
    var z1 = b.z + half;
    var pts = [
      [b.x0, b.y0, z0], [b.x1, b.y0, z0], [b.x1, b.y1, z0], [b.x0, b.y1, z0], [b.x0, b.y0, z0], null,
      [b.x0, b.y0, z1], [b.x1, b.y0, z1], [b.x1, b.y1, z1], [b.x0, b.y1, z1], [b.x0, b.y0, z1], null,
      [b.x0, b.y0, z0], [b.x0, b.y0, z1], null, [b.x1, b.y0, z0], [b.x1, b.y0, z1], null,
      [b.x1, b.y1, z0], [b.x1, b.y1, z1], null, [b.x0, b.y1, z0], [b.x0, b.y1, z1]
    ];
    return {
      type: "scatter3d", mode: "lines", showlegend: false, hoverinfo: "skip",
      x: pts.map(function (p) { return p ? p[0] : null; }),
      y: pts.map(function (p) { return p ? p[1] : null; }),
      z: pts.map(function (p) { return p ? p[2] : null; }),
      line: { color: color, width: width }
    };
  }

  function axis(title, extra) {
    var a = {
      title: { text: title, font: { size: 12, color: "#97a3bf", family: FONT } },
      tickfont: { size: 10, color: COL.text, family: FONT },
      color: COL.text, gridcolor: COL.grid, zerolinecolor: COL.grid, linecolor: "#34405f",
      showbackground: true, backgroundcolor: "rgba(17,26,51,0.55)", showspikes: false
    };
    Object.keys(extra || {}).forEach(function (k) { a[k] = extra[k]; });
    return a;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function camAt(t, zoom) {
    var out = { eye: {}, up: {}, center: {} };
    ["eye", "up", "center"].forEach(function (k) {
      ["x", "y", "z"].forEach(function (c) {
        var to = k === "eye" ? camEnd[k][c] * zoom : camEnd[k][c];
        out[k][c] = lerp(camStart[k][c], to, t);
      });
    });
    return out;
  }

  function zoomFor() {
    return window.innerWidth < 700 ? 1.45 : 1;
  }

  function setCam(cam) {
    Plotly.relayout(plotNode, { "scene.camera": cam });
  }

  function quietMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function play() {
    if (played) {
      return;
    }
    played = true;
    animate();
  }

  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "e3d-play") {
      return;
    }
    if (ready) {
      if (!quietMotion()) {
        play();
      }
    } else {
      wantPlay = true;
    }
  });

  function animate() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    var quiet = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (quiet) {
      setCam(camAt(1, zoomFor()));
      return;
    }
    setCam(camStart);
    var t0 = 0;
    function step(now) {
      if (!t0) {
        t0 = now;
      }
      var u = Math.min(1, (now - t0) / ANIM_MS);
      var e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      setCam(camAt(e, zoomFor()));
      raf = u < 1 ? requestAnimationFrame(step) : 0;
    }
    raf = requestAnimationFrame(step);
  }

  function legend(items) {
    legendNode.textContent = "";
    items.forEach(function (it) {
      var li = document.createElement("li");
      var dot = document.createElement("i");
      dot.style.background = it[0];
      li.appendChild(dot);
      li.appendChild(document.createTextNode(it[1]));
      legendNode.appendChild(li);
    });
    legendNode.hidden = false;
  }

  function draw(d) {
    var traces = [];
    d.boxes.forEach(function (b) {
      var moon = b.id === "lunar";
      var half = moon ? HALF_Z : b.id === "rover" ? HALF_Z * 1.7 : HALF_Z * 1.2;
      traces.push(boxMesh(b, half, moon ? COL.accent : COL.muted, moon ? 0.62 : 0.22));
      traces.push(boxEdges(b, half, moon ? "#ff9a62" : "#97a3bf", moon ? 4 : 2));
      if (b.z > 0) {
        var cx = (b.x0 + b.x1) / 2;
        var cy = Math.sqrt(b.y0 * b.y1);
        traces.push({ type: "scatter3d", mode: "lines", showlegend: false, hoverinfo: "skip", x: [cx, cx], y: [cy, cy], z: [b.z - half, 0], line: { color: moon ? "#ff9a62" : "#5b6785", width: moon ? 3 : 2, dash: "dash" } });
        traces.push(boxEdges({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, z: 0 }, 0, moon ? "#ff9a62" : "#5b6785", moon ? 3 : 1));
      }
    });
    traces.push({
      type: "scatter3d", mode: "markers", name: "Solid fuels", showlegend: false,
      x: d.solid.x, y: d.solid.y, z: d.solid.z, text: d.solid.text, hovertemplate: "%{text}<extra></extra>",
      marker: { symbol: "circle", size: 2.6, color: COL.solid, opacity: 0.9 }
    });
    traces.push({
      type: "scatter3d", mode: "markers", name: "Droplet and gas fuels", showlegend: false,
      x: d.other.x, y: d.other.y, z: d.other.z, text: d.other.text, hovertemplate: "%{text}<extra></extra>",
      marker: { symbol: "circle", size: 2.2, color: COL.other, opacity: 0.5 }
    });
    traces.push(d.flightTrace(d.burned, "Saffire flights, burned", false));
    traces.push(d.flightTrace(d.quiet, "Saffire flights, no ignition", true));
    traces.push({
      type: "scatter3d", mode: "markers", name: "Measured limits at 1 g, Mars, Moon", showlegend: false,
      x: d.meas.x, y: d.meas.y, z: d.meas.z, text: d.meas.text, hovertemplate: "%{text}<extra></extra>",
      marker: { symbol: "circle-open", size: 6, color: COL.measured, line: { color: COL.measured, width: 2 } }
    });
    traces.push({
      type: "scatter3d", mode: "text", showlegend: false, hoverinfo: "skip",
      x: d.boxes.map(function (b) { return LABEL_SIDE[b.id] ? b.x1 : (b.x0 + b.x1) / 2; }),
      y: d.boxes.map(function (b) { return Math.sqrt(b.y0 * b.y1); }),
      z: d.boxes.map(function (b) { return b.z + (LABEL_BELOW[b.id] ? -1 : LABEL_SIDE[b.id] ? 0 : 1) * HALF_Z * (b.id === "gateway" ? 4.2 : 1.8); }),
      text: d.boxes.map(function (b) { return b.name; }),
      textposition: d.boxes.map(function (b) { return LABEL_SIDE[b.id] ? "middle right" : LABEL_BELOW[b.id] ? "bottom center" : "top center"; }),
      textfont: { family: FONT, size: 12, color: d.boxes.map(function (b) { return b.id === "lunar" ? "#ffb98a" : "#97a3bf"; }) }
    });

    var xs = [];
    var ys = [];
    [d.solid, d.other, d.meas].forEach(function (s) { xs = xs.concat(s.x); ys = ys.concat(s.y); });
    d.burned.concat(d.quiet).forEach(function (t) { xs.push(t.o2_percent); ys.push(t.pressure_psia); });
    d.boxes.forEach(function (b) { xs.push(b.x0, b.x1); ys.push(b.y0, b.y1); });
    var xr = [Math.floor(Math.min.apply(null, xs)) - 1, Math.ceil(Math.max.apply(null, xs)) + 1];
    var ticks = ["0g", "moon", "mars", "1g"];

    var layout = {
      paper_bgcolor: COL.bg, plot_bgcolor: COL.bg,
      font: { family: FONT, color: COL.text },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      showlegend: false,
      hoverlabel: { bgcolor: "#18233f", bordercolor: "#34405f", align: "left", font: { family: FONT, color: "#eef2fb", size: 12 } },
      scene: {
        bgcolor: COL.bg,
        domain: { x: [0, 1], y: [0, 1] },
        aspectmode: "manual", aspectratio: { x: 1.3, y: 1, z: 0.9 },
        xaxis: axis("Oxygen (percent)", { range: xr }),
        yaxis: axis("Total pressure (psia)", { type: "log", range: P_RANGE.map(function (v) { return Math.log(v) / Math.LN10; }), tickmode: "array", tickvals: P_TICKS, ticktext: P_TICKS.map(String) }),
        zaxis: axis("Gravity (levels, not to scale)", {
          range: [-0.4, 3.4],
          tickmode: "array",
          tickvals: ticks.map(function (t) { return LEVEL_Z[t]; }),
          ticktext: ticks.map(function (t) { return t === "moon" || t === "mars" ? d.levelLabel[t].split(" (")[0] + " " + parseFloat(Number(d.gravity[t]).toFixed(3)) + " g" : fmt(d.gravity[t], 0) + " g"; })
        }),
        camera: camStart,
        dragmode: "orbit"
      }
    };
    return Plotly.newPlot(plotNode, traces, layout, { displayModeBar: false, displaylogo: false, responsive: true, scrollZoom: true }).then(function () {
      msgNode.hidden = true;
      resetBtn.hidden = false;
      ready = true;
      if (quietMotion()) {
        setCam(camAt(1, zoomFor()));
      } else if (wantPlay) {
        play();
      }
      legend([
        [COL.solid, "Solid fuel tests"],
        [COL.other, "Droplet and gas tests"],
        [COL.flight, "Saffire flights"],
        [COL.measured, "Measured limits at 1 g, Mars, Moon"],
        [COL.accent, "Moon base air"]
      ]);
    });
  }

  document.addEventListener("wheel", function (e) {
    if (!active) {
      e.stopPropagation();
    }
  }, true);
  plotNode.addEventListener("pointerdown", function () { active = true; });
  plotNode.addEventListener("mouseleave", function () { active = false; });
  resetBtn.addEventListener("click", animate);

  Promise.all([get("data/conditions.json"), get("data/outside_psi.json"), get("data/partial_g.json"), get("data/environments.json")]).then(function (r) {
    var d = build(r[0], r[1], r[2], r[3]);
    window.evidence3dCounts = {
      solid: d.solid.x.length, other: d.other.x.length,
      flightsBurned: d.burned.length, flightsNoIgnition: d.quiet.length,
      measured: d.meas.x.length, habitats: d.boxes.length
    };
    return draw(d);
  }).catch(function () {
    msgNode.textContent = "The evidence view could not load.";
  });
})();
