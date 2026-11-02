#!/usr/bin/env python3
"""Central Pedal - Central Pads: the pad pedal's pads, synthesised here (no one else's recording).

  <out>/<Style>/<Key>.wav - 20 styles in all 12 keys, each a stereo chord (root, fifth, octave - Morning adds the 9th)
  LOOP seconds long that repeats without a seam. The pad pedal plays the file of the song's key as it is (no pitch
  shifting). C# is "Cs" in a file name (no # in a file name or a web address).

    python3 tools/make-pad-loops.py <out folder> [--style NAME]... [--key C#]...

10.2: every style is built its own way - its own voices (saws, pulse waves, a choir through vowel formants, a bowed
section, FM glass, bells, drawbars, tuned breath...), its own movement (a breathing or sweeping filter, swells, a rotary
speaker, tremolo), its own stereo picture and its own reverb (a small room, a plate, a hall, a cathedral, a shimmer).
tools/pad_voices.py describes each one. Everything wraps round the loop, so it repeats with no seam.
Needs python3-numpy. Deterministic: the same files every build. (A file already there is kept.)"""
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pad_dsp as D  # noqa: E402
import pad_voices as PV  # noqa: E402

SR = D.SR
LOOP = 12.0        # seconds: long enough that the movement doesn't feel like it repeats (and 12 s loops tile into the ambient loops)
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
LOW = 48           # (each key's root in the octave from C3: C3..B3)
NAMES = ["Warm", "Air", "Choir Aah", "Choir Ooh", "Shimmer", "Strings", "Glass", "Swell", "Worship", "Ambient Drone", "Deep", "Heaven",
         "Felt", "Organ", "Analog", "Bowed", "Bells", "Choir Hum", "Cinematic", "Morning"]
STYLES = [(n, PV.STYLES[n]) for n in NAMES]


def say(*a):
    print(*a, flush=True)


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


def render(style, key, seed=21):
    """One style in one key: stereo, LOOP seconds, peaking at about -6 dBFS (room for layering)."""
    si, ki = NAMES.index(style), KEYS.index(key)
    lp = D.Loop(LOOP)
    x = PV.render(style, lp, LOW + ki, np.random.default_rng(seed + si * 97 + ki * 13))
    return x / (float(np.max(np.abs(x))) or 1.0) * 0.5


def build(out_dir, styles=None, keys=None, seed=21, log=say):
    """Every style in every key (or the ones named) into out_dir. Returns out_dir."""
    log("Central Pads (synthesised, %d styles x %d keys) -> %s" % (len(styles or NAMES), len(keys or KEYS), out_dir))
    for style in NAMES:
        if styles and style not in styles:
            continue
        for key in KEYS:
            if keys and key not in keys:
                continue
            path = os.path.join(out_dir, loop_file(style, key))
            if os.path.isfile(path):
                continue
            x = render(style, key, seed)
            loop_wav(path, x[:, 0], x[:, 1])
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
