#!/usr/bin/env python3
"""Central Pedal - builds the SFZ-based banks of the sound libraries: drum kits, guitars, basses and saxophones from
the sfzinstruments / Karoryfer Samples libraries, every one CC0 1.0 (each repository's LICENSE file; the Karoryfer
readmes add "Royalty-free for all commercial and non-commercial use"). Run by tools/build-libraries.sh (in CI).

Each instrument is an SFZ program read with tools/sfz_render.py and rendered at its default settings: for every sampled
key and velocity layer, the regions that sound (all its microphones, first round robin) are mixed into one mono note -
small SoundFonts that FluidSynth on the Pi and the computers' rig both play. Pitched instruments are levelled like the
orchestra; a drum kit keeps its own balance (one gain for the whole kit). Samples are fetched one at a time from
raw.githubusercontent.com at a pinned commit and deleted once used.

    python3 tools/sounds-sfz.py <download cache> <out folder> [--only BANK] [--plan]
--plan: read the SFZ programs and print what each bank would hold (no samples downloaded).
Needs python3-numpy, ffmpeg (FLAC samples) and the internet."""
import importlib.util
import os
import subprocess
import sys
import urllib.parse

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sfz_render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("sounds_vsco", os.path.join(os.path.dirname(HERE), "sounds-vsco.py"))
V = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(V)
_spec2 = importlib.util.spec_from_file_location("sounds_vcsl", os.path.join(HERE, "sounds-vcsl.py"))
VC = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(VC)

# the libraries (all CC0 1.0 - checked in each repository's LICENSE)
SOURCES = {
    "virtuosity": ("sfzinstruments/virtuosity_drums", "9f04cf9a734527edfbb0a4eee1f674e45bbf71bc", "Virtuosity Drums - Austin McMahon, recorded at Virtuosity Musical Instruments, Boston"),
    "rusty": ("sfzinstruments/karoryfer.big-rusty-drums", "f07ce00df34a46b6b08375be56fe116cf15782bc", "Big Rusty Drums - Karoryfer Samples"),
    "unruly": ("sfzinstruments/karoryfer.unruly-drums", "9bf75c2a1392f190cd1c264645653629f0b3a097", "Unruly Drums - Karoryfer Samples"),
    "bngg": ("sfzinstruments/karoryfer.black-and-green-guitars", "b3b3249d37dc977a1a297bd2dc053e6d9b6b805c", "Black And Green Guitars - Karoryfer Samples (Gretsch Anniversary, Hofner Club; Brian Wood)"),
    "emily": ("sfzinstruments/karoryfer.emilyguitar", "b4920dc662fd9cad6dcaccdeecffdd91c8725d8c", "Emily Guitar - Karoryfer Samples (Epiphone, D. Smolken)"),
    "meat": ("sfzinstruments/karoryfer.meatbass", "ac9e859564bda286ab5ec672d00ff1aa2fef2895", "Meatbass - Karoryfer Samples (1958 Otto Rubner double bass, Drogomir Smolken)"),
    "growly": ("sfzinstruments/karoryfer.growlybass", "4f483268fc66b5a6d5781d421c0d11b8d08d3fc6", "Growlybass - Karoryfer Samples (Squier Jazz Bass)"),
    "bigbass": ("sfzinstruments/karoryfer.big-little-bass", "4e92bdf54dcd2d6cfad968cc90542d5461c9b9fc", "Big Little Bass - Karoryfer Samples (Washburn AB95)"),
    "weresax": ("sfzinstruments/karoryfer.weresax", "a4d756b21d2a573aca0d840cce7e71ba5effd4c6", "Weresax - Karoryfer Samples (alto saxophone)"),
    "bearsax": ("sfzinstruments/karoryfer.bear-sax", "7abb3c652525a15dfac80e1b5dfbba9964ee568f", "Bear Sax - Karoryfer Samples (1926 Conn baritone saxophone)"),
}
LICENSE = "CC0 1.0"

