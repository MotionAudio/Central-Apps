"""Central FX collection, 10.8: more effects for every app (tools/make-cmfx-collection.py adds these to the rest).

Two kinds:
  * built from the engine's blocks (reverbs, delays, a channel strip, a vocal chain, filters, pitch, modulation...), the
    same way as the 10.3 collection;
  * ports of Airwindows effects by Chris Johnson (github.com/airwindows/airwindows, MIT licence - "Copyright (c) 2018
    Chris Johnson"), written in the plugin builder's code language: Density, PurestDrive, Spiral, ClipOnly2, PurestWarm,
    Tube2, Mackity, ButterComp2 and Slew2. Each one's algorithm is Chris's, line for line (in 32-bit floats; the
    noise-shaping dither at the end of his plugins is left out, as the apps mix in floating point). The knobs show
    units a person can use in place of 0-1 sliders, mapped onto his. CREDITS.md and the plugins' descriptions say so.

The basic one of each new kind is free (tier "free"); the better ones come with the Central Plugins plan ("plugins")."""

AW = "Airwindows (Chris Johnson, MIT licence)"


def code_plugin(pid, name, family, tier, description, knobs, code, presets=(), author=None):
    p = {"format": "central-fx", "version": 1, "id": pid, "name": name, "author": author or "Motion Audio", "family": family, "tier": tier,
         "description": description, "params": [], "presets": [], "graph": {"blocks": [], "wires": []}, "code": code.strip() + "\n"}
    for k in knobs:
        pid_, nm, lo, hi, d = k[:5]
        q = {"id": pid_, "name": nm, "min": lo, "max": hi, "default": d}
        if len(k) > 5 and k[5]:
            q["unit"] = k[5]
        if len(k) > 6 and k[6]:
            q["curve"] = "log"
        p["params"].append(q)
    ids = {q["id"] for q in p["params"]}
    for nm, vals in presets:
        for k in vals:
            assert k in ids, (pid, nm, k)
        p["presets"].append({"name": nm, "values": vals})
    return p


