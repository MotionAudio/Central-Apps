#!/usr/bin/python3
"""Rev B.2 on the routed board: the 7" Touch Display 2, the 11.9" bar screen and the 40 mm fan mount ON the board, so
the assembler fits them (nothing is left for the user but the Pi, the knobs / caps and the enclosure).

  - 7" Touch Display 2: screwed from the back of the board into its four M2.5 Pi stand-offs (49 x 58 mm pattern,
    8.5 mm long: the glass ends up 14.92 mm above the board).  Pattern centre is 27 mm from the display centre toward
    its ribbon connector; the display sits at (195, 94) with the connector end toward +x so the ribbon runs straight
    to the slot.  Holes: (193, 69.5) (251, 69.5) (193, 118.5) (251, 118.5).
  - 11.9" bar screen (Waveshare 11.9inch HDMI LCD): screwed from the back into its four M2.5 Pi stand-offs (58 x 49,
    4 mm long: glass 13.65 mm above the board).  Positions from Waveshare's STEP model.  Its mini-HDMI faces the 7"
    display (a slot in the board lets the plug body drop through to the Pi), its touch micro-USB faces +x (another
    slot under that plug; the cable goes to J_USB_BAR on the back).
  - Fan: 40 x 40 x 10 on 10 mm stand-offs on the BACK of the board at (116, 116), four M3 holes at 32 mm.
Conflicting parts are moved, copper in the new holes / slots is ripped, the board is saved for route.py to finish.
"""
import os
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design  # noqa: E402

OUT = build.OUT
NAME = build.NAME
_args = [a for a in sys.argv[1:] if not a.startswith("--")]
SRC = _args[0] if _args else "%s/%s-routed.kicad_pcb" % (OUT, NAME)
DST = _args[1] if len(_args) > 1 else "%s/pass6-src.kicad_pcb" % OUT
DRY = "--dry" in sys.argv
_KEEP = []

# ---- geometry (board mm, y down) --------------------------------------------------------------------------------
D7_AT = (195.0, 94.0)                                   # display centre (outline 189.32 x 120.24)
D7_HOLES = [(193.0, 69.5), (251.0, 69.5), (193.0, 118.5), (251.0, 118.5)]
BAR_AT = (195.0, 193.0)                                 # outline 287.3 x 69.8
BAR_HOLES = [(156.6, 170.5), (156.6, 219.45), (214.6, 170.5), (214.6, 219.45)]
HDMI_SLOT = (179.5, 129.0, 192.5, 154.0)                # mini-HDMI plug body (socket at x 185.1 on the bar's back edge)
TOUCH_SLOT = (247.5, 207.7, 271.5, 220.7)               # micro-USB plug body (socket at (240.2, 214.2) facing +x)
FAN_AT = (116.0, 116.0)
FAN_HOLES = [(FAN_AT[0] + dx, FAN_AT[1] + dy) for dx in (-16, 16) for dy in (-16, 16)]
MOVES = {                                                # ref: (x, y) new position, same rotation
    "C_SYS": (134.5, 55.5),                             # out from under the display's corner bracket (5.5 mm up)
    "U_MUX2": (171.5, 150.0),                           # out of the HDMI slot
    "C180": (171.5, 143.5),                             # U_MUX2's decoupling cap, follows it
    "C112": None, "C113": None,                         # under the display stand-off at (193, 118.5): auto-placed nearby
}
HOLE_CLR = 0.25 + 0.15
EDGE_CLR = 0.30 + 0.15


def rect_inflate(r, m):
    return (r[0] - m, r[1] - m, r[2] + m, r[3] + m)


def seg_point_dist(ax, ay, bx, by, px, py):
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = 0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
    return ((px - (ax + t * vx)) ** 2 + (py - (ay + t * vy)) ** 2) ** 0.5


