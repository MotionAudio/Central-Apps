#!/usr/bin/env python3
"""Central Control - builds the fixture library the lights page searches when you add a real light (10.2).

    python3 tools/make-fixture-library.py --ofl DIR --qlc DIR --out library.json.gz
        [--js central-usage/app/fixtures/fixture-library.js] [--ofl-commit SHA] [--qlc-commit SHA]
--out is the file the libraries release publishes (the apps' "Update the fixture library" downloads it); --js is the
copy that ships inside Central Control and Central Usage.

Reads two public libraries and turns every fixture's modes into the channel jobs the lighting engine drives:
  --ofl  a checkout of github.com/OpenLightingProject/open-fixture-library (MIT licence) - its fixtures/ folder
  --qlc  a checkout of github.com/mcallegari/qlcplus (Apache 2.0 licence) - its resources/fixtures/ folder
A fixture that is in both comes from the Open Fixture Library (it describes the channels in more detail).

What one fixture turns into (short keys, the file has thousands of them):
  {"m": maker index, "n": model, "t": type ("Moving Head", "Color Changer"…), "s": "o" (Open Fixture Library) | "q" (QLC+),
   "b": [beam min, max] degrees, "w": watts, "p": pan degrees, "i": tilt degrees,
   "md": [{"n": mode name, "c": "dim r g b strobe …" (one job per channel), "v": {"<channel index>": values}}]}
The jobs: dim dimf r g b w a uv c m y ctemp strobe pan panf tilt tiltf speed wheel gobo goborot prism prismrot
focus zoom iris frost haze fan zero (zero = a channel the lights page leaves at its resting value).
The values a channel needs to behave (only where it matters):
  "o" open (shutter open, gobo open, iris open, prism out, frost off), "x" closed (shutter closed),
  "s" [slowest, fastest] strobe, "sl" [[dmx, "#rrggbb"], …] colour wheel slots, "d" the resting value."""
import argparse
import datetime
import gzip
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

JOBS = "dim dimf r g b w a uv c m y ctemp strobe pan panf tilt tiltf speed wheel gobo goborot prism prismrot focus zoom iris frost haze fan zero".split()


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def deg(v):
    m = re.match(r"^\s*(-?[\d.]+)\s*deg", str(v or ""))
    return float(m.group(1)) if m else None


def mid(lo, hi):
    return int(round((lo + hi) / 2))


# ---------------------------------------------------------------- Open Fixture Library
def ofl_job(name, ch, has_rgb):
    caps = ch.get("capabilities") or ([ch["capability"]] if ch.get("capability") else [])
    types = [str(c.get("type", "")) for c in caps]
    t0 = types[0] if types else ""
    n = name.lower()
    if t0 == "ColorIntensity":
        col = str(caps[0].get("color", "")).lower()
        return {"red": "r", "green": "g", "blue": "b", "white": "w", "warm white": "w", "cold white": "w", "amber": "a", "uv": "uv",
                "cyan": "c", "magenta": "m", "yellow": "y"}.get(col, "zero")
    if t0 == "Intensity":
        return "dim"
    if "ShutterStrobe" in types or t0 == "StrobeSpeed":
        return "strobe"
    if t0 in ("Pan", "PanContinuous"):
        return "pan"
    if t0 in ("Tilt", "TiltContinuous"):
        return "tilt"
    if t0 in ("PanTiltSpeed", "PanTiltDuration"):
        return "speed"
    if any(t in ("WheelSlot", "WheelShake", "WheelSlotRotation") for t in types) or t0 == "WheelRotation":
        wheel = (caps[0].get("wheel") or name)
        if re.search(r"gobo", f"{wheel} {name}", re.I):
            return "goborot" if t0 in ("WheelSlotRotation", "WheelRotation") and "rot" in n else "gobo"
        if re.search(r"prism", f"{wheel} {name}", re.I):
            return "prism"
        return "wheel"
    if t0 == "ColorPreset":
        return "zero" if has_rgb else "wheel"
    if t0 == "ColorTemperature":
        return "ctemp"
    if t0 in ("Prism",):
        return "prism"
    if t0 == "PrismRotation":
        return "prismrot"
    if t0 == "Focus":
        return "focus"
    if t0 == "Zoom":
        return "zoom"
    if t0 == "Iris":
        return "iris"
    if t0 == "Frost":
        return "frost"
    if t0 in ("Fog", "FogOutput", "FogType"):
        return "haze" if t0 != "FogType" else "zero"
    if t0 == "Speed" and re.search(r"fan", n):
        return "fan"
    if re.search(r"\bfan\b", n):
        return "fan"
    return "zero"


