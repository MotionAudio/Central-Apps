#!/bin/bash
# rev B.4: widen the finished rev B.3 board to 500 mm and route what the widening opened up

cd /home/claude/pcb2
python3 stretch.py out/routed-rev-b3-final.kicad_pcb out/stretch-src.kicad_pcb 2>&1 | grep -v leak; test -f out/stretch-src.kicad_pcb || exit 1
python3 - <<'EOF' 2>&1 | grep -v leak
import pcbnew
b = pcbnew.LoadBoard("out/stretch-src.kicad_pcb")
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard("out/central-pedal-main-board-routed.kicad_pcb", b)
EOF
cp out/stretch-src.kicad_pro out/central-pedal-main-board-routed.kicad_pro
python3 cleanup.py --no-helpers 2>&1 | grep -v leak | tail -1
python3 cleanup.py --no-helpers 2>&1 | grep -v leak | tail -1
python3 - <<'EOF' 2>&1 | grep -v leak
import pcbnew
b = pcbnew.LoadBoard("out/central-pedal-main-board-routed.kicad_pcb")
for t in b.GetTracks():
    t.SetLocked(True)
pcbnew.SaveBoard("out/pass9-src.kicad_pcb", b)
print("locked", len(b.GetTracks()))
EOF
cp out/central-pedal-main-board-routed.kicad_pro out/pass9-src.kicad_pro
cp out/pass9-src.kicad_pcb out/routed-b4-prestrip.kicad_pcb
python3 route.py 30 out/pass9-src.kicad_pcb --rippable 2>&1 | grep -v leak | grep -v "FloatLine"