def _segs_cross(ax, ay, bx, by, cx, cy, dx, dy):
    def orient(px, py, qx, qy, rx, ry):
        return (qx - px) * (ry - py) - (qy - py) * (rx - px)
    o1, o2 = orient(ax, ay, bx, by, cx, cy), orient(ax, ay, bx, by, dx, dy)
    o3, o4 = orient(cx, cy, dx, dy, ax, ay), orient(cx, cy, dx, dy, bx, by)
    return (o1 * o2 < 0) and (o3 * o4 < 0)


def seg_rect_dist(ax, ay, bx, by, x1, y1, x2, y2):
    def inside(x, y):
        return x1 <= x <= x2 and y1 <= y <= y2
    if inside(ax, ay) or inside(bx, by):
        return 0.0
    for (cx, cy, dx, dy) in ((x1, y1, x2, y1), (x2, y1, x2, y2), (x2, y2, x1, y2), (x1, y2, x1, y1)):
        if _segs_cross(ax, ay, bx, by, cx, cy, dx, dy):
            return 0.0
    best = 1e9
    for (cx, cy, dx, dy) in ((x1, y1, x2, y1), (x2, y1, x2, y2), (x2, y2, x1, y2), (x1, y2, x1, y1)):
        best = min(best, seg_point_dist(ax, ay, bx, by, cx, cy), seg_point_dist(ax, ay, bx, by, dx, dy),
                   seg_point_dist(cx, cy, dx, dy, ax, ay), seg_point_dist(cx, cy, dx, dy, bx, by))
    return best


def seg_hits_rect(ax, ay, bx, by, hw, r):
    return seg_rect_dist(ax, ay, bx, by, *r) - hw < 0


def seg_hits_circle(ax, ay, bx, by, hw, cx, cy, cr):
    return seg_point_dist(ax, ay, bx, by, cx, cy) - hw - cr < 0


b = pcbnew.LoadBoard(SRC)
print("loaded", os.path.basename(SRC), "tracks+vias", len(b.GetTracks()))
ripped = {}


def rip(t, why):
    ripped[why] = ripped.get(why, 0) + 1
    b.Remove(t); _KEEP.append(t)


# ---- 1. new holes ------------------------------------------------------------------------------------------------
def add_hole(ref, key, x, y, desc):
    fp = build.load_fp(key)
    fp.SetReference(ref)
    fp.SetValue(desc)
    fp.Reference().SetVisible(False)
    fp.Value().SetVisible(False)
    fp.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    for g in fp.GraphicalItems():          # no courtyard: the stand-off feet sit over parts that are far above the board
        if g.GetLayer() in (pcbnew.F_CrtYd, pcbnew.B_CrtYd):
            g.SetLayer(pcbnew.User_9)
    b.Add(fp)
    return fp


new_holes = []    # (x, y, radius) copper keep-outs
for i, (x, y) in enumerate(D7_HOLES):
    add_hole("HD7_%d" % (i + 1), "HOLE_M25", x, y, "7in display stand-off M2.5"); new_holes.append((x, y, 1.35))
for i, (x, y) in enumerate(BAR_HOLES):
    add_hole("HBAR_%d" % (i + 1), "HOLE_M25", x, y, "bar screen stand-off M2.5"); new_holes.append((x, y, 1.35))
for i, (x, y) in enumerate(FAN_HOLES):
    add_hole("HFAN_%d" % (i + 1), "HOLE_M3", x, y, "fan stand-off M3"); new_holes.append((x, y, 1.6))
print("holes added:", len(new_holes))

# ---- 2. slots + silkscreen ------------------------------------------------------------------------------------------
for r in (HDMI_SLOT, TOUCH_SLOT):
    build.add_rect(b, pcbnew.Edge_Cuts, r[0], r[1], r[2], r[3], 0.1)
