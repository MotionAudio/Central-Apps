#!/usr/bin/python3
"""Central Pedal rev B - 3D-printed enclosure (CadQuery -> STEP / STL).

Everything is parametric and comes from the routed board's geometry (out/board-geometry.json: holes, footswitches,
LEDs, knobs, faders, label screens, jacks) plus the part heights in PARAMS below.  Coordinates: X = board x (mm,
0 at the left), Y = board depth measured from the FRONT edge (the player's side; the board's own y runs the other
way, Y = 278 - y), Z up with the board's component side at Z = 0.

Parts (all in central-pedal-enclosure.step, positioned; also one STEP + STL per part):
  base            the tub: floor, four walls, back-panel cut-outs, board bosses, fan grille, battery strap slots
  plate           the top plate 15.5 mm above the board: footswitch / LED / knob / fader / label-screen openings,
                  the two screen windows with their frames, bosses down to the board
  frame7, frameBar  retainer frames that clamp the 7" and the bar screen to the plate's underside
  plunger         the power-button pusher that sits in the back panel
  splices         bars that join the plate's four printed tiles on its underside
  base_tiles / plate_tiles   the base and plate cut into 2 x 2 printable pieces (half-lap seams on the base)
Reference bodies (board, Pi, screens) are included in the assembly STEP so the fit can be checked in CAD.
"""
import json
import math
import os
import sys

import cadquery as cq

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "out", "enclosure")
os.makedirs(OUT, exist_ok=True)
G = json.load(open(os.path.join(HERE, "..", "out", "board-geometry.json")))

# ------------------------------------------------------------------ parameters (mm)
W, H = 390.0, 278.0          # the board
T_PCB = 1.6
GAP = 2.0                    # board edge -> wall inner face
WALL = 3.0
R_OUT = 6.0                  # outside corner radius
Z_PLATE = 16.0               # plate underside above the board (footswitch bodies 15.25, 1/4" jack bodies 15.67 tall)
T_PLATE = 3.0
Z_FLOOR = -29.0              # floor top (Pi at -21.6 .. -23.2 on 20 mm standoffs, 3 mm for its underside parts)
T_FLOOR = 4.0
BOSS_D = 8.0                 # base bosses under the board (M3 x 40 screw up through them)
PLATE_BOSS_D = 7.0           # plate bosses down to the board (M3 heat-set insert)
INSERT_D, INSERT_DEPTH = 4.0, 6.5        # M3 x 5.7 heat-set insert
SCREW_D = 3.4
# footswitches / lights / knobs / faders / label screens
FSW_HOLE = 12.6              # M12 bushing
LED_HOLE = 5.3
ENC_HOLE = 8.0               # knob shaft through a plain hole (PEC11R-4230F: 30 mm shaft -> 11 mm of shaft above the plate)
FADER_RECESS = (18.0, 78.0)  # the fader cap runs in a shallow recessed tray (x, y), so the 20.5 mm lever top shows 6 mm
FADER_RECESS_FLOOR_Z = 12.8  # tray floor underside: above the label-screen modules (12.5) and the fader body (9)
FADER_RECESS_FLOOR_T = 1.6
FADER_SLOT = (3.6, 64.0)     # lever slot (x, y): 60 mm travel + lever
CHAMFER_WIN = 1.2            # 45-degree bezel on the screen and label-screen windows
EDGE_R = 2.5                 # rounded outer edges (plate top, base bottom)
OLED_WIN = (23.4, 6.6)       # 0.91" module's visible 22.4 x 5.6 + margin; centre = module origin + 17.5 in x
OLED_MODULE_H = 12.5         # module top above the board (on its 4-pin socket): nothing may hang lower over it
# screens
DISP7 = dict(size=(189.32, 120.24), active=(155.0, 88.0), at=(W / 2, 27.0 + 120.24 / 2), t=7.5)   # Pi Touch Display 2
BAR = dict(size=(287.0, 70.0), active=(268.0, 58.0), at=(W / 2, 158.0 + 35.0), t=9.5)             # 11.9" 1480x320 bar
RIM_W, RIM_H = 2.5, None      # screen frames on the plate underside: wall width; height = t + 0.5
FRAME_T = 2.5                 # retainer frame thickness
# back panel
JACK_AXIS_Z = 7.8            # 1/4" jack bore above the PCB (Neutrik NMJ6HCD2: verify on the drawing)
JACK_HOLE = 11.0
JACK35_AXIS_Z = 2.6          # PJ-320D
JACK35_HOLE = 9.5            # lets 3.5 mm plug bodies reach the recessed jack
USBC_WIN = (13.5, 8.0, 1.7)  # w, h, centre z - sized for the plug's overmould
USBA_WIN = (16.0, 9.0, 3.6)
PWR_HOLE = 5.0
PWR_Z = 3.5
# base interior
FAN_AT, FAN_SIZE, FAN_HOLES = (130.0, 100.0), 40.0, 32.0       # 40 mm fan on the floor, intake grille below it
BATT_BAY = (20.0, 100.0, 180.0, 250.0)                         # x0, x1, y0, y1 (board y): strap slots for a 2S pack
FEET_D = 20.0
VENT = dict(n=8, w=2.0, h=18.0, pitch=5.0)                      # slot rows in the side walls
# printable split
PLATE_SEAM_X, PLATE_SEAM_Y = 203.5, 140.0        # board coordinates; butt joints + splice bars on the underside
BASE_SEAM_X, BASE_SEAM_Y, BASE_LAP = 185.0, 130.0, 12.0   # half-lap seams