def ofl_values(job, ch, wheels):
    caps = ch.get("capabilities") or ([ch["capability"]] if ch.get("capability") else [])
    out = {}
    dv = ch.get("defaultValue")
    if isinstance(dv, (int, float)):
        out["d"] = int(dv)
    rng = lambda c: c.get("dmxRange") or [0, 255]
    if job == "strobe":
        for c in caps:
            eff, lo, hi = str(c.get("shutterEffect", "")), rng(c)[0], rng(c)[1]
            if c.get("type") != "ShutterStrobe":
                continue
            if eff == "Open" and "o" not in out:
                out["o"] = mid(lo, hi)
            elif eff == "Closed" and "x" not in out:
                out["x"] = mid(lo, hi)
            elif eff == "Strobe" and "s" not in out:
                out["s"] = [lo, hi] if not str(c.get("speedStart", "")).endswith("fast") else [hi, lo]
        if len(caps) == 1 and caps[0].get("type") == "ShutterStrobe" and caps[0].get("shutterEffect") == "Strobe":
            out.setdefault("o", 0)
    elif job in ("wheel", "gobo"):
        slots = []
        for c in caps:
            lo, hi = rng(c)
            if c.get("type") == "WheelSlot":
                wname = c.get("wheel") or ""
                w = wheels.get(wname) or (list(wheels.values())[0] if len(wheels) == 1 else None)
                num = c.get("slotNumber")
                slot = None
                if w and isinstance(num, (int, float)) and float(num).is_integer() and 1 <= int(num) <= len(w.get("slots", [])):
                    slot = w["slots"][int(num) - 1]
                st = (slot or {}).get("type", "")
                if st == "Open" and "o" not in out:
                    out["o"] = mid(lo, hi)
                elif st == "Color" and job == "wheel":
                    cols = slot.get("colors") or []
                    if cols:
                        slots.append([mid(lo, hi), cols[0]])
            elif c.get("type") == "ColorPreset" and job == "wheel":
                cols = c.get("colors") or []
                if cols:
                    slots.append([mid(lo, hi), cols[0]])
                elif "o" not in out and re.search(r"open|white|no function", str(c.get("comment", "")), re.I):
                    out["o"] = mid(lo, hi)
            elif c.get("type") == "NoFunction" and "o" not in out:
                out["o"] = mid(lo, hi)
        if slots and job == "wheel":
            out["sl"] = slots[:24]
    elif job in ("prism", "frost", "iris"):
        for c in caps:
            lo, hi = rng(c)
            t = c.get("type")
            if t == "NoFunction" or (t == "Iris" and str(c.get("openPercent", "")) in ("open", "100%")) or (t == "Frost" and str(c.get("frostIntensity", "")) in ("off", "0%")) or (t == "Prism" and str(c.get("comment", "")).lower() in ("out", "off")):
                out.setdefault("o", lo if t != "Iris" else mid(lo, hi))
        out.setdefault("o", 0)
    elif job == "zero" and "d" not in out:
        for c in caps:
            if c.get("type") == "NoFunction":
                out["d"] = rng(c)[0]
                break
    if out.get("d") == 0:
        del out["d"]
    return out


def matrix_keys(fx):
    mx = fx.get("matrix") or {}
    if mx.get("pixelKeys"):
        keys = []
        for z in mx["pixelKeys"]:
            for y in z:
                for x in y:
                    if x:
                        keys.append(x)
        return keys
    pc = mx.get("pixelCount")
    if pc:
        x, y, z = (pc + [1, 1, 1])[:3]
        dims = [d for d in (x, y, z) if d > 1]
        if len(dims) <= 1:
            return [str(i + 1) for i in range(x * y * z)]
        keys = []
        for zz in range(z):
            for yy in range(y):
                for xx in range(x):
                    keys.append(f"({xx + 1}, {yy + 1})" if z == 1 else f"({xx + 1}, {yy + 1}, {zz + 1})")
        return keys
    return []


