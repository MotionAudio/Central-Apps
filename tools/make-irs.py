#!/usr/bin/env python3
"""Central Pedal - makes the impulse responses of the Central Pedals sound library: guitar and bass cabinets and
acoustic guitar bodies, for the IR loader pedal ("IR loader: cab / acoustic body"). They are synthesised here from
filter and resonance models (no recording, no one else's IR), so they are ours to sell - license: the same as the app.

Cabinets: a speaker's response drawn as a curve (the low resonance, the cone's break-up, the high roll-off, the box)
made into a minimum-phase impulse (cepstrum), with a little seeded cone ripple so it doesn't sound like a plain EQ.
Acoustic bodies: the air, top and back modes of a body as decaying resonances, over a short broadband start.

Every IR is mono, 48 kHz, 24-bit, 2048 samples (43 ms): the Pi's convolver loads any length, and the computers' built-in
rig (cu-rig) keeps up to 4096 samples - so the same file works everywhere. Deterministic (same file every build).

    python3 tools/make-irs.py <out folder>        writes "<name>.wav" for every IR below and prints the list"""
import math
import os
import struct
import sys

import numpy as np

SR = 48000
N = 2048
FFT = 16384

# cabinets: name -> curve parts. hp: (Hz, Q) low cut, res: (Hz, dB, Q) speaker resonance, peaks: [(Hz, dB, Q)],
# lp: (Hz, order) high roll-off, ripple: dB of cone ripple above 1.5 kHz, seed, room: an early reflection (ms, level)
CABS = [
    ("Central 1x12 Open Back", dict(hp=(75, 0.7), res=(105, 4, 1.4), peaks=[(450, -2.5, 1.0), (2400, 3.5, 1.3), (4100, 2, 2.0)], lp=(6200, 4), ripple=1.6, seed=11, room=(1.6, 0.18))),
    ("Central 2x12 Closed Back", dict(hp=(85, 0.8), res=(118, 5, 1.6), peaks=[(400, -3, 1.0), (1700, 1.5, 1.2), (2900, 4, 1.4)], lp=(5600, 4), ripple=1.8, seed=12, room=(0.9, 0.08))),
    ("Central 2x12 Worship Smooth", dict(hp=(80, 0.7), res=(110, 4, 1.4), peaks=[(500, -2, 0.9), (2200, 2, 1.0), (3800, -2, 1.5)], lp=(5000, 4), ripple=1.0, seed=13, room=(1.2, 0.12))),
    ("Central 4x12 Vintage", dict(hp=(90, 0.8), res=(110, 5.5, 1.8), peaks=[(800, 2, 0.9), (1600, 3, 1.4), (3000, 4.5, 1.6)], lp=(5400, 6), ripple=2.2, seed=14, room=(0.7, 0.06))),
    ("Central 4x12 Modern Tight", dict(hp=(95, 1.0), res=(95, 4, 2.0), peaks=[(550, -4, 0.8), (2600, 3, 1.2), (4600, 2.5, 2.0)], lp=(6000, 6), ripple=1.6, seed=15, room=(0.6, 0.05))),
    ("Central 1x10 Small Combo", dict(hp=(120, 0.9), res=(160, 3, 1.5), peaks=[(900, 3, 1.0), (2000, 2.5, 1.5)], lp=(4800, 4), ripple=2.4, seed=16, room=(1.0, 0.2))),
    ("Central 2x10 Tweed", dict(hp=(100, 0.8), res=(130, 3.5, 1.4), peaks=[(700, 1.5, 0.9), (2300, 4, 1.2), (3600, 1.5, 2.0)], lp=(5800, 4), ripple=2.0, seed=17, room=(1.4, 0.16))),
    ("Central Bass 4x10", dict(hp=(45, 0.8), res=(70, 4, 1.4), peaks=[(400, -3, 0.9), (1200, 2, 1.1), (2800, 3, 1.5)], lp=(4500, 4), ripple=1.5, seed=21, room=(0.8, 0.06))),
    ("Central Bass 1x15", dict(hp=(38, 0.8), res=(55, 5, 1.3), peaks=[(300, -2, 0.9), (900, 1, 1.0)], lp=(2600, 4), ripple=1.2, seed=22, room=(0.9, 0.06))),
    ("Central Bass 8x10", dict(hp=(42, 0.8), res=(65, 5, 1.2), peaks=[(250, 2, 1.0), (600, -2, 1.0), (1800, 2, 1.2)], lp=(3800, 6), ripple=1.6, seed=23, room=(0.7, 0.05))),
]


def _variants(cabs):
    """Two more microphone placements of every guitar cabinet: "Edge" (off the cone's centre - darker, softer
    presence) and "Room" (a step back - the room's first reflections)."""
    out = []
    for name, s in cabs:
        if "Bass" in name:
            continue
        edge = dict(s, lp=(s["lp"][0] * 0.78, s["lp"][1]), peaks=[(f, db - 2.0 if f > 1500 else db, qq) for f, db, qq in s["peaks"]], seed=s["seed"] + 100, room=s.get("room"))
        room = dict(s, lp=(s["lp"][0] * 0.9, s["lp"][1]), seed=s["seed"] + 200, room=None, rooms=[(2.8, 0.28), (5.6, 0.18), (9.1, 0.11), (14.3, 0.06)])
        out += [(name + " Edge", edge), (name + " Room", room)]
    return out


CABS = CABS + _variants(CABS)

