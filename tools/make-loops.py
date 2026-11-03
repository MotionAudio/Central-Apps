#!/usr/bin/env python3
"""Central Pedal - loops for the texture channels (10.0; 10.2 each with its own feel), made here (no one else's recording):

  drums/    Drum and percussion loops (Central Instrument): twenty four-bar grooves, each with its own feel, kit and
            tempos - straight eighths, a big ride, rim and hat, half-time, four on the floor, driving sixteenths, toms,
            brushes (ballad, waltz and swing), a waltz, a gospel shuffle, a 6/8 ballad, 6/8 Celtic toms, a train beat,
            kick and clap, a cajon groove, shaker and congas, a frame drum in 6/8 and a cinematic swell - played on the
            library's own kits (Studio, Rusty Rock, Unruly, Brushes, Hand and Orchestral Percussion - CC0 samples, see
            sounds-sfz.py and sounds-vcsl.py). The fourth bar ends with the groove's own fill (the quiet ones breathe
            instead), the timing and touch are a drummer's (the kick on the grid, the backbeat a hair late, ghost notes
            that come and go), and each sits in a room of its own. The app plays the tempo nearest the song's, a little
            faster or slower to fit it. (6/8 grooves count their tempo in eighth notes, like their meter.)
  ambient/  Ambient loops (Central Pads, so every plan), 12 seconds in all 12 keys, each its own colour:
            Sparkle (soft bells on the key's pentatonic notes), Drift (two pads slowly trading places), Breath (air and
            a pad, rising and falling), Felt Piano (a few soft piano notes with echoes), Guitar Swells (clean guitar
            notes that fade in and echo away), Cello Drone (a bowed bass and a cello swelling on the root and fifth),
            Choir Air (voices on "aah" and "ooh" over a breath of air) and Harp Rain (harp runs falling now and then).
            Each is exactly periodic - its echoes and tails wrap round to the start - so it repeats without a seam.

Each folder gets an index.json: [{name, file, bpm, meter, bars, kit} | {name, file, key, seconds}].

    python3 tools/make-loops.py --sounds DIR --pads DIR --out DIR [--orchestra DIR]   (--sounds: the libraries' SoundFonts;
                                                                    --pads: make-pad-loops' output; --orchestra: VSCO, optional)
    python3 tools/make-loops.py --gm FILE.sf2 --pads DIR --out DIR     (a test with any General MIDI SoundFont)
Needs fluidsynth and python3-numpy. Deterministic: the same files every build. (A file already there is kept.)"""
import importlib.util
import json
import math
import os
import sys
import tempfile
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import midi_render as M  # noqa: E402

_s = importlib.util.spec_from_file_location("make_synths", os.path.join(HERE, "make-synths.py"))
SY = importlib.util.module_from_spec(_s)
_s.loader.exec_module(SY)

KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
DRUM_SR, AMB_SR = 44100, 32000
AMB_SECONDS = 12.0
LOOP_BARS = 4
K, S, X, CLAP, HC, HP, HO, RIDE, BELL, CRASH, T1, T2, T3, T4 = 36, 38, 37, 39, 42, 44, 46, 51, 53, 49, 50, 47, 43, 41
# the hand percussion kit (Central Instrument Percussion, General MIDI places): cajon low / slap, tambourine, congas,
# bongos, shakers, frame drum; the orchestral kit: bass drum, timpani, suspended cymbal
CAJ, CAJS, TAMB, BONGO_H, BONGO_L, CONGA_M, CONGA_O, SHAKE, SHAKE_L, FRAME = 35, 38, 54, 60, 61, 62, 63, 70, 82, 47
OBD, TIMP, SUSC = 35, 41, 52
HANDS = (S, K, X, T1, T2, T3, T4, CAJ, CAJS, CONGA_M, CONGA_O, BONGO_H, BONGO_L, FRAME)


def swing(at, amount):
    """An offbeat eighth (x.5) moved later: amount 0 straight, 1/6 a full triplet shuffle."""
    frac = at - math.floor(at)
    return at + amount if abs(frac - 0.5) < 1e-6 else at


def eighths(note, v1, v2, beats):
    return [(i / 2, note, v1 if i % 2 == 0 else v2) for i in range(beats * 2)]


def ghosts(rng, spots, note=S, v=(22, 34), chance=0.5):
    return [(at, note, int(rng.integers(*v))) for at in spots if rng.random() < chance]


