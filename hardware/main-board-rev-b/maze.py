#!/usr/bin/python3
"""Grid maze router for the last few connections the autorouter leaves open.
Reads the DRC report's unconnected items from the routed board, routes each on F.Cu / B.Cu (with vias) on a
0.15 mm grid inside a window around the two items, then fills the zones and reruns DRC."""
import heapq
import math
import os
import re
import sys

import numpy as np
import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design, fanout  # noqa: E402

OUT = build.OUT
NAME = build.NAME
routed = "%s/%s-routed.kicad_pcb" % (OUT, NAME)
STEP = 0.1             # mm grid
TW = 0.2               # track width (the Default net class)
CLR = 0.15             # clearance
VIA_D, VIA_DRILL = 0.5, 0.25
EDGE = 0.5
LAYERS = (pcbnew.F_Cu, pcbnew.B_Cu, pcbnew.In2_Cu)   # In2 (5V1 plane) allowed as a last resort, at a high cost
_KEEP = []   # removed items stay referenced: letting Python free them corrupts the board


def parse_unconnected(report):
    """[(net, itemA, itemB)] where item = ('pad', ref, num) | ('track', x, y, layer) | ('via', x, y)"""
    out = []
    for blk in report.split("\n[")[1:]:
        if not blk.startswith("unconnected_items"):
            continue
        items, net = [], None
        for line in blk.splitlines():
            m = re.search(r"@\(([-\d.]+) mm, ([-\d.]+) mm\): (.*)", line)
            if not m:
                continue
            x, y, what = float(m.group(1)), float(m.group(2)), m.group(3)
            pm = re.match(r"(?:PTH |NPTH )?[Pp]ad (\S+) \[(\w+)\] of (\w+)", what)
            tm = re.match(r"Track \[(\w+)\] on (\S+)", what)
            vm = re.match(r"Via \[(\w+)\]", what)
            if pm:
                net = pm.group(2)
                items.append(("pad", pm.group(3), pm.group(1), x, y))
            elif tm:
                net = tm.group(1)
                items.append(("track", x, y, tm.group(2)))
            elif vm:
                net = vm.group(1)
                items.append(("via", x, y))
        if len(items) == 2 and net:
            out.append((net, items[0], items[1]))
    return out


