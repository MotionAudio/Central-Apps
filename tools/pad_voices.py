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
 10.2, more:
  Sunday Keys    the modern worship pad: lush detuned saws and soft octaves, slowly opening, a long shimmer, very wide,
                 with room left for the singer (a gentle dip where the voice sits)
  Ember          a grand piano (recorded) stretched into a warm cloud, some of it backwards, under a frozen low piano, dark hall
  Halo           hand chimes (recorded) stretched into a high glistening cloud in a shimmer
  Selah          violins and cellos (recorded) stretched into a slow-breathing string cloud
  Tide           saws washing in and out like waves, with surf
  Dawn           piano notes (recorded) played backwards, blooming up at uneven moments, on an add9 chord
  Frozen Piano   a grand piano's sound (recorded) held still forever, clear and close
  Bowed Glass    a bowed psaltery (recorded) stretched into a high glassy cloud
  Vibes          a vibraphone (recorded) held, its motor turning
  Harp Wash      a concert harp (recorded) plucking slowly through the chord into a long hall
  Cathedral Organ a pipe organ (recorded) held in a cathedral
  Vowels         a singing synth whose vowel keeps changing
  Tape           saws on worn tape: wow, flutter, hiss, narrow
  Sparkle        a cloud of tiny glints over a soft bed, echoing
  Eighties       the 80s string-synth pad, pulse waves and a thick chorus
  Reed           a musette reed, its three reeds beating
  Swell Guitar   ambient electric guitar swells with long echoes
  Breathe        a pad that breathes in and out, three slow breaths a loop
  Tanpura        a buzzing drone, its brightness sweeping with each pluck
  Horns          soft french horns, dark and warm
  Flute Choir    a section of breathy flutes

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
    return D.width(D.reverb(lp, x, rng, 6.0, mix=0.48, damp=5500, predelay=0.035, width=1.2), 1.15)


def fx_choir_o(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 3200, 0.7, 2))
    return D.width(D.reverb(lp, x, rng, 4.5, mix=0.45, damp=3500, predelay=0.03, width=1.2), 1.2)


def fx_shimmer(lp, x, rng, f0):
    x = D.sweep(lp, x, lp_curve(lp, 0.4, 0.9, 1), lp4, f0 * 3, f0 * 24)   # (the bed under the halo breathes)
    return D.width(D.shimmer(lp, x, rng, 8.0, mix=0.72, amount=0.7, octaves=2), 1.2)


def fx_strings(lp, x, rng, f0):
    x = D.tremolo(lp, x, 1 / lp.L, 0.3)          # (the section leans into the bow and eases off)
    x = D.chorus(lp, x, rate=0.25, depth_ms=2.0, mix=0.25)
    return D.reverb(lp, x, rng, 3.4, mix=0.36, damp=5000, predelay=0.02, width=1.15)


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
    "Warm": {"layers": [(("saws", {"n": 7, "detune": 16}), 0, 1.0), (("saws", {"n": 3, "detune": 9, "spread": 0.5}), 1, 0.25), ("sub", -1, 0.25)], "fx": fx_warm, "chord": FIFTH},
    "Air": {"layers": [("air", 0, 1.0), (("sines", {"ratios": ((1, 1.0),), "spread": 1.0}), 1, 0.15)], "fx": fx_air, "chord": FIFTH},
    "Choir Aah": {"layers": [(("choir", {"vowel": "a", "singers": 12}), 0, 1.0), (("choir", {"vowel": "o", "singers": 6, "vib_cents": 16}), -1, 0.45)], "fx": fx_choir_a, "chord": FIFTH},
    "Choir Ooh": {"layers": [(("choir", {"vowel": "u", "singers": 6, "vib_cents": 16, "breath": 0.08, "to_vowel": "o"}), 0, 1.0)], "fx": fx_choir_o, "chord": FIFTH},
    "Shimmer": {"layers": [(("sines", {"ratios": ((1, 1.0), (2, 0.25))}), 0, 0.7), ("tri", 1, 0.45)], "fx": fx_shimmer, "chord": FIFTH},
    "Strings": {"layers": [(("strings", {"players": 16}), 0, 1.0), (("strings", {"players": 8, "low": True}), -1, 0.5)], "fx": fx_strings, "chord": FIFTH},
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


# ---------------------------------------------------------------- 10.2, more: pads made from real recordings (CC0)
# Recordings come from pad_sources.py (VCSL and VSCO 2 CE, both CC0): set_sources(Sources(cache)) before rendering
# these styles (make-pad-loops.py and make-pads.py do, with their download cache; tests use pad_sources.Stand()).
SRC = None
RECORDED = {"ember": "piano", "frozen": "piano", "blooms": "piano", "halo": "chimes", "selah_hi": "violins", "selah_lo": "cellos",
            "glassbow": "psaltery", "vibes": "vibes", "harp": "harp", "pipes": "organ"}


def set_sources(sources):
    global SRC
    SRC = sources


def _src(name, note, sr):
    """The recording nearest the note, moved to the note's pitch (resampled), mono."""
    if SRC is None:
        raise RuntimeError("this pad is made from recordings: give the download cache (--cache)")
    n, x = min(SRC.notes(name), key=lambda p: abs(p[0] - note))
    ratio = 2 ** ((note - n) / 12.0) * 32000.0 / sr
    m = int(len(x) / ratio)
    return np.interp(np.arange(m) * ratio, np.arange(len(x)), x)


def v_gran(lp, note, rng, src="piano", density=36, grain=0.28, region=(0.12, 1.6), rev=0.0, spread=0.95):
    """A recording stretched into a cloud: short overlapping pieces (grains) of the note's sustain, taken at random from
    `region` (seconds), some played backwards, scattered round the loop and across the stereo field."""
    y = _src(src, note, lp.sr)
    g = int(grain * lp.sr)
    a = min(int(region[0] * lp.sr), max(0, len(y) - g - 1))
    b = max(a + 1, min(int(region[1] * lp.sr), len(y) - g))
    win = np.hanning(g)
    out = np.zeros((lp.n, 2))
    for _ in range(int(density * lp.L)):
        p = int(rng.integers(a, b))
        seg = y[p:p + g]
        if len(seg) < g:
            continue
        if rng.random() < rev:
            seg = seg[::-1]
        seg = seg * win * rng.uniform(0.5, 1.0)
        idx = (int(rng.integers(0, lp.n)) + np.arange(g)) % lp.n
        ang = (rng.uniform(-spread, spread) + 1) * math.pi / 4
        out[idx, 0] += seg * math.cos(ang)
        out[idx, 1] += seg * math.sin(ang)
    return out


def v_freeze(lp, note, rng, src="piano", at=(0.15, 0.9), at2=(0.9, 2.2)):
    """A recording frozen: the sound of a moment of the note held forever (its spectrum with fresh phases, round the
    loop), two moments - the bright start and the mellower ring - slowly trading places."""
    y = _src(src, note, lp.sr)
    f = D.freqs(lp)
    outs = []
    for w0, w1 in (at, at2):
        seg = y[int(w0 * lp.sr):int(w1 * lp.sr)]
        if len(seg) < 2048:
            seg = y[:max(2048, len(y))]
        S = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        M = np.interp(f, np.fft.rfftfreq(len(seg), 1 / lp.sr), S)
        o = np.stack([np.fft.irfft(M * np.exp(1j * rng.uniform(0, 2 * math.pi, len(f))), lp.n) for _ in (0, 1)], 1)
        outs.append(o / D.rms(o))
    g = (0.5 + 0.5 * lp.lfo(1 / lp.L, rng.uniform(0, 6.28)))[:, None]
    return outs[0] * g + outs[1] * (1 - g)


def v_blooms(lp, note, rng, src="piano", every=2.2):
    """Notes played backwards: each one swells up out of nothing and stops - blooming at uneven moments round the loop."""
    y = _src(src, note, lp.sr)
    m = min(len(y), int(2.6 * lp.sr))
    r = (y[:m] * np.linspace(1, 0, m) ** 0.5)[::-1]
    out = np.zeros((lp.n, 2))
    at = rng.uniform(0, every)
    while at < lp.L:
        idx = (int(at * lp.sr) + np.arange(m)) % lp.n
        ang = (rng.uniform(-0.8, 0.8) + 1) * math.pi / 4
        amp = rng.uniform(0.6, 1.0)
        out[idx, 0] += r * amp * math.cos(ang)
        out[idx, 1] += r * amp * math.sin(ang)
        at += every * rng.uniform(0.7, 1.3)
    return out


def v_plucks(lp, note, rng, src="harp", every=1.6):
    """A recording's notes plucked at uneven moments round the loop (each ringing on across the loop's end)."""
    y = _src(src, note, lp.sr)
    m = min(len(y), lp.n)
    r = y[:m] * np.linspace(1, 0, m) ** 0.3
    out = np.zeros((lp.n, 2))
    at = rng.uniform(0, every)
    while at < lp.L:
        idx = (int(at * lp.sr) + np.arange(m)) % lp.n
        ang = (rng.uniform(-0.9, 0.9) + 1) * math.pi / 4
        amp = rng.uniform(0.5, 1.0)
        out[idx, 0] += r * amp * math.cos(ang)
        out[idx, 1] += r * amp * math.sin(ang)
        at += every * rng.uniform(0.6, 1.4)
    return out


