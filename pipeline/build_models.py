import json
import math
import os
import re
import sys

import numpy as np
from scipy.spatial import ConvexHull, Delaunay
from scipy.stats import rankdata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "public", "data")
OUT = os.path.join(SITE, "models.json")

SEED = 20261114
FOLDS = 10
BOOT_METRIC = 500
BOOT_FIT = 500
RIDGE = 1.0
MIN_PRESSURE = 0.3
FUELS = ("Heptane", "Methanol")
EDGE_O2 = 0.01
EDGE_P = 0.02
CURVE_P = 1.0
CURVE_STEP = 0.005
CURVE_LO = 0.12
CURVE_HI = 0.34
OUTCOMES = {"extinction": 1, "disruption": 0, "completion": 0}
STATUS_ORDER = {"inside": 0, "edge": 1, "outside": 2}


def read_json(path):
    with open(path, "r", encoding="ascii") as handle:
        return json.load(handle)


def note_value(text, key):
    match = re.search(r"(?:^|;\s*)" + key + r"=([^;]*)", text or "")
    return match.group(1).strip() if match else None


def diluent_fraction(text, gas):
    match = re.search(gas + r"\s+([\d.]+)", text or "")
    return float(match.group(1)) if match else 0.0


def load_flex():
    rows = []
    excluded = 0
    for r in read_json(os.path.join(SITE, "conditions.json")):
        if r.get("investigation") != "FLEX" or r.get("fuel") not in FUELS:
            continue
        if r.get("pressure_atm") is None or r.get("o2_frac") is None:
            continue
        if r["pressure_atm"] < MIN_PRESSURE:
            excluded += 1
            continue
        co2 = diluent_fraction(r.get("diluent"), "CO2")
        he = diluent_fraction(r.get("diluent"), "He")
        rows.append({
            "fuel": r["fuel"],
            "o2": float(r["o2_frac"]),
            "p": float(r["pressure_atm"]),
            "outcome": r.get("outcome"),
            "date": note_value(r.get("notes"), "date"),
            "co2": co2,
            "he": he,
            "n2_only": co2 == 0.0 and he == 0.0,
            "burn_time": r.get("burn_time_s"),
        })
    return rows, excluded


def design(rows):
    return np.array([[r["o2"], math.log(r["p"]), 1.0 if r["fuel"] == "Heptane" else 0.0] for r in rows])


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30.0, 30.0)))


def fit_logit(X, y):
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd == 0] = 1.0
    Z = np.column_stack([np.ones(len(X)), (X - mu) / sd])
    pen = np.diag([0.0] + [RIDGE] * X.shape[1])
    w = np.zeros(Z.shape[1])
    for _ in range(60):
        p = sigmoid(Z @ w)
        grad = Z.T @ (p - y) + pen @ w
        hess = (Z.T * (p * (1 - p))) @ Z + pen
        step = np.linalg.solve(hess, grad)
        w = w - step
        if np.abs(step).max() < 1e-9:
            break
    return {"w": w, "mu": mu, "sd": sd}


def predict_logit(model, X):
    Z = np.column_stack([np.ones(len(X)), (X - model["mu"]) / model["sd"]])
    return sigmoid(Z @ model["w"])


def group_folds(groups, k):
    sizes = {}
    for g in groups:
        sizes[g] = sizes.get(g, 0) + 1
    order = sorted(sizes, key=lambda g: (-sizes[g], g))
    load = [0] * k
    assign = {}
    for g in order:
        j = min(range(k), key=lambda i: (load[i], i))
        assign[g] = j
        load[j] += sizes[g]
    return np.array([assign[g] for g in groups])


def out_of_fold(X, y, groups):
    fold = group_folds(groups, FOLDS)
    pred = np.zeros(len(y))
    base = np.zeros(len(y))
    for j in range(FOLDS):
        te = fold == j
        tr = ~te
        pred[te] = predict_logit(fit_logit(X[tr], y[tr]), X[te])
        base[te] = y[tr].mean()
    return pred, base


def brier(y, p):
    return float(np.mean((p - y) ** 2))


def auc(y, p):
    pos = y == 1
    n1 = int(pos.sum())
    n0 = len(y) - n1
    if n1 == 0 or n0 == 0:
        return float("nan")
    ranks = rankdata(p)
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2.0) / (n1 * n0))


def cluster_indices(groups):
    ug = sorted(set(groups))
    arr = np.array(groups)
    return ug, {g: np.where(arr == g)[0] for g in ug}


