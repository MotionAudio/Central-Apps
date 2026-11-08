#!/usr/bin/python3
"""Fan-out vias for plane-net pads the autorouter left floating (GND on In1, 5V1 / VBAT on In2),
then stitch the planes, refill, and rerun DRC.  Reads the DRC report to know which pads need one."""
import math
import os
import re
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design  # noqa: E402

OUT = build.OUT
NAME = build.NAME
routed = "%s/%s-routed.kicad_pcb" % (OUT, NAME)
PLANES = {"GND": pcbnew.In1_Cu, "5V1": pcbnew.In2_Cu, "VBAT": pcbnew.In2_Cu}
CLR = mm(0.2)
EDGE = mm(0.5)
COPPER = (pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu)
_KEEP = []   # removed items stay referenced: letting Python free them corrupts the board


def unconnected_pads(report):
    """(ref, pad) pairs named in [unconnected_items] entries, with their net."""
    out = {}
    for blk in report.split("\n[")[1:]:
        if not blk.startswith("unconnected_items"):
            continue
        for m in re.finditer(r"Pad (\S+) \[(\w+)\] of (\w+)", blk):
            out[(m.group(3), m.group(1))] = m.group(2)
    return out


class Checker:
    def __init__(self, board):
        self.board = board
        self.items = []     # (net code, layer set, shape) for copper items
        for fp in board.GetFootprints():
            for pad in fp.Pads():
                for ly in COPPER:
                    if pad.IsOnLayer(ly):
                        self.items.append((pad.GetNetCode(), ly, pad.GetEffectiveShape(ly), pad.GetBoundingBox()))
                if pad.GetDrillSizeX() > 0:     # the hole itself (NPTH holes have no copper at all): keep 0.3 mm from every hole
                    hole = pad.GetEffectiveHoleShape()
                    for ly in COPPER:
                        self.items.append((-99, ly, hole, pad.GetBoundingBox()))
        for t in board.GetTracks():
            if t.GetClass() == "PCB_VIA":
                for ly in COPPER:
                    self.items.append((t.GetNetCode(), ly, t.GetEffectiveShape(ly), t.GetBoundingBox()))
                self.items.append((-99, pcbnew.F_Cu, t.GetEffectiveHoleShape(), t.GetBoundingBox()))   # (no via on a via, same net or not)
            else:
                self.items.append((t.GetNetCode(), t.GetLayer(), t.GetEffectiveShape(t.GetLayer()), t.GetBoundingBox()))
        self.edges = [d for d in board.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts]

    def add(self, item):
        if item.GetClass() == "PCB_VIA":
            for ly in COPPER:
                self.items.append((item.GetNetCode(), ly, item.GetEffectiveShape(ly), item.GetBoundingBox()))
            self.items.append((-99, pcbnew.F_Cu, item.GetEffectiveHoleShape(), item.GetBoundingBox()))
        else:
            self.items.append((item.GetNetCode(), item.GetLayer(), item.GetEffectiveShape(item.GetLayer()), item.GetBoundingBox()))

    def clear(self, shape, bbox, net, layers, clearance=CLR):
        bb = pcbnew.BOX2I(bbox.GetOrigin(), bbox.GetSize())
        bb.Inflate(clearance + mm(0.05))
        for ncode, ly, sh, obb in self.items:
            if ly not in layers or not bb.Intersects(obb):
                continue
            if ncode == net:
                continue
            if sh.Collide(shape, clearance):
                return False
        for e in self.edges:
            if e.GetEffectiveShape(pcbnew.Edge_Cuts).Collide(shape, EDGE):
                return False
        return True