class Grid:
    def __init__(self, board, x0, y0, x1, y1, netcode):
        self.x0, self.y0 = x0, y0
        self.nx = int((x1 - x0) / STEP) + 1
        self.ny = int((y1 - y0) / STEP) + 1
        self.block = {ly: np.zeros((self.ny, self.nx), dtype=bool) for ly in LAYERS}
        self.via_block = np.zeros((self.ny, self.nx), dtype=bool)
        self.net = netcode
        xs = x0 + np.arange(self.nx) * STEP
        ys = y0 + np.arange(self.ny) * STEP
        self.X, self.Y = np.meshgrid(xs, ys)
        # board edge and slot
        for d in board.GetDrawings():
            if d.GetLayer() != pcbnew.Edge_Cuts:
                continue
            a, b = d.GetStart(), d.GetEnd()
            self._seg_all((a.x / 1e6, a.y / 1e6), (b.x / 1e6, b.y / 1e6), 0, EDGE + TW / 2, via_too=True, via_extra=VIA_D / 2 + EDGE)
        for fp in board.GetFootprints():
            for pad in fp.Pads():
                self._pad(pad)
        for t in board.GetTracks():
            if t.GetClass() == "PCB_VIA":
                self._via_item(t)
            else:
                if t.GetNetCode() == netcode:
                    continue
                a, b = t.GetStart(), t.GetEnd()
                self._seg(t.GetLayer(), (a.x / 1e6, a.y / 1e6), (b.x / 1e6, b.y / 1e6), t.GetWidth() / 2e6)

    def _mark(self, arr, mask):
        arr |= mask

    def _dist_seg(self, a, b):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        if L2 == 0:
            return np.hypot(self.X - ax, self.Y - ay)
        t = np.clip(((self.X - ax) * dx + (self.Y - ay) * dy) / L2, 0, 1)
        return np.hypot(self.X - (ax + t * dx), self.Y - (ay + t * dy))

    def _seg(self, layer, a, b, half):
        if layer not in self.block:
            return
        d = self._dist_seg(a, b)
        self.block[layer] |= d < half + TW / 2 + CLR
        self.via_block |= d < half + VIA_D / 2 + CLR

    def _seg_all(self, a, b, half, extra, via_too=False, via_extra=0):
        d = self._dist_seg(a, b)
        for ly in LAYERS:
            self.block[ly] |= d < half + extra
        if via_too:
            self.via_block |= d < half + via_extra

    def _pad(self, pad):
        p = pad.GetPosition()
        cx, cy = p.x / 1e6, p.y / 1e6
        bb = pad.GetBoundingBox()
        hw, hh = bb.GetWidth() / 2e6, bb.GetHeight() / 2e6
        same = pad.GetNetCode() == self.net
        if pad.GetDrillSizeX() > 0:   # the hole: no via on top of it, whatever the net
            r = max(pad.GetDrillSizeX(), pad.GetDrillSizeY()) / 2e6
            d = np.hypot(self.X - cx, self.Y - cy)
            self.via_block |= d < r + VIA_DRILL / 2 + 0.3
        if same:
            return
        if pad.GetShape() == pcbnew.PAD_SHAPE_CUSTOM:
            # an L-shaped corner pin (BQ25798): its box would wall in the pins beside it - test the real outline
            shp = pad.GetEffectiveShape(pcbnew.F_Cu if pad.IsOnLayer(pcbnew.F_Cu) else pcbnew.B_Cu)
            i0, j0 = self.cell(cx - hw - 1.0, cy - hh - 1.0)
            i1, j1 = self.cell(cx + hw + 1.0, cy + hh + 1.0)
            for j in range(max(0, j0), min(self.ny, j1 + 1)):
                for i in range(max(0, i0), min(self.nx, i1 + 1)):
                    pt = pcbnew.VECTOR2I(mm(self.x0 + i * STEP), mm(self.y0 + j * STEP))
                    if shp.Collide(pt, mm(TW / 2 + CLR)):
                        for ly in LAYERS:
                            if pad.IsOnLayer(ly):
                                self.block[ly][j, i] = True
                    if shp.Collide(pt, mm(VIA_D / 2 + CLR)):
                        self.via_block[j, i] = True
            return
        # rectangle inflated (conservative for round / rotated pads)
        inx = np.abs(self.X - cx) < hw + TW / 2 + CLR
        iny = np.abs(self.Y - cy) < hh + TW / 2 + CLR
        for ly in LAYERS:
            if pad.IsOnLayer(ly):
                self.block[ly] |= inx & iny
        if any(pad.IsOnLayer(ly) for ly in (pcbnew.F_Cu, pcbnew.B_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu)):
            self.via_block |= (np.abs(self.X - cx) < hw + VIA_D / 2 + CLR) & (np.abs(self.Y - cy) < hh + VIA_D / 2 + CLR)

    def _via_item(self, v):
        p = v.GetPosition()
        cx, cy = p.x / 1e6, p.y / 1e6
        d = np.hypot(self.X - cx, self.Y - cy)
        self.via_block |= d < v.GetDrill() / 2e6 + VIA_DRILL / 2 + 0.3
        if v.GetNetCode() == self.net:
            return
        r = v.GetWidth() / 2e6
        for ly in LAYERS:
            self.block[ly] |= d < r + TW / 2 + CLR
        self.via_block |= d < r + VIA_D / 2 + CLR

    def cell(self, x, y):
        return int(round((x - self.x0) / STEP)), int(round((y - self.y0) / STEP))

    def pos(self, i, j):
        return self.x0 + i * STEP, self.y0 + j * STEP


def item_cells(board, grid, item, netcode):
    """Grid cells (i, j, layer) that count as 'on' this item."""
    cells = []
    if item[0] == "pad":
        fp = board.FindFootprintByReference(item[1])
        pad = fp.FindPadByNumber(item[2])
        bb = pad.GetBoundingBox()
        for ly in LAYERS:
            if not pad.IsOnLayer(ly):
                continue
            shape = pad.GetEffectiveShape(ly)
            i0, j0 = grid.cell(bb.GetLeft() / 1e6, bb.GetTop() / 1e6)
            i1, j1 = grid.cell(bb.GetRight() / 1e6, bb.GetBottom() / 1e6)
            for i in range(max(0, i0), min(grid.nx - 1, i1) + 1):
                for j in range(max(0, j0), min(grid.ny - 1, j1) + 1):
                    x, y = grid.pos(i, j)
                    if shape.Collide(pcbnew.VECTOR2I(mm(x), mm(y)), mm(TW / 2 - 0.02)):
                        cells.append((i, j, ly))
    elif item[0] == "track":
        x, y, lname = item[1], item[2], item[3]
        ly = {"F.Cu": pcbnew.F_Cu, "B.Cu": pcbnew.B_Cu}.get(lname)
        for t in board.GetTracks():
            if t.GetClass() != "PCB_TRACK" or t.GetNetCode() != netcode or (ly is not None and t.GetLayer() != ly):
                continue
            seg = pcbnew.SHAPE_SEGMENT(t.GetStart(), t.GetEnd(), t.GetWidth())
            if seg.Collide(pcbnew.VECTOR2I(mm(x), mm(y)), mm(0.05)):
                a, b = t.GetStart(), t.GetEnd()
                n = max(1, int(math.hypot(b.x - a.x, b.y - a.y) / 1e6 / STEP))
                for k in range(n + 1):
                    px = (a.x + (b.x - a.x) * k / n) / 1e6
                    py = (a.y + (b.y - a.y) * k / n) / 1e6
                    i, j = grid.cell(px, py)
                    if 0 <= i < grid.nx and 0 <= j < grid.ny:
                        cells.append((i, j, t.GetLayer()))
    elif item[0] == "via":
        i, j = grid.cell(item[1], item[2])
        for ly in LAYERS:
            cells.append((i, j, ly))
    return cells


