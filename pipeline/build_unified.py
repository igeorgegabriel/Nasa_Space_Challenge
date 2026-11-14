import csv
import glob
import io
import json
import os
import re
import unicodedata
from collections import Counter, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "data", "psi_experimental_tables")
INVENTORY = os.path.join(ROOT, "data", "psi_combustion_inventory.json")
OUT_DIR = os.path.join(ROOT, "data", "unified")

COLUMNS = [
    "row_id", "psi_id", "investigation", "source_file", "source_row",
    "fuel_class", "fuel", "sample_geometry", "o2_frac", "o2_min_frac",
    "o2_raw", "o2_basis", "diluent", "pressure_atm", "flow_cm_s",
    "flow_direction", "ignition", "outcome", "burn_time_s",
    "extinction_diameter_mm", "measurement_notes", "value_quality", "notes",
]

FUEL_CLASS = {
    "PSI-26": "solid", "PSI-25": "solid", "PSI-98": "solid",
    "PSI-99": "solid", "PSI-100": "solid",
    "PSI-69": "liquid_droplet", "PSI-68": "liquid_droplet",
    "PSI-39": "liquid_droplet",
    "PSI-20": "gas", "PSI-21": "gas", "PSI-22": "gas", "PSI-23": "gas",
    "PSI-10": "gas", "PSI-159": "gas", "PSI-107": "gas", "PSI-106": "gas",
    "PSI-102": "smoke_sample", "PSI-101": "smoke_sample",
    "PSI-47": "aerosol_dust",
    "PSI-142": "",
}

NUMBER = re.compile(r"\d+\.\d+|\.\d+|\d+")


def decode(raw_bytes):
    try:
        return raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw_bytes.decode("cp1252")


def to_ascii(text):
    text = text.replace("\u00b5", "u").replace("\u03bc", "u")
    text = text.replace("\u00bc", "1/4").replace("\u00bd", "1/2").replace("\u00be", "3/4")
    text = text.replace("\u00b0", " deg")
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = unicodedata.normalize("NFKD", text)
    return text.encode("ascii", "ignore").decode("ascii")


def clean(cell):
    cell = to_ascii(cell if cell is not None else "")
    cell = re.sub(r"\s+", " ", cell).strip()
    if cell in ("-", ""):
        return ""
    return cell


def read_table(path):
    with open(path, "rb") as handle:
        text = decode(handle.read())
    parsed = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    headers = [clean(h) for h in parsed[0]]
    rows = []
    for r in parsed[1:]:
        r = list(r) + [""] * (len(headers) - len(r))
        rows.append(OrderedDict((h, clean(c)) for h, c in zip(headers, r)))
    return rows


def num(text):
    found = NUMBER.search(text or "")
    return float(found.group()) if found else None


def tidy(value):
    if isinstance(value, float):
        value = round(value, 6)
        if value == int(value):
            return int(value)
    return value


def num_or_blank(text):
    if not text:
        return ""
    value = num(text)
    return "" if value is None else tidy(value)


def kv(*pairs):
    parts = []
    for key, value in pairs:
        if value is None or value == "":
            continue
        parts.append("%s=%s" % (key, str(value).replace(";", ",")))
    return "; ".join(parts)


def pick(row, *items):
    return kv(*[(label, row.get(header, "")) for label, header in items])


def with_unit(value, unit):
    return "%s %s" % (value, unit) if value else ""


def geometry(*pairs):
    return "; ".join("%s %s" % (k, v) for k, v in pairs if v)


def merge_notes(*parts):
    return "; ".join(p for p in parts if p)


def o2_fields(raw, percent, basis):
    raw = (raw or "").strip()
    if not raw:
        return {}
    flags = []
    if "%" in raw:
        values = []
        for v in re.findall(r"(\d+(?:\.\d+)?)\s*%", raw):
            v = float(v)
            if v > 100:
                v = v / 100.0
                flags.append("o2 source value %s read as 100x percent-format artifact" % raw)
            values.append(v)
        percent = True
    else:
        values = [float(v) for v in NUMBER.findall(raw)]
    if not values:
        return {}
    scale = 0.01 if percent else 1.0
    fracs = [round(v * scale, 6) for v in values]
    if max(fracs) > 1.0:
        return {}
    if len(fracs) > 1:
        quality = "range"
    elif "~" in raw or flags:
        quality = "approximate"
    else:
        quality = "exact"
    result = {
        "o2_frac": tidy(max(fracs)),
        "o2_min_frac": tidy(min(fracs)),
        "o2_raw": raw,
        "o2_basis": basis,
        "value_quality": quality,
    }
    if flags:
        result["notes"] = "; ".join(flags)
    return result


