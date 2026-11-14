import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INVENTORY = os.path.join(ROOT, "data", "psi_combustion_inventory.json")
UNIFIED = os.path.join(ROOT, "data", "unified", "investigations.json")
OUT_DIR = os.path.join(ROOT, "data", "investigations")
RAW_DIR = os.path.join(OUT_DIR, "raw")
NTRS_DIR = os.path.join(OUT_DIR, "raw_ntrs")
META_OUT = os.path.join(OUT_DIR, "investigations_meta.json")
README_OUT = os.path.join(OUT_DIR, "README.md")

PSI_BASE = "https://psi.nasa.gov/geode-py/ws"
PSI_PAGE = "https://psi.nasa.gov/physci/repo/data/investigations/"
NTRS_SEARCH = "https://ntrs.nasa.gov/api/citations/search"
UA = "Mozilla/5.0 Chrome/140.0"
DELAY = 0.6

FUNCTIONS = ("prevention", "detection", "suppression", "fundamental")

REFETCH = "--refetch" in sys.argv
SKIP_NTRS = "--skip-ntrs" in sys.argv


def ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


CTX = ssl_context()
FAILURES = []


def http(url, data=None, retries=3):
    headers = {"User-Agent": UA}
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=90, context=CTX) as r:
                raw = r.read()
            time.sleep(DELAY)
            return raw
        except urllib.error.HTTPError as e:
            last = "HTTP %s" % e.code
            if e.code in (400, 401, 403, 404):
                break
        except Exception as e:
            last = repr(e)
        time.sleep(2 * (attempt + 1))
    FAILURES.append({"url": url, "error": last})
    return None


def http_json(url, data=None):
    raw = http(url, data)
    if raw is None:
        return None
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        FAILURES.append({"url": url, "error": "invalid json"})
        return None


def walk_files(nodes, out):
    for n in nodes:
        if n.get("directory") is False and "bytes_size" in n:
            out.append(n)
        if n.get("files"):
            walk_files(n["files"], out)


