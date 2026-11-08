#!/bin/bash
set -e; cd /home/claude/pcb; P=/usr/bin/python3
$P - <<'PY' 2>&1 | grep -v leak || true
import pcbnew
b = pcbnew.LoadBoard("/home/claude/pcb/out/central-pedal-main-board-routed.kicad_pcb")
for z in list(b.Zones()):
    if z.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu): b.Remove(z)
# drop dangling stubs the rip-up left behind (tracks of ripped nets not touching anything get re-routed anyway)
pcbnew.SaveBoard("/home/claude/pcb/out/pass2-src.kicad_pcb", b)
PY
$P route.py 8 out/pass2-src.kicad_pcb > out/route2.log 2>&1
grep -E "DRC:|unconnected:|freerouting exit" out/route2.log
cp out/central-pedal-main-board-routed.kicad_pcb out/routed-backup2.kicad_pcb
$P fanout.py --stitch 2>&1 | grep -v leak | cut -c1-700 || true