def resample(rng, ug, idx):
    pick = rng.integers(0, len(ug), len(ug))
    return np.concatenate([idx[ug[i]] for i in pick])


def pct(values, lo=2.5, hi=97.5):
    return [float(np.percentile(values, lo)), float(np.percentile(values, hi))]


def rnd(value, digits=3):
    return round(float(value), digits)


def build_hulls(rows):
    hulls = {}
    for fuel in FUELS:
        pts = np.array(sorted({(r["o2"], r["p"]) for r in rows if r["fuel"] == fuel}))
        lo = pts.min(axis=0)
        span = pts.max(axis=0) - lo
        hulls[fuel] = {"pts": pts, "lo": lo, "span": span, "tri": Delaunay((pts - lo) / span)}
    return hulls


def in_hull(hull, o2, p):
    q = (np.array([[o2, p]]) - hull["lo"]) / hull["span"]
    return bool(hull["tri"].find_simplex(q)[0] >= 0)


def nearest_tested(hull, o2, p):
    q = (np.array([o2, p]) - hull["lo"]) / hull["span"]
    d = (((hull["pts"] - hull["lo"]) / hull["span"] - q) ** 2).sum(axis=1)
    j = int(d.argmin())
    return {"o2": rnd(hull["pts"][j][0]), "pressure_atm": rnd(hull["pts"][j][1])}


def excess(hull, o2, p):
    o2_lo, p_lo = hull["pts"].min(axis=0)
    o2_hi, p_hi = hull["pts"].max(axis=0)
    return {
        "o2": max(0.0, o2_lo - o2, o2 - o2_hi),
        "p": max(0.0, p_lo - p, p - p_hi),
        "p_side": "below" if p < p_lo else ("above" if p > p_hi else None),
        "o2_side": "below" if o2 < o2_lo else ("above" if o2 > o2_hi else None),
    }


def sig(value, digits=5):
    return float("{:.{}g}".format(float(value), digits))


def raw_coefficients(fit):
    scaled = fit["w"][1:] / fit["sd"]
    intercept = fit["w"][0] - float(np.sum(fit["w"][1:] * fit["mu"] / fit["sd"]))
    return [intercept] + [float(v) for v in scaled]


def hull_polygon(hull):
    pts = hull["pts"]
    order = ConvexHull(pts).vertices
    return [[round(float(pts[i][0]), 6), round(float(pts[i][1]), 6)] for i in order]


def predictor_block(full, fits, hulls):
    return {
        "features": ["o2_frac", "ln_pressure_atm", "fuel_is_heptane"],
        "standardised": {
            "intercept": sig(full["w"][0], 8),
            "coef": [sig(v, 8) for v in full["w"][1:]],
            "mean": [sig(v, 8) for v in full["mu"]],
            "scale": [sig(v, 8) for v in full["sd"]],
        },
        "raw": [sig(v, 8) for v in raw_coefficients(full)],
        "bootstrap_raw": [[sig(v) for v in raw_coefficients(f)] for f in fits],
        "bootstrap_note": "One raw-scale coefficient vector [intercept, o2_frac, ln_pressure_atm, fuel_is_heptane] per cluster-bootstrap refit over test dates. The 95 percent range is the 2.5th to 97.5th percentile of the predictions across these vectors.",
        "hull": {fuel: hull_polygon(hulls[fuel]) for fuel in FUELS},
        "box": {
            fuel: {
                "o2": [round(float(hulls[fuel]["pts"][:, 0].min()), 6), round(float(hulls[fuel]["pts"][:, 0].max()), 6)],
                "pressure_atm": [round(float(hulls[fuel]["pts"][:, 1].min()), 6), round(float(hulls[fuel]["pts"][:, 1].max()), 6)],
            }
            for fuel in FUELS
        },
    }


def window_points(env):
    o2 = env["o2"]
    pr = env["pressure_atm"]
    pts = [(a, b) for a in (o2["window_min"], o2["window_max"]) for b in (pr["window_min"], pr["window_max"])]
    mid = ((o2["window_min"] + o2["window_max"]) / 2.0, (pr["window_min"] + pr["window_max"]) / 2.0)
    return pts, mid