# instrument id -> source, SFZ program, kind (drum / decay / sus), keys rendered (lo, hi), seconds kept, controllers,
# samples left out (a pattern on the path), most velocity layers
INSTR = {
    "studiokit": dict(src="virtuosity", program="Programs/01-basic-kit.sfz", kind="drum", keys=(35, 81), cut=3.0, layers=4),
    "rustykit": dict(src="rusty", program="Programs/02-basic.sfz", kind="drum", keys=(35, 81), cut=3.0, layers=4),
    "unrulykit": dict(src="unruly", program="Programs/01-kit-sticks.sfz", kind="drum", keys=(35, 81), cut=3.0, layers=4),
    "brushkit": dict(src="unruly", program="Programs/02-kit-brushes.sfz", kind="drum", keys=(35, 81), cut=3.0, layers=3),
    "green": dict(src="bngg", program="Programs/04-green_twang.sfz", kind="decay", keys=(28, 88), cut=4.0, layers=3, exclude=r"(?i)noise|feedback|release|rel_"),
    "black": dict(src="bngg", program="Programs/07-black_twang.sfz", kind="decay", keys=(28, 88), cut=4.0, layers=3, exclude=r"(?i)noise|feedback|release|rel_"),
    "emily": dict(src="emily", program="emily_clean.sfz", kind="decay", keys=(28, 88), cut=4.0, layers=3, exclude=r"(?i)noise|release|rel_|mute"),
    "pizz": dict(src="meat", program="Programs/04_pizz.sfz", kind="decay", keys=(24, 72), cut=3.5, layers=3, exclude=r"(?i)noise|perc|knock|slap"),
    "arco": dict(src="meat", program="Programs/02_arco_3vel.sfz", kind="sus", keys=(24, 72), layers=2, exclude=r"(?i)noise|release|rel_"),
    "jazzbass": dict(src="growly", program="growlybass_clean.sfz", kind="decay", keys=(23, 72), cut=3.5, layers=3, exclude=r"(?i)scrape|noise|release|rel_"),
    "bigbass": dict(src="bigbass", program="Programs/01-big_little_pluck.sfz", kind="decay", keys=(23, 72), cut=3.5, layers=3, exclude=r"(?i)noise|release|rel_"),
    "altosax": dict(src="weresax", program="Programs/Sax.sfz", kind="sus", keys=(40, 90), layers=2, exclude=r"(?i)noise|breath|key|release|rel_"),
    "barisax": dict(src="bearsax", program="Programs/2-solo-poly.sfz", kind="sus", keys=(24, 70), layers=2, exclude=r"(?i)noise|breath|growl|sub_|release|rel_"),
}

# bank -> (plan, presets: (name, [(instrument, key lo, key hi, attack, release or None, dB)]))
BANKS = [
    ("Central Instrument Drum Kits", "instrument", [
        ("Studio Kit", [("studiokit", 0, 127, 0.001, None, 0)]),
        ("Rusty Rock Kit", [("rustykit", 0, 127, 0.001, None, 0)]),
        ("Unruly Kit", [("unrulykit", 0, 127, 0.001, None, 0)]),
        ("Brushes Kit", [("brushkit", 0, 127, 0.001, None, 0)]),
    ]),
    ("Central Instrument Guitars and Basses", "instrument", [
        ("Hollowbody Guitar (Gretsch)", [("green", 0, 127, 0.002, 0.4, 0)]),
        ("Archtop Guitar (Hofner)", [("black", 0, 127, 0.002, 0.4, 0)]),
        ("Electric Guitar Clean", [("emily", 0, 127, 0.002, 0.35, 0)]),
        ("Upright Bass", [("pizz", 0, 127, 0.002, 0.35, 0)]),
        ("Upright Bass (bowed)", [("arco", 0, 127, 0.08, 0.5, 0)]),
        ("Jazz Bass", [("jazzbass", 0, 127, 0.002, 0.25, 0)]),
        ("Acoustic Bass (hollowbody)", [("bigbass", 0, 127, 0.002, 0.3, 0)]),
    ]),
    ("Central Instrument Saxophones", "instrument", [
        ("Alto Sax", [("altosax", 0, 127, 0.03, 0.3, 0)]),
        ("Baritone Sax", [("barisax", 0, 127, 0.03, 0.3, 0)]),
        ("Sax Section", [("barisax", 0, 52, 0.04, 0.35, -2), ("altosax", 53, 127, 0.04, 0.35, -2)]),
    ]),
]
COPYRIGHT = "CC0 1.0 - sfzinstruments / Karoryfer Samples (see CREDITS.txt)"
COMMENT = "Built for Central Pedal from SFZ libraries on github.com/sfzinstruments, rendered mono."


def raw(src, path):
    repo, commit, _ = SOURCES[src]
    return "https://raw.githubusercontent.com/%s/%s/%s" % (repo, commit, urllib.parse.quote(path))


