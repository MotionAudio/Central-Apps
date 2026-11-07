#!/usr/bin/env python3
"""Central Pedal - Central Pads: the pad pedal's pads, synthesised here (no one else's recording).

  <out>/<Style>/<Key>.wav - 94 styles in all 12 keys (41 in Central Pads, 35 more in Central Pads Extra - 10.3, 18 more in Central Pads More - 10.5), each a stereo chord (root, fifth, octave - Morning adds the 9th)
  LOOP seconds long that repeats without a seam. The pad pedal plays the file of the song's key as it is (no pitch
  shifting). C# is "Cs" in a file name (no # in a file name or a web address).

    python3 tools/make-pad-loops.py <out folder> [--cache DIR] [--pulse DIR] [--style NAME]... [--key C#]...
--pulse: also make the moving pads (10.3) as a loop set there: <DIR>/index.json and a 4-second bed per pad and key,
         each with its gate - the pad pedal's texture channels open and close the bed in time with the song.
--cache: the download cache (the styles made from recordings - tools/pad_sources.py, all CC0 - need it).

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
import pad_sources as PS  # noqa: E402

SR = D.SR
LOOP = 12.0        # seconds: slow movement that doesn't feel like it repeats (and 12 s loops tile exactly into the 12 s ambient loops)
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
LOW = 48           # (each key's root in the octave from C3: C3..B3)
NAMES = ["Warm", "Air", "Choir Aah", "Choir Ooh", "Shimmer", "Strings", "Glass", "Swell", "Worship", "Ambient Drone", "Deep", "Heaven",
         "Felt", "Organ", "Analog", "Bowed", "Bells", "Choir Hum", "Cinematic", "Morning",
         # 10.2, more: the worship pads first, then the ones made from recordings, then more synthesised ones
         "Sunday Keys", "Ember", "Halo", "Selah", "Tide", "Dawn", "Frozen Piano", "Bowed Glass", "Vibes", "Harp Wash", "Cathedral Organ",
         "Vowels", "Tape", "Sparkle", "Eighties", "Reed", "Swell Guitar", "Breathe", "Tanpura", "Horns", "Flute Choir"]
MAIN_NAMES = list(NAMES)            # (Central Pads)
NAMES += PV.EXTRA_NAMES              # (10.3: Central Pads Extra - after the 41, so theirs stay exactly as they were)
NAMES += PV.MORE_NAMES               # (10.5: Central Pads More - after those, for the same reason)
RECORDED = [n for n in NAMES if PV.needs_sources(n)]   # (made from CC0 recordings: they need the download cache)
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


def build(out_dir, styles=None, keys=None, seed=21, log=say, cache=None):
    """Every style in every key (or the ones named) into out_dir. Returns out_dir."""
    if cache:
        PV.set_sources(PS.Sources(cache))
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


PULSE_SECONDS = 4.0


def build_pulse(out_dir, keys=None, seed=77, log=say, pulses=None):
    """The moving pads: per pad and key, a 4-second seamless bed, and index.json [{name, file, key, seconds, gate}].
    (10.5) Without `pulses`: Central Pads Extra's set here, and Central Pads More's (PV.PULSES_MORE) in <out_dir>-more."""
    import json
    if pulses is None:
        index = build_pulse(out_dir, keys, seed, log, PV.PULSES)
        build_pulse(out_dir.rstrip("/\\") + "-more", keys, seed + 1000, log, PV.PULSES_MORE)
        return index
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for pi, (name, style, gate) in enumerate(pulses):
        for ki, key in enumerate(KEYS):
            fn = "%s-%s.wav" % (name.lower().replace(" ", "-"), key.replace("#", "s"))
            index.append({"name": name, "file": fn, "key": key, "seconds": PULSE_SECONDS, "gate": gate})
            path = os.path.join(out_dir, fn)
            if (keys and key not in keys) or os.path.isfile(path):
                continue
            x = PV.render(style, D.Loop(PULSE_SECONDS), LOW + ki, np.random.default_rng(seed + pi * 31 + ki))
            x = x / (float(np.max(np.abs(x))) or 1.0) * 0.5
            loop_wav(path, x[:, 0], x[:, 1])
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, indent=1)
    log("    moving pads: %d beds" % len(index))
    return index


def main(argv):
    styles, keys, args, i, cache, pulse = [], [], [], 0, None, None
    while i < len(argv):
        if argv[i] in ("--cache", "--pulse") and i + 1 < len(argv):
            if argv[i] == "--cache":
                cache = argv[i + 1]
            else:
                pulse = argv[i + 1]
            i += 2
            continue
        if argv[i] in ("--style", "--key") and i + 1 < len(argv):
            (styles if argv[i] == "--style" else keys).append(argv[i + 1])
            i += 2
            continue
        args.append(argv[i])
        i += 1
    if len(args) != 1:
        print(__doc__)
        return 2
    build(args[0], styles or None, keys or None, cache=cache)
    if pulse:
        build_pulse(pulse, keys or None)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
