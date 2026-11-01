#!/usr/bin/env python3
"""Central Pedal - the 30-second previews (10.2): tools/make-previews.py and what build-libraries.py does with them.

Made from small stand-ins (sine pads, click loops, a tiny SoundFont, synthetic IRs):
  - a pad style goes through its keys, a loop set plays its loops back to back, each groove alone; an instrument preset
    plays a phrase for its kind; a keys preset gets its sound with the preset's reverb; an IR gets a guitar through it
  - every preview is a 30-second MP3 at one loudness, its name the one the built-in list expects
  - the manifest's items name their previews; libraries-index.json lists them with their addresses; SHA256SUMS has them
  - the installers pass the previews on (libraries.py), and the hymns' preview is their chorus or their loudest part
Needs python3-numpy and ffmpeg (the instrument checks also need fluidsynth; without them they're skipped).

    python3 test_previews.py"""
import importlib.util
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave
import zipfile

import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "tools"))
FAILS = []


def check(cond, label, detail=None):
    print(("  ✓ " if cond else "  ✗ ") + label + ("" if cond or detail is None else "   -- %s" % (str(detail)[:600],)))
    if not cond:
        FAILS.append(label)


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MP = load("make_previews", "tools/make-previews.py")
BUILD = load("build_libraries", "tools/build-libraries.py")
V = load("sounds_vsco", "sounds-vsco.py")