# acoustic bodies (for a piezo pickup: puts the wood and air back): modes (Hz, dB, decay ms), brightness, seed
BODIES = [
    ("Central Acoustic Dreadnought Body", dict(modes=[(98, 9, 38), (196, 7, 26), (230, 4, 22), (395, 3, 16), (560, 2, 12), (840, 2, 9), (1250, 1, 7)], bright=0.55, seed=31)),
    ("Central Acoustic Jumbo Body", dict(modes=[(92, 10, 42), (185, 7, 30), (250, 4, 24), (420, 3, 16), (700, 2, 11), (1100, 1.5, 8)], bright=0.5, seed=32)),
    ("Central Acoustic Parlor Body", dict(modes=[(118, 7, 28), (230, 7, 22), (310, 4, 18), (520, 3, 13), (900, 3, 9), (1500, 2, 7)], bright=0.7, seed=33)),
    ("Central Acoustic Nylon Body", dict(modes=[(100, 8, 34), (205, 6, 26), (300, 3, 20), (480, 2, 15), (760, 1.5, 10)], bright=0.4, seed=34)),
]


def peak_db(f, f0, db, q):
    """A bell curve in dB on a log-frequency axis (a peaking EQ's shape)."""
    x = np.log2(np.maximum(f, 1.0) / f0)
    bw = 1.0 / q
    return db * np.exp(-0.5 * (x / (bw / 2.0)) ** 2)


def cab_curve(f, spec):
    rng = np.random.default_rng(spec["seed"])
    hp_f, hp_q = spec["hp"]
    w = np.maximum(f, 1.0) / hp_f
    hp = 10 * np.log10(w ** 4 / ((1 - w ** 2) ** 2 + (w / hp_q) ** 2) + 1e-12)   # 2nd-order high-pass (the box's low end)
    hp = np.minimum(hp, 0)
    lp_f, order = spec["lp"]
    lp = -10 * np.log10(1 + (np.maximum(f, 1.0) / lp_f) ** (2 * order))
    db = hp + lp + peak_db(f, *spec["res"])
    for p in spec["peaks"]:
        db = db + peak_db(f, *p)
    # cone break-up: smooth random ripple above 1.5 kHz (on a log axis)
    knots = np.linspace(np.log2(1500), np.log2(SR / 2), 24)
    vals = rng.normal(0, spec["ripple"] / 2.0, len(knots))
    lf = np.log2(np.maximum(f, 1.0))
    ripple = np.interp(lf, knots, vals) * np.clip((lf - np.log2(1500)) / 1.0, 0, 1)
    return db + ripple


def min_phase(db):
    """A minimum-phase impulse with the given magnitude (dB per rfft bin), by the real cepstrum."""
    mag = 10 ** (db / 20.0)
    full = np.concatenate([mag, mag[-2:0:-1]])
    cep = np.fft.ifft(np.log(np.maximum(full, 1e-7))).real
    n = len(full)
    fold = np.zeros(n)
    fold[0] = cep[0]
    fold[1:n // 2] = 2 * cep[1:n // 2]
    fold[n // 2] = cep[n // 2]
    return np.fft.ifft(np.exp(np.fft.fft(fold))).real


def fade(x, ms=12):
    k = int(ms * SR / 1000)
    x = x[:N].copy()
    x[-k:] *= np.cos(np.linspace(0, math.pi / 2, k)) ** 2
    return x


def make_cab(spec):
    f = np.fft.rfftfreq(FFT, 1.0 / SR)
    ir = min_phase(cab_curve(f, spec))[:N]
    for ms, lvl in ([spec["room"]] if spec.get("room") else []) + list(spec.get("rooms") or []):
        d = int(ms * SR / 1000)
        refl = np.zeros(N)
        refl[d:] = ir[:N - d] * lvl
        ir = ir + refl
    return fade(ir)


def make_body(spec):
    rng = np.random.default_rng(spec["seed"])
    t = np.arange(N) / SR
    ir = np.zeros(N)
    ir[0] = 1.0   # the string's own direct sound
    for hz, db, dec in spec["modes"]:
        a = (10 ** (db / 20.0) - 1) * 2.0 / (dec / 1000.0 * SR)   # (a decaying sine's peak gain is about a * tau * SR / 2)
        ir += a * np.sin(2 * math.pi * hz * t + rng.uniform(0, 0.4)) * np.exp(-t / (dec / 1000.0))
    # the top's many small modes: short coloured noise
    noise = rng.normal(0, 1, N) * np.exp(-t / 0.006) * 0.08
    f = np.fft.rfftfreq(N, 1.0 / SR)
    shape = np.fft.rfft(noise) * (1 / (1 + (f / (2500 + 6000 * spec["bright"])) ** 2))
    ir += np.fft.irfft(shape, N)
    return fade(ir)


def write_wav24(path, x):
    x = x / (float(np.max(np.abs(x))) or 1.0) * 0.89
    v = np.clip(np.round(x * 8388607), -8388608, 8388607).astype(np.int32)
    b = np.empty((len(v), 3), np.uint8)
    b[:, 0], b[:, 1], b[:, 2] = v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF
    data = b.tobytes()
    fmt = struct.pack("<HHIIHH", 1, 1, SR, SR * 3, 3, 24)
    with open(path + ".part", "wb") as out:
        out.write(b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(data)) + b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data)
    os.replace(path + ".part", path)


def all_irs():
    """[(name, kind, samples)] for every IR."""
    return [(n, "cab", make_cab(s)) for n, s in CABS] + [(n, "body", make_body(s)) for n, s in BODIES]


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for name, kind, ir in all_irs():
        path = os.path.join(out_dir, name + ".wav")
        write_wav24(path, ir)
        print("    %-40s %s, %d bytes" % (name, kind, os.path.getsize(path)))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