class Loader:
    """Fetches SFZ texts and samples of one source (cached on disk; samples decoded once, deleted after the bank)."""

    def __init__(self, src, cache):
        self.src, self.cache = src, os.path.join(cache, "sfz", src)
        self.audio = {}
        self.files = []

    def text(self, path):
        local = os.path.join(self.cache, "text", path)
        V.fetch(raw(self.src, path), local)
        with open(local, encoding="utf-8", errors="replace") as handle:
            return handle.read()

    def sample(self, path):
        if path in self.audio:
            return self.audio[path]
        local = os.path.join(self.cache, "smp", path)
        V.fetch(raw(self.src, path), local)
        self.files.append(local)
        if local.lower().endswith(".wav"):
            try:
                x, sr = V.read_wav(local)
            except Exception:  # noqa: BLE001 - (float WAVs and the like: through ffmpeg)
                x, sr = decode(local)
        else:
            x, sr = decode(local)
        self.audio[path] = (x, sr)
        return x, sr

    def forget(self):
        self.audio = {}
        for f in self.files:
            try:
                os.remove(f)
            except OSError:
                pass
        self.files = []


def decode(path):
    """Any audio file -> (mono float32, sample rate), through ffmpeg."""
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    sr = int(info) if info.isdigit() else 48000
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, "<f4").astype(np.float32), sr


def plan(iid, loader):
    """[(key, [(lovel, hivel, velocity rendered)])] for one instrument, and its SFZ + active regions."""
    spec = INSTR[iid]
    sfz = R.Sfz(loader.text, spec["program"])
    regions = sfz.active(spec.get("cc"), spec.get("exclude"))
    lo, hi = spec["keys"]
    if spec["kind"] == "drum":
        keys = sorted({k for r in regions for k in range(max(lo, sfz.key_range(r)[0]), min(hi, sfz.key_range(r)[1]) + 1)})
    else:
        keys = sorted({sfz.key_range(r)[2] for r in regions if lo <= sfz.key_range(r)[2] <= hi})
    out = []
    for k in keys:
        lay = sfz.layers(regions, k)
        if not lay:
            continue
        if len(lay) > spec.get("layers", 3):
            n = spec.get("layers", 3)
            idx = sorted({round(i * (len(lay) - 1) / (n - 1)) for i in range(n)}) if n > 1 else [len(lay) - 1]
            keep = [lay[i] for i in idx]
            # (each kept layer reaches down to the one below it)
            lay = [(keep[i - 1][1] + 1 if i else 1, keep[i][1]) for i in range(len(keep))]
        out.append((k, [(a, b, b) for a, b in lay]))
    return out, sfz, regions