# Each groove plays one bar: f(bar 0..3, rng) -> [(beat, note, velocity)]. Bar 4 ends with the groove's own fill (or
# none), so the loop breathes like a drummer would and the turn back to bar 1 is felt. 6/8 grooves count in eighths.
def g_worship(b, r):
    h = [(0, K, 96), (1.5, K, 72), (2, K, 86), (1, S, 98), (3, S, 100)] + eighths(HC, 74, 50, 4) + ghosts(r, [2.75, 3.75], chance=0.35)
    return h + ([(3.5, K, 64)] if b == 1 else [])


def g_ride(b, r):
    return [(0, K, 108), (1.5, K, 86), (2, K, 100), (2.5, K, 70), (1, S, 112), (3, S, 114)] + [(i / 2, BELL if i % 4 == 0 else RIDE, 86 if i % 2 == 0 else 62) for i in range(8)]


def g_rim(b, r):
    return [(0, K, 68), (2.5, K, 50), (1, X, 62), (3, X, 64)] + [(q + 0.5 * i, HC, 44 if i == 0 else 30) for q in range(4) for i in range(2)]


def g_halftime(b, r):
    h = [(0, K, 100), (0.75, K, 58), (1.75, K, 74), (2, S, 112)] + [(i / 4, HC, 72 if i % 4 == 0 else 40 if i % 2 else 54) for i in range(16)] + ghosts(r, [1.25, 3.25, 3.75])
    return h + ([(3.5, K, 70)] if b == 2 else [])


def g_floor(b, r):
    return [(q, K, 104) for q in range(4)] + [(1, S, 96), (3, S, 98), (1, CLAP, 80), (3, CLAP, 82)] + [(q + 0.5, HO, 72) for q in range(4)] + [(q + 0.25 * i, HC, 40) for q in range(4) for i in (1, 3)]


def g_sixteenths(b, r):
    return [(0, K, 102), (1.5, K, 82), (1.75, K, 70), (2.5, K, 92), (1, S, 106), (3, S, 108)] + [(i / 4, HC, 78 if i % 4 == 0 else 46 if i % 2 else 60) for i in range(16)] + ghosts(r, [0.75, 2.25, 3.75], chance=0.6)


def g_toms(b, r):
    h = [(0, K, 98), (2, K, 92)] + [(i / 2, T4 if i % 4 < 2 else T3, 92 if i % 2 == 0 else 66) for i in range(8)]
    return h + ([(1, S, 70 + 10 * b), (3, S, 74 + 10 * b)] if b >= 2 else [])


def g_brushes(b, r):
    # a sweep in triplets on the snare (soft), the kick feathered, the backbeat a light tap
    return [(0, K, 56), (2, K, 50), (1, S, 66), (3, S, 70)] + [(q + i / 3, S, int(r.integers(22, 34))) for q in range(4) for i in range(3)]


def g_waltz(b, r):
    return [(0, K, 90), (1, HP, 50), (2, S, 80), (1, S, 30) if b % 2 else (2.5, K, 56)] + eighths(HC, 68, 44, 3)


def g_brush_waltz(b, r):
    return [(0, K, 58), (1, S, 44), (2, S, 62)] + [(q + i / 3, S, int(r.integers(20, 32))) for q in range(3) for i in range(3)]


def g_shuffle(b, r):
    # the gospel shuffle: hats on the triplet "1 - a", kick on 1 and the "a" of 2, a fat backbeat with ghost notes
    h = [(0, K, 100), (1 + 2 / 3, K, 70), (2, K, 92), (1, S, 108), (3, S, 112)] + [(q + t, HC, 80 if t == 0 else 50) for q in range(4) for t in (0, 2 / 3)]
    return h + [(at, S, int(r.integers(24, 36))) for at in (2 / 3, 2 + 2 / 3, 3 + 2 / 3) if r.random() < 0.6]


def g_brush_swing(b, r):
    return [(0, K, 50), (2, K, 46), (1, S, 62), (3, S, 64), (1, HP, 50), (3, HP, 52)] + [(q + t, RIDE, 64 if t == 0 else 46) for q in range(4) for t in ((0,) if q % 2 == 0 else (0, 2 / 3))]


def g_68_ballad(b, r):
    # 6/8 felt in two: kick on 1, snare on 4, eighths on the hat (counted in eighths: 0..5)
    h = [(0, K, 92), (3, S, 98), (5, K, 60)] + [(i, HC, 70 if i % 3 == 0 else 44) for i in range(6)]
    return h + ([(2, K, 58)] if b == 1 else [])


def g_68_celtic(b, r):
    # floor toms rolling in eighths under a kick on the big beats: a Celtic march
    return [(0, K, 96), (3, K, 90)] + [(i, T4 if i % 3 == 0 else T3, 90 if i % 3 == 0 else 58) for i in range(6)] + [(3, S, 70 if b < 2 else 92)]


