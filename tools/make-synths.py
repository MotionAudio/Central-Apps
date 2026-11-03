#!/usr/bin/env python3
"""Central Pedal - Central Keys Synths: ten synth sounds for the keys rig, synthesised here (no one else's recording, so
they're ours to sell with Central Keys). 10.2: each one built its own way, so none sounds like another:

  Saw Lead        two saws, a bright resonant filter, vibrato that comes in after the note starts
  Square Lead     a hollow square with a square an octave below, a quick scoop up into the note, narrow and centred
  Soft Lead       a flute: a soft sine voice with breath tuned to it, a chiff of air at the start, a singing vibrato
  Synth Brass     a saw section whose filter blares open and settles, with a brassy formant and a scoop up
  Super Saw       seven saws spread wide across the stereo field, bright, the lows cleared out
  String Machine  a mellow string-machine tone through the ensemble chorus (three choruses at once), wide
  Sub Bass        a pure sine with a hint of its octave: felt more than heard
  Synth Bass      a saw and square through a resonant filter that snaps shut (a squelch), then holds
  Pluck           a plucked string (Karplus-Strong): bright, then mellowing, left and right slightly apart
  Electric Bells  an FM bell (a modulator at 3.5 times the note), its brightness dying away first

Held sounds (the leads, brass, super saw, string machine, sub bass) start with an opening and then hold a seamless loop
(every cycle and every wobble whole in it). Struck ones (synth bass, pluck, bells) are one-shots that die away.

    python3 tools/make-synths.py <out folder>
Writes "<out>/Central Keys Synths - central-keys-synths.sf2". Needs python3-numpy. Deterministic: the same file every
build. (A file already there is kept.)"""
import importlib.util
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pad_dsp as D  # noqa: E402

_s = importlib.util.spec_from_file_location("sounds_vsco", os.path.join(os.path.dirname(HERE), "sounds-vsco.py"))
V = importlib.util.module_from_spec(_s)
_s.loader.exec_module(V)
_s2 = importlib.util.spec_from_file_location("sounds_vcsl", os.path.join(HERE, "sounds-vcsl.py"))
VC = importlib.util.module_from_spec(_s2)
_s2.loader.exec_module(VC)

SR = D.SR
LOOP = 4.0                       # seconds: a held note's loop
ONE_SHOT = 2.6                   # seconds: a struck note
ROOTS = list(range(24, 103, 6))  # a sample every half octave, C1..F#7
NAME = "Central Keys Synths"
FILE = "%s - %s.sf2" % (NAME, NAME.lower().replace(" ", "-"))


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12.0)


def q(f):
    return max(1, round(f * LOOP)) / LOOP


# ---------------------------------------------------------------- held sounds: an opening, then a loop
def _osc(lp, kind, f, cents_loop, cents_head, phase=0.0, width=0.5):
    ph, dt = D.head_phase(lp, f, cents_loop, cents_head, phase)
    return D.wave_of(kind, ph, dt, width)


