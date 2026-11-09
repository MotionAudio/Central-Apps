#!/usr/bin/python3
"""Rev B.4: widen the routed rev B.3 board from 390 to 509 mm so the footswitches sit 65 mm apart (centre to centre,
like a Morningstar MC8; they were 48 mm), without re-routing the whole board.

How:
  - two vertical seams that cross no pad, x = 65.0 (between the left knob cluster's two columns) and x = 302.25 (just
    left of the right knob cluster).  Everything right of a seam moves right 59.5 mm, so the screens / Pi / audio
    block end up centred and the right cluster lands at the mirror of the left one.  Wide power tracks crossing a seam
    get a straight horizontal bridge; narrow tracks crossing a seam are ripped (the router redoes them).
  - the knob-cluster parts that sit on the wrong side of a seam (encoders 2 + 3 with their filters on the left,
    label screens K4 / K5 with their links on the right) move with their cluster; their tracks are ripped.
  - the footswitch strip is re-spaced: switch i (front row) goes to x = 27 + 65 i, with its light, label screen, links
    and filter parts; the two upper corner switches move up 16 mm (70 mm from the front row); the M3 holes between
    the switches go to the new midpoints.  All tracks in the strip are ripped.
  - zones, outline and drawings follow the seams; the title is updated later by touchup.

    python3 stretch.py SRC.kicad_pcb OUT.kicad_pcb
"""
import os
import shutil
import sys

import pcbnew
from pcbnew import FromMM as mm

S1, S2, D = 65.0, 302.25, 55.0
W0, W1 = 390.0, 500.0
PITCH0, PITCH1, X0 = 48.0, (500.0 - 2 * 27.0) / 7, 27.0
CORNER_DY = -16.0
# knob clusters and faders, evenly spaced (user's request): case edge (x = -5) - fader - knob cluster - 7in window edge,
# equal steps.  Window edge = board centre - 78.5.
_S = W1 / 2 - 78.5
_F = max((2 * -5.0 + _S) / 3, 55.0)   # fader centre (55 rather than 53.8: its label screen's pins then clear the VBUS trunk at x 36)
_K = (_F + _S) / 2                  # knob cluster centre (between knob 1 and knobs 2 / 3)
DXF, DXK = _F - 27.0, _K - 66.0     # from the rev B.3 positions (fader 27, knobs 52 / 80)
R = lambda pre, a, b: ["%s%d" % (pre, i) for i in range(a, b + 1)]
LEFT_FADER = ["RV_A", "OLED_A", "R175", "C165", "C166"] + R("R", 176, 179)
LEFT_KNOBS = ["ENC1", "ENC2", "ENC3", "OLED_K1", "OLED_K2", "OLED_K3", "C144", "C148", "C152"] + R("R", 133, 153) + R("C", 141, 143) \
    + R("C", 145, 147) + R("C", 149, 151)
UPD = ["U_PD", "C3"] + R("R", 8, 12)          # USB-PD sink parts that sat where the fader goes: 22 mm right
RIGHT_FADER = ["RV_B", "OLED_B", "R180", "C167", "C168"] + R("R", 181, 184)
RIGHT_KNOBS = ["ENC4", "ENC5", "ENC6", "OLED_K4", "OLED_K5", "OLED_K6", "C156", "C160", "C164"] + R("R", 154, 174) \
    + R("C", 153, 155) + R("C", 157, 159) + R("C", 161, 163)
GROUP_DX = {}
for r in LEFT_FADER: GROUP_DX[r] = DXF
for r in LEFT_KNOBS: GROUP_DX[r] = DXK
for r in UPD: GROUP_DX[r] = 22.0
for r in RIGHT_FADER: GROUP_DX[r] = 2 * D - DXF
for r in RIGHT_KNOBS: GROUP_DX[r] = 2 * D - DXK
_KEEP = []


def fx(x):
    return x + (D if x > S1 else 0.0) + (D if x > S2 else 0.0)


def strip(x, y):
    return y > 224.0


def corner_l(x, y):
    return x < 52.0 and 168.0 < y <= 224.0


def corner_r(x, y):
    return x > 336.0 and 168.0 < y <= 224.0


