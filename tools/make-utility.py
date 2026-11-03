#!/usr/bin/env python3
"""Central Utility (10.2) - makes the first set of the Utility library's content, all made here (no recordings):

  clicks/<set>/accent.wav, beat.wav   metronome click sets for a song's Click sound (48 kHz, 16-bit, mono, 0.25 s):
                                       wood block, rim, closed hi-hat, cowbell, clave, shaker, side stick, triangle,
                                       mechanical tick, digital beep, soft beep, square blip, low tom, finger snap
  looks/<id>.json                      lighting looks in the lights page's preset format (groups front, back, beam,
                                       house, fx, haze - each {dim, color, w, a, uv, strobe, fx, speed, size, pan, tilt})

    python3 tools/make-utility.py <out folder>
Deterministic: the same files every build. tools/build-libraries.py packs them (--utility <out folder>)."""
import json
import math
import os
import struct
import sys
import random

SR = 48000
CLICK_SECONDS = 0.25

CLICKS = [  # (set id, name)
    ("woodblock", "Wood block"), ("rim", "Rim click"), ("hihat", "Closed hi-hat"), ("cowbell", "Cowbell"), ("clave", "Clave"),
    ("shaker", "Shaker"), ("sidestick", "Side stick"), ("triangle", "Triangle"), ("tick", "Mechanical tick"), ("beep", "Digital beep"),
    ("softbeep", "Soft beep"), ("blip", "Square blip"), ("tom", "Low tom"), ("snap", "Finger snap"),
]


def wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    peak = max(1e-9, max(abs(s) for s in samples))
    k = 0.89 / peak
    data = b"".join(struct.pack("<h", max(-32768, min(32767, int(round(s * k * 32767))))) for s in samples)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16) + b"data" + struct.pack("<I", len(data)) + data)


def env(t, attack, decay):
    return (t / attack if t < attack else 1.0) * math.exp(-max(0.0, t - attack) / decay)


def noise(seed):
    r = random.Random(seed)
    return lambda: r.uniform(-1, 1)


def bandpass(xs, f, q):
    """A simple two-pole band-pass (RBJ) over a list."""
    w = 2 * math.pi * f / SR
    alpha = math.sin(w) / (2 * q)
    b0, b2, a0, a1, a2 = alpha, -alpha, 1 + alpha, -2 * math.cos(w), 1 - alpha
    y, x1, x2, y1, y2 = [], 0.0, 0.0, 0.0, 0.0
    for x in xs:
        v = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1, y2, y1 = x1, x, y1, v
        y.append(v)
    return y


def highpass(xs, f):
    rc = 1 / (2 * math.pi * f)
    a = rc / (rc + 1 / SR)
    y, px, py = [], 0.0, 0.0
    for x in xs:
        v = a * (py + x - px)
        px, py = x, v
        y.append(v)
    return y


def click(kind, accent):
    n = int(SR * CLICK_SECONDS)
    up = 1.25 if accent else 1.0   # (the accent: higher, and a touch longer)
    ts = [i / SR for i in range(n)]
    nz = noise(sum(ord(c) * (i + 1) for i, c in enumerate(kind)))   # (a fixed seed per kind: the same files every build)
    if kind == "woodblock":
        f = 1650 * up
        return [env(t, 0.0005, 0.018) * (math.sin(2 * math.pi * f * t) + 0.35 * math.sin(2 * math.pi * f * 2.73 * t)) for t in ts]
    if kind == "rim":
        f = 1100 * up
        body = [env(t, 0.0003, 0.012) * math.sin(2 * math.pi * f * t) for t in ts]
        crack = bandpass([env(t, 0.0002, 0.006) * nz() for t in ts], 3500 * up, 2.0)
        return [b + 1.6 * c for b, c in zip(body, crack)]
    if kind == "hihat":
        return highpass([env(t, 0.0003, 0.03 if accent else 0.018) * nz() for t in ts], 7000)
    if kind == "cowbell":
        f1, f2 = 560 * up, 845 * up
        sq = lambda f, t: 1.0 if math.sin(2 * math.pi * f * t) >= 0 else -1.0
        return bandpass([env(t, 0.0005, 0.07) * (sq(f1, t) + sq(f2, t)) for t in ts], 2600 * up, 1.4)
    if kind == "clave":
        f = 2500 * up
        return [env(t, 0.0003, 0.025) * math.sin(2 * math.pi * f * t) for t in ts]
    if kind == "shaker":
        return bandpass([env(t, 0.008, 0.035 if accent else 0.025) * nz() for t in ts], 6000, 0.9)
    if kind == "sidestick":
        f = 420 * up
        return [env(t, 0.0003, 0.02) * (math.sin(2 * math.pi * f * t) + 0.6 * math.sin(2 * math.pi * f * 3.1 * t)) for t in ts]
    if kind == "triangle":
        f = 2900 * up
        return [env(t, 0.0005, 0.12) * (math.sin(2 * math.pi * f * t) + 0.4 * math.sin(2 * math.pi * f * 2.76 * t) + 0.2 * math.sin(2 * math.pi * f * 5.4 * t)) for t in ts]
    if kind == "tick":
        return highpass([env(t, 0.0002, 0.004) * (nz() * 0.6 + math.sin(2 * math.pi * 3800 * up * t)) for t in ts], 900)
    if kind == "beep":
        f = 1760 if accent else 1320
        return [(1.0 if t < 0.05 else math.exp(-(t - 0.05) / 0.004)) * min(1.0, t / 0.001) * math.sin(2 * math.pi * f * t) for t in ts]
    if kind == "softbeep":
        f = 1046.5 if accent else 784.0
        return [env(t, 0.004, 0.05) * math.sin(2 * math.pi * f * t) for t in ts]
    if kind == "blip":
        f = 1500 * up
        return [(1.0 if math.sin(2 * math.pi * f * t) >= 0 else -1.0) * (0.5 if t < 0.03 else 0.0) * min(1.0, t / 0.0005) for t in ts]
    if kind == "tom":
        out, ph = [], 0.0
        for t in ts:
            f = (140 * up) * (1 + 0.6 * math.exp(-t / 0.03))
            ph += 2 * math.pi * f / SR
            out.append(env(t, 0.001, 0.09) * math.sin(ph))
        return out
    if kind == "snap":
        return bandpass([env(t, 0.0006, 0.014) * nz() for t in ts], 2200 * up, 3.0)
    raise ValueError(kind)