def load_ofl(root):
    fdir = os.path.join(root, "fixtures")
    makers = json.load(open(os.path.join(fdir, "manufacturers.json")))
    out = []
    for mk in sorted(os.listdir(fdir)):
        mdir = os.path.join(fdir, mk)
        if not os.path.isdir(mdir):
            continue
        mname = (makers.get(mk) or {}).get("name") or mk
        for fn in sorted(os.listdir(mdir)):
            if not fn.endswith(".json"):
                continue
            try:
                fx = json.load(open(os.path.join(mdir, fn)))
            except Exception:
                continue
            if fx.get("redirectTo"):
                continue
            avail = dict(fx.get("availableChannels") or {})
            tmpl = fx.get("templateChannels") or {}
            keys = matrix_keys(fx)
            for tname, tch in tmpl.items():
                for k in keys:
                    avail[tname.replace("$pixelKey", k)] = tch
            has_rgb = any((c.get("capability") or {}).get("type") == "ColorIntensity" for c in avail.values())
            wheels = fx.get("wheels") or {}
            jobs, fine = {}, {}
            for k, ch in avail.items():
                j = ofl_job(k, ch, has_rgb)
                jobs[k] = j
                for i, f in enumerate(ch.get("fineChannelAliases") or []):
                    fine[f] = ("panf" if j == "pan" else "tiltf" if j == "tilt" else "dimf" if j == "dim" else "zero") if i == 0 else "zero"
            phys = fx.get("physical") or {}
            pan = tilt = None
            for k, ch in avail.items():
                cap = ch.get("capability") or ((ch.get("capabilities") or [{}])[0])
                if jobs.get(k) == "pan" and deg(cap.get("angleEnd")) is not None:
                    pan = abs((deg(cap.get("angleEnd")) or 0) - (deg(cap.get("angleStart")) or 0))
                if jobs.get(k) == "tilt" and deg(cap.get("angleEnd")) is not None:
                    tilt = abs((deg(cap.get("angleEnd")) or 0) - (deg(cap.get("angleStart")) or 0))
            modes = []
            for m in fx.get("modes") or []:
                chans = []
                for c in m.get("channels") or []:
                    if isinstance(c, dict) and c.get("insert") == "matrixChannels":
                        rf = c.get("repeatFor")
                        pk = rf if isinstance(rf, list) else keys
                        names = c.get("templateChannels") or []
                        if c.get("channelOrder") == "perChannel":
                            for t in names:
                                for k in pk:
                                    chans.append(t.replace("$pixelKey", k) if isinstance(t, str) else None)
                        else:
                            for k in pk:
                                for t in names:
                                    chans.append(t.replace("$pixelKey", k) if isinstance(t, str) else None)
                    else:
                        chans.append(c)
                cj, vals = [], {}
                for i, c in enumerate(chans):
                    if not isinstance(c, str):
                        cj.append("zero")
                        continue
                    j = jobs.get(c) or fine.get(c) or "zero"
                    cj.append(j)
                    if c in avail:
                        v = ofl_values(j, avail[c], wheels)
                        if v:
                            vals[str(i)] = v
                if cj:
                    md = {"n": m.get("name") or m.get("shortName") or "Mode", "c": " ".join(cj)}
                    if vals:
                        md["v"] = vals
                    modes.append(md)
            if not modes:
                continue
            e = {"mk": mname, "n": fx.get("name") or fn[:-5], "t": (fx.get("categories") or [""])[0], "s": "o", "md": modes}
            lens = (phys.get("lens") or {}).get("degreesMinMax")
            if lens:
                e["b"] = lens
            if phys.get("power"):
                e["w"] = phys["power"]
            if pan:
                e["p"] = pan
            if tilt:
                e["i"] = tilt
            out.append(e)
    return out


