#!/usr/bin/env python3
"""Central Pedal - checks of the sound and pedal library (no audio hardware, no internet):
  * every pedal of the catalogue (js/pedals.js) has its plugin in instrument-plugins.json, its knobs and starting
    values are real controls of that plugin, and every board is made of real pedals and knobs;
  * the plans: the 9.6 studio tools are in Central Plugins, the 9.6 pedals in Central Pedals, the orchestra boards free;
  * a pedal whose LV2 plugin package isn't installed is left out of the chain (not the whole chain refused);
  * the orchestra builder (sounds-vsco.py): SFZ reading, a loop found in a held tone and the join without a click,
    a plucked note left to ring, levels, and the SoundFont it writes reads back (presets, samples, loops);
  * the computer rig gives the orchestra banks their plan from tiers.txt.
    python3 test_library.py"""
import importlib.util
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import instrument_host  # noqa: E402
import native_rig  # noqa: E402

spec = importlib.util.spec_from_file_location("sounds_vsco", os.path.join(HERE, "sounds-vsco.py"))
vsco = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vsco)

failures = []


def check(label, fn):
    try:
        fn()
        print("  ✓ " + label)
    except Exception as error:  # noqa: BLE001
        failures.append(label)
        print("  ✗ " + label + "\n      " + str(error).replace("\n", "\n      ")[:800])


def node_json(expr):
    return json.loads(subprocess.check_output(["node", "-e", 'const P=require("./js/pedals.js");console.log(JSON.stringify(%s))' % expr], cwd=HERE))


PEDALS = node_json("P.pedals")
BOARDS = node_json("P.boards")
with open(os.path.join(HERE, "instrument-plugins.json")) as handle:
    PLUGINS = json.load(handle)
NEW_96 = {"ace-comp": "plugins", "ace-exp": "plugins", "lsp-comp": "plugins", "lsp-gate": "plugins", "zam-multicomp": "plugins", "ace-eq": "plugins",
          "dpf-3band": "plugins", "fomp-para": "plugins", "ace-delay": "plugins", "mverb": "plugins", "gigaverb": "plugins", "ace-reverb": "plugins",
          "zita-rev": "plugins", "pingpong": "pedals", "zam-autosat": "pedals", "soulforce": "pedals", "bitcrush": "pedals", "fomp-autowah": "pedals",
          "cs-chorus": "pedals", "cs-phaser": "pedals", "rb-pitch": "pedals", "ma-pitch": "pedals"}


def t_catalogue():
    ids, bad = set(), []
    for p in PEDALS:
        if p["id"] in ids:
            bad.append("two pedals called " + p["id"])
        ids.add(p["id"])
        info = PLUGINS.get(p["uri"])
        if not info:
            if not p["uri"].startswith(("builtin:", "ladspa:")) and not p["opts"].get("ladspa"):
                bad.append("%s: %s isn't in instrument-plugins.json" % (p["id"], p["uri"]))
            continue
        syms = {c["sym"] for c in info["controls"]}
        bad += ["%s: knob %s -> %s isn't a control" % (p["id"], k, s) for k, s in p["knobs"].items() if s not in syms]
        bad += ["%s: starting value %s isn't a control" % (p["id"], s) for s in (p["opts"].get("values") or {}) if s not in syms]
        if info["ain"] < 1 or info["aout"] < 1 or info["aout"] > 2:
            bad.append("%s: %d in / %d out" % (p["id"], info["ain"], info["aout"]))
    assert not bad, "\n".join(bad[:20])
    assert len(PEDALS) >= 260, len(PEDALS)


def t_boards():
    by = {p["id"]: p for p in PEDALS}
    bad = []
    for b in BOARDS:
        for item in b["chain"]:
            p = by.get(item[0])
            if not p:
                bad.append("%s: no pedal %s" % (b["id"], item[0]))
                continue
            info = PLUGINS.get(p["uri"]) or {"controls": []}
            syms = {c["sym"] for c in info["controls"]}
            for label in (item[1] or {}):
                if label not in p["knobs"] and label not in syms and info["controls"]:
                    bad.append("%s: %s has no knob %s" % (b["id"], item[0], label))
    assert not bad, "\n".join(bad)