def as_summary_if_range(o2):
    if o2.get("value_quality") == "range":
        o2["value_quality"] = "summary_row"
    return o2


def flow_direction(text):
    text = (text or "").strip().lower()
    return text if text in ("concurrent", "opposed") else ""


def yes_no(text):
    text = (text or "").strip().lower()
    if text in ("yes", "flash"):
        return "yes"
    if text == "no":
        return "no"
    return ""


def ignition_from_count(text):
    value = num(text)
    if value is None:
        return ""
    return "yes" if value > 0 else "no"


def mixture(pairs):
    parts = []
    for name, value in pairs:
        n = num(value)
        if n:
            parts.append("%s %s" % (name, value))
    return "; ".join(parts)


def parse_bass(rows):
    out = []
    for r in rows:
        material = r["Fuel Sample Material"]
        tokens = re.findall(r"\d+(?:\.\d+)?\s*cm|sphere|slab|candle|sheet", material, re.I)
        out.append({
            "fuel": material,
            "sample_geometry": " ".join(tokens),
            "notes": pick(r, ("date", "Date"), ("gmt_day", "GMT"),
                          ("as_run_test", "As Run Test #"), ("test", "Test #"),
                          ("sample", "Sample #")),
        })
    return out


def parse_bass2(rows):
    out = []
    for r in rows:
        material = r["Fuel Sample Material"]
        tokens = re.findall(r"\d+(?:\.\d+)?\s*(?:micron|mm|cm)", material, re.I)
        kw = {
            "fuel": material,
            "sample_geometry": "; ".join(tokens),
            "measurement_notes": pick(
                r, ("o2_final_pct", "Calibrated final O2 % by vol"),
                ("co2_initial_pct", "Initial CO2 % by vol"),
                ("co2_final_pct", "Final CO2 % by vol"),
                ("co_initial_ppm", "Initial CO (ppm)"),
                ("co_final_ppm", "Final CO (ppm)"),
                ("flow_restrictor", "Flow restrictor"),
                ("fan_display", "Fan display"), ("air_display", "Air display"),
                ("radiometer_gain", "Radiometer gain (1000 250 50 10)"),
                ("total_frames", "Total Frames Shot")),
            "notes": pick(r, ("pi", "PI"), ("test", "Test #"), ("date", "Date"),
                          ("gmt_day", "GMT"), ("sample", "Sample #")),
        }
        kw.update(o2_fields(r["Calibrated initial O2 % by vol"], True, "ambient"))
        out.append(kw)
    return out


def parse_saffire1(rows):
    out = []
    for r in rows:
        if r["Material"].lower().startswith("pre-test"):
            out.append({"value_quality": "summary_row",
                        "notes": kv(("sample", r["Sample Number"]), ("description", r["Material"]))})
            continue
        burn = num(r["Burn Time (s)"])
        kw = {
            "fuel": r["Material"],
            "sample_geometry": geometry(
                ("thickness", with_unit(r["Sample Thickness (cm)"], "cm")),
                ("length", with_unit(r["Sample Length (cm)"], "cm")),
                ("width", with_unit(r["Sample Width (cm)"], "cm"))),
            "flow_cm_s": num_or_blank(r["Air Flow (cm/s)"]),
            "flow_direction": flow_direction(r["Flow Direction"]),
            "ignition": "yes" if burn else "",
            "burn_time_s": tidy(burn) if burn is not None else "",
            "measurement_notes": pick(r, ("ignition_power_w", "Ignition Power (W)"),
                                      ("ignition_time_s", "Ignition Time (s)")),
            "notes": pick(r, ("sample", "Sample Number"), ("camera1", "Camera 1"),
                          ("camera2", "Camera 2")),
        }
        kw.update(o2_fields(r["Percent O2"], True, "ambient"))
        out.append(kw)
    return out


