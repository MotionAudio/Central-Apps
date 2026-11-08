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
pre = "%s/prefan.json" % OUT
if os.path.exists(pre) and "--no-prefan" not in sys.argv:
    import json
    ko = []
    for it in json.load(open(pre)):
        if "via" in it:
            x, y, dia = it["via"]
            ko.append("    (keepout \"\" (circle signal %d %d %d))" % (int(dia + 200), int(x), int(-y)))
        else:
            x1, y1, x2, y2, w, ly = it["path"]
            ko.append("    (keepout \"\" (path %s %d %d %d %d %d))" % (ly, int(w + 200), int(x1), int(-y1), int(x2), int(-y2)))
    marker = "    (via \"Via[0-3]"
    i = txt.index(marker)
    txt = txt[:i] + "\n".join(ko) + "\n" + txt[i:]
    print("pre-fanout keepouts injected:", len(ko))
open(dsn, "w").write(txt)
print("power layers:", txt.count("(type power)"), " planes:", txt.count("(plane "))
if os.path.exists(ses):
    os.remove(ses)
env = dict(os.environ, DISPLAY=":99")
subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1600x1200x24"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
t0 = time.time()
cmd = ["java", "-Xmx3g", "-jar", "/home/claude/tools/freerouting.jar", "-de", dsn, "-do", ses, "-mp", str(passes), "-us", "global", "-mt", "2", "-dr", "-oit", "0.5"]
r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=7000)
print("freerouting exit", r.returncode, "in %.0fs" % (time.time() - t0))
tail = [l for l in (r.stdout + r.stderr).splitlines() if "JAVA_TOOL" not in l]
print("\n".join([l for l in tail if "INFO" in l][-12:]))
if not os.path.exists(ses):
    raise SystemExit("no .ses produced")
import ses_import
target = "%s/%s-prefan.kicad_pcb" % (OUT, NAME)
if not (os.path.exists(target) and os.path.exists(pre) and "--no-prefan" not in sys.argv):
    target = board_path
board = pcbnew.LoadBoard(target)
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
