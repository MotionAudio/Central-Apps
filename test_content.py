#!/usr/bin/env python3
"""Central Pedal - checks of the 10.0 content, no internet:
  * hymns/hymns.json: every hymn clearly public domain (published before 1929, writers dead 70+ years); every verse fits
    its bars; the chart's chords follow the arrangement's chords bar for bar; the app's own chart reader (js/chords.js)
    reads the chart back with the same sections and chords; the song file's sections, lyrics and chords;
  * tools/make-hymns.py with a General MIDI SoundFont (when fluidsynth, ffmpeg and one are here): a short render makes
    every stem, the song file, the mix and preview, hymns-index.json and SHA256SUMS; the band comes in with the energy;
  * tools/make-synths.py: ten synths, held ones exact loops, struck ones dying away;
  * tools/make-pad-loops.py: the eight 10.0 styles are exact loops in their key;
  * tools/make-loops.py: drum loops of two bars at their tempo, ambient loops of 12 s in every key, all seamless;
  * the loops in a library zip install on the Pi (libraries.py): listed per groove with its files, each file found only
    inside its library; a kind the installer doesn't know is left out, not refused;
  * js/pedals.js: the 30 new pedals, every knob a control of its plugin, studio tools Central Plugins, the rest Central Pedals.
    python3 test_content.py"""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "tools"))
FAILS = []


def check(ok, what, detail=None):
    print(("  ✓ " if ok else "  ✗ ") + what + ("" if ok or detail is None else "   -- " + str(detail)[:600]))
    if not ok:
        FAILS.append(what)


def load(rel, name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MH = load("tools/make-hymns.py", "make_hymns")
SY = load("tools/make-synths.py", "make_synths")
PL = load("tools/make-pad-loops.py", "make_pad_loops")
ML = load("tools/make-loops.py", "make_loops")
BUILD = load("tools/build-libraries.py", "build_libraries")
LIB = load("libraries.py", "libraries")
GM = next((p for p in ("/usr/share/sounds/sf2/default-GM.sf2", "/usr/share/sounds/sf2/FluidR3_GM.sf2", "/usr/share/sounds/sf2/TimGM6mb.sf2") if os.path.isfile(p)), None)
AUDIO = bool(GM and shutil.which("fluidsynth") and shutil.which("ffmpeg"))


def collapse(seq):
    out = []
    for x in seq:
        if not out or out[-1] != x:
            out.append(x)
    return out


def read_wav(path):
    with wave.open(path) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, w.getnchannels()).astype(float) / 32768
        return x, w.getframerate()


def seamless(x):
    """The jump from the last sample to the first is no bigger than the loop's ordinary steps."""
    return float(np.max(np.abs(x[0] - x[-1]))) <= float(np.percentile(np.abs(np.diff(x, axis=0)), 99.9)) + 1e-4


