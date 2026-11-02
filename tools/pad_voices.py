#!/usr/bin/env python3
"""Central Pedal - the voices and styles of our pads (10.2), shared by make-pads.py (the Central Keys Pads SoundFont,
one held note at a time) and make-pad-loops.py (Central Pads: whole chords in every key, for the pad pedal).

Each style is built its own way, so no two sound alike:
  Warm       detuned saws through a slowly breathing low-pass, a sub underneath - round and analog
  Air        breath: noise tuned to the chord's harmonics, a few high sines, very wide, a long bloom
  Choir Aah  eight singers (each with their own vibrato and drift) through "ah" formants, breath, a church
  Choir Ooh  six softer singers through "oo" formants that drift towards "oh", darker, a hall
  Shimmer    a soft sine and triangle bed sent into a shimmer reverb - a halo of octaves above
  Strings    a bowed section: twelve players' saws with their own vibrato, a string body, bow noise, a hall
  Glass      FM glass, its brightness slowly turning, bouncing echoes, a bright plate
  Swell      saws whose low-pass opens and closes (and grows and fades) once round the loop
  Worship    layered: warm saws, an octave of soft sines above, a sub - very wide, a big hall
  Ambient Drone  a low root-and-fifth drone with a resonant filter wandering through its harmonics, wind, a cathedral
  Deep       an octave down: a dark, round bed with a slow pulse, almost mono
  Heaven     a high "ah" choir and sines in a shimmer - bright and enormous
  Felt       a soft felted tone, close and dry, a little tape wobble and hiss
  Organ      drawbars through a rotary speaker turning slowly, a small room
  Analog     pulse waves with moving width through a resonant filter sweeping up and down, a chorus
  Bowed      low cellos: dark, slow bow swells, a dark hall
  Bells      held bell partials beating gently, sparkling echoes
  Choir Hum  closed-mouth humming: warm, intimate, near
  Cinematic  low strings, a swelling brass-like layer, a drone, a shimmer and a breath of wind - huge and wide
  Morning    felt, glass and air on an add9 chord: light and gentle, with soft echoes

  voice(name, lp, note, rng) -> stereo dry voice;  STYLES[name] -> {"layers": [(voice, octave, gain)], "fx": fn, "chord"}
Needs numpy (and pad_dsp.py, next to this file)."""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pad_dsp as D  # noqa: E402


# ---------------------------------------------------------------- voices: one note, stereo, dry
def v_saws(lp, note, rng, n=5, detune=14.0, spread=0.8, vib=0.0, bright=1.0):
    """Detuned saws spread across the stereo field, each with its own slow drift (and a little vibrato if asked)."""
    f0 = D.hz(note)
    out = np.zeros((lp.n, 2))
    for i in range(n):
        c = (i / (n - 1) - 0.5) * 2 * detune if n > 1 else 0.0
        wob = c + lp.drift(rng, 3.0) + (vib * lp.lfo(rng.uniform(4.6, 5.6), rng.uniform(0, 6.28)) if vib else 0)
        x = D.saw(lp, f0, wob, rng.uniform(0, 1))
        out += D.pan(x, (i / (n - 1) - 0.5) * 2 * spread if n > 1 else 0.0)
    return out / math.sqrt(n)


def v_pulse(lp, note, rng, n=2, detune=7.0):
    """Pulse waves whose width slowly moves (each its own way) - hollow, then reedy, then hollow again."""
    f0 = D.hz(note)
    out = np.zeros((lp.n, 2))
    for i in range(n):
        w = 0.5 + 0.38 * lp.lfo(rng.choice([0.17, 0.25, 0.33]), rng.uniform(0, 6.28))
        x = D.pulse(lp, f0, w, (i - (n - 1) / 2) * detune + lp.drift(rng, 2.0), rng.uniform(0, 1))
        out += D.pan(x, -0.7 + 1.4 * i / max(1, n - 1))
    return out / math.sqrt(n)


def v_sines(lp, note, rng, ratios=((1, 1.0), (2, 0.35)), spread=0.6, beat=0.25):
    """Pure sines (and some overtones), each a touch detuned left from right so they slowly beat."""
    f0 = D.hz(note)
    out = np.zeros((lp.n, 2))
    for r, a in ratios:
        for side, sgn in ((0, -1), (1, 1)):
            out[:, side] += a * D.sine(lp, f0 * r + sgn * beat * r ** 0.5 / 2, None, rng.uniform(0, 1))
    return D.width(out, spread)


