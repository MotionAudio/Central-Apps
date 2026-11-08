#!/usr/bin/python3
"""Fab outputs for PCBWay (and JLCPCB) from the routed rev B board: Gerbers + drill (zip), BOM (PCBWay and JLC
column layouts, LCSC + manufacturer numbers), pick-and-place, PDFs, renders, netlist, not-fitted list, order notes."""
import csv
import os
import shutil
import subprocess
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import design  # noqa: E402

OUT = "/home/claude/pcb2/out"
NAME = "central-pedal-main-board"
REV = "rev B"
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


# ---- Gerbers (fab-friendly: protel extensions, no X2 attributes, mask subtracted from silk)
layers = "F.Cu,In1.Cu,In2.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts"
run("kicad-cli", "pcb", "export", "gerbers", "--layers", layers, "--subtract-soldermask", "--no-x2", "--no-netlist", "--use-drill-file-origin", "-o", GERB + "/", BOARD)
run("kicad-cli", "pcb", "export", "drill", "--format", "excellon", "--excellon-units", "mm", "--excellon-separate-th", "--drill-origin", "absolute", "--generate-map", "--map-format", "gerberx2", "-o", GERB + "/", BOARD)
zpath = "%s/%s-gerbers.zip" % (FAB, NAME)
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(GERB)):
        z.write(os.path.join(GERB, f), f)
print("gerbers:", zpath, len(os.listdir(GERB)), "files")