def route(grid, sources, targets):
    """Dijkstra over (layer, i, j); diagonal moves only when both orthogonal neighbours are free."""
    INF = 1e18
    L = {pcbnew.F_Cu: 0, pcbnew.B_Cu: 1, pcbnew.In2_Cu: 2}
    layers = [pcbnew.F_Cu, pcbnew.B_Cu, pcbnew.In2_Cu]
    stepcost = [1.0, 1.0, 4.0]
    dist = np.full((3, grid.ny, grid.nx), INF)
    prev = {}
    tgt = set((L[ly], i, j) for (i, j, ly) in targets)
    heap = []
    for (i, j, ly) in sources:
        dist[L[ly], j, i] = 0
        heapq.heappush(heap, (0, L[ly], i, j))
    moves = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.42), (1, -1, 1.42), (-1, 1, 1.42), (-1, -1, 1.42)]
    src = set((L[ly], i, j) for (i, j, ly) in sources)
    while heap:
        d, l, i, j = heapq.heappop(heap)
        if d > dist[l, j, i]:
            continue
        if (l, i, j) in tgt:
            path = [(l, i, j)]
            while (l, i, j) in prev:
                l, i, j = prev[(l, i, j)]
                path.append((l, i, j))
            return path[::-1]
        blk = grid.block[layers[l]]
        for di, dj, c in moves:
            ni, nj = i + di, j + dj
            if not (0 <= ni < grid.nx and 0 <= nj < grid.ny):
                continue
            if blk[nj, ni] and (l, ni, nj) not in tgt and (l, ni, nj) not in src:
                continue
            if di and dj and (blk[j, ni] or blk[nj, i]):
                continue
            nd = d + c * stepcost[l]
            if nd < dist[l, nj, ni]:
                dist[l, nj, ni] = nd
                prev[(l, ni, nj)] = (l, i, j)
                heapq.heappush(heap, (nd, l, ni, nj))
        # via (through-hole: any layer to any layer)
        if not grid.via_block[j, i]:
            for ol in range(3):
                if ol == l:
                    continue
                if not grid.block[layers[ol]][j, i] or (ol, i, j) in tgt:
                    nd = d + 12.0 + (6.0 if ol == 2 else 0.0)
                    if nd < dist[ol, j, i]:
                        dist[ol, j, i] = nd
                        prev[(ol, i, j)] = (l, i, j)
                        heapq.heappush(heap, (nd, ol, i, j))
    return None


def lay(board, grid, path, net):
    layers = [pcbnew.F_Cu, pcbnew.B_Cu, pcbnew.In2_Cu]
    # split into runs per layer, merge collinear cells
    runs, cur = [], [path[0]]
    for p in path[1:]:
        if p[0] != cur[-1][0]:
            runs.append(cur)
            cur = [p]
        else:
            cur.append(p)
    runs.append(cur)
    n_t = n_v = 0
    for k, run in enumerate(runs):
        pts = [grid.pos(i, j) for (_, i, j) in run]
        simp = [pts[0]]
        for a, b, c in zip(pts, pts[1:], pts[2:]):
            if (b[0] - a[0], b[1] - a[1]) != (c[0] - b[0], c[1] - b[1]):
                simp.append(b)
        if len(pts) > 1:
            simp.append(pts[-1])
        for a, b in zip(simp, simp[1:]):
            t = pcbnew.PCB_TRACK(board)
            t.SetStart(pcbnew.VECTOR2I(mm(a[0]), mm(a[1])))
            t.SetEnd(pcbnew.VECTOR2I(mm(b[0]), mm(b[1])))
            t.SetWidth(mm(TW))
            t.SetLayer(layers[run[0][0]])
            t.SetNet(net)
            board.Add(t)
            n_t += 1
        if k + 1 < len(runs):
            x, y = grid.pos(run[-1][1], run[-1][2])
            v = pcbnew.PCB_VIA(board)
            v.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
            v.SetViaType(pcbnew.VIATYPE_THROUGH)
            v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
            v.SetWidth(mm(VIA_D))
            v.SetDrill(mm(VIA_DRILL))
            v.SetNet(net)
            board.Add(v)
            n_v += 1
    return n_t, n_v