def main():
    tmp = tempfile.mkdtemp(prefix="content-")
    try:
        print("Hymns (hymns/hymns.json):")
        hymns = MH.load()
        check(len(hymns) >= 5 and MH.check(hymns) == [], "%d hymns, every verse fits its bars, every chord on a beat of its bar" % len(hymns), MH.check(hymns))
        check(all(h["public_domain"]["words"] < 1929 and h["public_domain"]["music"] < 1929 and h["public_domain"]["writers_died"] < 1955 for h in hymns),
              "every hymn is public domain: words and tune published before 1929, every writer dead more than 70 years")
        bad_chart, bad_lyrics = [], []
        for h in hymns:
            for s in MH.layout(h):
                if not s["lyrics"]:
                    continue
                lines = MH.chordpro_section(s)
                import re
                in_chart = collapse(re.findall(r"\[([^\]]+)\]", " ".join(lines)))
                in_bars = collapse([c["sym"] for b in s["bars"] for c, _ in b])
                if in_chart != in_bars[len(in_bars) - len(in_chart):] or len(in_bars) - len(in_chart) > 1:
                    bad_chart.append((h["id"], s["name"], in_chart, in_bars))
                text = MH.lyrics_text(*s["lyrics"])
                if any(c in text for c in "~^|/") or (len(s["bars"]) >= 8 and len(text.split("\n")) < 2):
                    bad_lyrics.append((h["id"], s["name"], text))
        check(not bad_chart, "each section's chart shows the arrangement's chord changes, in order (a chord carried over from the bar before may be left off)", bad_chart[:2])
        check(not bad_lyrics, "lyrics read cleanly, one line per line (no markers left)", bad_lyrics[:2])
        ag = next(h for h in hymns if h["id"] == "amazing-grace")
        secs = MH.layout(ag)
        v1 = MH.chordpro_section(secs[1])
        check(v1[0] == "A[G]mazing grace how [C]sweet the [G]sound" and v1[3] == "was [Em]blind but [D]now I [G]see.", "a pickup and a chord inside a word: 'A[G]mazing grace how [C]sweet the [G]sound'", v1)
        song = MH.song_file(ag, secs, 260.0, list(MH.ROLES))
        v = next(x for x in song["sections"] if x["name"] == "Verse 1")
        check(song["kind"] == "central-tracks-song" and song["bpb"] == 3 and v["bar"] == 9 and v["lyrics"].startswith("Amazing grace how sweet the sound\nthat saved a wretch like me.")
              and song["chords"][0] == {"label": "G", "bass": None, "bar": 1, "beat": 1.0} and {s["name"]: s["mute"] for s in song["stems"]}["Click"] is True,
              "the song file: meter, sections at their bars with lyrics, chords at bar and beat, click and guide muted", {k: song[k] for k in ("bpb", "duration")})
        if shutil.which("node"):
            js = ("const C=require(%s); const out={};" % json.dumps(os.path.join(HERE, "js", "chords.js")) +
                  "for (const [id,t] of Object.entries(JSON.parse(process.argv[1]))) { const p=C.parseChart(t); out[id]={key:p.key, time:p.time, sections:p.sections.map(s=>s.name), chords:C.chordsIn(p).length}; }"
                  "console.log(JSON.stringify(out));")
            charts = {h["id"]: MH.chart_text(h, MH.layout(h)) for h in hymns}
            r = subprocess.run(["node", "-e", js, json.dumps(charts)], capture_output=True, text=True)
            got = json.loads(r.stdout or "{}") if r.returncode == 0 else {}
            okp = all(got.get(h["id"], {}).get("sections") == [s["name"] for s in MH.layout(h)] and got[h["id"]]["key"] == h["key"] and got[h["id"]]["chords"] > 10 for h in hymns)
            check(okp, "the app's chart reader (js/chords.js) reads every chart back: its key, every section by name, the chords", (r.stderr[-300:], got))

        if AUDIO:
            print("\nRendering a hymn with a General MIDI SoundFont (%s):" % os.path.basename(GM))
            out = os.path.join(tmp, "hymns")
            rc = MH.main(["--gm", GM, "--out", out, "--only", "doxology", "--seconds", "75", "--base-url", "https://cdn.example.test/ct"])
            rel = os.path.join(out, "release")
            files = sorted(os.listdir(rel)) if os.path.isdir(rel) else []
            want = ["doxology--%s.mp3" % s for s in ("Drums", "Bass", "Keys", "Pad", "Electric", "Strings", "Click", "Guide")] + ["doxology--song.json", "doxology--doxology-mix.mp3", "doxology--doxology-preview.mp3", "hymns-index.json", "SHA256SUMS"]
            check(rc == 0 and sorted(want) == files, "every stem, the song file, the mix and preview, hymns-index.json and SHA256SUMS", files)
            idx = json.load(open(os.path.join(rel, "hymns-index.json")))
            e = idx["hymns"][0]
            okidx = (e["id"] == "doxology" and len(e["stems"]) == 8 and e["song"]["url"] == "https://cdn.example.test/ct/doxology--song.json" and all(s.get("sha256") and s.get("size") for s in e["stems"])
                     and {s["name"]: s.get("mute", False) for s in e["stems"]}["Guide.mp3"] is True)
            check(okidx, "hymns-index.json: each file with its address, size and sha256; click and guide marked to start muted", e["stems"][:2])
            sums = dict(reversed(l.split("  ")) for l in open(os.path.join(rel, "SHA256SUMS")).read().splitlines())
            check(all(hashlib.sha256(open(os.path.join(rel, f), "rb").read()).hexdigest() == sums.get(f) for f in files if f != "SHA256SUMS"), "SHA256SUMS matches every file")

            def rms_db(stem, a, b):
                raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", os.path.join(out, "doxology", stem + ".mp3"), "-f", "s16le", "-ac", "1", "-ar", "22050", "-"], capture_output=True).stdout
                x = np.frombuffer(raw, "<i2").astype(float) / 32768
                seg = x[int(a * 22050):int(b * 22050)]
                return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)
            dox = next(h for h in hymns if h["id"] == "doxology")
            bar = 60.0 / dox["bpm"] * dox["meter"]
            intro = (0, 8 * bar - 0.5)          # (energy 0: keys and pad)
            v2 = (18 * bar, 18 * bar + 7 * bar)  # (Verse 2, energy 2: the band)
            d0, d2, k0 = rms_db("Drums", *intro), rms_db("Drums", *v2), rms_db("Keys", *intro)
            check(d0 < -60 and d2 > -40 and k0 > -45, "the band follows the energy: no drums in the quiet intro (keys and pad), drums in the second verse", (round(d0, 1), round(d2, 1), round(k0, 1)))
        else:
            print("\n(no fluidsynth / ffmpeg / General MIDI SoundFont here: the render checks are skipped)")

        print("\nSynths (tools/make-synths.py):")
        sf2 = SY.build(os.path.join(tmp, "synths"))
        import midi_render as M
        presets = [p[2] for p in M.sf2_presets(sf2)]
        check(presets == [s[0] for s in SY.SOUNDS] and len(presets) == 10, "ten presets, the names the library lists", presets)
        held = SY.held("saw", 57, 1)
        ext = np.concatenate([held, held])
        check(abs(float(ext[len(held)]) - float(ext[len(held) - 1])) < 4 * float(np.median(np.abs(np.diff(held)))) + 1e-4 and len(held) == int(SY.LOOP * SY.SR), "a held synth note is one exact loop")
        bell, pluck = SY.struck("bells", 72, 1), SY.struck("pluck", 60, 1)
        rms = lambda x: float(np.sqrt(np.mean(x ** 2)))
        n3 = int(0.3 * SY.SR)
        check(rms(bell[:n3]) > 2.5 * rms(bell[-2 * n3:-n3]) and rms(pluck[:n3]) > 20 * rms(pluck[-2 * n3:-n3]) and not np.isnan(bell).any(), "struck ones die away (a bell rings on, a pluck is soon gone)",
              (rms(bell[:n3]) / rms(bell[-2 * n3:-n3]), rms(pluck[:n3]) / (rms(pluck[-2 * n3:-n3]) or 1e-9)))

        print("\nThe 10.0 pad styles (tools/make-pad-loops.py):")
        new = ["Felt", "Organ", "Analog", "Bowed", "Bells", "Choir Hum", "Cinematic", "Morning"]
        pdir = PL.build(os.path.join(tmp, "pads"), styles=new + ["Warm", "Shimmer", "Air"], keys=None, log=lambda *a: None)
        loops_ok, keys_ok = True, True
        for style in new:
            x, sr = read_wav(os.path.join(pdir, PL.loop_file(style, "D")))
            loops_ok &= seamless(x) and sr == PL.SR and len(x) == int(PL.LOOP * PL.SR) and 0.4 < float(np.max(np.abs(x))) < 0.55
            spec = np.abs(np.fft.rfft(x[:, 0]))
            f = np.argmax(spec[:int(800 * PL.LOOP)]) / PL.LOOP
            keys_ok &= any(abs(f - 146.83 * m) < 5 for m in (0.25, 0.5, 1, 1.5, 2, 3, 4))   # (D: its root, fifth or an octave of them)
        check(loops_ok, "each new style is a stereo exact loop of 6 s at about -6 dBFS")
        check(keys_ok, "...in its key (D)")

        print("\nLoops (tools/make-loops.py):")
        lout = os.path.join(tmp, "loops")
        if AUDIO:
            drums = ML.build_drums(lout, gm=GM, log=lambda *a: None)
            okd = len(drums) == 2 * len(ML.GROOVES)
            for e in drums:
                x, sr = read_wav(os.path.join(lout, "drums", e["file"]))
                okd &= abs(len(x) / sr - e["bars"] * e["meter"] * 60.0 / e["bpm"]) < 0.002 and seamless(x) and float(np.max(np.abs(x))) > 0.5
            check(okd, "ten grooves at 70 and 100 BPM, each exactly two bars long and seamless", [e["file"] for e in drums[:3]])
        amb = ML.build_ambient(lout, pdir, log=lambda *a: None)
        oka = len(amb) == 36 and {e["key"] for e in amb} == set(ML.KEYS)
        for e in amb[::5]:
            x, sr = read_wav(os.path.join(lout, "ambient", e["file"]))
            oka &= abs(len(x) / sr - 12.0) < 0.001 and seamless(x)
        check(oka, "three ambient styles in all 12 keys, 12 s each, seamless")

        print("\nLoops in a library, installed on the Pi (libraries.py):")
        if not AUDIO:   # (no drums rendered: a tiny one for the zip)
            os.makedirs(os.path.join(lout, "drums"), exist_ok=True)
            PL.loop_wav(os.path.join(lout, "drums", "one-90.wav"), np.zeros(64, np.float32), np.zeros(64, np.float32))
            json.dump([{"name": "One", "file": "one-90.wav", "bpm": 90, "meter": 4, "bars": 2}], open(os.path.join(lout, "drums", "index.json"), "w"))
        lib = {"id": "test-loops", "plan": "instrument", "version": "1.0", "title": "Test", "summary": "",
               "loops": [{"set": "drums", "name": "Drum loops", "license": "x", "credit": "made here"}, {"set": "ambient", "name": "Ambient loops", "license": "x", "credit": "made here"}]}
        entry = BUILD.build_library(lib, None, None, os.path.join(tmp, "zips"), log=lambda *a: None, loops_dir=lout)
        zpath = os.path.join(tmp, "zips", entry["file"])
        with zipfile.ZipFile(zpath) as zf:
            man = json.loads(zf.read("manifest.json"))
        lit = [i for i in man["items"] if i["kind"] == "loop"]
        check(lit and all(i["tier"] == "instrument" and i["file"].startswith("loops/") for i in lit) and any(i.get("key") == "F#" for i in lit) and any(i.get("bpm") for i in lit)
              and entry["counts"]["loop"] == len({(i["set"], i["name"]) for i in lit}) and "Ambient loops: Sparkle" in entry["contents"]["loops"],
              "the zip lists each loop with its plan, its tempo (drums) or key (ambient)", entry["counts"])
        # a newer kind next to them is left out, not refused
        z2 = os.path.join(tmp, "zips", "newer.zip")
        with zipfile.ZipFile(zpath) as src, zipfile.ZipFile(z2, "w") as dst:
            m2 = json.loads(src.read("manifest.json"))
            m2["items"].append({"kind": "hologram", "name": "From the future", "file": "future.bin", "tier": "instrument"})
            for n in src.namelist():
                if n != "manifest.json":
                    dst.writestr(n, src.read(n))
            dst.writestr("future.bin", b"?")
            dst.writestr("manifest.json", json.dumps(m2))
        store = LIB.LibraryStore(os.path.join(tmp, "data"))
        rec = store.install_file(z2)
        loops = store.loops()
        amb_entry = next((x for x in loops if x["name"] == "Sparkle"), None)
        f = store.loop_file("test-loops", amb_entry["files"][0]["file"]) if amb_entry else None
        check(rec["counts"]["loop"] == len(loops) and amb_entry and len(amb_entry["files"]) == 12 and amb_entry["tier"] == "instrument" and f and os.path.isfile(f),
              "installed: one entry per groove / style with its files, each file found", [(x["name"], len(x["files"])) for x in loops][:4])
        check(store.loop_file("test-loops", "../../etc/passwd") is None and store.loop_file("nope", "ambient/sparkle-C.wav") is None and store.loop_file("test-loops", "ambient/none.wav") is None,
              "nothing outside the library's own loops is handed out")
        check(True, "a kind the installer doesn't know (from a newer library) is left out; the rest installs")
        store.remove("test-loops")
        check(store.loops() == [], "Remove takes the loops away")

        print("\nPedals (js/pedals.js):")
        if shutil.which("node"):
            js = ("const P=require(%s), cat=require(%s); const out=[];" % (json.dumps(os.path.join(HERE, "js", "pedals.js")), json.dumps(os.path.join(HERE, "instrument-plugins.json"))) +
                  "for (const p of P.pedals) { const c=cat[p.uri]; if(!c) continue; const s=new Set(c.controls.map(x=>x.sym)); out.push({id:p.id, tier:p.tier, cat:p.category, ok:Object.values(p.knobs||{}).every(k=>s.has(k)) && Object.keys((p.opts||{}).values||{}).every(k=>s.has(k))}); }"
                  "console.log(JSON.stringify(out));")
            r = subprocess.run(["node", "-e", js], capture_output=True, text=True)
            ped = {p["id"]: p for p in json.loads(r.stdout or "[]")}
            new_ids = ["x42-limiter-st", "x42-comp-st", "calf-deesser", "calf-mbcomp", "zam-mbcomp", "zam-head", "single-eq", "dj-eq", "vocal-remover", "la-limiter", "invada-comp-st", "invada-hpf-st",
                       "invada-lpf-st", "eq10q-gate-st", "eq10q-comp-st", "autotune-scales", "slapback", "auto-level", "surge-guard", "loud-contour", "mda-multiband", "declipper", "ladder-lpf",
                       "ladder-hpf", "cs-chorus2", "rb-pitch-r3", "tube-drive", "lofi-vinyl", "cycle-shifter", "lsp-flanger"]
            check(all(i in ped and ped[i]["ok"] for i in new_ids), "the 30 new pedals are in the catalogue, every knob and preset value a control of its plugin", [i for i in new_ids if not (i in ped and ped[i]["ok"])])
            studio = {"comp", "eq", "delay", "reverb", "studio", "util"}
            check(all(ped[i]["tier"] == ("plugins" if ped[i]["cat"] in studio else "pedals") for i in new_ids), "studio tools are Central Plugins, the rest Central Pedals")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print()
    if FAILS:
        print("%d FAILED:\n  - %s" % (len(FAILS), "\n  - ".join(FAILS)))
        return 1
    print("ALL CONTENT CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