def parse_saffire2(rows):
    out = []
    for r in rows:
        first = r["Sample Number"]
        if first.startswith("Note "):
            out.append({"value_quality": "summary_row", "notes": first})
            continue
        if r["Material"].lower().startswith("pre-test"):
            out.append({"value_quality": "summary_row",
                        "notes": kv(("sample", first), ("description", r["Material"]))})
            continue
        burn_text = r["Burn Time (s)"]
        burn = num(burn_text) if re.search(r"\d", burn_text) else None
        kw = {
            "fuel": r["Material"],
            "sample_geometry": geometry(("thickness", r["Samle Thickness"]),
                                        ("length", r["Sample Length"]),
                                        ("width", r["Sample Width (cm)"])),
            "flow_cm_s": num_or_blank(r["Air Flow (cm/s)"]),
            "flow_direction": flow_direction(r["Flow Direction"]),
            "ignition": "yes" if burn else "",
            "outcome": "insignificant burn" if burn_text.lower() == "insignificant" else "",
            "burn_time_s": tidy(burn) if burn is not None else "",
            "measurement_notes": kv(
                ("ignition_power", r["Ignition Power (W)"]),
                ("ignition_time", r["Ignition Time (s)"]),
                ("burn_time_text", burn_text if burn is None else ""),
                ("ug_burn_length", r["?-g Burn Length"]),
                ("ug_spread_length", r["?-g Spread Length"]),
                ("1g_burn_length", r["1-g Burn Length"]),
                ("1g_spread_rate", r["1-g Spread Rate"])),
            "notes": pick(r, ("sample", "Sample Number"), ("camera1", "Camera 1"),
                          ("camera2", "Camera 2")),
        }
        kw.update(o2_fields(r["Percent O2 (Note 1)"], True, "ambient"))
        out.append(kw)
    return out


def parse_saffire3(rows):
    out = []
    for r in rows:
        out.append({
            "fuel": r["Material"],
            "sample_geometry": geometry(("thickness", r["Sample Thickness"]),
                                        ("length", r["Sample Length"]),
                                        ("width", r["Sample Width"])),
            "flow_cm_s": num_or_blank(r["Air Flow"]),
            "flow_direction": flow_direction(r["Direction"]),
            "notes": pick(r, ("sample", "Sample Number"), ("camera1", "Camera 1"),
                          ("camera2", "Camera 2")),
        })
    return out


def parse_flex(rows):
    out = []
    for r in rows:
        diameter = r["Droplet initial diameter; mm"]
        kw = {
            "fuel": r["Fuel"],
            "sample_geometry": geometry(("droplet initial diameter", with_unit(diameter, "mm"))),
            "diluent": mixture([("N2", r["N initial ambient composition; mole fraction"]),
                                ("CO2", r["CO initial ambient composition; mole fraction"]),
                                ("He", r["He initial ambient composition; mole fraction"])]),
            "outcome": r["Test end"].lower(),
            "burn_time_s": num_or_blank(r["Burn time; s"]),
            "extinction_diameter_mm": num_or_blank(r["Visible flame extinction diameter; mm"]),
            "measurement_notes": pick(r, ("burning_rate_mm", "Burning rate; mm")),
            "notes": pick(r, ("test", "FLEX Test #"), ("identifier", "FLEX Identifier"),
                          ("date", "Test Date"), ("gmt", "Test GMT")),
        }
        pressure = num(r["Ambient pressure; mmHg"])
        if pressure is not None:
            kw["pressure_atm"] = tidy(pressure / 760.0)
        kw.update(o2_fields(r["O initial ambient composition; mole fraction"], False, "ambient"))
        out.append(kw)
    return out


def parse_flex2(rows):
    out = []
    for r in rows:
        kw = {
            "fuel": r["Sample (Fuel Type)"],
            "sample_geometry": geometry(
                ("initial droplet diameter", with_unit(r["Initial Droplet Diameter (mm)"], "mm"))),
            "diluent": r["Ambient Gas Mixture"],
            "measurement_notes": kv(("pressure_atm_tested", r["Ambient Pressure (atm)"]),
                                    ("ambient_temperature_c", r["Ambient Temperature (C)"]),
                                    ("flow_velocity_cm_s_range", r["Flow Velocity (cm/s)"])),
        }
        kw.update(o2_fields(r["Oxygen Mole Fraction"], False, "ambient"))
        kw["value_quality"] = "summary_row"
        out.append(kw)
    return out