def fanout(board, todo):
    chk = Checker(board)
    placed, failed = 0, []
    for (ref, padnum), netname in sorted(todo.items()):
        fp = board.FindFootprintByReference(ref)
        if fp is None:
            continue
        pad = next((p for p in fp.Pads() if p.GetNumber() == padnum), None)
        if pad is None or netname not in PLANES:
            failed.append((ref, padnum, netname))
            continue
        net = pad.GetNetCode()
        layer = pcbnew.F_Cu if pad.IsOnLayer(pcbnew.F_Cu) else pcbnew.B_Cu
        pos = pad.GetPosition()
        size = pad.GetSize()
        half = max(size.x, size.y) / 2
        fine = min(size.x, size.y) < mm(0.5)          # a QFN / TSSOP pin: leave its neighbours an escape lane
        sizes = [(mm(0.6), mm(0.3)), (mm(0.5), mm(0.25))] if netname == "GND" else [(mm(0.8), mm(0.4)), (mm(0.6), mm(0.3)), (mm(0.5), mm(0.25))]
        if fine:
            sizes = [(mm(0.5), mm(0.25))]
        # try directions pointing away from the part's centre first
        c = fp.GetPosition()
        out_ang = math.atan2(pos.y - c.y, pos.x - c.x)
        order = sorted(range(16), key=lambda k: abs(math.atan2(math.sin(k * math.pi / 8 - out_ang), math.cos(k * math.pi / 8 - out_ang))))
        done = False
        # a fine pin on a package with no exposed pad: first try a via UNDER the package (between the pin rows),
        # reached by a stub running inward from the pad - it takes no escape lane from the neighbours
        tries = []
        if fine:
            for dd in (mm(1.0), mm(1.25), mm(1.5)):
                tries.append((dd, [(out_ang + math.pi, None)]))
        for (via_d, drill) in sizes:
          width = min(mm(0.3) if netname == "GND" else mm(0.5), min(size.x, size.y))
          dists = (half + via_d / 2 + mm(2.6), half + via_d / 2 + mm(3.2), half + via_d / 2 + mm(2.0)) if fine else (half + via_d / 2 + CLR + mm(0.15), half + via_d / 2 + mm(0.6), half + via_d / 2 + mm(1.1), half + via_d / 2 + mm(1.7), half + via_d / 2 + mm(2.4))
          plan = [(dd, [(a, None) for (a, _) in angs]) for (dd, angs) in tries] + [(dd, [(k * math.pi / 8, None) for k in order]) for dd in dists]
          for dist, angs in plan:
            for (ang, _) in angs:
                vx, vy = int(pos.x + dist * math.cos(ang)), int(pos.y + dist * math.sin(ang))
                via = pcbnew.PCB_VIA(board)
                via.SetPosition(pcbnew.VECTOR2I(vx, vy))
                via.SetViaType(pcbnew.VIATYPE_THROUGH)
                via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                via.SetWidth(via_d)
                via.SetDrill(drill)
                via.SetNet(pad.GetNet())
                vshape = via.GetEffectiveShape(pcbnew.F_Cu)
                if not chk.clear(vshape, via.GetBoundingBox(), net, set(COPPER)):
                    continue
                vp = via.GetPosition()
                routes = [[pos, vp]]
                for mid in (pcbnew.VECTOR2I(pos.x, vp.y), pcbnew.VECTOR2I(vp.x, pos.y)):
                    routes.append([pos, mid, vp])
                chosen = None
                for pts in routes:
                    ok = True
                    for a, c in zip(pts, pts[1:]):
                        if a == c:
                            continue
                        seg = pcbnew.SHAPE_SEGMENT(a, c, width)
                        sbb = pcbnew.BOX2I(a, pcbnew.VECTOR2I(1, 1))
                        sbb.Merge(c)
                        sbb.Inflate(width)
                        if not chk.clear(seg, sbb, net, {layer}):
                            ok = False
                            break
                    if ok:
                        chosen = pts
                        break
                if chosen is None:
                    continue
                board.Add(via)
                chk.add(via)
                for a, c in zip(chosen, chosen[1:]):
                    if a == c:
                        continue
                    t = pcbnew.PCB_TRACK(board)
                    t.SetStart(a)
                    t.SetEnd(c)
                    t.SetWidth(width)
                    t.SetLayer(layer)
                    t.SetNet(pad.GetNet())
                    board.Add(t)
                    chk.add(t)
                placed += 1
                done = True
                break
            if done:
                break
          if done:
              break
        if not done and netname == "GND" and min(size.x, size.y) >= mm(0.7):
            via = pcbnew.PCB_VIA(board)
            via.SetPosition(pos)
            via.SetViaType(pcbnew.VIATYPE_THROUGH)
            via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
            via.SetWidth(mm(0.45))
            via.SetDrill(mm(0.2))
            via.SetNet(pad.GetNet())
            if chk.clear(via.GetEffectiveShape(pcbnew.F_Cu), via.GetBoundingBox(), net, set(COPPER), mm(0.15)):
                board.Add(via)
                chk.add(via)
                placed += 1
                done = True
                print("  via-in-pad:", ref, padnum)
        if not done:
            failed.append((ref, padnum, netname))
    return placed, failed