def P(x, y):
    """board (x, y) -> CAD (X, Y)"""
    return (x, H - y)


# outer / inner envelopes (XY)
XO0, XO1 = -GAP - WALL, W + GAP + WALL
YO0, YO1 = -GAP - WALL, H + GAP + WALL
XI0, XI1 = -GAP, W + GAP
YI0, YI1 = -GAP, H + GAP
Z_TOP = Z_PLATE + T_PLATE
Z_BOT = Z_FLOOR - T_FLOOR


def rbox(x0, y0, x1, y1, z0, z1, r=0.0):
    w, d, h = x1 - x0, y1 - y0, z1 - z0
    wp = cq.Workplane("XY").box(w, d, h, centered=(True, True, False)).translate(((x0 + x1) / 2, (y0 + y1) / 2, z0))
    if r > 0:
        wp = wp.edges("|Z").fillet(r)
    return wp


def cyl(x, y, d, z0, z1):
    return cq.Workplane("XY").circle(d / 2).extrude(z1 - z0).translate((x, y, z0))


def slot(x, y, w, l, z0, z1, along="y"):
    """rounded slot centred on (x, y); w = width, l = overall length"""
    if along == "y":
        s = cq.Workplane("XY").slot2D(l, w, angle=90).extrude(z1 - z0)
    else:
        s = cq.Workplane("XY").slot2D(l, w, angle=0).extrude(z1 - z0)
    return s.translate((x, y, z0))


def frustum_cut(X, Y, w, h, c, r=1.0):
    """45-degree bezel for a w x h window centred on (X, Y) at the plate's top surface: a c-deep frustum"""
    f = (cq.Workplane("XY").rect(w + 2 * c, h + 2 * c).workplane(offset=-c - 0.001).rect(w, h).loft(combine=True))
    return f.translate((X, Y, Z_TOP + 0.001))


def cone_cut(X, Y, d, c):
    """countersink-style chamfer on a round hole at the plate's top surface"""
    cone = cq.Solid.makeCone((d + 2 * c) / 2, d / 2 - 0.001, c + 0.002, pnt=cq.Vector(X, Y, Z_TOP + 0.001), dir=cq.Vector(0, 0, -1))
    return cq.Workplane("XY").add(cone)


def union_all(parts):
    out = None
    for p in parts:
        out = p if out is None else out.union(p)
    return out