def t_plans():
    by = {p["id"]: p for p in PEDALS}
    wrong = ["%s is %s, not %s" % (i, by[i]["tier"], t) for i, t in NEW_96.items() if i not in by or by[i]["tier"] != t]
    assert not wrong, wrong
    boards = {b["id"]: b for b in BOARDS}
    for i in ("worship-strings", "cello-pad", "brass-swell", "flute-lead"):
        assert boards[i]["plans"] == [] and boards[i]["tier"] == "free", (i, boards[i]["plans"])
    assert boards["studio-keys-ace"]["plans"] == ["plugins"], boards["studio-keys-ace"]["plans"]
    assert boards["worship-grand"]["plans"][0] == "keys", "a board bringing a Central Keys sound still needs Central Keys"


def t_installed_filter():
    tmp = tempfile.mkdtemp(prefix="lv2-")
    try:
        os.makedirs(os.path.join(tmp, "a.lv2"))
        with open(os.path.join(tmp, "a.lv2", "manifest.ttl"), "w") as handle:
            handle.write('@prefix lv2: <http://lv2plug.in/ns/lv2core#> .\n@prefix zam: <urn:zamaudio:> .\n'
                         '<http://guitarix.sourceforge.net/plugins/gxbooster#booster> a lv2:Plugin .\nzam:ZamComp a lv2:Plugin .\n')
        have = instrument_host.installed_lv2_uris([tmp])
        assert "http://guitarix.sourceforge.net/plugins/gxbooster#booster" in have and "urn:zamaudio:ZamComp" in have, sorted(have)[:5]
        assert instrument_host.installed_lv2_uris([os.path.join(tmp, "none")]) == set()
        old = os.environ.get("LV2_PATH")
        os.environ["LV2_PATH"] = tmp
        try:
            host = instrument_host.InstrumentHost(None, tmp, HERE)
        finally:
            if old is None:
                os.environ.pop("LV2_PATH", None)
            else:
                os.environ["LV2_PATH"] = old
        assert host.plugin("http://guitarix.sourceforge.net/plugins/gxbooster#booster") and host.plugin("urn:zamaudio:ZamComp")
        assert host.plugin("urn:ardour:a-comp") is None, "a plugin that isn't installed is left out"
        assert host.plugin("ladspa:caps.so:Compress"), "LADSPA pedals are not filtered"
        host.lv2 = True
        conf = host.chain_conf("t", [{"uid": "a", "uri": "urn:ardour:a-comp", "on": True, "values": {}},
                                      {"uid": "b", "uri": "http://guitarix.sourceforge.net/plugins/gxbooster#booster", "on": True, "values": {}}], 1, 0, None, 0)
        assert "gxbooster" in conf and "a-comp" not in conf, "the chain keeps the installed pedal and skips the missing one"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


SR = 44100


def tone(seconds, f=220.0, vib=True):
    t = np.arange(int(seconds * SR)) / SR
    ph = 2 * np.pi * f * t + (0.6 * np.sin(2 * np.pi * 5.5 * t) if vib else 0)
    env = np.minimum(1, t / 0.15)
    return (0.3 * env * (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph))).astype(np.float32)


