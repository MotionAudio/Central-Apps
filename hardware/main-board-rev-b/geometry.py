#!/usr/bin/python3
"""Write out/board-geometry.json from the routed board: everything the enclosure model needs (hole, control, screen,
connector and slot positions, board mm, y down)."""
import json
import os
import sys

import pcbnew

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design  # noqa: E402

SRC = sys.argv[1] if len(sys.argv) > 1 else "%s/%s-routed.kicad_pcb" % (build.OUT, build.NAME)
b = pcbnew.LoadBoard(SRC)
P = {}
for fp in b.GetFootprints():
    p = fp.GetPosition()
    P[fp.GetReference()] = (round(p.x / 1e6, 3), round(p.y / 1e6, 3), fp.GetOrientationDegrees())


def refs(prefix):
    return sorted(r for r in P if r.startswith(prefix))


d = design.build()
FPK = {p["ref"]: p["fp"] for p in d.parts}


def by_fp(*keys):
    return [list(P[r][:2]) for r in sorted(P) if FPK.get(r) in keys]


g = {
    "board": [design.W, design.H],
    "holes": by_fp("HOLE_M3"),
    "pi_holes": [list(P[r][:2]) for r in refs("HPI")],
    "d7_holes": [list(P[r][:2]) for r in refs("HD7_")],
    "bar_holes": [list(P[r][:2]) for r in refs("HBAR_")],
    "fan_holes": [list(P[r][:2]) for r in refs("HFAN_")],
    "fsw": by_fp("FSW"),
    "led": by_fp("LED5"),
    "enc": by_fp("ENC"),
    "fader": by_fp("FADER"),
    "oled": [[r] + list(P[r][:2]) for r in sorted(P) if FPK.get(r) == "OLED"],
    # 1/4in jacks: the plug AXIS (the footprint origin is a pin, not the axis); PJ-611E: sleeve pads at axis - 7.0 / + 4.2
    "jack": [[round(min(p.GetPosition().x for p in b.FindFootprintByReference(r).Pads() if p.GetNumber() == "S") / 1e6 + 7.0, 3), 0.0]
             for r in sorted(P) if FPK.get(r) == "JACK635"],
    "jack35": [[P[r][0], 0.0] for r in sorted(P) if FPK.get(r) == "JACK35"],          # PJ-320D: the pegs sit on the axis = origin
    "caps_58": by_fp("CPOL"),                       # 6.3 x 5.8 electrolytics: the tallest SMD parts (matter under the 7in display's brackets)
    "opto": by_fp("SMD8_OPTO"),                     # 6N138S, 3.5 mm tall
    "slots": [[round(v / 1e6, 3) for v in c] for c in build.inner_cutouts(b)],
}


def _centre(key):
    pts = g[key]
    return (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2, (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2


# screen centres from their mounting holes (the 7in's holes are its Pi-mount pattern, 27 mm right of its centre;
# the bar screen's are 9.4 mm left of / 1.975 mm below its centre) - so they follow the board if it is widened
cx, cy = _centre("d7_holes"); g["d7_at"] = [round(cx - 27.0, 3), round(cy, 3)]
cx, cy = _centre("bar_holes"); g["bar_at"] = [round(cx + 9.4, 3), round(cy - 1.975, 3)]
for k in ("J1", "J_USBC", "SW_PWR", "J_USBA", "J_FAN", "J_BAT", "J_DISP", "J_USB_BAR", "J_USB_UP"):
    if k in P:
        g[k] = list(P[k][:2])
old = "%s/board-geometry.json" % build.OUT
json.dump(g, open(old, "w"), indent=1)
for k, v in g.items():
    print("%-10s %s" % (k, (str(v)[:100] + ("..." if len(str(v)) > 100 else ""))))
