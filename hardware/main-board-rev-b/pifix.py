#!/usr/bin/python3
"""Rev B.1 correction on the routed board: the Pi plugs onto the BACK with its component side toward the board, so
seen from the front it is NOT mirrored - pin 1 of the 2x20 socket belongs at the LEFT end of the header (x min),
inner row, and the Pi body / mounting holes / display-ribbon slot sit accordingly.  The earlier build had the whole
Pi frame mirrored.  This script:
  - renumbers J1's pads column-mirrored (pad positions stay, nets follow the pin numbers)
  - moves the four Pi mounting holes and the display-ribbon slot, redraws the Pi outline on the back silk
  - moves the hub crystal out of the new slot, drops the two unfitted 22 pF pads that sat there
  - rips every track touching the header and the crystal nets, so route.py (--rippable) can redo them
"""
import os
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design  # noqa: E402

OUT = build.OUT
NAME = build.NAME
SRC = sys.argv[1] if len(sys.argv) > 1 else "%s/%s-routed.kicad_pcb" % (OUT, NAME)
DST = sys.argv[2] if len(sys.argv) > 2 else "%s/pass4-src.kicad_pcb" % OUT
_KEEP = []

b = pcbnew.LoadBoard(SRC)
d = design.build()
j1_pins = {p["ref"]: p for p in d.parts}["J1"]["pins"]
netinfo = {n.GetNetname(): n for n in b.GetNetsByName().values()}

# ---- 1. J1: pin 1 at the left end, inner (+y) row
j1 = b.FindFootprintByReference("J1")
pads = list(j1.Pads())
xs = sorted({round(p.GetPosition().x / 1e6, 2) for p in pads})
ys = sorted({round(p.GetPosition().y / 1e6, 2) for p in pads})
assert len(xs) == 20 and len(ys) == 2, (xs, ys)
inner_y = ys[1]          # the row toward the Pi body (+y)
renum = 0
for p in pads:
    c = xs.index(round(p.GetPosition().x / 1e6, 2))
    new = 2 * c + (1 if round(p.GetPosition().y / 1e6, 2) == inner_y else 2)
    if p.GetNumber() != str(new):
        renum += 1
    p.SetNumber(str(new))
    net = j1_pins.get(str(new), "")
    p.SetNet(netinfo[net] if net else b.FindNet(0))
print("J1 pads renumbered:", renum, " pin 1 at", xs[0], inner_y)
pin1 = (xs[0], inner_y)
sign = 1
pi_left_x = pin1[0] - 7.1
header_y = pin1[1] - 1.27

# ---- 2. Pi mounting holes
for k, (px, py) in enumerate(((3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5))):
    fp = b.FindFootprintByReference("HPI%d" % (k + 1))
    fp.SetPosition(pcbnew.VECTOR2I(mm(pin1[0] + sign * (px - 7.1)), mm(header_y + (py - 3.5))))
    print("HPI%d ->" % (k + 1), round(fp.GetPosition().x / 1e6, 2), round(fp.GetPosition().y / 1e6, 2))

# ---- 3. slot + silk
old = build.inner_cutout(b)
for dwg in list(b.GetDrawings()):
    if dwg.GetLayer() == pcbnew.Edge_Cuts and dwg.GetClass() == "PCB_SHAPE":
        a, c = dwg.GetStart(), dwg.GetEnd()
        if all(mm(0.5) < v < mm(design.W - 0.5) for v in (a.x, c.x)) and all(mm(0.5) < v < mm(design.H - 0.5) for v in (a.y, c.y)):
            b.Remove(dwg); _KEEP.append(dwg)
    elif dwg.GetClass() == "PCB_TEXT" and dwg.GetText() in ("DISPLAY RIBBON", "RASPBERRY PI 4 FITS HERE (component side toward the board)", "NEVER PLUG THE PI'S OWN USB-C POWER IN"):
        b.Remove(dwg); _KEEP.append(dwg)
    elif dwg.GetLayer() == pcbnew.B_SilkS and dwg.GetClass() == "PCB_SHAPE" and dwg.GetShape() == pcbnew.SHAPE_T_SEGMENT:
        a, c = dwg.GetStart(), dwg.GetEnd()
        # the old Pi outline: 85 x 56 rectangle lines
        L = (c - a).EuclideanNorm()
        if abs(L - mm(85)) < mm(0.05) or abs(L - mm(56)) < mm(0.05):
            b.Remove(dwg); _KEEP.append(dwg)
slot_a, slot_b = sorted((pi_left_x - sign * 1.5, pi_left_x - sign * 4.7))
slot_x = (slot_a + slot_b) / 2
build.add_rect(b, pcbnew.Edge_Cuts, slot_a, header_y + 13.5, slot_b, header_y + 36.5, 0.1)
x_a, x_b = sorted((pi_left_x, pi_left_x + sign * 85))
build.add_rect(b, pcbnew.B_SilkS, x_a, header_y - 3.5, x_b, header_y - 3.5 + 56, 0.15)
build.add_text(b, "RASPBERRY PI 4 FITS HERE (component side toward the board)", (x_a + x_b) / 2, header_y + 30, 1.2, pcbnew.B_SilkS)
build.add_text(b, "NEVER PLUG THE PI'S OWN USB-C POWER IN", (x_a + x_b) / 2, header_y + 34, 1.2, pcbnew.B_SilkS)
build.add_text(b, "DISPLAY RIBBON", slot_x, header_y + 42, 0.9, pcbnew.F_SilkS, 90)
print("slot was", None if old is None else [round(v / 1e6, 2) for v in old], "now x %.2f-%.2f y %.2f-%.2f" % (slot_a, slot_b, header_y + 13.5, header_y + 36.5))
print("Pi body x %.2f-%.2f y %.2f-%.2f" % (x_a, x_b, header_y - 3.5, header_y - 3.5 + 56))

# ---- 4. hub crystal out of the slot, unfitted 22p pads gone
for ref in ("C89", "C90"):
    fp = b.FindFootprintByReference(ref)
    if fp:
        b.Remove(fp); _KEEP.append(fp)
y = b.FindFootprintByReference("Y_HUB")
y.SetOrientationDegrees(0)
y.SetPosition(pcbnew.VECTOR2I(mm(design.Y_HUB_AT[0]), mm(design.Y_HUB_AT[1])))
print("Y_HUB ->", design.Y_HUB_AT)

# ---- 5. rip what must be redone
hdr = j1.GetBoundingBox(False, False)
hdr.Inflate(mm(1.0))
ripped = {}
for t in list(b.GetTracks()):
    hit = t.GetNetname() in ("HUB_XI", "HUB_XO")
    if not hit and t.GetWidth() < mm(0.8):
        if t.GetClass() == "PCB_VIA":
            hit = hdr.Contains(t.GetPosition())
        else:
            hit = hdr.Contains(t.GetStart()) or hdr.Contains(t.GetEnd())
    if hit:
        ripped[t.GetNetname()] = ripped.get(t.GetNetname(), 0) + 1
        b.Remove(t); _KEEP.append(t)
print("ripped at the header / crystal:", sum(ripped.values()), "items on", len(ripped), "nets")
for z in list(b.Zones()):
    if z.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu):
        b.Remove(z); _KEEP.append(z)
pcbnew.SaveBoard(DST, b)
print("saved", DST)
