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
    check("four libraries, one for each plan", sorted(l["plan"] for l in defs) == ["instrument", "keys", "pedals", "plugins"], [l["plan"] for l in defs])
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
    by = {l["plan"]: l for l in defs}
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
    check("the cabinets roll off above the speaker's range", all(rolled) and len(rolled) == 10, rolled)
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
    banks = {b[0] for b in VCSL.BANKS}
    want = {s["name"] for l in defs for s in l.get("sounds") or []}
    check("every sound the libraries list is a bank the builder makes", want <= banks, want - banks)

    print("\nThe zips (tools/build-libraries.py):")
    snd = os.path.join(tmp, "sounds")
    os.makedirs(snd)
    for s in want:
        tiny_sf2(os.path.join(snd, BUILD.sound_file(s)), s)
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
    check("each manifest lists its items with their sha256, every one with the library's plan; CREDITS.txt inside", ok_items and tiers_ok and files_ok)
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
    check("Central Keys installs: its three banks and its presets", rec["counts"]["sound"] == 3 and rec["counts"]["preset"] == len(by["keys"]["presets"]) and all(os.path.isfile(p) for p in rec["sounds"]), rec["counts"])
    catalog = [{"file": p, "name": "x"} for p in rec["sounds"]]
    native_rig.bank_plans(catalog)
    check("the rig's sound list gives each bank its plan (keys) - locked without Central Keys though anyone can download it", [b.get("tier") for b in catalog] == ["keys"] * 3, catalog)
    check("presets come with the library's plan for the Instrument page", all(p["tier"] == "keys" and p["library"] == "central-keys-library" for p in rec["presets"]))
    prec = store.install_file(os.path.join(out, pedals_e["file"]), expected_sha256=pedals_e["sha256"])
    irs = native_rig.ir_plans([{"file": p} for p in prec["irs"]])
    check("Central Pedals installs its IRs into the IR folder, each with the pedals plan", len(irs) == 14 and all(i.get("tier") == "pedals" for i in irs), irs[:2])

    print("\nThe installer - the Central Pedal's host:")
    host = instrument_host.InstrumentHost(None, os.path.join(tmp, "pi"), HERE)
    pstore = libraries.LibraryStore(os.path.join(tmp, "pi"), host)
    pstore.install_file(kzip, expected_sha256=keys["sha256"])
    pstore.install_file(os.path.join(out, pedals_e["file"]), expected_sha256=pedals_e["sha256"])
    cat = [b for b in host.keys_catalog() if b["file"].startswith(host.sf2_user_dir)]
    check("its keys catalog lists the library's banks with the keys plan, not as the user's own", len(cat) == 3 and all(b.get("tier") == "keys" and not b.get("user") for b in cat), [(b["name"], b.get("tier"), b.get("user")) for b in cat])
    pir = host.ir_list()
    check("its IR list gives the library's IRs the pedals plan", len(pir) == 14 and all(i.get("tier") == "pedals" for i in pir), pir[:2])
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
    check("a newer version replaces the older one (the bank it no longer has is gone, with its plan line)", r2["version"] == "1.1" and r2["counts"]["sound"] == 2 and not os.path.exists(os.path.join(rig.sf2_user_dir, os.path.basename(drop["file"])))
          and os.path.basename(drop["file"]).split(" - ")[0] not in tiers, tiers)
    check("libraries.newer compares versions", libraries.newer("1.10", "1.9") and not libraries.newer("1.0", "1.0"))
    store.remove("central-keys-library")
    store.remove("central-pedals-library")
    left = [f for f in os.listdir(rig.sf2_user_dir) if f.endswith(".sf2")] + [f for f in os.listdir(rig.ir_dir) if f.endswith(".wav")]
    check("Remove takes every file and plan line the libraries added away", not left and not store.installed() and "central-" not in open(os.path.join(rig.sf2_user_dir, "tiers.txt")).read(), left)

    print("\nDownloads:")
    payload = open(kzip, "rb").read()

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/%s" % (srv.server_address[1], keys["file"])
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
    check("a good download installs", r3["version"] == "1.0" and r3["counts"]["sound"] == 3 and r3["source"] == "website")
    srv.shutdown()
    leftovers = [f for f in os.listdir(store.root) if f.endswith(".zip")]
    check("no downloaded zip is left behind", not leftovers, leftovers)


if __name__ == "__main__":
    sys.exit(main())
