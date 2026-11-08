#!/usr/bin/python3
"""Central Pedal rev B.3 - blueprint set (A3 PDF): overview, exploded assembly sequence, base / back panel / side
panel / top plate drawings with dimensions and coordinate tables, board mechanical drawing and height stack, wiring,
hardware list and print settings.  Everything is drawn from the same model and board geometry as the STEP files.

    python3 blueprint.py            -> ../out/enclosure/central-pedal-blueprints.pdf (+ the renders it uses)
"""
import os
import sys
import textwrap

import numpy as np
import trimesh
import cadquery as cq
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt                          # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages    # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle, Circle  # noqa: E402

sys.argv = [sys.argv[0], "--no-tiles"]
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enclosure as E  # noqa: E402

OUT = os.path.join(HERE, "..", "out", "enclosure")
TMP = "/tmp/claude-0/-home-claude/a668f7e4-aae0-5581-8b01-5647c153ccca/scratchpad"
PDF = os.path.join(OUT, "central-pedal-blueprints.pdf")
DATE = "2026-11-08"
REV = "B.3"
GOLD = "#b8860b"
INK = "#111111"
LIGHT = "#8a8a8a"
A3 = (16.54, 11.69)

# ------------------------------------------------------------------ model
base = E.lap_screw_holes(E.make_base())
plate = E.make_plate()
splices = E.make_splices()
plunger = E.make_plunger()
refs = E.make_refs()
G = E.G
H = E.H


def bx(x):           # CAD X -> drawing X (origin = outside front-left corner of the box)
    return x - E.XO0


def by(y):
    return y - E.YO0


# ------------------------------------------------------------------ renders
def mesh(shape, tol=0.2):
    p = os.path.join(TMP, "_bp.stl")
    cq.exporters.export(shape, p, tolerance=tol, angularTolerance=0.35)
    return trimesh.load(p)


def render(items, az, el, out, W=1700, Hh=1150, bg=(1, 1, 1)):
    a, e = np.radians(az), np.radians(el)
    view = np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
    up = np.array([0, 0, 1.0]); right = np.cross(up, view); right /= np.linalg.norm(right); up2 = np.cross(view, right)
    light = np.array([0.35, -0.45, 0.82]); light /= np.linalg.norm(light)
    tris, cols = [], []
    for m, col in items:
        v = m.vertices; f = m.faces; n = m.face_normals
        keep = (n @ view) > -0.2; f = f[keep]; n = n[keep]
        tris.append(v[f])
        shade = 0.32 + 0.68 * np.clip(np.abs(n @ light), 0, 1)
        cols.append(np.clip(np.array(col)[None, :] * shade[:, None], 0, 1))
    tris = np.concatenate(tris); cols = np.concatenate(cols)
    px = tris @ right; py = tris @ up2; pz = tris @ view
    x0, x1, y0, y1 = px.min(), px.max(), py.min(), py.max()
    s = min((W - 40) / (x1 - x0), (Hh - 40) / (y1 - y0))
    sx = (px - x0) * s + 20; sy = Hh - ((py - y0) * s + 20)
    zbuf = np.full((Hh, W), -1e9); img = np.ones((Hh, W, 3)) * np.array(bg)
    for i in range(len(tris)):
        xs, ys, zs = sx[i], sy[i], pz[i]
        xa, xb = int(max(0, np.floor(xs.min()))), int(min(W - 1, np.ceil(xs.max())))
        ya, yb = int(max(0, np.floor(ys.min()))), int(min(Hh - 1, np.ceil(ys.max())))
        if xa > xb or ya > yb:
            continue
        gx, gy = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
        (x1_, y1_), (x2_, y2_), (x3_, y3_) = (xs[0], ys[0]), (xs[1], ys[1]), (xs[2], ys[2])
        det = (y2_ - y3_) * (x1_ - x3_) + (x3_ - x2_) * (y1_ - y3_)
        if abs(det) < 1e-9:
            continue
        l1 = ((y2_ - y3_) * (gx - x3_) + (x3_ - x2_) * (gy - y3_)) / det
        l2 = ((y3_ - y1_) * (gx - x3_) + (x1_ - x3_) * (gy - y3_)) / det
        l3 = 1 - l1 - l2
        inside = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not inside.any():
            continue
        z = l1 * zs[0] + l2 * zs[1] + l3 * zs[2]
        sub = zbuf[ya:yb + 1, xa:xb + 1]
        upd = inside & (z > sub)
        sub[upd] = z[upd]
        img[ya:yb + 1, xa:xb + 1][upd] = cols[i]
    Image.fromarray((img * 255).astype(np.uint8)).save(out)
    print("render", os.path.basename(out))
    return out


C = dict(case=(0.2, 0.2, 0.21), board=(0.12, 0.42, 0.2), pi=(0.1, 0.55, 0.25), glass=(0.06, 0.06, 0.09),
         knob=(0.12, 0.12, 0.13), chrome=(0.72, 0.72, 0.75), amber=(1.0, 0.78, 0.2), grey=(0.38, 0.38, 0.4), gold=(0.83, 0.69, 0.22))
M = {}
for k, shp in (("base", base), ("plate", plate), ("splices", splices), ("plunger", plunger)):
    M[k] = mesh(shp)
for k in ("board", "pi", "display7", "bar_screen", "knobs", "footswitches", "fader_caps", "leds", "fan", "plugs", "side_io"):
    M[k] = mesh(refs[k])


def moved(m, dz):
    c = m.copy(); c.apply_translation((0, 0, dz)); return c