def g_train(b, r):
    # the country train beat: snare sixteenths with accents on 2 and 4, kick on 1 and 3
    return [(0, K, 92), (2, K, 88)] + [(i / 4, S, 96 if i in (4, 12) else 58 if i % 2 == 0 else 34) for i in range(16)] + [(q + 0.5, HP, 46) for q in range(4)]


def g_pulse(b, r):
    return [(0, K, 100), (0.75, K, 64), (2, K, 94), (2.5, K, 70), (1, CLAP, 100), (3, CLAP, 102), (1, S, 60), (3, S, 62)] + [(i / 4, HC, 70 if i % 2 == 0 else 38) for i in range(16)]


def g_cajon(b, r):
    h = [(0, CAJ, 104), (1.5, CAJ, 80), (2, CAJ, 96), (1, CAJS, 100), (3, CAJS, 104)] + [(i / 4, SHAKE, 70 if i % 2 == 0 else 44) for i in range(16)]
    return h + ghosts(r, [0.75, 2.75, 3.25], note=CAJS, v=(26, 40), chance=0.6) + ([(3.5, CAJ, 72)] if b % 2 else [])


def g_congas(b, r):
    # shaker in sixteenths, a tumbao on the congas, tambourine on 2 and 4
    return [(i / 4, SHAKE, 64 if i % 2 == 0 else 38) for i in range(16)] + [(1, TAMB, 78), (3, TAMB, 80)] + [(0, CONGA_M, 70), (1.5, CONGA_O, 88), (2, CONGA_M, 62), (3.5, CONGA_O, 90), (3.75, CONGA_O, 70), (2.5, BONGO_H, 60)]


def g_perc_68(b, r):
    return [(i, SHAKE_L, 60 if i % 3 == 0 else 36) for i in range(6)] + [(0, FRAME, 96), (3, FRAME, 82), (5, FRAME, 54), (1.5 if b % 2 else 4, TAMB, 58)]


def g_swell(b, r):
    # a cinematic build: bass drum and timpani on the downbeats, a suspended cymbal rolling up across the 4 bars
    h = [(0, OBD, 70 + 8 * b), (2, TIMP, 64 + 8 * b)] + ([(q, TIMP, 60 + 6 * b) for q in (1, 3)] if b >= 2 else [])
    return h + [(i / 8, SUSC, int(18 + 22 * (b + i / 32))) for i in range(32)]


def fill_snare(m):   # the last beat: snare and toms in 16ths
    return [(m - 1, S, 82), (m - 0.75, T1, 86), (m - 0.5, T2, 92), (m - 0.25, T4, 100)]


def fill_triplet(m):
    return [(m - 1 + i / 3, n, 80 + 8 * i) for i, n in enumerate((S, T2, T4))]


def fill_toms(m):
    return [(m - 2 + i / 4, (T1, T1, T2, T2, T3, T3, T4, S)[i], 70 + 4 * i) for i in range(8)]


def fill_pickup(m):
    return [(m - 0.5, S, 74), (m - 0.25, S, 84)]


def fill_cajon(m):
    return [(m - 1 + i / 4, CAJS if i % 2 else CAJ, 70 + 8 * i) for i in range(4)]


def fill_68(m):   # the last three eighths
    return [(m - 3 + i, n, 76 + 10 * i) for i, n in enumerate((S, T2, T4))]


def fill_conga(m):
    return [(m - 1 + i / 4, (CONGA_O, CONGA_M, BONGO_H, BONGO_L)[i], 76 + 6 * i) for i in range(4)]