def parse_cfi(rows):
    out = []
    for r in rows:
        kw = {
            "fuel": r["Fuel"],
            "sample_geometry": kv(("fiber", r["Fiber"])),
            "diluent": mixture([("N2", r["Nitrogen"]), ("He", r["Helium"])]),
            "pressure_atm": num_or_blank(r["Pressure"]),
            "notes": pick(r, ("flex_number", "Flex Number"), ("date", "Test Date"),
                          ("local_time", "Local Time"), ("cir", "CIR")),
        }
        kw.update(o2_fields(r["Oxygen"], False, "ambient"))
        out.append(kw)
    return out


def parse_bre(rows):
    out = []
    for r in rows:
        kw = {
            "fuel": r["Fuel Bottle"],
            "sample_geometry": geometry(("burner", with_unit(r["Burner Size (mm)"], "mm"))),
            "diluent": "N2",
            "ignition": ignition_from_count(r["Flames Ignited"]),
            "measurement_notes": pick(r, ("flames_ignited", "Flames Ignited")),
        }
        o2 = as_summary_if_range(o2_fields(r["Oxygen Conc (percent)"], True, "ambient"))
        extra = o2.pop("notes", "")
        kw.update(o2)
        kw["notes"] = merge_notes(kv(("date", "%s %s %s" % (r["Year"], r["Month"], r["Date"]))),
                                  extra, r["Notes"])
        out.append(kw)
    return out


def parse_cld(rows):
    out = []
    for r in rows:
        bottle = re.sub(r"\bCH[5-9]\b", "CH4", r["Fuel Bottle"])
        flag = ""
        if bottle != r["Fuel Bottle"]:
            flag = "fuel bottle label %s read as CH4 (series label)" % r["Fuel Bottle"]
        out.append({
            "fuel": bottle,
            "diluent": "N2",
            "ignition": ignition_from_count(r["Flames ignited"]),
            "measurement_notes": pick(r, ("fuel_conc_range", "Fuel conc. Range"),
                                      ("fuel_mfc_slpm", "Fuel MFC"), ("n2_mfc_slpm", "N2 MFC"),
                                      ("flames_ignited", "Flames ignited")),
            "notes": merge_notes(pick(r, ("test_type", "Test Type"), ("test_day", "Test Day")),
                                 flag, r["Notes"]),
        })
    return out


def parse_efield(rows):
    out = []
    last = {}
    for index, r in enumerate(rows, 1):
        if r["Test Day"]:
            last = {"index": index, "fuel": r["Fuel Bottle"], "type": r["Test Type"],
                    "day": r["Test Day"], "polarity": r["Mesh Polarity"],
                    "date": "%s-%s-%s" % (r["Year"], r["Month"], r["Date"])}
            out.append({
                "fuel": r["Fuel Bottle"],
                "diluent": "N2",
                "ignition": ignition_from_count(r["Flames Ignited"]),
                "measurement_notes": pick(r, ("fuel_conc", "Fuel Conc"),
                                          ("mesh_polarity", "Mesh Polarity"),
                                          ("flames_ignited", "Flames Ignited")),
                "notes": merge_notes(kv(("test_type", r["Test Type"]), ("test_day", r["Test Day"]),
                                        ("date", last["date"])), r["Notes"]),
            })
        else:
            out.append({
                "fuel": last.get("fuel", ""),
                "diluent": "N2",
                "measurement_notes": kv(("fuel_conc", r["Fuel Conc"]),
                                        ("mesh_polarity", last.get("polarity", ""))),
                "value_quality": "summary_row",
                "notes": merge_notes(
                    kv(("test_type", last.get("type", "")), ("test_day", last.get("day", "")),
                       ("date", last.get("date", ""))),
                    "continuation row, conditions inherited from data row %s" % last.get("index", ""),
                    r["Notes"]),
            })
    return out


