#!/usr/bin/env python3
"""Central Pedal - makes two banks of the sound libraries, synthesised here (no one else's recording):

  Central Keys Pads (Central Keys): fifteen pads, each built its own way (tools/pad_voices.py says how) - Warm Pad (detuned
      saws, a breathing low-pass), Air Pad (tuned breath), Choir Aah and Choir Ooh (singers through vowel formants), Shimmer
      Pad (a shimmer reverb's octaves), String Pad (a bowed section), Glass Pad (FM glass), Swell Pad (its filter opens as
      you hold a note), Worship Pad (layered and very wide), Analog Sweep Pad (a resonant filter sweeping), Dark Pad (a
      deep, round bed), Bell Pad (held bells beating), and (10.2, more) Sunday Pad (the modern worship pad), Ember Pad
      (a grand piano stretched into a warm cloud) and Selah Strings (violins and cellos stretched into a cloud) - the last
      two from CC0 recordings (VCSL, VSCO 2 CE; tools/pad_sources.py). Stereo; each note a seamless loop with its movement and reverb
      wrapped round it, so it holds forever.
  Central Plugins Textures (Central Plugins): Ambient Drone (a low drone with a resonant filter wandering through it) and
      Transitions - risers, a downlifter, a sub drop, swells, reverse cymbals, an impact, wind and a shimmer hit, one per key.
      The cymbal, gong and drum sounds come from VCSL (Versilian Studios, CC0 1.0); the rest is synthesised.
  Central Pads Swells (Central Pads, so every plan has it): swells, risers, downlifters and an arrival in every key, at
      4, 8 and 16 seconds, and an air bed for between songs (build_swells, below).

    python3 tools/make-pads.py <download cache> <out folder> [--only BANK]
Needs python3-numpy (and the internet for the VCSL cymbals and gong). Deterministic: the same files every build."""
import importlib.util
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pad_dsp as D  # noqa: E402
import pad_voices as PV  # noqa: E402
import pad_sources as PS  # noqa: E402

_s = importlib.util.spec_from_file_location("sounds_vsco", os.path.join(os.path.dirname(HERE), "sounds-vsco.py"))
V = importlib.util.module_from_spec(_s)
_s.loader.exec_module(V)
_s2 = importlib.util.spec_from_file_location("sounds_vcsl", os.path.join(HERE, "sounds-vcsl.py"))
VC = importlib.util.module_from_spec(_s2)
_s2.loader.exec_module(VC)

SR = D.SR             # 32 kHz (pads hold nothing above 12 kHz)
LOOP = 6.0            # seconds: a held note's loop
ROOTS = list(range(24, 103, 6))   # a sample every half octave, C1..F#7 (a pad moved 3 semitones still sounds itself)
OURS = "Motion Audio - synthesised by tools/make-pads.py"


def q(f):
    """A frequency moved to the nearest whole number of cycles in the loop."""
    return max(1, round(f * LOOP)) / LOOP


# (name, how it's built, attack, release): how = (pad_voices style, semitones to render it at, seconds of opening)
PADS = [("Warm Pad", ("Warm", 0, 0), 1.0, 2.5), ("Air Pad", ("Air", 0, 0), 1.5, 3.5), ("Choir Aah", ("Choir Aah", 0, 0), 0.5, 2.0),
        ("Choir Ooh", ("Choir Ooh", 0, 0), 0.6, 2.2), ("Shimmer Pad", ("Shimmer", 0, 0), 1.2, 4.0), ("String Pad", ("Strings", 0, 0), 0.4, 1.5),
        ("Glass Pad", ("Glass", -12, 0), 0.2, 2.5), ("Swell Pad", ("Swell", 0, 3.0), 0.3, 3.0), ("Worship Pad", ("Worship", 0, 0), 1.5, 4.0),
        ("Analog Sweep Pad", ("Analog", 0, 0), 0.3, 2.0), ("Dark Pad", ("Deep", 12, 0), 1.2, 3.0), ("Bell Pad", ("Bells", -12, 0), 0.05, 3.0),
        # 10.2, more: the Sunday-keys worship pad, and two made from CC0 recordings (tools/pad_sources.py)
        ("Sunday Pad", ("Sunday Keys", 0, 0), 1.5, 4.5), ("Ember Pad", ("Ember", 0, 0), 1.2, 4.0), ("Selah Strings", ("Selah", 0, 0), 0.8, 3.0)]