# ================================================================== BASE
def make_base():
    outer = rbox(XO0, YO0, XO1, YO1, Z_BOT, Z_PLATE, R_OUT).edges("<Z").fillet(EDGE_R)
    cavity = rbox(XI0, YI0, XI1, YI1, Z_FLOOR, Z_PLATE + 1, R_OUT - WALL)
    base = outer.cut(cavity)

    adds = []
    # bosses under the board at every M3 hole (board rests on them; one M3 x 40 from below into the plate boss)
    for (x, y) in G["holes"]:
        X, Y = P(x, y)
        adds.append(cyl(X, Y, BOSS_D, Z_FLOOR - 0.01, -T_PCB))
    # thicker pad behind the USB-C / USB-A / power button so plugs reach them (their faces sit at the board edge)
    adds.append(rbox(6.0, H + 0.5, 62.0, H + GAP + 0.01, -T_PCB - 2.0, 12.0))
    # fan mount pads (4 x M3 insert) around the 40 mm fan on the floor
    fx, fy = P(*FAN_AT)
    for sx in (-1, 1):
        for sy in (-1, 1):
            adds.append(cyl(fx + sx * FAN_HOLES / 2, fy + sy * FAN_HOLES / 2, 7.0, Z_FLOOR - 0.01, Z_FLOOR + 5.0))
    base = base.union(union_all(adds))

    cuts = []
    # screw holes through the bosses + counterbores from below
    for (x, y) in G["holes"]:
        X, Y = P(x, y)
        cuts.append(cyl(X, Y, SCREW_D, Z_BOT - 1, -T_PCB + 1))
        cuts.append(cyl(X, Y, 6.5, Z_BOT - 1, Z_BOT + 3.0))
    # back panel: 1/4" jacks
    yb0, yb1 = H + 0.4, YO1 + 1          # from the inner pad face through the wall
    for (ref, x, y) in G["jack"]:
        X, _ = P(x, y)
        cuts.append(cq.Workplane("XZ").circle(JACK_HOLE / 2).extrude(-(yb1 - yb0)).translate((X, yb0, JACK_AXIS_Z)))
    for (ref, x, y) in G["jack35"]:
        X, _ = P(x, y)
        cuts.append(cq.Workplane("XZ").circle(JACK35_HOLE / 2).extrude(-(yb1 - yb0)).translate((X, yb0, JACK35_AXIS_Z)))
    # USB-C, USB-A: rounded windows
    for (key, (w, h, zc)) in (("J_USBC", USBC_WIN), ("J_USBA", USBA_WIN)):
        X, _ = P(*G[key])
        win = cq.Workplane("XZ").rect(w, h).extrude(-(yb1 - yb0)).edges("|Y").fillet(min(w, h) / 2 - 0.6).translate((X, yb0, zc))
        cuts.append(win)
    # power button: hole for the plunger stem + a pocket for its cap on the inside
    X, _ = P(*G["SW_PWR"])
    cuts.append(cq.Workplane("XZ").circle(PWR_HOLE / 2).extrude(-(yb1 - yb0)).translate((X, yb0, PWR_Z)))
    cuts.append(cq.Workplane("XZ").circle(4.6).extrude(-1.6).translate((X, yb0, PWR_Z)))
    # fan: grille (hex-ish ring of holes) + 4 screw holes
    cuts.append(cyl(fx, fy, 3.0, Z_BOT - 1, Z_FLOOR + 1))
    for ring, n in ((1, 6), (2, 12), (3, 18)):
        rr = ring * 5.6
        for k in range(n):
            a = 2 * math.pi * k / n + (ring % 2) * math.pi / n
            cuts.append(cyl(fx + rr * math.cos(a), fy + rr * math.sin(a), 4.0, Z_BOT - 1, Z_FLOOR + 1))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cuts.append(cyl(fx + sx * FAN_HOLES / 2, fy + sy * FAN_HOLES / 2, INSERT_D, Z_FLOOR + 5.0 - INSERT_DEPTH, Z_FLOOR + 6.0))
    # battery bay: two pairs of strap slots (25 mm hook-and-loop strap)
    bx0, bx1, by0, by1 = BATT_BAY
    for xs in (bx0 + 22.0, bx1 - 22.0):
        for ys in (by0, by1):
            X, Y = P(xs, ys)
            cuts.append(slot(X, Y, 4.0, 27.0, Z_BOT - 1, Z_FLOOR + 1, along="x"))
    # feet recesses (stick-on rubber feet)
    for (x, y) in ((15, 15), (W - 15, 15), (15, H - 15), (W - 15, H - 15)):
        X, Y = P(x, y)
        cuts.append(cyl(X, Y, FEET_D, Z_BOT - 1, Z_BOT + 1.0))
    # vents: slot rows low in both side walls, near the Pi (right) and the power stage (left)
    for (xw, yc) in ((XO0, P(0, 90)[1]), (XO1, P(0, 90)[1]), (XO0, P(0, 200)[1]), (XO1, P(0, 200)[1])):
        for k in range(VENT["n"]):
            Y = yc + (k - (VENT["n"] - 1) / 2) * VENT["pitch"]
            cuts.append(cq.Workplane("YZ").rect(VENT["w"], VENT["h"]).extrude(WALL + 2).translate((xw - 1, Y, Z_FLOOR + 4 + VENT["h"] / 2)))
    base = base.cut(union_all(cuts))
    return base