def enc_l(x, y):          # encoders 2 / 3 and their filters: right of seam 1 but part of the left cluster
    return S1 < x < 87.5 and (40.0 < y < 72.5 or 106.0 < y < 132.5)


def rcl(x, y):            # label screens K4 / K5 and their links: left of seam 2 but part of the right cluster
    return 286.0 < x < S2 and 20.0 < y < 140.0


def cluster_l(x, y):      # left fader + knob cluster + the USB-PD parts among them (all re-placed)
    return x < 87.5 and 20.0 < y < 135.0


def cluster_r(x, y):
    return x > 286.0 and 20.0 < y < 135.0


def ripzone(x, y):
    return strip(x, y) or corner_l(x, y) or corner_r(x, y) or cluster_l(x, y) or cluster_r(x, y)


def mmxy(v):
    return v.x / 1e6, v.y / 1e6


def V(x, y):
    return pcbnew.VECTOR2I(mm(x), mm(y))


def main(src, out):
    b = pcbnew.LoadBoard(src)
    # ---------------------------------------------------------------- tracks: rip, bridge, shift
    ripped = bridged = moved = 0
    for t in list(b.GetTracks()):
        if t.GetClass() == "PCB_VIA":
            x, y = mmxy(t.GetPosition())
            if ripzone(x, y) and not ((cluster_l(x, y) or cluster_r(x, y)) and t.GetWidth() >= mm(1.0)):
                b.Remove(t); _KEEP.append(t); ripped += 1
            else:
                t.SetPosition(V(fx(x), y)); moved += 1
            continue
        (ax, ay), (cx, cy) = mmxy(t.GetStart()), mmxy(t.GetEnd())
        crosses = [s for s in (S1, S2) if (ax - s) * (cx - s) < 0]
        hard = any(strip(*p) or corner_l(*p) or corner_r(*p) for p in ((ax, ay), (cx, cy)))
        soft = any(cluster_l(*p) or cluster_r(*p) for p in ((ax, ay), (cx, cy)))
        if hard or (soft and t.GetWidth() < mm(1.0)) or (crosses and t.GetWidth() < mm(1.0)):
            b.Remove(t); _KEEP.append(t); ripped += 1
            continue
        if not crosses:
            t.SetStart(V(fx(ax), ay)); t.SetEnd(V(fx(cx), cy)); moved += 1
            continue
        # wide track over a seam: split at the seam(s), shift the pieces, join them with horizontal bridges
        pts = [(ax, ay)]
        for s in sorted(crosses, key=lambda s: abs(s - ax)):
            yy = ay + (cy - ay) * (s - ax) / (cx - ax)
            pts.append((s, yy))
        pts.append((cx, cy))
        segs = []
        for (p, q) in zip(pts, pts[1:]):
            mx = (p[0] + q[0]) / 2.0
            sh = fx(mx) - mx
            segs.append(((p[0] + sh, p[1]), (q[0] + sh, q[1])))
        chain = []
        for k, (p, q) in enumerate(segs):
            chain.append((p, q))
            if k + 1 < len(segs):
                chain.append((q, segs[k + 1][0]))          # bridge (horizontal)
        t.SetStart(V(*chain[0][0])); t.SetEnd(V(*chain[0][1]))
        for (p, q) in chain[1:]:
            n = pcbnew.PCB_TRACK(b)
            n.SetStart(V(*p)); n.SetEnd(V(*q)); n.SetWidth(t.GetWidth()); n.SetLayer(t.GetLayer()); n.SetNet(t.GetNet())
            n.SetLocked(t.IsLocked())
            b.Add(n)
        bridged += 1
    print("tracks/vias: ripped %d, shifted %d, bridged %d" % (ripped, moved, bridged))

    # ---------------------------------------------------------------- footprints
    log = {}
    for f in b.GetFootprints():
        ref = f.GetReference()
        x, y = mmxy(f.GetPosition())
        pads = list(f.Pads())
        px = sum(p.GetPosition().x for p in pads) / len(pads) / 1e6 if pads else x
        dx, dy = fx(px) - px, 0.0
        why = "seam"
        if ref in GROUP_DX:
            dx, why = GROUP_DX[ref], "cluster"
        elif ref in ("H11", "H12", "H13", "H14", "H15", "H16", "H17"):
            k = int(ref[1:]) - 11
            dx, why = (X0 + PITCH1 / 2 + PITCH1 * k) - x, "hole"
        elif ref in ("H3",):
            dx, why = 0.0, "hole"
        elif ref in ("H4",):
            dx, why = 2 * D, "hole"
        elif strip(px, y):
            i = max(0, min(7, int((px - X0 + PITCH0 / 2) // PITCH0)))
            dx, why = (X0 + PITCH1 * i) - (X0 + PITCH0 * i), "fs%d" % (i + 1)
        elif corner_l(px, y):
            dx, dy, why = 0.0, CORNER_DY, "corner-L"
        elif corner_r(px, y):
            dx, dy, why = 2 * D, CORNER_DY, "corner-R"
        elif enc_l(px, y):
            dx, why = 0.0, "left-cluster"
        elif rcl(px, y):
            dx, why = 2 * D, "right-cluster"
        if dx or dy:
            f.SetPosition(V(x + dx, y + dy))
        log.setdefault(why, []).append(ref)
    for k in sorted(log):
        if k != "seam":
            print("  %-14s %s" % (k, " ".join(sorted(log[k]))))

    # ---------------------------------------------------------------- zones
    for z in b.Zones():
        poly = z.Outline()
        for i in range(poly.TotalVertices()):
            v = poly.CVertex(i)
            poly.SetVertex(i, V(fx(v.x / 1e6), v.y / 1e6))
        z.UnFill()

    # ---------------------------------------------------------------- drawings (outline, silk, fab)
    def shift_for(cx, cy, bb):
        # the bar-screen outline (silk rectangle 51.35 .. 338.65 x 158 .. 228) moves with the screen as one piece
        if bb[0] >= 51.0 and bb[1] <= 339.0 and bb[2] >= 157.5 and bb[3] <= 228.5:
            return D, 0.0
        if cluster_l(cx, cy):
            return (DXF if cx < 40 else DXK), 0.0
        if cluster_r(cx, cy):
            return (2 * D - DXF if cx > 350 else 2 * D - DXK), 0.0
        if strip(cx, cy):
            i = max(0, min(7, int((cx - X0 + PITCH0 / 2) // PITCH0)))
            return (X0 + PITCH1 * i) - (X0 + PITCH0 * i), 0.0
        if corner_l(cx, cy):
            return 0.0, CORNER_DY
        if corner_r(cx, cy):
            return 2 * D, CORNER_DY
        return fx(cx) - cx, 0.0

    for d in list(b.GetDrawings()):
        bbx = d.GetBoundingBox()
        bb = (bbx.GetLeft() / 1e6, bbx.GetRight() / 1e6, bbx.GetTop() / 1e6, bbx.GetBottom() / 1e6)
        w = bb[1] - bb[0]
        if d.GetClass() == "PCB_SHAPE" and d.GetShape() in (pcbnew.SHAPE_T_SEGMENT, pcbnew.SHAPE_T_RECT) and \
                (d.GetLayer() == pcbnew.Edge_Cuts and w > 300 or w > 300):
            (ax, ay), (cx, cy) = mmxy(d.GetStart()), mmxy(d.GetEnd())       # board-wide: stretch
            d.SetStart(V(fx(ax), ay)); d.SetEnd(V(fx(cx), cy))
            continue
        if d.GetClass() in ("PCB_TEXT", "PCB_TEXTBOX"):
            cx, cy = mmxy(d.GetPosition())
        else:
            cx, cy = (bb[0] + bb[1]) / 2, (bb[2] + bb[3]) / 2
        dx, dy = shift_for(cx, cy, bb)
        if dx or dy:
            d.Move(V(dx, dy))

    pcbnew.SaveBoard(out, b)
    pro = os.path.splitext(src)[0] + ".kicad_pro"
    if os.path.exists(pro):
        shutil.copy(pro, os.path.splitext(out)[0] + ".kicad_pro")
    print("saved", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