# ---- pick and place (both sides: the Pi header, battery / fan / display / USB headers are on the back)
pos_csv = "%s/pos.csv" % FAB
run("kicad-cli", "pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "both", "-o", pos_csv, BOARD)
d = design.build()
by_ref = {p["ref"]: p for p in d.parts}


def skip(p):
    return p["dnp"] or p["fp"].startswith("HOLE") or p["fp"] in ("TP", "SJ") or not (p["mpn"] or p["lcsc"])


rows = [r for r in csv.DictReader(open(pos_csv)) if r["Ref"] in by_ref and not skip(by_ref[r["Ref"]])]
cpl = "%s/%s-cpl.csv" % (FAB, NAME)
with open(cpl, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
    for r in rows:
        w.writerow([r["Ref"], "%.3fmm" % float(r["PosX"]), "%.3fmm" % float(r["PosY"]), "Top" if r["Side"] == "top" else "Bottom", "%.1f" % float(r["Rot"])])
print("cpl:", cpl, len(rows), "parts")


def refsort(r):
    return (r.rstrip("0123456789"), int(r[len(r.rstrip("0123456789")):] or 0))


def is_th(p):
    lib, fpname = design.FP[p["fp"]]
    return p["fp"] in ("LED5", "USBC", "USBA", "PI40", "PH2", "PH4", "VH2", "JACK635", "ENC", "FADER", "FSW", "OLED", "TACT_RA", "JACK35") or "THT" in fpname or "PinSocket" in fpname


# ---- BOM, grouped by (value, footprint, part number)
groups = {}
for p in d.parts:
    if skip(p):
        continue
    lib, fpname = design.FP[p["fp"]]
    key = (p["value"], fpname, p["mpn"], p["lcsc"] or "")
    groups.setdefault(key, []).append(p)
ordered = sorted(groups.items(), key=lambda kv: (kv[1][0]["ref"][0], len(kv[1][0]["ref"]), kv[1][0]["ref"]))

# JLC columns (also what PCBWay's engineers read without trouble)
bom = "%s/%s-bom.csv" % (FAB, NAME)
with open(bom, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #", "Manufacturer Part Number", "Quantity", "Description"])
    for (value, fpname, mpn, lcsc), ps in ordered:
        refs = ",".join(sorted((p["ref"] for p in ps), key=refsort))
        w.writerow([value, refs, fpname, lcsc, mpn, len(ps), ps[0]["desc"]])
print("bom:", bom, len(groups), "lines")

# PCBWay's assembly BOM template columns
NOTES = {
    "FSW": "PCB-pin soft-touch momentary footswitch, M12 bushing, two pins 6.3-6.9 mm apart (e.g. Taiwan Alpha SF12020F, Tayda SF13P-0102-23.5R-M12, Love My Switches soft-touch PCB mount). Any of these fits the slotted holes.",
    "OLED": "0.91\" 128x32 I2C OLED module (SSD1306, 4 pins at 2.54 mm: GND VCC SCL SDA). Solder straight into the socket holes, screen facing up. If the module's pin order is VCC GND SCL SDA, move the two 0R links next to it from A to B.",
    "ENC": "Bourns PEC11R-4220F-S0024 (no nut: the top plate holds it). 20 mm D-shaft.",
    "FADER": "Bourns PTA6043-2015DPB103, 60 mm travel, 10k linear, lever up.",
    "JACK635": "Neutrik NMJ6HCD2 horizontal PCB 1/4\" TRS jack, body on the board, barrel through the back panel cut-out.",
    "USBA": "Through-hole USB-A, flush to the back edge.",
    "USBC": "USB-C 16-pin receptacle (hybrid SMD/TH), flush to the back edge.",
    "PI40": "2x20 female header, 8.5 mm tall, on the BACK of the board (the Pi plugs on from behind).",
    "LED5": "5 mm yellow LED, long leg (+) in the square pad, stands 15 mm proud for the top plate.",
    "TACT_RA": "Right-angle tactile switch at the back edge (power button).",
    "VH2": "JST VH 2-pin, back side. PH2 / PH4: JST PH, back side.",
}
pcbway = "%s/%s-bom-pcbway.csv" % (FAB, NAME)
with open(pcbway, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["Item #", "Designator", "Qty", "Manufacturer", "Mfg Part #", "Description / Value", "Package/Footprint", "Type", "Your Instructions / Notes"])
    for i, ((value, fpname, mpn, lcsc), ps) in enumerate(ordered, 1):
        refs = ",".join(sorted((p["ref"] for p in ps), key=refsort))
        mfr, mpn_only = (mpn.split(" ", 1) + [""])[:2] if mpn and " " in mpn and not mpn.startswith(("0603", "0805", "2x20", "0.91", "SPST")) else ("", mpn)
        note = NOTES.get(ps[0]["fp"], "")
        if lcsc:
            note = ("LCSC " + lcsc + ". " + note).strip()
        w.writerow([i, refs, len(ps), mfr, mpn_only, (ps[0]["desc"] + " - " if ps[0]["desc"] and ps[0]["desc"] != value else "") + value, fpname, "TH" if is_th(ps[0]) else "SMD", note])
print("pcbway bom:", pcbway)

dnp = sorted((p["ref"] for p in d.parts if p["dnp"]), key=refsort)
with open("%s/not-fitted.txt" % FAB, "w") as fh:
    fh.write("Not fitted (DNP) on %s - leave these empty:\n%s\n\n" % (REV, ", ".join(dnp)))
    fh.write("Solder jumpers (no part): JP_GAIN_A / JP_GAIN_B (bridge for 0 dB instrument inputs), JP_WP (bridge to write-protect the EEPROM).\n")
    fh.write("The OLED 'B' 0R links are DNP: fit them (and remove the 'A' ones) only for VCC-GND-SCL-SDA modules.\n")
    fh.write("The hub's two 22p crystal caps are DNP (the SL2.1A has them inside).\n")

# ---- netlist as text (the wiring, pin by pin) for the person doing the review
with open("%s/%s-netlist.txt" % (FAB, NAME), "w") as fh:
    fh.write("Central Pedal main board %s - every net and the pins on it\n\n" % REV)
    for net, pins in sorted(d.nets().items()):
        fh.write("%-14s %s\n" % (net, "  ".join("%s.%s" % pp for pp in pins)))
    fh.write("\nParts\n")
    for p in d.parts:
        fh.write("%-10s %-24s %-56s %-12s %s\n" % (p["ref"], p["value"], design.FP[p["fp"]][1], p["lcsc"] or "", p["mpn"]))
with open("%s/design-notes.txt" % FAB, "w") as fh:
    fh.write("Central Pedal main board %s - design notes and assumptions\n\n" % REV)
    for i, note in enumerate(d.notes, 1):
        fh.write("%2d. %s\n\n" % (i, note))

# ---- order notes for PCBWay
with open("%s/PCBWAY-ORDER.md" % FAB, "w") as fh:
    fh.write("""# Central Pedal main board %(rev)s - ordering at PCBWay

## PCB
- Size: %(w)g x %(h)g mm, 4 layers (F.Cu signal / In1 GND / In2 5V1 + 5V2 / B.Cu signal), 1.6 mm FR-4 TG150+, 1 oz outer, 0.5 oz inner
- Solder mask BLACK (matte if offered), silkscreen WHITE, surface finish ENIG (gold - it is the look, and the hub / audio pads like it)
- Min track / space 0.15 / 0.15 mm, min via 0.45 mm pad / 0.2 mm drill, min hole 0.3 mm (slots on the footswitch and jack pads: plated slots)
- Board outline and mounting holes are on Edge.Cuts in the Gerbers; no v-score, no panel
- Quantity 5 (or 2 for a first check)
- Impedance control: not needed

## Assembly
- Upload `%(name)s-bom-pcbway.csv` (or `%(name)s-bom.csv`, the JLC layout) and `%(name)s-cpl.csv`
- Both sides are populated: top = everything, bottom = the Pi header (J1) and the JST headers (battery, fan, display power, USB hub upstream, bar screen) and three SOT23 parts
- Every component has an LCSC number where LCSC stocks it (518 of 579 placements); PCBWay may buy from LCSC, Digi-Key or Mouser by the manufacturer part number
- Parts LCSC does not stock (sourced by part number / description, see the Notes column): the 10 footswitches, the 18 0.91" OLED modules
- Through-hole parts to be soldered: footswitches, encoders, faders, 1/4" jacks, 3.5 mm jacks, USB-A, 2x20 header (BACK side), JST headers (BACK side), 5 mm LEDs (stand 15 mm proud), OLED modules (straight into their 4-pin sockets, screen up)
- Do NOT fit the parts in `not-fitted.txt`
- Polarity: follow the Gerber silkscreen for diodes, LEDs, electrolytic / polymer caps and ICs (pin 1 marks); the CPL rotations use KiCad's convention - please check them on your assembly preview
- The HAT EEPROM (U_EEP) may stay blank: the software recognises the board by its chips; `eeprom/` has the image if you can program it
- No conformal coating; clean flux (audio board)

## Mechanical (for our top plate, not for PCBWay)
- A top plate sits 15.5 mm above the board: footswitch bushings (M12), encoder shafts (7.5 mm clearance, no nut), fader levers, LEDs and the OLED windows pass through it; the Raspberry Pi 4 sits behind the board on 8.5-9 mm M2.5 standoffs (holes at 164.2/222.2 x 63.8/112.8 mm)

## Files in this folder
- `%(name)s-gerbers.zip` - Gerbers (RS-274X) + Excellon drills + drill map
- `%(name)s-bom-pcbway.csv`, `%(name)s-bom.csv` - the BOM in PCBWay's and JLC's layouts
- `%(name)s-cpl.csv` - pick and place (mm, both sides)
- `%(name)s-top.pdf`, `%(name)s-bottom.pdf` - assembly drawings; `*-front.png`, `*-back.png`, `*-in1.png`, `*-in2.png` - renders
- `%(name)s-netlist.txt` - every net, pin by pin, for review; `design-notes.txt` - every design assumption
- `drc-report.txt` - KiCad's design rule check of this exact board
- `%(name)s.kicad_pcb` / `.kicad_pro` + `custom.pretty/` - the KiCad 7 project
""" % {"rev": REV, "w": design.W, "h": design.H, "name": NAME})

# ---- PDF and PNG renders
run("kicad-cli", "pcb", "export", "pdf", "--layers", "F.Cu,F.SilkS,F.Fab,Edge.Cuts", "--include-border-title", "-o", "%s/%s-top.pdf" % (FAB, NAME), BOARD)
run("kicad-cli", "pcb", "export", "pdf", "--layers", "B.Cu,B.SilkS,Edge.Cuts", "--mirror", "--include-border-title", "-o", "%s/%s-bottom.pdf" % (FAB, NAME), BOARD)
run("/home/claude/pcb2/render.sh", BOARD, "%s/%s" % (FAB, NAME))
shutil.copy(BOARD, "%s/%s.kicad_pcb" % (FAB, NAME))
if os.path.exists("%s/%s.kicad_pro" % (OUT, NAME)):
    shutil.copy("%s/%s.kicad_pro" % (OUT, NAME), "%s/%s.kicad_pro" % (FAB, NAME))
shutil.copytree("/home/claude/pcb2/custom.pretty", "%s/custom.pretty" % FAB)
shutil.copy("%s/drc-report.txt" % OUT, "%s/drc-report.txt" % FAB)
if os.path.isdir("/home/claude/pcb2/eeprom"):
    shutil.copytree("/home/claude/pcb2/eeprom", "%s/eeprom" % FAB)
print("done:", sorted(os.listdir(FAB)))