# ================================================================== PLATE
def make_plate():
    plate = rbox(XO0, YO0, XO1, YO1, Z_PLATE, Z_TOP, R_OUT).edges(">Z").fillet(EDGE_R)
    # alignment lip into the base cavity
    lip = rbox(XI0 + 0.3, YI0 + 0.3, XI1 - 0.3, YI1 - 0.3, Z_PLATE - 2.0, Z_PLATE + 0.01, R_OUT - WALL)
    lip = lip.cut(rbox(XI0 + 2.3, YI0 + 2.3, XI1 - 2.3, YI1 - 2.3, Z_PLATE - 3, Z_PLATE + 1, R_OUT - WALL - 2))
    lip = lip.cut(rbox(XI0 - 1, YI1 - 2.5, XI1 + 1, YI1 + 1, Z_PLATE - 3, Z_PLATE + 1))      # not along the back: the jack bodies are there
    plate = plate.union(lip)

    adds, cuts = [], []
    # bosses down to the board (heat-set insert from below)
    for (x, y) in G["holes"]:
        X, Y = P(x, y)
        adds.append(cyl(X, Y, PLATE_BOSS_D, 0.0, Z_PLATE + 0.01))
        cuts.append(cyl(X, Y, INSERT_D, -0.1, INSERT_DEPTH))
    # knobs: plain shaft holes with a small top chamfer
    for (x, y) in G["enc"]:
        X, Y = P(x, y)
        cuts.append(cyl(X, Y, ENC_HOLE, Z_PLATE - 1, Z_TOP + 1))
        cuts.append(cone_cut(X, Y, ENC_HOLE, 0.6))
    # faders: a shallow recessed tray (its floor hangs below the plate) with the lever slot through it
    fz0 = FADER_RECESS_FLOOR_Z
    for (x, y) in G["fader"]:
        X, Y = P(x, y)
        ww, wl = FADER_RECESS
        adds.append(rbox(X - ww / 2 - 2, Y - wl / 2 - 2, X + ww / 2 + 2, Y + wl / 2 + 2, fz0, Z_PLATE + 0.01, 3.0))
        cuts.append(rbox(X - ww / 2, Y - wl / 2, X + ww / 2, Y + wl / 2, fz0 + FADER_RECESS_FLOOR_T, Z_TOP + 1, 2.0))
        cuts.append(slot(X, Y, FADER_SLOT[0], FADER_SLOT[1], fz0 - 1, Z_TOP + 1, along="y"))
        cuts.append(frustum_cut(X, Y, ww, wl, CHAMFER_WIN, r=2.0))
    # screens: window + a rim on the underside the screen is clamped into
    for scr in (DISP7, BAR):
        sx, sy = P(*scr["at"])
        sw, sh = scr["size"]
        aw, ah = scr["active"]
        rim_h = scr["t"] + 0.5
        back = 0.0 if scr is DISP7 else RIM_W           # the 7" screen's back edge sits 2.3 mm from the jack bodies: no wall there
        adds.append(rbox(sx - sw / 2 - 0.3 - RIM_W, sy - sh / 2 - 0.3 - RIM_W, sx + sw / 2 + 0.3 + RIM_W, sy + sh / 2 + 0.3 + back, Z_PLATE - rim_h, Z_PLATE + 0.01, 2.0))
        cuts.append(rbox(sx - sw / 2 - 0.3, sy - sh / 2 - 0.3, sx + sw / 2 + 0.3, sy + sh / 2 + 0.3 + (1.0 if scr is DISP7 else 0.0), Z_PLATE - rim_h - 1, Z_PLATE - 0.001, 0.6))
        cuts.append(rbox(sx - aw / 2 - 1.0, sy - ah / 2 - 1.0, sx + aw / 2 + 1.0, sy + ah / 2 + 1.0, Z_PLATE - 1, Z_TOP + 1, 1.5))
        cuts.append(frustum_cut(sx, sy, aw + 2.0, ah + 2.0, CHAMFER_WIN, r=1.5))
        # insert bosses for the retainer frame (where there is room - see frame_screws), hook pockets on the other side
        for (bx, by) in frame_screws(scr):
            adds.append(cyl(bx, by, 7.0, Z_PLATE - rim_h, Z_PLATE + 0.01))
            cuts.append(cyl(bx, by, INSERT_D, Z_PLATE - rim_h - 1, Z_PLATE - rim_h + INSERT_DEPTH))
    hk7, hkb = hook_geometry(DISP7), hook_geometry(BAR)
    cuts += hk7["notches"] + hkb["slots"]
    adds += hkb["blocks"]
    # nothing added under the plate may reach down into a label-screen module
    oled_keep = union_all([rbox(P(x - 2.0, y + 6.5)[0], P(x - 2.0, y + 6.5)[1], P(x + 37.0, y - 6.5)[0], P(x + 37.0, y - 6.5)[1], -1.0, OLED_MODULE_H) for (ref, x, y) in G["oled"]])
    plate = plate.union(union_all(adds).cut(oled_keep))
    # through openings
    for (x, y) in G["fsw"]:
        X, Y = P(x, y)
        cuts.append(cyl(X, Y, FSW_HOLE, Z_PLATE - 1, Z_TOP + 1))
    for (x, y) in G["led"]:
        X, Y = P(x, y)
        cuts.append(cyl(X, Y, LED_HOLE, Z_PLATE - 1, Z_TOP + 1))
        cuts.append(cone_cut(X, Y, LED_HOLE, 0.8))
    for (ref, x, y) in G["oled"]:
        X, Y = P(x + 17.5, y)
        cuts.append(rbox(X - OLED_WIN[0] / 2, Y - OLED_WIN[1] / 2, X + OLED_WIN[0] / 2, Y + OLED_WIN[1] / 2, Z_PLATE - 1, Z_TOP + 1, 1.0))
        cuts.append(frustum_cut(X, Y, OLED_WIN[0], OLED_WIN[1], 0.8, r=1.0))
    # splice-bar insert bosses on the underside along the two seams (butt joints)
    for (X, Y, bd, hd) in splice_boss_points():
        adds2 = cyl(X, Y, bd, Z_PLATE - 6.5, Z_PLATE + 0.01)
        plate = plate.union(adds2)
        cuts.append(cyl(X, Y, hd, Z_PLATE - 7.5, Z_PLATE - 6.5 + INSERT_DEPTH))
    plate = plate.cut(union_all(cuts))
    return plate


