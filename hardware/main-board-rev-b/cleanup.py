#!/usr/bin/python3
"""Tidy the routed board: zero-length segments out, dangling stubs out (repeat until KiCad's DRC reports none),
and - once - a plane via next to the two pads the router could not reach the plane from (TP_5V1 sits in the
5V2 band, D19's 5V2 pad sits above it), so maze.py has a short connection to finish."""
import os
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, fanout  # noqa: E402

OUT = build.OUT
NAME = build.NAME
args = [a for a in sys.argv[1:] if not a.startswith("--")]
routed = args[0] if args else "%s/%s-routed.kicad_pcb" % (OUT, NAME)
_KEEP = []

HELPER_VIAS = [("5V1", 87.0, 153.0), ("5V2", 255.0, 158.5)]


def add_via(board, net, x, y, dia=0.8, drill=0.4):
    v = pcbnew.PCB_VIA(board)
    v.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    v.SetViaType(pcbnew.VIATYPE_THROUGH)
    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    v.SetWidth(mm(dia))
    v.SetDrill(mm(drill))
    v.SetNet(board.FindNet(net))
    board.Add(v)


board = pcbnew.LoadBoard(routed)
n0 = len(board.GetTracks())
# zero-length segments (the router writes a few)
for t in list(board.GetTracks()):
    if t.GetClass() == "PCB_TRACK" and (t.GetEnd() - t.GetStart()).EuclideanNorm() < mm(0.005):
        board.Remove(t)
        _KEEP.append(t)
print("zero-length segments removed:", n0 - len(board.GetTracks()))

if "--no-helpers" not in sys.argv:
    have = {(t.GetNetname(), round(t.GetPosition().x / 1e6, 1), round(t.GetPosition().y / 1e6, 1)) for t in board.GetTracks() if t.GetClass() == "PCB_VIA"}
    for net, x, y in HELPER_VIAS:
        if (net, x, y) not in have:
            add_via(board, net, x, y)
            print("helper via", net, (x, y))

import re
for it in range(6):
    rep, counts = fanout.drc(board, "%s/drc-report.txt" % OUT)
    dang = re.findall(r"\[track_dangling\].*?@\(([-\d.]+) mm, ([-\d.]+) mm\): Track \[(\S+)\] on (\S+), length ([\d.]+) mm", rep, re.S)
    vdang = re.findall(r"\[via_dangling\].*?@\(([-\d.]+) mm, ([-\d.]+) mm\): Via \[(\S+)\]", rep, re.S)
    print("pass %d: dangling tracks %d, dangling vias %d" % (it, len(dang), len(vdang)))
    if not dang and not vdang:
        break
    gone = 0
    for x, y, net, layer, length in dang:
        x, y, length = float(x), float(y), float(length)
        for t in list(board.GetTracks()):
            if t.GetClass() == "PCB_TRACK" and t.GetNetname() == net and board.GetLayerName(t.GetLayer()) == layer and t.GetWidth() < mm(0.8):
                s, e = t.GetStart(), t.GetEnd()
                if abs((e - s).EuclideanNorm() / 1e6 - length) < 0.01 and (
                        abs(s.x / 1e6 - x) < 0.01 and abs(s.y / 1e6 - y) < 0.01 or abs(e.x / 1e6 - x) < 0.01 and abs(e.y / 1e6 - y) < 0.01):
                    board.Remove(t)
                    _KEEP.append(t)
                    gone += 1
                    break
    for x, y, net in vdang:
        x, y = float(x), float(y)
        if any(net == n and abs(x - hx) < 0.01 and abs(y - hy) < 0.01 for n, hx, hy in HELPER_VIAS):
            continue              # the helper vias are dangling until maze.py reaches them
        for t in list(board.GetTracks()):
            if t.GetClass() == "PCB_VIA" and t.GetNetname() == net and abs(t.GetPosition().x / 1e6 - x) < 0.01 and abs(t.GetPosition().y / 1e6 - y) < 0.01:
                board.Remove(t)
                _KEEP.append(t)
                gone += 1
                break
    if not gone:
        break
pcbnew.SaveBoard(routed, board)
print("saved", routed, "tracks+vias:", len(board.GetTracks()))
print("DRC:", counts)
