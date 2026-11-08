#!/usr/bin/python3
"""Rip-up as a text edit of the .kicad_pcb: delete other nets' track segments crossing the strip in front of a pad.
   ripfile.py BOARD REF PAD [length_mm]"""
import math, re, sys
import pcbnew
from pcbnew import FromMM as mm

path, ref, num = sys.argv[1], sys.argv[2], sys.argv[3]
length = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
TW, CLR = 0.25, 0.15
b = pcbnew.LoadBoard(path)
fp = b.FindFootprintByReference(ref)
pad = fp.FindPadByNumber(num)
c, p = fp.GetPosition(), pad.GetPosition()
ang = math.atan2(p.y - c.y, p.x - c.x)
ang = round(ang / (math.pi / 2)) * (math.pi / 2)
px, py = p.x / 1e6, p.y / 1e6
fx, fy = px + length * math.cos(ang), py + length * math.sin(ang)
half = min(pad.GetSize().x, pad.GetSize().y) / 2e6 + CLR + TW / 2
keep_net = pad.GetNetCode()

def seg_dist(ax, ay, bx, by, cx, cy, dx, dy):
    """distance between segments AB and CD"""
    def pd(px, py, ax, ay, bx, by):
        vx, vy = bx - ax, by - ay
        L2 = vx * vx + vy * vy
        t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * vx + (py - ay) * vy) / L2))
        return math.hypot(px - (ax + t * vx), py - (ay + t * vy))
    def inter(a, b, c, d):
        def ccw(p, q, r): return (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0])
        return ccw(a, c, d) != ccw(b, c, d) and ccw(a, b, c) != ccw(a, b, d)
    if inter((ax, ay), (bx, by), (cx, cy), (dx, dy)):
        return 0.0
    return min(pd(ax, ay, cx, cy, dx, dy), pd(bx, by, cx, cy, dx, dy), pd(cx, cy, ax, ay, bx, by), pd(dx, dy, ax, ay, bx, by))

txt = open(path).read()
pat = re.compile(r'\(segment\s*\(start ([-\d.]+) ([-\d.]+)\)\s*\(end ([-\d.]+) ([-\d.]+)\)\s*\(width ([\d.]+)\)\s*\(layer "([^"]+)"\)\s*\(net (\d+)\)\s*\(tstamp [^)]*\)\s*\)\s*', re.S)
names = {int(m.group(1)): m.group(2) for m in re.finditer(r'\(net (\d+) "([^"]*)"\)', txt)}
ripped, n = set(), 0
def repl(m):
    global n
    x1, y1, x2, y2, w, ly, net = float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5)), m.group(6), int(m.group(7))
    if net == keep_net or abs(w - 0.21) < 1e-6:
        return m.group(0)
    if seg_dist(x1, y1, x2, y2, px, py, fx, fy) < w / 2 + half:
        ripped.add(names.get(net, str(net))); n += 1
        return ""
    return m.group(0)
out = pat.sub(repl, txt)
open(path, "w").write(out)
print("removed", n, "segments of", sorted(ripped))