def splice_bars_spec():
    """(x0, x1, y0, y1) in board coords of each splice bar on the plate underside"""
    sx, sy = PLATE_SEAM_X, PLATE_SEAM_Y
    # (x0, x1, y0, y1, boss diameter, hole diameter): the front bar is squeezed between the label-screen modules and the
    # footswitch bodies, so it takes M3 self-tapping screws in small bosses; the side bars take heat-set inserts
    return [
        (10.0, 60.0, sy - 9.0, sy + 7.0, 7.0, INSERT_D),      # left of the 7" screen, across the y seam
        (330.0, 380.0, sy - 9.0, sy + 7.0, 7.0, INSERT_D),    # right of it
    ]


def splice_boss_points():
    """[(X, Y, boss_d, hole_d)]"""
    pts = []
    for (x0, x1, y0, y1, bd, hd) in splice_bars_spec():
        if x1 - x0 > y1 - y0:          # bar along x: a boss near each end, each side of the seam
            for x in (x0 + 4.0, x1 - 4.0):
                pts.append(P(x, (y0 + y1) / 2) + (bd, hd))
        else:
            for y in (y0 + 4.0, y1 - 4.0):
                pts.append(P((x0 + x1) / 2, y) + (bd, hd))
    return pts


def make_splices():
    bars = []
    for (x0, x1, y0, y1, bd, hd) in splice_bars_spec():
        X0, Y0 = P(x0, y1)
        X1, Y1 = P(x1, y0)
        bar = rbox(X0, Y0, X1, Y1, Z_PLATE - 6.5 - 2.5, Z_PLATE - 6.5, 1.5)
        bars.append(bar)
    bars = union_all(bars)
    holes = union_all([cyl(X, Y, SCREW_D, Z_PLATE - 12, Z_PLATE) for (X, Y, bd, hd) in splice_boss_points()])
    return bars.cut(holes)


def frame_screws(scr):
    """CAD (X, Y) of the retainer-frame screw bosses.  7" screen: two on its back edge, one each side between the
    knob wells; bar screen: two at its back corners, one each side above the end footswitches.  The front edge of
    each frame hooks into pockets instead (there is no room for bosses there)."""
    sx, sy = P(*scr["at"])
    sw, sh = scr["size"]
    edge = 0.3 + RIM_W + 3.5
    if scr is DISP7:          # three a side, between the knob wells and the label-screen modules; none at the back (jacks)
        return [(sx + sgn * (sw / 2 + edge), P(0, y)[1]) for sgn in (-1, 1) for y in (42.0, 86.0, 130.0)]
    return [(sx - sw / 2 - edge, sy + sh / 2 + edge), (sx + sw / 2 + edge, sy + sh / 2 + edge),
            (sx - sw / 2 - edge, P(0, 175.0)[1]), (sx + sw / 2 + edge, P(0, 175.0)[1])]


HOOK_X = (148.0, 242.0)        # board x of the two front tongues of each frame (between label-screen modules)
TONGUE_W, TONGUE_T = 10.0, 2.0