# outlines of what sits on top (front silk) and the fan (back silk), so the assembly drawing shows it
w7, h7 = 189.32, 120.24
build.add_rect(b, pcbnew.F_SilkS, D7_AT[0] - w7 / 2, D7_AT[1] - h7 / 2, D7_AT[0] + w7 / 2, D7_AT[1] + h7 / 2, 0.15)
build.add_text(b, "7in TOUCH DISPLAY 2 (ribbon connector at this end, cable to the slot)", D7_AT[0] + 40, D7_AT[1] + 52, 1.2, pcbnew.F_SilkS)
wb, hb = 287.3, 69.8
build.add_rect(b, pcbnew.F_SilkS, BAR_AT[0] - wb / 2, BAR_AT[1] - hb / 2, BAR_AT[0] + wb / 2, BAR_AT[1] + hb / 2, 0.15)
build.add_text(b, "11.9in BAR SCREEN - HDMI / buttons edge toward the 7in display", BAR_AT[0], BAR_AT[1] - 28, 1.2, pcbnew.F_SilkS)
build.add_text(b, "HDMI PLUG", (HDMI_SLOT[0] + HDMI_SLOT[2]) / 2, HDMI_SLOT[1] - 2, 0.9, pcbnew.F_SilkS)
build.add_text(b, "TOUCH USB PLUG", (TOUCH_SLOT[0] + TOUCH_SLOT[2]) / 2, TOUCH_SLOT[3] + 2, 0.9, pcbnew.F_SilkS)
build.add_rect(b, pcbnew.B_SilkS, FAN_AT[0] - 20, FAN_AT[1] - 20, FAN_AT[0] + 20, FAN_AT[1] + 20, 0.15)
build.add_text(b, "40mm FAN on 10mm stand-offs", FAN_AT[0], FAN_AT[1], 1.2, pcbnew.B_SilkS)
build.add_text(b, "(blows down, out through the floor grille)", FAN_AT[0], FAN_AT[1] + 3, 0.9, pcbnew.B_SilkS)
for (x, y) in D7_HOLES:
    build.add_text(b, "7in", x, y + 3.2, 0.8, pcbnew.B_SilkS)
for (x, y) in BAR_HOLES:
    build.add_text(b, "BAR", x, y + 3.2, 0.8, pcbnew.B_SilkS)

# ---- 3. move the parts in the way -------------------------------------------------------------------------------
fps = list(b.GetFootprints())
blocked = [rect_inflate(HDMI_SLOT, 1.0), rect_inflate(TOUCH_SLOT, 1.0)]
blocked += [(x - 3.3, y - 3.3, x + 3.3, y + 3.3) for (x, y) in D7_HOLES + BAR_HOLES]
blocked += [(x - 3.6, y - 3.6, x + 3.6, y + 3.6) for (x, y) in FAN_HOLES]


def bbox_mm(fp):
    bb = fp.GetBoundingBox(False, False)
    return (bb.GetLeft() / 1e6, bb.GetTop() / 1e6, bb.GetRight() / 1e6, bb.GetBottom() / 1e6)


def overlaps(r, s, m=0.0):
    return not (r[2] + m < s[0] or s[2] + m < r[0] or r[3] + m < s[1] or s[3] + m < r[1])


def free_spot(fp, others):
    """nearest grid position (0.5 mm steps, within 8 mm) where the footprint's box clears everything"""
    x0, y0 = fp.GetPosition().x / 1e6, fp.GetPosition().y / 1e6
    bb = bbox_mm(fp); hw, hh = (bb[2] - bb[0]) / 2, (bb[3] - bb[1]) / 2
    best = None
    for dy in range(-16, 17):
        for dx in range(-16, 17):
            x, y = x0 + dx * 0.5, y0 + dy * 0.5
            r = (x - hw, y - hh, x + hw, y + hh)
            if any(overlaps(r, z) for z in blocked):
                continue
            if any(overlaps(r, o, 0.3) for o in others):
                continue
            d = dx * dx + dy * dy
            if best is None or d < best[0]:
                best = (d, x, y)
    return best


