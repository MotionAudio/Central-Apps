#!/usr/bin/env python3
"""Central Pedal - loops for the texture channels (10.0), made here (no one else's recording):

  drums/    Drum loops (Central Instrument): ten two-bar grooves played on the library's own drum kits (Studio, Rusty
            Rock, Unruly, Brushes - CC0 samples, see sounds-sfz.py) at 70 and 100 BPM. The app plays the one nearest the
            song's tempo, a little faster or slower to fit it.
  ambient/  Ambient loops (Central Pads, so every plan): Sparkle (soft bells on the key's pentatonic notes), Drift (two
            pads slowly trading places) and Breath (air and a pad, rising and falling), 12 seconds in all 12 keys. Each
            is exactly periodic - its echoes and tails wrap round to the start - so it repeats without a seam.

Each folder gets an index.json: [{name, file, bpm, meter, bars} | {name, file, key, seconds}].

    python3 tools/make-loops.py --sounds DIR --pads DIR --out DIR      (--sounds: the kits' SoundFont; --pads: make-pad-loops' output)
    python3 tools/make-loops.py --gm FILE.sf2 --pads DIR --out DIR     (a test with any General MIDI SoundFont)
Needs fluidsynth and python3-numpy. Deterministic: the same files every build. (A file already there is kept.)"""
import importlib.util
import json
import math
import os
import sys
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
TEMPOS = (70, 100)
K, S, X, HC, HP, HO, RIDE, CRASH, T1, T2, T3, T4 = 36, 38, 37, 42, 44, 46, 51, 49, 50, 47, 43, 41


def eighths(note, v1, v2, beats):
    return [(i / 2, note, v1 if i % 2 == 0 else v2) for i in range(beats * 2)]


def pat_worship(m):
    return [(0, K, 92), (1.5, K, 70), (2, K, 84), (1, S, 95), (3, S, 98)] + eighths(HC, 72, 52, 4)


def pat_ride(m):
    return [(0, K, 105), (1.5, K, 84), (2, K, 98), (2.5, K, 70), (1, S, 110), (3, S, 112)] + eighths(RIDE, 84, 64, 4)


def pat_quiet(m):
    return [(0, K, 70), (2, X, 58)] + [(q, HC, 46) for q in range(4)]


def pat_halftime(m):
    return [(0, K, 98), (0.5, K, 60), (1.75, K, 72), (2, S, 108)] + eighths(HC, 70, 50, 4)


def pat_floor(m):
    return [(q, K, 100) for q in range(4)] + [(1, S, 96), (3, S, 98)] + [(q + 0.5, HO, 70) for q in range(4)] + [(q, HC, 50) for q in range(4)]


def pat_sixteenths(m):
    return [(0, K, 100), (1.5, K, 80), (2.5, K, 90), (1, S, 104), (3, S, 106)] + [(i / 4, HC, 74 if i % 4 == 0 else 48 if i % 2 else 58) for i in range(16)]


def pat_toms(m):
    return [(0, K, 96), (2, K, 90)] + [(i / 2, T4 if i % 4 < 2 else T3, 90 if i % 2 == 0 else 70) for i in range(8)]


def pat_brushes(m):
    return [(0, K, 60), (2, K, 54), (1, S, 70), (3, S, 74)] + [(i / 3 + q, S, 32) for q in range(4) for i in range(3)]


def pat_waltz(m):
    return [(0, K, 88), (1, HP, 52), (2, S, 82)] + eighths(HC, 66, 46, 3)


def pat_waltz_brush(m):
    return [(0, K, 58), (2, S, 66)] + [(i / 3 + q, S, 30) for q in range(3) for i in range(3)]