def v_tri(lp, note, rng):
    f0 = D.hz(note)
    return D.pan(D.tri(lp, f0, lp.drift(rng, 2.0)), rng.uniform(-0.3, 0.3))


def v_choir(lp, note, rng, vowel="a", singers=8, vib_cents=22.0, breath=0.12, to_vowel=None):
    """A choir: each singer a soft glottal buzz with their own vibrato, pitch drift and place; the section through vowel
    formants (optionally drifting towards another vowel), with breath."""
    f0 = D.hz(note)
    f = D.freqs(lp)
    src = np.zeros((lp.n, 2))
    for i in range(singers):
        rate = rng.uniform(4.8, 6.0)
        cents = rng.uniform(-9, 9) + lp.drift(rng, 6.0) + vib_cents * (0.6 + 0.4 * lp.lfo(0.11, rng.uniform(0, 6.28))) * lp.lfo(rate, rng.uniform(0, 6.28))
        x = D.saw(lp, f0, cents, rng.uniform(0, 1))
        src += D.pan(x, rng.uniform(-0.85, 0.85))
    src = D.filt(src, D.tilt(f, -4.5, 300))           # (a voice's buzz falls away above, softer than a saw)
    air = np.stack([D.noise(lp, rng, "pink", 200, 9000) for _ in (0, 1)], 1)
    air *= (0.75 + 0.25 * lp.lfo(0.17, 1.0))[:, None]
    src = src / D.rms(src) + breath * air
    H = D.formant(f, D.VOWELS[vowel]) * D.highpass(f, 90, 0.7, 2)
    y = D.filt(src, H)
    if to_vowel:   # (the vowel slowly changes and comes back)
        y2 = D.filt(src, D.formant(f, D.VOWELS[to_vowel]) * D.highpass(f, 90, 0.7, 2))
        g = (0.5 + 0.5 * lp.lfo(1 / lp.L, 0.5))[:, None]
        y = y * (1 - g) + y2 * g
    return y


def v_strings(lp, note, rng, players=12, low=False):
    """A bowed section: saws with each player's vibrato and tuning, through a string body (its resonances), with bow
    noise - violins, or (low) cellos with a deeper body."""
    f0 = D.hz(note)
    f = D.freqs(lp)
    out = np.zeros((lp.n, 2))
    for i in range(players):
        cents = rng.uniform(-8, 8) + lp.drift(rng, 4.0) + rng.uniform(8, 16) * lp.lfo(rng.uniform(4.5, 6.2), rng.uniform(0, 6.28))
        out += D.pan(D.saw(lp, f0, cents, rng.uniform(0, 1)), rng.uniform(-0.9, 0.9))
    body = ([(220, 6, 1.2), (500, 4, 1.4), (1100, 5, -1.2), (2600, 4, 2.5)] if low else [(290, 6, 1.0), (750, 5, 2.0), (1700, 6, -2.0), (3200, 3, 3.0)])
    H = D.lowpass(f, 2400 if low else 4200, 0.6, 2) * D.highpass(f, 60 if low else 160, 0.7, 2) * D.tilt(f, -1.5, 1000)
    for fc, db, q in [(b[0], b[2], b[1]) for b in body]:
        H = H * D.peak(f, fc, db, q)
    y = D.filt(out, H)
    bow = np.stack([D.noise(lp, rng, "pink", 800, 7000) for _ in (0, 1)], 1)
    bow *= (0.6 + 0.4 * lp.drift(rng, 1.0, 2.0))[:, None]
    return y / D.rms(y) + 0.012 * bow


def v_fm_glass(lp, note, rng):
    """FM glass: a bright, slightly inharmonic tone whose brightness (the FM index) turns slowly, left and right apart."""
    f0 = D.hz(note)
    out = np.zeros((lp.n, 2))
    for side in (0, 1):
        idx = 1.6 + 1.1 * lp.lfo(1 / lp.L * 2, side * 2.0)
        x = D.fm(lp, f0 + (side - 0.5) * 0.3, 3.5, idx, lp.drift(rng, 1.5)) + 0.4 * D.fm(lp, f0 * 2, 1.0, 0.6 + 0.4 * lp.lfo(0.3, side), None)
        out[:, side] = x
    return out


