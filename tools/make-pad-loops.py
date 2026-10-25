#!/usr/bin/env python3
"""Central Pedal - Central Pads (9.8): the pad pedal's pads, synthesised here (no one else's recording).

  <out>/<Style>/<Key>.wav - 12 styles in all 12 keys, each a stereo chord (root, fifth, octave) LOOP seconds long that
  repeats without a seam. The pad pedal plays the file of the song's key as it is (no pitch shifting). C# is "Cs" in a
  file name (no # in a file name or a web address).

    python3 tools/make-pad-loops.py <out folder> [--style NAME]... [--key C#]...

The pad sounds are tools/make-pads.py's (the same partials and slow movement); each note is built in the frequency
domain - every partial and its movement sit on whole cycles of the loop, so one inverse FFT makes it, exactly
periodic. Needs python3-numpy. Deterministic: the same files every build. (A file already there is kept.)"""
import importlib.util
import math
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_s = importlib.util.spec_from_file_location("make_pads", os.path.join(HERE, "make-pads.py"))
MP = importlib.util.module_from_spec(_s)
_s.loader.exec_module(MP)

SR, LOOP = MP.SR, MP.LOOP
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
LOW = 48           # (each key's root in the octave from C3: C3..B3)
# name -> ([(make-pads kind, octave, gain)], chord intervals)
STYLES = [
    ("Warm", [("warm", 0, 1.0), ("warm", -1, 0.5)], (0, 7, 12)),
    ("Air", [("air", 0, 1.0), ("warm", -1, 0.35)], (0, 7, 12)),
    ("Choir Aah", [("aah", 0, 1.0), ("warm", -1, 0.3)], (0, 7, 12)),
    ("Choir Ooh", [("ooh", 0, 1.0), ("warm", -1, 0.35)], (0, 7, 12)),
    ("Shimmer", [("shimmer", 1, 0.8), ("worship", 0, 0.8)], (0, 7, 12)),
    ("Strings", [("string", 0, 1.0), ("string", -1, 0.4)], (0, 7, 12)),
    ("Glass", [("glass", 1, 0.7), ("warm", 0, 0.6)], (0, 7, 12)),
    ("Swell", [("swell", 0, 1.0), ("air", 1, 0.25)], (0, 7, 12)),
    ("Worship", [("worship", 0, 1.0), ("shimmer", 1, 0.35), ("warm", -1, 0.4)], (0, 7, 12)),
    ("Ambient Drone", [("drone", -1, 1.0), ("air", 0, 0.3)], (0, 7)),
    ("Deep", [("warm", -1, 1.0), ("swell", 0, 0.5)], (0, 7, 12)),
    ("Heaven", [("aah", 1, 0.5), ("shimmer", 1, 0.6), ("string", 0, 0.6)], (0, 7, 12)),
]
NAMES = [s[0] for s in STYLES]


def say(*a):
    print(*a, flush=True)


def pad_note_fast(kind, note, seed):
    """make-pads' pad_note, built in the frequency domain: a partial with slow movement is three bins (itself and two
    sidebands) - hundreds of times quicker than adding sines, and just as seamless."""
    rng = np.random.default_rng(seed + note * 31)
    n = int(LOOP * SR)
    spec = np.zeros(n // 2 + 1, complex)

    def add(freq, amp, phase):   # amp * cos(2 pi freq t + phase)
        k = int(round(freq * LOOP))
        if k < 0:
            k, phase = -k, -phase
        if k == 0:
            spec[0] += amp * math.cos(phase) * n
        elif k < n // 2:
            spec[k] += amp * n / 2 * complex(math.cos(phase), math.sin(phase))
    f0 = 440.0 * 2 ** ((note - 69) / 12.0)
    for cents in MP.VOICES[kind]:
        fv = f0 * 2 ** (cents / 1200.0)
        for f, a, mv, depth in MP.partials(kind, fv):
            fq, ph, ps = MP.q(f), rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi)
            add(fq, a * (1 - depth / 2), ph - math.pi / 2)            # a (1 - d/2) sin(w t + ph)
            add(fq - mv, -a * depth / 4, ph - ps)                     # - (a d/2) sin(m t + ps) sin(w t + ph), as two cosines
            add(fq + mv, a * depth / 4, ph + ps - math.pi)
    x = np.fft.irfft(spec, n)
    if kind == "air":   # (a little breath: periodic noise, its spectrum on the loop's own bins)
        nspec = np.zeros(n // 2 + 1, complex)
        bins = np.arange(len(nspec)) / LOOP
        band = np.exp(-0.5 * ((bins - min(6000, f0 * 8)) / 2500.0) ** 2)
        nspec[1:] = band[1:] * np.exp(1j * rng.uniform(0, 2 * math.pi, len(nspec) - 1))
        noise = np.fft.irfft(nspec, n)
        x = x / (np.max(np.abs(x)) or 1) + 0.25 * noise / (np.max(np.abs(noise)) or 1)
    return x / (np.sqrt(np.mean(x ** 2)) or 1.0) * 0.2


def loop_file(style, key):
    """<Style>/<key>.wav ("Cs" for C#)."""
    return os.path.join(style.replace(" ", "-"), key.replace("#", "s") + ".wav")


def loop_wav(path, left, right):
    """A 16-bit stereo WAV (the loop is the whole file)."""
    x = np.stack([np.asarray(left), np.asarray(right)], axis=1)
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path + ".part", "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    os.replace(path + ".part", path)


def build(out_dir, styles=None, keys=None, seed=21, log=say):
    """Every style in every key (or the ones named) into out_dir. Returns out_dir."""
    log("Central Pads (synthesised, %d styles x %d keys) -> %s" % (len(styles or NAMES), len(keys or KEYS), out_dir))
    for si, (style, layers, chord) in enumerate(STYLES):
        if styles and style not in styles:
            continue
        for ki, key in enumerate(KEYS):
            if keys and key not in keys:
                continue
            path = os.path.join(out_dir, loop_file(style, key))
            if os.path.isfile(path):
                continue
            root = LOW + ki
            chans = []
            for side in (0, 1):   # (left and right: the same chord, its partials' phases and movement drawn apart)
                x = np.zeros(int(LOOP * SR))
                for li, (kind, octave, gain) in enumerate(layers):
                    for ci, step in enumerate(chord):
                        note = root + 12 * octave + step
                        if 24 <= note <= 100:
                            x += gain * (1.0 if ci == 0 else 0.7) * pad_note_fast(kind, note, seed + si * 97 + li * 13 + side * 7919)
                chans.append(x)
            peak = max(float(np.max(np.abs(c))) for c in chans) or 1.0
            loop_wav(path, chans[0] / peak * 0.5, chans[1] / peak * 0.5)   # (about -6 dBFS peak: room for layering)
    return out_dir


def main(argv):
    styles, keys, args, i = [], [], [], 0
    while i < len(argv):
        if argv[i] in ("--style", "--key") and i + 1 < len(argv):
            (styles if argv[i] == "--style" else keys).append(argv[i + 1])
            i += 2
            continue
        args.append(argv[i])
        i += 1
    if len(args) != 1:
        print(__doc__)
        return 2
    build(args[0], styles or None, keys or None)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