def pad_sample(how, note, seed):
    """One held note of a pad, stereo float32 (frames x 2), and its loop (start, end). Most pads are all loop; the Swell
    Pad starts with an opening (its low-pass opening wide over a few seconds) before its loop."""
    style, shift, opening = how
    lp = D.Loop(LOOP)
    rng = np.random.default_rng(seed + note * 31)
    if not opening:
        x = PV.render(style, lp, note + shift, rng, notes=[(note + shift, 1.0)])
        return x.astype(np.float32), 0, lp.n
    # the Swell Pad: its held sound (the filter wide), and before it the same sound with the filter opening up to it
    dry = PV.render(style, lp, note, rng, notes=[(note, 1.0)], fx=False)
    f0 = D.hz(note)
    f = D.freqs(lp)
    cuts = np.geomspace(f0 * 1.2, f0 * 14, 10)
    versions = [D.reverb(lp, D.filt(dry, D.lowpass(f, c, 0.9, 4)), np.random.default_rng(seed + 7), 3.5, mix=0.35, damp=5000) for c in cuts]
    held = versions[-1]
    a = int(opening * SR)
    idx = np.arange(-a, 0) % lp.n
    prog = (np.arange(a) / max(1, a - 1)) ** 0.8 * (len(cuts) - 1)
    i0 = np.minimum(np.floor(prog).astype(int), len(cuts) - 2)
    w = (prog - i0)[:, None]
    head = np.zeros((a, 2))
    for k in range(len(cuts) - 1):
        sel = i0 == k
        head[sel] = versions[k][idx[sel]] * (1 - w[sel]) + versions[k + 1][idx[sel]] * w[sel]
    head *= np.minimum(1.0, np.arange(a) / (0.6 * a) + 0.25)[:, None]
    x = np.concatenate([head, held])
    x = x / D.rms(held) * 0.2
    return x.astype(np.float32), a, a + lp.n


def stereo_zones(name, x, s, e, note, keys, samples, extra):
    """A stereo note as two samples (left and right) on two zones panned hard left and right - every SoundFont player
    plays that (the pan generator), so the pad stays wide everywhere."""
    zones = []
    for side, pan in ((0, -500), (1, 500)):
        ch = np.concatenate([x[:, side], x[s:s + 32, side]])   # (after the loop's end: its start again, for interpolation)
        pcm = np.clip(np.round(ch * 32767), -32768, 32767).astype("<i2")
        samples.append({"name": "%s%d%s_%d" % (name[:8], note, "LR"[side], len(samples)), "pcm": pcm, "sr": SR, "root": note, "s": s, "e": e})
        zones.append([("keyRange", keys), ("pan", pan)] + extra + [("overridingRootKey", note), ("sampleModes", 1), ("sampleID", len(samples) - 1)])
    return zones


def pad_zones(how, samples, seed, extra=()):
    zones = []
    ranges = VC.key_ranges(ROOTS)
    for note in ROOTS:
        x, s, e = pad_sample(how, note, seed)
        zones += stereo_zones(how[0].replace(" ", ""), x, s, e, note, ranges[note], samples, list(extra))
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
    for prog, (pname, how, att, rel) in enumerate(PADS):
        V.say("  " + pname)
        env = [("attackVolEnv", V.tc(att)), ("releaseVolEnv", V.tc(rel)), ("reverbEffectsSend", 60)]
        zones = pad_zones(how, samples, seed + prog * 101, env)
        instruments.append({"name": pname.lower()[:19], "zones": zones})
        presets.append({"name": pname, "prog": prog, "zones": [[("keyRange", (0, 127)), ("instrument", len(instruments) - 1)]]})
    V.write_sf2(out, name, samples, instruments, presets, copyright="Motion Audio (synthesised - sold with Central Keys)", comment="Made by tools/make-pads.py: stereo, seamless loops, no recordings.")
    V.say("  -> %s (%.0f MB, %d samples)" % (os.path.basename(out), os.path.getsize(out) / 1e6, len(samples)))
    return out