def renders():
    R = {}
    R["iso"] = render([(M["base"], C["case"]), (M["plate"], C["case"]), (M["display7"], C["glass"]), (M["bar_screen"], C["glass"]),
                       (M["knobs"], C["knob"]), (M["footswitches"], C["chrome"]), (M["fader_caps"], C["knob"]), (M["leds"], C["amber"])],
                      -60, 32, os.path.join(OUT, "bp-iso.png"))
    lc = (0.34, 0.34, 0.36)
    R["right"] = render([(M["base"], lc), (M["plate"], lc), (M["knobs"], C["knob"]), (M["footswitches"], C["chrome"]), (M["side_io"], C["gold"]),
                         (M["display7"], C["glass"]), (M["bar_screen"], C["glass"])],
                        12, 8, os.path.join(OUT, "bp-right.png"))
    R["back"] = render([(M["base"], lc), (M["plate"], lc), (M["knobs"], C["knob"]), (M["footswitches"], C["chrome"]),
                        (M["display7"], C["glass"]), (M["bar_screen"], C["glass"])],
                       100, 8, os.path.join(OUT, "bp-back.png"))
    gap = dict(fan=0, pi=60, board=150, plate=225, top=265)
    R["exploded"] = render([(M["base"], C["case"]), (moved(M["fan"], gap["fan"]), C["grey"]), (moved(M["side_io"], 0), C["grey"]),
                            (moved(M["pi"], gap["pi"]), C["pi"]),
                            (moved(M["board"], gap["board"]), C["board"]), (moved(M["display7"], gap["board"]), C["glass"]),
                            (moved(M["bar_screen"], gap["board"]), C["glass"]),
                            (moved(M["plate"], gap["plate"]), C["case"]),
                            (moved(M["knobs"], gap["top"]), C["knob"]), (moved(M["fader_caps"], gap["top"]), C["knob"]),
                            (moved(M["footswitches"], gap["top"] - 15), C["chrome"])],
                           -62, 15, os.path.join(OUT, "bp-exploded.png"), W=1400, Hh=1600)
    steps = [
        [(M["base"], C["case"]), (M["fan"], C["grey"]), (M["side_io"], C["grey"])],
        [(M["base"], C["case"]), (M["fan"], C["grey"]), (M["side_io"], C["grey"]), (M["pi"], C["pi"])],
        [(M["board"], C["board"]), (M["display7"], C["glass"]), (M["bar_screen"], C["glass"]), (M["plugs"], C["grey"])],
        [(M["base"], C["case"]), (M["board"], C["board"]), (M["display7"], C["glass"]), (M["bar_screen"], C["glass"])],
        [(M["base"], C["case"]), (M["plate"], C["case"]), (M["display7"], C["glass"]), (M["bar_screen"], C["glass"]), (M["leds"], C["amber"])],
        [(M["base"], C["case"]), (M["plate"], C["case"]), (M["display7"], C["glass"]), (M["bar_screen"], C["glass"]),
         (M["knobs"], C["knob"]), (M["footswitches"], C["chrome"]), (M["fader_caps"], C["knob"]), (M["leds"], C["amber"])],
    ]
    R["steps"] = [render(it, -60, 38, os.path.join(OUT, "bp-step%d.png" % (i + 1)), W=900, Hh=620) for i, it in enumerate(steps)]
    return R


# ------------------------------------------------------------------ 2D helpers
def outline(shape, z):
    """polylines (in drawing coordinates) of a horizontal section of a solid"""
    polys = []
    try:
        sec = shape.section(z)
    except Exception:
        return polys
    for f in sec.faces().vals():
        for w in f.Wires():
            pts = []
            for e in w.Edges():
                n = 2 if e.geomType() == "LINE" else 24
                for t in np.linspace(0, 1, n):
                    p = e.positionAt(t)
                    pts.append((bx(p.x), by(p.y)))
            if pts:
                polys.append(np.array(pts))
    return polys


def sheet(title, n, total, subtitle=""):
    fig = plt.figure(figsize=A3)
    fig.patch.set_facecolor("white")
    # border + title block
    fig.add_artist(Rectangle((0.012, 0.015), 0.976, 0.97, transform=fig.transFigure, fill=False, lw=1.6, color=INK))
    tb = fig.add_axes([0.70, 0.02, 0.284, 0.085]); tb.set_xlim(0, 1); tb.set_ylim(0, 1); tb.axis("off")
    tb.add_patch(Rectangle((0, 0), 1, 1, fill=False, lw=1.2, color=INK))
    tb.add_patch(Rectangle((0, 0.62), 1, 0.38, color="#111111"))
    tb.text(0.03, 0.80, "CENTRAL PEDAL  rev %s" % REV, color=GOLD, fontsize=13, weight="bold", va="center")
    tb.text(0.97, 0.80, "MotionAudio.org", color="white", fontsize=9, ha="right", va="center")
    tb.text(0.03, 0.42, title, fontsize=11, weight="bold", va="center")
    tb.text(0.03, 0.15, "units mm  |  %s  |  sheet %d / %d" % (DATE, n, total), fontsize=8, va="center", color="#333")
    if subtitle:
        fig.text(0.025, 0.928, subtitle, fontsize=10, color="#333")
    fig.text(0.025, 0.945, title.upper(), fontsize=15, weight="bold", color=INK, va="bottom")
    return fig


def dim(ax, p1, p2, off, text=None, fs=7, color=INK):
    """linear dimension between p1 and p2 (drawing coords), offset perpendicular by off"""
    p1, p2 = np.array(p1, float), np.array(p2, float)
    d = p2 - p1
    L = np.hypot(*d)
    if L < 1e-6:
        return
    u = d / L
    nrm = np.array([-u[1], u[0]])
    a, b = p1 + nrm * off, p2 + nrm * off
    for p, q in ((p1, a), (p2, b)):
        ax.plot([p[0], q[0] + nrm[0] * np.sign(off) * 1.5], [p[1], q[1] + nrm[1] * np.sign(off) * 1.5], color=color, lw=0.4)
    ax.annotate("", xy=b, xytext=a, arrowprops=dict(arrowstyle="<|-|>", color=color, lw=0.6, mutation_scale=7))
    mid = (a + b) / 2 + nrm * (2.2 if off >= 0 else -2.2)
    ang = np.degrees(np.arctan2(u[1], u[0]))
    if ang > 90 or ang < -90:
        ang += 180
    ax.text(mid[0], mid[1], text if text is not None else "%.1f" % L, fontsize=fs, ha="center", va="center", rotation=ang, color=color,
            bbox=dict(boxstyle="square,pad=0.08", fc="white", ec="none"))


def draw_polys(ax, polys, color=INK, lw=0.6, fill=None):
    for p in polys:
        ax.plot(p[:, 0], p[:, 1], color=color, lw=lw)


def table(ax, x, y, rows, col_w, fs=6.2, line_h=3.6, header=True):
    for i, row in enumerate(rows):
        yy = y - i * line_h
        cx = x
        for j, cell in enumerate(row):
            ax.text(cx, yy, str(cell), fontsize=fs, va="top", ha="left", weight="bold" if (header and i == 0) else "normal",
                    family="DejaVu Sans Mono" if j > 0 else "DejaVu Sans")
            cx += col_w[j]
        if header and i == 0:
            ax.plot([x, x + sum(col_w)], [yy - line_h * 0.85, yy - line_h * 0.85], color=INK, lw=0.4)


