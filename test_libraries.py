#!/usr/bin/env python3
"""Central Pedal - checks of the sound libraries (9.8), no internet and no audio hardware:
  * libraries/libraries.json: four libraries, one per plan; every preset and board is made of real pedals and knobs
    (js/pedals.js), every IR a board names is in the library; the website's built-in list matches it;
  * tools/make-irs.py: 14 IRs, mono 48 kHz 24-bit 2048 samples, cabinets rolled off up high (the built-in rig keeps 4096);
  * tools/sounds-vcsl.py: notes and dynamics read from VCSL names, key / velocity ranges, the octave heard in a sample,
    and every bank's instruments match files in the VCSL list (tools/vcsl-names.txt when it's there);
  * tools/build-libraries.py: the zips (manifest, every item with its plan and sha256, the same zip every time),
    libraries-index.json and SHA256SUMS;
  * libraries.py (the installer): a sha256 mismatch is refused (download and file), a damaged item too; sounds and IRs
    keep their plan (tiers.txt, read by the Pi's host and the computers' rig); an update replaces, Remove cleans up.
    python3 test_libraries.py"""
import hashlib
import http.server
import importlib.util
import io
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import wave
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import instrument_host  # noqa: E402
import libraries  # noqa: E402
import native_rig  # noqa: E402


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sys.path.insert(0, os.path.join(HERE, "tools"))
import sfz_render as VCSL_R  # noqa: E402
VCSL = load("sounds_vcsl", "tools/sounds-vcsl.py")
IRS = load("make_irs", "tools/make-irs.py")
BUILD = load("build_libraries", "tools/build-libraries.py")
VSCO = load("sounds_vsco", "sounds-vsco.py")

failures = []


def check(label, ok, detail=""):
    print(("  ✓ " if ok else "  ✗ ") + label + ("" if ok or not detail else "   -- " + str(detail)[:400]))
    if not ok:
        failures.append(label)


def tiny_sf2(path, name="Test", hz=440.0):
    """A one-preset SoundFont (a short sine), written with the orchestra builder's writer."""
    sr = 22050
    x = (0.3 * np.sin(2 * np.pi * hz * np.arange(int(0.3 * sr)) / sr)).astype(np.float32)
    pcm = np.round(x * 32767).astype("<i2")
    VSCO.write_sf2(path, name, [{"name": "s0", "pcm": pcm, "sr": sr, "root": 69, "s": None, "e": None}],
                   [{"name": "i0", "zones": [[("keyRange", (0, 127)), ("sampleID", 0)]]}], [{"name": name, "prog": 0, "zones": [[("instrument", 0)]]}], copyright="test", comment="test")


def read_wav24(path):
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 3
        raw, ch, sr, n = w.readframes(w.getnframes()), w.getnchannels(), w.getframerate(), w.getnframes()
    b = np.frombuffer(raw, np.uint8).reshape(-1, 3)
    v = b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16)
    v = np.where(v & 0x800000, v - 0x1000000, v) / 8388608.0
    return v, ch, sr, n