def refusal_text(fuel, name, ex, hull, mid):
    lowest = hull["pts"][:, 1].min()
    parts = []
    if ex["p"] > 0:
        side = "below the lowest" if ex["p_side"] == "below" else "above the highest"
        edge = lowest if ex["p_side"] == "below" else hull["pts"][:, 1].max()
        parts.append("{:.2f} atm {} tested pressure ({:.3f} atm)".format(ex["p"], side, edge))
    if ex["o2"] > 0:
        side = "below the lowest" if ex["o2_side"] == "below" else "above the highest"
        edge = hull["pts"][:, 0].min() if ex["o2_side"] == "below" else hull["pts"][:, 0].max()
        parts.append("{:.1f} points of O2 {} tested ({:.0f} percent)".format(ex["o2"] * 100, side, edge * 100))
    if not parts:
        parts.append("outside the region the {} tests covered".format(fuel.lower()))
    return "{}: {}. {} air is {:.2f} atm.".format(fuel, "; ".join(parts), name, mid[1])


def curve_range(hull):
    xs = [round(CURVE_LO + i * CURVE_STEP, 4) for i in range(int(round((CURVE_HI - CURVE_LO) / CURVE_STEP)) + 1)]
    return [x for x in xs if in_hull(hull, x, CURVE_P)]


def limiting_block(rows, all_rows_n):
    out = {}
    published = {
        "Methanol": {
            "value_text": "about 12 to 13 percent O2",
            "source": "NTRS 20130014061",
            "title": "Methanol Droplet Combustion in Oxygen-Inert Environments in Microgravity",
            "url": "https://ntrs.nasa.gov/citations/20130014061",
            "verified_in_repo": True,
            "quote": "The experiments also show that the limiting oxygen index for methanol in these diluent gases is around 12% to 13% oxygen by volume.",
        },
        "Heptane": {
            "value_text": "about 15 percent O2",
            "source": "Dietrich 2014, as reported in the project research notes",
            "title": "",
            "url": "",
            "verified_in_repo": False,
            "quote": "",
        },
    }
    for fuel in FUELS:
        sub = [r for r in rows if r["fuel"] == fuel]
        n2 = [r for r in sub if r["n2_only"]]
        comp = [r for r in sub if r["outcome"] == "completion"]
        lowest_all = min(r["o2"] for r in sub)
        lowest_n2 = min(r["o2"] for r in n2)
        out[fuel] = {
            "rows": len(sub),
            "lowest_o2_with_flame_any_diluent": rnd(lowest_all),
            "rows_at_that_o2": sum(1 for r in sub if r["o2"] == lowest_all),
            "lowest_o2_with_flame_n2_only": rnd(lowest_n2),
            "lowest_o2_completion": rnd(min(r["o2"] for r in comp)) if comp else None,
            "completion_rows": len(comp),
            "published": published[fuel],
        }
    return {
        "what_the_rows_show": "Every FLEX row records a flame, so the lowest O2 in the rows is the lowest O2 NASA tested with a flame seen, not a measured limit. Published limits mark where quasi-steady burning stops, a stricter test.",
        "fuels": out,
    }


def diluent_block(rows):
    families = (
        ("N2 only", lambda r: r["co2"] == 0 and r["he"] == 0),
        ("N2 with CO2", lambda r: r["co2"] > 0 and r["he"] == 0),
        ("N2 with He", lambda r: r["he"] > 0 and r["co2"] == 0),
    )
    band = (0.15, 0.25)
    table = []
    for fuel in FUELS:
        for label, test in families:
            sub = [r for r in rows if r["fuel"] == fuel and test(r)]
            if not sub:
                continue
            inb = [r for r in sub if band[0] <= r["o2"] <= band[1]]
            table.append({
                "fuel": fuel,
                "diluent": label,
                "rows": len(sub),
                "o2_min": rnd(min(r["o2"] for r in sub)),
                "o2_max": rnd(max(r["o2"] for r in sub)),
                "extinction_share": rnd(sum(1 for r in sub if r["outcome"] == "extinction") / len(sub)),
                "band_rows": len(inb),
                "band_extinction_share": rnd(sum(1 for r in inb if r["outcome"] == "extinction") / len(inb)) if inb else None,
            })
    return {
        "band_o2": [band[0], band[1]],
        "table": table,
        "note": "Counts straight from the rows. Not adjusted for pressure or droplet size. CO2 mixes mostly cover lower O2 than He mixes, so shares are not like for like. No published comparison is cited here.",
    }