# ---------------------------------------------------------------- lighting looks
W, WARM, AMBER, RED, BLUE, DEEP, PURPLE = "#ffffff", "#ffb36b", "#ff8a00", "#ff2a10", "#1f4dff", "#0a1fb0", "#7a2bff"


def G(dim, color="#ffffff", **o):
    g = {"dim": dim, "color": color, "w": 0, "a": 0, "uv": 0, "strobe": 0, "fx": "none", "speed": 1, "size": 0.6, "pan": 0.5, "tilt": 0.5}
    g.update(o)
    return g


LOOKS = [
    ("sunrise", "Sunrise", "#ff9a3c", 4, {"front": G(0.6, WARM), "back": G(0.8, "#ff7a2f", a=0.4, fx="breathe", speed=8, size=0.25), "beam": G(0.35, "#ffcf7a", fx="sweep", speed=16, size=0.3), "house": G(0.15, WARM), "haze": G(0.25)}),
    ("ocean", "Ocean", "#0094ff", 3, {"front": G(0.5, "#ffe1c4"), "back": G(0.85, "#0067ff", fx="breathe", speed=4, size=0.4), "beam": G(0.5, "#00c2ff", fx="panwave", speed=8, size=0.4), "haze": G(0.35)}),
    ("candlelight", "Candlelight", "#ffb35c", 6, {"front": G(0.35, WARM, a=0.3), "back": G(0.3, AMBER, a=0.6, fx="breathe", speed=8, size=0.2), "house": G(0.12, WARM)}),
    ("cross", "Cross (backlit)", "#ffffff", 2, {"front": G(0.15, WARM), "back": G(1.0, W, w=1), "beam": G(0.9, W, w=1, tilt=0.15), "haze": G(0.45)}),
    ("royal", "Royal purple", "#8a2be2", 2, {"front": G(0.6, WARM), "back": G(0.9, "#7a2bff", uv=0.3), "beam": G(0.55, "#b44dff", fx="alternate", speed=2, size=0.6), "haze": G(0.3)}),
    ("forest", "Forest", "#2fbf4a", 3, {"front": G(0.55, "#fff1d6"), "back": G(0.8, "#1fbf3a", fx="breathe", speed=8, size=0.3), "beam": G(0.4, "#9dff5a", fx="sweep", speed=8, size=0.3), "haze": G(0.3)}),
    ("embers", "Embers", "#ff3a10", 2, {"front": G(0.5, WARM), "back": G(0.85, "#ff2a10", fx="sparkle", speed=1, size=0.5), "beam": G(0.4, AMBER, fx="sweep", speed=8, size=0.3), "haze": G(0.35)}),
    ("ice", "Ice", "#bfe9ff", 2, {"front": G(0.6, "#e8f6ff"), "back": G(0.8, "#9ad8ff", w=0.4), "beam": G(0.6, "#e8f6ff", w=0.8, fx="circle", speed=8, size=0.4), "haze": G(0.35)}),
    ("gospel", "Gospel celebration", "#ffcc00", 0.5, {"front": G(0.95, WARM, w=0.3), "back": G(1.0, "#ffcc00", fx="chase", speed=0.5, size=0.7), "beam": G(1.0, W, w=1, fx="ballyhoo", speed=2, size=0.6), "fx": G(0.3, W, fx="flash", speed=1, size=1), "haze": G(0.4)}),
    ("rock", "Hymn rock", "#ff1e3c", 0.5, {"front": G(0.85, WARM), "back": G(1.0, RED, fx="pulse", speed=1, size=0.7), "beam": G(1.0, W, w=1, fx="sweep", speed=2, size=0.8), "fx": G(0, W), "haze": G(0.45)}),
    ("reflection", "Reflection", "#4a5cff", 6, {"front": G(0.3, WARM), "back": G(0.35, "#3a4cff", fx="breathe", speed=8, size=0.3), "house": G(0.1, WARM), "haze": G(0.2)}),
    ("communion", "Communion", "#e8c48a", 4, {"front": G(0.45, WARM, a=0.2), "back": G(0.35, "#c98a4a", a=0.4), "house": G(0.35, WARM)}),
    ("baptism", "Baptism (water)", "#00b4ff", 3, {"front": G(0.7, "#fff7ec"), "back": G(0.7, "#00a0ff", fx="wipe", speed=8, size=0.5), "beam": G(0.5, "#7fd8ff", fx="panwave", speed=8, size=0.3), "haze": G(0.3)}),
    ("christmas", "Christmas", "#d4142a", 2, {"front": G(0.65, WARM), "back": G(0.85, "#d4142a", color2="#18a03a", fx="alternate", speed=4, size=0.9), "beam": G(0.45, W, w=0.6, fx="sparkle", speed=1, size=0.5), "haze": G(0.25)}),
    ("easter", "Easter morning", "#ffe6a8", 3, {"front": G(0.8, WARM, w=0.2), "back": G(0.9, "#ffd77a", a=0.3), "beam": G(0.7, W, w=0.7, tilt=0.2, fx="sweep", speed=16, size=0.3), "house": G(0.2, WARM), "haze": G(0.35)}),
    ("sermon", "Sermon (clean front light)", "#fff4e0", 3, {"front": G(0.85, "#fff4e0", w=0.5), "back": G(0.25, BLUE), "house": G(0.3, WARM)}),
    ("announce", "Announcements", "#ffffff", 2, {"front": G(0.8, W, w=0.6), "back": G(0.4, "#2b3cff"), "house": G(0.6, WARM)}),
    ("kids", "Kids' worship", "#ff3ea5", 1, {"front": G(0.9, WARM), "back": G(1.0, W, fx="rainbow", speed=2, size=1), "beam": G(0.9, W, fx="rainbow", speed=1, size=1), "haze": G(0.3)}),
    ("youth", "Youth night", "#00e0c0", 0.5, {"front": G(0.6, "#e6fffb"), "back": G(1.0, "#00e0c0", color2="#7a2bff", fx="alternate", speed=1, size=1), "beam": G(1.0, W, w=1, fx="figure8", speed=2, size=0.7), "fx": G(0.5, W, strobe=0.6, strobeSync="beat"), "haze": G(0.5)}),
    ("walkout", "Walk-out", "#ffb36b", 3, {"front": G(0.4, WARM), "back": G(0.5, AMBER, fx="breathe", speed=8, size=0.3), "house": G(0.85, WARM)}),
    ("dawn", "Slow dawn", "#ff7f50", 8, {"front": G(0.25, WARM), "back": G(0.45, "#ff5f40", fx="breathe", speed=16, size=0.4), "haze": G(0.2)}),
    ("starry", "Starry night", "#1a237e", 4, {"back": G(0.3, "#1a237e"), "beam": G(0.35, "#c5cae9", w=0.3, fx="sparkle", speed=2, size=0.7), "haze": G(0.4)}),
    ("revival", "Revival", "#ff6a00", 1, {"front": G(0.9, WARM), "back": G(1.0, "#ff6a00", fx="pulse", speed=1, size=0.4), "beam": G(0.9, "#ffd000", fx="sweep", speed=4, size=0.6), "haze": G(0.4)}),
    ("silent", "Silent prayer", "#20264d", 8, {"front": G(0.18, WARM), "back": G(0.15, DEEP), "house": G(0.08, WARM)}),
]


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 2
    out = argv[0]
    for sid, _name in CLICKS:
        for role in ("accent", "beat"):
            wav(os.path.join(out, "clicks", sid, role + ".wav"), click(sid, role == "accent"))
    os.makedirs(os.path.join(out, "looks"), exist_ok=True)
    for lid, name, sw, fade, g in LOOKS:
        look = {"id": "utility-" + lid, "name": name, "swatch": sw, "fade": fade, "g": g, "utility": True}
        with open(os.path.join(out, "looks", lid + ".json"), "w") as f:
            json.dump(look, f, indent=1, sort_keys=True)
    with open(os.path.join(out, "index.json"), "w") as f:
        json.dump({"clicks": [{"set": s, "name": n} for s, n in CLICKS], "looks": [{"file": l[0], "name": l[1]} for l in LOOKS]}, f, indent=1)
    print("%d click sets, %d lighting looks -> %s" % (len(CLICKS), len(LOOKS), out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
