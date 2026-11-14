import io
import json
import os
import time
import urllib.parse
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "investigations", "raw")
META = os.path.join(ROOT, "data", "investigations", "investigations_meta.json")
OUT_DIR = os.path.join(ROOT, "data", "images")
PSI_BASE = "https://psi.nasa.gov/geode-py/ws"
UA = "Mozilla/5.0 Chrome/140.0"
CATEGORY = "Representative Image(s)"
TARGETS = ["PSI-10", "PSI-22", "PSI-25", "PSI-47", "PSI-159"]
MAX_WIDTH = 1200
SKIP_KEYWORDS = ["logo", "insignia", "on iss", "on_iss", "hardware"]


def post_json(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def get_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def walk(nodes, out):
    for n in nodes:
        if n.get("directory") is False:
            out.append(n)
        walk(n.get("files") or [], out)


def list_images(psi_id):
    with open(os.path.join(RAW_DIR, psi_id + ".json"), encoding="utf-8") as fh:
        version = json.load(fh)["file_listing"]["version"]
    listing = post_json(PSI_BASE + "/files/v2", {
        "folder": "", "fileType": "study", "studyId": psi_id,
        "version": str(version), "obfuscationcode": ""})
    flat = []
    walk(listing.get("files") or [], flat)
    return [f for f in flat if f.get("sortingCategory") == CATEGORY]


def presigned(psi_id, file_id):
    url = "%s/studies/%s/download?file=%s&redirect=false" % (PSI_BASE, psi_id, file_id)
    return get_bytes(url).decode("utf-8").strip().strip('"')


def short_name(key):
    base = os.path.basename(key)
    prefix = "%s_%s_" % (key.split("/")[1], CATEGORY)
    return base[len(prefix):] if base.startswith(prefix) else base


def to_web_jpeg(raw):
    img = Image.open(io.BytesIO(raw))
    img.load()
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")
    if img.width > MAX_WIDTH:
        height = round(img.height * MAX_WIDTH / img.width)
        img = img.resize((MAX_WIDTH, height), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88, optimize=True)
    return buf.getvalue(), img.width, img.height


def stem_slug(name):
    stem = os.path.splitext(name)[0]
    keep = [c if c.isalnum() else "_" for c in stem]
    slug = "".join(keep)
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug.strip("_").lower()


def main():
    with open(META, encoding="utf-8") as fh:
        meta = {r["psi_id"]: r for r in json.load(fh)}
    records = []
    for psi_id in TARGETS:
        license_rec = meta[psi_id].get("license") or {}
        license_text = license_rec.get("id") or "not stated on the PSI investigation record"
        target_dir = os.path.join(OUT_DIR, psi_id)
        os.makedirs(target_dir, exist_ok=True)
        for f in list_images(psi_id):
            original = short_name(f["key"])
            if any(k in original.lower() for k in SKIP_KEYWORDS):
                continue
            raw = get_bytes(presigned(psi_id, f["id"]))
            data, width, height = to_web_jpeg(raw)
            out_name = stem_slug(original) + ".jpg"
            with open(os.path.join(target_dir, out_name), "wb") as fh:
                fh.write(data)
            records.append({
                "psi_id": psi_id,
                "file": "data/images/%s/%s" % (psi_id, out_name),
                "original_name": original,
                "psi_path": f["key"],
                "width": width,
                "height": height,
                "bytes": len(data),
                "credit": "NASA / PSI %s" % psi_id,
                "license": license_text,
            })
            time.sleep(0.5)
    with open(os.path.join(OUT_DIR, "images.json"), "w", encoding="ascii", newline="\n") as fh:
        json.dump(records, fh, indent=1, ensure_ascii=True)
        fh.write("\n")
    print("images written: %d" % len(records))


if __name__ == "__main__":
    main()