# ---------------------------------------------------------------- 10.2, more synthesised voices
def v_vowels(lp, note, rng):
    """A singing synth whose vowel keeps changing: ah - eh - ee - oh - oo and back round, once a loop."""
    f = D.freqs(lp)
    src = v_saws(lp, note, rng, n=3, detune=8, spread=0.6, vib=10)
    src = D.filt(src, D.tilt(f, -3.0, 300))
    order = ["a", "e", "i", "o", "u"]
    ys = [D.filt(src, D.formant(f, D.VOWELS[v]) * D.highpass(f, 90, 0.7, 2)) for v in order]
    pos = (lp.t / lp.L * len(order)) % len(order)
    out = np.zeros_like(src)
    for i, y in enumerate(ys):
        d = np.minimum(np.abs(pos - i), len(order) - np.abs(pos - i))
        out += y * np.clip(1 - d, 0, 1)[:, None]
    return out


def v_tape(lp, note, rng):
    """Two saws on worn tape: strong wow (slow pitch wander) and flutter."""
    f0 = D.hz(note)
    out = np.zeros((lp.n, 2))
    wow = 16 * lp.lfo(0.4, rng.uniform(0, 6.28)) + 5 * lp.lfo(5.8, 0.0) + lp.drift(rng, 6.0)
    for i, c in enumerate((-4.0, 4.0)):
        out += D.pan(D.saw(lp, f0, wow + c, rng.uniform(0, 1)) * 0.6 + D.tri(lp, f0 * 2, wow + c) * 0.3, (i - 0.5) * 0.4)
    return out


def v_glints(lp, note, rng, per_second=5.0):
    """A cloud of tiny sine glints on the note and its octaves, scattered round the loop."""
    f0 = D.hz(note)
    out = np.zeros((lp.n, 2))
    for _ in range(int(per_second * lp.L)):
        f = lp.q(f0 * rng.choice([1, 2, 2, 4]))
        if f > 0.4 * lp.sr:
            continue
        g = int(rng.uniform(0.08, 0.35) * lp.sr)
        t = np.arange(g) / lp.sr
        seg = np.sin(2 * math.pi * f * t + rng.uniform(0, 6.28)) * np.hanning(g) * rng.uniform(0.3, 1.0)
        idx = (int(rng.integers(0, lp.n)) + np.arange(g)) % lp.n
        ang = (rng.uniform(-1, 1) + 1) * math.pi / 4
        out[idx, 0] += seg * math.cos(ang)
        out[idx, 1] += seg * math.sin(ang)
    return out


def v_reed(lp, note, rng):
    """A musette reed: two narrow pulse waves tuned apart (they beat), through a reed's resonances."""
    f0 = D.hz(note)
    f = D.freqs(lp)
    x = sum(D.pulse(lp, f0, 0.28, c + lp.drift(rng, 1.5), rng.uniform(0, 1)) for c in (-11.0, 0.0, 11.0))
    x = D.filt(x, D.peak(f, 900, 7, 1.5) * D.peak(f, 2100, 5, 2.0) * D.lowpass(f, 5000, 0.7, 2))
    return D.stereo(x)


def v_eguitar(lp, note, rng):
    """An electric guitar note swelled in with the volume knob (no pick attack), again and again, each string its own
    time - the ambient worship guitar."""
    f0 = D.hz(note)
    f = D.freqs(lp)
    x = D.saw(lp, f0, lp.drift(rng, 3.0) + 7 * lp.lfo(5.0, rng.uniform(0, 6.28)), rng.uniform(0, 1))
    x = D.filt(x, D.highpass(f, 90, 0.7, 2) * D.peak(f, 2400, 6, 1.4) * D.lowpass(f, 4200, 0.9, 4))
    period = lp.L / 3
    ph = (lp.t / period + rng.uniform(0, 1)) % 1.0
    env = np.where(ph < 0.45, (ph / 0.45) ** 2, np.exp(-(ph - 0.45) / 0.22))
    return D.pan(D.saturate(x / D.rms(x) * 0.5, 1.8) * env, rng.uniform(-0.4, 0.4))


def v_tanpura(lp, note, rng):
    """A tanpura-like drone: a bright buzzing band (the bridge's 'jawari') sweeping up through the harmonics each time
    the string is plucked, four times round the loop."""
    f0 = D.hz(note)
    out = np.zeros((lp.n, 2))
    ph0 = rng.uniform(0, 1)
    cycle = ((lp.t / (lp.L / 4)) + ph0) % 1.0
    centre = 3 + 22 * cycle ** 0.7
    for k in range(1, 34):
        fk = f0 * k
        if fk > 0.42 * lp.sr:
            break
        amp = (1 / k ** 0.6) * (0.25 + 0.75 * np.exp(-((k - centre) / 3.5) ** 2)) * (0.6 + 0.4 * np.exp(-cycle * 3))
        for side in (0, 1):
            out[:, side] += amp * D.sine(lp, fk + (side - 0.5) * 0.2, None, rng.uniform(0, 1))
    return out


def v_horns(lp, note, rng):
    """Soft french horns: a few saws with a slow vibrato, dark, with the horn's warm resonance."""
    f = D.freqs(lp)
    y = v_saws(lp, note, rng, n=3, detune=6, spread=0.5, vib=6)
    return D.filt(y, D.peak(f, 600, 7, 1.0) * D.lowpass(f, 2200, 0.7, 4) * D.highpass(f, 150, 0.7, 2))


def v_flutes(lp, note, rng, players=5):
    """A section of flutes: each player a soft sine voice with breath and their own vibrato."""
    f0 = D.hz(note)
    f = D.freqs(lp)
    out = np.zeros((lp.n, 2))
    for i in range(players):
        vib = rng.uniform(12, 22) * lp.lfo(rng.uniform(4.6, 5.6), rng.uniform(0, 6.28)) + rng.uniform(-6, 6)
        x = D.sine(lp, f0, vib, rng.uniform(0, 1)) + 0.2 * D.sine(lp, f0 * 2, vib) + 0.06 * D.sine(lp, f0 * 3, vib)
        out += D.pan(x, rng.uniform(-0.9, 0.9))
    comb = sum((1 / k) / (1 + ((f - f0 * k) / (10 + f0 * k * 0.01)) ** 2) for k in (1, 2, 3))
    breath = np.stack([D.filt(D.noise(lp, rng, "white"), comb * D.highpass(f, 300, 0.7, 2)) for _ in (0, 1)], 1)
    return out / D.rms(out) + 0.12 * breath / D.rms(breath)


def v_eighties(lp, note, rng):
    """The 80s string-synth pad: three pulse waves whose widths sweep quickly, bright and open."""
    f0 = D.hz(note)
    out = np.zeros((lp.n, 2))
    for i, c in enumerate((-6.0, 0.0, 6.0)):
        w = 0.5 + 0.4 * lp.lfo(rng.choice([0.9, 1.1, 1.3]), rng.uniform(0, 6.28))
        out += D.pan(D.pulse(lp, f0, w, c + lp.drift(rng, 1.5), rng.uniform(0, 1)), (i - 1) * 0.7)
    return out


VOICES.update({"gran": v_gran, "freeze": v_freeze, "blooms": v_blooms, "plucks": v_plucks, "vowels": v_vowels, "tape": v_tape, "glints": v_glints,
               "reed": v_reed, "eguitar": v_eguitar, "tanpura": v_tanpura, "horns": v_horns, "flutes": v_flutes, "eighties": v_eighties})


def needs_sources(style):
    """True when a style is (partly) made from recordings."""
    return any((spec if isinstance(spec, str) else spec[0]) in ("gran", "freeze", "blooms", "plucks", "texture") for spec, _o, _g in STYLES[style]["layers"])


# ---------------------------------------------------------------- 10.2, more effects
def vocal_space(lp, x, lo=110.0):
    """Room for the singer: the lows below the band's bass cleared, a gentle dip where the voice sits (1.5-3 kHz)."""
    f = D.freqs(lp)
    return D.filt(x, D.highpass(f, lo, 0.7, 2) * D.peak(f, 2200, -5.0, 0.7))


def fx_sunday(lp, x, rng, f0):
    x = D.sweep(lp, x, lp_curve(lp, 0.35, 0.7, 1), lp4, f0 * 3, f0 * 30)
    x = D.chorus(lp, vocal_space(lp, x), rate=0.15, depth_ms=4.0, mix=0.45, voices=3)
    x = D.shimmer(lp, x, rng, 9.0, mix=0.6, amount=0.45, octaves=2)
    return D.width(x, 1.45)