def list_files(psi_id, version_hint):
    tried = []
    versions = []
    if version_hint:
        versions.append(int(version_hint))
    versions += [v for v in range(12, 0, -1) if v not in versions]
    for v in versions:
        payload = {"folder": "", "fileType": "study", "studyId": psi_id,
                   "version": str(v), "obfuscationcode": ""}
        req = urllib.request.Request(
            PSI_BASE + "/files/v2",
            data=json.dumps(payload).encode("utf-8"),
            headers={"User-Agent": UA, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=90, context=CTX) as r:
                j = json.loads(r.read().decode("utf-8", "replace"))
            time.sleep(DELAY)
        except Exception as e:
            tried.append((v, repr(e)))
            time.sleep(DELAY)
            continue
        flat = []
        walk_files(j.get("files") or [], flat)
        if flat:
            return v, flat
    FAILURES.append({"url": PSI_BASE + "/files/v2 studyId=" + psi_id,
                     "error": "no file listing for any version; " + str(tried[:3])})
    return 0, []


def summarize_files(flat):
    cats = {}
    for f in flat:
        c = f.get("sortingCategory") or "Uncategorized"
        d = cats.setdefault(c, {"files": 0, "bytes": 0, "restricted_files": 0})
        d["files"] += 1
        d["bytes"] += int(f.get("bytes_size") or 0)
        if f.get("restricted") or f.get("restrictedAccess"):
            d["restricted_files"] += 1
    return cats


def fetch_psi(psi_id):
    path = os.path.join(RAW_DIR, psi_id + ".json")
    if os.path.exists(path) and not REFETCH:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    detail = http_json("%s/repo/investigations/%s" % (PSI_BASE, psi_id))
    version, flat = list_files(psi_id, (detail or {}).get("version"))
    listing = None
    if flat:
        listing = {
            "version": version,
            "total_files": len(flat),
            "total_bytes": sum(int(f.get("bytes_size") or 0) for f in flat),
            "categories": summarize_files(flat),
            "non_raw_files": [
                {"name": os.path.basename(f["key"]),
                 "category": f.get("sortingCategory"),
                 "bytes": int(f.get("bytes_size") or 0)}
                for f in flat
                if (f.get("sortingCategory") or "") not in ("Raw Data", "Calibration")
            ],
        }
    rec = {"psi_id": psi_id, "detail": detail, "file_listing": listing,
           "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    os.makedirs(RAW_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, ensure_ascii=True, indent=1)
    return rec


def load_ids():
    with open(INVENTORY, encoding="utf-8") as fh:
        inv = json.load(fh)
    def key(s):
        return int(s.split("-")[1])
    return sorted(inv.keys(), key=key)

SENT_SPLIT = re.compile(r"(?<=[.!?;])\s+(?=[A-Z0-9(\[])|\n+")


def sentences(text):
    parts = [p.strip() for p in SENT_SPLIT.split(text or "")]
    out = []
    carry = ""
    for p in parts:
        if not p:
            continue
        p = (carry + " " + p).strip() if carry else p
        carry = ""
        if len(p) < 14:
            carry = p
            continue
        out.append(p)
    if carry:
        out.append(carry)
    return out


def quote(sent, limit=420):
    sent = " ".join(sent.split())
    return sent if len(sent) <= limit else sent[:limit].rstrip() + " ..."


def norm(text):
    return (text or "").strip()


CUES = {
    "suppression": re.compile(
        r"(fire|flame)[- ]suppress\w*|suppressant\w*|extinguishing agent|"
        r"extinguishment|fire[- ]?fight\w*|put(?:ting)? out|"
        r"suppression of (?:fire|flame)s?|detection(?: and|,) suppression|"
        r"suppression systems?", re.I),
    "detection": re.compile(
        r"(?:fire|smoke)[- ]detect\w*|smoke aerosol|detection systems?|"
        r"detection and suppression|detection, suppression|"
        r"particulate counter|smoke particle|smoke generation|"
        r"smoke detectors?", re.I),
    "prevention": re.compile(
        r"material flammability|materials? selection|flammability limits?|"
        r"flammability screening|flammability of|flammability test|"
        r"NASA.STD.6001|\bignition\b|\bprevent\w*|fire safety standards?|"
        r"flame spread|fire (?:grows|growth|spread)|material screening|"
        r"safest materials|fire risk", re.I),
    "fundamental": re.compile(
        r"\bsoot\b|kinetic\w*|validat\w+ (?:of )?(?:the )?"
        r"(?:numerical|computational|models?|simulations?)|"
        r"computational models?|numerical simulations?|benchmark|"
        r"fundamental\w*|cool flames?|droplet|diffusion flames?|"
        r"flame structure|chemi-?ion\w*|basic understanding|"
        r"model validation|detailed chemistry", re.I),
}
TIE_ORDER = ("suppression", "detection", "prevention", "fundamental")
MIN_PRIMARY_SCORE = 2
SOURCE_WEIGHT = (("objective", 3), ("hypothesis", 2), ("researchImpacts", 1))


def classify_function(detail):
    hits = {f: [] for f in FUNCTIONS}
    score = {f: 0 for f in FUNCTIONS}
    for field, weight in SOURCE_WEIGHT:
        for sent in sentences(detail.get(field) or ""):
            for fn in TIE_ORDER:
                if CUES[fn].search(sent):
                    hits[fn].append({"source_field": field, "weight": weight,
                                     "quote": quote(sent)})
                    score[fn] += weight
    candidates = [{"function": fn, "score": score[fn], "evidence": hits[fn][:4]}
                  for fn in TIE_ORDER if score[fn] > 0]
    if not candidates:
        return "unassigned", "", []
    best = max(TIE_ORDER, key=lambda fn: (score[fn], -TIE_ORDER.index(fn)))
    if score[best] < MIN_PRIMARY_SCORE:
        return "unassigned", "", candidates
    ev = sorted(hits[best], key=lambda h: -h["weight"])[0]
    basis = "[%s] %s" % (ev["source_field"], ev["quote"])
    return best, basis, candidates


DIAG_TERMS = re.compile(
    r"\b(temperature|oxygen|carbon dioxide|pressure|velocity|radiation|"
    r"heat flux|soot volume fraction|ion current|chemiluminescence)\b", re.I)
INSTRUMENT_ONLY = re.compile(
    r"\b(cameras?|video|imag(?:er|ers|ing)|DSLR|thermocouples?|radiometers?|"
    r"photodiodes?|spectromet\w+|spectroscop\w+|analy[sz]ers?|sensors?|"
    r"anemometers?|transducers?|interferomet\w+|schlieren|tomograph\w+|"
    r"pyrometr\w+|detectors?|PIV|probes?|chromatograph\w+|calorimeters?|"
    r"gauges?|microphones?|photometers?|counters?|flowmeters?|"
    r"electrometers?|diagnostics?)\b", re.I)
MEASURE = re.compile(r"\bmeasur\w+|\bquantif\w+|\brecorded\b", re.I)


def diagnostics(detail):
    out = []
    terms = set()
    seen = set()
    for field in ("approach", "objective", "researchImpacts", "hypothesis"):
        for sent in sentences(detail.get(field) or ""):
            inst = INSTRUMENT_ONLY.findall(sent)
            if inst or (MEASURE.search(sent) and DIAG_TERMS.search(sent)):
                q = quote(sent)
                if q in seen:
                    continue
                seen.add(q)
                out.append({"source_field": field, "text": q})
                for t in inst:
                    terms.add(t.lower())
    return out, sorted(terms)


INCREMENT = re.compile(r"\bIncrements? \d+(?:\s*(?:-|to|and|/|,)\s*\d+)*", re.I)


def increments(detail):
    found = []
    for field in ("approach", "objective", "hypothesis", "researchImpacts",
                  "missionName"):
        for m in INCREMENT.findall(detail.get(field) or ""):
            if m not in found:
                found.append(m)
    return found


def derive_platform(detail):
    fp = norm(detail.get("flightProgram"))
    hw = norm(detail.get("experimentHardware"))
    ptype = norm(detail.get("projectType"))
    blob = (fp + " " + hw).lower()
    if "cygnus" in blob:
        return "Cygnus", "flightProgram=%r; experimentHardware=%r" % (fp, hw)
    if "international space station" in blob:
        return "ISS", "flightProgram=%r" % fp
    if ptype.lower().startswith("ground") and fp.lower() in ("", "not applicable"):
        return "ground", "projectType=%r; flightProgram=%r" % (ptype, fp)
    return "", ""


def people(detail):
    pis, cois, others = [], [], []
    insts = []
    for c in detail.get("contacts") or []:
        name = " ".join(x for x in (norm(c.get("firstName")),
                                    norm(c.get("midInitials")),
                                    norm(c.get("lastName"))) if x)
        roles = [norm(r.get("annotationValue")) for r in c.get("roles") or []]
        aff = norm(c.get("affiliation"))
        if aff and aff not in insts:
            insts.append(aff)
        rl = " ".join(roles).lower()
        if "principal investigator" in rl:
            pis.append(name)
        elif "co-investigator" in rl:
            cois.append(name)
        else:
            others.append({"name": name, "roles": roles, "affiliation": aff})
    return pis, cois, others, insts


def publications(detail):
    out = []
    for p in detail.get("publications") or []:
        doi = norm(p.get("doi"))
        out.append({
            "title": norm(p.get("title")),
            "authors": norm(p.get("authorList")),
            "year": "",
            "doi": doi,
            "url": "https://doi.org/" + doi if doi else "",
            "pubmed_id": norm(p.get("pubMedID")),
            "status": norm((p.get("status") or {}).get("annotationValue")),
        })
    return out


def load_unified():
    with open(UNIFIED, encoding="utf-8") as fh:
        inv = json.load(fh)
    rows = {}
    cpath = os.path.join(ROOT, "data", "unified", "conditions.json")
    with open(cpath, encoding="utf-8") as fh:
        for r in json.load(fh):
            rows.setdefault(r["psi_id"], []).append(r)
    return inv, rows


def distinct(rows, key, limit=40):
    counts = {}
    for r in rows:
        v = r.get(key)
        if v not in (None, ""):
            counts[str(v)] = counts.get(str(v), 0) + 1
    items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"value": k, "rows": n} for k, n in items[:limit]], len(items)


