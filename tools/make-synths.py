#!/usr/bin/env python3
"""Central Pedal - Central Keys Synths (10.0): ten synth sounds for the keys rig, synthesised here (no one else's
recording, so they're ours to sell with Central Keys).

  Held sounds (Saw Lead, Square Lead, Soft Lead, Synth Brass, Super Saw, String Machine, Sub Bass) are exact loops: every
  partial and its slow movement sit on whole cycles of the loop, so a held note never shows a seam (like the pads).
  Struck sounds (Synth Bass, Pluck, Electric Bells) are one-shots: each partial dies away on its own, the high ones first,
  the way a filter envelope closes.

    python3 tools/make-synths.py <out folder>
Writes "<out>/Central Keys Synths - central-keys-synths.sf2". Needs python3-numpy. Deterministic: the same file every
build. (A file already there is kept.)"""
import importlib.util
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("sounds_vsco", os.path.join(os.path.dirname(HERE), "sounds-vsco.py"))
V = importlib.util.module_from_spec(_s)
_s.loader.exec_module(V)
_s2 = importlib.util.spec_from_file_location("sounds_vcsl", os.path.join(HERE, "sounds-vcsl.py"))
VC = importlib.util.module_from_spec(_s2)
_s2.loader.exec_module(VC)

SR = 32000
LOOP = 2.0                       # seconds: a held note's loop
ONE_SHOT = 2.6                   # seconds: a struck note
ROOTS = list(range(24, 100, 4))  # a sample every major third, C1..B7
NAME = "Central Keys Synths"
FILE = "%s - %s.sf2" % (NAME, NAME.lower().replace(" ", "-"))


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12.0)


def periodic(parts, seed):
    """One exact loop from [(freq, amp, movement Hz, movement depth)]: built in the frequency domain (a partial with slow
    movement is itself and two sidebands), so it repeats with no seam."""
    rng = np.random.default_rng(seed)
    n = int(LOOP * SR)
    spec = np.zeros(n // 2 + 1, complex)

    def add(freq, amp, phase):
        k = int(round(freq * LOOP))
        if 0 < k < n // 2:
            spec[k] += amp * n / 2 * complex(math.cos(phase), math.sin(phase))
    for f, a, mv, depth in parts:
        ph, ps = rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi)
        add(f, a * (1 - depth / 2), ph - math.pi / 2)
        if depth and mv:
            add(f - mv, -a * depth / 4, ph - ps)
            add(f + mv, a * depth / 4, ph + ps - math.pi)
    x = np.fft.irfft(spec, n)
    return x / (np.sqrt(np.mean(x ** 2)) or 1.0) * 0.2


def q(f):
    return max(1, round(f * LOOP)) / LOOP


def saw(f0, cut, detunes=(0,), spread=0.0, move=0.2):
    nyq, out = 0.45 * SR, []
    for i, cents in enumerate(detunes):
        fv = f0 * 2 ** (cents / 1200.0)
        for k in range(1, 200):
            f = fv * k
            if f > nyq:
                break
            out.append((q(f), (1.0 / k) / (1 + (k / cut) ** 2.5), (k % 4 + 1 + i) / LOOP, move))
    return out


def square(f0, cut):
    nyq, out = 0.45 * SR, []
    for k in range(1, 200, 2):
        f = f0 * k
        if f > nyq:
            break
        out.append((q(f), (1.0 / k) / (1 + (k / cut) ** 2), (k % 3 + 1) / LOOP, 0.1))
    return out


def held(kind, note, seed):
    f0 = hz(note)
    if kind == "saw":
        parts = saw(f0, 30, (-6, 6), move=0.15)
    elif kind == "square":
        parts = square(f0, 18)
    elif kind == "soft":       # a flute-like lead: the fundamental and a breath of harmonics
        parts = [(q(f0 * k), a, (k + 1) / LOOP, 0.1) for k, a in ((1, 1.0), (2, 0.25), (3, 0.12), (4, 0.05)) if f0 * k < 0.45 * SR]
    elif kind == "brass":      # a saw through a darker filter, with the 2nd and 3rd harmonics pushed (a brassy edge)
        parts = [(f, a * (1.6 if round(f / f0) in (2, 3) else 1.0), mv, d) for f, a, mv, d in saw(f0, 9, (-4, 4), move=0.1)]
    elif kind == "supersaw":
        parts = saw(f0, 40, (-24, -14, -6, 0, 6, 14, 24), move=0.3)
    elif kind == "strings":    # a string machine: two detuned saws, soft top, a slow ensemble shimmer
        parts = saw(f0, 14, (-9, 9), move=0.45)
    elif kind == "sub":        # a sine with a little 2nd harmonic: felt more than heard
        parts = [(q(f0), 1.0, 0, 0), (q(f0 * 2), 0.18, 0, 0)]
    else:
        raise ValueError(kind)
    return periodic(parts, seed + note * 31).astype(np.float32)


