#!/usr/bin/env python3
"""Central Pedal - builds the sound library SoundFonts for Central Keys and Central Instrument from the Versilian
Community Sample Library (VCSL, Versilian Studios, CC0 1.0 "no special terms" - https://github.com/sgossner/VCSL).
Run by tools/build-libraries.sh (in CI: .github/workflows/libraries.yml), not on the pedal.

VCSL comes as plain WAVs (no SFZ), named by note and dynamic: GPiano_sus_C3_v3_rr1_Player.wav, EWHarp_Normal_A#2_v2_RR1.wav,
Marimba_hit_Outrigger_B2_loud_01.wav... Each instrument below picks its files with a pattern, reads the note and the
dynamic layer from the name (one round-robin), and becomes SoundFont zones: notes spread half-way to their neighbours,
dynamic layers split across the velocity range. Held instruments (organs, winds) get a loop the same way as the
orchestra (sounds-vsco.py: a loop found by correlation, smoothed with a crossfade); struck and plucked ones keep their
natural decay, cut after a few seconds. Unpitched percussion becomes kits: one sound per key (General MIDI places).

    python3 tools/sounds-vcsl.py <download cache> <out folder> [--names FILE] [--only BANK] [--plan]
--names: the VCSL file list (one path per line); default tools/vcsl-names.txt (the list at COMMIT, made with
         git ls-tree -r --name-only), else a partial git clone (names only, no samples).
--plan:  print what each bank would hold (and a size estimate) without downloading anything.
Needs python3-numpy, git (for the list) and the internet (raw.githubusercontent.com)."""
import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("sounds_vsco", os.path.join(os.path.dirname(HERE), "sounds-vsco.py"))
V = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(V)

COMMIT = "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e"   # sgossner/VCSL (CC0 1.0)
REPO = "https://github.com/sgossner/VCSL.git"
RAW = "https://raw.githubusercontent.com/sgossner/VCSL/" + COMMIT + "/"
COPYRIGHT = "CC0 1.0 - Versilian Community Sample Library (VCSL) by Versilian Studios"
COMMENT = "Built for Central Pedal from VCSL (github.com/sgossner/VCSL), mono."
PEAK = V.PEAK
LEVEL_RMS = 0.2
MAX_LAYERS = 3     # dynamic layers kept per note (the loudest, the softest and one between)