def hook_geometry(scr):
    """Front edge of each retainer frame hooks under the plate instead of screwing (no room for bosses there).
    7" frame: its tongues slide into notches cut up into the bar rim's back wall (that wall reaches below the 7"
    frame).  Bar frame: its tongues slide into catch blocks hung under the bar rim's front wall.
    Returns dict(tongue_z=(z0, z1), notches=[boxes to cut from the plate], blocks=[boxes to add], slots=[boxes to cut])."""
    rim_h = scr["t"] + 0.5
    fz0, fz1 = Z_PLATE - rim_h - FRAME_T, Z_PLATE - rim_h
    tz0, tz1 = fz0 + (FRAME_T - TONGUE_T) / 2, fz0 + (FRAME_T + TONGUE_T) / 2
    bsx, bsy = P(*BAR["at"])
    bsw, bsh = BAR["size"]
    out = dict(tongue_z=(tz0, tz1), notches=[], blocks=[], slots=[], tongues=[])
    o = 0.3 + RIM_W
    if scr is DISP7:
        wall_y0, wall_y1 = bsy + bsh / 2 + 0.3, bsy + bsh / 2 + o          # bar rim back wall
        for hx in HOOK_X:
            X = P(hx, 0)[0]
            out["notches"].append(rbox(X - TONGUE_W / 2 - 0.3, wall_y0 - 1, X + TONGUE_W / 2 + 0.3, wall_y1 + 1, tz0 - 0.3, tz1 + 0.3))
            sx, sy = P(*DISP7["at"])
            fy = sy - DISP7["size"][1] / 2 - o                              # 7" frame front edge
            out["tongues"].append(rbox(X - TONGUE_W / 2, wall_y0 - 0.5, X + TONGUE_W / 2, fy + 1.0, tz0, tz1))
    else:
        wall_y0, wall_y1 = bsy - bsh / 2 - o, bsy - bsh / 2 - 0.3          # bar rim front wall (outer, inner)
        for hx in HOOK_X:
            X = P(hx, 0)[0]
            out["blocks"].append(rbox(X - TONGUE_W / 2 - 2.5, wall_y0 - 1.0, X + TONGUE_W / 2 + 2.5, wall_y1 + 3.0, fz0 - 1.0, Z_PLATE - rim_h + 0.01))
            out["slots"].append(rbox(X - TONGUE_W / 2 - 0.3, wall_y0 - 2.0, X + TONGUE_W / 2 + 0.3, wall_y1 + 4.0, tz0 - 0.3, tz1 + 0.3))
            out["tongues"].append(rbox(X - TONGUE_W / 2, wall_y0 - 1.5, X + TONGUE_W / 2, wall_y1 + 2.5, tz0, tz1))
            out["notches"].append(rbox(X - TONGUE_W / 2 - 2.8, wall_y0 - 1.5, X + TONGUE_W / 2 + 2.8, wall_y1 + 3.5, fz0 - 1, fz1 + 1))   # cut from the FRAME ring
    return out


def make_frame(scr):
    """retainer frame: clamps the screen up against the plate; screwed at frame_screws(), hooked at the front"""
    sx, sy = P(*scr["at"])
    sw, sh = scr["size"]
    rim_h = scr["t"] + 0.5
    z0, z1 = Z_PLATE - rim_h - FRAME_T, Z_PLATE - rim_h
    o = 0.3 + RIM_W                               # out to the rim's outer face
    ob = 1.5 if scr is DISP7 else o               # back edge: the 7" frame stops short of the jack bodies
    fr = rbox(sx - sw / 2 - o, sy - sh / 2 - o, sx + sw / 2 + o, sy + sh / 2 + ob, z0, z1, 2.0)
    fr = fr.cut(rbox(sx - sw / 2 + 12.0, sy - sh / 2 + 12.0, sx + sw / 2 - 12.0, sy + sh / 2 - 12.0, z0 - 1, z1 + 1, 2.0))
    ears, holes = [], []
    rx0, rx1 = sx - sw / 2 - o, sx + sw / 2 + o
    ry0, ry1 = sy - sh / 2 - o, sy + sh / 2 + ob
    for (bx, by) in frame_screws(scr):
        ears.append(cyl(bx, by, 7.0, z0, z1))
        cx, cy = min(max(bx, rx0), rx1), min(max(by, ry0), ry1)     # nearest point of the ring's outline
        ears.append(rbox(min(bx, cx) - 3.5, min(by, cy) - 3.5, max(bx, cx) + 3.5, max(by, cy) + 3.5, z0, z1))
        holes.append(cyl(bx, by, SCREW_D, z0 - 1, z1 + 1))
    hk = hook_geometry(scr)
    if scr is BAR:
        fr = fr.cut(union_all(hk["notches"]))
        # and let the 7" frame's tongues pass: notch the back member where they slide into the rim wall
        bsx, bsy = P(*BAR["at"])
        wall_y1 = bsy + BAR["size"][1] / 2 + 0.3 + RIM_W
        for hx in HOOK_X:
            X = P(hx, 0)[0]
            fr = fr.cut(rbox(X - TONGUE_W / 2 - 0.6, wall_y1 - RIM_W - 4.0, X + TONGUE_W / 2 + 0.6, wall_y1 + 1.0, z0 - 1, z1 + 1))
    fr = fr.union(union_all(ears)).union(union_all(hk["tongues"])).cut(union_all(holes))
    oled_keep = union_all([rbox(P(x - 2.0, y + 6.5)[0], P(x - 2.0, y + 6.5)[1], P(x + 37.0, y - 6.5)[0], P(x + 37.0, y - 6.5)[1], -1.0, OLED_MODULE_H) for (ref, x, y) in G["oled"]])
    return fr.cut(oled_keep)


