"""z-buffer renders of the enclosure (assembled / open / back) for the README"""
import sys, numpy as np, trimesh, cadquery as cq
from PIL import Image
sys.argv = ["x", "--no-tiles"]
import enclosure as E
def mesh(shape, tol=0.15):
    p = "/tmp/claude-0/-home-claude/a668f7e4-aae0-5581-8b01-5647c153ccca/scratchpad/_r.stl"
    cq.exporters.export(shape, p, tolerance=tol, angularTolerance=0.3)
    return trimesh.load(p)
def render(items, az, el, out, W=1800, H=1250):
    a, e = np.radians(az), np.radians(el)
    view = np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
    up = np.array([0, 0, 1.0]); right = np.cross(up, view); right /= np.linalg.norm(right); up2 = np.cross(view, right)
    light = np.array([0.35, -0.45, 0.82]); light /= np.linalg.norm(light)
    tris, cols = [], []
    for m, col in items:
        v = m.vertices; f = m.faces; n = m.face_normals
        keep = (n @ view) > -0.2; f = f[keep]; n = n[keep]
        t = v[f]
        shade = 0.3 + 0.7 * np.clip(np.abs(n @ light), 0, 1)
        tris.append(t); cols.append(np.clip(np.array(col)[None, :] * shade[:, None], 0, 1))
    tris = np.concatenate(tris); cols = np.concatenate(cols)
    px = tris @ right; py = tris @ up2; pz = tris @ view
    x0, x1, y0, y1 = px.min(), px.max(), py.min(), py.max()
    s = min((W - 40) / (x1 - x0), (H - 40) / (y1 - y0))
    sx = (px - x0) * s + 20; sy = H - ((py - y0) * s + 20)
    zbuf = np.full((H, W), -1e9); img = np.ones((H, W, 3)) 
    for i in range(len(tris)):
        xs, ys, zs = sx[i], sy[i], pz[i]
        xa, xb = int(max(0, np.floor(xs.min()))), int(min(W - 1, np.ceil(xs.max())))
        ya, yb = int(max(0, np.floor(ys.min()))), int(min(H - 1, np.ceil(ys.max())))
        if xa > xb or ya > yb: continue
        gx, gy = np.meshgrid(np.arange(xa, xb + 1) + 0.5, np.arange(ya, yb + 1) + 0.5)
        (x1_, y1_), (x2_, y2_), (x3_, y3_) = (xs[0], ys[0]), (xs[1], ys[1]), (xs[2], ys[2])
        det = (y2_ - y3_) * (x1_ - x3_) + (x3_ - x2_) * (y1_ - y3_)
        if abs(det) < 1e-9: continue
        l1 = ((y2_ - y3_) * (gx - x3_) + (x3_ - x2_) * (gy - y3_)) / det
        l2 = ((y3_ - y1_) * (gx - x3_) + (x1_ - x3_) * (gy - y3_)) / det
        l3 = 1 - l1 - l2
        inside = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not inside.any(): continue
        z = l1 * zs[0] + l2 * zs[1] + l3 * zs[2]
        sub = zbuf[ya:yb + 1, xa:xb + 1]
        upd = inside & (z > sub)
        sub[upd] = z[upd]
        img[ya:yb + 1, xa:xb + 1][upd] = cols[i]
    Image.fromarray((img * 255).astype(np.uint8)).save(out); print(out)
dark = (0.2, 0.2, 0.21); gold = (0.83, 0.69, 0.22); green = (0.12, 0.42, 0.2); black = (0.06, 0.06, 0.09)
base = E.lap_screw_holes(E.make_base()); plate = E.make_plate(); f7 = E.make_frame(E.DISP7); fb = E.make_frame(E.BAR); refs = E.make_refs()
mb, mp, m7, mbar = mesh(base), mesh(plate), mesh(f7), mesh(fb)
mboard, mpi, md7, mdb = mesh(refs["board"]), mesh(refs["pi"]), mesh(refs["display7"]), mesh(refs["bar_screen"])
render([(mb, dark), (mp, dark), (md7, black), (mdb, black)], -60, 35, "../out/enclosure/view-assembled.png")
render([(mb, dark), (mboard, green), (mpi, green), (md7, black), (mdb, black), (m7, gold), (mbar, gold)], -60, 40, "../out/enclosure/view-open.png")
render([(mb, dark), (mp, dark)], 115, 18, "../out/enclosure/view-back.png")