# ---------------------------------------------------------------- instruments
# id -> folder (in VCSL), inc (pattern on the path inside the folder), kind ("sus": looped, "decay": rings out), cut
# (seconds kept of a ringing note), exc (pattern to leave out)
ZI, CH, AE, EL, ID, ME = "Chordophones/Zithers/", "Chordophones/Composite Chordophones/", "Aerophones/", "Electrophones/TX81Z/", "Idiophones/Struck Idiophones/", "Membranophones/Struck Membranophones/"
INSTR = {
    # Central Keys
    "upr": dict(folder=ZI + "Upright Piano, Yamaha", inc=r"^Sustains/.*_rr1\.wav$", kind="decay", cut=6.5),
    "fmp": dict(folder=EL + "FM Piano", inc=r"_vl\d\.wav$", kind="decay", cut=5.0),
    "clv": dict(folder=EL + "Clavisynth", inc=r"_vl\d\.wav$", kind="decay", cut=3.0),
    "hsc": dict(folder=ZI + "Harpsichord, Flemish", inc=r"^Sustains/Low/.*_rr1\.wav$", kind="decay", cut=4.5),
    "org": dict(folder=AE + "Edge-blown Aerophones/Pipe Organ", inc=r"^Loud/.*\.wav$", kind="sus"),
    "orgq": dict(folder=AE + "Edge-blown Aerophones/Pipe Organ", inc=r"^Quiet/.*_rr1\.wav$", kind="sus"),
    "orgp": dict(folder=AE + "Edge-blown Aerophones/Pipe Organ", inc=r"^Loud Pedal/.*\.wav$", kind="sus"),
    "pos": dict(folder=AE + "Edge-blown Aerophones/Renaissance Organ", inc=r"4foot_Room_.*_rr1\.wav$", kind="sus"),
    "vibs": dict(folder=ID + "Vibraphone", inc=r"^Soft Mallets/.*_rr1_", kind="decay", cut=6.0),
    "vibh": dict(folder=ID + "Vibraphone", inc=r"^Hard Mallets/.*_rr1_", kind="decay", cut=6.0),
    "mar": dict(folder=ID + "Marimba", inc=r"_01\.wav$", kind="decay", cut=3.0),
    "glk": dict(folder=ID + "Glockenspiel", inc=r"_01\.wav$", kind="decay", cut=4.0),
    "tbl": dict(folder=ID + "Tubular Bells 2", inc=r"_1\.wav$", kind="decay", cut=7.0),
    "chm": dict(folder=ID + "Hand Chimes", inc=r"_r01_main\.wav$", kind="decay", cut=6.0),
    # Central Instrument
    "hrp": dict(folder=CH + "Folk Harp", inc=r"_RR1\.wav$", kind="decay", cut=5.0),
    "chp": dict(folder=CH + "Concert Harp", inc=r"_(mf|f)1\.wav$", kind="decay", cut=6.0),
    "kal": dict(folder="Idiophones/Plucked Idiophones/Kalimba, Tanzania", inc=r"\.wav$", kind="decay", cut=4.0),
    "stm": dict(folder=CH + "Strumstick", inc=r"_Finger_Str\d_Main_.*_rr1\.wav$", kind="decay", cut=4.0),
    "rec": dict(folder=AE + "Edge-blown Aerophones/Baroque Alto Recorder", inc=r"\.wav$", exc=r"(?i)stac|rel", kind="sus"),
    "trec": dict(folder=AE + "Edge-blown Aerophones/Baroque Tenor Recorder", inc=r"\.wav$", exc=r"(?i)stac|rel", kind="sus"),
    "hmc": dict(folder=AE + "Free Aerophones/Harmonica-Hohner-Special20-C", inc=r"\.wav$", exc=r"(?i)rel|bend|trill", kind="sus"),
    "sax": dict(folder=AE + "Reed Aerophones/Tenor Saxophone", inc=r"^Non-Vibrato/.*_rr1\.wav$", kind="sus"),
    "oca": dict(folder=AE + "Edge-blown Aerophones/Ocarina, Typical", inc=r"\.wav$", exc=r"(?i)rel|stac", kind="sus"),
}

# kits: (General MIDI key, folder, pattern, seconds kept) - one key each, its dynamic layers across the velocity range
HAND_KIT = [
    (35, ID + "Cajon", r"^Cajon_hit1_.*_rr1\.wav$", 1.5), (38, ID + "Cajon", r"^Cajon_hit2_.*_rr1\.wav$", 1.2),
    (39, ID + "Claps", r"^Clap_rr1\.wav$", 1.0), (54, ID + "Tambourine 1", r"^Tamb1_Hit_v\d_rr1", 1.5),
    (56, ID + "Cowbells", r"^Cowbell1_Hit_v\d_rr1", 1.5), (60, ME + "Bongos", r"^BongoH_Hit1_v\d_rr1", 1.0),
    (61, ME + "Bongos", r"^BongoL_Hit1_v\d_rr1", 1.0), (62, ME + "Conga", r"^Conga_HitFM_v\d_rr1", 1.0),
    (63, ME + "Conga", r"^Conga_HitN_v\d_rr1", 1.5), (69, ID + "Cabasa", r"Cabasa1_Hit_rr1", 1.0),
    (70, ID + "Shaker, Small", r"^Mid_ShakerDouble_Down_rr1\.wav$", 1.0), (75, ID + "Claves", r"^Claves1_Hit_v\d_rr1", 1.0),
    (76, ID + "Woodblock", r"^wood_click_f_rr1\.wav$", 1.0), (77, ID + "Woodblock", r"^wood_click3_vl\d\.wav$", 1.0),
    (47, ME + "Frame Drum", r"^HDrumL_Hit_v\d_rr1", 2.0), (82, ID + "Shaker, Large", r"\.wav$", 1.2),
]
ORCH_KIT = [
    (35, ME + "Bass Drum 2", r"^bassdrum_hit_(mf1|f|ff)\.wav$", 4.0), (38, ME + "Snare Drum, Rope Tension", r"^Hi/RopeSnare_hi_sn_Main_vl\d_rr1", 1.5),
    (41, ME + "Timpani 1", r"Timpani1_Hit_v\d_rr1_Sum\.wav$", 4.0), (45, ME + "Tom 2", r"TomL_HitM_v\d_rr1", 2.0),
    (48, ME + "Tom 1", r"^Mallet/TomH_HitM_v\d_rr1", 2.0), (49, ID + "Clash Cymbals 1", r"cymbal_crash1_(mp1|mf1|ff2)\.wav$", 5.0),
    (52, ID + "Suspended Cymbal 1", r"susCymb1_hit_(pp1|mp1|f1|fff1)\.wav$", 6.0), (42, ID + "Hi-Hat Cymbal", r"^HiHat_HitC_v\d_rr1", 1.0),
    (54, ID + "Tambourine 1", r"^Tamb1_Hit_v\d_rr1", 1.5), (81, ID + "Triangles", r"triangle1_hit_mp\.wav$", 4.0),
    (83, ID + "Sleigh Bells", r"^Sleighbells_Hit_rr1", 2.0), (84, ID + "Bell Tree", r"^Individual/BellTree_Hit_C5_rr1", 3.0),
    (51, ID + "Mark Trees", r"windchimes_slowAsc1\.wav$", 5.0), (57, ID + "Gong 1", r"^gong_(p|mf|fff)\.wav$", 8.0),
]