# ------------------------------------------------------------------ sheets
def s_overview(pdf, R, n, N):
    fig = sheet("Overview", n, N, "The finished pedal: 400 x 288 x 52 mm, two printed parts (base + top plate), the board and the Raspberry Pi inside.")
    for (img, rect, cap) in ((R["iso"], [0.03, 0.38, 0.55, 0.50], "assembled"),
                             (R["right"], [0.60, 0.55, 0.38, 0.36], "right side: Ethernet / USB / USB / HDMI 2 panel ports"),
                             (R["back"], [0.60, 0.16, 0.38, 0.36], "back panel: power, USB-C, USB-A, jacks, MIDI, phones")):
        ax = fig.add_axes(rect); ax.imshow(Image.open(img)); ax.axis("off"); ax.set_title(cap, fontsize=9, loc="left")
    ax = fig.add_axes([0.03, 0.04, 0.55, 0.33]); ax.axis("off"); ax.set_xlim(0, 100); ax.set_ylim(0, 60)
    lines = [
        "WHAT IS IN THE BOX",
        "Base (printed, 4 tiles): floor, walls, back panel, right I/O panel, Pi bosses with M2.5 inserts, fan pads, board bosses.",
        "Top plate (printed, 4 tiles): every control comes through it - footswitch nuts on top, knobs on 30 mm shafts,",
        "   fader caps in recessed trays, bezelled windows for the 7\" and 11.9\" screens and the 18 label screens.",
        "Main board rev B.3 (PCBWay, assembled): all controls, jacks, label screens; the 7\" and 11.9\" screens screw onto it.",
        "Raspberry Pi 4 on the base floor, component side up; the board plugs onto it through a 2x20 stacking header.",
        "40 mm fan on the floor over the exhaust grille; side vents are the intake.",
        "",
        "OVERALL SIZE  400 x 288 mm footprint, 49 mm base + 3 mm plate (52 mm) + feet; knobs stand 15 mm above the plate.",
        "MATERIAL  PETG / ASA / ABS, black.  All tiles fit a 220 x 220 mm print bed.",
        "ORIGIN for every drawing: the outside FRONT-LEFT corner of the box, X to the right, Y toward the back.",
    ]
    for i, t in enumerate(lines):
        ax.text(0, 58 - i * 5.0, t, fontsize=9 if i else 11, weight="bold" if i in (0, 8, 9, 10) and i else ("bold" if i == 0 else "normal"),
                color=GOLD if i == 0 else INK)
    pdf.savefig(fig); plt.close(fig)


def s_assembly(pdf, R, n, N):
    fig = sheet("Assembly sequence", n, N, "Build it in this order. Steps 3-4: the screens screw on from the BACK of the board, so they go on before the board drops into the base.")
    ax = fig.add_axes([0.02, 0.10, 0.36, 0.83]); ax.imshow(Image.open(R["exploded"])); ax.axis("off")
    ax.set_title("exploded: base, fan, Pi, board + screens, top plate, knobs", fontsize=9, loc="left")
    steps = [
        ("1  Base", "Heat-set inserts (soldering iron, ~230 °C): 4 x M2.5 in the Pi bosses, 4 x M3 in the fan pads. || "
                    "Fan onto the 4 floor pads, label down (blows out through the floor grille): 4 x M3 x 16. || "
                    "4 panel-mount leads into the right wall, M3 x 8 + nuts. Power plunger into its back-panel hole from inside. "
                    "2S battery on its two straps."),
        ("2  Raspberry Pi", "Pi component side up, USB / Ethernet toward the right wall. 4 x M2.5 x 20 male-female standoffs: male end down "
                            "through each Pi hole into the base inserts - this screws the Pi to the case. || "
                            "Push the 2x20 stacking header onto the GPIO pins. Plug the side-panel leads into Ethernet and the two blue "
                            "USB 3.0 ports, the HDMI lead into HDMI1 (by the audio jack). Plug in the bar-screen HDMI lead (HDMI0, by USB-C) "
                            "and the USB-A to PH-4 lead (a black USB 2.0 port); leave their other ends loose."),
        ("3  Screens onto the board", "On the bench, BEFORE the board goes in - their screws go in from the back of the board. || "
                                      "7\" display and 11.9\" bar screen glass up, in their silkscreen outlines, 4 x M2.5 screws each from "
                                      "the back. Feed the 7\" ribbon down through the slot beside J1. Display power lead -> J_DISP, bar "
                                      "touch lead -> J_USB_BAR (both on the back)."),
        ("4  Board onto the Pi", "Hold the board just above the base and connect: 7\" ribbon -> Pi DISPLAY port, HDMI lead -> bar screen "
                                 "(through its slot), USB lead -> J_USB_UP, fan -> J_FAN, battery -> J_BAT. || "
                                 "Lower it: J1 slides over the stacking header and the board settles on the 4 Pi standoffs and the 17 "
                                 "base bosses. Nothing should be pinched."),
        ("5  Top plate", "Black foam tape around the two screen windows on the plate's underside (1 mm for the 7\", 2 mm for the bar). || "
                         "Set the plate on: shafts, levers, LEDs and footswitch bushings come through. Turn the pedal over and drive "
                         "17 x M3 x 40 from the bottom: base boss -> board -> plate insert. Snug, not tight."),
        ("6  Finish", "Washer + nut on each 1/4\" jack outside the back panel (bagged with the board). Footswitch nuts on top. "
                      "Push on the 6 knobs and 2 fader caps. 4 rubber feet in the corner recesses. || "
                      "Power on with the button: the screens and label screens come up."),
    ]
    for i, (h, t) in enumerate(steps):
        col, row = i % 3, i // 3
        x0 = 0.385 + col * 0.205
        top = 0.905 - row * 0.405
        ax = fig.add_axes([x0, top - 0.165, 0.195, 0.165]); ax.imshow(Image.open(R["steps"][i])); ax.axis("off")
        fig.text(x0, top - 0.180, h, fontsize=10.5, weight="bold", color=GOLD)
        body = "\n".join(textwrap.fill(p, 66) for p in t.replace("\n", " ").split(" || "))
        fig.text(x0, top - 0.192, body, fontsize=6.9, va="top", linespacing=1.35)
    pdf.savefig(fig); plt.close(fig)


