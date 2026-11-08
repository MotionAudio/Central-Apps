#!/usr/bin/python3
"""Rev B layout plan (v7): 7-inch main touchscreen (Pi Touch Display 2), 7.9-inch bar touchscreen, 8 footswitches
across + one above each end switch, 18 label screens. To scale, front view, black and gold."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, FancyBboxPatch, Polygon

W, H = 390.0, 278.0
GOLD = "#d4af37"
BRASS = "#E2C27E"
fig, ax = plt.subplots(figsize=(17.5, 13.4), dpi=170)
ax.set_xlim(-6, W + 6)
ax.set_ylim(H + 24, -24)
ax.set_aspect("equal")
ax.axis("off")

ax.add_patch(Rectangle((0, 0), W, H, fc="#111111", ec=GOLD, lw=2))
for (x, y) in [(5, 5), (W - 5, 5), (5, H - 5), (W - 5, H - 5), (W / 2, 5), (W / 2, H - 5), (5, 150), (W - 5, 150)]:
    ax.add_patch(Circle((x, y), 1.6, fc=GOLD, ec="black", lw=0.6))


def label(x, y, s, size=6.5, color=GOLD, ha="center", va="center", weight="normal", rot=0, **kw):
    ax.text(x, y, s, size=size, color=color, ha=ha, va=va, weight=weight, rotation=rot, **kw)


def rbox(x0, y0, w, h, fc, ec="none", lw=0.4, r=1.6):
    ax.add_patch(FancyBboxPatch((x0, y0), w, h, boxstyle="round,pad=0,rounding_size=%g" % r, fc=fc, ec=ec, lw=lw))


def quarter_jack(x, name, bold=True):
    ax.add_patch(Rectangle((x - 8, 0), 16, 20, fc="#1c1c1c", ec=GOLD, lw=0.8))
    ax.add_patch(Circle((x, -3), 6, fc="#333", ec=GOLD, lw=0.8))
    ax.add_patch(Circle((x, -3), 3.2, fc="black"))
    label(x, 11, name, size=5, color=GOLD if bold else "#e8d9a0", weight="bold" if bold else "normal")


def mini_jack(x, name):
    ax.add_patch(Rectangle((x - 3.5, 0), 7, 13, fc="#1c1c1c", ec=GOLD, lw=0.8))
    ax.add_patch(Circle((x, -2), 2.6, fc="#333", ec=GOLD, lw=0.6))
    label(x, 15, name, size=4.2, rot=90, va="top")


def oled(x, y, text):
    rbox(x - 14, y - 4.6, 28, 9.2, "#1b1b1b", ec="#6b5a2a", lw=0.7)
    ax.add_patch(Rectangle((x - 11.2, y - 2.8), 22.4, 5.6, fc="#05070a", ec="none"))
    label(x, y + 0.1, text, size=3.6, color="#e9f3ff", weight="bold", family="DejaVu Sans Mono")


def knob(x, y, n):
    ax.add_patch(Circle((x, y), 10, fc="#0c0c0c", ec="#2a2a2a", lw=2.4))
    ax.add_patch(Circle((x, y), 9.2, fc="#1a1a1a", ec=GOLD, lw=1.1))
    ax.add_patch(Polygon([(x - 0.9, y - 3), (x + 0.9, y - 3), (x + 0.6, y - 8.6), (x - 0.6, y - 8.6)], fc=GOLD, ec="none"))
    label(x, y + 13.2, "KNOB %d" % n, size=4.2)


def footswitch(x, y, n):
    ax.add_patch(Circle((x, y), 10.5, fc="#0c0c0c", ec="#2a2a2a", lw=2))
    ax.add_patch(Circle((x, y), 9.5, fc="#1a1a1a", ec=GOLD, lw=1.2))
    ax.add_patch(Circle((x, y), 5.8, fc=GOLD, ec="#f1dc9c", lw=0.6))
    ax.add_patch(Circle((x + 14, y - 11), 2.2, fc="#ffd24d", ec="white", lw=0.5))
    label(x, y + 14.5, "FSW %d" % n, size=4.4)


# ---------- BACK PANEL
ax.add_patch(Rectangle((14 - 4, 0), 8, 8, fc="#1c1c1c", ec=GOLD, lw=0.8))
ax.add_patch(Circle((14, -2.5), 3.2, fc="#c00", ec="white", lw=0.8))
label(14, 11, "POWER", size=4.5, va="top")
ax.add_patch(Rectangle((28 - 4.5, 0), 9, 8, fc="#1c1c1c", ec=GOLD, lw=0.8))
rbox(28 - 4.5, -2.5, 9, 3.2, "#333", ec=GOLD, lw=0.6, r=1.5)
label(28, 11, "USB-C\nPD IN", size=4.5, va="top")
ax.add_patch(Rectangle((44 - 7, 0), 14, 15, fc="#1c1c1c", ec=GOLD, lw=0.8))
ax.add_patch(Rectangle((44 - 6, -2), 12, 4, fc="#333", ec=GOLD, lw=0.6))
label(44, 18, "USB-A", size=4.5, va="top")
label(29, -14, "power · USB-C · USB-A", size=5.5, color="black")

names = ["EXT\nFSW A", "INST\nIN A", "OUT 1", "OUT 2", "OUT 3", "OUT 4", "OUT 5", "OUT 6", "INST\nIN B", "EXT\nFSW B"]
for i, n in enumerate(names):
    quarter_jack(W / 2 - 90 + 20 * i, n, bold=not n.startswith("EXT"))
label(W / 2, -14, "six mono 1/4\" outputs centred · instrument input each side · external footswitch jack outside each  (Neutrik NMJ6HCD2)", size=5.8, color="black")

mini_jack(W - 40, "MIDI IN")
mini_jack(W - 28, "MIDI OUT")
mini_jack(W - 16, "PHONES")
label(W - 28, -14, "MIDI in · MIDI out · phones", size=5.5, color="black")

# ---------- CONTROL BAND: faders, knob triangles, label screens
for side in ("L", "R"):
    X = (lambda x: x) if side == "L" else (lambda x: W - x)
    k = (1, 2, 3) if side == "L" else (6, 4, 5)
    fx = X(W / 2 - 3.5 * 48)        # the fader sits on the end footswitch's centre line
    oled(fx, 30, "FADER %s" % ("A" if side == "L" else "B"))
    ax.add_patch(Rectangle((fx - 4.5, 46), 9, 75, fc="#1a1a1a", ec=GOLD, lw=0.9))
    ax.add_patch(Rectangle((fx - 0.8, 53.5), 1.6, 60, fc="#050505"))
    rbox(fx - 5.5, 78, 11, 7, GOLD, ec="#7a6220", lw=0.6, r=1.2)
    label(fx, 127, "FADER %s" % ("A" if side == "L" else "B"), size=4.2)
    oled(X(55), 64, "KNOB %d" % k[0]); knob(X(55), 84, k[0])
    oled(X(85), 30, "KNOB %d" % k[1]); knob(X(85), 48, k[1])
    oled(X(85), 102, "KNOB %d" % k[2]); knob(X(85), 120, k[2])

# ---------- 7-inch main touchscreen (Raspberry Pi Touch Display 2) running the Live view
sw, sh = 189.32, 120.24
sx, sy = (W - sw) / 2, 27
rbox(sx, sy, sw, sh, "#0a0a0a", ec="#333", lw=1.2, r=2)
ux, uy, uw, uh = sx + (sw - 155) / 2, sy + (sh - 88) / 2, 155.0, 88.0
ax.add_patch(Rectangle((ux, uy), uw, uh, fc="#111317", ec="none"))
K = uw / 108.8                   # the mock was drawn for a 108.8-wide screen
Ky = uh / 65.3


def P(v):      # x-size scale
    return v * K


def Q(v):      # y-size scale
    return v * Ky


fs = 1.32      # font scale
ax.add_patch(Rectangle((ux, uy), uw, Q(6), fc="#0B0D10", ec="none"))
tx = ux + P(3)
for i, t in enumerate(["● Live", "Pad", "Tracks", "Instrument", "Looper", "Controls", "I/O"]):
    wdt = P(1.55 * len(t) + 2.2)
    if i == 0:
        rbox(tx - P(1), uy + Q(1), wdt, Q(4), "#23272E", r=1)
        label(tx + wdt / 2 - P(1), uy + Q(3.1), t, size=2.9 * fs, color=BRASS, weight="bold")
    else:
        label(tx + wdt / 2 - P(1), uy + Q(3.1), t, size=2.9 * fs, color="#9AA1AB")
    tx += wdt + P(2)
ax.add_patch(Circle((ux + uw - P(5), uy + Q(3)), 1.6, fc="#6FCF97", ec="none"))
label(ux + uw - P(9.5), uy + Q(3.1), "7.9 V ▮▮▮▯", size=2.3 * fs, color="#9AA1AB")
label(ux + P(3), uy + Q(11.5), "GOODNESS OF GOD", size=5.2 * fs, color="#ECE7DD", weight="bold", ha="left")
label(ux + P(3), uy + Q(16), "Bethel  ·  Key D  ·  63 BPM  ·  4/4", size=3 * fs, color="#9AA1AB", ha="left")
rbox(ux + uw - P(30), uy + Q(8.5), P(27), Q(9), BRASS, r=1.4)
label(ux + uw - P(16.5), uy + Q(13), "▶  PLAYING", size=3.4 * fs, color="#1A1408", weight="bold")
bx = ux + P(3)
for s_, live in [("INTRO", False), ("V1", False), ("CH", True), ("V2", False), ("CH", False), ("BRIDGE", False), ("CH", False), ("OUT", False)]:
    wdt = P(2.2 * len(s_) + 5)
    rbox(bx, uy + Q(20), wdt, Q(6), BRASS if live else "#1A1D22", ec="none" if live else "#343A44", r=1)
    label(bx + wdt / 2, uy + Q(23.1), s_, size=2.8 * fs, color="#1A1408" if live else "#ECE7DD", weight="bold" if live else "normal")
    bx += wdt + P(1.5)
ax.add_patch(Rectangle((ux + P(3), uy + Q(28.5)), uw - P(6), Q(1.6), fc="#23272E", ec="none"))
ax.add_patch(Rectangle((ux + P(3), uy + Q(28.5)), (uw - P(6)) * 0.38, Q(1.6), fc=BRASS, ec="none"))
label(ux + P(3), uy + Q(32.5), "1:24", size=2.6 * fs, color="#9AA1AB", ha="left")
label(ux + uw - P(3), uy + Q(32.5), "-2:51", size=2.6 * fs, color="#9AA1AB", ha="right")
rbox(ux + P(3), uy + Q(36), P(44), Q(26), "#1A1D22", ec="#343A44")
label(ux + P(6), uy + Q(40), "PAD", size=2.6 * fs, color="#9AA1AB", ha="left")
label(ux + P(6), uy + Q(45.5), "Warm Strings  ·  D", size=3.6 * fs, color="#ECE7DD", weight="bold", ha="left")
label(ux + P(6), uy + Q(50.5), "swell 60%   reverb 45%   tone 30%", size=2.6 * fs, color="#9AA1AB", ha="left")
ax.add_patch(Rectangle((ux + P(6), uy + Q(55)), P(38), Q(2.4), fc="#23272E", ec="none"))
ax.add_patch(Rectangle((ux + P(6), uy + Q(55)), P(38) * 0.6, Q(2.4), fc="#6FCF97", ec="none"))
rbox(ux + P(50), uy + Q(36), P(30), Q(26), "#1A1D22", ec="#343A44")
label(ux + P(53), uy + Q(40), "NEXT", size=2.6 * fs, color="#9AA1AB", ha="left")
label(ux + P(53), uy + Q(45.5), "Build My Life", size=3.4 * fs, color="#ECE7DD", weight="bold", ha="left")
label(ux + P(53), uy + Q(50), "Key G · 72 BPM", size=2.6 * fs, color="#9AA1AB", ha="left")
label(ux + P(53), uy + Q(56), "CLICK  ON     CUES  ON", size=2.5 * fs, color=BRASS, ha="left")
rbox(ux + P(83), uy + Q(36), P(22.8), Q(26), "#1A1D22", ec="#343A44")
label(ux + P(94.4), uy + Q(40), "OUTPUTS", size=2.6 * fs, color="#9AA1AB")
for i, lvl in enumerate([0.7, 0.72, 0.5, 0.55, 0.35, 0.3]):
    mx = ux + P(86 + i * 3.3)
    ax.add_patch(Rectangle((mx, uy + Q(43)), P(2.2), Q(16), fc="#0B0D10", ec="none"))
    ax.add_patch(Rectangle((mx, uy + Q(43 + 16 * (1 - lvl))), P(2.2), Q(16 * lvl), fc="#6FCF97" if lvl < 0.7 else "#F0B429", ec="none"))
    label(mx + P(1.1), uy + Q(61), str(i + 1), size=2.2 * fs, color="#6E7682")
label(W / 2, sy + sh + 4.5, "7\" Raspberry Pi Touch Display 2, 1280 × 720 (189 × 120 mm), on four standoffs shared with the Pi 4 behind the board — ribbon through a slot to the Pi", size=4.3, color="#8d8d8d")

# ---------- 7.9-inch bar touchscreen above FSW 2-7
bw, bh = 287.0, 70.0
bx0, by0 = (W - bw) / 2, 158
rbox(bx0, by0, bw, bh, "#0a0a0a", ec="#333", lw=1.2, r=2)
vx, vy, vw, vh = bx0 + 9.5, by0 + 6, 268.0, 58.0
ax.add_patch(Rectangle((vx, vy), vw, vh, fc="#111317", ec="none"))
rbox(vx + 3, vy + 3, 52, vh - 6, "#1A1D22", ec="#343A44")
label(vx + 6, vy + 7.5, "NOW", size=2.8, color="#9AA1AB", ha="left")
label(vx + 6, vy + 13, "Goodness of God", size=4.2, color="#ECE7DD", weight="bold", ha="left")
label(vx + 6, vy + 18, "CHORUS  ·  bar 3 of 8", size=3, color=BRASS, ha="left")
label(vx + 6, vy + 26, "LOOPER", size=2.8, color="#9AA1AB", ha="left")
for i in range(4):
    ax.add_patch(Rectangle((vx + 6 + i * 11.5, vy + 29), 11, 7, fc=["#6FCF97", "#6FCF97", "#F0B429", "#23272E"][i], ec="#0B0D10", lw=0.4))
label(vx + 6, vy + 40, "● REC layer 3   ·   2 bars   ·   63 BPM", size=2.8, color="#EF6B63", ha="left")
label(vx + 6, vy + 47, "PAD  Warm Strings · D", size=3, color="#ECE7DD", ha="left")
label(vx + 6, vy + 52, "CLICK on  ·  CUES on  ·  OUT 1-2 FOH", size=2.6, color="#9AA1AB", ha="left")
label(vx + 60, vy + 7.5, "SOUNDS", size=2.8, color=BRASS, weight="bold", ha="left")
label(vx + 76, vy + 7.5, "SONGS      FILES      LOOPS", size=2.8, color="#9AA1AB", ha="left")
for i, (name, key, sel) in enumerate([("Warm Strings", "D", True), ("Glass Pad", "D", False), ("Choir Air", "D", False), ("Deep Drone", "D", False), ("Shimmer", "D", False), ("Sub Bed", "D", False), ("Organ Swell", "D", False), ("Piano Bed", "D", False), ("Cinematic", "D", False), ("Ambient Gtr", "D", False)]):
    tx0 = vx + 60 + i * 19.5
    rbox(tx0, vy + 11, 18, 30, BRASS if sel else "#1A1D22", ec="none" if sel else "#343A44", r=1.4)
    label(tx0 + 9, vy + 20, name.replace(" ", "\n"), size=2.7, color="#1A1408" if sel else "#ECE7DD", weight="bold" if sel else "normal")
    label(tx0 + 9, vy + 35, key, size=3.4, color="#1A1408" if sel else BRASS, weight="bold")
ax.add_patch(Rectangle((vx + 60, vy + 44), vw - 63, 1.2, fc="#23272E", ec="none"))
ax.add_patch(Rectangle((vx + 80, vy + 44), 30, 1.2, fc=BRASS, ec="none"))
label(vx + 60, vy + 50, "‹ swipe to scroll ›   tap a tile to load it   ·   hold for options", size=2.6, color="#6E7682", ha="left")
rbox(vx + vw - 34, vy + 47, 31, 8, "#23272E", r=1.4)
label(vx + vw - 18.5, vy + 51, "▶  PLAY NEXT SONG", size=2.7, color="#ECE7DD", weight="bold")

# ---------- FOOTSWITCHES: 8 across (pitch 48) + one above each end switch
pitch = 48
for i in range(8):
    x = W / 2 - 3.5 * pitch + pitch * i
    oled(x, 236, "FSW %d" % (i + 1))
    footswitch(x, 256, i + 1)
for x, n in [(W / 2 - 3.5 * pitch, 9), (W / 2 + 3.5 * pitch, 10)]:
    oled(x, 182, "FSW %d" % n)
    footswitch(x, 202, n)

# ---------- legend
label(W / 2, H + 7, "Board 390 × 278 mm (15.4 × 10.9 in), 4 layers, black solder mask, gold (ENIG) finish.  Top edge = back panel.  Eight footswitches across (48 mm apart) + one above each end switch, light beside each.", size=5.8, color="black")
label(W / 2, H + 12.5, "Eighteen 0.91\" OLED label screens behind windows in the top plate (one above every footswitch, knob and fader) show what that control is assigned to; the app rewrites them when a mapping changes.", size=5.8, color="black")
label(W / 2, H + 18, "Bar: 11.9\" touchscreen, 1480 × 320 (287 × 70 mm) — scroll sounds, songs, files, loops; shows what is playing and looping.  Click-knobs (encoders: detented turn + press).  Under the main screen: 3 DACs, USB hub, instrument ADC, headphone amp, MIDI, expanders, I²C muxes, charger and power.", size=5.8, color="black")
label(-3, H / 2, "LEFT", size=7, color="black", rot=90)
label(W + 3, H / 2, "RIGHT", size=7, color="black", rot=270)

plt.tight_layout()
plt.savefig("/home/claude/pcb/out/rev-b-layout-plan.png", dpi=170, bbox_inches="tight", facecolor="white")
print("ok")
