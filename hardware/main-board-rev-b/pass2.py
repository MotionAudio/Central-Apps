#!/usr/bin/python3
"""Second routing pass preparation: take the routed board, remove what the first pass got wrong, save a source board
for route.py (which exports every remaining track as FIXED and routes only what is open).

Removed:
  - tracks / vias through or too close to NPTH holes (mounting holes, jack pegs, the display-cable cut-out):
    Freerouting does not see holes without copper, so pass 1 routed straight through some of them
  - plane-stub vias that landed in the wrong In2 region (a 5V1 via in the 5V2 band, 5V2 vias up in the 5V1 area):
    those pads get real tracks instead
  - dangling stubs the router left (KiCad DRC track_dangling)
  - the outer GND pours (route.py adds them back after routing)
"""
import math
import os
import re
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design  # noqa: E402

OUT = build.OUT
NAME = build.NAME
SRC = sys.argv[1] if len(sys.argv) > 1 else "%s/%s-routed.kicad_pcb" % (OUT, NAME)
DST = sys.argv[2] if len(sys.argv) > 2 else "%s/pass2-src.kicad_pcb" % OUT
HOLE_CLR = 0.25      # KiCad rule: copper to hole
EDGE_CLR = 0.30      # copper to board edge
Y_SPLIT = 156.0      # In2: 5V1 above, 5V2 below
_KEEP = []


def seg_point_dist(ax, ay, bx, by, px, py):
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = 0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def seg_rect_dist(ax, ay, bx, by, x1, y1, x2, y2):
    """distance from segment AB to an axis-aligned rectangle (0 if it crosses it)"""
    def inside(x, y):
        return x1 <= x <= x2 and y1 <= y <= y2
    if inside(ax, ay) or inside(bx, by):
        return 0.0
    best = 1e9
    for (cx, cy, dx, dy) in ((x1, y1, x2, y1), (x2, y1, x2, y2), (x2, y2, x1, y2), (x1, y2, x1, y1)):
        best = min(best, seg_point_dist(ax, ay, bx, by, cx, cy), seg_point_dist(ax, ay, bx, by, dx, dy),
                   seg_point_dist(cx, cy, dx, dy, ax, ay), seg_point_dist(cx, cy, dx, dy, bx, by))
    return best


board = pcbnew.LoadBoard(SRC)
tracks = list(board.GetTracks())
print("loaded", os.path.basename(SRC), "tracks+vias:", len(tracks))

# ---- 1. NPTH holes and the cut-out
holes = []
for fp in board.GetFootprints():
    for p in fp.Pads():
        if p.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH:
            holes.append((p.GetPosition().x / 1e6, p.GetPosition().y / 1e6, max(p.GetDrillSizeX(), p.GetDrillSizeY()) / 2e6, fp.GetReference()))
cutouts = [tuple(v / 1e6 for v in build.inner_cutout(board))] if build.inner_cutout(board) else []
print("NPTH holes:", len(holes), " cut-outs:", cutouts)

doomed = set()
why = {}
for t in tracks:
    if t.GetClass() == "PCB_VIA":
        x, y = t.GetPosition().x / 1e6, t.GetPosition().y / 1e6
        r = t.GetWidth() / 2e6
        for hx, hy, hr, ref in holes:
            if math.hypot(x - hx, y - hy) - r - hr < HOLE_CLR - 0.001:
                doomed.add(t); why[t] = "hole " + ref
        for (x1, y1, x2, y2) in cutouts:
            if seg_rect_dist(x, y, x, y, x1, y1, x2, y2) - r < EDGE_CLR - 0.001:
                doomed.add(t); why[t] = "cut-out"
    else:
        s, e = t.GetStart(), t.GetEnd()
        ax, ay, bx, by = s.x / 1e6, s.y / 1e6, e.x / 1e6, e.y / 1e6
        hw = t.GetWidth() / 2e6
        for hx, hy, hr, ref in holes:
            if seg_point_dist(ax, ay, bx, by, hx, hy) - hw - hr < HOLE_CLR - 0.001:
                doomed.add(t); why[t] = "hole " + ref
        for (x1, y1, x2, y2) in cutouts:
            if seg_rect_dist(ax, ay, bx, by, x1, y1, x2, y2) - hw < EDGE_CLR - 0.001:
                doomed.add(t); why[t] = "cut-out"
n_hole = len(doomed)

# ---- 2. plane-stub vias in the wrong In2 region (+ their stub)
def attached_stubs(via):
    vp = via.GetPosition()
    out = []
    for t in tracks:
        if t.GetClass() == "PCB_TRACK" and t.GetNetCode() == via.GetNetCode():
            if (t.GetStart() - vp).EuclideanNorm() < mm(0.01) or (t.GetEnd() - vp).EuclideanNorm() < mm(0.01):
                if (t.GetEnd() - t.GetStart()).EuclideanNorm() <= mm(2.0):
                    out.append(t)
    return out

for t in tracks:
    if t.GetClass() != "PCB_VIA":
        continue
    y = t.GetPosition().y / 1e6
    net = t.GetNetname()
    x = t.GetPosition().x / 1e6
    if any(n_ == net and abs(x - vx) < 0.01 and abs(y - vy) < 0.01 for n_, vx, vy, _d, _dr in design.VIAS):
        continue          # a hand-placed trunk via, not a plane stub
    if (net == "5V1" and y > Y_SPLIT) or (net == "5V2" and y < Y_SPLIT):
        doomed.add(t); why[t] = "wrong plane region"
        for s in attached_stubs(t):
            doomed.add(s); why[s] = "stub of wrong-region via"
n_plane = len(doomed) - n_hole

# ---- 3. dangling stubs from the DRC report
rep_path = "%s/drc-report.txt" % OUT
if os.path.exists(rep_path):
    rep = open(rep_path).read()
    for m in re.finditer(r"\[track_dangling\].*?@\(([-\d.]+) mm, ([-\d.]+) mm\): Track \[(\S+)\] on (\S+), length ([\d.]+) mm", rep, re.S):
        x, y, net, layer, length = float(m.group(1)), float(m.group(2)), m.group(3), m.group(4), float(m.group(5))
        for t in tracks:
            if t.GetClass() == "PCB_TRACK" and t.GetNetname() == net and board.GetLayerName(t.GetLayer()) == layer:
                s, e = t.GetStart(), t.GetEnd()
                if abs((e - s).EuclideanNorm() / 1e6 - length) < 0.01 and (
                        math.hypot(s.x / 1e6 - x, s.y / 1e6 - y) < 0.01 or math.hypot(e.x / 1e6 - x, e.y / 1e6 - y) < 0.01):
                    doomed.add(t); why[t] = "dangling"
n_dangle = len(doomed) - n_hole - n_plane

by_net = {}
for t in doomed:
    by_net.setdefault(t.GetNetname(), []).append(why[t])
print("removing %d items (holes/cut-out %d, plane region %d, dangling %d):" % (len(doomed), n_hole, n_plane, n_dangle))
for net, reasons in sorted(by_net.items()):
    print("   %-12s %d  %s" % (net, len(reasons), sorted(set(reasons))))
for t in doomed:
    board.Remove(t)
    _KEEP.append(t)

# ---- 4. outer GND pours off (route.py pours them again after routing)
for z in list(board.Zones()):
    if z.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu):
        board.Remove(z)
        _KEEP.append(z)
pcbnew.SaveBoard(DST, board)
print("saved", DST)