def build_textures(cache, out_dir, seed=11):
    name = "Central Plugins Textures"
    out = os.path.join(out_dir, "%s - %s.sf2" % (name, name.lower().replace(" ", "-")))
    if os.path.isfile(out):
        return out
    V.say(name + " (synthesised + VCSL cymbals and gong, CC0)")
    samples, instruments, presets = [], [], []
    zones = pad_zones(("Ambient Drone", 12, 0), samples, seed, [("attackVolEnv", V.tc(3.0)), ("releaseVolEnv", V.tc(5.0)), ("reverbEffectsSend", 80)])
    instruments.append({"name": "drone", "zones": zones})
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


# ---------------------------------------------------------------- Central Pads Swells (10.2): transitions in every key
# For intros, builds and between songs, played from the keys (any app that plays SoundFonts): each preset has one
# sound per key - C, C#, D... on every octave of the keyboard play it in that key, as made (no pitch shifting). No tempo:
# each comes in lengths of seconds (4 s is about 2 bars at 120 BPM, 8 s about 4 bars at 120 or 2 at 60, 16 s about 8
# bars at 120 or 4 at 60). Made at 24 kHz (they hold nothing above 11 kHz that matters) to keep the bank small.
SW_SR = 24000
SW_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SWELLS = [("Swell to Key 4s", "swell", 4), ("Swell to Key 8s", "swell", 8), ("Swell to Key 16s", "swell", 16),
          ("Riser to Key 4s", "riser", 4), ("Riser to Key 8s", "riser", 8), ("Riser to Key 16s", "riser", 16),
          ("Downlifter 4s", "down", 4), ("Downlifter 8s", "down", 8), ("Arrival (hit + bloom)", "arrival", 6), ("Air Bed (no key)", "air", 10)]


def _glide(n, f_from, f_to, curve, rng, cents=0.0):
    """A saw gliding from one pitch to another along curve (0..1), not a loop."""
    f = f_from * (f_to / f_from) ** curve * 2 ** (cents / 1200.0)
    dt = f / SW_SR
    ph = rng.uniform(0, 1) + np.cumsum(dt)
    return D.wave_of("saw", ph, dt)


def _tail(x, seconds, rng, decay, mix, shimmer=False):
    """x through a reverb on a canvas long enough that nothing wraps round; cut back to its own length."""
    lp = D.Loop(len(x) / SW_SR + decay * 1.3, SW_SR)
    pad = np.zeros((lp.n, 2))
    pad[:len(x)] = D.stereo(x)
    y = D.shimmer(lp, pad, rng, decay, mix=mix, amount=0.4, octaves=1) if shimmer else D.reverb(lp, pad, rng, decay, mix=mix, damp=6000, width=1.2)
    return y[:int(seconds * SW_SR)]