def t_sfz():
    text = ("<control>\ndefault_path=Strings\\Cello Section\\susvib\\\n<global>\nampeg_attack=0.002\nampeg_release=0.9\n<group>\n"
            "<region>\nsample=Cello A2 v1.wav\nlokey=55\nhikey=58\npitch_keycenter=57\nhivel=62\nvolume=6\n"
            "<region> sample=Cello A2 v2.wav lokey=55 hikey=58 pitch_keycenter=57 lovel=63 // comment\n")
    regions, path = vsco.parse_sfz(text)
    assert path == "Strings/Cello Section/susvib/", path
    assert [r["sample"] for r in regions] == ["Cello A2 v1.wav", "Cello A2 v2.wav"], regions
    assert regions[0]["ampeg_release"] == "0.9" and regions[1]["lovel"] == "63" and regions[0]["volume"] == "6", regions


def t_loop():
    x = tone(6.0)
    s, e = vsco.find_loop(x, SR)
    assert 0.4 * SR < s < e <= vsco.MAX_LOOP_END * SR + 1 and 0.6 * SR <= e - s <= 1.9 * SR, (s / SR, e / SR)
    pcm, ls, le = vsco.render_sample(x, SR, "sus", 1.0)
    assert (ls, le) == (s, e) and len(pcm) == e + 32, (ls, le, len(pcm))
    y = pcm.astype(np.float32) / 32768
    # the join: the last points before the end lead into the start without a step bigger than the tone's own
    joined = np.concatenate([y[le - 400:le], y[ls:ls + 400]])
    step = np.max(np.abs(np.diff(joined)))
    assert step < 1.6 * np.max(np.abs(np.diff(y[ls:le]))), step
    # a fading note: the loop ends while it still sounds full
    fade = tone(6.0) * np.concatenate([np.ones(int(2.0 * SR)), np.linspace(1, 0, int(1.0 * SR)), np.zeros(int(3.0 * SR))]).astype(np.float32)
    s2, e2 = vsco.find_loop(fade, SR)
    assert e2 <= 2.45 * SR, e2 / SR   # (it falls under 60 % at 2.4 s)
    # a plucked note keeps its ring and is never looped; a click above the ceiling is rounded off
    pluck = tone(5.0, vib=False) * np.exp(-np.arange(int(5.0 * SR)) / SR * 3).astype(np.float32)
    pcm2, a, b = vsco.render_sample(pluck, SR, "pluck", 1.0)
    assert a is None and len(pcm2) == int(3.5 * SR), (a, len(pcm2))
    spike = tone(3.0).copy()
    spike[SR] = 3.0
    pcm3, _, _ = vsco.render_sample(spike, SR, "sus", 1.0)
    assert np.max(np.abs(pcm3.astype(np.float32) / 32768)) <= vsco.PEAK + 1e-3


