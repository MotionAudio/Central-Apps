#!/bin/bash
# rev B.4 after routing: tidy, finish the last connections, ground stitching, designators, drills, title, DRC
cd /home/claude/pcb2
f() { grep -v "memory leak" || true; }
python3 cleanup.py --no-helpers 2>&1 | f | tail -1
MAZE_VIA=60 MAZE_W=1.4 python3 -u maze.py --margin 10 2>&1 | f
python3 cleanup.py --no-helpers 2>&1 | f | tail -1
python3 fanout.py --stitch 2>&1 | f | tail -3
python3 islandvias.py 2>&1 | f | tail -1
python3 fixrefs.py 2>&1 | f | tail -2
python3 upsizevias.py 2>&1 | f | tail -1
python3 - <<'EOF' 2>&1 | f
import sys
sys.path.insert(0, ".")
import pcbnew, fanout, build
b = pcbnew.LoadBoard("out/central-pedal-main-board-routed.kicad_pcb")
for d in b.GetDrawings():
    if d.GetClass() == "PCB_TEXT" and d.GetText().startswith("CENTRAL PEDAL MAIN BOARD"):
        d.SetText("CENTRAL PEDAL MAIN BOARD  rev B.4")
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard("out/central-pedal-main-board-routed.kicad_pcb", b)
rep, counts = fanout.drc(b, "%s/drc-report.txt" % build.OUT)
print("FINAL DRC:", counts, "| errors:", rep.count("Severity: error"))
EOF