def swell_sound(kind, key, seconds, seed=41):
    rng = np.random.default_rng(seed + key * 13 + seconds)
    root = 48 + key
    n = int(seconds * SW_SR)
    p = np.arange(n) / n
    if kind == "swell":        # the key's chord struck, its reverb played backwards: it rises out of nothing into the downbeat
        lp = D.Loop(1.6, SW_SR)
        hit = PV.render("Sunday Keys", lp, root, rng, fx=False) * np.exp(-np.arange(lp.n) / SW_SR / 0.45)[:, None]
        big = D.Loop(seconds + 2.0, SW_SR)
        canvas = np.zeros((big.n, 2))
        canvas[:lp.n] = hit
        wet = D.reverb(big, canvas, rng, seconds * 0.8, mix=1.0, damp=5000, predelay=0.0, width=1.3)
        x = wet[::-1][-n:] + 0.35 * D.octave_up(wet[::-1][-n:])
        x = x * (p ** 1.2)[:, None]
    elif kind == "riser":      # noise sweeping up and the key's chord gliding up an octave into place, growing
        noise = D.ffilt(rng.normal(0, 1, n), lambda f: D.highpass(f, 150, 0.7, 2), SW_SR)
        noise = D.fsweep(noise, p ** 1.4, lambda f, c: D.bandpass(f, c, 1.5), 250, 9000, SW_SR)
        tones = np.zeros(n)
        for semi in (0, 7, 12):
            f_end = D.hz(root + 12 + semi)
            for c in (-7.0, 7.0):
                tones += _glide(n, f_end / 2, f_end, np.minimum(1, p / 0.85) ** 2, rng, c)   # (in key for the last moments)
        tones = D.fsweep(tones, 0.15 + 0.85 * p ** 1.5, lambda f, c: D.lowpass(f, c, 1.2, 4), 300, 9000, SW_SR)
        x = np.stack([noise / D.rms(noise) * 0.6 + tones / D.rms(tones)] * 2, 1)
        x = D.width(np.stack([x[:, 0], np.roll(x[:, 1], int(0.012 * SW_SR))], 1), 1.2)
        x = x * (p ** 2)[:, None]
        x = _tail(x, seconds, rng, 3.0, 0.3)
    elif kind == "down":       # the key's chord falling an octave and noise sweeping down, fading away
        noise = D.fsweep(rng.normal(0, 1, n), (1 - p) ** 1.2, lambda f, c: D.bandpass(f, c, 1.5), 200, 8000, SW_SR)
        tones = np.zeros(n)
        for semi in (0, 7, 12):
            f0 = D.hz(root + 12 + semi)
            for c in (-6.0, 6.0):
                tones += _glide(n, f0, f0 / 2, np.maximum(0, (p - 0.1) / 0.9) ** 0.7, rng, c)   # (in key at first, then falling)
        tones = D.fsweep(tones, (1 - p) ** 1.3, lambda f, c: D.lowpass(f, c, 1.0, 4), 250, 8000, SW_SR)
        x = np.stack([noise / D.rms(noise) * 0.5 + tones / D.rms(tones)] * 2, 1)
        x = x * ((1 - p) ** 1.6 * np.minimum(1, p / 0.01))[:, None]
        x = _tail(x, seconds, rng, 3.0, 0.35)
    elif kind == "arrival":    # a deep hit, and the key's chord blooming out of it into a shimmer
        t = np.arange(n) / SW_SR
        boom = np.sin(2 * math.pi * np.cumsum(70 * (35 / 70) ** np.minimum(1, t / 0.8)) / SW_SR) * np.exp(-t / 0.7)
        burst = D.ffilt(rng.normal(0, 1, n) * np.exp(-t / 0.06), lambda f: D.lowpass(f, 2500, 0.7, 2), SW_SR)
        lp = D.Loop(seconds, SW_SR)
        chord = PV.render("Sunday Keys", lp, root, rng, fx=False) * (np.minimum(1, t / 0.04) * np.exp(-t / 2.2))[:, None]
        x = chord / D.rms(chord) * 0.2 + D.stereo(boom * 0.5 + burst * 0.15)
        x = _tail(x, seconds, rng, 5.0, 0.5, shimmer=True)
        x = x * np.minimum(1, (seconds - t) / 1.0)[:, None]
    else:                      # air: breath and room tone with slow movement, a seamless loop, no key
        lp = D.Loop(seconds, SW_SR)
        x = np.stack([D.noise(lp, rng, "pink", 60, 9000) for _ in (0, 1)], 1)
        x = D.sweep(lp, x, 0.5 + 0.5 * lp.drift(rng, 1.0, 0.3), lambda f, c: D.lowpass(f, c, 0.8, 2), 600, 6000)
        x = D.reverb(lp, x, rng, 3.0, mix=0.4, damp=3000, width=1.3)
        return (x / (np.max(np.abs(x)) or 1) * 0.35).astype(np.float32)
    x = x - x.mean(0)
    f = min(int(0.03 * SW_SR), len(x))
    x[-f:] *= np.linspace(1, 0, f)[:, None]                 # (it stops cleanly - on the downbeat for a swell or riser)
    return (x / (np.max(np.abs(x)) or 1) * 0.8).astype(np.float32)


