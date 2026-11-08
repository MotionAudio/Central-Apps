#!/bin/bash
cd /home/claude/pcb; P=/usr/bin/python3
$P route.py 16 > out/route.log 2>&1
grep -E "DRC:|unconnected:|freerouting exit" out/route.log
cp out/central-pedal-main-board-routed.kicad_pcb out/routed-backup.kicad_pcb
$P fanout.py 2>&1 | grep -v leak | cut -c1-500
# second pass for whatever the first missed (with the fan-out vias in place), then the final finish
$P - <<'PY' 2>&1 | grep -v leak
import pcbnew
b = pcbnew.LoadBoard("/home/claude/pcb/out/central-pedal-main-board-routed.kicad_pcb")
for z in list(b.Zones()):
    if z.GetLayer() in (pcbnew.F_Cu, pcbnew.B_Cu): b.Remove(z)
pcbnew.SaveBoard("/home/claude/pcb/out/pass2-src.kicad_pcb", b)
PY
timeout 1500 $P route.py 6 out/pass2-src.kicad_pcb --no-prefan > out/route2.log 2>&1
grep -E "DRC:|unconnected:|freerouting exit" out/route2.log
$P fanout.py --stitch 2>&1 | grep -v leak | cut -c1-600
echo PIPELINE-DONE
