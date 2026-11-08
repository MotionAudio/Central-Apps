#!/usr/bin/python3
"""Rev B.3 finishing touches on the routed board: the fan moved to the base floor, so its four M3 holes and the
back-silk outline come off; the title silk says rev B.3.  Refills the zones and saves in place.

    python3 touchup.py [board]
"""
import os
import sys

import pcbnew

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402

routed = sys.argv[1] if len(sys.argv) > 1 else "%s/%s-routed.kicad_pcb" % (build.OUT, build.NAME)
_KEEP = []
FAN_AT = (116.0, 116.0)

b = pcbnew.LoadBoard(routed)
gone = []
for fp in list(b.GetFootprints()):
    if fp.GetReference().startswith("HFAN_"):
        gone.append(fp.GetReference()); _KEEP.append(fp); b.Remove(fp)
for d in list(b.GetDrawings()):
    if d.GetLayer() != pcbnew.B_SilkS:
        continue
    if d.GetClass() == "PCB_TEXT" and ("40mm FAN" in d.GetText() or "floor grille" in d.GetText()):
        gone.append(d.GetText()); _KEEP.append(d); b.Remove(d)
    elif d.GetClass() == "PCB_SHAPE":
        bb = d.GetBoundingBox()
        if abs(bb.GetLeft() / 1e6 - (FAN_AT[0] - 20)) < 0.3 and abs(bb.GetRight() / 1e6 - (FAN_AT[0] + 20)) < 0.3 \
                and FAN_AT[1] - 20.3 <= bb.GetTop() / 1e6 and bb.GetBottom() / 1e6 <= FAN_AT[1] + 20.3:
            gone.append("fan outline"); _KEEP.append(d); b.Remove(d)
for d in b.GetDrawings():
    if d.GetClass() == "PCB_TEXT" and d.GetText().startswith("CENTRAL PEDAL MAIN BOARD"):
        d.SetText("CENTRAL PEDAL MAIN BOARD  rev B.3")
build.add_text(b, "fan + Raspberry Pi mount in the base, below", FAN_AT[0], FAN_AT[1], 1.0, pcbnew.B_SilkS)
filler = pcbnew.ZONE_FILLER(b)
filler.Fill(b.Zones())
pcbnew.SaveBoard(routed, b)
print("removed:", gone)
