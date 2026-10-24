#!/usr/bin/env python3
"""Central Pedal - makes two banks of the sound libraries, synthesised here (no one else's recording):

  Central Keys Pads (Central Keys): Warm Pad, Air Pad, Choir Aah, Choir Ooh, Shimmer Pad, String Pad, Glass Pad,
      Swell Pad, Worship Pad - each note an exact loop: every partial (and every slow movement in it) is a whole number
      of cycles in the loop, so it holds forever without a seam.
  Central Plugins Textures (Central Plugins): Ambient Drone (a slowly moving pitched drone) and Transitions - risers,
      a downlifter, a sub drop, swells, reverse cymbals, an impact, wind and a shimmer hit, one per key. The cymbal,
      gong and drum sounds come from VCSL (Versilian Studios, CC0 1.0); the rest is synthesised.

    python3 tools/make-pads.py <download cache> <out folder> [--only BANK]
Needs python3-numpy (and the internet for the VCSL cymbals and gong). Deterministic: the same files every build."""
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

SR = 32000            # (pads hold nothing above 12 kHz)
LOOP = 6.0            # seconds: every partial a whole number of cycles in it
ROOTS = list(range(24, 100, 4))   # a sample every major third, C1..B7
OURS = "Motion Audio - synthesised by tools/make-pads.py"


def q(f):
    """A frequency moved to the nearest whole number of cycles in the loop."""
    return max(1, round(f * LOOP)) / LOOP


def formant(f, peaks):
    return sum(a * math.exp(-0.5 * ((f - fc) / bw) ** 2) for fc, bw, a in peaks)


AAH = [(700, 130, 1.0), (1220, 150, 0.6), (2600, 220, 0.25), (3300, 300, 0.12)]
OOH = [(300, 80, 1.0), (870, 110, 0.45), (2240, 200, 0.12)]


def partials(kind, f0):
    """[(frequency, amplitude, movement Hz, movement depth)] for one pad voice."""
    out = []
    nyq = 0.45 * SR
    if kind in ("warm", "string", "swell", "worship"):
        cut = {"warm": 7, "string": 14, "swell": 9, "worship": 10}[kind]
        for k in range(1, 120):
            f = f0 * k
            if f > nyq:
                break
            a = (1.0 / k) / (1 + (k / cut) ** 2)
            out.append((f, a, (k % 5 + 1) / LOOP, 0.25))
    elif kind == "air":
        for k in range(1, 80):
            f = f0 * k
            if f > nyq:
                break
            a = (1.0 / k ** 0.7) / (1 + (k / 24.0) ** 2)
            out.append((f, a, (k % 7 + 1) / LOOP, 0.45))
    elif kind in ("aah", "ooh"):
        peaks = AAH if kind == "aah" else OOH
        for k in range(1, 100):
            f = f0 * k
            if f > nyq:
                break
            a = (1.0 / k ** 0.6) * (0.08 + formant(f, peaks))
            out.append((f, a, (k % 3 + 1) / LOOP, 0.2))
    elif kind == "shimmer":
        for r, a in ((1, 1.0), (2, 0.6), (3, 0.35), (4, 0.4), (6, 0.2), (8, 0.25), (12, 0.1), (16, 0.12)):
            if f0 * r < nyq:
                out.append((f0 * r, a, (r % 4 + 1) / LOOP, 0.5))
    elif kind == "glass":
        for r, a in ((1, 1.0), (2.76, 0.45), (5.40, 0.25), (8.93, 0.12), (2, 0.3)):
            if f0 * r < nyq:
                out.append((f0 * r, a, 1 / LOOP, 0.3))
    elif kind == "drone":
        for r, a in ((0.5, 0.6), (1, 1.0), (1.5, 0.5), (2, 0.55), (3, 0.3), (4, 0.25), (5, 0.12), (6, 0.12), (8, 0.08)):
            if f0 * r < nyq:
                out.append((f0 * r, a, (int(r * 2) % 3 + 1) / LOOP, 0.6))
    return out


VOICES = {"warm": (-6, 0, 6), "string": (-12, -5, 0, 5, 12), "swell": (-8, 0, 8), "worship": (-7, 0, 7), "air": (-4, 4), "aah": (-9, -3, 3, 9), "ooh": (-9, -3, 3, 9),
          "shimmer": (0, 4), "glass": (0,), "drone": (-5, 5)}