def s_base(pdf, n, N):
    fig = sheet("Base - top view", n, N, "Section just above the floor (bold) and through the floor (thin): walls, bosses, Pi mounts, fan pads, grille, strap slots, seams.")
    ax = fig.add_axes([0.03, 0.12, 0.70, 0.82]); ax.set_aspect("equal"); ax.axis("off")
    draw_polys(ax, outline(base, E.Z_FLOOR - 2.0), LIGHT, 0.35)
    draw_polys(ax, outline(base, E.Z_FLOOR + 0.6), INK, 0.7)
    Wd, Hd = E.XO1 - E.XO0, E.YO1 - E.YO0
    dim(ax, (0, 0), (Wd, 0), -12, "%.0f" % Wd)
    dim(ax, (0, 0), (0, Hd), 12, "%.0f" % Hd)
    # Pi bosses
    pis = [(bx(E.P(x, y)[0]), by(E.P(x, y)[1])) for (x, y) in G["pi_holes"]]
    xs = sorted({round(p[0], 2) for p in pis}); ys = sorted({round(p[1], 2) for p in pis})
    for p in pis:
        ax.add_patch(Circle(p, 3.25, fill=False, color=GOLD, lw=1.0))
    dim(ax, (xs[0], ys[1]), (xs[1], ys[1]), 7, "%.0f" % (xs[1] - xs[0]), color=GOLD)
    dim(ax, (xs[1], ys[0]), (xs[1], ys[1]), -7, "%.0f" % (ys[1] - ys[0]), color=GOLD)
    ax.plot([xs[0], xs[0]], [ys[0], -18], color=GOLD, lw=0.3, ls=":")
    ax.plot([xs[0], Wd + 22], [ys[0], ys[0]], color=GOLD, lw=0.3, ls=":")
    ax.text(xs[0] + 1, -16, "%.1f" % xs[0], fontsize=6.5, color=GOLD, rotation=90, va="bottom")
    ax.text(Wd + 3, ys[0] + 1, "%.1f" % ys[0], fontsize=6.5, color=GOLD)
    ax.text(xs[0], ys[1] + 13, "Raspberry Pi 4: 4 bosses Ø6.5, M2.5 heat-set insert hole Ø%.1f x %.0f deep,\nboss top %.1f mm above the floor (Pi PCB sits on 20 mm standoffs above it)"
            % (E.PI_INSERT[0], E.PI_INSERT[1], E.PI_Z0 - E.Z_FLOOR), fontsize=6.5, color=GOLD)
    # fan
    FX, FY = bx(E.P(*E.FAN_AT)[0]), by(E.P(*E.FAN_AT)[1])
    ax.add_patch(Rectangle((FX - 20, FY - 20), 40, 40, fill=False, ls="--", color=GOLD, lw=0.8))
    dim(ax, (FX - 16, FY - 16), (FX + 16, FY - 16), -9, "32", color=GOLD)
    dim(ax, (FX - 16, FY - 16), (FX - 16, FY + 16), 9, "32", color=GOLD)
    ax.plot([FX, FX], [FY, -18], color=GOLD, lw=0.3, ls=":")
    ax.plot([-20, FX], [FY, FY], color=GOLD, lw=0.3, ls=":")
    ax.text(FX + 1, -16, "%.1f" % FX, fontsize=6.5, color=GOLD, rotation=90, va="bottom")
    ax.text(-19, FY + 1, "%.1f" % FY, fontsize=6.5, color=GOLD)
    ax.text(FX - 20, FY + 23, "40 mm fan: 4 pads Ø7 x %.0f high, M3 inserts;\nexhaust grille in the floor under it" % E.FAN_PAD_H, fontsize=6.5, color=GOLD)
    # battery
    bx0, bx1, by0, by1 = E.BATT_BAY
    ax.text(bx(E.P(bx0, by1)[0]) + 2, by(E.P(bx0, by1)[1]) + 3, "2S battery bay: strap slots 4 x 27", fontsize=6.5, color=LIGHT)
    # seams
    sx_, sy_ = bx(E.BASE_SEAM_X), by(H - E.BASE_SEAM_Y)
    ax.plot([sx_, sx_], [0, Hd], color="#c33", lw=0.5, ls="-.")
    ax.plot([0, Wd], [sy_, sy_], color="#c33", lw=0.5, ls="-.")
    ax.text(sx_ + 1, Hd + 3, "tile seam X %.1f (half-lap %.0f)" % (sx_, E.BASE_LAP), fontsize=6.5, color="#c33")
    ax.text(Wd + 2, sy_ + 1, "seam Y %.1f" % sy_, fontsize=6.5, color="#c33")
    ax.set_xlim(-25, Wd + 30); ax.set_ylim(-25, Hd + 15)
    # table of base features
    tx = fig.add_axes([0.74, 0.12, 0.25, 0.82]); tx.axis("off"); tx.set_xlim(0, 100); tx.set_ylim(0, 100)
    rows = [("feature", "X", "Y", "size")]
    for i, (x, y) in enumerate(G["holes"]):
        X, Y = E.P(x, y)
        rows.append(("board boss %d" % (i + 1), "%.1f" % bx(X), "%.1f" % by(Y), "Ø%.0f, M3 clear." % E.BOSS_D))
    for i, p in enumerate(pis):
        rows.append(("Pi boss %d" % (i + 1), "%.1f" % p[0], "%.1f" % p[1], "Ø6.5, M2.5 ins."))
    for sx in (-1, 1):
        for sy in (-1, 1):
            rows.append(("fan pad", "%.1f" % (FX + sx * 16), "%.1f" % (FY + sy * 16), "Ø7, M3 insert"))
    for (x, y) in ((15, 15), (E.W - 15, 15), (15, H - 15), (E.W - 15, H - 15)):
        X, Y = E.P(x, y)
        rows.append(("foot recess", "%.1f" % bx(X), "%.1f" % by(Y), "Ø%.0f x 1" % E.FEET_D))
    table(tx, 0, 99, rows, [36, 18, 18, 30], fs=6.0, line_h=2.55)
    tx.text(0, 99 - 2.55 * (len(rows) + 1), "Floor %.0f mm, walls %.0f mm, corner R%.0f,\nbottom edge fillet R%.1f. Bosses hold the board's\nunderside at Z 0 (floor top = %.0f)." % (E.T_FLOOR, E.WALL, E.R_OUT, E.EDGE_R, E.Z_FLOOR),
            fontsize=6.5, va="top")
    pdf.savefig(fig); plt.close(fig)