# bank -> (tier, presets: (name, [(instrument, key lo, key hi, attack, release, dB)]) or (name, "kit", [kit]))
BANKS = [
    ("Central Keys Pianos", "keys", [
        ("Upright Piano", [("upr", 0, 127, 0.002, 0.45, 0)]),
        ("Soft Upright", [("upr", 0, 127, 0.03, 1.2, -1)]),
        ("FM Piano", [("fmp", 0, 127, 0.002, 0.6, 0)]),
        ("FM Piano & Upright", [("upr", 0, 127, 0.002, 0.6, -2), ("fmp", 0, 127, 0.002, 0.8, -5)]),
        ("Clavisynth", [("clv", 0, 127, 0.002, 0.25, 0)]),
        ("Harpsichord", [("hsc", 0, 127, 0.002, 0.35, 0)]),
    ]),
    ("Central Keys Organs", "keys", [
        ("Pipe Organ", [("orgp", 0, 47, 0.04, 0.5, -2), ("org", 48, 127, 0.04, 0.5, 0)]),
        ("Pipe Organ (manual only)", [("org", 0, 127, 0.04, 0.5, 0)]),
        ("Quiet Organ", [("orgq", 0, 127, 0.05, 0.6, 0)]),
        ("Organ Swell", [("orgq", 0, 127, 0.9, 1.8, 0)]),
        ("Positive Organ", [("pos", 0, 127, 0.03, 0.4, 0)]),
    ]),
    ("Central Keys Mallets", "keys", [
        ("Vibraphone", [("vibs", 0, 127, 0.002, 0.9, 0)]),
        ("Vibraphone (hard mallets)", [("vibh", 0, 127, 0.002, 0.9, 0)]),
        ("Marimba", [("mar", 0, 127, 0.002, 0.5, 0)]),
        ("Glockenspiel", [("glk", 0, 127, 0.002, 1.0, -2)]),
        ("Tubular Bells", [("tbl", 0, 127, 0.002, 2.0, 0)]),
        ("Hand Chimes", [("chm", 0, 127, 0.002, 1.6, 0)]),
        ("Chime Pad", [("chm", 0, 127, 0.45, 3.0, 0), ("vibs", 0, 127, 0.3, 2.5, -6)]),
        ("Vibes & Chimes", [("vibs", 0, 127, 0.002, 1.2, -1), ("chm", 55, 127, 0.002, 1.8, -5)]),
    ]),
    ("Central Instrument Harps", "instrument", [
        ("Folk Harp", [("hrp", 0, 127, 0.002, 1.2, 0)]),
        ("Concert Harp", [("chp", 0, 127, 0.002, 1.5, 0)]),
        ("Harp Pad", [("chp", 0, 127, 0.25, 2.8, 0)]),
        ("Kalimba", [("kal", 0, 127, 0.002, 0.8, 0)]),
        ("Strumstick", [("stm", 0, 127, 0.002, 0.6, 0)]),
    ]),
    ("Central Instrument Winds", "instrument", [
        ("Alto Recorder", [("rec", 0, 127, 0.04, 0.25, 0)]),
        ("Tenor Recorder", [("trec", 0, 127, 0.04, 0.25, 0)]),
        ("Recorder Consort", [("trec", 0, 64, 0.06, 0.4, -2), ("rec", 65, 127, 0.06, 0.4, -2)]),
        ("Harmonica", [("hmc", 0, 127, 0.02, 0.2, 0)]),
        ("Tenor Sax", [("sax", 0, 127, 0.03, 0.25, 0)]),
        ("Ocarina", [("oca", 0, 127, 0.03, 0.3, 0)]),
    ]),
    ("Central Instrument Percussion", "instrument", [
        ("Hand Percussion", "kit", HAND_KIT),
        ("Orchestral Percussion", "kit", ORCH_KIT),
    ]),
]