GROOVES = [("Worship Eighths", 4, "Studio Kit", pat_worship), ("Big Ride", 4, "Studio Kit", pat_ride), ("Rim and Hat", 4, "Studio Kit", pat_quiet),
           ("Half-Time", 4, "Rusty Rock Kit", pat_halftime), ("Four on the Floor", 4, "Studio Kit", pat_floor), ("Driving Sixteenths", 4, "Unruly Kit", pat_sixteenths),
           ("Toms Build", 4, "Rusty Rock Kit", pat_toms), ("Brushes Ballad", 4, "Brushes Kit", pat_brushes), ("Waltz", 3, "Studio Kit", pat_waltz),
           ("Brushes Waltz", 3, "Brushes Kit", pat_waltz_brush)]
AMBIENT = ["Sparkle", "Drift", "Breath"]


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


def kit(sounds, gm, name):
    """(sf2, bank, program, channel)"""
    if gm:
        return gm, 128, 0, 9
    path = None
    for fn in sorted(os.listdir(sounds)):
        if fn.lower().endswith(".sf2") and fn.split(" - ")[0].strip().lower() == "central instrument drum kits":
            path = os.path.join(sounds, fn)
    if not path:
        raise SystemExit("no Central Instrument Drum Kits SoundFont in %s (build the libraries first)" % sounds)
    pr = M.find_preset(path, *name.split()[:1]) or M.find_preset(path, "Kit")
    return path, pr[0], pr[1], 0


def build_drums(out, sounds=None, gm=None, log=print):
    folder = os.path.join(out, "drums")
    os.makedirs(folder, exist_ok=True)
    index = []
    for name, meter, kit_name, pat in GROOVES:
        sf2, bank, prog, ch = kit(sounds, gm, kit_name)
        for bpm in TEMPOS:
            fn = "%s-%d.wav" % (slug(name), bpm)
            path = os.path.join(folder, fn)
            index.append({"name": name, "file": fn, "bpm": bpm, "meter": meter, "bars": 2, "kit": kit_name})
            if os.path.isfile(path):
                continue
            mid = M.Midi(bpm)
            if ch != 9:
                mid.program(ch, prog, bank)
            rng = np.random.default_rng(len(name) * 1000 + bpm)
            for bar in range(2):
                hits = pat(meter)
                if bar == 1 and name not in ("Rim and Hat", "Brushes Ballad", "Brushes Waltz"):   # (the second bar: a little pickup into the loop's start)
                    hits = [h for h in hits if h[0] < meter - 0.5] + [(meter - 0.5, S, 74), (meter - 0.25, S, 82)]
                for at, note, v in hits:
                    mid.note(bar * meter + at + float(rng.normal(0, 0.006)), 0.25, note, int(max(1, min(127, v + rng.integers(-4, 5)))), ch)
            tmp = os.path.join(folder, fn + ".mid")
            mid.save(tmp)
            y = M.render(sf2, tmp, sr=DRUM_SR)
            os.remove(tmp)
            n = int(round(2 * meter * 60.0 / bpm * DRUM_SR))
            y = np.pad(y, ((0, max(0, 2 * n - len(y))), (0, 0)))
            loop = y[:n].copy()
            loop += y[n:2 * n]                    # (what rings past the loop's end comes in at its start: seamless)
            loop *= 0.7 / (float(np.max(np.abs(loop))) or 1.0)
            write_wav(path, loop, DRUM_SR)
    with open(os.path.join(folder, "index.json"), "w") as f:
        json.dump(index, f, indent=1)
    log("    drums: %d loops" % len(index))
    return index


def circular_reverb(x, seconds=3.0, wet=0.35, seed=4):
    """A reverb whose tail wraps round (circular convolution): the loop stays seamless."""
    n = len(x)
    rng = np.random.default_rng(seed)
    m = int(seconds * AMB_SR)
    ir = np.zeros(n)
    t = np.arange(m) / AMB_SR
    ir[:m] = rng.normal(0, 1, m) * np.exp(-6.9 * t / seconds)
    ir[:int(0.03 * AMB_SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    return x + wet * np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(ir), n)


def read_pad(pads, style, key):
    p = os.path.join(pads, style.replace(" ", "-"), key.replace("#", "s") + ".wav")
    w = wave.open(p)
    x = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, 2).astype(np.float32) / 32768
    if w.getframerate() != AMB_SR:
        raise ValueError("a pad at %d Hz" % w.getframerate())
    reps = int(round(AMB_SECONDS * AMB_SR)) // len(x) + 1
    return np.tile(x, (reps, 1))[:int(AMB_SECONDS * AMB_SR)]