def s_panels(pdf, n, N):
    fig = sheet("Back panel and right side panel", n, N, "Seen from outside. Heights from the bottom of the base. All holes are cut in the base walls.")
    zb = E.Z_BOT
    # ---- back panel (seen from behind: X runs right-to-left, mirror for the viewer)
    ax = fig.add_axes([0.03, 0.52, 0.94, 0.40]); ax.set_aspect("equal"); ax.axis("off")
    Wd = E.XO1 - E.XO0
    Hz = E.Z_PLATE - zb

    def bxm(X):                       # viewed from behind: left in the drawing = the box's right side
        return Wd - bx(X)
    ax.add_patch(Rectangle((0, 0), Wd, Hz, fill=False, lw=1.0, color=INK))
    ax.plot([0, Wd], [E.Z_FLOOR - zb, E.Z_FLOOR - zb], color=LIGHT, lw=0.4, ls="--")
    ax.text(2, E.Z_FLOOR - zb + 1, "floor top", fontsize=6, color=LIGHT)
    ax.plot([0, Wd], [0 - zb, 0 - zb], color=LIGHT, lw=0.4, ls=":")
    ax.text(2, -zb + 1, "board top", fontsize=6, color=LIGHT)
    rows = [("item", "X from right", "height", "hole")]
    for (x, y) in G["jack"]:
        X = bxm(E.P(x, y)[0]); Z = E.JACK_AXIS_Z - zb
        ax.add_patch(Circle((X, Z), E.JACK_HOLE / 2, fill=False, lw=0.8, color=INK))
        ax.add_patch(Circle((X, Z), E.JACK_RING[1] / 2, fill=False, lw=0.4, ls="--", color=LIGHT))
        rows.append(("1/4\" jack", "%.1f" % X, "%.1f" % Z, "Ø%.1f (+ ring %.1f/%.0f inside)" % (E.JACK_HOLE, *E.JACK_RING)))
    for (x, y) in G["jack35"]:
        X = bxm(E.P(x, y)[0]); Z = E.JACK35_AXIS_Z - zb
        ax.add_patch(Circle((X, Z), E.JACK35_HOLE / 2, fill=False, lw=0.8, color=INK))
        rows.append(("3.5 mm jack", "%.1f" % X, "%.1f" % Z, "Ø%.1f" % E.JACK35_HOLE))
    for key, (w, h, zc), name in (("J_USBC", E.USBC_WIN, "USB-C window"), ("J_USBA", E.USBA_WIN, "USB-A window")):
        X = bxm(E.P(*G[key])[0]); Z = zc - zb
        ax.add_patch(FancyBboxPatch((X - w / 2, Z - h / 2), w, h, boxstyle="round,pad=0,rounding_size=%.1f" % (min(w, h) / 2 - 0.6), fill=False, lw=0.8, color=INK))
        rows.append((name, "%.1f" % X, "%.1f" % Z, "%.1f x %.1f, R%.1f" % (w, h, min(w, h) / 2 - 0.6)))
    X = bxm(E.P(*G["SW_PWR"])[0]); Z = E.PWR_Z - zb
    ax.add_patch(Circle((X, Z), E.PWR_HOLE / 2, fill=False, lw=0.8, color=INK))
    rows.append(("power plunger", "%.1f" % X, "%.1f" % Z, "Ø%.1f" % E.PWR_HOLE))
    dim(ax, (0, 0), (Wd, 0), -6, "%.0f" % Wd)
    dim(ax, (0, 0), (0, Hz), 6, "%.0f (base)" % Hz)
    jx = sorted(bxm(E.P(x, 0)[0]) for (x, y) in G["jack"])
    dim(ax, (jx[0], E.JACK_AXIS_Z - zb), (jx[1], E.JACK_AXIS_Z - zb), 14, "21 pitch")
    dim(ax, (jx[0], 0), (jx[0], E.JACK_AXIS_Z - zb), -5, "%.1f" % (E.JACK_AXIS_Z - zb))
    ax.set_xlim(-12, Wd + 5); ax.set_ylim(-14, Hz + 8)
    ax.set_title("BACK PANEL (from behind)", fontsize=10, loc="left", weight="bold")
    tx = fig.add_axes([0.03, 0.12, 0.45, 0.36]); tx.axis("off"); tx.set_xlim(0, 100); tx.set_ylim(0, 100)
    table(tx, 0, 99, rows, [22, 18, 14, 46], fs=6.2, line_h=5.4)
    # ---- right panel
    ax = fig.add_axes([0.50, 0.12, 0.48, 0.36]); ax.set_aspect("equal"); ax.axis("off")
    Dd = E.YO1 - E.YO0
    ax.add_patch(Rectangle((0, 0), Dd, Hz, fill=False, lw=1.0, color=INK))
    ax.plot([0, Dd], [E.Z_FLOOR - zb] * 2, color=LIGHT, lw=0.4, ls="--")
    ax.plot([0, Dd], [-E.T_PCB - zb] * 2, color=LIGHT, lw=0.4, ls=":")
    ax.text(2, -E.T_PCB - zb + 1, "board underside", fontsize=6, color=LIGHT)
    rrows = [("port", "Y from front", "height", "cut-out / screw slots")]
    for (yb, kind) in E.SIDE_IO:
        (fw, fh), (smin, smax), sw, _ = E.IO_SPEC[kind]
        Yd = by(E.P(0, yb)[1]); Z = E.SIDE_IO_Z - zb
        ax.add_patch(FancyBboxPatch((Yd - fw / 2, Z - fh / 2), fw, fh, boxstyle="round,pad=0,rounding_size=1", fill=False, lw=0.8, color=INK))
        for sgn in (-1, 1):
            a, b = Yd + sgn * smin / 2, Yd + sgn * smax / 2
            ax.plot([min(a, b), max(a, b)], [Z + sw / 2] * 2, color=INK, lw=0.6)
            ax.plot([min(a, b), max(a, b)], [Z - sw / 2] * 2, color=INK, lw=0.6)
        ax.text(Yd, Z + fh / 2 + 2.5, {"RJ45": "ETHERNET", "USB": "USB 3.0", "HDMI": "HDMI 2"}[kind], fontsize=6.5, ha="center", weight="bold")
        rrows.append((kind, "%.1f" % Yd, "%.1f" % Z, "%.1f x %.1f; slots %.0f-%.0f c/c, %.1f wide" % (fw, fh, smin, smax, sw)))
    vy = by(E.P(0, 240)[1])
    for k in range(E.VENT["n"]):
        Y = vy + (k - (E.VENT["n"] - 1) / 2) * E.VENT["pitch"]
        ax.add_patch(Rectangle((Y - E.VENT["w"] / 2, E.Z_FLOOR + 4 - zb), E.VENT["w"], E.VENT["h"], fill=False, lw=0.5, color=INK))
    rrows.append(("vents", "%.1f" % vy, "%.1f" % (E.Z_FLOOR + 4 - zb + E.VENT["h"] / 2), "%d slots %.0f x %.0f at %.0f pitch" % (E.VENT["n"], E.VENT["w"], E.VENT["h"], E.VENT["pitch"])))
    dim(ax, (0, 0), (Dd, 0), -6, "%.0f" % Dd)
    ax.set_xlim(-6, Dd + 4); ax.set_ylim(-14, Hz + 6)
    ax.set_title("RIGHT SIDE PANEL (from the right; front of the pedal at left)", fontsize=10, loc="left", weight="bold")
    t2 = fig.add_axes([0.50, 0.40, 0.48, 0.10]); t2.axis("off"); t2.set_xlim(0, 100); t2.set_ylim(0, 100)
    table(t2, 0, 98, rrows, [10, 16, 12, 62], fs=6.2, line_h=17)
    pdf.savefig(fig); plt.close(fig)