def held_sample(kind, note, seed):
    """One held note: stereo float32 (frames x 2) and its loop (start, end) - the opening first, then the loop."""
    rng = np.random.default_rng(seed + note * 31)
    lp = D.Loop(LOOP)
    f0 = hz(note)
    n = lp.n
    A = int((0.45 if kind in ("saw", "brass", "soft") else 0.25) * SR)
    th = np.arange(A) / SR                  # (time in the opening)
    vib = lambda rate, depth, ph=0.0: depth * lp.lfo(rate, ph)
    fl = D.freqs(lp)

    def both(sig):   # (a sound over the opening and the loop: split)
        return sig[:A], sig[A:]

    if kind == "saw":            # two saws, bright resonant filter, vibrato fading in over the opening
        out = np.zeros((A + n, 2))
        for i, c in enumerate((-5.0, 5.0)):
            ph0 = rng.uniform(0, 1)
            vl = c + vib(5.5, 16, i * 0.4)
            vh = c + 16 * np.clip((th - 0.15) / 0.3, 0, 1) * np.sin(2 * math.pi * lp.q(5.5) * (th - th[-1] - 1 / SR) + i * 0.4)
            out[:, i] = _osc(lp, "saw", f0, vl, vh, ph0)
        shape = lambda f, k: D.lowpass(f, k, 1.8, 2)
        head, loop = both(out)
        loop = D.filt(loop, shape(fl, min(f0 * 10, 9000)))
        head = D.ffilt(head, lambda f: shape(f, min(f0 * 10, 9000)))
        x = D.splice(head, D.width(loop, 0.35), int(0.03 * SR))
        x[:A] = D.width(x[:A], 0.35)
    elif kind == "square":       # a hollow square and its octave below, a quick scoop up into the note
        scoop = -40 * np.exp(-th / 0.05)
        a = _osc(lp, "pulse", f0, vib(6.0, 8), scoop, rng.uniform(0, 1))
        b = _osc(lp, "pulse", f0 / 2, vib(6.0, 8), scoop, rng.uniform(0, 1))
        m = a + 0.45 * b
        head, loop = m[:A], m[A:]
        shape = lambda f: D.lowpass(f, min(f0 * 6, 7000), 0.8, 4)
        x = D.stereo(D.splice(D.ffilt(head, shape), D.filt(loop, shape(fl)), int(0.03 * SR)))
    elif kind == "soft":         # a flute: sine voice, breath tuned to it, a chiff of air, a singing vibrato
        vl = vib(5.0, 20)
        vh = 20 * np.clip((th - 0.1) / 0.3, 0, 1) * np.sin(2 * math.pi * lp.q(5.0) * (th - th[-1] - 1 / SR))
        tone = sum(a * _osc(lp, "sine", f0 * k, vl, vh, rng.uniform(0, 1)) for k, a in ((1, 1.0), (2, 0.22), (3, 0.08)) if f0 * k < 0.42 * SR)
        comb = np.zeros_like(fl)
        for k in (1, 2, 3, 4):
            comb += (1 / k) / (1 + ((fl - f0 * k) / (8 + f0 * k * 0.01)) ** 2)
        breath = D.filt(D.noise(lp, rng, "white"), comb * D.highpass(fl, 300, 0.7, 2))
        breath_loop = breath / D.rms(breath) * 0.18
        head_noise = np.random.default_rng(seed).normal(0, 1, A)
        chiff = D.ffilt(head_noise, lambda f: D.bandpass(f, min(f0 * 4, 8000), 1.2)) * np.exp(-th / 0.04) * 0.9
        head = tone[:A] + breath_loop[np.arange(-A, 0) % n] + chiff
        x = D.stereo(D.splice(head, tone[A:] + breath_loop, int(0.03 * SR)))
    elif kind == "brass":        # a saw section: filter blares open and settles, brassy formant, a scoop up
        out = np.zeros((A + n, 2))
        for i, c in enumerate((-7.0, 0.0, 7.0)):
            vl = c + vib(4.8, 7, i)
            vh = c - 30 * np.exp(-th / 0.06)
            out += D.pan(_osc(lp, "saw", f0, vl, vh, rng.uniform(0, 1)), (i - 1) * 0.5)
        settle = 0.55
        env = np.where(th < 0.06, 0.2 + 0.8 * th / 0.06, settle + (1 - settle) * np.exp(-(th - 0.06) / 0.12))   # (blares open, settles)
        shape = lambda f, k: D.lowpass(f, k, 1.1, 4) * D.peak(f, 1200, 5, 1.2)
        lo, hi = f0 * 1.5, min(f0 * 22, 12000)
        head = D.fsweep(out[:A], env, shape, lo, hi)
        k_hold = lo * (hi / lo) ** settle
        loop = D.filt(out[A:], shape(fl, k_hold))
        x = D.splice(head, loop, int(0.03 * SR))
    elif kind == "supersaw":     # seven saws spread wide, bright, the lows cleared
        out = np.zeros((A + n, 2))
        cents = (-26, -16, -8, 0, 8, 16, 26)
        for i, c in enumerate(cents):
            dr = lp.drift(rng, 2.0)
            out += D.pan(_osc(lp, "saw", f0, c + dr, np.full(A, c + dr[0]), rng.uniform(0, 1)), (i / 3 - 1) * 0.95)
        shape = lambda f: D.highpass(f, 160, 0.7, 2) * D.lowpass(f, min(f0 * 30, 12000), 0.7, 2)
        loop = D.chorus(lp, D.filt(out[A:], shape(fl)), rate=0.4, depth_ms=2.0, base_ms=8, mix=0.3)
        x = D.splice(D.ffilt(out[:A], shape), loop, int(0.05 * SR))
    elif kind == "strings":      # a mellow string machine through the ensemble
        out = np.zeros(A + n)
        for c in (-4.0, 4.0):
            out += _osc(lp, "saw", f0, c + vib(0.3, 3), np.full(A, c), rng.uniform(0, 1))
        out += 0.4 * _osc(lp, "pulse", f0 * 2, vib(0.3, 3), np.zeros(A), rng.uniform(0, 1), 0.3)
        shape = lambda f: D.lowpass(f, min(f0 * 5, 5000), 0.7, 2) * D.highpass(f, 120, 0.7, 2)
        loop = D.ensemble(lp, D.filt(out[A:], shape(fl)), mix=0.8)
        head = D.stereo(D.ffilt(out[:A], shape))
        x = D.splice(head, loop, int(0.12 * SR))
    elif kind == "sub":          # a sine with a little of its octave
        m = _osc(lp, "sine", f0, None, np.zeros(A)) + 0.15 * _osc(lp, "sine", f0 * 2, None, np.zeros(A))
        x = D.stereo(m)
    else:
        raise ValueError(kind)
    loop = x[A:]
    x = x / D.rms(loop) * 0.2
    return x.astype(np.float32), A, A + n