def numeric_range(rows, key):
    vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
    if not vals:
        return None
    return {"min": min(vals), "max": max(vals), "rows": len(vals)}


def build_record(psi_id, raw, unified_inv, unified_rows):
    d = raw.get("detail") or {}
    fl = raw.get("file_listing")
    pis, cois, others, insts = people(d)
    platform, platform_basis = derive_platform(d)
    fn, basis, cands = classify_function(d)
    diag, diag_terms = diagnostics(d)
    rows = unified_rows.get(psi_id, [])
    uinv = unified_inv.get(psi_id, {})
    fuels, n_fuels = distinct(rows, "fuel")
    geoms, n_geoms = distinct(rows, "sample_geometry")
    diluents, _ = distinct(rows, "diluent", 20)
    cond = {}
    for key in ("o2_frac", "pressure_atm", "flow_cm_s"):
        rng = numeric_range(rows, key)
        if rng:
            cond[key] = rng
    cond_unified = {"source": "data/unified/conditions.json",
                    "row_count": len(rows), "ranges": cond,
                    "diluents": diluents} if rows else {}
    categories = []
    if fl:
        for cat, v in sorted(fl["categories"].items()):
            categories.append({"category": cat, "files": v["files"],
                               "bytes": v["bytes"],
                               "restricted_files": v["restricted_files"]})
    return {
        "psi_id": psi_id,
        "title": norm(d.get("title")),
        "acronym": norm(d.get("investigationAcronym")),
        "short_name": uinv.get("investigation", ""),
        "description": norm(d.get("description")),
        "objectives": norm(d.get("objective")),
        "hypothesis": norm(d.get("hypothesis")),
        "approach": norm(d.get("approach")),
        "research_impacts_earth_benefits": norm(d.get("researchImpacts")),
        "research_area": norm(d.get("researchArea")),
        "sub_research_area": norm(d.get("subResearchArea")),
        "project_type": norm(d.get("projectType")),
        "principal_investigators": pis,
        "co_investigators": cois,
        "other_contacts": others,
        "institutions": insts,
        "managing_center": norm(d.get("managingNasaCenter")),
        "funding": norm(d.get("funding")),
        "platform": platform,
        "platform_basis": platform_basis,
        "flight_program_raw": norm(d.get("flightProgram")),
        "hardware": norm(d.get("experimentHardware")),
        "hardware_link": norm(d.get("experimentHardwareLink")),
        "fuel_class": uinv.get("fuel_class", ""),
        "fuel_class_source": "data/unified/investigations.json" if uinv.get("fuel_class") else "",
        "fuels": fuels,
        "fuels_distinct_total": n_fuels,
        "fuels_source": "data/unified/conditions.json" if fuels else "",
        "sample_geometry": geoms,
        "sample_geometry_distinct_total": n_geoms,
        "sample_geometry_source": "data/unified/conditions.json" if geoms else "",
        "test_conditions_text": norm(d.get("approach")),
        "test_conditions_unified": cond_unified,
        "diagnostics_measurements": diag,
        "diagnostics_terms": diag_terms,
        "mission": {
            "investigation_start": norm(d.get("investigationStartDate")),
            "investigation_end": norm(d.get("investigationEndDate")),
            "mission_name": norm(d.get("missionName")),
            "mission_start": norm(d.get("missionStart")),
            "mission_end": norm(d.get("missionEnd")),
            "public_release": norm(d.get("releaseDate")),
            "increments": increments(d),
        },
        "doi": norm(d.get("doi")),
        "license": {"id": norm(d.get("licenseIdentifier")),
                    "name": norm(d.get("licenseName")),
                    "link": norm(d.get("licenseLink"))},
        "psi_url": PSI_PAGE + psi_id,
        "related_investigations": [x for x in norm(d.get("related_glds")).split(",") if x],
        "data_version": (fl or {}).get("version") or d.get("version") or "",
        "data_categories": categories,
        "data_total_files": (fl or {}).get("total_files", 0),
        "data_total_bytes": (fl or {}).get("total_bytes", 0),
        "documents_listed": (fl or {}).get("non_raw_files", []),
        "publications": publications(d),
        "fire_safety_function": fn,
        "fire_safety_function_basis": basis,
        "fire_safety_function_candidates": cands,
        "ntrs_publications": [],
    }


