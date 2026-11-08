#!/usr/bin/python3
"""Rev B.3 on the routed board (cost-down):
  - the ten 1/4in jacks become HOOYA PJ-611E (3/8in bushing + nut through the back panel) on the same anchors: the plug
    axes stay where they were, the pads move, so the copper around every jack is ripped for route.py to redo
  - D_BAR (the one SMD part on the back) moves to the front, so the SMT is single-sided (one stencil, one reflow)
  - encoders and ESD diodes change part number only (same footprints)
"""
import os
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design  # noqa: E402

_args = [a for a in sys.argv[1:] if not a.startswith("--")]
SRC = _args[0] if _args else "%s/%s-routed.kicad_pcb" % (build.OUT, build.NAME)
DST = _args[1] if len(_args) > 1 else "%s/pass8-src.kicad_pcb" % build.OUT
_KEEP = []

b = pcbnew.LoadBoard(SRC)
d = design.build()
parts = {p["ref"]: p for p in d.parts}
nets = {n.GetNetname(): n for n in b.GetNetsByName().values()}
ripzones = []


def bbox_mm(fp):
    bb = fp.GetBoundingBox(False, False)
    return (bb.GetLeft() / 1e6, bb.GetTop() / 1e6, bb.GetRight() / 1e6, bb.GetBottom() / 1e6)


# ---- 1. jacks
for ref, p in parts.items():
    if p["fp"] != "JACK635":
        continue
    old = b.FindFootprintByReference(ref)
    ob = bbox_mm(old)
    pos, rot = old.GetPosition(), old.GetOrientationDegrees()
    b.Remove(old); _KEEP.append(old)
    new = build.load_fp("JACK635")
    new.SetReference(ref)
    new.SetValue(p["value"])
    new.SetPosition(pos)
    new.SetOrientationDegrees(rot)
    b.Add(new)
    for pad in new.Pads():
        net = p["pins"].get(pad.GetNumber(), "")
        pad.SetNet(nets[net] if net else b.FindNet(0))
    nb = bbox_mm(new)
    ripzones += [ob, nb]
    ax = pos.x / 1e6 - 8.115
    print("%-7s PJ-611E axis x %.3f, body x %.1f-%.1f y %.1f-%.1f" % (ref, ax, nb[0], nb[2], nb[1], nb[3]))

# ---- 2. D_BAR to the front
db = b.FindFootprintByReference("D_BAR")
if db.GetLayer() == pcbnew.B_Cu:
    ripzones.append(bbox_mm(db))
    db.Flip(db.GetPosition(), False)
    ripzones.append(bbox_mm(db))
    print("D_BAR flipped to", "front" if db.GetLayer() == pcbnew.F_Cu else "back")

# ---- 3. rip copper in / near the changed footprints
def inside(x, y, r, m):
    return r[0] - m <= x <= r[2] + m and r[1] - m <= y <= r[3] + m


def seg_hits(ax, ay, bx, by, r, m):
    n = max(2, int(((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5 / 0.2) + 1)
    return any(inside(ax + (bx - ax) * k / (n - 1), ay + (by - ay) * k / (n - 1), r, m) for k in range(n))


n = 0
for t in list(b.GetTracks()):
    if t.GetWidth() >= mm(0.8) and t.GetClass() != "PCB_VIA" and t.IsLocked():
        pass
    hw = t.GetWidth() / 2e6
    if t.GetClass() == "PCB_VIA":
        q = t.GetPosition()
        hit = any(inside(q.x / 1e6, q.y / 1e6, r, hw + 0.4) for r in ripzones)
    else:
        a, c = t.GetStart(), t.GetEnd()
        hit = any(seg_hits(a.x / 1e6, a.y / 1e6, c.x / 1e6, c.y / 1e6, r, hw + 0.4) for r in ripzones)
    if hit:
        b.Remove(t); _KEEP.append(t); n += 1
print("tracks/vias ripped:", n)

# ---- 4. values of the changed parts, outer pours off, save
for ref, p in parts.items():
    fp = b.FindFootprintByReference(ref)
    if fp and fp.GetValue() != p["value"]:
        fp.SetValue(p["value"])
for z in list(b.Zones()):
    if z.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu):
        b.Remove(z); _KEEP.append(z)
pcbnew.SaveBoard(DST, b)
print("saved", DST)
