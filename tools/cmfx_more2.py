"""Central FX collection, 10.8 (second batch): a de-esser, a filter, a bass mono-maker, a vari-mu compressor, a drum bus,
guitar and bass amps, an auto-swell, a reverse delay and a sub-octave enhancer.

DeEss, Capacitor2 and Pressure4 are Airwindows effects by Chris Johnson (github.com/airwindows/airwindows, MIT licence -
"Copyright (c) 2018 Chris Johnson"; LICENSE-airwindows.txt), ported line for line into the code language like the first
batch (tools/cmfx_more.py). In Pressure4 the "flip" between two sets of state never changes (it's never toggled), so only
the one set it uses is here. The rest are Motion Audio's own."""
from cmfx_more import code_plugin, AW


def more2(G):
    P = []

    # ============================================================ free
    P.append(code_plugin("de-esser", "De-esser", "dynamics", "free",
        "Airwindows DeEss by Chris Johnson: turns down harsh S and T sounds the moment they happen and leaves the rest of the voice alone. The free de-esser. Ported from Airwindows (MIT licence).",
        [("intensity", "Intensity", 0, 1, 0.45), ("maxcut", "Most it turns down", 0, 48, 24, "dB"), ("freq", "Frequency", 0, 1, 0.5)], r"""
// Airwindows DeEss, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@init
rAL = 1; rBL = 1; rAR = 1; rBR = 1
@block
os = srate / 44100
it = pow(intensity, 5) * (8192 / os)
md = db2gain(maxcut)
ia = freq * freq / os
@sample
x = inL
s3L = s2L; s2L = s1L; s1L = x
d = s1L - s2L
m1 = d * (d / 1.3)
m2 = (s2L - s3L) * (d / 1.3)
e = m1 - m2
se = abs(e * (e / 1.3))
at = 7 + se * 1024
se = min(1 + it * it * se, it)
rc = 1 + 0.01 / se
k = (1 - abs(x)) * ia
if (flip) {
  iAL = iAL * (1 - k) + x * k
  rAL = rAL < se ? (rAL * at + se) / (at + 1) : 1 + (rAL - 1) / rc
  rAL = min(rAL, md)
  x = iAL + (x - iAL) / rAL
} else {
  iBL = iBL * (1 - k) + x * k
  rBL = rBL < se ? (rBL * at + se) / (at + 1) : 1 + (rBL - 1) / rc
  rBL = min(rBL, md)
  x = iBL + (x - iBL) / rBL
}
outL = x
x = inR
s3R = s2R; s2R = s1R; s1R = x
d = s1R - s2R
m1 = d * (d / 1.3)
m2 = (s2R - s3R) * (d / 1.3)
e = m1 - m2
se = abs(e * (e / 1.3))
at = 7 + se * 1024
se = min(1 + it * it * se, it)
rc = 1 + 0.01 / se
k = (1 - abs(x)) * ia
if (flip) {
  iAR = iAR * (1 - k) + x * k
  rAR = rAR < se ? (rAR * at + se) / (at + 1) : 1 + (rAR - 1) / rc
  rAR = min(rAR, md)
  x = iAR + (x - iAR) / rAR
} else {
  iBR = iBR * (1 - k) + x * k
  rBR = rBR < se ? (rBR * at + se) / (at + 1) : 1 + (rBR - 1) / rc
  rBR = min(rBR, md)
  x = iBR + (x - iBR) / rBR
}
outR = x
flip = !flip
""", [("Gentle", {"intensity": 0.35, "maxcut": 12}), ("Vocal", {"intensity": 0.45, "maxcut": 24}), ("Strong", {"intensity": 0.6, "maxcut": 36, "freq": 0.4})], author=AW))

    P.append(code_plugin("capacitor", "Capacitor", "filter", "free",
        "Airwindows Capacitor2 by Chris Johnson: a gentle low-pass and high-pass made like real capacitors, with their soft, musical character. Trims the top and bottom without sounding like an EQ. Ported from Airwindows (MIT licence).",
        [("lowpass", "Low-pass", 0, 1, 1), ("highpass", "High-pass", 0, 1, 0), ("nonlin", "Capacitor character", 0, 1, 0), ("mix", "Mix", 0, 1, 1)], r"""
// Airwindows Capacitor2, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
// (each sample runs stage A and two of B-F in turn, as Chris's count 0-5 does: B/C alternate, D/E/F take turns)
@block
lc = lowpass * lowpass
hc = highpass * highpass
nl = 1 + (1 - nonlin) * 6
trim = 1.5 / pow(nl, 1 / 3)
@sample
cnt += 1
if (cnt > 5) { cnt = 0 }
odd = cnt == 1 || cnt == 3 || cnt == 5
third = cnt == 1 || cnt == 4 ? 1 : (cnt == 2 || cnt == 5 ? 2 : 0)
x = inL + 1e-20
ds = abs(2 - ((x + nl) / nl))
la = lc * ds; il = 1 - la; ha = hc * ds; ih = 1 - ha
hAL = hAL * ih + x * ha; x -= hAL; lAL = lAL * il + x * la; x = lAL
if (odd) { hCL = hCL * ih + x * ha; x -= hCL; lCL = lCL * il + x * la; x = lCL } else { hBL = hBL * ih + x * ha; x -= hBL; lBL = lBL * il + x * la; x = lBL }
if (third == 0) { hDL = hDL * ih + x * ha; x -= hDL; lDL = lDL * il + x * la; x = lDL } else { if (third == 1) { hEL = hEL * ih + x * ha; x -= hEL; lEL = lEL * il + x * la; x = lEL } else { hFL = hFL * ih + x * ha; x -= hFL; lFL = lFL * il + x * la; x = lFL } }
outL = inL + (x * trim - inL) * mix
x = inR + 1e-20
ds = abs(2 - ((x + nl) / nl))
la = lc * ds; il = 1 - la; ha = hc * ds; ih = 1 - ha
hAR = hAR * ih + x * ha; x -= hAR; lAR = lAR * il + x * la; x = lAR
if (odd) { hCR = hCR * ih + x * ha; x -= hCR; lCR = lCR * il + x * la; x = lCR } else { hBR = hBR * ih + x * ha; x -= hBR; lBR = lBR * il + x * la; x = lBR }
if (third == 0) { hDR = hDR * ih + x * ha; x -= hDR; lDR = lDR * il + x * la; x = lDR } else { if (third == 1) { hER = hER * ih + x * ha; x -= hER; lER = lER * il + x * la; x = lER } else { hFR = hFR * ih + x * ha; x -= hFR; lFR = lFR * il + x * la; x = lFR } }
outR = inR + (x * trim - inR) * mix
""", [("Warm top", {"lowpass": 0.6}), ("Clean the lows", {"highpass": 0.08}), ("Vintage band", {"lowpass": 0.5, "highpass": 0.1, "nonlin": 0.6})], author=AW))

    P.append(code_plugin("mono-bass", "Mono Bass", "stereo", "free",
        "Puts everything below a frequency in the middle and leaves the rest as wide as it was: a tight, centred low end that's safe on mono speakers and subwoofers.",
        [("freq", "Below", 40, 400, 120, "Hz", True), ("width", "Width above", 0, 2, 1)], r"""
@block
k = 1 - exp(-2 * pi * freq / srate)
@sample
a1 += (inL - a1) * k + 1e-20
a2 += (a1 - a2) * k
b1 += (inR - b1) * k + 1e-20
b2 += (b1 - b2) * k
lo = (a2 + b2) * 0.5
hl = inL - a2
hr = inR - b2
m = (hl + hr) * 0.5
s = (hl - hr) * 0.5 * width
outL = lo + m + s
outR = lo + m - s
""", [("Tight bass", {"freq": 120}), ("Subwoofer safe", {"freq": 80}), ("Mono lows, wide top", {"freq": 200, "width": 1.4})]))

    # ============================================================ Central Plugins
    P.append(code_plugin("pressure", "Pressure", "compressor", "plugins",
        "Airwindows Pressure4 by Chris Johnson: a vari-mu style compressor that clamps down on peaks and lets go smoothly, with a soft clip after it so nothing goes over. Ported from Airwindows (MIT licence).",
        [("pressure", "Pressure", 0, 1, 0.3), ("speed", "Speed", 0, 1, 0.2), ("mu", "Mewiness", -1, 1, 1), ("output", "Output", -18, 6, 0, "dB")], r"""
// Airwindows Pressure4, Copyright (c) 2018 Chris Johnson, MIT licence (LICENSE-airwindows.txt) - ported to Central FX
@init
sp = 10000
co = 1
@block
os = srate / 44100
th = 1 - pressure * 0.95
mk = 1 / th
rel = pow(1.28 - speed, 5) * 32768 / os
fa = sqrt(rel)
mw = abs(mu)
um = 1 - mw
pm = mu >= 0
go = db2gain(output)
@sample
xl = inL * mk
xr = inR * mk
se = max(abs(xl), abs(xr))
if (se > th) {
  mv = th / se
  ma = sqrt(abs(sp))
  co = (co * (ma - 1) + (mv < th ? th : mv)) / ma
} else {
  co = (co * (sp * sp - 1) + 1) / (sp * sp)
}
sp = (sp * (sp - 1) + abs(se * rel) + fa) / sp
c = (pm ? co * co : sqrt(co)) * mw + co * um
xl = xl * c * go
xr = xr * c * go
b = abs(xl)
b = b > 1.57079633 ? 1 : sin(b)
outL = xl > 0 ? b : -b
b = abs(xr)
b = b > 1.57079633 ? 1 : sin(b)
outR = xr > 0 ? b : -b
""", [("Glue", {"pressure": 0.25, "speed": 0.2}), ("Vocal pressure", {"pressure": 0.45, "speed": 0.35, "output": -2}), ("Squash", {"pressure": 0.75, "speed": 0.5, "output": -4})], author=AW))

    g = G("drum-bus", "Drum Bus", "dynamics", "plugins", "Everything a drum bus wants in one: punch from a transient shaper, glue from a compressor, weight in the low end, tape grit and a blend control.")
    pu = g.knob("punch", "Punch", -50, 100, 35, "%"); cr = g.knob("crush", "Glue", -40, 0, -18, "dB"); bo = g.knob("boom", "Boom", 0, 9, 3, "dB")
    dr = g.knob("drive", "Grit", 0, 18, 5, "dB"); mix = g.knob("mix", "Mix", 0, 1, 1)
    g.block("in", "input", col=0, row=1)
    g.chain("in", g.block("tr", "transient", {"attack": pu, "sustain": -10, "level": 0}), g.block("comp", "compressor", {"style": "glue", "detect": "rms", "threshold": cr, "ratio": 4, "attack": 10, "release": 120, "knee": 6, "makeup": 4, "schpf": 90}),
            g.block("boom", "eq", {"mode": "lowshelf", "freq": 70, "q": 0.7, "gain": bo}), g.block("air", "eq", {"mode": "highshelf", "freq": 9000, "q": 0.7, "gain": 1.5}),
            g.block("tape", "drive", {"mode": "tape", "drive": dr, "tone": 14000, "level": -3, "mix": 1, "oversample": 2}))
    g.block("blend", "mix", {"mix": mix, "law": "linear"}, col=7, row=1); g.wire("tape", "blend", "wet"); g.wire("in", "blend", "dry"); g.block("out", "output", col=8, row=1); g.wire("blend", "out")
    g.preset("Worship kit", punch=30, crush=-16, boom=2, drive=4); g.preset("Big rock", punch=55, crush=-24, boom=4, drive=9); g.preset("Parallel smash", punch=70, crush=-32, boom=3, drive=10, mix=0.45)
    P.append(g.done())

    g = G("guitar-amp", "Guitar Amp", "saturation", "plugins", "A guitar amp and cabinet for a guitar plugged straight in: gain, a three-band tone stack, presence, a speaker's shape and a little room.")
    ga = g.knob("gain", "Gain", 0, 36, 14, "dB"); ba = g.knob("bass", "Bass", -12, 12, 1, "dB"); mi = g.knob("mid", "Middle", -12, 12, 0, "dB"); tr = g.knob("treble", "Treble", -12, 12, 1, "dB")
    pr = g.knob("presence", "Presence", -6, 9, 2, "dB"); rm = g.knob("room", "Room", 0, 0.5, 0.12); lv = g.knob("level", "Level", -30, 6, -10, "dB")
    g.chain(g.block("in", "input"), g.block("tight", "filter", {"mode": "highpass", "freq": 90, "q": 0.7}), g.block("pre", "drive", {"mode": "tube", "drive": ga, "tone": 7000, "level": 0, "mix": 1, "oversample": 2}),
            g.block("bass", "eq", {"mode": "lowshelf", "freq": 120, "q": 0.7, "gain": ba}), g.block("mid", "eq", {"mode": "peak", "freq": 750, "q": 0.8, "gain": mi}), g.block("treb", "eq", {"mode": "highshelf", "freq": 2800, "q": 0.7, "gain": tr}),
            g.block("cab", "filter", {"mode": "lowpass", "freq": 5200, "q": 0.9, "slope": 24}), g.block("pres", "eq", {"mode": "peak", "freq": 2400, "q": 1.1, "gain": pr}), g.block("cabhp", "filter", {"mode": "highpass", "freq": 75, "q": 0.8}),
            g.block("room", "reverb", {"size": 0.25, "damp": 0.5, "mix": rm, "predelay": 4, "width": 0.7, "mod": 0.1}), g.block("lvl", "gain", {"gain": lv}), g.block("out", "output"))
    g.preset("Clean", gain=4, bass=2, treble=2, level=-4); g.preset("Edge of breakup", gain=14, mid=1, level=-10); g.preset("Crunch", gain=24, mid=2, treble=0, level=-16); g.preset("Lead", gain=32, mid=4, presence=4, room=0.2, level=-20)
    P.append(g.done())

    g = G("bass-amp", "Bass Amp", "saturation", "plugins", "A bass amp for a bass plugged straight in: a compressor to even it out, drive blended under the clean sound, and a bass, mid and treble that suit a bass guitar.")
    co = g.knob("comp", "Compression", -40, 0, -18, "dB"); dr = g.knob("drive", "Drive", 0, 30, 10, "dB"); bl = g.knob("blend", "Drive blend", 0, 1, 0.3)
    ba = g.knob("bass", "Bass", -12, 12, 2, "dB"); mi = g.knob("mid", "Middle", -12, 12, -2, "dB"); tr = g.knob("treble", "Treble", -12, 12, 0, "dB"); lv = g.knob("level", "Level", -24, 6, 0, "dB")
    g.block("in", "input", col=0, row=1)
    g.block("comp", "compressor", {"style": "opto", "detect": "rms", "threshold": co, "ratio": 4, "attack": 15, "release": 200, "knee": 8, "makeup": 4}, col=1, row=1); g.wire("in", "comp")
    g.block("dr", "drive", {"mode": "tube", "drive": dr, "tone": 3000, "level": -6, "mix": 1, "oversample": 2}, col=2, row=0); g.wire("comp", "dr")
    g.block("blend", "mix", {"mix": bl, "law": "equal"}, col=3, row=1); g.wire("dr", "blend", "wet"); g.wire("comp", "blend", "dry")
    g.chain("blend", g.block("bass", "eq", {"mode": "lowshelf", "freq": 80, "q": 0.7, "gain": ba}, col=4, row=1), g.block("mid", "eq", {"mode": "peak", "freq": 500, "q": 0.9, "gain": mi}, col=5, row=1),
            g.block("treb", "eq", {"mode": "highshelf", "freq": 2500, "q": 0.7, "gain": tr}, col=6, row=1), g.block("top", "filter", {"mode": "lowpass", "freq": 7000, "q": 0.7}, col=7, row=1),
            g.block("lvl", "gain", {"gain": lv}, col=8, row=1), g.block("out", "output", col=9, row=1))
    g.preset("Round", bass=3, mid=-2, treble=-2, blend=0.15); g.preset("Growl", drive=20, blend=0.45, mid=2, treble=2); g.preset("Worship pocket", comp=-22, bass=2, mid=-3, blend=0.2)
    P.append(g.done())

    P.append(code_plugin("auto-swell", "Auto Swell", "dynamics", "plugins",
        "Fades each note in by itself, like rolling the volume knob up after you pick: the violin-like swell of ambient worship guitar. Set how loud a note must be to count and how slowly it rises.",
        [("threshold", "Sensitivity", -60, -10, -38, "dB"), ("rise", "Rise", 50, 2000, 450, "ms", True), ("curve", "Curve", 1, 3, 2), ("mix", "Mix", 0, 1, 1)], r"""
@init
armed = 1
@block
ka = 1 - exp(-1 / (0.001 * srate))
kr = 1 - exp(-1 / (0.06 * srate))
th = db2gain(threshold)
step = 1000 / (rise * srate)
@sample
lv = max(abs(inL), abs(inR))
env += (lv - env) * (lv > env ? ka : kr)
if (env > th && armed) { armed = 0; g = 0 }
if (env < th * 0.5) { armed = 1 }
g = min(1, g + step)
w = pow(g, curve)
outL = inL * (1 - mix + mix * w)
outR = inR * (1 - mix + mix * w)
""", [("Violin swell", {"rise": 450}), ("Slow pad", {"rise": 1200, "curve": 2.5}), ("Quick fade", {"rise": 150, "curve": 1.5})]))

    P.append(code_plugin("reverse-delay", "Reverse Delay", "delay", "plugins",
        "Plays what you just played backwards, a moment later: the dreamy, sucked-in repeats of an ambient guitar or a vocal throw. Two overlapping readers keep it smooth.",
        [("time", "Time", 100, 650, 400, "ms"), ("feedback", "Repeats", 0, 0.8, 0.3), ("mix", "Mix", 0, 1, 0.35), ("tone", "Tone", 1500, 12000, 6000, "Hz", True)], r"""
array bL[65536]
array bR[65536]
@block
n = max(64, min(32000, floor(time * srate / 1000)))
kt = 1 - exp(-2 * pi * tone / srate)
@sample
k += 1
if (k >= n) { k = 0 }
k2 = k + n * 0.5
if (k2 >= n) { k2 -= n }
w1 = 1 - abs(2 * k / n - 1)
w2 = 1 - w1
rL = bL[w - 2 * k - 1] * w1 + bL[w - 2 * k2 - 1] * w2
rR = bR[w - 2 * k - 1] * w1 + bR[w - 2 * k2 - 1] * w2
fL += (rL - fL) * kt
fR += (rR - fR) * kt
bL[w] = inL + fL * feedback
bR[w] = inR + fR * feedback
w += 1
if (w >= 65536) { w = 0 }
outL = inL * (1 - mix) + fL * mix
outR = inR * (1 - mix) + fR * mix
""", [("Dream", {"time": 400, "feedback": 0.3, "mix": 0.35}), ("Swirl", {"time": 600, "feedback": 0.6, "mix": 0.45, "tone": 4000}), ("Short flip", {"time": 180, "feedback": 0.1, "mix": 0.3})]))

    P.append(code_plugin("sub-enhancer", "Sub Enhancer", "pitch", "plugins",
        "Adds a note an octave below the low end, made from it: a deeper kick, a bass that you feel on a big system, or weight under a thin synth.",
        [("amount", "Sub", 0, 1, 0.4), ("freq", "From below", 60, 250, 140, "Hz", True), ("tone", "Smoothness", 40, 160, 90, "Hz", True)], r"""
@block
k = 1 - exp(-2 * pi * freq / srate)
ks = 1 - exp(-2 * pi * tone / srate)
ke = 1 - exp(-1 / (0.01 * srate))
@sample
m = (inL + inR) * 0.5
l1 += (m - l1) * k + 1e-20
l2 += (l1 - l2) * k
if (l2 > 0 && pr <= 0) { sq = sq > 0 ? -1 : 1 }
if (sq == 0) { sq = 1 }
pr = l2
e += (abs(l2) - e) * ke
s1 += (sq * e - s1) * ks
s2 += (s1 - s2) * ks
sub = s2 * amount * 2.2
outL = inL + sub
outR = inR + sub
""", [("Kick weight", {"amount": 0.35, "freq": 120}), ("Deep bass", {"amount": 0.5, "freq": 150, "tone": 80}), ("Subtle", {"amount": 0.2})]))

    return P