NOTE = re.compile(r"(?:^|[_ ])([A-Ga-g])(#|b)?(-?\d)(?=[_ .]|$)")
DYN = {"ppp": 1, "pp": 2, "p": 3, "mp": 4, "mf": 5, "f": 6, "ff": 7, "fff": 8, "soft": 3, "med": 5, "medium": 5, "loud": 7}
PC = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def note_of(path):
    """MIDI note from a VCSL name (C4 = 60), or None."""
    m = None
    for m in NOTE.finditer(os.path.splitext(os.path.basename(path))[0]):
        pass
    if not m:
        return None
    n = 12 * (int(m.group(3)) + 1) + PC[m.group(1).lower()] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return n if 0 <= n <= 127 else None


def layer_of(path):
    """A dynamic layer's rank from the name (_v3, _vl2, _mf, _loud...), 0 when the name has none."""
    base = os.path.splitext(os.path.basename(path))[0]
    m = re.search(r"_vl?(\d+)(?=_|$)", base, re.I)
    if m:
        return int(m.group(1)) * 10
    for tok in re.split(r"[_ ]", base.lower()):
        t = re.sub(r"\d+$", "", tok)
        if t in DYN:
            return DYN[t] * 10
    return 0


def keep_layers(layers):
    """At most MAX_LAYERS dynamic layers: the softest, the loudest and the ones between, evenly."""
    layers = sorted(layers, key=lambda f: layer_of(f))
    if len(layers) <= MAX_LAYERS:
        return layers
    idx = sorted({round(i * (len(layers) - 1) / (MAX_LAYERS - 1)) for i in range(MAX_LAYERS)})
    return [layers[i] for i in idx]


def vel_ranges(n):
    """n velocity ranges covering 1..127, softest first."""
    edges = [1 + round(i * 127 / n) for i in range(n + 1)]
    return [(edges[i] if i else 0, min(127, edges[i + 1] - 1) if i < n - 1 else 127) for i in range(n)]


def pick(names, folder, inc, exc=None):
    """Paths inside a folder (relative) that match."""
    pre = folder.rstrip("/") + "/"
    out = []
    for n in names:
        if n.startswith(pre) and n.lower().endswith(".wav"):
            rel = n[len(pre):]
            if re.search(inc, rel) and not (exc and re.search(exc, rel)):
                out.append(rel)
    return sorted(out)


def plan_instrument(iid, names):
    """{note: [relative paths by layer]} for a pitched instrument."""
    spec = INSTR[iid]
    by_note = {}
    for rel in pick(names, spec["folder"], spec["inc"], spec.get("exc")):
        n = note_of(rel)
        if n is None:
            continue
        lst = by_note.setdefault(n, [])
        if all(layer_of(x) != layer_of(rel) for x in lst):   # (one take per dynamic layer)
            lst.append(rel)
    return {n: keep_layers(v) for n, v in sorted(by_note.items())}