def v_bells(lp, note, rng):
    """Held bell partials (a soft struck bar's ratios), each pair slightly apart so they beat slowly."""
    f0 = D.hz(note)
    parts = [(1, 1.0), (2.0, 0.35), (2.76, 0.45), (4.07, 0.22), (5.40, 0.15), (6.8, 0.07), (8.93, 0.05)]
    out = np.zeros((lp.n, 2))
    for r, a in parts:
        if f0 * r > 0.42 * lp.sr:
            continue
        for side in (0, 1):
            beat = rng.uniform(0.15, 0.6) * (1 if side else -1)
            am = 0.75 + 0.25 * lp.lfo(rng.uniform(0.08, 0.3), rng.uniform(0, 6.28))
            out[:, side] += a * am * D.sine(lp, f0 * r + beat, None, rng.uniform(0, 1))
    return out


def v_organ(lp, note, rng, bars=((0.5, 0.3), (1, 1.0), (1.5, 0.6), (2, 0.85), (3, 0.45), (4, 0.6), (6, 0.25), (8, 0.35))):
    """Tonewheel drawbars (16', 8', 5 1/3', 4', 2 2/3', 2', 1 1/3', 1') with a touch of key click grit."""
    f0 = D.hz(note)
    x = D.additive(lp, [(lp.q(f0 * r), a, rng.uniform(0, 6.28)) for r, a in bars if f0 * r < 0.42 * lp.sr])
    x = D.saturate(x / D.rms(x) * 0.3, 1.3)
    return D.stereo(x)


def v_felt(lp, note, rng):
    """A soft felted tone: round, a few quiet overtones, with a slow tape wobble (wow) and flutter."""
    f0 = D.hz(note)
    wow = 6 * lp.lfo(0.5, rng.uniform(0, 6.28)) + 2 * lp.lfo(6.3, 0.0) + lp.drift(rng, 3.0)
    x = D.tri(lp, f0, wow) * 0.6 + D.sine(lp, f0, wow) + 0.25 * D.sine(lp, f0 * 2, wow) + 0.08 * D.sine(lp, f0 * 3, wow)
    x = D.filt(x, D.lowpass(D.freqs(lp), min(1500, f0 * 4), 0.6, 4))
    return D.pan(x, rng.uniform(-0.25, 0.25))


def v_air(lp, note, rng):
    """Breath that sings: noise tuned to the note's harmonics (narrow peaks), with a few high sines."""
    f0 = D.hz(note)
    f = D.freqs(lp)
    comb = np.zeros_like(f)
    for k in range(1, 40):
        fk = f0 * k
        if fk > 12000:
            break
        comb += (1 / k ** 0.4) / (1 + ((f - fk) / (4 + fk * 0.003)) ** 2) ** 2   # (narrow peaks: the breath sings the note)
    comb *= D.highpass(f, 400, 0.7, 2)
    out = np.stack([D.filt(D.noise(lp, rng, "white"), comb) for _ in (0, 1)], 1)
    out = out / D.rms(out)
    out += 0.4 * v_sines(lp, note + 12, rng, ((1, 1.0), (1.5, 0.4), (2, 0.5)), 1.0, 0.4)
    return out


def v_sub(lp, note, rng):
    return D.stereo(D.sine(lp, D.hz(note), lp.drift(rng, 1.0)))


def v_brass(lp, note, rng):
    """A brass-like section of saws with a bright formant bump (for Cinematic's swell)."""
    y = v_saws(lp, note, rng, n=4, detune=9, spread=0.6, vib=6)
    f = D.freqs(lp)
    return D.filt(y, D.peak(f, 1200, 6, 1.2) * D.lowpass(f, 3500, 0.7, 2))


VOICES = {"saws": v_saws, "pulse": v_pulse, "sines": v_sines, "tri": v_tri, "choir": v_choir, "strings": v_strings, "glass": v_fm_glass,
          "bells": v_bells, "organ": v_organ, "felt": v_felt, "air": v_air, "sub": v_sub, "brass": v_brass}


def voice(spec, lp, note, rng):
    """spec: a voice name or (name, {options})."""
    name, opt = (spec, {}) if isinstance(spec, str) else spec
    return VOICES[name](lp, note, rng, **opt)