def t_sf2():
    tmp = tempfile.mkdtemp(prefix="vsco-")
    try:
        samples, zones = [], []
        for i, (root, f) in enumerate(((48, 130.81), (60, 261.63))):
            pcm, s, e = vsco.render_sample(tone(5.0, f), SR, "sus", 1.0)
            samples.append({"name": "t%d" % root, "pcm": pcm, "sr": SR, "root": root, "s": s, "e": e})
            zones.append([("keyRange", (0, 54) if i == 0 else (55, 127)), ("velRange", (0, 127)), ("attackVolEnv", vsco.tc(0.01)),
                          ("releaseVolEnv", vsco.tc(0.8)), ("overridingRootKey", root), ("sampleModes", 1), ("sampleID", i)])
        insts = [{"name": "test", "zones": zones}]
        presets = [{"name": "Test Strings", "prog": 0, "zones": [[("keyRange", (0, 127)), ("instrument", 0)]]},
                   {"name": "Test Pad", "prog": 1, "zones": [[("keyRange", (0, 127)), ("initialAttenuation", 75), ("instrument", 0)]]}]
        out = os.path.join(tmp, "Test - Test.sf2")
        vsco.write_sf2(out, "Test bank", samples, insts, presets)
        got = instrument_host.sf2_presets(out)
        assert [(p["prog"], p["name"]) for p in got] == [(0, "Test Strings"), (1, "Test Pad")], got
        with open(out, "rb") as handle:
            data = handle.read()
        assert data[:4] == b"RIFF" and data[8:12] == b"sfbk" and struct.unpack("<I", data[4:8])[0] == len(data) - 8
        i = data.find(b"INAM")
        n = struct.unpack("<I", data[i + 4:i + 8])[0]
        assert n % 2 == 0 and data[i + 8:i + 8 + n].rstrip(b"\0") == b"Test bank", "INFO texts are zero-ended and of even size"
        j = data.find(b"shdr")
        sh = data[j + 8:j + 8 + 46]
        st, en, ls, le, sr, root = struct.unpack("<IIIIIB", sh[20:41])
        assert sr == SR and root == 48 and st < ls < le < en and en - st == len(samples[0]["pcm"]), (st, en, ls, le)
        if shutil.which("fluidsynth"):   # FluidSynth (the keys engine) loads it
            r = subprocess.run(["fluidsynth", "-ni", "-r", "48000", "-F", os.path.join(tmp, "o.wav"), out], capture_output=True, text=True, timeout=60)
            assert "Failed to load" not in r.stdout + r.stderr and "invalid" not in r.stderr, r.stderr[-300:]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def t_banks_list():
    names = [p[0] for _, _, ps in vsco.BANKS for p in ps]
    for want in ("Worship Strings", "Cello Pad", "Cellos", "Contrabass", "French Horn", "Trumpet", "Brass Swell", "Flute", "Flute Lead", "Oboe", "Clarinet", "Bassoon"):
        assert want in names, want
    used = {layer[0] for _, _, ps in vsco.BANKS for _, layers in ps for layer in layers}
    assert used <= set(vsco.INSTR), used - set(vsco.INSTR)
    assert all(len(n) <= 19 for n in names), "SoundFont names are 19 characters at most"
    with open(os.path.join(HERE, "get-sounds.sh")) as handle:
        gs = handle.read()
    assert "sounds-vsco.py" in gs and 'VSCO_TIER="${VSCO_TIER:-free}"' in gs


def t_rig_plans():
    tmp = tempfile.mkdtemp(prefix="rig-")
    try:
        with open(os.path.join(tmp, "tiers.txt"), "w") as handle:
            handle.write("# prefix | plan\nVSCO-Strings|free|CC0|VSCO Strings\n")
        cat = [{"file": os.path.join(tmp, "VSCO-Strings - VSCO-Strings.sf2"), "presets": []}, {"file": os.path.join(tmp, "Kalimba.sf2"), "presets": []}]
        native_rig.bank_plans(cat)
        assert cat[0].get("tier") == "free" and "tier" not in cat[1], cat
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


print("Library: pedals, boards, plans")
check("every pedal's plugin is listed, its knobs and starting values are real controls, 1-2 outputs", t_catalogue)
check("every board is made of real pedals and knobs", t_boards)
check("9.6: studio tools in Central Plugins, pedals in Central Pedals; the orchestra boards free, Worship Grand still Central Keys", t_plans)
check("a pedal whose LV2 package isn't installed is left out of the chain (the rest of the chain still loads)", t_installed_filter)
print("Library: the orchestra (VSCO 2: CE -> SoundFonts)")
check("SFZ: regions with the global / group values, the sample path, comments", t_sfz)
check("a held note gets a loop (found by correlation, joined without a click); a fading note loops while full; a pluck rings; clicks rounded off", t_loop)
check("the SoundFont written reads back: presets, even-sized texts, sample headers with loops; FluidSynth loads it", t_sf2)
check("the orchestra presets (Worship Strings, Cello Pad, Brass Swell, Flute Lead...) and their plan (free) in get-sounds.sh", t_banks_list)
check("the computer rig gives a bank its plan from tiers.txt", t_rig_plans)
print("\n%s" % ("ALL LIBRARY CHECKS PASSED" if not failures else "%d CHECK(S) FAILED: %s" % (len(failures), failures)))
sys.exit(1 if failures else 0)
