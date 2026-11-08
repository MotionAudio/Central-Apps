import cadquery as cq, itertools, sys
sys.argv = ["x", "--no-tiles"]
import enclosure as E
base = E.lap_screw_holes(E.make_base()); plate = E.make_plate(); f7 = E.make_frame(E.DISP7); fb = E.make_frame(E.BAR)
spl = E.make_splices(); refs = E.make_refs()
oled = E.union_all([E.rbox(E.P(x - 2.0, y + 6.5)[0], E.P(x - 2.0, y + 6.5)[1], E.P(x + 37.0, y - 6.5)[0], E.P(x + 37.0, y - 6.5)[1], 0.0, E.OLED_MODULE_H) for (ref, x, y) in E.G["oled"]])
# tall board parts as boxes: footswitch bodies (27x14x15.25), encoders (bushing r4 to z7, body 12x12x6), faders (9x75x9.2), LEDs (r2.5 to z15), jacks (18x25x15.7)
parts = []
for (x, y) in E.G["fsw"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 13.5, Y - 7, X + 13.5, Y + 7, 0, 15.25))
for (x, y) in E.G["enc"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 6.5, Y - 7.5, X + 6.5, Y + 7.5, 0, 6.5)); parts.append(E.cyl(X, Y, 7.0, 0, 7.0))
for (x, y) in E.G["fader"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 4.5, Y - 37.5, X + 4.5, Y + 37.5, 0, E.FADER_BODY_H))
for (x, y) in E.G["led"]: X, Y = E.P(x, y); parts.append(E.cyl(X, Y, 5.0, 0, 15.0))
for (r, x, y) in E.G["jack"]: X, Y = E.P(x, y); parts.append(E.rbox(X - 9.1, Y - 20.2, X + 9.1, Y + 2.9, 0, 15.67))
tall = E.union_all(parts)
objs = {"base": base, "plate": plate, "frame7": f7, "frameBar": fb, "splices": spl, "oled_modules": oled, "tall_parts": tall,
        "board": refs["board"], "pi": refs["pi"], "disp7": refs["display7"], "bar": refs["bar_screen"]}
def vol(s):
    try: return s.val().Volume()
    except Exception: return 0.0
pairs = [("plate","frame7"),("plate","frameBar"),("frame7","frameBar"),("frame7","oled_modules"),("frameBar","oled_modules"),("plate","oled_modules"),
         ("plate","tall_parts"),("plate","board"),("plate","disp7"),("plate","bar"),("frame7","disp7"),("frameBar","bar"),("frame7","tall_parts"),("frameBar","tall_parts"),
         ("base","plate"),("base","board"),("base","pi"),("base","tall_parts"),("splices","plate"),("splices","frame7"),("splices","frameBar"),("splices","tall_parts"),("splices","oled_modules"),("frame7","board"),("frameBar","board")]
for a, b in pairs:
    v = vol(objs[a].intersect(objs[b]))
    print("%-12s x %-12s overlap %8.1f mm3 %s" % (a, b, v, "" if v < 0.5 else "  <-- CHECK"))

def where(a, b):
    i = objs[a].intersect(objs[b])
    try:
        bb = i.val().BoundingBox()
        print("  %s x %s bbox X %.1f..%.1f Y %.1f..%.1f (board y %.1f..%.1f) Z %.1f..%.1f" % (a, b, bb.xmin, bb.xmax, bb.ymin, bb.ymax, E.H - bb.ymax, E.H - bb.ymin, bb.zmin, bb.zmax))
    except Exception as e:
        print("  no bbox", e)
for a, b in (("plate", "frame7"), ("frame7", "frameBar"), ("splices", "tall_parts")):
    where(a, b)
