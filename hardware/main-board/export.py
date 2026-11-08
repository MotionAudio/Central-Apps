#!/usr/bin/python3
"""Fab outputs for JLCPCB / PCBWay from the routed board: Gerbers + drill (zip), BOM CSV, CPL CSV, PDF, renders."""
import csv
import os
import shutil
import subprocess
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import design  # noqa: E402

OUT = "/home/claude/pcb/out"
NAME = "central-pedal-main-board"
BOARD = "%s/%s-routed.kicad_pcb" % (OUT, NAME)
FAB = "%s/fab" % OUT
GERB = "%s/gerbers" % FAB
shutil.rmtree(FAB, ignore_errors=True)
os.makedirs(GERB)


def run(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print("FAILED:", " ".join(cmd), "\n", r.stdout, r.stderr)
        raise SystemExit(1)
    return r.stdout


# ---- Gerbers (JLC/PCBWay-friendly: protel extensions, no X2 attributes, mask subtracted from silk)
layers = "F.Cu,In1.Cu,In2.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts"
run("kicad-cli", "pcb", "export", "gerbers", "--layers", layers, "--subtract-soldermask", "--no-x2", "--no-netlist", "--use-drill-file-origin", "-o", GERB + "/", BOARD)
run("kicad-cli", "pcb", "export", "drill", "--format", "excellon", "--excellon-units", "mm", "--excellon-separate-th", "--drill-origin", "absolute", "--generate-map", "--map-format", "gerberx2", "-o", GERB + "/", BOARD)
zpath = "%s/%s-gerbers.zip" % (FAB, NAME)
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(GERB)):
        z.write(os.path.join(GERB, f), f)
print("gerbers:", zpath, len(os.listdir(GERB)), "files")

# ---- pick and place -> JLC CPL
pos_csv = "%s/pos.csv" % FAB
run("kicad-cli", "pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "both", "-o", pos_csv, BOARD)
d0 = design.build()
skip = set(p["ref"] for p in d0.parts if p["dnp"] or p["fp"].startswith("HOLE") or p["fp"] == "TP")
rows = [r for r in csv.DictReader(open(pos_csv)) if r["Ref"] not in skip]
cpl = "%s/%s-cpl-jlcpcb.csv" % (FAB, NAME)
with open(cpl, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
    for r in rows:
        w.writerow([r["Ref"], "%.3fmm" % float(r["PosX"]), "%.3fmm" % float(r["PosY"]), "Top" if r["Side"] == "top" else "Bottom", "%.1f" % float(r["Rot"])])
print("cpl:", cpl, len(rows), "parts")

# ---- BOM (JLC columns + manufacturer part number and a description), grouped
d = design.build()
groups = {}
for p in d.parts:
    if p["dnp"] or p["fp"].startswith("HOLE") or p["fp"] == "TP":
        continue
    lib, fpname = design.FP[p["fp"]]
    key = (p["value"], fpname, p["mpn"], p["lcsc"])
    groups.setdefault(key, []).append(p)
bom = "%s/%s-bom-jlcpcb.csv" % (FAB, NAME)
with open(bom, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #", "Manufacturer Part Number", "Quantity", "Description"])
    for (value, fpname, mpn, lcsc), ps in sorted(groups.items(), key=lambda kv: (kv[1][0]["ref"][0], len(kv[1][0]["ref"]), kv[1][0]["ref"])):
        refs = ",".join(sorted((p["ref"] for p in ps), key=lambda r: (r.rstrip("0123456789"), int(r[len(r.rstrip("0123456789")):] or 0))))
        w.writerow([value, refs, fpname, lcsc, mpn, len(ps), ps[0]["desc"]])
print("bom:", bom, len(groups), "lines")
dnp = [p["ref"] for p in d.parts if p["dnp"]]
with open("%s/not-fitted.txt" % FAB, "w") as fh:
    fh.write("Not fitted (DNP) on rev A: %s\n" % ", ".join(dnp))

# ---- netlist as text (the wiring, pin by pin) for the person doing the review
with open("%s/%s-netlist.txt" % (FAB, NAME), "w") as fh:
    fh.write("Central Pedal main board rev A - every net and the pins on it\n\n")
    for net, pins in sorted(d.nets().items()):
        fh.write("%-14s %s\n" % (net, "  ".join("%s.%s" % pp for pp in pins)))
    fh.write("\nParts\n")
    for p in d.parts:
        fh.write("%-8s %-24s %-50s %s\n" % (p["ref"], p["value"], design.FP[p["fp"]][1], p["mpn"]))

# ---- PDF and PNG renders
run("kicad-cli", "pcb", "export", "pdf", "--layers", "F.Cu,F.SilkS,F.Fab,Edge.Cuts", "--include-border-title", "-o", "%s/%s-top.pdf" % (FAB, NAME), BOARD)
run("kicad-cli", "pcb", "export", "pdf", "--layers", "B.Cu,B.SilkS,Edge.Cuts", "--mirror", "--include-border-title", "-o", "%s/%s-bottom.pdf" % (FAB, NAME), BOARD)
run("/home/claude/pcb/render.sh", BOARD, "%s/%s" % (FAB, NAME))
shutil.copy(BOARD, "%s/%s.kicad_pcb" % (FAB, NAME))
shutil.copy("%s/%s.kicad_pro" % (OUT, NAME), "%s/%s.kicad_pro" % (FAB, NAME))
shutil.copytree("/home/claude/pcb/custom.pretty", "%s/custom.pretty" % FAB)
shutil.copy("%s/drc-report.txt" % OUT, "%s/drc-report.txt" % FAB)
shutil.copy("%s/design-notes.txt" % OUT, "%s/design-notes.txt" % FAB)
print("done:", sorted(os.listdir(FAB)))