def struck(kind, note, seed):
    rng = np.random.default_rng(seed + note * 17)
    f0 = hz(note)
    n = int(ONE_SHOT * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    if kind == "bells":        # two-operator FM bell: inharmonic partials, long ring, the top dying first
        for r, a, d in ((1, 1.0, 2.2), (2.0, 0.35, 1.4), (2.76, 0.45, 1.1), (4.07, 0.25, 0.7), (5.40, 0.15, 0.45), (8.93, 0.08, 0.25)):
            if f0 * r < 0.45 * SR:
                x += a * np.sin(2 * math.pi * f0 * r * t + rng.uniform(0, 6.28)) * np.exp(-t / d)
    else:                      # a saw whose upper harmonics close fast (pluck) or slower (bass)
        tau = 0.35 if kind == "pluck" else 0.6
        body = 1.6 if kind == "pluck" else 2.4
        for k in range(1, 120):
            f = f0 * k
            if f > 0.45 * SR:
                break
            x += (1.0 / k) * np.sin(2 * math.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t * (1 + k * 0.8) / tau) * (1 if k == 1 else 1)
        x *= np.exp(-t / body)
    x[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    fade = int(0.05 * SR)
    x[-fade:] *= np.linspace(1, 0, fade)
    return (x / (np.max(np.abs(x)) or 1.0) * 0.7).astype(np.float32)


# name, kind, held?, attack, release, notes range
SOUNDS = [
    ("Saw Lead", "saw", True, 0.01, 0.4), ("Square Lead", "square", True, 0.01, 0.3), ("Soft Lead", "soft", True, 0.06, 0.5),
    ("Synth Brass", "brass", True, 0.08, 0.4), ("Super Saw", "supersaw", True, 0.02, 0.8), ("String Machine", "strings", True, 0.35, 1.6),
    ("Sub Bass", "sub", True, 0.005, 0.15), ("Synth Bass", "bass", False, 0.001, 0.2), ("Pluck", "pluck", False, 0.001, 0.4),
    ("Electric Bells", "bells", False, 0.001, 1.2),
]


def build(out_dir, seed=31):
    out = os.path.join(out_dir, FILE)
    if os.path.isfile(out):
        return out
    V.say(NAME + " (synthesised)")
    samples, instruments, presets = [], [], []
    ranges = VC.key_ranges(ROOTS)
    for prog, (pname, kind, is_held, att, rel) in enumerate(SOUNDS):
        zones = []
        for note in ROOTS:
            if is_held:
                x = held(kind, note, seed + prog * 101)
                n = len(x)
                x = np.concatenate([x, x[:32]])   # (after the loop's end: its start again, for the interpolation)
                s, e = 0, n
            else:
                x = struck(kind, note, seed + prog * 101)
                s = e = None
            pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
            samples.append({"name": "%s%d_%d" % (kind[:6], note, len(samples)), "pcm": pcm, "sr": SR, "root": note, "s": s, "e": e})
            gens = [("keyRange", ranges[note]), ("attackVolEnv", V.tc(att)), ("releaseVolEnv", V.tc(rel)), ("reverbEffectsSend", 120), ("overridingRootKey", note)]
            if is_held:
                gens.append(("sampleModes", 1))
            gens.append(("sampleID", len(samples) - 1))
            zones.append(gens)
        instruments.append({"name": kind, "zones": zones})
        presets.append({"name": pname, "prog": prog, "zones": [[("keyRange", (0, 127)), ("instrument", len(instruments) - 1)]]})
    os.makedirs(out_dir, exist_ok=True)
    V.write_sf2(out, NAME, samples, instruments, presets, copyright="Motion Audio (synthesised - sold with Central Keys)",
                comment="Made by tools/make-synths.py: exact loops and one-shots, no recordings.")
    V.say("  -> %s (%.0f MB, %d samples)" % (os.path.basename(out), os.path.getsize(out) / 1e6, len(samples)))
    return out


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 2
    build(argv[0])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
