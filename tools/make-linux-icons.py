#!/usr/bin/env python3
"""Make the Linux icon sets from the website's logos (docs/brand/<app>.png, 1024 x 1024).

Linux menus and docks look icons up by size (16 ... 512) in the hicolor theme, which has no 1024 x 1024 folder,
so a single big PNG shows up as a blank icon. electron-builder copies each file of an icon folder to
/usr/share/icons/hicolor/<size>/apps/, so each app gets a folder of the standard sizes.
Run it again whenever a logo in docs/brand changes:  python3 tools/make-linux-icons.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
SETS = {   # website logo -> the app's icon folder
    "central-control": "central-usage/build/icons/control",
    "central-usage": "central-usage/build/icons/usage",
    "central-pedal-control": "central-pedal-control/build/icons",
    "central-services": "central-services/build/icons",
}

for logo, out in SETS.items():
    src = Image.open(os.path.join(ROOT, "docs/brand", logo + ".png")).convert("RGBA")
    d = os.path.join(ROOT, out)
    os.makedirs(d, exist_ok=True)
    for s in SIZES:
        src.resize((s, s), Image.LANCZOS).save(os.path.join(d, f"{s}x{s}.png"), optimize=True)
    print(out, ", ".join(f"{s}" for s in SIZES))
