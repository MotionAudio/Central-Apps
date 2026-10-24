#!/usr/bin/env python3
"""Central Pedal - packs the sound libraries (one per plan: Central Keys, Central Instrument, Central Plugins, Central
Pedals) from libraries/libraries.json into versioned zips the website lists and the apps install.

    python3 tools/build-libraries.py --sounds DIR --irs DIR --out DIR [--base-url URL] [--only ID] [--allow-missing]

--sounds: the SoundFonts tools/sounds-vcsl.py built; --irs: the impulses tools/make-irs.py made.
--base-url: where the zips will be downloaded from (written into the index; default: the GitHub release "libraries").
--allow-missing: leave out a sound that wasn't built (tests) instead of stopping.

Writes to --out:
  <id>-<version>.zip       manifest.json + sounds/*.sf2, irs/*.wav, presets/*.json, boards/*.json, CREDITS.txt
  libraries-index.json     what the website's /v1/libraries and the apps read: each library, its size, sha256, url and contents
  SHA256SUMS               sha256sum format, for the zips and the index

manifest.json: {format, id, plan, version, title, summary, items: [{kind: sound|board|preset|ir|click, name, file, tier,
size, sha256, license, credit, presets?}], credits: [..]}. Every item keeps its library's plan as its tier: anyone can
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
DEFAULT_BASE = "https://github.com/MotionAudio/central-apps/releases/download/libraries"
PLANS = {"keys": "Central Keys", "instrument": "Central Instrument", "plugins": "Central Plugins", "pedals": "Central Pedals"}
KINDS = ("sound", "board", "preset", "ir", "click")
FORMAT = 1
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


def build_library(lib, sounds_dir, irs_dir, out_dir, allow_missing=False, log=print):
    """Writes <id>-<version>.zip; returns its index entry (without the url)."""
    tier = lib["plan"]
    items, files, credits, missing = [], [], [], []
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
    manifest = {"format": FORMAT, "id": lib["id"], "plan": tier, "planName": PLANS[tier], "version": str(lib["version"]), "title": lib["title"],
                "summary": lib.get("summary", ""), "items": items, "credits": credits, "built": datetime.date.today().isoformat()}
    credit_txt = "%s %s - part of %s\n\n%s\n\nEverything here opens with %s: anyone can download it, the plan's package key unlocks it.\n\n%s\n" % (
        lib["title"], lib["version"], PLANS[tier], lib.get("summary", ""), PLANS[tier], "\n".join("- " + c for c in credits) or "")
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
    count = {k: sum(1 for i in items if i["kind"] == k) for k in KINDS}
    log("    %-34s %6.1f MB  %s%s" % (name, os.path.getsize(path) / 1e6, ", ".join("%d %ss" % (v, k) for k, v in count.items() if v),
                                     ("   (left out, not built: %s)" % ", ".join(missing)) if missing else ""))
    contents = {
        "sounds": [{"name": i["name"], "presets": i["presets"], "license": i["license"]} for i in items if i["kind"] == "sound"],
        "presets": [i["name"] for i in items if i["kind"] == "preset"],
        "boards": [i["name"] for i in items if i["kind"] == "board"],
        "irs": [i["name"] for i in items if i["kind"] == "ir"],
    }
    return {"id": lib["id"], "plan": tier, "planName": PLANS[tier], "title": lib["title"], "version": str(lib["version"]), "summary": lib.get("summary", ""),
            "file": name, "size": os.path.getsize(path), "sha256": sha256_file(path), "contents": contents, "counts": count, "credits": credits,
            "unpacked": sum(i["size"] for i in items)}


def vcsl_presets():
    """{bank name: [preset names]} from tools/sounds-vcsl.py (what each VCSL SoundFont will hold, before it's built)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("sounds_vcsl", os.path.join(ROOT, "tools", "sounds-vcsl.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return {name: [p[0] for p in presets] for name, _tier, presets in mod.BANKS}


def builtin_list(definitions=DEFINITIONS, base_url=DEFAULT_BASE):
    """The libraries as the website lists them before (or without) a published libraries-index.json: what's in each and
    an estimated size, no sha256 (server/src/libraries-builtin.json is written from this: --write-builtin)."""
    banks = vcsl_presets()
    out = []
    for lib in load_definitions(definitions):
        sounds = [{"name": s["name"], "presets": banks.get(s["name"], []), "license": s.get("license", "")} for s in lib.get("sounds") or []]
        contents = {"sounds": sounds, "presets": [b["name"] for b in lib.get("presets") or []], "boards": [b["name"] for b in lib.get("boards") or []],
                    "irs": [i["name"] for i in lib.get("irs") or []]}
        count = {"sound": len(sounds), "board": len(contents["boards"]), "preset": len(contents["presets"]), "ir": len(contents["irs"]), "click": 0}
        name = "%s-%s.zip" % (lib["id"], lib["version"])
        out.append({"id": lib["id"], "plan": lib["plan"], "planName": PLANS[lib["plan"]], "title": lib["title"], "version": str(lib["version"]), "summary": lib.get("summary", ""),
                    "file": name, "size": int(lib.get("approxMB", 1) * 1e6), "approximate": True, "sha256": None, "url": base_url.rstrip("/") + "/" + name,
                    "contents": contents, "counts": count, "credits": sorted({s.get("credit", "") for s in (lib.get("sounds") or []) + (lib.get("irs") or []) if s.get("credit")})})
    return out


def build_all(sounds_dir, irs_dir, out_dir, base_url=DEFAULT_BASE, only=None, allow_missing=False, definitions=DEFINITIONS, log=print):
    libs = load_definitions(definitions)
    entries = []
    for lib in libs:
        if only and lib["id"] != only:
            continue
        e = build_library(lib, sounds_dir, irs_dir, out_dir, allow_missing=allow_missing, log=log)
        e["url"] = base_url.rstrip("/") + "/" + e["file"]
        entries.append(e)
    index = {"format": FORMAT, "base": base_url.rstrip("/"), "built": datetime.date.today().isoformat(), "libraries": entries}
    with open(os.path.join(out_dir, "libraries-index.json"), "w", encoding="utf-8") as handle:
        json.dump(index, handle, indent=1)
    with open(os.path.join(out_dir, "SHA256SUMS"), "w", encoding="utf-8") as handle:
        for e in entries:
            handle.write("%s  %s\n" % (e["sha256"], e["file"]))
        handle.write("%s  %s\n" % (sha256_file(os.path.join(out_dir, "libraries-index.json")), "libraries-index.json"))
    return index


def main(argv):
    opt, i = {}, 0
    while i < len(argv):
        a = argv[i]
        if a == "--allow-missing":
            opt["allow_missing"] = True
            i += 1
            continue
        if a in ("--sounds", "--irs", "--out", "--base-url", "--only", "--definitions", "--write-builtin") and i + 1 < len(argv):
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
    build_all(opt.get("sounds"), opt.get("irs"), opt["out"], opt.get("base_url") or DEFAULT_BASE, opt.get("only"), opt.get("allow_missing", False), opt.get("definitions") or DEFINITIONS)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