moved = []
for ref, at in MOVES.items():
    fp = b.FindFootprintByReference(ref)
    if fp is None:
        print("  (no %s on this board)" % ref); continue
    old = bbox_mm(fp)
    if at is None:
        others = [bbox_mm(o) for o in fps if o is not fp and o.GetLayer() == fp.GetLayer() and o.GetReference() not in MOVES]
        others += [bbox_mm(b.FindFootprintByReference(r_)) for r_ in moved]
        best = free_spot(fp, others)
        if best is None:
            raise SystemExit("no free spot for %s" % ref)
        at = (best[1], best[2])
    fp.SetPosition(pcbnew.VECTOR2I(mm(at[0]), mm(at[1])))
    new = bbox_mm(fp)
    clash = [o.GetReference() for o in fps if o is not fp and o.GetLayer() == fp.GetLayer() and o.GetReference() not in MOVES and overlaps(new, bbox_mm(o), 0.25)]
    clash += [z for z in blocked if overlaps(new, z)]
    if clash:
        raise SystemExit("%s at %s clashes with %s" % (ref, at, clash))
    moved.append(ref)
    print("  %-6s %s -> (%.1f, %.1f)" % (ref, "moved", at[0], at[1]))
    # copper under the old and the new footprint goes: the router redoes these nets
    for t in list(b.GetTracks()):
        hw = t.GetWidth() / 2e6
        if t.GetClass() == "PCB_VIA":
            p = t.GetPosition(); x, y = p.x / 1e6, p.y / 1e6
            if (old[0] - 0.5 <= x <= old[2] + 0.5 and old[1] - 0.5 <= y <= old[3] + 0.5) or (new[0] - 0.5 <= x <= new[2] + 0.5 and new[1] - 0.5 <= y <= new[3] + 0.5):
                rip(t, "moved part " + ref)
        else:
            a, c = t.GetStart(), t.GetEnd()
            if seg_hits_rect(a.x / 1e6, a.y / 1e6, c.x / 1e6, c.y / 1e6, hw + 0.4, old) or seg_hits_rect(a.x / 1e6, a.y / 1e6, c.x / 1e6, c.y / 1e6, hw + 0.4, new):
                rip(t, "moved part " + ref)

# ---- 4. copper out of the new holes and slots ---------------------------------------------------------------------
for t in list(b.GetTracks()):
    hw = t.GetWidth() / 2e6
    if t.GetClass() == "PCB_VIA":
        p = t.GetPosition(); x, y = p.x / 1e6, p.y / 1e6
        if any(((x - hx) ** 2 + (y - hy) ** 2) ** 0.5 - hw - hr < HOLE_CLR for (hx, hy, hr) in new_holes):
            rip(t, "via in a new hole"); continue
        if any(seg_hits_rect(x, y, x, y, hw + EDGE_CLR, s) for s in (HDMI_SLOT, TOUCH_SLOT)):
            rip(t, "via in a slot"); continue
    else:
        a, c = t.GetStart(), t.GetEnd()
        ax, ay, cx, cy = a.x / 1e6, a.y / 1e6, c.x / 1e6, c.y / 1e6
        if any(seg_hits_circle(ax, ay, cx, cy, hw + HOLE_CLR, hx, hy, hr) for (hx, hy, hr) in new_holes):
            rip(t, "track through a new hole"); continue
        if any(seg_hits_rect(ax, ay, cx, cy, hw + EDGE_CLR, s) for s in (HDMI_SLOT, TOUCH_SLOT)):
            rip(t, "track through a slot"); continue
print("ripped:", ripped, " total", sum(ripped.values()))

# ---- 5. outer GND pours off (route.py puts them back), save -----------------------------------------------------
for z in list(b.Zones()):
    if z.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu):
        b.Remove(z); _KEEP.append(z)
if not DRY:
    pcbnew.SaveBoard(DST, b)
    print("saved", DST)
