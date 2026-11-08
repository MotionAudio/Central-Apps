#!/usr/bin/python3
"""Put one GND via into every filled island of the outer ground pours that has no via of its own (an island that only
touches SMD pads is copper that floats off the ground plane).  Then refill and report DRC."""
import os
import re
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, fanout  # noqa: E402

P = sys.argv[1] if len(sys.argv) > 1 else "%s/%s-routed.kicad_pcb" % (build.OUT, build.NAME)
b = pcbnew.LoadBoard(P)
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
gnd = b.FindNet("GND")
vias = [(t.GetPosition().x, t.GetPosition().y) for t in b.GetTracks() if t.GetClass() == "PCB_VIA" and t.GetNetCode() == gnd.GetNetCode()]
chk = fanout.Checker(b)
cuts = [tuple(v / 1e6 for v in c) for c in build.inner_cutouts(b)]
added = 0
for z in list(b.Zones()):
    if z.GetLayer() not in (pcbnew.F_Cu, pcbnew.B_Cu) or z.GetNetCode() != gnd.GetNetCode():
        continue
    polys = z.GetFilledPolysList(z.GetLayer())
    for i in range(polys.OutlineCount()):
        ol = polys.Outline(i)
        bb = ol.BBox()
        if any(bb.Contains(pcbnew.VECTOR2I(x, y)) and ol.PointInside(pcbnew.VECTOR2I(x, y)) for (x, y) in vias):
            continue
        if ol.Area() / 1e12 < 0.6:
            continue                     # slivers: nothing fits anyway (they stay as copper islands)
        placed = False
        step = mm(0.25)
        y = bb.GetTop() + step
        while y < bb.GetBottom() and not placed:
            x = bb.GetLeft() + step
            while x < bb.GetRight():
                pt = pcbnew.VECTOR2I(x, y)
                if ol.PointInside(pt) and not any(c[0] - 1.0 <= x / 1e6 <= c[2] + 1.0 and c[1] - 1.0 <= y / 1e6 <= c[3] + 1.0 for c in cuts):
                    via = pcbnew.PCB_VIA(b)
                    via.SetPosition(pt)
                    via.SetViaType(pcbnew.VIATYPE_THROUGH)
                    via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                    via.SetWidth(mm(0.5)); via.SetDrill(mm(0.25))
                    via.SetNet(gnd)
                    if chk.clear(via.GetEffectiveShape(pcbnew.F_Cu), via.GetBoundingBox(), gnd.GetNetCode(), set(fanout.COPPER), mm(0.2)):
                        b.Add(via); chk.add(via); vias.append((x, y)); added += 1; placed = True
                        print("  via for %s island at (%.1f, %.1f) [island %.1f mm2]" % (b.GetLayerName(z.GetLayer()), x / 1e6, y / 1e6, ol.Area() / 1e12))
                        break
                x += step
            y += step
        if not placed:
            print("  no room in %s island bbox x %.1f-%.1f y %.1f-%.1f (%.1f mm2)" % (b.GetLayerName(z.GetLayer()), bb.GetLeft() / 1e6, bb.GetRight() / 1e6, bb.GetTop() / 1e6, bb.GetBottom() / 1e6, ol.Area() / 1e12))
print("vias added:", added)
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard(P, b)
rep, counts = fanout.drc(b, "%s/drc-report.txt" % build.OUT)
print("DRC:", counts)
for m in re.finditer(r"\[unconnected_items\].*?\n.*?\n\s*(@.*?)\n\s*(@.*?)\n", rep):
    print("  ", m.group(1)[:85], "|", m.group(2)[:85])