def key_ranges(notes):
    """Each root note's key range: half-way to its neighbours, the ends stretched to 0 and 127."""
    out = {}
    for i, n in enumerate(notes):
        lo = 0 if i == 0 else (notes[i - 1] + n) // 2 + 1
        hi = 127 if i == len(notes) - 1 else (n + notes[i + 1]) // 2
        out[n] = (lo, hi)
    return out


def plan_kit(kit, names):
    out = []
    for key, folder, inc, cut in kit:
        files = pick(names, folder, inc)
        if not files:
            continue
        seen, lst = set(), []
        for f in files:
            if layer_of(f) not in seen:
                seen.add(layer_of(f))
                lst.append(f)
        out.append((key, folder, keep_layers(lst), cut))
    return out


# ---------------------------------------------------------------- audio
def render(x, sr, kind, gain, cut):
    """int16 data and loop points (sus: looped as the orchestra; decay: cut after `cut` seconds with a short fade)."""
    if kind == "sus":
        return V.render_sample(x, sr, "sus", gain)
    x = x * gain
    if float(np.max(np.abs(x))) > 0.8 * PEAK:
        x = (np.tanh(x / PEAK) * PEAK).astype(np.float32)
    start = int(np.argmax(np.abs(x) > 0.002)) if np.any(np.abs(x) > 0.002) else 0   # (the silence before the note)
    start = max(0, start - int(0.002 * sr))
    data = x[start:start + int(cut * sr)].copy()
    f = min(int(0.25 * sr), len(data))
    data[len(data) - f:] *= np.linspace(1, 0, f, dtype=np.float32) ** 2
    return np.clip(np.round(data * 32767), -32768, 32767).astype("<i2"), None, None


def fetch_wav(cache, folder, rel):
    local = os.path.join(cache, "vcsl", folder, rel)
    V.fetch(RAW + urllib.parse.quote(folder + "/" + rel), local)
    return local


def level(loaded, win):
    """Gains that bring an instrument's notes even (as sounds-vsco.py: loudest layer of each note 70 % of the way to the
    typical note) and its typical note to LEVEL_RMS."""
    body = [float(np.sqrt(np.mean(x[int(win[0] * sr):int(win[1] * sr)] ** 2))) + 1e-9 for _, x, sr in loaded]
    roots = [n for n, _, _ in loaded]
    loudest = {k: max(b for b, rk in zip(body, roots) if rk == k) for k in set(roots)}
    typical = float(np.median(list(loudest.values())))
    even = [min(4.0, max(0.25, (typical / loudest[rk]) ** 0.7)) for rk in roots]
    body = [b * e for b, e in zip(body, even)]
    norm = LEVEL_RMS / (float(np.median(body)) or 1.0)
    return [e * norm for e in even]


def pitch_of(x, sr, guess):
    """The fundamental (Hz) of a note, YIN-style (the first dip of the difference function), searched from two octaves
    below to two octaves above the name's note; None when it can't tell."""
    start = int(0.12 * sr)
    w = int(min(0.25 * sr, max(2048, 6 * sr / (guess / 4.5))))
    seg = x[start:start + 2 * w].astype(np.float64)
    if len(seg) < 2 * w or float(np.max(np.abs(seg))) < 1e-3:
        return None
    lo, hi = max(2, int(sr / (guess * 4.5))), min(w - 1, int(sr / (guess / 4.5)))
    if hi <= lo:
        return None
    d = np.array([np.sum((seg[:w] - seg[t:t + w]) ** 2) for t in range(hi + 1)])
    cm = d.copy()
    cm[1:] = d[1:] * np.arange(1, hi + 1) / (np.cumsum(d[1:]) + 1e-12)
    for t in range(lo, hi):
        if cm[t] < 0.15 and cm[t] <= cm[t - 1] and cm[t] <= cm[t + 1]:
            return sr / t
    t = lo + int(np.argmin(cm[lo:hi]))
    return sr / t if cm[t] < 0.4 else None