def clusters(board, netcode):
    """Union-find over this net's pads, tracks and vias by touching geometry -> list of item lists."""
    items = []
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            if pad.GetNetCode() == netcode:
                items.append(pad)
    for t in board.GetTracks():
        if t.GetNetCode() == netcode:
            items.append(t)
    parent = list(range(len(items)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def layers_of(it):
        if it.GetClass() == "PCB_TRACK":
            return [it.GetLayer()]
        return [ly for ly in COPPER if it.IsOnLayer(ly)]

    shapes = [{ly: it.GetEffectiveShape(ly) for ly in layers_of(it)} for it in items]
    boxes = [it.GetBoundingBox() for it in items]
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if not boxes[i].Intersects(boxes[j]):
                continue
            common = set(shapes[i]) & set(shapes[j])
            if any(shapes[i][ly].Collide(shapes[j][ly], 0) for ly in common):
                parent[find(i)] = find(j)
    groups = {}
    for i, it in enumerate(items):
        groups.setdefault(find(i), []).append(it)
    return list(groups.values())


def cluster_fanout(board, todo):
    """For a floating plane-net pad: put a via anywhere on the copper island it already sits on."""
    chk = Checker(board)
    placed, failed = 0, []
    by_net = {}
    for (ref, padnum), netname in todo.items():
        if netname in PLANES:
            by_net.setdefault(netname, []).append((ref, padnum))
    for netname, pads in by_net.items():
        net = board.FindNet(netname)
        code = net.GetNetCode()
        groups = clusters(board, code)
        done_groups = set()
        for (ref, padnum) in pads:
            fp = board.FindFootprintByReference(ref)
            pad = next((p for p in fp.Pads() if p.GetNumber() == padnum), None)
            grp = next((g for g in groups if any(it is pad or (it.GetClass() == "PAD" and it.GetParent().GetReference() == ref and it.GetNumber() == padnum) for it in g)), None)
            if grp is None:
                failed.append((ref, padnum, netname))
                continue
            gid = id(grp)
            if gid in done_groups:
                continue
            if any(it.GetClass() == "PCB_VIA" for it in grp):
                done_groups.add(gid)   # already reaches a plane; the plane must be missing there (see DRC)
                continue
            # candidate points: along every track of the island, every 0.4 mm, then around each pad
            cands = []
            for it in grp:
                if it.GetClass() == "PCB_TRACK":
                    a, c = it.GetStart(), it.GetEnd()
                    L = math.hypot(c.x - a.x, c.y - a.y)
                    n = max(1, int(L / mm(0.4)))
                    for k in range(n + 1):
                        f = k / n
                        cands.append((pcbnew.VECTOR2I(int(a.x + (c.x - a.x) * f), int(a.y + (c.y - a.y) * f)), it.GetLayer(), None))
            ok = False
            for (pt, layer, _) in cands:
                for (via_d, drill) in ((mm(0.6), mm(0.3)), (mm(0.5), mm(0.25))):
                    via = pcbnew.PCB_VIA(board)
                    via.SetPosition(pt)
                    via.SetViaType(pcbnew.VIATYPE_THROUGH)
                    via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                    via.SetWidth(via_d)
                    via.SetDrill(drill)
                    via.SetNet(net)
                    if chk.clear(via.GetEffectiveShape(pcbnew.F_Cu), via.GetBoundingBox(), code, set(COPPER)):
                        board.Add(via)
                        chk.add(via)
                        placed += 1
                        ok = True
                        break
                if ok:
                    break
            done_groups.add(gid)
            if not ok:
                failed.append((ref, padnum, netname))
    return placed, failed


def ripup_fanout(board, todo, radius=1.6):
    """Last resort for a boxed-in plane-net pad: remove other nets' tracks within `radius` of it.
    The removed nets are left for a second router pass to reconnect (route.py with the routed board as source)."""
    info = {}
    for fp in board.GetFootprints():
        ref = fp.GetReference()
        for pad in fp.Pads():
            key = (ref, pad.GetNumber())
            if key in todo:
                info[key] = (pad.GetNetCode(), {ly: pad.GetEffectiveShape(ly) for ly in COPPER if pad.IsOnLayer(ly)})
    ripped = set()
    victims = []
    for t in board.GetTracks():
        if t.GetClass() != "PCB_TRACK":
            continue
        seg = pcbnew.SHAPE_SEGMENT(t.GetStart(), t.GetEnd(), t.GetWidth())
        for key, (code, shapes) in info.items():
            if t.GetNetCode() == code or t.GetLayer() not in shapes:
                continue
            if seg.Collide(shapes[t.GetLayer()], mm(radius)):
                victims.append(t)
                ripped.add(t.GetNetname())
                break
    for t in victims:
        _KEEP.append(t)
        board.Remove(t)
    return sorted(ripped)


def widen(board, nets, widths=(1.2, 0.8, 0.5)):
    """Make the power nets' tracks as wide as their surroundings allow (the router drew them at 0.3 mm)."""
    chk = Checker(board)
    codes = {board.FindNet(n).GetNetCode(): n for n in nets if board.FindNet(n)}
    changed = 0
    for t in list(board.GetTracks()):
        if t.GetClass() != "PCB_TRACK" or t.GetNetCode() not in codes:
            continue
        for w in widths:
            seg = pcbnew.SHAPE_SEGMENT(t.GetStart(), t.GetEnd(), mm(w))
            bb = pcbnew.BOX2I(t.GetStart(), pcbnew.VECTOR2I(1, 1))
            bb.Merge(t.GetEnd())
            bb.Inflate(mm(w))
            if chk.clear(seg, bb, t.GetNetCode(), {t.GetLayer()}, mm(0.15)):
                t.SetWidth(mm(w))
                chk.add(t)      # so the next net's widening sees this one at its new width
                changed += 1
                break
    return changed


def stitch(board, pitch=12.0):
    """GND stitching vias on a grid, wherever one fits (ties the four ground layers together)."""
    chk = Checker(board)
    gnd = board.FindNet("GND")
    n = 0
    y = 6.0
    while y < design.H - 5:
        x = 6.0
        while x < design.W - 5:
            via = pcbnew.PCB_VIA(board)
            via.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
            via.SetViaType(pcbnew.VIATYPE_THROUGH)
            via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
            via.SetWidth(mm(0.6))
            via.SetDrill(mm(0.3))
            via.SetNet(gnd)
            if chk.clear(via.GetEffectiveShape(pcbnew.F_Cu), via.GetBoundingBox(), gnd.GetNetCode(), set(COPPER), mm(0.5)):
                board.Add(via)
                chk.add(via)
                n += 1
            x += pitch
        y += pitch
    return n


def drc(board, path):
    pcbnew.WriteDRCReport(board, path, pcbnew.EDA_UNITS_MILLIMETRES, True)
    rep = open(path).read()
    counts = {}
    for m in re.finditer(r"^\[(\w+)\]", rep, re.M):
        counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    return rep, counts


def prefanout(board):
    """Before routing: a via beside every SMD pad of GND / 5V1 / VBAT, while the board is still empty.
    A fine-pitch pin on a package with an exposed pad of the same net is tied to that pad with a short
    track instead (the EP has its own vias), so the pins next to it keep their escape lanes."""
    todo = {}
    tied = 0
    for fp in board.GetFootprints():
        pads = list(fp.Pads())
        eps = [p for p in pads if p.GetDrillSizeX() == 0 and min(p.GetSize().x, p.GetSize().y) >= mm(0.7) and max(p.GetSize().x, p.GetSize().y) >= mm(1.1) and p.GetNetname() in PLANES]
        for pad in pads:
            if pad.GetNetname() not in PLANES or pad.GetDrillSizeX() != 0:
                continue
            fine = min(pad.GetSize().x, pad.GetSize().y) < mm(0.5)
            ep = next((e for e in eps if e.GetNetCode() == pad.GetNetCode() and e is not pad), None)
            if fine and ep is not None:
                layer = pcbnew.F_Cu if pad.IsOnLayer(pcbnew.F_Cu) else pcbnew.B_Cu
                # straight in, perpendicular to the pin row, ending 0.15 mm inside the EP's edge (a diagonal to the
                # EP centre would cross the neighbouring pins)
                pp, ec, es = pad.GetPosition(), ep.GetPosition(), ep.GetSize()
                dx, dy = pp.x - ec.x, pp.y - ec.y
                if abs(dx) * es.y > abs(dy) * es.x:      # pin is left/right of the EP: run horizontally
                    end = pcbnew.VECTOR2I(ec.x + (es.x // 2 - mm(0.15)) * (1 if dx > 0 else -1), pp.y)
                else:
                    end = pcbnew.VECTOR2I(pp.x, ec.y + (es.y // 2 - mm(0.15)) * (1 if dy > 0 else -1))
                t = pcbnew.PCB_TRACK(board)
                t.SetStart(pp)
                t.SetEnd(end)
                t.SetWidth(mm(0.21))      # (0.21: marks an EP tie - not exported as a router keep-out)
                t.SetLayer(layer)
                t.SetNet(pad.GetNet())
                board.Add(t)
                tied += 1
                continue
            todo[(fp.GetReference(), pad.GetNumber())] = pad.GetNetname()
    # runs of neighbouring same-net pins (a SOIC's three source pins, say): join them with a track along the row and
    # fan only the end pin out, so the pin after the run keeps its escape lane
    joined = 0
    for fp in board.GetFootprints():
        ref = fp.GetReference()
        mine = [p for p in fp.Pads() if (ref, p.GetNumber()) in todo]
        used = set()
        for a in mine:
            if a.GetNumber() in used:
                continue
            run = [a]
            used.add(a.GetNumber())
            changed = True
            while changed:
                changed = False
                for b in mine:
                    if b.GetNumber() in used or b.GetNetCode() != a.GetNetCode():
                        continue
                    if any((b.GetPosition() - r.GetPosition()).EuclideanNorm() <= mm(1.5) for r in run):
                        run.append(b)
                        used.add(b.GetNumber())
                        changed = True
            if len(run) < 2:
                continue
            run.sort(key=lambda p: (p.GetPosition().x, p.GetPosition().y))
            layer = pcbnew.F_Cu if a.IsOnLayer(pcbnew.F_Cu) else pcbnew.B_Cu
            for r1, r2 in zip(run, run[1:]):
                t = pcbnew.PCB_TRACK(board)
                t.SetStart(r1.GetPosition())
                t.SetEnd(r2.GetPosition())
                t.SetWidth(mm(0.22))      # (0.22: a pin-run join - exported as a router keep-out, unlike EP ties)
                t.SetLayer(layer)
                t.SetNet(a.GetNet())
                board.Add(t)
            for r in run[1:-1]:
                todo.pop((ref, r.GetNumber()), None)
            # keep only the end pin nearest the part's corner (away from the rest of the row)
            c = fp.GetPosition()
            ends = sorted((run[0], run[-1]), key=lambda p: -(p.GetPosition() - c).EuclideanNorm())
            todo.pop((ref, ends[1].GetNumber()), None)
            joined += 1
    print("fine pins tied to their exposed pad:", tied, " pin runs joined:", joined)
    return fanout(board, todo)


if __name__ == "__main__" and "--pre" in sys.argv:
    clean = "%s/%s.kicad_pcb" % (OUT, NAME)
    board = pcbnew.LoadBoard(clean)
    before = set(id(t) for t in board.GetTracks())
    placed, failed = prefanout(board)
    print("pre-fanout vias:", placed, "failed:", failed)
    pcbnew.SaveBoard("%s/%s-prefan.kicad_pcb" % (OUT, NAME), board)
    import json
    items = []
    for t in board.GetTracks():
        if t.GetClass() == "PCB_VIA":
            items.append({"via": [t.GetPosition().x / 1e3, t.GetPosition().y / 1e3, t.GetWidth() / 1e3]})
        elif t.GetWidth() != mm(0.21):
            items.append({"path": [t.GetStart().x / 1e3, t.GetStart().y / 1e3, t.GetEnd().x / 1e3, t.GetEnd().y / 1e3, t.GetWidth() / 1e3, "F.Cu" if t.GetLayer() == pcbnew.F_Cu else "B.Cu"]})
    json.dump(items, open("%s/prefan.json" % OUT, "w"))
    print("keepout items:", len(items))
    raise SystemExit(0)


if __name__ == "__main__":
    board = pcbnew.LoadBoard(routed)
    rep, counts = drc(board, "%s/drc-report.txt" % OUT)
    print("DRC before:", counts)
    todo = unconnected_pads(rep)
    print("pads to fan out:", len(todo))
    placed, failed = fanout(board, todo)
    print("vias placed:", placed, "failed:", failed)
    if failed:
        left = {(r, p): n for (r, p, n) in failed}
        placed2, failed2 = cluster_fanout(board, left)
        print("island vias placed:", placed2, "failed:", failed2)
        if failed2 and "--ripup" in sys.argv:
            left = {(r, p): n for (r, p, n) in failed2}
            ripped = ripup_fanout(board, left)
            print("ripped up around the stuck pads; nets to re-route:", ripped)
            pcbnew.SaveBoard(routed, board)
            raise SystemExit(0)   # (run again without --ripup, in a fresh process, to place the vias)
    print("widened power tracks:", widen(board, build.POWER_NETS + ["LED_A"]))
    if "--stitch" in sys.argv:
        print("stitching vias:", stitch(board))
    filler = pcbnew.ZONE_FILLER(board)
    filler.Fill(board.Zones())
    pcbnew.SaveBoard(routed, board)
    rep, counts = drc(board, "%s/drc-report.txt" % OUT)
    print("DRC:", counts)
    left = unconnected_pads(rep)
    print("still unconnected pads:", len(left), sorted(left.items())[:40])
