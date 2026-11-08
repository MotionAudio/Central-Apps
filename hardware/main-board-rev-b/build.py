#!/usr/bin/python3
"""Central Pedal main board: design.py -> KiCad board -> (route) -> fab files.  Run with the system python (pcbnew)."""
import json
import os
import subprocess
import sys

import pcbnew
from pcbnew import FromMM as mm

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import design  # noqa: E402

OUT = "/home/claude/pcb2/out"
FP_DIR = "/usr/share/kicad/footprints"
CUSTOM = "/home/claude/pcb2/custom.pretty"
NAME = "central-pedal-main-board"
os.makedirs(OUT, exist_ok=True)

POWER_NETS = ["5V1", "5V2", "3V3", "VSYS", "VBAT", "VBAT_P", "BAT_F", "BAT_RAW", "SW1", "SW2", "SW_5V1", "SW_5V2", "SW_3V3", "PMID", "VBUS", "5VA", "3V3A", "USBA_5V"]
PLANE_NETS = ["GND", "5V1", "VBAT", "3V3", "VSYS", "5V2"]


def load_fp(key):
    lib, name = design.FP[key]
    path = CUSTOM if lib == "custom" else "%s/%s.pretty" % (FP_DIR, lib)
    fp = pcbnew.FootprintLoad(path, name)
    if fp is None:
        raise SystemExit("footprint missing: %s/%s" % (lib, name))
    return fp


def make_board(d):
    board = pcbnew.BOARD()
    board.SetCopperLayerCount(4)
    ds = board.GetDesignSettings()
    ds.SetBoardThickness(mm(1.6))
    # nets
    nets = d.nets()
    netinfo = {}
    for name in sorted(nets):
        ni = pcbnew.NETINFO_ITEM(board, name)
        board.Add(ni)
        netinfo[name] = ni
    # footprints
    for p in d.parts:
        fp = load_fp(p["fp"])
        fp.SetReference(p["ref"])
        fp.SetValue(p["value"])
        board.Add(fp)
        fp.SetPosition(pcbnew.VECTOR2I(mm(p["at"][0]), mm(p["at"][1])))
        if p["side"] == "B":
            fp.Flip(fp.GetPosition(), True)
        fp.SetOrientationDegrees(p["rot"])
        if p["dnp"]:
            fp.SetAttributes(fp.GetAttributes() | pcbnew.FP_EXCLUDE_FROM_BOM | pcbnew.FP_EXCLUDE_FROM_POS_FILES)
        if p["fp"].startswith("HOLE") or p["fp"] == "TP":
            fp.SetAttributes(fp.GetAttributes() | pcbnew.FP_EXCLUDE_FROM_BOM | pcbnew.FP_EXCLUDE_FROM_POS_FILES)
        for pad in fp.Pads():
            net = p["pins"].get(pad.GetNumber(), "")
            if net:
                pad.SetNet(netinfo[net])
        # smaller reference text so the silk stays readable on a dense board
        fp.Reference().SetTextSize(pcbnew.VECTOR2I(mm(0.8), mm(0.8)))
        fp.Reference().SetTextThickness(mm(0.12))
        fp.Value().SetVisible(False)
    return board, netinfo


def pi_frame(board):
    """Where the Pi sits (behind the board) from the header's pads: returns (pin1, pin2, sign) in board mm."""
    j1 = board.FindFootprintByReference("J1")
    pos = {pad.GetNumber(): pad.GetPosition() for pad in j1.Pads()}
    p1, p2, p39 = pos["1"], pos["2"], pos["39"]
    sign = 1 if p39.x > p1.x else -1
    return (p1.x / 1e6, p1.y / 1e6), (p2.x / 1e6, p2.y / 1e6), sign


def orient_pi_header(board):
    """Pin 1 (inner row) toward the Pi body (+y, down the board), pins 1/2 at the right end, header centred at x = 135."""
    j1 = board.FindFootprintByReference("J1")
    for attempt in range(4):
        (x1, y1), (x2, y2), sign = pi_frame(board)
        if y1 > y2 and sign < 0:
            break
        j1.SetOrientationDegrees(j1.GetOrientationDegrees() + 90)
    else:
        # a flipped footprint may need a mirror instead of a rotation: try the other rotations with a flip
        j1.Flip(j1.GetPosition(), False)
        for attempt in range(4):
            (x1, y1), (x2, y2), sign = pi_frame(board)
            if y1 > y2 and sign < 0:
                break
            j1.SetOrientationDegrees(j1.GetOrientationDegrees() + 90)
    bb = j1.GetBoundingBox(False, False)
    cx = (bb.GetLeft() + bb.GetRight()) / 2 / 1e6
    cy = (bb.GetTop() + bb.GetBottom()) / 2 / 1e6
    j1.Move(pcbnew.VECTOR2I(mm(design.PI_HEADER[0] - cx), mm(design.PI_HEADER[1] - cy)))
    (x1, y1), (x2, y2), sign = pi_frame(board)
    assert y1 > y2 and sign < 0, (x1, y1, x2, y2, sign)
    return (x1, y1), sign