# ---------------------------------------------------------------- the styles' effects (on the whole chord)
def lp_curve(lp, lo, hi, rate_cycles=1, phase=0.0, shape="sine"):
    """0..1 for sweep(): a filter's movement, `rate_cycles` times round the loop."""
    return lo + (hi - lo) * (0.5 + 0.5 * lp.lfo(rate_cycles / lp.L, phase, shape))


def lp4(f, c):
    return D.lowpass(f, c, 0.7, 4)


def res_lp(f, c):
    return D.lowpass(f, c, 3.5, 4)


def fx_warm(lp, x, rng, f0):
    x = D.sweep(lp, x, lp_curve(lp, 0.25, 0.6, 1), lp4, f0 * 2.5, f0 * 14)
    x = D.saturate(x / D.rms(x) * 0.35, 1.6)
    x = D.chorus(lp, x, rate=0.3, depth_ms=2.5, mix=0.35)
    return D.reverb(lp, x, rng, 3.0, mix=0.28, damp=4000, width=0.8)


def fx_air(lp, x, rng, f0):
    x = D.filt(x, D.highpass(D.freqs(lp), 250, 0.7, 2))
    x = D.sweep(lp, x, 0.5 + 0.5 * lp.drift(rng, 1.0, 0.3), lambda f, k: D.lowpass(f, k, 0.9, 2), 2000, 10000)   # (the breath comes and goes)
    x = D.tremolo(lp, x, 0.25, 0.3, math.pi)
    return D.width(D.reverb(lp, x, rng, 7.5, mix=0.6, damp=9000, predelay=0.04, width=1.3), 1.25)


def fx_choir_a(lp, x, rng, f0):
    return D.reverb(lp, x, rng, 5.0, mix=0.42, damp=5500, predelay=0.035, width=1.1)


def fx_choir_o(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 3200, 0.7, 2))
    return D.width(D.reverb(lp, x, rng, 4.5, mix=0.45, damp=3500, predelay=0.03, width=1.2), 1.2)


def fx_shimmer(lp, x, rng, f0):
    return D.shimmer(lp, x, rng, 7.0, mix=0.72, amount=0.7, octaves=2)


def fx_strings(lp, x, rng, f0):
    x = D.tremolo(lp, x, 1 / lp.L, 0.25)          # (the section leans into the bow and eases off)
    return D.reverb(lp, x, rng, 2.8, mix=0.3, damp=5000, predelay=0.02, width=1.0)


def fx_glass(lp, x, rng, f0):
    x = D.delay(lp, x, lp.L / 32, feedback=0.45, mix=0.35, tone=6000)
    return D.reverb(lp, x, rng, 2.4, mix=0.32, damp=10000, bright=1.3, predelay=0.01)


def fx_swell(lp, x, rng, f0):
    c = lp_curve(lp, 0.05, 1.0, 1, -math.pi / 2)
    x = D.sweep(lp, x, c, lambda f, k: D.lowpass(f, k, 1.2, 4), f0 * 1.5, f0 * 30)
    x = x * (0.35 + 0.65 * c ** 0.7)[:, None]
    return D.reverb(lp, x, rng, 3.5, mix=0.35, damp=5000)


def fx_worship(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.filt(x, D.peak(f, 3000, 3.0, 0.8) * D.highpass(f, 70, 0.7, 2))
    x = D.chorus(lp, x, rate=0.2, depth_ms=3.5, mix=0.4, voices=3)
    x = D.shimmer(lp, x, rng, 5.5, mix=0.45, amount=0.3, octaves=1)
    return D.width(x, 1.35)


def fx_drone(lp, x, rng, f0):
    curve = 0.5 + 0.5 * lp.drift(rng, 1.0, 0.25)
    x = D.sweep(lp, x, curve, lambda f, k: D.lowpass(f, k, 4.0, 4), f0 * 2, f0 * 16, steps=16)
    wind = np.stack([D.noise(lp, rng, "pink", 100, 3000) for _ in (0, 1)], 1) * (0.5 + 0.5 * lp.drift(rng, 1.0, 0.4))[:, None]
    x = x / D.rms(x) + 0.2 * wind
    return D.width(D.reverb(lp, x, rng, 8.0, mix=0.55, damp=2000, predelay=0.06, width=1.3), 1.3)


def fx_deep(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 320, 0.6, 4))
    x = D.tremolo(lp, x, 4 / lp.L * 4, 0.35)
    return D.width(D.reverb(lp, x, rng, 2.0, mix=0.2, damp=1500), 0.35)