def octave_shift(loaded):
    """VCSL instruments name their notes with different middle Cs (C3 or C4): the octaves to add to the names, from the
    pitch heard in the samples (the median over the instrument)."""
    offs = []
    for n, x, sr in loaded:
        f = pitch_of(x, sr, 440.0 * 2 ** ((n - 69) / 12.0))
        if f:
            offs.append(12 * round(np.log2(f / (440.0 * 2 ** ((n - 69) / 12.0)))))
    if not offs:
        return 0
    return int(max(-24, min(24, float(np.median(offs)))))


def build_instrument(iid, names, cache, samples):
    spec = INSTR[iid]
    plan = plan_instrument(iid, names)
    if not plan:
        raise RuntimeError("%s: no samples matched in %s" % (iid, spec["folder"]))
    loaded, meta = [], []
    for n, files in plan.items():
        for vi, rel in enumerate(files):
            local = fetch_wav(cache, spec["folder"], rel)
            x, sr = V.read_wav(local)
            loaded.append((n, x, sr))
            meta.append((n, vi, len(files), local))
    shift = spec["shift"] if "shift" in spec else octave_shift(loaded)
    if shift:
        V.say("    (notes named %+d octave%s from the pitch heard)" % (shift // 12, "" if abs(shift) == 12 else "s"))
        loaded = [(min(127, max(0, n + shift)), x, sr) for n, x, sr in loaded]
    ranges = key_ranges(sorted({n for n, _, _ in loaded}))
    gains = level(loaded, (0.0, 0.3) if spec["kind"] == "decay" else (0.4, 2.4))
    zones = []
    for (n, x, sr), (_, vi, nl, local), g in zip(loaded, meta, gains):
        pcm, s, e = render(x, sr, spec["kind"], g, spec.get("cut", 3.5))
        samples.append({"name": "%s%d_%d" % (iid, n, len(samples)), "pcm": pcm, "sr": sr, "root": n, "s": s, "e": e})
        z = [("keyRange", ranges[n]), ("velRange", vel_ranges(nl)[vi]), ("overridingRootKey", n)]
        if s is not None:
            z.append(("sampleModes", 1))
        z.append(("sampleID", len(samples) - 1))
        zones.append(z)
        try:
            os.remove(local)
        except OSError:
            pass
    return zones


def build_kit(kit, names, cache, samples):
    zones = []
    for key, folder, files, cut in plan_kit(kit, names):
        for vi, rel in enumerate(files):
            local = fetch_wav(cache, folder, rel)
            x, sr = V.read_wav(local)
            peak = float(np.max(np.abs(x))) or 1.0
            g = (0.75 / peak) * (0.55 + 0.45 * (vi + 1) / len(files))   # (the loudest layer peaks at 0.75, softer ones lower)
            pcm, _, _ = render(x, sr, "decay", g, cut)
            samples.append({"name": "kit%d_%d" % (key, len(samples)), "pcm": pcm, "sr": sr, "root": key, "s": None, "e": None})
            zones.append([("keyRange", (key, key)), ("velRange", vel_ranges(len(files))[vi]), ("overridingRootKey", key), ("sampleID", len(samples) - 1)])
            try:
                os.remove(local)
            except OSError:
                pass
    if not zones:
        raise RuntimeError("a kit with no sounds")
    return zones


def bank_file(bank_name):
    return "%s - %s.sf2" % (bank_name, bank_name.lower().replace(" ", "-"))


def build_bank(bank, names, cache, out_dir):
    bank_name, _tier, presets = bank
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, bank_file(bank_name))
    if os.path.isfile(out):
        return out
    V.say(bank_name + " (VCSL, CC0)")
    samples, instruments, inst_index, base = [], [], {}, {}
    pr_out = []
    for prog, preset in enumerate(presets):
        pname = preset[0]
        if len(preset) == 3 and preset[1] == "kit":
            V.say("  kit: " + pname)
            zones = build_kit(preset[2], names, cache, samples)
            instruments.append({"name": "kit %d" % len(instruments), "zones": [z[:2] + [("attackVolEnv", V.tc(0.001)), ("releaseVolEnv", V.tc(0.4))] + z[2:] for z in zones]})
            pr_out.append({"name": pname, "prog": prog, "zones": [[("keyRange", (0, 127)), ("instrument", len(instruments) - 1)]]})
            continue
        pz = []
        for iid, klo, khi, att, rel, db in preset[1]:
            if iid not in base:
                V.say("  " + INSTR[iid]["folder"].split("/")[-1])
                base[iid] = build_instrument(iid, names, cache, samples)
            key = (iid, round(att, 3), round(rel, 3))
            if key not in inst_index:
                env = [("attackVolEnv", V.tc(att)), ("releaseVolEnv", V.tc(rel))]
                instruments.append({"name": "%s %s" % (iid, len(instruments)), "zones": [z[:2] + env + [("reverbEffectsSend", 120)] + z[2:] for z in base[iid]]})
                inst_index[key] = len(instruments) - 1
            z = [("keyRange", (klo, khi))]
            if db < 0:
                z.append(("initialAttenuation", int(round(-db * 10 / 0.4))))
            z.append(("instrument", inst_index[key]))
            pz.append(z)
        pr_out.append({"name": pname, "prog": prog, "zones": pz})
    V.write_sf2(out, bank_name, samples, instruments, pr_out, copyright=COPYRIGHT, comment=COMMENT)
    V.say("  -> %s (%.0f MB, %d samples)" % (os.path.basename(out), os.path.getsize(out) / 1e6, len(samples)))
    return out


def list_names(cache):
    """The VCSL file list from a partial clone (names only: no sample is downloaded)."""
    repo = os.path.join(cache, "vcsl-tree")
    if not os.path.isdir(os.path.join(repo, ".git")):
        subprocess.run(["git", "clone", "--quiet", "--filter=blob:none", "--no-checkout", REPO, repo], check=True)
    out = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "--name-only", COMMIT], check=True, capture_output=True, text=True).stdout
    return [line for line in out.splitlines() if line]


