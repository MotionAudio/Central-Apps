#!/usr/bin/env python3
"""Central Pedal - packs the libraries (one per plan: Central Keys, Central Instrument, Central Plugins, Central
Pedals, Central Pads, Central Utility) from libraries/libraries.json into versioned zips the website lists and the apps
install.

    python3 tools/build-libraries.py --sounds DIR --irs DIR --out DIR [--base-url URL] [--only ID] [--allow-missing]

--sounds: the SoundFonts tools/sounds-vcsl.py built; --irs: the impulses tools/make-irs.py made; --pads: the pad loops
tools/make-pads.py made (default: <sounds>/pad-loops); --loops: the loops tools/make-loops.py made, <set>/index.json each
(default: <sounds>/loops; 10.0); --utility: what tools/make-utility.py made - click sets, lighting looks, and later
slide templates, backgrounds and graphics (default: <sounds>/utility; 10.2).
--base-url: where the zips will be downloaded from (written into the index; default: the GitHub release "libraries").
--allow-missing: leave out a sound that wasn't built (tests) instead of stopping.
--no-previews: skip the 30-second previews (10.2; tools/make-previews.py makes them from the sounds just built).

Writes to --out:
  <id>-<version>.zip       manifest.json + sounds/*.sf2, irs/*.wav, pads/<style>/<key>.wav, presets/*.json, boards/*.json, CREDITS.txt
  libraries-index.json     what the website's /v1/libraries and the apps read: each library, its size, sha256, url and contents
  SHA256SUMS               sha256sum format, for the zips, the previews and the index
  preview--<library>--<kind>--<name>.mp3   (10.2) 30 seconds of each pad style, loop set and loop, instrument preset,
                           keys preset and IR - what people hear before they download; listed in the index ("previews",
                           each with its url) and on the manifest's items ("preview", or "previews" [[preset, file]] on a SoundFont)

manifest.json: {format, id, plan, version, title, summary, items: [{kind: sound|board|preset|ir|click|pad, name, file,
tier, size, sha256, license, credit, presets?, key? (a pad: its key, C..B)}], credits: [..]}. Every item keeps its library's plan as its tier: anyone can
download a library, but its sounds, presets, boards and IRs only open with that plan."""
import datetime
import hashlib
import json
import os
import re
import struct
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFINITIONS = os.path.join(ROOT, "libraries", "libraries.json")
DEFAULT_BASE = "https://libraries.motionaudio.org"   # (10.5: Cloudflare R2 - the GitHub release "libraries" was its home until 10.4)
PLANS = {"keys": "Central Keys", "instrument": "Central Instrument", "plugins": "Central Plugins", "pedals": "Central Pedals", "pads": "Central Pads", "utility": "Central Utility"}
# (10.2) Central Utility: click sets, lighting looks, slide templates, lyric backgrounds, graphics (tools/make-utility.py)
KINDS = ("sound", "board", "preset", "ir", "click", "pad", "loop", "look", "slide", "background", "graphic")
UTILITY_KINDS = (("look", "looks"), ("slide", "slides"), ("background", "backgrounds"), ("graphic", "graphics"))
PAD_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def pad_loop_file(style, key):
    """Where tools/make-pads.py writes a pad loop (and the same path, under pads/, in the zip)."""
    return "%s/%s.wav" % (style.replace(" ", "-"), key.replace("#", "s"))
FORMAT = 1
MAX_ZIP = int(1.5e9)   # (a library zip stays under 1.5 GB: downloads on church Wi-Fi, the Pi's card)
ZIP_DATE = (2026, 1, 1, 0, 0, 0)   # (every entry gets the same date: the same content makes the same zip)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-") or "item"


def sound_file(name):
    """The SoundFont's file name, as tools/sounds-vcsl.py writes it ("<bank> - <slug>.sf2": the part before " - " is the
    bank's name in the app, and the tiers.txt line that gives it its plan)."""
    return "%s - %s.sf2" % (name, name.lower().replace(" ", "-"))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def sf2_preset_names(path):
    """The preset names in a SoundFont (its phdr records), without loading the samples."""
    with open(path, "rb") as handle:
        data = handle.read(12)
        if data[:4] != b"RIFF" or data[8:12] != b"sfbk":
            raise ValueError("%s is not a SoundFont" % os.path.basename(path))
        size = os.path.getsize(path)
        pos = 12
        while pos + 8 <= size:
            handle.seek(pos)
            cid, n = struct.unpack("<4sI", handle.read(8))
            if cid == b"LIST":
                kind = handle.read(4)
                if kind == b"pdta":
                    end, p = pos + 8 + n, pos + 12
                    while p + 8 <= end:
                        handle.seek(p)
                        sid, sn = struct.unpack("<4sI", handle.read(8))
                        if sid == b"phdr":
                            raw = handle.read(sn)
                            names = [raw[i:i + 20].split(b"\0")[0].decode("latin-1") for i in range(0, sn - 38, 38)]
                            return [x for x in names if x and x != "EOP"]
                        p += 8 + sn + (sn & 1)
            pos += 8 + n + (n & 1)
    return []