def acronym_terms(rec):
    terms = []
    for part in re.split(r"\s*/\s*", rec["acronym"]):
        part = re.sub(r"^ACME\s+", "", part.strip())
        if part and part.upper() != "ACME" and part not in terms:
            terms.append(part)
    return terms


def acronym_base(acr):
    base = re.sub(r"[-\s]?(?:I{1,3}|IV|V|R|\d+)$", "", acr)
    return base if len(base) >= 5 and base != acr else ""


ACME_PREFIX = re.compile(r"^Advanced Combustion via Microgravity Experiments\s*(?:\(ACME\))?\s*[-/:]?\s*", re.I)


def title_segments(title):
    segs = []
    core = ACME_PREFIX.sub("", title)
    for s in re.split(r"\s+[-/:]\s+|\s*/\s*|:\s+", core):
        s = s.strip()
        if len(s) >= 12 and s.lower() not in [x.lower() for x in segs]:
            segs.append(s)
    return segs


GENERIC_TOKENS = {"advanced", "combustion", "microgravity", "experiments",
                  "experiment", "investigation", "effects", "effect", "using",
                  "with", "from", "data", "analysis", "study", "studies",
                  "the", "and", "for", "via", "flame", "flames"}


def title_tokens(title):
    toks = []
    for t in re.findall(r"[A-Za-z][A-Za-z-]{3,}", title.lower()):
        if t not in GENERIC_TOKENS and t not in toks:
            toks.append(t)
    return toks