# ---------------------------------------------------------------- QLC+
PRESET_JOB = {
    "IntensityDimmer": "dim", "IntensityMasterDimmer": "dim", "IntensityDimmerFine": "dimf", "IntensityMasterDimmerFine": "dimf",
    "IntensityRed": "r", "IntensityGreen": "g", "IntensityBlue": "b", "IntensityWhite": "w", "IntensityAmber": "a", "IntensityUV": "uv",
    "IntensityCyan": "c", "IntensityMagenta": "m", "IntensityYellow": "y", "IntensityLime": "zero", "IntensityIndigo": "zero",
    "IntensityWarmWhite": "w", "IntensityColdWhite": "w",
    "PositionPan": "pan", "PositionPanFine": "panf", "PositionTilt": "tilt", "PositionTiltFine": "tiltf", "PositionXAxis": "zero", "PositionYAxis": "zero",
    "SpeedPanTiltSlowFast": "speed", "SpeedPanTiltFastSlow": "speed", "SpeedPanSlowFast": "speed", "SpeedTiltSlowFast": "speed",
    "ColorWheel": "wheel", "ColorRGBMixer": "zero", "ColorCTOMixer": "ctemp", "ColorCTBMixer": "ctemp", "ColorCTCMixer": "ctemp",
    "GoboWheel": "gobo", "GoboIndex": "goborot", "ShutterStrobeSlowFast": "strobe", "ShutterStrobeFastSlow": "strobe", "ShutterIrisMinToMax": "iris", "ShutterIrisMaxToMin": "iris",
    "BeamFocusNearFar": "focus", "BeamFocusFarNear": "focus", "BeamZoomSmallBig": "zoom", "BeamZoomBigSmall": "zoom", "PrismRotationSlowFast": "prismrot", "PrismRotationFastSlow": "prismrot",
    "NoFunction": "zero",
}


def qlc_job(name, group, preset, byte, colour, caps, has_rgb):
    if preset in PRESET_JOB:
        return PRESET_JOB[preset]
    n, g = name.lower(), (group or "").lower()
    fine = byte == 1 or re.search(r"\bfine\b|lsb|16.?bit", n)
    if g == "pan" or (re.search(r"\bpan\b", n) and not re.search(r"speed|tilt|time", n)):
        return "panf" if fine else "pan"
    if g == "tilt" or (re.search(r"\btilt\b", n) and not re.search(r"speed|pan|time", n)):
        return "tiltf" if fine else "tilt"
    if g == "intensity":
        if colour:
            return {"red": "r", "green": "g", "blue": "b", "white": "w", "amber": "a", "uv": "uv", "cyan": "c", "magenta": "m", "yellow": "y"}.get(colour.lower(), "zero")
        if fine:
            return "dimf" if re.search(r"dim|master|intensity", n) else "zero"
        for k, j in (("red", "r"), ("green", "g"), ("blue", "b"), ("white", "w"), ("amber", "a"), ("uv", "uv"), ("cyan", "c"), ("magenta", "m"), ("yellow", "y")):
            if re.search(r"\b" + k + r"\b", n):
                return j
        return "dim"
    if fine:
        return "zero"
    if g == "shutter":
        if re.search(r"iris", n):
            return "iris"
        return "strobe"
    if g == "speed":
        return "speed" if re.search(r"pan|tilt|p/t|movement|move", n) else "zero"
    if g == "colour":
        if re.search(r"ct[obc]|temperature|cto|ctb", n):
            return "ctemp"
        if has_rgb and not any(c.get("res") for c in caps):
            return "zero"
        return "wheel" if not has_rgb or re.search(r"wheel", n) else "zero"
    if g == "gobo":
        return "goborot" if re.search(r"rot|index|spin", n) else "gobo"
    if g == "prism":
        return "prismrot" if re.search(r"rot", n) else "prism"
    if g == "beam":
        for k, j in (("zoom", "zoom"), ("focus", "focus"), ("iris", "iris"), ("frost", "frost")):
            if k in n:
                return j
        return "zero"
    if re.search(r"fog|haze|smoke|output|pump", n) and not re.search(r"fan", n):
        return "haze"
    if re.search(r"\bfan\b", n):
        return "fan"
    return "zero"