def check_board(b, where):
    if not isinstance(b, dict) or not b.get("name") or not isinstance(b.get("chain"), list) or not b["chain"]:
        raise ValueError("%s: a board needs a name and a chain of pedals" % where)
    if b.get("kind") not in ("electric", "acoustic", "bass", "keys"):
        raise ValueError("%s: %s has no instrument kind (electric, acoustic, bass, keys)" % (where, b["name"]))
    for it in b["chain"]:
        if not (isinstance(it, list) and it and isinstance(it[0], str) and (len(it) < 2 or isinstance(it[1], dict))):
            raise ValueError("%s: %s has a pedal that isn't [id, {knob: value}]" % (where, b["name"]))


def load_definitions(path=DEFINITIONS):
    with open(path, encoding="utf-8") as handle:
        doc = json.load(handle)
    libs = doc.get("libraries") or []
    seen = set()
    for lib in libs:
        for key in ("id", "plan", "version", "title"):
            if not lib.get(key):
                raise ValueError("a library without %s" % key)
        if lib["plan"] not in PLANS:
            raise ValueError("%s: unknown plan %s" % (lib["id"], lib["plan"]))
        if lib["id"] in seen or not re.match(r"^[a-z0-9-]+$", lib["id"]) or not re.match(r"^\d+(\.\d+)*$", str(lib["version"])):
            raise ValueError("%s: a library id is lowercase letters, digits and dashes (once each); its version is like 1.0" % lib["id"])
        seen.add(lib["id"])
        for b in (lib.get("presets") or []) + (lib.get("boards") or []):
            check_board(b, lib["id"])
    return libs