def more(G):
    P = []

    # ============================================================ reverbs
    g = G("plate-reverb", "Plate Reverb", "reverb", "free", "A smooth, bright plate: the classic for vocals and snares. The free one.")
    mix = g.knob("mix", "Mix", 0, 1, 0.2); dec = g.knob("decay", "Decay", 0.2, 0.85, 0.5); pre = g.knob("predelay", "Pre-delay", 0, 120, 20, "ms")
    g.block("in", "input", col=0, row=1)
    g.chain("in", g.block("hp", "filter", {"mode": "highpass", "freq": 180, "q": 0.7}), g.block("plate", "reverb", {"size": dec, "damp": 0.2, "mix": 1, "predelay": pre, "width": 1, "mod": 0.6}))
    g.block("blend", "mix", {"mix": mix, "law": "equal"}); g.wire("plate", "blend", "wet"); g.wire("in", "blend", "dry"); g.chain("blend", g.block("out", "output"))
    g.preset("Vocal", mix=0.18, decay=0.45, predelay=25); g.preset("Snare", mix=0.25, decay=0.35, predelay=5); g.preset("Long plate", mix=0.28, decay=0.75, predelay=40)
    P.append(g.done())

    g = G("hall-reverb", "Hall Reverb", "reverb", "free", "A concert hall: wide, warm and long. The free one.")
    mix = g.knob("mix", "Mix", 0, 1, 0.25); size = g.knob("size", "Size", 0.4, 0.95, 0.7); dark = g.knob("damp", "Darkness", 0, 1, 0.5); pre = g.knob("predelay", "Pre-delay", 0, 150, 30, "ms")
    g.chain(g.block("in", "input"), g.block("hall", "reverb", {"size": size, "damp": dark, "mix": mix, "predelay": pre, "width": 1, "mod": 0.45}), g.block("out", "output"))
    g.preset("Concert hall", mix=0.25, size=0.75, damp=0.45); g.preset("Strings", mix=0.32, size=0.85, damp=0.55, predelay=40); g.preset("Small hall", mix=0.2, size=0.5, damp=0.4)
    P.append(g.done())

    g = G("cathedral", "Cathedral", "reverb", "plugins", "Stone and height: a huge, slow tail with the low end kept clear. For pads, choirs, piano and the big ending.")
    mix = g.knob("mix", "Mix", 0, 1, 0.3); size = g.knob("size", "Size", 0.75, 1, 0.94); pre = g.knob("predelay", "Pre-delay", 0, 250, 60, "ms")
    bright = g.knob("bright", "Brightness", -9, 6, -2, "dB"); lc = g.knob("lowcut", "Low cut", 60, 600, 180, "Hz", True)
    g.block("in", "input", col=0, row=1)
    g.chain("in", g.block("hp", "filter", {"mode": "highpass", "freq": lc, "q": 0.7, "slope": 24}), g.block("verb", "reverb", {"size": size, "damp": 0.35, "mix": 1, "predelay": pre, "width": 1, "mod": 0.7}),
            g.block("air", "eq", {"mode": "highshelf", "freq": 5000, "q": 0.7, "gain": bright}))
    g.block("blend", "mix", {"mix": mix, "law": "equal"}); g.wire("air", "blend", "wet"); g.wire("in", "blend", "dry"); g.chain("blend", g.block("out", "output"))
    g.preset("Cathedral", mix=0.3); g.preset("Choir loft", mix=0.38, size=0.97, predelay=90, bright=-3); g.preset("Ambient wash", mix=0.55, size=1, predelay=120, bright=-4, lowcut=300)
    P.append(g.done())

    g = G("chamber", "Chamber", "reverb", "plugins", "An echo chamber: dense and natural, the sound of a lot of classic records. Sits a voice or a piano in a real room.")
    mix = g.knob("mix", "Mix", 0, 1, 0.22); size = g.knob("size", "Size", 0.25, 0.7, 0.45); dark = g.knob("damp", "Darkness", 0, 1, 0.35); pre = g.knob("predelay", "Pre-delay", 0, 80, 12, "ms")
    g.block("in", "input", col=0, row=1)
    g.chain("in", g.block("hp", "filter", {"mode": "highpass", "freq": 120, "q": 0.7}), g.block("room", "reverb", {"size": size, "damp": dark, "mix": 1, "predelay": pre, "width": 0.85, "mod": 0.2}),
            g.block("mids", "eq", {"mode": "peak", "freq": 1200, "q": 0.8, "gain": 1.5}))
    g.block("blend", "mix", {"mix": mix, "law": "equal"}); g.wire("mids", "blend", "wet"); g.wire("in", "blend", "dry"); g.chain("blend", g.block("out", "output"))
    g.preset("Vocal chamber", mix=0.2); g.preset("Piano", mix=0.26, size=0.55, damp=0.4); g.preset("Drum room", mix=0.18, size=0.3, damp=0.25, predelay=2)
    P.append(g.done())

    g = G("spring-reverb", "Spring Reverb", "reverb", "plugins", "The springs in the back of a guitar amp: bouncy, a little metallic, and right for surf, country and vintage keys.")
    mix = g.knob("mix", "Mix", 0, 1, 0.3); dec = g.knob("decay", "Decay", 0.15, 0.6, 0.35); tone = g.knob("tone", "Tone", 1500, 6000, 3200, "Hz", True); drip = g.knob("drip", "Drip", 0, 0.75, 0.45)
    g.block("in", "input", col=0, row=1)
    g.chain("in", g.block("hp", "filter", {"mode": "highpass", "freq": 300, "q": 0.6}), g.block("bounce", "delay", {"time": 31, "feedback": drip, "mix": 1, "tone": tone}),
            g.block("tank", "reverb", {"size": dec, "damp": 0.55, "mix": 1, "predelay": 0, "width": 0.6, "mod": 0.9}), g.block("lp", "filter", {"mode": "lowpass", "freq": tone, "q": 1.4}))
    g.block("blend", "mix", {"mix": mix, "law": "equal"}); g.wire("lp", "blend", "wet"); g.wire("in", "blend", "dry"); g.chain("blend", g.block("out", "output"))
    g.preset("Amp spring", mix=0.28); g.preset("Surf", mix=0.45, decay=0.45, drip=0.65, tone=3800); g.preset("Subtle", mix=0.15, drip=0.3)
    P.append(g.done())

    g = G("gated-reverb", "Gated Reverb", "reverb", "plugins", "The big 80s drum sound: a large room that stops dead. The gate follows the dry sound, so the tail shuts with each hit.")
    mix = g.knob("mix", "Mix", 0, 1, 0.45); size = g.knob("size", "Size", 0.4, 0.9, 0.75); hold = g.knob("hold", "Gate time", 40, 500, 180, "ms", True); thr = g.knob("threshold", "Gate threshold", -60, -10, -35, "dB")
    g.block("in", "input", col=0, row=1)
    g.block("verb", "reverb", {"size": size, "damp": 0.3, "mix": 1, "predelay": 0, "width": 1, "mod": 0.2}, col=1, row=1); g.wire("in", "verb")
    g.block("gate", "gate", {"threshold": thr, "range": -80, "attack": 0.5, "hold": hold, "release": 25}, col=2, row=1); g.wire("verb", "gate"); g.wire("in", "gate", "key")
    g.block("blend", "mix", {"mix": mix, "law": "equal"}, col=3, row=1); g.wire("gate", "blend", "wet"); g.wire("in", "blend", "dry")
    g.block("out", "output", col=4, row=1); g.wire("blend", "out")
    g.preset("80s snare", mix=0.5, size=0.8, hold=200); g.preset("Tight toms", mix=0.4, size=0.6, hold=120); g.preset("Huge", mix=0.6, size=0.9, hold=320)
    P.append(g.done())

    g = G("ducking-reverb", "Ducking Reverb", "reverb", "plugins", "A big reverb that gets out of the way while you sing or play, and blooms in the gaps. The words stay clear.")
    mix = g.knob("mix", "Mix", 0, 1, 0.35); size = g.knob("size", "Size", 0.3, 0.95, 0.75); duck = g.knob("duck", "Duck threshold", -50, 0, -26, "dB"); rel = g.knob("release", "Bloom", 80, 1500, 400, "ms", True)
    g.block("in", "input", col=0, row=1)
    g.block("verb", "reverb", {"size": size, "damp": 0.4, "mix": 1, "predelay": 30, "width": 1, "mod": 0.5}, col=1, row=1); g.wire("in", "verb")
    g.block("duck", "compressor", {"threshold": duck, "ratio": 8, "attack": 5, "release": rel, "knee": 6}, col=2, row=1); g.wire("verb", "duck"); g.wire("in", "duck", "key")
    g.block("blend", "mix", {"mix": mix, "law": "equal"}, col=3, row=1); g.wire("duck", "blend", "wet"); g.wire("in", "blend", "dry")
    g.block("out", "output", col=4, row=1); g.wire("blend", "out")
    g.preset("Lead vocal", mix=0.32, duck=-28); g.preset("Ambient guitar", mix=0.45, size=0.9, duck=-22, release=700); g.preset("Speech", mix=0.2, size=0.5, duck=-35, release=250)
    P.append(g.done())

    # ============================================================ delays
    g = G("slapback", "Slapback", "delay", "free", "One quick repeat: the rockabilly vocal and the country guitar. The free short delay.")
    t = g.knob("time", "Time", 40, 220, 110, "ms"); fb = g.knob("feedback", "Repeats", 0, 0.4, 0.1); tone = g.knob("tone", "Tone", 1500, 12000, 5000, "Hz", True); mix = g.knob("mix", "Mix", 0, 1, 0.3)
    g.chain(g.block("in", "input"), g.block("slap", "delay", {"time": t, "feedback": fb, "mix": mix, "tone": tone}), g.block("out", "output"))
    g.preset("Vocal slap", time=100, mix=0.25); g.preset("Country guitar", time=130, feedback=0.15, mix=0.35); g.preset("Doubled", time=45, feedback=0, mix=0.3)
    P.append(g.done())

    g = G("analog-delay", "Analog Delay", "delay", "plugins", "Dark, warm repeats that soften as they go, with a little grit: the bucket-brigade pedal sound.")
    t = g.knob("time", "Time", 40, 900, 380, "ms", True); fb = g.knob("feedback", "Repeats", 0, 0.9, 0.45); mix = g.knob("mix", "Mix", 0, 1, 0.3); grit = g.knob("grit", "Grit", 0, 18, 6, "dB")
    g.p["params"][0] = dict([("id", g.p["params"][0]["id"]), ("tempoSync", True)] + [(k, v) for k, v in g.p["params"][0].items() if k != "id"])
    g.block("in", "input", col=0, row=1)
    g.block("echo", "delay", {"time": t, "feedback": fb, "mix": 1, "tone": 2600}, col=1, row=0); g.wire("in", "echo")
    g.block("bbd", "drive", {"mode": "tape", "drive": grit, "tone": 3200, "level": -3, "mix": 1}, col=2, row=0); g.wire("echo", "bbd")
    g.block("wow", "chorus", {"rate": 0.4, "depth": 0.15, "mix": 1}, col=3, row=0); g.wire("bbd", "wow")
    g.block("blend", "mix", {"mix": mix, "law": "equal"}, col=4, row=1); g.wire("wow", "blend", "wet"); g.wire("in", "blend", "dry")
    g.block("out", "output", col=5, row=1); g.wire("blend", "out")
    g.preset("Warm echo", time=380, feedback=0.45, mix=0.3); g.preset("Ambient", time=600, feedback=0.7, mix=0.35, grit=4); g.preset("Slap", time=120, feedback=0.15, mix=0.3, grit=9)
    P.append(g.done())

    g = G("multi-tap", "Multi-Tap Delay", "delay", "plugins", "Three repeats at once - the beat, the dotted eighth and the half - spread across the stereo field. Rhythmic and wide.")
    t = g.knob("time", "Beat", 150, 1000, 500, "ms", True); mix = g.knob("mix", "Mix", 0, 1, 0.3); fb = g.knob("feedback", "Repeats", 0, 0.7, 0.25); tone = g.knob("tone", "Tone", 1500, 12000, 4500, "Hz", True)
    g.p["params"][0] = dict([("id", g.p["params"][0]["id"]), ("tempoSync", True)] + [(k, v) for k, v in g.p["params"][0].items() if k != "id"])
    g.block("in", "input", col=0, row=1); g.block("beat", "param", {"param": "time"}, col=0, row=3)
    for i, (k, pan, lvl) in enumerate(((0.75, -0.7, -3), (1.0, 0.0, -1), (1.5, 0.7, -5))):
        g.block("t%d" % i, "math", {"op": "multiply", "b": k}, col=1, row=i); g.wire("beat", "t%d" % i, "a")
        g.block("d%d" % i, "delay", {"feedback": fb, "mix": 1, "tone": tone, "maxTime": 2000}, col=2, row=i); g.wire("in", "d%d" % i); g.wire("t%d" % i, "d%d" % i, "time")
        g.block("p%d" % i, "stereo", {"pan": pan}, col=3, row=i); g.wire("d%d" % i, "p%d" % i)
        g.block("g%d" % i, "gain", {"gain": lvl}, col=4, row=i); g.wire("p%d" % i, "g%d" % i); g.wire("g%d" % i, "blend", "wet")
    g.block("blend", "mix", {"mix": mix, "law": "equal"}, col=5, row=1); g.wire("in", "blend", "dry")
    g.block("out", "output", col=6, row=1); g.wire("blend", "out")
    g.preset("Rhythmic", time=500, mix=0.3); g.preset("Wide ambience", time=700, mix=0.4, feedback=0.45, tone=3500); g.preset("Tight", time=300, mix=0.22, feedback=0.1)
    P.append(g.done())

    g = G("shimmer-delay", "Shimmer Delay", "delay", "plugins", "Repeats that climb an octave and melt into a soft reverb: the swelling worship guitar and the dreamy piano.")
    t = g.knob("time", "Time", 150, 1200, 450, "ms", True); fb = g.knob("feedback", "Repeats", 0, 0.85, 0.5); mix = g.knob("mix", "Mix", 0, 1, 0.35); shim = g.knob("shimmer", "Shimmer", 0, 1, 0.5)
    g.p["params"][0] = dict([("id", g.p["params"][0]["id"]), ("tempoSync", True)] + [(k, v) for k, v in g.p["params"][0].items() if k != "id"])
    g.block("in", "input", col=0, row=1)
    g.block("echo", "delay", {"time": t, "feedback": fb, "mix": 1, "tone": 6000}, col=1, row=0); g.wire("in", "echo")
    g.block("up", "pitch", {"semitones": 12, "mix": shim}, col=2, row=0); g.wire("echo", "up")
    g.block("verb", "reverb", {"size": 0.7, "damp": 0.35, "mix": 0.45, "predelay": 0, "width": 1, "mod": 0.6}, col=3, row=0); g.wire("up", "verb")
    g.block("blend", "mix", {"mix": mix, "law": "equal"}, col=4, row=1); g.wire("verb", "blend", "wet"); g.wire("in", "blend", "dry")
    g.block("out", "output", col=5, row=1); g.wire("blend", "out")
    g.preset("Worship swell", time=450, feedback=0.55, mix=0.38, shimmer=0.5); g.preset("Heavenly", time=700, feedback=0.7, mix=0.45, shimmer=0.75); g.preset("Subtle sparkle", time=350, feedback=0.35, mix=0.22, shimmer=0.3)
    P.append(g.done())

    g = G("ducking-delay", "Ducking Delay", "delay", "plugins", "Repeats that wait for you to stop playing or singing: busy echoes in the gaps, a clean line while you play.")
    t = g.knob("time", "Time", 60, 1200, 430, "ms", True); fb = g.knob("feedback", "Repeats", 0, 0.85, 0.45); mix = g.knob("mix", "Mix", 0, 1, 0.35); duck = g.knob("duck", "Duck threshold", -50, 0, -24, "dB")
    g.p["params"][0] = dict([("id", g.p["params"][0]["id"]), ("tempoSync", True)] + [(k, v) for k, v in g.p["params"][0].items() if k != "id"])
    g.block("in", "input", col=0, row=1)
    g.block("echo", "delay", {"time": t, "feedback": fb, "mix": 1, "tone": 5000}, col=1, row=1); g.wire("in", "echo")
    g.block("duck", "compressor", {"threshold": duck, "ratio": 10, "attack": 3, "release": 250, "knee": 6}, col=2, row=1); g.wire("echo", "duck"); g.wire("in", "duck", "key")
    g.block("blend", "mix", {"mix": mix, "law": "equal"}, col=3, row=1); g.wire("duck", "blend", "wet"); g.wire("in", "blend", "dry")
    g.block("out", "output", col=4, row=1); g.wire("blend", "out")
    g.preset("Lead guitar", time=430, feedback=0.45, mix=0.38); g.preset("Vocal throw", time=500, feedback=0.35, mix=0.3, duck=-30); g.preset("Ambient", time=750, feedback=0.65, mix=0.42, duck=-20)
    P.append(g.done())

    # ============================================================ dynamics and compressors
    g = G("channel-strip", "Channel Strip", "dynamics", "plugins", "A console channel in one: low cut, gate, three-band EQ, compressor and a touch of drive, in the order a mixing desk has them.")
    lc = g.knob("lowcut", "Low cut", 20, 400, 80, "Hz", True, "Filter"); gt = g.knob("gate", "Gate", -90, -20, -70, "dB", group="Gate")
    lo = g.knob("low", "Low", -12, 12, 0, "dB", group="EQ"); mid = g.knob("mid", "Mid", -12, 12, 0, "dB", group="EQ"); mf = g.knob("midFreq", "Mid freq", 200, 6000, 1200, "Hz", True, "EQ"); hi = g.knob("high", "High", -12, 12, 0, "dB", group="EQ")
    th = g.knob("threshold", "Threshold", -50, 0, -18, "dB", group="Compressor"); ra = g.knob("ratio", "Ratio", 1, 10, 3, ":1", group="Compressor"); mk = g.knob("makeup", "Makeup", -6, 18, 3, "dB", group="Compressor")
    dr = g.knob("drive", "Drive", 0, 18, 2, "dB", group="Output")
    g.chain(g.block("in", "input"), g.block("hp", "filter", {"mode": "highpass", "freq": lc, "q": 0.7}), g.block("gate", "gate", {"threshold": gt, "range": -40, "attack": 0.5, "hold": 30, "release": 120}),
            g.block("lo", "eq", {"mode": "lowshelf", "freq": 110, "q": 0.7, "gain": lo}), g.block("mid", "eq", {"mode": "peak", "freq": mf, "q": 0.9, "gain": mid}), g.block("hi", "eq", {"mode": "highshelf", "freq": 8000, "q": 0.7, "gain": hi}),
            g.block("comp", "compressor", {"style": "clean", "detect": "rms", "threshold": th, "ratio": ra, "attack": 8, "release": 140, "knee": 6, "makeup": mk}),
            g.block("sat", "drive", {"mode": "tape", "drive": dr, "tone": 16000, "level": 0, "mix": 1, "oversample": 2}), g.block("out", "output"))
    g.preset("Vocal", lowcut=100, mid=-1, midFreq=400, high=2.5, threshold=-20, ratio=3, makeup=4); g.preset("Acoustic guitar", lowcut=90, low=-2, mid=1.5, midFreq=2500, high=2, threshold=-18, ratio=2.5)
    g.preset("Kick drum", lowcut=30, gate=-40, low=3, mid=-4, midFreq=350, high=2, threshold=-16, ratio=4, makeup=3); g.preset("Bass", lowcut=35, low=2, mid=1.5, midFreq=800, threshold=-22, ratio=4, makeup=4, drive=6)
    P.append(g.done())

    g = G("vocal-chain", "Vocal Chain", "dynamics", "plugins", "Everything a lead vocal usually gets, in order and set up: low cut, gentle levelling, presence, air and a plate around it.")
    lc = g.knob("lowcut", "Low cut", 60, 300, 110, "Hz", True); lv = g.knob("level", "Levelling", -40, 0, -22, "dB"); pr = g.knob("presence", "Presence", -6, 9, 3, "dB")
    air = g.knob("air", "Air", 0, 9, 3, "dB"); sp = g.knob("space", "Space", 0, 0.5, 0.15)
    g.block("in", "input", col=0, row=1)
    g.chain("in", g.block("hp", "filter", {"mode": "highpass", "freq": lc, "q": 0.7, "slope": 24}), g.block("lvl", "compressor", {"style": "opto", "detect": "rms", "threshold": lv, "ratio": 3, "attack": 10, "release": 250, "knee": 10, "makeup": 8}),
            g.block("pres", "eq", {"mode": "peak", "freq": 3200, "q": 0.9, "gain": pr}), g.block("airy", "eq", {"mode": "highshelf", "freq": 12000, "q": 0.6, "gain": air}),
            g.block("plate", "reverb", {"size": 0.45, "damp": 0.2, "mix": sp, "predelay": 30, "width": 1, "mod": 0.6}), g.block("out", "output"))
    g.preset("Pop vocal", level=-24, presence=3, air=4, space=0.15); g.preset("Worship lead", level=-20, presence=2, air=3, space=0.22); g.preset("Spoken word", lowcut=90, level=-26, presence=2, air=1, space=0.05)
    P.append(g.done())

    g = G("parallel-compressor", "Parallel Compressor", "compressor", "plugins", "New York compression: a hard-squashed copy blended under the original. Punch and body without losing the hits.")
    th = g.knob("crush", "Crush", -50, -10, -32, "dB"); at = g.knob("attack", "Attack", 0.1, 40, 3, "ms", True); rl = g.knob("release", "Release", 30, 600, 90, "ms", True); bl = g.knob("blend", "Blend", 0, 1, 0.35); mk = g.knob("makeup", "Makeup", 0, 24, 12, "dB")
    g.block("in", "input", col=0, row=1)
    g.block("squash", "compressor", {"style": "fet", "detect": "peak", "threshold": th, "ratio": 12, "attack": at, "release": rl, "knee": 2, "makeup": mk}, col=1, row=0); g.wire("in", "squash")
    g.block("blend", "mix", {"mix": bl, "law": "linear"}, col=2, row=1); g.wire("squash", "blend", "wet"); g.wire("in", "blend", "dry")
    g.block("out", "output", col=3, row=1); g.wire("blend", "out")
    g.preset("Drum bus", crush=-34, attack=3, release=80, blend=0.4); g.preset("Vocal thickener", crush=-30, attack=8, release=150, blend=0.25, makeup=10); g.preset("Smash", crush=-45, attack=0.5, release=60, blend=0.5, makeup=18)
    P.append(g.done())

    g = G("expander", "Expander", "dynamics", "plugins", "A gentler gate: turns the quiet parts down by an amount instead of off, so spill and noise drop away naturally.")
    th = g.knob("threshold", "Threshold", -80, -10, -45, "dB"); rg = g.knob("range", "Range", -40, 0, -12, "dB"); rl = g.knob("release", "Release", 20, 1000, 180, "ms", True)
    g.chain(g.block("in", "input"), g.block("exp", "gate", {"threshold": th, "range": rg, "attack": 2, "hold": 20, "release": rl}), g.block("out", "output"))
    g.preset("Vocal spill", threshold=-50, range=-10); g.preset("Tom mics", threshold=-38, range=-20, release=250); g.preset("Noise", threshold=-60, range=-8, release=300)
    P.append(g.done())

    # ============================================================ EQ and filters
    g = G("vintage-eq", "Vintage EQ", "eq", "plugins", "A passive program EQ in the classic style: boost and cut the same low frequency for a big, tight bottom, and a broad, silky top.")
    lf = g.knob("lowFreq", "Low freq", 20, 100, 60, "Hz", True, "Low"); lb = g.knob("lowBoost", "Low boost", 0, 10, 3, "dB", group="Low"); la = g.knob("lowAtten", "Low cut", 0, 10, 2, "dB", group="Low")
    hf = g.knob("highFreq", "High freq", 3000, 16000, 10000, "Hz", True, "High"); hb = g.knob("highBoost", "High boost", 0, 10, 2, "dB", group="High"); ha = g.knob("highAtten", "Top cut", 0, 10, 0, "dB", group="High")
    g.block("in", "input", col=0, row=1); g.block("lf", "param", {"param": "lowFreq"}, col=0, row=3); g.block("la", "param", {"param": "lowAtten"}, col=1, row=3)
    g.block("lf2", "math", {"op": "multiply", "b": 1.8}, col=1, row=2); g.wire("lf", "lf2", "a")
    g.block("laN", "math", {"op": "negate"}, col=2, row=3); g.wire("la", "laN", "a")
    g.block("hb", "eq", {"mode": "lowshelf", "q": 0.6, "gain": lb}, col=1, row=1); g.wire("in", "hb"); g.wire("lf", "hb", "freq")
    g.block("dip", "eq", {"mode": "peak", "q": 0.7}, col=2, row=1); g.wire("hb", "dip"); g.wire("lf2", "dip", "freq"); g.wire("laN", "dip", "gain")
    g.block("hiB", "eq", {"mode": "peak", "freq": hf, "q": 0.5, "gain": hb}, col=3, row=1); g.wire("dip", "hiB")
    g.block("ha", "param", {"param": "highAtten"}, col=3, row=3); g.block("haN", "math", {"op": "negate"}, col=4, row=3); g.wire("ha", "haN", "a")
    g.block("top", "eq", {"mode": "highshelf", "freq": 18000, "q": 0.7}, col=4, row=1); g.wire("hiB", "top"); g.wire("haN", "top", "gain")
    g.block("out", "output", col=5, row=1); g.wire("top", "out")
    g.preset("Kick and bass", lowFreq=60, lowBoost=4, lowAtten=3, highBoost=0); g.preset("Vocal sheen", lowBoost=0, lowAtten=0, highFreq=12000, highBoost=3); g.preset("Master glow", lowFreq=30, lowBoost=1.5, lowAtten=1, highFreq=16000, highBoost=1.5, highAtten=0.5)
    P.append(g.done())

    g = G("air-band", "Air Band", "eq", "plugins", "Opens up the very top - breath, shimmer and space - with a wide, gentle shelf that doesn't make things harsh.")
    f = g.knob("freq", "Frequency", 8000, 20000, 14000, "Hz", True); gn = g.knob("gain", "Air", 0, 12, 4, "dB"); o = g.knob("output", "Output", -12, 6, 0, "dB")
    g.chain(g.block("in", "input"), g.block("air", "eq", {"mode": "highshelf", "freq": f, "q": 0.5, "gain": gn}), g.block("soft", "eq", {"mode": "peak", "freq": 4500, "q": 1.2, "gain": -0.8}), g.block("o", "gain", {"gain": o}), g.block("out", "output"))
    g.preset("Vocal air", freq=12000, gain=4); g.preset("Acoustic sparkle", freq=10000, gain=3); g.preset("Master", freq=16000, gain=2)
    P.append(g.done())

    g = G("low-pass", "Low-Pass Filter", "filter", "free", "Takes the top off, from a gentle darkening to a resonant synth filter. The free filter.")
    f = g.knob("cutoff", "Cutoff", 40, 20000, 4000, "Hz", True); q = g.knob("resonance", "Resonance", 0.5, 12, 0.7); mix = g.knob("mix", "Mix", 0, 1, 1)
    g.block("in", "input", col=0, row=1); g.block("lp", "filter", {"mode": "lowpass", "freq": f, "q": q, "slope": 24}, col=1, row=0); g.wire("in", "lp")
    g.block("blend", "mix", {"mix": mix}, col=2, row=1); g.wire("lp", "blend", "wet"); g.wire("in", "blend", "dry"); g.block("out", "output", col=3, row=1); g.wire("blend", "out")
    g.preset("Darker", cutoff=6000); g.preset("Underwater", cutoff=400, resonance=1.5); g.preset("Synth", cutoff=1200, resonance=6)
    P.append(g.done())

    g = G("high-pass", "High-Pass Filter", "filter", "free", "Takes the bottom away: clears rumble, thins a sound to make room, or sweeps for a build. The free one.")
    f = g.knob("cutoff", "Cutoff", 20, 8000, 120, "Hz", True); q = g.knob("resonance", "Resonance", 0.5, 12, 0.7); mix = g.knob("mix", "Mix", 0, 1, 1)
    g.block("in", "input", col=0, row=1); g.block("hp", "filter", {"mode": "highpass", "freq": f, "q": q, "slope": 24}, col=1, row=0); g.wire("in", "hp")
    g.block("blend", "mix", {"mix": mix}, col=2, row=1); g.wire("hp", "blend", "wet"); g.wire("in", "blend", "dry"); g.block("out", "output", col=3, row=1); g.wire("blend", "out")
    g.preset("Rumble", cutoff=60); g.preset("Thin it out", cutoff=400); g.preset("Build", cutoff=1500, resonance=3)
    P.append(g.done())

    g = G("telephone", "Telephone", "eq", "free", "Through a phone or a small radio: only the middle, a little crunchy. For an intro, a breakdown or a voice in a drama.")
    lo = g.knob("low", "Low cut", 200, 1000, 450, "Hz", True); hi = g.knob("high", "High cut", 1500, 5000, 3000, "Hz", True); cr = g.knob("crunch", "Crunch", 0, 24, 8, "dB")
    g.chain(g.block("in", "input"), g.block("hp", "filter", {"mode": "highpass", "freq": lo, "q": 0.9, "slope": 24}), g.block("lp", "filter", {"mode": "lowpass", "freq": hi, "q": 0.9, "slope": 24}),
            g.block("honk", "eq", {"mode": "peak", "freq": 1400, "q": 1.2, "gain": 5}), g.block("cr", "drive", {"mode": "hard", "drive": cr, "tone": 6000, "level": -6, "mix": 0.8}), g.block("out", "output"))
    g.preset("Phone"); g.preset("AM radio", low=600, high=2500, crunch=4); g.preset("Megaphone", low=700, high=3500, crunch=18)
    P.append(g.done())

    g = G("auto-filter", "Auto Filter", "filter", "plugins", "A filter that sweeps by itself, slow or fast: movement for pads, synths and drum loops.")
    lo = g.knob("low", "From", 80, 4000, 300, "Hz", True); hi = g.knob("high", "To", 500, 18000, 4000, "Hz", True); rt = g.knob("rate", "Rate", 0.05, 12, 0.5, "Hz", True); q = g.knob("resonance", "Resonance", 0.5, 10, 2.5); mix = g.knob("mix", "Mix", 0, 1, 1)
    g.block("in", "input", col=0, row=1); g.block("lo", "param", {"param": "low"}, col=0, row=2); g.block("hi", "param", {"param": "high"}, col=0, row=3)
    g.block("lfo", "lfo", {"rate": rt, "shape": "sine", "stereo": 60}, col=1, row=2); g.wire("lo", "lfo", "from"); g.wire("hi", "lfo", "to")
    g.block("f", "filter", {"mode": "lowpass", "q": q}, col=2, row=0); g.wire("in", "f"); g.wire("lfo", "f", "freq")
    g.block("blend", "mix", {"mix": mix}, col=3, row=1); g.wire("f", "blend", "wet"); g.wire("in", "blend", "dry"); g.block("out", "output", col=4, row=1); g.wire("blend", "out")
    g.preset("Slow sweep", low=300, high=4000, rate=0.15); g.preset("Wobble", low=150, high=1500, rate=4, resonance=5); g.preset("Pad movement", low=800, high=9000, rate=0.08, resonance=1.2)
    P.append(g.done())

    g = G("envelope-filter", "Envelope Filter", "filter", "plugins", "The auto-wah: the harder you play, the more the filter opens. Funk guitar, clavinet and bass.")
    sens = g.knob("sensitivity", "Sensitivity", -12, 24, 6, "dB"); lo = g.knob("low", "From", 100, 1000, 300, "Hz", True); hi = g.knob("high", "To", 1000, 8000, 3000, "Hz", True); q = g.knob("q", "Peak", 1, 10, 4); mix = g.knob("mix", "Mix", 0, 1, 1)
    g.block("in", "input", col=0, row=1); g.block("lo", "param", {"param": "low"}, col=0, row=2); g.block("hi", "param", {"param": "high"}, col=0, row=3)
    g.block("env", "envelope", {"attack": 4, "release": 120, "sensitivity": sens}, col=1, row=2); g.wire("in", "env"); g.wire("lo", "env", "from"); g.wire("hi", "env", "to")
    g.block("f", "filter", {"mode": "lowpass", "q": q}, col=2, row=0); g.wire("in", "f"); g.wire("env", "f", "freq")
    g.block("lift", "gain", {"gain": -2}, col=3, row=0); g.wire("f", "lift")
    g.block("blend", "mix", {"mix": mix}, col=4, row=1); g.wire("lift", "blend", "wet"); g.wire("in", "blend", "dry"); g.block("out", "output", col=5, row=1); g.wire("blend", "out")
    g.preset("Funk guitar"); g.preset("Bass quack", low=150, high=1500, q=6, sensitivity=8); g.preset("Clav", low=400, high=5000, q=3, sensitivity=4)
    P.append(g.done())

    g = G("synth-filter", "Synth Filter", "filter", "plugins", "A resonant 24 dB low-pass with drive in front and a soft clip after, for synths, drum loops and builds. The resonance sings without blowing up.")
    f = g.knob("cutoff", "Cutoff", 40, 18000, 1800, "Hz", True); q = g.knob("resonance", "Resonance", 0.7, 10, 3); d = g.knob("drive", "Drive", 0, 24, 6, "dB"); o = g.knob("output", "Output", -18, 6, 0, "dB")
    g.chain(g.block("in", "input"), g.block("pre", "drive", {"mode": "tube", "drive": d, "tone": 18000, "level": -3, "mix": 1, "oversample": 2}),
            g.block("res", "filter", {"mode": "lowpass", "freq": f, "q": q}), g.block("lp", "filter", {"mode": "lowpass", "freq": f, "q": 0.6}),
            g.block("tame", "drive", {"mode": "soft", "drive": 0, "tone": 20000, "level": 0, "mix": 1, "oversample": 2}), g.block("o", "gain", {"gain": o}), g.block("out", "output"))
    g.preset("Acid", cutoff=900, resonance=8, drive=12); g.preset("Warm", cutoff=3500, resonance=1.5, drive=4); g.preset("Closed", cutoff=300, resonance=4)
    P.append(g.done())

    # ============================================================ saturation (and the Airwindows ports)
    g = G("overdrive", "Overdrive", "saturation", "free", "A warm tube overdrive: from a little hair to a proper crunch. The free drive.")
    d = g.knob("drive", "Drive", 0, 36, 12, "dB"); tone = g.knob("tone", "Tone", 1000, 12000, 5000, "Hz", True); lvl = g.knob("level", "Level", -24, 6, -8, "dB"); mix = g.knob("mix", "Mix", 0, 1, 1)
    g.chain(g.block("in", "input"), g.block("hp", "filter", {"mode": "highpass", "freq": 70, "q": 0.7}), g.block("od", "drive", {"mode": "tube", "drive": d, "tone": tone, "level": lvl, "mix": mix, "oversample": 2}), g.block("out", "output"))
    g.preset("Edge of breakup", drive=8, level=-5); g.preset("Crunch", drive=20, tone=4500, level=-12); g.preset("Keys grit", drive=10, tone=7000, mix=0.6)
    P.append(g.done())

    g = G("bitcrusher", "Bitcrusher", "saturation", "free", "Fewer bits and a lower sample rate: from vintage sampler grit to all-out digital destruction.")
    b = g.knob("bits", "Bits", 2, 16, 8); r = g.knob("rate", "Sample rate", 1000, 44100, 11025, "Hz", True); mix = g.knob("mix", "Mix", 0, 1, 1)
    g.chain(g.block("in", "input"), g.block("bc", "bitcrush", {"bits": b, "rate": r, "mix": mix}), g.block("out", "output"))
    g.preset("SP-1200", bits=12, rate=26000); g.preset("8-bit", bits=8, rate=11025); g.preset("Destroyed", bits=4, rate=3000, mix=0.7)
    P.append(g.done())

    g = G("multiband-saturator", "Multiband Saturator", "saturation", "plugins", "Three bands, each driven on its own: weight in the lows, bite in the mids, sheen on top, without one muddying the others.")
    x1 = g.knob("xlow", "Low / mid split", 80, 600, 220, "Hz", True, "Bands"); x2 = g.knob("xhigh", "Mid / high split", 1500, 9000, 3500, "Hz", True, "Bands")
    dl = g.knob("lowDrive", "Low drive", 0, 24, 6, "dB", group="Low"); dm = g.knob("midDrive", "Mid drive", 0, 24, 4, "dB", group="Mid"); dh = g.knob("highDrive", "High drive", 0, 24, 3, "dB", group="High")
    o = g.knob("output", "Output", -18, 6, -3, "dB")
    g.block("in", "input", col=0, row=1)
    for r, band, d_, mode, os_ in ((0, "low", dl, "tube", 1), (1, "mid", dm, "tape", 1), (2, "high", dh, "soft", 2)):   # only the top band makes harmonics high enough to alias
        g.block(band, "crossover", {"band": band, "low": x1, "high": x2}, col=1, row=r); g.wire("in", band)
        g.block(band + "D", "drive", {"mode": mode, "drive": d_, "tone": 20000, "level": 0, "mix": 1, "oversample": os_}, col=2, row=r); g.wire(band, band + "D"); g.wire(band + "D", "o")
    g.block("o", "gain", {"gain": o}, col=3, row=1); g.block("out", "output", col=4, row=1); g.wire("o", "out")
    g.preset("Bass weight", lowDrive=12, midDrive=4, highDrive=0); g.preset("Drum bus", lowDrive=6, midDrive=8, highDrive=4, output=-5); g.preset("Mix glue", lowDrive=3, midDrive=3, highDrive=2, output=-2)
    P.append(g.done())

    g = G("lofi-tape", "Lo-Fi Tape", "saturation", "plugins", "A worn cassette: wobbling pitch, a dull top and soft saturation. Instant nostalgia for keys, drums and vocals.")
    wow = g.knob("wow", "Wobble", 0, 1, 0.4); age = g.knob("age", "Age", 2000, 16000, 6500, "Hz", True); d = g.knob("drive", "Saturation", 0, 24, 8, "dB"); mix = g.knob("mix", "Mix", 0, 1, 1)
    g.block("in", "input", col=0, row=1)
    g.chain("in", g.block("wob", "chorus", {"rate": 0.6, "depth": wow, "mix": 1}), g.block("tape", "drive", {"mode": "tape", "drive": d, "tone": age, "level": -4, "mix": 1, "oversample": 2}),
            g.block("lp", "filter", {"mode": "lowpass", "freq": age, "q": 0.6}), g.block("hp", "filter", {"mode": "highpass", "freq": 90, "q": 0.6}))
    g.block("blend", "mix", {"mix": mix}, col=6, row=1); g.wire("hp", "blend", "wet"); g.wire("in", "blend", "dry"); g.block("out", "output", col=7, row=1); g.wire("blend", "out")
    g.preset("Cassette", wow=0.4, age=6500); g.preset("Old VHS", wow=0.7, age=4000, drive=12); g.preset("Gentle", wow=0.2, age=11000, drive=4)
    P.append(g.done())

    P.append(code_plugin("density", "Density", "saturation", "free",
        "Airwindows Density by Chris Johnson: a smooth, musical saturation that adds weight and loudness (or, below zero, takes it away). Ported from Airwindows (MIT licence).",
        [("density", "Density", -1, 4, 1), ("highpass", "Highpass", 0, 1, 0), ("output", "Output", -24, 0, 0, "dB"), ("mix", "Mix", 0, 1, 1)], r"""
// Airwindows Density, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@init
flip = 1
@block
iir = highpass * highpass * highpass / (srate / 44100)
d = density
amt = abs(d)
d = d * abs(d)
if (amt > 1) { amt = amt - ceil(amt - 1) }
stages = d > 1 ? ceil(d - 1) : 0
g = db2gain(output)
@sample
dryL = inL
dryR = inR
xL = inL + 1e-20
xR = inR + 1e-20
if (flip > 0) { aL = aL * (1 - iir) + xL * iir; xL -= aL; aR = aR * (1 - iir) + xR * iir; xR -= aR }
else { bL = bL * (1 - iir) + xL * iir; xL -= bL; bR = bR * (1 - iir) + xR * iir; xR -= bR }
flip = -flip
loop (stages) {
  b = sin(min(abs(xL) * 1.57079633, 1.57079633)); xL = xL > 0 ? b : -b
  b = sin(min(abs(xR) * 1.57079633, 1.57079633)); xR = xR > 0 ? b : -b
}
b = min(abs(xL) * 1.57079633, 1.57079633); b = d > 0 ? sin(b) : 1 - cos(b)
xL = xL > 0 ? xL * (1 - amt) + b * amt : xL * (1 - amt) - b * amt
b = min(abs(xR) * 1.57079633, 1.57079633); b = d > 0 ? sin(b) : 1 - cos(b)
xR = xR > 0 ? xR * (1 - amt) + b * amt : xR * (1 - amt) - b * amt
outL = (xL * g) * mix + dryL * (1 - mix)
outR = (xR * g) * mix + dryR * (1 - mix)
""", [("Weight", {"density": 1}), ("Thick", {"density": 2.2, "output": -3}), ("Thinner", {"density": -0.5})], author=AW))

    P.append(code_plugin("purest-drive", "Purest Drive", "saturation", "free",
        "Airwindows PurestDrive by Chris Johnson: the cleanest saturation there is - it only drives what's loud and leaves the highs open. Ported from Airwindows (MIT licence).",
        [("drive", "Drive", 0, 1, 0.5), ("output", "Output", -24, 6, 0, "dB")], r"""
// Airwindows PurestDrive, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@block
g = db2gain(output)
@sample
sL = sin(inL)
ap = (abs(pL + sL) / 2) * drive
pL = sin(inL)
outL = (inL * (1 - ap) + sL * ap) * g
sR = sin(inR)
ap = (abs(pR + sR) / 2) * drive
pR = sin(inR)
outR = (inR * (1 - ap) + sR * ap) * g
""", [("Gentle", {"drive": 0.3}), ("Warm", {"drive": 0.6}), ("All in", {"drive": 1, "output": -2})], author=AW))

    P.append(code_plugin("spiral", "Spiral", "saturation", "free",
        "Airwindows Spiral by Chris Johnson: the smoothest clipping curve - loud peaks roll over sweetly instead of breaking up. Ported from Airwindows (MIT licence).",
        [("input", "Input", -12, 18, 0, "dB"), ("output", "Output", -24, 6, 0, "dB"), ("mix", "Mix", 0, 1, 1)], r"""
// Airwindows Spiral, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@block
gi = db2gain(input)
go = db2gain(output)
@sample
xL = inL * gi
aL = abs(xL)
xL = aL == 0 ? 0 : sin(xL * aL) / aL
xR = inR * gi
aR = abs(xR)
xR = aR == 0 ? 0 : sin(xR * aR) / aR
outL = xL * go * mix + inL * (1 - mix)
outR = xR * go * mix + inR * (1 - mix)
""", [("Glue", {"input": 3}), ("Push", {"input": 9, "output": -4}), ("Parallel", {"input": 12, "output": -6, "mix": 0.5})], author=AW))

    P.append(code_plugin("clip-only", "Clipper", "limiter", "free",
        "Airwindows ClipOnly2 by Chris Johnson: a safety clipper that rounds off overs with no harshness, so nothing past full scale gets through. Ported from Airwindows (MIT licence).",
        [("input", "Input", 0, 18, 0, "dB"), ("output", "Output", -12, 0, 0, "dB")], r"""
// Airwindows ClipOnly2, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
array iL[18]
array iR[18]
@init
sp = max(1, min(16, floor(srate / 44100)))
@block
gi = db2gain(input)
go = db2gain(output)
@sample
x = clamp(inL * gi, -4, 4)
if (wpL > 0) { if (x < lL) { lL = 0.7058208 + x * 0.2609148 } else { lL = 0.2491717 + lL * 0.7390851 } }
wpL = x > 0.9549925859
if (wpL) { x = 0.7058208 + lL * 0.2609148 }
if (wnL > 0) { if (x > lL) { lL = -0.7058208 + x * 0.2609148 } else { lL = -0.2491717 + lL * 0.7390851 } }
wnL = x < -0.9549925859
if (wnL) { x = -0.7058208 + lL * 0.2609148 }
iL[sp] = x
k = sp
loop (sp) { iL[k - 1] = iL[k]; k -= 1 }
outL = lL * go
lL = iL[0]
y = clamp(inR * gi, -4, 4)
if (wpR > 0) { if (y < lR) { lR = 0.7058208 + y * 0.2609148 } else { lR = 0.2491717 + lR * 0.7390851 } }
wpR = y > 0.9549925859
if (wpR) { y = 0.7058208 + lR * 0.2609148 }
if (wnR > 0) { if (y > lR) { lR = -0.7058208 + y * 0.2609148 } else { lR = -0.2491717 + lR * 0.7390851 } }
wnR = y < -0.9549925859
if (wnR) { y = -0.7058208 + lR * 0.2609148 }
iR[sp] = y
k = sp
loop (sp) { iR[k - 1] = iR[k]; k -= 1 }
outR = lR * go
lR = iR[0]
""", [("Safety", {"input": 0}), ("Louder", {"input": 4}), ("Hot", {"input": 9, "output": -1})], author=AW))

    P.append(code_plugin("warm", "Warm", "saturation", "free",
        "Airwindows PurestWarm by Chris Johnson: rounds off one half of the wave only, for a subtle, even-harmonic warmth. Ported from Airwindows (MIT licence).",
        [("side", "Which half (0 top, 1 bottom)", 0, 1, 0), ("drive", "Input", -12, 12, 0, "dB"), ("output", "Output", -12, 12, 0, "dB")], r"""
// Airwindows PurestWarm, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@block
gi = db2gain(drive)
go = db2gain(output) / gi
@sample
xL = inL * gi
xR = inR * gi
if (side < 0.5) {
  if (xL > 0) { xL = sin(xL * 1.57079634) / 1.57079634 }
  if (xR > 0) { xR = sin(xR * 1.57079634) / 1.57079634 }
} else {
  if (xL < 0) { xL = -(sin(-xL * 1.57079634) / 1.57079634) }
  if (xR < 0) { xR = -(sin(-xR * 1.57079634) / 1.57079634) }
}
outL = xL * go
outR = xR * go
""", [("Top half", {"side": 0}), ("Bottom half", {"side": 1}), ("Pushed", {"side": 0, "drive": 6})], author=AW))

    P.append(code_plugin("tube", "Tube", "saturation", "plugins",
        "Airwindows Tube2 by Chris Johnson: a real triode-style curve with its asymmetry and slew, from a gentle glow to a fat tube push. Ported from Airwindows (MIT licence).",
        [("input", "Input", 0, 1, 0.5), ("tube", "Tube", 0, 1, 0.5), ("output", "Output", -12, 12, 0, "dB")], r"""
// Airwindows Tube2, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@block
pf = floor(9 * (1 - tube)) + 1
pe = pf + 1
gs = 1 / pe
os2 = 1 + 1 / pf
hi = srate / 44100 > 1.9
go = db2gain(output) * 1.923076923076923
@sample
x = inL * input
if (hi) { st = x; x = (x + pA) * 0.5; pA = st }
x = clamp(x, -1, 1) / pf
a = abs(x)
r = sqrt(a)
x = (x - x * a * (x < 0 ? 1 + r : 1 - r) * 0.25) * pf
x = (x - (x < 0 ? -pow(-x, pe) : pow(x, pe)) * gs) * os2
if (hi) { st = x; x = (x + pC) * 0.5; pC = st; sl = pE - x; st = x; x = (x + pE) * 0.5; pE = st } else { sl = pE - x; pE = x }
sl = sl > 0 ? 1 + sqrt(sl) * 0.5 : 1 - sqrt(-sl) * 0.5
x -= x * abs(x) * sl * gs
outL = clamp(x, -0.52, 0.52) * go
y = inR * input
if (hi) { st = y; y = (y + pB2) * 0.5; pB2 = st }
y = clamp(y, -1, 1) / pf
a = abs(y)
r = sqrt(a)
y = (y - y * a * (y < 0 ? 1 + r : 1 - r) * 0.25) * pf
y = (y - (y < 0 ? -pow(-y, pe) : pow(y, pe)) * gs) * os2
if (hi) { st = y; y = (y + pD) * 0.5; pD = st; sl = pF - y; st = y; y = (y + pF) * 0.5; pF = st } else { sl = pF - y; pF = y }
sl = sl > 0 ? 1 + sqrt(sl) * 0.5 : 1 - sqrt(-sl) * 0.5
y -= y * abs(y) * sl * gs
outR = clamp(y, -0.52, 0.52) * go
""", [("Glow", {"input": 0.4, "tube": 0.3}), ("Warm tube", {"input": 0.6, "tube": 0.6}), ("Fat", {"input": 0.9, "tube": 0.85, "output": -3})], author=AW))

    P.append(code_plugin("console-preamp", "Console Preamp", "saturation", "plugins",
        "Airwindows Mackity by Chris Johnson: the sound of a small-format console's preamp - a tight low end, a soft top and grit when pushed. Ported from Airwindows (MIT licence).",
        [("drive", "Drive", -12, 24, 0, "dB"), ("output", "Output", -24, 0, 0, "dB")], r"""
// Airwindows Mackity, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@init
os = srate / 44100
iA = 0.001860867 / os
iB = 0.000287496 / os
K = tan(pi * 19160 / srate)
qa = 0.431684981684982
n = 1 / (1 + K / qa + K * K)
a0 = K * K * n; a1 = 2 * a0; a3 = 2 * (K * K - 1) * n; a4 = (1 - K / qa + K * K) * n
qb = 1.1582298
n = 1 / (1 + K / qb + K * K)
b0 = K * K * n; b1 = 2 * b0; b3 = 2 * (K * K - 1) * n; b4 = (1 - K / qb + K * K) * n
@block
tr = db2gain(drive)
tr = tr * tr
go = db2gain(output)
@sample
n = noise() * 1e-17
x = inL + n
jAL += (x - jAL) * iA
x = (x - jAL) * tr
o = a0 * (x + xa2L) + a1 * xa1L - a3 * ya1L - a4 * ya2L
xa2L = xa1L; xa1L = x; ya2L = ya1L; ya1L = o
x = clamp(o, -1, 1)
x2 = x * x
x -= x2 * x2 * x * 0.1768
o = b0 * (x + xb2L) + b1 * xb1L - b3 * yb1L - b4 * yb2L
xb2L = xb1L; xb1L = x; yb2L = yb1L; yb1L = o
jBL += (o - jBL) * iB
outL = (o - jBL) * go
y = inR + n
jAR += (y - jAR) * iA
y = (y - jAR) * tr
o = a0 * (y + xa2R) + a1 * xa1R - a3 * ya1R - a4 * ya2R
xa2R = xa1R; xa1R = y; ya2R = ya1R; ya1R = o
y = clamp(o, -1, 1)
y2 = y * y
y -= y2 * y2 * y * 0.1768
o = b0 * (y + xb2R) + b1 * xb1R - b3 * yb1R - b4 * yb2R
xb2R = xb1R; xb1R = y; yb2R = yb1R; yb1R = o
jBR += (o - jBR) * iB
outR = (o - jBR) * go
""", [("Channel", {"drive": 0}), ("Pushed", {"drive": 9, "output": -6}), ("Driven bus", {"drive": 15, "output": -10})], author=AW))

    P.append(code_plugin("butter-comp", "ButterComp", "compressor", "plugins",
        "Airwindows ButterComp2 by Chris Johnson: a smooth, glue-like compressor that works on the two halves of the wave apart - natural, never pumpy. Ported from Airwindows (MIT licence).",
        [("compress", "Compress", 0, 1, 0.4), ("output", "Output", -12, 6, 0, "dB"), ("mix", "Mix", 0, 1, 1)], r"""
// Airwindows ButterComp2, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@init
cApL = 1; cAnL = 1; cBpL = 1; cBnL = 1; tpL = 1; tnL = 1
cApR = 1; cAnR = 1; cBpR = 1; cBnR = 1; tpR = 1; tnR = 1
@block
ig = pow(10, (compress * 14) / 20)
cf = 0.012 * (compress / 135) / (srate / 44100)
k = db2gain(output) / ((ig - 1) / 1.5 + 1)
@sample
x = inL * ig
rm = cf / (1 + abs(lastL))
dv = 1 - rm
ip = max(x + 1, 0)
iq = max(1 - x, 0)
tpL = tpL * dv + ip * ip * rm
tnL = tnL * dv + iq * iq * rm
if (x > 0) { c = rm / (tpL * tpL); if (flip) { cApL = cApL * dv + c } else { cBpL = cBpL * dv + c } }
else { c = rm / (tnL * tnL); if (flip) { cAnL = cAnL * dv + c } else { cBnL = cBnL * dv + c } }
tm = flip ? cApL * min(ip * 0.5, 1) + cAnL * min(iq * 0.5, 1) : cBpL * min(ip * 0.5, 1) + cBnL * min(iq * 0.5, 1)
x = inL + (x * tm * k - inL) * mix
lastL = x
outL = x
y = inR * ig
rm = cf / (1 + abs(lastR))
dv = 1 - rm
ip = max(y + 1, 0)
iq = max(1 - y, 0)
tpR = tpR * dv + ip * ip * rm
tnR = tnR * dv + iq * iq * rm
if (y > 0) { c = rm / (tpR * tpR); if (flip) { cApR = cApR * dv + c } else { cBpR = cBpR * dv + c } }
else { c = rm / (tnR * tnR); if (flip) { cAnR = cAnR * dv + c } else { cBnR = cBnR * dv + c } }
tm = flip ? cApR * min(ip * 0.5, 1) + cAnR * min(iq * 0.5, 1) : cBpR * min(ip * 0.5, 1) + cBnR * min(iq * 0.5, 1)
y = inR + (y * tm * k - inR) * mix
lastR = y
outR = y
flip = !flip
""", [("Glue", {"compress": 0.3}), ("Smooth vocal", {"compress": 0.5}), ("Parallel squeeze", {"compress": 0.85, "mix": 0.5})], author=AW))

    P.append(code_plugin("slew", "Slew", "eq", "plugins",
        "Airwindows Slew2 by Chris Johnson: tames harsh, spiky highs by limiting how fast the wave can move - smooths cymbals, sibilance and brittle digital sound. Ported from Airwindows (MIT licence).",
        [("clamp", "Clamp", 0, 1, 0.3), ("output", "Output", -12, 6, 0, "dB")], r"""
// Airwindows Slew2, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@init
dec = 0.915965594177219015
dd = dec * dec
tw = 0.0414213562373095048801688
@block
th = pow(1 - clamp, 4) / (2 / 44100 * srate)
go = db2gain(output)
@sample
x = inL
lsL = (x + l1L + (l3L - l2L) * tw) * 0.5
l3L = l2L; l2L = l1L; l1L = x
bL *= dec
hdf = bL * dec
y = clamp(x, lsL - th, lsL + th)
lsL = y
c = y - x
aL = aL * dd + c + 1e-20
bL = bL * dec - c + 1e-20
df = aL * dec
outL = (x + (df + hdf + pdL) / 0.734) * go
pdL = df * 0.5
x = inR
lsR = (x + l1R + (l3R - l2R) * tw) * 0.5
l3R = l2R; l2R = l1R; l1R = x
bR *= dec
hdf = bR * dec
y = clamp(x, lsR - th, lsR + th)
lsR = y
c = y - x
aR = aR * dd + c + 1e-20
bR = bR * dec - c + 1e-20
df = aR * dec
outR = (x + (df + hdf + pdR) / 0.734) * go
pdR = df * 0.5
""", [("Smooth", {"clamp": 0.3}), ("De-harsh", {"clamp": 0.55}), ("Vintage", {"clamp": 0.75})], author=AW))

    # ============================================================ modulation and pitch
    g = G("vibrato", "Vibrato", "modulation", "free", "Pitch that wavers like a singer's or a whammy bar's. The free vibrato.")
    rt = g.knob("rate", "Rate", 0.1, 10, 5, "Hz", True); dp = g.knob("depth", "Depth", 0, 1, 0.35)
    g.chain(g.block("in", "input"), g.block("vib", "chorus", {"rate": rt, "depth": dp, "mix": 1}), g.block("out", "output"))
    g.preset("Gentle", rate=5, depth=0.25); g.preset("Wide", rate=4, depth=0.6); g.preset("Fast warble", rate=8, depth=0.4)
    P.append(g.done())

    g = G("doubler", "Doubler", "modulation", "free", "A second take, slightly out of step: thickens a vocal or a guitar and spreads it a little.")
    dp = g.knob("depth", "Depth", 0, 1, 0.3); wd = g.knob("width", "Width", 0.5, 2, 1.4); mix = g.knob("mix", "Mix", 0, 1, 0.45)
    g.chain(g.block("in", "input"), g.block("dbl", "chorus", {"rate": 0.25, "depth": dp, "mix": mix}), g.block("wide", "stereo", {"width": wd}), g.block("out", "output"))
    g.preset("Vocal double", depth=0.25, mix=0.4); g.preset("Wide guitar", depth=0.35, width=1.8, mix=0.5); g.preset("Subtle", depth=0.15, mix=0.3)
    P.append(g.done())

    P.append(code_plugin("ring-mod", "Ring Modulator", "modulation", "free",
        "Multiplies the sound by a tone: bells, robots and metallic sci-fi textures. Low rates make a choppy tremolo.",
        [("freq", "Frequency", 1, 2000, 220, "Hz", True), ("amount", "Amount", 0, 1, 0.6)], r"""
@sample
ph += freq / srate
ph -= floor(ph)
m = sin(2 * pi * ph)
outL = mix(inL, inL * m, amount)
outR = mix(inR, inR * m, amount)
""", [("Bells", {"freq": 440, "amount": 0.7}), ("Robot", {"freq": 60, "amount": 1}), ("Choppy", {"freq": 8, "amount": 1})]))

    g = G("uni-vibe", "Uni-Vibe", "modulation", "plugins", "The swirling, throbbing chorus-phaser of 60s and 70s guitar - also lovely on organ and electric piano.")
    rt = g.knob("rate", "Speed", 0.2, 10, 1.5, "Hz", True); dp = g.knob("intensity", "Intensity", 0, 1, 0.75); mix = g.knob("mix", "Mix", 0, 1, 0.55)
    g.chain(g.block("in", "input"), g.block("ph", "phaser", {"rate": rt, "depth": dp, "feedback": 0.15, "mix": mix}), g.block("wob", "chorus", {"rate": rt, "depth": 0.2, "mix": 0.3}), g.block("warm", "eq", {"mode": "highshelf", "freq": 6000, "q": 0.7, "gain": -2}), g.block("lvl", "gain", {"gain": 4.5}), g.block("out", "output"))
    g.preset("Slow swirl", rate=1, intensity=0.7); g.preset("Throb", rate=5, intensity=0.9, mix=0.6); g.preset("Organ", rate=2.5, intensity=0.6, mix=0.5)
    P.append(g.done())

    g = G("harmonic-tremolo", "Harmonic Tremolo", "modulation", "plugins", "The brownface amp tremolo: the lows and highs pulse in turn, for a phasey, liquid wobble instead of a plain on-off.")
    rt = g.knob("rate", "Speed", 0.5, 12, 4, "Hz", True); dp = g.knob("depth", "Depth", 0, 18, 12, "dB"); x = g.knob("split", "Split", 300, 2000, 700, "Hz", True)
    g.block("in", "input", col=0, row=1); g.block("dep", "param", {"param": "depth"}, col=0, row=3); g.block("depN", "math", {"op": "negate"}, col=1, row=3); g.wire("dep", "depN", "a")
    g.block("low", "crossover", {"band": "low", "low": x, "high": 20000}, col=1, row=0); g.wire("in", "low")
    g.block("high", "crossover", {"band": "high", "low": 20, "high": x}, col=1, row=2); g.wire("in", "high")
    g.block("lfoA", "lfo", {"rate": rt, "shape": "sine", "to": 0, "phase": 0}, col=2, row=3); g.wire("depN", "lfoA", "from")
    g.block("lfoB", "lfo", {"rate": rt, "shape": "sine", "to": 0, "phase": 180}, col=2, row=4); g.wire("depN", "lfoB", "from")
    g.block("gl", "gain", {}, col=3, row=0); g.wire("low", "gl"); g.wire("lfoA", "gl", "gain")
    g.block("gh", "gain", {}, col=3, row=2); g.wire("high", "gh"); g.wire("lfoB", "gh", "gain")
    g.block("out", "output", col=4, row=1); g.wire("gl", "out"); g.wire("gh", "out")
    g.preset("Brownface", rate=4, depth=12); g.preset("Slow liquid", rate=1.5, depth=10, split=500); g.preset("Deep", rate=6, depth=18)
    P.append(g.done())

    g = G("ensemble", "Ensemble", "modulation", "plugins", "Three choruses at once, at different speeds: the lush string machine and the big, wide keys of the 70s and 80s.")
    dp = g.knob("depth", "Depth", 0, 1, 0.5); mix = g.knob("mix", "Mix", 0, 1, 0.55); wd = g.knob("width", "Width", 0.5, 2, 1.5)
    g.block("in", "input", col=0, row=1)
    for i, (rate, pan) in enumerate(((0.63, -0.8), (0.91, 0.0), (1.37, 0.8))):
        g.block("c%d" % i, "chorus", {"rate": rate, "depth": dp, "mix": 1}, col=1, row=i); g.wire("in", "c%d" % i)
        g.block("p%d" % i, "stereo", {"pan": pan}, col=2, row=i); g.wire("c%d" % i, "p%d" % i); g.wire("p%d" % i, "g")
    g.block("g", "gain", {"gain": -4.8}, col=3, row=0)
    g.block("blend", "mix", {"mix": mix, "law": "equal"}, col=4, row=1); g.wire("g", "blend", "wet"); g.wire("in", "blend", "dry")
    g.chain("blend", g.block("wide", "stereo", {"width": wd}, col=5, row=1), g.block("out", "output", col=6, row=1))
    g.preset("String machine", depth=0.6, mix=0.7); g.preset("Wide keys", depth=0.45, mix=0.5, width=1.8); g.preset("Subtle", depth=0.3, mix=0.35)
    P.append(g.done())

    g = G("micro-pitch", "Micro Pitch", "modulation", "plugins", "Two copies tuned a few cents apart, one each side: the classic wide vocal and the huge, stable doubled guitar - no wobble, unlike a chorus.")
    c = g.knob("cents", "Detune", 0, 30, 9, "cents"); mix = g.knob("mix", "Mix", 0, 1, 0.4); dly = g.knob("delay", "Delay", 0, 30, 12, "ms")
    g.block("in", "input", col=0, row=1); g.block("cents", "param", {"param": "cents"}, col=0, row=3); g.block("neg", "math", {"op": "negate"}, col=1, row=3); g.wire("cents", "neg", "a")
    g.block("up", "pitch", {"semitones": 0, "mix": 1}, col=1, row=0); g.wire("in", "up"); g.wire("cents", "up", "fine")
    g.block("dn", "pitch", {"semitones": 0, "mix": 1}, col=1, row=2); g.wire("in", "dn"); g.wire("neg", "dn", "fine")
    g.block("dl", "delay", {"time": dly, "feedback": 0, "mix": 1, "tone": 18000}, col=2, row=2); g.wire("dn", "dl")
    g.block("pl", "stereo", {"pan": -1}, col=3, row=0); g.wire("up", "pl"); g.block("pr", "stereo", {"pan": 1}, col=3, row=2); g.wire("dl", "pr")
    g.block("blend", "mix", {"mix": mix, "law": "equal"}, col=4, row=1); g.wire("pl", "blend", "wet"); g.wire("pr", "blend", "wet"); g.wire("in", "blend", "dry")
    g.block("out", "output", col=5, row=1); g.wire("blend", "out")
    g.preset("Wide vocal", cents=9, mix=0.35); g.preset("Huge guitar", cents=14, mix=0.5, delay=18); g.preset("Subtle", cents=5, mix=0.25)
    P.append(g.done())

    g = G("pitch-shifter", "Pitch Shifter", "pitch", "free", "Moves the sound up or down, from a few cents to two octaves, keeping its timing. The free pitch shifter.")
    st = g.knob("semitones", "Semitones", -24, 24, 12); fn = g.knob("fine", "Fine", -100, 100, 0, "cents"); mix = g.knob("mix", "Mix", 0, 1, 0.5)
    g.chain(g.block("in", "input"), g.block("ps", "pitch", {"semitones": st, "fine": fn, "mix": mix}), g.block("out", "output"))
    g.preset("Octave up", semitones=12, mix=0.4); g.preset("Octave down", semitones=-12, mix=0.5); g.preset("Fifth", semitones=7, mix=0.35)
    P.append(g.done())

    g = G("octaver", "Octaver", "pitch", "plugins", "A clean octave below (and one above, if you like) under the original: a bass line from a guitar, or a huge low end on a synth.")
    low = g.knob("down", "Octave down", 0, 1, 0.6); up = g.knob("up", "Octave up", 0, 1, 0); dry = g.knob("dry", "Dry", -24, 0, 0, "dB"); tone = g.knob("tone", "Tone", 300, 4000, 1200, "Hz", True)
    g.block("in", "input", col=0, row=1)
    g.block("dn", "pitch", {"semitones": -12, "mix": 1}, col=1, row=0); g.wire("in", "dn")
    g.block("lp", "filter", {"mode": "lowpass", "freq": tone, "q": 0.7}, col=2, row=0); g.wire("dn", "lp")
    g.block("dl", "mix", {"mix": low, "law": "linear"}, col=3, row=0); g.wire("lp", "dl", "wet")
    g.block("upb", "pitch", {"semitones": 12, "mix": 1}, col=1, row=2); g.wire("in", "upb")
    g.block("ul", "mix", {"mix": up, "law": "linear"}, col=3, row=2); g.wire("upb", "ul", "wet")
    g.block("d", "gain", {"gain": dry}, col=2, row=1); g.wire("in", "d")
    g.block("out", "output", col=4, row=1); g.wire("dl", "out"); g.wire("ul", "out"); g.wire("d", "out")
    g.preset("Guitar to bass", down=0.8, dry=-12, tone=800); g.preset("Thick synth", down=0.5, up=0.2); g.preset("Organ", down=0.4, up=0.35, tone=2500)
    P.append(g.done())

    g = G("harmonizer", "Harmonizer", "pitch", "plugins", "A second voice at an interval - a third, a fifth, an octave - for instant harmonies on a lead line or a big synth stack.")
    a = g.knob("interval", "Interval", -12, 12, 7, "st"); b = g.knob("interval2", "Second interval", -12, 12, 12, "st"); m1 = g.knob("level", "Voice", 0, 1, 0.5); m2 = g.knob("level2", "Second voice", 0, 1, 0)
    g.block("in", "input", col=0, row=1)
    g.block("v1", "pitch", {"semitones": a, "mix": 1}, col=1, row=0); g.wire("in", "v1"); g.block("l1", "mix", {"mix": m1}, col=2, row=0); g.wire("v1", "l1", "wet")
    g.block("v2", "pitch", {"semitones": b, "mix": 1}, col=1, row=2); g.wire("in", "v2"); g.block("l2", "mix", {"mix": m2}, col=2, row=2); g.wire("v2", "l2", "wet")
    g.block("out", "output", col=3, row=1); g.wire("in", "out"); g.wire("l1", "out"); g.wire("l2", "out")
    g.preset("Fifth", interval=7, level=0.45); g.preset("Octave stack", interval=12, interval2=-12, level=0.4, level2=0.3); g.preset("Third", interval=4, level=0.45)
    P.append(g.done())

    # ============================================================ stereo, utility and limiting
    P.append(code_plugin("utility", "Utility", "stereo", "free",
        "The everyday tools in one: gain, balance, width (0 = mono), and each side's polarity. The free utility.",
        [("gain", "Gain", -36, 24, 0, "dB"), ("balance", "Balance", -1, 1, 0), ("width", "Width", 0, 2, 1), ("flipL", "Invert left", 0, 1, 0), ("flipR", "Invert right", 0, 1, 0)], r"""
@block
g = db2gain(gain)
@sample
l = inL * g * (flipL > 0.5 ? -1 : 1)
r = inR * g * (flipR > 0.5 ? -1 : 1)
m = (l + r) * 0.5
s = (l - r) * 0.5 * width
l = m + s
r = m - s
outL = l * (balance > 0 ? 1 - balance : 1)
outR = r * (balance < 0 ? 1 + balance : 1)
""", [("Mono", {"width": 0}), ("Quieter", {"gain": -6}), ("Flip polarity", {"flipL": 1, "flipR": 1})]))

    P.append(code_plugin("haas-widener", "Haas Widener", "stereo", "plugins",
        "Width from timing: one side a few milliseconds later, so a mono sound spreads out. A low cut keeps the bass centred and mono-safe.",
        [("time", "Delay", 1, 30, 12, "ms"), ("amount", "Amount", 0, 1, 0.7), ("side", "Delay side (0 left, 1 right)", 0, 1, 1), ("bass", "Keep bass centred below", 40, 400, 150, "Hz", True)], r"""
delay d[40]
@sample
m = (inL + inR) * 0.5
k = 1 - exp(-2 * pi * bass / srate)
lo += (m - lo) * k + 1e-20
d.write(inR * (side > 0.5 ? 1 : 0) + inL * (side > 0.5 ? 0 : 1))
w = d.read(time)
hiL = inL - lo
hiR = inR - lo
if (side > 0.5) { outL = lo + hiL; outR = lo + mix(hiR, w - lo, amount) } else { outL = lo + mix(hiL, w - lo, amount); outR = lo + hiR }
""", [("Wider", {"time": 10, "amount": 0.6}), ("Very wide", {"time": 20, "amount": 0.9}), ("Subtle", {"time": 6, "amount": 0.4})]))

    g = G("maximizer", "Maximizer", "limiter", "plugins", "Loudness for a finished mix: a soft clipper rounds the peaks, then a true-peak limiter holds the ceiling. Louder without crunch.")
    inp = g.knob("input", "Input", 0, 18, 4, "dB"); ch = g.knob("character", "Clip softness", 0, 12, 3, "dB"); c = g.knob("ceiling", "Ceiling", -6, 0, -1, "dB"); rl = g.knob("release", "Release", 10, 500, 60, "ms", True)
    g.chain(g.block("in", "input"), g.block("g", "gain", {"gain": inp}), g.block("clip", "drive", {"mode": "soft", "drive": ch, "tone": 20000, "level": 0, "mix": 0.5, "oversample": 4}),
            g.block("lim", "limiter", {"detect": "truepeak", "lookahead": 5, "ceiling": c, "release": rl}), g.block("out", "output"))
    g.preset("Streaming", input=4, character=2, ceiling=-1); g.preset("Loud", input=9, character=5, ceiling=-1, release=40); g.preset("Gentle", input=2, character=1, ceiling=-1.5, release=120)
    P.append(g.done())

    return P