def qlc_values(job, caps, default):
    out = {}
    if default:
        out["d"] = default
    if job == "strobe":
        for c in caps:
            p, nm = c["preset"], c["name"].lower()
            if (p == "ShutterOpen" or (not p and re.search(r"\bopen\b|shutter on|no strobe", nm))) and "o" not in out:
                out["o"] = mid(c["lo"], c["hi"])
            elif (p in ("ShutterClose",) or (not p and re.search(r"closed?|blackout|shutter off", nm))) and "x" not in out:
                out["x"] = mid(c["lo"], c["hi"])
            elif (p.startswith("Strobe") or (not p and "strobe" in nm)) and "s" not in out and "random" not in nm and "random" not in p.lower():
                out["s"] = [c["hi"], c["lo"]] if "FastToSlow" in p or "fast → slow" in nm or "fast-slow" in nm else [c["lo"], c["hi"]]
        if "o" not in out and len(caps) <= 1:
            out["o"] = 0
    elif job in ("wheel", "gobo"):
        slots = []
        for c in caps:
            if c.get("res") and job == "wheel" and re.match(r"^#[0-9a-fA-F]{6}$", c["res"]):
                if re.search(r"\bopen\b|white", c["name"], re.I) and c["res"].lower() == "#ffffff" and "o" not in out:
                    out["o"] = mid(c["lo"], c["hi"])
                else:
                    slots.append([mid(c["lo"], c["hi"]), c["res"].lower()])
            elif re.search(r"\bopen\b|no gobo|white|no function", c["name"], re.I) and "o" not in out:
                out["o"] = mid(c["lo"], c["hi"])
        if slots and job == "wheel":
            out["sl"] = slots[:24]
    elif job in ("prism", "frost", "iris"):
        for c in caps:
            if re.search(r"\bopen\b|\bout\b|\boff\b|no function|no prism|no frost", c["name"], re.I):
                out["o"] = mid(c["lo"], c["hi"]) if job == "iris" else c["lo"]
                break
        out.setdefault("o", 0)
    elif job == "zero" and "d" not in out:
        for c in caps:
            if re.search(r"no function|nothing", c["name"], re.I):
                out["d"] = c["lo"]
                break
    if out.get("d") == 0:
        del out["d"]
    return out


def load_qlc(root):
    fdir = os.path.join(root, "resources", "fixtures")
    out = []
    for dp, _dn, fns in os.walk(fdir):
        for fn in sorted(fns):
            if not fn.endswith(".qxf"):
                continue
            try:
                tree = ET.parse(os.path.join(dp, fn))
            except Exception:
                continue
            r = tree.getroot()
            ns = r.tag[: r.tag.index("}") + 1] if r.tag.startswith("{") else ""
            q = lambda el, t: el.find(ns + t)
            txt = lambda el, t: ((q(el, t).text if q(el, t) is not None else "") or "").strip()
            maker, model, ftype = txt(r, "Manufacturer"), txt(r, "Model"), txt(r, "Type")
            if not maker or not model:
                continue
            chans = {}
            for c in r.findall(ns + "Channel"):
                g = q(c, "Group")
                col = q(c, "Colour")
                caps = []
                for cap in c.findall(ns + "Capability"):
                    caps.append({"lo": int(cap.get("Min", 0)), "hi": int(cap.get("Max", 255)), "preset": cap.get("Preset", "") or "", "name": (cap.text or "").strip(),
                                 "res": cap.get("Res1") or cap.get("Color") or (cap.get("Res") if str(cap.get("Res", "")).startswith("#") else "")})
                chans[c.get("Name")] = {"group": g.text if g is not None else "", "byte": int(g.get("Byte", 0)) if g is not None else 0, "preset": c.get("Preset", "") or "",
                                        "colour": col.text if col is not None else "", "caps": caps, "default": int(c.get("Default", 0) or 0)}
            has_rgb = any(PRESET_JOB.get(c["preset"]) in ("r", "g", "b") or (c["group"] == "Intensity" and c["colour"]) or re.search(r"\b(red|green|blue)\b", n.lower()) for n, c in chans.items())
            jobs = {n: qlc_job(n, c["group"], c["preset"], c["byte"], c["colour"], c["caps"], has_rgb) for n, c in chans.items()}
            modes = []
            for m in r.findall(ns + "Mode"):
                lst = sorted(m.findall(ns + "Channel"), key=lambda e: int(e.get("Number", 0)))
                cj, vals = [], {}
                for i, e in enumerate(lst):
                    nm = (e.text or "").strip()
                    j = jobs.get(nm, "zero")
                    cj.append(j)
                    if nm in chans:
                        v = qlc_values(j, chans[nm]["caps"], chans[nm]["default"])
                        if v:
                            vals[str(i)] = v
                if cj:
                    md = {"n": m.get("Name") or "Mode", "c": " ".join(cj)}
                    if vals:
                        md["v"] = vals
                    modes.append(md)
            if not modes:
                continue
            e = {"mk": maker, "n": model, "t": ftype, "s": "q", "md": modes}
            phys = r.find(ns + "Physical")
            if phys is None and modes:
                for m in r.findall(ns + "Mode"):
                    phys = m.find(ns + "Physical")
                    if phys is not None:
                        break
            if phys is not None:
                lens, focus, tech = q(phys, "Lens"), q(phys, "Focus"), q(phys, "Technical")
                if lens is not None and float(lens.get("DegreesMax", 0) or 0) > 0:
                    e["b"] = [float(lens.get("DegreesMin", 0) or 0), float(lens.get("DegreesMax", 0) or 0)]
                if focus is not None and int(focus.get("PanMax", 0) or 0) > 0:
                    e["p"] = int(focus.get("PanMax"))
                if focus is not None and int(focus.get("TiltMax", 0) or 0) > 0:
                    e["i"] = int(focus.get("TiltMax"))
                if tech is not None and int(tech.get("PowerConsumption", 0) or 0) > 0:
                    e["w"] = int(tech.get("PowerConsumption"))
            out.append(e)
    return out