DRUM_BANK = "Central Instrument Drum Kits"
PERC_BANK = "Central Instrument Percussion"
# (name, meter, kit (bank, preset), tempos, swing, fill, room, loudness dBFS RMS, pattern)
GROOVES = [
    ("Worship Eighths", 4, (DRUM_BANK, "Studio Kit"), (72, 96), 0, fill_snare, 0.10, -19, g_worship),
    ("Big Ride", 4, (DRUM_BANK, "Studio Kit"), (84, 112), 0, fill_toms, 0.12, -18, g_ride),
    ("Rim and Hat", 4, (DRUM_BANK, "Studio Kit"), (64, 84), 0, None, 0.16, -24, g_rim),
    ("Half-Time", 4, (DRUM_BANK, "Rusty Rock Kit"), (68, 84), 0, fill_snare, 0.14, -19, g_halftime),
    ("Four on the Floor", 4, (DRUM_BANK, "Studio Kit"), (108, 126), 0, fill_pickup, 0.08, -18, g_floor),
    ("Driving Sixteenths", 4, (DRUM_BANK, "Unruly Kit"), (92, 120), 0, fill_snare, 0.08, -18, g_sixteenths),
    ("Toms Build", 4, (DRUM_BANK, "Rusty Rock Kit"), (76, 100), 0, fill_toms, 0.18, -19, g_toms),
    ("Brushes Ballad", 4, (DRUM_BANK, "Brushes Kit"), (60, 78), 0, None, 0.20, -24, g_brushes),
    ("Waltz", 3, (DRUM_BANK, "Studio Kit"), (84, 116), 0, fill_pickup, 0.12, -21, g_waltz),
    ("Brushes Waltz", 3, (DRUM_BANK, "Brushes Kit"), (72, 100), 0, None, 0.20, -25, g_brush_waltz),
    ("Gospel Shuffle", 4, (DRUM_BANK, "Studio Kit"), (92, 116), 0, fill_triplet, 0.12, -18, g_shuffle),
    ("Brushes Swing", 4, (DRUM_BANK, "Brushes Kit"), (88, 120), 0, None, 0.18, -24, g_brush_swing),
    ("6/8 Ballad", 6, (DRUM_BANK, "Studio Kit"), (150, 192), 0, fill_68, 0.16, -21, g_68_ballad),
    ("6/8 Celtic Toms", 6, (DRUM_BANK, "Rusty Rock Kit"), (174, 222), 0, fill_68, 0.20, -19, g_68_celtic),
    ("Train Beat", 4, (DRUM_BANK, "Brushes Kit"), (100, 132), 0, fill_pickup, 0.12, -21, g_train),
    ("Kick and Clap", 4, (DRUM_BANK, "Unruly Kit"), (96, 124), 0, fill_pickup, 0.06, -18, g_pulse),
    ("Cajon Groove", 4, (PERC_BANK, "Hand Percussion"), (80, 104), 0.08, fill_cajon, 0.14, -21, g_cajon),
    ("Shaker and Congas", 4, (PERC_BANK, "Hand Percussion"), (88, 112), 0, fill_conga, 0.12, -22, g_congas),
    ("Frame Drum 6/8", 6, (PERC_BANK, "Hand Percussion"), (162, 210), 0, None, 0.18, -22, g_perc_68),
    ("Cinematic Swell", 4, (PERC_BANK, "Orchestral Percussion"), (66, 88), 0, None, 0.28, -22, g_swell),
]
AMBIENT = ["Sparkle", "Drift", "Breath", "Felt Piano", "Guitar Swells", "Cello Drone", "Choir Air", "Harp Rain"]
# the ambient styles played on the libraries' instruments: (bank, preset words, fallbacks [(bank, words)], GM program)
AMB_SOUNDS = {
    "Felt Piano": ("Central Keys Grand Pianos", ["Soft Grand"], [("Central Keys Pianos", ["Soft Upright"])], 0),
    "Guitar Swells": ("Central Instrument Guitars and Basses", ["Electric Guitar Clean"], [("Central Instrument Guitars and Basses", ["Hollowbody"])], 27),
    "Cello Drone": ("VSCO Strings", ["Cello Pad"], [("Central Instrument Guitars and Basses", ["Upright Bass", "bowed"]), ("Central Keys Pads", ["String Pad"])], 42),
    "Cello Drone low": ("Central Instrument Guitars and Basses", ["Upright Bass", "bowed"], [("VSCO Strings", ["Contrabass"])], 43),
    "Choir Air aah": ("Central Keys Pads", ["Choir Aah"], [("Central Keys Pads", ["Choir"])], 52),
    "Choir Air ooh": ("Central Keys Pads", ["Choir Ooh"], [("Central Keys Pads", ["Choir"])], 53),
    "Harp Rain": ("Central Instrument Harps", ["Concert Harp"], [("Central Instrument Harps", ["Harp"])], 46),
}


def slug(s):
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-").replace("--", "-")


def write_wav(path, x, sr):
    x = np.asarray(x, np.float32)
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path + ".part", "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    os.replace(path + ".part", path)


def find_bank(dirs, bank):
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.lower().endswith(".sf2") and fn.split(" - ")[0].strip().lower().replace("-", " ") == bank.lower():
                return os.path.join(d, fn)
    return None


def kit(sounds, gm, spec):
    """(sf2, bank, program, channel)"""
    bank_name, preset = spec
    if gm:
        return gm, 128, 0, 9
    path = find_bank([sounds], bank_name)
    if not path:
        raise SystemExit("no %s SoundFont in %s (build the libraries first)" % (bank_name, sounds))
    pr = M.find_preset(path, preset) or M.find_preset(path, preset.split()[0]) or M.find_preset(path, "Kit")
    if not pr:
        raise SystemExit("no preset %r in %s" % (preset, path))
    return path, pr[0], pr[1], 0


