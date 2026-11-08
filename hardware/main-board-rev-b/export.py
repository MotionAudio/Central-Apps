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
        side = "Top" if r["Side"] == "top" else "Bottom"
        if by_ref[r["Ref"]]["side"] == "B":
            side = "Bottom"          # J1: a through-hole socket fitted from the back (its KiCad footprint stays on the front so the pin numbers stay put)
        w.writerow([r["Ref"], "%.3fmm" % float(r["PosX"]), "%.3fmm" % float(r["PosY"]), side, "%.1f" % float(r["Rot"])])
print("cpl:", cpl, len(rows), "parts")


def refsort(r):
    return (r.rstrip("0123456789"), int(r[len(r.rstrip("0123456789")):] or 0))


def is_th(p):
    lib, fpname = design.FP[p["fp"]]
    return p["fp"] in ("LED5", "USBC", "USBA", "PI40", "PH2", "PH4", "VH2", "JACK635", "ENC", "FADER", "FSW", "OLED", "TACT_RA", "JACK35") or "THT" in fpname or "PinSocket" in fpname


# ---- BOM, one line per orderable part: (footprint, LCSC number, manufacturer part number - or the value when there is none)
MAKERS = ("TI", "Nexperia", "Neutrik", "Bourns", "JST", "Sunlord", "ST", "Alpha&Omega", "Microchip", "C&K", "HRO", "Hynetek", "ADI", "Murata",
          "CoreChips", "Lite-On", "NXP", "onsemi", "Diodes", "Vishay", "Yageo", "Samsung", "TDK", "Kemet", "Panasonic", "XINGLIGHT", "Littelfuse")
groups = {}
for p in d.parts:
    if skip(p):
        continue
    lib, fpname = design.FP[p["fp"]]
    key = (fpname, p["lcsc"] or "", p["mpn"] or p["value"])
    groups.setdefault(key, []).append(p)
ordered = sorted(groups.items(), key=lambda kv: (kv[1][0]["ref"][0], len(kv[1][0]["ref"]), kv[1][0]["ref"]))


def common_prefix(strings):
    pre = os.path.commonprefix(list(strings))
    return pre.rstrip("0123456789 -(")


def describe(ps):
    """What one BOM line is: the shared description, else the shared value, else what the descriptions have in common."""
    descs = {p["desc"] for p in ps}
    values = {p["value"] for p in ps}
    if len(descs) == 1 and ps[0]["desc"]:
        return ps[0]["desc"]
    if len(values) == 1:
        return ps[0]["value"]
    pre = common_prefix(descs)
    return pre if len(pre) >= 4 else ps[0]["value"]


def split_maker(mpn):
    """'Bourns PEC11R-...' -> ('Bourns', 'PEC11R-...'); a descriptive string stays whole."""
    if mpn and " " in mpn and mpn.split(" ", 1)[0] in MAKERS:
        return tuple(mpn.split(" ", 1))
    return ("", mpn)

