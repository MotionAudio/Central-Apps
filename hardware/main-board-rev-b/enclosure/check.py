"""Interference check: every printed part against the board, the Pi, the two screens (as mounted on the board), the
fan, the cable plugs, the label-screen modules and the tall board parts.  Prints the overlap volume of each pair;
anything above 0.5 mm3 is flagged."""
import sys

import cadquery as cq  # noqa: F401

sys.argv = ["x", "--no-tiles"]
import enclosure as E  # noqa: E402

base = E.lap_screw_holes(E.make_base()); plate = E.make_plate()
spl = E.make_splices(); refs = E.make_refs()
oled = E.union_all([E.rbox(E.P(x - 2.0, y + 6.5)[0], E.P(x - 2.0, y + 6.5)[1], E.P(x + 37.0, y - 6.5)[0], E.P(x + 37.0, y - 6.5)[1], 0.0, E.OLED_MODULE_H) for (ref, x, y) in E.G["oled"]])
oled_tight = E.union_all([E.rbox(E.P(x - 1.5, y + 6.0)[0], E.P(x - 1.5, y + 6.0)[1], E.P(x + 36.5, y - 6.0)[0], E.P(x + 36.5, y - 6.0)[1], 0.0, E.OLED_MODULE_H) for (ref, x, y) in E.G["oled"]])   # the module itself: 38 x 12, pins 1.5 mm from its end
# tall board parts as boxes: footswitch bodies (27x14x15.25), encoders (bushing r4 to z7, body 12x12x6, shaft to 30), faders
# (9x75x9.2, lever to 20.5), LEDs (r2.5 to z15), 1/4" jacks (18x25x15.7), 3.5 mm jacks (6x12x5), big caps (6.3 dia x 5.8)
parts = []
for (x, y) in E.G["fsw"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 13.5, Y - 7, X + 13.5, Y + 7, 0, 15.25))
for (x, y) in E.G["enc"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 6.5, Y - 7.5, X + 6.5, Y + 7.5, 0, 6.5)); parts.append(E.cyl(X, Y, 7.0, 0, 7.0)); parts.append(E.cyl(X, Y, 6.0, 0, 30.0))
for (x, y) in E.G["fader"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 4.5, Y - 37.5, X + 4.5, Y + 37.5, 0, 9.0)); parts.append(E.rbox(X - 0.75, Y - 2.0, X + 0.75, Y + 2.0, 0, 20.5))
for (x, y) in E.G["led"]: X, Y = E.P(x, y); parts.append(E.cyl(X, Y, 5.0, 0, 15.0))
for (x, y) in E.G["jack"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 9.1, Y - 20.2, X + 9.1, Y + 2.9, 0, 15.67))
for (x, y) in E.G["jack35"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 3.0, Y - 7.0, X + 3.0, Y + 3.0, 0, 5.0))
for (x, y) in E.G.get("caps_58", []): X, Y = E.P(x, y); parts.append(E.cyl(X, Y, 6.3, 0, 5.8))
tall = E.union_all(parts)
objs = {"base": base, "plate": plate, "splices": spl, "oled_modules": oled, "tall_parts": tall,
        "board": refs["board"], "pi": refs["pi"], "disp7": refs["display7"], "bar": refs["bar_screen"], "fan": refs["fan"], "plugs": refs["plugs"], "oled_tight": oled_tight}


def vol(s):
    try:
        return s.val().Volume()
    except Exception:
        return 0.0


pairs = [("plate", "oled_modules"), ("plate", "tall_parts"), ("plate", "board"), ("plate", "disp7"), ("plate", "bar"), ("plate", "plugs"),
         ("base", "plate"), ("base", "board"), ("base", "pi"), ("base", "tall_parts"), ("base", "fan"), ("base", "plugs"),
         ("splices", "plate"), ("splices", "tall_parts"), ("splices", "oled_modules"), ("splices", "disp7"), ("splices", "bar"),
         ("disp7", "tall_parts"), ("disp7", "oled_tight"), ("bar", "tall_parts"), ("bar", "oled_tight"), ("disp7", "bar"),
         ("fan", "pi"), ("plugs", "fan"), ("plugs", "pi"), ("plugs", "disp7"), ("plugs", "bar")]
bad = 0
for a, b in pairs:
    v = vol(objs[a].intersect(objs[b]))
    flag = "" if v < 0.5 else "  <-- CHECK"
    bad += bool(flag)
    print("%-12s x %-12s overlap %8.1f mm3 %s" % (a, b, v, flag))


def where(a, b):
    i = objs[a].intersect(objs[b])
    try:
        bb = i.val().BoundingBox()
        print("  %s x %s bbox X %.1f..%.1f Y %.1f..%.1f (board y %.1f..%.1f) Z %.1f..%.1f" % (a, b, bb.xmin, bb.xmax, bb.ymin, bb.ymax, E.H - bb.ymax, E.H - bb.ymin, bb.zmin, bb.zmax))
    except Exception as e:
        print("  no bbox", e)


for a, b in pairs:
    if vol(objs[a].intersect(objs[b])) >= 0.5:
        where(a, b)
# gaps the gaskets must fill
print("gasket gap 7in display: %.2f mm, bar screen: %.2f mm" % (E.Z_PLATE - E.DISP7["glass_z"], E.Z_PLATE - E.BAR["glass_z"]))
print("flagged pairs:", bad)