def parse_sflame(rows):
    out = []
    for r in rows:
        atmosphere = r["Atmosphere*"]
        diluent_match = re.search(r"with (N\d|He)", atmosphere)
        diluent = ""
        flags = []
        if diluent_match:
            diluent = diluent_match.group(1)
            if re.fullmatch(r"N[3-9]", diluent):
                flags.append("atmosphere label %s read as N2 (series label)" % diluent)
                diluent = "N2"
        bottle = re.sub(r"with N[3-9]", "with N2", r["Fuel Bottle"])
        if bottle != r["Fuel Bottle"]:
            flags.append("fuel bottle label %s read as N2 variant (series label)" % r["Fuel Bottle"])
        kw = {
            "fuel": bottle,
            "diluent": diluent,
            "pressure_atm": 1,
            "ignition": ignition_from_count(r["Flames Ignited*"]),
            "measurement_notes": kv(("flames_ignited", r["Flames Ignited*"]),
                                    ("pressure", "approx 1 atm per table note")),
        }
        kw.update(as_summary_if_range(o2_fields(atmosphere, True, "ambient")))
        kw["notes"] = merge_notes(
            kv(("test_type", r["Test Type"]), ("test_day", r["Test Day*"]),
               ("date", "%s %s %s" % (r["Year"], r["Month"], r["Date"]))),
            "; ".join(flags), r["Notes"])
        out.append(kw)
    return out


def parse_flame_normal(rows):
    out = []
    for r in rows:
        ramped = any(v == "RAMPED" for v in r.values())
        mn2 = num(r["mN2 (mg/s)"]) if r["mN2 (mg/s)"] != "RAMPED" else None
        kw = {
            "fuel": r["Fuel"],
            "diluent": "N2" if mn2 else "",
            "pressure_atm": num_or_blank(r["pinit (atm)"]),
            "measurement_notes": pick(
                r, ("xfuel", "Xfuel"), ("mfuel_mg_s", "mfuel (mg/s)"), ("mn2_mg_s", "mN2 (mg/s)"),
                ("mtot_mg_s", "mtot (mg/s)"), ("xo2_final", "XO2 (final)"),
                ("pfinal_atm", "pfinal (atm)"), ("pmean_atm", "pmean (atm)"),
                ("mean_zst", "mean Zst"), ("tad_k", "Tad (K)")),
            "notes": pick(r, ("flame_type", "Flame Type"), ("day", "Day"), ("test", "Test")),
        }
        kw.update(o2_fields(r["XO2 (init)"], False, "ambient"))
        if ramped:
            kw["value_quality"] = "ramped"
        out.append(kw)
    return out


def parse_flame_inverse(rows):
    out = []
    for r in rows:
        ramped = any(v == "RAMPED" for v in r.values())
        mn2 = num(r["mN2 (mg/s)"]) if r["mN2 (mg/s)"] != "RAMPED" else None
        kw = {
            "fuel": "C2H4",
            "diluent": "N2" if mn2 else "",
            "pressure_atm": num_or_blank(r["pinit (atm)"]),
            "measurement_notes": pick(
                r, ("mo2_mg_s", "mO2 (mg/s)"), ("mn2_mg_s", "mN2 (mg/s)"),
                ("mtot_mg_s", "mtot (mg/s)"), ("xc2h4_initial", "XC2H4 initial"),
                ("xc2h4_final", "XC2H4 final"), ("pfinal_atm", "pfinal (atm)"),
                ("pmean_atm", "pmean (atm)"), ("mean_zst", "mean Zst"), ("tad_k", "Tad (K)")),
            "notes": pick(r, ("flame_type", "Flame Type"), ("day", "Day"), ("test", "Test")),
        }
        kw.update(o2_fields(r["XO2"], False, "oxidizer_stream"))
        if ramped:
            kw["value_quality"] = "ramped"
        out.append(kw)
    return out


def cfig_outcome(se_ft, comment):
    se_ft = se_ft.strip().upper()
    if se_ft == "SE":
        return "self-extinguished"
    if se_ft == "FT":
        return "flow-terminated"
    low = comment.lower()
    if "failed to ignite" in low or "not ignited" in low or "no ignition" in low:
        return "failed to ignite"
    if "aborted" in low:
        return "aborted"
    return ""


def bar_to_atm(text):
    value = num(text)
    return tidy(value / 1.01325) if value is not None else ""