def add_line(board, layer, a, b, width=0.1):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_SEGMENT)
    s.SetStart(pcbnew.VECTOR2I(mm(a[0]), mm(a[1])))
    s.SetEnd(pcbnew.VECTOR2I(mm(b[0]), mm(b[1])))
    s.SetLayer(layer)
    s.SetWidth(mm(width))
    board.Add(s)


def add_rect(board, layer, x0, y0, x1, y1, width=0.1):
    for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        add_line(board, layer, a, b, width)


def add_text(board, text, x, y, size=1.5, layer=pcbnew.F_SilkS, rot=0, bold=False):
    t = pcbnew.PCB_TEXT(board)
    t.SetText(text)
    t.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    t.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
    t.SetTextThickness(mm(size * 0.15))
    t.SetLayer(layer)
    t.SetTextAngleDegrees(rot)
    if layer == pcbnew.B_SilkS:
        t.SetMirrored(True)
    board.Add(t)


def add_zone(board, layer, net, rect, priority=0, clearance=0.3, min_width=0.25, thermal=True):
    z = pcbnew.ZONE(board)
    z.SetLayer(layer)
    z.SetNet(net)
    if len(rect) == 4:
        x0, y0, x1, y1 = rect
        pts = ((x0, y0), (x1, y0), (x1, y1), (x0, y1))
    else:
        pts = rect
    outline = z.Outline()
    outline.NewOutline()
    for (x, y) in pts:
        outline.Append(mm(x), mm(y))
    z.SetAssignedPriority(priority)
    z.SetLocalClearance(mm(clearance))
    z.SetMinThickness(mm(min_width))
    z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL if thermal else pcbnew.ZONE_CONNECTION_FULL)
    z.SetThermalReliefGap(mm(0.4))
    z.SetThermalReliefSpokeWidth(mm(0.5))
    z.SetIsFilled(False)
    board.Add(z)
    return z


def add_track(board, net, layer, width, pts):
    for a, b in zip(pts, pts[1:]):
        t = pcbnew.PCB_TRACK(board)
        t.SetStart(pcbnew.VECTOR2I(mm(a[0]), mm(a[1])))
        t.SetEnd(pcbnew.VECTOR2I(mm(b[0]), mm(b[1])))
        t.SetWidth(mm(width))
        t.SetLayer(layer)
        t.SetNet(net)
        board.Add(t)


def add_via(board, net, x, y, dia, drill):
    v = pcbnew.PCB_VIA(board)
    v.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    v.SetViaType(pcbnew.VIATYPE_THROUGH)
    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    v.SetWidth(mm(dia))
    v.SetDrill(mm(drill))
    v.SetNet(net)
    board.Add(v)