# ---------------------------------------------------------------- one library
MAKER_ALIASES = {"chauvetdj": "chauvet", "chauvetprofessional": "chauvetprofessional", "americandj": "adj", "adjproducts": "adj", "claypaky": "claypaky", "robelighting": "robe", "martinprofessional": "martin"}


def mkey(maker):
    k = norm(maker)
    return MAKER_ALIASES.get(k, k)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ofl", required=True)
    ap.add_argument("--qlc", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--js", default="", help="also write the library as a script the lights page loads (works from file:// too)")
    ap.add_argument("--ofl-commit", default="")
    ap.add_argument("--qlc-commit", default="")
    a = ap.parse_args(argv)
    ofl, qlc = load_ofl(a.ofl), load_qlc(a.qlc)
    seen = {(mkey(e["mk"]), norm(e["n"])) for e in ofl}
    allf = list(ofl) + [e for e in qlc if (mkey(e["mk"]), norm(e["n"])) not in seen]
    allf.sort(key=lambda e: (e["mk"].lower(), e["n"].lower()))
    makers = sorted({e["mk"] for e in allf}, key=str.lower)
    idx = {m: i for i, m in enumerate(makers)}
    for e in allf:
        e["m"] = idx[e.pop("mk")]
        for md in e["md"]:
            for j in md["c"].split():
                assert j in JOBS, j
    lib = {"format": "central-fixtures", "version": 1, "built": datetime.date.today().isoformat(),
           "sources": [{"name": "Open Fixture Library", "license": "MIT", "url": "https://github.com/OpenLightingProject/open-fixture-library", "commit": a.ofl_commit, "fixtures": sum(1 for e in allf if e["s"] == "o")},
                       {"name": "QLC+ fixture definitions", "license": "Apache-2.0", "url": "https://github.com/mcallegari/qlcplus", "commit": a.qlc_commit, "fixtures": sum(1 for e in allf if e["s"] == "q")}],
           "makers": makers, "fixtures": allf}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    raw = json.dumps(lib, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    with gzip.GzipFile(a.out, "wb", mtime=0, compresslevel=9) as f:
        f.write(raw)
    if a.js:
        import base64
        b64 = base64.b64encode(open(a.out, "rb").read()).decode("ascii")
        with open(a.js, "w") as f:
            f.write("/* Central Control - the fixture library (made by tools/make-fixture-library.py: the Open Fixture Library, MIT,\n"
                    " * and the QLC+ fixture definitions, Apache 2.0). Gzipped JSON in base64; fixture-catalog.js unpacks it. */\n"
                    "window.CU_FIXTURE_LIBRARY = { built: " + json.dumps(lib["built"]) + ", fixtures: " + str(len(allf)) + ", gz: \"" + b64 + "\" };\n")
    modes = sum(len(e["md"]) for e in allf)
    print(f"{len(allf)} fixtures ({lib['sources'][0]['fixtures']} Open Fixture Library, {lib['sources'][1]['fixtures']} QLC+), {modes} modes, {len(makers)} makers -> {a.out} ({os.path.getsize(a.out) // 1024} KB, {len(raw) // 1024} KB unpacked)")


if __name__ == "__main__":
    main(sys.argv[1:])