def build():
    rows, excluded = load_flex()
    envs = read_json(os.path.join(SITE, "environments.json"))["environments"]
    rng = np.random.default_rng(SEED)

    labelled = [r for r in rows if r["outcome"] in OUTCOMES and r["date"]]
    X = design(labelled)
    y = np.array([OUTCOMES[r["outcome"]] for r in labelled], dtype=float)
    groups = [r["date"] for r in labelled]
    pred, base = out_of_fold(X, y, groups)
    b_model = brier(y, pred)
    b_base = brier(y, base)
    skill = 1.0 - b_model / b_base
    a_model = auc(y, pred)

    ug, idx = cluster_indices(groups)
    gains = []
    skills = []
    aucs = []
    for _ in range(BOOT_METRIC):
        ii = resample(rng, ug, idx)
        bm = brier(y[ii], pred[ii])
        bb = brier(y[ii], base[ii])
        gains.append(bb - bm)
        skills.append(1.0 - bm / bb)
        a = auc(y[ii], pred[ii])
        if not math.isnan(a):
            aucs.append(a)

    bins = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0001]
    calibration = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (pred >= lo) & (pred < hi)
        if m.sum():
            calibration.append({"from": rnd(lo, 2), "to": rnd(min(hi, 1.0), 2), "rows": int(m.sum()), "predicted": rnd(pred[m].mean()), "observed": rnd(y[m].mean())})

    full = fit_logit(X, y)
    fits = []
    for _ in range(BOOT_FIT):
        ii = resample(rng, ug, idx)
        fits.append(fit_logit(X[ii], y[ii]))

    def predict_with_band(o2s, ps, heptane):
        Q = np.array([[o, math.log(p), heptane] for o, p in zip(o2s, ps)])
        point = predict_logit(full, Q)
        boot = np.array([predict_logit(f, Q) for f in fits])
        return point, np.percentile(boot, 2.5, axis=0), np.percentile(boot, 97.5, axis=0)

    hulls = build_hulls(rows)
    per_fuel_rows = {f: sum(1 for r in labelled if r["fuel"] == f) for f in FUELS}
    domain = {}
    for fuel in FUELS:
        sub = [r for r in rows if r["fuel"] == fuel]
        n2 = [r for r in sub if r["n2_only"]]
        h = hulls[fuel]
        domain[fuel] = {
            "rows": len(sub),
            "o2": [rnd(h["pts"][:, 0].min()), rnd(h["pts"][:, 0].max())],
            "pressure_atm": [rnd(h["pts"][:, 1].min()), rnd(h["pts"][:, 1].max())],
            "n2_only_rows": len(n2),
            "n2_only_o2": [rnd(min(r["o2"] for r in n2)), rnd(max(r["o2"] for r in n2))],
            "n2_only_pressure_atm": [rnd(min(r["p"] for r in n2)), rnd(max(r["p"] for r in n2))],
        }

    curves = {}
    for fuel in FUELS:
        xs = curve_range(hulls[fuel])
        point, lo, hi = predict_with_band(xs, [CURVE_P] * len(xs), 1.0 if fuel == "Heptane" else 0.0)
        curves[fuel] = {
            "o2": xs,
            "p": [rnd(v) for v in point],
            "lo": [rnd(v) for v in lo],
            "hi": [rnd(v) for v in hi],
            "tested_o2_at_curve_pressure": [xs[0], xs[-1]],
        }

    habitats = []
    for env in envs:
        pts, mid = window_points(env)
        per = {}
        worst = "inside"
        for fuel in FUELS:
            h = hulls[fuel]
            corners_in = all(in_hull(h, a, b) for a, b in pts + [mid])
            ex = excess(h, mid[0], mid[1])
            if corners_in:
                status = "inside"
            elif ex["o2"] <= EDGE_O2 and ex["p"] <= EDGE_P:
                status = "edge"
            else:
                status = "outside"
            entry = {
                "status": status,
                "margin": {"o2": rnd(ex["o2"], 4), "pressure_atm": rnd(ex["p"], 4)},
                "nearest_tested": nearest_tested(h, mid[0], mid[1]),
            }
            if status == "outside":
                entry["prediction"] = None
                entry["refusal"] = refusal_text(fuel, env["name"], ex, h, mid)
            else:
                point, lo, hi = predict_with_band([mid[0]], [mid[1]], 1.0 if fuel == "Heptane" else 0.0)
                entry["prediction"] = {"estimate": rnd(point[0]), "lo": rnd(lo[0]), "hi": rnd(hi[0])}
                entry["refusal"] = None
            if STATUS_ORDER[status] > STATUS_ORDER[worst]:
                worst = status
            per[fuel] = entry
        habitats.append({
            "id": env["id"],
            "name": env["name"],
            "o2": {"min": env["o2"]["window_min"], "max": env["o2"]["window_max"], "mid": rnd(mid[0], 4)},
            "pressure_atm": {"min": env["pressure_atm"]["window_min"], "max": env["pressure_atm"]["window_max"], "mid": rnd(mid[1], 4)},
            "status": worst,
            "fuels": per,
        })

    high_o2 = [r for r in rows if r["o2"] >= 0.30 and r["p"] < 0.8]

    model = {
        "id": "flex_radiative_extinction",
        "name": "Does a droplet flame go out on its own?",
        "family": "FLEX droplet flames, 0 g, quiescent",
        "target": "Probability that a FLEX test ends in radiative extinction, the flame dying on its own as the droplet shrinks, instead of droplet break-up (disruption) or burning to completion.",
        "label_note": "The not-extinguished class mixes disruption, partly a test artefact, with completion, where the fuel burned out. Completion alone has too few rows to model separately.",
        "features": ["O2 mole fraction", "ln of pressure (atm)", "fuel (heptane or methanol)"],
        "method": "Ridge-penalised logistic regression, 3 inputs, fitted on all labelled rows. Diluent identity is not an input, so gas other than O2 is assumed to be N2.",
        "rows_used": {"total": len(labelled), "by_fuel": per_fuel_rows, "positive": int(y.sum()), "negative": int(len(y) - y.sum())},
        "rows_excluded": {"count": excluded, "reason": "recorded pressure below 0.3 atm, a data defect in the PSI table"},
        "validation": {
            "scheme": "GroupKFold by test date: {} folds, {} test dates, whole days held out. Intervals from {} cluster bootstrap resamples over dates.".format(FOLDS, len(ug), BOOT_METRIC),
            "folds": FOLDS,
            "groups": len(ug),
            "bootstrap_resamples": BOOT_METRIC,
            "seed": SEED,
            "baseline": "Training-fold share of extinctions, the same guess for every row",
            "brier_model": rnd(b_model, 4),
            "brier_baseline": rnd(b_base, 4),
            "brier_gain": rnd(b_base - b_model, 4),
            "brier_gain_ci95": [rnd(v, 4) for v in pct(gains)],
            "brier_skill": rnd(skill, 3),
            "brier_skill_ci95": [rnd(v, 3) for v in pct(skills)],
            "auc": rnd(a_model, 3),
            "auc_ci95": [rnd(v, 3) for v in pct(aucs)],
            "auc_baseline": 0.5,
            "calibration": calibration,
        },
        "domain": {
            "rule": "Predict only if the habitat window and its mid-point lie inside the convex hull of tested (O2, pressure) points for that fuel. Within {} atm and {} O2 of the tested range the verdict is edge. Otherwise the model refuses.".format(EDGE_P, EDGE_O2),
            "fuels": domain,
            "edge_tolerance": {"pressure_atm": EDGE_P, "o2": EDGE_O2},
            "gas_assumption": "O2 plus N2 balance",
            "hull_uses_all_diluents": True,
        },
        "limits": [
            "FLEX is droplets of heptane and methanol in still gas at 0 g. It says nothing about solids, flow or other fuels.",
            "No FLEX test ran below {:.3f} atm.".format(min(domain[f]["pressure_atm"][0] for f in FUELS)),
            "Only {} FLEX rows have O2 of 30 percent or more below 0.8 atm, and {} of them ended in radiative extinction.".format(len(high_o2), sum(1 for r in high_o2 if r["outcome"] == "extinction")),
            "All numbers are cross-validated within one facility's campaigns. No independent test set exists.",
            "The burning-rate value is not modelled: its unit in the PSI file header is not stated.",
        ],
        "curve": {
            "pressure_atm": CURVE_P,
            "gas": "N2 balance",
            "fuels": curves,
        },
        "habitats": habitats,
        "predictor": predictor_block(full, fits, hulls),
    }

    return {
        "schema": 1,
        "source": "public/data/conditions.json, investigation FLEX (PSI-69)",
        "models": [model],
        "limiting_oxygen": limiting_block(rows, len(rows)),
        "diluents": diluent_block(rows),
    }


def main():
    result = build()
    text = json.dumps(result, sort_keys=True, ensure_ascii=True, indent=1)
    with open(OUT, "w", encoding="ascii", newline="\n") as handle:
        handle.write(text + "\n")
    m = result["models"][0]["validation"]
    print("rows", result["models"][0]["rows_used"]["total"], "brier", m["brier_model"], "vs", m["brier_baseline"], "skill", m["brier_skill"], "auc", m["auc"])
    for h in result["models"][0]["habitats"]:
        print(h["id"], h["status"], {f: (v["status"], v["prediction"]) for f, v in h["fuels"].items()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
