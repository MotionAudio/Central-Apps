#!/usr/bin/env python3
"""Central Pedal - the sound-design kit behind our pads and synths (10.2): make-pads.py, make-pad-loops.py and
make-synths.py build every sound from these pieces.

Everything here works on one loop of audio and keeps it a loop: oscillators run a whole number of cycles in it, every
wobble (vibrato, filter sweeps, tremolo, a rotary speaker) a whole number of times round it, and the filters, chorus,
delays and reverbs wrap round its end (circular), so the last sample runs straight into the first with no seam - the
reverb's tail is already "in" the start of the loop, the way it would be after a long held chord.

  Loop(seconds)                        a loop: its length, time axis and helpers (q: a frequency on whole cycles)
  saw / pulse / tri / sine / fm         band-limited oscillators with vibrato and pulse-width movement
  noise                                 noise of a colour, as a loop
  lowpass / highpass / bandpass / formant / tilt   filter shapes (zero-phase, applied in the frequency domain)
  filt(x, H) / sweep(x, curve, ...)     a fixed filter, or one that moves (a morph between fixed ones)
  chorus / ensemble / delay / reverb / shimmer / rotary / tremolo / autopan / width / saturate   effects
Needs numpy only. Deterministic for a given seed."""
import math

import numpy as np

SR = 32000


class Loop:
    """One loop of `seconds` at `sr`. Frequencies and wobbles are moved onto whole cycles of the loop (q)."""

    def __init__(self, seconds, sr=SR):
        self.sr = sr
        self.n = int(round(seconds * sr))
        self.L = self.n / sr
        self.t = np.arange(self.n) / sr

    def q(self, f):
        return max(1, round(f * self.L)) / self.L

    def lfo(self, rate, phase=0.0, shape="sine"):
        """-1..1, a whole number of cycles round the loop (at least one)."""
        r = self.q(rate)
        p = r * self.t + phase / (2 * math.pi)
        if shape == "tri":
            return 4 * np.abs((p + 0.25) % 1 - 0.5) - 1
        return np.sin(2 * math.pi * p)

    def drift(self, rng, depth=1.0, top=0.6):
        """A slow random wander (-depth..depth roughly), smooth and looping: random low frequencies only, up to `top` Hz."""
        spec = np.zeros(self.n // 2 + 1, complex)
        k = max(2, int(top * self.L))
        spec[1:k] = rng.normal(0, 1, k - 1) * np.exp(1j * rng.uniform(0, 2 * math.pi, k - 1)) / np.arange(1, k) ** 0.8
        x = np.fft.irfft(spec, self.n)
        return x / (np.max(np.abs(x)) or 1) * depth


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12.0)


# ---------------------------------------------------------------- oscillators
def _phase(lp, f, cents=None, phase=0.0):
    """The running phase (in cycles) of an oscillator at f with an optional pitch wobble in cents; the wobble is
    corrected so the loop still holds a whole number of cycles (no seam)."""
    f = lp.q(f)
    inst = np.full(lp.n, f) if cents is None else f * 2 ** (np.asarray(cents) / 1200.0)
    inst = inst * (f * lp.n / np.sum(inst))
    ph = phase + np.concatenate([[0.0], np.cumsum(inst[:-1])]) / lp.sr
    return ph, inst / lp.sr


def _blep(p, dt):
    """The polyBLEP correction for a saw's jump at phase 0 (p in 0..1, dt the phase step per sample)."""
    out = np.zeros_like(p)
    a = p < dt
    t = p[a] / dt[a]
    out[a] = t + t - t * t - 1
    b = p > 1 - dt
    t = (p[b] - 1) / dt[b]
    out[b] = t * t + t + t + 1
    return out


def saw(lp, f, cents=None, phase=0.0):
    ph, dt = _phase(lp, f, cents, phase)
    p = ph % 1.0
    return 2 * p - 1 - _blep(p, dt)


def pulse(lp, f, width=0.5, cents=None, phase=0.0):
    """A pulse wave; width may move (an array 0.05..0.95) - pulse-width modulation."""
    ph, dt = _phase(lp, f, cents, phase)
    p = ph % 1.0
    p2 = (ph - np.asarray(width)) % 1.0
    return (2 * p - 1 - _blep(p, dt)) - (2 * p2 - 1 - _blep(p2, dt))