def build_swells(out_dir, seed=41, log=None):
    name = "Central Pads Swells"
    out = os.path.join(out_dir, "%s - %s.sf2" % (name, name.lower().replace(" ", "-")))
    if os.path.isfile(out):
        return out
    V.say(name + " (synthesised)")
    samples, instruments, presets = [], [], []
    for prog, (pname, kind, seconds) in enumerate(SWELLS):
        V.say("  " + pname)
        keys = [0] if kind == "air" else range(12)
        ids = {}
        for k in keys:
            x = swell_sound(kind, k, seconds, seed)
            ids[k] = []
            for side in (0, 1):
                ch = x[:, side]
                loop = kind == "air"
                if loop:
                    ch = np.concatenate([ch, ch[:32]])
                pcm = np.clip(np.round(ch * 32767), -32768, 32767).astype("<i2")
                samples.append({"name": "%s%s%d%s_%d" % (kind[:5], SW_KEYS[k].replace("#", "s"), seconds, "LR"[side], len(samples)), "pcm": pcm, "sr": SW_SR,
                                "root": 60, "s": 0 if loop else None, "e": len(x) if loop else None})
                ids[k].append(len(samples) - 1)
        zones = []
        for note in range(24, 97):   # every key of the keyboard plays its own key's sound, as made
            k = 0 if kind == "air" else note % 12
            for side, pan in ((0, -500), (1, 500)):
                z = [("keyRange", (note, note)), ("pan", pan), ("attackVolEnv", V.tc(0.001)), ("releaseVolEnv", V.tc(2.0 if kind == "air" else 1.2)), ("overridingRootKey", note)]
                if kind == "air":
                    z.append(("sampleModes", 1))
                zones.append(z + [("sampleID", ids[k][side])])
        instruments.append({"name": pname.lower()[:19], "zones": zones})
        presets.append({"name": pname, "prog": prog, "zones": [[("keyRange", (0, 127)), ("instrument", len(instruments) - 1)]]})
    V.write_sf2(out, name, samples, instruments, presets, copyright="Motion Audio (synthesised - sold with Central Pads)",
                comment="Made by tools/make-pads.py: swells, risers, downlifters and arrivals in every key (each key of the keyboard plays its own), and an air bed.")
    V.say("  -> %s (%.0f MB, %d samples)" % (os.path.basename(out), os.path.getsize(out) / 1e6, len(samples)))
    return out


TRANSITION_KEYS = [(48, "Riser 4s"), (50, "Riser 8s"), (52, "Downlifter"), (53, "Reverse Cymbal"), (55, "Reverse Crash (long)"), (57, "Cymbal Swell"), (59, "Cymbal Swell (long)"),
                   (60, "Impact"), (62, "Sub Drop"), (64, "Reverse Gong"), (65, "Wind"), (67, "Shimmer Hit")]
BANKS = [("Central Keys Pads", "keys", [p[0] for p in PADS]), ("Central Plugins Textures", "plugins", ["Ambient Drone", "Transitions (risers, swells, reverse cymbals)"]),
         ("Central Pads Swells", "pads", [s[0] for s in SWELLS])]


def main(argv):
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] != "--only")]
    if len(args) != 2:
        print(__doc__)
        return 2
    cache, out_dir = args
    os.makedirs(out_dir, exist_ok=True)
    PV.set_sources(PS.Sources(cache))   # (the pads made from recordings)
    if not only or only == "Central Pads Swells":
        build_swells(out_dir)
    if not only or only == "Central Keys Pads":
        build_pads(out_dir)
    if not only or only == "Central Plugins Textures":
        build_textures(cache, out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