def parse_cfig_normal(rows):
    out = []
    for r in rows:
        kw = {
            "fuel": r["Fuel"],
            "pressure_atm": bar_to_atm(r["approx p (bar)"]),
            "ignition": yes_no(r["Hot ignition"]),
            "outcome": cfig_outcome(r["Self-ext or flow term"], r["Comments"]),
            "burn_time_s": num_or_blank(r["burn time (sec)"]),
            "measurement_notes": pick(
                r, ("xo2_after_test", "XO2 after test"), ("xf", "Xf"), ("mhc_mg_s", "mHC (mg/s)"),
                ("tfp", "TFP"), ("tad_k", "Tad (K)"), ("zst", "Zst"),
                ("peak_burner_t_c", "Peak burner T (C )")),
            "notes": pick(r, ("flame_type", "Flame Type"), ("day", "Day"), ("test", "Test"),
                          ("cool_flame", "Cool flame?"), ("hot_ignition", "Hot ignition"),
                          ("comments", "Comments")),
        }
        kw.update(o2_fields(r["XO2 before test"], False, "ambient"))
        out.append(kw)
    return out


def parse_cfig_inverse(rows):
    out = []
    for r in rows:
        kw = {
            "fuel": r["Fuel"],
            "pressure_atm": bar_to_atm(r["approx p (bar)"]),
            "ignition": yes_no(r["Hot ignition"]),
            "outcome": cfig_outcome(r["Self -ext or flow term"], r["Comments"]),
            "burn_time_s": num_or_blank(r["burn time (sec)"]),
            "measurement_notes": pick(
                r, ("xf_before_test", "Xf before test"), ("xf_after_test", "Xf after test"),
                ("hc_burnrate_mg_s", "HC burnrate (mg/s)"),
                ("o2_flow_rate_mg_s", "O2 flow rate (mg/s)"),
                ("tfp", "TFP"), ("tad_k", "Tad (K)"), ("zst", "Zst"),
                ("peak_burner_t_c", "Peak burner Temp (C)"), ("color", "Color")),
            "notes": pick(r, ("flame_type", "Flame Type"), ("day", "Day"), ("test", "Test"),
                          ("hot_ignition", "Hot ignition"), ("comments", "Comments")),
        }
        kw.update(o2_fields(r["XO2"], False, "oxidizer_stream"))
        out.append(kw)
    return out


def parse_spice(rows):
    out = []
    for r in rows:
        fuel = re.sub(r"\s*%\s*", "% ", r["Fuel"]).strip()
        out.append({
            "fuel": fuel,
            "sample_geometry": geometry(("nozzle", with_unit(r["Nozzle (mm)"], "mm"))),
            "flow_cm_s": num_or_blank(r["Air Rate (cm/s)"]),
            "ignition": "yes" if r["GMT ignition"] else "",
            "measurement_notes": pick(r, ("fuel_rate_sccm", "Fuel Rate (sccm)"),
                                      ("fuel_rate_mg_s", "Fuel Rate (mg/s)"),
                                      ("hc_fuel_rate_mg_s", "HC Fuel Rate (mg/s)")),
            "notes": pick(r, ("gmt_day", "GMT date"), ("gmt_ignition", "GMT ignition"),
                          ("gmt_flame_off", "GMT Flame Off")),
        })
    return out


def parse_slice(rows):
    out = []
    for r in rows:
        text = r["Fuel Type"]
        match = re.match(r"\s*(\d+%\s*[A-Za-z0-9]+)", text)
        out.append({
            "fuel": match.group(1) if match else text,
            "diluent": "N2" if "balance N2" in text else "",
            "notes": kv(("test_date", r["Test Date"]), ("fuel_type_text", text)),
        })
    return out


def parse_same(rows):
    out = []
    for r in rows:
        material = r["Sample Material"]
        same = "same conditions as 1-4" in material
        kw = {
            "fuel": material.split(":")[0].strip(),
            "flow_cm_s": num_or_blank(r["Air Flow (cm/s)"]),
            "measurement_notes": pick(r, ("weight_loss_rate_mg_min", "Weight loss rate (mg/min)"),
                                      ("aging_duration_min", "Aging Duration (minutes)")),
            "notes": merge_notes(kv(("sample", r["Sample #"])),
                                 "same conditions as samples 1-4" if same else ""),
        }
        if same:
            kw["value_quality"] = "summary_row"
        out.append(kw)
    return out