# JLC columns (also what PCBWay's engineers read without trouble)
bom = "%s/%s-bom.csv" % (FAB, NAME)
with open(bom, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #", "Manufacturer Part Number", "Quantity", "Description"])
    for (fpname, lcsc, mpn_or_value), ps in ordered:
        refs = ",".join(sorted((p["ref"] for p in ps), key=refsort))
        value = ps[0]["value"] if len({p["value"] for p in ps}) == 1 else describe(ps)
        w.writerow([value, refs, fpname, lcsc, ps[0]["mpn"], len(ps), describe(ps)])
print("bom:", bom, len(groups), "lines")

# PCBWay's assembly BOM template columns
NOTES = {
    "FSW": "PCB-pin soft-touch momentary footswitch, M12 bushing, two pins 6.3-6.9 mm apart (e.g. Taiwan Alpha SF12020F, Tayda SF13P-0102-23.5R-M12, Love My Switches soft-touch PCB mount). Any of these fits the slotted holes.",
    "OLED": "0.91\" 128x32 I2C OLED module (SSD1306, 4 pins at 2.54 mm: GND VCC SCL SDA). Solder straight into the socket holes, screen facing up. If the module's pin order is VCC GND SCL SDA, move the two 0R links next to it from A to B.",
    "ENC": "Bourns PEC11R-4230F-S0024: 30 mm flatted shaft (the enclosure plate is 16 mm up). No nut.",
    "FADER": "Bourns PTA6043-2015DPB103, 60 mm travel, 10k linear, lever up.",
    "JACK635": "Neutrik NMJ6HCD2 horizontal PCB 1/4\" TRS jack, body on the board, barrel through the back panel cut-out.",
    "USBA": "Through-hole USB-A, flush to the back edge.",
    "USBC": "USB-C 16-pin receptacle (hybrid SMD/TH), flush to the back edge.",
    "PI40": "2x20 female header, 8.5 mm tall, on the BACK of the board (the Pi plugs on from behind through a stacking header; pin 1 = left end, inner row, seen from the front).",
    "LED5": "5 mm yellow LED, long leg (+) in the square pad, stands 15 mm proud for the top plate.",
    "TACT_RA": "Right-angle tactile switch at the back edge (power button).",
    "VH2": "JST VH 2-pin, back side. PH2 / PH4: JST PH, back side.",
}
pcbway = "%s/%s-bom-pcbway.csv" % (FAB, NAME)
with open(pcbway, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["Item #", "Designator", "Qty", "Manufacturer", "Mfg Part #", "Description / Value", "Package/Footprint", "Type", "Your Instructions / Notes"])
    for i, ((fpname, lcsc, mpn_or_value), ps) in enumerate(ordered, 1):
        refs = ",".join(sorted((p["ref"] for p in ps), key=refsort))
        mfr, mpn_only = split_maker(ps[0]["mpn"])
        note = NOTES.get(ps[0]["fp"], "")
        if lcsc:
            note = ("LCSC " + lcsc + ". " + note).strip()
        desc = describe(ps)
        value = ps[0]["value"] if len({p["value"] for p in ps}) == 1 else ""
        w.writerow([i, refs, len(ps), mfr, mpn_only, (desc + " - " + value) if value and value != desc else (desc or value), fpname, "TH" if is_th(ps[0]) else "SMD", note])
print("pcbway bom:", pcbway)

dnp = sorted((p["ref"] for p in d.parts if p["dnp"]), key=refsort)
with open("%s/not-fitted.txt" % FAB, "w") as fh:
    fh.write("Not fitted (DNP) on %s - leave these empty:\n%s\n\n" % (REV, ", ".join(dnp)))
    fh.write("Solder jumpers (no part): JP_GAIN_A / JP_GAIN_B (bridge for 0 dB instrument inputs), JP_WP (bridge to write-protect the EEPROM).\n")
    fh.write("The OLED 'B' 0R links are DNP: fit them (and remove the 'A' ones) only for VCC-GND-SCL-SDA modules.\n")

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
import pcbnew as _pcbnew
_b = _pcbnew.LoadBoard(BOARD)
n_small_vias = sum(1 for t in _b.GetTracks() if t.GetClass() == "PCB_VIA" and t.GetDrill() < _pcbnew.FromMM(0.29))
with open("%s/PCBWAY-ORDER.md" % FAB, "w") as fh:
    fh.write("""# Central Pedal main board %(rev)s - ordering at PCBWay

## PCB
- Size: %(w)g x %(h)g mm, 4 layers (F.Cu signal / In1 GND / In2 5V1 + 5V2 / B.Cu signal), 1.6 mm FR-4 TG150+, 1 oz outer, 0.5 oz inner
- Solder mask BLACK (matte if offered), silkscreen WHITE, surface finish ENIG (gold - it is the look, and the hub / audio pads like it)
- Min track / space 0.15 / 0.15 mm, vias 0.6 mm pad / 0.3 mm drill (a few at 0.5 / 0.25 mm), min hole 0.25 mm (slots on the footswitch and jack pads: plated slots)
- Board outline and mounting holes are on Edge.Cuts in the Gerbers; no v-score, no panel
- Quantity 5 (or 2 for a first check)
- Impedance control: not needed

## Assembly
- Upload `%(name)s-bom-pcbway.csv` (or `%(name)s-bom.csv`, the JLC layout) and `%(name)s-cpl.csv`
- Both sides are populated: top = everything else; BOTTOM = the 2x20 Pi socket J1 (through-hole, body on the bottom, pin 1 = the square hole at the LEFT end of the row seen from the top), the JST headers (battery, fan, display power, USB hub upstream, bar screen) and the bar-screen ESD diode D_BAR
- Every component has an LCSC number where LCSC stocks it (%(n_lcsc)d of %(n_all)d placements); PCBWay may buy from LCSC, Digi-Key or Mouser by the manufacturer part number
- Parts LCSC does not stock (sourced by part number / description, see the Notes column): the 10 footswitches, the 18 0.91" OLED modules
- Through-hole parts to be soldered: footswitches, encoders, faders, 1/4" jacks, 3.5 mm jacks, USB-A, 2x20 header (BACK side), JST headers (BACK side), 5 mm LEDs (stand 15 mm proud), OLED modules (straight into their 4-pin sockets, screen up)
- Do NOT fit the parts in `not-fitted.txt`
- Polarity: follow the Gerber silkscreen for diodes, LEDs, electrolytic / polymer caps and ICs (pin 1 marks); the CPL rotations use KiCad's convention - please check them on your assembly preview
- The HAT EEPROM (U_EEP) may stay blank: the software recognises the board by its chips; `eeprom/` has the image if you can program it
- No conformal coating; clean flux (audio board)

## Step by step on pcbway.com

1. **PCB Instant Quote** (Quick-order PCB): Board type *Single pieces*; Size **%(w)g x %(h)g mm**; Quantity 5 (or 2);
   Layers **4**; Material FR-4, TG **150** or higher; Thickness **1.6 mm**; Min track / spacing **6/6 mil**;
   Min hole size **0.25 mm** (pick 0.25 or "0.2-0.25" - there are %(n_small_vias)d vias with 0.25 mm drills); Solder mask **Black**; Silkscreen **White**; Surface finish **ENIG** (immersion gold);
   Via process *Tenting vias*; Finished copper **1 oz** outer, inner copper 0.5 oz (1 oz is fine too);
   Impedance control *No*; Castellated holes *No*; Edge plating *No*; Panelization *No* (one board).
   Stackup: leave their default 4-layer stackup; the inner layers are power/ground planes.
2. Tick **Assembly Service** on the same page: *Turnkey* (they buy the parts), assembly side **Both sides**,
   quantity = board quantity, unique parts **%(n_lines)d**, no BGA, no conformal coating, no X-ray needed.
   "Sensitive / special parts": write *through-hole footswitches, 1/4" jacks and OLED modules hand-soldered; the Pi
   socket J1 goes on the BOTTOM side*.
3. Add to cart, then on the order page upload **`%(name)s-gerbers.zip`** as the PCB file.
4. In the assembly section upload **`%(name)s-bom-pcbway.csv`** as the BOM and **`%(name)s-cpl.csv`**
   as the pick-and-place (centroid / XY) file. If their form wants an Excel BOM, open the CSV in Excel and
   save as .xlsx - keep the columns.
5. Submit. Within a day a PCBWay engineer reviews the Gerbers (they will ask you to confirm the board outline and
   the slot - say yes) and sends a parts quote. That is where you "tell them the parts": they take the **LCSC
   number** in the Notes column and the **Mfg Part #** column from the BOM and come back with a list of what they
   found, what is out of stock, and anything they cannot identify. Answer that email line by line; for the two
   parts with no LCSC number (footswitches, OLED modules) the Notes column already says what fits - any of the
   listed makes is fine. If they offer a substitute for a passive (same value, size, voltage) accept it; for ICs
   say no substitutes.
6. If you would rather send some parts yourself (footswitches, OLED modules, jacks), reply that those lines are
   *customer supplied* and ship them to the address they give; everything else stays turnkey.
7. Approve the quote, pay, and they build. Ask for photos of the first assembled board before the rest - and
   check J1 is on the back and the footswitch LED colour is right.

Not on this board (you buy them): the Raspberry Pi 4 + 2x20 stacking header + M2.5 x 20 standoffs, the 7" Touch
Display 2, the 11.9" bar screen, the 2S battery pack (JST-VH lead), a 40 mm 5 V fan (JST-PH lead), knobs for the
six 6 mm D-shafts, two fader caps, the enclosure (see `../enclosure/`).

## Mechanical (for our top plate, not for PCBWay)
- A 3 mm top plate sits 16 mm above the board: footswitch bushings (M12, nut on top), the 30 mm encoder shafts (8 mm clearance holes, no nut), fader levers (in recessed trays), LEDs and the OLED windows pass through it; the Raspberry Pi 4 hangs behind the board, component side toward it, on ~20 mm M2.5 standoffs (holes at 166.7/224.7 x 63.8/112.8 mm) - a 2x20 extra-long stacking header (e.g. Adafruit 2223 or any 2x20 'GPIO stacking header' with ~11 mm pins) on the Pi's GPIO pins reaches the board's socket; the Pi's USB / Ethernet block is 16 mm tall, which is why it cannot sit closer. Seen from the front the Pi is not mirrored: pin 1 at the left end of the header

## Files in this folder
- `%(name)s-gerbers.zip` - Gerbers (RS-274X) + Excellon drills + drill map
- `%(name)s-bom-pcbway.csv`, `%(name)s-bom.csv` - the BOM in PCBWay's and JLC's layouts
- `%(name)s-cpl.csv` - pick and place (mm, both sides)
- `%(name)s-top.pdf`, `%(name)s-bottom.pdf` - assembly drawings; `*-front.png`, `*-back.png`, `*-in1.png`, `*-in2.png` - renders
- `%(name)s-netlist.txt` - every net, pin by pin, for review; `design-notes.txt` - every design assumption
- `drc-report.txt` - KiCad's design rule check of this exact board
- `%(name)s.kicad_pcb` / `.kicad_pro` + `custom.pretty/` - the KiCad 7 project
""" % {"rev": REV, "w": design.W, "h": design.H, "name": NAME, "n_lines": len(groups), "n_all": len([p for p in d.parts if not p["dnp"]]), "n_lcsc": len([p for p in d.parts if not p["dnp"] and p["lcsc"]]), "n_small_vias": n_small_vias})

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