def fx_ember(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 2600, 0.7, 2) * D.highpass(D.freqs(lp), 70, 0.7, 2))
    return D.width(D.reverb(lp, x, rng, 7.5, mix=0.55, damp=2500, predelay=0.04, width=1.2), 1.2)


def fx_halo(lp, x, rng, f0):
    x = D.filt(x, D.highpass(D.freqs(lp), 450, 0.7, 2))
    return D.width(D.shimmer(lp, x, rng, 8.0, mix=0.65, amount=0.6, octaves=2), 1.5)


def fx_selah(lp, x, rng, f0):
    x = x * (0.5 + 0.5 * (0.5 + 0.5 * lp.lfo(2 / lp.L, 0.7)))[:, None]
    x = vocal_space(lp, x, 80)
    return D.width(D.reverb(lp, x, rng, 6.0, mix=0.45, damp=4500, predelay=0.03, width=1.3), 1.3)


def fx_tide(lp, x, rng, f0):
    wave = (0.5 - 0.5 * np.cos(2 * math.pi * 3 * lp.t / lp.L)) ** 2      # (three waves round the loop)
    x = D.sweep(lp, x, 0.2 + 0.7 * wave, lp4, f0 * 2, f0 * 24)
    x = x * (0.45 + 0.55 * wave)[:, None]
    surf = np.stack([D.noise(lp, rng, "pink", 200, 9000) for _ in (0, 1)], 1) * (0.1 + wave)[:, None]
    x = x / D.rms(x) + 0.25 * surf
    return D.width(D.reverb(lp, x, rng, 4.0, mix=0.35, damp=5000), 1.3)


def fx_dawn(lp, x, rng, f0):
    x = D.delay(lp, x, lp.L / 12, feedback=0.3, mix=0.25, tone=4000)
    return D.reverb(lp, x, rng, 5.0, mix=0.5, damp=5000, width=1.2)


def fx_frozen(lp, x, rng, f0):
    return D.reverb(lp, x, rng, 1.8, mix=0.25, damp=9000, bright=1.2, predelay=0.01)


def fx_glassbow(lp, x, rng, f0):
    x = D.filt(x, D.highpass(D.freqs(lp), 300, 0.7, 2) * D.lowpass(D.freqs(lp), 8000, 0.7, 2))
    x = D.delay(lp, x, lp.L / 20, feedback=0.3, mix=0.25, tone=8000)
    return D.reverb(lp, x, rng, 3.5, mix=0.4, damp=9000, bright=1.3)


def fx_vibes(lp, x, rng, f0):
    x = D.tremolo(lp, x, 5.2, 0.55, math.pi / 2)        # (the vibraphone's motor)
    return D.reverb(lp, x, rng, 2.2, mix=0.3, damp=7000)


def fx_harp(lp, x, rng, f0):
    return D.width(D.reverb(lp, x, rng, 6.0, mix=0.55, damp=6000, predelay=0.02, width=1.3), 1.2)


def fx_vowels(lp, x, rng, f0):
    x = D.chorus(lp, x, rate=0.3, depth_ms=3.0, mix=0.35)
    return D.reverb(lp, x, rng, 3.0, mix=0.35, damp=5000)


def fx_tape(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.saturate(D.filt(x, D.highpass(f, 180, 0.7, 2) * D.lowpass(f, 3600, 0.7, 2)) / D.rms(x) * 0.4, 2.2)
    hiss = np.stack([D.noise(lp, rng, "pink", 1500, 9000) for _ in (0, 1)], 1)
    x = x / D.rms(x) + 0.03 * hiss
    return D.width(D.reverb(lp, x, rng, 0.8, mix=0.15, damp=3000), 0.3)


def fx_sparkle(lp, x, rng, f0):
    x = D.delay(lp, x, lp.L / 24, feedback=0.45, mix=0.35, tone=7000)
    return D.width(D.reverb(lp, x, rng, 4.5, mix=0.5, damp=9000, bright=1.3), 1.4)


def fx_eighties(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 5500, 0.7, 2))
    x = D.chorus(lp, x, rate=0.7, depth_ms=6.0, base_ms=8, mix=0.85, voices=3)
    return D.reverb(lp, x, rng, 2.0, mix=0.25, damp=8000)


def fx_cathedral(lp, x, rng, f0):
    return D.width(D.reverb(lp, x, rng, 9.0, mix=0.6, damp=3000, predelay=0.08, width=1.3), 1.2)


def fx_reed(lp, x, rng, f0):
    return D.width(D.reverb(lp, x, rng, 1.0, mix=0.2, damp=4000, predelay=0.006), 0.5)


def fx_swellgtr(lp, x, rng, f0):
    x = D.delay(lp, x, lp.L / 16, feedback=0.5, mix=0.45, tone=3500)
    return D.reverb(lp, x, rng, 5.0, mix=0.45, damp=4000, width=1.2)


def fx_breathe(lp, x, rng, f0):
    breath = (0.5 - 0.5 * np.cos(2 * math.pi * 3 * lp.t / lp.L)) ** 1.5   # (three slow breaths round the loop)
    x = D.sweep(lp, x, 0.15 + 0.8 * breath, lp4, f0 * 2, f0 * 16)
    x = x * (0.3 + 0.7 * breath)[:, None]
    return D.reverb(lp, x, rng, 3.5, mix=0.35, damp=5000)


def fx_tanpura(lp, x, rng, f0):
    return D.width(D.reverb(lp, x, rng, 3.0, mix=0.3, damp=4000), 0.8)


def fx_horns(lp, x, rng, f0):
    return D.reverb(lp, x, rng, 4.5, mix=0.4, damp=3000, predelay=0.03)


def fx_flutes(lp, x, rng, f0):
    return D.width(D.reverb(lp, x, rng, 3.5, mix=0.4, damp=7000, bright=1.1), 1.2)


STYLES.update({
    # the Sunday-keys worship pads: lush, slow, wide, long tails, out of the singer's way
    "Sunday Keys": {"layers": [("tri", 0, 0.8), (("sines", {"ratios": ((1, 1.0), (2, 0.3), (3, 0.12)), "spread": 1.0}), 0, 0.8), (("sines", {"ratios": ((1, 1.0), (1.5, 0.4))}), 1, 0.5),
                               ("air", 1, 0.25), ("sub", -1, 0.3)],
                    "fx": fx_sunday, "chord": FIFTH},
    "Ember": {"layers": [(("gran", {"src": "piano", "rev": 0.5, "density": 30}), 0, 1.0), (("freeze", {"src": "piano"}), -1, 0.5)], "fx": fx_ember, "chord": FIFTH},
    "Halo": {"layers": [(("gran", {"src": "chimes", "grain": 0.4, "density": 24, "region": (0.05, 2.5)}), 1, 1.0)], "fx": fx_halo, "chord": FIFTH},
    "Selah": {"layers": [(("gran", {"src": "violins", "grain": 0.5, "density": 26, "region": (0.4, 2.8)}), 0, 1.0),
                         (("gran", {"src": "cellos", "grain": 0.5, "density": 18, "region": (0.4, 2.8)}), -1, 0.7)], "fx": fx_selah, "chord": FIFTH},
    "Tide": {"layers": [(("saws", {"n": 4, "detune": 12, "spread": 0.9}), 0, 1.0), ("sub", -1, 0.25)], "fx": fx_tide, "chord": FIFTH},
    "Dawn": {"layers": [(("blooms", {"src": "piano"}), 0, 1.0), (("sines", {"ratios": ((1, 1.0),)}), 0, 0.25)], "fx": fx_dawn, "chord": (0, 7, 12, 14)},
    "Frozen Piano": {"layers": [(("freeze", {"src": "piano"}), 0, 1.0)], "fx": fx_frozen, "chord": FIFTH},
    "Bowed Glass": {"layers": [(("gran", {"src": "psaltery", "grain": 0.35, "density": 30, "region": (0.3, 2.5)}), 0, 1.0)], "fx": fx_glassbow, "chord": FIFTH},
    "Vibes": {"layers": [(("freeze", {"src": "vibes", "at": (0.05, 0.6), "at2": (0.6, 1.8)}), 0, 1.0)], "fx": fx_vibes, "chord": FIFTH},
    "Harp Wash": {"layers": [(("plucks", {"src": "harp"}), 0, 1.0), (("plucks", {"src": "harp", "every": 2.4}), 1, 0.5)], "fx": fx_harp, "chord": (0, 7, 12, 14)},
    "Cathedral Organ": {"layers": [(("freeze", {"src": "organ", "at": (0.4, 1.4), "at2": (1.4, 2.6)}), 0, 1.0), (("freeze", {"src": "organ", "at": (0.4, 1.4), "at2": (1.4, 2.6)}), -1, 0.6)],
                        "fx": fx_cathedral, "chord": FIFTH},
    # synthesised, each its own kind
    "Vowels": {"layers": [("vowels", 0, 1.0)], "fx": fx_vowels, "chord": FIFTH},
    "Tape": {"layers": [("tape", 0, 1.0)], "fx": fx_tape, "chord": FIFTH},
    "Sparkle": {"layers": [("glints", 1, 1.0), (("sines", {"ratios": ((1, 1.0),)}), 0, 0.35)], "fx": fx_sparkle, "chord": (0, 7, 12, 14)},
    "Eighties": {"layers": [("eighties", 0, 1.0)], "fx": fx_eighties, "chord": FIFTH},
    "Reed": {"layers": [("reed", 0, 1.0)], "fx": fx_reed, "chord": FIFTH},
    "Swell Guitar": {"layers": [("eguitar", 0, 1.0)], "fx": fx_swellgtr, "chord": (0, 7, 12, 19)},
    "Breathe": {"layers": [(("saws", {"n": 4, "detune": 10, "spread": 0.8}), 0, 1.0), (("sines", {"ratios": ((1, 1.0),)}), 1, 0.3)], "fx": fx_breathe, "chord": FIFTH},
    "Tanpura": {"layers": [("tanpura", -1, 1.0)], "fx": fx_tanpura, "chord": (0, 7, 12)},
    "Horns": {"layers": [("horns", 0, 1.0), ("horns", 1, 0.35)], "fx": fx_horns, "chord": FIFTH},
    "Flute Choir": {"layers": [("flutes", 1, 1.0)], "fx": fx_flutes, "chord": FIFTH},
})