def tri(lp, f, cents=None, phase=0.0):
    ph, _ = _phase(lp, f, cents, phase)
    return 4 * np.abs(ph % 1.0 - 0.5) - 1


def sine(lp, f, cents=None, phase=0.0):
    ph, _ = _phase(lp, f, cents, phase)
    return np.sin(2 * math.pi * ph)


def fm(lp, f, ratio, index, cents=None, phase=0.0, feedback=0.0):
    """A two-operator FM tone: a carrier at f, its modulator at f x ratio (both on whole cycles), index may move."""
    ph, _ = _phase(lp, f, cents, phase)
    fm_f = lp.q(f * ratio)
    pm, _ = _phase(lp, fm_f, cents)
    mod = np.sin(2 * math.pi * pm)
    if feedback:
        mod = np.sin(2 * math.pi * pm + feedback * mod)
    return np.sin(2 * math.pi * ph + np.asarray(index) * mod)


def additive(lp, parts):
    """[(freq, amp, phase)] as one exact loop (built on the loop's own frequency bins)."""
    spec = np.zeros(lp.n // 2 + 1, complex)
    for f, a, ph in parts:
        k = int(round(f * lp.L))
        if 0 < k < lp.n // 2:
            spec[k] += a * lp.n / 2 * complex(math.cos(ph - math.pi / 2), math.sin(ph - math.pi / 2))
    return np.fft.irfft(spec, lp.n)


def noise(lp, rng, color="white", lo=20.0, hi=None):
    """Noise as a loop: white, pink or brown, band-limited to lo..hi Hz."""
    f = np.fft.rfftfreq(lp.n, 1 / lp.sr)
    mag = np.ones_like(f)
    with np.errstate(divide="ignore"):
        if color == "pink":
            mag = 1 / np.sqrt(np.maximum(f, 1))
        elif color == "brown":
            mag = 1 / np.maximum(f, 1)
    mag = mag * highpass(f, lo, 0.7, 4)          # (gentle edges, not a brick wall: a wall rings and sounds boxed in)
    if hi:
        mag = mag * lowpass(f, hi, 0.7, 4)
    mag[0] = 0
    spec = mag * np.exp(1j * rng.uniform(0, 2 * math.pi, len(f)))
    x = np.fft.irfft(spec, lp.n)
    return x / (np.sqrt(np.mean(x ** 2)) or 1)


# ---------------------------------------------------------------- filter shapes (magnitude at frequency f)
def lowpass(f, fc, q=0.707, poles=2):
    r = f / fc
    return (1 / np.sqrt((1 - r * r) ** 2 + (r / q) ** 2)) ** (poles / 2)


def highpass(f, fc, q=0.707, poles=2):
    r = np.maximum(f, 1e-6) / fc
    return (r * r / np.sqrt((1 - r * r) ** 2 + (r / q) ** 2)) ** (poles / 2)


def bandpass(f, fc, q=1.0):
    r = np.maximum(f, 1e-6) / fc
    return (r / q) / np.sqrt((1 - r * r) ** 2 + (r / q) ** 2)


def peak(f, fc, gain_db, q=1.0):
    """A bell boost or cut (approximately)."""
    return 1 + (10 ** (gain_db / 20) - 1) * bandpass(f, fc, q) ** 2


def formant(f, peaks, floor=0.03):
    """A vowel: resonances [(centre Hz, bandwidth Hz, level)] over a small floor."""
    out = np.full_like(f, floor, dtype=float)
    for fc, bw, a in peaks:
        out = out + a / np.sqrt(1 + ((f - fc) / (bw / 2)) ** 2) ** 2
    return out


def tilt(f, db_per_oct, pivot=1000.0):
    return (np.maximum(f, 20) / pivot) ** (db_per_oct / 6.02)


VOWELS = {   # (centre Hz, bandwidth Hz, level): a mixed-voice choir's formants
    "a": [(730, 110, 1.0), (1150, 130, 0.55), (2650, 200, 0.22), (3400, 260, 0.1)],
    "o": [(520, 90, 1.0), (850, 110, 0.5), (2600, 220, 0.12), (3300, 260, 0.06)],
    "u": [(330, 70, 1.0), (780, 100, 0.3), (2250, 220, 0.06)],
    "e": [(500, 90, 1.0), (1850, 140, 0.45), (2600, 200, 0.22), (3300, 260, 0.08)],
    "i": [(290, 70, 1.0), (2250, 160, 0.35), (2950, 220, 0.25), (3600, 260, 0.1)],
    "m": [(250, 60, 1.0), (1100, 300, 0.04), (2300, 300, 0.03)],   # a closed-mouth hum
}


def freqs(lp):
    return np.fft.rfftfreq(lp.n, 1 / lp.sr)


def filt(x, H):
    """A fixed filter on a loop (mono or stereo), applied round the loop (no seam, no delay)."""
    X = np.fft.rfft(x, axis=0)
    if X.ndim == 2:
        H = H[:, None]
    return np.fft.irfft(X * H, len(x), axis=0)


def sweep(lp, x, curve, shape, lo, hi, steps=12):
    """A filter that moves: `shape(f, cutoff)` at a cutoff following `curve` (0..1 -> lo..hi Hz, on a log scale), made
    as a morph between `steps` fixed filters - smooth, and still a loop when the curve is."""
    f = freqs(lp)
    cuts = np.geomspace(lo, hi, steps)
    X = np.fft.rfft(x, axis=0)
    pos = np.clip(np.asarray(curve), 0, 1) * (steps - 1)
    i0 = np.minimum(np.floor(pos).astype(int), steps - 2)
    w = pos - i0
    out = np.zeros_like(x)
    for k, c in enumerate(cuts):
        H = shape(f, c)
        y = np.fft.irfft(X * (H[:, None] if X.ndim == 2 else H), len(x), axis=0)
        g = np.where(i0 == k, 1 - w, 0) + np.where(i0 == k - 1, w, 0)
        out += y * (g[:, None] if x.ndim == 2 else g)
    return out


# ---------------------------------------------------------------- effects (all wrap round the loop)
def _read(x, pos):
    """x read at fractional positions, wrapping round (linear interpolation)."""
    n = len(x)
    i = np.floor(pos).astype(int)
    fr = pos - i
    return x[i % n] * (1 - fr) + x[(i + 1) % n] * fr


def stereo(x):
    return np.stack([x, x], 1) if x.ndim == 1 else x


def chorus(lp, x, rate=0.5, depth_ms=3.0, base_ms=12.0, mix=0.5, voices=2):
    """A stereo chorus: `voices` delayed copies per side, their delays wobbling (left and right apart)."""
    x = stereo(x)
    n = lp.n
    idx = np.arange(n)
    out = x * (1 - mix * 0.5)
    for side in (0, 1):
        src = x[:, side]
        for v in range(voices):
            ph = 2 * math.pi * (v / voices + side * 0.25)
            d = (base_ms + depth_ms * (1 + lp.lfo(rate * (1 + 0.13 * v), ph)) / 2) * lp.sr / 1000
            out[:, side] += mix / voices * _read(src, idx - d)
    return out


def ensemble(lp, x, mix=0.6):
    """The string-machine ensemble: three choruses at once, a slow one and a fast shimmer (a thick, moving sound)."""
    x = stereo(x)
    a = chorus(lp, x, rate=0.6, depth_ms=4.5, base_ms=9, mix=mix, voices=3)
    b = chorus(lp, x, rate=5.5, depth_ms=0.5, base_ms=6, mix=mix * 0.5, voices=3)
    return (a + b) * 0.6


def delay(lp, x, seconds, feedback=0.35, mix=0.25, pingpong=True, tone=5000.0, taps=8):
    """Echoes round the loop, each a little darker; ping-pong bounces them left, right, left..."""
    x = stereo(x)
    d = int(round(seconds * lp.sr))
    H = lowpass(freqs(lp), tone, 0.6, 2)
    wet = np.zeros_like(x)
    cur = x.mean(1) if pingpong else x
    for k in range(1, taps + 1):
        cur = filt(np.roll(cur, d, axis=0), H)
        g = feedback ** (k - 1)
        if pingpong:
            wet[:, (k - 1) % 2] += g * cur
        else:
            wet += g * cur
    return x + mix * wet


def reverb_ir(lp, rng, seconds, damp=6000.0, predelay=0.02, early=0.5, bright=1.0, width=1.0):
    """A stereo reverb's impulse response: decaying noise whose highs die faster than its lows (damp: the frequency
    where the decay is twice as quick), a few early reflections, a gap before it (predelay)."""
    m = min(lp.n - 1, int(seconds * 1.15 * lp.sr))
    f = np.fft.rfftfreq(m, 1 / lp.sr)
    t = np.arange(m) / lp.sr
    ir = np.zeros((lp.n, 2))
    for side in (0, 1):
        # bands decaying at their own rates: an RT60 per band, shorter for the highs
        y = np.zeros(m)
        nz = np.fft.rfft(rng.normal(0, 1, m))
        edges = [0, 250, 700, 1800, 4000, 8000, lp.sr / 2 + 1]
        for lo, hi in zip(edges[:-1], edges[1:]):
            mid = math.sqrt(max(lo, 60) * hi)
            rt = seconds / (1 + (mid / damp) ** 1.4)
            band = np.fft.irfft(nz * ((f >= lo) & (f < hi)), m)
            y += band * np.exp(-6.9 * t / rt) * (bright if mid > 3000 else 1.0)
        fade = np.clip((t - 0.0) / 0.03, 0, 1)   # (a soft onset: the diffuse tail grows in)
        y *= fade
        er = np.zeros(m)
        for _ in range(10):   # early reflections
            at = int(rng.uniform(0.004, 0.07) * lp.sr)
            er[at] += rng.uniform(-1, 1) * early
        y = y / (np.sqrt(np.sum(y ** 2)) or 1) + er / (np.sqrt(np.sum(er ** 2)) or 1) * early * 0.5
        p = int(predelay * lp.sr)
        ir[p:p + m, side] = y[:lp.n - p]
    mid, side = ir.mean(1), (ir[:, 0] - ir[:, 1]) / 2
    ir = np.stack([mid + width * side, mid - width * side], 1)
    return ir / (np.sqrt(np.sum(ir ** 2) / 2) or 1)


def reverb(lp, x, rng, seconds=3.0, mix=0.35, **kw):
    """x through a reverb that wraps round the loop (the tail of the end is in the start)."""
    x = stereo(x)
    ir = reverb_ir(lp, rng, seconds, **kw)
    X = np.fft.rfft(x.mean(1))
    wet = np.stack([np.fft.irfft(X * np.fft.rfft(ir[:, s]), lp.n) for s in (0, 1)], 1)
    wet *= (np.sqrt(np.mean(x ** 2)) / (np.sqrt(np.mean(wet ** 2)) or 1))
    return x * math.sqrt(1 - mix) + wet * math.sqrt(mix)


def octave_up(x):
    """Exactly an octave up, still the same loop: every other sample, twice round."""
    n = len(x)
    y = x[0::2]
    return np.concatenate([y, y], axis=0)[:n] if len(y) * 2 >= n else np.concatenate([y, y, y[:n - 2 * len(y)]], axis=0)


def shimmer(lp, x, rng, seconds=6.0, mix=0.5, amount=0.5, octaves=2):
    """The shimmer reverb: the reverb's tail shifted up an octave and fed back in - a halo of high octaves."""
    x = stereo(x)
    wet = reverb(lp, x, rng, seconds, mix=1.0, damp=7000, predelay=0.03)
    halo = np.zeros_like(x)
    cur = wet
    for k in range(octaves):
        cur = reverb(lp, filt(octave_up(cur), highpass(freqs(lp), 500, 0.7, 2)), rng, seconds, mix=1.0, damp=9000, width=1.2)
        halo += cur * (amount ** (k + 1))
    wet = wet + halo
    wet *= np.sqrt(np.mean(x ** 2)) / (np.sqrt(np.mean(wet ** 2)) or 1)
    return x * math.sqrt(1 - mix) + wet * math.sqrt(mix)


def rotary(lp, x, rate=0.8, depth=0.35):
    """A rotary speaker (slow chorale): the horn's swirl - pitch wobble, level and side to side, left and right apart."""
    x = x.mean(1) if x.ndim == 2 else x
    idx = np.arange(lp.n)
    out = np.zeros((lp.n, 2))
    for side, ph in ((0, 0.0), (1, math.pi / 2)):
        l = lp.lfo(rate, ph)
        d = (1.2 + 0.9 * l) * lp.sr / 1000
        out[:, side] = _read(x, idx - d) * (1 - depth / 2 + depth / 2 * lp.lfo(rate, ph + 0.6))
    return out


def tremolo(lp, x, rate, depth, stereo_phase=0.0):
    x = stereo(x)
    g = np.stack([1 - depth / 2 + depth / 2 * lp.lfo(rate, 0), 1 - depth / 2 + depth / 2 * lp.lfo(rate, stereo_phase)], 1)
    return x * g


def autopan(lp, x, rate, depth):
    x = stereo(x)
    p = depth * lp.lfo(rate)
    return np.stack([x[:, 0] * np.sqrt((1 - p) / 2) * math.sqrt(2), x[:, 1] * np.sqrt((1 + p) / 2) * math.sqrt(2)], 1)


def width(x, amount):
    """Mid/side: 0 = mono, 1 = as it is, >1 wider."""
    x = stereo(x)
    m, s = x.mean(1), (x[:, 0] - x[:, 1]) / 2
    return np.stack([m + amount * s, m - amount * s], 1)


def pan(x, p):
    """A mono signal placed at p (-1 left .. 1 right), equal power."""
    a = (p + 1) * math.pi / 4
    return np.stack([x * math.cos(a), x * math.sin(a)], 1)


def saturate(x, drive=1.5):
    return np.tanh(x * drive) / math.tanh(drive)


def rms(x):
    return float(np.sqrt(np.mean(np.asarray(x) ** 2))) or 1.0


def to_rms(x, level=0.2):
    return x / rms(x) * level


def head_phase(lp, f, cents_loop, cents_head, phase=0.0):
    """The phase of an oscillator over an opening (before the loop) and the loop: the loop exactly periodic, the opening
    running into it with its own pitch movement (a scoop, vibrato coming in), in cycles. -> (phase, step) for both."""
    ph, dt = _phase(lp, f, cents_loop, phase)
    fq = lp.q(f)
    inst = fq * 2 ** (np.asarray(cents_head) / 1200.0) / lp.sr
    back = np.cumsum(inst[::-1])[::-1]          # (from each opening sample to the loop's start)
    return np.concatenate([ph[0] - back, ph]), np.concatenate([inst, dt])


def wave_of(kind, ph, dt, width=0.5):
    p = ph % 1.0
    if kind == "saw":
        return 2 * p - 1 - _blep(p, dt)
    if kind == "pulse":
        p2 = (ph - width) % 1.0
        return (2 * p - 1 - _blep(p, dt)) - (2 * p2 - 1 - _blep(p2, dt))
    if kind == "tri":
        return 4 * np.abs(p - 0.5) - 1
    return np.sin(2 * math.pi * ph)


def ffilt(x, H_fn, sr=SR, pad=0.25):
    """A fixed filter on a sound that isn't a loop (zero-padded so nothing wraps round)."""
    n = len(x)
    m = n + int(pad * sr)
    f = np.fft.rfftfreq(m, 1 / sr)
    X = np.fft.rfft(x, m, axis=0)
    H = H_fn(f)
    return np.fft.irfft(X * (H[:, None] if X.ndim == 2 else H), m, axis=0)[:n]


def fsweep(x, cut, shape, lo, hi, sr=SR, steps=14):
    """A moving filter on a sound that isn't a loop: `cut` (per sample, 0..1 -> lo..hi on a log scale)."""
    cuts = np.geomspace(lo, hi, steps)
    pos = np.clip(np.asarray(cut), 0, 1) * (steps - 1)
    i0 = np.minimum(np.floor(pos).astype(int), steps - 2)
    w = pos - i0
    out = np.zeros_like(x)
    for k, c in enumerate(cuts):
        g = np.where(i0 == k, 1 - w, 0) + np.where(i0 == k - 1, w, 0)
        if not np.any(g):
            continue
        y = ffilt(x, lambda f: shape(f, c), sr)
        out += y * (g[:, None] if x.ndim == 2 else g)
    return out


def splice(head, loop, xfade):
    """An opening flowing into its loop: the opening's last `xfade` samples cross into the loop's own end (which leads
    straight into the loop's start), so there is no step where the loop begins."""
    a = len(head)
    k = min(xfade, a)
    if k:
        tail = loop[np.arange(-k, 0) % len(loop)]
        w = np.linspace(0, 1, k)
        if head.ndim == 2:
            w = w[:, None]
        head = head.copy()
        head[a - k:] = head[a - k:] * (1 - w) + tail * w
    return np.concatenate([head, loop])