def make_plunger():
    X, Yb = P(*G["SW_PWR"])
    yb0 = H + 0.4
    stem_l = (YO1 - yb0) + 1.5
    stem = cq.Workplane("XZ").circle(PWR_HOLE / 2 - 0.25).extrude(-stem_l).translate((X, yb0, PWR_Z))
    cap = cq.Workplane("XZ").circle(4.4).extrude(-1.4).translate((X, yb0, PWR_Z))
    return stem.union(cap)


# ================================================================== reference bodies
def make_refs():
    refs = {}
    refs["board"] = rbox(0, 0, W, H, -T_PCB, 0)
    # Pi behind the board, component side up, on 20 mm standoffs; header along the board's back-panel side
    px0, py0 = G["pi_holes"][0][0] - 3.5, G["pi_holes"][0][1] - 3.5
    X0, Y1 = P(px0, py0)
    refs["pi"] = rbox(X0, Y1 - 56.0, X0 + 85.0, Y1, -T_PCB - 20.0 - 1.6, -T_PCB - 20.0)
    for name, scr in (("display7", DISP7), ("bar_screen", BAR)):
        sx, sy = P(*scr["at"])
        sw, sh = scr["size"]
        refs[name] = rbox(sx - sw / 2, sy - sh / 2, sx + sw / 2, sy + sh / 2, Z_PLATE - scr["t"], Z_PLATE)
    # the controls as they will look from the outside (sizes of typical parts: 20 mm knobs, soft-touch footswitch
    # caps with their M12 nuts, 12 x 22 fader caps, 5 mm LED domes)
    knobs, fsw, caps, leds = [], [], [], []
    for (x, y) in G["enc"]:
        X, Y = P(x, y)
        knobs.append(cyl(X, Y, 20.0, Z_TOP + 1.5, Z_TOP + 15.0).faces(">Z").edges().fillet(1.5))
    for (x, y) in G["fsw"]:
        X, Y = P(x, y)
        fsw.append(cq.Workplane("XY").polygon(6, 17.0).extrude(2.6).translate((X, Y, Z_TOP)))          # the nut
        fsw.append(cyl(X, Y, 10.5, Z_TOP + 2.6, Z_TOP + 9.0).faces(">Z").edges().fillet(1.0))         # the plunger cap
    for (x, y) in G["fader"]:
        X, Y = P(x, y)
        caps.append(rbox(X - 6.0, Y - 11.0, X + 6.0, Y + 11.0, FADER_RECESS_FLOOR_Z + FADER_RECESS_FLOOR_T + 0.5, 20.5 + 2.0, 1.5))
    for (x, y) in G["led"]:
        X, Y = P(x, y)
        leds.append(cyl(X, Y, 4.9, 10.0, Z_TOP - 0.4))
    refs["knobs"], refs["footswitches"], refs["fader_caps"], refs["leds"] = union_all(knobs), union_all(fsw), union_all(caps), union_all(leds)
    return refs


# ================================================================== printable tiles
def halfspace(axis, lo, hi):
    big = 2000.0
    if axis == "x":
        return rbox(lo, -big, hi, big, -big, big)
    return rbox(-big, lo, big, hi, -big, big)


def split_plate(plate):
    SX, SY = PLATE_SEAM_X, H - PLATE_SEAM_Y
    tiles = {}
    for name, (xa, xb) in (("L", (-1000, SX)), ("R", (SX, 1000))):
        for name2, (ya, yb) in (("front", (-1000, SY)), ("back", (SY, 1000))):
            tiles["plate_%s_%s" % (name2, name)] = plate.intersect(halfspace("x", xa, xb)).intersect(halfspace("y", ya, yb))
    return tiles


def split_base(base):
    """2 x 2 with half-laps: walls lap in their thickness (outer half on one tile, inner half on the other),
    the floor laps vertically (lower half / upper half).  Each lap is BASE_LAP wide."""
    SX, SY = BASE_SEAM_X, H - BASE_SEAM_Y
    half = BASE_LAP / 2
    big = 2000.0
    outer_half = rbox(XO0, YO0, XO1, YO1, -big, big, R_OUT).cut(rbox(XO0 + WALL / 2, YO0 + WALL / 2, XO1 - WALL / 2, YO1 - WALL / 2, -big, big, R_OUT - WALL / 2))
    inner_half = rbox(XO0 + WALL / 2, YO0 + WALL / 2, XO1 - WALL / 2, YO1 - WALL / 2, -big, big, R_OUT - WALL / 2)
    z_mid = Z_FLOOR - T_FLOOR / 2
    lower = halfspace("x", -big, big).intersect(rbox(-big, -big, big, big, -big, z_mid))
    upper = rbox(-big, -big, big, big, z_mid, big)

    def region(axis, side):
        """side -1 = low side of the seam (takes the outer wall half and the lower floor half in the lap)"""
        S = SX if axis == "x" else SY
        if side < 0:
            main = halfspace(axis, -big, S - half)
            lap = halfspace(axis, S - half, S + half)
            return main.union(lap.intersect(outer_half.union(lower)))
        main = halfspace(axis, S + half, big)
        lap = halfspace(axis, S - half, S + half)
        return main.union(lap.intersect(inner_half.intersect(upper).union(inner_half.intersect(rbox(-big, -big, big, big, Z_FLOOR - 0.001, big)))))

    tiles = {}
    for nx, sx in (("L", -1), ("R", 1)):
        rx = region("x", sx)
        for ny, sy in (("front", -1), ("back", 1)):
            ry = region("y", sy)
            tiles["base_%s_%s" % (ny, nx)] = base.intersect(rx).intersect(ry)
    return tiles