# ---------------------------------------------------------------- 10.3: Central Pads Extra - 35 more styles
RECORDED.update({k: k for k in ("tubular", "glock", "marimba", "kalimba", "zither", "ocarina", "recorder", "harmonica", "sax", "fmpiano", "posorgan", "kawai", "mbira",
                                "wine", "sleigh", "horn", "trumpet", "trombone", "flute", "clarinet", "oboe", "bassoon", "violas", "basses")})


def v_texture(lp, note, rng, src="sleigh", every=1.2, hp=2500.0):
    """An unpitched recording (sleigh bells...) scattered round the loop, its lows taken out so it never muddies the key."""
    if SRC is None:
        raise RuntimeError("this pad is made from recordings: give the download cache (--cache)")
    _n, y = SRC.notes(src)[0]
    y = D.ffilt(np.asarray(y, float), lambda f: D.highpass(f, hp, 0.7, 2), 32000)
    if lp.sr != 32000:
        y = np.interp(np.arange(int(len(y) * lp.sr / 32000)) * 32000 / lp.sr, np.arange(len(y)), y)
    m = min(len(y), lp.n)
    r = y[:m] * np.linspace(1, 0, m) ** 0.5
    out = np.zeros((lp.n, 2))
    at = rng.uniform(0, every)
    while at < lp.L:
        idx = (int(at * lp.sr) + np.arange(m)) % lp.n
        ang = (rng.uniform(-0.9, 0.9) + 1) * math.pi / 4
        g = rng.uniform(0.3, 1.0)
        out[idx, 0] += r * g * math.cos(ang)
        out[idx, 1] += r * g * math.sin(ang)
        at += every * rng.uniform(0.5, 1.5)
    return out


def v_ks_cloud(lp, note, rng, every=0.7):
    """Plucked strings (Karplus-Strong, made here) scattered round the loop on the note and its octave."""
    out = np.zeros((lp.n, 2))
    at = rng.uniform(0, every)
    while at < lp.L:
        f = D.hz(note + 12 * int(rng.integers(0, 2)))
        p = int(lp.sr / f)
        frac = lp.sr / f - p
        n = min(lp.n, int(3.0 * lp.sr))
        y = np.zeros(n + p + 2)
        y[2:p + 2] = np.convolve(rng.uniform(-1, 1, p), [0.25, 0.5, 0.25], "same")
        i = p + 2
        while i < len(y):
            j = min(len(y), i + p)
            k = np.arange(i, j)
            y[i:j] = 0.4985 * ((y[k - p] * (1 - frac) + y[k - p - 1] * frac) + (y[k - p - 1] * (1 - frac) + y[k - p - 2] * frac))
            i = j
        y = y[2:n + 2] * np.linspace(1, 0, n) ** 0.5
        idx = (int(at * lp.sr) + np.arange(n)) % lp.n
        ang = (rng.uniform(-0.9, 0.9) + 1) * math.pi / 4
        g = rng.uniform(0.4, 1.0)
        out[idx, 0] += y * g * math.cos(ang)
        out[idx, 1] += y * g * math.sin(ang)
        at += every * rng.uniform(0.5, 1.5)
    return out


def v_ep(lp, note, rng, every=2.5):
    """A soft electric piano (an FM tine, made here) played again and again at uneven moments, each note ringing on."""
    out = np.zeros((lp.n, 2))
    n = min(lp.n, int(3.5 * lp.sr))
    t = np.arange(n) / lp.sr
    f = D.hz(note)
    at = rng.uniform(0, every)
    while at < lp.L:
        idx_ = 1.2 * np.exp(-t / 0.5) + 0.2
        y = np.sin(2 * math.pi * f * t + idx_ * np.sin(2 * math.pi * f * t)) * np.exp(-t / 1.6) + 0.15 * np.sin(2 * math.pi * f * 14 * t) * np.exp(-t / 0.05)
        y = y * np.minimum(1, t / 0.003)
        idx = (int(at * lp.sr) + np.arange(n)) % lp.n
        ang = (rng.uniform(-0.5, 0.5) + 1) * math.pi / 4
        g = rng.uniform(0.6, 1.0)
        out[idx, 0] += y * g * math.cos(ang)
        out[idx, 1] += y * g * math.sin(ang)
        at += every * rng.uniform(0.7, 1.3)
    return out


VOICES.update({"texture": v_texture, "kscloud": v_ks_cloud, "ep": v_ep})