def pad_note(kind, note, seed):
    """One loop (LOOP seconds) of a pad at a MIDI note, as float32 - periodic, so the whole sample loops."""
    rng = np.random.default_rng(seed + note * 31)
    n = int(LOOP * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    f0 = 440.0 * 2 ** ((note - 69) / 12.0)
    for cents in VOICES[kind]:
        fv = f0 * 2 ** (cents / 1200.0)
        for f, a, mv, depth in partials(kind, fv):
            fq = q(f)
            ph = rng.uniform(0, 2 * math.pi)
            am = 1.0 - depth * 0.5 * (1 + np.sin(2 * math.pi * mv * t + rng.uniform(0, 2 * math.pi)))
            x += a * am * np.sin(2 * math.pi * fq * t + ph)
    if kind == "air":   # (a little breath: periodic noise, its spectrum on the loop's own bins)
        spec = np.zeros(n // 2 + 1, complex)
        bins = np.arange(len(spec)) / LOOP
        band = np.exp(-0.5 * ((bins - min(6000, f0 * 8)) / 2500.0) ** 2)
        spec[1:] = band[1:] * np.exp(1j * rng.uniform(0, 2 * math.pi, len(spec) - 1))
        noise = np.fft.irfft(spec, n)
        x = x / (np.max(np.abs(x)) or 1) + 0.25 * noise / (np.max(np.abs(noise)) or 1)
    x = x / (np.sqrt(np.mean(x ** 2)) or 1.0) * 0.2
    return x.astype(np.float32)


PADS = [("Warm Pad", "warm", 1.2, 2.5), ("Air Pad", "air", 1.5, 3.0), ("Choir Aah", "aah", 0.6, 1.8), ("Choir Ooh", "ooh", 0.7, 2.0), ("Shimmer Pad", "shimmer", 1.8, 3.5),
        ("String Pad", "string", 0.5, 1.5), ("Glass Pad", "glass", 0.3, 2.5), ("Swell Pad", "swell", 3.5, 3.0), ("Worship Pad", "worship", 2.0, 4.0)]


def pad_zones(kind, samples, seed):
    zones = []
    ranges = VC.key_ranges(ROOTS)
    for note in ROOTS:
        x = pad_note(kind, note, seed)
        n = len(x)
        x = np.concatenate([x, x[:32]])   # (after the loop's end: its start again, for the interpolation)
        pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
        samples.append({"name": "%s%d_%d" % (kind[:6], note, len(samples)), "pcm": pcm, "sr": SR, "root": note, "s": 0, "e": n})
        zones.append([("keyRange", ranges[note]), ("overridingRootKey", note), ("sampleModes", 1), ("sampleID", len(samples) - 1)])
    return zones


# ---------------------------------------------------------------- transitions
def sweep_noise(seconds, f_from, f_to, rise=True, seed=1):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    noise = rng.normal(0, 1, n)
    spec = np.fft.rfft(noise)
    out = np.zeros(n)
    segs = 24
    for i in range(segs):   # (a band moving from f_from to f_to, made in steps and crossfaded)
        fc = f_from * (f_to / f_from) ** (i / (segs - 1))
        f = np.fft.rfftfreq(n, 1 / SR)
        band = np.fft.irfft(spec * np.exp(-0.5 * ((f - fc) / (fc * 0.6)) ** 2), n)
        w = np.zeros(n)
        c = n * i // (segs - 1)
        half = n // (segs - 1)
        lo, hi = max(0, c - half), min(n, c + half)
        w[lo:hi] = np.hanning(hi - lo) if hi > lo else 0
        out += band * w
    env = np.linspace(0, 1, n) ** 2 if rise else np.linspace(1, 0, n) ** 1.5
    return (out * env).astype(np.float32)


def sub_drop(seconds=2.5):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f = 90 * (28 / 90) ** (t / seconds)
    ph = 2 * math.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t / (seconds * 0.6))).astype(np.float32)


def shimmer_hit(seconds=4.0):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    x = sum(a * np.sin(2 * math.pi * f * t) * np.exp(-t / d) for f, a, d in ((1046.5, 1.0, 1.4), (1568, 0.6, 1.1), (2093, 0.5, 0.9), (2889, 0.3, 0.6), (4186, 0.2, 0.5)))
    return x.astype(np.float32)


def wind(seconds=6.0, seed=5):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec = np.fft.rfft(rng.normal(0, 1, n)) / (1 + (f / 500.0) ** 2)
    x = np.fft.irfft(spec, n)
    t = np.arange(n) / SR
    env = 0.6 + 0.4 * np.sin(2 * math.pi * t / seconds * 2) ** 2
    env *= np.minimum(1, t / 0.8) * np.minimum(1, (seconds - t) / 1.2)
    return (x * env).astype(np.float32)


def vcsl(cache, folder, rel):
    x, sr = V.read_wav(VC.fetch_wav(cache, folder, rel))
    if sr != SR:
        x = np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x).astype(np.float32)
    return x