def ambient(style, ki, pads):
    n = int(AMB_SECONDS * AMB_SR)
    t = np.arange(n) / AMB_SR
    rng = np.random.default_rng(100 + ki * 7 + AMBIENT.index(style))
    if style == "Sparkle":     # soft bells on the key's major pentatonic, two octaves up, at uneven moments
        x = np.zeros((n, 2))
        steps = [0, 2, 4, 7, 9]
        at = 0.0
        while at < AMB_SECONDS:
            note = 72 + ki + steps[rng.integers(0, 5)] + 12 * int(rng.integers(0, 2))
            note = note - 12 if note > 96 else note
            b = SY.struck("bells", int(note), 9)
            if SY.SR != AMB_SR:
                b = np.interp(np.arange(int(len(b) * AMB_SR / SY.SR)) * SY.SR / AMB_SR, np.arange(len(b)), b)
            pan = rng.uniform(0.2, 0.8)
            amp = rng.uniform(0.25, 0.6)
            i = int(at * AMB_SR)
            idx = (i + np.arange(len(b))) % n          # (a note near the end rings on at the start)
            np.add.at(x[:, 0], idx, b * amp * math.cos(pan * math.pi / 2))
            np.add.at(x[:, 1], idx, b * amp * math.sin(pan * math.pi / 2))
            at += rng.uniform(0.45, 1.3)
        x = np.stack([circular_reverb(x[:, 0], wet=0.6, seed=4), circular_reverb(x[:, 1], wet=0.6, seed=5)], axis=1)
    elif style == "Drift":     # two pads, each fading in as the other fades out, once round the loop
        a, b = read_pad(pads, "Warm", KEYS[ki]), read_pad(pads, "Shimmer", KEYS[ki])
        g = 0.5 + 0.5 * np.sin(2 * math.pi * t / AMB_SECONDS)
        x = a * g[:, None] + b * (1 - g)[:, None] * 0.8
    else:                      # Breath: air (noise on the loop's own bins, so it repeats exactly) and the Air pad, swelling twice
        f = np.fft.rfftfreq(n, 1 / AMB_SR)
        x = np.zeros((n, 2))
        for c in range(2):
            spec = np.exp(1j * rng.uniform(0, 2 * math.pi, len(f))) * np.exp(-0.5 * ((f - 1800) / 1400.0) ** 2)
            spec[0] = 0
            x[:, c] = np.fft.irfft(spec, n)
        x /= float(np.max(np.abs(x))) or 1.0
        swell = 0.55 + 0.45 * np.sin(2 * math.pi * 2 * t / AMB_SECONDS - math.pi / 2)
        x = x * 0.5 * swell[:, None] + read_pad(pads, "Air", KEYS[ki]) * (0.4 + 0.3 * swell)[:, None]
    return x * (0.6 / (float(np.max(np.abs(x))) or 1.0))


def build_ambient(out, pads, log=print):
    folder = os.path.join(out, "ambient")
    os.makedirs(folder, exist_ok=True)
    index = []
    for style in AMBIENT:
        for ki, key in enumerate(KEYS):
            fn = "%s-%s.wav" % (slug(style), key.replace("#", "s"))
            index.append({"name": style, "file": fn, "key": key, "seconds": AMB_SECONDS})
            path = os.path.join(folder, fn)
            if not os.path.isfile(path):
                write_wav(path, ambient(style, ki, pads), AMB_SR)
    with open(os.path.join(folder, "index.json"), "w") as f:
        json.dump(index, f, indent=1)
    log("    ambient: %d loops" % len(index))
    return index


def main(argv):
    opt, i = {}, 0
    while i < len(argv):
        if argv[i] in ("--sounds", "--pads", "--out", "--gm") and i + 1 < len(argv):
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
    build_ambient(opt["out"], opt["pads"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