def lap_screw_holes(base):
    """M3 through the floor laps (3 per seam) with a nut pocket from below"""
    SX, SY = BASE_SEAM_X, H - BASE_SEAM_Y
    cuts = []
    for Y in (P(0, 30)[1], P(0, 165)[1], P(0, 262)[1]):
        cuts.append(cyl(SX, Y, SCREW_D, Z_BOT - 1, Z_FLOOR + 1))
        cuts.append(cq.Workplane("XY").polygon(6, 6.4).extrude(2.6).translate((SX, Y, Z_BOT - 0.01)))
    for X in (35.0, 150.0, 240.0, 355.0):
        cuts.append(cyl(X, SY, SCREW_D, Z_BOT - 1, Z_FLOOR + 1))
        cuts.append(cq.Workplane("XY").polygon(6, 6.4).extrude(2.6).translate((X, SY, Z_BOT - 0.01)))
    return base.cut(union_all(cuts))


# ================================================================== build + export
def export(name, shape, stl=True):
    cq.exporters.export(shape, os.path.join(OUT, name + ".step"))
    if stl:
        cq.exporters.export(shape, os.path.join(OUT, name + ".stl"), tolerance=0.05, angularTolerance=0.2)
    bb = shape.val().BoundingBox()
    print("%-22s %.1f x %.1f x %.1f mm" % (name, bb.xlen, bb.ylen, bb.zlen))


if __name__ == "__main__":
    only = sys.argv[1:]
    base = make_base()
    base = lap_screw_holes(base)
    export("base", base, stl=False)
    plate = make_plate()
    export("plate", plate, stl=False)
    splices = make_splices()
    export("splice-bars", splices)
    frame7 = make_frame(DISP7)
    export("frame-7in", frame7)
    frame_bar = make_frame(BAR)
    export("frame-bar", frame_bar)
    plunger = make_plunger()
    export("power-plunger", plunger)
    refs = make_refs()

    asm = cq.Assembly(name="central-pedal-enclosure")
    asm.add(base, name="base", color=cq.Color(0.12, 0.12, 0.12))
    asm.add(plate, name="plate", color=cq.Color(0.12, 0.12, 0.12))
    asm.add(splices, name="splice-bars", color=cq.Color(0.5, 0.5, 0.5))
    asm.add(frame7, name="frame-7in", color=cq.Color(0.5, 0.5, 0.5))
    asm.add(frame_bar, name="frame-bar", color=cq.Color(0.5, 0.5, 0.5))
    asm.add(plunger, name="power-plunger", color=cq.Color(0.83, 0.69, 0.22))
    asm.add(refs["board"], name="ref-main-board", color=cq.Color(0.1, 0.35, 0.15))
    asm.add(refs["pi"], name="ref-raspberry-pi-4", color=cq.Color(0.1, 0.5, 0.2))
    asm.add(refs["display7"], name="ref-7in-display", color=cq.Color(0.05, 0.05, 0.1))
    asm.add(refs["bar_screen"], name="ref-bar-screen", color=cq.Color(0.05, 0.05, 0.1))
    asm.add(refs["knobs"], name="ref-knobs", color=cq.Color(0.1, 0.1, 0.1))
    asm.add(refs["footswitches"], name="ref-footswitches", color=cq.Color(0.75, 0.75, 0.78))
    asm.add(refs["fader_caps"], name="ref-fader-caps", color=cq.Color(0.1, 0.1, 0.1))
    asm.add(refs["leds"], name="ref-leds", color=cq.Color(1.0, 0.8, 0.2))
    asm.save(os.path.join(OUT, "central-pedal-enclosure.step"))
    print("assembly saved")

    if "--no-tiles" not in only:
        for name, t in split_plate(plate).items():
            export(name, t)
        for name, t in split_base(base).items():
            export(name, t)
