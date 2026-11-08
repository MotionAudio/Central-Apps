#!/usr/bin/python3
"""Route the board with Freerouting, pour the outer ground, fill, DRC."""
import os, subprocess, sys, time
import pcbnew
from pcbnew import FromMM as mm
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build, design

OUT = build.OUT; NAME = build.NAME
board_path = "%s/%s.kicad_pcb" % (OUT, NAME)
dsn = "%s/%s.dsn" % (OUT, NAME); ses = "%s/%s.ses" % (OUT, NAME)
passes = int(sys.argv[1]) if len(sys.argv) > 1 else 30

src = sys.argv[2] if len(sys.argv) > 2 else board_path      # (the pre-fanned board, or a routed one to finish)
board = pcbnew.LoadBoard(src)
print("netclasses:", [c for c in board.GetDesignSettings().m_NetSettings.m_NetClasses.keys()] if hasattr(board.GetDesignSettings().m_NetSettings, "m_NetClasses") else "?")
ok = pcbnew.ExportSpecctraDSN(board, dsn)
print("DSN export:", ok, os.path.getsize(dsn))
# the inner layers are planes: tell the router not to put tracks on them
txt = open(dsn).read()
for ly in ("In1.Cu", "In2.Cu"):
    txt = txt.replace("(layer %s\n      (type signal)" % ly, "(layer %s\n      (type power)" % ly)
# KiCad exports every zone's outline, not its fill: the 5V1 plane would overlap the 5V2 region and the router would
# treat the whole bottom band as both nets.  Cut the 5V1 polygon where the 5V2 zone (priority 1) takes over.
import re as _re
_m = _re.search(r"\(plane 5V2 \(polygon In2\.Cu \d+\s+0 (-\d+)", txt)
if _m:
    ysplit = _m.group(1)
    txt, n = _re.subn(r"(\(plane 5V1 \(polygon In2\.Cu \d+\s+)0 0\s+390000 0\s+390000 -278000\s+0 -278000",
                      lambda mm_: "%s0 0  390000 0  390000 %s  0 %s" % (mm_.group(1), ysplit, ysplit), txt)
    print("5V1 plane cut at y =", ysplit, "(patched %d)" % n)
# The pre-fanout stubs and vias, the power trunks and the pin-run joins are already on the board: export them as
# FIXED wires so the router keeps them (and keeps proper clearance from them) without the oversized keep-outs an
# earlier version injected - those fenced in the neighbouring pads of fine-pitch parts and most connections failed.
rippable = "--rippable" in sys.argv       # pass 3: only LOCKED items stay fixed, the rest may be ripped up and redone
n_fixed = txt.count("(type route)")
if not rippable:
    txt = txt.replace("(type route)", "(type fix)")
print("pre-routes:", n_fixed, "(all fixed)" if not rippable else "(locked ones fixed: %d)" % txt.count("(type fix)"))
# Holes without copper (mounting holes, jack pegs) and the display-cable cut-out are invisible to the router: give it
# keep-outs so tracks and vias keep KiCad's hole (0.25) and edge (0.3) clearance.  Keep-out circle radius =
# hole radius + clearance + a margin; the router keeps its own 0.15 clearance from the keep-out edge on top.
ko = []
for fp in board.GetFootprints():
    for p in fp.Pads():
        if p.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH:
            x, y = p.GetPosition().x / 1000, p.GetPosition().y / 1000                       # um
            dia = max(p.GetDrillSizeX(), p.GetDrillSizeY()) / 1000 + 2 * (250 + 150)
            ko.append("    (keepout \"\" (circle signal %d %d %d))" % (int(dia), int(x), int(-y)))
cut = build.inner_cutout(board)
if cut:
    m_ = 300 + 150
    x1, y1, x2, y2 = cut[0] / 1000 - m_, cut[1] / 1000 - m_, cut[2] / 1000 + m_, cut[3] / 1000 + m_
    ko.append("    (keepout \"\" (polygon signal 0  %d %d  %d %d  %d %d  %d %d))" % (x1, -y1, x2, -y1, x2, -y2, x1, -y2))
marker = "    (via \"Via[0-3]"
i = txt.index(marker)
txt = txt[:i] + "\n".join(ko) + "\n" + txt[i:]
print("hole / cut-out keepouts:", len(ko))
open(dsn, "w").write(txt)
print("power layers:", txt.count("(type power)"), " planes:", txt.count("(plane "))
pre = "%s/prefan.json" % OUT
import_only = "--import-only" in sys.argv
if not import_only:
    if os.path.exists(ses):
        os.remove(ses)
    env = dict(os.environ, DISPLAY=":99")
    subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1600x1200x24"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    t0 = time.time()
    cmd = ["java", "-Xmx5g", "-jar", "/home/claude/tools/freerouting.jar", "-de", dsn, "-do", ses, "-mp", str(passes), "-us", "global", "-mt", "1", "-dr", "-oit", "0.5"]
    r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=14000)
    print("freerouting exit", r.returncode, "in %.0fs" % (time.time() - t0))
    tail = [l for l in (r.stdout + r.stderr).splitlines() if "JAVA_TOOL" not in l]
    print("\n".join([l for l in tail if "INFO" in l][-12:]))
if not os.path.exists(ses):
    raise SystemExit("no .ses produced")
import ses_import
target = src
board = pcbnew.LoadBoard(target)
if rippable:          # the router re-did the unlocked routes: drop the old copies before importing its result
    _keep = []
    for t in list(board.GetTracks()):
        if not t.IsLocked():
            board.Remove(t)
            _keep.append(t)
    print("unlocked tracks/vias dropped before import:", len(_keep))
print("tracks before import:", len(board.GetTracks()), "from", os.path.basename(target))
print("SES import (tracks, vias):", ses_import.import_ses(board, ses))
# outer-layer ground pours (after routing, so they did not block the router), then fill everything
gnd = board.FindNet("GND")
for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
    build.add_zone(board, layer, gnd, (0, 0, design.W, design.H), 0, clearance=0.2, min_width=0.2)
filler = pcbnew.ZONE_FILLER(board)
filler.Fill(board.Zones())
routed_path = "%s/%s-routed.kicad_pcb" % (OUT, NAME)
pcbnew.SaveBoard(routed_path, board)
print("saved", routed_path)
drc_path = "%s/drc-report.txt" % OUT
pcbnew.WriteDRCReport(board, drc_path, pcbnew.EDA_UNITS_MILLIMETRES, True)
rep = open(drc_path).read()
import re as _re
counts = {}
for m in _re.finditer(r"^\[(\w+)\]", rep, _re.M):
    counts[m.group(1)] = counts.get(m.group(1), 0) + 1
print("DRC:", counts)
print("unconnected:", rep.count("[unconnected_items]"))