def rip_corridor(board, ref, num, length=3.0):
    """Remove other nets' tracks from the strip in front of a pad (outward from its part), so it can escape."""
    fp = board.FindFootprintByReference(ref)
    pad = fp.FindPadByNumber(num)
    c, p = fp.GetPosition(), pad.GetPosition()
    ang = math.atan2(p.y - c.y, p.x - c.x)
    ang = round(ang / (math.pi / 2)) * (math.pi / 2)        # snap to the pin row's normal
    half = min(pad.GetSize().x, pad.GetSize().y) / 2e6 + CLR + TW / 2
    far = pcbnew.VECTOR2I(int(p.x + length * 1e6 * math.cos(ang)), int(p.y + length * 1e6 * math.sin(ang)))
    corridor = pcbnew.SHAPE_SEGMENT(p, far, mm(2 * half))
    ripped = set()
    for t in list(board.GetTracks()):
        if t.GetClass() != "PCB_TRACK" or t.GetNetCode() == pad.GetNetCode() or t.GetWidth() == mm(0.21) or t.GetWidth() >= mm(0.8):
            continue          # (wide = a hand-routed power trunk: never rip those)
        if t.GetEffectiveShape(t.GetLayer()).Collide(corridor, 0):
            ripped.add(t.GetNetname())
            _KEEP.append(t)
            board.Remove(t)
    return sorted(ripped)


def main():
    board = pcbnew.LoadBoard(routed)
    rep, counts = fanout.drc(board, "%s/drc-report.txt" % OUT)
    todo = parse_unconnected(rep)
    print("open connections:", len(todo), flush=True)
    if "--rip" in sys.argv:          # --rip REF PAD : clear the strip in front of that pad first
        i = sys.argv.index("--rip")
        print("ripped nets:", rip_corridor(board, sys.argv[i + 1], sys.argv[i + 2]))
        pcbnew.SaveBoard(routed, board)
        raise SystemExit(0)      # (route in a fresh process: removing items and going on corrupts the board object)
    first = sys.argv[sys.argv.index("--first") + 1].split(",") if "--first" in sys.argv else []
    todo.sort(key=lambda e: (e[0] not in first, first.index(e[0]) if e[0] in first else 0))
    done = 0
    for net, a, b in todo:
        ni = board.FindNet(net)
        pts = [(a[3], a[4]) if a[0] == "pad" else (a[1], a[2]), (b[3], b[4]) if b[0] == "pad" else (b[1], b[2])]
        margin = float(sys.argv[sys.argv.index("--margin") + 1]) if "--margin" in sys.argv else 10.0
        x0 = max(0.0, min(p[0] for p in pts) - margin)
        x1 = min(design.W, max(p[0] for p in pts) + margin)
        y0 = max(0.0, min(p[1] for p in pts) - margin)
        y1 = min(design.H, max(p[1] for p in pts) + margin)
        grid = Grid(board, x0, y0, x1, y1, ni.GetNetCode())
        grid.block[pcbnew.In2_Cu][:] = True      # rev B: In2 is the 5V1 / 5V2 plane pair - never cut it
        S = item_cells(board, grid, a, ni.GetNetCode())
        T = item_cells(board, grid, b, ni.GetNetCode())
        if not S or not T:
            print("  %s: no cells for %s / %s" % (net, a, b))
            continue
        path = route(grid, S, T)
        if path is None:
            print("  %s: NO PATH %s -> %s" % (net, a[:3], b[:3]), flush=True)
            continue
        n_t, n_v = lay(board, grid, path, ni)
        done += 1
        print("  %s: routed %s -> %s (%d segments, %d vias)" % (net, a[:3], b[:3], n_t, n_v), flush=True)
        pcbnew.SaveBoard(routed, board)          # keep what is done so far (a long run may be cut short)
    filler = pcbnew.ZONE_FILLER(board)
    filler.Fill(board.Zones())
    pcbnew.SaveBoard(routed, board)
    rep, counts = fanout.drc(board, "%s/drc-report.txt" % OUT)
    print("routed", done, "of", len(todo), "- DRC:", counts)


if __name__ == "__main__":
    main()
