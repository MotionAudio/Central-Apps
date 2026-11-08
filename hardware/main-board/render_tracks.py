#!/usr/bin/python3
"""Render the routed board with the copper pours hidden, so tracks and vias can be checked by eye."""
import subprocess, sys, pcbnew
src, prefix = sys.argv[1], sys.argv[2]
b = pcbnew.LoadBoard(src)
for z in list(b.Zones()):
    if z.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu):
        b.Remove(z)
tmp = "/tmp/tracks-only.kicad_pcb"
pcbnew.SaveBoard(tmp, b)
for name, layers, extra in (("front", "F.Cu,F.SilkS,Edge.Cuts", []), ("back", "B.Cu,B.SilkS,Edge.Cuts", ["--mirror"])):
    svg = "%s-%s-tracks.svg" % (prefix, name)
    subprocess.run(["kicad-cli", "pcb", "export", "svg", "--layers", layers, "--page-size-mode", "2", "--exclude-drawing-sheet", "-o", svg, tmp] + extra, check=True, capture_output=True)
    subprocess.run(["rsvg-convert", "-w", "3600", "-b", "white", svg, "-o", "%s-%s-tracks.png" % (prefix, name)], check=True)
print("ok")
