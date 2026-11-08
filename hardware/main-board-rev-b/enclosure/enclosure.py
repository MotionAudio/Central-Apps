#!/usr/bin/python3
"""Central Pedal rev B - 3D-printed enclosure (CadQuery -> STEP / STL).

Everything is parametric and comes from the routed board's geometry (out/board-geometry.json: holes, footswitches,
LEDs, knobs, faders, label screens, jacks) plus the part heights in PARAMS below.  Coordinates: X = board x (mm,
0 at the left), Y = board depth measured from the FRONT edge (the player's side; the board's own y runs the other
way, Y = 278 - y), Z up with the board's component side at Z = 0.

Parts (all in central-pedal-enclosure.step, positioned; also one STEP + STL per part):
  base            the tub: floor, four walls, back-panel cut-outs, board bosses, fan grille, battery strap slots
  plate           the top plate 16 mm above the board: footswitch / LED / knob / fader / label-screen openings,
                  the two screen windows (bezelled; the screens themselves are screwed to the BOARD and meet the
                  plate through a foam gasket), bosses down to the board
  plunger         the power-button pusher that sits in the back panel
  splices         bars that stiffen the plate's y seam on its underside
  base_tiles / plate_tiles   the base and plate cut into 2 x 2 printable pieces (half-lap seams on both)
Reference bodies (board, Pi, screens with their stand-offs, fan, cable plugs, controls) are included in the assembly
STEP so the fit can be checked in CAD.
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
ENC_HOLE = 8.0               # knob shaft through a plain hole (EC11, 30 mm shaft -> 11 mm of shaft above the plate)
FADER_RECESS = (18.0, 78.0)  # the fader cap runs in a shallow recessed tray (x, y), so the 20.5 mm lever top shows 6 mm
FADER_RECESS_FLOOR_Z = 12.8  # tray floor underside: above the label-screen modules (12.5) and the fader body (9)
FADER_RECESS_FLOOR_T = 1.6
FADER_SLOT = (3.6, 64.0)     # lever slot (x, y): 60 mm travel + lever
CHAMFER_WIN = 1.2            # 45-degree bezel on the screen and label-screen windows
EDGE_R = 2.5                 # rounded outer edges (plate top, base bottom)
OLED_WIN = (23.4, 6.6)       # 0.91" module's visible 22.4 x 5.6 + margin; centre = module origin + 17.5 in x
OLED_MODULE_H = 12.5         # module top above the board (on its 4-pin socket): nothing may hang lower over it
# screens
# Both screens are screwed to the board on their own stand-offs (rev B.2), so their heights are fixed by the board:
#   glass_z = glass front above the board, body_z = the underside of the screen body (outside its stand-offs)
DISP7 = dict(size=(189.32, 120.24), active=(155.0, 88.0), at=tuple(G["d7_at"]), glass_z=14.92, body_z=8.5,
             holes=G["d7_holes"], so_d=5.0, brackets=[(dx, dy) for dx in (-70.0, 70.0) for dy in (-35.355, 35.355)], bracket_z=5.5)
BAR = dict(size=(287.3, 69.8), active=(268.18, 57.98), at=tuple(G["bar_at"]), glass_z=13.65, body_z=6.7,
           holes=G["bar_holes"], so_d=5.5, brackets=[], bracket_z=None,
           # from Waveshare's STEP: the driver PCB on the back (its back face 4.0 mm above our board, with a notch in front
           # of the touch port), four more 4 mm corner posts that also rest on our board, and the parts that hang lowest
           pcb=(136.5, 159.75, 258.5, 226.25, 4.0), notch=(244.0, 209.0, 259.5, 219.0),
           posts=[(254.5, 222.85), (254.5, 163.75), (140.5, 163.8), (140.45, 222.8)],
           low=[(137.5, 187.0, 143.8, 211.0, 1.5), (160.4, 166.3, 168.3, 171.75, 1.36), (237.1, 210.25, 242.5, 218.2, 1.36)])
GASKET = {id(DISP7): Z_PLATE - 14.92, id(BAR): Z_PLATE - 13.65}      # foam tape between the plate and each glass (1.1 / 2.4 mm)
# back panel
JACK_AXIS_Z = 6.3            # 1/4" jack axis above the PCB (HOOYA PJ-611E: 12.6 mm body, axis centred)
JACK_HOLE = 9.9              # its 3/8in-32 bushing (9.53) through the back panel; nut + washer outside
JACK_RING = (10.6, 13.0)     # spacer ring on the wall's inside (ID clears the 10.1 mm collar, OD bears on the body face):
                             # the nut clamps the panel against the jack body, not against the solder joints
JACK35_AXIS_Z = 2.6          # PJ-320D
JACK35_HOLE = 9.5            # lets 3.5 mm plug bodies reach the recessed jack
USBC_WIN = (13.5, 8.0, 1.7)  # w, h, centre z - sized for the plug's overmould
USBA_WIN = (16.0, 9.0, 3.6)
PWR_HOLE = 5.0
PWR_Z = 3.5
# base interior
FAN_AT, FAN_SIZE, FAN_HOLES = (126.0, 112.0), 40.0, 32.0       # 40 mm fan screwed to the base floor (4 x M3 inserts), blowing down through the grille
FAN_PAD_H = 4.0
# Raspberry Pi 4: screwed to the base on 4 bosses with M2.5 heat-set inserts (component side up), the board drops onto it
PI_Z0 = -T_PCB - 20.0 - 1.6         # Pi PCB underside: 20 mm M2.5 male-female standoffs between the Pi and the board
PI_INSERT = (3.6, 7.0)              # M2.5 heat-set insert hole: diameter, depth (the standoff's 6 mm male thread goes in)
# right side panel: the Pi's ports come out through panel-mount extension leads (board y of each, kind)
SIDE_IO_Z = -15.3                   # centred in the 27 mm between the floor and the board
SIDE_IO = [(42.0, "RJ45"), (84.0, "USB"), (122.0, "USB"), (190.0, "HDMI")]
IO_SPEC = {   # face cut-out (w, h), mounting-hole slot range (min, max centre-to-centre), screw slot width, body depth inside
    "RJ45": ((17.0, 14.5), (27.0, 38.0), 3.4, 32.0),
    "USB": ((15.4, 8.2), (26.0, 32.0), 3.4, 30.0),
    "HDMI": ((16.2, 7.6), (28.0, 34.0), 3.4, 30.0),
}
BATT_BAY = (20.0, 100.0, 180.0, 250.0)                         # x0, x1, y0, y1 (board y): strap slots for a 2S pack
FEET_D = 20.0
VENT = dict(n=8, w=2.0, h=18.0, pitch=5.0)                      # slot rows in the side walls
# printable split
PLATE_SEAM_X, PLATE_SEAM_Y, PLATE_LAP = 203.5, 150.0, 8.0   # board coordinates; half-lap joints (1.5 mm steps) + splice bars on the y seam
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
    # Raspberry Pi bosses (M2.5 inserts) and fan pads (M3 inserts)
    for (x, y) in G["pi_holes"]:
        X, Y = P(x, y)
        adds.append(cyl(X, Y, 6.5, Z_FLOOR - 0.01, PI_Z0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            FX, FY = P(*FAN_AT)
            adds.append(cyl(FX + sx * FAN_HOLES / 2, FY + sy * FAN_HOLES / 2, 7.0, Z_FLOOR - 0.01, Z_FLOOR + FAN_PAD_H))
    # spacer rings behind the 1/4" jack holes: from the wall's inner face to 0.05 mm short of the jack body face (board edge)
    for (x, y) in G["jack"]:
        X, _ = P(x, y)
        ring = cq.Workplane("XZ").circle(JACK_RING[1] / 2).circle(JACK_RING[0] / 2).extrude(-(GAP - 0.05 + 0.5))
        adds.append(ring.translate((X, H + 0.05, JACK_AXIS_Z)))
    fx, fy = P(*FAN_AT)
    base = base.union(union_all(adds))

    cuts = []
    # screw holes through the bosses + counterbores from below
    for (x, y) in G["holes"]:
        X, Y = P(x, y)
        cuts.append(cyl(X, Y, SCREW_D, Z_BOT - 1, -T_PCB + 1))
        cuts.append(cyl(X, Y, 6.5, Z_BOT - 1, Z_BOT + 3.0))
    # insert holes: Pi bosses (M2.5), fan pads (M3)
    for (x, y) in G["pi_holes"]:
        X, Y = P(x, y)
        cuts.append(cyl(X, Y, PI_INSERT[0], PI_Z0 - PI_INSERT[1], PI_Z0 + 0.5))
    for sx in (-1, 1):
        for sy in (-1, 1):
            FX, FY = P(*FAN_AT)
            cuts.append(cyl(FX + sx * FAN_HOLES / 2, FY + sy * FAN_HOLES / 2, INSERT_D, Z_FLOOR + FAN_PAD_H - INSERT_DEPTH, Z_FLOOR + FAN_PAD_H + 1))
    # right side panel: cut-outs + slotted M3 holes for the panel-mount leads (ears 26-38 mm apart all fit)
    for (yb, kind) in SIDE_IO:
        (fw, fh), (smin, smax), sw, _ = IO_SPEC[kind]
        Y = P(0, yb)[1]
        x0 = XI1 - 1.0
        cuts.append(cq.Workplane("YZ").rect(fw, fh).extrude(WALL + 2.0).edges("|X").fillet(1.0).translate((x0, Y, SIDE_IO_Z)))
        for sgn in (-1, 1):
            yc = Y + sgn * (smin + smax) / 4
            slot_len = (smax - smin) / 2 + sw
            cuts.append(cq.Workplane("YZ").slot2D(slot_len, sw).extrude(WALL + 2.0).translate((x0, yc, SIDE_IO_Z)))
    # back panel: 1/4" jacks
    yb0, yb1 = H + 0.4, YO1 + 1          # from the inner pad face through the wall
    for (x, y) in G["jack"]:
        X, _ = P(x, y)
        cuts.append(cq.Workplane("XZ").circle(JACK_HOLE / 2).extrude(-(yb1 - yb0)).translate((X, yb0, JACK_AXIS_Z)))
    for (x, y) in G["jack35"]:
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
    # fan: exhaust grille (hex-ish ring of holes) in the floor under the fan that hangs off the back of the board
    cuts.append(cyl(fx, fy, 3.0, Z_BOT - 1, Z_FLOOR + 1))
    for ring, n in ((1, 6), (2, 12), (3, 18)):
        rr = ring * 5.6
        for k in range(n):
            a = 2 * math.pi * k / n + (ring % 2) * math.pi / n
            cuts.append(cyl(fx + rr * math.cos(a), fy + rr * math.sin(a), 4.0, Z_BOT - 1, Z_FLOOR + 1))
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
    for (xw, yc) in ((XO0, P(0, 90)[1]), (XO1, P(0, 240)[1]), (XO0, P(0, 200)[1])):         # right wall: clear of the side I/O
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
    # screens: a bezelled window over each screen's active area; the screen itself is on the board, a strip of foam
    # tape on the plate underside around the window seals the gap (GASKET) to the glass
    for scr in (DISP7, BAR):
        sx, sy = P(*scr["at"])
        aw, ah = scr["active"]
        cuts.append(rbox(sx - aw / 2 - 1.0, sy - ah / 2 - 1.0, sx + aw / 2 + 1.0, sy + ah / 2 + 1.0, Z_PLATE - 1, Z_TOP + 1, 1.5))
        cuts.append(frustum_cut(sx, sy, aw + 2.0, ah + 2.0, CHAMFER_WIN, r=1.5))
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
    pi = [rbox(X0, Y1 - 56.0, X0 + 85.0, Y1, PI_Z0, PI_Z0 + 1.6)]
    # its tall parts (component side up): Ethernet, 2 x 2 USB at the right short edge (2.5 mm overhang), the standoffs
    for (yc, w, h) in ((10.25, 16.0, 13.5), (29.0, 15.0, 16.0), (47.0, 15.0, 16.0)):
        Yc = Y1 - yc
        pi.append(rbox(X0 + 85.0 - 21.0, Yc - w / 2, X0 + 85.0 + 2.5, Yc + w / 2, PI_Z0 + 1.6, PI_Z0 + 1.6 + h))
    for (x, y) in G["pi_holes"]:
        pi.append(cq.Workplane("XY").polygon(6, 5.8).extrude(20.0).translate((P(x, y)[0], P(x, y)[1], PI_Z0 + 1.6)))
    refs["pi"] = union_all(pi)
    # the two screens as mounted on the board: body + stand-offs (+ the 7" display's corner brackets)
    for name, scr in (("display7", DISP7), ("bar_screen", BAR)):
        sx, sy = P(*scr["at"])
        sw, sh = scr["size"]
        body = rbox(sx - sw / 2, sy - sh / 2, sx + sw / 2, sy + sh / 2, scr["body_z"], scr["glass_z"], 3.0)
        parts = [body] + [cyl(P(x, y)[0], P(x, y)[1], scr["so_d"], 0.0, scr["body_z"] + 0.01) for (x, y) in scr["holes"]]
        for (dx, dy) in scr["brackets"]:
            bx, by = P(scr["at"][0] + dx, scr["at"][1] + dy)
            parts.append(rbox(bx - 4.5, by - 7.5, bx + 4.5, by + 7.5, scr["bracket_z"], scr["body_z"] + 0.01))
        if "pcb" in scr:
            x0, y0, x1, y1, z = scr["pcb"]
            X0, Y0 = P(x0, y1); X1, Y1 = P(x1, y0)
            pcb = rbox(X0, Y0, X1, Y1, z, scr["body_z"] + 0.01)
            nx0, ny0, nx1, ny1 = scr["notch"]
            pcb = pcb.cut(rbox(P(nx0, ny1)[0], P(nx0, ny1)[1], P(nx1, ny0)[0], P(nx1, ny0)[1], z - 1, scr["body_z"] + 1))
            parts.append(pcb)
            parts += [cyl(P(x, y)[0], P(x, y)[1], scr["so_d"], 0.0, z + 0.01) for (x, y) in scr["posts"]]
            for (x0, y0, x1, y1, z) in scr["low"]:
                parts.append(rbox(P(x0, y1)[0], P(x0, y1)[1], P(x1, y0)[0], P(x1, y0)[1], z, scr["pcb"][4] + 0.01))
        refs[name] = union_all(parts)
    # fan on the floor pads, 40 x 40 x 10
    fx, fy = P(*FAN_AT)
    refs["fan"] = rbox(fx - 20, fy - 20, fx + 20, fy + 20, Z_FLOOR + FAN_PAD_H, Z_FLOOR + FAN_PAD_H + 10.0, 2.0)
    # panel-mount leads behind the right wall: connector body + the first 15 mm of cable
    io = []
    for (yb, kind) in SIDE_IO:
        (fw, fh), _, _, depth = IO_SPEC[kind]
        Y = P(0, yb)[1]
        io.append(rbox(XI1 - depth, Y - fw / 2 - 1.0, XI1 - 0.01, Y + fw / 2 + 1.0, SIDE_IO_Z - fh / 2 - 1.0, SIDE_IO_Z + fh / 2 + 1.0, 1.0))
    refs["side_io"] = union_all(io)
    # cable plugs: the bar screen's HDMI and touch-USB plug bodies sit in their board slots (7 mm thick, centred on
    # the sockets 2.7 mm above the board) and the Pi's micro-HDMI plug under the board
    plugs = []
    for (x0, y0, x1, y1) in G["slots"]:
        if x1 - x0 < 5:
            continue                                    # the ribbon slot
        if x1 - x0 > y1 - y0:                             # touch plug: 10 mm wide housing in the bar PCB's notch
            yc = (y0 + y1) / 2
            X0, Y0 = P(x0 + 0.5, yc + 4.7); X1, Y1 = P(x1 - 0.5, yc - 4.7)
        else:                                              # HDMI plug: 11 x 24 housing hanging in the slot
            X0, Y0 = P(x0 + 1.0, y1 - 0.5); X1, Y1 = P(x1 - 1.0, y0 + 0.5)
        plugs.append(rbox(X0, Y0, X1, Y1, -0.8, 6.2, 1.0))
    pi_hdmi_x = px0 + 39.5                               # micro-HDMI 1 on the Pi
    X, Y = P(pi_hdmi_x, py0 + 56.0 + 13.0)                    # from 1 mm outside the Pi's front edge, 24 mm long
    plugs.append(rbox(X - 5.5, Y - 12.0, X + 5.5, Y + 12.0, -T_PCB - 20.0 - 1.6 - 5.0, -T_PCB - 20.0 + 2.5, 1.0))
    refs["plugs"] = union_all(plugs)
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
    """2 x 2 with half-laps through the plate's thickness: the low-side tile keeps the upper half in the lap zone, the
    high-side tile the lower half (and whatever hangs below the plate there)."""
    SX, SY = PLATE_SEAM_X, H - PLATE_SEAM_Y
    half = PLATE_LAP / 2
    big = 2000.0
    z_mid = Z_PLATE + T_PLATE / 2
    upper = rbox(-big, -big, big, big, z_mid, big)
    lower = rbox(-big, -big, big, big, -big, z_mid)

    def region(axis, side):
        S = SX if axis == "x" else SY
        lap = halfspace(axis, S - half, S + half)
        if side < 0:
            return halfspace(axis, -big, S - half).union(lap.intersect(upper))
        return halfspace(axis, S + half, big).union(lap.intersect(lower))

    tiles = {}
    for nx, sx in (("L", -1), ("R", 1)):
        rx = region("x", sx)
        for ny, sy in (("front", -1), ("back", 1)):
            tiles["plate_%s_%s" % (ny, nx)] = plate.intersect(rx).intersect(region("y", sy))
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
    plunger = make_plunger()
    export("power-plunger", plunger)
    refs = make_refs()

    asm = cq.Assembly(name="central-pedal-enclosure")
    asm.add(base, name="base", color=cq.Color(0.12, 0.12, 0.12))
    asm.add(plate, name="plate", color=cq.Color(0.12, 0.12, 0.12))
    asm.add(splices, name="splice-bars", color=cq.Color(0.5, 0.5, 0.5))
    asm.add(plunger, name="power-plunger", color=cq.Color(0.83, 0.69, 0.22))
    asm.add(refs["board"], name="ref-main-board", color=cq.Color(0.1, 0.35, 0.15))
    asm.add(refs["pi"], name="ref-raspberry-pi-4", color=cq.Color(0.1, 0.5, 0.2))
    asm.add(refs["display7"], name="ref-7in-display", color=cq.Color(0.05, 0.05, 0.1))
    asm.add(refs["bar_screen"], name="ref-bar-screen", color=cq.Color(0.05, 0.05, 0.1))
    asm.add(refs["fan"], name="ref-fan", color=cq.Color(0.2, 0.2, 0.2))
    asm.add(refs["side_io"], name="ref-side-panel-leads", color=cq.Color(0.3, 0.3, 0.3))
    asm.add(refs["plugs"], name="ref-cable-plugs", color=cq.Color(0.3, 0.3, 0.3))
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
