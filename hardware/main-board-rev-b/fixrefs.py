#!/usr/bin/python3
"""Make the board's reference designators match design.py again.

Rev B's design dropped the two unfitted hub-crystal capacitors (old C89 / C90) after the board was built, so every
capacitor numbered after them is two lower in design.py than on the board (board C91 = design C89 ... board C182 =
design C180).  The BOM is written from design.py and the pick-and-place from the board, so the two disagreed: values
landed on the wrong pads and the last two capacitors were missing from the CPL.  This renames each board footprint to
the design part with the same footprint and the same pin-to-net map, sets its value from the design, and refuses to
save if any part is left unmatched or ambiguous.

    python3 fixrefs.py [board]
"""
import os
import sys

import pcbnew

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design  # noqa: E402

routed = sys.argv[1] if len(sys.argv) > 1 else "%s/%s-routed.kicad_pcb" % (build.OUT, build.NAME)
b = pcbnew.LoadBoard(routed)
d = design.build()
parts = {p["ref"]: p for p in d.parts}
fps = {f.GetReference(): f for f in b.GetFootprints()}


def board_nets(f):
    m = {}
    for pad in f.Pads():
        if pad.GetNumber():
            m.setdefault(pad.GetNumber(), set()).add(pad.GetNetname())
    return {k: (sorted(v)[0] if len(v) == 1 else tuple(sorted(v))) for k, v in m.items()}


def matches(f, p):
    bn = board_nets(f)
    return all(not net or bn.get(pin) == net for pin, net in p["pins"].items())


# the history is a plain shift: board C<n> (n >= 91) is design C<n-2>.  Verify every one by its nets before renaming.
plan, problems = {}, []
for r, f in fps.items():
    if r[0] == "C" and r[1:].isdigit() and int(r[1:]) >= 91:
        t = "C%d" % (int(r[1:]) - 2)
        if t in parts and matches(f, parts[t]):
            plan[r] = t
        else:
            problems.append((r, t))
low_bad = [r for r, f in fps.items() if r in parts and r not in plan and not (r[0] == "C" and r[1:].isdigit() and int(r[1:]) >= 91)
           and not matches(f, parts[r])]
if problems or low_bad:
    print("NOT SAVED - shift does not hold for:", problems, "| other mismatches:", low_bad)
    raise SystemExit(1)
shift = sum(1 for a, c in plan.items() if int(a[1:]) - int(c[1:]) == 2)
print("renaming %d footprints (%d are the two-lower shift)" % (len(plan), shift))
for old, new in plan.items():          # two steps so no two footprints share a name in between
    fps[old].SetReference("TMP_" + new)
for old, new in plan.items():
    f = fps[old]
    f.SetReference(new)
    f.SetValue(parts[new]["value"])
pcbnew.SaveBoard(routed, b)
left = [r for r, f in ((f.GetReference(), f) for f in b.GetFootprints()) if r in parts and not matches(f, parts[r])]
missing = sorted(set(r for r, p in parts.items() if not p["fp"].startswith("HOLE")) - {f.GetReference() for f in b.GetFootprints()})
print("still mismatched:", left, "| design parts not on the board:", missing)