def plan_text(names):
    """What each bank would hold, with a size estimate (mono 16-bit at 48 kHz)."""
    lines = []
    for bank_name, tier, presets in BANKS:
        secs, nsamp, used = 0.0, 0, set()
        for preset in presets:
            if len(preset) == 3 and preset[1] == "kit":
                for key, folder, files, cut in plan_kit(preset[2], names):
                    nsamp += len(files)
                    secs += cut * len(files)
                continue
            for layer in preset[1]:
                iid = layer[0]
                if iid in used:
                    continue
                used.add(iid)
                p = plan_instrument(iid, names)
                k = sum(len(v) for v in p.values())
                nsamp += k
                secs += k * (INSTR[iid].get("cut") or 3.3)
                lines.append("    %-5s %-58s %3d notes %3d samples%s" % (iid, INSTR[iid]["folder"], len(p), k, "" if p else "   <-- NOTHING MATCHED"))
        lines.insert(len(lines) - len(used), "%s (%s): %d presets, %d samples, about %.0f MB" % (bank_name, tier, len(presets), nsamp, secs * 48000 * 2 / 1e6))
    return "\n".join(lines)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    opt = {}
    i = 0
    while i < len(argv):
        if argv[i] in ("--names", "--only"):
            opt[argv[i][2:]] = argv[i + 1]
            i += 2
            continue
        if argv[i] == "--plan":
            opt["plan"] = True
        i += 1
    args = [a for a in args if a not in opt.values()]
    if len(args) != 2:
        print(__doc__)
        return 2
    cache, out_dir = args
    os.makedirs(cache, exist_ok=True)
    if not opt.get("names") and os.path.isfile(os.path.join(HERE, "vcsl-names.txt")):
        opt["names"] = os.path.join(HERE, "vcsl-names.txt")   # (the file list of COMMIT, kept next to this script)
    if opt.get("names"):
        with open(opt["names"], encoding="utf-8") as handle:
            names = [line.strip() for line in handle if line.strip()]
    else:
        names = list_names(cache)
    if opt.get("plan"):
        print(plan_text(names))
        return 0
    os.makedirs(out_dir, exist_ok=True)
    built = 0
    for bank in BANKS:
        if opt.get("only") and opt["only"] != bank[0]:
            continue
        build_bank(bank, names, cache, out_dir)
        built += 1
    print("    %d VCSL banks ready in %s" % (built, out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
