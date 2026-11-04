#!/usr/bin/env python3
"""Central FX collection (10.3): the effects that come with the apps, built on the plugin builder's engine.

    python3 tools/make-cmfx-collection.py        -> production/plugin-collection/<id>.cmfx.json (one per plugin)

The basic one of each family is free (tier "free"); the better ones come with the Central Plugins plan (tier "plugins").
Each plugin has its knobs (with units and ranges a person can use), a description and a few starting points (presets).
tools/build-cmfx.sh turns the folder into cmfx-collection.js for the apps, and the native build copies the files next to
the rig (central-fx/) for the pedal boards. Deterministic: the same files every time."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "production", "plugin-collection")


class G:
    """A plugin: its knobs, blocks (laid out left to right) and wires."""
    def __init__(self, pid, name, family, tier, description):
        self.p = {"format": "central-fx", "version": 1, "id": pid, "name": name, "author": "Motion Audio", "family": family, "tier": tier,
                  "description": description, "params": [], "presets": [], "graph": {"blocks": [], "wires": []}}
        self.col = 0

    def knob(self, pid, name, lo, hi, default, unit="", log=False, group=None, sync=False):
        q = {"id": pid}
        if sync:   # (10.4) a delay's time knob: the apps can set it to a note at the song's tempo ("Sync to tempo")
            q["tempoSync"] = True
        q.update({"name": name, "min": lo, "max": hi, "default": default})
        if unit:
            q["unit"] = unit
        if log:
            q["curve"] = "log"
        if group:
            q["group"] = group
        self.p["params"].append(q)
        return {"param": pid}

    def block(self, bid, btype, props=None, col=None, row=0):
        c = self.col if col is None else col
        self.p["graph"]["blocks"].append({"id": bid, "type": btype, "x": 40 + c * 200, "y": 40 + row * 190, "props": props or {}})
        if col is None:
            self.col += 1
        return bid

    def wire(self, a, b, port="in"):
        self.p["graph"]["wires"].append({"from": a + ".out", "to": b + "." + port})

    def chain(self, *ids):
        for a, b in zip(ids, ids[1:]):
            self.wire(a, b)

    def preset(self, name, **values):
        self.p["presets"].append({"name": name, "values": values})

    def done(self):
        ids = {q["id"] for q in self.p["params"]}
        for pr in self.p["presets"]:
            for k in pr["values"]:
                assert k in ids, (self.p["id"], pr["name"], k)
        return self.p


P = []

# ================================================================ space
g = G("room-reverb", "Room Reverb", "reverb", "free", "A natural room around the sound. The basic reverb: small to medium spaces.")
mix, size, tone = g.knob("mix", "Mix", 0, 1, 0.22), g.knob("size", "Size", 0, 0.6, 0.3), g.knob("damp", "Darkness", 0, 1, 0.45)
g.chain(g.block("in", "input"), g.block("room", "reverb", {"size": size, "damp": tone, "mix": mix, "predelay": 6, "mod": 0.3}), g.block("out", "output"))
g.preset("Small room", mix=0.18, size=0.15, damp=0.5); g.preset("Live room", mix=0.25, size=0.35, damp=0.35); g.preset("Wooden hall", mix=0.3, size=0.55, damp=0.55)
P.append(g.done())

g = G("vocal-plate", "Vocal Plate", "reverb", "plugins", "A bright, smooth plate made for vocals: sits behind the voice without clouding the words.")
mix = g.knob("mix", "Mix", 0, 1, 0.2); dec = g.knob("decay", "Decay", 0.2, 0.9, 0.55); pre = g.knob("predelay", "Pre-delay", 0, 150, 25, "ms")
bright = g.knob("bright", "Brightness", -6, 6, 2, "dB"); lc = g.knob("lowcut", "Low cut", 80, 800, 220, "Hz", True)
g.block("in", "input", col=0, row=1)
g.chain("in", g.block("hp", "filter", {"mode": "highpass", "freq": lc, "q": 0.7, "slope": 24}), g.block("plate", "reverb", {"size": dec, "damp": 0.18, "mix": 1, "predelay": pre, "width": 1, "mod": 0.55}),
        g.block("air", "eq", {"mode": "highshelf", "freq": 6000, "q": 0.7, "gain": bright}), g.block("blend", "mix", {"mix": mix, "law": "equal"}))
g.wire("air", "blend", "wet"); g.p["graph"]["wires"] = [w for w in g.p["graph"]["wires"] if w != {"from": "air.out", "to": "blend.in"}]
g.wire("in", "blend", "dry"); g.chain("blend", g.block("out", "output"))
g.preset("Lead vocal", mix=0.2, decay=0.5, predelay=30, bright=2.5, lowcut=250); g.preset("Ballad", mix=0.3, decay=0.7, predelay=45, bright=1, lowcut=200)
g.preset("Backing vocals", mix=0.28, decay=0.55, predelay=10, bright=0, lowcut=350); g.preset("Snare plate", mix=0.25, decay=0.45, predelay=0, bright=3, lowcut=300)
P.append(g.done())


def mixed(g, wet_last, mixknob, law="equal"):
    """dry (from in) and wet into a blend, then out"""
    g.p["graph"]["wires"] = [w for w in g.p["graph"]["wires"] if not (w["from"] == wet_last + ".out" and w["to"] == "blend.in")]
    b = g.block("blend", "mix", {"mix": mixknob, "law": law})
    g.wire(wet_last, b, "wet"); g.wire("in", b, "dry"); g.chain(b, g.block("out", "output"))


g = G("lush-hall", "Lush Hall", "reverb", "plugins", "A big, wide, softly moving hall. For pads, keys and slow songs.")
mix = g.knob("mix", "Mix", 0, 1, 0.28); dec = g.knob("decay", "Decay", 0.4, 1, 0.8); pre = g.knob("predelay", "Pre-delay", 0, 200, 35, "ms")
tone = g.knob("tone", "Tone", 1500, 16000, 7000, "Hz", True); wid = g.knob("width", "Width", 0, 1, 1); mod = g.knob("motion", "Motion", 0, 1, 0.7)
g.block("in", "input")
g.chain("in", g.block("hp", "filter", {"mode": "highpass", "freq": 140, "q": 0.7}), g.block("hall", "reverb", {"size": dec, "damp": 0.35, "mix": 1, "predelay": pre, "width": wid, "mod": mod}),
        g.block("lp", "filter", {"mode": "lowpass", "freq": tone, "q": 0.6}))
mixed(g, "lp", mix)
g.preset("Concert hall", mix=0.25, decay=0.75, predelay=30, tone=8000); g.preset("Cathedral", mix=0.35, decay=0.95, predelay=60, tone=5000, motion=0.6)
g.preset("Pad wash", mix=0.5, decay=0.9, predelay=10, tone=6000, motion=0.9); g.preset("Dark hall", mix=0.3, decay=0.8, tone=3000)
P.append(g.done())

g = G("worship-shimmer", "Worship Shimmer", "reverb", "plugins", "The worship shimmer: a huge reverb with soft octaves blooming above. Keys, pads, clean guitar.")
mix = g.knob("mix", "Mix", 0, 1, 0.35); sh = g.knob("shimmer", "Shimmer", 0, 1, 0.5); dec = g.knob("decay", "Decay", 0.5, 1, 0.9)
fifth = g.knob("fifth", "Fifth", 0, 1, 0, group="Shimmer"); tone = g.knob("tone", "Tone", 2000, 14000, 6500, "Hz", True); lc = g.knob("lowcut", "Low cut", 100, 800, 300, "Hz", True)
g.block("in", "input", col=0, row=1)
g.chain("in", g.block("hp", "filter", {"mode": "highpass", "freq": lc, "q": 0.7, "slope": 24}), g.block("early", "reverb", {"size": 0.7, "damp": 0.3, "mix": 1, "predelay": 20, "mod": 0.6}))
oct_ = g.block("octave", "pitch", {"semitones": 12, "mix": sh, "window": 90}); g.wire("early", oct_)
fif = g.block("fifthup", "pitch", {"semitones": 19, "mix": fifth, "window": 90}); g.wire(oct_, fif)
g.chain(fif, g.block("hall", "reverb", {"size": dec, "damp": 0.28, "mix": 1, "width": 1, "mod": 0.8}), g.block("lp", "filter", {"mode": "lowpass", "freq": tone, "q": 0.6}))
mixed(g, "lp", mix)
g.preset("Shimmer pad", mix=0.45, shimmer=0.6, decay=0.95); g.preset("Subtle air", mix=0.25, shimmer=0.3, decay=0.8, tone=8000)
g.preset("Octave and fifth", mix=0.4, shimmer=0.5, fifth=0.35, decay=0.92); g.preset("Ambient guitar", mix=0.5, shimmer=0.45, decay=0.9, lowcut=400)
P.append(g.done())

g = G("simple-delay", "Delay", "delay", "free", "A clean delay: set the time, how many repeats and how loud they are. The basic delay.")
t = g.knob("time", "Time", 40, 1500, 380, "ms", True, sync=True); fb = g.knob("feedback", "Repeats", 0, 0.9, 0.35); mix = g.knob("mix", "Mix", 0, 1, 0.25)
g.chain(g.block("in", "input"), g.block("echo", "delay", {"time": t, "feedback": fb, "mix": mix, "tone": 7000, "maxTime": 1600}), g.block("out", "output"))
g.preset("Slapback", time=110, feedback=0.1, mix=0.25); g.preset("Quarter at 80", time=750, feedback=0.35, mix=0.22); g.preset("Long trails", time=600, feedback=0.6, mix=0.3)
P.append(g.done())

g = G("dotted-eighth", "Dotted Eighth Delay", "delay", "plugins", "The dotted-eighth delay of worship guitar, locked to the song's tempo (it takes the BPM from the song where the app knows it).")
bpm = g.knob("bpm", "Tempo", 50, 200, 72, "BPM"); fb = g.knob("feedback", "Repeats", 0, 0.85, 0.4); mix = g.knob("mix", "Mix", 0, 1, 0.3)
tone = g.knob("tone", "Tone", 1500, 12000, 4500, "Hz", True); mod = g.knob("motion", "Motion", 0, 1, 0.2)
g.block("in", "input", col=0, row=1); g.block("tempo", "param", {"param": "bpm"}, col=0, row=0)
g.block("time", "math", {"op": "divide", "a": 45000}, col=1, row=0); g.wire("tempo", "time", "b")
g.block("wob", "lfo", {"rate": 0.45, "from": -1.5, "to": 1.5}, col=1, row=2); g.block("amt", "param", {"param": "motion"}, col=1, row=3)
g.block("wobs", "math", {"op": "multiply"}, col=2, row=2); g.wire("wob", "wobs", "a"); g.wire("amt", "wobs", "b")
g.block("t2", "math", {"op": "add"}, col=2, row=0); g.wire("time", "t2", "a"); g.wire("wobs", "t2", "b")
g.block("echo", "delay", {"feedback": fb, "mix": mix, "tone": tone, "maxTime": 1000}, col=3, row=1); g.wire("in", "echo"); g.wire("t2", "echo", "time")
g.block("out", "output", col=4, row=1); g.wire("echo", "out")
g.preset("Lead line", feedback=0.45, mix=0.3, tone=4500); g.preset("Ambient swell", feedback=0.6, mix=0.4, tone=3500, motion=0.5); g.preset("Tight rhythm", feedback=0.25, mix=0.22, tone=6000)
P.append(g.done())

g = G("ping-pong-delay", "Ping-Pong Delay", "delay", "plugins", "Repeats that bounce left and right across the stereo field.")
t = g.knob("time", "Time", 40, 1500, 330, "ms", True, sync=True); fb = g.knob("feedback", "Repeats", 0, 0.9, 0.45); mix = g.knob("mix", "Mix", 0, 1, 0.3)
tone = g.knob("tone", "Tone", 1500, 16000, 6000, "Hz", True); wid = g.knob("width", "Width", 0, 2, 1.3)
g.chain(g.block("in", "input"), g.block("echo", "delay", {"time": t, "feedback": fb, "mix": 1, "tone": tone, "mode": "pingpong", "maxTime": 1600}), g.block("wide", "stereo", {"width": wid}))
mixed(g, "wide", mix, "linear")
g.preset("Bouncy eighths", time=250, feedback=0.4, mix=0.3); g.preset("Wide vocal throw", time=420, feedback=0.3, mix=0.25, tone=4000); g.preset("Dark and long", time=550, feedback=0.65, mix=0.35, tone=2500)
P.append(g.done())

g = G("tape-echo", "Tape Echo", "delay", "plugins", "Warm, wobbly repeats that darken and saturate as they fade, like a tape machine.")
t = g.knob("time", "Time", 60, 1200, 420, "ms", True, sync=True); fb = g.knob("feedback", "Repeats", 0, 0.9, 0.45); mix = g.knob("mix", "Mix", 0, 1, 0.3)
wow = g.knob("wobble", "Wobble", 0, 1, 0.35); age = g.knob("age", "Tape age", 1200, 9000, 3200, "Hz", True); sat = g.knob("saturation", "Saturation", 0, 18, 6, "dB")
g.block("in", "input", col=0, row=1); g.block("tm", "param", {"param": "time"}, col=0, row=0)
g.block("w", "lfo", {"rate": 0.6, "from": -3, "to": 3, "shape": "sine"}, col=0, row=2); g.block("wa", "param", {"param": "wobble"}, col=0, row=3)
g.block("ws", "math", {"op": "multiply"}, col=1, row=2); g.wire("w", "ws", "a"); g.wire("wa", "ws", "b")
g.block("tt", "math", {"op": "add"}, col=1, row=0); g.wire("tm", "tt", "a"); g.wire("ws", "tt", "b")
g.block("echo", "delay", {"feedback": fb, "mix": 1, "tone": age, "maxTime": 1400}, col=2, row=1); g.wire("in", "echo"); g.wire("tt", "echo", "time")
g.block("hp", "filter", {"mode": "highpass", "freq": 120, "q": 0.6}, col=3, row=1); g.wire("echo", "hp")
g.block("tape", "drive", {"mode": "tape", "drive": sat, "tone": 9000, "level": -2, "mix": 0.7, "oversample": 2}, col=4, row=1); g.wire("hp", "tape")
g.col = 5; mixed(g, "tape", mix, "linear")
g.preset("Space echo", time=380, feedback=0.55, mix=0.32, wobble=0.4); g.preset("Old cassette", time=300, feedback=0.4, wobble=0.8, age=1800, saturation=10)
g.preset("Rockabilly slap", time=120, feedback=0.15, mix=0.3, wobble=0.15, age=5000); g.preset("Dub", time=600, feedback=0.78, mix=0.4, wobble=0.3, age=2200)
P.append(g.done())

# ================================================================ dynamics
g = G("simple-compressor", "Compressor", "compressor", "free", "Evens out the level. The basic compressor.")
thr = g.knob("threshold", "Threshold", -50, 0, -18, "dB"); ra = g.knob("ratio", "Ratio", 1, 20, 3, ":1"); at = g.knob("attack", "Attack", 0.5, 100, 10, "ms", True)
rl = g.knob("release", "Release", 20, 1500, 150, "ms", True); mk = g.knob("makeup", "Make-up", 0, 18, 3, "dB")
g.chain(g.block("in", "input"), g.block("comp", "compressor", {"threshold": thr, "ratio": ra, "attack": at, "release": rl, "makeup": mk, "knee": 6}), g.block("out", "output"))
g.preset("Gentle", threshold=-16, ratio=2, attack=20, release=200, makeup=2); g.preset("Vocal", threshold=-20, ratio=4, attack=5, release=120, makeup=5); g.preset("Bass", threshold=-22, ratio=5, attack=15, release=180, makeup=4)
P.append(g.done())

g = G("fet-compressor", "FET Compressor", "compressor", "plugins", "A fast, punchy compressor in the style of the classic 1176: drive the input, set the output. Bold on vocals, drums and bass.")
inp = g.knob("input", "Input", 0, 36, 12, "dB"); out = g.knob("output", "Output", -12, 24, 8, "dB"); at = g.knob("attack", "Attack", 0.02, 0.8, 0.2, "ms", True)
rl = g.knob("release", "Release", 50, 1100, 250, "ms", True); ra = g.knob("ratio", "Ratio", 4, 20, 4, ":1"); mix = g.knob("mix", "Mix", 0, 1, 1)
g.chain(g.block("in", "input"), g.block("drive", "gain", {"gain": inp}),
        g.block("fet", "compressor", {"style": "fet", "threshold": -24, "ratio": ra, "attack": at, "release": rl, "knee": 2, "makeup": out, "mix": 1}))
mixed(g, "fet", mix, "linear")
g.preset("Vocal grab", input=14, output=8, attack=0.3, release=200, ratio=4); g.preset("Drum smash", input=26, output=10, attack=0.05, release=100, ratio=20, mix=0.5)
g.preset("Bass control", input=12, output=8, attack=0.6, release=400, ratio=8); g.preset("Parallel punch", input=24, output=12, attack=0.02, release=150, ratio=20, mix=0.35)
P.append(g.done())

g = G("opto-leveler", "Opto Leveler", "compressor", "plugins", "Smooth, musical levelling in the style of the LA-2A: one knob for how much, one for how loud. The release slows the harder it works.")
red = g.knob("reduction", "Peak reduction", 0, 100, 40, "%"); gain = g.knob("gain", "Gain", 0, 30, 6, "dB"); ra = g.knob("ratio", "Compress ↔ limit", 3, 10, 3, ":1")
mix = g.knob("mix", "Mix", 0, 1, 1)
g.block("in", "input", col=0, row=1); g.block("red", "param", {"param": "reduction"}, col=0, row=0)
g.block("thr", "math", {"op": "map", "inLo": 0, "inHi": 100, "outLo": -6, "outHi": -42}, col=1, row=0); g.wire("red", "thr", "a")
g.block("opto", "compressor", {"style": "opto", "detect": "rms", "ratio": ra, "attack": 10, "release": 80, "knee": 10, "makeup": gain, "mix": 1}, col=2, row=1)
g.wire("in", "opto"); g.wire("thr", "opto", "threshold"); g.col = 3
mixed(g, "opto", mix, "linear")
g.preset("Smooth vocal", reduction=45, gain=8); g.preset("Bass leveler", reduction=55, gain=9, ratio=4); g.preset("Gentle bus", reduction=25, gain=3); g.preset("Limit", reduction=60, gain=10, ratio=10)
P.append(g.done())

g = G("bus-glue", "Bus Glue", "compressor", "plugins", "The bus compressor that pulls a mix together: gentle, RMS, with a side-chain filter so the bass doesn't pump it.")
thr = g.knob("threshold", "Threshold", -40, 0, -18, "dB"); ra = g.knob("ratio", "Ratio", 1.5, 10, 2, ":1"); at = g.knob("attack", "Attack", 0.1, 30, 10, "ms", True)
rl = g.knob("release", "Release", 100, 1200, 300, "ms", True); mk = g.knob("makeup", "Make-up", 0, 12, 2, "dB"); sc = g.knob("schpf", "Side-chain HPF", 10, 300, 60, "Hz", True)
mix = g.knob("mix", "Mix", 0, 1, 1)
g.chain(g.block("in", "input"), g.block("glue", "compressor", {"style": "glue", "detect": "rms", "threshold": thr, "ratio": ra, "attack": at, "release": rl, "makeup": mk, "schpf": sc, "knee": 8, "mix": mix}), g.block("out", "output"))
g.preset("Mix glue", threshold=-16, ratio=2, attack=10, release=300, makeup=2); g.preset("Drum bus", threshold=-20, ratio=4, attack=3, release=200, makeup=4, schpf=90)
g.preset("Gentle master", threshold=-10, ratio=1.5, attack=30, release=600, makeup=1); g.preset("Vocal bus", threshold=-18, ratio=3, attack=5, release=150, makeup=3, schpf=150)
P.append(g.done())

g = G("multiband-compressor", "Multiband Compressor", "compressor", "plugins", "Three bands, each with its own compressor: control the low end, the body and the top separately.")
x1 = g.knob("xlow", "Low / mid split", 60, 600, 200, "Hz", True, "Bands"); x2 = g.knob("xhigh", "Mid / high split", 1200, 9000, 3000, "Hz", True, "Bands")
tl = g.knob("lowThr", "Low threshold", -50, 0, -20, "dB", group="Low"); gl = g.knob("lowGain", "Low gain", -12, 12, 0, "dB", group="Low")
tm = g.knob("midThr", "Mid threshold", -50, 0, -20, "dB", group="Mid"); gm = g.knob("midGain", "Mid gain", -12, 12, 0, "dB", group="Mid")
th = g.knob("highThr", "High threshold", -50, 0, -22, "dB", group="High"); gh = g.knob("highGain", "High gain", -12, 12, 0, "dB", group="High")
ra = g.knob("ratio", "Ratio", 1, 10, 3, ":1"); out = g.knob("output", "Output", -12, 12, 0, "dB")
g.block("in", "input", col=0, row=1)
for r, band, t_, g_, at, rl in ((0, "low", tl, gl, 30, 220), (1, "mid", tm, gm, 10, 140), (2, "high", th, gh, 3, 90)):
    g.block(band, "crossover", {"band": band, "low": x1, "high": x2}, col=1, row=r); g.wire("in", band)
    g.block(band + "C", "compressor", {"detect": "rms", "threshold": t_, "ratio": ra, "attack": at, "release": rl, "knee": 6, "makeup": g_}, col=2, row=r); g.wire(band, band + "C")
    g.wire(band + "C", "sum" if False else "outg")
g.block("outg", "gain", {"gain": out}, col=3, row=1); g.block("out", "output", col=4, row=1); g.wire("outg", "out")
g.preset("Mix polish", lowThr=-18, midThr=-20, highThr=-24, ratio=2); g.preset("Tame the low end", lowThr=-28, lowGain=2, ratio=4)
g.preset("Vocal smoother", xlow=250, xhigh=4000, midThr=-24, highThr=-28, ratio=3, highGain=1); g.preset("Loud and even", lowThr=-26, midThr=-26, highThr=-26, ratio=4, output=4)
P.append(g.done())

g = G("deesser-pro", "De-esser Pro", "compressor", "plugins", "A split-band de-esser: only the sharp S range is turned down, so the rest of the voice stays untouched.")
f = g.knob("freq", "Frequency", 3000, 11000, 5500, "Hz", True); thr = g.knob("threshold", "Threshold", -50, 0, -28, "dB"); ra = g.knob("amount", "Amount", 2, 12, 6, ":1")
g.block("in", "input", col=0, row=1)
g.block("body", "crossover", {"band": "low", "low": f, "high": 20000}, col=1, row=0); g.wire("in", "body")
g.block("ess", "crossover", {"band": "high", "low": 20, "high": f}, col=1, row=2); g.wire("in", "ess")
g.block("duck", "compressor", {"threshold": thr, "ratio": ra, "attack": 0.3, "release": 60, "knee": 4}, col=2, row=2); g.wire("ess", "duck")
g.block("out", "output", col=3, row=1); g.wire("body", "out"); g.wire("duck", "out")
g.preset("Female vocal", freq=7000, threshold=-30, amount=6); g.preset("Male vocal", freq=5000, threshold=-28, amount=5); g.preset("Strong", freq=6000, threshold=-38, amount=10)
P.append(g.done())

g = G("transient-shaper", "Transient Shaper", "dynamics", "plugins", "More or less attack and more or less sustain, at any level: punch up drums, soften a pick, tighten a room.")
a = g.knob("attack", "Attack", -100, 100, 30, "%"); s = g.knob("sustain", "Sustain", -100, 100, 0, "%"); o = g.knob("output", "Output", -12, 12, 0, "dB")
g.chain(g.block("in", "input"), g.block("shape", "transient", {"attack": a, "sustain": s, "level": o}), g.block("out", "output"))
g.preset("Drum punch", attack=60, sustain=-10); g.preset("Tighten the room", attack=10, sustain=-60); g.preset("Soften the pick", attack=-50, sustain=10); g.preset("Long sustain", attack=0, sustain=60, output=-3)
P.append(g.done())

g = G("gate", "Gate", "dynamics", "free", "Quiets the sound when it drops under the threshold: spill, hum and noise between notes. The basic gate.")
thr = g.knob("threshold", "Threshold", -80, 0, -45, "dB"); rng = g.knob("range", "Range", -90, 0, -60, "dB"); hold = g.knob("hold", "Hold", 0, 400, 40, "ms")
rl = g.knob("release", "Release", 10, 1500, 150, "ms", True)
g.chain(g.block("in", "input"), g.block("gate", "gate", {"threshold": thr, "range": rng, "attack": 0.5, "hold": hold, "release": rl}), g.block("out", "output"))
g.preset("Tom", threshold=-30, range=-40, hold=60, release=200); g.preset("Guitar noise", threshold=-55, range=-80, hold=20, release=120); g.preset("Gentle", threshold=-50, range=-15, release=300)
P.append(g.done())

# ================================================================ EQ
g = G("eq-4band", "4-Band EQ", "eq", "free", "Low and high shelves with two mids. The basic EQ.")
k = {}
for pid, name, lo, hi, d in (("lowF", "Low", 30, 400, 100), ("mid1F", "Low mid", 150, 2000, 400), ("mid2F", "High mid", 800, 8000, 2500), ("highF", "High", 2500, 16000, 8000)):
    k[pid] = g.knob(pid, name + " frequency", lo, hi, d, "Hz", True, name); k[pid[:-1] + "G"] = g.knob(pid[:-1] + "G", name + " gain", -15, 15, 0, "dB", group=name)
g.chain(g.block("in", "input"), g.block("low", "eq", {"mode": "lowshelf", "freq": k["lowF"], "gain": k["lowG"], "q": 0.7}), g.block("m1", "eq", {"mode": "peak", "freq": k["mid1F"], "gain": k["mid1G"], "q": 0.9}),
        g.block("m2", "eq", {"mode": "peak", "freq": k["mid2F"], "gain": k["mid2G"], "q": 0.9}), g.block("high", "eq", {"mode": "highshelf", "freq": k["highF"], "gain": k["highG"], "q": 0.7}), g.block("out", "output"))
g.preset("Vocal clarity", mid1G=-2, mid2G=2, highG=2); g.preset("Warm keys", lowG=2, mid2G=-1.5, highG=-2); g.preset("Kick", lowF=60, lowG=4, mid1F=350, mid1G=-5, mid2F=3500, mid2G=3)
P.append(g.done())

g = G("eq-8band", "8-Band Parametric EQ", "eq", "plugins", "A full parametric EQ: low and high cut, shelves and four fully adjustable bells.")
hp = g.knob("hpF", "Low cut", 20, 500, 20, "Hz", True, "Cuts"); lp = g.knob("lpF", "High cut", 2000, 20000, 20000, "Hz", True, "Cuts")
ls = (g.knob("lsF", "Low shelf frequency", 30, 500, 100, "Hz", True, "Low shelf"), g.knob("lsG", "Low shelf gain", -15, 15, 0, "dB", group="Low shelf"))
bands = []
for i, d in enumerate((200, 800, 2500, 6000)):
    n = str(i + 1)
    bands.append((g.knob("b" + n + "F", "Band " + n + " frequency", 30, 18000, d, "Hz", True, "Band " + n), g.knob("b" + n + "G", "Band " + n + " gain", -18, 18, 0, "dB", group="Band " + n), g.knob("b" + n + "Q", "Band " + n + " width (Q)", 0.2, 12, 1, "", True, "Band " + n)))
hs = (g.knob("hsF", "High shelf frequency", 2000, 18000, 9000, "Hz", True, "High shelf"), g.knob("hsG", "High shelf gain", -15, 15, 0, "dB", group="High shelf"))
ids = [g.block("in", "input"), g.block("hp", "filter", {"mode": "highpass", "freq": hp, "q": 0.7, "slope": 24}), g.block("ls", "eq", {"mode": "lowshelf", "freq": ls[0], "gain": ls[1], "q": 0.7})]
for i, (f_, g_, q_) in enumerate(bands):
    ids.append(g.block("b" + str(i + 1), "eq", {"mode": "peak", "freq": f_, "gain": g_, "q": q_}))
ids += [g.block("hs", "eq", {"mode": "highshelf", "freq": hs[0], "gain": hs[1], "q": 0.7}), g.block("lp", "filter", {"mode": "lowpass", "freq": lp, "q": 0.7, "slope": 24}), g.block("out", "output")]
g.chain(*ids)
g.preset("Vocal", hpF=90, b1F=300, b1G=-3, b1Q=1.2, b3F=3200, b3G=2.5, hsG=2); g.preset("Acoustic guitar", hpF=80, b1F=200, b1G=-4, b2F=900, b2G=-1.5, b4F=7000, b4G=2.5)
g.preset("Snare", hpF=70, b1F=220, b1G=3, b2F=900, b2G=-4, b2Q=2, b3F=5000, b3G=3); g.preset("Telephone", hpF=400, lpF=3500, b2F=1500, b2G=6, b2Q=0.8)
P.append(g.done())

g = G("tilt-eq", "Tilt EQ", "eq", "plugins", "One knob tips the whole sound darker or brighter around a centre point. Fast, musical tone shaping.")
tilt = g.knob("tilt", "Tilt", -6, 6, 0, "dB"); piv = g.knob("pivot", "Centre", 250, 4000, 900, "Hz", True); o = g.knob("output", "Output", -12, 12, 0, "dB")
g.block("in", "input", col=0, row=1); g.block("t", "param", {"param": "tilt"}, col=0, row=0)
g.block("neg", "math", {"op": "negate"}, col=1, row=0); g.wire("t", "neg", "a")
g.block("lo", "eq", {"mode": "lowshelf", "freq": piv, "q": 0.5}, col=2, row=1); g.wire("in", "lo"); g.wire("neg", "lo", "gain")
g.block("hi", "eq", {"mode": "highshelf", "freq": piv, "q": 0.5}, col=3, row=1); g.wire("lo", "hi"); g.wire("t", "hi", "gain")
g.block("o", "gain", {"gain": o}, col=4, row=1); g.wire("hi", "o"); g.block("out", "output", col=5, row=1); g.wire("o", "out")
g.preset("Brighter", tilt=2.5); g.preset("Warmer", tilt=-2.5); g.preset("Air on top", tilt=4, pivot=2500); g.preset("Darken cymbals", tilt=-4, pivot=3000)
P.append(g.done())

g = G("low-high-cut", "Low & High Cut", "eq", "free", "Takes away rumble at the bottom and hiss at the top. The basic filter.")
lc = g.knob("lowcut", "Low cut", 20, 800, 80, "Hz", True); hc = g.knob("highcut", "High cut", 1500, 20000, 18000, "Hz", True)
g.chain(g.block("in", "input"), g.block("hp", "filter", {"mode": "highpass", "freq": lc, "q": 0.7, "slope": 24}), g.block("lp", "filter", {"mode": "lowpass", "freq": hc, "q": 0.7, "slope": 24}), g.block("out", "output"))
g.preset("Vocal", lowcut=100, highcut=18000); g.preset("Clean up guitar", lowcut=120, highcut=10000); g.preset("Radio", lowcut=500, highcut=3500)
P.append(g.done())

# ================================================================ character and modulation
g = G("tape-saturation", "Tape Saturation", "saturation", "plugins", "The warmth of tape: soft saturation (4x oversampled, no harsh aliasing), a little low-end bump and a gentle top.")
d = g.knob("drive", "Drive", 0, 24, 8, "dB"); bump = g.knob("bump", "Low bump", 0, 4, 1.5, "dB"); tone = g.knob("tone", "Top", 6000, 20000, 15000, "Hz", True)
o = g.knob("output", "Output", -18, 6, -4, "dB"); mix = g.knob("mix", "Mix", 0, 1, 1)
g.chain(g.block("in", "input"), g.block("hb", "eq", {"mode": "peak", "freq": 90, "q": 1.1, "gain": bump}),
        g.block("tape", "drive", {"mode": "tape", "drive": d, "tone": tone, "level": o, "mix": 1, "oversample": 4}))
mixed(g, "tape", mix, "linear")
g.preset("Warm mix bus", drive=4, bump=1, output=-2); g.preset("Vocal glow", drive=8, bump=0.5, tone=16000, output=-4); g.preset("Hot drums", drive=16, bump=2.5, tone=12000, output=-9); g.preset("Lo-fi tape", drive=20, tone=7000, output=-10)
P.append(g.done())

g = G("exciter", "Exciter", "saturation", "plugins", "Adds fresh harmonics on top for presence and air, without simply turning up the treble.")
f = g.knob("freq", "Frequency", 1000, 10000, 3500, "Hz", True); amt = g.knob("amount", "Amount", -40, 0, -14, "dB"); col = g.knob("color", "Colour", 0, 30, 14, "dB")
g.block("in", "input", col=0, row=1)
g.block("hp", "filter", {"mode": "highpass", "freq": f, "q": 0.7, "slope": 24}, col=1, row=0); g.wire("in", "hp")
g.block("gen", "drive", {"mode": "tube", "drive": col, "tone": 18000, "level": 0, "mix": 1, "oversample": 4}, col=2, row=0); g.wire("hp", "gen")
g.block("hp2", "filter", {"mode": "highpass", "freq": f, "q": 0.7}, col=3, row=0); g.wire("gen", "hp2")
g.block("amt", "gain", {"gain": amt}, col=4, row=0); g.wire("hp2", "amt")
g.block("out", "output", col=5, row=1); g.wire("in", "out"); g.wire("amt", "out")
g.preset("Vocal presence", freq=3500, amount=-14, color=12); g.preset("Air", freq=8000, amount=-12, color=10); g.preset("Acoustic sparkle", freq=5000, amount=-16, color=18)
P.append(g.done())

g = G("chorus", "Chorus", "modulation", "free", "Thickens the sound with a gently moving copy of itself. The basic chorus.")
r = g.knob("rate", "Speed", 0.05, 5, 0.8, "Hz", True); dp = g.knob("depth", "Depth", 0, 1, 0.5); mix = g.knob("mix", "Mix", 0, 1, 0.5)
g.chain(g.block("in", "input"), g.block("ch", "chorus", {"rate": r, "depth": dp, "mix": mix}), g.block("out", "output"))
g.preset("Subtle", rate=0.5, depth=0.3, mix=0.35); g.preset("Classic", rate=0.9, depth=0.55, mix=0.5); g.preset("Seasick", rate=3, depth=0.9, mix=0.6)
P.append(g.done())

g = G("dimension-chorus", "Dimension Chorus", "modulation", "plugins", "Two choruses against each other for a wide, still, shimmering width, with no wobble. Lovely on keys, pads and clean guitar.")
r = g.knob("rate", "Speed", 0.1, 2, 0.45, "Hz", True); dp = g.knob("depth", "Depth", 0, 1, 0.45); wid = g.knob("width", "Width", 0, 2, 1.5); mix = g.knob("mix", "Mix", 0, 1, 0.5)
g.chain(g.block("in", "input"), g.block("a", "chorus", {"rate": r, "depth": dp, "mix": 1}), g.block("sw", "stereo", {"mode": "swap"}), g.block("b", "chorus", {"rate": 0.63, "depth": dp, "mix": 0.5}),
        g.block("sw2", "stereo", {"mode": "swap", "width": wid}))
mixed(g, "sw2", mix, "linear")
g.preset("Mode 1", depth=0.3, rate=0.35, mix=0.4); g.preset("Mode 2", depth=0.45, rate=0.45, mix=0.5); g.preset("Mode 3", depth=0.65, rate=0.6, mix=0.55); g.preset("Mode 4", depth=0.85, rate=0.8, mix=0.6, width=1.8)
P.append(g.done())

g = G("rotary-speaker", "Rotary Speaker", "modulation", "plugins", "The spinning organ speaker: horn and drum at their own speeds, speeding up and slowing down with weight. Turn Speed for chorale or tremolo.")
sp = g.knob("speed", "Speed (slow ↔ fast)", 0, 1, 0); d = g.knob("drive", "Drive", 0, 24, 6, "dB"); dp = g.knob("depth", "Depth", 0, 1, 0.9); mix = g.knob("mix", "Mix", 0, 1, 1)
g.chain(g.block("in", "input"), g.block("amp", "drive", {"mode": "tube", "drive": d, "tone": 7000, "level": -4, "mix": 1, "oversample": 2}), g.block("rot", "rotary", {"speed": sp, "depth": dp, "mix": mix}), g.block("out", "output"))
g.preset("Chorale (slow)", speed=0); g.preset("Tremolo (fast)", speed=1); g.preset("Gospel organ", speed=1, drive=12); g.preset("Gentle Wurli", speed=0.2, drive=2, depth=0.6, mix=0.7)
P.append(g.done())

g = G("tremolo-autopan", "Tremolo / Auto-pan", "modulation", "free", "Pulses the volume, or spreads it so it moves left and right. The basic tremolo.")
r = g.knob("rate", "Speed", 0.5, 12, 4.5, "Hz", True); dp = g.knob("depth", "Depth", 0, 1, 0.55); spread = g.knob("spread", "Left ↔ right", 0, 180, 0, "°")
g.chain(g.block("in", "input"), g.block("t", "tremolo", {"rate": r, "depth": dp, "stereo": spread, "shape": "sine"}), g.block("out", "output"))
g.preset("Amp tremolo", rate=5, depth=0.5); g.preset("Slow pulse", rate=1.5, depth=0.7); g.preset("Auto-pan", rate=1, depth=0.9, spread=180)
P.append(g.done())

g = G("lofi-filter", "Lo-Fi Filter", "saturation", "plugins", "Thin, crunchy and small: fewer bits, a lower sample rate and a narrow band. For intros and breakdowns.")
bits = g.knob("bits", "Bits", 4, 16, 10, "bits"); rate = g.knob("rate", "Sample rate", 2000, 24000, 11000, "Hz", True); lc = g.knob("lowcut", "Low cut", 100, 1500, 350, "Hz", True)
hc = g.knob("highcut", "High cut", 1500, 12000, 4000, "Hz", True); d = g.knob("drive", "Drive", 0, 24, 6, "dB"); mix = g.knob("mix", "Mix", 0, 1, 1)
g.chain(g.block("in", "input"), g.block("hp", "filter", {"mode": "highpass", "freq": lc, "q": 0.8, "slope": 24}), g.block("lp", "filter", {"mode": "lowpass", "freq": hc, "q": 1.1, "slope": 24}),
        g.block("crush", "bitcrush", {"bits": bits, "rate": rate, "mix": 1}), g.block("grit", "drive", {"mode": "soft", "drive": d, "tone": 9000, "level": -3, "mix": 1, "oversample": 2}))
mixed(g, "grit", mix, "linear")
g.preset("AM radio", lowcut=500, highcut=3200, bits=12, rate=16000); g.preset("Old sampler", bits=12, rate=9000, lowcut=120, highcut=8000, drive=3); g.preset("Crushed", bits=6, rate=5000, drive=12)
P.append(g.done())

g = G("phaser", "Phaser", "modulation", "plugins", "A smooth, sweeping phaser from subtle movement to deep swirl.")
r = g.knob("rate", "Speed", 0.05, 6, 0.4, "Hz", True); dp = g.knob("depth", "Depth", 0, 1, 0.7); fb = g.knob("feedback", "Resonance", -0.9, 0.9, 0.3); mix = g.knob("mix", "Mix", 0, 1, 0.5)
g.chain(g.block("in", "input"), g.block("ph", "phaser", {"rate": r, "depth": dp, "feedback": fb, "mix": mix, "stages": 6}), g.block("out", "output"))
g.preset("Slow swirl", rate=0.2, depth=0.8, feedback=0.4); g.preset("Funky", rate=1.2, depth=0.6, feedback=0.5); g.preset("Subtle", rate=0.3, depth=0.4, feedback=0.1, mix=0.35)
P.append(g.done())

g = G("flanger", "Flanger", "modulation", "plugins", "The jet-plane sweep: a very short moving delay with feedback.")
r = g.knob("rate", "Speed", 0.05, 4, 0.25, "Hz", True); dp = g.knob("depth", "Depth", 0, 1, 0.7); fb = g.knob("feedback", "Feedback", -0.9, 0.9, 0.6); mix = g.knob("mix", "Mix", 0, 1, 0.5)
g.chain(g.block("in", "input"), g.block("fl", "chorus", {"mode": "flanger", "rate": r, "depth": dp, "feedback": fb, "mix": mix}), g.block("out", "output"))
g.preset("Jet", rate=0.15, depth=0.9, feedback=0.75); g.preset("Gentle", rate=0.3, depth=0.4, feedback=0.3, mix=0.35); g.preset("Metallic", rate=0.5, depth=0.6, feedback=-0.8)
P.append(g.done())

# ================================================================ stereo and level
g = G("stereo-widener", "Stereo Widener", "stereo", "plugins", "Makes the sound wider, while keeping the bass in the middle so it stays solid (and safe in mono).")
wid = g.knob("width", "Width", 0, 2, 1.5); bm = g.knob("bassMono", "Bass mono below", 40, 400, 140, "Hz", True); o = g.knob("output", "Output", -12, 6, 0, "dB")
g.block("in", "input", col=0, row=1)
g.block("lowb", "crossover", {"band": "low", "low": bm, "high": 20000}, col=1, row=0); g.wire("in", "lowb")
g.block("mono", "stereo", {"mode": "mono"}, col=2, row=0); g.wire("lowb", "mono")
g.block("highb", "crossover", {"band": "high", "low": 20, "high": bm}, col=1, row=2); g.wire("in", "highb")
g.block("wide", "stereo", {"width": wid}, col=2, row=2); g.wire("highb", "wide")
g.block("o", "gain", {"gain": o}, col=3, row=1); g.wire("mono", "o"); g.wire("wide", "o")
g.block("out", "output", col=4, row=1); g.wire("o", "out")
g.preset("Wider", width=1.4); g.preset("Very wide", width=1.9, bassMono=180); g.preset("Narrow", width=0.6); g.preset("Mono check", width=0)
P.append(g.done())

g = G("limiter", "Limiter", "limiter", "free", "Never lets the sound go over the ceiling. The basic limiter.")
inp = g.knob("input", "Input", 0, 18, 0, "dB"); c = g.knob("ceiling", "Ceiling", -12, 0, -1, "dB"); rl = g.knob("release", "Release", 10, 800, 80, "ms", True)
g.chain(g.block("in", "input"), g.block("g", "gain", {"gain": inp}), g.block("lim", "limiter", {"ceiling": c, "release": rl}), g.block("out", "output"))
g.preset("Safety", input=0, ceiling=-1); g.preset("Louder", input=4, ceiling=-1, release=60); g.preset("Stream", input=3, ceiling=-2, release=120)
P.append(g.done())

g = G("truepeak-limiter", "True-Peak Limiter", "limiter", "plugins", "A transparent mastering limiter: it looks ahead to catch peaks smoothly and counts the peaks between samples, so the ceiling holds after any conversion.")
inp = g.knob("input", "Input", 0, 18, 3, "dB"); c = g.knob("ceiling", "Ceiling", -12, 0, -1, "dB"); rl = g.knob("release", "Release", 10, 800, 100, "ms", True)
g.chain(g.block("in", "input"), g.block("g", "gain", {"gain": inp}), g.block("lim", "limiter", {"detect": "truepeak", "lookahead": 5, "ceiling": c, "release": rl}), g.block("out", "output"))
g.preset("Streaming (-1 dBTP)", input=3, ceiling=-1, release=100); g.preset("Loud master", input=8, ceiling=-1, release=60); g.preset("Broadcast", input=4, ceiling=-2, release=150)
P.append(g.done())


def main():
    os.makedirs(OUT, exist_ok=True)
    keep = set()
    for p in P:
        f = p["id"] + ".cmfx.json"; keep.add(f)
        with open(os.path.join(OUT, f), "w", encoding="utf-8") as h:
            json.dump(p, h, indent=1, ensure_ascii=False); h.write("\n")
    for f in os.listdir(OUT):
        if f.endswith(".cmfx.json") and f not in keep:
            os.remove(os.path.join(OUT, f))
    free = sum(1 for p in P if p["tier"] == "free")
    print("%d plugins (%d free, %d with Central Plugins) -> %s" % (len(P), free, len(P) - free, os.path.relpath(OUT, ROOT)))


if __name__ == "__main__":
    main()
