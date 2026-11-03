"""Test pictures for the picture import (10.2; central-usage/test-pictures.mjs): writes into argv[1]
(python3 tools/make-test-pictures.py central-usage/test-pictures; needs Pillow and pillow-heif). A JPEG with EXIF rotation (Orientation 6: stored
sideways, shown upright), PNG with see-through, WebP, an animated GIF, TIFF, HEIC, BMP, AVIF (if Pillow can), SVG, a
fake .jpg that isn't a picture, and ten numbered JPEGs for the multi-import."""
import sys, os, io
from PIL import Image, ImageDraw
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

def scene(w, h, col=(30, 90, 200), mark=(250, 200, 40)):
    im = Image.new("RGB", (w, h), col); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w // 4, h // 4], fill=mark)          # a yellow block in the top-left corner (upright)
    d.rectangle([w // 2 - 4, 0, w // 2 + 4, h], fill=(255, 255, 255))
    return im

# 1. JPEG, EXIF Orientation 6: the pixels are stored turned 90° anticlockwise; a viewer turns them clockwise.
up = scene(400, 300)                                # how it should look: 400 wide, 300 tall, yellow top-left
stored = up.transpose(Image.Transpose.ROTATE_90)    # 300 wide, 400 tall, as a phone saves it
ex = Image.Exif(); ex[0x0112] = 6
stored.save(os.path.join(out, "phone-rotated.jpg"), quality=92, exif=ex.tobytes())
# 2. PNG with see-through
p = Image.new("RGBA", (320, 200), (0, 0, 0, 0)); ImageDraw.Draw(p).ellipse([20, 20, 300, 180], fill=(220, 40, 60, 255)); p.save(os.path.join(out, "logo.png"))
# 3. WebP
scene(640, 360, (20, 140, 90)).save(os.path.join(out, "photo.webp"), quality=85)
# 4. animated GIF (4 frames, different colours)
frames = [Image.new("RGB", (160, 90), c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]]
frames[0].save(os.path.join(out, "moving.gif"), save_all=True, append_images=frames[1:], duration=120, loop=0)
# 5. TIFF
scene(500, 300, (120, 40, 160)).save(os.path.join(out, "scan.tiff"))
# 6. HEIC (and a big one, more than 3840 across, to check the downscale)
import pillow_heif
pillow_heif.register_heif_opener()
scene(600, 400, (200, 100, 30)).save(os.path.join(out, "iphone.heic"), quality=80)
# 7. BMP, 8. AVIF (Pillow 11+ writes AVIF when built with it)
scene(200, 100, (10, 10, 10)).save(os.path.join(out, "old.bmp"))
try: scene(300, 200, (50, 50, 120)).save(os.path.join(out, "new.avif"), quality=60)
except Exception as e: print("no AVIF writer:", e)
# 9. a big JPEG (5000 x 2500) for the 3840 downscale
scene(5000, 2500).save(os.path.join(out, "huge.jpg"), quality=80)
# 10. SVG
open(os.path.join(out, "drawing.svg"), "w").write('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#0a4"/><circle cx="75" cy="75" r="50" fill="#ff0"/></svg>')
# 11. not a picture
open(os.path.join(out, "not-a-picture.jpg"), "w").write("hello, this is text pretending to be a JPEG")
# 12. ten for the multi-import, saved out of order on purpose
for i in [3, 1, 10, 7, 2, 9, 4, 8, 6, 5]:
    im = Image.new("RGB", (192, 108), (i * 20, 255 - i * 20, 128)); ImageDraw.Draw(im).text((80, 40), str(i), fill=(0, 0, 0)); im.save(os.path.join(out, "slide %02d.jpg" % i), quality=85)
print(sorted(os.listdir(out)))