def write_project(path, netinfo):
    """KiCad 7 keeps net classes in the project file; the DSN export and DRC read them from there."""
    pro = {
        "board": {"design_settings": {
            "rule_severities": {"starved_thermal": "warning", "lib_footprint_issues": "ignore", "lib_footprint_mismatch": "ignore", "silk_overlap": "warning", "silk_over_copper": "warning", "silk_edge_clearance": "warning", "solder_mask_bridge": "warning"},
            "rules": {"min_clearance": 0.15, "min_copper_edge_clearance": 0.3, "min_hole_clearance": 0.25, "min_hole_to_hole": 0.25,
                      "min_track_width": 0.15, "min_via_diameter": 0.45, "min_via_annular_width": 0.1, "min_microvia_diameter": 0.2,
                      "min_microvia_drill": 0.1, "min_silk_clearance": 0.0, "min_via_drill": 0.2, "min_text_height": 0.8, "min_text_thickness": 0.08,
                      "min_through_hole_diameter": 0.2, "use_height_for_length_calcs": True, "solder_mask_clearance": 0.0,
                      "solder_mask_min_width": 0.0, "max_error": 0.005},
            "track_widths": [0.0, 0.2, 0.3, 0.5, 1.0, 2.0], "via_dimensions": [{"diameter": 0.0, "drill": 0.0}, {"diameter": 0.6, "drill": 0.3}, {"diameter": 1.2, "drill": 0.6}],
        }},
        "net_settings": {
            "classes": [
                {"name": "Default", "clearance": 0.15, "track_width": 0.2, "via_diameter": 0.6, "via_drill": 0.3, "microvia_diameter": 0.3, "microvia_drill": 0.1, "diff_pair_width": 0.2, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25, "wire_width": 6, "bus_width": 12, "line_style": 0, "pcb_color": "rgba(0, 0, 0, 0.000)", "schematic_color": "rgba(0, 0, 0, 0.000)"},
                {"name": "Power", "clearance": 0.15, "track_width": 0.3, "via_diameter": 0.8, "via_drill": 0.4, "microvia_diameter": 0.3, "microvia_drill": 0.1, "diff_pair_width": 0.2, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25, "wire_width": 6, "bus_width": 12, "line_style": 0, "pcb_color": "rgba(0, 0, 0, 0.000)", "schematic_color": "rgba(0, 0, 0, 0.000)"},
                {"name": "USB", "clearance": 0.15, "track_width": 0.25, "via_diameter": 0.6, "via_drill": 0.3, "microvia_diameter": 0.3, "microvia_drill": 0.1, "diff_pair_width": 0.25, "diff_pair_gap": 0.2, "diff_pair_via_gap": 0.25, "wire_width": 6, "bus_width": 12, "line_style": 0, "pcb_color": "rgba(0, 0, 0, 0.000)", "schematic_color": "rgba(0, 0, 0, 0.000)"},
            ],
            "meta": {"version": 3},
            "net_colors": None,
            "netclass_assignments": None,
            "netclass_patterns": [{"netclass": "Power", "pattern": n} for n in POWER_NETS] + [{"netclass": "USB", "pattern": n} for n in ("USB_DP", "USB_DM", "USB2_DP", "USB2_DM")],
        },
        "meta": {"filename": os.path.basename(path), "version": 1},
        "pcbnew": {"last_paths": {"gencad": "", "idf": "", "netlist": "", "specctra_dsn": "", "step": "", "vrml": ""}, "page_layout_descr_file": ""},
    }
    with open(path, "w") as fh:
        json.dump(pro, fh, indent=2)