def room_ir(seconds, seed, sr, dark=5000.0):
    rng = np.random.default_rng(seed)
    m = int(seconds * sr)
    t = np.arange(m) / sr
    ir = rng.normal(0, 1, m) * np.exp(-6.9 * t / seconds)
    f = np.fft.rfftfreq(m, 1 / sr)
    ir = np.fft.irfft(np.fft.rfft(ir) / (1 + (f / dark) ** 2), m)
    ir[:int(0.008 * sr)] = 0
    return ir / np.sqrt(np.sum(ir ** 2))


def wrap_room(x, wet, seed, sr, seconds=0.9):
    """A room added round the loop (circular convolution): the loop stays seamless. Left and right differ a little."""
    if wet <= 0:
        return x
    n = len(x)
    out = x.copy()
    for c in range(x.shape[1]):
        ir = np.zeros(n)
        r = room_ir(min(seconds, n / sr * 0.9), seed * 2 + c, sr)
        ir[:len(r)] = r
        out[:, c] = x[:, c] + wet * np.fft.irfft(np.fft.rfft(x[:, c]) * np.fft.rfft(ir), n)
    return out


def groove_hits(name, meter, pattern, fill, bar, rng):
    hits = pattern(bar, rng)
    if bar == LOOP_BARS - 1 and fill is not None:
        f = fill(meter)
        start = min(at for at, _, _ in f)
        hits = [h for h in hits if h[0] < start or h[1] not in HANDS] + f
    return hits


def build_drums(out, sounds=None, gm=None, log=print):
    folder = os.path.join(out, "drums")
    os.makedirs(folder, exist_ok=True)
    index = []
    for name, meter, kit_spec, tempos, sw, fill, room, db, pat in GROOVES:
        sf2, bank, prog, ch = kit(sounds, gm, kit_spec)
        for bpm in tempos:
            fn = "%s-%d.wav" % (slug(name), bpm)
            path = os.path.join(folder, fn)
            index.append({"name": name, "file": fn, "bpm": bpm, "meter": meter, "bars": LOOP_BARS, "kit": kit_spec[1]})
            if os.path.isfile(path):
                continue
            mid = M.Midi(bpm)
            if ch != 9:
                mid.program(ch, prog, bank)
            rng = np.random.default_rng(len(name) * 1000 + bpm)
            lead = 0.004 * bpm / 60.0        # (4 ms: no hit starts on the loop's very first sample, so the turn is clean)
            for bar in range(LOOP_BARS):
                for at, note, v in groove_hits(name, meter, pat, fill, bar, rng):
                    at = swing(at, sw)
                    # (a drummer's time: the kick on the grid, the backbeat and hand drums a touch late, the hats loose)
                    late = 0.012 if note in (S, X, CLAP, CAJS) and meter != 6 else 0.0
                    spread = 0.006 if note in (K, CAJ, OBD) else 0.014
                    vel = int(max(1, min(127, v + rng.integers(-5, 6))))
                    mid.note(max(0.0, bar * meter + at + late + float(rng.normal(0, spread))) + lead, 0.25, note, vel, ch)
            with tempfile.TemporaryDirectory() as tmp:
                mp = os.path.join(tmp, "loop.mid")
                mid.save(mp)
                y = M.render(sf2, mp, sr=DRUM_SR)
            n = int(round(LOOP_BARS * meter * 60.0 / bpm * DRUM_SR))
            y = np.pad(y, ((0, max(0, 2 * n - len(y))), (0, 0)))
            loop = y[:n].copy()
            loop += y[n:2 * n]                    # (what rings past the loop's end comes in at its start: seamless)
            loop = wrap_room(loop, room, len(name), DRUM_SR)
            rms = float(np.sqrt(np.mean(loop ** 2))) or 1.0
            loop *= 10 ** (db / 20.0) / rms
            peak = float(np.max(np.abs(loop)))
            if peak > 0.89:
                loop *= 0.89 / peak
            write_wav(path, loop, DRUM_SR)
    with open(os.path.join(folder, "index.json"), "w") as f:
        json.dump(index, f, indent=1)
    log("    drums: %d loops" % len(index))
    return index