def fx_heaven(lp, x, rng, f0):
    x = D.filt(x, D.highpass(D.freqs(lp), 300, 0.7, 2))
    x = D.shimmer(lp, x, rng, 8.0, mix=0.6, amount=0.6, octaves=2)
    return D.width(x, 1.4)


def fx_felt(lp, x, rng, f0):
    hiss = np.stack([D.noise(lp, rng, "pink", 2000, 12000) for _ in (0, 1)], 1)
    x = x / D.rms(x) + 0.006 * hiss
    return D.width(D.reverb(lp, x, rng, 1.2, mix=0.18, damp=3000, predelay=0.008), 0.6)


def fx_organ(lp, x, rng, f0):
    x = D.rotary(lp, x, rate=0.8, depth=0.5)
    x = D.filt(x, D.peak(D.freqs(lp), 2500, 4.0, 0.9))
    return D.reverb(lp, x, rng, 1.4, mix=0.18, damp=5000, predelay=0.008, width=0.8)


def fx_analog(lp, x, rng, f0):
    x = D.sweep(lp, x, lp_curve(lp, 0.05, 0.95, 2, 0.0, "tri"), res_lp, f0 * 1.5, f0 * 40, steps=20)
    x = D.chorus(lp, x, rate=0.5, depth_ms=3.0, base_ms=7, mix=0.5)
    return D.reverb(lp, x, rng, 2.2, mix=0.25, damp=7000, bright=1.2)


def fx_bowed(lp, x, rng, f0):
    x = x * (0.45 + 0.55 * (0.5 + 0.5 * lp.lfo(2 / lp.L, 0.3)))[:, None]   # (slow bow swells, twice round)
    x = D.filt(x, D.lowpass(D.freqs(lp), 1500, 0.7, 2))
    return D.width(D.reverb(lp, x, rng, 4.5, mix=0.45, damp=1800, predelay=0.03, width=1.2), 1.2)


def fx_bells(lp, x, rng, f0):
    x = D.delay(lp, x, lp.L / 24, feedback=0.4, mix=0.3, tone=7000)
    return D.reverb(lp, x, rng, 3.0, mix=0.35, damp=8000, bright=1.2)


def fx_hum(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 1800, 0.7, 2))
    return D.width(D.reverb(lp, x, rng, 1.5, mix=0.2, damp=2500, predelay=0.01), 0.45)


def fx_cinematic(lp, x, rng, f0):
    c = lp_curve(lp, 0.2, 1.0, 1, -math.pi / 2)
    x = D.sweep(lp, x, c, lp4, f0 * 3, f0 * 40)
    x = D.shimmer(lp, x, rng, 8.5, mix=0.5, amount=0.35, octaves=1)
    return D.width(x, 1.4)


def fx_morning(lp, x, rng, f0):
    x = D.delay(lp, x, lp.L / 16, feedback=0.35, mix=0.25, tone=5000)
    return D.reverb(lp, x, rng, 2.6, mix=0.3, damp=7000, bright=1.1, width=1.1)