def build(route=True):
    d = design.build()
    board, netinfo = make_board(d)
    pin1, sign = orient_pi_header(board)
    W, H = design.W, design.H

    # ---- outline, with the slot for the Pi's display ribbon
    add_rect(board, pcbnew.Edge_Cuts, 0, 0, W, H, 0.1)
    pi_left_x = pin1[0] + sign * (-7.1)             # the Pi's SD-card / DSI end
    header_y = pin1[1] - 1.27
    slot_a, slot_b = sorted((pi_left_x - sign * 1.5, pi_left_x - sign * 4.7))   # just past the Pi's DSI end
    slot_x = (slot_a + slot_b) / 2
    add_rect(board, pcbnew.Edge_Cuts, slot_a, header_y + 13.5, slot_b, header_y + 36.5, 0.1)
    # Pi mounting holes (M2.5), from the Pi 4 mechanical drawing: (3.5, 3.5) (61.5, 3.5) (3.5, 52.5) (61.5, 52.5) with the header row at y = 3.5
    for k, (px, py) in enumerate(((3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5))):
        fp = load_fp("HOLE_M25")
        board.Add(fp)
        fp.SetReference("HPI%d" % (k + 1))
        for g in list(fp.GraphicalItems()):   # the Pi's holes sit 3.6 mm from its header: drop the courtyard so DRC accepts the true geometry
            if g.GetLayer() in (pcbnew.F_CrtYd, pcbnew.B_CrtYd):
                fp.Remove(g)
        fp.Reference().SetVisible(False)
        fp.SetAttributes(fp.GetAttributes() | pcbnew.FP_EXCLUDE_FROM_BOM | pcbnew.FP_EXCLUDE_FROM_POS_FILES)
        fp.SetPosition(pcbnew.VECTOR2I(mm(pin1[0] + sign * (px - 7.1)), mm(header_y + (py - 3.5))))
    # the Pi's outline on the back silk, so nothing gets fitted there
    x_a, x_b = sorted((pi_left_x, pi_left_x + sign * 85))
    add_rect(board, pcbnew.B_SilkS, x_a, header_y - 3.5, x_b, header_y - 3.5 + 56, 0.15)
    add_text(board, "RASPBERRY PI 4 FITS HERE (component side toward the board)", (x_a + x_b) / 2, header_y + 30, 1.2, pcbnew.B_SilkS)
    add_text(board, "NEVER PLUG THE PI'S OWN USB-C POWER IN", (x_a + x_b) / 2, header_y + 34, 1.2, pcbnew.B_SilkS)
    add_text(board, "DISPLAY RIBBON", slot_x, header_y + 42, 0.9, pcbnew.F_SilkS, 90)

    # ---- silkscreen labels
    add_text(board, "CENTRAL PEDAL MAIN BOARD  rev B", W / 2, 151, 2.0)
    add_text(board, "motionaudio.org", W / 2, 154.5, 1.2)
    labels = {"J_EXTA": "EXT A", "J_INA": "INST A", "J_OUT1": "OUT 1", "J_OUT2": "OUT 2", "J_OUT3": "OUT 3", "J_OUT4": "OUT 4", "J_OUT5": "OUT 5", "J_OUT6": "OUT 6",
              "J_INB": "INST B", "J_EXTB": "EXT B", "J_MIDI_IN": "MIDI IN", "J_MIDI_OUT": "MIDI OUT", "J_PHONES": "PHONES", "J_USBC": "USB-C PD IN", "J_USBA": "USB-A", "SW_PWR": "POWER",
              "RV_A": "FADER A", "RV_B": "FADER B"}
    for k in range(1, 11):
        labels["SW_FS%d" % k] = "FSW %d" % k
    for k in range(1, 7):
        labels["ENC%d" % k] = "KNOB %d" % k
    for ref, text in labels.items():
        fp = board.FindFootprintByReference(ref)
        bb = fp.GetBoundingBox(False, False)
        x = (bb.GetLeft() + bb.GetRight()) / 2 / 1e6
        y = bb.GetBottom() / 1e6 + 1.2 if fp.GetPosition().y < mm(30) else bb.GetTop() / 1e6 - 1.2
        if ref.startswith("RV"):
            x, y = fp.GetPosition().x / 1e6, bb.GetBottom() / 1e6 + 1.5
        add_text(board, text, x, y, 1.0)
    for ref, text in {"J_BAT": "BATTERY 2S  (- +)", "J_FAN": "FAN", "J_DISP": "SCREEN 5V", "J_USB_UP": "USB TO PI", "J_USB_BAR": "BAR SCREEN USB"}.items():
        fp = board.FindFootprintByReference(ref)
        bb = fp.GetBoundingBox(False, False)
        add_text(board, text, (bb.GetLeft() + bb.GetRight()) / 2 / 1e6, bb.GetBottom() / 1e6 + 1.5, 1.0, pcbnew.B_SilkS)
    add_text(board, "TOP PLATE 15.5 mm ABOVE THIS BOARD", W / 2, 158, 1.0)

    # ---- planes: GND on In1; In2 = 5V1 everywhere except a 5V2 region along the bottom (y >= 156)
    gnd, v5, vbat, vsys, v33, v52 = netinfo["GND"], netinfo["5V1"], netinfo["VBAT"], netinfo["VSYS"], netinfo["3V3"], netinfo["5V2"]
    add_zone(board, pcbnew.In1_Cu, gnd, (0, 0, W, H), 0, clearance=0.3, min_width=0.25)
    add_zone(board, pcbnew.In2_Cu, v5, (0, 0, W, H), 0, clearance=0.3, min_width=0.25, thermal=False)
    # 5V2 (screens, lights, USB-A, fan) owns the bottom part of In2: the back connectors (y 158-165), the footswitch
    # lights and the bar-screen ESD part all sit below y = 156. VSYS / VBAT / 3V3 are routed as tracks (fanout.py PLANES).
    add_zone(board, pcbnew.In2_Cu, v52, (0, 156, W, H), 1, clearance=0.3, min_width=0.25, thermal=False)
    # outer-layer ground pours are added after routing (they would block the router)

    # ---- hand-routed power copper (the autorouter treats it as fixed)
    for net, layer, width, pts in design.TRUNKS:
        add_track(board, netinfo[net], pcbnew.F_Cu if layer == "F" else pcbnew.B_Cu, width, pts)
    for net, x, y, dia, drill in design.VIAS:
        add_via(board, netinfo[net], x, y, dia, drill)

    board_path = "%s/%s.kicad_pcb" % (OUT, NAME)
    pro_path = "%s/%s.kicad_pro" % (OUT, NAME)
    pcbnew.SaveBoard(board_path, board)
    write_project(pro_path, netinfo)   # (after the save: SaveBoard writes a default project file)
    print("saved", board_path, "-", len(list(board.GetFootprints())), "footprints,", board.GetNetCount(), "nets")
    with open("%s/design-notes.txt" % OUT, "w") as fh:
        fh.write("\n".join(d.notes) + "\n")
    return board_path


if __name__ == "__main__":
    build()