def s_plate(pdf, n, N):
    fig = sheet("Top plate - top view", n, N, "Section through the plate (bold); dashed: tile seams. Coordinates of every opening on the right.")
    ax = fig.add_axes([0.02, 0.12, 0.56, 0.78]); ax.set_aspect("equal"); ax.axis("off")
    draw_polys(ax, outline(plate, E.Z_PLATE + 1.5), INK, 0.6)
    Wd, Hd = E.XO1 - E.XO0, E.YO1 - E.YO0
    dim(ax, (0, 0), (Wd, 0), -10, "%.0f" % Wd)
    dim(ax, (0, 0), (0, Hd), 10, "%.0f" % Hd)
    sx_, sy_ = bx(E.PLATE_SEAM_X), by(H - E.PLATE_SEAM_Y)
    ax.plot([sx_, sx_], [0, Hd], color="#c33", lw=0.5, ls="-.")
    ax.plot([0, Wd], [sy_, sy_], color="#c33", lw=0.5, ls="-.")
    rows = [("opening", "X", "Y", "size")]
    for i, (x, y) in enumerate(G["fsw"]):
        X, Y = E.P(x, y); rows.append(("footswitch %d" % (i + 1), "%.1f" % bx(X), "%.1f" % by(Y), "Ø%.1f" % E.FSW_HOLE))
    for i, (x, y) in enumerate(G["led"]):
        X, Y = E.P(x, y); rows.append(("LED %d" % (i + 1), "%.1f" % bx(X), "%.1f" % by(Y), "Ø%.1f" % E.LED_HOLE))
    for i, (x, y) in enumerate(G["enc"]):
        X, Y = E.P(x, y); rows.append(("knob %d" % (i + 1), "%.1f" % bx(X), "%.1f" % by(Y), "Ø%.1f" % E.ENC_HOLE))
    for i, (x, y) in enumerate(G["fader"]):
        X, Y = E.P(x, y); rows.append(("fader %s" % "AB"[i], "%.1f" % bx(X), "%.1f" % by(Y), "slot %.1f x %.0f" % tuple(E.FADER_SLOT)))
    for (ref, x, y) in G["oled"]:
        X, Y = E.P(x + 17.5, y); rows.append((ref.replace("OLED_", "label "), "%.1f" % bx(X), "%.1f" % by(Y), "%.1f x %.1f" % E.OLED_WIN))
    for name, scr in (("7in window", E.DISP7), ("bar window", E.BAR)):
        X, Y = E.P(*scr["at"]); rows.append((name, "%.1f" % bx(X), "%.1f" % by(Y), "%.1f x %.1f" % (scr["active"][0] + 2, scr["active"][1] + 2)))
    for i, (x, y) in enumerate(G["holes"]):
        X, Y = E.P(x, y); rows.append(("boss %d" % (i + 1), "%.1f" % bx(X), "%.1f" % by(Y), "Ø%.0f, M3 insert" % E.PLATE_BOSS_D))
    body = rows[1:]
    per = (len(body) + 2) // 3
    for k in range(3):
        chunk = [rows[0]] + body[k * per:(k + 1) * per]
        tx = fig.add_axes([0.595 + k * 0.133, 0.12, 0.128, 0.80]); tx.axis("off"); tx.set_xlim(0, 100); tx.set_ylim(0, 100)
        table(tx, 0, 99.5, chunk, [33, 17, 17, 33], fs=5.6, line_h=99.0 / (per + 2))
    fig.text(0.025, 0.105, "Fader trays: %.0f x %.0f recess, floor %.1f above the board, lever slot %.1f x %.0f through.  Label windows %.1f x %.1f (X, Y = window centre).  "
             "Screen windows: 45° bezel %.1f mm.  All X / Y from the outside front-left corner." % (E.FADER_RECESS[0], E.FADER_RECESS[1], E.FADER_RECESS_FLOOR_Z, E.FADER_SLOT[0], E.FADER_SLOT[1], E.OLED_WIN[0], E.OLED_WIN[1], E.CHAMFER_WIN), fontsize=7)
    ax.set_xlim(-20, Wd + 6); ax.set_ylim(-20, Hd + 6)
    ax.text(2, Hd + 2, "Plate 3 mm, top at 19 mm above the board, top edge fillet R%.1f; windows bezelled 45° x %.1f; knob / LED holes chamfered" % (E.EDGE_R, E.CHAMFER_WIN), fontsize=7)
    pdf.savefig(fig); plt.close(fig)