def parse_same_r(rows):
    out = []
    for r in rows:
        out.append({
            "fuel": r["Sample Type"],
            "flow_cm_s": num_or_blank(r["Inlet velocity (cm/s)"]),
            "measurement_notes": pick(r, ("rt_r0", "Rt/R0"), ("duration_s", "Duration (sec)"),
                                      ("primary_aging_time_s", "Primary aging time (sec)"),
                                      ("primary_mixing_time_s", "Primary mixing time (sec)"),
                                      ("net_aging_time_s", "Net aging time (sec)")),
            "notes": pick(r, ("test", "SAME Test #"), ("description", "Description"),
                          ("date", "Date")),
        })
    return out


def parse_daft(rows):
    out = []
    for r in rows:
        out.append({
            "fuel": r["Sample Material"],
            "measurement_notes": pick(r, ("hardware", "Hardware Description"),
                                      ("sampled_location", "Sampled Location")),
            "notes": pick(r, ("session", "Session Name"), ("actual_day", "Actual Day")),
        })
    return out


def parse_summary(rows):
    out = []
    for r in rows:
        out.append({
            "value_quality": "summary_row",
            "notes": pick(r, ("data_id", "Data ID"), ("description", "Data Description"),
                          ("reference", "Reference Publication Link"),
                          ("figure", "Figure ID in Reference")),
        })
    return out


PARSERS = {
    "PSI-26": parse_bass, "PSI-25": parse_bass2, "PSI-98": parse_saffire1,
    "PSI-99": parse_saffire2, "PSI-100": parse_saffire3, "PSI-69": parse_flex,
    "PSI-68": parse_flex2, "PSI-39": parse_cfi, "PSI-20": parse_bre,
    "PSI-21": parse_cld, "PSI-22": parse_efield, "PSI-23": parse_sflame,
    "PSI-107": parse_spice, "PSI-106": parse_slice, "PSI-102": parse_same,
    "PSI-101": parse_same_r, "PSI-47": parse_daft, "PSI-142": parse_summary,
}


def select_parser(psi_id, name):
    inverse = "inverse" in name.lower()
    if psi_id == "PSI-10":
        return parse_flame_inverse if inverse else parse_flame_normal
    if psi_id == "PSI-159":
        return parse_cfig_inverse if inverse else parse_cfig_normal
    return PARSERS[psi_id]


def psi_sort_key(path):
    name = os.path.basename(path)
    return (int(re.match(r"PSI-(\d+)_", name).group(1)), name)


def investigation_label(inventory, psi_id):
    entry = inventory.get(psi_id, {})
    return to_ascii(entry.get("acr") or entry.get("title") or psi_id)


def build_rows():
    with open(INVENTORY, "r", encoding="utf-8") as handle:
        inventory = json.load(handle)
    rows = []
    files_by_psi = OrderedDict()
    paths = sorted(glob.glob(os.path.join(SRC_DIR, "PSI-*_Experimental table_*.csv")), key=psi_sort_key)
    for path in paths:
        name = os.path.basename(path)
        psi_id = re.match(r"(PSI-\d+)_", name).group(1)
        parsed = select_parser(psi_id, name)(read_table(path))
        files_by_psi.setdefault(psi_id, []).append(name)
        label = investigation_label(inventory, psi_id)
        for index, kw in enumerate(parsed, 1):
            row = {c: "" for c in COLUMNS}
            row.update({
                "psi_id": psi_id, "investigation": label, "source_file": name,
                "source_row": index, "fuel_class": FUEL_CLASS[psi_id],
                "o2_basis": "none", "value_quality": "exact",
            })
            row.update(kw)
            rows.append(row)
    for number, row in enumerate(rows, 1):
        row["row_id"] = "U%05d" % number
    return rows, inventory, files_by_psi


def json_row(row):
    return OrderedDict((c, None if row[c] == "" else row[c]) for c in COLUMNS)