# name -> layers [(voice spec, octave, gain)], effects, chord (semitones over the root)
FIFTH = (0, 7, 12)
STYLES = {
    "Warm": {"layers": [(("saws", {"n": 5, "detune": 14}), 0, 1.0), ("sub", -1, 0.25)], "fx": fx_warm, "chord": FIFTH},
    "Air": {"layers": [("air", 0, 1.0), (("sines", {"ratios": ((1, 1.0),), "spread": 1.0}), 1, 0.15)], "fx": fx_air, "chord": FIFTH},
    "Choir Aah": {"layers": [(("choir", {"vowel": "a", "singers": 8}), 0, 1.0)], "fx": fx_choir_a, "chord": FIFTH},
    "Choir Ooh": {"layers": [(("choir", {"vowel": "u", "singers": 6, "vib_cents": 16, "breath": 0.08, "to_vowel": "o"}), 0, 1.0)], "fx": fx_choir_o, "chord": FIFTH},
    "Shimmer": {"layers": [(("sines", {"ratios": ((1, 1.0), (2, 0.25))}), 0, 0.7), ("tri", 1, 0.45)], "fx": fx_shimmer, "chord": FIFTH},
    "Strings": {"layers": [(("strings", {"players": 12}), 0, 1.0)], "fx": fx_strings, "chord": FIFTH},
    "Glass": {"layers": [("glass", 1, 1.0), (("sines", {"ratios": ((1, 1.0),)}), 0, 0.3)], "fx": fx_glass, "chord": FIFTH},
    "Swell": {"layers": [("tri", 0, 1.0), (("sines", {"ratios": ((1, 1.0), (2, 0.5), (3, 0.25))}), 0, 0.8), (("saws", {"n": 3, "detune": 6, "spread": 0.4}), 0, 0.35)], "fx": fx_swell, "chord": FIFTH},
    "Worship": {"layers": [(("saws", {"n": 6, "detune": 18, "spread": 1.0}), 0, 0.8), (("sines", {"ratios": ((1, 1.0), (1.5, 0.3))}), 1, 0.45), ("sub", -1, 0.4)],
                "fx": lambda lp, x, rng, f0: fx_worship(lp, D.sweep(lp, x, lp_curve(lp, 0.55, 0.85, 1), lp4, f0 * 3, f0 * 30), rng, f0), "chord": FIFTH},
    "Ambient Drone": {"layers": [(("saws", {"n": 3, "detune": 6, "spread": 0.5}), -1, 1.0), ("sub", -1, 0.3)], "fx": fx_drone, "chord": (0, 7)},
    "Deep": {"layers": [(("saws", {"n": 3, "detune": 8, "spread": 0.3}), -1, 0.7), ("sub", -1, 1.0), ("tri", 0, 0.4)], "fx": fx_deep, "chord": FIFTH},
    "Heaven": {"layers": [(("choir", {"vowel": "a", "singers": 6, "vib_cents": 18}), 1, 0.8), (("sines", {"ratios": ((1, 1.0), (2, 0.4), (3, 0.15))}), 1, 0.6)], "fx": fx_heaven, "chord": FIFTH},
    "Felt": {"layers": [("felt", 0, 1.0), ("felt", 1, 0.25)], "fx": fx_felt, "chord": FIFTH},
    "Organ": {"layers": [("organ", 0, 1.0)], "fx": fx_organ, "chord": FIFTH},
    "Analog": {"layers": [(("pulse", {"n": 2}), 0, 1.0), (("saws", {"n": 2, "detune": 5}), -1, 0.4)], "fx": fx_analog, "chord": FIFTH},
    "Bowed": {"layers": [(("strings", {"players": 8, "low": True}), -1, 1.0)], "fx": fx_bowed, "chord": FIFTH},
    "Bells": {"layers": [("bells", 1, 1.0), (("sines", {"ratios": ((1, 1.0),)}), 0, 0.25)], "fx": fx_bells, "chord": FIFTH},
    "Choir Hum": {"layers": [(("choir", {"vowel": "m", "singers": 6, "vib_cents": 10, "breath": 0.03}), 0, 1.0)], "fx": fx_hum, "chord": FIFTH},
    "Cinematic": {"layers": [(("strings", {"players": 8, "low": True}), -1, 0.8), ("brass", 0, 0.5), ("sub", -1, 0.4), ("air", 1, 0.15)], "fx": fx_cinematic, "chord": FIFTH},
    "Morning": {"layers": [("felt", 0, 0.8), ("glass", 1, 0.3), ("air", 1, 0.1)], "fx": fx_morning, "chord": (0, 7, 12, 14)},
}


def render(style, lp, root, rng, notes=None, fx=True):
    """A style on a chord at `root` (MIDI) - or on `notes` [(MIDI, gain)] - through its effects. Stereo, RMS 0.2."""
    st = STYLES[style]
    notes = notes if notes is not None else [(root + s, 1.0 if i == 0 else 0.7) for i, s in enumerate(st["chord"])]
    x = np.zeros((lp.n, 2))
    for spec, octave, gain in st["layers"]:
        layer = np.zeros((lp.n, 2))
        for note, g in (notes[:1] if spec == "sub" else notes):   # (a sub only under the root: under the fifth it would muddy the chord)
            m = note + 12 * octave
            if 21 <= m <= 108:
                layer += g * voice(spec, lp, m, rng)
        if np.any(layer):
            x += gain * layer / D.rms(layer)
    if fx:
        x = st["fx"](lp, x, rng, D.hz(root))
    x = x - x.mean(0)
    return D.to_rms(x, 0.2)
