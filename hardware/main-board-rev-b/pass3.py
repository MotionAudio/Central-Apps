#!/usr/bin/python3
"""Pass-3 source: lock the hand-routed copper (trunks, plane stubs, pin joins, their vias) so Freerouting keeps it,
leave every signal route rippable, drop the outer GND pours (route.py pours them again)."""
import os, sys
import pcbnew
from pcbnew import FromMM as mm
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402
OUT = build.OUT; NAME = build.NAME
src = sys.argv[1] if len(sys.argv) > 1 else "%s/%s-routed.kicad_pcb" % (OUT, NAME)
dst = sys.argv[2] if len(sys.argv) > 2 else "%s/pass3-src.kicad_pcb" % OUT
b = pcbnew.LoadBoard(src)
locked = 0
for t in b.GetTracks():
    if t.GetClass() == "PCB_VIA":
        lock = t.GetWidth() >= mm(0.79)          # plane stubs, trunk vias, helper vias (signal vias are 0.5 / 0.6)
    else:
        w = t.GetWidth()
        lock = w >= mm(0.29) or abs(w - mm(0.22)) < 1000
    t.SetLocked(lock)
    locked += lock
_keep = []
for z in list(b.Zones()):
    if z.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu):
        b.Remove(z); _keep.append(z)
pcbnew.SaveBoard(dst, b)
print("locked", locked, "of", len(b.GetTracks()), "->", dst)