# ---------------------------------------------------------------- ambient
def circular_reverb(x, seconds=3.0, wet=0.35, seed=4, dark=None):
    """A reverb whose tail wraps round (circular convolution): the loop stays seamless."""
    n = len(x)
    rng = np.random.default_rng(seed)
    m = min(int(seconds * AMB_SR), n)
    ir = np.zeros(n)
    t = np.arange(m) / AMB_SR
    ir[:m] = rng.normal(0, 1, m) * np.exp(-6.9 * t / seconds)
    if dark:
        f = np.fft.rfftfreq(n, 1 / AMB_SR)
        ir = np.fft.irfft(np.fft.rfft(ir) / (1 + (f / dark) ** 2), n)
    ir[:int(0.03 * AMB_SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    return x + wet * np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(ir), n)


def circular_echo(x, seconds, feedback, repeats=8):
    """Echoes that wrap round the loop."""
    out = x.copy()
    d = int(seconds * AMB_SR)
    g = 1.0
    for k in range(1, repeats + 1):
        g *= feedback
        out += g * np.roll(x, d * k)
    return out


def fold(y, n):
    """A render longer than the loop folded round onto it: what rings on comes in at the start."""
    out = np.zeros((n, y.shape[1]), np.float64)
    for i in range(0, len(y), n):
        seg = y[i:i + n]
        out[:len(seg)] += seg
    return out


def read_pad(pads, style, key):
    styles = [style] + [s for s in ("Warm", "Worship", "Air", "Shimmer", "Swell", "Strings") if s != style]
    for st in styles:   # (a style the pads don't have any more: the nearest one there is)
        p = os.path.join(pads, st.replace(" ", "-"), key.replace("#", "s") + ".wav")
        if os.path.isfile(p):
            break
    w = wave.open(p)
    x = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, 2).astype(np.float32) / 32768
    sr = w.getframerate()
    if sr != AMB_SR:
        idx = np.arange(int(len(x) * AMB_SR / sr)) * sr / AMB_SR
        x = np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1).astype(np.float32)
    reps = int(round(AMB_SECONDS * AMB_SR)) // len(x) + 1
    return np.tile(x, (reps, 1))[:int(AMB_SECONDS * AMB_SR)]


def instrument(style, sounds, orchestra, gm):
    """(sf2, bank, program) for an ambient style, or None if nothing here plays it."""
    bank, words, fallbacks, gm_prog = AMB_SOUNDS[style]
    if gm:
        return gm, 0, gm_prog
    for b, w in [(bank, words)] + fallbacks:
        path = find_bank([sounds, orchestra], b)
        pr = M.find_preset(path, *w) if path else None
        if pr:
            return path, pr[0], pr[1]
    return None


def ambient_styles(sounds=None, orchestra=None, gm=None):
    """The ambient styles this build can make (the ones on instruments need the libraries' SoundFonts or a GM one)."""
    out = []
    for st in AMBIENT:
        need = [k for k in AMB_SOUNDS if k == st or k.startswith(st + " ")]
        if all(instrument(k, sounds, orchestra, gm) for k in need):
            out.append(st)
    return out


def play(style, sounds, orchestra, gm, notes, n, gain=0.5):
    """notes [(start s, length s, key, velocity, [(t, cc, value)])] on one instrument, folded onto a loop of n samples."""
    sf2, bank, prog = instrument(style, sounds, orchestra, gm)
    mid = M.Midi(60)                      # (at 60 BPM a beat is a second)
    mid.program(0, prog, bank)
    for at, ln, key, vel, ccs in notes:
        for t, num, val in ccs:
            mid.cc(at + t, num, int(val), 0)
        mid.note(at, ln, int(key), int(vel), 0)
    with tempfile.TemporaryDirectory() as tmp:
        mp = os.path.join(tmp, "a.mid")
        mid.save(mp)
        y = M.render(sf2, mp, sr=AMB_SR, gain=gain)
    return fold(y.astype(np.float64), n)