def build_investigations(rows, inventory, files_by_psi):
    result = OrderedDict()
    fields = [c for c in COLUMNS if c != "row_id"]
    for psi_id in files_by_psi:
        group = [r for r in rows if r["psi_id"] == psi_id]
        entry = inventory.get(psi_id, {})
        hardware = entry.get("hw", {}) or {}
        result[psi_id] = OrderedDict([
            ("psi_id", psi_id),
            ("investigation", investigation_label(inventory, psi_id)),
            ("title", to_ascii(entry.get("title", ""))),
            ("fuel_class", FUEL_CLASS[psi_id]),
            ("hardware", to_ascii(hardware.get("Name", "")) or None),
            ("hardware_link", to_ascii(hardware.get("Link", "")) or None),
            ("row_count", len(group)),
            ("coverage", OrderedDict((f, sum(1 for r in group if r[f] != "")) for f in fields)),
            ("source_files", files_by_psi[psi_id]),
        ])
    return result


def o2_stats(group):
    known = [r["o2_frac"] for r in group if r["o2_frac"] != ""]
    bins = OrderedDict([("lt_0.21", 0), ("0.21_to_lt_0.25", 0),
                        ("0.25_to_lt_0.30", 0), ("ge_0.30", 0)])
    for v in known:
        if v < 0.21:
            bins["lt_0.21"] += 1
        elif v < 0.25:
            bins["0.21_to_lt_0.25"] += 1
        elif v < 0.30:
            bins["0.25_to_lt_0.30"] += 1
        else:
            bins["ge_0.30"] += 1
    return OrderedDict([
        ("rows", len(group)),
        ("o2_known", len(known)),
        ("o2_min", min(known) if known else None),
        ("o2_max", max(known) if known else None),
        ("bins", bins),
    ])


def count_by(rows, key):
    return OrderedDict(sorted(Counter(r[key] or "unclassified" for r in rows).items()))


def cross_count(rows, key_a, key_b):
    cross = OrderedDict()
    for r in rows:
        cross.setdefault(r[key_a] or "unclassified", Counter())[r[key_b]] += 1
    return OrderedDict((k, dict(v)) for k, v in sorted(cross.items()))


def build_summary(rows, inventory):
    classes = sorted({r["fuel_class"] or "unclassified" for r in rows})
    ge = [r for r in rows if r["o2_frac"] != "" and r["o2_frac"] >= 0.30]
    psi_ids = sorted({r["psi_id"] for r in rows}, key=lambda s: int(s[4:]))
    return OrderedDict([
        ("total_rows", len(rows)),
        ("counts_by_investigation", count_by(rows, "psi_id")),
        ("investigation_names", OrderedDict((p, investigation_label(inventory, p)) for p in psi_ids)),
        ("counts_by_fuel_class", count_by(rows, "fuel_class")),
        ("o2_overall", o2_stats(rows)),
        ("o2_by_fuel_class", OrderedDict(
            (c, o2_stats([r for r in rows if (r["fuel_class"] or "unclassified") == c]))
            for c in classes)),
        ("rows_with_o2_and_outcome",
         sum(1 for r in rows if r["o2_frac"] != "" and r["outcome"] != "")),
        ("o2_ge_030", OrderedDict([
            ("total", len(ge)),
            ("by_fuel_class", count_by(ge, "fuel_class")),
            ("by_investigation", count_by(ge, "psi_id")),
            ("by_o2_basis", count_by(ge, "o2_basis")),
            ("by_value_quality", count_by(ge, "value_quality")),
            ("by_fuel_class_and_o2_basis", cross_count(ge, "fuel_class", "o2_basis")),
            ("by_investigation_and_o2_basis", cross_count(ge, "psi_id", "o2_basis")),
        ])),
    ])


def write_json(path, payload):
    with open(path, "w", encoding="ascii", newline="\n") as handle:
        json.dump(payload, handle, indent=1, ensure_ascii=True)
        handle.write("\n")


def main():
    rows, inventory, files_by_psi = build_rows()
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "conditions.csv"), "w", encoding="ascii", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(COLUMNS)
        for row in rows:
            writer.writerow([str(row[c]) for c in COLUMNS])
    write_json(os.path.join(OUT_DIR, "conditions.json"), [json_row(r) for r in rows])
    write_json(os.path.join(OUT_DIR, "investigations.json"),
               build_investigations(rows, inventory, files_by_psi))
    write_json(os.path.join(OUT_DIR, "summary.json"), build_summary(rows, inventory))
    print("rows written: %d" % len(rows))


if __name__ == "__main__":
    main()
