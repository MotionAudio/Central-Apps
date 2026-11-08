#!/usr/bin/python3
"""Cheaper drilling: turn every 0.5 / 0.25 mm via into a 0.6 / 0.3 mm one wherever it still clears everything
(0.3 mm is the smallest hole most fabs drill at no extra cost).  Upsizes them all, runs DRC, puts back the ones that
then show up in a clearance error, and repeats until DRC is clean.

    python3 upsizevias.py [board]
"""
import os
import re
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, fanout  # noqa: E402

routed = sys.argv[1] if len(sys.argv) > 1 else "%s/%s-routed.kicad_pcb" % (build.OUT, build.NAME)
b = pcbnew.LoadBoard(routed)
small = [v for v in b.GetTracks() if v.GetClass() == "PCB_VIA" and v.GetDrill() < mm(0.29)]
print("small vias:", len(small))
for v in small:
    v.SetWidth(mm(0.6)); v.SetDrill(mm(0.3))
keep_small = set()
for rnd in range(4):
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    rep, counts = fanout.drc(b, "%s/drc-report.txt" % build.OUT)
    errs = {k: n for k, n in counts.items() if k in ("clearance", "hole_clearance", "hole_to_hole", "copper_edge_clearance",
                                                    "tracks_crossing", "shorting_items", "via_dangling", "annular_width",
                                                    "unconnected_items", "drill_out_of_range")}
    print("round", rnd, "errors:", errs)
    if not errs:
        break
    # positions mentioned in error blocks
    pts = set()
    for block in rep.split("\n["):
        head = block.split("]", 1)[0]
        if head in errs:
            for x, y in re.findall(r"@\(([-\d.]+) mm, ([-\d.]+) mm\): Via", block):
                pts.add((round(float(x), 3), round(float(y), 3)))
    n = 0
    for v in small:
        p = v.GetPosition()
        if (round(p.x / 1e6, 3), round(p.y / 1e6, 3)) in pts and v.GetDrill() > mm(0.29):
            v.SetWidth(mm(0.5)); v.SetDrill(mm(0.25)); keep_small.add(id(v)); n += 1
    print("  put back to 0.5 / 0.25:", n)
    if n == 0:
        print("errors not caused by the upsized vias - stopping")
        break
pcbnew.SaveBoard(routed, b)
left = sum(1 for v in b.GetTracks() if v.GetClass() == "PCB_VIA" and v.GetDrill() < mm(0.29))
print("vias still 0.25 mm:", left, "| DRC:", counts)
