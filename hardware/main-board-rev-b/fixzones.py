#!/usr/bin/python3
"""In2 planes as finally decided: 5V1 base + a 5V2 region y >= 156; the VSYS / VBAT / 3V3 zones (never used by the
fan-out, routed as tracks) are removed.  usage: fixzones.py BOARD [OUT]"""
import sys
import pcbnew
from pcbnew import FromMM as mm
sys.path.insert(0, "/home/claude/pcb2")
import design

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else src
board = pcbnew.LoadBoard(src)
removed, fixed = [], 0
for z in list(board.Zones()):
    if not z.IsOnLayer(pcbnew.In2_Cu):
        continue
    net = z.GetNetname()
    if net in ("VSYS", "VBAT", "3V3"):
        board.Remove(z)
        removed.append(net)
    elif net == "5V2":
        pts = pcbnew.SHAPE_POLY_SET()
        pts.NewOutline()
        for x, y in ((0, 156), (design.W, 156), (design.W, design.H), (0, design.H)):
            pts.Append(mm(x), mm(y))
        z.SetOutline(pts)
        z.SetAssignedPriority(1)
        fixed += 1
print("removed In2 zones:", removed, " 5V2 region reset:", fixed)
pcbnew.SaveBoard(dst, board)