TOPIC = re.compile(r"microgravity|space station|\bISS\b|combustion|flame|"
                   r"\bfire\b|smoke|droplet|soot|aerosol|spacecraft", re.I)


def ntrs_queries(rec):
    q = []
    title = rec["title"]
    for a in acronym_terms(rec):
        q.append('"%s" microgravity' % a)
        base = acronym_base(a)
        if base:
            q.append('"%s" microgravity' % base)
    q.append('"%s"' % title)
    for seg in title_segments(title)[:3]:
        q.append('"%s" microgravity' % seg)
    toks = title_tokens(title)
    if len(toks) >= 3:
        q.append(" ".join(toks[:5]))
    seen = []
    for x in q:
        if x not in seen:
            seen.append(x)
    return seen


def ntrs_fetch(query):
    key = re.sub(r"[^A-Za-z0-9]+", "_", query)[:90]
    path = os.path.join(NTRS_DIR, key + ".json")
    if os.path.exists(path) and not REFETCH:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    url = NTRS_SEARCH + "?" + urllib.parse.urlencode({"q": query, "page.size": 25})
    j = http_json(url)
    if j is None:
        return None
    os.makedirs(NTRS_DIR, exist_ok=True)
    res = {"query": query, "response": j}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=True)
    return res


def ntrs_authors(r):
    names = []
    for a in sorted(r.get("authorAffiliations") or [], key=lambda x: x.get("sequence", 0)):
        n = ((a.get("meta") or {}).get("author") or {}).get("name")
        if n and n not in names:
            names.append(n)
    return names


def ntrs_pdf(r):
    for dl in r.get("downloads") or []:
        if (dl.get("mimetype") or "") == "application/pdf" and not dl.get("draft"):
            links = dl.get("links") or {}
            rel = links.get("pdf") or links.get("original")
            if rel:
                return "https://ntrs.nasa.gov" + rel if rel.startswith("/") else rel
    return ""


def ntrs_year(r):
    for p in r.get("publications") or []:
        d = p.get("publicationDate") or ""
        if d[:4].isdigit():
            return int(d[:4])
    d = r.get("distributionDate") or ""
    return int(d[:4]) if d[:4].isdigit() else None


SPACE = re.compile(r"microgravity|space station|ISS|spacecraft|space ?flight|"
                   r"low[- ]?g|reduced gravity|zero gravity|parabolic", re.I)