def s_board(pdf, n, N):
    fig = sheet("Board mechanical and height stack", n, N, "Board coordinates (KiCad, origin top-left = back-left corner, Y toward the front). What screws where.")
    ax = fig.add_axes([0.03, 0.30, 0.62, 0.60]); ax.set_aspect("equal"); ax.axis("off")
    Wb, Hb = E.W, E.H
    ax.add_patch(Rectangle((0, 0), Wb, Hb, fill=False, lw=1.1, color=INK))
    flip = lambda y: Hb - y  # noqa: E731  (draw with the front of the pedal at the bottom)
    for (x, y) in G["holes"]:
        ax.add_patch(Circle((x, flip(y)), 1.6, fill=False, color=INK, lw=0.7))
    for (x, y) in G["pi_holes"]:
        ax.add_patch(Circle((x, flip(y)), 1.35, fill=False, color=GOLD, lw=0.9))
    px0, py0 = G["pi_holes"][0][0] - 3.5, G["pi_holes"][0][1] - 3.5
    ax.add_patch(Rectangle((px0, flip(py0 + 56)), 85, 56, fill=False, ls="--", color=GOLD, lw=0.8))
    ax.text(px0 + 1, flip(py0 + 56) + 1.5, "Raspberry Pi 4 below (component side up)", fontsize=6, color=GOLD)
    for key, col in (("d7_holes", "#2266aa"), ("bar_holes", "#2266aa")):
        for (x, y) in G[key]:
            ax.add_patch(Circle((x, flip(y)), 1.35, fill=False, color=col, lw=0.9))
    for name, scr in (("7\" Touch Display 2", E.DISP7), ("11.9\" bar screen", E.BAR)):
        cx, cy = scr["at"]; w, h = scr["size"]
        ax.add_patch(Rectangle((cx - w / 2, flip(cy + h / 2)), w, h, fill=False, ls=":", color="#2266aa", lw=0.8))
        ax.text(cx - w / 2 + 1, flip(cy - h / 2) - 4, name, fontsize=6.5, color="#2266aa")
    for (x0, y0, x1, y1) in G["slots"]:
        ax.add_patch(Rectangle((x0, flip(y1)), x1 - x0, y1 - y0, fill=True, color="#ddd", ec=INK, lw=0.6))
    FX, FY = E.FAN_AT
    ax.add_patch(Rectangle((FX - 20, flip(FY + 20)), 40, 40, fill=False, ls="--", color=LIGHT, lw=0.7))
    ax.text(FX - 19, flip(FY - 20) - 4, "fan (on the floor)", fontsize=6, color=LIGHT)
    for key, lab, dy in (("J_DISP", "J_DISP", -6), ("J_USB_BAR", "J_USB_BAR", -6), ("J_USB_UP", "J_USB_UP", 3), ("J_FAN", "J_FAN", 3), ("J_BAT", "J_BAT", 3), ("J1", "J1 (Pi header)", -6)):
        if key in G:
            x, y = G[key]
            ax.plot([x], [flip(y)], marker="s", ms=3, color="#a33")
            ax.text(x - 2, flip(y) + dy, lab, fontsize=5.8, color="#a33")
    ax.text(Wb - 2, -13, "red squares: cable headers, all on the BACK of the board", fontsize=6, color="#a33", ha="right")
    dim(ax, (0, 0), (Wb, 0), -9, "%.0f" % Wb)
    dim(ax, (0, 0), (0, Hb), 9, "%.0f" % Hb)
    ax.set_xlim(-14, Wb + 4); ax.set_ylim(-16, Hb + 4)
    tx = fig.add_axes([0.66, 0.30, 0.33, 0.64]); tx.axis("off"); tx.set_xlim(0, 100); tx.set_ylim(0, 100)
    rows = [("hole", "x", "y", "use")]
    for (x, y) in G["pi_holes"]:
        rows.append(("Pi M2.5", "%.2f" % x, "%.2f" % y, "rests on the 20 mm standoffs"))
    for (x, y) in G["d7_holes"]:
        rows.append(("7in M2.5", "%.2f" % x, "%.2f" % y, "screw from the back"))
    for (x, y) in G["bar_holes"]:
        rows.append(("bar M2.5", "%.2f" % x, "%.2f" % y, "screw from the back"))
    for (x0, y0, x1, y1) in G["slots"]:
        rows.append(("slot", "%.1f-%.1f" % (x0, x1), "%.1f-%.1f" % (y0, y1), "ribbon / plug cut-out"))
    rows.append(("M3 x 17", "see table", "sheet 3", "base boss -> board -> plate"))
    table(tx, 0, 99, rows, [16, 22, 22, 40], fs=6.0, line_h=4.0)
    # height stack
    hx = fig.add_axes([0.03, 0.05, 0.62, 0.22]); hx.axis("off"); hx.set_xlim(-60, 200); hx.set_ylim(-36, 38)
    levels = [(E.Z_BOT, "underside of base"), (E.Z_FLOOR, "floor top"), (E.PI_Z0, "Pi PCB"), (E.PI_Z0 + 17.6, "Pi USB/Ethernet top"),
              (-E.T_PCB, "board underside"), (0, "board top"), (E.BAR["glass_z"], "bar glass"), (E.DISP7["glass_z"], "7\" glass"),
              (E.Z_PLATE, "plate underside"), (E.Z_TOP, "plate top"), (E.Z_TOP + 15, "knob tops")]
    for i, (z, name) in enumerate(levels):
        hx.plot([0, 120], [z, z], color=INK if i in (0, 5, 9) else LIGHT, lw=0.7 if i in (0, 5, 9) else 0.4)
        hx.text(124 + (i % 2) * 44, z, "%s  %+.1f" % (name, z), fontsize=6, va="center")
    hx.add_patch(Rectangle((10, E.PI_Z0), 50, 1.6, color=C_hex("pi")))
    hx.add_patch(Rectangle((40, E.PI_Z0 + 1.6), 18, 16, fill=False, ec=C_hex("pi")))
    hx.add_patch(Rectangle((62, E.PI_Z0 + 1.6), 3, 20, color="#999"))
    hx.text(67, E.PI_Z0 + 10, "20 mm standoff", fontsize=5.5)
    hx.add_patch(Rectangle((0, -E.T_PCB), 120, E.T_PCB, color=C_hex("board")))
    hx.add_patch(Rectangle((5, E.DISP7["body_z"]), 55, E.DISP7["glass_z"] - E.DISP7["body_z"], color="#223"))
    hx.add_patch(Rectangle((0, E.Z_PLATE), 120, E.T_PLATE, color="#333"))
    hx.text(-58, 0, "HEIGHTS (mm, board top = 0)", fontsize=7, weight="bold")
    # notes
    nx = fig.add_axes([0.66, 0.125, 0.33, 0.16]); nx.axis("off"); nx.set_xlim(0, 100); nx.set_ylim(0, 100)
    notes = ["Pi: 4 x M2.5 x 20 male-female standoffs, male end down through the Pi into the base inserts. "
             "The board's 4 Pi holes sit on the standoff tops; the 2x20 stacking header joins the Pi to J1, and the 17 M3 x 40 "
             "screws clamp base, board and plate together.",
             "Screens: on their own M2.5 stand-offs, screwed from the BACK of the board - fit them on the bench before the board goes "
             "in. The 7\" display covers the board's Pi holes, which is why those take no screws.",
             "Gasket gaps plate-to-glass: 7\" %.2f mm, bar %.2f mm." % (E.Z_PLATE - E.DISP7["glass_z"], E.Z_PLATE - E.BAR["glass_z"])]
    body = "\n\n".join(textwrap.fill(t, 70) for t in notes)
    nx.text(0, 100, body, fontsize=6.6, va="top", linespacing=1.3)
    pdf.savefig(fig); plt.close(fig)


def C_hex(k):
    r, g, b = C[k]
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


def s_wiring(pdf, n, N):
    fig = sheet("Wiring and cables", n, N, "Every cable inside the box. The board's cable headers are all on its BACK; the Pi sits under it on the base floor.")
    ax = fig.add_axes([0.03, 0.47, 0.94, 0.44]); ax.axis("off"); ax.set_xlim(0, 400); ax.set_ylim(0, 120)

    def box(x, y, w, h, title, lines, col):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=1.5", fc="white", ec=col, lw=1.4))
        ax.text(x + 3, y + h - 3, title, fontsize=9.5, weight="bold", color=col, va="top")
        for i, t in enumerate(lines):
            ax.text(x + 3, y + h - 13 - i * 8.5, t, fontsize=7.2, va="top")
    box(2, 4, 122, 112, "RASPBERRY PI 4  (base floor)", ["DISPLAY (DSI)  <- 7\" ribbon", "HDMI0, next to USB-C  -> bar screen", "      (= \"HDMI 1\" in the app: the app)",
        "HDMI1, next to audio  -> right panel HDMI", "      (= \"HDMI 2\": projector lyrics)", "USB 2.0 (black)  -> J_USB_UP", "USB 3.0 (blue) x 2  -> right panel",
        "Ethernet  -> right panel", "Power: 5 V from the board through the header", "  - never plug the Pi's own USB-C in"], "#2a8a3e")
    box(139, 4, 122, 112, "MAIN BOARD  (headers on the back)", ["J1  2x20 socket  <- stacking header", "J_DISP  PH 2  -> 7\" display power", "J_USB_BAR  PH 4  -> bar screen touch",
        "J_USB_UP  PH 4  <- Pi USB (hub upstream)", "J_FAN  PH 2  -> fan", "J_BAT  VH 2  <- 2S battery", "Back panel (on the board): power button,",
        "  USB-C power/charge, USB-A, 10 x 1/4\" jacks,", "  MIDI in / out, phones"], "#1f6f3a")
    box(276, 62, 122, 54, "SCREENS  (screwed to the board)", ["7\": ribbon -> Pi DSI through the board slot;", "    power lead -> J_DISP", "11.9\": HDMI <- Pi HDMI0; TOUCH micro-USB",
        "    <- J_USB_BAR (touch + 5 V)"], "#2266aa")
    box(276, 4, 122, 48, "RIGHT SIDE PANEL  /  BASE", ["Ethernet, USB 3.0, USB 3.0, HDMI 2:", "  panel-mount leads from the Pi", "Fan on the floor -> J_FAN",
        "2S pack on its straps -> J_BAT"], "#555555")
    tx = fig.add_axes([0.03, 0.115, 0.94, 0.34]); tx.axis("off"); tx.set_xlim(0, 100); tx.set_ylim(0, 100)
    rows = [("#", "cable", "from", "to", "wires / notes"),
            ("1", "2x20 stacking header", "Pi GPIO pins", "J1 on the board", "push it onto the Pi first; the board's J1 slides over it"),
            ("2", "7\" display ribbon (with the display)", "display", "Pi DISPLAY (DSI) port", "through the board slot beside J1"),
            ("3", "7\" display power lead", "display", "J_DISP", "its own lead, plug swapped for a PH-2: red = pin 2 (5 V), black = pin 1"),
            ("4", "slim HDMI lead (mini-HDMI to micro-HDMI)", "bar screen HDMI", "Pi HDMI0 (next to USB-C)", "plug body sits in the board's HDMI PLUG slot"),
            ("5", "bar screen USB lead (with the screen)", "bar screen TOUCH", "J_USB_BAR", "USB-A end swapped for a PH-4: 1 red 5 V, 2 white D-, 3 green D+, 4 black GND"),
            ("6", "USB-A plug to PH-4 lead, ~20 cm", "Pi USB 2.0 port", "J_USB_UP", "pin 1 empty, 2 white D-, 3 green D+, 4 black GND"),
            ("7", "RJ45 panel-mount lead", "Pi Ethernet", "right panel", "M3 x 8 + nuts through the slotted ears"),
            ("8", "USB 3.0 panel-mount lead x 2", "Pi USB 3.0 (blue)", "right panel", "M3 x 8 + nuts"),
            ("9", "micro-HDMI to HDMI panel-mount lead", "Pi HDMI1 (next to audio)", "right panel", "projector / second screen"),
            ("10", "fan lead (PH-2 plug)", "fan", "J_FAN", "red = pin 2 (5 V), black = pin 1"),
            ("11", "battery lead (VH-2 plug)", "2S pack with BMS", "J_BAT", "pin 1 = battery -, pin 2 = battery +  (check before plugging in)")]
    table(tx, 0, 99, rows, [3, 25, 15, 17, 40], fs=7.0, line_h=8.4)
    pdf.savefig(fig); plt.close(fig)