def phaser(lp, x, rate=0.08, stages=6):
    """A slow phaser: notches sweeping up and down through the sound (made as a moving comb of all-pass dips)."""
    f = D.freqs(lp)
    curve = 0.5 + 0.5 * lp.lfo(rate)

    def shape(fr, c):
        h = np.ones_like(fr)
        for k in range(stages // 2):
            h = h * (1 - 0.85 * np.exp(-((fr - c * (1.9 ** k)) / (c * (1.9 ** k) * 0.18)) ** 2))
        return h
    return D.sweep(lp, x, curve, shape, 200, 1600, steps=16)


def crush(x, keep=6, bits=9):
    """Lo-fi: every `keep` samples held (a low sample rate) and fewer levels (bits) - then gently smoothed."""
    y = np.repeat(x[::keep], keep, axis=0)[:len(x)]
    q = 2 ** (bits - 1)
    return np.round(y * q) / q


def fx_hall(seconds, mix, damp=5000.0, width=1.2, hp=0.0, lp_=0.0, pre=0.03, bright=1.0, wide=1.0):
    def fx(lp, x, rng, f0):
        f = D.freqs(lp)
        H = np.ones_like(f)
        if hp:
            H = H * D.highpass(f, hp, 0.7, 2)
        if lp_:
            H = H * D.lowpass(f, lp_, 0.7, 2)
        y = D.filt(x, H)
        y = D.reverb(lp, y, rng, seconds, mix=mix, damp=damp, predelay=pre, width=width, bright=bright)
        return D.width(y, wide)
    return fx


def fx_shim(seconds, mix, amount, octaves=1, hp=0.0, wide=1.3):
    def fx(lp, x, rng, f0):
        if hp:
            x = D.filt(x, D.highpass(D.freqs(lp), hp, 0.7, 2))
        return D.width(D.shimmer(lp, x, rng, seconds, mix=mix, amount=amount, octaves=octaves), wide)
    return fx


def fx_sunday_warm(lp, x, rng, f0):
    x = D.saturate(D.filt(x, D.lowpass(D.freqs(lp), 1800, 0.7, 4)) / D.rms(x) * 0.4, 2.0)
    x = vocal_space(lp, x, 90)
    return D.width(D.reverb(lp, x, rng, 7.0, mix=0.5, damp=2500, width=1.3), 1.3)


def fx_sunday_bright(lp, x, rng, f0):
    x = D.filt(vocal_space(lp, x, 160), D.peak(D.freqs(lp), 7000, 4, 0.7))
    return D.width(D.shimmer(lp, x, rng, 7.0, mix=0.55, amount=0.55, octaves=2), 1.4)


def fx_sunday_cine(lp, x, rng, f0):
    c = lp_curve(lp, 0.15, 1.0, 1, -math.pi / 2)
    x = D.sweep(lp, x, c, lp4, f0 * 2, f0 * 40) * (0.5 + 0.5 * c)[:, None]
    return D.width(D.shimmer(lp, vocal_space(lp, x, 60), rng, 10.0, mix=0.6, amount=0.4, octaves=1), 1.5)


def fx_amb_guitar(lp, x, rng, f0):
    x = D.delay(lp, x, lp.L / 8, feedback=0.45, mix=0.4, tone=3000)
    return D.width(D.shimmer(lp, x, rng, 8.0, mix=0.55, amount=0.35, octaves=1), 1.3)


def fx_synth_swell(lp, x, rng, f0):
    c = lp_curve(lp, 0.0, 1.0, 1, -math.pi / 2)
    x = D.sweep(lp, x, c, lambda f, k: D.lowpass(f, k, 1.6, 4), f0 * 1.2, f0 * 50) * (0.25 + 0.75 * c ** 1.3)[:, None]
    noise = np.stack([D.noise(lp, rng, "white", 3000, 12000) for _ in (0, 1)], 1) * (c ** 3)[:, None]
    x = x / D.rms(x) + 0.12 * noise
    return D.width(D.reverb(lp, x, rng, 4.0, mix=0.35, damp=7000), 1.3)


def fx_christmas(lp, x, rng, f0):
    return D.width(D.reverb(lp, x, rng, 4.5, mix=0.45, damp=7000, bright=1.2, width=1.2), 1.2)


def fx_musicbox(lp, x, rng, f0):
    return D.reverb(lp, D.filt(x, D.highpass(D.freqs(lp), 400, 0.7, 2)), rng, 1.6, mix=0.3, damp=9000, predelay=0.01)


def fx_easter(lp, x, rng, f0):
    x = x * (0.55 + 0.45 * (0.5 + 0.5 * lp.lfo(1 / lp.L, -math.pi / 2)))[:, None]
    return D.width(D.reverb(lp, x, rng, 6.5, mix=0.5, damp=4000, predelay=0.05, width=1.3), 1.2)


def fx_lofi(lp, x, rng, f0):
    f = D.freqs(lp)
    x = crush(x / (np.max(np.abs(x)) or 1) * 0.7, keep=4, bits=8)
    x = D.filt(x, D.lowpass(f, 3500, 0.7, 2) * D.highpass(f, 120, 0.7, 2))
    hiss = np.stack([D.noise(lp, rng, "pink", 1000, 8000) for _ in (0, 1)], 1)
    x = x / D.rms(x) + 0.04 * hiss
    return D.width(D.reverb(lp, x, rng, 1.0, mix=0.2, damp=3000), 0.5)


def fx_phaser(lp, x, rng, f0):
    return D.reverb(lp, phaser(lp, D.chorus(lp, x, rate=0.2, depth_ms=2, mix=0.3)), rng, 2.5, mix=0.3, damp=6000)


def fx_marimba(lp, x, rng, f0):
    return D.width(D.reverb(lp, D.delay(lp, x, lp.L / 20, feedback=0.3, mix=0.2, tone=5000), rng, 3.0, mix=0.4, damp=6000), 1.3)


def fx_tremolo_hall(lp, x, rng, f0):
    return D.reverb(lp, D.tremolo(lp, x, 6.5, 0.35, math.pi / 3), rng, 3.5, mix=0.4, damp=5000)


def fx_haze(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.saturate(D.filt(x, D.lowpass(f, 3000, 0.7, 2)) / D.rms(x) * 0.4, 1.6)
    return D.width(D.reverb(lp, x, rng, 2.5, mix=0.35, damp=3500), 0.7)


def G(src, **kw):
    return ("gran", dict(src=src, **kw))


def F(src, **kw):
    return ("freeze", dict(src=src, **kw))


SUS = {"region": (0.4, 2.6), "grain": 0.45, "density": 24}   # (a sustained instrument's held middle)
EXTRA = {
    # Sunday-keys worship variants - each from its own sound
    "Sunday Warm": {"layers": [(("saws", {"n": 6, "detune": 12, "spread": 1.0}), 0, 1.0), ("felt", 0, 0.4), ("sub", -1, 0.3)], "fx": fx_sunday_warm, "chord": FIFTH},
    "Sunday Bright": {"layers": [(F("fmpiano", at=(0.05, 0.5), at2=(0.5, 1.6)), 0, 1.0), (("sines", {"ratios": ((1, 1.0), (2, 0.3))}), 1, 0.4)], "fx": fx_sunday_bright, "chord": (0, 7, 12, 14)},
    "Sunday Dark": {"layers": [(G("cellos", **SUS), -1, 1.0), (G("violas", **SUS), 0, 0.5), ("sub", -1, 0.35)],
                    "fx": lambda lp, x, rng, f0: fx_shim(9.0, 0.55, 0.45, 1, wide=1.6)(lp, D.filt(x, D.lowpass(D.freqs(lp), 1800, 0.7, 4)) * (0.4 + 0.6 * (0.5 + 0.5 * lp.lfo(2 / lp.L)))[:, None], rng, f0), "chord": FIFTH},
    "Sunday Air": {"layers": [("air", 0, 0.8), (G("flute", **SUS), 0, 0.8)], "fx": fx_shim(9.0, 0.6, 0.5, 2, hp=200, wide=1.5), "chord": FIFTH},
    "Sunday Cinematic": {"layers": [(G("horn", **SUS), 0, 1.0), (G("violins", **SUS), 1, 0.6), ("sub", -1, 0.3)], "fx": fx_sunday_cine, "chord": FIFTH},
    "Ambient Guitar": {"layers": [(("blooms", {"src": "kawai", "every": 1.8}), 0, 0.5), ("eguitar", 0, 1.0)], "fx": fx_amb_guitar, "chord": (0, 7, 12, 19)},
    "Synth Swell": {"layers": [(("saws", {"n": 7, "detune": 24, "spread": 1.0}), 0, 1.0), (("saws", {"n": 3, "detune": 12}), 1, 0.4)], "fx": fx_synth_swell, "chord": FIFTH},
    # seasonal
    "Christmas Bells": {"layers": [(("plucks", {"src": "tubular", "every": 2.6}), 0, 1.0), (("plucks", {"src": "glock", "every": 1.3}), 1, 0.35),
                                   (("texture", {"src": "sleigh", "every": 1.4}), 0, 0.2), (("sines", {"ratios": ((1, 1.0), (2, 0.3))}), 0, 0.45)], "fx": fx_christmas, "chord": FIFTH},
    "Music Box": {"layers": [(("plucks", {"src": "glock", "every": 0.9}), 1, 1.0), (("plucks", {"src": "glock", "every": 1.7}), 2, 0.35)], "fx": fx_musicbox, "chord": (0, 4, 7, 12)},
    "Easter Brass": {"layers": [(G("horn", **SUS), 0, 1.0), (G("trombone", **SUS), -1, 0.5), (G("trumpet", **SUS), 1, 0.6)],
                     "fx": lambda lp, x, rng, f0: fx_shim(6.5, 0.45, 0.3, 1, hp=90, wide=1.4)(lp, x * (0.45 + 0.55 * (0.5 + 0.5 * lp.lfo(1 / lp.L, -math.pi / 2)))[:, None], rng, f0), "chord": FIFTH},
    "Advent Glass": {"layers": [(("blooms", {"src": "wine", "every": 1.6}), -1, 1.0)],
                     "fx": lambda lp, x, rng, f0: D.reverb(lp, D.delay(lp, x, lp.L / 16, feedback=0.45, mix=0.4, tone=6000), rng, 2.0, mix=0.3, damp=9000, bright=1.2), "chord": FIFTH},
    "Candlelight": {"layers": [(F("kawai"), 1, 1.0), (F("kawai"), 0, 0.5)], "fx": lambda lp, x, rng, f0: D.width(fx_haze(lp, x, rng, f0), 0.4), "chord": (0, 7, 12, 16)},
    # made from more recordings (CC0)
    "Oboe Bloom": {"layers": [(F("oboe", at=(0.3, 1.0), at2=(1.0, 2.0)), 0, 1.0), (G("oboe", **SUS), 0, 0.5)], "fx": fx_hall(3.5, 0.4, damp=6000), "chord": FIFTH},
    "Clarinet Mist": {"layers": [(F("clarinet", at=(0.3, 1.0), at2=(1.0, 2.0)), 0, 1.0), ("air", 1, 0.2)], "fx": fx_hall(5.0, 0.55, damp=5000, hp=150, wide=1.5), "chord": FIFTH},
    "Bassoon Deep": {"layers": [(G("bassoon", **SUS), -1, 1.0)], "fx": fx_hall(3.0, 0.35, damp=2000, lp_=1800, wide=0.8), "chord": FIFTH},
    "Flute Breath": {"layers": [(G("flute", region=(0.2, 2.6), grain=0.25, density=40, rev=0.3), 1, 1.0)], "fx": fx_hall(4.0, 0.45, damp=8000, bright=1.2, wide=1.4), "chord": FIFTH},
    "Trumpet Halo": {"layers": [(G("trumpet", **SUS), 1, 1.0)], "fx": fx_shim(7.0, 0.6, 0.5, 1, hp=500, wide=1.4), "chord": FIFTH},
    "Trombone Floor": {"layers": [(F("trombone", at=(0.4, 1.2), at2=(1.2, 2.2)), -1, 1.0)],
                       "fx": lambda lp, x, rng, f0: fx_hall(1.8, 0.25, damp=4000, wide=0.4)(lp, x * (0.3 + 0.7 * (0.5 - 0.5 * np.cos(2 * math.pi * 4 * lp.t / lp.L)) ** 2)[:, None], rng, f0), "chord": FIFTH},
    "Viola Cloud": {"layers": [(G("violas", region=(0.4, 2.6), grain=0.35, density=30, rev=0.5), 0, 1.0)], "fx": fx_hall(5.0, 0.45, damp=5000, wide=1.3), "chord": FIFTH},
    "Contrabass Drone": {"layers": [(F("basses", at=(0.4, 1.2), at2=(1.2, 2.4)), -1, 1.0)],
                         "fx": lambda lp, x, rng, f0: fx_hall(3.0, 0.3, damp=1500, lp_=900, wide=0.3)(lp, D.tremolo(lp, x, 4 / lp.L * 3, 0.5), rng, f0), "chord": (0, 7)},
    "Marimba Rain": {"layers": [(("plucks", {"src": "marimba", "every": 0.5}), 0, 1.0), (("plucks", {"src": "marimba", "every": 0.8}), 1, 0.5)], "fx": fx_marimba, "chord": (0, 7, 12, 14)},
    "Kalimba Drift": {"layers": [(("plucks", {"src": "kalimba", "every": 0.9}), 0, 1.0)], "fx": lambda lp, x, rng, f0: D.reverb(lp, D.delay(lp, x, lp.L / 12, feedback=0.5, mix=0.45, tone=4000), rng, 2.5, mix=0.35), "chord": (0, 7, 12, 14)},
    "Mbira Glow": {"layers": [(F("mbira", at=(0.02, 0.4), at2=(0.4, 1.4)), 0, 1.0)], "fx": fx_hall(3.0, 0.4, damp=6000), "chord": FIFTH},
    "Ocarina Wind": {"layers": [(F("ocarina"), 0, 1.0), ("air", 1, 0.3)], "fx": fx_hall(5.0, 0.5, damp=7000, wide=1.3), "chord": FIFTH},
    "Recorder Consort": {"layers": [(G("recorder", **SUS), 0, 1.0), (G("recorder", **SUS), 1, 0.5)], "fx": fx_hall(1.2, 0.2, damp=6000, pre=0.008, wide=0.6), "chord": FIFTH},
    "Harmonica Haze": {"layers": [(F("harmonica", at=(0.3, 1.0), at2=(1.0, 2.0)), 0, 1.0)], "fx": fx_haze, "chord": FIFTH},
    "Sax Smoke": {"layers": [(F("sax", at=(0.3, 1.0), at2=(1.0, 2.0)), 0, 1.0), (G("sax", **SUS), 0, 0.4)], "fx": fx_haze, "chord": FIFTH},
    "Zither Tremolo": {"layers": [(G("zither", region=(0.2, 2.5), grain=0.3, density=30), 0, 1.0)], "fx": fx_hall(4.0, 0.45, damp=6000, wide=1.3), "chord": FIFTH},
    "Renaissance Organ": {"layers": [(F("posorgan", at=(0.3, 1.0), at2=(1.0, 2.0)), 0, 1.0)], "fx": fx_hall(2.2, 0.3, damp=5000, pre=0.015, wide=0.9), "chord": FIFTH},
    "Glass Harmonica": {"layers": [(F("wine", at=(0.3, 1.0), at2=(1.0, 2.0)), 0, 1.0)], "fx": fx_tremolo_hall, "chord": FIFTH},
    # more made here
    "Granular Choir": {"layers": [(("choir", {"vowel": "a", "singers": 8}), 0, 1.0)], "fx": lambda lp, x, rng, f0: fx_shim(6.0, 0.5, 0.4, 1, wide=1.3)(lp, D.chorus(lp, x[::-1].copy(), rate=0.9, depth_ms=8, mix=0.6, voices=3), rng, f0), "chord": FIFTH},
    "Pluck Cloud": {"layers": [("kscloud", 0, 1.0)], "fx": fx_hall(5.0, 0.5, damp=6000, wide=1.3), "chord": (0, 7, 12, 14)},
    "Phaser Pad": {"layers": [(("saws", {"n": 4, "detune": 9, "spread": 0.7}), 0, 1.0)], "fx": fx_phaser, "chord": FIFTH},
    "Lo-fi Keys": {"layers": [("ep", 0, 1.0)], "fx": fx_lofi, "chord": (0, 4, 7, 11)},
    "Wide Fifths": {"layers": [(("sines", {"ratios": ((1, 1.0), (1.5, 0.8), (2.25, 0.5), (3, 0.4), (4.5, 0.2)), "spread": 1.0, "beat": 0.6}), -1, 1.0)],
                    "fx": fx_hall(6.0, 0.5, damp=6000, wide=1.6), "chord": (0,)},
}
STYLES.update(EXTRA)
EXTRA_NAMES = list(EXTRA)

# ---------------------------------------------------------------- 10.3: moving pads - the app gates them to the song's tempo
# Each is a keyed bed (a loop per key) with a gate: 16 steps a bar, each 0-9 ("~" in front: glide between the steps).
# The pad pedal's texture channels play the bed and open and close it in time with the song (js/textures.js).
PULSES = [("Pulse Eighths", "Warm", "9070907090709070"), ("Gated Sixteenths", "Analog", "9696969696969696"),
          ("Heartbeat", "Deep", "9500000095000000"), ("Trance Gate", "Sunday Keys", "9009009009009090"),
          ("Offbeat Pump", "Worship", "~1369136913691369"), ("Bar Swell", "Strings", "~1122334455667799")]


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


# ---------------------------------------------------------------- 10.5: Central Pads More - 24 more styles
# More of what Sunday mornings ask for: worship beds with room for the singer, choirs and strings together, a string
# machine, an organ pad, quiet prayer-room pads, and a few made from the CC0 recordings (VSCO 2 CE, VCSL).
def v_string_machine(lp, note, rng):
    """The 70s string synthesizer: a saw per note through a three-voice ensemble chorus (the bucket-brigade swirl)."""
    x = v_saws(lp, note, rng, n=2, detune=4.0, spread=0.4)
    return D.ensemble(lp, x, mix=0.85)


def v_breath_sines(lp, note, rng):
    """Soft sines on the first harmonics, each breathing at its own slow rate (an organ-like glow with motion)."""
    out = np.zeros((lp.n, 2))
    for k, (ratio, g) in enumerate(((1, 1.0), (2, 0.5), (3, 0.3), (4, 0.18), (6, 0.08))):
        y = D.sine(lp, D.hz(note) * ratio, lp.drift(rng, 3.0), rng.uniform(0, 1))
        env = 0.55 + 0.45 * lp.lfo((k % 3 + 1) / lp.L, rng.uniform(0, 2 * math.pi))
        pan = rng.uniform(0.25, 0.75)
        out[:, 0] += y * env * g * math.cos(pan * math.pi / 2)
        out[:, 1] += y * env * g * math.sin(pan * math.pi / 2)
    return out


def v_twinkle(lp, note, rng, per_second=1.6):
    """A few high FM bell glints a second on the chord's pentatonic, each ringing away: a night sky."""
    out = np.zeros((lp.n, 2))
    n = min(lp.n, int(2.5 * lp.sr))
    t = np.arange(n) / lp.sr
    at = rng.uniform(0, 1 / per_second)
    pent = (0, 2, 4, 7, 9, 12, 14)
    while at < lp.L:
        f = D.hz(note + pent[int(rng.integers(0, len(pent)))])
        y = np.sin(2 * math.pi * f * t + 1.6 * np.exp(-t / 0.25) * np.sin(2 * math.pi * f * 3.01 * t)) * np.exp(-t / 0.9)
        y = y * np.minimum(1, t / 0.004)
        idx = (int(at * lp.sr) + np.arange(n)) % lp.n
        ang = (rng.uniform(-0.95, 0.95) + 1) * math.pi / 4
        g = rng.uniform(0.3, 0.9)
        out[idx, 0] += y * g * math.cos(ang)
        out[idx, 1] += y * g * math.sin(ang)
        at += rng.uniform(0.4, 1.6) / per_second
    return out


VOICES.update({"stringmachine": v_string_machine, "breathsines": v_breath_sines, "twinkle": v_twinkle})


def fx_sunday_shimmer(lp, x, rng, f0):
    x = D.sweep(lp, x, lp_curve(lp, 0.3, 0.8, 1, -math.pi / 2), lp4, f0 * 3, f0 * 36)
    x = D.chorus(lp, vocal_space(lp, x), rate=0.12, depth_ms=3.5, mix=0.4, voices=3)
    return D.width(D.shimmer(lp, x, rng, 11.0, mix=0.7, amount=0.55, octaves=2), 1.5)


def fx_deep_worship(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.filt(x, D.lowpass(f, 1600, 0.8, 4) * D.highpass(f, 48, 0.7, 2))
    x = x * (0.6 + 0.4 * (0.5 + 0.5 * lp.lfo(1 / lp.L, -math.pi / 2)))[:, None]
    return D.width(D.reverb(lp, vocal_space(lp, x, 70), rng, 8.0, mix=0.5, damp=2200, predelay=0.05, width=1.3), 1.3)


def fx_analog_strings(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 4600, 0.7, 2) * D.highpass(D.freqs(lp), 110, 0.7, 2))
    x = D.chorus(lp, x, rate=0.6, depth_ms=4.0, base_ms=10, mix=0.55, voices=2)
    return D.width(D.reverb(lp, x, rng, 3.2, mix=0.35, damp=6000, predelay=0.02), 1.3)


def fx_glass_choir(lp, x, rng, f0):
    x = vocal_space(lp, x, 150)
    x = D.delay(lp, x, lp.L / 16, feedback=0.35, mix=0.25, tone=6000)
    return D.width(D.shimmer(lp, x, rng, 7.0, mix=0.55, amount=0.4, octaves=1), 1.4)


def fx_prayer_room(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.filt(x, D.lowpass(f, 2200, 0.7, 2) * D.highpass(f, 90, 0.7, 2))
    x = x * (0.7 + 0.3 * (0.5 + 0.5 * lp.lfo(2 / lp.L, rng.uniform(0, 6.0))))[:, None]
    return D.width(D.reverb(lp, x, rng, 9.0, mix=0.6, damp=2800, predelay=0.06, width=1.2), 1.1)


def fx_cathedral_choir(lp, x, rng, f0):
    x = x * (0.8 + 0.2 * (0.5 + 0.5 * lp.lfo(1 / lp.L, -math.pi / 2)))[:, None]
    return D.width(D.reverb(lp, vocal_space(lp, x, 120), rng, 10.0, mix=0.62, damp=3500, predelay=0.09, width=1.3), 1.3)


def fx_rising_tide(lp, x, rng, f0):
    c = lp_curve(lp, 0.0, 1.0, 1, -math.pi / 2)
    x = D.sweep(lp, x, c, lambda f, k: D.lowpass(f, k, 1.0, 4), f0 * 1.5, f0 * 26) * (0.4 + 0.6 * c)[:, None]
    return D.width(D.reverb(lp, D.chorus(lp, x, rate=0.25, depth_ms=3, mix=0.35), rng, 5.0, mix=0.42, damp=5500), 1.4)


def fx_organ_pad(lp, x, rng, f0):
    x = D.rotary(lp, D.filt(x, D.lowpass(D.freqs(lp), 4200, 0.7, 2) * D.highpass(D.freqs(lp), 60, 0.7, 2)), rate=0.7, depth=0.3)
    return D.width(D.reverb(lp, x, rng, 4.5, mix=0.45, damp=4500, predelay=0.03, width=1.2), 1.2)


def fx_celtic_air(lp, x, rng, f0):
    x = D.filt(x, D.highpass(D.freqs(lp), 160, 0.7, 2))
    x = D.delay(lp, x, lp.L / 10, feedback=0.3, mix=0.2, tone=5000)
    return D.width(D.reverb(lp, x, rng, 5.5, mix=0.5, damp=6500, predelay=0.03, width=1.3), 1.3)


def fx_glacier(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.filt(x, D.highpass(f, 240, 0.7, 2) * D.lowpass(f, 7000, 0.7, 2) * D.peak(f, 3200, -3.0, 0.8))
    x = x * (0.55 + 0.45 * (0.5 + 0.5 * lp.lfo(1 / lp.L, math.pi)))[:, None]
    return D.width(D.shimmer(lp, x, rng, 12.0, mix=0.65, amount=0.45, octaves=2), 1.5)


def fx_soft_brass(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 2600, 0.7, 2))
    x = x * (0.5 + 0.5 * (0.5 + 0.5 * lp.lfo(1 / lp.L, -math.pi / 2)))[:, None]
    return D.width(D.reverb(lp, x, rng, 6.0, mix=0.5, damp=3200, predelay=0.04, width=1.3), 1.2)


def fx_night_sky(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 8500, 0.7, 2))
    x = D.delay(lp, x, lp.L / 12, feedback=0.4, mix=0.35, tone=6500)
    return D.width(D.reverb(lp, x, rng, 7.0, mix=0.55, damp=7000, bright=1.15, width=1.3), 1.5)


def fx_harvest(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 6000, 0.7, 2))
    return D.width(D.reverb(lp, D.delay(lp, x, lp.L / 16, feedback=0.3, mix=0.2, tone=5000), rng, 3.5, mix=0.4, damp=5000), 1.3)


def fx_heartstrings(lp, x, rng, f0):
    breath = (0.5 - 0.5 * np.cos(2 * math.pi * 2 * lp.t / lp.L)) ** 1.3
    x = D.sweep(lp, x, 0.2 + 0.75 * breath, lp4, f0 * 2, f0 * 20) * (0.45 + 0.55 * breath)[:, None]
    return D.width(D.reverb(lp, vocal_space(lp, x, 75), rng, 6.5, mix=0.5, damp=3800, predelay=0.04, width=1.3), 1.3)


def fx_fire(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.saturate(D.filt(x, D.lowpass(f, 3200, 0.8, 2) * D.highpass(f, 90, 0.7, 2)) / D.rms(x) * 0.45, 1.8)
    x = phaser(lp, x, rate=0.12, stages=6)
    x = D.filt(x, D.peak(f, 3000, -2.5, 0.8))
    return D.width(D.shimmer(lp, x, rng, 6.0, mix=0.45, amount=0.35, octaves=1), 1.4)


def fx_still_waters(lp, x, rng, f0):
    wave = (0.5 - 0.5 * np.cos(2 * math.pi * 2 * lp.t / lp.L)) ** 1.5
    x = D.sweep(lp, x, 0.25 + 0.6 * wave, lp4, f0 * 2, f0 * 18) * (0.55 + 0.45 * wave)[:, None]
    return D.width(D.reverb(lp, x, rng, 3.0, mix=0.4, damp=5500, predelay=0.015, bright=1.05), 1.3)


def fx_harmonium(lp, x, rng, f0):
    x = D.filt(x, D.lowpass(D.freqs(lp), 3600, 0.7, 2))
    x = D.tremolo(lp, x, 4.8, 0.26, math.pi / 3)
    x = x * (0.8 + 0.2 * (0.5 + 0.5 * lp.lfo(2 / lp.L, 1.0)))[:, None]   # (the bellows)
    return D.width(D.reverb(lp, x, rng, 1.8, mix=0.28, damp=4000, predelay=0.012, width=1.1), 0.9)


def fx_choir_strings(lp, x, rng, f0):
    x = vocal_space(lp, x, 100)
    return D.width(D.reverb(lp, x, rng, 6.0, mix=0.5, damp=4800, predelay=0.04, width=1.3), 1.3)


def fx_communion(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.filt(x, D.lowpass(f, 3000, 0.7, 2) * D.highpass(f, 70, 0.7, 2))
    x = x * (0.75 + 0.25 * (0.5 + 0.5 * lp.lfo(1 / lp.L, rng.uniform(0, 6.0))))[:, None]
    return D.width(D.reverb(lp, vocal_space(lp, x, 90), rng, 6.0, mix=0.5, damp=3200, predelay=0.04, width=1.2), 1.1)


def fx_tape_strings(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.saturate(D.filt(x, D.highpass(f, 120, 0.7, 2) * D.lowpass(f, 3400, 0.7, 2)) / D.rms(x) * 0.42, 2.0)
    x = D.chorus(lp, x, rate=0.28, depth_ms=5.5, base_ms=6, mix=0.5, voices=1)   # (the wow of a worn tape)
    hiss = np.stack([D.noise(lp, rng, "pink", 1200, 8000) for _ in (0, 1)], 1)
    x = x / D.rms(x) + 0.035 * hiss
    return D.width(D.reverb(lp, x, rng, 2.2, mix=0.28, damp=3000), 0.85)


def fx_kingdom(lp, x, rng, f0):
    x = D.sweep(lp, x, lp_curve(lp, 0.3, 0.9, 1, -math.pi / 2), lp4, f0 * 3, f0 * 34)
    x = D.chorus(lp, vocal_space(lp, x, 80), rate=0.1, depth_ms=3.0, mix=0.35, voices=3)
    return D.width(D.shimmer(lp, x, rng, 9.0, mix=0.5, amount=0.4, octaves=2), 1.5)


def fx_advent(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.filt(x, D.lowpass(f, 3500, 0.7, 2) * D.highpass(f, 50, 0.7, 2))
    return D.width(D.reverb(lp, x, rng, 7.0, mix=0.55, damp=2500, predelay=0.05, width=1.3), 1.2)


def fx_gospel_organ(lp, x, rng, f0):
    x = D.saturate(D.filt(x, D.lowpass(D.freqs(lp), 5000, 0.7, 2)) / D.rms(x) * 0.4, 1.4)
    x = D.rotary(lp, x, rate=5.8, depth=0.5)   # (the Leslie on fast)
    return D.width(D.reverb(lp, x, rng, 1.6, mix=0.25, damp=4500, predelay=0.012), 1.0)


def fx_rain(lp, x, rng, f0):
    f = D.freqs(lp)
    x = D.filt(x, D.lowpass(f, 2600, 0.7, 2) * D.highpass(f, 60, 0.7, 2))
    rain = np.stack([D.noise(lp, rng, "pink", 500, 9000) for _ in (0, 1)], 1)
    gust = 0.7 + 0.3 * (0.5 + 0.5 * lp.lfo(2 / lp.L, rng.uniform(0, 6.0))) + 0.08 * lp.drift(rng, 1.0)   # (the rain comes and goes)
    drops = np.zeros(lp.n)                                                                                # (a few bigger drops on the roof)
    for _ in range(int(lp.L * 6)):
        at = int(rng.uniform(0, lp.n)); m = min(lp.n - at, int(0.012 * lp.sr))
        drops[at:at + m] += np.exp(-np.arange(m) / (0.003 * lp.sr)) * rng.uniform(0.3, 1.0)
    rain = rain * np.clip(gust, 0.3, 1.2)[:, None] + np.stack([drops, np.roll(drops, 7)], 1) * rain
    x = x / D.rms(x) + 0.22 * rain / D.rms(rain)
    return D.width(D.reverb(lp, x, rng, 3.5, mix=0.4, damp=4000, predelay=0.02), 1.3)


MORE = {
    # worship beds
    "Sunday Shimmer": {"layers": [(("saws", {"n": 6, "detune": 14, "spread": 1.0}), 0, 0.9), (("sines", {"ratios": ((1, 1.0), (2, 0.3)), "spread": 1.0}), 1, 0.6), ("sub", -1, 0.25)], "fx": fx_sunday_shimmer, "chord": FIFTH},
    "Deep Worship": {"layers": [(("saws", {"n": 7, "detune": 18, "spread": 0.9}), 0, 1.0), (("saws", {"n": 3, "detune": 10, "spread": 0.5}), -1, 0.6), ("tri", 0, 0.4), ("sub", -1, 0.45)], "fx": fx_deep_worship, "chord": FIFTH},
    "Analog Strings": {"layers": [("stringmachine", 0, 1.0), ("stringmachine", 1, 0.4)], "fx": fx_analog_strings, "chord": FIFTH},
    "Glass Choir": {"layers": [(("choir", {"vowel": "o", "singers": 8, "vib_cents": 14}), 0, 1.0), ("glass", 1, 0.5)], "fx": fx_glass_choir, "chord": FIFTH},
    "Prayer Room": {"layers": [(F("piano", at=(0.2, 1.0), at2=(1.0, 2.4)), 0, 1.0), ("air", 1, 0.2), ("breathsines", 0, 0.22)], "fx": fx_prayer_room, "chord": FIFTH},
    "Cathedral Choir": {"layers": [(("choir", {"vowel": "a", "singers": 14, "vib_cents": 18}), 0, 1.0), (("choir", {"vowel": "u", "singers": 8, "vib_cents": 12}), -1, 0.5)], "fx": fx_cathedral_choir, "chord": FIFTH},
    "Rising Tide": {"layers": [(("pulse", {"n": 3, "detune": 9}), 0, 1.0), (("saws", {"n": 3, "detune": 7}), -1, 0.45)], "fx": fx_rising_tide, "chord": FIFTH},
    "Organ Pad": {"layers": [(("organ", {"bars": ((0.5, 0.25), (1, 1.0), (1.5, 0.45), (2, 0.7), (3, 0.22), (4, 0.3))}), 0, 1.0), ("breathsines", 0, 0.3)], "fx": fx_organ_pad, "chord": FIFTH},
    "Choir and Strings": {"layers": [(("choir", {"vowel": "a", "singers": 10}), 0, 0.9), (("strings", {"players": 12}), 0, 0.8), (("strings", {"players": 6, "low": True}), -1, 0.4)], "fx": fx_choir_strings, "chord": FIFTH},
    "Still Waters": {"layers": [(("sines", {"ratios": ((1, 1.0), (2, 0.4), (3, 0.15)), "spread": 1.0, "beat": 0.35}), 0, 1.0), ("air", 1, 0.2), ("tri", -1, 0.3)], "fx": fx_still_waters, "chord": (0, 7, 12, 14)},
    "Chapel Harmonium": {"layers": [("reed", 0, 1.0), (("organ", {"bars": ((1, 1.0), (2, 0.5))}), -1, 0.4)], "fx": fx_harmonium, "chord": FIFTH},
    "Pentecost Fire": {"layers": [(("saws", {"n": 7, "detune": 22, "spread": 1.0}), 0, 1.0), (("pulse", {"n": 2, "detune": 6}), 1, 0.25), ("sub", -1, 0.3)], "fx": fx_fire, "chord": FIFTH},
    "Night Sky": {"layers": [("twinkle", 1, 0.8), (("sines", {"ratios": ((1, 1.0), (2, 0.2))}), 0, 0.5), ("air", 1, 0.12)], "fx": fx_night_sky, "chord": (0, 7, 12, 14)},
    # made from recordings (CC0)
    "Celtic Air": {"layers": [("flutes", 1, 0.8), ("air", 1, 0.25), (("plucks", {"src": "harp", "every": 2.0}), 0, 0.6)], "fx": fx_celtic_air, "chord": (0, 7, 12, 14)},
    "Glacier": {"layers": [(G("violins", grain=0.5, density=28, region=(0.4, 2.8), rev=0.4), 1, 0.8), (F("violins", at=(0.5, 1.5), at2=(1.5, 2.8)), 0, 0.7)], "fx": fx_glacier, "chord": FIFTH},
    "Soft Brass": {"layers": [(G("horn", **SUS), 0, 1.0), (G("trombone", **SUS), -1, 0.6), (G("horn", **SUS), 1, 0.3)], "fx": fx_soft_brass, "chord": FIFTH},
    "Harvest": {"layers": [(("plucks", {"src": "marimba", "every": 0.7}), 0, 0.7), (("strings", {"players": 10}), 0, 0.8), ("felt", 1, 0.25)], "fx": fx_harvest, "chord": (0, 7, 12, 14)},
    "Heartstrings": {"layers": [(G("cellos", **SUS), -1, 0.75), (G("cellos", **SUS), 0, 0.6), (G("violas", **SUS), 0, 0.7), ("sub", -1, 0.15)], "fx": fx_heartstrings, "chord": FIFTH},
    # six more (10.5, the second round)
    "Communion": {"layers": [(("blooms", {"src": "piano", "every": 2.6}), 0, 0.8), (("choir", {"vowel": "m", "singers": 6, "vib_cents": 10, "breath": 0.03}), 0, 0.6), ("sub", -1, 0.15)], "fx": fx_communion, "chord": FIFTH},
    "Tape Strings": {"layers": [("stringmachine", 0, 1.0), ("stringmachine", -1, 0.4)], "fx": fx_tape_strings, "chord": FIFTH},
    "Kingdom Come": {"layers": [(("saws", {"n": 7, "detune": 20, "spread": 1.0}), 0, 1.0), (("choir", {"vowel": "a", "singers": 10}), 0, 0.5), (("strings", {"players": 12}), 1, 0.4), ("sub", -1, 0.4), ("air", 1, 0.15)], "fx": fx_kingdom, "chord": FIFTH},
    "Advent Waiting": {"layers": [(("plucks", {"src": "tubular", "every": 3.2}), -1, 0.7), (("sines", {"ratios": ((1, 1.0), (2, 0.3)), "spread": 1.0}), -1, 0.8), ("air", 0, 0.15)], "fx": fx_advent, "chord": FIFTH},
    "Gospel Organ": {"layers": [(("organ", {"bars": ((1, 1.0), (1.5, 0.7), (2, 0.8), (3, 0.5), (4, 0.6), (6, 0.3), (8, 0.4))}), 0, 1.0)], "fx": fx_gospel_organ, "chord": FIFTH},
    "Rain on the Roof": {"layers": [(("blooms", {"src": "piano", "every": 2.0}), 0, 0.6), (("saws", {"n": 3, "detune": 8, "spread": 0.6}), -1, 0.5), ("sub", -1, 0.2)], "fx": fx_rain, "chord": FIFTH},
}
STYLES.update(MORE)
MORE_NAMES = list(MORE)

# 10.5: more moving pads (their own loop set, in Central Pads More - Central Pads Extra's files stay as they were)
PULSES_MORE = [("Dotted Eighths", "Sunday Keys", "9009009009009009"), ("Sixteenth Shimmer", "Shimmer", "9595959595959595"),
               ("Slow Breath", "Air", "~1234567898765432"), ("Push and Pull", "Analog", "9009090090090900"),
               ("Quarter Swell", "Deep Worship", "~9631963196319631"), ("Half-Time Pulse", "Sunday Shimmer", "9000000090000000")]