def main():
    tmp = tempfile.mkdtemp(prefix="cc-libs-")
    try:
        run(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n%s" % ("ALL PASSED" if not failures else "%d FAILED:\n  - %s" % (len(failures), "\n  - ".join(failures))))
    return 1 if failures else 0


def run(tmp):
    print("The library definitions:")
    defs = BUILD.load_definitions()
    check("seven libraries: one for each plan (Central Pads, and Central Utility since 10.2), and Central Pads Extra (10.3) - a second for the pads plan", sorted(l["plan"] for l in defs) == ["instrument", "keys", "pads", "pads", "pedals", "plugins", "utility"] and sorted(l["id"] for l in defs if l["plan"] == "pads") == ["central-pads-extra", "central-pads-library"], [l["plan"] for l in defs])
    node = subprocess.run(["node", "-e", "const P=require('./js/pedals.js');console.log(JSON.stringify(P.pedals.map(p=>[p.id,p.tier,Object.keys(p.knobs),!!p.opts.irFile])))"], cwd=HERE, capture_output=True, text=True)
    pedals = {p[0]: p for p in json.loads(node.stdout)}
    bad = []
    for lib in defs:
        irs = {i["name"] for i in lib.get("irs") or []}
        for b in (lib.get("presets") or []) + (lib.get("boards") or []):
            for it in b["chain"]:
                p = pedals.get(it[0])
                if not p:
                    bad.append("%s: %s isn't a pedal" % (b["name"], it[0]))
                    continue
                for knob in (it[1] if len(it) > 1 else {}):
                    if knob not in p[2]:
                        bad.append("%s: %s has no knob %s" % (b["name"], it[0], knob))
                if len(it) > 2 and it[2].get("ir"):
                    if not p[3]:
                        bad.append("%s: %s doesn't load IRs" % (b["name"], it[0]))
                    if it[2]["ir"] not in irs:
                        bad.append("%s: the IR %s isn't in %s" % (b["name"], it[2]["ir"], lib["id"]))
    check("every preset and board is made of real pedals and knobs, and names IRs its library has", not bad, bad)
    plans_of = lambda lib: {pedals[it[0]][1] for b in (lib.get("presets") or []) + (lib.get("boards") or []) for it in b["chain"]} - {"free"}
    by = {}
    for l in defs:   # (each plan's first library; Central Pads Extra - 10.3 - is the pads plan's second, by its id)
        by.setdefault(l["plan"], l)
    extra = next(l for l in defs if l["id"] == "central-pads-extra")
    check("Keys and Instrument presets use only free pedals (they need just their own plan)", not plans_of(by["keys"]) and not plans_of(by["instrument"]), (plans_of(by["keys"]), plans_of(by["instrument"])))
    check("Plugins boards need nothing but Central Plugins; Pedals boards nothing but Central Pedals", plans_of(by["plugins"]) <= {"plugins"} and plans_of(by["pedals"]) <= {"pedals"}, (plans_of(by["plugins"]), plans_of(by["pedals"])))
    with open(os.path.join(HERE, "server", "src", "libraries-builtin.json"), encoding="utf-8") as handle:
        builtin = json.load(handle)["libraries"]
    fresh = BUILD.builtin_list()
    check("the website's built-in list (server/src/libraries-builtin.json) is up to date (tools/build-libraries.py --write-builtin)",
          json.dumps([{k: e[k] for k in ("id", "plan", "title", "version", "summary", "contents", "size")} for e in builtin], sort_keys=True) == json.dumps([{k: e[k] for k in ("id", "plan", "title", "version", "summary", "contents", "size")} for e in fresh], sort_keys=True))
    js = open(os.path.join(HERE, "js", "libraries.js"), encoding="utf-8").read()
    check("the apps' built-in list (js/libraries.js) names the same libraries and versions", all(('id: "%s", plan: "%s", title: "%s", version: "%s"' % (l["id"], l["plan"], l["title"], l["version"])) in js for l in defs))

    print("\nThe impulse responses (tools/make-irs.py):")
    ir_dir = os.path.join(tmp, "irs")
    IRS.main(ir_dir)
    files = sorted(os.listdir(ir_dir))
    names = [i["name"] for i in by["pedals"]["irs"]]
    check("one WAV for each IR the Central Pedals library lists", sorted(n + ".wav" for n in names) == files, files)
    shapes, rolled = set(), []
    for f in files:
        v, ch, sr, n = read_wav24(os.path.join(ir_dir, f))
        shapes.add((ch, sr, n))
        if "Body" not in f and np.all(np.isfinite(v)):
            spec = np.abs(np.fft.rfft(v, 16384)) ** 2
            fr = np.fft.rfftfreq(16384, 1 / 48000)
            rolled.append(spec[fr > 9000].sum() < 0.05 * spec[(fr > 200) & (fr < 4000)].sum())
    check("each is mono, 48 kHz, 24-bit, 2048 samples (within the rig's 4096)", shapes == {(1, 48000, 2048)}, shapes)
    check("the cabinets (centre, edge and room microphones) roll off above the speaker's range", all(rolled) and len(rolled) == len([f for f in files if "Body" not in f]) >= 20, rolled)
    again = os.path.join(tmp, "irs2")
    IRS.main(again)
    check("the same files every build", all(open(os.path.join(ir_dir, f), "rb").read() == open(os.path.join(again, f), "rb").read() for f in files))

    print("\nThe VCSL builder (tools/sounds-vcsl.py):")
    check("notes from names (C4 = 60, sharps, low octaves)", [VCSL.note_of(x) for x in ("GPiano_sus_C4_v3_rr1_Player.wav", "EWHarp_Normal_A#2_v2_RR1.wav", "Player_vl1_rr1_B0.wav", "Rode_Man3Open_A4.wav", "Clap_rr1.wav")] == [60, 46, 23, 69, None])
    check("dynamic layers from names (_v3, _vl2, mf, loud)", VCSL.layer_of("x_C4_v3_rr1.wav") > VCSL.layer_of("x_C4_v1_rr1.wav") and VCSL.layer_of("x_C4_ff.wav") > VCSL.layer_of("x_C4_mp.wav") and VCSL.layer_of("Marimba_hit_C4_loud_01.wav") > VCSL.layer_of("Marimba_hit_C4_soft_01.wav"))
    vr = VCSL.vel_ranges(3)
    check("velocity ranges cover 0..127 without gaps", vr[0][0] == 0 and vr[-1][1] == 127 and all(vr[i][1] + 1 == vr[i + 1][0] for i in range(2)), vr)
    kr = VCSL.key_ranges([48, 55, 60])
    check("key ranges reach half-way to the next note and stretch to the ends", kr == {48: (0, 51), 55: (52, 57), 60: (58, 127)}, kr)
    sr = 44100
    t = np.arange(int(0.6 * sr)) / sr
    c5 = (0.5 * np.sin(2 * np.pi * 523.25 * t) + 0.2 * np.sin(2 * np.pi * 1046.5 * t)).astype(np.float32)
    check("a sample named C4 that sounds C5 is moved up an octave", VCSL.octave_shift([(60, c5, sr), (62, c5, sr)]) in (12, 10) or VCSL.octave_shift([(60, c5, sr)]) == 12, VCSL.octave_shift([(60, c5, sr)]))
    names_file = os.path.join(HERE, "tools", "vcsl-names.txt")
    if os.path.isfile(names_file):
        vnames = open(names_file, encoding="utf-8").read().split("\n")
        empty = [iid for iid in VCSL.INSTR if not VCSL.plan_instrument(iid, vnames)]
        kits = [k for kit in (VCSL.HAND_KIT, VCSL.ORCH_KIT) for k in kit if not VCSL.plan_kit([k], vnames)]
        check("every instrument and kit sound finds its samples in the VCSL list", not empty and not kits, (empty, kits))
    else:
        print("  - (no tools/vcsl-names.txt: the VCSL file list isn't checked here; CI builds the banks)")
    banks = set(BUILD.vcsl_presets())   # (every bank builder: VCSL, the SFZ libraries, the pads and textures)
    want = {s["name"] for l in defs for s in l.get("sounds") or []}
    check("every sound the libraries list is a bank the builder makes", want <= banks, want - banks)

    print("\nThe SFZ reader (tools/sfz_render.py):")
    files_sfz = {
        "P/kit.sfz": '#include "maps/keys.sfz"\n<control>\nset_cc101=127\nset_cc4=0\n// a comment\n<global> loop_mode=one_shot amplitude_oncc101=100 locc101=1\n#include "maps/kick.sfz"\n'
                     '<global>\n<group> key=$HH sw_last=24 sw_default=24\n<region> sample=../S/hh closed.wav hicc4=60\n<region> sample=../S/hh_open.wav locc4=61\n'
                     '<group> key=$HH sw_last=25\n<region> sample=../S/hh_sw2.wav\n<region> sample=../S/rel.wav key=40 trigger=release\n',
        "P/maps/keys.sfz": "#define $KICK 36\n#define $HH 42\n",
        "P/maps/kick.sfz": "<master> volume=-6\n<group> key=$KICK\n<region> sample=..\\S\\kick_v1_rr1.wav hivel=63\n<region> sample=../S/kick_v1_rr2.wav hivel=63 seq_position=2\n"
                           "<region> sample=../S/kick_v2.wav lovel=64 volume=0\n<region> sample=../S/kick_oh.wav lovel=64 amplitude=50\n<region> sample=../S/kick_x.wav lorand=0.5\n",
    }
    sfz = VCSL_R.Sfz(lambda p: files_sfz[p], "P/kit.sfz")
    act = sfz.active()
    paths = sorted(sfz.sample_path(r) for r in act)
    check("#include / #define, backslashes, the default key switch and controllers, first round robin, attack triggers only",
          paths == ["S/hh closed.wav", "S/kick_oh.wav", "S/kick_v1_rr1.wav", "S/kick_v2.wav"], paths)
    check("layers at a key, and each region's level (volume overridden in the region, amplitude, amplitude_oncc at its default)",
          sfz.layers(act, 36) == [(1, 63), (64, 127)] and abs(sfz.gain([r for r in act if "kick_v1" in r["sample"]][0]) - 10 ** (-6 / 20)) < 1e-6
          and abs(sfz.gain([r for r in act if "kick_oh" in r["sample"]][0]) - 0.5 * 10 ** (-6 / 20)) < 1e-6, sfz.layers(act, 36))
    tone = lambda f: (np.sin(2 * np.pi * f * np.arange(4410) / 44100) * 0.5).astype(np.float32)
    mix = VCSL_R.render_note(sfz, act, 36, 100, lambda p: (tone(100), 44100))
    check("a note mixes every microphone that sounds there (kick + overhead, at their levels)", mix is not None and abs(float(np.max(np.abs(mix[0]))) - 0.5 * (1 + 0.5 * 10 ** (-6 / 20))) < 0.02, mix and float(np.max(np.abs(mix[0]))))
    SFZB = load("sounds_sfz", "tools/sounds-sfz.py")
    check("every SFZ library is CC0 at a pinned commit, and every instrument a bank uses is defined", all(len(c) == 40 for _r, c, _t in SFZB.SOURCES.values()) and SFZB.LICENSE == "CC0 1.0"
          and all(layer[0] in SFZB.INSTR for _b, _p, presets in SFZB.BANKS for _n, layers in presets for layer in layers))

    print("\nThe pads and textures (tools/make-pads.py, 10.2):")
    PADS = load("make_pads", "tools/make-pads.py")
    # (seamless: where the loop runs round, its curve bends no more than anywhere inside it - a seam would be a kink)
    seamless = lambda lp: float(np.max(np.abs(np.diff(np.concatenate([lp[-3:], lp[:3]]), 2, axis=0)))) <= float(np.max(np.abs(np.diff(lp, 2, axis=0)))) + 1e-6
    x, s0, e0 = PADS.pad_sample(PADS.PADS[0][1], 57, 7)
    check("a pad note is stereo and one seamless loop (its movement and reverb wrap round)", x.ndim == 2 and x.shape[1] == 2 and (s0, e0) == (0, int(PADS.LOOP * PADS.SR))
          and seamless(x[s0:e0]) and float(np.max(np.abs(x[:, 0] - x[:, 1]))) > 0.01 and np.isfinite(x).all(), (s0, e0))
    sw, s1, e1 = PADS.pad_sample(dict((p[0], p[1]) for p in PADS.PADS)["Swell Pad"], 57, 7)
    cen = lambda y: float(np.sum(np.abs(np.fft.rfft(y.mean(1))) * np.arange(len(y) // 2 + 1)) / np.sum(np.abs(np.fft.rfft(y.mean(1))))) * PADS.SR / len(y)
    check("the Swell Pad opens before its loop: darker at first, flowing into the loop with no step", s1 == int(3.0 * PADS.SR) and e1 - s1 == int(PADS.LOOP * PADS.SR)
          and cen(sw[:int(0.5 * PADS.SR)]) < 0.7 * cen(sw[s1:s1 + int(0.5 * PADS.SR)]) and float(np.max(np.abs(sw[s1] - sw[s1 - 1]))) <= float(np.max(np.abs(np.diff(sw[s1:e1], axis=0)))) + 1e-6,
          (s1, cen(sw[:int(0.5 * PADS.SR)]), cen(sw[s1:s1 + int(0.5 * PADS.SR)])))
    check("eighteen pads; the textures bank is a Central Plugins sound, the pads Central Keys, the swells Central Pads", len(PADS.PADS) == 18
          and dict((b[0], b[1]) for b in PADS.BANKS) == {"Central Keys Pads": "keys", "Central Plugins Textures": "plugins", "Central Pads Swells": "pads", "Central Pads Swells Extra": "pads"}
          and [p[0] for p in PADS.PADS[:9]] == ["Warm Pad", "Air Pad", "Choir Aah", "Choir Ooh", "Shimmer Pad", "String Pad", "Glass Pad", "Swell Pad", "Worship Pad"])
    SW = dict((x[0], x[1:]) for x in PADS.SWELLS)
    sw, ri, dn = PADS.swell_sound("swell", 2, 4), PADS.swell_sound("riser", 2, 4), PADS.swell_sound("down", 2, 4)
    rms = lambda y: float(np.sqrt(np.mean(y ** 2)))
    q = PADS.SW_SR // 4
    seg = ri[-q - 720:-720].mean(1)
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    fr = np.fft.rfftfreq(len(seg), 1 / PADS.SW_SR)
    lo = fr[np.argmax(spec * (fr < 700) * (fr > 200))]
    check("Central Pads Swells: swells and risers in every key at 4, 8 and 16 s: a swell grows into its end, a riser ends in its key (D), a downlifter fades out",
          {SW[n][1] for n in SW if SW[n][0] in ("swell", "riser")} == {4, 8, 16} and len(sw) == 4 * PADS.SW_SR and rms(sw[:q]) < 0.05 * rms(sw[-2 * q:-q])
          and min(abs(lo - f) for f in (293.66, 440.0, 587.33)) < 8 and rms(dn[-q:]) < 0.1 * rms(dn[:q]), (lo, rms(sw[:q]), rms(sw[-2 * q:-q])))

    # Central Pads (tools/make-pad-loops.py): each style in each key, a stereo seamless loop
    LOOPS = load("make_pad_loops", "tools/make-pad-loops.py")
    ploops = LOOPS.build(os.path.join(tmp, "padloops"), styles=["Worship"], keys=["C", "F#"], log=lambda *a: None)
    import wave as _wave
    with _wave.open(os.path.join(ploops, LOOPS.loop_file("Worship", "F#"))) as w:
        frames = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, 2) / 32768.0
        okw = w.getnchannels() == 2 and w.getframerate() == LOOPS.SR and w.getnframes() == int(LOOPS.LOOP * LOOPS.SR)
    peak = float(np.max(np.abs(frames)))
    spec = np.abs(np.fft.rfft(frames[:, 0]))
    f0 = np.argmax(spec[: int(400 * LOOPS.LOOP)]) / LOOPS.LOOP   # (the strongest low partial: F#3 185 Hz or its octave / fifth)
    check("Central Pads: a key's loop is a stereo WAV of the loop's length, about -6 dBFS, in its key (F#: Fs.wav), seamless", okw and 0.45 < peak < 0.52 and os.path.basename(LOOPS.loop_file("Worship", "F#")) == "Fs.wav" and LOOPS.loop_file("Choir Aah", "C") == BUILD.pad_loop_file("Choir Aah", "C")
          and any(abs(f0 - 185.0 * m) < 6 for m in (0.25, 0.5, 1, 1.5, 2, 3)) and seamless(frames), (okw, peak, f0))
    check("Central Pads: 41 styles, the same ones the library lists; Central Pads Extra: 35 more, none the same", len(LOOPS.MAIN_NAMES) == 41 and len(set(LOOPS.NAMES)) == 76
          and LOOPS.MAIN_NAMES == [p["name"] for p in by["pads"]["pads"]] and LOOPS.NAMES[41:] == [p["name"] for p in extra["pads"]] and extra["plan"] == "pads", LOOPS.NAMES)
    pdir2 = LOOPS.build_pulse(os.path.join(tmp, "pulse"), keys=["D"], log=lambda *a: None)
    gw = [e for e in pdir2 if e["key"] == "D"]
    with _wave.open(os.path.join(tmp, "pulse", gw[0]["file"])) as w:
        okp = w.getnchannels() == 2 and abs(w.getnframes() / w.getframerate() - LOOPS.PULSE_SECONDS) < 1e-3
    check("the moving pads: six, each in all 12 keys, a 4-second stereo bed with its gate (16 steps, 0-9, '~' to glide)", len({e["name"] for e in pdir2}) == 6 and len(pdir2) == 72 and okp
          and all(re.match(r"^~?[0-9]{16}$", e["gate"]) for e in pdir2), gw[:2])

    print("\nThe zips (tools/build-libraries.py):")
    snd = os.path.join(tmp, "sounds")
    os.makedirs(snd)
    for s in want:
        tiny_sf2(os.path.join(snd, BUILD.sound_file(s)), s)
    for pd in by["pads"]["pads"] + extra["pads"]:   # (Central Pads and Extra: a tiny loop per style and key)
        for k in BUILD.PAD_KEYS:
            LOOPS.loop_wav(os.path.join(snd, "pad-loops", BUILD.pad_loop_file(pd["name"], k)), np.zeros(64, np.float32), np.zeros(64, np.float32))
    for lib in defs:   # (10.0: the loops - a tiny one per set; tools/make-loops.py's own checks are in test_content.py)
        for ls in lib.get("loops") or []:
            os.makedirs(os.path.join(snd, "loops", ls["set"]), exist_ok=True)
            LOOPS.loop_wav(os.path.join(snd, "loops", ls["set"], "one.wav"), np.zeros(64, np.float32), np.zeros(64, np.float32))
            with open(os.path.join(snd, "loops", ls["set"], "index.json"), "w") as handle:
                json.dump([{"name": "One", "file": "one.wav", "bpm": 90, "meter": 4, "bars": 2}], handle)
    import runpy   # (10.2: Central Utility's click sets and lighting looks, made the real way - it takes a second)
    runpy.run_path(os.path.join(HERE, "tools", "make-utility.py"), run_name="make_utility")["main"]([os.path.join(snd, "utility")])
    out = os.path.join(tmp, "out")
    index = BUILD.build_all(snd, ir_dir, out, base_url="https://example.test/libs", log=lambda *a: None)
    zips = sorted(f for f in os.listdir(out) if f.endswith(".zip"))
    check("one versioned zip per library", zips == sorted("%s-%s.zip" % (l["id"], l["version"]) for l in defs), zips)
    ok_items, tiers_ok, files_ok = True, True, True
    for e in index["libraries"]:
        with zipfile.ZipFile(os.path.join(out, e["file"])) as zf:
            man = json.loads(zf.read("manifest.json"))
            for it in man["items"]:
                data = zf.read(it["file"])
                ok_items &= hashlib.sha256(data).hexdigest() == it["sha256"] and it["kind"] in libraries.KINDS
                tiers_ok &= it["tier"] == man["plan"] == e["plan"]
            files_ok &= "CREDITS.txt" in zf.namelist()
            if any(i["kind"] in ("sound", "ir", "pad") for i in man["items"]):
                cr = zf.read("sounds/CREDITS.txt").decode()
                files_ok &= all(s["url"] in cr and s["license"] in cr for s in man["sources"]) and bool(man["sources"])
    check("each manifest lists its items with their sha256, every one with the library's plan; CREDITS.txt, and sounds/CREDITS.txt with every source's license and URL", ok_items and tiers_ok and files_ok)
    sums = dict(reversed(line.split("  ")) for line in open(os.path.join(out, "SHA256SUMS")).read().splitlines())
    check("SHA256SUMS matches the zips and the index", all(hashlib.sha256(open(os.path.join(out, f), "rb").read()).hexdigest() == sums.get(f) for f in zips + ["libraries-index.json"]), sums)
    e0 = index["libraries"][0]
    check("libraries-index.json: id, plan, title, version, size, sha256, url and what's inside", all(e0.get(k) for k in ("id", "plan", "title", "version", "size", "sha256", "url", "contents")) and e0["url"] == "https://example.test/libs/" + e0["file"], {k: e0.get(k) for k in ("id", "url", "size")})
    out2 = os.path.join(tmp, "out2")
    index2 = BUILD.build_all(snd, ir_dir, out2, base_url="https://example.test/libs", log=lambda *a: None)
    check("the same zip every build (same content, same sha256)", [e["sha256"] for e in index["libraries"]] == [e["sha256"] for e in index2["libraries"]])
    try:
        BUILD.build_all(os.path.join(tmp, "nothing"), ir_dir, os.path.join(tmp, "out3"), log=lambda *a: None)
        stopped = False
    except FileNotFoundError:
        stopped = True
    check("a sound that wasn't built stops the build (not a library missing its sounds)", stopped)

    NK = len(by["keys"]["sounds"])
    print("\nThe installer (libraries.py) - the computers' rig folders:")
    data_root = os.path.join(tmp, "data")
    rig = native_rig.NativeRig(None, data_root, tmp, binary=None)   # (no rig program: just its folders)
    store = libraries.LibraryStore(data_root, rig)
    keys = [e for e in index["libraries"] if e["plan"] == "keys"][0]
    pedals_e = [e for e in index["libraries"] if e["plan"] == "pedals"][0]
    kzip = os.path.join(out, keys["file"])
    try:
        store.install_file(kzip, expected_sha256="0" * 64)
        refused = False
    except libraries.LibraryError as error:
        refused = "checksum" in str(error)
    check("a library that doesn't match its sha256 is refused, and nothing is installed", refused and not store.installed() and not [f for f in os.listdir(rig.sf2_user_dir) if f.endswith(".sf2")])
    # a damaged item inside a good zip
    bad_zip = os.path.join(tmp, "bad.zip")
    with zipfile.ZipFile(kzip) as src, zipfile.ZipFile(bad_zip, "w") as dst:
        for n in src.namelist():
            d = src.read(n)
            dst.writestr(n, d + b"!" if n.endswith(".sf2") else d)
    try:
        store.install_file(bad_zip)
        refused = False
    except libraries.LibraryError as error:
        refused = "damaged" in str(error)
    check("a sound whose sha256 doesn't match the manifest is refused", refused and not store.installed())
    rec = store.install_file(kzip, expected_sha256=keys["sha256"])
    check("Central Keys installs: all its banks and its presets", rec["counts"]["sound"] == NK and rec["counts"]["preset"] == len(by["keys"]["presets"]) and all(os.path.isfile(p) for p in rec["sounds"]), rec["counts"])
    catalog = [{"file": p, "name": "x"} for p in rec["sounds"]]
    native_rig.bank_plans(catalog)
    check("the rig's sound list gives each bank its plan (keys) - locked without Central Keys though anyone can download it", [b.get("tier") for b in catalog] == ["keys"] * NK, catalog)
    check("presets come with the library's plan for the Instrument page", all(p["tier"] == "keys" and p["library"] == "central-keys-library" for p in rec["presets"]))
    prec = store.install_file(os.path.join(out, pedals_e["file"]), expected_sha256=pedals_e["sha256"])
    irs = native_rig.ir_plans([{"file": p} for p in prec["irs"]])
    check("Central Pedals installs its IRs into the IR folder, each with the pedals plan", len(irs) == len(by["pedals"]["irs"]) and all(i.get("tier") == "pedals" for i in irs), irs[:2])

    plug = [e for e in index["libraries"] if e["plan"] == "plugins"][0]
    grec = store.install_file(os.path.join(out, plug["file"]), expected_sha256=plug["sha256"])
    gcat = native_rig.bank_plans([{"file": p, "name": "x"} for p in grec["sounds"]])
    check("Central Plugins' textures bank keeps the plugins plan (a sound bank can belong to any plan)", gcat and all(b.get("tier") == "plugins" for b in gcat), gcat)
    store.remove("central-plugins-library")
    pads_e = [e for e in index["libraries"] if e["id"] == "central-pads-library"][0]
    extra_e = [e for e in index["libraries"] if e["id"] == "central-pads-extra"][0]
    check("Central Pads Extra's zip: 35 styles, the moving pads with their gates, the extra swells - all with the pads plan, as a second library", extra_e["plan"] == "pads"
          and extra_e["counts"]["pad"] == 35 and extra_e["counts"]["loop"] >= 1 and "Central Pads Swells Extra" in json.dumps(extra_e["contents"]), extra_e["counts"])
    check("Central Pads' zip: all 41 styles in all 12 keys, with the pads plan", pads_e["counts"]["pad"] == len(by["pads"]["pads"]) == 41 and len(pads_e["contents"]["pads"]) == 41, pads_e["counts"])
    drec = store.install_file(os.path.join(out, pads_e["file"]), expected_sha256=pads_e["sha256"])
    styles = store.pads()
    f_fs = store.pad_file("central-pads-library", "Worship", "F#")
    check("Central Pads installs: 41 pad styles, each in all 12 keys, with the pads plan", drec["counts"]["pad"] == 41 and len(styles) == 41 and all(len(x["keys"]) == 12 and x["tier"] == "pads" for x in styles), [(x["name"], len(x["keys"])) for x in styles])
    check("...a style's loop in a key is found (F# -> Fs.wav, inside the library's own folder)", f_fs and f_fs.endswith(os.path.join("Worship", "Fs.wav")) and os.path.isfile(f_fs), f_fs)
    check("...nothing outside it is (a made-up library, style or key)", not store.pad_file("../x", "Worship", "C") and not store.pad_file("central-pads-library", "Nope", "C") and not store.pad_file("central-pads-library", "Worship", "H"))
    store.remove("central-pads-library")
    check("...and Remove takes the loops away", not store.pads() and not os.path.exists(f_fs))
    old_max = BUILD.MAX_ZIP
    BUILD.MAX_ZIP = 1000
    try:
        BUILD.build_all(snd, ir_dir, os.path.join(tmp, "out4"), only="central-keys-library", log=lambda *a: None)
        big = False
    except ValueError as error:
        big = "under" in str(error)
    BUILD.MAX_ZIP = old_max
    check("a library over the size limit (1.5 GB) stops the build", big)

    print("\nThe installer - the Central Pedal's host:")
    host = instrument_host.InstrumentHost(None, os.path.join(tmp, "pi"), HERE)
    pstore = libraries.LibraryStore(os.path.join(tmp, "pi"), host)
    pstore.install_file(kzip, expected_sha256=keys["sha256"])
    pstore.install_file(os.path.join(out, pedals_e["file"]), expected_sha256=pedals_e["sha256"])
    cat = [b for b in host.keys_catalog() if b["file"].startswith(host.sf2_user_dir)]
    check("its keys catalog lists the library's banks with the keys plan, not as the user's own", len(cat) == NK and all(b.get("tier") == "keys" and not b.get("user") for b in cat), [(b["name"], b.get("tier"), b.get("user")) for b in cat])
    pstore.install_file(os.path.join(out, plug["file"]), expected_sha256=plug["sha256"])
    tex = [b for b in host.keys_catalog() if b["name"].startswith("Central Plugins")]
    check("...and the Central Plugins textures with the plugins plan", tex and all(b.get("tier") == "plugins" for b in tex), [(b["name"], b.get("tier")) for b in tex])
    pir = host.ir_list()
    check("its IR list gives the library's IRs the pedals plan", len(pir) == len(by["pedals"]["irs"]) and all(i.get("tier") == "pedals" for i in pir), pir[:2])
    tiny_sf2(os.path.join(host.sf2_user_dir, "My Own.sf2"), "My Own")
    mine = [b for b in host.keys_catalog() if b["name"] == "My Own"]
    check("the musician's own bank in the same folder stays theirs (free)", mine and mine[0].get("user") and not mine[0].get("tier"), mine)

    print("\nUpdate and Remove:")
    # a 1.1 of Central Keys with one bank fewer: the update replaces 1.0 (its old bank and its plan line go)
    with zipfile.ZipFile(kzip) as src:
        man = json.loads(src.read("manifest.json"))
        drop = [i for i in man["items"] if i["kind"] == "sound"][-1]
        man["items"] = [i for i in man["items"] if i is not drop]
        man["version"] = "1.1"
        newzip = os.path.join(tmp, "keys-1.1.zip")
        with zipfile.ZipFile(newzip, "w") as dst:
            for n in src.namelist():
                if n != drop["file"]:
                    dst.writestr(n, json.dumps(man) if n == "manifest.json" else src.read(n))
    r2 = store.install_file(newzip)
    tiers = open(os.path.join(rig.sf2_user_dir, "tiers.txt")).read()
    check("a newer version replaces the older one (the bank it no longer has is gone, with its plan line)", r2["version"] == "1.1" and r2["counts"]["sound"] == NK - 1 and not os.path.exists(os.path.join(rig.sf2_user_dir, os.path.basename(drop["file"])))
          and os.path.basename(drop["file"]).split(" - ")[0] not in tiers, tiers)
    check("libraries.newer compares versions", libraries.newer("1.10", "1.9") and not libraries.newer("1.0", "1.0"))
    store.remove("central-keys-library")
    store.remove("central-pedals-library")
    left = [f for f in os.listdir(rig.sf2_user_dir) if f.endswith(".sf2")] + [f for f in os.listdir(rig.ir_dir) if f.endswith(".wav")]
    check("Remove takes every file and plan line the libraries added away", not left and not store.installed() and "central-" not in open(os.path.join(rig.sf2_user_dir, "tiers.txt")).read(), left)

    # (10.2) a plugin you made in Central Production: its personal library (plan "free", personal) installs on the Central
    # Pedal too, and the plugin is listed as yours - for the pedalboard and the effects - without the community switch
    fxzip = os.path.join(tmp, "my-tremolo.zip")
    fxjson = json.dumps({"format": "central-fx", "version": 1, "name": "My Tremolo", "blocks": [], "wires": []}).encode()
    with zipfile.ZipFile(fxzip, "w") as z:
        z.writestr("manifest.json", json.dumps({"format": 1, "id": "my-tremolo-abc123", "plan": "free", "personal": True, "version": "1.1790000000", "title": "My Tremolo",
                                                "items": [{"kind": "fx", "file": "fx/My Tremolo.cmfx.json", "name": "My Tremolo", "format": "central-fx", "sha256": hashlib.sha256(fxjson).hexdigest()}]}))
        z.writestr("fx/My Tremolo.cmfx.json", fxjson)
    store.set_plugins_allowed(False)
    frec = store.install_file(fxzip)
    mine = store.central_fx()
    lst = [x for x in store.listing() if x["id"] == "my-tremolo-abc123"]
    check("(10.2) your own Central FX plugin (a personal library) installs here and is listed as yours, the community switch off",
          frec["source"] == "personal" and frec["counts"].get("fx") == 1 and os.path.isfile(frec["fx"][0]["file"]) and frec["fx"][0]["file"].endswith(".cmfx.json")
          and [(m["name"], m["from"]) for m in mine] == [("My Tremolo", "mine")] and lst and lst[0]["fx"] and lst[0]["personal"], (frec, mine))
    try:
        bad = os.path.join(tmp, "not-fx.zip")
        with zipfile.ZipFile(bad, "w") as z:
            z.writestr("manifest.json", json.dumps({"format": 1, "id": "my-bad-abc123", "plan": "free", "personal": True, "version": "1.1", "items": [{"kind": "fx", "file": "fx/x.cmfx.json"}]}))
            z.writestr("fx/x.cmfx.json", "{\"format\": \"lv2\"}")
        store.install_file(bad)
        bad_refused = False
    except libraries.LibraryError:
        bad_refused = True
    try:
        sneak = os.path.join(tmp, "sneak.zip")
        with zipfile.ZipFile(sneak, "w") as z:
            z.writestr("manifest.json", json.dumps({"format": 1, "id": "sneaky-lib", "plan": "free", "version": "1.1", "items": [{"kind": "fx", "file": "fx/x.cmfx.json"}]}))
            z.writestr("fx/x.cmfx.json", fxjson)
        store.install_file(sneak)
        sneak_refused = False
    except libraries.LibraryError:
        sneak_refused = True
    check("(10.2) ...a file that isn't a Central FX plugin is refused, and plan \"free\" is only for your own (personal) libraries", bad_refused and sneak_refused)
    store.remove("my-tremolo-abc123")
    check("(10.2) ...and Remove takes it away", not store.central_fx() and not os.path.exists(frec["fx"][0]["file"]))

    print("\nDownloads:")
    payload = open(kzip, "rb").read()

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path == "/idx":   # (10.0.1) the published release's list, behind a redirect like GitHub's
                self.send_response(302)
                self.send_header("Location", "/rel/libraries-index.json")
                self.end_headers()
                return
            if self.path == "/rel/libraries-index.json":
                body = json.dumps({"libraries": [dict(keys, sha256=keys["sha256"].upper()), {"id": "central-pads-library", "plan": "pads", "file": "p.zip"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/%s" % (srv.server_address[1], keys["file"])
    idx = libraries.release_index("http://127.0.0.1:%d/idx" % srv.server_address[1])
    rel = idx["libraries"]
    check("(10.0.1) the published release's list (through its redirect): each library ready, its url = the index's folder + file, unpublished ones left out",
          idx["source"] == "release" and len(rel) == 1 and rel[0]["ready"] and rel[0]["sha256"] == keys["sha256"] and rel[0]["url"] == "http://127.0.0.1:%d/rel/%s" % (srv.server_address[1], keys["file"]), [(r["url"], r["sha256"], len(rel)) for r in rel])
    r0 = store.install_url(rel[0]["url"], rel[0]["sha256"], rel[0]["id"], rel[0]["size"])
    check("(10.0.1) a library from the release's list downloads and installs", r0["version"] == keys["version"])
    store.remove("central-keys-library")
    try:
        store.install_url(url, "e" * 64, "central-keys-library")
        refused = False
    except libraries.LibraryError as error:
        refused = "checksum" in str(error)
    check("a download that doesn't match the website's sha256 is refused", refused and not store.installed())
    try:
        store.install_url(url, None, "central-keys-library")
        refused = False
    except libraries.LibraryError as error:
        refused = "published" in str(error)
    check("a library the website lists without a sha256 (not published yet) isn't downloaded", refused)
    r3 = store.install_url(url, keys["sha256"], "central-keys-library", len(payload))
    check("a good download installs", r3["version"] == by["keys"]["version"] and r3["counts"]["sound"] == NK and r3["source"] == "website")
    srv.shutdown()
    leftovers = [f for f in os.listdir(store.root) if f.endswith(".zip")]
    check("no downloaded zip is left behind", not leftovers, leftovers)


if __name__ == "__main__":
    sys.exit(main())