def relevance(rec, r):
    title = r.get("title") or ""
    abstract = r.get("abstract") or ""
    kw = " ".join(r.get("keywords") or [])
    blob = " ".join((title, abstract, kw))
    low_blob = blob.lower()
    acrs = acronym_terms(rec)
    suffixed = bool(acrs) and bool(acronym_base(acrs[0]))
    strong = 0
    weak = 0
    reasons = []
    full = rec["title"].lower()
    if full and full in low_blob:
        strong += 6
        reasons.append("full title")
    if SPACE.search(blob):
        if not suffixed:
            for seg in title_segments(rec["title"]):
                if seg.lower() in low_blob:
                    weak += 3
                    reasons.append("title segment")
                    break
        toks = title_tokens(rec["title"])
        if len(toks) >= 3 and "full title" not in reasons:
            cov = sum(1 for t in toks if t in low_blob) / float(len(toks))
            if cov >= 0.75:
                weak += 3
                reasons.append("title terms")
    for acr in acrs:
        flags = re.I if len(acr) > 4 else 0
        pat = re.compile(r"(?<![A-Za-z0-9])" + re.escape(acr) + r"(?![A-Za-z0-9])", flags)
        got = 0
        if pat.search(title):
            got = 4
            reasons.append("acronym in title")
        elif pat.search(abstract):
            got = 3
            reasons.append("acronym in abstract")
        base = acronym_base(acr)
        if base and not got:
            bpat = re.compile(r"(?<![A-Za-z0-9])" + re.escape(base) +
                              r"(?![A-Za-z0-9])(?![-\s]?(?:[IVX]+|\d+)(?![A-Za-z0-9]))", re.I)
            if bpat.search(title):
                got = 4
                reasons.append("program acronym in title")
        if got and len(acr) <= 4 and not TOPIC.search(blob):
            got = 0
            reasons = [x for x in reasons if not x.startswith("acronym")]
        strong += got
    score = strong + weak
    if strong and TOPIC.search(blob):
        score += 1
    return score, reasons


def enrich_ntrs(rec):
    found = {}
    for q in ntrs_queries(rec):
        res = ntrs_fetch(q)
        if not res:
            continue
        for r in res["response"].get("results") or []:
            rid = str(r.get("id"))
            sc, reasons = relevance(rec, r)
            if sc < 4:
                continue
            sc += min(float((r.get("_meta") or {}).get("score") or 0) / 1000.0, 0.3)
            if rid not in found or sc > found[rid][0]:
                found[rid] = (sc, reasons, q, r)
    ranked = sorted(found.values(), key=lambda t: -t[0])[:5]
    out = []
    for sc, reasons, q, r in ranked:
        out.append({
            "id": str(r.get("id")),
            "title": norm(r.get("title")),
            "year": ntrs_year(r),
            "authors": ntrs_authors(r),
            "abstract": norm(r.get("abstract"))[:600],
            "pdf_url": ntrs_pdf(r),
            "ntrs_url": "https://ntrs.nasa.gov/citations/" + str(r.get("id")),
            "match_basis": ", ".join(sorted(set(reasons))),
            "query": q,
        })
    return out


COVERAGE_FIELDS = [
    "title", "acronym", "short_name", "description", "objectives",
    "principal_investigators", "co_investigators", "institutions", "platform",
    "hardware", "fuel_class", "fuels", "sample_geometry", "test_conditions_text",
    "diagnostics_measurements", "mission", "doi", "license", "psi_url",
    "data_categories", "publications", "fire_safety_function",
    "ntrs_publications",
]
SHORT = {"principal_investigators": "PI", "co_investigators": "CoI",
         "institutions": "inst", "test_conditions_text": "cond_text",
         "diagnostics_measurements": "diag", "data_categories": "data_cat",
         "publications": "pubs", "fire_safety_function": "fsf",
         "ntrs_publications": "ntrs", "sample_geometry": "geom",
         "objectives": "obj", "description": "desc", "short_name": "short",
         "fuel_class": "fclass", "acronym": "acr", "platform": "plat",
         "hardware": "hw"}


def has_value(rec, field):
    v = rec.get(field)
    if field == "mission":
        m = v or {}
        return any(m.get(k) for k in m)
    if field == "license":
        return bool((v or {}).get("id"))
    if field == "fire_safety_function":
        return v not in ("", "unassigned", None)
    return bool(v)