def s_bom(pdf, n, N):
    fig = sheet("Parts to buy, hardware and printing", n, N, "Everything that is not on the PCBWay board. Cheap generic parts are fine where no brand is named.")
    ax = fig.add_axes([0.03, 0.10, 0.94, 0.84]); ax.axis("off"); ax.set_xlim(0, 100); ax.set_ylim(0, 100)
    rows = [("qty", "part", "notes"),
            ("1", "Raspberry Pi 4 Model B (2 GB+)", "powered from the board - never plug its own USB-C in"),
            ("1", "2x20 extra-long GPIO stacking header (~11 mm pins)", "e.g. Adafruit 2223"),
            ("4", "M2.5 x 20 mm male-female hex standoff (6 mm thread)", "Pi to base inserts; board rests on top"),
            ("4", "M2.5 heat-set insert (M2.5 x 4 x 3.5)", "Pi bosses in the base"),
            ("1", "Raspberry Pi Touch Display 2 (7\")", "with its ribbon cables and screws"),
            ("1", "Waveshare 11.9inch HDMI LCD (touch, SKU 19454)", "its screws; its USB cable becomes the touch lead"),
            ("1", "slim mini-HDMI to micro-HDMI lead, ~30 cm", "bar screen to Pi HDMI0"),
            ("1", "short USB-A plug lead (~20 cm) + JST PH 4-pin plug", "Pi USB 2.0 port -> J_USB_UP: pin 1 not used, 2 white D-, 3 green D+, 4 black GND"),
            ("1", "JST PH 2.0 2-pin + 4-pin pre-crimped pigtails, heat-shrink", "display power and bar touch leads"),
            ("1", "40 x 40 x 10 mm 5 V fan, JST PH 2.0 plug", "+ 4 x M3 x 16 screws, 4 x M3 heat-set inserts"),
            ("1", "RJ45 panel-mount extension lead, 20-30 cm", "M3 ears, 27-38 mm apart"),
            ("2", "USB 3.0 A panel-mount extension lead, 30 cm", "M3 ears, 26-32 mm apart"),
            ("1", "micro-HDMI male to HDMI-A female panel-mount lead, 30-50 cm", "M3 ears, 28-34 mm apart"),
            ("8", "M3 x 8 screws + nuts", "panel-mount leads"),
            ("1", "2S Li-ion pack with BMS, JST VH 2-pin lead", "fits 80 x 70 mm bay, 2 x 25 mm hook-and-loop straps"),
            ("21", "M3 heat-set inserts (M3 x 5.7 x 4)", "17 plate bosses + 4 splice-bar bosses"),
            ("17", "M3 x 40 cap screws", "base -> board -> plate"),
            ("4 / 7", "M3 x 8 screws / M3 x 12 + nuts", "splice bars / base tile laps"),
            ("6", "knobs for 6 mm D shafts, 18-20 mm", "black with a gold line"),
            ("2", "fader caps for a 4 mm lever", ""),
            ("4", "rubber feet Ø20", ""),
            ("1", "black foam tape 1 mm and 2 mm, 5 mm wide", "gaskets around the screen windows")]
    table(ax, 0, 99, rows, [6, 42, 52], fs=7.2, line_h=3.15)
    y = 99 - 3.15 * (len(rows) + 1.5)
    ax.text(0, y, "PRINTING", fontsize=10, weight="bold", color=GOLD)
    for i, t in enumerate(["PETG, ASA or ABS, black (matte if you have it). 0.2 mm layers. All parts fit a 220 x 220 mm bed.",
                           "Plate tiles: upside down (flat top on the bed), 5 perimeters, 40 % infill, 100 % top/bottom near the fader trays and lap steps.",
                           "Base tiles: floor down, 4 perimeters, 25 % infill. Back / side panel holes bridge without supports.",
                           "Splice bars, power plunger: flat, 100 % infill.  Inserts: soldering iron at ~230 °C (445 °F), press straight, let cool.",
                           "Base tiles: glue the half-laps and bolt with the 7 x M3 x 12; plate tiles: glue the laps, screw the 2 splice bars."]):
        ax.text(0, y - 3.2 - i * 3.0, t, fontsize=7.4, va="top")
    pdf.savefig(fig); plt.close(fig)


if __name__ == "__main__":
    R = renders()
    sheets = [lambda p, n, N: s_overview(p, R, n, N), lambda p, n, N: s_assembly(p, R, n, N), s_base, s_panels, s_plate, s_board, s_wiring, s_bom]
    with PdfPages(PDF) as pdf:
        for i, fn in enumerate(sheets, 1):
            fn(pdf, i, len(sheets))
    print("saved", PDF)
