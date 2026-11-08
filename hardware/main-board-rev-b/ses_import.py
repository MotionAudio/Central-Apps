#!/usr/bin/python3
"""Read a Specctra session (.ses) from Freerouting and put its wires and vias on a KiCad board (headless)."""
import re
import sys

import pcbnew

LAYER = {"F.Cu": pcbnew.F_Cu, "In1.Cu": pcbnew.In1_Cu, "In2.Cu": pcbnew.In2_Cu, "B.Cu": pcbnew.B_Cu}


def parse(text):
    """Minimal s-expression parser -> nested lists of str."""
    tokens = re.findall(r'"[^"]*"|\(|\)|[^\s()]+', text)
    stack = [[]]
    for t in tokens:
        if t == "(":
            stack.append([])
        elif t == ")":
            node = stack.pop()
            stack[-1].append(node)
        else:
            stack[-1].append(t.strip('"'))
    return stack[0]


def find(node, key):
    for n in node:
        if isinstance(n, list) and n and n[0] == key:
            yield n


def import_ses(board, path, scale=1e4 / 10.0):
    """scale: SES units -> nm. KiCad writes (resolution um 10): coordinates are in 1/10 um = 100 nm."""
    tree = parse(open(path).read())
    session = tree[0]
    routes = next(find(session, "routes"))
    res = next(find(routes, "resolution"), None)
    if res:
        unit, per = res[1], float(res[2])
        scale = {"um": 1000.0, "mm": 1e6, "mil": 25400.0, "inch": 25.4e6}[unit] / per
    pads = {}
    for ps in find(next(find(routes, "library_out")), "padstack"):
        name = ps[1]
        m = re.match(r"Via\[(\d+)-(\d+)\]_(\d+):(\d+)_um", name)
        if m:
            pads[name] = (int(m.group(3)) * 1000, int(m.group(4)) * 1000)
    nets = {n.GetNetname(): n for n in board.GetNetsByName().values()} if hasattr(board, "GetNetsByName") else {}
    if not nets:
        for code in range(board.GetNetCount()):
            ni = board.FindNet(code)
            if ni:
                nets[ni.GetNetname()] = ni
    # Freerouting writes the FIXED pre-routes back out too: skip anything already on the board
    have_vias, have_segs = set(), set()
    for t in board.GetTracks():
        if t.GetClass() == "PCB_VIA":
            have_vias.add((round(t.GetPosition().x / 1000), round(t.GetPosition().y / 1000)))
        else:
            a, b = t.GetStart(), t.GetEnd()
            key = frozenset(((round(a.x / 1000), round(a.y / 1000)), (round(b.x / 1000), round(b.y / 1000))))
            have_segs.add((t.GetLayer(), key))
    n_tracks = n_vias = n_dup = 0
    for net in find(next(find(routes, "network_out")), "net"):
        name = net[1]
        ni = nets.get(name) or board.FindNet(name)
        if ni is None:
            print("unknown net in SES:", name)
            continue
        for wire in find(net, "wire"):
            for pth in find(wire, "path"):
                layer = LAYER[pth[1]]
                width = int(float(pth[2]) * scale)
                coords = [float(v) for v in pth[3:]]
                pts = [(int(coords[i] * scale), int(-coords[i + 1] * scale)) for i in range(0, len(coords), 2)]
                for a, b in zip(pts, pts[1:]):
                    if a == b:
                        continue
                    key = frozenset(((round(a[0] / 1000), round(a[1] / 1000)), (round(b[0] / 1000), round(b[1] / 1000))))
                    if (layer, key) in have_segs:
                        n_dup += 1
                        continue
                    t = pcbnew.PCB_TRACK(board)
                    t.SetStart(pcbnew.VECTOR2I(*a))
                    t.SetEnd(pcbnew.VECTOR2I(*b))
                    t.SetWidth(width)
                    t.SetLayer(layer)
                    t.SetNet(ni)
                    board.Add(t)
                    n_tracks += 1
        for via in find(net, "via"):
            dia, drill = pads.get(via[1], (600000, 300000))
            x, y = float(via[2]) * scale, -float(via[3]) * scale
            if (round(x / 1000), round(y / 1000)) in have_vias:
                n_dup += 1
                continue
            v = pcbnew.PCB_VIA(board)
            v.SetPosition(pcbnew.VECTOR2I(int(x), int(y)))
            v.SetViaType(pcbnew.VIATYPE_THROUGH)
            v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
            v.SetWidth(dia)
            v.SetDrill(drill)
            v.SetNet(ni)
            board.Add(v)
            n_vias += 1
    if n_dup:
        print("SES items already on the board (skipped):", n_dup)
    return n_tracks, n_vias


if __name__ == "__main__":
    b = pcbnew.LoadBoard(sys.argv[1])
    print(import_ses(b, sys.argv[2]))
    pcbnew.SaveBoard(sys.argv[3] if len(sys.argv) > 3 else sys.argv[1], b)