def transitions(cache):
    """[(key, name, samples)]"""
    ID = VC.ID
    rev = lambda x, s: x[:int(s * SR)][::-1].copy()
    cym = vcsl(cache, ID + "Suspended Cymbal 1", "susCymb1_hit_f1.wav")
    crash = vcsl(cache, ID + "Clash Cymbals 1", "cymbal_crash1_ff2.wav")
    gong = vcsl(cache, ID + "Gong 1", "gong_fff.wav")
    swell = vcsl(cache, ID + "Suspended Cymbal 1", "susCymb1_cresc_4s.wav")
    swell_long = vcsl(cache, ID + "Suspended Cymbal 1", "susCymb1_cresc_7.5s.wav")
    kick = vcsl(cache, VC.ME + "Bass Drum 2", "bassdrum_hit_ff.wav")
    impact = np.zeros(max(len(kick), len(gong)), np.float32)
    impact[:len(kick)] += kick
    impact[:len(gong)] += 0.6 * gong
    return [
        (48, "Riser 4s", sweep_noise(4.0, 300, 7000, True, 1)), (50, "Riser 8s", sweep_noise(8.0, 200, 8000, True, 2)),
        (52, "Downlifter", sweep_noise(3.0, 6000, 250, False, 3)), (53, "Reverse Cymbal", rev(cym, 3.0)),
        (55, "Reverse Crash (long)", rev(crash, 5.0)), (57, "Cymbal Swell", swell[:int(4.5 * SR)]),
        (59, "Cymbal Swell (long)", swell_long[:int(8 * SR)]), (60, "Impact", impact[:int(6 * SR)]),
        (62, "Sub Drop", sub_drop()), (64, "Reverse Gong", rev(gong, 6.0)), (65, "Wind", wind()), (67, "Shimmer Hit", shimmer_hit()),
    ]


def build_pads(out_dir, seed=7):
    name = "Central Keys Pads"
    out = os.path.join(out_dir, "%s - %s.sf2" % (name, name.lower().replace(" ", "-")))
    if os.path.isfile(out):
        return out
    V.say(name + " (synthesised)")
    samples, instruments, presets = [], [], []
    for prog, (pname, kind, att, rel) in enumerate(PADS):
        zones = pad_zones(kind, samples, seed + prog)
        env = [("attackVolEnv", V.tc(att)), ("releaseVolEnv", V.tc(rel))]
        instruments.append({"name": kind + " pad", "zones": [z[:1] + env + [("reverbEffectsSend", 200), ("chorusEffectsSend", 80)] + z[1:] for z in zones]})
        presets.append({"name": pname, "prog": prog, "zones": [[("keyRange", (0, 127)), ("instrument", len(instruments) - 1)]]})
    V.write_sf2(out, name, samples, instruments, presets, copyright="Motion Audio (synthesised - sold with Central Keys)", comment="Made by tools/make-pads.py: exact loops, no recordings.")
    V.say("  -> %s (%.0f MB, %d samples)" % (os.path.basename(out), os.path.getsize(out) / 1e6, len(samples)))
    return out


def build_textures(cache, out_dir, seed=11):
    name = "Central Plugins Textures"
    out = os.path.join(out_dir, "%s - %s.sf2" % (name, name.lower().replace(" ", "-")))
    if os.path.isfile(out):
        return out
    V.say(name + " (synthesised + VCSL cymbals and gong, CC0)")
    samples, instruments, presets = [], [], []
    zones = pad_zones("drone", samples, seed)
    instruments.append({"name": "drone", "zones": [z[:1] + [("attackVolEnv", V.tc(3.0)), ("releaseVolEnv", V.tc(5.0)), ("reverbEffectsSend", 250)] + z[1:] for z in zones]})
    presets.append({"name": "Ambient Drone", "prog": 0, "zones": [[("keyRange", (0, 127)), ("instrument", 0)]]})
    tz = []
    for key, label, x in transitions(cache):
        x = x / (float(np.max(np.abs(x))) or 1.0) * 0.85
        f = min(int(0.05 * SR), len(x))
        x[len(x) - f:] *= np.linspace(1, 0, f)
        pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
        samples.append({"name": label[:19], "pcm": pcm, "sr": SR, "root": key, "s": None, "e": None})
        tz.append([("keyRange", (key, key)), ("attackVolEnv", V.tc(0.001)), ("releaseVolEnv", V.tc(1.0)), ("overridingRootKey", key), ("sampleID", len(samples) - 1)])
    instruments.append({"name": "transitions", "zones": tz})
    presets.append({"name": "Transitions (risers, swells, reverse cymbals)", "prog": 1, "zones": [[("keyRange", (0, 127)), ("instrument", 1)]]})
    V.write_sf2(out, name, samples, instruments, presets, copyright="Motion Audio (synthesised) + VCSL by Versilian Studios (CC0 1.0)", comment="Made by tools/make-pads.py.")
    V.say("  -> %s (%.0f MB, %d samples)" % (os.path.basename(out), os.path.getsize(out) / 1e6, len(samples)))
    return out


TRANSITION_KEYS = [(48, "Riser 4s"), (50, "Riser 8s"), (52, "Downlifter"), (53, "Reverse Cymbal"), (55, "Reverse Crash (long)"), (57, "Cymbal Swell"), (59, "Cymbal Swell (long)"),
                   (60, "Impact"), (62, "Sub Drop"), (64, "Reverse Gong"), (65, "Wind"), (67, "Shimmer Hit")]
BANKS = [("Central Keys Pads", "keys", [p[0] for p in PADS]), ("Central Plugins Textures", "plugins", ["Ambient Drone", "Transitions (risers, swells, reverse cymbals)"])]


def main(argv):
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--only")]
    if len(args) != 2:
        print(__doc__)
        return 2
    cache, out_dir = args
    os.makedirs(out_dir, exist_ok=True)
    if not only or only == "Central Keys Pads":
        build_pads(out_dir)
    if not only or only == "Central Plugins Textures":
        build_textures(cache, out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
