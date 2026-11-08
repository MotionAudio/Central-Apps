#!/usr/bin/python3
"""Put back any hand-routed power trunk / via from design.TRUNKS / design.VIAS that is missing from the routed board,
then rip the other-net tracks that now sit in its way (maze.py re-routes them) and report."""
import os
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design, fanout  # noqa: E402

OUT = build.OUT
NAME = build.NAME
routed = "%s/%s-routed.kicad_pcb" % (OUT, NAME)
_KEEP = []
b = pcbnew.LoadBoard(routed)
netinfo = {n.GetNetname(): n for n in b.GetNetsByName().values()}


def has_seg(a, c, layer):
    for t in b.GetTracks():
        if t.GetClass() == "PCB_TRACK" and t.GetLayer() == layer:
            s, e = t.GetStart(), t.GetEnd()
            if (abs(s.x - mm(a[0])) < 1000 and abs(s.y - mm(a[1])) < 1000 and abs(e.x - mm(c[0])) < 1000 and abs(e.y - mm(c[1])) < 1000) or \
               (abs(e.x - mm(a[0])) < 1000 and abs(e.y - mm(a[1])) < 1000 and abs(s.x - mm(c[0])) < 1000 and abs(s.y - mm(c[1])) < 1000):
                return True
    return False


def has_via(x, y):
    return any(t.GetClass() == "PCB_VIA" and abs(t.GetPosition().x - mm(x)) < 1000 and abs(t.GetPosition().y - mm(y)) < 1000 for t in b.GetTracks())


added = []
for net, layer, width, pts in design.TRUNKS:
    ly = pcbnew.F_Cu if layer == "F" else pcbnew.B_Cu
    for a, c in zip(pts, pts[1:]):
        if not has_seg(a, c, ly):
            t = pcbnew.PCB_TRACK(b)
            t.SetStart(pcbnew.VECTOR2I(mm(a[0]), mm(a[1])))
            t.SetEnd(pcbnew.VECTOR2I(mm(c[0]), mm(c[1])))
            t.SetWidth(mm(width))
            t.SetLayer(ly)
            t.SetNet(netinfo[net])
            b.Add(t)
            added.append(t)
            print("restored trunk", net, layer, width, a, c)
for net, x, y, dia, drill in design.VIAS:
    if not has_via(x, y):
        v = pcbnew.PCB_VIA(b)
        v.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
        v.SetViaType(pcbnew.VIATYPE_THROUGH)
        v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        v.SetWidth(mm(dia))
        v.SetDrill(mm(drill))
        v.SetNet(netinfo[net])
        b.Add(v)
        added.append(v)
        print("restored via", net, (x, y))

# rip whatever other net now collides with the restored copper
ripped = {}
CLR = mm(0.16)
for item in added:
    shp = item.GetEffectiveShape(item.GetLayer()) if item.GetClass() == "PCB_TRACK" else None
    for t in list(b.GetTracks()):
        if t in added or t.GetNetCode() == item.GetNetCode():
            continue
        hit = False
        if item.GetClass() == "PCB_TRACK":
            if t.GetClass() == "PCB_VIA" or t.GetLayer() == item.GetLayer():
                hit = t.GetEffectiveShape(item.GetLayer()).Collide(shp, CLR)
        else:   # via: both outer layers
            for ly in (pcbnew.F_Cu, pcbnew.B_Cu):
                if t.GetClass() == "PCB_VIA" or t.GetLayer() == ly:
                    if t.GetEffectiveShape(ly).Collide(item.GetEffectiveShape(ly), CLR):
                        hit = True
        if hit:
            ripped.setdefault(t.GetNetname(), 0)
            ripped[t.GetNetname()] += 1
            b.Remove(t)
            _KEEP.append(t)
print("ripped:", ripped)
pcbnew.SaveBoard(routed, b)
print("saved", routed)