def held(kind, note, seed):
    """The held loop alone, mono (its middle): what repeats while a key is held."""
    x, s, e = held_sample(kind, note, seed)
    return x[s:e].mean(1).astype(np.float32)


# ---------------------------------------------------------------- struck sounds: one-shots that die away
def struck_stereo(kind, note, seed):
    rng = np.random.default_rng(seed + note * 17)
    f0 = hz(note)
    n = int(ONE_SHOT * SR)
    t = np.arange(n) / SR
    if kind == "bells":          # FM: a modulator at 3.5x (inharmonic), its index dying away; a soft 1:1 pair for body
        out = np.zeros((n, 2))
        mph = rng.uniform(0, 6.28)
        for side in (0, 1):
            fc = f0 * (1 + (side - 0.5) * 0.0012)
            idx = 0.4 + 3.6 * np.exp(-t / 0.35)
            x = np.sin(2 * math.pi * fc * t + idx * np.sin(2 * math.pi * fc * 3.5 * t + mph))
            body = np.sin(2 * math.pi * fc * t + 0.8 * np.exp(-t / 0.8) * np.sin(2 * math.pi * fc * t))
            out[:, side] = (0.75 * x * np.exp(-t / 1.4) + 0.5 * body * np.exp(-t / 2.2))
        if f0 * 3.5 * 5 > 0.45 * SR:   # (very high notes: the FM sidebands would fold over - a simpler tone)
            out = np.stack([np.sin(2 * math.pi * f0 * t) * np.exp(-t / 1.6)] * 2, 1)
    elif kind == "pluck":        # Karplus-Strong: a burst of noise round a delay line the length of one cycle, damped
        out = np.zeros((n, 2))
        pick = rng.uniform(-1, 1, int(SR / f0) + 4)
        for side in (0, 1):
            period = SR / (f0 * (1 + (side - 0.5) * 0.002))
            p = int(period)
            frac = period - p
            buf = pick[:p + 2] * (1.0 if side == 0 else 0.85) + (0 if side == 0 else 0.15 * rng.uniform(-1, 1, p + 2))
            buf = np.convolve(buf, [0.3, 0.4, 0.3], "same")          # (a slightly soft pick)
            y = np.zeros(n + p + 2)
            y[2:p + 2] = buf[:p]
            damp = 0.5 * (0.996 ** (440.0 / max(f0, 55.0)) if f0 < 880 else 0.993)
            i = p + 2
            while i < len(y):   # (a period at a time: each sample needs only the ones a period or more before it)
                j = min(len(y), i + p)
                k = np.arange(i, j)
                a = y[k - p] * (1 - frac) + y[k - p - 1] * frac
                b = y[k - p - 1] * (1 - frac) + y[k - p - 2] * frac
                y[i:j] = damp * (a + b)
                i = j
            out[:, side] = y[2:n + 2]
        out = D.ffilt(out, lambda f: D.highpass(f, 40, 0.7, 2))
    else:                        # synth bass: saw + square an octave down, a resonant filter snapping shut, then holding
        a = 2 * ((f0 * t + rng.uniform(0, 1)) % 1) - 1
        b = np.sign(np.sin(2 * math.pi * f0 / 2 * t))
        raw = a + 0.5 * b
        env = np.exp(-t / 0.18)
        out = D.fsweep(raw, 0.15 + 0.85 * env, lambda f, k: D.lowpass(f, k, 3.0, 4), f0 * 1.2, min(f0 * 24, 12000))
        out = np.tanh(out * 1.5) * np.exp(-t / 2.4)
        out = D.stereo(out)
    out[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))[:, None]
    fade = int(0.05 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return (out / (np.max(np.abs(out)) or 1.0) * 0.7).astype(np.float32)


def struck(kind, note, seed):
    """A struck note, mono (its middle) - for the ambient loops and the checks."""
    x = struck_stereo(kind, note, seed).mean(1)
    return (x / (np.max(np.abs(x)) or 1.0) * 0.7).astype(np.float32)


# name, kind, held?, attack, release
SOUNDS = [
    ("Saw Lead", "saw", True, 0.005, 0.4), ("Square Lead", "square", True, 0.005, 0.3), ("Soft Lead", "soft", True, 0.03, 0.5),
    ("Synth Brass", "brass", True, 0.01, 0.4), ("Super Saw", "supersaw", True, 0.02, 0.8), ("String Machine", "strings", True, 0.35, 1.6),
    ("Sub Bass", "sub", True, 0.005, 0.15), ("Synth Bass", "bass", False, 0.001, 0.2), ("Pluck", "pluck", False, 0.001, 0.4),
    ("Electric Bells", "bells", False, 0.001, 1.2),
]
STEREO = {"saw", "brass", "supersaw", "strings", "pluck", "bells"}   # (the ones whose width is part of the sound)


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
                x, s, e = held_sample(kind, note, seed + prog * 101)
                x = np.concatenate([x, x[s:s + 32]])   # (after the loop's end: its start again, for the interpolation)
            else:
                x = struck_stereo(kind, note, seed + prog * 101)
                s = e = None
            chans = ((0, -500), (1, 500)) if kind in STEREO else ((None, 0),)
            for side, pan in chans:
                ch = x.mean(1) if side is None else x[:, side]
                pcm = np.clip(np.round(ch * 32767), -32768, 32767).astype("<i2")
                samples.append({"name": "%s%d%s_%d" % (kind[:6], note, "" if side is None else "LR"[side], len(samples)), "pcm": pcm, "sr": SR, "root": note, "s": s, "e": e})
                gens = [("keyRange", ranges[note])] + ([("pan", pan)] if pan else []) + [("attackVolEnv", V.tc(att)), ("releaseVolEnv", V.tc(rel)), ("reverbEffectsSend", 80), ("overridingRootKey", note)]
                if is_held:
                    gens.append(("sampleModes", 1))
                gens.append(("sampleID", len(samples) - 1))
                zones.append(gens)
        instruments.append({"name": kind, "zones": zones})
        presets.append({"name": pname, "prog": prog, "zones": [[("keyRange", (0, 127)), ("instrument", len(instruments) - 1)]]})
    os.makedirs(out_dir, exist_ok=True)
    V.write_sf2(out, NAME, samples, instruments, presets, copyright="Motion Audio (synthesised - sold with Central Keys)",
                comment="Made by tools/make-synths.py: seamless loops and one-shots, no recordings.")
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