def ambient(style, ki, pads, sounds=None, orchestra=None, gm=None):
    n = int(AMB_SECONDS * AMB_SR)
    t = np.arange(n) / AMB_SR
    rng = np.random.default_rng(100 + ki * 7 + AMBIENT.index(style))
    pent = [0, 2, 4, 7, 9]
    if style == "Sparkle":     # soft bells on the key's major pentatonic, two octaves up, at uneven moments
        x = np.zeros((n, 2))
        at = 0.0
        while at < AMB_SECONDS:
            note = 72 + ki + pent[rng.integers(0, 5)] + 12 * int(rng.integers(0, 2))
            note = note - 12 if note > 96 else note
            b = SY.struck("bells", int(note), 9)
            if SY.SR != AMB_SR:
                b = np.interp(np.arange(int(len(b) * AMB_SR / SY.SR)) * SY.SR / AMB_SR, np.arange(len(b)), b)
            pan = rng.uniform(0.2, 0.8)
            amp = rng.uniform(0.25, 0.6)
            idx = (int(at * AMB_SR) + np.arange(len(b))) % n          # (a note near the end rings on at the start)
            np.add.at(x[:, 0], idx, b * amp * math.cos(pan * math.pi / 2))
            np.add.at(x[:, 1], idx, b * amp * math.sin(pan * math.pi / 2))
            at += rng.uniform(0.45, 1.3)
        x = np.stack([circular_reverb(x[:, 0], wet=0.6, seed=4), circular_reverb(x[:, 1], wet=0.6, seed=5)], axis=1)
    elif style == "Drift":     # two pads, each fading in as the other fades out, once round the loop
        a, b = read_pad(pads, "Warm", KEYS[ki]), read_pad(pads, "Shimmer", KEYS[ki])
        g = 0.5 + 0.5 * np.sin(2 * math.pi * t / AMB_SECONDS)
        x = a * g[:, None] + b * (1 - g)[:, None] * 0.8
    elif style == "Breath":    # air (noise on the loop's own bins, so it repeats exactly) and the Air pad, swelling twice
        f = np.fft.rfftfreq(n, 1 / AMB_SR)
        x = np.zeros((n, 2))
        for c in range(2):
            spec = np.exp(1j * rng.uniform(0, 2 * math.pi, len(f))) * np.exp(-0.5 * ((f - 1800) / 1400.0) ** 2)
            spec[0] = 0
            x[:, c] = np.fft.irfft(spec, n)
        x /= float(np.max(np.abs(x))) or 1.0
        swell = 0.55 + 0.45 * np.sin(2 * math.pi * 2 * t / AMB_SECONDS - math.pi / 2)
        x = x * 0.5 * swell[:, None] + read_pad(pads, "Air", KEYS[ki]) * (0.4 + 0.3 * swell)[:, None]
    elif style == "Felt Piano":   # a few soft piano notes in the middle of the keyboard, each echoing away; dark and close
        notes, at = [], 0.3
        while at < AMB_SECONDS - 0.2:
            k = 60 + ki + [0, 4, 7, 11, 14, 16, 19][rng.integers(0, 7)]
            k = k - 12 if k > 84 else k
            notes.append((at, 3.0, k, int(rng.integers(30, 52)), []))
            if rng.random() < 0.35:     # (now and then a pair, like a hand resting on two keys)
                notes.append((at + 0.04, 3.0, k - [3, 4, 5][rng.integers(0, 3)], int(rng.integers(26, 40)), []))
            at += rng.uniform(1.1, 2.4)
        x = play("Felt Piano", sounds, orchestra, gm, notes, n, gain=0.7)
        f = np.fft.rfftfreq(n, 1 / AMB_SR)
        for c in range(2):    # (felt over the hammers: the top rolled off)
            x[:, c] = np.fft.irfft(np.fft.rfft(x[:, c]) / np.sqrt(1 + (f / 2200.0) ** 4), n)
        x = circular_echo(x, 0.62, 0.38, 6)
        x[:, 1] = np.roll(x[:, 1], int(0.012 * AMB_SR))
        x = np.stack([circular_reverb(x[:, c], seconds=3.5, wet=0.5, seed=20 + c, dark=4000) for c in range(2)], axis=1)
    elif style == "Guitar Swells":   # clean guitar notes that fade in (the volume knob rolled up) and echo away
        notes, at = [], 0.0
        while at < AMB_SECONDS - 0.5:
            k = 59 + ki + [0, 7, 12, 14, 16, 19][rng.integers(0, 6)]
            k = k - 12 if k > 81 else k
            swell = [(i * 0.08, 11, int(127 * (i / 10) ** 1.6)) for i in range(11)] + [(0.0, 7, 110)]
            notes.append((at, 2.6, k, 84, [(0.0, 11, 0)] + swell))
            at += rng.uniform(1.4, 2.6)
        x = play("Guitar Swells", sounds, orchestra, gm, notes, n, gain=0.7)
        x = circular_echo(x, 0.45, 0.45, 8)
        x[:, 0] = np.roll(x[:, 0], int(0.225 * AMB_SR)) * 0.6 + x[:, 0] * 0.7   # (a ping-pong echo: left a half-step behind)
        x = np.stack([circular_reverb(x[:, c], seconds=5.0, wet=0.8, seed=30 + c, dark=6000) for c in range(2)], axis=1)
    elif style == "Cello Drone":    # a bowed bass on the root and a cello on the fifth, each swelling at its own pace
        root = 36 + ki if ki < 7 else 24 + ki
        lo = play("Cello Drone low", sounds, orchestra, gm, [(0, AMB_SECONDS + 1.5, root, 70, [])], n, gain=0.7)
        hi = play("Cello Drone", sounds, orchestra, gm, [(0.5, AMB_SECONDS, root + 19, 60, []), (6.4, AMB_SECONDS, root + 24, 50, [])], n, gain=0.6)
        g1 = 0.7 + 0.3 * np.sin(2 * math.pi * t / AMB_SECONDS)
        g2 = 0.6 + 0.4 * np.sin(2 * math.pi * 2 * t / AMB_SECONDS + 1.0)
        x = lo * g1[:, None] + hi * g2[:, None] * 0.8
        x = np.stack([circular_reverb(x[:, c], seconds=4.0, wet=0.45, seed=40 + c, dark=3500) for c in range(2)], axis=1)
    elif style == "Choir Air":      # voices on "aah" then "ooh" (root, fifth and ninth), over a breath of air
        base = 48 + ki
        voicing = [base, base + 7, base + 14, base + 16]
        aah = play("Choir Air aah", sounds, orchestra, gm, [(0, AMB_SECONDS + 1, k, 66, []) for k in voicing], n, gain=0.45)
        ooh = play("Choir Air ooh", sounds, orchestra, gm, [(0, AMB_SECONDS + 1, k, 66, []) for k in voicing], n, gain=0.45)
        g = 0.5 + 0.5 * np.cos(2 * math.pi * t / AMB_SECONDS)
        x = aah * g[:, None] + ooh * (1 - g)[:, None]
        f = np.fft.rfftfreq(n, 1 / AMB_SR)
        air = np.zeros((n, 2))
        for c in range(2):
            spec = np.exp(1j * rng.uniform(0, 2 * math.pi, len(f))) * np.exp(-0.5 * ((f - 3500) / 2200.0) ** 2)
            spec[0] = 0
            air[:, c] = np.fft.irfft(spec, n)
        x = x / (float(np.max(np.abs(x))) or 1.0) + air / (float(np.max(np.abs(air))) or 1.0) * 0.12
        x = np.stack([circular_reverb(x[:, c], seconds=4.5, wet=0.6, seed=50 + c, dark=7000) for c in range(2)], axis=1)
    else:                           # Harp Rain: harp runs down the key's add9 chord, now and then, with space between
        notes, at = [], 0.2
        while at < AMB_SECONDS - 1.0:
            top = 84 + ki - 12 * int(rng.integers(0, 2))
            run = [top + (0, -3, -5, -8, -10)[j % 5] - 12 * (j // 5) for j in range(int(rng.integers(6, 11)))]
            step = rng.uniform(0.07, 0.11)
            for j, k in enumerate(run):
                notes.append((at + j * step + float(rng.normal(0, 0.006)), 2.5, k, int(66 - 3 * j + rng.integers(-4, 5)), []))
            at += len(run) * step + rng.uniform(1.8, 3.2)
        x = play("Harp Rain", sounds, orchestra, gm, notes, n, gain=0.6)
        x = np.stack([circular_reverb(x[:, c], seconds=4.0, wet=0.55, seed=60 + c, dark=8000) for c in range(2)], axis=1)
    return x * (0.6 / (float(np.max(np.abs(x))) or 1.0))


def build_ambient(out, pads, sounds=None, orchestra=None, gm=None, log=print):
    folder = os.path.join(out, "ambient")
    os.makedirs(folder, exist_ok=True)
    index = []
    styles = ambient_styles(sounds, orchestra, gm)
    for style in AMBIENT:
        if style not in styles:
            log("    ambient: %s needs the libraries' instruments (left out)" % style)
            continue
        for ki, key in enumerate(KEYS):
            fn = "%s-%s.wav" % (slug(style), key.replace("#", "s"))
            index.append({"name": style, "file": fn, "key": key, "seconds": AMB_SECONDS})
            path = os.path.join(folder, fn)
            if not os.path.isfile(path):
                write_wav(path, ambient(style, ki, pads, sounds, orchestra, gm), AMB_SR)
    with open(os.path.join(folder, "index.json"), "w") as f:
        json.dump(index, f, indent=1)
    log("    ambient: %d loops" % len(index))
    return index


def main(argv):
    opt, i = {}, 0
    while i < len(argv):
        if argv[i] in ("--sounds", "--pads", "--out", "--gm", "--orchestra") and i + 1 < len(argv):
            opt[argv[i][2:]] = argv[i + 1]
            i += 2
            continue
        print(__doc__)
        return 2
    if not opt.get("out") or not opt.get("pads") or not (opt.get("sounds") or opt.get("gm")):
        print(__doc__)
        return 2
    print("Loops -> %s" % opt["out"], flush=True)
    build_drums(opt["out"], opt.get("sounds"), opt.get("gm"))
    build_ambient(opt["out"], opt["pads"], opt.get("sounds"), opt.get("orchestra"), opt.get("gm"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