def write_readme(records, failures, ntrs_ran):
    L = []
    L.append("# PSI combustion investigation metadata")
    L.append("")
    L.append("Generated by `pipeline/fetch_psi_metadata.py` from the public PSI endpoint "
             "`https://psi.nasa.gov/geode-py/ws/repo/investigations/{id}`, the PSI file "
             "listing endpoint `.../ws/files/v2`, `data/unified/*.json` (fuel class, fuels, "
             "sample geometry, condition ranges) and the NASA NTRS public API.")
    L.append("")
    L.append("Raw responses: `data/investigations/raw/{psi_id}.json` (PSI detail plus file "
             "listing summary) and `data/investigations/raw_ntrs/` (one file per NTRS query). "
             "Output: `data/investigations/investigations_meta.json`.")
    L.append("")
    L.append("## Field provenance")
    L.append("")
    L.append("- Verbatim from PSI: title, acronym, objectives, hypothesis, approach, "
             "research_impacts_earth_benefits, hardware, doi, license, publications "
             "(title, authors, doi), contacts, dates.")
    L.append("- `description` is the PSI `description` field. PSI leaves it empty for every "
             "investigation, so it stays blank. Use `objectives` and `approach`.")
    L.append("- `fuel_class`, `fuels`, `sample_geometry`, `test_conditions_unified` and "
             "`short_name` come from the unified conditions table, which was built from PSI "
             "experimental tables. Investigations absent from that table are blank.")
    L.append("- `test_conditions_text` is the PSI Approach text, verbatim.")
    L.append("- `diagnostics_measurements` are verbatim sentences from Approach, Objectives, "
             "Hypothesis and Research Impacts that name an instrument or a measurement; "
             "`diagnostics_terms` lists the instrument words matched. PSI has no structured "
             "instrument list.")
    L.append("- `platform` is derived from the PSI flight program and hardware strings "
             "(`platform_basis` shows which). Publication `year` is blank because PSI does "
             "not list one.")
    L.append("- `fire_safety_function`: keyword cues over Objectives (weight 3), Hypothesis "
             "(2) and Research Impacts (1); the highest score wins (minimum 2, so a single Research Impacts sentence alone leaves the record unassigned), ties go to suppression, "
             "detection, prevention, fundamental in that order. "
             "`fire_safety_function_basis` quotes the best supporting sentence and "
             "`fire_safety_function_candidates` lists every function with cue evidence. "
             "`unassigned` means no cue matched. This is a keyword heuristic, not a curated "
             "label: review records with several candidates before relying on the primary.")
    L.append("- NTRS: queries use the acronym, full title and title segments with "
             "microgravity/combustion terms. A hit is kept only when the full title, a title "
             "segment or the acronym (with a topical term) appears in the NTRS title, "
             "abstract or keywords; `match_basis` records why. Max 5 per investigation, "
             "abstract cut to 600 characters. NTRS matching was "
             + ("run." if ntrs_ran else "skipped in this run."))
    L.append("")
    L.append("## Field coverage (Y = found, - = missing)")
    L.append("")
    head = ["psi_id"] + [SHORT.get(f, f) for f in COVERAGE_FIELDS]
    L.append("| " + " | ".join(head) + " |")
    L.append("|" + "|".join(["---"] * len(head)) + "|")
    for r in records:
        row = [r["psi_id"]] + ["Y" if has_value(r, f) else "-" for f in COVERAGE_FIELDS]
        L.append("| " + " | ".join(row) + " |")
    L.append("")
    L.append("## Per investigation")
    L.append("")
    for r in records:
        found = [f for f in COVERAGE_FIELDS if has_value(r, f)]
        missing = [f for f in COVERAGE_FIELDS if not has_value(r, f)]
        L.append("### %s %s" % (r["psi_id"], r["title"]))
        L.append("")
        L.append("- Acronym: %s; platform: %s; function: %s" % (
            r["acronym"] or "-", r["platform"] or "-", r["fire_safety_function"]))
        L.append("- Found: " + ", ".join(found))
        L.append("- Missing: " + (", ".join(missing) if missing else "none"))
        L.append("- PSI publications: %d; NTRS records kept: %d; data files: %d" % (
            len(r["publications"]), len(r["ntrs_publications"]), r["data_total_files"]))
        L.append("")
    L.append("## Endpoint failures")
    L.append("")
    if failures:
        for f in failures:
            L.append("- %s : %s" % (f["url"], f["error"]))
    else:
        L.append("none")
    L.append("")
    with open(README_OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(L))


def main():
    ids = load_ids()
    unified_inv, unified_rows = load_unified()
    records = []
    for pid in ids:
        print("PSI", pid, flush=True)
        raw = fetch_psi(pid)
        rec = build_record(pid, raw, unified_inv, unified_rows)
        if not SKIP_NTRS:
            print("  NTRS", pid, flush=True)
            rec["ntrs_publications"] = enrich_ntrs(rec)
        records.append(rec)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(META_OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(records, fh, ensure_ascii=True, indent=1)
    write_readme(records, FAILURES, not SKIP_NTRS)
    print("wrote", META_OUT, len(records), "records")
    print("failures", json.dumps(FAILURES, indent=1))


if __name__ == "__main__":
    main()