def build_library(lib, sounds_dir, irs_dir, out_dir, allow_missing=False, log=print, pads_dir=None, loops_dir=None, previews=False, utility_dir=None):
    """Writes <id>-<version>.zip (and, with previews, its 30-second previews beside it); returns its index entry (without
    the urls)."""
    tier = lib["plan"]
    items, files, credits, missing = [], [], [], []
    pads_dir = pads_dir or os.path.join(sounds_dir or "", "pad-loops")
    loops_dir = loops_dir or os.path.join(sounds_dir or "", "loops")
    utility_dir = utility_dir or os.path.join(sounds_dir or "", "utility")
    for c in lib.get("clicks") or []:   # (10.2: a click set, the accent and the beat - tools/make-utility.py)
        for role in ("accent", "beat"):
            src = os.path.join(utility_dir, "clicks", c["set"], role + ".wav")
            if not os.path.isfile(src):
                if allow_missing:
                    if c["name"] not in missing:
                        missing.append(c["name"])
                    continue
                raise FileNotFoundError("%s: the click set %s wasn't made (%s)" % (lib["id"], c["name"], src))
            arc = "clicks/%s-%s.wav" % (c["set"], role)
            items.append({"kind": "click", "name": c["name"], "role": role, "file": arc, "tier": tier, "size": os.path.getsize(src), "sha256": sha256_file(src),
                          "license": c.get("license", "Made by Motion Audio"), "credit": c.get("credit", "")})
            files.append((arc, src))
    for kind, key in UTILITY_KINDS:   # (10.2: looks, slide templates, backgrounds, graphics - files in <utility>/<key>/)
        for e in lib.get(key) or []:
            fname = e["file"] if os.path.splitext(e["file"])[1] else e["file"] + ".json"
            src = os.path.join(utility_dir, key, fname)
            if not os.path.isfile(src):
                if allow_missing:
                    missing.append(e["name"])
                    continue
                raise FileNotFoundError("%s: %s wasn't made (%s)" % (lib["id"], e["name"], src))
            arc = "%s/%s" % (key, fname)
            items.append({"kind": kind, "name": e["name"], "file": arc, "tier": tier, "size": os.path.getsize(src), "sha256": sha256_file(src)})
            files.append((arc, src))
    for ls in lib.get("loops") or []:   # (10.0: a set of loops tools/make-loops.py made - <loops>/<set>/index.json lists them)
        listing = os.path.join(loops_dir or "", ls["set"], "index.json")
        if not os.path.isfile(listing):
            if allow_missing:
                missing.append(ls["name"])
                continue
            raise FileNotFoundError("%s: the loops %s weren't made (%s)" % (lib["id"], ls["set"], listing))
        with open(listing, encoding="utf-8") as handle:
            entries = json.load(handle)
        for e in entries:
            src = os.path.join(loops_dir, ls["set"], e["file"])
            arc = "loops/%s/%s" % (ls["set"], e["file"])
            item = {"kind": "loop", "name": e["name"], "set": ls["set"], "group": ls["name"], "file": arc, "tier": tier, "size": os.path.getsize(src), "sha256": sha256_file(src),
                    "license": ls.get("license", ""), "credit": ls.get("credit", "")}
            for k in ("bpm", "meter", "bars", "key", "seconds", "gate"):
                if e.get(k) is not None:
                    item[k] = e[k]
            items.append(item)
            files.append((arc, src))
        if ls.get("credit") and ls["credit"] not in credits:
            credits.append(ls["credit"])
    for pad in lib.get("pads") or []:   # (a pad style: one loop per key)
        got = 0
        for key in PAD_KEYS:
            src = os.path.join(pads_dir, pad_loop_file(pad["name"], key))
            if not os.path.isfile(src):
                if allow_missing:
                    continue
                raise FileNotFoundError("%s: the pad %s in %s wasn't made (%s)" % (lib["id"], pad["name"], key, src))
            arc = "pads/" + pad_loop_file(pad["name"], key)
            items.append({"kind": "pad", "name": pad["name"], "key": key, "file": arc, "tier": tier, "size": os.path.getsize(src), "sha256": sha256_file(src),
                          "license": pad.get("license", ""), "credit": pad.get("credit", "")})
            files.append((arc, src))
            got += 1
        if not got:
            missing.append(pad["name"])
        if pad.get("credit") and pad["credit"] not in credits:
            credits.append(pad["credit"])
    for s in lib.get("sounds") or []:
        src = os.path.join(sounds_dir or "", sound_file(s["name"]))
        if not os.path.isfile(src):
            if allow_missing:
                missing.append(s["name"])
                continue
            raise FileNotFoundError("%s: the sound %s wasn't built (%s)" % (lib["id"], s["name"], src))
        arc = "sounds/" + os.path.basename(src)
        items.append({"kind": "sound", "name": s["name"], "file": arc, "tier": tier, "size": os.path.getsize(src), "sha256": sha256_file(src),
                      "license": s.get("license", ""), "credit": s.get("credit", ""), "presets": sf2_preset_names(src)})
        files.append((arc, src))
        if s.get("credit") and s["credit"] not in credits:
            credits.append(s["credit"])
    for ir in lib.get("irs") or []:
        src = os.path.join(irs_dir or "", ir["name"] + ".wav")
        if not os.path.isfile(src):
            if allow_missing:
                missing.append(ir["name"])
                continue
            raise FileNotFoundError("%s: the IR %s wasn't made (%s)" % (lib["id"], ir["name"], src))
        arc = "irs/" + os.path.basename(src)
        items.append({"kind": "ir", "name": ir["name"], "file": arc, "tier": tier, "size": os.path.getsize(src), "sha256": sha256_file(src),
                      "license": ir.get("license", ""), "credit": ir.get("credit", "")})
        files.append((arc, src))
        if ir.get("credit") and ir["credit"] not in credits:
            credits.append(ir["credit"])
    blobs = []
    for kind, key in (("preset", "presets"), ("board", "boards")):
        for b in lib.get(key) or []:
            arc = "%ss/%s.json" % (kind, slug(b["name"]))
            data = json.dumps(dict(b, tier=tier, library=lib["id"]), indent=1).encode()
            items.append({"kind": kind, "name": b["name"], "file": arc, "tier": tier, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "instrument": b["kind"]})
            blobs.append((arc, data))
    if not items:
        raise ValueError("%s: nothing to pack" % lib["id"])
    made = []
    if previews:   # (10.2: before the manifest is written - its items name their previews)
        try:
            made = _load("tools/make-previews.py", "make_previews").make_library_previews(lib, items, out_dir, sounds_dir, pads_dir, loops_dir, irs_dir, pad_loop_file, log=log)
        except Exception as e:   # (no ffmpeg here, say: the library still builds, without previews)
            log("    (no previews for %s: %s)" % (lib["id"], e))
    sources = source_lines(lib, missing)
    manifest = {"format": FORMAT, "id": lib["id"], "plan": tier, "planName": PLANS[tier], "version": str(lib["version"]), "title": lib["title"],
                "summary": lib.get("summary", ""), "items": items, "credits": credits, "sources": sources, "built": datetime.date.today().isoformat(),
                "previews": [{k: p[k] for k in ("kind", "name", "preset", "set", "file", "seconds") if k in p} for p in made]}
    credit_txt = "%s %s - part of %s\n\n%s\n\nEverything here opens with %s: anyone can download it, the plan's package key unlocks it.\n\n%s\n\nSources (license, where it is):\n%s\n" % (
        lib["title"], lib["version"], PLANS[tier], lib.get("summary", ""), PLANS[tier], "\n".join("- " + c for c in credits) or "",
        "\n".join("- %s: %s - %s - %s" % (s["item"], s["text"], s["license"], s["url"]) for s in sources) or "- (all made by Motion Audio)")
    if any(i["kind"] in ("sound", "ir", "pad", "loop") for i in items):   # (sounds/CREDITS.txt: every source of every sound and IR, with its license and URL)
        blobs.append(("sounds/CREDITS.txt", ("Sources of the sounds and impulse responses in %s %s\n\n%s\n" % (lib["title"], lib["version"], "\n".join(
            "%s\n    %s\n    License: %s\n    %s" % (s["item"], s["text"], s["license"], s["url"]) for s in sources))).encode()))
    name = "%s-%s.zip" % (lib["id"], lib["version"])
    path = os.path.join(out_dir, name)
    os.makedirs(out_dir, exist_ok=True)
    with zipfile.ZipFile(path + ".part", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        def put(arc, data=None, src=None):
            zi = zipfile.ZipInfo(arc, ZIP_DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            if src:
                zi.file_size = os.path.getsize(src)   # (known size: no zip64 records - the apps' zip reader keeps it simple)
                with open(src, "rb") as handle, zf.open(zi, "w") as dst:
                    for block in iter(lambda: handle.read(1 << 20), b""):
                        dst.write(block)
            else:
                zf.writestr(zi, data)
        put("manifest.json", json.dumps(manifest, indent=1).encode())
        put("CREDITS.txt", credit_txt.encode())
        for arc, data in blobs:
            put(arc, data)
        for arc, src in files:
            put(arc, src=src)
    os.replace(path + ".part", path)
    if os.path.getsize(path) > MAX_ZIP:
        raise ValueError("%s is %.2f GB - a library stays under %.1f GB (split it, or leave something out)" % (name, os.path.getsize(path) / 1e9, MAX_ZIP / 1e9))
    count = {k: sum(1 for i in items if i["kind"] == k) for k in KINDS}
    count["pad"] = len({i["name"] for i in items if i["kind"] == "pad"})   # (pad styles, each in every key)
    count["loop"] = len({(i["set"], i["name"]) for i in items if i["kind"] == "loop"})   # (loops: each groove / style once, whatever its tempos or keys)
    count["click"] = len({i["name"] for i in items if i["kind"] == "click"})   # (click sets: the accent and the beat count once)
    log("    %-34s %6.1f MB  %s%s" % (name, os.path.getsize(path) / 1e6, ", ".join("%d %ss" % (v, k) for k, v in count.items() if v),
                                     ("   (left out, not built: %s)" % ", ".join(missing)) if missing else ""))
    contents = {
        "sounds": [{"name": i["name"], "presets": i["presets"], "license": i["license"]} for i in items if i["kind"] == "sound"],
        "presets": [i["name"] for i in items if i["kind"] == "preset"],
        "boards": [i["name"] for i in items if i["kind"] == "board"],
        "irs": [i["name"] for i in items if i["kind"] == "ir"],
        "pads": sorted({i["name"] for i in items if i["kind"] == "pad"}, key=[p["name"] for p in lib.get("pads") or []].index),
        "loops": list(dict.fromkeys("%s: %s" % (i["group"], i["name"]) for i in items if i["kind"] == "loop")),
    }
    if count["click"]:
        contents["clicks"] = list(dict.fromkeys(i["name"] for i in items if i["kind"] == "click"))
    for kind, key in UTILITY_KINDS:
        if count.get(kind):
            contents[key] = [i["name"] for i in items if i["kind"] == kind]
    return {"id": lib["id"], "plan": tier, "planName": PLANS[tier], "title": lib["title"], "version": str(lib["version"]), "summary": lib.get("summary", ""),
            "file": name, "size": os.path.getsize(path), "sha256": sha256_file(path), "contents": contents, "counts": count, "credits": credits,
            "sources": sources, "unpacked": sum(i["size"] for i in items), "previews": made}


def source_lines(lib, missing=()):
    """[{item, text, license, url}] - every source of the library's sounds and IRs (what it is, its license, where)."""
    out = []
    for s in (lib.get("sounds") or []) + (lib.get("irs") or []) + (lib.get("pads") or []) + (lib.get("loops") or []):
        if s["name"] in missing:
            continue
        for src in s.get("sources") or []:
            out.append({"item": s["name"], "text": src.get("text", ""), "license": src.get("license", ""), "url": src.get("url", "")})
    return out


def _load(rel, name):
    import importlib.util
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def vcsl_presets():
    """{bank name: [preset names]} from the bank builders (sounds-vcsl.py, sounds-sfz.py, make-pads.py) - what each
    SoundFont will hold, before it's built."""
    out = {}
    for rel, name in (("tools/sounds-vcsl.py", "sounds_vcsl"), ("tools/sounds-sfz.py", "sounds_sfz")):
        out.update({b[0]: [p[0] for p in b[2]] for b in _load(rel, name).BANKS})
    out.update({b[0]: list(b[2]) for b in _load("tools/make-pads.py", "make_pads").BANKS})
    synths = _load("tools/make-synths.py", "make_synths")
    out[synths.NAME] = [s[0] for s in synths.SOUNDS]
    return out


def loop_names(lib):
    """What a library's loops will be, before they're made (tools/make-loops.py's lists)."""
    ml = _load("tools/make-loops.py", "make_loops")
    pv = _load("tools/pad_voices.py", "pad_voices")
    names = {"drums": [g[0] for g in ml.GROOVES], "ambient": list(ml.AMBIENT), "pulse": [p[0] for p in pv.PULSES], "pulse-more": [p[0] for p in pv.PULSES_MORE]}
    return ["%s: %s" % (ls["name"], n) for ls in lib.get("loops") or [] for n in names.get(ls["set"], [])]


def builtin_list(definitions=DEFINITIONS, base_url=DEFAULT_BASE):
    """The libraries as the website lists them before (or without) a published libraries-index.json: what's in each and
    an estimated size, no sha256 (server/src/libraries-builtin.json is written from this: --write-builtin)."""
    banks = vcsl_presets()
    out = []
    for lib in load_definitions(definitions):
        sounds = [{"name": s["name"], "presets": banks.get(s["name"], []), "license": s.get("license", "")} for s in lib.get("sounds") or []]
        contents = {"sounds": sounds, "presets": [b["name"] for b in lib.get("presets") or []], "boards": [b["name"] for b in lib.get("boards") or []],
                    "irs": [i["name"] for i in lib.get("irs") or []], "pads": [p["name"] for p in lib.get("pads") or []], "loops": loop_names(lib)}
        count = {"sound": len(sounds), "board": len(contents["boards"]), "preset": len(contents["presets"]), "ir": len(contents["irs"]), "click": len(lib.get("clicks") or []), "pad": len(contents["pads"]),
                 "loop": len(contents["loops"])}
        if lib.get("clicks"):
            contents["clicks"] = [c["name"] for c in lib["clicks"]]
        for kind, key in UTILITY_KINDS:
            if lib.get(key):
                contents[key] = [e["name"] for e in lib[key]]
                count[kind] = len(lib[key])
        name = "%s-%s.zip" % (lib["id"], lib["version"])
        pv = expected_previews(lib, banks, base_url)
        out.append({"id": lib["id"], "plan": lib["plan"], "planName": PLANS[lib["plan"]], "title": lib["title"], "version": str(lib["version"]), "summary": lib.get("summary", ""),
                    "file": name, "size": int(lib.get("approxMB", 1) * 1e6), "approximate": True, "sha256": None, "url": base_url.rstrip("/") + "/" + name,
                    "contents": contents, "counts": count, "credits": sorted({s.get("credit", "") for s in (lib.get("sounds") or []) + (lib.get("irs") or []) + (lib.get("pads") or []) + (lib.get("loops") or []) if s.get("credit")}),
                    "sources": source_lines(lib), "previews": pv, "previewsExpected": True})
    return out


def expected_previews(lib, banks, base_url=DEFAULT_BASE):
    """The previews a build of this library makes (their names come from tools/make-previews.py) - for the built-in list,
    before a published libraries-index.json says which ones really are there."""
    mp = _load("tools/make-previews.py", "make_previews")
    base = base_url.rstrip("/") + "/"
    out, used = [], set()

    def add(kind, name, preset=None, **extra):
        fn = mp.unique_name(lib["id"], kind, name, preset, used)
        e = dict({"kind": kind, "name": name, "file": fn, "url": base + fn, "seconds": mp.SECONDS}, **extra)
        if preset is not None:
            e["preset"] = preset
        out.append(e)
    for p in lib.get("pads") or []:
        add("pad", p["name"])
    ml = _load("tools/make-loops.py", "make_loops")
    pv = _load("tools/pad_voices.py", "pad_voices")
    names = {"drums": list(dict.fromkeys(g[0] for g in ml.GROOVES)), "ambient": list(ml.AMBIENT), "pulse": [p[0] for p in pv.PULSES], "pulse-more": [p[0] for p in pv.PULSES_MORE]}
    for ls in lib.get("loops") or []:
        add("loops", ls["name"], set=ls["set"])
        for n in names.get(ls["set"], []):
            add("loop", n, set=ls["set"])
    for snd in lib.get("sounds") or []:
        for pr in banks.get(snd["name"], []):
            add("sound", snd["name"], pr)
    for b in lib.get("presets") or []:
        if b.get("sound"):
            add("preset", b["name"])
    for ir in lib.get("irs") or []:
        add("ir", ir["name"])
    return out


def build_all(sounds_dir, irs_dir, out_dir, base_url=DEFAULT_BASE, only=None, allow_missing=False, definitions=DEFINITIONS, log=print, pads_dir=None, loops_dir=None, previews=False, utility_dir=None):
    libs = load_definitions(definitions)
    entries = []
    for lib in libs:
        if only and lib["id"] != only:
            continue
        e = build_library(lib, sounds_dir, irs_dir, out_dir, allow_missing=allow_missing, log=log, pads_dir=pads_dir, loops_dir=loops_dir, previews=previews, utility_dir=utility_dir)
        e["url"] = base_url.rstrip("/") + "/" + e["file"]
        for p in e["previews"]:
            p["url"] = base_url.rstrip("/") + "/" + p["file"]
        entries.append(e)
    index = {"format": FORMAT, "base": base_url.rstrip("/"), "built": datetime.date.today().isoformat(), "libraries": entries}
    with open(os.path.join(out_dir, "libraries-index.json"), "w", encoding="utf-8") as handle:
        json.dump(index, handle, indent=1)
    with open(os.path.join(out_dir, "SHA256SUMS"), "w", encoding="utf-8") as handle:
        for e in entries:
            handle.write("%s  %s\n" % (e["sha256"], e["file"]))
            for p in e["previews"]:
                handle.write("%s  %s\n" % (p["sha256"], p["file"]))
        handle.write("%s  %s\n" % (sha256_file(os.path.join(out_dir, "libraries-index.json")), "libraries-index.json"))
    return index


def main(argv):
    opt, i = {"previews": True}, 0
    while i < len(argv):
        a = argv[i]
        if a == "--allow-missing":
            opt["allow_missing"] = True
            i += 1
            continue
        if a == "--no-previews":
            opt["previews"] = False
            i += 1
            continue
        if a in ("--sounds", "--irs", "--pads", "--loops", "--utility", "--out", "--base-url", "--only", "--definitions", "--write-builtin") and i + 1 < len(argv):
            opt[a[2:].replace("-", "_")] = argv[i + 1]
            i += 2
            continue
        print(__doc__)
        return 2
    if opt.get("write_builtin"):
        with open(opt["write_builtin"], "w", encoding="utf-8") as handle:
            json.dump({"_about": "Written by tools/build-libraries.py --write-builtin from libraries/libraries.json: what /v1/libraries lists until libraries-index.json is published.",
                       "libraries": builtin_list(opt.get("definitions") or DEFINITIONS)}, handle, indent=1)
            handle.write("\n")
        return 0
    if not opt.get("out"):
        print(__doc__)
        return 2
    build_all(opt.get("sounds"), opt.get("irs"), opt["out"], opt.get("base_url") or DEFAULT_BASE, opt.get("only"), opt.get("allow_missing", False), opt.get("definitions") or DEFINITIONS,
              pads_dir=opt.get("pads"), loops_dir=opt.get("loops"), previews=opt["previews"], utility_dir=opt.get("utility"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