def write_wav(path, x, sr=44100):
    x = np.asarray(x, np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(np.clip(np.round(x * 32767), -32768, 32767).astype("<i2").tobytes())
    return path


def tone(freqs, seconds, sr=44100, level=0.3):
    t = np.arange(int(seconds * sr)) / sr
    return sum(np.sin(2 * math.pi * f * t) for f in freqs) / len(freqs) * level


def mp3_info(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, "<i2").astype(np.float32) / 32768
    loud = x[np.abs(x) > 1e-4]
    return {"seconds": len(x) / 8000.0, "peak": float(np.max(np.abs(x))) if len(x) else 0, "rms_db": 20 * math.log10(float(np.sqrt(np.mean(loud ** 2))) + 1e-9) if len(loud) else -99,
            "late": float(np.max(np.abs(x[int(20 * 8000):int(25 * 8000)]))) if len(x) > 25 * 8000 else 0}


def main():
    if not shutil.which("ffmpeg"):
        print("  (no ffmpeg here: the preview checks are skipped)")
        return 0
    fluid = bool(shutil.which("fluidsynth"))
    tmp = tempfile.mkdtemp(prefix="cp-previews-")
    try:
        # ---- the stand-ins
        pads = os.path.join(tmp, "pad-loops")
        for style, mult in (("Warm", 1.0), ("Choir Aah", 1.5)):
            for i, key in enumerate(BUILD.PAD_KEYS):
                f0 = 130.81 * 2 ** (i / 12)
                write_wav(os.path.join(pads, BUILD.pad_loop_file(style, key)), tone([f0 * mult, f0 * 1.5 * mult, f0 * 2 * mult], 6.0, 32000), 32000)
        loops = os.path.join(tmp, "loops")
        idx = []
        for name in ("Worship Eighths", "Waltz"):
            for bpm in (70, 100):
                n = int(2 * 4 * 60 / bpm * 44100)
                x = np.zeros(n, np.float32)
                for b in range(8):
                    a = int(b * 60 / bpm * 44100)
                    x[a:a + 2000] += np.exp(-np.arange(2000) / 300.0) * (0.8 if b % 4 == 0 else 0.4)
                fn = "%s-%d.wav" % (name.lower().replace(" ", "-"), bpm)
                write_wav(os.path.join(loops, "drums", fn), x)
                idx.append({"name": name, "file": fn, "bpm": bpm, "meter": 4, "bars": 2})
        with open(os.path.join(loops, "drums", "index.json"), "w") as f:
            json.dump(idx, f)
        irs = os.path.join(tmp, "irs")
        rng = np.random.default_rng(1)
        for nm in ("Central Test 1x12", "Central Test Acoustic Body", "Central Test Bass 4x10"):
            ir = rng.normal(0, 1, 2400) * np.exp(-np.arange(2400) / 300.0)
            write_wav(os.path.join(irs, nm + ".wav"), ir / np.max(np.abs(ir)) * 0.9)
        sounds = os.path.join(tmp, "sounds")
        os.makedirs(sounds)
        sf2 = os.path.join(sounds, BUILD.sound_file("Central Keys Test Sounds"))
        t = np.arange(int(2.5 * 32000)) / 32000
        sine = (np.sin(2 * math.pi * 261.63 * t) * np.exp(-1.2 * t) * 0.8 * 32767).astype("<i2")
        V.write_sf2(sf2, "Central Keys Test Sounds", [{"name": "sine", "pcm": sine, "sr": 32000, "root": 60, "s": None, "e": None}],
                    [{"name": "sine", "zones": [[("keyRange", (0, 127)), ("overridingRootKey", 60), ("sampleID", 0)]]}],
                    [{"name": nm, "prog": i, "zones": [[("keyRange", (0, 127)), ("instrument", 0)]]} for i, nm in enumerate(["Test Grand Piano", "Test Warm Pad", "Test Sub Bass", "Test Saw Lead"])],
                    copyright="test", comment="test")
        lib = {"id": "central-keys-library", "plan": "keys", "version": "9.9", "title": "Test Library",
               "pads": [{"name": "Warm"}, {"name": "Choir Aah"}],
               "loops": [{"set": "drums", "name": "Drum loops"}],
               "sounds": [{"name": "Central Keys Test Sounds"}],
               "presets": [{"name": "Test Ballad", "kind": "keys", "chain": [["dfly-hall", {"Decay": 2.4}]], "sound": "test grand piano|central keys test sounds"}],
               "irs": [{"name": "Central Test 1x12"}, {"name": "Central Test Acoustic Body"}, {"name": "Central Test Bass 4x10"}]}

        print("The previews (tools/make-previews.py):")
        check(MP.kind_of("Concert Grand (Steinway B)") == "keys" and MP.kind_of("Warm Pad") == "sustain" and MP.kind_of("Jazz Bass") == "bass" and MP.kind_of("Alto Sax") == "melody"
              and MP.kind_of("Studio Kit") == "kit" and MP.kind_of("Glockenspiel") == "high" and MP.kind_of("Transitions (risers, swells, reverse cymbals)") == "hits" and MP.kind_of("Pipe Organ") == "sustain",
              "each instrument gets a phrase for its kind (keys, held chords, a bass line, a melody, a groove, bells high up, the hits)")
        ph = MP.phrase("Test Grand Piano", "keys")
        keys = [k for _, _, k, _ in ph]
        check(max(s + ln for s, ln, _, _ in ph) > 25 and max(keys) - min(keys) >= 24, "a keys phrase fills the 30 seconds and covers two octaves or more", (max(keys) - min(keys)))
        out = os.path.join(tmp, "out")
        items = [{"kind": "pad", "name": "Warm", "key": "C"}, {"kind": "loop", "name": "Waltz", "set": "drums"}, {"kind": "sound", "name": "Central Keys Test Sounds"},
                 {"kind": "preset", "name": "Test Ballad"}, {"kind": "ir", "name": "Central Test 1x12"}]
        logs = []
        made = MP.make_library_previews(lib, items, out, sounds, pads, loops, irs, BUILD.pad_loop_file, log=logs.append)
        kinds = sorted({m["kind"] for m in made})
        want_kinds = ["ir", "loop", "loops", "pad", "preset", "sound"] if fluid else ["ir", "loop", "loops", "pad"]
        check(kinds == want_kinds, "previews of the pads, the loop set, each groove%s and the IRs" % (", each instrument preset, the keys preset" if fluid else ""), (kinds, logs))
        infos = {m["file"]: mp3_info(os.path.join(out, m["file"])) for m in made}
        check(all(abs(i["seconds"] - 30) < 0.4 for i in infos.values()), "every preview is 30 seconds", {k: round(v["seconds"], 2) for k, v in infos.items()})
        check(all(-21 < i["rms_db"] < -12 and i["peak"] < 0.99 for i in infos.values()), "...at one loudness (about -16 dBFS RMS), peaks under full scale", {k: (round(v["rms_db"], 1), round(v["peak"], 2)) for k, v in infos.items()})
        check(all(i["late"] > 0.02 for i in infos.values()), "...and none goes quiet before its end (sound at 20-25 s)", {k: round(v["late"], 3) for k, v in infos.items()})
        check(all(m["file"].startswith("preview--central-keys--") and m["file"].endswith(".mp3") for m in made) and "preview--central-keys--pad--choir-aah.mp3" in infos
              and "preview--central-keys--loops--drum-loops.mp3" in infos and "preview--central-keys--ir--central-test-1x12.mp3" in infos,
              "named by library, kind and name (preview--central-keys--pad--choir-aah.mp3)", sorted(infos))
        check(items[0].get("preview") == "preview--central-keys--pad--warm.mp3" and items[1].get("preview") == "preview--central-keys--loop--waltz.mp3" and items[4].get("preview"),
              "the manifest's items name their previews", items)
        if fluid:
            check(items[2].get("previews") and items[2]["previews"][0] == ["Test Grand Piano", "preview--central-keys--sound--test-sounds--test-grand-piano.mp3"] and items[3].get("preview"),
                  "a SoundFont lists each preset's preview; a keys preset gets its sound's (with its reverb)", (items[2].get("previews"), items[3].get("preview")))
        else:
            print("  (no fluidsynth here: the instrument previews are skipped)")
        # the built-in list expects the same names
        banks = {"Central Keys Test Sounds": ["Test Grand Piano", "Test Warm Pad", "Test Sub Bass", "Test Saw Lead"]}
        expected = {p["file"] for p in BUILD.expected_previews(dict(lib, loops=[]), banks)}
        check(all(m["file"] in expected for m in made if m["kind"] not in ("loop", "loops")), "the built-in list expects the very names a build makes (so the website can list them before the index is out)",
              sorted(m["file"] for m in made if m["file"] not in expected))
        used = set()
        a, b = MP.unique_name("x-library", "sound", "Bank", "Electric Upright Bass", used), MP.unique_name("x-library", "sound", "Bank", "Electric Upright Bass (bowed)", used)
        check(a != b and b.endswith("-2.mp3"), "two presets that share their first 19 characters get different previews (-2)", (a, b))
        # the same preview every build
        out2 = os.path.join(tmp, "out2")
        made2 = MP.make_library_previews(dict(lib, sounds=[], presets=[], irs=[], loops=[]), [], out2, None, pads, None, None, BUILD.pad_loop_file, log=lambda *a: None)
        check([m["sha256"] for m in made2] == [m["sha256"] for m in made if m["kind"] == "pad"], "the same previews every build (same sounds, same files)")

        print("\nThe libraries' index and zips (tools/build-libraries.py):")
        defs = os.path.join(tmp, "libraries.json")
        with open(defs, "w") as f:
            json.dump({"libraries": [dict(lib, sounds=[], presets=[])]}, f)
        dist = os.path.join(tmp, "dist")
        index = BUILD.build_all(sounds, irs, dist, base_url="https://example.test/libs", definitions=defs, log=lambda *a: None, pads_dir=pads, loops_dir=loops, previews=True)
        e = index["libraries"][0]
        check(e["previews"] and all(p["url"] == "https://example.test/libs/" + p["file"] and os.path.isfile(os.path.join(dist, p["file"])) for p in e["previews"]),
              "libraries-index.json lists each preview with its address, next to the zip", e["previews"][:2])
        with zipfile.ZipFile(os.path.join(dist, e["file"])) as zf:
            man = json.loads(zf.read("manifest.json"))
        check(len(man["previews"]) == len(e["previews"]) and any(i.get("preview") for i in man["items"]) and not any(n.endswith(".mp3") for n in zf.namelist() if n.startswith("preview")),
              "the manifest lists them too (they stay out of the zip: they're for before the download)")
        sums = open(os.path.join(dist, "SHA256SUMS")).read()
        check(all(p["file"] in sums for p in e["previews"]), "SHA256SUMS has each preview")
        quiet = BUILD.build_all(sounds, irs, os.path.join(tmp, "dist2"), base_url="https://example.test/libs", definitions=defs, log=lambda *a: None, pads_dir=pads, loops_dir=loops)
        check(quiet["libraries"][0]["previews"] == [] and not [f for f in os.listdir(os.path.join(tmp, "dist2")) if f.startswith("preview--")], "--no-previews (and the tests' default): none made")
        built = BUILD.builtin_list()
        keys_lib = next(x for x in built if x["id"] == "central-keys-library")
        check(all(p["url"].startswith(BUILD.DEFAULT_BASE + "/preview--") for x in built for p in x["previews"]) and any(p["kind"] == "sound" for p in keys_lib["previews"])
              and any(p["kind"] == "ir" for x in built for p in x["previews"]) and any(p["kind"] == "pad" for x in built for p in x["previews"]),
              "the built-in list (server/src/libraries-builtin.json) names every library's previews", len(keys_lib["previews"]))
        with open(os.path.join(ROOT, "server", "src", "libraries-builtin.json")) as f:
            check(json.load(f)["libraries"] == json.loads(json.dumps(built)), "server/src/libraries-builtin.json is up to date (tools/build-libraries.py --write-builtin)")

        print("\nThe installers and the hymns:")
        sys.path.insert(0, ROOT)
        L = load("libraries_mod", "libraries.py")
        got = L.previews_of({"previews": [{"kind": "pad", "name": "Warm", "file": "preview--x--pad--warm.mp3"}, {"kind": "evil", "file": "x.mp3"}, {"kind": "pad", "name": "Bad", "file": "../../etc.mp3"}]}, "https://h.test/rel")
        check(got == [{"kind": "pad", "name": "Warm", "url": "https://h.test/rel/preview--x--pad--warm.mp3", "seconds": 30}], "the Central Pedal's installer passes on a library's previews (and only real ones, next to its zip)", got)
        H = load("make_hymns", "tools/make-hymns.py")
        sr = H.SR
        secs = [{"name": "Verse 1", "start": 1}, {"name": "Chorus", "start": 9}, {"name": "Verse 2", "start": 17}, {"name": "Chorus", "start": 25}]
        mix = np.zeros((int(120 * sr), 2), np.float32)
        a = H.preview_start(secs, 2.0, mix)
        check(a == int(24 * 2.0 * sr), "a hymn's preview starts at its second chorus, once the song has built", a / sr)
        loud = np.zeros((int(120 * sr), 2), np.float32)
        loud[int(70 * sr):int(100 * sr)] = 0.5
        a = H.preview_start([{"name": "Verse 1", "start": 1}, {"name": "Verse 2", "start": 9}], 2.0, loud)
        check(68 * sr <= a <= 71 * sr and H.PREVIEW_SECONDS == 30, "...and a hymn without a chorus: its loudest 30 seconds (the hymns' previews are 30 seconds now)", a / sr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n%s" % ("%d FAILED" % len(FAILS) if FAILS else "all passed"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