def build_instrument(iid, cache, samples):
    spec = INSTR[iid]
    loader = Loader(spec["src"], cache)
    notes, sfz, regions = plan(iid, loader)
    if not notes:
        raise RuntimeError("%s: nothing sounds in %s" % (iid, spec["program"]))
    rendered, rels = [], []
    for key, layers in notes:
        for vi, (vlo, vhi, vel) in enumerate(layers):
            got = R.render_note(sfz, regions, key, vel, loader.sample, spec.get("cc"))
            if got is None:
                continue
            x, sr, rel = got
            rendered.append((key, x, sr, vlo, vhi))
            rels.append(rel)
    loader.forget()
    if spec["kind"] == "drum":
        # within a key, the soft layers are brought up (FluidSynth softens low velocities again); the kit keeps its balance
        peaks = [float(np.max(np.abs(x))) or 1e-6 for _, x, _, _, _ in rendered]
        loud = {}
        for (k, *_), p in zip(rendered, peaks):
            loud[k] = max(loud.get(k, 0.0), p)
        order = {}
        for i, (k, *_r) in enumerate(rendered):
            order.setdefault(k, []).append(i)
        gains = [1.0] * len(rendered)
        for k, idx in order.items():
            idx.sort(key=lambda i: rendered[i][4])
            for rank, i in enumerate(idx):
                gains[i] = loud[k] * (0.45 + 0.55 * (rank + 1) / len(idx)) / peaks[i]
        top = max(p * g for p, g in zip(peaks, gains)) or 1.0
        gains = [g * 0.89 / top for g in gains]
    else:
        shift = spec["shift"] if "shift" in spec else VC.octave_shift([(k, x, sr) for k, x, sr, _, _ in rendered])
        if shift:   # (an instrument mapped an octave from where it sounds - basses often are: keys play at sounding pitch here)
            V.say("    (mapped %+d octave%s from the pitch heard)" % (shift // 12, "" if abs(shift) == 12 else "s"))
            rendered = [(min(127, max(0, k + shift)), x, sr, a, b) for k, x, sr, a, b in rendered]
        gains = VC.level([(k, x, sr) for k, x, sr, _, _ in rendered], (0.0, 0.3) if spec["kind"] == "decay" else (0.4, 2.4))
    keys = sorted({k for k, _, _, _, _ in rendered})
    ranges = {k: (k, k) for k in keys} if spec["kind"] == "drum" else VC.key_ranges(keys)
    zones = []
    for (key, x, sr, vlo, vhi), g in zip(rendered, gains):
        kind = "decay" if spec["kind"] == "drum" else spec["kind"]
        pcm, s, e = VC.render(x, sr, kind, g, spec.get("cut", 3.5))
        samples.append({"name": "%s%d_%d" % (iid[:8], key, len(samples)), "pcm": pcm, "sr": sr, "root": key, "s": s, "e": e})
        z = [("keyRange", ranges[key]), ("velRange", (0 if vlo <= 1 else vlo, vhi)), ("overridingRootKey", key)]
        if s is not None:
            z.append(("sampleModes", 1))
        z.append(("sampleID", len(samples) - 1))
        zones.append(z)
    release = float(np.median(rels)) if rels else 0.3
    return zones, release


def bank_file(name):
    return "%s - %s.sf2" % (name, name.lower().replace(" ", "-"))


def build_bank(bank, cache, out_dir):
    name, _plan, presets = bank
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, bank_file(name))
    if os.path.isfile(out):
        return out
    V.say(name + " (sfzinstruments / Karoryfer, CC0)")
    samples, instruments, index, base = [], [], {}, {}
    pr_out = []
    for prog, (pname, layers) in enumerate(presets):
        pz = []
        for iid, klo, khi, att, rel, db in layers:
            if iid not in base:
                V.say("  " + INSTR[iid]["program"] + " (" + SOURCES[INSTR[iid]["src"]][0] + ")")
                base[iid] = build_instrument(iid, cache, samples)
            zones, rel0 = base[iid]
            r = rel if rel is not None else rel0
            key = (iid, round(att, 3), round(r, 3))
            if key not in index:
                env = [("attackVolEnv", V.tc(att)), ("releaseVolEnv", V.tc(r))]
                instruments.append({"name": "%s %d" % (iid[:12], len(instruments)), "zones": [z[:2] + env + z[2:] for z in zones]})
                index[key] = len(instruments) - 1
            z = [("keyRange", (klo, khi))]
            if db < 0:
                z.append(("initialAttenuation", int(round(-db * 10 / 0.4))))
            z.append(("instrument", index[key]))
            pz.append(z)
        pr_out.append({"name": pname, "prog": prog, "zones": pz})
    V.write_sf2(out, name, samples, instruments, pr_out, copyright=COPYRIGHT, comment=COMMENT)
    V.say("  -> %s (%.0f MB, %d samples)" % (os.path.basename(out), os.path.getsize(out) / 1e6, len(samples)))
    return out


def credits():
    """[(bank, source text, url)] for CREDITS.txt."""
    out = []
    for name, _plan, presets in BANKS:
        srcs = []
        for _p, layers in presets:
            for layer in layers:
                s = INSTR[layer[0]]["src"]
                if s not in srcs:
                    srcs.append(s)
        for s in srcs:
            repo, commit, text = SOURCES[s]
            out.append((name, text, "https://github.com/%s/tree/%s" % (repo, commit)))
    return out


def main(argv):
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--only")]
    if len(args) != 2:
        print(__doc__)
        return 2
    cache, out_dir = args
    if "--plan" in argv:
        for name, plan_id, presets in BANKS:
            print("%s (%s)" % (name, plan_id))
            for iid in sorted({layer[0] for _p, layers in presets for layer in layers}):
                notes, _sfz, regions = plan(iid, Loader(INSTR[iid]["src"], cache))
                n = sum(len(l) for _k, l in notes)
                print("    %-10s %-40s %3d keys %3d notes (%d regions sound)%s" % (iid, INSTR[iid]["program"], len(notes), n, len(regions), "" if notes else "   <-- NOTHING"))
        return 0
    for bank in BANKS:
        if only and only != bank[0]:
            continue
        build_bank(bank, cache, out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
