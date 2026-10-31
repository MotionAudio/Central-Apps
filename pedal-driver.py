#!/usr/bin/env python3
"""
Pad Pedal - hardware, audio-system and network driver (v4)
==========================================================

Runs on the Raspberry Pi as the pad-pedal-driver service.  It is the bridge
between the Pad Pedal app (Chromium, full screen) and everything physical:

  * 12 buttons, 6 knobs, 2 sliders (+ optional expression pedal, encoder,
    MCP23017 expander, LEDs).  Buttons: GPIO with pull-ups, switch to GND.
    Knobs/sliders: 10k pots on two ADS1115 boards (0x48, 0x49).
  * Learn: while the Learn tab waits, whichever pin / ADS1115 channel / USB
    key / MIDI control you touch is reported back, so inputs map themselves.
  * USB foot pedals (HID "keyboards"), USB MIDI in/out (notes, CCs, clock out),
    Ableton Link, mouse / keyboard detection (the app shows its cursor).
  * The 3.5" SPI touch screen (/dev/fb1 + ADS7846 touch): a compact remote of
    the Pad Pedal / Tracks screen, drawn here from the app's "display" state.
  * http://127.0.0.1:8766  the app itself (/app/), the USB/SD browser, chord
    charts (PDF -> pages + lyrics with poppler), spoken cue words (espeak-ng),
    uploads.
  * http://<pi>:8080  companion pages for every phone / tablet / laptop on the
    Wi-Fi: chord charts that follow the song and section, a projector lyrics
    page (HDMI 2 shows the same page), a remote, and an upload page.
  * System: safe mode, shutdown, restart, Wi-Fi, audio outputs, displays.

Protocol (JSON over ws://127.0.0.1:8765).  Driver -> app:
  hello {inputs, reservedPins, screen35, soundCards, mouse, addresses, code...}
  control {id, event:"press|hold|release"} | {id, value:0..1} | {id, delta:+-1}
  action {name, args, from}          (3.5" screen, companion remote)
  learned {target, input:{gpio}|{adc}|{usb}, alreadyUsedBy}   learning {target}
  devices {mouse, keyboard, usb:[..]}   midi {data, port}   tempo {bpm, source}
  linkStatus {peers}  linkTransport {playing}  systemStatus {...}  uploaded {...}
App -> driver:
  role {role}  state {playing, playingAll, selected}  display {...}  leds {states, bpm}
  inputs {inputs, save}  learn {target, kind, allowKeyboard}  learnCancel
  system {action: status|safeMode|shutdown|reboot|wifi|audio|dac|screen|displays|restartSession|hostname}
  link {enabled, bpm, playing}   midiClock {bpm, running}   midiOut {messages:[{data, at}]}

Every part is optional: anything not wired, or any library that is missing,
is logged and skipped.  Config: /data/pad-pedal/hardware.json (falls back to
/etc/pad-pedal/hardware.json); the Learn tab edits it through this driver.
"""
import argparse
import asyncio
import copy
import datetime
import hashlib
import uuid
import hmac
import io
import json
import logging
import math
import mimetypes
import os
import random
import re
import secrets
import shutil
import signal
import socket
import struct
import sys
import subprocess
import tempfile
import threading
import zipfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import instrument_host
except Exception as _error:  # the host is optional (needs PipeWire tools on the Pi)
    instrument_host = None
    logging.getLogger("pedal-driver").info("instrument host unavailable: %s", _error)
try:
    import native_rig  # the built-in instrument rig (cu-rig) on Windows / macOS
except Exception:  # noqa: BLE001
    native_rig = None
try:
    import libraries as sound_libraries  # the sound libraries (Settings → Packages → Libraries)
except Exception as _error:  # noqa: BLE001
    sound_libraries = None
    logging.getLogger("pedal-driver").info("sound libraries unavailable: %s", _error)
try:
    import sources  # Planning Center + track packs (MultiTracks.com, Loop Community)
except Exception as _error:
    sources = None
    logging.getLogger("pedal-driver").info("sources unavailable: %s", _error)

log = logging.getLogger("pedal-driver")

VERSION = 7
APP_VERSION = "10.0.1"
# Central Pedal Control (the editor on a Mac): the same app and driver, but it never pairs with the main admin as a
# pedal and never updates itself (the Mac app updates as a whole); it uploads to a Central Pedal instead
PEDAL_CONTROL = os.environ.get("CC_PEDAL_CONTROL") == "1"
CONFIG_CANDIDATES = ["/data/pad-pedal/hardware.json", "/etc/pad-pedal/hardware.json"]
SYSTEM_SCRIPT = "/usr/local/sbin/pad-pedal-system"
AUDIO_EXTENSIONS = (".wav", ".mp3", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".aif", ".aiff", ".opus")
CHART_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg", ".txt", ".cho", ".chopro", ".crd", ".pro", ".onsong")
SF2_EXTENSIONS = (".sf2", ".sf3")
UPLOAD_KINDS = ("stems", "sounds", "charts", "sf2", "soundzip")

# Pins the standard build keeps for other jobs (see wiring.html):
#   2,3 I2C (ADS1115 knobs, MCP23017)   18,19,21 I2S DAC (click / MD output)
#   7,8,9,10,11,17,24,25 the 3.5" SPI touch screen (only while it is on)
RESERVED_ALWAYS = [2, 3, 18, 19, 21]
RESERVED_TFT = [7, 8, 9, 10, 11, 17, 24, 25]
ALL_GPIO = list(range(2, 28))
TFT_OVERLAYS = ("waveshare35a", "waveshare35b", "waveshare35c", "piscreen", "tft35a", "tinylcd35", "pitft35-resistive")

# The same defaults the app's Learn tab shows (configure.js DEFAULT_INPUTS)
DEFAULT_INPUTS = [
    {"id": "b1", "name": "Button 1", "kind": "button", "gpio": 4}, {"id": "b2", "name": "Button 2", "kind": "button", "gpio": 5},
    {"id": "b3", "name": "Button 3", "kind": "button", "gpio": 6}, {"id": "b4", "name": "Button 4", "kind": "button", "gpio": 12},
    {"id": "b5", "name": "Button 5", "kind": "button", "gpio": 13}, {"id": "b6", "name": "Button 6", "kind": "button", "gpio": 14},
    {"id": "b7", "name": "Button 7", "kind": "button", "gpio": 15}, {"id": "b8", "name": "Button 8", "kind": "button", "gpio": 16},
    {"id": "b9", "name": "Button 9", "kind": "button", "gpio": 22}, {"id": "b10", "name": "Button 10", "kind": "button", "gpio": 23},
    {"id": "b11", "name": "Button 11", "kind": "button", "gpio": 26}, {"id": "b12", "name": "Button 12", "kind": "button", "gpio": 27},
    {"id": "k1", "name": "Knob 1", "kind": "knob", "adc": {"address": "0x48", "channel": 0}},
    {"id": "k2", "name": "Knob 2", "kind": "knob", "adc": {"address": "0x48", "channel": 1}},
    {"id": "k3", "name": "Knob 3", "kind": "knob", "adc": {"address": "0x48", "channel": 2}},
    {"id": "k4", "name": "Knob 4", "kind": "knob", "adc": {"address": "0x48", "channel": 3}},
    {"id": "k5", "name": "Knob 5", "kind": "knob", "adc": {"address": "0x49", "channel": 0}},
    {"id": "k6", "name": "Knob 6", "kind": "knob", "adc": {"address": "0x49", "channel": 1}},
    {"id": "s1", "name": "Slider 1", "kind": "slider", "adc": {"address": "0x49", "channel": 2}},
    {"id": "s2", "name": "Slider 2", "kind": "slider", "adc": {"address": "0x49", "channel": 3}},
    {"id": "exp", "name": "Expression pedal", "kind": "expression", "adc": {"address": "0x4a", "channel": 0}, "auto_calibrate": True, "optional": True},
    {"id": "enc", "name": "Encoder", "kind": "encoder", "gpio_a": 10, "gpio_b": 9, "gpio_button": 11, "optional": True},
]

DEFAULT_CONFIG = {
    "ws_host": "127.0.0.1",
    "ws_port": 8765,
    "http_port": 8766,          # app + USB/SD browser + charts + cues (this Pi only)
    "lan_port": 8080,           # companion pages (whole Wi-Fi)
    "lan_ws_port": 8081,
    "app_root": "/opt/pad-pedal",
    "data_root": "/data/pad-pedal",
    "inputs": DEFAULT_INPUTS,
    # Optional LEDs: {"id":"led1","gpio":20,"follows":"b1"} or on the expander {"id":"led1","expander":0,"follows":"b1"}
    "leds": [],
    # Optional MCP23017 (16 more pins): {"address":"0x20","buttons":[{"id":"x1","name":"Extra 1","pin":0}], "leds":[...]}
    "expander": None,
    "debounce_s": 0.03,
    "hold_s": 0.8,
    "i2c_bus": 1,
    "analog_min_raw": 120,
    "analog_max_raw": 26300,
    "analog_poll_hz": 40,
    "analog_smoothing": 0.35,
    "analog_deadband": 0.006,
    "midi": True,
    "midi_out": True,
    "link": True,
    "media_roots": ["/media", "/data/pad-pedal/sounds", "/home/pi/Music"],
    "mini_screen": {
        "enabled": True, "fb": "/dev/fb1", "width": 480, "height": 320, "rotate": 0, "touch": "ADS7846",
        "calibration": {"xmin": 200, "xmax": 3900, "ymin": 200, "ymax": 3900, "swap": True, "flip_x": False, "flip_y": True},
    },
    "tft_overlay": "none",          # none | waveshare35a | ... (System menu switches it)
    "tft_overlay_choice": "waveshare35a",
    "touch_screen": "",             # an id from screens.json (Settings → Touch screen); "" = from tft_overlay (older versions)
    "i2s_dac": True,
}


def load_config(path):
    config = copy.deepcopy(DEFAULT_CONFIG)
    if path:
        try:
            with open(path) as handle:
                user = json.load(handle)
            for key, value in user.items():
                if key.startswith("_"):
                    continue
                if isinstance(value, dict) and isinstance(config.get(key), dict):
                    config[key].update(value)
                else:
                    config[key] = value
            log.info("loaded config %s", path)
        except FileNotFoundError:
            log.info("no config at %s, using built-in defaults", path)
        except Exception as error:
            log.warning("could not read %s (%s), using built-in defaults", path, error)
    if not isinstance(config.get("inputs"), list) or not config["inputs"]:
        config["inputs"] = copy.deepcopy(DEFAULT_INPUTS)
    return config


def parse_address(value):
    return int(value, 0) if isinstance(value, str) else int(value)


def screen_on(config):
    """A small touch screen on the GPIO pins is on (the driver draws on it)."""
    return (config.get("tft_overlay") or "none") != "none"


# ----- touch screens: screens.json (sizes, kinds, config.txt lines, the maker's driver)
_SCREENS = {}
LEGACY_SCREEN = {"waveshare35a": "waveshare35a", "waveshare35b": "waveshare35b", "waveshare35c": "waveshare35c", "piscreen": "rpi35-xpt2046",
                 "tft35a": "rpi35-xpt2046", "tinylcd35": "tinylcd35", "pitft35-resistive": "pitft35"}


def boot_id():
    try:
        with open("/proc/sys/kernel/random/boot_id") as fh:
            return fh.read().strip()
    except OSError:
        return "boot"


# screens.json as it shipped with this driver: used when the file can't be found or read (tests keep them the same)
BUILTIN_SCREENS_JSON = r'''{"_about":"Central Pedal touch screens. kind: spi = a small screen on the GPIO pins (Central Pedal draws its own remote on it; HDMI 1 can show a copy), hdmi = a touch monitor on HDMI 1 (shows the app; its touch is USB), dsi = a screen on the ribbon-cable display port (shows the app). config = lines for config.txt; video = the mode forced on HDMI 1 when the screen does not say its size; driver = the maker's overlay, downloaded when the screen is picked (built-in ones need nothing). pins = GPIO pins the screen uses (kept free of buttons).","groups":[{"id":"spi","name":"Small screens on the GPIO pins (2.2\" - 4\")"},{"id":"hdmi","name":"HDMI touch screens (USB touch)"},{"id":"dsi","name":"Ribbon-cable (DSI) touch screens"}],"screens":[{"id":"rpi35-xpt2046","kind":"spi","size":3.5,"res":[480,320],"name":"3.5\" RPi Display - XPT2046 touch (the common blue board)","also":"LCDwiki MPI3501, Waveshare 3.5\" (A) and its clones (Kuman, OSOYOO, Elegoo, iUniker, Quimat...), 480\u00d7320, ILI9486","config":["dtparam=spi=on","dtoverlay=piscreen,speed=16000000,rotate=90,fps=50,xohms=40"],"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25],"calibration":{"xmin":200,"xmax":3900,"ymin":200,"ymax":3900,"swap":true,"flip_x":false,"flip_y":true}},{"id":"waveshare35a","kind":"spi","size":3.5,"res":[480,320],"name":"Waveshare 3.5\" (A) - Waveshare's own driver","also":"the same board as above, with the overlay from Waveshare's LCD-show","config":["dtparam=spi=on","dtoverlay=waveshare35a:rotate=90"],"driver":{"name":"waveshare35a","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare35a-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"waveshare35b","kind":"spi","size":3.5,"res":[480,320],"name":"Waveshare 3.5\" (B) IPS","config":["dtparam=spi=on","dtoverlay=waveshare35b:rotate=90"],"driver":{"name":"waveshare35b","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare35b-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"waveshare35b-v2","kind":"spi","size":3.5,"res":[480,320],"name":"Waveshare 3.5\" (B) Rev 2.0","config":["dtparam=spi=on","dtoverlay=waveshare35b-v2:rotate=90"],"driver":{"name":"waveshare35b-v2","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare35b-v2-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"waveshare35c","kind":"spi","size":3.5,"res":[480,320],"name":"Waveshare 3.5\" (C) high speed","config":["dtparam=spi=on","dtoverlay=waveshare35c:rotate=90"],"driver":{"name":"waveshare35c","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare35c-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"piscreen2r","kind":"spi","size":3.5,"res":[480,320],"name":"OzzMaker PiScreen 2 (3.5\")","config":["dtparam=spi=on","dtoverlay=piscreen2r,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"pitft35","kind":"spi","size":3.5,"res":[480,320],"name":"Adafruit PiTFT 3.5\" (resistive)","config":["dtparam=spi=on","dtoverlay=pitft35-resistive,rotate=90,speed=32000000,fps=25"],"touch":"stmpe","pins":[7,8,9,10,11,24,25],"calibration":{"xmin":300,"xmax":3800,"ymin":200,"ymax":3900,"swap":true,"flip_x":false,"flip_y":false}},{"id":"tinylcd35","kind":"spi","size":3.5,"res":[480,320],"name":"TinyLCD 3.5\"","config":["dtparam=spi=on","dtoverlay=tinylcd35,touch,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,5,25]},{"id":"mz61581","kind":"spi","size":3.2,"res":[480,320],"name":"Tontec 3.2\" / 3.5\" (MZ61581)","config":["dtparam=spi=on","dtoverlay=mz61581,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,4,15,18,25]},{"id":"waveshare32b","kind":"spi","size":3.2,"res":[320,240],"name":"Waveshare 3.2\" (B)","config":["dtparam=spi=on","dtoverlay=waveshare32b:rotate=270"],"driver":{"name":"waveshare32b","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare32b-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,22,27]},{"id":"pitft28r","kind":"spi","size":2.8,"res":[320,240],"name":"Adafruit PiTFT 2.8\" (resistive)","config":["dtparam=spi=on","dtoverlay=pitft28-resistive,rotate=90,speed=64000000,fps=30"],"touch":"stmpe","pins":[7,8,9,10,11,24,25],"calibration":{"xmin":300,"xmax":3800,"ymin":200,"ymax":3900,"swap":true,"flip_x":false,"flip_y":false}},{"id":"pitft28c","kind":"spi","size":2.8,"res":[320,240],"name":"Adafruit PiTFT 2.8\" (capacitive)","config":["dtparam=spi=on","dtparam=i2c_arm=on","dtoverlay=pitft28-capacitive,rotate=90,speed=64000000,fps=30"],"touch":"EP0110M09|ft6236|ft6x06","pins":[7,8,9,10,11,24,25],"calibration":{"xmin":0,"xmax":240,"ymin":0,"ymax":320,"swap":true,"flip_x":false,"flip_y":true}},{"id":"rpi-display","kind":"spi","size":2.8,"res":[320,240],"name":"Watterott RPi-Display 2.8\"","config":["dtparam=spi=on","dtoverlay=rpi-display,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,18,23,24,25]},{"id":"hy28b","kind":"spi","size":2.8,"res":[320,240],"name":"HY28B 2.8\"","config":["dtparam=spi=on","dtoverlay=hy28b,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,17,18,25]},{"id":"pitft22","kind":"spi","size":2.2,"res":[320,240],"name":"Adafruit PiTFT 2.2\" (no touch - buttons only)","config":["dtparam=spi=on","dtoverlay=pitft22,rotate=270,speed=32000000,fps=30"],"touch":"","pins":[7,8,9,10,11,25]},{"id":"hdmi-auto","kind":"hdmi","name":"HDMI touch screen - any size (it says its own size)","also":"most screens sold for the Pi: Waveshare, Elecrow, SunFounder, ROADOM, the official monitors","config":[]},{"id":"hdmi-35","kind":"hdmi","size":3.5,"res":[480,320],"name":"3.5\" HDMI touch (MPI3508) 480\u00d7320","config":[],"video":"480x320M@60"},{"id":"hdmi-4","kind":"hdmi","size":4,"res":[800,480],"name":"4\" HDMI touch (MPI4008) 800\u00d7480","config":[],"video":"800x480M@60"},{"id":"hdmi-5","kind":"hdmi","size":5,"res":[800,480],"name":"5\" HDMI touch 800\u00d7480 (Waveshare 5\", Elecrow, MPI5008)","config":[],"video":"800x480M@60"},{"id":"hdmi-7-800","kind":"hdmi","size":7,"res":[800,480],"name":"7\" HDMI touch 800\u00d7480","config":[],"video":"800x480M@60"},{"id":"hdmi-7-1024","kind":"hdmi","size":7,"res":[1024,600],"name":"7\" HDMI touch 1024\u00d7600 (Waveshare 7\" C, Elecrow, SunFounder)","config":[],"video":"1024x600M@60"},{"id":"hdmi-10","kind":"hdmi","size":10.1,"res":[1280,800],"name":"10.1\" HDMI touch 1280\u00d7800","config":[],"video":"1280x800M@60"},{"id":"dsi-rpi7","kind":"dsi","size":7,"res":[800,480],"name":"Raspberry Pi Touch Display 7\" (the original)","also":"and the Waveshare 4.3\" / 5\" / 7\" DSI screens made to work like it","config":["dtoverlay=vc4-kms-dsi-7inch"]},{"id":"dsi-rpi2-7","kind":"dsi","size":7,"res":[720,1280],"name":"Raspberry Pi Touch Display 2 (7\")","config":["dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=90"]},{"id":"dsi-rpi2-5","kind":"dsi","size":5,"res":[720,1280],"name":"Raspberry Pi Touch Display 2 (5\")","config":["dtoverlay=vc4-kms-dsi-ili9881-5inch,rotation=90"]},{"id":"dsi-ws-28","kind":"dsi","size":2.8,"res":[480,640],"name":"Waveshare 2.8\" DSI","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,2_8_inch"]},{"id":"dsi-ws-34","kind":"dsi","size":3.4,"res":[800,800],"name":"Waveshare 3.4\" round DSI","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,3_4_inch"]},{"id":"dsi-ws-40","kind":"dsi","size":4,"res":[480,800],"name":"Waveshare 4\" DSI","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,4_0_inch"]},{"id":"dsi-ws-50","kind":"dsi","size":5,"res":[720,1280],"name":"Waveshare 5\" DSI (720\u00d71280)","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,5_0_inch"]},{"id":"dsi-ws-70c","kind":"dsi","size":7,"res":[1024,600],"name":"Waveshare 7\" DSI (C) 1024\u00d7600","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,7_0_inchC"]},{"id":"dsi-ws-79","kind":"dsi","size":7.9,"res":[400,1280],"name":"Waveshare 7.9\" DSI (bar)","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,7_9_inch"]},{"id":"dsi-ws-101","kind":"dsi","size":10.1,"res":[800,1280],"name":"Waveshare 10.1\" DSI","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,10_1_inch"]}]}'''


def builtin_screens():
    data = json.loads(BUILTIN_SCREENS_JSON)
    return {"groups": data.get("groups") or [], "screens": data.get("screens") or []}


def screens_catalog(app_root):
    """screens.json from the app's folder (or the driver's own folder). Missing or unreadable: the copy built into the
    driver, with "fallback" saying why (and the next look tries the file again)."""
    here = os.path.dirname(os.path.abspath(__file__))
    paths = [os.path.join(d, "screens.json") for d in dict.fromkeys([app_root or here, here])]
    path = next((p for p in paths if os.path.isfile(p)), None)
    if not path:
        return dict(builtin_screens(), fallback="screens.json is missing from " + (app_root or here))
    try:
        key = (path, os.path.getmtime(path))
        if _SCREENS.get("key") != key:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
            _SCREENS.clear()
            _SCREENS.update({"key": key, "data": {"groups": data.get("groups") or [], "screens": data.get("screens") or []}})
        return _SCREENS["data"]
    except Exception as error:
        return dict(builtin_screens(), fallback="screens.json could not be read (%s)" % error)


def framebuffers(root="/sys/class/graphics"):
    """The Pi's picture outputs by name ({"fb0": "vc4drmfb", "fb1": "fb_ili9486"}): a small GPIO screen whose driver
    started shows up here (Settings → Touch screen says whether it did)."""
    out = {}
    try:
        for n in sorted(os.listdir(root)):
            if re.fullmatch(r"fb\d+", n):
                try:
                    with open(os.path.join(root, n, "name"), encoding="utf-8", errors="replace") as handle:
                        out[n] = handle.read().strip()[:40]
                except OSError:
                    out[n] = ""
    except OSError:
        pass
    return out


def screen_by_id(app_root, sid):
    return next((x for x in screens_catalog(app_root)["screens"] if x.get("id") == sid), None)


def display_connectors(drm="/sys/class/drm"):
    """What the Pi's own display ports see: {"seen": the KMS driver lists its ports, "hdmi": a screen on HDMI,
    "dsi": a screen on the ribbon port}. A small GPIO (SPI) screen isn't one of them."""
    out = {"seen": False, "hdmi": False, "dsi": False}
    try:
        names = os.listdir(drm)
    except OSError:
        return out
    for n in names:
        m = re.match(r"card\d+-(HDMI|DSI)", n)
        if not m:
            continue
        out["seen"] = True
        try:
            with open(os.path.join(drm, n, "status")) as fh:
                st = fh.read().strip()
        except OSError:
            continue
        if st == "connected":
            out["hdmi" if m.group(1) == "HDMI" else "dsi"] = True
    return out


def touch_screen_id(config):
    """The touch screen picked (Settings → Touch screen), or what an older version had set ("off" = none)."""
    sid = config.get("touch_screen")
    if sid:
        return sid
    tft = config.get("tft_overlay") or "none"
    return LEGACY_SCREEN.get(tft, "rpi35-xpt2046") if tft != "none" else "off"


def touch_kind(config):
    sid = touch_screen_id(config)
    if sid == "off":
        return "off"
    s = screen_by_id(config.get("app_root"), sid)
    return (s or {}).get("kind", "spi")


def reserved_pins(config):
    pins = set(RESERVED_ALWAYS)
    if screen_on(config):
        s = screen_by_id(config.get("app_root"), touch_screen_id(config))
        pins.update((s or {}).get("pins") or RESERVED_TFT)
    return sorted(pins)


def slug(text):
    text = re.sub(r"\(.*?\)", "", str(text or "")).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def file_sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def safe_name(name):
    name = os.path.basename(name or "").strip().replace("\\", "_")
    name = re.sub(r"[^A-Za-z0-9 ._\-()&'+#,]", "_", name)
    if not name.strip(". "):   # ("." and ".." are not names - they'd climb out of the folder)
        return "file"
    return name[:120]


# ---------------------------------------------------------------------------
# I2C chips
# ---------------------------------------------------------------------------
class ADS1115:
    REG_CONVERSION = 0x00
    REG_CONFIG = 0x01

    def __init__(self, bus, address):
        self.bus = bus
        self.address = address

    def read(self, channel):
        config = 0x8000 | ((4 + channel) << 12) | (0b001 << 9) | 0x0100 | (0b111 << 5) | 0x0003
        self.bus.write_i2c_block_data(self.address, self.REG_CONFIG, [(config >> 8) & 0xFF, config & 0xFF])
        time.sleep(0.0013)
        for _ in range(10):
            high, _low = self.bus.read_i2c_block_data(self.address, self.REG_CONFIG, 2)
            if high & 0x80:
                break
            time.sleep(0.0004)
        high, low = self.bus.read_i2c_block_data(self.address, self.REG_CONVERSION, 2)
        raw = (high << 8) | low
        return raw - 65536 if raw & 0x8000 else raw


class MCP23017:
    IODIRA, GPPUA, GPIOA, OLATA = 0x00, 0x0C, 0x12, 0x14

    def __init__(self, bus, address):
        self.bus = bus
        self.address = address
        self.olat = 0

    def _w16(self, reg, value):
        self.bus.write_i2c_block_data(self.address, reg, [value & 0xFF, (value >> 8) & 0xFF])

    def setup(self, input_mask, output_mask):
        self._w16(self.IODIRA, (0xFFFF | input_mask) & ~output_mask & 0xFFFF)
        self._w16(self.GPPUA, input_mask & 0xFFFF)
        self._w16(self.OLATA, 0)

    def read(self):
        lo, hi = self.bus.read_i2c_block_data(self.address, self.GPIOA, 2)
        return lo | (hi << 8)

    def write(self, pin, on):
        if on:
            self.olat |= (1 << pin)
        else:
            self.olat &= ~(1 << pin)
        self._w16(self.OLATA, self.olat & 0xFFFF)


def open_i2c_bus(number):
    for module in ("smbus2", "smbus"):
        try:
            return __import__(module).SMBus(number)
        except ImportError:
            continue
        except Exception as error:
            log.warning("could not open I2C bus %s with %s (%s)", number, module, error)
            return None
    log.warning("neither smbus2 nor smbus is installed - knobs/sliders disabled")
    return None


class AnalogInput:
    """Normalizes, smooths and de-jitters one pot / slider / expression reading."""

    def __init__(self, spec, config):
        self.id = spec["id"]
        self.spec = spec
        self.address = parse_address(spec["adc"]["address"])
        self.channel = int(spec["adc"]["channel"])
        self.auto = bool(spec.get("auto_calibrate")) or spec.get("kind") == "expression"
        self.invert = bool(spec.get("invert"))
        self.lo = float(spec.get("min_raw", config["analog_min_raw"]))
        self.hi = float(spec.get("max_raw", config["analog_max_raw"]))
        self.seen_lo = None
        self.seen_hi = None
        self.alpha = float(config["analog_smoothing"])
        self.deadband = float(config["analog_deadband"])
        self.smoothed = None
        self.sent = None

    def update(self, raw):
        lo, hi = self.lo, self.hi
        if self.auto:
            self.seen_lo = raw if self.seen_lo is None else min(self.seen_lo, raw)
            self.seen_hi = raw if self.seen_hi is None else max(self.seen_hi, raw)
            if self.seen_hi - self.seen_lo >= 3000:
                lo, hi = self.seen_lo, self.seen_hi
        value = min(1.0, max(0.0, (raw - lo) / max(1.0, hi - lo)))
        if self.invert:
            value = 1.0 - value
        self.smoothed = value if self.smoothed is None else self.smoothed + self.alpha * (value - self.smoothed)
        out = self.smoothed
        if out < 0.012:
            out = 0.0
        elif out > 0.988:
            out = 1.0
        if self.sent is None or abs(out - self.sent) >= self.deadband or (out in (0.0, 1.0) and out != self.sent):
            self.sent = out
            return round(out, 4)
        return None


# ---------------------------------------------------------------------------
# Shell helpers
# ---------------------------------------------------------------------------
def run(cmd, timeout=20, **kw):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)
        return result.returncode, (result.stdout or ""), (result.stderr or "")
    except Exception as error:
        return 127, "", str(error)


def run_privileged(*args):
    code, out, err = run(["sudo", "-n"] + list(args), timeout=180)
    if code != 0:
        log.warning("%s failed: %s", " ".join(args), (err or out).strip())
    return code == 0


def safe_mode_active():
    try:
        with open("/proc/mounts") as handle:
            for line in handle:
                parts = line.split()
                if len(parts) > 2 and parts[1] == "/" and parts[2] == "overlay":
                    return True
    except OSError:
        pass
    return False


def safe_mode_configured():
    for path in ("/boot/firmware/cmdline.txt", "/boot/cmdline.txt"):
        try:
            with open(path) as handle:
                return "overlayroot=tmpfs" in handle.read()
        except OSError:
            continue
    return safe_mode_active()


def local_ipv4():
    """This computer's IPv4 addresses without Linux tools (Windows / macOS): the host name's addresses and the
    address a UDP socket would use to reach the network (nothing is sent)."""
    found = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            found.insert(0, sock.getsockname()[0])
    except OSError:
        pass
    out = []
    for a in found:
        if a not in out and not a.startswith("127.") and not a.startswith("169.254."):
            out.append(a)
    return out


def ip_addresses():
    code, out, _ = run(["hostname", "-I"], timeout=5) if sys.platform.startswith("linux") else (1, "", "")
    if code != 0:
        return local_ipv4()
    return [a for a in out.split() if re.match(r"^\d+\.\d+\.\d+\.\d+$", a) and not a.startswith("127.")]


def _wifi_helper():
    """The Wi-Fi goes through the root helper on the Central Pedal (NetworkManager does not let a background
    service change it); on a PC or without the helper, nmcli directly."""
    return os.path.exists(SYSTEM_SCRIPT) and sys.platform.startswith("linux")


def wifi_status(scan=False):
    status = {"connected": None, "signal": None, "addresses": ip_addresses(), "networks": [], "available": shutil.which("nmcli") is not None,
              "country": (open("/etc/pad-pedal/wifi-country").read().strip() if os.path.exists("/etc/pad-pedal/wifi-country") else "US"), "error": None}
    if not status["available"]:
        status["error"] = "Wi-Fi can't be set up on this system."
        return status
    if _wifi_helper():
        code, out, err = run(["sudo", "-n", SYSTEM_SCRIPT, "wifi", "scan" if scan else "status"], timeout=40 if scan else 15)
    else:
        code, out, err = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes" if scan else "no"], timeout=30 if scan else 8)
    if code != 0:
        status["error"] = wifi_error(err or out)
    seen = {}
    for line in out.splitlines() if code == 0 else []:
        parts = line.replace("\\:", "\u0000").split(":")
        if len(parts) < 4:
            continue
        try:
            sig = int(parts[2] or 0)
        except ValueError:
            continue
        active, ssid, security = parts[0] == "yes", parts[1].replace("\u0000", ":"), parts[3]
        if not ssid:
            continue
        if active:
            status["connected"], status["signal"] = ssid, sig
        if ssid in seen and seen[ssid]["signal"] >= sig and not active:
            continue
        seen[ssid] = {"ssid": ssid, "signal": sig, "security": security if security not in ("", "--") else "", "active": active}
    status["networks"] = sorted(seen.values(), key=lambda n: (-int(n["active"]), -n["signal"]))
    return status


def wifi_error(text):
    """nmcli's words into something a person can act on."""
    t = (text or "").strip()
    low = t.lower()
    if "secrets were required" in low or "802-1x" in low or "psk: property is invalid" in low or "invalid passphrase" in low or "wrong password" in low:
        return "Wrong password - check it (it is case-sensitive) and try again."
    if "no network with ssid" in low:
        return "That network was not found. Is it in range? (For a hidden network use \"Other network…\".)"
    if "not authorized" in low or "insufficient privileges" in low or "permission" in low:
        return "Not allowed to change the Wi-Fi - update Central Pedal (the Wi-Fi helper comes with the update)."
    if "rfkill" in low or "radio" in low and "disabled" in low:
        return "The Wi-Fi radio is switched off. Set the Wi-Fi country in Settings → Wi-Fi and try again."
    if "timeout" in low or "timed out" in low:
        return "The network did not answer in time - move closer to the router, or check the password."
    if "ip configuration could not be reserved" in low or "dhcp" in low:
        return "Connected, but the network gave no address (DHCP). Check the router."
    return t.splitlines()[-1] if t else "Could not connect."


def wifi_connect(ssid, password, hidden=False):
    if not shutil.which("nmcli"):
        return False, "NetworkManager is not available"
    if _wifi_helper():
        args = ["sudo", "-n", SYSTEM_SCRIPT, "wifi", "connect"] + (["hidden"] if hidden else [])
        code, out, err = run(args, timeout=75, input="%s\n%s\n" % (ssid.replace("\n", " "), (password or "").replace("\n", "")))
        return (True, "Connected to %s" % ssid) if code == 0 else (False, wifi_error(err or out))
    run(["nmcli", "connection", "delete", "padpedal-wifi"], timeout=10)
    cmd = ["nmcli", "--wait", "45", "device", "wifi", "connect", ssid, "name", "padpedal-wifi"]
    if password:
        cmd += ["password", password]
    if hidden:
        cmd += ["hidden", "yes"]
    code, out, err = run(cmd, timeout=60)
    if code != 0:
        run(["nmcli", "connection", "delete", "padpedal-wifi"], timeout=10)
        return False, wifi_error(err or out)
    run(["nmcli", "connection", "modify", "padpedal-wifi", "connection.autoconnect", "yes", "connection.autoconnect-priority", "10"], timeout=10)
    return True, "Connected to %s" % ssid


def pi_health(data_root):
    """For the Ready check: temperature, power (under-voltage / throttling), free space, free memory."""
    out = {}
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as fh:
            out["tempC"] = round(int(fh.read().strip()) / 1000, 1)
    except (OSError, ValueError):
        pass
    if shutil.which("vcgencmd"):
        _code, text, _err = run(["vcgencmd", "get_throttled"], timeout=3)
        m = re.search(r"0x([0-9a-fA-F]+)", text or "")
        if m:
            bits = int(m.group(1), 16)
            out["underVoltage"] = bool(bits & 0x1)
            out["throttled"] = bool(bits & 0x4) or bool(bits & 0x2)
            out["underVoltageSinceBoot"] = bool(bits & 0x10000)
            out["throttledSinceBoot"] = bool(bits & 0x40000)
    try:
        st = os.statvfs(data_root)
        out["diskFreeMB"] = int(st.f_bavail * st.f_frsize / 1048576)
        out["diskTotalMB"] = int(st.f_blocks * st.f_frsize / 1048576)
    except OSError:
        pass
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    out["memFreeMB"] = int(line.split()[1]) // 1024
                elif line.startswith("MemTotal:"):
                    out["memTotalMB"] = int(line.split()[1]) // 1024
    except (OSError, ValueError):
        pass
    out["simulated"] = os.environ.get("CC_PLAYER") == "1"
    return out


# ---- the Pi's sound path (9.9.1): what the app plays into, where that goes, and a tone straight on each card ----------
def pulse_env():
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", "/run/user/%d" % os.getuid())
    return env


def pactl_short(what):
    """pactl list short <what> -> [[columns]]"""
    code, out, _ = run(["pactl", "list", "short", what], timeout=8, env=pulse_env())
    return [line.split("\t") for line in out.splitlines() if line.strip()] if code == 0 else []


def app_sink_inputs():
    """The app's (Chromium's) streams: [{"id", "sink": sink index, "sinkName"}]."""
    clients = {c[0]: (c[2] if len(c) > 2 else "") for c in pactl_short("clients")}
    sinks = {s[0]: s[1] for s in pactl_short("sinks") if len(s) > 1}
    out = []
    for si in pactl_short("sink-inputs"):
        if len(si) > 2 and re.search(r"(?i)chrom", clients.get(si[2], "")):
            out.append({"id": si[0], "sink": si[1], "sinkName": sinks.get(si[1], "")})
    return out


def steer_app_audio():
    """Every app stream into the combined output (padpedal_out). A stream remembered on another device - HDMI, from
    before the combined output existed - played where nobody listens while the app's meters moved. Returns how many
    were moved. (Only the app's own streams: the instrument chain links its channels itself.)"""
    names = [s[1] for s in pactl_short("sinks") if len(s) > 1]
    if "padpedal_out" not in names:
        return 0
    moved = 0
    for si in app_sink_inputs():
        if si["sinkName"] and si["sinkName"] != "padpedal_out":
            code, _, _ = run(["pactl", "move-sink-input", si["id"], "padpedal_out"], timeout=8, env=pulse_env())
            if code == 0:
                moved += 1
                log.info("sound: the app was playing on %s - moved to the combined output", si["sinkName"])
    return moved


def jack_mixer():
    """The headphone jack's ALSA mixer ("PCM" / "Headphone"): {"card", "control", "text", "muted"} or None."""
    try:
        lines = open("/proc/asound/cards").read().splitlines()
    except OSError:
        lines = []
    for line in lines:
        m = re.match(r"\s*(\d+)\s+\[(\S+)\s*\]", line)
        if m and re.match(r"(?i)headphones|bcm2835", m.group(2)):
            for control in ("PCM", "Headphone", "Master"):
                code, out, _ = run(["amixer", "-c", m.group(1), "sget", control], timeout=5)
                if code == 0:
                    vals = re.findall(r"\[(-?[\d.]+dB)\]", out)
                    return {"card": int(m.group(1)), "control": control, "text": vals[0] if vals else "", "muted": "[off]" in out}
            return {"card": int(m.group(1)), "control": "", "text": "", "muted": False}
    return None


def audio_path_check(data_root, fix=True):
    """Where the sound goes, in plain words, for Settings → Audio → Test sound (and the problems found / fixed)."""
    found, fixed = [], []
    cards = sound_cards()
    has_jack = any(re.match(r"(?i)headphones|bcm2835", c) for c in cards)
    cfg_txt = ""
    for path in ("/boot/firmware/config.txt", "/boot/config.txt"):
        try:
            cfg_txt = open(path).read()
            break
        except OSError:
            pass
    if not has_jack:
        found.append("The headphone jack isn't switched on (there's no Headphones sound card)."
                     + ("" if re.search(r"(?m)^dtparam=audio=on", cfg_txt) else " config.txt is missing dtparam=audio=on - it's added now; restart the pedal."))
        if fix and not re.search(r"(?m)^dtparam=audio=on", cfg_txt) and os.path.exists(SYSTEM_SCRIPT):
            if run_privileged(SYSTEM_SCRIPT, "jack", "on"):
                fixed.append("Switched the headphone jack on (after a restart).")
    sinks = [s[1] for s in pactl_short("sinks") if len(s) > 1]
    code, default, _ = run(["pactl", "get-default-sink"], timeout=5, env=pulse_env())
    default = default.strip()
    chans = read_json(os.path.join(data_root, "audio-channels.json"), {}) or {}
    if "padpedal_out" not in sinks:
        found.append("The combined output (padpedal_out) isn't there. Restart the screens (Settings → Screens → Apply) to make it again.")
    elif default != "padpedal_out":
        found.append("The default output was %s, not the combined output." % (default or "nothing"))
        if fix and run(["pactl", "set-default-sink", "padpedal_out"], timeout=5, env=pulse_env())[0] == 0:
            fixed.append("Made the combined output the default again.")
    streams = app_sink_inputs()
    elsewhere = [si["sinkName"] for si in streams if si["sinkName"] and si["sinkName"] != "padpedal_out"]
    if elsewhere and "padpedal_out" in sinks:
        found.append("The app was playing into %s." % ", ".join(sorted(set(elsewhere))))
        if fix and steer_app_audio():
            fixed.append("Moved the app's sound to the combined output.")
    jm = jack_mixer()
    if jm and jm.get("muted"):
        found.append("The headphone jack was muted.")
        if fix and run(["amixer", "-q", "-c", str(jm["card"]), "sset", jm["control"] or "PCM", "0dB", "unmute"], timeout=5)[0] == 0:
            fixed.append("Turned the headphone jack on, at full level.")
    planned = chans.get("cards")
    dac_on = (read_json(os.path.join(data_root, "audio.json"), {}) or {}).get("dac")
    wrong = has_jack and planned is not None and (not planned or (planned[0] or {}).get("kind") != "jack")
    if not wrong and dac_on is False and any((c or {}).get("kind") == "i2s" for c in (planned or [])):
        wrong = True   # (the DAC is switched off but still part of the outputs)
    if wrong:
        found.append("The headphone jack wasn't on outputs 1-2 (a DAC board that isn't fitted was there instead)."
                     if planned and any((c or {}).get("kind") == "i2s" for c in planned) else "The headphone jack wasn't part of the outputs.")
        if fix:
            ok, _text = reapply_audio()
            if ok:
                fixed.append("Made the outputs again: 1-2 the headphone jack" + (", 3-4 the DAC board" if dac_on else "") + ".")
                chans = read_json(os.path.join(data_root, "audio-channels.json"), {}) or {}
                planned = chans.get("cards")
    return {"type": "audioCheck", "cards": cards, "sinks": sinks, "default": default, "appStreams": streams, "channels": chans.get("channels") or [],
            "planned": planned or [], "jack": jm, "found": found, "fixed": fixed, "ok": not found}


def reapply_audio(app_root=None):
    """Make the combined output again now (what happens when the screens start): the outputs in their order - the jack
    on 1-2, the DAC on 3-4 only when it's fitted, USB from 5. (ok, the script's last lines)"""
    script = os.path.join(app_root or os.path.dirname(os.path.abspath(__file__)), "pad-pedal-audio-config")
    if not os.path.exists(script):
        return False, "pad-pedal-audio-config isn't installed"
    code, out, err = run([sys.executable, script, "apply"], timeout=90, env=pulse_env())
    lines = [ln for ln in (out + "\n" + err).splitlines() if ln.strip()]
    if code == 0:
        steer_app_audio()
    return code == 0, "\n".join(lines[-4:])


def card_tone(sink, seconds=0.7, freq=660):
    """A tone straight on one sound card's own sink (not through the app): tells a cable or headphone problem apart
    from an app routing one."""
    import math
    import struct
    import wave
    path = "/tmp/pad-pedal-tone-%d.wav" % freq
    if not os.path.exists(path):
        rate = 48000
        n = int(rate * seconds)
        frames = bytearray()
        for i in range(n):
            env = min(1.0, i / 960.0, (n - i) / 960.0)
            v = int(0.3 * env * 32767 * math.sin(2 * math.pi * freq * i / rate))
            frames += struct.pack("<hh", v, v)
        with wave.open(path, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(bytes(frames))
    for cmd in (["pw-play", "--target", sink, path], ["paplay", "-d", sink, path]):
        if shutil.which(cmd[0]):
            code, _, err = run(cmd, timeout=10, env=pulse_env())
            return code == 0, err.strip()
    return False, "no pw-play / paplay"


def sound_cards():
    cards = []
    try:
        with open("/proc/asound/cards") as handle:
            for line in handle:
                m = re.match(r"\s*(\d+)\s+\[(\S+)\s*\]:\s*(.*)", line)
                if m:
                    cards.append(m.group(2) + " " + m.group(3).strip())
    except OSError:
        pass
    return cards


# what a Central Control computer may ask the Central Pedal to do: page the lyrics. Starting, stopping and
# moving the tracks is only done on the Central Pedal.
CU_ACTIONS = ("lyricsNext", "lyricsPrev")
DISPLAY_KEYS = ("hdmi1", "hdmi2", "cursor", "mode1", "mode2", "scale", "inset1", "inset2", "touchKind")


def connected_displays():
    out = []
    try:
        for name in sorted(os.listdir("/sys/class/drm")):
            if "-HDMI-" not in name:
                continue
            try:
                with open(os.path.join("/sys/class/drm", name, "status")) as handle:
                    out.append({"name": name.split("-", 1)[1], "connected": handle.read().strip() == "connected"})
            except OSError:
                continue
    except OSError:
        pass
    return out


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


PLAN_NAMES = {"keys": "Central Keys", "plugins": "Central Plugins", "instrument": "Central Instrument", "pedals": "Central Pedals", "pads": "Central Pads"}


def clean_packages(items):
    """The sound plan packages the app keeps with the pedal (keys like SXXX-XXXX-XXXX-XXXX and what each one opens)."""
    out = []
    for p in items if isinstance(items, list) else []:
        if not isinstance(p, dict) or not isinstance(p.get("key"), str) or not re.fullmatch(r"[A-Z0-9-]{8,40}", p["key"]):
            continue
        plans = {k: str(v)[:40] for k, v in (p.get("plans") or {}).items() if k in PLAN_NAMES} if isinstance(p.get("plans"), dict) else {}
        q = {"key": p["key"], "plans": plans}
        for k in ("end", "holder", "church", "error"):
            if isinstance(p.get(k), str):
                q[k] = p[k][:120]
        if isinstance(p.get("okAt"), (int, float)):
            q["okAt"] = p["okAt"]
        if p.get("ok") is False:
            q["ok"] = False
        out.append(q)
    return out[:20]


def package_lines(items, now=None):
    """For the small screens: one short line per package ("Central Keys, Central Pedals · to 10/23/2027" or why it stopped)."""
    now = time.time() if now is None else now
    lines = []
    for p in items or []:
        plans = p.get("plans") or {}
        ends = []
        for v in plans.values():
            try:
                ends.append(datetime.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
            except Exception:
                pass
        names = ", ".join(PLAN_NAMES[k] for k in ("keys", "plugins", "instrument", "pedals", "pads") if k in plans) or "no plans"
        stale = p.get("okAt") and now - p["okAt"] / 1000.0 > 14 * 86400
        if p.get("ok") is False:
            state = p.get("error") or "not valid"
        elif ends and max(ends) < now:
            state = "ended"
        elif stale:
            state = "needs the internet to check"
        else:
            state = ("to " + time.strftime("%m/%d/%Y", time.localtime(max(ends)))) if ends else "active"
        lines.append("%s · %s" % (names, state))
    return lines


def write_json(path, value):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".part", "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
        os.replace(path + ".part", path)
        return True
    except OSError as error:
        log.warning("could not write %s (%s)", path, error)
        return False


# ---------------------------------------------------------------------------
# Charts (PDF / image / text -> pages + sections + lyrics) and cue words
# ---------------------------------------------------------------------------
SECTION_RE = re.compile(r"^\s*[\[\(]?\s*(intro|verse|pre[- ]?chorus|chorus|bridge|tag|outro|ending|interlude|instrumental|turnaround|vamp|refrain|hook|solo|breakdown|coda|end|build)\s*([0-9]+|[a-d])?\s*[\]\)]?\s*:?\s*(\(.*\))?\s*$", re.I)
CHORD_RE = re.compile(r"^\(?[A-G](#|b)?(m|maj|min|dim|aug|sus|add|M)?[0-9]*(sus[24]|add[29]|maj7|m7|dim7|aug7|\+|-)?(\/[A-G](#|b)?)?\)?[.,|]*$")
KEY_RE = re.compile(r"\b(?:key(?:\s+of)?|original key)\s*[:=]?\s*([A-G](?:#|b)?)\s*(m|minor|maj|major)?\b", re.I)
BPM_RE = re.compile(r"\b(?:bpm|tempo)\s*[:=]?\s*(\d{2,3})\b|\b(\d{2,3})\s*bpm\b", re.I)
TIME_RE = re.compile(r"\b([2-9]|1[0-2])/([48])\b")
FLAT_TO_SHARP = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E"}


def parse_chart_text(text):
    """Section names with their lyric lines (chord lines dropped), plus key / bpm / time.
    Header lines (title, key / tempo, copyright) before the first section heading are not lyrics."""
    sections, cur = [], None
    key = bpm = tsig = None
    lines = [l.rstrip() for l in (text or "").splitlines()]
    has_headings = any(SECTION_RE.match(l) for l in lines if l.strip())
    title = None
    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        dm = re.match(r"^\{\s*([a-z_]+)\s*:\s*(.*?)\s*\}$", line.strip(), re.I)
        if dm:  # ChordPro directives
            dk, dv = dm.group(1).lower(), dm.group(2)
            if dk in ("title", "t"):
                title = dv
            elif dk == "key":
                k = FLAT_TO_SHARP.get(dv, dv)
                key = k.upper() if len(k) == 1 else k[0].upper() + k[1:]
            elif dk == "tempo" and dv.isdigit():
                bpm = int(dv)
            elif dk == "time":
                tsig = dv
            continue
        if title is None and not SECTION_RE.match(line):
            title = line.strip()
            if has_headings or (len(title) < 60 and not any(CHORD_RE.match(t) for t in title.split()) and len(title.split()) <= 8):
                continue  # the song title
        if key is None:
            m = KEY_RE.search(line)
            if m:
                k = m.group(1)
                k = FLAT_TO_SHARP.get(k, k)
                key = k.upper() if len(k) == 1 else k[0].upper() + k[1:]
        if bpm is None:
            m = BPM_RE.search(line)
            if m:
                bpm = int(m.group(1) or m.group(2))
        if tsig is None:
            m = TIME_RE.search(line)
            if m:
                tsig = m.group(1) + "/" + m.group(2)
        m = SECTION_RE.match(line)
        if m:
            name = m.group(1).lower()
            name = "Pre-Chorus" if name.startswith("pre") else name.capitalize()
            if m.group(2):
                name += " " + m.group(2).upper()
            cur = {"name": name, "lines": []}
            sections.append(cur)
            continue
        clean = re.sub(r"\[[^\]]*\]", "", line).strip()
        if not clean:
            continue
        toks = [t for t in clean.split() if t not in ("|", "||", "%", "/", "\u00b7", "-", "N.C.")]
        chordy = sum(1 for t in toks if CHORD_RE.match(t))
        if (toks and chordy / len(toks) >= 0.6) or (not toks and "|" in clean):
            continue  # a chord line (or a line of bars)
        if re.match(r"^(copyright|ccli|©|\(c\)|words and music|by |key\b|tempo\b|bpm\b|capo\b|time\b)", clean, re.I):
            continue
        if cur is None:
            if has_headings:
                continue  # header text before the first section
            cur = {"name": "Verse 1", "lines": []}
            sections.append(cur)
        cur["lines"].append(clean)
    return {"sections": sections, "key": key, "bpm": bpm, "time": tsig, "title": title}


class Charts:
    """charts/<id>/{original, page-N.png, chart.json}; ids are slug + short hash."""

    def __init__(self, root):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def new_id(self, name):
        base = slug(os.path.splitext(name)[0]) or "chart"
        return base[:40] + "-" + hashlib.sha1((name + str(time.time())).encode()).hexdigest()[:6]

    def chart_dir(self, chart_id):
        chart_id = re.sub(r"[^a-z0-9\-]", "", str(chart_id or ""))
        if not chart_id:
            return None
        return os.path.join(self.root, chart_id)

    def info(self, chart_id):
        d = self.chart_dir(chart_id)
        return read_json(os.path.join(d, "chart.json"), None) if d else None

    def page_path(self, chart_id, n):
        d = self.chart_dir(chart_id)
        return os.path.join(d, "page-%d.png" % int(n)) if d else None

    def listing(self):
        out = []
        try:
            for name in sorted(os.listdir(self.root)):
                info = read_json(os.path.join(self.root, name, "chart.json"), None)
                if info:
                    out.append({"id": info["id"], "name": info["name"], "pageCount": info.get("pageCount", 1), "key": info.get("key"), "bpm": info.get("bpm"), "time": info.get("time"), "sections": len(info.get("sections") or [])})
        except OSError:
            pass
        return out

    def delete(self, chart_id):
        d = self.chart_dir(chart_id)
        if d and os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)
            return True
        return False

    def from_text(self, name, text):
        chart_id = self.new_id(name or "chart")
        d = self.chart_dir(chart_id)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "chart.txt"), "w") as handle:
            handle.write(text or "")
        parsed = parse_chart_text(text)
        info = {"id": chart_id, "name": name or chart_id, "pageCount": 0, "file": "chart.txt", "text": text}
        info.update(parsed)
        for s in info["sections"]:
            s["page"] = 1
        write_json(os.path.join(d, "chart.json"), info)
        return info

    def from_file(self, name, data):
        name = safe_name(name)
        chart_id = self.new_id(name)
        d = self.chart_dir(chart_id)
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, name)
        with open(path, "wb") as handle:
            handle.write(data)
        lower = name.lower()
        display = re.sub(r"\.[^.]+$", "", name).replace("_", " ").strip()
        info = {"id": chart_id, "name": display or chart_id, "pageCount": 0, "file": name, "sections": [], "key": None, "bpm": None, "time": None, "text": ""}
        if lower.endswith(".pdf"):
            if shutil.which("pdftoppm"):
                code, _, err = run(["pdftoppm", "-r", "110", "-png", path, os.path.join(d, "p")], timeout=240)
                if code != 0:
                    log.warning("pdftoppm failed: %s", err.strip())
                pages = sorted((p for p in os.listdir(d) if p.startswith("p-") and p.endswith(".png")), key=lambda p: int(re.findall(r"\d+", p)[0]))
                for n, p in enumerate(pages, 1):
                    os.replace(os.path.join(d, p), os.path.join(d, "page-%d.png" % n))
                info["pageCount"] = len(pages)
            else:
                log.warning("poppler-utils is not installed - chart pages are not rendered")
            if shutil.which("pdftotext"):
                code, text, _ = run(["pdftotext", "-layout", path, "-"], timeout=60)
                if code == 0:
                    info["text"] = text
                    info.update(parse_chart_text(text))
                    self.locate_pages(path, info)
        elif lower.endswith((".png", ".jpg", ".jpeg")):
            try:
                from PIL import Image
                Image.open(path).convert("RGB").save(os.path.join(d, "page-1.png"))
            except Exception:
                shutil.copyfile(path, os.path.join(d, "page-1.png"))
            info["pageCount"] = 1
        else:
            try:
                text = data.decode("utf-8", "replace")
            except Exception:
                text = ""
            info["text"] = text
            info.update(parse_chart_text(text))
        for s in info["sections"]:
            s.setdefault("page", 1)
        write_json(os.path.join(d, "chart.json"), info)
        return info

    def locate_pages(self, pdf_path, info):
        """Which page each section heading is on (pdftotext -bbox), for auto page turns."""
        code, html, _ = run(["pdftotext", "-bbox", pdf_path, "-"], timeout=60)
        if code != 0:
            return
        found = []
        page_no = 0
        words = []
        for m in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', html):
            if m.group(1):
                page_no += 1
                continue
            words.append((page_no, float(m.group(4)), (m.group(7) or "").strip()))
        for i, (page, y, word) in enumerate(words):
            head = word.rstrip(":").strip("[]()")
            if SECTION_RE.match(head):
                nxt = words[i + 1][2].strip("[]():") if i + 1 < len(words) and words[i + 1][0] == page and abs(words[i + 1][1] - y) < 2 else ""
                name = head.lower()
                name = "Pre-Chorus" if name.startswith("pre") else name.capitalize()
                if re.match(r"^(\d+|[a-d])$", nxt, re.I):
                    name += " " + nxt.upper()
                found.append((name, page))
        for s in info["sections"]:
            for name, page in found:
                if slug(name) == slug(s["name"]):
                    s["page"] = page
                    break


class Cues:
    """Spoken cue words: pre-rendered /opt/pad-pedal/cues/*.wav + espeak-ng on demand."""

    def __init__(self, app_root, data_root):
        self.builtin = os.path.join(app_root, "cues")
        self.generated = os.path.join(data_root, "tts")
        self.custom = os.path.join(data_root, "cues")      # words recorded with a mic (your own MD's voice)
        os.makedirs(self.generated, exist_ok=True)
        os.makedirs(self.custom, exist_ok=True)

    def ids(self):
        out = set()
        for d in (self.builtin, self.generated, self.custom):
            try:
                out.update(n[:-4] for n in os.listdir(d) if n.endswith(".wav"))
            except OSError:
                pass
        return sorted(out)

    def custom_ids(self):
        try:
            return sorted(n[:-4] for n in os.listdir(self.custom) if n.endswith(".wav"))
        except OSError:
            return []

    def path(self, cue_id):
        cue_id = re.sub(r"[^a-z0-9\-]", "", str(cue_id or "").lower())
        for d in (self.custom, self.generated, self.builtin):
            p = os.path.join(d, cue_id + ".wav")
            if cue_id and os.path.isfile(p):
                return p
        return None

    def save_custom(self, cue_id, data):
        cue_id = re.sub(r"[^a-z0-9\-]", "", str(cue_id or "").lower())[:40]
        if not cue_id or len(data) < 100 or data[:4] != b"RIFF":
            raise ValueError("need a word and a WAV recording")
        p = os.path.join(self.custom, cue_id + ".wav")
        with open(p + ".part", "wb") as handle:
            handle.write(data)
        os.replace(p + ".part", p)
        return cue_id

    def remove_custom(self, cue_id):
        cue_id = re.sub(r"[^a-z0-9\-]", "", str(cue_id or "").lower())
        p = os.path.join(self.custom, cue_id + ".wav")
        if cue_id and os.path.isfile(p):
            os.remove(p)
            return True
        return False

    def tts(self, text):
        text = re.sub(r"\s+", " ", (text or "").strip())[:60]
        cue_id = slug(text)
        if not cue_id:
            return None
        existing = self.path(cue_id)
        if existing:
            return existing
        if not shutil.which("espeak-ng"):
            return None
        path = os.path.join(self.generated, cue_id + ".wav")
        code, _, err = run(["espeak-ng", "-v", "en-us", "-s", "165", "-p", "35", "-a", "180", "-w", path, text], timeout=20)
        if code != 0 or not os.path.isfile(path):
            log.warning("espeak-ng failed: %s", err.strip())
            return None
        return path


class Library:
    """Every audio file a song uses, kept on /data so the card is the source of truth:
    the app re-decodes a stem from here when its copy in the browser is gone (new card,
    restore, cleared profile), and the backup zip contains everything."""

    def __init__(self, data_root):
        self.root = os.path.join(data_root, "library")
        os.makedirs(self.root, exist_ok=True)
        self.data_root = data_root

    def song_dir(self, song):
        d = os.path.join(self.root, re.sub(r"[^\w\-]+", "-", str(song or "song"))[:60] or "song")
        os.makedirs(d, exist_ok=True)
        return d

    def inside(self, path):
        real = os.path.realpath(path or "")
        return real.startswith(os.path.realpath(self.root) + os.sep) and os.path.isfile(real)

    def store(self, song, name, data):
        name = safe_name(name)
        target = os.path.join(self.song_dir(song), name)
        base, ext = os.path.splitext(target)
        n = 2
        while os.path.exists(target) and os.path.getsize(target) != len(data):
            target = "%s (%d)%s" % (base, n, ext)
            n += 1
        if not os.path.exists(target):
            with open(target + ".part", "wb") as handle:
                handle.write(data)
            os.replace(target + ".part", target)
        return target

    def copy(self, song, path):
        if self.inside(path):
            return os.path.realpath(path)
        with open(path, "rb") as handle:
            return self.store(song, os.path.basename(path), handle.read())

    def remove(self, path):
        if self.inside(path):
            os.remove(os.path.realpath(path))
            d = os.path.dirname(os.path.realpath(path))
            if not os.listdir(d):
                os.rmdir(d)
            return True
        return False

    def listing(self):
        out = []
        for song in sorted(os.listdir(self.root)):
            d = os.path.join(self.root, song)
            if not os.path.isdir(d):
                continue
            files = [{"name": f, "path": os.path.join(d, f), "size": os.path.getsize(os.path.join(d, f))} for f in sorted(os.listdir(d)) if os.path.isfile(os.path.join(d, f))]
            out.append({"song": song, "files": files, "size": sum(f["size"] for f in files)})
        return out

    # ----- backup / restore: a zip of everything on /data/pad-pedal -----------
    BACKUP_DIRS = ("library", "charts", "uploads", "sounds", "tts", "cues", "lighting", "setlists")
    BACKUP_FILES = ("project.json", "hardware.json", "audio.json", "code", "code-chosen", "settings.json", "sources.json", "services.json")

    def backup(self, folder, progress=None):
        import zipfile
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError:
            pass
        if not os.path.isdir(folder) or not os.access(folder, os.W_OK):
            raise ValueError("no writable USB stick / SD card at " + str(folder))
        name = "central-control-backup-" + time.strftime("%Y-%m-%d-%H%M") + ".zip"
        target = os.path.join(folder, name)
        total = 0
        with zipfile.ZipFile(target + ".part", "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
            for fn in self.BACKUP_FILES:
                p = os.path.join(self.data_root, fn)
                if os.path.isfile(p):
                    zf.write(p, fn)
            for sub in self.BACKUP_DIRS:
                d = os.path.join(self.data_root, sub)
                if not os.path.isdir(d):
                    continue
                for base, _dirs, files in os.walk(d):
                    for f in files:
                        full = os.path.join(base, f)
                        if f.endswith(".part"):
                            continue
                        zf.write(full, os.path.relpath(full, self.data_root))
                        total += os.path.getsize(full)
                        if progress:
                            progress(total)
            zf.writestr("central-control-backup.json", json.dumps({"version": 6, "made": time.strftime("%Y-%m-%d %H:%M"), "bytes": total}))
        os.replace(target + ".part", target)
        try:
            os.sync()
        except Exception:
            pass
        return {"file": target, "size": os.path.getsize(target)}

    @staticmethod
    def backups_in(folder):
        out = []
        try:
            for f in sorted(os.listdir(folder), reverse=True):
                if f.startswith("central-control-backup-") and f.endswith(".zip"):
                    p = os.path.join(folder, f)
                    out.append({"name": f, "path": p, "size": os.path.getsize(p), "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(p)))})
        except OSError:
            pass
        return out

    def restore(self, path):
        import zipfile
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if "central-control-backup.json" not in names:
                raise ValueError("not a Central Pedal backup")
            root = os.path.realpath(self.data_root)
            n = 0
            for member in names:
                if member.endswith("/") or member == "central-control-backup.json":
                    continue
                dest = os.path.realpath(os.path.join(root, member))
                if not dest.startswith(root + os.sep):
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with zf.open(member) as src, open(dest + ".part", "wb") as out:
                    shutil.copyfileobj(src, out)
                os.replace(dest + ".part", dest)
                n += 1
        return {"files": n, "project": os.path.isfile(os.path.join(self.data_root, "project.json"))}

    # ----- software update from a source zip on a USB stick -------------------
    @staticmethod
    def updates_in(folder):
        import zipfile
        out = []
        try:
            for f in sorted(os.listdir(folder), reverse=True):
                if not f.endswith(".zip") or not re.search(r"central-control|pad-pedal", f, re.I) or "backup" in f:
                    continue
                p = os.path.join(folder, f)
                try:
                    with zipfile.ZipFile(p) as zf:
                        names = zf.namelist()
                    if any(n.endswith("pedal-driver.py") for n in names) and any(n.endswith("js/app.js") for n in names):
                        out.append({"name": f, "path": p, "size": os.path.getsize(p), "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(p)))})
                except Exception:
                    continue
        except OSError:
            pass
        return out


# ---------------------------------------------------------------------------
# HTTP servers
# ---------------------------------------------------------------------------
class HttpBase(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CentralControl/7"

    def log_message(self, fmt, *args):
        log.debug("http: " + fmt, *args)

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def send_file(self, path, content_type=None, cache=False):
        if not path or not os.path.isfile(path):
            return self.send_json(404, {"error": "not found"})
        size = os.path.getsize(path)
        ctype = content_type or mimetypes.guess_type(path)[0] or "application/octet-stream"
        if path.endswith(".js"):
            ctype = "text/javascript"
        start, end = 0, size - 1
        m = re.match(r"^bytes=(\d*)-(\d*)$", self.headers.get("Range") or "")
        if m and size and (m.group(1) or m.group(2)):   # videos seek with Range requests
            if m.group(1):
                start = int(m.group(1))
                end = min(size - 1, int(m.group(2))) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.end_headers()
                return None
            self.send_response(206)
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        else:
            self.send_response(200)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        if cache:
            self.send_header("Cache-Control", "max-age=3600")
        elif re.search(r"\.(html?|js|css)$", path or "", re.I):
            self.send_header("Cache-Control", "no-cache")   # (pages and scripts: always the version just installed)
        self.end_headers()
        if self.command == "HEAD":
            return None
        with open(path, "rb") as handle:
            handle.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = handle.read(min(1 << 16, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)
        return None

    def body(self, limit=700 * 1024 * 1024):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > limit:
            return b""
        data = bytearray()
        while len(data) < length:
            chunk = self.rfile.read(min(1 << 20, length - len(data)))
            if not chunk:
                break
            data += chunk
        return bytes(data)

    def serve_static(self, root, rel, index="index.html"):
        rel = urllib.parse.unquote(rel).lstrip("/")
        real = os.path.realpath(os.path.join(root, rel or index))
        if os.path.isdir(real):
            real = os.path.join(real, index)
        root_real = os.path.realpath(root)
        if not (real == root_real or real.startswith(root_real + os.sep)):
            return self.send_json(403, {"error": "not allowed"})
        return self.send_file(real)

    def is_local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")


class LocalServer:
    """http://127.0.0.1:8766 - the app, USB/SD browser, charts, cue words, uploads."""

    def __init__(self, driver, port, host="127.0.0.1"):
        self.driver = driver
        self.port = port
        self.host = host
        self.httpd = None

    @property
    def roots(self):
        roots = list(self.driver.config.get("media_roots") or []) + [self.driver.uploads_dir, self.driver.library.root]
        return [os.path.realpath(r) for r in roots]

    def allowed(self, path):
        real = os.path.realpath(path)
        return any(real == r or real.startswith(r + os.sep) for r in self.roots if os.path.isdir(r)), real

    def drives(self):
        out = []
        for root in self.roots:
            if not os.path.isdir(root):
                continue
            if os.path.basename(root) == "media":
                for name in sorted(os.listdir(root)):
                    full = os.path.join(root, name)
                    if not os.path.isdir(full) or name.startswith("."):
                        continue
                    if os.path.ismount(full) or name.startswith("usb-"):
                        out.append({"name": name.replace("usb-", "USB / SD ").strip(), "path": full})
                    else:
                        for sub in sorted(os.listdir(full)) if os.access(full, os.R_OK) else []:
                            subfull = os.path.join(full, sub)
                            if os.path.isdir(subfull) and os.path.ismount(subfull):
                                out.append({"name": sub, "path": subfull})
            else:
                label = {"sounds": "Pad Pedal sounds folder", "Music": "Music folder", "uploads": "Uploaded over Wi-Fi"}.get(os.path.basename(root), os.path.basename(root))
                out.append({"name": label, "path": root})
        return out

    def listing(self, path, kinds):
        ok, real = self.allowed(path)
        if not ok or not os.path.isdir(real):
            return None
        dirs, files = [], []
        for name in sorted(os.listdir(real), key=str.lower):
            if name.startswith("."):
                continue
            full = os.path.join(real, name)
            if os.path.isdir(full):
                dirs.append({"name": name, "path": full})
            elif name.lower().endswith(kinds):
                try:
                    files.append({"name": name, "path": full, "size": os.path.getsize(full)})
                except OSError:
                    pass
        return {"path": real, "dirs": dirs, "files": files}

    def handler(self):
        server = self
        driver = self.driver

        class Handler(HttpBase):
            def do_HEAD(self):
                self.do_GET()

            def do_GET(self):
                url = urllib.parse.urlparse(self.path)
                query = urllib.parse.parse_qs(url.query)
                path = (query.get("path") or [""])[0]
                p = url.path
                if p.startswith("/practice/"):   # practice mixes kept here
                    pm = driver.practice
                    if p == "/practice/caps":
                        return self.send_json(200, pm.caps())
                    if p == "/practice/list":
                        return self.send_json(200, {"folders": pm.listing(), "caps": pm.caps()})
                    if p == "/practice/file":
                        f = pm.path((query.get("folder") or [""])[0], (query.get("name") or [""])[0])
                        return self.send_file(f) if f else self.send_json(404, {"error": "no such file"})
                    return self.send_json(404, {"error": "unknown"})
                if p.startswith("/split/"):   # the stem splitter (Demucs)
                    if p == "/split/status":
                        return self.send_json(200, driver.splitter.status())
                    if p == "/split/file":
                        f = driver.splitter.file_path((query.get("id") or [""])[0], (query.get("rel") or [""])[0])
                        return self.send_file(f, "application/octet-stream") if f else self.send_json(404, {"error": "no such file"})
                    return self.send_json(404, {"error": "unknown"})
                if p.startswith("/sync/"):
                    sync = driver.sync
                    if p == "/sync/status":
                        return self.send_json(200, sync.status())
                    if p == "/sync/setlists":
                        return self.send_json(200, {"setlists": sync.setlists_listing()})
                    if p == "/sync/songs":
                        return self.send_json(200, {"songs": sync.songs_listing()})
                    if p.startswith("/sync/song/"):
                        song = sync.song_for_app(urllib.parse.unquote(p[len("/sync/song/"):]))
                        return self.send_json(200, song) if song else self.send_json(404, {"error": "no such song"})
                    if p.startswith("/sync/setlist/"):
                        sl = sync.setlist_for_app(urllib.parse.unquote(p[len("/sync/setlist/"):]))
                        return self.send_json(200, sl) if sl else self.send_json(404, {"error": "no such setlist"})
                    return self.send_json(404, {"error": "unknown"})
                if p in ("/", "/app"):
                    self.send_response(302)
                    self.send_header("Location", "/app/#perform")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return None
                if p.startswith("/app/"):
                    return self.serve_static(driver.config["app_root"], p[5:])
                if p == "/roots":
                    return self.send_json(200, {"dirs": server.drives(), "files": []})
                if p == "/list":
                    want = (query.get("kind") or [""])[0]
                    kinds = AUDIO_EXTENSIONS + CHART_EXTENSIONS if want == "all" else SF2_EXTENSIONS + (".wav",) if want == "sf2" else (".zip",) + AUDIO_EXTENSIONS if want == "pack" else AUDIO_EXTENSIONS
                    result = server.listing(path, kinds)
                    return self.send_json(200, result) if result else self.send_json(403, {"error": "not allowed"})
                if p == "/file":
                    ok, real = server.allowed(path)
                    if not ok or not os.path.isfile(real) or not real.lower().endswith(AUDIO_EXTENSIONS + CHART_EXTENSIONS):
                        return self.send_json(403, {"error": "not allowed"})
                    return self.send_file(real)
                if p == "/cues":
                    return self.send_json(200, {"cues": driver.cues.ids(), "custom": driver.cues.custom_ids(), "tts": shutil.which("espeak-ng") is not None})
                if p.startswith("/cues/"):
                    return self.send_file(driver.cues.path(p[6:-4] if p.endswith(".wav") else p[6:]), "audio/wav", cache=False)
                if p == "/tts":
                    wav = driver.cues.tts((query.get("text") or [""])[0])
                    if wav:
                        return self.send_file(wav, "audio/wav", cache=True)
                    # no speech engine on this machine (espeak-ng missing): "nothing to play", not an error the page logs
                    self.send_response(204)
                    self.cors()
                    self.send_header("X-No-Speech", "1")
                    self.end_headers()
                    return None
                if p == "/charts":
                    return self.send_json(200, {"charts": driver.charts.listing()})
                if p.startswith("/charts/"):
                    parts = p.split("/")
                    chart_id = parts[2] if len(parts) > 2 else ""
                    name = parts[3] if len(parts) > 3 else "chart.json"
                    if name == "chart.json":
                        info = driver.charts.info(chart_id)
                        return self.send_json(200, info) if info else self.send_json(404, {"error": "no such chart"})
                    m = re.match(r"^page-(\d+)\.png$", name)
                    if m:
                        return self.send_file(driver.charts.page_path(chart_id, m.group(1)), "image/png", cache=True)
                    return self.send_json(404, {"error": "unknown"})
                if p == "/status":
                    return self.send_json(200, driver.system_status())
                if p == "/libraries":   # the sound libraries installed here, and any being installed
                    return self.send_json(200, library_state(driver))
                if p == "/libraries/pads":   # Central Pads: the pad styles installed here (the pad pedal's voice list)
                    st = library_store(driver)
                    return self.send_json(200, {"pads": st.pads() if st else []})
                if p == "/libraries/loops":   # 10.0: the loops installed here (drum loops at a tempo, ambient loops in a key) for the texture channels
                    st = library_store(driver)
                    return self.send_json(200, {"loops": st.loops() if st and hasattr(st, "loops") else []})
                if p == "/libraries/loop":   # one loop's WAV: ?lib=<library id>&file=<set>/<file>
                    st = library_store(driver)
                    qs = urllib.parse.parse_qs(url.query)
                    f = st.loop_file((qs.get("lib") or [""])[0], (qs.get("file") or [""])[0]) if st and hasattr(st, "loop_file") else None
                    return self.send_file(f, "audio/wav", cache=True) if f else self.send_json(404, {"error": "no such loop"})
                if p == "/libraries/pad":   # one pad style's loop in one key: ?lib=<library id>&style=<name>&key=C#
                    st = library_store(driver)
                    qs = urllib.parse.parse_qs(url.query)
                    f = st.pad_file((qs.get("lib") or [""])[0], (qs.get("style") or [""])[0], (qs.get("key") or [""])[0]) if st else None
                    return self.send_file(f, "audio/wav", cache=True) if f else self.send_json(404, {"error": "no such pad"})
                if p == "/library":
                    return self.send_json(200, {"songs": driver.library.listing(), "root": driver.library.root})
                if p.startswith("/pco/") and driver.pco:
                    try:
                        if p == "/pco/status":
                            return self.send_json(200, {"configured": driver.pco.configured()})
                        if p == "/pco/service-types":
                            return self.send_json(200, {"serviceTypes": driver.pco.service_types()})
                        if p == "/pco/plans":
                            return self.send_json(200, {"plans": driver.pco.plans((query.get("type") or [""])[0])})
                        if p == "/pco/items":
                            return self.send_json(200, {"items": driver.pco.items((query.get("type") or [""])[0], (query.get("plan") or [""])[0])})
                    except ValueError as error:
                        return self.send_json(400, {"error": str(error)})
                if p in ("/backups", "/updates"):  # what is on the USB stick / SD card
                    skip = (os.path.realpath(driver.uploads_dir), os.path.realpath(driver.library.root))
                    drives = [d for d in server.drives() if not os.path.realpath(d["path"]).startswith(skip)]
                    out = []
                    for d in drives:
                        folder = os.path.join(d["path"], "Central Control")
                        if p == "/backups":
                            found = Library.backups_in(folder) + Library.backups_in(d["path"])
                        else:
                            found = Library.updates_in(d["path"]) + Library.updates_in(folder)
                        out.append({"drive": d["name"], "path": d["path"], "files": found, "free": shutil.disk_usage(d["path"]).free if os.path.isdir(d["path"]) else 0})
                    return self.send_json(200, {"drives": out})
                if p == "/api/whoami":   # (Central Pedal Control's Mac app checks that the driver on this port is its own)
                    return self.send_json(200, {"pedalControl": PEDAL_CONTROL, "appVersion": APP_VERSION})
                if p == "/pedal/loaded-set":
                    return self.send_json(200, {"set": driver.transfer.loaded_set()})
                if p in ("/set/bank", "/set/bank-info"):   # Central Pedal Control: a keys / instrument sound a set uses
                    bank = driver.transfer.bank_known((query.get("path") or [""])[0])
                    if not bank:
                        return self.send_json(404, {"error": "not a sound here"})
                    if p == "/set/bank":
                        return self.send_file(bank["file"], "application/octet-stream")
                    return self.send_json(200, {"file": bank["file"], "name": os.path.basename(bank["file"]), "size": os.path.getsize(bank["file"]),
                                                "sha": driver.transfer.sha_cached(bank["file"]), "tier": bank.get("tier") or None})
                if p == "/pedal/package":   # an upload from Central Pedal Control, for the app here to apply
                    pk = driver.transfer.local_package((query.get("token") or [""])[0])
                    return self.send_json(200, pk) if pk else self.send_json(404, {"error": "no such upload"})
                if p == "/pedal/file":
                    path = driver.transfer.file_path((query.get("token") or [""])[0], (query.get("id") or [""])[0], "in")
                    return self.send_file(path, "application/octet-stream") if path else self.send_json(404, {"error": "no such file"})
                if p == "/project":
                    pj = os.path.join(driver.config["data_root"], "project.json")
                    return self.send_file(pj, "application/json") if os.path.isfile(pj) else self.send_json(200, {})
                return self.send_json(404, {"error": "unknown"})

            def do_PUT(self):
                url = urllib.parse.urlparse(self.path)
                query = urllib.parse.parse_qs(url.query)
                if url.path in ("/practice/file", "/split/upload", "/libraries/file") and not local_origin_ok(self.headers):
                    return self.send_json(403, {"error": "only the app can do that"})
                if url.path == "/libraries/file":   # Install from a file…: a library zip (checked against ?sha256= when the app knows it)
                    st = library_store(driver)
                    if not st:
                        self.body(1)
                        return self.send_json(500, {"error": "sound libraries aren't available here"})
                    data = self.body(1536 * 1024 * 1024)
                    if not data:
                        return self.send_json(400, {"error": "empty file (or too big)"})
                    sha = (query.get("sha256") or [""])[0] or None
                    try:
                        rec = st.install_bytes(data, expected_sha256=sha, source="file")
                    except ValueError as error:
                        return self.send_json(400, {"error": str(error)})
                    library_installed(driver, rec)
                    return self.send_json(200, {"ok": True, "record": {"id": rec["id"], "version": rec["version"], "counts": rec.get("counts")}, "installed": st.listing()})
                if url.path == "/practice/file":   # one practice mix (a WAV, or the playlist) from the app
                    q1 = lambda k, dflt="": (query.get(k) or [dflt])[0]
                    try:
                        reply = driver.practice.save(q1("folder"), q1("name"), self.body(), q1("format", "wav"), int(q1("kbps", "192") or 192), q1("usb") == "1")
                    except (ValueError, OSError) as error:
                        return self.send_json(400, {"error": str(error)})
                    return self.send_json(200, reply)
                if url.path == "/split/upload":   # a song to split into stems
                    try:
                        return self.send_json(200, driver.splitter.upload((query.get("name") or ["song.wav"])[0], self.body()))
                    except (ValueError, OSError) as error:
                        return self.send_json(400, {"error": str(error)})
                if url.path == "/export":  # save a file onto the first USB stick / SD card
                    name = safe_name((query.get("name") or ["export"])[0])
                    data = self.body()
                    for root in driver.config.get("media_roots") or []:
                        if os.path.basename(root) == "media" and os.path.isdir(root):
                            for d in sorted(os.listdir(root)):
                                full = os.path.join(root, d)
                                if os.path.isdir(full) and (os.path.ismount(full) or d.startswith("usb-")) and os.access(full, os.W_OK):
                                    target = os.path.join(full, "Central Control", name)
                                    os.makedirs(os.path.dirname(target), exist_ok=True)
                                    with open(target, "wb") as handle:
                                        handle.write(data)
                                    return self.send_json(200, {"ok": True, "path": target})
                    return self.send_json(404, {"error": "no USB stick or SD card found"})
                if url.path == "/upload":
                    kind = (query.get("kind") or ["stems"])[0]
                    name = (query.get("name") or [self.headers.get("X-File-Name") or "upload"])[0]
                    song = (query.get("song") or [""])[0]
                    data = self.body()
                    if not data:
                        return self.send_json(400, {"error": "empty upload"})
                    return self.send_json(200, driver.handle_upload(kind, name, song, data, announce=kind != "charts"))
                if url.path == "/cues/record":  # a cue word recorded with a mic (WAV body), in the MD's own voice
                    try:
                        cue_id = driver.cues.save_custom((query.get("id") or [""])[0], self.body(1 << 24))
                    except ValueError as error:
                        return self.send_json(400, {"error": str(error)})
                    return self.send_json(200, {"ok": True, "id": cue_id, "cues": driver.cues.ids(), "custom": driver.cues.custom_ids()})
                if url.path == "/library":  # the app keeps a copy of every song file here
                    name = (query.get("name") or [self.headers.get("X-File-Name") or "audio"])[0]
                    song = (query.get("song") or ["song"])[0]
                    data = self.body()
                    if not data:
                        return self.send_json(400, {"error": "empty file"})
                    return self.send_json(200, {"ok": True, "path": driver.library.store(song, name, data)})
                self.body()
                return self.send_json(404, {"error": "unknown"})

            def json_body(self, limit=1 << 16):
                try:
                    return json.loads(self.body(limit).decode() or "{}")
                except Exception:
                    return None

            def do_POST(self):
                url = urllib.parse.urlparse(self.path)
                if url.path == "/license/state":   # the app's license setup, kept with the data (a Central Pedal's browser profile can be wiped)
                    if not local_origin_ok(self.headers):
                        return self.send_json(403, {"error": "only the app can do that"})
                    payload = self.json_body()
                    if not isinstance(payload, dict) or len(json.dumps(payload)) > 8000:
                        return self.send_json(400, {"error": "not a license state"})
                    write_json(os.path.join(driver.config["data_root"], "license-state.json"), payload)
                    return self.send_json(200, {"ok": True})
                if url.path.startswith("/practice/") or url.path.startswith("/split/"):
                    if not local_origin_ok(self.headers):
                        return self.send_json(403, {"error": "only the app can do that"})
                    payload = self.json_body() or {}
                    pm, sp = driver.practice, driver.splitter
                    try:
                        if url.path == "/practice/config":
                            return self.send_json(200, pm.configure(payload))
                        if url.path == "/practice/delete":
                            return self.send_json(200, pm.delete(payload.get("folder"), payload.get("name")))
                        if url.path == "/practice/usb":
                            return self.send_json(200, pm.to_usb(payload.get("folder")))
                        if url.path == "/practice/copy":
                            return self.send_json(200, pm.copy_to(payload.get("folder"), payload.get("dest")))
                        if url.path == "/split/install":
                            return self.send_json(200, sp.install())
                        if url.path == "/split/uninstall":
                            return self.send_json(200, sp.uninstall())
                        if url.path == "/split/config":
                            return self.send_json(200, sp.configure(payload))
                        if url.path == "/split/start":
                            return self.send_json(200, sp.start(payload.get("path"), payload.get("opts") or {}))
                        if url.path == "/split/resplit":
                            return self.send_json(200, sp.resplit(payload.get("id"), payload.get("rel"), payload.get("kind"), payload.get("opts")))
                        if url.path == "/split/cancel":
                            return self.send_json(200, sp.cancel(payload.get("id")))
                        if url.path == "/split/forget":
                            return self.send_json(200, sp.forget(payload.get("id")))
                    except (ValueError, OSError) as error:
                        return self.send_json(400, {"error": str(error)})
                    return self.send_json(404, {"error": "unknown"})
                if url.path in ("/pedal/export-file", "/pedal/export-done"):   # the app here answering a Download
                    q = urllib.parse.parse_qs(url.query)
                    token = (q.get("token") or [""])[0]
                    if url.path == "/pedal/export-file":
                        code_, reply = driver.transfer.put_file(token, (q.get("id") or [""])[0], "", "", "sample", self.body(), out=True)
                        return self.send_json(code_, reply)
                    pkg = self.json_body(64 << 20)
                    code_, reply = driver.transfer.export_done(token, pkg)
                    if code_ == 200 and isinstance(pkg, dict) and not pkg.get("error") and "songs" in (pkg.get("parts") or []):
                        driver.transfer.set_brought_back()   # (the set's changes made here are in Central Pedal Control now)
                    return self.send_json(code_, reply)
                if url.path in ("/pedal/set-commit", "/pedal/set-done", "/pedal/set-state"):   # the app here and its set
                    q = urllib.parse.parse_qs(url.query)
                    token = (q.get("token") or [""])[0]
                    if url.path == "/pedal/set-state":
                        code_, reply = driver.transfer.set_state(self.json_body() or {})
                    elif url.path == "/pedal/set-commit":
                        self.body(1 << 16)   # (read what came with it: a body left unread spoils the next request)
                        code_, reply = driver.transfer.set_commit(token)
                    else:
                        code_, reply = driver.transfer.set_done(token, self.json_body() or {})
                    return self.send_json(code_, reply)
                if url.path.startswith("/pco/") or url.path.startswith("/pack/"):
                    payload = self.json_body()
                    if payload is None:
                        return self.send_json(400, {"error": "not JSON"})
                    if not sources:
                        return self.send_json(500, {"error": "sources module missing"})
                    try:
                        return self.send_json(200, driver.source_action(url.path, payload))
                    except (ValueError, OSError, zipfile.BadZipFile) as error:
                        return self.send_json(400, {"error": str(error)})
                if url.path.startswith("/library/") or url.path in ("/backup", "/restore", "/update", "/cues/remove"):
                    payload = self.json_body()
                    if payload is None:
                        return self.send_json(400, {"error": "not JSON"})
                    try:
                        if url.path == "/library/copy":
                            ok, real = driver.local.allowed(payload.get("path") or "") if driver.local else (False, "")
                            if not ok or not os.path.isfile(real):
                                return self.send_json(403, {"error": "file not allowed"})
                            return self.send_json(200, {"ok": True, "path": driver.library.copy(payload.get("song") or "song", real)})
                        if url.path == "/cues/remove":
                            return self.send_json(200, {"ok": driver.cues.remove_custom(payload.get("id")), "cues": driver.cues.ids(), "custom": driver.cues.custom_ids()})
                        if url.path == "/library/remove":
                            return self.send_json(200, {"ok": driver.library.remove(payload.get("path") or "")})
                        if url.path == "/backup":
                            folder = payload.get("path") or ""
                            ok, real = driver.local.allowed(folder) if driver.local else (False, "")
                            if not ok:
                                return self.send_json(403, {"error": "folder not allowed"})
                            driver.emit({"type": "backup", "state": "running"})
                            info = driver.library.backup(os.path.join(real, "Central Control") if os.path.basename(real) != "Central Control" else real)
                            driver.emit({"type": "backup", "state": "done", "file": info["file"], "size": info["size"]})
                            return self.send_json(200, dict(info, ok=True))
                        if url.path == "/restore":
                            ok, real = driver.local.allowed(payload.get("file") or "") if driver.local else (False, "")
                            if not ok or not os.path.isfile(real):
                                return self.send_json(403, {"error": "file not allowed"})
                            info = driver.library.restore(real)
                            return self.send_json(200, dict(info, ok=True))
                        if url.path == "/update":
                            ok, real = driver.local.allowed(payload.get("file") or "") if driver.local else (False, "")
                            if not ok or not os.path.isfile(real):
                                return self.send_json(403, {"error": "file not allowed"})
                            return self.send_json(200, driver.software_update(real))
                    except (ValueError, OSError) as error:
                        return self.send_json(400, {"error": str(error)})
                    return self.send_json(404, {"error": "unknown"})
                if url.path in ("/libraries/install", "/libraries/remove"):   # a sound library: from the website's list / taken away
                    if not local_origin_ok(self.headers):
                        return self.send_json(403, {"error": "only the app can do that"})
                    payload = self.json_body() or {}
                    if not library_store(driver):
                        return self.send_json(500, {"error": "sound libraries aren't available here"})
                    try:
                        if url.path == "/libraries/install":
                            return self.send_json(200, library_install_async(driver, payload))
                        reply = library_store(driver).remove(str(payload.get("id") or ""))
                        library_installed(driver, None)
                        return self.send_json(200, dict(reply, installed=library_store(driver).listing()))
                    except ValueError as error:
                        return self.send_json(400, {"error": str(error)})
                if url.path == "/chart/text":
                    try:
                        payload = json.loads(self.body(1 << 22).decode() or "{}")
                    except Exception:
                        return self.send_json(400, {"error": "not JSON"})
                    info = driver.charts.from_text(payload.get("name") or "Chart", payload.get("text") or "")
                    return self.send_json(200, info)
                if url.path == "/instrument/sf2":  # copy a SoundFont from a USB stick / SD card into the keys sounds
                    try:
                        payload = json.loads(self.body(1 << 16).decode() or "{}")
                    except Exception:
                        return self.send_json(400, {"error": "not JSON"})
                    if not driver.instrument:
                        return self.send_json(500, {"error": "instrument host not available"})
                    ok, real = driver.local.allowed(payload.get("path") or "") if driver.local else (False, "")
                    if not ok or not os.path.isfile(real) or not real.lower().endswith(SF2_EXTENSIONS):
                        return self.send_json(403, {"error": "file not allowed"})
                    try:
                        with open(real, "rb") as fh:
                            info = driver.instrument.add_sf2(os.path.basename(real), fh.read())
                        return self.send_json(200, {"ok": True, "name": os.path.basename(real), "presets": info["presets"], "file": info["file"]})
                    except (ValueError, OSError) as error:
                        return self.send_json(400, {"error": str(error)})
                if url.path == "/instrument/ir":  # an impulse response (.wav) from a USB stick for the IR loader pedal
                    try:
                        payload = json.loads(self.body(1 << 16).decode() or "{}")
                    except Exception:
                        return self.send_json(400, {"error": "not JSON"})
                    if not driver.instrument:
                        return self.send_json(500, {"error": "instrument host not available"})
                    ok, real = driver.local.allowed(payload.get("path") or "") if driver.local else (False, "")
                    if not ok or not os.path.isfile(real) or not real.lower().endswith((".wav", ".flac")):
                        return self.send_json(403, {"error": "file not allowed"})
                    try:
                        with open(real, "rb") as fh:
                            info = driver.instrument.add_ir(os.path.basename(real), fh.read())
                        return self.send_json(200, {"ok": True, "file": info["file"]})
                    except (ValueError, OSError) as error:
                        return self.send_json(400, {"error": str(error)})
                if url.path == "/instrument/wavbank":  # a folder of WAVs named by note (on a USB stick) -> SoundFont
                    try:
                        payload = json.loads(self.body(1 << 16).decode() or "{}")
                    except Exception:
                        return self.send_json(400, {"error": "not JSON"})
                    if not driver.instrument:
                        return self.send_json(500, {"error": "instrument host not available"})
                    ok, real = driver.local.allowed(payload.get("path") or "") if driver.local else (False, "")
                    if not ok or not os.path.isdir(real):
                        return self.send_json(403, {"error": "folder not allowed"})
                    try:
                        return self.send_json(200, driver.instrument.add_wav_bank(payload.get("name") or os.path.basename(real), real))
                    except ValueError as error:
                        return self.send_json(400, {"error": str(error)})
                if url.path == "/project":
                    data = self.body()
                    try:
                        json.loads(data.decode())
                    except Exception:
                        return self.send_json(400, {"error": "not JSON"})
                    target = os.path.join(driver.config["data_root"], "project.json")
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with open(target + ".part", "wb") as handle:
                        handle.write(data)
                    os.replace(target + ".part", target)
                    try:
                        driver.sync.from_project(json.loads(data.decode()))
                    except Exception as error:
                        log.warning("sync: %s", error)
                    return self.send_json(200, {"ok": True, "size": len(data)})
                if url.path.startswith("/sync/"):
                    payload = self.json_body() or {}
                    sync = driver.sync
                    if url.path == "/sync/link":
                        return self.send_json(200, sync.link(payload.get("address"), payload.get("port") or 8080, payload.get("code")))
                    if url.path == "/sync/unlink":
                        return self.send_json(200, sync.unlink())
                    if url.path == "/sync/delete":
                        return self.send_json(200, sync.delete(payload.get("kind"), payload.get("id"), payload.get("scope")))
                    if url.path == "/sync/name":
                        sync.rename(payload.get("name"))
                        return self.send_json(200, sync.status())
                    if url.path == "/sync/now":
                        sync.wake.set()
                        return self.send_json(200, {"ok": True})
                    return self.send_json(404, {"error": "unknown"})
                if url.path == "/upload":
                    return self.do_PUT()
                self.body()
                return self.send_json(404, {"error": "unknown"})

            def do_DELETE(self):
                url = urllib.parse.urlparse(self.path)
                if url.path.startswith("/charts/"):
                    return self.send_json(200, {"ok": driver.charts.delete(url.path.split("/")[2])})
                if url.path == "/file":
                    path = (urllib.parse.parse_qs(url.query).get("path") or [""])[0]
                    ok, real = server.allowed(path)
                    if ok and real.startswith(os.path.realpath(driver.uploads_dir) + os.sep) and os.path.isfile(real):
                        os.remove(real)
                        return self.send_json(200, {"ok": True})
                    return self.send_json(403, {"error": "not allowed"})
                return self.send_json(404, {"error": "unknown"})

        return Handler

    def start(self):
        try:
            self.httpd = ThreadingHTTPServer((self.host, self.port), self.handler())
            self.httpd.daemon_threads = True
        except OSError as error:
            log.warning("local web server could not start on port %s (%s)", self.port, error)
            return False
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        log.info("app + USB/SD browser on http://%s:%s/app/ (media roots: %s)", self.host, self.port, ", ".join(self.roots))
        return True

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()


class CompanionServer:
    """http://<pi>:8080 for phones / tablets / laptops: charts, lyrics, remote, upload."""

    def __init__(self, driver, port, host="0.0.0.0"):
        self.driver = driver
        self.port = port
        self.host = host
        self.httpd = None

    def handler(self):
        driver = self.driver

        class Handler(HttpBase):
            def do_HEAD(self):
                self.do_GET()

            def do_GET(self):
                url = urllib.parse.urlparse(self.path)
                p = url.path
                root = os.path.join(driver.config["app_root"], "companion")
                pages = {"/": "index.html", "/index.html": "index.html", "/charts": "index.html", "/charts/": "index.html",
                         "/lyrics": "lyrics.html", "/lyrics/": "lyrics.html", "/upload": "upload.html", "/upload/": "upload.html",
                         "/remote": "remote.html", "/remote/": "remote.html", "/mini": "mini.html", "/mini/": "mini.html", "/stage": "stage.html", "/stage/": "stage.html", "/slides": "slides.html", "/slides/": "slides.html"}
                if p in ("/setup", "/setup/"):   # phone setup (Wi-Fi, touch screen, code) - also on the pedal's own setup Wi-Fi
                    return driver.phone_setup.send_page(self)
                if p == "/setup/state":
                    return self.send_json(200, driver.phone_setup.state())
                if p == "/cu":
                    self.send_response(302)
                    self.send_header("Location", "/cu/")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if p.startswith("/cu/"):   # Central Control for iPhone / iPad (and any browser): User 1 / User 2, served from here
                    app_root = driver.config["app_root"]
                    rel = p[len("/cu/"):]
                    if rel == "manifest.webmanifest":
                        body = json.dumps({"name": "Central Control", "short_name": "Central Control", "start_url": "/cu/", "scope": "/cu/", "display": "standalone",
                                           "background_color": "#08111d", "theme_color": "#08111d", "icons": [{"src": "/cu/icon.png", "sizes": "512x512", "type": "image/png"}]}).encode()
                        self.send_response(200)
                        self.send_header("Content-Type", "application/manifest+json")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return
                    if rel == "icon.png":
                        icon = os.path.join(app_root, "central-usage", "build", "icon-usage.png")   # (Central Usage's icon)
                        return self.send_file(icon if os.path.isfile(icon) else os.path.join(app_root, "central-usage", "build", "icon.png"), "image/png", cache=True)
                    if rel.startswith("shared/"):
                        name = rel[len("shared/"):]
                        return self.serve_static(os.path.join(app_root, "css" if name.endswith(".css") else "js"), name)
                    if rel.startswith("fonts/"):
                        return self.serve_static(os.path.join(app_root, "fonts"), rel[len("fonts/"):])
                    return self.serve_static(os.path.join(app_root, "central-usage", "app"), rel)
                if p == "/control":
                    self.send_response(302)
                    self.send_header("Location", "/control/")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if p.startswith("/control/"):   # Central Pedal Control in any browser (an iPad: Share → Add to Home Screen)
                    app_root = driver.config["app_root"]
                    rel = p[len("/control/"):]
                    if rel in ("", "index.html"):
                        try:
                            with open(os.path.join(app_root, "index.html"), encoding="utf-8") as handle:
                                page = handle.read()
                        except OSError:
                            return self.send_json(404, {"error": "no app"})
                        head = ('<head>\n  <script>window.CP_CONTROL = true;</script>\n  <link rel="manifest" href="manifest.webmanifest">\n'
                                '  <meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">\n'
                                '  <meta name="apple-mobile-web-app-status-bar-style" content="black"><meta name="apple-mobile-web-app-title" content="Pedal Control">\n'
                                '  <link rel="apple-touch-icon" href="icon.png">')
                        body = page.replace("<head>", head, 1).replace("<title>Central Pedal</title>", "<title>Central Pedal Control</title>", 1).encode()
                        self.send_response(200)
                        self.send_header("Content-Type", "text/html; charset=utf-8")
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        if self.command != "HEAD":
                            self.wfile.write(body)
                        return
                    if rel == "manifest.webmanifest":
                        body = json.dumps({"name": "Central Pedal Control", "short_name": "Pedal Control", "start_url": "/control/", "scope": "/control/", "display": "standalone",
                                           "background_color": "#111317", "theme_color": "#111317", "icons": [{"src": "/control/icon.png", "sizes": "512x512", "type": "image/png"}]}).encode()
                        self.send_response(200)
                        self.send_header("Content-Type", "application/manifest+json")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        if self.command != "HEAD":
                            self.wfile.write(body)
                        return
                    if rel == "icon.png":
                        for icon in (os.path.join(app_root, "central-pedal-control", "build", "icon.png"), os.path.join(app_root, "central-usage", "build", "icon.png")):
                            if os.path.isfile(icon):
                                return self.send_file(icon, "image/png", cache=True)
                        return self.send_json(404, {"error": "no icon"})
                    if re.match(r"^(css|js|fonts|cues)/", rel):   # (only the app's own files - never the driver or settings)
                        return self.serve_static(app_root, rel)
                    return self.send_json(404, {"error": "unknown"})
                if p == "/practice":
                    self.send_response(302)
                    self.send_header("Location", "/practice/")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if p.startswith("/practice/"):   # practice mixes for the band's phones (a setting: open / pairing code / off)
                    pm = driver.practice
                    code = (urllib.parse.parse_qs(url.query).get("code") or [""])[0]
                    ip = self.client_address[0] if self.client_address else ""
                    if p == "/practice/":
                        body = pm.page(code, ip).encode()
                        self.send_response(200)
                        self.cors()
                        self.send_header("Content-Type", "text/html; charset=utf-8")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        if self.command != "HEAD":
                            self.wfile.write(body)
                        return
                    if not pm.allowed(code, ip):
                        return self.send_json(403, {"error": "practice mixes need the practice code"})
                    parts = [urllib.parse.unquote(x) for x in p[len("/practice/"):].split("/")]
                    f = pm.path(parts[0], parts[1]) if len(parts) == 2 else None
                    return self.send_file(f) if f else self.send_json(404, {"error": "no such file"})
                if p in ("/api/pedal/export", "/api/pedal/export-file"):   # Central Pedal Control's Download (its token)
                    q = urllib.parse.parse_qs(url.query)
                    token = (q.get("token") or [""])[0]
                    if p == "/api/pedal/export":
                        code_, reply = driver.transfer.export_state(token)
                        return self.send_json(code_, reply)
                    path = driver.transfer.file_path(token, (q.get("id") or [""])[0], "out")
                    return self.send_file(path, "application/octet-stream") if path else self.send_json(404, {"error": "no such file"})
                if p.startswith("/api/sync/"):   # another Central Pedal of the same group pulling songs
                    sync = driver.sync
                    if not sync.auth_ok(self.headers, p):
                        return self.send_json(403, {"error": "not linked"})
                    if p == "/api/sync/index":
                        return self.send_json(200, sync.index())
                    if p.startswith("/api/sync/song/") or p.startswith("/api/sync/setlist/"):
                        kind = "song" if p.startswith("/api/sync/song/") else "setlist"
                        rec = sync.record(kind, urllib.parse.unquote(p.rsplit("/", 1)[1]))
                        return self.send_json(200, rec) if rec else self.send_json(404, {"error": "not here"})
                    if p == "/api/sync/file":
                        path = sync.path_for((urllib.parse.parse_qs(url.query).get("key") or [""])[0])
                        return self.send_file(path, "application/octet-stream") if path else self.send_json(404, {"error": "no such file"})
                    return self.send_json(404, {"error": "unknown"})
                if p in pages:
                    return self.serve_static(root, pages[p])
                if p.startswith("/fonts/"):
                    return self.serve_static(os.path.join(driver.config["app_root"], "fonts"), p[len("/fonts/"):])
                if p == "/api/display":
                    return self.send_json(200, driver.display)
                if p == "/api/service":   # the run order and the countdown (stage display); no secrets in it
                    return self.send_json(200, driver.service_plan.state())
                if p == "/api/info":
                    return self.send_json(200, {"hostname": socket.gethostname(), "wsPort": driver.config["lan_ws_port"], "version": VERSION, "appVersion": APP_VERSION, "addresses": ip_addresses(),
                                                "interfaces": ip_interfaces(), "netAudio": {"mode": driver.netaudio.cfg["mode"]}, "audioHost": driver.public_audio_host(), "center": driver.center_link.info() if driver.center_link.connected else None,
                                                "displays": {k: v for k, v in driver.displays_config().items() if k in ("hdmi1", "hdmi2", "touchKind")},
                                                "packages": package_lines(read_json(os.path.join(driver.config["data_root"], "packages.json"), []))})
                if p == "/api/hub":   # songs on the Central Pedal, for Central Control
                    return self.send_json(200, {"songs": driver.hub_listing()})
                if p.startswith("/api/hub/"):
                    sid = re.sub(r"[^A-Za-z0-9_-]", "", p[len("/api/hub/"):])[:64]
                    j = read_json(os.path.join(driver.hub_dir, sid + ".json"), None) if sid else None
                    return self.send_json(200, j) if j else self.send_json(404, {"error": "no such song"})
                if p == "/api/hub-file":   # a song's audio file from the library (pairing code needed)
                    q = urllib.parse.parse_qs(url.query)
                    if not driver.code_ok((q.get("code") or [""])[0]):
                        return self.send_json(403, {"error": "wrong code"})
                    path = (q.get("path") or [""])[0]
                    if not driver.library.inside(path):
                        return self.send_json(404, {"error": "not in the library"})
                    return self.send_file(os.path.realpath(path), mimetypes.guess_type(path)[0] or "application/octet-stream", cache=True)
                if p.startswith("/api/slides/"):
                    name = safe_name(urllib.parse.unquote(p[len("/api/slides/"):]))
                    path = os.path.join(driver.slides_dir, name)
                    if not name or not os.path.isfile(path):
                        return self.send_json(404, {"error": "no such slide"})
                    return self.send_file(path, mimetypes.guess_type(path)[0] or "application/octet-stream", cache=True)
                if p == "/api/slide":
                    return self.send_json(200, driver.slide)
                if p == "/api/lighting":  # the light show (cues) of one song, written by Central Control
                    sid = re.sub(r"[^A-Za-z0-9_-]", "", (urllib.parse.parse_qs(url.query).get("song") or [""])[0])[:64]
                    path = os.path.join(driver.config["data_root"], "lighting", sid + ".json")
                    return self.send_json(200, read_json(path, {}) if sid else {})
                if p == "/api/charts":
                    return self.send_json(200, {"charts": driver.charts.listing()})
                if p.startswith("/api/charts/"):
                    parts = p.split("/")
                    chart_id = parts[3] if len(parts) > 3 else ""
                    name = parts[4] if len(parts) > 4 else "chart.json"
                    if name == "chart.json":
                        info = driver.charts.info(chart_id)
                        return self.send_json(200, info) if info else self.send_json(404, {"error": "no such chart"})
                    m = re.match(r"^page-(\d+)\.png$", name)
                    if m:
                        return self.send_file(driver.charts.page_path(chart_id, m.group(1)), "image/png", cache=True)
                    return self.send_json(404, {"error": "unknown"})
                return self.serve_static(root, p)

            def do_POST(self):
                url = urllib.parse.urlparse(self.path)
                query = urllib.parse.parse_qs(url.query)
                if url.path == "/setup/apply":
                    try:
                        payload = json.loads(self.body(1 << 14).decode() or "{}")
                    except Exception:
                        payload = {}
                    return self.send_json(200, driver.phone_setup.apply(payload))
                if url.path == "/api/sync/link":
                    try:
                        payload = json.loads(self.body(1 << 16).decode() or "{}")
                    except Exception:
                        payload = {}
                    code_, reply = driver.sync.handle_link(payload)
                    return self.send_json(code_, reply)
                if url.path.startswith("/api/pedal/"):   # Central Pedal Control (Mac / iPad): Upload and Download
                    tr = driver.transfer
                    token = (query.get("token") or [""])[0]
                    if url.path in ("/api/pedal/begin", "/api/pedal/export"):
                        try:
                            payload = json.loads(self.body(1 << 16).decode() or "{}")
                        except Exception:
                            payload = {}
                        code_, reply = tr.begin(payload, "out" if url.path == "/api/pedal/export" else "in")
                        return self.send_json(code_, reply)
                    if url.path == "/api/pedal/chunk":   # a piece of a set's file (resumable)
                        g = lambda k: (query.get(k) or [""])[0]
                        code_, reply = tr.put_chunk(token, g("id"), g("offset"), g("total"), self.body(tr.CHUNK_MAX),
                                                    {"kind": g("kind"), "name": g("name"), "song": g("song"), "sha": g("sha")})
                        return self.send_json(code_, reply)
                    if url.path == "/api/pedal/file":
                        code_, reply = tr.put_file(token, (query.get("id") or [""])[0], (query.get("name") or [""])[0], (query.get("song") or [""])[0], (query.get("kind") or ["stem"])[0], self.body())
                        return self.send_json(code_, reply)
                    if url.path == "/api/pedal/commit":
                        try:
                            pkg = json.loads(self.body(64 << 20).decode() or "{}")
                        except Exception:
                            return self.send_json(400, {"error": "not JSON"})
                        code_, reply = tr.commit(token, pkg)
                        return self.send_json(code_, reply)
                    return self.send_json(404, {"error": "unknown"})
                if url.path == "/api/sync/poke":
                    if not driver.sync.auth_ok(self.headers, url.path):
                        return self.send_json(403, {"error": "not linked"})
                    driver.sync.wake.set()
                    return self.send_json(200, {"ok": True})
                if url.path == "/api/upload":
                    kind = (query.get("kind") or ["stems"])[0]
                    name = (query.get("name") or [self.headers.get("X-File-Name") or "upload"])[0]
                    song = (query.get("song") or [""])[0]
                    data = self.body()
                    if not data:
                        return self.send_json(400, {"error": "empty upload"})
                    return self.send_json(200, driver.handle_upload(kind, name, song, data, announce=True))
                if url.path == "/api/lighting":
                    try:
                        message = json.loads(self.body(1 << 22).decode() or "{}")
                    except Exception:
                        return self.send_json(400, {"error": "not JSON"})
                    if not driver.code_ok(message.get("code")):
                        return self.send_json(403, {"error": "wrong code"})
                    sid = re.sub(r"[^A-Za-z0-9_-]", "", str(message.get("song") or ""))[:64]
                    if not sid:
                        return self.send_json(400, {"error": "no song"})
                    show = message.get("show") or {}
                    show["updated"] = int(time.time() * 1000)
                    show["by"] = str(message.get("by") or "")[:60]
                    write_json(os.path.join(driver.config["data_root"], "lighting", sid + ".json"), show)
                    driver.sync.touch(sid)   # the light show travels with the song to the other Central Pedals
                    driver.emit({"type": "lighting", "song": sid, "updated": show["updated"], "by": show["by"]}, lan=True)
                    return self.send_json(200, {"ok": True, "updated": show["updated"]})
                if url.path == "/api/slides":   # a picture / video from Central Control for the Pi's slides screen
                    if not driver.code_ok((query.get("code") or [""])[0]):
                        self.body()
                        return self.send_json(403, {"error": "wrong code"})
                    name = safe_name((query.get("name") or ["slide"])[0])
                    if not re.search(r"\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|m4v|ogv)$", name, re.I):
                        self.body()
                        return self.send_json(400, {"error": "pictures and videos only"})
                    data = self.body(1 << 30)
                    if not data:
                        return self.send_json(400, {"error": "empty upload"})
                    with open(os.path.join(driver.slides_dir, name), "wb") as handle:
                        handle.write(data)
                    return self.send_json(200, {"ok": True, "file": name, "url": "/api/slides/" + urllib.parse.quote(name)})
                if url.path == "/api/action":
                    try:
                        message = json.loads(self.body(1 << 16).decode() or "{}")
                    except Exception:
                        return self.send_json(400, {"error": "not JSON"})
                    if not driver.code_ok(message.get("code")):
                        return self.send_json(403, {"error": "wrong code"})
                    driver.emit({"type": "action", "name": message.get("name"), "args": message.get("args") or {}, "from": "companion"})
                    return self.send_json(200, {"ok": True})
                self.body()
                return self.send_json(404, {"error": "unknown"})

            def do_PUT(self):
                self.do_POST()

        return Handler

    def start(self):
        try:
            self.httpd = ThreadingHTTPServer((self.host, self.port), self.handler())
            self.httpd.daemon_threads = True
        except OSError as error:
            log.warning("companion web server could not start on port %s (%s)", self.port, error)
            return False
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        log.info("companion (charts / lyrics / remote / upload) on http://%s.local:%s/", socket.gethostname(), self.port)
        return True

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()


# ---------------------------------------------------------------------------
# MIDI in/out + clock, Ableton Link
# ---------------------------------------------------------------------------
SETUP_SSID = "Central Pedal Setup"
SETUP_IP = "10.42.0.1"


FACTORY_MARKERS = ("/boot/firmware/central-factory-test", "/boot/central-factory-test")
FACTORY_CORNERS = ("tl", "tr", "bl", "br")


class Factory:
    """The factory test, on a card built by hand (build-image.sh puts central-factory-test on the boot partition).
    The first start is the factory test: a checklist on HDMI 1 (keyboard and mouse) - footswitches, knobs, the small
    screen, outputs, the instrument input, MIDI, Wi-Fi, health - and the touch screen can be changed there. Restarts the
    test itself asks for (a new touch screen, Restart) come back into the test. Any other start - the pedal was unplugged
    - is the customer's first start: the Wi-Fi used in the test is forgotten, the touch screen is kept, and the pedal
    asks for the church Wi-Fi on the phone ("Central Pedal Setup") straight away.
    data/factory.json: {"state": "factory" | "customer", "boot": the start it belongs to, "continue": true (the next
    start stays in the test), "finished", "firstBoot" (the customer hasn't set it up yet), "screen"}"""

    def __init__(self, driver, markers=None, bid=None):
        self.driver = driver
        self.path = os.path.join(driver.config["data_root"], "factory.json")
        self.markers = tuple(markers if markers is not None else (driver.config.get("factory_markers") or FACTORY_MARKERS))
        self.pattern = False        # the small screen shows the test pattern (touch the 4 corners)
        self.corners = set()
        self.led_until = {}
        self.state = "none"
        try:
            self.state = self.decide(bid)
        except Exception as error:   # (the pedal always starts, whatever the file says)
            log.warning("factory: %s", error)

    def load(self):
        return read_json(self.path, {}) or {}

    def save(self, j):
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            write_json(self.path, j)
        except Exception as error:
            log.warning("factory: could not save (%s)", error)

    def decide(self, bid=None):
        bid = bid or boot_id()
        j = self.load()
        if not j:
            if any(os.path.exists(p) for p in self.markers):
                self.save({"state": "factory", "boot": bid, "started": time.time()})
                log.info("factory test: the first start of a card built by hand")
                return "factory"
            return "none"
        if j.get("state") == "factory":
            if j.get("boot") == bid:
                return "factory"            # (the driver restarted, the pedal didn't)
            if j.get("continue"):
                j.pop("continue", None)
                j["boot"] = bid
                self.save(j)
                return "factory"            # (a restart the test asked for: a new touch screen)
            self.to_customer(j)
            return "customer"
        return j.get("state") or "none"

    def to_customer(self, j=None):
        """Unplugged after the test: the customer's first start. Wi-Fi from the test forgotten, the touch screen kept."""
        d = self.driver
        j = dict(j if j is not None else self.load())
        if os.path.exists(SYSTEM_SCRIPT):
            run(["sudo", "-n", SYSTEM_SCRIPT, "wifi", "forget-all"], timeout=30)
            run(["sudo", "-n", SYSTEM_SCRIPT, "factory-done"], timeout=30)
        root = d.config["data_root"]
        for name in ("code", "code-chosen", "center.json", "license-state.json"):   # (the customer picks their own code)
            try:
                os.remove(os.path.join(root, name))
            except OSError:
                pass
        if hasattr(d, "load_code"):
            try:
                d.code = d.load_code()
            except Exception:
                pass
        sid = touch_screen_id(d.config)
        self.save({"state": "customer", "firstBoot": True, "screen": sid if sid != "off" else None, "since": time.time(),
                   "tested": bool(j.get("report")), "finished": bool(j.get("finished"))})
        log.info("factory test over: the customer's first start (touch screen kept: %s)", sid)

    # ----- what the pedal is now
    @property
    def on(self):
        return self.state == "factory"

    def first_boot(self):
        return self.state == "customer" and bool(self.load().get("firstBoot"))

    def screen_set(self):
        return self.state == "customer" and bool(self.load().get("screen"))

    def setup_done(self):
        j = self.load()
        if j.get("firstBoot"):
            j["firstBoot"] = False
            self.save(j)

    def continue_next(self):
        """The next start (a restart the test asks for) stays in the factory test."""
        if self.on:
            j = self.load()
            j["continue"] = True
            self.save(j)

    def info(self):
        j = self.load()
        return {"state": self.state, "on": self.on, "finished": bool(j.get("finished")), "firstBoot": self.first_boot(),
                "screenSet": self.screen_set(), "pattern": self.pattern, "corners": sorted(self.corners)}

    # ----- the test page's questions
    def status(self, scan=False):
        d = self.driver
        root = d.config["data_root"]
        banks = []
        for folder in ("/opt/pad-pedal/sounds", os.path.join(d.config.get("app_root") or "", "sounds")):
            try:
                banks += [f for f in os.listdir(folder) if f.lower().endswith(SF2_EXTENSIONS)]
            except OSError:
                pass
        sid = touch_screen_id(d.config)
        scr = screen_by_id(d.config.get("app_root"), sid) if sid != "off" else None
        wifi = wifi_status(scan=scan) if shutil.which("nmcli") else {"available": False, "networks": [], "error": "NetworkManager is not installed."}
        mini = getattr(d, "mini", None)
        leds = getattr(d, "leds", {}) or {}
        return {"type": "factoryStatus", **self.info(), "version": APP_VERSION, "health": pi_health(root), "banks": sorted(set(banks)),
                "inputs": d.config.get("inputs") or [], "leds": sorted(leds), "ledFollows": {k: (v.get("follows") or k) for k, v in leds.items()},
                "midiPorts": d.midi.ports() if getattr(d, "midi", None) else {"inputs": [], "outputs": []}, "soundCards": sound_cards(),
                "wifi": {"available": wifi.get("available"), "networks": len(wifi.get("networks") or []), "error": wifi.get("error")},
                "touchScreen": sid, "touchScreenName": (scr or {}).get("name") or ("No touch screen" if sid == "off" else sid),
                "touchScreens": screens_catalog(d.config.get("app_root")), "miniScreen": bool(mini and mini.available and mini.fb_present()),
                "miniTouch": getattr(mini, "touch_name", None) if mini else None, "framebuffers": framebuffers(),
                "report": read_json(os.path.join(root, "factory-report.json"), None)}

    def blink(self, led_id, seconds=2.0):
        """Blink one LED for a moment (whatever the app had it doing), then back to the app's state."""
        d = self.driver
        entry = (getattr(d, "leds", {}) or {}).get(led_id)
        if not entry:
            return False
        try:
            entry["led"].blink(on_time=0.12, off_time=0.12, background=True)
        except Exception:
            return False
        until = time.monotonic() + seconds
        self.led_until[led_id] = until

        def back():
            time.sleep(seconds + 0.05)
            if self.led_until.get(led_id) == until:
                self.led_until.pop(led_id, None)
                d.update_leds()
        threading.Thread(target=back, daemon=True).start()
        return True

    def corner(self, c):
        if c in FACTORY_CORNERS and self.pattern:
            self.corners.add(c)
            self.announce()

    def set_pattern(self, on):
        self.pattern = bool(on) and self.on
        self.corners = set()
        self.announce()

    def report(self, results):
        root = self.driver.config["data_root"]
        rep = {"saved": time.strftime("%Y-%m-%d %H:%M:%S"), "version": APP_VERSION, "hostname": socket.gethostname(), "device": device_id(),
               "touchScreen": touch_screen_id(self.driver.config), "results": results if isinstance(results, dict) else {}}
        write_json(os.path.join(root, "factory-report.json"), rep)
        j = self.load()
        j["report"] = rep["saved"]
        self.save(j)
        return rep

    def finish(self):
        j = self.load()
        j["finished"] = True
        self.save(j)
        self.pattern = False
        self.announce()

    def announce(self):
        d = self.driver
        if getattr(d, "loop", None) is not None:
            try:
                d.loop.call_soon_threadsafe(d.emit, {"type": "factory", **self.info()})
                d.loop.call_soon_threadsafe(d.schedule_mini_render, True)
            except Exception:
                pass

    def handle(self, message, ws):
        """{type: "factory", action: status | scan | led | pattern | corner | report | finish | screen | restart}"""
        d = self.driver
        a = message.get("action")
        if a in ("status", "scan"):
            def go():
                st = self.status(scan=a == "scan")
                if d.loop is not None:
                    if ws is not None:
                        d.loop.call_soon_threadsafe(d.send_to, ws, st)
                    else:
                        d.loop.call_soon_threadsafe(d.emit, st)
            threading.Thread(target=go, daemon=True).start()
            return
        if a == "led":
            self.blink(str(message.get("id") or ""), float(message.get("seconds") or 2))
        elif a == "pattern":
            self.set_pattern(message.get("on"))
        elif a == "corner":
            self.corner(str(message.get("corner") or ""))
        elif a == "report":
            rep = self.report(message.get("results"))
            if ws is not None:
                d.send_to(ws, {"type": "factoryReport", "ok": True, "report": rep})
        elif a == "finish":
            self.finish()
        elif a == "screen":   # a different touch screen: set it, and come back into the test after the restart
            result = d.set_touch_screen(str(message.get("value") or "off"))
            if result.get("ok"):
                self.continue_next()
            if ws is not None:
                d.send_to(ws, dict(result, type="factoryScreen"))
            if result.get("ok") and message.get("restart") and not d.config.get("simulated"):
                run_privileged("/usr/sbin/shutdown", "-r", "now")
        elif a == "restart":   # (back into the test afterwards)
            self.continue_next()
            if not d.config.get("simulated"):
                run_privileged("/usr/sbin/shutdown", "-r", "now")


class PhoneSetup:
    """Phone setup: a Central Pedal with no network makes its own open Wi-Fi, "Central Pedal Setup". A phone that joins
    it opens the setup page by itself (every name answers 10.42.0.1 and port 80 sends everything to /setup): pick the
    church Wi-Fi, the touch screen and the 4-digit code (the main admin's, or a new one - Central Pedal Control uses the
    same code), then Upload. The pedal joins the Wi-Fi, turns the screen on (fetching its driver) and restarts when the
    screen needs it. If the Wi-Fi doesn't work, "Central Pedal Setup" comes back and the page says why.
    The same page is at http://<pedal>:8080/setup on the network (it asks for the pedal's code there)."""

    FIRST_WAIT = 25       # seconds offline before the setup Wi-Fi comes on (no Wi-Fi saved yet)
    SAVED_WAIT = 120      # ... with a Wi-Fi saved that doesn't answer (a new room, the router restarting)
    RETRY_SAVED = 300     # the setup Wi-Fi gives the saved network another try after this long with no phone on it

    def __init__(self, driver):
        self.driver = driver
        self.on = False
        self.busy = False
        self.httpd = None
        self.networks = []
        self.error = ""
        self.joined = ""
        self.since = 0.0
        self.last_seen = 0.0     # the last time a phone asked for the setup page
        self.lock = threading.Lock()
        self.stopping = False

    # ----- what's there
    def available(self):
        return os.path.exists(SYSTEM_SCRIPT) and sys.platform.startswith("linux") and shutil.which("nmcli") is not None

    def online(self):
        addrs = [a for a in ip_addresses() if not a.startswith("10.42.0.")]
        return bool(addrs)

    def saved_wifi(self):
        code, out, _ = run(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"], timeout=8)
        if code != 0:
            return False
        for line in out.splitlines():
            name, _, kind = line.rpartition(":")
            if kind in ("802-11-wireless", "wifi") and name != "central-setup":
                return True
        return False

    def status(self):
        return {"on": self.on, "ssid": SETUP_SSID, "address": "http://%s/" % SETUP_IP, "error": self.error, "busy": self.busy, "joined": self.joined}

    # ----- on / off
    def watch(self):
        """At start and whenever the pedal has been offline a while: the setup Wi-Fi."""
        if not self.available():
            return
        fx = getattr(self.driver, "factory", None)
        while fx is not None and fx.on and not self.stopping:   # (the factory test: the tester's own network, no setup Wi-Fi)
            time.sleep(5)
        if fx is not None and fx.first_boot() and not self.online():
            time.sleep(3)   # (the customer's first start after the factory test: ask for the Wi-Fi straight away)
            if not self.online() and not self.saved_wifi():
                self.start("the customer's first start")
        else:
            time.sleep(15)
        offline_since = None
        while not self.stopping:
            try:
                if fx is not None and fx.on:
                    time.sleep(5)
                    continue
                if self.on:
                    quiet = time.monotonic() - max(self.since, self.last_seen)
                    if not self.busy and quiet > self.RETRY_SAVED and self.saved_wifi():
                        log.info("phone setup: no phone for a while - trying the saved Wi-Fi again")
                        self.stop()
                        offline_since = time.monotonic()
                elif not self.busy:
                    if self.online():
                        offline_since = None
                    else:
                        offline_since = offline_since or time.monotonic()
                        wait = self.SAVED_WAIT if self.saved_wifi() else self.FIRST_WAIT
                        if time.monotonic() - offline_since >= wait:
                            self.start("no network")
                            offline_since = None
            except Exception as error:
                log.warning("phone setup: %s", error)
            time.sleep(10)

    def start(self, why=""):
        with self.lock:
            if self.on or not self.available():
                return self.status()
            try:   # (the list for the page: once the pedal is its own Wi-Fi it can't look around)
                self.networks = [n for n in wifi_status(scan=True).get("networks") or [] if n.get("ssid") and n["ssid"] != SETUP_SSID]
            except Exception:
                self.networks = []
            code, out, err = run(["sudo", "-n", SYSTEM_SCRIPT, "setup-ap", "start", SETUP_SSID], timeout=60)
            if code != 0:
                log.warning("phone setup: the setup Wi-Fi didn't start: %s", (err or out).strip()[-200:])
                return dict(self.status(), ok=False, startError=wifi_error(err or out))
            self.on, self.since = True, time.monotonic()
            self.serve()
            log.info("phone setup: Wi-Fi \"%s\" is on (%s)", SETUP_SSID, why or "asked")
        self.announce()
        return self.status()

    def stop(self):
        with self.lock:
            if self.httpd:
                try:
                    self.httpd.shutdown()
                    self.httpd.server_close()
                except Exception:
                    pass
                self.httpd = None
            if self.on:
                run(["sudo", "-n", SYSTEM_SCRIPT, "setup-ap", "stop"], timeout=30)
            self.on = False
        self.announce()

    def announce(self):
        d = self.driver
        if getattr(d, "loop", None) is not None:
            try:
                d.loop.call_soon_threadsafe(d.emit, {"type": "phoneSetup", **self.status()})
            except Exception:
                pass
        if getattr(d, "loop", None) is not None and getattr(d, "mini", None) is not None:
            try:
                d.loop.call_soon_threadsafe(d.schedule_mini_render, True)
            except Exception:
                pass

    def serve(self):
        """Port 80 while the setup Wi-Fi is on: the page, and every other address sent to it (that is what makes a
        phone open it by itself)."""
        setup = self

        class Handler(HttpBase):
            def do_HEAD(self):
                self.do_GET()

            def do_GET(self):
                p = urllib.parse.urlparse(self.path).path
                if p in ("/setup", "/setup/"):
                    setup.last_seen = time.monotonic()
                    return setup.send_page(self)
                if p == "/setup/state":
                    setup.last_seen = time.monotonic()
                    return self.send_json(200, setup.state(local=True))
                self.send_response(302)
                self.send_header("Location", "http://%s/setup" % SETUP_IP)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self):
                p = urllib.parse.urlparse(self.path).path
                if p != "/setup/apply":
                    return self.send_json(404, {"error": "unknown"})
                try:
                    payload = json.loads(self.body(1 << 14).decode() or "{}")
                except Exception:
                    payload = {}
                setup.last_seen = time.monotonic()
                return self.send_json(200, setup.apply(payload, local=True))

        try:
            self.httpd = ThreadingHTTPServer(("0.0.0.0", 80), Handler)
            self.httpd.daemon_threads = True
            threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        except OSError as error:
            self.httpd = None   # (the page is still at :8080/setup)
            log.warning("phone setup: port 80 is not free (%s) - the page is at http://%s:%s/setup", error, SETUP_IP, self.driver.config.get("lan_port"))

    # ----- the page
    def send_page(self, h):
        path = os.path.join(self.driver.config["app_root"], "companion", "setup.html")
        return h.send_file(path, "text/html; charset=utf-8")

    def state(self, local=False):
        d = self.driver
        cat = screens_catalog(d.config.get("app_root"))
        groups = {g.get("id"): g.get("name") for g in cat.get("groups") or []}
        screens = [{"id": s.get("id"), "name": s.get("name"), "group": groups.get(s.get("kind"), s.get("kind")), "kind": s.get("kind")} for s in cat.get("screens") or []]
        current = touch_screen_id(d.config)
        connected = None
        if not self.on:
            try:
                connected = wifi_status().get("connected")
            except Exception:
                connected = None
        fx = getattr(d, "factory", None)
        screen_set = bool(fx and fx.screen_set())
        return {"setupWifi": self.on, "local": bool(local and self.on), "screenSet": screen_set,
                "screenName": (screen_by_id(d.config.get("app_root"), current) or {}).get("name") if current != "off" else "No touch screen", "networks": self.networks if self.on else (wifi_status(scan=True).get("networks") or []),
                "connected": connected, "screens": screens, "screen": current if current != "off" else ("rpi35-xpt2046" if not d.config.get("touch_screen") else "off"),
                "codeChosen": d.code_chosen(), "center": d.center_link.info() if getattr(d, "center_link", None) else None,
                "error": self.error, "busy": self.busy, "joined": self.joined, "name": socket.gethostname(), "version": APP_VERSION}

    def apply(self, payload, local=False):
        """Upload: the code is checked (and saved) right away; the Wi-Fi and the screen a moment later, after the
        phone has its answer (the setup Wi-Fi goes away when the pedal joins the church's)."""
        d = self.driver
        if self.busy:
            return {"ok": False, "error": "The pedal is still setting up - give it a minute."}
        ssid = str(payload.get("ssid") or "").strip()
        password = str(payload.get("password") or "")
        hidden = bool(payload.get("hidden"))
        keep_wifi = bool(payload.get("keepWifi")) and not self.on
        sid = str(payload.get("screen") or "").strip()
        code = re.sub(r"\D", "", str(payload.get("code") or ""))[:4]
        if not keep_wifi and not ssid:
            return {"ok": False, "field": "wifi", "error": "Pick the church's Wi-Fi."}
        if password and len(password) < 8:
            return {"ok": False, "field": "password", "error": "Wi-Fi passwords are at least 8 characters - check it."}
        if sid and sid != "off" and not screen_by_id(d.config.get("app_root"), sid):
            return {"ok": False, "field": "screen", "error": "Pick the touch screen from the list."}
        if len(code) != 4:
            return {"ok": False, "field": "code", "error": "The code is 4 digits."}
        if d.code_chosen():
            if not d.code_ok(code):
                return {"ok": False, "field": "code", "error": "That's not this pedal's code. It's the 4 digits picked when it was set up (main admin → Settings → This computer)."}
        else:
            r = d.set_code(code)
            if not r.get("ok"):
                return {"ok": False, "field": "code", "error": r.get("error") or "The code wasn't saved."}
        self.busy, self.error = True, ""
        threading.Thread(target=self._finish, args=(ssid, password, hidden, keep_wifi, sid), daemon=True).start()
        return {"ok": True, "ssid": ssid, "restart": bool(sid and sid != touch_screen_id(d.config)),
                "message": ("The pedal is joining \"%s\" now." % ssid) if not keep_wifi else "Saved."}

    def _finish(self, ssid, password, hidden, keep_wifi, sid):
        d = self.driver
        try:
            time.sleep(3 if self.on else 0.5)   # (the phone gets the answer before the setup Wi-Fi goes)
            if not keep_wifi:
                was_on = self.on
                self.stop()
                ok, msg = wifi_connect(ssid, password, hidden=hidden)
                if not ok:
                    self.error = "The pedal couldn't join \"%s\": %s" % (ssid, msg)
                    log.warning("phone setup: %s", self.error)
                    self.busy = False
                    if was_on or not self.online():
                        self.start("the Wi-Fi didn't work")
                    return
                self.joined = ssid
                log.info("phone setup: joined %s", ssid)
                if getattr(d, "factory", None):
                    d.factory.setup_done()
            restart = False
            if sid and sid != touch_screen_id(d.config):
                r = d.set_touch_screen(sid)
                if r.get("ok"):
                    restart = bool(r.get("restart"))
                else:
                    self.error = "Wi-Fi ✓ - the screen wasn't set: %s Pick it again in Settings → Touch screen." % (r.get("error") or "")
                    log.warning("phone setup: %s", self.error)
            if restart and not d.config.get("simulated"):
                log.info("phone setup: restarting for the new screen")
                time.sleep(2)
                run_privileged("/usr/sbin/shutdown", "-r", "now")
        finally:
            self.busy = False
            self.announce()


class ClockTempo:
    def __init__(self):
        self.ticks = []

    def tick(self, t):
        if self.ticks and t - self.ticks[-1] > 0.5:
            self.ticks = []
        self.ticks.append(t)
        if len(self.ticks) > 49:
            self.ticks.pop(0)
        if len(self.ticks) >= 25 and len(self.ticks) % 24 == 1:
            per_tick = (self.ticks[-1] - self.ticks[0]) / (len(self.ticks) - 1)
            return round(60.0 / (per_tick * 24), 1)
        return None


def midi_port_wanted(name):
    """A real MIDI device's port - not "Midi Through", and not a port a program opened through RtMidi ("RtMidiIn Client",
    "RtMidiOut Client"): every port we open makes one of those, and opening those in turn made a new one every scan."""
    client = str(name).split(":", 1)[0].strip()
    return bool(client) and "Through" not in name and not client.startswith("RtMidi")


def midi_short_name(n):
    """'nanoKONTROL2:nanoKONTROL2 MIDI 1 20:0' and 'nanoKONTROL2 MIDI 1' are the same device (control-surface.js shortPort)."""
    n = re.sub(r"\s+\d+:\d+$", "", re.sub(r" \(out\)$", "", str(n or "")))
    i = n.find(":")
    return (n[i + 1:].strip() if i > 0 and n[i + 1:].strip() else n).lower()


class Midi:
    """All USB MIDI inputs / outputs (hot-plugged), scheduled sends, MIDI clock out."""

    def __init__(self, emit, want_out=True):
        self.emit = emit
        self.inputs = {}
        self.outputs = {}
        self.want_out = want_out
        self.clock = ClockTempo()
        self.last_bpm = None
        self.available = False
        self.lock = threading.Lock()
        self.transport = {"bpm": 120.0, "running": False}
        self.clock_stop = threading.Event()
        self.clock_thread = None
        try:
            import mido  # noqa: F401
            self.mido = mido
            self.available = True
        except Exception as error:
            log.info("MIDI disabled (%s) - install python3-mido python3-rtmidi", error)

    def add_listener(self, fn):
        self.listeners = getattr(self, "listeners", [])
        self.listeners.append(fn)

    def remove_listener(self, fn):
        self.listeners = [f for f in getattr(self, "listeners", []) if f is not fn]

    def on_message(self, port_name, message):
        for fn in getattr(self, "listeners", []):
            try:
                fn(message, port_name)
            except Exception:
                pass
        if message.type == "clock":
            bpm = self.clock.tick(time.monotonic())
            if bpm and (self.last_bpm is None or abs(bpm - self.last_bpm) >= 0.5):
                self.last_bpm = bpm
                self.emit({"type": "tempo", "bpm": bpm, "source": "clock"})
        elif message.type in ("note_on", "note_off", "control_change", "program_change", "pitchwheel", "start", "stop", "continue", "songpos"):
            self.emit({"type": "midi", "data": message.bytes(), "port": port_name})

    def scan(self):
        if not self.available:
            return
        try:
            in_names = [n for n in self.mido.get_input_names() if midi_port_wanted(n)]
            out_names = [n for n in self.mido.get_output_names() if midi_port_wanted(n)] if self.want_out else []
        except Exception as error:
            log.debug("MIDI scan failed (%s)", error)
            return
        with self.lock:
            for name in in_names:
                if name not in self.inputs:
                    try:
                        self.inputs[name] = self.mido.open_input(name, callback=lambda m, n=name: self.on_message(n, m))
                        log.info("MIDI input opened: %s", name)
                    except Exception as error:
                        log.warning("could not open MIDI input %s (%s)", name, error)
            for name in list(self.inputs):
                if name not in in_names:
                    try:
                        self.inputs.pop(name).close()
                    except Exception:
                        pass
                    log.info("MIDI input removed: %s", name)
            for name in out_names:
                if name not in self.outputs:
                    try:
                        self.outputs[name] = self.mido.open_output(name)
                        log.info("MIDI output opened: %s", name)
                    except Exception as error:
                        log.warning("could not open MIDI output %s (%s)", name, error)
            for name in list(self.outputs):
                if name not in out_names:
                    try:
                        self.outputs.pop(name).close()
                    except Exception:
                        pass
                    log.info("MIDI output removed: %s", name)

    def send_bytes(self, data, port=None):
        if not self.available or not data:
            return 0
        try:
            message = self.mido.Message.from_bytes(bytes(int(b) & 0xFF for b in data))
        except Exception as error:
            log.debug("bad MIDI bytes %r (%s)", data, error)
            return 0
        return self.send_raw(message, port)

    def send_raw(self, message, port=None):
        sent = 0
        with self.lock:
            names = list(self.outputs.keys())
            if port and port not in self.outputs:   # (an input's name: the output of the same device)
                want = midi_short_name(port)
                names = [n for n in names if midi_short_name(n) == want]
            elif port:
                names = [port]
            for name in names:
                out = self.outputs[name]
                try:
                    out.send(message)
                    sent += 1
                except Exception as error:
                    log.debug("MIDI send to %s failed (%s)", name, error)
        return sent

    def send_messages(self, messages):
        """[{data:[..], at: ms from now}] - the lights channel uses 'at' for exact hits."""
        for m in messages or []:
            data, at = m.get("data") or [], float(m.get("at") or 0) / 1000.0
            if at <= 0.002:
                self.send_bytes(data)
            else:
                threading.Timer(at, self.send_bytes, args=(data,)).start()

    def set_clock(self, bpm=None, running=None):
        if not self.available:
            return
        changed = running is not None and bool(running) != self.transport["running"]
        if bpm:
            self.transport["bpm"] = float(bpm)
        if running is not None:
            self.transport["running"] = bool(running)
        if changed:
            try:
                self.send_raw(self.mido.Message("start" if running else "stop"))
            except Exception:
                pass
        if self.clock_thread is None:
            self.clock_thread = threading.Thread(target=self.clock_loop, daemon=True)
            self.clock_thread.start()

    def clock_loop(self):
        next_tick = time.perf_counter()
        while not self.clock_stop.is_set():
            period = 60.0 / max(20.0, min(300.0, self.transport["bpm"])) / 24.0
            if self.transport["running"] and self.outputs:
                try:
                    self.send_raw(self.mido.Message("clock"))
                except Exception:
                    pass
            next_tick += period
            delay = next_tick - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            else:
                next_tick = time.perf_counter()

    def ports(self):
        with self.lock:
            return {"inputs": sorted(self.inputs), "outputs": sorted(self.outputs)}

    async def loop(self):
        while self.available:
            await asyncio.to_thread(self.scan)
            await asyncio.sleep(3)

    def close(self):
        self.clock_stop.set()
        with self.lock:
            for port in list(self.inputs.values()) + list(self.outputs.values()):
                try:
                    port.close()
                except Exception:
                    pass


class LinkSync:
    """Ableton Link: shares tempo and play / stop with Link apps on the Wi-Fi."""

    def __init__(self, emit, enabled=True):
        self.emit = emit
        self.link = None
        self.available = False
        self.last_bpm = None
        self.wanted = False
        if not enabled:
            return
        try:
            import link
            self.link = link.Link(120.0)
            self.link.enabled = False
            self.link.startStopSyncEnabled = True
            self.link.setTempoCallback(self.on_tempo)
            self.link.setNumPeersCallback(self.on_peers)
            self.link.setStartStopCallback(self.on_start_stop)
            self.available = True
            log.info("Ableton Link available")
        except Exception as error:
            log.info("Ableton Link unavailable (%s) - pip install LinkPython-extern", error)

    def on_tempo(self, bpm):
        if self.last_bpm is None or abs(bpm - self.last_bpm) >= 0.05:
            self.last_bpm = bpm
            self.emit({"type": "tempo", "bpm": round(float(bpm), 2), "source": "link"})

    def on_peers(self, n):
        self.emit({"type": "linkStatus", "available": True, "peers": int(n), "bpm": self.tempo(), "enabled": self.wanted})

    def on_start_stop(self, playing):
        self.emit({"type": "linkTransport", "playing": bool(playing)})

    def peers(self):
        try:
            return int(self.link.numPeers()) if self.available else 0
        except Exception:
            return 0

    def tempo(self):
        try:
            return round(float(self.link.captureSessionState().tempo()), 2)
        except Exception:
            return None

    def configure(self, enabled, bpm=None, playing=None):
        if not self.available:
            return
        self.wanted = bool(enabled)
        try:
            self.link.enabled = bool(enabled)
        except Exception:
            pass
        if not enabled:
            return
        try:
            state = self.link.captureSessionState()
            now = self.link.clock().micros()
            if bpm and abs(state.tempo() - float(bpm)) >= 0.01:
                self.last_bpm = float(bpm)
                state.setTempo(float(bpm), now)
            if playing is not None and bool(state.isPlaying()) != bool(playing):
                if playing:
                    state.setIsPlayingAndRequestBeatAtTime(True, now, 0.0, 4.0)
                else:
                    state.setIsPlaying(False, now)
            self.link.commitSessionState(state)
        except Exception as error:
            log.debug("link update failed (%s)", error)

    def status(self):
        return {"available": self.available, "enabled": self.wanted, "peers": self.peers(), "bpm": self.tempo() if self.available else None}


# ---------------------------------------------------------------------------
# USB input devices (foot pedals, mouse / keyboard detection) via evdev
# ---------------------------------------------------------------------------
class UsbInputs:
    PEDAL_WORDS = ("foot", "pedal", "pcsensor", "ikkegol", "scythe", "footswitch", "fs1", "fs3", "fs22")

    def __init__(self, driver):
        self.driver = driver
        self.available = False
        self.devices = {}       # path -> {"dev", "kind", "mapped": {code: input_id}}
        self.pointer = {"mouse": False, "keyboard": False}
        self.lock = threading.Lock()
        self.stop_flag = threading.Event()
        try:
            import evdev
            self.evdev = evdev
            self.available = True
        except Exception as error:
            log.info("USB pedals / mouse detection disabled (%s) - install python3-evdev", error)

    @staticmethod
    def matches(spec_usb, dev):
        if not spec_usb:
            return False
        info = dev.info
        if spec_usb.get("vendor") and int(spec_usb["vendor"]) != info.vendor:
            return False
        if spec_usb.get("product") and int(spec_usb["product"]) != info.product:
            return False
        if spec_usb.get("name") and spec_usb["name"] != dev.name:
            return False
        return bool(spec_usb.get("name") or spec_usb.get("vendor") or spec_usb.get("product"))

    def classify(self, dev):
        ev = self.evdev
        caps = dev.capabilities()
        keys = set(caps.get(ev.ecodes.EV_KEY, []))
        rel = set(caps.get(ev.ecodes.EV_REL, []))
        absn = set(k[0] if isinstance(k, tuple) else k for k in caps.get(ev.ecodes.EV_ABS, []))
        if ev.ecodes.REL_X in rel and ev.ecodes.BTN_LEFT in keys:
            return "mouse"
        if ev.ecodes.ABS_MT_POSITION_X in absn or (ev.ecodes.BTN_TOUCH in keys and ev.ecodes.ABS_X in absn):
            return "touch"
        letters = sum(1 for k in range(ev.ecodes.KEY_A, ev.ecodes.KEY_Z + 1) if k in keys)
        if letters >= 20 and ev.ecodes.KEY_SPACE in keys and ev.ecodes.KEY_ENTER in keys and not any(w in dev.name.lower() for w in self.PEDAL_WORDS):
            return "keyboard"
        if keys or absn:
            return "keys"
        return "other"

    def mapping_for(self, dev):
        mapped = {}
        for spec in self.driver.config.get("inputs") or []:
            usb = spec.get("usb")
            if usb and self.matches(usb, dev) and usb.get("code") is not None:
                mapped[int(usb["code"])] = spec["id"]
        return mapped

    def scan(self):
        if not self.available:
            return
        ev = self.evdev
        try:
            paths = set(ev.list_devices())
        except Exception:
            return
        with self.lock:
            for path in list(self.devices):
                if path not in paths:
                    entry = self.devices.pop(path)
                    try:
                        entry["dev"].close()
                    except Exception:
                        pass
                    log.info("USB device removed: %s", entry["dev"].name)
            for path in paths:
                if path in self.devices:
                    continue
                try:
                    dev = ev.InputDevice(path)
                except Exception:
                    continue
                kind = self.classify(dev)
                entry = {"dev": dev, "kind": kind, "mapped": self.mapping_for(dev)}
                self.devices[path] = entry
                log.info("USB device: %s (%s)%s", dev.name, kind, " - %d mapped key(s)" % len(entry["mapped"]) if entry["mapped"] else "")
                if entry["mapped"] and kind != "keyboard":
                    try:
                        dev.grab()
                    except Exception as error:
                        log.debug("grab %s failed (%s)", dev.name, error)
                if kind in ("keys", "keyboard", "other"):
                    threading.Thread(target=self.read_loop, args=(path,), daemon=True).start()
            mouse = any(e["kind"] == "mouse" for e in self.devices.values())
            keyboard = any(e["kind"] == "keyboard" for e in self.devices.values())
            listing = [{"name": e["dev"].name, "pedal": bool(e["mapped"]) or e["kind"] == "keys", "keyboard": e["kind"] == "keyboard", "mouse": e["kind"] == "mouse", "touch": e["kind"] == "touch"}
                       for e in self.devices.values() if e["kind"] in ("mouse", "keyboard", "keys", "touch")]
        pointer = {"mouse": mouse, "keyboard": keyboard}
        if pointer != self.pointer or self.driver.devices_dirty:
            self.pointer = pointer
            self.driver.devices_dirty = False
            self.driver.emit({"type": "devices", "mouse": mouse, "keyboard": keyboard, "usb": listing})

    def read_loop(self, path):
        ev = self.evdev
        entry = self.devices.get(path)
        if not entry:
            return
        dev = entry["dev"]
        try:
            for event in dev.read_loop():
                if self.stop_flag.is_set() or self.devices.get(path) is not entry:
                    break
                if event.type == ev.ecodes.EV_KEY:
                    code = event.code
                    learn = self.driver.learn
                    if learn and learn.get("kind") in ("button", None) and event.value == 1 and (entry["kind"] != "keyboard" or learn.get("allowKeyboard")):
                        name = ev.ecodes.KEY.get(code, ev.ecodes.BTN.get(code, str(code)))
                        if isinstance(name, list):
                            name = name[0]
                        self.driver.learned({"usb": {"vendor": dev.info.vendor, "product": dev.info.product, "name": dev.name, "code": code, "codeName": str(name)}})
                        continue
                    target = entry["mapped"].get(code)
                    if not target:
                        continue
                    if event.value == 1:
                        self.driver.button_event(target, "press")
                    elif event.value == 0:
                        self.driver.button_event(target, "release")
                elif event.type == ev.ecodes.EV_ABS and entry["kind"] == "keys":
                    # a USB expression pedal / game-pad axis mapped as a knob
                    learn = self.driver.learn
                    if learn and learn.get("kind") in ("knob", "slider", "expression"):
                        info = dev.absinfo(event.code)
                        self.driver.learned({"usb": {"vendor": dev.info.vendor, "product": dev.info.product, "name": dev.name, "abs": event.code, "min": info.min, "max": info.max}})
                        continue
                    for spec in self.driver.config.get("inputs") or []:
                        usb = spec.get("usb")
                        if usb and usb.get("abs") == event.code and self.matches(usb, dev):
                            lo, hi = usb.get("min", 0), usb.get("max", 255)
                            value = (event.value - lo) / max(1, hi - lo)
                            self.driver.analog_event(spec["id"], 1 - value if spec.get("invert") else value)
        except Exception as error:
            log.debug("usb read loop for %s ended (%s)", path, error)

    async def loop(self):
        while self.available and not self.stop_flag.is_set():
            await asyncio.to_thread(self.scan)
            await asyncio.sleep(2)

    def relearn(self):
        with self.lock:
            for entry in self.devices.values():
                try:
                    entry["dev"].close()
                except Exception:
                    pass
            self.devices.clear()
        self.driver.devices_dirty = True

    def close(self):
        self.stop_flag.set()
        self.relearn()


# ---------------------------------------------------------------------------
# The 3.5" SPI touch screen (framebuffer + ADS7846 touch)
# ---------------------------------------------------------------------------
def set_line(driver):
    """"Sunday AM · from Mac · Oct 24 9:12" - the set this pedal holds (uploaded from Central Pedal Control)."""
    try:
        st = driver.transfer.loaded_set() if driver and getattr(driver, "transfer", None) else None
    except Exception:
        st = None
    if not st:
        return ""
    when = time.strftime("%b %d %H:%M", time.localtime(st.get("at") or 0))
    return "%s · from %s · %s%s" % (st.get("name") or "Set", st.get("from") or "?", when, " · changed here" if st.get("changed") else "")


# ---------------------------------------------------------------------------
# The 3.5" screen's touch panel (a resistive ADS7846 / XPT2046): calibration and smoothing
# ---------------------------------------------------------------------------
def touch_affine_fit(raw_pts, screen_pts):
    """Least-squares affine map from the panel's raw numbers to screen pixels: x = a·rx + b·ry + c, y = d·rx + e·ry + f.
    Five points (4 corners + the centre) cover a panel that is swapped, turned, mirrored or a little skewed.
    Returns ([a, b, c, d, e, f], rms error in pixels), or (None, None) when the points don't span the panel."""
    n = len(raw_pts)
    if n < 3 or n != len(screen_pts):
        return None, None
    mx = sum(p[0] for p in raw_pts) / float(n)   # (centred raw numbers keep the sums well-conditioned)
    my = sum(p[1] for p in raw_pts) / float(n)
    pts = [(rx - mx, ry - my) for rx, ry in raw_pts]
    sxx = sum(u * u for u, _ in pts); sxy = sum(u * v for u, v in pts); syy = sum(v * v for _, v in pts)
    det = sxx * syy - sxy * sxy
    if det <= 1e-6 * max(1.0, sxx * syy):
        return None, None
    out = []
    for k in (0, 1):
        t = [p[k] for p in screen_pts]
        tm = sum(t) / float(n)
        su = sum(u * (ti - tm) for (u, _), ti in zip(pts, t))
        sv = sum(v * (ti - tm) for (_, v), ti in zip(pts, t))
        a = (su * syy - sv * sxy) / det
        b = (sv * sxx - su * sxy) / det
        out += [a, b, tm - a * mx - b * my]
    err = 0.0
    for (rx, ry), (sx, sy) in zip(raw_pts, screen_pts):
        err += (out[0] * rx + out[1] * ry + out[2] - sx) ** 2 + (out[3] * rx + out[4] * ry + out[5] - sy) ** 2
    return [round(v, 7) for v in out], math.sqrt(err / n)


def touch_press_point(samples):
    """Where a held touch was, from all its readings: the middle value of each, leaving out the first readings (the
    finger still settling) and the last ones (lifting off - a resistive panel's readings wander then)."""
    pts = list(samples)
    if len(pts) >= 8:
        pts = pts[2:-3]
    elif len(pts) >= 3:
        pts = pts[1:]
    if not pts:
        return None
    xs, ys = sorted(p[0] for p in pts), sorted(p[1] for p in pts)
    return xs[len(xs) // 2], ys[len(ys) // 2]


class TouchFilter:
    """A finger sliding on the panel, in screen pixels: steady but without lag you can feel.
    - the middle of the last 3 readings (one wild reading - often the one as the finger lifts - never gets through)
    - a reading far from the last one is held back until the next one agrees (a real fast move gets through a
      reading later; a spike never does)
    - small wobbles are smoothed, real moves are followed at once (the smoothing gets lighter the faster it moves)"""
    WINDOW = 3
    JUMP = 48.0      # px in one reading (~8 ms) - further than a finger moves
    SETTLE = 6.0     # px: slower than this is smoothed

    def __init__(self):
        self.reset()

    def reset(self):
        self.win, self.out, self.suspect, self.at = [], None, None, 0.0

    def add(self, x, y, now=None):
        now = time.monotonic() if now is None else now
        if self.at and now - self.at > 0.15:   # (a new touch)
            self.reset()
        self.at = now
        if self.out is not None and math.hypot(x - self.out[0], y - self.out[1]) > self.JUMP:
            s = self.suspect
            if s is None or math.hypot(x - s[0], y - s[1]) > self.JUMP / 2:
                self.suspect = (x, y)
                return None
            self.win = [s]   # (two readings agree: the finger really moved there)
        self.suspect = None
        self.win = (self.win + [(x, y)])[-self.WINDOW:]
        xs, ys = sorted(p[0] for p in self.win), sorted(p[1] for p in self.win)
        mx, my = xs[len(xs) // 2], ys[len(ys) // 2]
        if self.out is None:
            self.out = (float(mx), float(my))
        else:
            d = math.hypot(mx - self.out[0], my - self.out[1])
            a = max(0.35, min(1.0, d / self.SETTLE))
            self.out = (self.out[0] + (mx - self.out[0]) * a, self.out[1] + (my - self.out[1]) * a)
        return self.out


class MiniScreen:
    """The small touch screen on the GPIO pins (/dev/fb1): Pads, Tracks, Instrument and Settings tabs, drawn here and
    touched through its own panel. Taps run the app's actions; the tabs, pages and HDMI choices are the screen's own."""

    def __init__(self, driver, spec, fb_override=None):
        self.driver = driver
        self.spec = spec or {}
        self.w = int(self.spec.get("width", 480))
        self.h = int(self.spec.get("height", 320))
        self.fb = fb_override or self.spec.get("fb", "/dev/fb1")
        self.available = False
        self.image = None
        self.hits = []
        self.lock = threading.Lock()
        self.tab, self.sub, self.pages, self.override = "pads", {}, {}, {}
        self.active, self.drag_at, self.confirm, self.confirm_at = None, 0.0, None, 0.0
        self.pick_screen, self.touch_msg = None, ""
        self.notice, self.notice_at = "", 0.0   # (a line along the bottom for a few seconds: "Part of Central Pedals · $70 a year…")
        self.overlay = None    # a list to pick from (boards, sounds, what a button does) or the keyboard, over the page
        self.lists = {}        # what the app sent for those lists: {what: {"items": [...], ...}}
        self.wifi, self.wifi_at, self.wifi_busy, self.wifi_msg = None, 0.0, False, ""
        self.update_msg, self.update_ready = "", False
        # the touch panel: a full-screen touch mode (calibrate / check / test) when not None, the slide smoothing,
        # and what the panel has been doing (the Touch test page and the start-up report show it)
        self.tmode = None
        self.dragf = TouchFilter()
        # (10.0.1) a mouse click on the big screen's app shows here too: the matching tab, the matching button lit for a
        # moment. A finger on this screen wins: for FINGER_WINS seconds after a touch, clicks over there don't move it.
        self.flash, self.touched_at = None, -99.0
        self.tstats = {"device": None, "presses": 0, "taps": 0, "rate": 0.0, "jitter": 0.0, "tapMs": 0.0, "pressure": None, "last": 0.0}
        self.song_edit = False   # (the setlist page's EDIT: move songs, take them out)
        self.lists_saving = None
        self.load_lists()
        self.COL = dict(MiniScreen.COL)   # (this screen's colours: the app's Settings → Colours can change them)
        try:
            self.set_theme((getattr(driver, "config", None) or {}).get("mini_theme"))
        except Exception:
            pass
        try:
            from PIL import Image, ImageDraw, ImageFont
            self.Image, self.ImageDraw, self.ImageFont = Image, ImageDraw, ImageFont
        except Exception as error:
            log.info("3.5\" screen rendering disabled (%s) - install python3-pil", error)
            return
        self.available = True
        self.load_fonts()

    def fb_present(self):
        return os.path.exists(self.fb)

    @staticmethod
    def clip(text, n):
        text = str(text or "")
        return text if len(text) <= n else text[: n - 1] + "…"

    # ----- the look (the same colours as the app's "Copy of the small touch screen" page) -------------------------
    COL = {"bg": (17, 19, 23), "bar": (26, 29, 34), "text": (236, 231, 221), "muted": (154, 161, 171), "accent": (226, 194, 126),
           "idle": (22, 42, 66), "selected": (31, 68, 110), "playing": (34, 128, 92), "stop": (96, 34, 46), "line": (52, 58, 68),
           "btn": (35, 39, 46), "on": (226, 194, 126), "ontext": (26, 20, 8), "warn": (255, 190, 110), "track": (46, 51, 60),
           "lp_rec": (229, 72, 77), "lp_dub": (245, 165, 36), "lp_play": (48, 164, 108), "lp_stop": (141, 181, 222)}
    TABS = [("pads", "PADS"), ("tracks", "TRACKS"), ("instrument", "INSTRUMENT"), ("looper", "LOOPER"), ("settings", "SETTINGS")]
    SUBS = {"pads": [("pads", "Pads"), ("key", "Key"), ("sound", "Sound"), ("fx", "Effects")],
            "tracks": [("play", "Play"), ("mix", "Mixer"), ("songs", "Setlist"), ("fx", "Effects"), ("scenes", "Scenes"), ("tempo", "Tempo")],
            "instrument": [("sound", "Sound"), ("pedals", "Pedals"), ("eq", "EQ · Comp"), ("tune", "Tuner · Level")],
            "looper": [("loops", "Loops"), ("mix", "Mix"), ("setup", "Setup")],
            "settings": [("audio", "Audio"), ("wifi", "Wi-Fi"), ("controls", "Controls"), ("screens", "Screens"), ("touch", "Touch"), ("system", "System")]}
    KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    FINGER_WINS = 1.5     # seconds a touch here keeps a mouse click on HDMI from switching the page under the finger
    FLASH_FOR = 0.45      # how long the mirrored button stays lit
    HDMI1 = [("app", "Central Pedal app"), ("touch", "Copy of this screen"), ("lyrics", "Lyrics"), ("charts", "Chord charts"), ("stage", "Stage display"), ("slides", "Slides")]
    HDMI2 = [("lyrics", "Lyrics"), ("slides", "Slides & lyrics"), ("stage", "Stage display"), ("charts", "Chord charts"), ("touch", "Copy of this screen"), ("app", "Central Pedal app"), ("off", "Nothing")]
    KIND_SHORT = {"electric": "Electric", "acoustic": "Acoustic", "bass": "Bass", "keys": "Keys", "off": "Off"}

    def load_fonts(self):
        here = os.path.dirname(os.path.abspath(__file__))
        roots = [os.path.join(here, "fonts")]
        try:
            roots.insert(0, os.path.join(self.driver.config["app_root"], "fonts"))
        except Exception:
            pass
        dejavu = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"]

        def find(name):
            for r in roots:
                p = os.path.join(r, name)
                if os.path.isfile(p):
                    return p
            return next((c for c in dejavu if os.path.isfile(c)), None)

        def font(name, size):
            path = find(name)
            basic = getattr(getattr(self.ImageFont, "Layout", None), "BASIC", getattr(self.ImageFont, "LAYOUT_BASIC", 0))
            try:   # (the basic layout: the same letter spacing with or without libraqm)
                return self.ImageFont.truetype(path, size, layout_engine=basic) if path else self.ImageFont.load_default()
            except Exception:
                try:
                    return self.ImageFont.truetype(path, size)
                except Exception:
                    return self.ImageFont.load_default()
        self.F = {"title": font("archivo-semibold.ttf", 16), "sub": font("archivo-medium.ttf", 11), "label": font("archivo-medium.ttf", 12),
                  "btn": font("archivo-bold.ttf", 13), "tab": font("archivo-condensed-bold.ttf", 13), "num": font("archivo-bold.ttf", 21),
                  "tiny": font("archivo-semibold.ttf", 9), "big": font("archivo-bold.ttf", 30), "name": font("archivo-semibold.ttf", 14)}
        # (older names other code and tests use)
        self.font, self.small, self.big = self.F["btn"], self.F["sub"], self.F["num"]

    # ----- small drawing helpers ------------------------------------------------------------------------------------
    # Text is most of the drawing time (FreeType draws every letter each time): each word's picture is kept and
    # stamped again, so a redraw costs a few milliseconds even on a Pi 3.
    TEXT_CACHE = 4000

    def text_width(self, g, text, font):
        cache = self.__dict__.setdefault("_wcache", {})
        key = (text, id(font))
        w = cache.get(key)
        if w is None:
            w = g.textlength(text, font=font)
            if len(cache) > self.TEXT_CACHE:
                cache.clear()
            cache[key] = w
        return w

    def fit(self, g, text, font, width):
        text = str(text or "")
        try:
            if self.text_width(g, text, font) <= width:
                return text
            lo, hi = 0, len(text)   # the longest start that fits with "…" (halving, not a letter at a time)
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if self.text_width(g, text[:mid] + "…", font) <= width:
                    lo = mid
                else:
                    hi = mid - 1
            return text[:lo].rstrip() + "…"
        except Exception:
            n = max(1, int(width / 7))
            return text if len(text) <= n else text[: n - 1] + "…"

    @staticmethod
    def _rgb(value):
        v = str(value or "").strip().lstrip("#")
        if len(v) == 3:
            v = "".join(c * 2 for c in v)
        if len(v) != 6 or any(c not in "0123456789abcdefABCDEF" for c in v):
            return None
        return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))

    def set_theme(self, colors):
        """The app's colours (Settings → Colours): background, panels, text, accent... None = our own look."""
        col = dict(MiniScreen.COL)
        for k, v in (colors or {}).items():
            rgb = self._rgb(v)
            if k in col and rgb:
                col[k] = rgb
        changed = col != self.COL
        self.COL = col
        return changed

    # characters the screen's font (Archivo) has no shape for: drawn as their nearest look-alike instead of a box
    GLYPH_FALLBACK = str.maketrans({"→": "›", "←": "‹", "⌫": "‹", "▲": "^", "▼": "v", "♭": "b", "♯": "#", "✕": "×", "✓": "", "↔": "–"})

    def text(self, g, xy, text, font, fill, anchor="la", width=None):
        text = str(text if text is not None else "").translate(self.GLYPH_FALLBACK)
        if width:
            text = self.fit(g, text, font, width)
        if not text:
            return
        try:
            cache = self.__dict__.setdefault("_tcache", {})
            x, y = float(xy[0]), float(xy[1])
            start = (round(x - math.floor(x), 2), round(y - math.floor(y), 2))   # (the same sub-pixel place as drawing it afresh)
            key = (text, id(font), anchor, start)
            hit = cache.get(key)
            if hit is None:
                hit = font.getmask2(text, "L", anchor=anchor, start=start)
                if len(cache) > self.TEXT_CACHE:
                    cache.clear()
                cache[key] = hit
            mask, off = hit
            g.draw.draw_bitmap((int(math.floor(x)) + off[0], int(math.floor(y)) + off[1]), mask, g._getink(fill)[0])
            return
        except Exception:
            pass
        try:
            g.text(xy, text, font=font, fill=fill, anchor=anchor)
        except Exception:
            g.text(xy, text, font=font, fill=fill)

    def button(self, g, hits, box, label, action, on=False, fill=None, sub=None, font=None, color=None, radius=9):
        C = self.COL
        bg = C["on"] if on else (fill or C["btn"])
        g.rounded_rectangle(box, radius, fill=bg, outline=C["accent"] if on else C["line"])
        fg = C["ontext"] if on else (color or C["text"])
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        w = box[2] - box[0] - 10
        if sub:
            self.text(g, (cx, cy - 7), label, font or self.F["btn"], fg, "mm", w)
            self.text(g, (cx, cy + 9), sub, self.F["sub"], C["ontext"] if on else C["muted"], "mm", w)
        else:
            self.text(g, (cx, cy), label, font or self.F["btn"], fg, "mm", w)
        if action is not None:
            hits.append((list(map(int, box)), action))

    def slider_value(self, key, value):
        o = self.override.get(key)
        if o and time.monotonic() - o[1] < 1.5:
            return o[0]
        return value

    @staticmethod
    def pan_text(p):
        """Pan as people read it: L 30 / C / R 30."""
        p = float(p or 0)
        n = int(round(abs(p) * 100))
        return "C" if n < 2 else ("L %d" if p < 0 else "R %d") % n

    def pan_fader(self, g, hits, box, pan, action):
        """PAN beside a track's level: a centre mark and a bar that grows from the middle. Dragging moves it; a
        double-tap puts it back in the centre (a single tap doesn't jump it)."""
        C = self.COL
        x0, y0, x1, y1 = box
        key = action["name"] + "|" + json.dumps(action.get("args") or {}, sort_keys=True)
        v = max(0.0, min(1.0, float(self.slider_value(key, (float(pan or 0) + 1) / 2))))
        cy = (y0 + y1) / 2
        self.text(g, (x0 + 1, cy - 8), "PAN", self.F["tiny"], C["muted"])
        self.text(g, (x0 + 1, cy + 7), self.pan_text(v * 2 - 1), self.F["sub"], C["text"], "lm", 34)
        bx0, bx1 = x0 + 38, x1 - 6
        mid = (bx0 + bx1) / 2
        g.rounded_rectangle([bx0, cy - 4, bx1, cy + 4], 4, fill=C["track"])
        fx = bx0 + (bx1 - bx0) * v
        if abs(fx - mid) > 2:
            g.rectangle([min(fx, mid), cy - 4, max(fx, mid), cy + 4], fill=C["accent"])
        g.line([mid, cy - 9, mid, cy + 9], fill=C["muted"], width=1)
        g.ellipse([fx - 7, cy - 7, fx + 7, cy + 7], fill=C["text"], outline=C["bg"])
        hits.append(([int(bx0 - 8), int(y0), int(bx1 + 6), int(y1)], dict(action, slider=[bx0, bx1], key=key, pan=True)))

    def fader(self, g, hits, box, label, value, action, valtext=None, dim=False, label_w=118):
        """A row: its name on the left, a bar to slide across (tap or drag)."""
        C = self.COL
        x0, y0, x1, y1 = box
        key = action["name"] + "|" + json.dumps(action.get("args") or {}, sort_keys=True)
        v = max(0.0, min(1.0, float(self.slider_value(key, value) or 0)))
        lw = label_w
        self.text(g, (x0 + 2, (y0 + y1) / 2), label, self.F["label"], C["muted"] if dim else C["text"], "lm", lw - 6)
        bx0, bx1, cy = x0 + lw, x1 - 44, (y0 + y1) / 2
        g.rounded_rectangle([bx0, cy - 5, bx1, cy + 5], 5, fill=C["track"])
        fx = bx0 + (bx1 - bx0) * v
        if fx > bx0 + 4:
            g.rounded_rectangle([bx0, cy - 5, fx, cy + 5], 5, fill=C["line"] if dim else C["accent"])
        g.ellipse([fx - 9, cy - 9, fx + 9, cy + 9], fill=C["text"], outline=C["bg"])
        self.text(g, (x1 - 2, cy), valtext if valtext is not None else "%d%%" % round(v * 100), self.F["sub"], C["muted"], "rm", 42)
        hits.append(([int(bx0 - 10), int(y0), int(bx1 + 10), int(y1)], dict(action, slider=[bx0, bx1], key=key)))

    def chips(self, g, hits, tab, y0=44, y1=70, pager=None):
        """The tab's pages (Play · Mixer · Setlist …) and, when a list runs long, ‹ 1/3 › on the right."""
        C, W = self.COL, self.w
        subs = self.SUBS[tab]
        right = W - 6 - (96 if pager else 0)
        cw = (right - 6 - 4 * (len(subs) - 1)) / len(subs)
        cur = self.sub.get(tab, subs[0][0])
        for i, (sid, name) in enumerate(subs):
            x = 6 + i * (cw + 4)
            box = [x, y0, x + cw, y1]
            on = sid == cur
            g.rounded_rectangle(box, 13, fill=C["accent"] if on else C["bar"], outline=C["accent"] if on else C["line"])
            self.text(g, ((box[0] + box[2]) / 2, (y0 + y1) / 2), name, self.F["label"], C["ontext"] if on else C["text"], "mm", cw - 8)
            hits.append(([int(b) for b in box], {"local": "sub", "tab": tab, "value": sid}))
        if pager:
            key, page, pages = pager
            self.button(g, hits, [W - 98, y0, W - 66, y1], "‹", {"local": "page", "key": key, "d": -1} if page > 0 else None, radius=13, color=C["text"] if page > 0 else C["line"])
            self.text(g, (W - 50, (y0 + y1) / 2), "%d/%d" % (page + 1, pages), self.F["sub"], C["muted"], "mm")
            self.button(g, hits, [W - 38, y0, W - 6, y1], "›", {"local": "page", "key": key, "d": 1} if page < pages - 1 else None, radius=13, color=C["text"] if page < pages - 1 else C["line"])

    def paged(self, key, items, per):
        pages = max(1, (len(items) + per - 1) // per)
        page = max(0, min(self.pages.get(key, 0), pages - 1))
        self.pages[key] = page
        return items[page * per:(page + 1) * per], page, pages

    # ----- the screen -----------------------------------------------------------------------------------------------
    def render(self, d, _depth=0):
        """Draw the whole screen from the app's display state. Returns the PIL image."""
        if not self.available:
            return None
        C, W, H = self.COL, self.w, self.h
        img = self.Image.new("RGB", (W, H), C["bg"])
        g = self.ImageDraw.Draw(img)
        hits = []
        d = d or {}
        self.header(g, d)
        tab = self.tab if self.tab in dict(self.TABS) else "pads"
        ov = self.overlay
        try:
            if ov:
                getattr(self, "overlay_" + ov["kind"])(g, hits, d)
            else:
                getattr(self, "page_" + tab)(g, hits, d)
        except Exception as error:   # (a page with odd data never blanks the screen)
            log.debug("small screen page %s: %s", tab, error)
            self.text(g, (W / 2, H / 2), "…", self.F["num"], C["muted"], "mm")
        if not (ov and ov["kind"] == "keys"):
            self.tabbar(g, hits, tab)
        if self.notice and time.monotonic() - self.notice_at < self.NOTICE_S:
            g.rounded_rectangle([4, H - 88, W - 4, H - 46], 9, fill=(40, 34, 20), outline=C["accent"], width=2)
            self.lock_icon(g, 12, H - 79, 22, C["accent"])
            self.text(g, (42, H - 67), self.notice, self.F["label"], C["text"], "lm", W - 54)
        ts = getattr(self.driver, "touch_select", None)
        if ts and ts.get("label"):
            # the touch-select knob: which setting it holds, and which way to turn to pick it up
            g.rectangle([0, H - 42, W, H], fill=(10, 40, 30))
            g.line([0, H - 42, W, H - 42], fill=C["accent"], width=2)
            g.text((8, H - 37), self.clip(str(ts.get("label") or "").translate(self.GLYPH_FALLBACK), 46), font=self.font, fill=C["text"])
            pick = ts.get("pickup")
            sub = ("turn it UP to pick it up" if pick == "up" else "turn it DOWN to pick it up" if pick == "down" else str(ts.get("value") or ""))
            g.text((8, H - 19), self.clip(sub, 48), font=self.small, fill=(255, 210, 120) if pick else C["accent"])
        tv = getattr(self.driver, "tuner_view", None)
        if tv and tv.get("on"):
            # the tuner takes the whole small screen
            g.rectangle([0, 0, W, H], fill=(4, 9, 16))
            cents = tv.get("cents")
            ok = cents is not None and abs(int(cents)) < 3
            self.text(g, (10, 8), "TUNER", self.F["tab"], C["muted"])
            self.text(g, (W / 2, 95), str(tv.get("note") or "–"), self.F["big"], C["accent"] if ok else C["text"], "mm")
            g.rectangle([30, 150, W - 30, 158], fill=C["line"])
            g.rectangle([W / 2 - 1, 140, W / 2 + 1, 168], fill=C["muted"])
            if cents is not None:
                x = W / 2 + max(-50, min(50, int(cents))) / 50.0 * (W / 2 - 30)
                g.rectangle([x - 4, 136, x + 4, 172], fill=C["accent"] if ok else (255, 180, 80))
                self.text(g, (W / 2, 200), "in tune" if ok else ("%+d¢ %s" % (int(cents), "sharp" if cents > 0 else "flat")), self.F["title"], C["accent"] if ok else (255, 210, 120), "mm")
            box = [W - 110, H - 50, W - 10, H - 10]
            hits = []
            self.button(g, hits, box, "DONE", {"name": "tuner"}, fill=(21, 42, 67))
        fx = getattr(self.driver, "factory", None)
        if fx and fx.on and fx.pattern:
            # the factory test: colour bars, a grid, and the 4 corners to touch
            hits = []
            bars = [(255, 255, 255), (255, 220, 0), (0, 220, 220), (0, 200, 0), (220, 0, 220), (230, 30, 30), (30, 60, 230), (0, 0, 0)]
            bw = W / len(bars)
            for i, col in enumerate(bars):
                g.rectangle([int(i * bw), 0, int((i + 1) * bw), H], fill=col)
            for x in range(0, W, 40):
                g.line([x, 0, x, H], fill=(70, 70, 70), width=1)
            for y in range(0, H, 40):
                g.line([0, y, W, y], fill=(70, 70, 70), width=1)
            g.rectangle([0, 0, W - 1, H - 1], outline=(255, 255, 255), width=2)
            box = [W / 2 - 150, H / 2 - 34, W / 2 + 150, H / 2 + 34]
            g.rounded_rectangle(box, radius=10, fill=(17, 19, 23))
            self.text(g, (W / 2, H / 2 - 12), "FACTORY TEST", self.F["title"], C["accent"], "mm")
            self.text(g, (W / 2, H / 2 + 12), "Touch the 4 corners  (%d / 4)" % len(fx.corners), self.F["btn"], C["text"], "mm")
            r = 26
            for cid, (cx, cy) in (("tl", (r + 6, r + 6)), ("tr", (W - r - 6, r + 6)), ("bl", (r + 6, H - r - 6)), ("br", (W - r - 6, H - r - 6))):
                done = cid in fx.corners
                g.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(34, 128, 92) if done else (17, 19, 23), outline=(255, 255, 255), width=3)
                g.line([cx - 10, cy, cx + 10, cy], fill=(255, 255, 255), width=2)
                g.line([cx, cy - 10, cx, cy + 10], fill=(255, 255, 255), width=2)
                hits.append(([cx - r - 18, cy - r - 18, cx + r + 18, cy + r + 18], {"local": "factoryCorner", "corner": cid}))
        ps = getattr(self.driver, "phone_setup", None)
        if ps and (ps.on or ps.busy) and not (fx and fx.on):
            # phone setup takes the whole small screen: what to do on the phone
            g.rectangle([0, 0, W, H], fill=C["bg"])
            self.text(g, (14, 12), "Set up with your phone", self.F["title"], C["text"])
            lines = (["The pedal is joining the Wi-Fi…"] if ps.busy else
                     ["Please connect to", "    \"%s\"" % SETUP_SSID, "on your phone's Wi-Fi.", "The setup page opens by itself", "    (or go to %s)" % SETUP_IP, "Pick the church Wi-Fi and a code."])
            for i, line in enumerate(lines):
                self.text(g, (14, 52 + i * 27), line, self.F["btn"], C["accent"] if line.startswith("    \"") else C["text"])
            if ps.error:
                first, _, rest = ps.error.partition(": ")
                self.text(g, (14, H - 100), self.clip(first.replace("The pedal couldn't", "Couldn't"), 52), self.font, (255, 210, 120), "la", W - 28)
                if rest:
                    self.text(g, (14, H - 76), self.clip(rest.split(" - ")[0], 52), self.font, (255, 210, 120), "la", W - 28)
            hits = []
            if not ps.busy:
                self.button(g, hits, [W - 130, H - 50, W - 10, H - 10], "NOT NOW", {"local": "setupStop"}, fill=(21, 42, 67))
        if self.tmode:   # calibrating / checking / testing the touch: the whole screen until it's done
            hits = []
            try:
                self.draw_tmode(g, hits)
            except Exception as error:
                log.debug("touch page: %s", error)
        elif self.flash:
            try:
                if self.draw_flash(g, hits, d) and _depth < 8:
                    return self.render(d, _depth + 1)
            except Exception as error:
                log.debug("mirrored press: %s", error)
                self.flash = None
        with self.lock:
            self.image = img
            self.hits = hits
        return img

    def header(self, g, d):
        C, W = self.COL, self.w
        g.rectangle([0, 0, W, 40], fill=C["bar"])
        song = d.get("song") or {}
        tracks = bool(d.get("tracksMode"))
        section = d.get("section") or {}
        if tracks:
            sub = (section.get("name") or "") + ("  · bar %s" % d.get("bar") if d.get("bar") else "")
            if d.get("countIn"):
                sub = "Count-in %s" % d.get("countIn")
            elif (d.get("loop") if d.get("loop") is not None else -1) >= 0:
                sub += "  · repeat"
        else:
            sub = "Pads" + ("  · layer" if (d.get("performance") or {}).get("layerMode") else "") + ("  · frozen" if d.get("frozen") else "")
        if getattr(self.driver, "service_lock", False):
            sub = "LOCKED · " + sub
        right = W - (178 if tracks else 112)
        self.text(g, (10, 4), song.get("name") or "Central Pedal", self.F["title"], C["text"], "la", right - 16)
        self.text(g, (10, 23), sub, self.F["sub"], C["muted"], "la", right - 16)
        key = str(d.get("key") or song.get("key") or "C")
        x = W - 104
        if tracks:
            pos = d.get("pos") or 0
            self.text(g, (x - 66, 4), "TIME", self.F["tiny"], C["muted"])
            self.text(g, (x - 66, 15), "%d:%02d" % (int(pos) // 60, int(pos) % 60), self.F["num"], C["text"])
            if d.get("playing"):
                g.ellipse([x - 80, 22, x - 72, 30], fill=C["accent"])
        self.text(g, (x, 4), "KEY", self.F["tiny"], C["muted"])
        self.text(g, (x, 15), key, self.F["num"], C["accent"])
        self.text(g, (x + 50, 4), "BPM", self.F["tiny"], C["muted"])
        self.text(g, (x + 50, 15), str(int(round(d.get("bpm") or 0))), self.F["num"], C["text"])

    def tabbar(self, g, hits, tab):
        C, W, H = self.COL, self.w, self.h
        y0 = H - 40
        g.rectangle([0, y0, W, H], fill=C["bar"])
        g.line([0, y0, W, y0], fill=C["line"])
        tw = W / len(self.TABS)
        for i, (tid, name) in enumerate(self.TABS):
            x0, x1 = i * tw, (i + 1) * tw
            if tid == tab:
                g.rectangle([x0, y0 + 1, x1, H], fill=C["btn"])
                g.rectangle([x0 + 10, y0 + 1, x1 - 10, y0 + 4], fill=C["accent"])
            self.text(g, ((x0 + x1) / 2, y0 + 21), name, self.F["tab"], C["accent"] if tid == tab else C["muted"], "mm", tw - 6)
            hits.append(([int(x0), y0, int(x1), H], {"local": "tab", "value": tid}))

    # ----- PADS: the 8 pads + STOP, and the 8 buttons (transport when tracks are on) ---------------------------------
    def page_pads(self, g, hits, d):
        sub = self.sub.get("pads", "pads")
        if sub != "pads":
            return getattr(self, "pads_" + sub)(g, hits, d)
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "pads")
        pads = d.get("pads") or []
        gx, gy, gw, gh = 6, 76, 296, H - 46 - 76
        cw, ch = (gw - 2 * 5) / 3, (gh - 2 * 5) / 3
        for i in range(9):
            r, c = divmod(i, 3)
            x0, y0 = gx + c * (cw + 5), gy + r * (ch + 5)
            box = [int(x0), int(y0), int(x0 + cw), int(y0 + ch)]
            if i == 8:
                g.rounded_rectangle(box, 10, fill=C["stop"], outline=(130, 65, 75))
                self.text(g, ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), "STOP", self.F["btn"], (255, 255, 255), "mm")
                hits.append((box, {"name": "stop"}))
                continue
            pad = pads[i] if i < len(pads) else {"name": "Pad %d" % (i + 1)}
            state = "playing" if pad.get("playing") else "selected" if pad.get("selected") else "idle"
            g.rounded_rectangle(box, 10, fill=C[state], outline=C["accent"] if state == "playing" else C["line"])
            self.text(g, (x0 + 8, y0 + 5), str(i + 1), self.F["sub"], C["accent"] if state == "playing" else C["muted"])
            self.text(g, (x0 + 8, y0 + ch - 16), pad.get("name"), self.F["label"], C["text"], "ld", cw - 14)
            self.pad_volume(g, hits, [x0 + 8, y0 + ch - 12, x0 + cw - 8, y0 + ch - 3], i, pad.get("level"))   # (before the pad: a drag here never plays it)
            hits.append((box, {"name": "pad", "args": {"index": i}}))
        bx, by, bw = 308, gy, W - 308 - 6
        if d.get("tracksMode"):
            loop = d.get("loop") if d.get("loop") is not None else -1
            buttons = [("PAUSE" if d.get("playing") else "PLAY", {"name": "playPause"}, bool(d.get("playing"))),
                       ("START", {"name": "startOver"}, False), ("SECTION ›", {"name": "nextSection"}, False),
                       ("REPEAT", {"name": "repeatSection"}, loop >= 0),
                       ("KEY −", {"name": "keyDown"}, False), ("KEY +", {"name": "keyUp"}, False),
                       ("CLICK", {"name": "toggleClick"}, bool(d.get("click", True))), ("NEXT SONG", {"name": "nextSong"}, False)]
        else:
            perf = d.get("performance") or {}
            buttons = [("TAP", {"name": "tap"}, False), ("FREEZE", {"name": "freeze"}, bool(d.get("frozen"))),
                       ("KEY −", {"name": "keyDown"}, False), ("KEY +", {"name": "keyUp"}, False),
                       ("LAYER", {"name": "layer"}, bool(perf.get("layerMode"))), ("NEXT SONG", {"name": "nextSong"}, False),
                       ("PREV SONG", {"name": "prevSong"}, False), ("TRACKS", {"name": "toggleTracks"}, False)]
        bh = (gh - 3 * 4) / 4
        for i, (label, action, on) in enumerate(buttons[:8]):
            r, c = divmod(i, 2)
            x0, y0 = bx + c * (bw / 2 + 2), by + r * (bh + 4)
            self.button(g, hits, [x0, y0, x0 + bw / 2 - 2, y0 + bh], label, action, on=on, font=self.F["sub"] if len(label) > 8 else self.F["btn"])

    def pad_volume(self, g, hits, box, index, level):
        """A pad's own volume along the bottom of its button: a thin bar with a knob. Slide it to change; a tap alone
        doesn't jump it (and never plays the pad)."""
        C = self.COL
        x0, y0, x1, y1 = box
        action = {"name": "padVolume", "args": {"index": index}}
        key = action["name"] + "|" + json.dumps(action["args"], sort_keys=True)
        v = max(0.0, min(1.0, float(self.slider_value(key, (72 if level is None else float(level)) / 100.0) or 0)))
        cy = (y0 + y1) / 2
        g.rounded_rectangle([x0, cy - 3, x1, cy + 3], 3, fill=C["track"])
        fx = x0 + (x1 - x0) * v
        if fx > x0 + 3:
            g.rounded_rectangle([x0, cy - 3, fx, cy + 3], 3, fill=C["accent"])
        g.ellipse([fx - 6, cy - 6, fx + 6, cy + 6], fill=C["text"], outline=C["bg"])
        hits.append(([int(x0 - 4), int(y0 - 2), int(x1 + 4), int(y1 + 2)], dict(action, slider=[x0, x1], key=key, nojump=True)))

    @classmethod
    def key_index(cls, key):
        """C = 0 … B = 11 from "G", "F#m", "Bb", "E♭" (None when it can't be read)."""
        m = re.match(r"\s*([A-Ga-g])([#♯b♭]?)", str(key or ""))
        if not m:
            return None
        n = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[m.group(1).upper()]
        return (n + (1 if m.group(2) in ("#", "♯") else -1 if m.group(2) in ("b", "♭") else 0)) % 12

    def pads_key(self, g, hits, d):
        """Every key at once: a tap goes straight to it (playing tracks shift with it)."""
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "pads")
        key = d.get("key") or (d.get("song") or {}).get("key")
        cur = self.key_index(key)
        minor = bool(re.match(r"\s*[A-Ga-g][#♯b♭]?m(?!aj)", str(key or "")))
        cw, kh = (W - 12 - 5 * 4) / 6, 50
        for i, name in enumerate(self.KEY_NAMES):
            r, c = divmod(i, 6)
            x, y = 6 + c * (cw + 4), 76 + r * (kh + 4)
            delta = ((i - cur + 6) % 12) - 6 if cur is not None else None
            action = None if delta == 0 else {"name": "stepKey", "delta": delta} if delta is not None else None
            self.button(g, hits, [x, y, x + cw, y + kh], name + ("m" if minor else ""), action, on=cur == i,
                        font=self.F["num"] if len(name) == 1 and not minor else self.F["title"])
        y = 76 + 2 * (kh + 4) + 4
        half = (W - 12 - 5) / 2
        self.button(g, hits, [6, y, 6 + half, y + 46], "KEY −", {"name": "keyDown"}, sub="a half step down")
        self.button(g, hits, [11 + half, y, W - 6, y + 46], "KEY +", {"name": "keyUp"}, sub="a half step up")
        self.text(g, (W / 2, H - 56), "The pads change key at once; playing tracks shift with them.", self.F["sub"], C["muted"], "mm", W - 16)

    def pads_sound(self, g, hits, d):
        """How the pads sound: volume, reverb, tone, fade - and freeze, layer and the two textures."""
        W, H = self.w, self.h
        self.chips(g, hits, "pads")
        perf = d.get("performance") or {}
        vol = (d.get("mini") or {}).get("volume")
        rows = [("Pads volume", "volume", perf.get("volume", vol if vol is not None else 0.85)), ("Reverb", "reverb", perf.get("reverb", 0.5)),
                ("Tone", "tone", perf.get("tone", 1)), ("Fade time", "fade", perf.get("fade", 0.5))]
        y, rh = 76, 32
        for label, name, value in rows:
            value = float(value or 0)
            vt = ("dark" if value < 0.2 else "bright" if value > 0.8 else "%d%%" % round(value * 100)) if name == "tone" else None
            self.fader(g, hits, [6, y, W - 6, y + rh], label, value, {"name": name}, valtext=vt)
            y += rh
        tex = d.get("textures") or []
        buttons = [("FREEZE", {"name": "freeze"}, bool(d.get("frozen")), "hold the sound"), ("LAYER", {"name": "layer"}, bool(perf.get("layerMode")), "stack pads")]
        for n in (0, 1):
            t = tex[n] if n < len(tex) else {}
            buttons.append(("TEXTURE %d" % (n + 1), {"name": "texture%d" % (n + 1)}, bool(t.get("on")), t.get("name") or "off"))
        bw = (W - 12 - 3 * 5) / 4
        for i, (label, action, on, sub) in enumerate(buttons):
            x = 6 + i * (bw + 5)
            self.button(g, hits, [x, y + 6, x + bw, H - 46], label, action, on=on, sub=sub, font=self.F["label"])

    # ----- TRACKS ---------------------------------------------------------------------------------------------------
    def page_tracks(self, g, hits, d):
        sub = self.sub.get("tracks", "play")
        getattr(self, "tracks_" + sub)(g, hits, d)

    def tracks_play(self, g, hits, d):
        C, W, H = self.COL, self.w, self.h
        secs = d.get("sections") or []
        cur = (d.get("section") or {}).get("index")
        if secs and cur is not None and self.pages.get("secs_song") != d.get("songId"):
            self.pages["secs_song"] = d.get("songId")
            self.pages["secs"] = int(cur) // 5
        items = [dict(s, index=i) for i, s in enumerate(secs)]
        shown, page, pages = self.paged("secs", items, 5)
        self.chips(g, hits, "tracks", pager=("secs", page, pages) if pages > 1 else None)
        y0, y1 = 76, 108
        if not shown:
            self.text(g, (W / 2, (y0 + y1) / 2), "No sections - this song has no tracks" if not (d.get("song") or {}).get("hasTracks") else "No sections yet", self.F["sub"], C["muted"], "mm")
        cw = (W - 12 - 4 * 4) / 5
        for j, s in enumerate(shown):
            x = 6 + j * (cw + 4)
            on = s["index"] == cur
            col = s.get("color")
            fill = C["btn"]
            if isinstance(col, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", col):
                rgb = tuple(int(col[k:k + 2], 16) for k in (1, 3, 5))
                fill = tuple(int(v * (0.85 if on else 0.35) + C["bg"][n] * (0.15 if on else 0.65)) for n, v in enumerate(rgb))
            g.rounded_rectangle([x, y0, x + cw, y1], 8, fill=fill, outline=C["accent"] if on else C["line"], width=2 if on else 1)
            self.text(g, (x + cw / 2, (y0 + y1) / 2), s.get("name") or "Section", self.F["label"], C["text"], "mm", cw - 8)
            hits.append(([int(x), y0, int(x + cw), y1], {"name": "goSection", "args": {"index": s["index"]}}))
        loop = d.get("loop") if d.get("loop") is not None else -1
        buttons = [("PAUSE" if d.get("playing") else "PLAY", {"name": "playPause"}, bool(d.get("playing")), None),
                   ("STOP", {"name": "stopTracks"}, False, None), ("‹ SECTION", {"name": "prevSection"}, False, None),
                   ("SECTION ›", {"name": "nextSection"}, False, None),
                   ("REPEAT", {"name": "repeatSection"}, loop >= 0, None), ("START", {"name": "startOver"}, False, "from the top"),
                   ("‹ SONG", {"name": "prevSong"}, False, None), ("NEXT SONG", {"name": "nextSong"}, False, None)]
        gy0, gy1 = 114, H - 46
        bw, bh = (W - 12 - 3 * 5) / 4, (gy1 - gy0 - 5) / 2
        for i, (label, action, on, sub) in enumerate(buttons):
            r, c = divmod(i, 4)
            x, y = 6 + c * (bw + 5), gy0 + r * (bh + 5)
            self.button(g, hits, [x, y, x + bw, y + bh], label, action, on=on, sub=sub)

    def tracks_mix(self, g, hits, d):
        C, W, H = self.COL, self.w, self.h
        m = d.get("mini") or {}
        lv = m.get("levels") or {}
        rows = [("Tracks (all)", {"name": "tracksLevel"}, lv.get("tracks", 0.85), None, None, None),
                ("Click", {"name": "clickLevel"}, lv.get("click", 0.85), None, None, None)]
        for s in m.get("stems") or []:
            rows.append((s.get("name") or "Track", {"name": "stemLevel", "args": {"index": s.get("i", 0)}}, min(1.0, (s.get("gain") or 0) / 1.3),
                         {"name": "stemMute", "args": {"index": s.get("i", 0)}}, bool(s.get("mute")), s))
        shown, page, pages = self.paged("mix", rows, 6)
        self.chips(g, hits, "tracks", pager=("mix", page, pages) if pages > 1 else None)
        y = 76
        rh = (H - 46 - 76) / 6
        for label, action, value, mute, muted, stem in shown:
            x0 = 6
            if mute is not None:
                self.button(g, hits, [6, y + 3, 38, y + rh - 3], "M", mute, on=muted, radius=7, font=self.F["label"])
                x0 = 44
            if stem is not None:   # a track: its level, and its PAN on the right
                self.fader(g, hits, [x0, y, W - 124, y + rh], label, value, action, dim=bool(muted), label_w=100)
                self.pan_fader(g, hits, [W - 118, y, W - 6, y + rh], stem.get("pan") or 0, {"name": "stemPan", "args": {"index": stem.get("i", 0)}})
            else:
                self.fader(g, hits, [x0, y, W - 6, y + rh], label, value, action, dim=bool(muted))
            y += rh
        if not (m.get("stems") or []):
            self.text(g, (W / 2, H - 70), "This song has no tracks yet", self.F["sub"], C["muted"], "mm")

    def tracks_songs(self, g, hits, d):
        """The setlist: tap a song to go to it; ‹ SONG, NEXT ›, START SET (song 1); + ADD from the song library (A–Z);
        EDIT: move a song up / down or take it out of this setlist (✕ twice - it stays in the song library)."""
        C, W, H = self.COL, self.w, self.h
        songs = d.get("songs") or []
        cur = (d.get("song") or {}).get("index")
        per = 4
        if cur is not None and self.pages.get("songs_cur") != cur:
            self.pages["songs_cur"] = cur
            self.pages["songs"] = int(cur) // per
        items = [dict(s, index=i) for i, s in enumerate(songs)]
        shown, page, pages = self.paged("songs", items, per)
        self.chips(g, hits, "tracks", pager=("songs", page, pages) if pages > 1 else None)
        edit = bool(self.song_edit)
        held = set_line(self.driver)
        line = ("Set: " + held) if held else "Setlist · %d song%s" % (len(songs), "" if len(songs) == 1 else "s")
        self.text(g, (8, 84), line, self.F["sub"], C["muted"], "lm", W - 16)
        y, rh = 92, 36
        armed = self.confirm if (self.confirm or "").startswith("rm:") and time.monotonic() - self.confirm_at < 4 else None
        for s in shown:
            on = s["index"] == cur
            right = W - 6 - (3 * 44 if edit else 0)
            box = [6, y + 2, right, y + rh - 2]
            g.rounded_rectangle(box, 8, fill=C["selected"] if on else C["btn"], outline=C["accent"] if on else C["line"])
            cy = (box[1] + box[3]) / 2
            self.text(g, (16, cy), str(s["index"] + 1), self.F["label"], C["accent"] if on else C["muted"], "lm")
            self.text(g, (44, cy), s.get("name") or "Song", self.F["name"], C["text"], "lm", right - 44 - 50)
            self.text(g, (right - 24, cy), s.get("key") or "", self.F["label"], C["muted"], "rm")
            if s.get("hasTracks"):   # (a dot: the song has tracks)
                g.ellipse([right - 16, cy - 4, right - 8, cy + 4], fill=C["accent"])
            hits.append(([6, int(y), int(right), int(y + rh)], {"name": "loadSong", "args": {"index": s["index"]}}))   # (the whole row height: easier to hit)
            if edit:
                i = s["index"]
                x = right + 4
                self.icon_button(g, hits, [x, y + 2, x + 40, y + rh - 2], "up", {"local": "pick", "what": "setlistMove", "id": i, "target": -1, "quiet": True} if i > 0 else None, tall=(y, y + rh))
                self.icon_button(g, hits, [x + 44, y + 2, x + 84, y + rh - 2], "down", {"local": "pick", "what": "setlistMove", "id": i, "target": 1, "quiet": True} if i < len(songs) - 1 else None, tall=(y, y + rh))
                self.icon_button(g, hits, [x + 88, y + 2, W - 6, y + rh - 2], "x", {"local": "rmSong", "index": i}, fill=C["stop"] if armed == "rm:%d" % i else None, tall=(y, y + rh))
            y += rh
        if not songs:
            self.text(g, (W / 2, 150), "The setlist is empty", self.F["sub"], C["muted"], "mm")
            self.text(g, (W / 2, 172), "+ ADD a song from the library, or upload a set from Central Pedal Control", self.F["sub"], C["muted"], "mm", W - 20)
        bw = (W - 12 - 5 * 4) / 6
        for i, (label, action, on) in enumerate((("‹ SONG", {"name": "prevSong"}, False), ("NEXT ›", {"name": "nextSong"}, False),
                                                  ("START", {"name": "loadSong", "args": {"index": 0}} if songs else None, False),
                                                  ("+ ADD", {"local": "list", "what": "library", "title": "Song library", "az": True}, False),
                                                  ("SETS", {"local": "list", "what": "setlists", "title": "Load setlist"}, False),
                                                  ("DONE" if edit else "EDIT", {"local": "songEdit"}, edit))):
            x = 6 + i * (bw + 4)
            self.button(g, hits, [x, 240, x + bw, H - 46], label, action, on=on, font=self.F["label"], color=None if action else C["line"])

    def icon_button(self, g, hits, box, icon, action, fill=None, tall=None):
        """A button with a drawn sign (the screen's font has no arrows): up, down, x. tall: (y0, y1) the touch area
        reaches (the whole row, not only the drawn button)."""
        C = self.COL
        g.rounded_rectangle(box, 8, fill=fill or C["btn"], outline=C["line"])
        col = C["text"] if action is not None else C["line"]
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        if icon == "up":
            g.polygon([(cx - 8, cy + 5), (cx + 8, cy + 5), (cx, cy - 6)], fill=col)
        elif icon == "down":
            g.polygon([(cx - 8, cy - 5), (cx + 8, cy - 5), (cx, cy + 6)], fill=col)
        else:
            g.line([cx - 6, cy - 6, cx + 6, cy + 6], fill=col, width=3)
            g.line([cx - 6, cy + 6, cx + 6, cy - 6], fill=col, width=3)
        if action is not None:
            hits.append(([int(box[0]), int(tall[0] if tall else box[1]), int(box[2]), int(tall[1] if tall else box[3])], action))

    def library_items(self):
        """The song library (every song on this pedal), A–Z; the ones already in the setlist say so."""
        sync = getattr(self.driver, "sync", None) if self.driver else None
        try:
            listing = sync.songs_listing() if sync else []
        except Exception:
            listing = []
        inset = {x.get("id") for x in ((self.driver.display or {}).get("songs") if self.driver else None) or []}
        out = []
        for x in listing:
            if not x.get("here", True):
                continue
            bits = [x.get("key") or "", ("%d tracks" % x["stems"]) if x.get("stems") else ""]
            there = x.get("id") in inset
            out.append({"id": x.get("id"), "label": x.get("name") or "Song", "sub": "in the setlist" if there else " · ".join(b for b in bits if b), "inset": there})
        return out

    def local_list(self, what):
        """The lists the screen fills itself (no need to ask the app): the song library, what HDMI 1 / 2 can show."""
        if what == "library":
            self.lists["library"] = {"items": self.library_items(), "at": time.monotonic()}
        elif what == "setlists":   # (10.0: Load setlist - the setlists this pedal knows; the open one is marked)
            sync = getattr(self.driver, "sync", None) if self.driver else None
            try:
                listing = sync.setlists_listing() if sync else []
            except Exception:
                listing = []
            cur = getattr(sync, "current", None)
            self.lists["setlists"] = {"items": [{"id": x["id"], "label": x.get("name") or "Setlist", "sub": "%d song%s%s" % (x.get("count", 0), "" if x.get("count") == 1 else "s", " · open now" if x["id"] == cur else "")} for x in listing],
                                      "current": cur}
        elif what in ("hdmi1", "hdmi2") and self.driver:
            n = 1 if what == "hdmi1" else 2
            cur = self.driver.displays_config().get("hdmi%d" % n) or ("app" if n == 1 else "lyrics")
            self.lists[what] = {"items": [{"id": k, "label": v} for k, v in (self.HDMI1 if n == 1 else self.HDMI2)], "current": "touch" if cur == "mini" else cur}
        else:
            return False
        return True

    # ----- effects: every track (stem), every pad, the tracks bus and the pads bus (js/fx.js through mini-bridge.js) ----
    def tracks_fx(self, g, hits, d):
        self.fx_targets(g, hits, d, "tracks")

    def pads_fx(self, g, hits, d):
        self.fx_targets(g, hits, d, "pads")

    def fx_targets(self, g, hits, d, which):
        C, W, H = self.COL, self.w, self.h
        key = "fxTargets:" + which
        if which == "tracks" and self.pages.get("fxt_song") != d.get("songId"):   # (another song: its own tracks)
            self.lists.pop(key, None)   # (the copy may be another song's: the saved project has this one's until the app sends it)
            self.pages["fxt_song"] = d.get("songId")
            self.want("fxTargets", which, every=0)
        self.want("fxTargets", which, every=3.0)
        data = self.lists.get(key)
        if data is None or (data.get("error") and not data.get("items")):   # (nothing from the app yet: the saved project's)
            data = {"items": self.copy_targets(which, d.get("songId"))}
            self.retry_soon()
        items = (data or {}).get("items") or []
        shown, page, pages = self.paged("fxt:" + which, items, 5)
        self.chips(g, hits, "tracks" if which == "tracks" else "pads", pager=("fxt:" + which, page, pages) if pages > 1 else None)
        y, rh = 76, (H - 46 - 76) / 5
        for it in shown:
            box = [6, y + 2, W - 6, y + rh - 2]
            on = bool(it.get("on"))
            g.rounded_rectangle(box, 8, fill=C["btn"], outline=C["accent"] if on else C["line"])
            cy = (box[1] + box[3]) / 2
            g.ellipse([14, cy - 5, 24, cy + 5], fill=C["accent"] if on else C["track"])
            self.text(g, (34, cy), it.get("label") or "", self.F["name"], C["text"], "lm", W - 34 - 150)
            self.text(g, (W - 34, cy), it.get("sub") or "", self.F["sub"], C["accent"] if on else C["muted"], "rm", 130)
            self.text(g, (W - 14, cy), "›", self.F["title"], C["muted"], "rm")
            hits.append(([6, int(y), W - 6, int(y + rh)], {"local": "fxOpen", "target": it.get("id"), "title": it.get("label")}))
            y += rh
        if which == "tracks" and len(items) <= 1:
            self.text(g, (W / 2, y + 20), "This song has no tracks yet - the tracks bus still works", self.F["sub"], C["muted"], "mm", W - 20)

    FX_TOGGLE = {"gate": "GATE", "eq": "EQ", "comp": "COMP", "reverb": "REVERB", "delay": "DELAY"}
    FX_LABEL = {"gate.threshold": "Threshold", "eq.low": "Low", "eq.mid": "Mid", "eq.high": "High", "comp.amount": "Amount",
                "comp.threshold": "Threshold", "reverb.send": "Send", "delay.send": "Send"}

    def overlay_fx(self, g, hits, d):
        """One track's / pad's / bus's effects: on / off and the preset, then each effect - on / off and its main amount
        (the reverb's type and the delay's time step on with a tap; the better ones say Central Plugins)."""
        C, W, H = self.COL, self.w, self.h
        ov = self.overlay
        tid = ov.get("target") or ""
        self.want("fx", tid, every=3.0)
        entry = self.lists.get("fx:" + tid)
        st = (entry or {}).get("state")
        if not st:   # (nothing from the app yet, or it doesn't know this one: the saved project's)
            st = self.copy_state(tid, d.get("songId"))
            if entry is None or not st:
                self.retry_soon()
        rows = [{"head": True}] + list((st or {}).get("rows") or [])
        shown, page, pages = self.paged("fx:" + tid, rows, 5)
        self.button(g, hits, [6, 44, 86, 70], "‹ BACK", {"local": "back"}, radius=13, font=self.F["label"])
        self.text(g, (96, 57), (st or {}).get("name") or ov.get("title") or "Effects", self.F["name"], C["text"], "lm", W - 96 - (104 if pages > 1 else 8))
        if pages > 1:
            self.button(g, hits, [W - 98, 44, W - 66, 70], "‹", {"local": "page", "key": "fx:" + tid, "d": -1} if page > 0 else None, radius=13, color=C["text"] if page > 0 else C["line"])
            self.text(g, (W - 50, 57), "%d/%d" % (page + 1, pages), self.F["sub"], C["muted"], "mm")
            self.button(g, hits, [W - 38, 44, W - 6, 70], "›", {"local": "page", "key": "fx:" + tid, "d": 1} if page < pages - 1 else None, radius=13, color=C["text"] if page < pages - 1 else C["line"])
        if not st:
            self.text(g, (W / 2, 160), "This one isn't in the song any more", self.F["sub"], C["muted"], "mm")
            self.text(g, (W / 2, 182), "Go back and pick it again from the list", self.F["sub"], C["muted"], "mm")
            return
        master = bool(st.get("on"))
        y, rh = 76, (H - 46 - 76) / 5
        for r in shown:
            if r.get("head"):
                x = 6
                if st.get("master"):
                    self.button(g, hits, [6, y + 3, 74, y + rh - 3], "ON" if master else "OFF", {"name": "fxToggle", "args": {"target": tid, "path": "on"}}, on=master, radius=8)
                    x = 80
                lock = st.get("lock")
                self.button(g, hits, [x, y + 3, W - 6, y + rh - 3], "Preset: " + (st.get("preset") or "your own"),
                            {"local": "list", "what": "fxPresets", "kind": tid, "target": tid, "title": "Presets", "stack": True, "current": st.get("preset")},
                            sub=("pro presets: " + lock) if lock else "tap to pick one", radius=8)
                y += rh
                continue
            on = bool(r.get("on")) and master
            if r.get("toggle"):
                self.button(g, hits, [6, y + 3, 74, y + rh - 3], self.FX_TOGGLE.get(r.get("fx"), "ON"), {"name": "fxToggle", "args": {"target": tid, "path": r["toggle"]}},
                            on=bool(r.get("on")), radius=8, font=self.F["label"])
            ch = r.get("choice")
            right = W - 84 if ch else W - 6
            lo, hi = float(r.get("min", 0)), float(r.get("max", 1))
            v = (float(r.get("value") or 0) - lo) / max(1e-9, hi - lo)
            self.fader(g, hits, [80, y, right, y + rh], self.FX_LABEL.get(r.get("path"), r.get("label") or ""), v,
                       {"name": "fxValue", "args": {"target": tid, "path": r.get("path")}}, valtext=r.get("text"), dim=not on, label_w=72)
            if ch:   # (a small lock: the other types / times come with Central Plugins - a tap says so)
                self.button(g, hits, [W - 80, y + 3, W - 6, y + rh - 3], ch.get("name") or "", {"name": "fxCycle", "args": {"target": tid, "path": ch.get("path")}},
                            sub="tap: next", radius=8, font=self.F["label"])
                if ch.get("more"):
                    self.lock_icon(g, W - 19, y + 6, 10, C["accent"])
            y += rh

    # ----- scenes and screens -----------------------------------------------------------------------------------------
    def tracks_scenes(self, g, hits, d):
        """This song's scenes (recall one, previous / next), lyrics previous / next, the projector blank and what HDMI 1 / 2
        show (picked from a list: a change restarts the screens once)."""
        C, W, H = self.COL, self.w, self.h
        if self.pages.get("scenes_song") != d.get("songId"):
            self.pages["scenes_song"] = d.get("songId")
            self.pages["scenes"] = 0
            self.lists.pop("scenes", None)
            self.want("scenes", every=0)
        self.want("scenes", every=3.0)
        data = self.lists.get("scenes") or {}
        if "items" not in data:   # (nothing from the app yet: this song's scenes from the saved project)
            song = self.saved_song(self.saved_project(), d.get("songId")) or {}
            data = {"items": [{"id": i, "label": sc.get("name") or "Scene %d" % (i + 1)} for i, sc in enumerate(song.get("scenes") or []) if isinstance(sc, dict)]}
            self.retry_soon()
        items = data.get("items") or []
        cur = data.get("current")
        shown, page, pages = self.paged("scenes", items, 6)
        self.chips(g, hits, "tracks", pager=("scenes", page, pages) if pages > 1 else None)
        cw, ch = (W - 12 - 2 * 5) / 3, 38
        if not items:
            self.text(g, (W / 2, 106), "This song has no scenes yet", self.F["sub"], C["muted"], "mm")
            self.text(g, (W / 2, 126), "Add them in the song editor, under Scenes", self.F["sub"], C["muted"], "mm")
        for j, sc in enumerate(shown):
            r, c = divmod(j, 3)
            x, y = 6 + c * (cw + 5), 76 + r * (ch + 4)
            self.button(g, hits, [x, y, x + cw, y + ch], sc.get("label") or "Scene", {"local": "pick", "what": "scenes", "id": sc.get("id"), "label": sc.get("label"), "quiet": True},
                        on=sc.get("id") == cur, radius=8, font=self.F["label"])
        ls = d.get("lyrics") or {}
        lsub = ("page %d of %d" % (int(ls.get("page") or 0) + 1, ls["pages"])) if ls.get("pages") else (ls.get("section") or "")
        bw = (W - 12 - 3 * 5) / 4
        for i, (label, action, sub) in enumerate((("‹ SCENE", {"name": "scenePrev"}, None), ("SCENE ›", {"name": "sceneNext"}, None),
                                                   ("‹ LYRICS", {"name": "lyricsPrev"}, lsub or None), ("LYRICS ›", {"name": "lyricsNext"}, lsub or None))):
            x = 6 + i * (bw + 5)
            self.button(g, hits, [x, 164, x + bw, 206], label, action, sub=sub)
        disp = self.driver.displays_config() if self.driver else {}
        names = []
        for n, opts in ((1, self.HDMI1), (2, self.HDMI2)):
            cur_h = disp.get("hdmi%d" % n) or ("app" if n == 1 else "lyrics")
            names.append(dict(opts).get("touch" if cur_h == "mini" else cur_h, cur_h))
        blank = bool((d.get("projector") or {}).get("blank"))
        third = (W - 12 - 10) / 3
        for i, (label, action, on, sub) in enumerate((("BLANK", {"name": "projectorBlank"}, blank, "projector " + ("blank" if blank else "showing")),
                                                       ("HDMI 1", {"local": "list", "what": "hdmi1", "title": "HDMI 1 shows"}, False, names[0]),
                                                       ("HDMI 2", {"local": "list", "what": "hdmi2", "title": "HDMI 2 shows"}, False, names[1]))):
            x = 6 + i * (third + 5)
            self.button(g, hits, [x, 212, x + third, H - 46], label, action, on=on, sub=sub)

    def overlay_letters(self, g, hits, d):
        """Jump the list to a letter (the letters with no song are dimmed)."""
        C, W, H = self.COL, self.w, self.h
        ov = self.overlay
        parent = ov.get("parent") or {}
        items = (self.lists.get(self.list_key(parent)) or {}).get("items") or [] if parent.get("what") else []
        have = {self.initial(it.get("label")) for it in items}
        self.button(g, hits, [6, 44, 86, 70], "‹ BACK", {"local": "back"}, radius=13, font=self.F["label"])
        self.text(g, (96, 57), "Jump to a letter", self.F["name"], C["text"], "lm")
        letters = [chr(c) for c in range(65, 91)] + ["#"]
        cw, ch, gap = (W - 12 - 6 * 4) / 7, (H - 46 - 76 - 3 * 4) / 4, 4
        for i, L in enumerate(letters):
            r, c = divmod(i, 7)
            x, y = 6 + c * (cw + gap), 76 + r * (ch + gap)
            ok = L in have
            self.button(g, hits, [x, y, x + cw, y + ch], L, {"local": "letter", "letter": L} if ok else None, font=self.F["title"], radius=8,
                        color=None if ok else C["line"])

    @staticmethod
    def initial(label):
        c = str(label or "").strip()[:1].upper()
        return c if "A" <= c <= "Z" else "#"

    def tracks_tempo(self, g, hits, d):
        """The click and the tempo: tempo %, back to 100, ±5 %, tap; click on / off and its level, voice cues, count-in."""
        W, H = self.w, self.h
        self.chips(g, hits, "tracks")
        m = d.get("mini") or {}
        pct = float(m.get("tempoPercent") if m.get("tempoPercent") is not None else round((d.get("speed") or 1) * 100))
        self.fader(g, hits, [6, 76, W - 6, 112], "Tempo", (pct - 50) / 100.0, {"name": "tempoPercent"}, valtext="%d%%" % round(pct), label_w=70)
        bw = (W - 12 - 3 * 5) / 4
        for i, (label, action, sub) in enumerate((("− 5%", {"name": "slower"}, "same pitch"), ("100%", {"name": "tempoReset"}, "as recorded"),
                                                   ("+ 5%", {"name": "faster"}, "same pitch"), ("TAP", {"name": "tap"}, "%d BPM" % round(d.get("bpm") or 0)))):
            x = 6 + i * (bw + 5)
            self.button(g, hits, [x, 116, x + bw, 160], label, action, sub=sub, on=label == "100%" and round(pct) == 100)
        lv = m.get("levels") or {}
        self.fader(g, hits, [6, 166, W - 6, 202], "Click level", lv.get("click", 0.85), {"name": "clickLevel"}, dim=not d.get("click", True), label_w=100)
        third = (W - 12 - 10) / 3
        for i, (label, action, on, sub) in enumerate((("CLICK", {"name": "toggleClick"}, bool(d.get("click", True)), "on" if d.get("click", True) else "off"),
                                                       ("VOICE CUES", {"name": "toggleCues"}, bool(d.get("cues", True)), "on" if d.get("cues", True) else "off"),
                                                       ("COUNT-IN", {"name": "countIn"}, False, "off · 1 · 2 bars"))):
            x = 6 + i * (third + 5)
            self.button(g, hits, [x, 208, x + third, H - 46], label, action, on=on, sub=sub)

    # ----- INSTRUMENT -----------------------------------------------------------------------------------------------
    def page_instrument(self, g, hits, d):
        ins = (d.get("mini") or {}).get("instrument")
        sub = self.sub.get("instrument", "sound")
        if not ins:
            self.chips(g, hits, "instrument")
            self.text(g, (self.w / 2, 170), "The instrument isn't ready yet", self.F["sub"], self.COL["muted"], "mm")
            return
        getattr(self, "instrument_" + sub)(g, hits, d, ins)

    def instrument_sound(self, g, hits, d, ins):
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "instrument")
        kinds = [k[0] for k in ins.get("kinds") or []] or ["electric", "acoustic", "bass", "keys", "off"]
        cw = (W - 12 - 4 * (len(kinds) - 1)) / len(kinds)
        for i, k in enumerate(kinds):
            x = 6 + i * (cw + 4)
            self.button(g, hits, [x, 76, x + cw, 110], self.KIND_SHORT.get(k, k.title()), {"name": "instrumentKindSet", "args": {"kind": k}}, on=k == ins.get("kind"), radius=8)
        keys = ins.get("kind") == "keys"
        off = ins.get("kind") == "off"
        name = ins.get("patch") if keys else ins.get("board")
        y0, y1 = 118, 182
        if off:
            g.rounded_rectangle([6, y0, W - 6, y1], 10, fill=C["bar"], outline=C["line"])
            self.text(g, (W / 2, (y0 + y1) / 2), "The instrument is off - pick one above", self.F["label"], C["muted"], "mm")
        else:
            self.button(g, hits, [6, y0, 66, y1], "‹", {"name": "patchPrev" if keys else "boardPrev"}, font=self.F["num"])
            self.button(g, hits, [W - 66, y0, W - 6, y1], "›", {"name": "patchNext" if keys else "boardNext"}, font=self.F["num"])
            g.rounded_rectangle([72, y0, W - 72, y1], 10, fill=C["bar"], outline=C["line"])
            locked = ins.get("patchLocked") if keys else ins.get("boardLocked")
            self.text(g, (W / 2, y0 + 16), "SOUND" if keys else "BOARD", self.F["tiny"], C["muted"], "mm")
            self.text(g, (W / 2, y0 + (34 if locked else 40)), name or ("pick a sound" if keys else "pick a board"), self.F["title"], C["muted"] if locked else C["text"], "mm", W - 160)
            if locked:
                self.lock_icon(g, 80, y0 + 6, 16, C["accent"])
                self.text(g, (W / 2, y0 + 54), ("muted · " if keys else "locked pedals bypassed · ") + locked, self.F["tiny"], C["accent"], "mm", W - 156)
                hits.append(([72, y0, W - 72, y1], {"local": "say", "text": locked + (" - this sound is muted until the plan is active." if keys else " - its locked pedals are bypassed until the plan is active.")}))
            else:   # the whole list: tap the name
                self.text(g, (W / 2, y0 + 56), "tap for the list", self.F["tiny"], C["muted"], "mm")
                hits.append(([72, y0, W - 72, y1], {"local": "list", "what": "patches" if keys else "boards", "title": "Keys sounds" if keys else "Boards"}))
        lv = ins.get("levelDb") or 0
        self.fader(g, hits, [6, 190, W - 6, 230], "Instrument level", (lv + 30) / 42.0, {"name": "instrumentLevel"}, valtext="%+g dB" % lv)
        if ins.get("kind") in ("electric", "acoustic", "bass"):   # play any sound: the guitar plays the chosen keys sound / a synth
            third = (W - 12 - 8) / 3.0
            self.button(g, hits, [6, 236, 6 + third, H - 46], "TUNER", {"name": "tuner"}, on=bool(ins.get("tuner")))
            self.button(g, hits, [10 + third, 236, 10 + 2 * third, H - 46], "PLAY ANY", {"name": "playAnyToggle"}, on=bool(ins.get("playAny")))
            self.button(g, hits, [14 + 2 * third, 236, W - 6, H - 46], "PEDALS", {"local": "sub", "tab": "instrument", "value": "pedals"})
            return
        self.button(g, hits, [6, 236, W / 2 - 3, H - 46], "TUNER", {"name": "tuner"}, on=bool(ins.get("tuner")))
        self.button(g, hits, [W / 2 + 3, 236, W - 6, H - 46], "PEDALS", {"local": "sub", "tab": "instrument", "value": "pedals"})

    def instrument_pedals(self, g, hits, d, ins):
        C, W, H = self.COL, self.w, self.h
        pedals = ins.get("pedals") or []
        shown, page, pages = self.paged("pedals", pedals, 9)
        self.chips(g, hits, "instrument", pager=("pedals", page, pages) if pages > 1 else None)
        if not pedals:
            self.text(g, (W / 2, 170), "No pedals on this board" if ins.get("kind") != "off" else "The instrument is off", self.F["sub"], C["muted"], "mm")
            return
        gy0, gy1 = 76, H - 46
        cw, ch = (W - 12 - 2 * 5) / 3, (gy1 - gy0 - 2 * 5) / 3
        for j, p in enumerate(shown):
            r, c = divmod(j, 3)
            x, y = 6 + c * (cw + 5), gy0 + r * (ch + 5)
            on = bool(p.get("on"))
            if p.get("locked"):
                box = [x, y, x + cw, y + ch]
                g.rounded_rectangle(box, 9, fill=C["bar"], outline=C["line"], width=1)
                self.lock_icon(g, x + 8, y + 6, 16, C["accent"])
                self.text(g, (x + 28, y + 7), "LOCKED", self.F["tiny"], C["accent"])
                self.text(g, (x + 8, y + ch - 8), p.get("name") or "Pedal", self.F["label"], C["muted"], "ld", cw - 14)
                hits.append((list(map(int, box)), {"local": "say", "text": p["locked"] + " - bypassed until the plan is active."}))
                continue
            col = p.get("color")
            rgb = tuple(int(col[k:k + 2], 16) for k in (1, 3, 5)) if isinstance(col, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", col) else C["accent"]
            box = [x, y, x + cw, y + ch]
            g.rounded_rectangle(box, 9, fill=tuple(int(v * 0.45 + C["bg"][n] * 0.55) for n, v in enumerate(rgb)) if on else C["btn"], outline=rgb if on else C["line"], width=2 if on else 1)
            g.ellipse([x + 8, y + 8, x + 18, y + 18], fill=(255, 92, 80) if on else C["track"])
            self.text(g, (x + 24, y + 6), "ON" if on else "off", self.F["tiny"], C["text"] if on else C["muted"])
            self.text(g, (x + 8, y + ch - 8), p.get("name") or "Pedal", self.F["label"], C["text"] if on else C["muted"], "ld", cw - 14)
            hits.append((list(map(int, box)), {"name": "pedalToggle", "args": {"index": p.get("index", 0)}}))

    def instrument_eq(self, g, hits, d, ins):
        C, W, H = self.COL, self.w, self.h
        knobs = ins.get("knobs") or []
        shown, page, pages = self.paged("eq", knobs, 5)
        self.chips(g, hits, "instrument", pager=("eq", page, pages) if pages > 1 else None)
        if not knobs:
            self.text(g, (W / 2, 150), "No EQ or compressor on this board.", self.F["label"], C["muted"], "mm")
            self.text(g, (W / 2, 172), "Add one on the Instrument tab (EQ & tone, Compressor, Studio).", self.F["sub"], C["muted"], "mm", W - 20)
            return
        y, rh = 76, (H - 46 - 76) / 5
        for k in shown:
            label = (k.get("pedal") or "") + " · " + (k.get("label") or "")
            self.fader(g, hits, [6, y, W - 6, y + rh], label, k.get("value") or 0, {"name": "pedalKnob", "args": {"uid": k.get("uid"), "sym": k.get("sym")}},
                       valtext="locked" if k.get("locked") else k.get("text"), dim=not k.get("on", True) or bool(k.get("locked")))
            if k.get("locked"):
                hits[-1] = ([6, int(y), W - 6, int(y + rh)], {"local": "say", "text": k["locked"] + " - bypassed until the plan is active."})
            y += rh

    def instrument_tune(self, g, hits, d, ins):
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "instrument")
        self.button(g, hits, [6, 76, W - 6, 132], "TUNER", {"name": "tuner"}, on=bool(ins.get("tuner")), sub="the instrument is muted while it's up", font=self.F["title"])
        lv = ins.get("levelDb") or 0
        self.fader(g, hits, [6, 140, W - 6, 182], "Instrument level", (lv + 30) / 42.0, {"name": "instrumentLevel"}, valtext="%+g dB" % lv)
        if ins.get("kind") in ("electric", "acoustic", "bass"):   # play any sound: on / off and its mode
            mode = str((self.lists.get("instrument") or {}).get("mode") or "")
            half = (W - 12 - 5) / 2
            self.button(g, hits, [6, 186, 6 + half, 228], "PLAY ANY", {"name": "playAnyToggle"}, on=bool(ins.get("playAny")), sub="any sound from the guitar")
            self.button(g, hits, [11 + half, 186, W - 6, 228], "MODE: " + (mode.title() if mode else "…"), {"local": "pick", "what": "playAnyMode", "id": "next"}, sub="Auto · Notes · Synth")
        else:
            vol = (d.get("mini") or {}).get("volume")
            if vol is None:
                vol = (d.get("performance") or {}).get("volume", 1)
            self.fader(g, hits, [6, 186, W - 6, 228], "Pads volume", vol or 0, {"name": "volume"})
        self.button(g, hits, [6, 234, W - 6, H - 46], "AUTO SET-UP", {"name": "instrumentAuto"}, sub="listens to you play and sets the gain")

    # ----- SETTINGS -------------------------------------------------------------------------------------------------
    # ----- LOOPER: three loops - each with its state, where it is, and its switches -----------------------------
    LP_LABEL = {"empty": "REC", "armed": "WAIT", "recording": "RECORDING", "playing": "PLAYING", "dubbing": "OVERDUB", "stopped": "STOPPED"}
    LP_NEXT = {"empty": "record", "armed": "cancel", "recording": "close loop", "playing": "overdub", "dubbing": "play", "stopped": "play"}
    LP_SRC = {"inst": "Instrument", "input": "Audio input", "both": "Both"}
    LP_MODE = {"auto": ("Auto", "with the song when it plays"), "song": ("Tempo", "always N bars"), "free": ("Free", "tap to start and close")}

    def lp_color(self, state):
        C = self.COL
        return {"armed": C["lp_rec"], "recording": C["lp_rec"], "dubbing": C["lp_dub"], "playing": C["lp_play"], "stopped": C["lp_stop"]}.get(state)

    def page_looper(self, g, hits, d):
        lp = (d.get("mini") or {}).get("looper")
        sub = self.sub.get("looper", "loops")
        if not lp:
            self.chips(g, hits, "looper")
            self.text(g, (self.w / 2, 170), "The looper isn't ready yet", self.F["sub"], self.COL["muted"], "mm")
            return
        if lp.get("on") is False:
            self.chips(g, hits, "looper")
            self.text(g, (self.w / 2, 160), "The looper is off", self.F["title"], self.COL["text"], "mm")
            self.text(g, (self.w / 2, 186), "Turn it on in the app's LOOPER tab (Looper on)", self.F["sub"], self.COL["muted"], "mm")
            return
        getattr(self, "looper_" + sub)(g, hits, d, lp)

    def looper_loops(self, g, hits, d, lp):
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "looper")
        tracks = lp.get("tracks") or []
        sel = int(lp.get("sel") or 0)
        y, rh = 76, 46
        for i in range(3):
            t = tracks[i] if i < len(tracks) else {"s": "empty"}
            s, col = t.get("s") or "empty", self.lp_color(t.get("s"))
            # the loop: its state, where it is, its length (a tap: the main switch works this loop)
            box = [6, y, 176, y + rh]
            fill = tuple(int(c * 0.30 + C["bg"][n] * 0.70) for n, c in enumerate(col)) if col else C["btn"]
            g.rounded_rectangle(box, 9, fill=fill, outline=C["accent"] if i == sel else C["line"], width=3 if i == sel else 1)
            self.text(g, (14, y + 13), "LOOP %d" % (i + 1), self.F["label"], C["accent"] if i == sel else C["text"])
            state = {"empty": "empty", "armed": "waiting", "recording": "rec", "playing": "play", "dubbing": "dub", "stopped": "stopped"}.get(s, s)
            self.text(g, (88, y + 13), state, self.F["sub"], C["text"] if col else C["muted"], "la", 50)
            right = ("bar %s/%s" % (t.get("bar"), t.get("bars"))) if t.get("bar") and t.get("bars") else ("%s s" % t.get("secs") if t.get("secs") else "")
            self.text(g, (170, y + 13), right, self.F["sub"], C["muted"], "ra", 60)
            bx0, bx1, by = 14, 168, y + 34
            g.rounded_rectangle([bx0, by - 3, bx1, by + 3], 3, fill=C["track"])
            f = max(0.0, min(1.0, float(t.get("f") or 0)))
            if col and f > 0.01:
                g.rounded_rectangle([bx0, by - 3, bx0 + (bx1 - bx0) * f, by + 3], 3, fill=col)
            hits.append((box, {"name": "looperSelect", "args": {"index": i}}))
            # its switches
            self.button(g, hits, [180, y, 268, y + rh], self.LP_LABEL.get(s, "REC"), {"name": "looperRec", "args": {"index": i}},
                        fill=col or C["btn"], sub=self.LP_NEXT.get(s, ""), font=self.F["label"], color=(255, 255, 255) if col else None)
            self.button(g, hits, [272, y, 326, y + rh], "PLAY" if s == "stopped" else "STOP", {"name": "looperTrackStop", "args": {"index": i}} if s != "empty" else None,
                        font=self.F["sub"], color=None if s != "empty" else C["line"])
            if t.get("undo") or not t.get("redo"):
                self.button(g, hits, [330, y, 384, y + rh], "UNDO", {"name": "looperTrackUndo", "args": {"index": i}} if t.get("undo") else None,
                            font=self.F["sub"], color=None if t.get("undo") else C["line"])
            else:
                self.button(g, hits, [330, y, 384, y + rh], "REDO", {"name": "looperTrackRedo", "args": {"index": i}}, font=self.F["sub"])
            self.button(g, hits, [388, y, 434, y + rh], "CLR", {"name": "looperTrackClear", "args": {"index": i}} if s != "empty" else None,
                        font=self.F["sub"], color=None if s != "empty" else C["line"])
            self.button(g, hits, [438, y, W - 6, y + rh], "M", {"name": "looperTrackMute", "args": {"index": i}}, on=bool(t.get("mute")), font=self.F["label"])
            y += rh + 4
        cur = tracks[sel] if sel < len(tracks) else {"s": "empty"}
        bw = (W - 12 - 3 * 5) / 4
        y0, y1 = 228, H - 46
        buttons = [(self.LP_LABEL.get(cur.get("s"), "REC"), {"name": "looperRec", "args": {"index": -1}}, "loop %d" % (sel + 1), self.lp_color(cur.get("s"))),
                   ("PLAY ALL", {"name": "looperPlayAll"}, "every loop", None), ("STOP ALL", {"name": "looperStopAll"}, "every loop", None),
                   ("CLEAR ALL", {"name": "looperClearAll"}, "every loop", None)]
        for i, (label, action, sub, col) in enumerate(buttons):
            x = 6 + i * (bw + 5)
            self.button(g, hits, [x, y0, x + bw, y1], label, action, sub=sub, fill=col or C["btn"], color=(255, 255, 255) if col else None)

    def looper_mix(self, g, hits, d, lp):
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "looper")
        tracks = lp.get("tracks") or []
        y, rh = 76, (H - 46 - 76) / 3
        for i in range(3):
            t = tracks[i] if i < len(tracks) else {}
            top = y + 2
            self.button(g, hits, [6, top + 2, 38, top + 30], "M", {"name": "looperTrackMute", "args": {"index": i}}, on=bool(t.get("mute")), radius=7, font=self.F["label"])
            self.fader(g, hits, [44, top, W - 124, top + 32], "Loop %d" % (i + 1), min(1.0, float(t.get("level", 0.9)) / 1.2),
                       {"name": "looperTrackLevel", "args": {"index": i}}, valtext="%d%%" % round(float(t.get("level", 0.9)) * 100), dim=bool(t.get("mute")), label_w=62)
            self.pan_fader(g, hits, [W - 118, top, W - 6, top + 32], t.get("pan") or 0, {"name": "looperTrackPan", "args": {"index": i}})
            by0, by1 = top + 35, y + rh - 3
            third = (W - 50 - 10) / 3
            for j, (label, action, on) in enumerate((("REVERSE", {"name": "looperTrackReverse", "args": {"index": i}}, bool(t.get("rev"))),
                                                     ("½ SPEED", {"name": "looperTrackHalf", "args": {"index": i}}, bool(t.get("half"))),
                                                     ("from " + self.LP_SRC.get(t.get("src") or "inst", "Instrument").lower(), {"name": "looperTrackSource", "args": {"index": i}}, False))):
                x = 44 + j * (third + 5)
                self.button(g, hits, [x, by0, x + third, by1], label, action, on=on, font=self.F["sub"], radius=7)
            y += rh

    def looper_setup(self, g, hits, d, lp):
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "looper")
        mode = self.LP_MODE.get(lp.get("mode") or "auto", self.LP_MODE["auto"])
        bars = int(lp.get("bars") or 4)
        sel = int(lp.get("sel") or 0)
        half = (W - 12 - 5) / 2
        rows = [(("TIMING: " + mode[0].upper(), {"name": "looperMode"}, mode[1], False),
                 ("LENGTH: %d BAR%s" % (bars, "" if bars == 1 else "S"), {"name": "looperBars"}, "1 · 2 · 4 · 8 · 16", False)),
                (("COUNT-IN", {"name": "looperCountIn"}, "on - one bar of clicks" if lp.get("countIn") else "off", bool(lp.get("countIn"))),
                 ("MAIN SWITCH: LOOP %d" % (sel + 1), {"name": "looperSelectNext"}, "tap for the next loop", False))]
        y = 78
        for row in rows:
            for j, (label, action, sub, on) in enumerate(row):
                x = 6 + j * (half + 5)
                self.button(g, hits, [x, y, x + half, y + 60], label, action, on=on, sub=sub)
            y += 66
        self.text(g, (W / 2, y + 12), "The first loop sets the length; the others stay in step.", self.F["sub"], C["muted"], "mm", W - 16)
        self.text(g, (W / 2, y + 30), "A footswitch on \"Looper pedal\": tap rec/play/dub · double tap stop · hold clear", self.F["sub"], C["muted"], "mm", W - 16)

    def page_settings(self, g, hits, d):
        sub = self.sub.get("settings", "audio")
        getattr(self, "settings_" + sub)(g, hits, d)

    def settings_audio(self, g, hits, d):
        C, W, H = self.COL, self.w, self.h
        m = d.get("mini") or {}
        inp = m.get("input") or {}
        rt = (m.get("routing") or {}).get("buses") or []
        self.chips(g, hits, "settings")
        rh = (H - 46 - 76) / 6
        y = 76
        gain = inp.get("gain") or 0
        self.fader(g, hits, [6, y, W - 110, y + rh], "Input gain", (gain + 20) / 60.0, {"name": "inputGain"}, valtext="%+d dB" % gain)
        ch = inp.get("channel") or "L"
        self.button(g, hits, [W - 102, y + 4, W - 56, y + rh - 4], "IN L", {"name": "inputChannel", "args": {"channel": "L"}}, on=ch == "L", radius=7, font=self.F["label"])
        self.button(g, hits, [W - 52, y + 4, W - 6, y + rh - 4], "IN R", {"name": "inputChannel", "args": {"channel": "R"}}, on=ch == "R", radius=7, font=self.F["label"])
        y += rh
        lv = ((m.get("instrument") or {}).get("levelDb")) or 0
        self.fader(g, hits, [6, y, W - 6, y + rh], "Instrument out", (lv + 30) / 42.0, {"name": "instrumentLevel"}, valtext="%+g dB" % lv)
        y += rh
        for b in rt[:4]:
            self.text(g, (8, y + rh / 2), b.get("name") or b.get("id"), self.F["label"], C["text"], "lm", 118)
            self.button(g, hits, [124, y + 3, 160, y + rh - 3], "‹", {"name": "busOutput", "args": {"bus": b.get("id"), "delta": -1}}, radius=7)
            g.rounded_rectangle([164, y + 3, W - 46, y + rh - 3], 7, fill=C["bar"], outline=C["line"])
            self.text(g, ((164 + W - 46) / 2, y + rh / 2), b.get("out") or "Off", self.F["label"], C["text"] if b.get("ch") else C["muted"], "mm", W - 46 - 172)
            self.button(g, hits, [W - 42, y + 3, W - 6, y + rh - 3], "›", {"name": "busOutput", "args": {"bus": b.get("id"), "delta": 1}}, radius=7)
            y += rh
        if not rt:
            self.text(g, (W / 2, 200), "Outputs: set them in the Central Pedal app, Settings - Audio", self.F["sub"], C["muted"], "mm")

    def settings_screens(self, g, hits, d):
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "settings")
        disp = self.driver.displays_config() if self.driver else {}
        y = 80
        for n, opts in ((1, self.HDMI1), (2, self.HDMI2)):
            cur = disp.get("hdmi%d" % n) or ("app" if n == 1 else "lyrics")
            if cur == "mini":
                cur = "touch"
            name = dict(opts).get(cur, cur)
            self.text(g, (8, y + 22), "HDMI %d" % n, self.F["name"], C["text"], "lm")
            self.button(g, hits, [80, y, 124, y + 44], "‹", {"local": "hdmi", "n": n, "d": -1}, font=self.F["num"])
            g.rounded_rectangle([130, y, W - 56, y + 44], 9, fill=C["bar"], outline=C["line"])
            self.text(g, ((130 + W - 56) / 2, y + 22), name, self.F["label"], C["text"], "mm", W - 56 - 140)
            self.button(g, hits, [W - 50, y, W - 6, y + 44], "›", {"local": "hdmi", "n": n, "d": 1}, font=self.F["num"])
            y += 52
        self.text(g, (W / 2, y + 6), "A change restarts the screens (the sound keeps playing on the Pi's own outputs).", self.F["tiny"], C["muted"], "mm", W - 16)
        self.button(g, hits, [6, H - 46 - 50, W - 6, H - 50], "RESTART THE SCREENS", {"local": "restartScreens"})

    def screen_list(self):
        """Every touch screen the pedal knows (screens.json): small GPIO screens first, then HDMI and ribbon-cable ones,
        then "No touch screen"."""
        app_root = self.driver.config.get("app_root") if self.driver else None
        cat = screens_catalog(app_root)
        order = {"spi": 0, "hdmi": 1, "dsi": 2}
        items = sorted(cat.get("screens") or [], key=lambda x: (order.get(x.get("kind"), 3), -(x.get("size") or 0), x.get("name") or ""))
        return [(x.get("id"), x) for x in items] + [("off", {"name": "No touch screen", "kind": "off"})]

    def settings_touch(self, g, hits, d):
        """Settings → Touch: which touch screen this is (applied after a restart), calibrate its touch, flip it 180°."""
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "settings")
        cfg = self.driver.config if self.driver else {}
        cur = touch_screen_id(cfg) if self.driver else "off"
        screens = self.screen_list()
        ids = [x[0] for x in screens]
        pick = self.pick_screen if self.pick_screen in ids else cur if cur in ids else ids[0]
        self.pick_screen = pick
        s = dict(screens)[pick]
        kinds = {"spi": "on the GPIO pins", "hdmi": "HDMI touch", "dsi": "ribbon cable", "off": "HDMI 1 shows the app"}
        y0, y1 = 76, 132
        self.button(g, hits, [6, y0, 50, y1], "‹", {"local": "tsPick", "d": -1}, font=self.F["num"])
        self.button(g, hits, [W - 50, y0, W - 6, y1], "›", {"local": "tsPick", "d": 1}, font=self.F["num"])
        g.rounded_rectangle([56, y0, W - 56, y1], 10, fill=C["bar"], outline=C["accent"] if pick == cur else C["line"])
        self.text(g, (W / 2, y0 + 18), s.get("name") or pick, self.F["label"], C["text"], "mm", W - 124)
        info = ("In use · " if pick == cur else "") + kinds.get(s.get("kind"), "") + (" · %d×%d" % tuple(s["res"][:2]) if s.get("res") else "") + (" · downloads its driver once" if s.get("driver") else "")
        self.text(g, (W / 2, y0 + 38), info, self.F["sub"], C["muted"], "mm", W - 124)
        pending = bool(cfg.get("touch_screen_pending")) and cfg.get("touch_screen_pending") == boot_id()
        msg = self.touch_msg or ("Restart to use the new screen." if pending else "")
        if msg:
            self.text(g, (W / 2, 144), msg, self.F["sub"], C["accent"] if msg.startswith("Saved") else C["warn"], "mm", W - 16)
        by0, by1 = 154, 200
        if pick != cur:
            self.button(g, hits, [6, by0, W - 6, by1], "USE THIS SCREEN", {"local": "tsApply"}, on=True, sub="then restart the pedal")
        elif pending:
            self.button(g, hits, [6, by0, W - 6, by1], "RESTART NOW", {"local": "reboot"}, on=self.confirm == "reboot", sub="tap again" if self.confirm == "reboot" else "to use the new screen")
        else:
            touch = getattr(self, "touch_name", None)
            self.text(g, (W / 2, (by0 + by1) / 2), ("Touch panel found: " + touch) if touch else "Touch panel not found yet", self.F["label"], C["text"] if touch else C["warn"], "mm", W - 16)
        bw = (W - 12 - 10) / 3
        flipped = int((self.spec or {}).get("rotate") or 0) == 180
        cal = (self.spec or {}).get("calibration") or {}
        self.button(g, hits, [6, 208, 6 + bw, H - 46], "CALIBRATE", {"local": "calibrate"}, sub="5 crosses, then a check" if not cal.get("affine") else "done - again: 5 crosses")
        self.button(g, hits, [6 + bw + 5, 208, 6 + 2 * bw + 5, H - 46], "TEST TOUCH", {"local": "touchTest"}, sub="dots and numbers")
        self.button(g, hits, [6 + 2 * bw + 10, 208, W - 6, H - 46], "FLIP 180°", {"local": "flip"}, on=flipped, sub="upside down" if flipped else "screen upside down")

    # ----- SETTINGS → Wi-Fi: the networks around; an open or saved one joins with a tap, a new one asks its password
    WIFI_PER = 3

    def wifi_refresh(self, scan=False, force=False):
        if self.wifi_busy or (not force and self.wifi is not None and time.monotonic() - self.wifi_at < 20):
            return
        self.wifi_busy = True

        def work():
            try:
                self.wifi = wifi_status(scan=scan)
            except Exception as error:
                self.wifi = {"error": str(error)[:80], "networks": []}
            self.wifi_at, self.wifi_busy = time.monotonic(), False
            if self.driver:
                self.driver.schedule_mini_render(force=True)
        threading.Thread(target=work, daemon=True).start()

    def settings_wifi(self, g, hits, d):
        C, W, H = self.COL, self.w, self.h
        st = self.wifi
        if st is None or time.monotonic() - self.wifi_at > 20:
            self.wifi_refresh()
        st = st or {}
        nets = st.get("networks") or []
        shown, page, pages = self.paged("wifi", nets, self.WIFI_PER)
        self.chips(g, hits, "settings")
        if st.get("connected"):
            line = "Connected to %s · %s%%" % (st["connected"], st.get("signal") or 0)
        elif st.get("error"):
            line = st["error"]
        else:
            line = "Looking…" if self.wifi_busy or not st else "Not connected"
        addrs = ", ".join((st.get("addresses") or [])[:2])
        self.text(g, (8, 84), line, self.F["label"], C["text"] if st.get("connected") else C["warn"], "lm", W - 16)
        self.text(g, (8, 102), self.wifi_msg or (addrs and "Address " + addrs) or "", self.F["sub"], C["accent"] if self.wifi_msg else C["muted"], "lm", W - 16)
        y, rh = 114, 36
        for n in shown:
            on = bool(n.get("active"))
            box = [6, y, W - 6, y + rh - 4]
            g.rounded_rectangle(box, 8, fill=C["selected"] if on else C["btn"], outline=C["accent"] if on else C["line"])
            if n.get("security"):
                self.lock_icon(g, 14, y + 8, 15, C["muted"])
            self.text(g, (38, y + (rh - 4) / 2), n.get("ssid") or "", self.F["name"], C["text"], "lm", W - 150)
            bars = max(1, min(4, int((n.get("signal") or 0) / 25) + 1))
            for b in range(4):
                bx = W - 96 + b * 7
                g.rectangle([bx, y + rh - 12 - (b + 1) * 4, bx + 4, y + rh - 12], fill=C["accent"] if b < bars else C["track"])
            self.text(g, (W - 14, y + (rh - 4) / 2), "joined" if on else "join", self.F["sub"], C["accent"] if on else C["muted"], "rm")
            hits.append(([int(v) for v in box], {"local": "wifiPick", "ssid": n.get("ssid"), "secure": bool(n.get("security")), "active": on}))
            y += rh
        if not nets:
            self.text(g, (W / 2, 160), "Looking for Wi-Fi…" if self.wifi_busy else "No Wi-Fi found - tap SCAN", self.F["sub"], C["muted"], "mm")
        pw = 54 if pages > 1 else 0
        half = (W - 12 - 5 - 2 * (pw + 5 if pw else 0)) / 2
        x = 6
        if pw:
            self.button(g, hits, [x, 226, x + pw, H - 46], "‹", {"local": "page", "key": "wifi", "d": -1} if page > 0 else None, font=self.F["num"], color=C["text"] if page > 0 else C["line"])
            x += pw + 5
        self.button(g, hits, [x, 226, x + half, H - 46], "SCAN", {"local": "wifiScan"}, sub="look again")
        self.button(g, hits, [x + half + 5, 226, x + 2 * half + 5, H - 46], "PHONE SETUP", {"local": "phoneSetup"}, sub="set it up from a phone")
        if pw:
            self.button(g, hits, [W - 6 - pw, 226, W - 6, H - 46], "›", {"local": "page", "key": "wifi", "d": 1} if page < pages - 1 else None, font=self.F["num"], color=C["text"] if page < pages - 1 else C["line"])

    def wifi_join(self, ssid, password):
        self.wifi_msg = "Joining %s…" % ssid

        def work():
            try:
                ok, text = wifi_connect(ssid, password)
            except Exception as error:
                ok, text = False, str(error)[:80]
            self.wifi_msg = ("Joined %s" % ssid) if ok else (text or "Couldn't join %s" % ssid)
            if self.driver:
                self.driver.emit({"type": "wifiResult", "ok": ok, "message": text, "ssid": ssid})
            self.wifi_busy = False
            self.wifi_refresh(force=True)
        threading.Thread(target=work, daemon=True).start()

    def run_update(self, install=False):
        """Settings → System: look for a new version, then INSTALL (asked twice) - the same as Settings → Software updates."""
        up = getattr(self.driver, "updater", None)
        if not up:
            self.update_msg = "not on this pedal"
            return
        if getattr(up, "busy", False):
            self.update_msg = "busy - a moment…"
            return
        self.update_msg = "installing - the pedal restarts its app" if install else "looking…"

        def work():
            up.busy = True
            try:
                if install:
                    if not up.latest:
                        up.check()
                    res = self.driver.software_update(up.download())
                    self.update_ready = False
                    self.update_msg = "installed - restarting…" if res.get("ok") else "not installed: " + str(res.get("error") or "")[:60]
                else:
                    st = up.check()
                    self.update_ready = str(st.get("latest")) if st.get("available") and st.get("hasPi") else False
                    self.update_msg = ("%s is ready - tap INSTALL" % st.get("latest")) if self.update_ready else (st.get("error") or "up to date (%s)" % APP_VERSION)
            except Exception as error:
                self.update_msg = "couldn't: %s" % str(error)[:60]
            finally:
                up.busy = False
                self.driver.emit(up.status())
                self.driver.schedule_mini_render(force=True)
        threading.Thread(target=work, daemon=True).start()

    # ----- SETTINGS → Controls: what each button, knob and slider does (tap one, pick from the list)
    def settings_controls(self, g, hits, d):
        C, W, H = self.COL, self.w, self.h
        data = self.lists.get("controls")
        self.want("controls")
        items = (data or {}).get("items") or []
        shown, page, pages = self.paged("controls", items, 4)
        self.chips(g, hits, "settings")
        if data is None:   # (the very first start: the app hasn't sent them yet - it does when it's up, in a few seconds)
            self.retry_soon()
            self.text(g, (W / 2, 160), "Getting the list of controls…", self.F["sub"], C["muted"], "mm")
            self.text(g, (W / 2, 182), "It shows up here as soon as the app has started", self.F["sub"], C["muted"], "mm")
            return
        if pages > 1:   # ‹ 1/5 › along the bottom
            yb = H - 46 - 34
            self.button(g, hits, [6, yb, 120, H - 46], "‹ PREV", {"local": "page", "key": "controls", "d": -1} if page > 0 else None, color=C["text"] if page > 0 else C["line"])
            self.text(g, (W / 2, yb + 17), "%d / %d" % (page + 1, pages), self.F["label"], C["muted"], "mm")
            self.button(g, hits, [W - 120, yb, W - 6, H - 46], "MORE ›", {"local": "page", "key": "controls", "d": 1} if page < pages - 1 else None, color=C["text"] if page < pages - 1 else C["line"])
        y, rh = 76, (H - 46 - 76 - 38) / 4
        for it in shown:
            box = [6, y + 2, W - 6, y + rh - 2]
            g.rounded_rectangle(box, 8, fill=C["btn"], outline=C["line"])
            self.text(g, (16, (box[1] + box[3]) / 2), it.get("name") or it.get("id"), self.F["name"], C["text"], "lm", 130)
            none = (it.get("action") or "none") == "none"
            self.text(g, (W - 30, (box[1] + box[3]) / 2), it.get("label") or "", self.F["label"], C["muted"] if none else C["accent"], "rm", W - 190)
            self.text(g, (W - 14, (box[1] + box[3]) / 2), "›", self.F["title"], C["muted"], "rm")
            hits.append(([int(v) for v in box], {"local": "list", "what": "actions", "kind": it.get("kind") or "trigger", "target": it.get("id"),
                                                 "current": it.get("action"), "title": (it.get("name") or it.get("id")) + " does…"}))
            y += rh

    def settings_system(self, g, hits, d):
        C, W, H = self.COL, self.w, self.h
        self.chips(g, hits, "settings")
        try:
            addrs = ip_addresses()
        except Exception:
            addrs = []
        code = ""
        try:
            code = self.driver.pair_code() if self.driver and hasattr(self.driver, "pair_code") else str((self.driver.system_status() or {}).get("code") or "")
        except Exception:
            code = ""
        lines = [("Central Pedal", APP_VERSION), ("Address", ", ".join(addrs[:2]) or "not on a network"), ("Pairing code", code or "–")]
        ls = set_line(self.driver)
        if ls:
            lines.append(("Set", ls))
        try:
            pk = package_lines(read_json(os.path.join(self.driver.config["data_root"], "packages.json"), [])) if self.driver else []
        except Exception:
            pk = []
        lines += [("Packages" if i == 0 else "", v) for i, v in enumerate(pk[:1 if ls else 2])] or [("Packages", "none - free sounds and pedals")]
        up = getattr(self.driver, "updater", None) if self.driver else None
        lines.append(("Updates", self.update_msg or ("tap UPDATES to look" if up else "not on this pedal")))
        y = 80
        for k, v in lines:
            self.text(g, (10, y), k, self.F["label"], C["muted"])
            self.text(g, (130, y), v, self.F["label"], C["accent"] if k == "Updates" and self.update_ready else C["text"], "la", W - 140)
            y += 21
        bw = (W - 12 - 15) / 4
        by0, by1 = H - 46 - 62, H - 50
        x = [6 + i * (bw + 5) for i in range(4)]
        if self.update_ready:
            self.button(g, hits, [x[0], by0, x[0] + bw, by1], "INSTALL", {"local": "update", "install": True}, on=self.confirm == "update", sub="tap again" if self.confirm == "update" else self.update_ready)
        else:
            self.button(g, hits, [x[0], by0, x[0] + bw, by1], "UPDATES", {"local": "update"}, sub="look now")
        self.button(g, hits, [x[1], by0, x[1] + bw, by1], "ADD KEY", {"local": "keys", "purpose": "package", "title": "Type the package key (SXXX-XXXX-XXXX-XXXX)"}, sub="a package")
        self.button(g, hits, [x[2], by0, x[2] + bw, by1], "RESTART", {"local": "reboot"}, on=self.confirm == "reboot", sub="tap again" if self.confirm == "reboot" else "the pedal")
        self.button(g, hits, [x[3], by0, W - 6, by1], "SHUT DOWN", {"local": "shutdown"}, on=self.confirm == "shutdown", fill=C["stop"], sub="tap again" if self.confirm == "shutdown" else "safely")

    # ----- over the page: a list to pick from, or the keyboard ------------------------------------------------------
    def want(self, what, kind=None, every=4.0):
        """Ask the app for a list (sounds, boards, what a button can do…), at most every few seconds."""
        key = what + (":" + kind if kind else "")
        asked = self.__dict__.setdefault("_asked", {})
        if self.driver and time.monotonic() - asked.get(key, 0) > every:
            asked[key] = time.monotonic()
            self.driver.emit({"type": "miniRequest", "what": what, "kind": kind})

    # ----- the driver's own copy of the lists: the app sends them when it connects and when they change (miniPush);
    # kept on the card, so after a restart the screen shows them at once, before the app is even up
    LISTS_FILE = "mini-lists.json"

    def lists_path(self):
        root = self.driver.config.get("data_root") if self.driver and getattr(self.driver, "config", None) else None
        return os.path.join(root, self.LISTS_FILE) if root else None

    def load_lists(self):
        path = self.lists_path()
        saved = read_json(path, {}) if path else {}
        if isinstance(saved, dict):
            for key, value in saved.items():
                if isinstance(value, dict):
                    self.lists.setdefault(str(key), value)

    def save_lists(self):
        path = self.lists_path()
        if not path or self.lists_saving is not None:
            return

        def write():
            self.lists_saving = None
            keep = {k: v for k, v in list(self.lists.items()) if k != "library" and not k.startswith(("hdmi", "fxPresets:"))}
            try:
                write_json(path, keep)
            except Exception as error:
                log.debug("small screen lists not saved (%s)", error)
        self.lists_saving = threading.Timer(2.0, write)
        self.lists_saving.daemon = True
        self.lists_saving.start()

    def retry_soon(self, seconds=2.5):
        """Nothing to show yet: draw again in a moment (asking again on the way), instead of waiting for something else
        to redraw the screen."""
        drv = self.driver
        if not drv or not getattr(drv, "loop", None) or getattr(self, "_retry_at", 0) > time.monotonic():
            return
        self._retry_at = time.monotonic() + seconds
        try:
            drv.loop.call_soon_threadsafe(drv.loop.call_later, seconds, lambda: drv.schedule_mini_render(True))
        except RuntimeError:
            pass

    def kept_edit(self, m):
        """An effects change made here while no app page is running: shown on the screen straight away (the app gets it
        when it's back)."""
        self.say("Kept - it goes in as soon as the Central Pedal app is running")
        args = m.get("args") or {}
        tid = str(args.get("target") or m.get("target") or "")
        entry = self.lists.get("fx:" + tid)
        st = (entry or {}).get("state")
        if not st:
            return
        path = str(args.get("path") or "")
        if m.get("name") == "fxToggle":
            if path == "on":
                st["on"] = not st.get("on")
            for r in st.get("rows") or []:
                if r.get("toggle") == path or (path.endswith(".on") and r.get("fx") == path[:-3] and "toggle" not in r):
                    r["on"] = not r.get("on")
        elif m.get("name") == "fxValue":
            for r in st.get("rows") or []:
                if r.get("path") == path:
                    v = r.get("min", 0) + float(m.get("value") or 0) * (r.get("max", 1) - r.get("min", 0))
                    r["value"] = v
                    r["text"] = self.fx_text(v, "dB" if r.get("fx") in ("gate", "eq") or path.endswith("threshold") else "%")
        elif m.get("type") == "miniPick":
            st["preset"] = str(m.get("id") or "")
        self.save_lists()

    # ----- effects from the project the driver already has (project.json, saved by the app) when no list came yet
    FX_DEFAULT = {"on": False, "preset": "",
                  "gate": {"on": False, "threshold": -45}, "eq": {"on": True, "low": 0, "mid": 0, "high": 0},
                  "comp": {"on": False, "amount": 35}, "reverb": {"on": False, "type": "room", "send": 15},
                  "delay": {"on": False, "time": "1/8", "send": 12}}
    REVERB_NAMES = {"room": "Room", "hall": "Hall", "plate": "Plate", "cathedral": "Cathedral"}
    DIV_NAMES = {2.0: "1/2", 1.0: "1/4", 0.5: "1/8", 0.25: "1/16", 1.5: "1/4.", 0.75: "1/8."}

    @staticmethod
    def fx_text(v, unit):
        v = float(v or 0)
        if unit == "dB":
            r = round(v * 10) / 10
            return ("+" if r > 0 else "") + ("%g" % r) + " dB"
        return "%d%%" % round(v)

    @classmethod
    def fx_merge(cls, base, over):
        out = json.loads(json.dumps(base))
        for k, v in (over or {}).items() if isinstance(over, dict) else []:
            if v is None and isinstance(out.get(k), dict):
                continue
            out[k] = cls.fx_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
        return out

    def saved_project(self):
        root = self.driver.config.get("data_root") if self.driver and getattr(self.driver, "config", None) else None
        p = read_json(os.path.join(root, "project.json"), {}) if root else {}
        return p if isinstance(p, dict) else {}

    def saved_song(self, p, song_id=None):
        songs = [s for s in (p.get("songs") or []) if isinstance(s, dict)]
        hit = next((s for s in songs if song_id and s.get("id") == song_id), None)
        if hit is None:
            i = p.get("songIndex")
            hit = songs[i] if isinstance(i, int) and 0 <= i < len(songs) else None
        return hit

    def pad_fx(self, pad):
        e = pad.get("effects") or {}
        eq, c, r, dl, gt = e.get("eq") or {}, e.get("compressor") or {}, e.get("reverb") or {}, e.get("delay") or {}, e.get("gate") or {}
        b = eq.get("bands") or []
        gain = lambda i: float((b[i] or {}).get("gain") or 0) if len(b) > i and isinstance(b[i], dict) else 0.0
        try:
            div = self.DIV_NAMES.get(float(dl.get("division")), "1/8")
        except (TypeError, ValueError):
            div = "1/8"
        return {"on": True, "preset": pad.get("fxPreset") or "",
                "gate": {"on": bool(gt.get("enabled")), "threshold": gt.get("threshold", -45) if gt.get("threshold") is not None else -45},
                "eq": {"on": eq.get("enabled") is not False, "low": gain(1), "mid": gain(3), "high": gain(4)},
                "comp": {"on": bool(c.get("enabled")), "amount": 35 if c.get("amount") is None else c.get("amount")},
                "reverb": {"on": bool(r.get("enabled")), "type": r.get("type") or "hall", "send": 30 if r.get("wet") is None else r.get("wet")},
                "delay": {"on": bool(dl.get("enabled")), "time": div, "send": 25 if dl.get("send") is None else dl.get("send")}}

    @staticmethod
    def pad_fx_on(pad):
        e = pad.get("effects") or {}
        return bool(pad.get("fxPreset")) or bool((e.get("compressor") or {}).get("enabled")) or bool((e.get("delay") or {}).get("enabled"))

    def copy_targets(self, which, song_id=None):
        """The bus and every track (or pad), with on / off and the preset, from the saved project."""
        p = self.saved_project()
        on_text = lambda on, preset: (preset or "on") if on else "off"
        bus = self.fx_merge(self.FX_DEFAULT, (p.get("busFx") or {}).get(which))
        if which == "pads":
            items = [{"id": "bus:pads", "label": "All pads (pads bus)", "on": bool(bus.get("on")), "sub": on_text(bus.get("on"), bus.get("preset"))}]
            for i, pad in enumerate(p.get("pads") or []):
                if isinstance(pad, dict):
                    on = self.pad_fx_on(pad)
                    items.append({"id": "pad:%d" % i, "label": "Pad %d · %s" % (i + 1, pad.get("name") or ""), "on": on, "sub": on_text(on, pad.get("fxPreset"))})
            return items
        items = [{"id": "bus:tracks", "label": "All tracks (tracks bus)", "on": bool(bus.get("on")), "sub": on_text(bus.get("on"), bus.get("preset"))}]
        song = self.saved_song(p, song_id)
        for st in ((song or {}).get("tracks") or {}).get("stems") or []:
            if isinstance(st, dict) and st.get("id") is not None:
                fx = st.get("fx") or {}
                items.append({"id": "stem:%s" % st["id"], "label": st.get("name") or "Track", "on": bool(fx.get("on")), "sub": on_text(fx.get("on"), fx.get("preset"))})
        return items

    def copy_state(self, tid, song_id=None):
        """One target's effects from the saved project (the basic controls; the app fills in the rest when it's up)."""
        p = self.saved_project()
        kind, _, rest = str(tid).partition(":")
        name, fx = None, None
        if kind == "bus" and rest in ("tracks", "pads"):
            name, fx = ("Tracks bus (all tracks)" if rest == "tracks" else "Pads bus (all pads)"), self.fx_merge(self.FX_DEFAULT, (p.get("busFx") or {}).get(rest))
        elif kind == "pad" and rest.isdigit():
            pads = p.get("pads") or []
            i = int(rest)
            if i < len(pads) and isinstance(pads[i], dict):
                name, fx = "Pad %d · %s" % (i + 1, pads[i].get("name") or ""), self.fx_merge(self.FX_DEFAULT, self.pad_fx(pads[i]))
        elif kind == "stem":
            song = self.saved_song(p, song_id)
            st = next((s for s in ((song or {}).get("tracks") or {}).get("stems") or [] if isinstance(s, dict) and str(s.get("id")) == rest), None)
            if st:
                name, fx = st.get("name") or "Track", self.fx_merge(self.FX_DEFAULT, st.get("fx"))
        if fx is None:
            return None
        rows = []
        if kind != "bus":
            rows.append({"fx": "gate", "label": "Gate", "toggle": "gate.on", "on": bool(fx["gate"].get("on")), "path": "gate.threshold", "min": -80, "max": 0, "value": fx["gate"].get("threshold", -45)})
        for band, label in (("low", "EQ low"), ("mid", "EQ mid"), ("high", "EQ high")):
            row = {"fx": "eq", "label": label, "on": bool(fx["eq"].get("on")), "path": "eq." + band, "min": -12, "max": 12, "value": fx["eq"].get(band, 0)}
            if band == "low":
                row["toggle"] = "eq.on"
            rows.append(row)
        rows.append({"fx": "comp", "label": "Compressor", "toggle": "comp.on", "on": bool(fx["comp"].get("on")), "path": "comp.amount", "min": 0, "max": 100, "value": fx["comp"].get("amount", 35)})
        rows.append({"fx": "reverb", "label": "Reverb", "toggle": "reverb.on", "on": bool(fx["reverb"].get("on")), "path": "reverb.send", "min": 0, "max": 100, "value": fx["reverb"].get("send", 15),
                     "choice": {"path": "reverb.type", "name": self.REVERB_NAMES.get(fx["reverb"].get("type"), str(fx["reverb"].get("type") or "Room"))}})
        rows.append({"fx": "delay", "label": "Delay", "toggle": "delay.on", "on": bool(fx["delay"].get("on")), "path": "delay.send", "min": 0, "max": 100, "value": fx["delay"].get("send", 12),
                     "choice": {"path": "delay.time", "name": str(fx["delay"].get("time") or "1/8")}})
        for r in rows:
            try:
                r["value"] = float(r["value"])
            except (TypeError, ValueError):
                r["value"] = float(r["min"])
            r["text"] = self.fx_text(r["value"], "dB" if r["fx"] in ("gate", "eq") else "%")
        return {"id": tid, "name": name, "kind": kind, "master": kind != "pad", "on": True if kind == "pad" else bool(fx.get("on")), "preset": fx.get("preset") or "",
                "pro": True, "lock": "", "rows": rows, "fromCopy": True}

    def list_key(self, ov):
        return ov["what"] + (":" + ov["akind"] if ov.get("akind") else "")

    def overlay_list(self, g, hits, d):
        C, W, H = self.COL, self.w, self.h
        ov = self.overlay
        key = self.list_key(ov)
        data = self.lists.get(key)
        items = (data or {}).get("items") or []
        cur = ov.get("current") if ov.get("current") is not None else (data or {}).get("current")
        if data is not None and not ov.get("placed"):   # (opens at the page with the current one on it)
            ov["placed"] = True
            at = next((i for i, it in enumerate(items) if it.get("id") == cur), 0)
            self.pages["list:" + key] = at // 5
        if ov["what"] == "library" and time.monotonic() - (data or {}).get("at", 0) > 3:   # (a song copied in meanwhile shows up)
            self.local_list("library")
            data = self.lists.get(key)
            items = (data or {}).get("items") or []
        shown, page, pages = self.paged("list:" + key, items, 5)
        self.button(g, hits, [6, 44, 86, 70], "‹ BACK", {"local": "back"}, radius=13, font=self.F["label"])
        az = bool(ov.get("az")) and len(items) > 5
        self.text(g, (96, 57), ov.get("title") or "", self.F["name"], C["text"], "lm", W - 96 - (104 if pages > 1 else 8) - (54 if az else 0))
        if az:
            ax = W - (152 if pages > 1 else 56)
            self.button(g, hits, [ax, 44, ax + 48, 70], "A–Z", {"local": "letters"}, radius=13, font=self.F["label"])
        if pages > 1:
            self.button(g, hits, [W - 98, 44, W - 66, 70], "‹", {"local": "page", "key": "list:" + key, "d": -1} if page > 0 else None, radius=13, color=C["text"] if page > 0 else C["line"])
            self.text(g, (W - 50, 57), "%d/%d" % (page + 1, pages), self.F["sub"], C["muted"], "mm")
            self.button(g, hits, [W - 38, 44, W - 6, 70], "›", {"local": "page", "key": "list:" + key, "d": 1} if page < pages - 1 else None, radius=13, color=C["text"] if page < pages - 1 else C["line"])
        if data is None:   # (the very first start: the app hasn't sent this list yet)
            self.want(ov["what"], ov.get("akind"), every=2.0)
            self.retry_soon(2.0)
            self.text(g, (W / 2, 160), "Getting the list…", self.F["sub"], C["muted"], "mm")
            self.text(g, (W / 2, 182), "It shows up here as soon as the app has started", self.F["sub"], C["muted"], "mm")
            return
        if not items:
            self.text(g, (W / 2, 170), "No songs on this pedal yet" if ov["what"] == "library" else "Nothing to pick here", self.F["sub"], C["muted"], "mm")
            if ov["what"] == "library":
                self.text(g, (W / 2, 192), "Upload a set from Central Pedal Control", self.F["sub"], C["muted"], "mm")
            return
        y, rh = 76, (H - 46 - 76) / 5
        for it in shown:
            on = it.get("id") == cur
            box = [6, y + 2, W - 6, y + rh - 2]
            g.rounded_rectangle(box, 8, fill=C["selected"] if on else C["bar"] if it.get("locked") else C["btn"], outline=C["accent"] if on else C["line"])
            cy = (box[1] + box[3]) / 2
            x = 14
            if it.get("locked"):
                self.lock_icon(g, x, cy - 8, 15, C["accent"])
                x += 22
            self.text(g, (x, cy), it.get("label") or it.get("id"), self.F["name"], C["muted"] if it.get("locked") else C["text"], "lm", W - x - 150)
            self.text(g, (W - 14, cy), it.get("locked") or it.get("sub") or "", self.F["sub"], C["accent"] if it.get("locked") else C["muted"], "rm", 140)
            if it.get("locked"):
                hits.append(([int(v) for v in box], {"local": "say", "text": str(it.get("locked")) + " - it opens with that plan."}))
            elif it.get("inset"):
                hits.append(([int(v) for v in box], {"local": "say", "text": "\"%s\" is already in the setlist" % (it.get("label") or "")}))
            else:
                hits.append(([int(v) for v in box], {"local": "pick", "what": ov["what"], "id": it.get("id"), "target": ov.get("target"), "label": it.get("label")}))
            y += rh

    KB_ROWS = {"abc": ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm-._"],
               "ABC": ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM-._"],
               "sym": ["1234567890", "!@#$%^&*()", "=+[]{};:'", '",<>/?~|\\`']}

    def kb_shown(self):
        ov = self.overlay
        v = ov.get("value") or ""
        if ov.get("purpose") == "package":
            return "-".join(v[i:i + 4] for i in range(0, len(v), 4))
        return v

    def overlay_keys(self, g, hits, d):
        """A keyboard for a Wi-Fi password or a package key (keys 44 px wide, the field on top)."""
        C, W, H = self.COL, self.w, self.h
        ov = self.overlay
        g.rectangle([0, 40, W, H], fill=C["bg"])
        g.rounded_rectangle([6, 44, W - 6, 80], 8, fill=C["bar"], outline=C["accent"])
        shown = self.kb_shown()
        if shown:
            shown = self.fit(g, shown, self.F["title"], W - 40) if self.text_width(g, shown, self.F["title"]) > W - 40 else shown
            self.text(g, (16, 62), shown, self.F["title"], C["text"], "lm")
            cx = 18 + self.text_width(g, shown, self.F["title"])
            g.rectangle([cx, 52, cx + 1, 72], fill=C["accent"])
        else:
            self.text(g, (16, 62), ov.get("title") or "", self.F["label"], C["muted"], "lm", W - 32)
        mode = ov.get("mode") or "abc"
        rows = self.KB_ROWS[mode]
        top, rh, gap = 86, 42, 4
        kw = (W - 12 - 9 * gap) / 10
        for r, row in enumerate(rows):
            y = top + r * (rh + gap)
            x = 6
            for ch in row:
                self.button(g, hits, [x, y, x + kw, y + rh], ch, {"local": "kb", "k": ch}, font=self.F["title"], radius=7)
                x += kw + gap
            if len(row) < 10:   # (a short row ends with ⌫)
                self.button(g, hits, [x, y, W - 6, y + rh], "DEL", {"local": "kbDel"}, radius=7, font=self.F["label"])
        y = top + 4 * (rh + gap)
        cols = [("ABC" if mode == "abc" else "abc", {"local": "kbMode", "mode": "ABC" if mode == "abc" else "abc"}, 64),
                ("#+=", {"local": "kbMode", "mode": "sym" if mode != "sym" else "abc"}, 56), ("space", {"local": "kb", "k": " "}, 0),
                ("DEL", {"local": "kbDel"}, 56), ("CANCEL", {"local": "back"}, 76), ("OK", {"local": "kbOk"}, 76)]
        fixed = sum(c[2] for c in cols) + gap * (len(cols) - 1)
        x = 6
        for label, action, wdt in cols:
            wdt = wdt or (W - 12 - fixed)
            self.button(g, hits, [x, y, x + wdt, H - 4], label, action, on=label == "OK", radius=7,
                        font=self.F["label"] if len(label) > 2 else self.F["title"])
            x += wdt + gap

    # ----- what a touch does ----------------------------------------------------------------------------------------
    NOTICE_S = 3.5

    def lock_icon(self, g, x, y, size, color):
        """A padlock (drawn: the screen's font has no lock glyph): its body and its shackle, size px high."""
        s = float(size)
        g.rounded_rectangle([x, y + s * 0.42, x + s * 0.82, y + s], max(1, int(s * 0.12)), fill=color)
        g.arc([x + s * 0.16, y, x + s * 0.66, y + s * 0.84], 180, 360, fill=color, width=max(2, int(s * 0.13)))
        g.line([x + s * 0.18, y + s * 0.42, x + s * 0.18, y + s * 0.47], fill=color, width=max(2, int(s * 0.13)))
        g.line([x + s * 0.64, y + s * 0.42, x + s * 0.64, y + s * 0.47], fill=color, width=max(2, int(s * 0.13)))

    def say(self, text):
        """Show a line along the bottom for a few seconds (which plan opens a locked pedal or sound)."""
        self.notice, self.notice_at = str(text or ""), time.monotonic()
        if self.driver:
            t = threading.Timer(self.NOTICE_S + 0.1, lambda: self.driver.schedule_mini_render(force=True))
            t.daemon = True
            t.start()

    def local(self, a):
        """The small screen's own buttons: tabs, pages, HDMI choices, restart / shut down (asked twice)."""
        kind = a.get("local")
        if kind == "say":
            self.say(a.get("text"))
        elif kind == "tab":
            self.tab = a.get("value") or "pads"
            self.overlay = None
        elif kind == "sub":
            self.tab = a.get("tab") or self.tab
            self.sub[self.tab] = a.get("value")
            self.overlay = None
            if self.tab == "settings" and a.get("value") == "wifi":
                self.wifi_refresh(force=True)
            if self.tab == "instrument" and a.get("value") == "tune":
                self.want("instrument", every=0)
        elif kind == "list":
            # (stack: a list over another overlay - BACK and a pick go back to it, e.g. the presets over a track's effects)
            self.overlay = {"kind": "list", "what": a.get("what"), "akind": a.get("kind"), "title": a.get("title"), "target": a.get("target"), "current": a.get("current"),
                            "az": a.get("az"), "parent": self.overlay if a.get("stack") else None}
            self.lists.pop(self.list_key(self.overlay), None)   # (always the app's newest list)
            if self.local_list(a.get("what")):
                if a.get("what") == "library":
                    self.pages["list:library"] = 0
            else:
                self.want(a.get("what"), a.get("kind"), every=0)
        elif kind == "back":
            self.overlay = (self.overlay or {}).get("parent")
        elif kind == "letters" and self.overlay and self.overlay.get("kind") == "list":
            self.overlay = {"kind": "letters", "parent": self.overlay}
        elif kind == "letter" and self.overlay and self.overlay.get("kind") == "letters":
            parent = self.overlay.get("parent") or {}
            key = self.list_key(parent)
            items = (self.lists.get(key) or {}).get("items") or []
            at = next((i for i, it in enumerate(items) if self.initial(it.get("label")) == a.get("letter")), None)
            if at is not None:
                self.pages["list:" + key] = at // 5
            self.overlay = parent
        elif kind == "fxOpen":
            tid = str(a.get("target") or "")
            self.overlay = {"kind": "fx", "target": tid, "title": a.get("title")}   # (drawn at once from the copy; the app's answer freshens it)
            self.pages["fx:" + tid] = 0
            self.want("fx", tid, every=0)
        elif kind == "songEdit":
            self.song_edit = not self.song_edit
            self.confirm = None
        elif kind == "rmSong" and self.driver:
            tag = "rm:%d" % int(a.get("index") or 0)
            if self.confirm == tag and time.monotonic() - self.confirm_at < 4:
                self.confirm = None
                self.driver.emit({"type": "miniPick", "what": "setlistRemove", "id": int(a.get("index") or 0)})
            else:
                self.confirm, self.confirm_at = tag, time.monotonic()
                self.say("Tap X again to take it out of the setlist (it stays in the song library)")
        elif kind == "pick" and a.get("what") in ("hdmi1", "hdmi2") and self.driver:
            n = 1 if a.get("what") == "hdmi1" else 2
            self.overlay = (self.overlay or {}).get("parent")
            if (self.lists.get(a.get("what")) or {}).get("current") != a.get("id"):
                self.driver.system_action({"action": "displays", "config": {"hdmi%d" % n: a.get("id")}}, None)
                self.say("HDMI %d: %s - the screens restart (the sound keeps playing)" % (n, a.get("label") or a.get("id")))
        elif kind == "pick" and self.driver:
            self.driver.emit({"type": "miniPick", "what": a.get("what"), "id": a.get("id"), "target": a.get("target")})
            if a.get("what") != "playAnyMode" and not a.get("quiet"):
                self.overlay = (self.overlay or {}).get("parent")
                if a.get("label"):
                    self.say(("Now: " if a.get("what") == "actions" else "Added: " if a.get("what") == "library" else "") + str(a.get("label")))
            elif a.get("what") == "scenes" and a.get("label"):
                self.say("Scene: %s" % a.get("label"))
        elif kind == "wifiScan":
            self.wifi_msg = ""
            self.wifi_refresh(scan=True, force=True)
        elif kind == "wifiPick" and self.driver:
            if a.get("active"):
                self.wifi_msg = "Already joined %s" % a.get("ssid")
            elif a.get("secure"):
                self.overlay = {"kind": "keys", "purpose": "wifi", "ssid": a.get("ssid"), "value": "", "mode": "abc", "title": "Password for %s" % a.get("ssid")}
            else:
                self.wifi_join(a.get("ssid"), "")
        elif kind == "phoneSetup" and self.driver and getattr(self.driver, "phone_setup", None):
            threading.Thread(target=lambda: self.driver.phone_setup.start("asked on the small screen"), daemon=True).start()
        elif kind == "keys":
            self.overlay = {"kind": "keys", "purpose": a.get("purpose"), "value": "", "mode": "ABC" if a.get("purpose") == "package" else "abc", "title": a.get("title")}
        elif kind == "kb" and self.overlay and self.overlay.get("kind") == "keys":
            ov, ch = self.overlay, str(a.get("k") or "")
            if ov.get("purpose") == "package":
                ch = re.sub(r"[^A-Z0-9]", "", ch.upper())
                if len(ov["value"]) < 16:
                    ov["value"] += ch
            elif len(ov["value"]) < 64:
                ov["value"] += ch
        elif kind == "kbDel" and self.overlay and self.overlay.get("kind") == "keys":
            self.overlay["value"] = self.overlay["value"][:-1]
        elif kind == "kbMode" and self.overlay and self.overlay.get("kind") == "keys":
            self.overlay["mode"] = a.get("mode") if a.get("mode") in self.KB_ROWS else "abc"
        elif kind == "kbOk" and self.overlay and self.overlay.get("kind") == "keys" and self.driver:
            ov, self.overlay = self.overlay, None
            if ov.get("purpose") == "wifi":
                self.tab, self.sub["settings"] = "settings", "wifi"
                self.wifi_join(ov.get("ssid"), ov.get("value") or "")
            elif ov.get("purpose") == "package":
                if len(ov.get("value") or "") != 16 or not ov["value"].startswith("S"):
                    self.say("A package key has 16 letters and digits and starts with S.")
                else:
                    self.driver.emit({"type": "miniPackage", "key": "-".join(ov["value"][i:i + 4] for i in range(0, 16, 4))})
                    self.say("Checking the key…")
        elif kind == "update" and self.driver:
            if a.get("install") and not (self.confirm == "update" and time.monotonic() - self.confirm_at < 5):
                self.confirm, self.confirm_at = "update", time.monotonic()
            else:
                self.confirm = None
                self.run_update(bool(a.get("install")))
        elif kind == "page":
            self.pages[a.get("key")] = self.pages.get(a.get("key"), 0) + int(a.get("d") or 0)
        elif kind == "hdmi" and self.driver:
            n = int(a.get("n") or 1)
            opts = [o[0] for o in (self.HDMI1 if n == 1 else self.HDMI2)]
            cur = self.driver.displays_config().get("hdmi%d" % n) or opts[0]
            cur = "touch" if cur == "mini" else cur
            i = opts.index(cur) if cur in opts else 0
            self.driver.system_action({"action": "displays", "config": {"hdmi%d" % n: opts[(i + int(a.get("d") or 1)) % len(opts)]}}, None)
        elif kind == "restartScreens" and self.driver:
            self.driver.system_action({"action": "restartSession"}, None)
        elif kind == "factoryCorner" and self.driver and getattr(self.driver, "factory", None):
            self.driver.factory.corner(a.get("corner"))
        elif kind == "setupStop" and self.driver and getattr(self.driver, "phone_setup", None):
            threading.Thread(target=self.driver.phone_setup.stop, daemon=True).start()
        elif kind == "calibrate":
            self.start_calibration()
            return
        elif kind == "touchTest":
            self.start_test()
            return
        elif kind == "tmSave":
            self.cal_finish(True)
            return
        elif kind == "tmRedo":
            self.start_calibration()
            return
        elif kind == "tmDone":
            self.set_tmode(None)
            return
        elif kind == "tsPick":
            ids = [x[0] for x in self.screen_list()]
            i = ids.index(self.pick_screen) if self.pick_screen in ids else 0
            self.pick_screen, self.touch_msg = ids[(i + int(a.get("d") or 1)) % len(ids)], ""
        elif kind == "tsApply" and self.driver:
            sid = self.pick_screen
            self.touch_msg = "Setting up the screen…"

            def work():
                try:
                    r = self.driver.set_touch_screen(sid)
                except Exception as error:
                    r = {"ok": False, "error": str(error)[:120]}
                self.touch_msg = "Saved - restart the pedal to use it." if r.get("ok") else (r.get("error") or "Not changed.")
                self.driver.emit(dict(r, type="touchScreenResult", screen=sid))
                self.driver.schedule_mini_render(force=True)
            threading.Thread(target=work, daemon=True).start()
        elif kind == "flip" and self.driver:
            # the picture turned 180° and the touch with it (its calibration flipped both ways)
            mini = self.driver.config.setdefault("mini_screen", {})
            mini["rotate"] = 0 if int(mini.get("rotate") or 0) == 180 else 180
            cal = dict(mini.get("calibration") or {})
            cal["flip_x"], cal["flip_y"] = not cal.get("flip_x", False), not cal.get("flip_y", False)
            A = cal.get("affine")
            if isinstance(A, list) and len(A) == 6:   # (x -> W-1-x, y -> H-1-y)
                cal["affine"] = [-A[0], -A[1], self.w - 1 - A[2], -A[3], -A[4], self.h - 1 - A[5]]
            mini["calibration"] = cal
            self.spec = mini
            self.driver.save_config()
        elif kind in ("reboot", "shutdown") and self.driver:
            if self.confirm == kind and time.monotonic() - self.confirm_at < 5:
                self.confirm = None
                self.driver.system_action({"action": kind}, None)
            else:
                self.confirm, self.confirm_at = kind, time.monotonic()
        if self.driver:
            self.driver.schedule_mini_render(force=True)

    def send_value(self, action, x):
        x0, x1 = action["slider"]
        v = max(0.0, min(1.0, (x - x0) / max(1.0, x1 - x0)))
        self.override[action["key"]] = (v, time.monotonic())
        if self.driver:
            self.driver.emit({"type": "action", "name": action["name"], "args": action.get("args") or {}, "value": v, "from_": "screen"})
            self.driver.schedule_mini_render()
        return v

    def tap(self, raw_x, raw_y):
        """One touch on the panel (raw panel numbers): the button under it - or, calibrating / testing, that page's."""
        self.touched_at = time.monotonic()
        if self.tmode:
            return self.tmode_tap(raw_x, raw_y)
        self.dragf.reset()
        x, y = self.map_touch(raw_x, raw_y)
        return self.tap_xy(x, y)

    def tap_xy(self, x, y):
        """A tap at a place on the screen (pixels): the button there does its job."""
        self.touched_at = time.monotonic()
        action, box = self.hit_box(x, y)
        self.active = None
        if not action:
            return None
        if not action.get("slider") and self.fb_present():
            self.press_feedback(box)
        if action.get("local"):
            self.local(action)
            return action
        if action.get("pan"):   # a pan: a double-tap centres it; a single tap waits for a drag (no jump)
            now = time.monotonic()
            last = getattr(self, "pan_tap", None)
            self.active, self.drag_at = action, now
            if last and last[0] == action["key"] and now - last[1] < 0.45:
                self.pan_tap = None
                self.active = None
                self.override[action["key"]] = (0.5, now)
                if self.driver:
                    self.driver.emit({"type": "action", "name": action["name"], "args": dict(action.get("args") or {}, pan=0), "value": 0.5, "from_": "screen"})
                    self.driver.schedule_mini_render()
            else:
                self.pan_tap = (action["key"], now)
            return action
        if action.get("slider"):
            self.active, self.drag_at = action, time.monotonic()
            if not action.get("nojump"):   # (a pad's volume: only a slide changes it)
                self.send_value(action, x)
            return action
        if self.driver:
            msg = {"type": "action", "name": action["name"], "args": action.get("args") or {}, "from_": "screen"}
            if action.get("delta"):
                msg["delta"] = action["delta"]
            self.driver.emit(msg)
        return action

    def drag(self, raw_x, raw_y):
        """A finger sliding on a fader: its value follows (about 40 a second). Every reading goes through the
        smoothing (TouchFilter: a wild reading never moves it, a wobble of a pixel or two is ignored)."""
        self.touched_at = time.monotonic()
        a = self.active
        if not a:
            return None
        x, y = self.map_touch(raw_x, raw_y)
        if self.__dict__.get("_drag_for") is not a:   # (a new fader: the smoothing starts again)
            self._drag_for = a
            self.dragf.reset()
        f = self.dragf.add(x, y)
        if f is None or time.monotonic() - self.drag_at < 0.025:
            return None
        x = int(round(f[0]))
        if a.get("drag_x") is not None and abs(x - a["drag_x"]) < 2:
            return None
        self.drag_at = time.monotonic()
        a["drag_x"] = x
        return self.send_value(a, x)

    FULL_PUSH_S = 30.0   # (now and then the whole picture again, in case something else drew on the screen)

    def push(self, img=None):
        """Put the picture on the screen. Only the rows that changed since the last one are written: the screen's
        driver sends just those over SPI (a whole 480×320 picture takes ~150 ms at 16 MHz, a clock tick ~15 ms)."""
        img = img if img is not None else self.image
        if not self.available or img is None or not self.fb_present():
            return False
        if self.spec.get("rotate"):
            img = img.rotate(int(self.spec["rotate"]), expand=True)
        size = self.fb_size()
        if size and tuple(size) != img.size:   # a 320×240 screen: the same picture, scaled
            img = img.resize(tuple(size), getattr(self.Image, "LANCZOS", 1))
        data = self.to_rgb565(img)
        w, h = img.size
        row = w * 2
        stride = self.fb_stride() or row
        plock = self.__dict__.setdefault("_push_lock", threading.Lock())
        with plock:
            prev = getattr(self, "_last_fb", None)
            full = prev is None or len(prev) != len(data) or stride != row or time.monotonic() - getattr(self, "_full_at", 0.0) > self.FULL_PUSH_S
            r0, r1 = 0, h
            if not full:
                rows = self.changed_rows(prev, data, w, h)
                if rows is None:
                    self.last_push_bytes = 0
                    return True
                r0, r1 = rows
            try:
                with open(self.fb, "r+b") as handle:
                    if stride == row:
                        handle.seek(r0 * row)
                        handle.write(data[r0 * row:r1 * row])
                    else:   # (a framebuffer with padded lines: line by line)
                        for y in range(r0, r1):
                            handle.seek(y * stride)
                            handle.write(data[y * row:(y + 1) * row])
                self._last_fb = data
                self.last_push_bytes = (r1 - r0) * row
                if full:
                    self._full_at = time.monotonic()
                return True
            except Exception as error:
                self._last_fb = None
                log.debug("framebuffer write failed (%s)", error)
                return False

    @staticmethod
    def changed_rows(prev, data, w, h):
        """(first, last + 1) of the rows that differ, or None when nothing did."""
        try:
            import numpy as np
            a = np.frombuffer(data, dtype="<u2").reshape(h, w)
            b = np.frombuffer(prev, dtype="<u2").reshape(h, w)
            rows = np.flatnonzero((a != b).any(axis=1))
            return (int(rows[0]), int(rows[-1]) + 1) if rows.size else None
        except Exception:
            row = w * 2
            diff = [y for y in range(h) if data[y * row:(y + 1) * row] != prev[y * row:(y + 1) * row]]
            return (diff[0], diff[-1] + 1) if diff else None

    def fb_stride(self):
        if getattr(self, "_fb_stride", None) is None:
            try:
                with open("/sys/class/graphics/%s/stride" % os.path.basename(self.fb)) as fh:
                    self._fb_stride = int(fh.read().strip() or 0)
            except (OSError, ValueError):
                self._fb_stride = 0
        return self._fb_stride

    def mirror(self, tab, press=None, now=None, sub=None):
        """(10.0.1) A mouse click on the app on the big screen: this screen goes to the same tab and, for a button,
        lights the matching one for a moment (found on whichever page of the tab has it). Returns False when it
        stays put: a finger touched this screen a moment ago (the finger wins), a touch mode is open, or a tab
        this screen doesn't have."""
        now = time.monotonic() if now is None else now
        if now - self.touched_at < self.FINGER_WINS or self.tmode or tab not in dict(self.TABS):
            return False
        if tab != self.tab or press:
            self.overlay = None
        self.tab = tab
        if sub and sub in dict(self.SUBS.get(tab, [])):
            self.sub[tab] = sub
        if press and press.get("name"):
            subs = [k for k, _ in self.SUBS.get(tab, [])]
            first = subs[0] if subs else None
            sub0 = self.sub.get(tab, first)
            self.flash = {"name": press["name"], "args": dict(press.get("args") or {}), "until": now + self.FLASH_FOR,
                          "sub0": sub0, "tries": [k for k in subs if k != sub0], "found": False}
        else:
            self.flash = None
        return True

    @staticmethod
    def matches(action, name, args):
        if not action or action.get("slider") or action.get("pan") or action.get("local") or action.get("name") != name:
            return False
        have = action.get("args") or {}
        return all(have.get(k) == v for k, v in (args or {}).items())

    def draw_flash(self, g, hits, d):
        """The mirrored button lit (inside render). Not on this page: try the tab's other pages; nowhere: back to
        the page it was on. Returns True when the page changed and must be drawn again."""
        fl = self.flash
        if not fl or time.monotonic() > fl["until"]:
            self.flash = None
            return False
        box = next((b for b, a in hits if self.matches(a, fl["name"], fl["args"])), None)
        if box is not None:
            fl["found"] = True
            x0, y0, x1, y1 = [int(v) for v in box]
            g.rounded_rectangle([x0, y0, x1, y1], 9, outline=self.COL["accent"], width=3)
            g.rounded_rectangle([x0 + 3, y0 + 3, x1 - 3, y1 - 3], 7, outline=(255, 244, 214), width=1)
            return False
        if fl["found"] or self.overlay:
            return False   # (it was shown; the page moved on since - leave it)
        if fl["tries"]:
            self.sub[self.tab] = fl["tries"].pop(0)
            return True
        if fl["sub0"]:
            self.sub[self.tab] = fl["sub0"]
        self.flash = None
        return True

    def press_feedback(self, box):
        """The pressed button lights up at once - before the app has answered (that redraw follows a moment later)."""
        if not self.available or self.image is None:
            return False
        with self.lock:
            img = self.image.copy()
        g = self.ImageDraw.Draw(img)
        x0, y0, x1, y1 = [int(v) for v in box]
        g.rounded_rectangle([x0, y0, x1, y1], 9, outline=self.COL["accent"], width=3)
        g.rounded_rectangle([x0 + 3, y0 + 3, x1 - 3, y1 - 3], 7, outline=(255, 244, 214), width=1)
        return self.push(img)

    def fb_size(self):
        """The framebuffer's own size (/sys/class/graphics/fbN/virtual_size), else the picked screen's."""
        if getattr(self, "_fb_size", None) is None:
            size = None
            try:
                with open("/sys/class/graphics/%s/virtual_size" % os.path.basename(self.fb)) as fh:
                    w, h = (int(x) for x in fh.read().strip().split(",")[:2])
                    if w and h:
                        size = (w, h)
            except (OSError, ValueError):
                pass
            if not size and self.spec.get("fb_size"):
                size = tuple(int(x) for x in self.spec["fb_size"][:2])
            self._fb_size = size or (self.w, self.h)
        return self._fb_size

    @staticmethod
    def to_rgb565(img):
        try:
            import numpy as np
            a = np.asarray(img.convert("RGB"), dtype=np.uint16)
            return (((a[:, :, 0] >> 3) << 11) | ((a[:, :, 1] >> 2) << 5) | (a[:, :, 2] >> 3)).astype("<u2").tobytes()
        except Exception:
            pixels = img.convert("RGB").tobytes()
            out = bytearray(len(pixels) // 3 * 2)
            for i in range(0, len(pixels), 3):
                r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
                struct.pack_into("<H", out, i // 3 * 2, ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3))
            return bytes(out)

    def hit_test(self, x, y):
        return self.hit_box(x, y)[0]

    def hit_box(self, x, y):
        """The button under a point (and its box). A touch that lands just outside one (a resistive panel's few
        pixels of error) still counts for the nearest button within 6 px."""
        with self.lock:
            hits = list(self.hits)
        for box, action in hits:
            if box[0] <= x <= box[2] and box[1] <= y <= box[3]:
                return action, box
        best, near = None, 6.0
        for box, action in hits:
            dx = max(box[0] - x, 0, x - box[2])
            dy = max(box[1] - y, 0, y - box[3])
            d = math.hypot(dx, dy)
            if d <= near:
                best, near = (action, box), d
        return best or (None, None)

    def map_touch(self, raw_x, raw_y):
        c = self.spec.get("calibration") or {}
        A = c.get("affine")
        if isinstance(A, (list, tuple)) and len(A) == 6:   # (calibrated with the 5 crosses)
            x = A[0] * raw_x + A[1] * raw_y + A[2]
            y = A[3] * raw_x + A[4] * raw_y + A[5]
            return int(round(min(max(x, 0), self.w - 1))), int(round(min(max(y, 0), self.h - 1)))
        if c.get("swap", True):
            raw_x, raw_y = raw_y, raw_x
        x = (raw_x - c.get("xmin", 200)) / max(1, c.get("xmax", 3900) - c.get("xmin", 200))
        y = (raw_y - c.get("ymin", 200)) / max(1, c.get("ymax", 3900) - c.get("ymin", 200))
        if c.get("flip_x"):
            x = 1 - x
        if c.get("flip_y"):
            y = 1 - y
        return int(min(max(x, 0), 1) * (self.w - 1)), int(min(max(y, 0), 1) * (self.h - 1))

    def touch_loop(self, usb):
        if not usb.available:
            return
        ev = usb.evdev
        want = [w.strip().lower() for w in str(self.spec.get("touch") if self.spec.get("touch") is not None else "ADS7846").split("|") if w.strip()]
        if not want:
            return   # a screen without touch
        try:   # (Python hands the CPU between threads every 5 ms: sooner, so a touch never waits long behind a redraw)
            sys.setswitchinterval(min(sys.getswitchinterval(), 0.002))
        except Exception:
            pass
        abs_x = (ev.ecodes.ABS_X, getattr(ev.ecodes, "ABS_MT_POSITION_X", -1))
        abs_y = (ev.ecodes.ABS_Y, getattr(ev.ecodes, "ABS_MT_POSITION_Y", -1))
        abs_p = getattr(ev.ecodes, "ABS_PRESSURE", -1)
        while not usb.stop_flag.is_set():
            dev = None
            try:
                for path in ev.list_devices():
                    d = ev.InputDevice(path)
                    if any(w in d.name.lower() for w in want):
                        dev = d
                        break
                    d.close()
            except Exception:
                dev = None
            if dev is None:
                time.sleep(5)
                continue
            log.info("3.5\" touch panel: %s", dev.name)
            self.touch_name = dev.name
            self.tstats["device"] = dev.name
            x = y = pressure = None
            down = pending = False
            samples, press, down_at = [], [], 0.0
            try:
                for event in dev.read_loop():
                    if usb.stop_flag.is_set():
                        break
                    # The panel sends "touched" before the place it was touched (both in one report): the tap is acted
                    # on at the end of the report, with this touch's place - not the last one's (or none at all).
                    if event.type == ev.ecodes.EV_ABS:
                        if event.code in abs_x:
                            x = event.value
                        elif event.code in abs_y:
                            y = event.value
                        elif event.code == abs_p:
                            pressure = event.value
                    elif event.type == ev.ecodes.EV_KEY and event.code == ev.ecodes.BTN_TOUCH:
                        if event.value == 1 and not down:
                            down = pending = True
                            samples, press, down_at = [], [], time.monotonic()
                        elif event.value == 0:
                            if pending and samples:   # (a very quick, light tap: what was read so far still counts)
                                self.tap(*self.steady(samples))
                                self.note_tap(down_at)
                            self.released(press, down_at, pressure)
                            down = pending = False
                            self.active = None
                    elif event.type == ev.ecodes.EV_SYN and x is not None and y is not None:
                        if down:
                            press.append((x, y))
                        if pending:
                            # A resistive panel's first readings jump while the finger settles: the tap goes off on the
                            # middle of the first few (about 30 ms), not on the very first one.
                            samples.append((x, y))
                            if len(samples) >= 3 or time.monotonic() - down_at > 0.03:
                                pending = False
                                self.tap(*self.steady(samples))
                                self.note_tap(down_at)
                        elif down and self.active:
                            self.drag(x, y)   # (a finger sliding along a fader)
                        elif down and self.tmode and self.tmode.get("kind") == "test":
                            self.test_reading(x, y)
            except Exception as error:
                log.debug("touch loop ended (%s)", error)
                time.sleep(2)

    # ----- what the panel is doing (the Touch test page, the start-up report) ----------------------------------------
    TOUCH_STATS_FILE = "/tmp/central-pedal-touch.json"

    def note_tap(self, down_at):
        self.tstats["taps"] += 1
        self.tstats["tapMs"] = round((time.monotonic() - down_at) * 1000.0, 1)

    def released(self, press, down_at, pressure=None):
        """A finger lifted: readings per second and - when it was held still - how far its readings wandered (px).
        Calibrating, it was one of the crosses."""
        now = time.monotonic()
        st = self.tstats
        st["presses"] += 1
        st["last"] = now
        dur = now - down_at
        if len(press) >= 4 and dur > 0.06:
            st["rate"] = round(len(press) / dur, 1)
        if pressure is not None:
            st["pressure"] = pressure
        pts = [self.map_touch(*p) for p in (press[2:-3] if len(press) >= 10 else [])]
        if pts:
            mx, my = sum(p[0] for p in pts) / float(len(pts)), sum(p[1] for p in pts) / float(len(pts))
            far = max(math.hypot(p[0] - mx, p[1] - my) for p in pts)
            if far < 25:   # (held still, not a slide)
                st["jitter"] = round(math.sqrt(sum((p[0] - mx) ** 2 + (p[1] - my) ** 2 for p in pts) / len(pts)), 1)
        if self.tmode and self.tmode.get("kind") == "cal":
            self.calibration_press(press)
        elif self.tmode and self.tmode.get("kind") == "test":
            self.redraw()
        if now - self.__dict__.get("_stats_at", 0.0) > 2.0:
            self._stats_at = now
            self.write_touch_stats()

    def write_touch_stats(self):
        try:
            cal = (self.spec or {}).get("calibration") or {}
            how = ("5 crosses, fit %s px" % cal.get("rms")) if cal.get("affine") else ("2 crosses (older)" if cal.get("xmin") is not None and cal.get("at") else "the screen's defaults")
            with open(self.TOUCH_STATS_FILE, "w") as fh:
                json.dump(dict(self.tstats, at=int(time.time()), calibration=how), fh)
        except (OSError, TypeError, ValueError):
            pass

    # ----- touch modes: CALIBRATE (5 crosses), then CHECK (tap the dot), and TEST (dots and numbers) -----------------
    # Each takes the whole small screen until it's done (the app's redraws don't wipe it).
    CAL_MARGIN = 28
    CAL_MAX_RMS = 12.0   # px: the 5 crosses must agree this well, else one touch was off - again
    CHECK_OK = 10.0      # px from the dot: "good"

    def cal_targets(self):
        m, W, H = self.CAL_MARGIN, self.w, self.h
        return [(m, m), (W - 1 - m, m), (W - 1 - m, H - 1 - m), (m, H - 1 - m), ((W - 1) // 2, (H - 1) // 2)]

    def check_target(self):
        return int(self.w * 0.3), int(self.h * 0.42)

    def redraw(self):
        if self.driver:
            self.driver.schedule_mini_render(force=True)

    def set_tmode(self, mode, timeout=None):
        self.tmode = mode
        with self.lock:   # (the page underneath's buttons can't be hit before the touch page is drawn)
            self.hits = []
        if self.driver:
            self.driver.touch_calibrating = bool(mode and mode.get("kind") == "cal")
        self.dragf.reset()
        if mode is not None and timeout:
            gen = self.__dict__.get("_tgen", 0) + 1
            self._tgen = gen
            mode["gen"] = gen
            tm = threading.Timer(timeout, self._tmode_timeout, args=(gen,))
            tm.daemon = True
            tm.start()
        self.redraw()

    def _tmode_timeout(self, gen):
        t = self.tmode
        if not t or t.get("gen") != gen:
            return
        if t["kind"] == "test" and time.monotonic() - self.tstats.get("last", 0.0) < 60:
            self.set_tmode(t, 30)   # (still being used)
        elif t["kind"] == "check":   # nobody pressed SAVE or REDO: keep it when it is good, else the one from before
            marks = t.get("marks") or []
            self.cal_finish(t.get("rms", 99) <= 8 and (not marks or marks[-1][2] <= self.CHECK_OK))
        else:
            self.set_tmode(None)

    def _set_cal(self, cal):
        spec = self.spec if isinstance(self.spec, dict) else {}
        if cal:
            spec["calibration"] = cal
        else:
            spec.pop("calibration", None)
        self.spec = spec

    def start_calibration(self):
        if not self.available:
            return
        t = self.tmode or {}
        prev = t["prev"] if "prev" in t else dict((self.spec or {}).get("calibration") or {})
        self._set_cal(prev)   # (a REDO, or calibrating again from the app mid-check: back to the one before)
        self.set_tmode({"kind": "cal", "points": [], "prev": prev, "msg": ""}, 120)

    def calibration_press(self, press):
        t = self.tmode
        if not t or t.get("kind") != "cal":
            return
        pt = touch_press_point(press)
        if pt is None or len(press) < 3:
            t["msg"] = "Hold your finger on the cross a moment"
            self.redraw()
            return
        t["points"].append(pt)
        t["msg"] = ""
        if len(t["points"]) < 5:
            self.redraw()
            return
        A, rms = touch_affine_fit(t["points"], self.cal_targets())
        if A is None or rms > self.CAL_MAX_RMS:
            t["points"] = []
            t["msg"] = "One touch was off - once more, from the first cross"
            self.redraw()
            return
        cal = dict(t["prev"])
        cal.update({"affine": A, "points": 5, "rms": round(rms, 1), "at": int(time.time())})
        self._set_cal(cal)   # (live for the check: the dot and SAVE / REDO already use it)
        self.set_tmode({"kind": "check", "cal": cal, "prev": t["prev"], "rms": rms, "marks": []}, 45)

    def cal_finish(self, save):
        t = self.tmode or {}
        if t.get("kind") != "check":
            self.set_tmode(None)
            return
        cal = t["cal"] if save else t["prev"]
        self._set_cal(cal)
        if save and self.driver:
            ms = self.driver.config.get("mini_screen")
            if ms is None:
                self.driver.config["mini_screen"] = self.spec
            elif ms is not self.spec:
                ms["calibration"] = cal
            self.driver.save_config()
        if self.driver:
            self.driver.emit({"type": "touchCalibrated", "calibration": cal, "saved": bool(save)})
        self.write_touch_stats()
        self.set_tmode(None)

    def start_test(self):
        if self.available:
            self.set_tmode({"kind": "test", "dots": [], "trail": [], "raw": []}, 90)

    def test_reading(self, raw_x, raw_y):
        t = self.tmode
        x, y = self.map_touch(raw_x, raw_y)
        t["raw"] = (t["raw"] + [(x, y)])[-80:]
        f = self.dragf.add(x, y)
        if f is not None:
            t["trail"] = (t["trail"] + [f])[-80:]
        if self.driver:
            self.driver.schedule_mini_render()

    def tmode_tap(self, raw_x, raw_y):
        t = self.tmode
        if t["kind"] == "cal":
            return None   # (a cross counts when the finger lifts: from all its readings, not the first few)
        x, y = self.map_touch(raw_x, raw_y)
        action, box = self.hit_box(x, y)
        if action and action.get("local"):
            if self.fb_present():
                self.press_feedback(box)
            self.local(action)
            return action
        if t["kind"] == "check":
            tx, ty = self.check_target()
            t["marks"] = (t["marks"] + [(x, y, math.hypot(x - tx, y - ty))])[-4:]
        elif t["kind"] == "test":
            self.dragf.reset()
            self.dragf.add(x, y)
            t["dots"] = (t["dots"] + [(x, y)])[-12:]
            t["raw"], t["trail"] = [], []
        self.redraw()
        return None

    def draw_tmode(self, g, hits):
        C, W, H, t = self.COL, self.w, self.h, self.tmode
        g.rectangle([0, 0, W, H], fill=C["bg"])
        kind = t["kind"]
        if kind == "cal":
            targets = self.cal_targets()
            n = len(t["points"])
            for px, py in targets[:n]:
                g.ellipse([px - 4, py - 4, px + 4, py + 4], fill=C["playing"])
            px, py = targets[min(n, 4)]
            g.ellipse([px - 15, py - 15, px + 15, py + 15], outline=C["accent"], width=2)
            g.line([px - 22, py, px + 22, py], fill=C["text"], width=2)
            g.line([px, py - 22, px, py + 22], fill=C["text"], width=2)
            cy = H // 2 - 70 if n == 4 else H // 2
            self.text(g, (W / 2, cy - 12), "Touch the cross (%d of 5)" % (n + 1), self.F["title"], C["text"], "mm")
            self.text(g, (W / 2, cy + 12), "with a fingertip - hold still a moment, then lift", self.F["sub"], C["muted"], "mm")
            if t.get("msg"):
                self.text(g, (W / 2, cy + 34), t["msg"], self.F["label"], C["warn"], "mm", W - 90)
        elif kind == "check":
            tx, ty = self.check_target()
            self.text(g, (14, 16), "Check the touch", self.F["title"], C["text"])
            self.text(g, (14, 40), "Tap the dot. A ring shows where your tap landed.", self.F["sub"], C["muted"])
            g.ellipse([tx - 7, ty - 7, tx + 7, ty + 7], fill=C["accent"])
            for i, (mx, my, d) in enumerate(t["marks"]):
                last = i == len(t["marks"]) - 1
                col = (C["playing"] if d <= self.CHECK_OK else C["warn"]) if last else C["line"]
                g.ellipse([mx - 11, my - 11, mx + 11, my + 11], outline=col, width=3 if last else 1)
            if t["marks"]:
                d = t["marks"][-1][2]
                good = d <= self.CHECK_OK
                self.text(g, (W * 0.58, ty - 10), "%d px off" % round(d), self.F["num"], C["playing"] if good else C["warn"], "lm")
                self.text(g, (W * 0.58, ty + 16), "good - tap SAVE" if good else "too far - tap REDO", self.F["label"], C["text"], "lm")
            else:
                self.text(g, (W * 0.58, ty), "the 5 crosses agree to %.1f px" % t.get("rms", 0), self.F["label"], C["muted"], "lm", W * 0.4)
            bw = (W - 18) / 2
            self.button(g, hits, [6, H - 64, 6 + bw, H - 8], "SAVE", {"local": "tmSave"}, on=True, sub="use this calibration")
            self.button(g, hits, [12 + bw, H - 64, W - 6, H - 8], "REDO", {"local": "tmRedo"}, sub="the 5 crosses again")
        else:   # test
            st = self.tstats
            for rx, ry in t["raw"]:
                g.point((rx, ry), fill=C["muted"])
            if len(t["trail"]) > 1:
                g.line([(int(a), int(b)) for a, b in t["trail"]], fill=C["accent"], width=2)
            for i, (dx, dy) in enumerate(t["dots"]):
                last = i == len(t["dots"]) - 1
                r = 6 if last else 4
                g.ellipse([dx - r, dy - r, dx + r, dy + r], fill=C["accent"] if last else C["selected"])
            self.text(g, (10, 14), "Touch test", self.F["title"], C["text"])
            cal = (self.spec or {}).get("calibration") or {}
            lines = ["%s readings a second - a tap goes off after %s ms" % (int(st["rate"]) if st["rate"] else "-", int(st["tapMs"]) if st["tapMs"] else "-"),
                     "held still it wanders %s px%s" % (st["jitter"] if st["jitter"] else "-", ("  - pressure %s" % st["pressure"]) if st.get("pressure") is not None else ""),
                     "calibrated with 5 crosses" if cal.get("affine") else "not calibrated yet - tap CALIBRATE"]
            for i, line in enumerate(lines):
                self.text(g, (10, 38 + i * 16), line, self.F["sub"], C["muted"] if i < 2 or cal.get("affine") else C["warn"], "la", W - 220 if i == 0 else None)
            self.button(g, hits, [W - 206, 6, W - 106, 44], "CALIBRATE", {"local": "calibrate"})
            self.button(g, hits, [W - 100, 6, W - 6, 44], "DONE", {"local": "tmDone"}, on=True)
            self.text(g, (W / 2, H - 14), "touch and slide anywhere: a dot where you tap, the line is what a fader gets", self.F["tiny"], C["muted"], "mm")

    @staticmethod
    def steady(samples):
        """The touch's place from its first readings: the middle value of each (the first reading left out when there
        are enough)."""
        pts = samples[1:] if len(samples) >= 3 else samples
        xs, ys = sorted(p[0] for p in pts), sorted(p[1] for p in pts)
        return xs[len(xs) // 2], ys[len(ys) // 2]

    def draw_calibration(self, step):   # (older callers: the 5-cross calibration)
        self.start_calibration()


class _ExpanderLed:
    def __init__(self, chip, pin):
        self.chip, self.pin = chip, pin

    def on(self):
        self.chip.write(self.pin, True)

    def off(self):
        self.chip.write(self.pin, False)

    def blink(self, **_):
        self.chip.write(self.pin, True)

    def close(self):
        pass


# ---------------------------------------------------------------------------
# Network audio: Central Pedal -> Central Control computers (Ethernet or Wi-Fi)
# ---------------------------------------------------------------------------
def ip_interfaces():
    """[{iface, address, kind}] for every IPv4 address; kind is ethernet / wifi / other."""
    found = []
    code, out, _ = run(["ip", "-o", "-4", "addr", "show"], timeout=5)
    if code == 0:
        for line in out.splitlines():
            m = re.match(r"^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)/", line)
            if not m or m.group(2).startswith("127."):
                continue
            iface = m.group(1).split("@")[0]
            wireless = os.path.isdir("/sys/class/net/%s/wireless" % iface) or iface.startswith("wl")
            kind = "wifi" if wireless else "ethernet" if re.match(r"^(eth|en|usb)", iface) else "other"
            found.append({"iface": iface, "address": m.group(2), "kind": kind})
        return found
    # no `ip` command: ask the kernel for each interface's address
    try:
        import fcntl
        for iface in sorted(os.listdir("/sys/class/net")):
            if iface == "lo":
                continue
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                    packed = fcntl.ioctl(sock.fileno(), 0x8915, struct.pack("256s", iface[:15].encode()))   # SIOCGIFADDR
                address = socket.inet_ntoa(packed[20:24])
            except OSError:
                continue
            wireless = os.path.isdir("/sys/class/net/%s/wireless" % iface) or iface.startswith("wl")
            kind = "wifi" if wireless else "ethernet" if re.match(r"^(eth|en|usb)", iface) else "other"
            found.append({"iface": iface, "address": address, "kind": kind})
    except Exception:
        pass
    if not found:   # Windows / macOS
        found = [{"iface": "net%d" % i, "address": a, "kind": "other"} for i, a in enumerate(local_ipv4())]
    return found


SYNC_PREFIXES = ("library/", "charts/", "lighting/")
SYNC_PORT = 8094


def _newer(a, b):
    """(rev, ts, by) of a is newer than b (None is oldest)."""
    if not b:
        return bool(a)
    if not a:
        return False
    return (int(a[0]), int(a[1]), str(a[2])) > (int(b[0]), int(b[1]), str(b[2]))


class SongSync:
    """Every Central Pedal (the Pi and Central Pedal on a PC) keeps the same songs and setlists.

    Songs and setlists are records with a version (rev, a Lamport clock, then time, then device), so the
    newest edit wins and an edit made after receiving another one always counts as newer. Devices find
    each other on the network (a small UDP beacon) and are linked once with the other one's pairing code;
    after that they pull each other's changes every few seconds. A song's files (its stems, its chart
    pages, its light show) come along. A Raspberry Pi only downloads stems of songs that are in a
    setlist (cards are small); a PC takes everything. Deleting asks: this setlist, this device, everywhere."""

    def __init__(self, driver):
        self.driver = driver
        self.data_root = os.path.realpath(driver.config["data_root"])
        self.root = os.path.join(self.data_root, "sync")
        for sub in ("songs", "setlists"):
            os.makedirs(os.path.join(self.root, sub), exist_ok=True)
        self.state_path = os.path.join(self.root, "state.json")
        st = read_json(self.state_path, {})
        self.id = st.get("id") or ("cc-" + secrets.token_hex(6))
        self.name = st.get("name") or driver.config.get("device_name") or socket.gethostname()
        self.group = st.get("group") if isinstance(st.get("group"), dict) else None
        self.clock = int(st.get("clock") or 0)
        self.hidden = set(st.get("hidden") or [])        # songs deleted on this device only
        self.known = st.get("known") or {}               # device id -> name (for "made on")
        self.kind = driver.config.get("sync_kind") if driver.config.get("sync_kind") in ("pc", "pi") else ("pc" if driver.config.get("simulated") else "pi")
        # which songs' stems a device keeps: a computer all of them; a Pi only the open setlist's (10.0 - one setlist
        # at a time on the card; the others come back from the computer when they're opened again). "setlists" = the
        # stems of every song in any setlist (before 10.0).
        self.stems_mode = driver.config.get("sync_stems") or ("all" if self.kind == "pc" else "current")
        self.current = None                               # the setlist open here (from the app's saves)
        self.pruning = False
        self.lock = threading.RLock()
        self.songs = self._load_all("songs")
        self.setlists = self._load_all("setlists")
        self.sha = {}                                     # key -> (mtime, size, sha1)
        self.peers = {}                                   # id -> {name, address, port, group, seen, kind, lastSync, error}
        for hostport in driver.config.get("sync_peers") or []:
            host, _, port = str(hostport).rpartition(":")
            self.peers["static:" + hostport] = {"name": hostport, "address": host or hostport, "port": int(port or 8080), "group": None, "seen": 0, "static": True}
        self.activity = {"busy": False, "file": None, "done": 0, "total": 0, "warning": None}
        self.wake = threading.Event()
        self.stopping = False
        self.save_state()

    # ----- storage ---------------------------------------------------------
    def save_state(self):
        write_json(self.state_path, {"id": self.id, "name": self.name, "group": self.group, "clock": self.clock, "hidden": sorted(self.hidden), "known": self.known})

    def _load_all(self, sub):
        out = {}
        d = os.path.join(self.root, sub)
        for name in os.listdir(d):
            if name.endswith(".json"):
                j = read_json(os.path.join(d, name), None)
                if j and j.get("id"):
                    out[j["id"]] = j
        return out

    def _save(self, sub, rec):
        (self.songs if sub == "songs" else self.setlists)[rec["id"]] = rec
        write_json(os.path.join(self.root, sub, re.sub(r"[^A-Za-z0-9_-]", "", rec["id"])[:80] + ".json"), rec)

    def tick(self, seen=0):
        self.clock = max(self.clock, int(seen or 0)) + 1
        return self.clock

    @staticmethod
    def safe_id(value):
        return re.sub(r"[^A-Za-z0-9_-]", "", str(value or ""))[:80]

    # ----- files that go with a song ---------------------------------------------
    def key_for(self, path):
        if not path:
            return None
        real = os.path.realpath(path)
        if not real.startswith(self.data_root + os.sep):
            return None
        key = os.path.relpath(real, self.data_root).replace(os.sep, "/")
        return key if key.startswith(SYNC_PREFIXES) and ".." not in key.split("/") else None

    def path_for(self, key):
        key = str(key or "")
        if not key.startswith(SYNC_PREFIXES) or ".." in key.split("/") or key.startswith("/"):
            return None
        return os.path.join(self.data_root, *key.split("/"))

    def meta(self, key):
        path = self.path_for(key)
        if not path or not os.path.isfile(path):
            return None
        stat = os.stat(path)
        cached = self.sha.get(key)
        if cached and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
            return {"key": key, "size": stat.st_size, "sha1": cached[2]}
        h = hashlib.sha1()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                h.update(chunk)
        self.sha[key] = (stat.st_mtime, stat.st_size, h.hexdigest())
        return {"key": key, "size": stat.st_size, "sha1": h.hexdigest()}

    def portable(self, song):
        """The song as it travels: stem files as data-relative keys instead of this device's paths."""
        s = copy.deepcopy(song)
        for st in ((s.get("tracks") or {}).get("stems") or []):
            if st.get("file"):
                key = self.key_for(st["file"])
                if key:
                    st["fileKey"] = key
                st.pop("file", None)
        return s

    def localized(self, song):
        s = copy.deepcopy(song)
        for st in ((s.get("tracks") or {}).get("stems") or []):
            if st.get("fileKey"):
                st["file"] = self.path_for(st["fileKey"])
                st.pop("fileKey", None)
        return s

    def asset_keys(self, song, stems=True):
        keys = []
        if stems:
            for st in ((song.get("tracks") or {}).get("stems") or []):
                if st.get("fileKey"):
                    keys.append(st["fileKey"])
        chart = song.get("chart") or {}
        cid = self.safe_id(chart.get("id")) if isinstance(chart, dict) else ""
        if cid:
            d = os.path.join(self.data_root, "charts", cid)
            if os.path.isdir(d):
                keys += ["charts/%s/%s" % (cid, n) for n in sorted(os.listdir(d)) if os.path.isfile(os.path.join(d, n))]
        sid = self.safe_id(song.get("id"))
        if sid and os.path.isfile(os.path.join(self.data_root, "lighting", sid + ".json")):
            keys.append("lighting/%s.json" % sid)
        return keys

    # ----- from this device's app ----------------------------------------------
    def from_project(self, project):
        """Called with every saved project: the open setlist and its songs become records."""
        if not isinstance(project, dict):
            return
        changed = False
        now = int(time.time() * 1000)
        with self.lock:
            ids = []
            for song in project.get("songs") or []:
                if not isinstance(song, dict) or not song.get("id"):
                    continue
                sid = self.safe_id(song["id"])
                if not sid:
                    continue
                ids.append(sid)
                portable = self.portable(song)
                digest = hashlib.sha1(json.dumps(portable, sort_keys=True).encode()).hexdigest()
                rec = self.songs.get(sid)
                if sid in self.hidden:
                    self.hidden.discard(sid)     # it was put in a setlist here again
                    changed = True
                if rec and rec.get("hash") == digest and not rec.get("deleted"):
                    continue
                self._save("songs", {"id": sid, "rev": self.tick(rec and rec.get("rev")), "ts": now, "by": self.id, "hash": digest, "deleted": False, "song": portable})
                changed = True
            slid = self.safe_id(project.get("setlistId"))
            opened = bool(slid) and slid != self.current
            if slid:
                self.current = slid
            if slid:
                body = {"name": str(project.get("name") or "Setlist")[:120], "songIds": ids}
                rec = self.setlists.get(slid)
                if not rec or rec.get("deleted") or rec.get("setlist") != body:
                    self._save("setlists", {"id": slid, "rev": self.tick(rec and rec.get("rev")), "ts": now, "by": self.id, "deleted": False, "setlist": body})
                    changed = True
            if changed:
                self.save_state()
        if changed:
            self.poke_peers()
        if opened and self.stems_mode == "current":
            threading.Thread(target=self.keep_one_setlist, daemon=True, name="sync-prune").start()

    # ----- 10.0: a Pi keeps one setlist's tracks; a computer stores and runs the rest ----------------------
    def runs_tracks(self):
        """Central Pedal Control on a computer runs the tracks for a linked pedal (the pedal is its foot controller)."""
        return bool(PEDAL_CONTROL and self.driver.config.get("run_tracks", True))

    def wanted_ids(self):
        """The songs whose stems this device keeps (None = every song)."""
        if self.stems_mode == "all":
            return None
        if self.stems_mode == "current":
            rec = self.setlists.get(self.current or "")
            return set(((rec or {}).get("setlist") or {}).get("songIds") or []) if rec and not rec.get("deleted") else set()
        return self.setlist_song_ids()

    def tracks_host(self):
        """The linked computer (Central Pedal Control) that runs the tracks now, or None: online, linked, and it says so."""
        if self.kind != "pi" or not self.group:
            return None
        now = time.time()
        with self.lock:
            best = None
            for pid, p in self.peers.items():
                if p.get("group") != self.group["id"] or not p.get("tracks") or not p.get("address"):
                    continue
                if not (p.get("static") or now - p.get("seen", 0) < 15):
                    continue
                if best is None or p.get("seen", 0) > best[1].get("seen", 0):
                    best = (pid, p)
            if not best:
                return None
            pid, p = best
            return {"id": pid, "name": p.get("name") or "Central Pedal Control", "address": p["address"], "port": int(p.get("port") or 8080),
                    "wsPort": int(p.get("ws") or 8081), "online": True, "kind": "pedal-control"}

    def host_check(self):
        """A Pi: a linked Central Pedal Control that runs the tracks came or went - this pedal controls it, or plays again."""
        link = getattr(self.driver, "center_link", None)
        if link is not None and self.kind == "pi":
            try:
                link.set_pc_player(self.tracks_host())
            except Exception as error:
                log.debug("sync: tracks host check (%s)", error)

    def on_computer(self, sid):
        """A linked computer has this song (it keeps every song's tracks), so the Pi can let its copy go."""
        for p in self.peers.values():
            if self.group and p.get("group") == self.group["id"] and p.get("kind") == "pc" and sid in (p.get("songIds") or ()):
                return True
        return False

    def keep_one_setlist(self):
        """A new setlist is open on a Pi: the tracks of songs that aren't in it are removed here - only when a linked
        computer has them (they come back from it when that setlist is opened again). Songs that are only on this Pi stay."""
        if self.kind != "pi" or self.pruning:
            return
        self.pruning = True
        try:
            time.sleep(float(self.driver.config.get("sync_prune_delay", 2)))   # (the app saves a few times when a setlist opens)
            wanted = self.wanted_ids() or set()
            freed, kept = 0, 0
            with self.lock:
                for sid, rec in list(self.songs.items()):
                    if rec.get("deleted") or sid in wanted or rec.get("missing"):
                        continue
                    song = rec.get("song") or {}
                    stems = [k for k in self.asset_keys(song) if k.startswith("library/")]
                    if not stems:
                        continue
                    if not self.on_computer(sid):
                        kept += 1
                        continue
                    self.drop_files(dict(song, id=sid), keep=wanted)
                    rec["missing"] = stems
                    self._save("songs", rec)
                    freed += 1
            if freed:
                log.info("sync: one setlist on this Pi - the tracks of %d other song%s removed here (the computer keeps them)", freed, "" if freed == 1 else "s")
            self.activity["kept"] = kept
            self.emit_status()
            self.wake.set()    # (the open setlist's tracks come over now if they aren't here)
        finally:
            self.pruning = False

    def touch(self, sid):
        """A file that belongs to a song changed (its light show): a new version, so the others fetch it."""
        sid = self.safe_id(sid)
        with self.lock:
            rec = self.songs.get(sid)
            if not rec or rec.get("deleted"):
                return
            rec = dict(rec, rev=self.tick(rec.get("rev")), ts=int(time.time() * 1000), by=self.id)
            self._save("songs", rec)
        self.poke_peers()

    # ----- listings for this device's app -------------------------------------------
    def device_name(self, did):
        if did == self.id:
            return self.name
        return self.known.get(did) or (self.peers.get(did) or {}).get("name") or "another Central Pedal"

    def setlist_song_ids(self):
        out = set()
        for rec in self.setlists.values():
            if not rec.get("deleted"):
                out.update((rec.get("setlist") or {}).get("songIds") or [])
        return out

    def setlists_listing(self):
        with self.lock:
            out = []
            for rec in self.setlists.values():
                if rec.get("deleted"):
                    continue
                sl = rec.get("setlist") or {}
                out.append({"id": rec["id"], "name": sl.get("name", ""), "count": len(sl.get("songIds") or []), "ts": rec.get("ts"), "by": self.device_name(rec.get("by"))})
            return sorted(out, key=lambda x: -int(x["ts"] or 0))

    def songs_listing(self):
        with self.lock:
            inlists = {}
            for rec in self.setlists.values():
                if not rec.get("deleted"):
                    for sid in (rec.get("setlist") or {}).get("songIds") or []:
                        inlists.setdefault(sid, []).append((rec.get("setlist") or {}).get("name", ""))
            out = []
            for rec in self.songs.values():
                if rec.get("deleted"):
                    continue
                s = rec.get("song") or {}
                missing = [k for k in rec.get("missing") or []]
                out.append({"id": rec["id"], "name": s.get("name", ""), "key": s.get("key"), "bpm": s.get("bpm"), "stems": len(((s.get("tracks") or {}).get("stems") or [])),
                            "setlists": inlists.get(rec["id"], []), "here": rec["id"] not in self.hidden, "stemsHere": not missing, "ts": rec.get("ts"), "by": self.device_name(rec.get("by"))})
            return sorted(out, key=lambda x: x["name"].lower())

    def song_for_app(self, sid):
        rec = self.songs.get(self.safe_id(sid))
        if not rec or rec.get("deleted"):
            return None
        return self.localized(rec["song"])

    def setlist_for_app(self, slid):
        rec = self.setlists.get(self.safe_id(slid))
        if not rec or rec.get("deleted"):
            return None
        sl = rec.get("setlist") or {}
        songs = [self.song_for_app(sid) for sid in sl.get("songIds") or []]
        return {"id": rec["id"], "name": sl.get("name", ""), "songs": [s for s in songs if s], "missingStems": self.missing_count(sl.get("songIds") or [])}

    def missing_count(self, ids):
        return sum(1 for sid in ids if (self.songs.get(sid) or {}).get("missing"))

    def delete(self, kind, rid, scope):
        """kind song / setlist; scope "here" (this device only) or "everywhere"."""
        rid = self.safe_id(rid)
        with self.lock:
            store = self.songs if kind == "song" else self.setlists
            rec = store.get(rid)
            if not rec:
                return {"ok": False, "error": "not found"}
            if scope == "everywhere":
                rec = dict(rec, deleted=True, rev=self.tick(rec.get("rev")), ts=int(time.time() * 1000), by=self.id)
                if kind == "song":
                    self.drop_files(rec.get("song") or {})
                    rec["song"] = {"id": rid, "name": (rec.get("song") or {}).get("name", "")}
                self._save("songs" if kind == "song" else "setlists", rec)
            elif kind == "song":
                self.hidden.add(rid)
                self.drop_files(rec.get("song") or {})
                rec["missing"] = self.asset_keys(rec.get("song") or {})
                self._save("songs", rec)
            else:
                return {"ok": False, "error": "a setlist is deleted everywhere"}
            self.save_state()
        self.poke_peers()
        return {"ok": True}

    def drop_files(self, song, keep=None):
        """Remove a song's stems here unless another song still uses them (keep: only these songs count - and the
        songs only this device has - when a Pi lets the other setlists' tracks go)."""
        used = set()
        for rid, rec in self.songs.items():
            if rid != song.get("id") and not rec.get("deleted") and rid not in self.hidden:
                if keep is not None and rid not in keep and (rec.get("missing") or self.on_computer(rid)):
                    continue
                used.update(self.asset_keys(rec.get("song") or {}))
        for key in self.asset_keys(song):
            if key.startswith("library/") and key not in used:
                path = self.path_for(key)
                try:
                    if path and os.path.isfile(path):
                        os.remove(path)
                except OSError:
                    pass

    # ----- what the other devices get -------------------------------------------------
    def auth_ok(self, headers, path):
        if not self.group:
            return False
        if headers.get("X-CC-Group") != self.group["id"]:
            return False
        want = hmac.new(self.group["key"].encode(), path.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(want, headers.get("X-CC-Sig") or "")

    def sign(self, path):
        return {"X-CC-Group": self.group["id"], "X-CC-Sig": hmac.new(self.group["key"].encode(), path.encode(), hashlib.sha256).hexdigest(), "X-CC-From": self.id}

    def index(self):
        with self.lock:
            return {"id": self.id, "name": self.name, "kind": self.kind, "host": {"tracks": self.runs_tracks(), "wsPort": int(self.driver.config.get("lan_ws_port") or 8081)},
                    "songs": {k: [r.get("rev", 0), r.get("ts", 0), r.get("by", ""), bool(r.get("deleted"))] for k, r in self.songs.items() if k not in self.hidden or r.get("deleted")},
                    "setlists": {k: [r.get("rev", 0), r.get("ts", 0), r.get("by", ""), bool(r.get("deleted"))] for k, r in self.setlists.items()},
                    "names": dict(self.known, **{self.id: self.name})}

    def record(self, kind, rid):
        with self.lock:
            rec = (self.songs if kind == "song" else self.setlists).get(self.safe_id(rid))
            if not rec or (kind == "song" and rec["id"] in self.hidden and not rec.get("deleted")):
                return None
            rec = copy.deepcopy(rec)
        if kind == "song" and not rec.get("deleted"):
            have = set(rec.get("missing") or [])
            rec["assets"] = [m for m in (self.meta(k) for k in self.asset_keys(rec["song"]) if k not in have) if m]
        rec.pop("missing", None)
        return rec

    def handle_link(self, payload):
        """Another Central Pedal links with this one using this one's pairing code."""
        if not self.driver.code_ok((payload or {}).get("code")):
            return 403, {"error": "That code is not right - it is in this Central Pedal's Settings."}
        theirs = payload.get("group") if isinstance(payload.get("group"), dict) else None
        with self.lock:
            if not self.group:
                self.group = theirs if theirs and theirs.get("id") and theirs.get("key") else {"id": "g-" + secrets.token_hex(6), "key": secrets.token_hex(24)}
            pid = self.safe_id(payload.get("id"))
            if pid:
                self.known[pid] = str(payload.get("name") or "")[:60]
            self.save_state()
        self.wake.set()
        self.emit_status()
        return 200, {"group": self.group, "id": self.id, "name": self.name, "kind": self.kind}

    # ----- linking from here --------------------------------------------------------------
    def link(self, address, port, code):
        url = "http://%s:%d/api/sync/link" % (address, int(port or 8080))
        body = json.dumps({"code": str(code or "").strip(), "id": self.id, "name": self.name, "kind": self.kind, "group": self.group}).encode()
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=6) as r:
                j = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                return {"ok": False, "error": json.loads(e.read().decode()).get("error") or str(e)}
            except Exception:
                return {"ok": False, "error": str(e)}
        except Exception as e:
            return {"ok": False, "error": "Could not reach it (%s)." % e}
        with self.lock:
            self.group = j["group"]
            self.known[j["id"]] = j.get("name", "")
            p = self.peers.setdefault(j["id"], {"address": address, "port": int(port or 8080)})
            p.update({"name": j.get("name", ""), "group": self.group["id"], "kind": j.get("kind"), "seen": time.time()})
            self.save_state()
        self.wake.set()
        self.emit_status()
        return {"ok": True, "name": j.get("name", "")}

    def unlink(self):
        with self.lock:
            self.group = None
            self.save_state()
        self.emit_status()
        return {"ok": True}

    def rename(self, name):
        with self.lock:
            self.name = str(name or "").strip()[:60] or self.name
            self.save_state()
        self.emit_status()

    # ----- status for the app -------------------------------------------------------------
    def status(self):
        now = time.time()
        with self.lock:
            peers = []
            for pid, p in self.peers.items():
                online = p.get("static") or now - p.get("seen", 0) < 15
                peers.append({"id": pid, "name": p.get("name", ""), "address": p.get("address"), "port": p.get("port"), "kind": p.get("kind"), "online": bool(online),
                              "linked": bool(self.group and p.get("group") == self.group["id"]), "lastSync": p.get("lastSync"), "error": p.get("error"), "runsTracks": bool(p.get("tracks"))})
            return {"type": "sync", "event": "status", "id": self.id, "name": self.name, "kind": self.kind, "linked": bool(self.group), "stems": self.stems_mode,
                    "current": self.current, "runsTracks": self.runs_tracks(), "tracksHost": self.tracks_host(), "keptOnlyHere": self.activity.get("kept", 0),
                    "peers": sorted(peers, key=lambda x: (not x["linked"], x["name"].lower())), "activity": dict(self.activity),
                    "songs": sum(1 for r in self.songs.values() if not r.get("deleted")), "setlists": sum(1 for r in self.setlists.values() if not r.get("deleted"))}

    def emit_status(self):
        self.driver.emit(self.status())

    # ----- finding the others ---------------------------------------------------------------
    def poke_peers(self):
        def go():
            for p in list(self.peers.values()):
                if self.group and p.get("group") == self.group["id"]:
                    try:
                        path = "/api/sync/poke"
                        req = urllib.request.Request("http://%s:%d%s" % (p["address"], p["port"], path), data=b"{}", headers=dict(self.sign(path), **{"Content-Type": "application/json"}), method="POST")
                        urllib.request.urlopen(req, timeout=2).close()
                    except Exception:
                        pass
        threading.Thread(target=go, daemon=True).start()

    def beacon(self):
        return json.dumps({"cc": "central-control", "id": self.id, "name": self.name, "kind": self.kind, "port": int(self.driver.config["lan_port"]),
                           "group": self.group["id"] if self.group else None, "v": APP_VERSION,
                           "tracks": self.runs_tracks(), "ws": int(self.driver.config.get("lan_ws_port") or 8081)}).encode()

    def udp_loop(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):
                try:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except OSError:
                    pass
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.bind(("", int(self.driver.config.get("sync_udp_port") or SYNC_PORT)))
            sock.settimeout(1.0)
        except OSError as e:
            log.warning("sync: no UDP beacon (%s)", e)
            return
        last = checked = 0
        while not self.stopping:
            if time.time() - checked > 2:
                checked = time.time()
                self.host_check()
            if time.time() - last > 4:
                last = time.time()
                for target in ("255.255.255.255", "127.255.255.255"):
                    try:
                        sock.sendto(self.beacon(), (target, int(self.driver.config.get("sync_udp_port") or SYNC_PORT)))
                    except OSError:
                        pass
            try:
                data, addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                time.sleep(1)
                continue
            try:
                j = json.loads(data.decode())
            except Exception:
                continue
            if j.get("cc") != "central-control" or not j.get("id") or j["id"] == self.id:
                continue
            with self.lock:
                p = self.peers.setdefault(j["id"], {})
                fresh = not p.get("seen")
                p.update({"name": str(j.get("name") or "")[:60], "address": addr[0], "port": int(j.get("port") or 8080), "group": j.get("group"), "kind": j.get("kind"), "seen": time.time(), "version": j.get("v"),
                          "tracks": bool(j.get("tracks")), "ws": int(j.get("ws") or 8081)})
                if j.get("name"):
                    self.known[j["id"]] = str(j["name"])[:60]
            if fresh:
                self.emit_status()
                self.wake.set()

    def start(self):
        if self.driver.config.get("sync_udp", True):
            threading.Thread(target=self.udp_loop, daemon=True, name="sync-udp").start()
        threading.Thread(target=self.pull_loop, daemon=True, name="sync-pull").start()

    # ----- pulling from the others ---------------------------------------------------------
    def fetch(self, peer, path, raw=False, timeout=8):
        req = urllib.request.Request("http://%s:%d%s" % (peer["address"], peer["port"], path), headers=self.sign(path.split("?")[0]))
        r = urllib.request.urlopen(req, timeout=timeout)
        if raw:
            return r
        with r:
            return json.loads(r.read().decode())

    def pull_loop(self):
        while not self.stopping:
            self.wake.wait(float(self.driver.config.get("sync_interval") or 8))
            self.wake.clear()
            if not self.group:
                continue
            for pid, peer in list(self.peers.items()):
                if peer.get("static") and not peer.get("group"):
                    peer["group"] = self.group["id"]
                if peer.get("group") != self.group["id"]:
                    continue
                if not peer.get("static") and time.time() - peer.get("seen", 0) > 30:
                    continue
                try:
                    self.pull(peer)
                    peer["lastSync"] = int(time.time() * 1000)
                    peer["error"] = None
                except Exception as e:
                    peer["error"] = str(e)[:200]
                    log.info("sync from %s failed: %s", peer.get("name"), e)
            self.fill_missing()
            self.host_check()
            self.emit_status()

    def pull(self, peer):
        idx = self.fetch(peer, "/api/sync/index")
        if idx.get("id") and peer.get("static"):
            peer["name"] = idx.get("name") or peer["name"]
            peer["kind"] = idx.get("kind")
        host = idx.get("host") if isinstance(idx.get("host"), dict) else {}
        peer["tracks"] = bool(host.get("tracks"))
        if host.get("wsPort"):
            peer["ws"] = int(host["wsPort"])
        peer["songIds"] = set(k for k, v in (idx.get("songs") or {}).items() if not (isinstance(v, list) and len(v) > 3 and v[3]))
        with self.lock:
            for did, nm in (idx.get("names") or {}).items():
                if did != self.id and nm:
                    self.known[did] = nm
        # setlists first: on a Pi they decide which stems come over
        for slid, ver in (idx.get("setlists") or {}).items():
            mine = self.setlists.get(slid)
            if _newer(ver, mine and [mine.get("rev", 0), mine.get("ts", 0), mine.get("by", "")]):
                rec = self.fetch(peer, "/api/sync/setlist/" + urllib.parse.quote(slid))
                if rec and rec.get("id") == slid:
                    with self.lock:
                        self.clock = max(self.clock, int(rec.get("rev") or 0))
                        rec.pop("assets", None)
                        self._save("setlists", rec)
                    self.driver.emit({"type": "sync", "event": "setlist", "setlist": None if rec.get("deleted") else dict(rec["setlist"], id=slid), "id": slid, "deleted": bool(rec.get("deleted"))})
        wanted = self.wanted_ids() or set()
        for sid, ver in (idx.get("songs") or {}).items():
            mine = self.songs.get(sid)
            if not _newer(ver, mine and [mine.get("rev", 0), mine.get("ts", 0), mine.get("by", "")]):
                continue
            rec = self.fetch(peer, "/api/sync/song/" + urllib.parse.quote(sid))
            if not rec or rec.get("id") != sid:
                continue
            if rec.get("deleted"):
                with self.lock:
                    if mine:
                        self.drop_files(mine.get("song") or {})
                    self.clock = max(self.clock, int(rec.get("rev") or 0))
                    rec.pop("assets", None)
                    self._save("songs", rec)
                self.driver.emit({"type": "sync", "event": "removed", "id": sid})
                continue
            stems = self.stems_mode == "all" or sid in wanted
            if sid in self.hidden:
                stems = False
            missing = self.download(peer, rec.get("assets") or [], stems)
            assets = rec.pop("assets", None)
            with self.lock:
                self.clock = max(self.clock, int(rec.get("rev") or 0))
                rec["missing"] = missing
                rec["hash"] = hashlib.sha1(json.dumps(rec.get("song") or {}, sort_keys=True).encode()).hexdigest()
                self._save("songs", rec)
            if sid not in self.hidden:
                self.driver.emit({"type": "sync", "event": "song", "song": self.localized(rec["song"]), "missing": len(missing)})

    def download(self, peer, assets, stems=True):
        """Brings a song's files over (only what is new or different). Returns the keys left out."""
        missing = []
        for a in assets:
            key = a.get("key")
            path = self.path_for(key)
            if not path:
                continue
            if key.startswith("library/") and not stems:
                if not (os.path.isfile(path) and os.path.getsize(path) == a.get("size")):
                    missing.append(key)
                continue
            have = self.meta(key)
            if have and have["sha1"] == a.get("sha1"):
                continue
            free = shutil.disk_usage(self.data_root).free
            if free - int(a.get("size") or 0) < int(self.driver.config.get("sync_reserve_mb") or 800) * 1048576:
                self.activity["warning"] = "This device is nearly full - some stems were not copied. Remove songs here (Song library → Delete on this device)."
                missing.append(key)
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            part = path + ".sync-part"
            self.activity.update({"busy": True, "file": key.split("/")[-1]})
            self.emit_status()
            h = hashlib.sha1()
            try:
                with self.fetch(peer, "/api/sync/file?key=" + urllib.parse.quote(key), raw=True, timeout=30) as r, open(part, "wb") as out:
                    for chunk in iter(lambda: r.read(1 << 20), b""):
                        out.write(chunk)
                        h.update(chunk)
                if a.get("sha1") and h.hexdigest() != a["sha1"]:
                    raise IOError("checksum mismatch")
                os.replace(part, path)
                self.activity["done"] += 1
            except Exception as e:
                missing.append(key)
                log.info("sync: %s not copied (%s)", key, e)
                try:
                    os.remove(part)
                except OSError:
                    pass
            finally:
                self.activity.update({"busy": False, "file": None})
        return missing

    def fill_missing(self):
        """A song that joined a setlist on a Pi gets its stems now."""
        if not self.group:
            return
        wanted = self.wanted_ids()
        for sid, rec in list(self.songs.items()):
            if not rec.get("missing") or rec.get("deleted") or sid in self.hidden:
                continue
            if wanted is not None and sid not in wanted:
                continue
            for peer in list(self.peers.values()):
                if peer.get("group") != self.group["id"]:
                    continue
                try:
                    theirs = self.fetch(peer, "/api/sync/song/" + urllib.parse.quote(sid))
                except Exception:
                    continue
                if not theirs or theirs.get("deleted"):
                    continue
                left = self.download(peer, [a for a in theirs.get("assets") or [] if a.get("key") in rec["missing"]], True)
                with self.lock:
                    rec["missing"] = left
                    self._save("songs", rec)
                if not left:
                    self.driver.emit({"type": "sync", "event": "song", "song": self.localized(rec["song"]), "missing": 0})
                    break


CU_ROLES = ("main", "admin", "user1", "user2")
CU_ADMIN_TIER = ("main", "admin")
CU_JOBS = ("general", "lighting", "production", "mix", "inears", "slides")


def _salted(secret, salt):
    return hashlib.sha256((salt + ":" + str(secret)).encode()).hexdigest()


class CuRoles:
    """Who is who among the Central Control computers: one main admin, any number of admins and users.

    The main admin chooses that role on its first launch and sends a secret token (so no one else can
    pretend to be it), its 4-digit PIN and a pairing code. A new computer joins with the pairing code.
    Users switch between User 1 and User 2 themselves; going between the user and the admin side
    needs the main admin's PIN, or the main admin changes it from its own People list. Kept in
    /data/pad-pedal/cu-roles.json so it survives restarts and is in the backup."""

    LOCK_AFTER = 5
    LOCK_SECONDS = 60

    def __init__(self, driver, path):
        self.driver = driver
        self.path = path
        j = read_json(path, {})
        self.main = j.get("main") if isinstance(j.get("main"), dict) else None
        self.devices = j.get("devices") if isinstance(j.get("devices"), dict) else {}
        lk = j.get("lock") if isinstance(j.get("lock"), dict) else {}
        self.lock = {"all": bool(lk.get("all")), "devices": {k: True for k, v in (lk.get("devices") or {}).items() if v}}   # the main admin's service lock
        self.fails = {}     # device id -> [count, locked until]
        self.health = {}    # device id -> {..., "at": ms} (what each computer reports every few seconds)
        self._push_at = 0.0

    def save(self):
        write_json(self.path, {"main": self.main, "devices": self.devices, "lock": self.lock})

    def is_locked(self, did):
        """The service lock: on every computer but the main admin (all), or on chosen ones."""
        if self.main and did == self.main.get("id"):
            return False
        return bool(self.lock.get("all") or self.lock["devices"].get(did))

    # ----- who is connected -------------------------------------------------
    def sockets(self, device_id=None):
        out = []
        for ws, info in list(self.driver.lan_clients.items()):
            if info.get("cuId") and (device_id is None or info.get("cuId") == device_id):
                out.append(ws)
        return out

    def online(self, device_id):
        return bool(self.sockets(device_id))

    def is_main(self, ws):
        info = self.driver.lan_clients.get(ws) or {}
        return bool(self.main and info.get("cuId") == self.main.get("id") and info.get("cuMain"))

    def role_of(self, ws):
        info = self.driver.lan_clients.get(ws) or {}
        d = self.devices.get(info.get("cuId") or "")
        return d.get("role") if d else None

    def admin_ok(self, ws):
        """Slides and the audio host are admin jobs - once there is a main admin."""
        if not self.main:
            return True
        info = self.driver.lan_clients.get(ws) or {}
        if not info.get("cuId"):
            return True        # not a Central Control (a phone page, an older app)
        return self.role_of(ws) in CU_ADMIN_TIER

    def claimants(self):
        """Every device that says it is the main admin; the registered one first."""
        out = []
        if self.main:
            out.append({"id": self.main["id"], "name": self.main.get("name", ""), "registered": True, "online": self.online(self.main["id"])})
        for did, d in self.devices.items():
            if d.get("claimsMain") and (not self.main or did != self.main["id"]):
                out.append({"id": did, "name": d.get("name", ""), "registered": False, "online": self.online(did)})
        return out

    # ----- views ------------------------------------------------------------
    def device_view(self, did):
        d = self.devices.get(did) or {}
        h = self.health.get(did)
        if h and time.time() * 1000 - h.get("at", 0) > 20000:
            h = None
        return {"id": did, "name": d.get("name", ""), "role": d.get("role"), "jobs": d.get("jobs") or ["general"], "paired": bool(d.get("paired")), "online": self.online(did),
                "lastSeen": d.get("lastSeen", 0), "claimsMain": bool(d.get("claimsMain")), "locked": self.is_locked(did), "wantsAdmin": bool(d.get("wantsAdmin")), "health": h}

    def view_for(self, ws):
        info = self.driver.lan_clients.get(ws) or {}
        did = info.get("cuId")
        mains = self.claimants()
        v = {"type": "cuRoles", "hasMain": bool(self.main), "mainName": self.main.get("name", "") if self.main else "",
             "conflict": [m for m in mains] if len(mains) > 1 else [], "you": self.device_view(did) if did else None,
             "youAreMain": self.is_main(ws), "lockAll": bool(self.lock.get("all"))}
        if v["youAreMain"]:
            v["devices"] = sorted((self.device_view(k) for k in self.devices if k != did), key=lambda x: (not x["online"], x["name"].lower()))
            v["pairPin"] = self.driver.code        # the network's pairing PIN (the main admin shows it and can change it)
            v["pedal"] = self.driver.pedal_health()
        codes = self.driver.audio_host_codes()
        if did and codes:
            role = (self.devices.get(did) or {}).get("role")
            if role in CU_ADMIN_TIER:
                v["hostCodes"] = {"admin": codes.get("adminCode"), "user": codes.get("userCode")}
            elif role in ("user1", "user2"):
                v["hostCodes"] = {"user": codes.get("userCode")}
        return v

    def push_soon(self):
        """Health reports come every few seconds from every computer: the main admin's view at most twice a second."""
        now = time.time()
        if now - self._push_at < 0.5:
            return
        self._push_at = now
        for ws in self.sockets():
            if self.is_main(ws):
                self.driver.send_to(ws, self.view_for(ws))

    def push(self, only=None):
        for ws in self.sockets():
            info = self.driver.lan_clients.get(ws) or {}
            if only and info.get("cuId") not in only and not self.is_main(ws):
                continue
            self.driver.send_to(ws, self.view_for(ws))

    # ----- messages ---------------------------------------------------------
    def locked(self, did):
        c = self.fails.get(did)
        return bool(c and c[1] > time.time())

    def wrong(self, did):
        c = self.fails.setdefault(did, [0, 0])
        c[0] += 1
        if c[0] >= self.LOCK_AFTER:
            c[0] = 0
            c[1] = time.time() + self.LOCK_SECONDS

    def handle(self, ws, m):
        """One {type: "cuRole", action: ...} message from a Central Control computer; returns the reply."""
        info = self.driver.lan_clients.setdefault(ws, {"auth": False, "app": None})
        action = m.get("action")
        did = re.sub(r"[^A-Za-z0-9_-]", "", str(m.get("id") or info.get("cuId") or ""))[:48]
        if not did:
            return {"type": "cuRoleReply", "ok": False, "error": "This computer has no id."}
        name = str(m.get("name") or "").strip()[:40]
        now = int(time.time() * 1000)

        if action in ("hello", "join"):
            info["cuId"] = did
            info["app"] = "central-usage"
            d = self.devices.get(did)
            claim = m.get("role") if m.get("role") in CU_ROLES else None
            if action == "join":
                # every device pairs with the one 4-digit pairing PIN the main admin picked (it is also the pedal's)
                if self.locked(did):
                    return {"type": "cuRoleReply", "ok": False, "action": "join", "error": "Too many wrong PINs - wait a minute."}
                if not self.driver.code_ok(m.get("pair") or m.get("code")):
                    self.wrong(did)
                    return {"type": "cuRoleReply", "ok": False, "action": "join", "error": "That pairing PIN is not right. It is the 4 digits the main admin picked (main admin → Settings → This computer)."}
                want = claim if claim in ("admin", "user1", "user2") else "user1"
                d = self.devices.setdefault(did, {})
                pending = False
                if want == "admin" and self.main and d.get("role") != "admin":
                    pin_ok = bool(self.main.get("pinHash")) and _salted(str(m.get("pin") or "").strip(), self.main.get("pinSalt", "")) == self.main["pinHash"]
                    if not pin_ok:
                        want, pending = "user1", True      # the main admin allows it (Devices tab), or the computer types the role PIN later
                d.update({"name": name or d.get("name") or "Central Control", "role": want, "paired": True, "lastSeen": now})
                if pending:
                    d["wantsAdmin"] = True
                else:
                    d.pop("wantsAdmin", None)
                d.pop("claimsMain", None)
                info["auth"] = True
                self.fails.pop(did, None)
                self.save()
                self.push()
                return {"type": "cuRoleReply", "ok": True, "action": "join", "role": d["role"], "pending": pending, "code": self.driver.code}

            # hello: a computer says who it is and what role it has
            if claim == "main":
                token = str(m.get("token") or "")
                if not self.main:
                    if len(token) < 16:
                        return {"type": "cuRoleReply", "ok": False, "action": "hello", "error": "missing token"}
                    pair = str(m.get("pair") or "").strip()
                    if not self.driver.code_chosen() and re.match(r"^\d{4}$", pair) and pair != str(m.get("pin") or ""):
                        # the pedal has no pairing PIN yet: the main admin's becomes the network's
                        res = self.driver.set_code(pair)
                        if not res.get("ok"):
                            return {"type": "cuRoleReply", "ok": False, "action": "hello", "error": res.get("error")}
                        info["auth"] = True
                    if not (info.get("auth") or self.driver.code_ok(pair) or self.driver.code_ok(m.get("code"))):
                        return {"type": "cuRoleReply", "ok": False, "action": "hello", "needCode": True, "error": "This Central Pedal already has a pairing PIN. Type that PIN (on the pedal: Settings → Wi-Fi & devices) - it becomes your pairing PIN."}
                    salt = secrets.token_hex(8)
                    self.main = {"id": did, "name": name or "Main admin", "tokenSalt": salt, "tokenHash": _salted(token, salt), "since": now}
                if self.main["id"] == did and _salted(token, self.main.get("tokenSalt", "")) == self.main.get("tokenHash"):
                    info["cuMain"] = True
                    self.main["name"] = name or self.main.get("name", "")
                    for key, secret in (("pin", m.get("pin")),):
                        if secret is not None and re.match(r"^\d{4}$", str(secret)):
                            salt = secrets.token_hex(8)
                            self.main[key + "Salt"] = salt
                            self.main[key + "Hash"] = _salted(str(secret), salt)
                    d = self.devices.setdefault(did, {})
                    d.update({"name": self.main["name"], "role": "main", "paired": True, "lastSeen": now})
                    d.pop("claimsMain", None)
                    info["auth"] = True
                else:
                    # a second computer that thinks it is the main admin: it works as an admin until one of them forgets the role
                    d = self.devices.setdefault(did, {})
                    d.update({"name": name or d.get("name") or "Central Control", "role": "admin", "claimsMain": True, "lastSeen": now})
            else:
                if not d:
                    # first time the Central Pedal sees this computer: once there is a main admin, a new one starts as a user
                    role = claim or "user1"
                    if self.main and role in CU_ADMIN_TIER:
                        role = "user1"
                    d = self.devices.setdefault(did, {"role": role, "paired": False})
                if not self.main and claim in ("admin", "user1", "user2"):
                    d["role"] = claim       # no main admin yet: every computer chooses its own role
                if d.get("role") == "main" and (not self.main or self.main["id"] != did):
                    d["role"] = "admin"     # it forgot being the main admin elsewhere
                d.pop("claimsMain", None)
                d["name"] = name or d.get("name") or "Central Control"
                d["lastSeen"] = now
            self.save()
            self.push()
            return None

        if did != info.get("cuId"):
            return {"type": "cuRoleReply", "ok": False, "action": action, "error": "Say hello first."}
        d = self.devices.get(did)
        if not d:
            return {"type": "cuRoleReply", "ok": False, "action": action, "error": "This computer is not known yet."}

        if action == "set":   # this computer changes its own role
            want = m.get("role")
            if want not in ("admin", "user1", "user2"):
                return {"type": "cuRoleReply", "ok": False, "action": "set", "error": "Pick Admin, User 1 or User 2."}
            have = d.get("role")
            if have == "main":
                return {"type": "cuRoleReply", "ok": False, "action": "set", "error": "The main admin stays the main admin. To give it up use Forget role."}
            same_side = (have in ("user1", "user2") and want in ("user1", "user2")) or (have == want)
            if not same_side and self.main:
                if self.locked(did):
                    return {"type": "cuRoleReply", "ok": False, "action": "set", "error": "Too many wrong PINs - wait a minute."}
                if want == "admin" and m.get("ask"):
                    d["wantsAdmin"] = True
                    self.save()
                    self.push()
                    return {"type": "cuRoleReply", "ok": True, "action": "set", "role": have, "pending": True}
                if not self.main.get("pinHash") or _salted(str(m.get("pin") or "").strip(), self.main.get("pinSalt", "")) != self.main["pinHash"]:
                    self.wrong(did)
                    return {"type": "cuRoleReply", "ok": False, "action": "set", "error": "Wrong PIN. The main admin's role PIN is in its Settings."}
            d["role"] = want
            d.pop("claimsMain", None)
            self.fails.pop(did, None)
            self.save()
            self.push()
            return {"type": "cuRoleReply", "ok": True, "action": "set", "role": want}

        if action == "forget":   # this computer gives up its role (back to the first-launch choice)
            if self.main and self.main["id"] == did:
                if _salted(str(m.get("token") or ""), self.main.get("tokenSalt", "")) != self.main.get("tokenHash"):
                    return {"type": "cuRoleReply", "ok": False, "action": "forget", "error": "Only the main admin itself can give up the role."}
                self.main = None
                info.pop("cuMain", None)
            self.devices.pop(did, None)
            self.save()
            self.push()
            return {"type": "cuRoleReply", "ok": True, "action": "forget"}

        if action == "health":   # how this computer is doing (every few seconds), for the main admin's Devices tab
            h = m.get("health") if isinstance(m.get("health"), dict) else {}
            keep = {}
            for k, v in h.items():
                if isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) < 60):
                    keep[str(k)[:20]] = v
                if len(keep) >= 16:
                    break
            keep["at"] = now
            self.health[did] = keep
            self.push_soon()
            return None

        if action == "myJobs":   # the main admin's own job(s): everything (production manager), or e.g. lighting when it has no cameras
            if not self.is_main(ws):
                return {"type": "cuRoleReply", "ok": False, "action": action, "error": "Only the main admin."}
            jobs = [j for j in (m.get("jobs") or []) if j in CU_JOBS]
            d["jobs"] = ["general"] if not jobs or "general" in jobs else jobs
            self.save()
            self.push()
            return {"type": "cuRoleReply", "ok": True, "action": action, "jobs": d["jobs"]}

        if action == "setPair":   # the main admin changes the network's pairing PIN; computers online now get it, the rest ask
            if not self.is_main(ws):
                return {"type": "cuRoleReply", "ok": False, "action": action, "error": "Only the main admin."}
            res = self.driver.set_code(m.get("pair"))
            if not res.get("ok"):
                return {"type": "cuRoleReply", "ok": False, "action": action, "error": res.get("error")}
            self.push()
            return {"type": "cuRoleReply", "ok": True, "action": action, "pair": res["code"]}

        if action == "lock":   # the main admin's service lock: everyone (target "all") or one computer
            if not self.is_main(ws):
                return {"type": "cuRoleReply", "ok": False, "action": action, "error": "Only the main admin locks."}
            on = bool(m.get("on"))
            target = re.sub(r"[^A-Za-z0-9_-]", "", str(m.get("target") or "all"))[:48]
            if target == "all":
                self.lock["all"] = on
                if not on:
                    self.lock["devices"] = {}
            elif target in self.devices:
                if on:
                    self.lock["devices"][target] = True
                else:
                    self.lock["devices"].pop(target, None)
            else:
                return {"type": "cuRoleReply", "ok": False, "action": action, "error": "No such computer."}
            self.save()
            self.push()
            return {"type": "cuRoleReply", "ok": True, "action": action}

        if action in ("assign", "rename", "remove", "jobs", "approve"):   # the main admin, from its Devices tab
            if not self.is_main(ws):
                return {"type": "cuRoleReply", "ok": False, "action": action, "error": "Only the main admin changes other computers."}
            target = re.sub(r"[^A-Za-z0-9_-]", "", str(m.get("target") or ""))[:48]
            t = self.devices.get(target)
            if not t or target == did:
                return {"type": "cuRoleReply", "ok": False, "action": action, "error": "No such computer."}
            if action == "approve":   # a computer set up as an admin waits for this
                want = "admin" if m.get("allow") else "user1"
                t["role"] = want
                t.pop("wantsAdmin", None)
                for tw in self.sockets(target):
                    self.driver.send_to(tw, {"type": "cuRoleAssigned", "role": want, "by": self.main.get("name", ""), "approved": bool(m.get("allow"))})
            elif action == "assign":
                want = m.get("role")
                if want not in ("admin", "user1", "user2"):
                    return {"type": "cuRoleReply", "ok": False, "action": action, "error": "Pick Admin, User 1 or User 2."}
                t["role"] = want
                t.pop("claimsMain", None)
                t.pop("wantsAdmin", None)
                for tw in self.sockets(target):
                    self.driver.send_to(tw, {"type": "cuRoleAssigned", "role": want, "by": self.main.get("name", "")})
            elif action == "jobs":   # an admin's jobs: any of lighting / production / mix / in-ears / slides, or general (everything)
                jobs = [j for j in (m.get("jobs") or []) if j in CU_JOBS]
                t["jobs"] = ["general"] if not jobs or "general" in jobs else jobs
                for tw in self.sockets(target):
                    self.driver.send_to(tw, {"type": "cuRoleAssigned", "role": t.get("role"), "jobs": t["jobs"], "by": self.main.get("name", "")})
            elif action == "rename":
                t["name"] = str(m.get("newName") or "").strip()[:40] or t.get("name", "")
                for tw in self.sockets(target):
                    self.driver.send_to(tw, {"type": "cuRoleAssigned", "name": t["name"], "role": t.get("role"), "by": self.main.get("name", "")})
            else:
                self.devices.pop(target, None)
                for tw in self.sockets(target):
                    self.driver.send_to(tw, {"type": "cuRoleAssigned", "role": None, "removed": True, "by": self.main.get("name", "")})
            self.save()
            self.push()
            return {"type": "cuRoleReply", "ok": True, "action": action}

        return {"type": "cuRoleReply", "ok": False, "action": action, "error": "Unknown action."}

    def gone(self, ws):
        info = self.driver.lan_clients.get(ws) or {}
        if info.get("cuId"):
            d = self.devices.get(info["cuId"])
            if d:
                d["lastSeen"] = int(time.time() * 1000)
                self.save()


SERVICE_ROLES = ("lighting", "production", "slides", "lyrics", "mix", "inears", "band")
SERVICE_KINDS = ("song", "prayer", "welcome", "announcements", "offering", "sermon", "communion", "video", "other")


def first_usb(media_roots):
    """The first writable USB stick / SD card under /media (None when there is none)."""
    for root in media_roots or []:
        if os.path.basename(root) == "media" and os.path.isdir(root):
            for d in sorted(os.listdir(root)):
                full = os.path.join(root, d)
                if os.path.isdir(full) and (os.path.ismount(full) or d.startswith("usb-")) and os.access(full, os.W_OK):
                    return full
    if sys.platform == "darwin" and os.path.isdir("/Volumes"):   # (Central Pedal Control on a Mac: a stick shows up in /Volumes)
        for d in sorted(os.listdir("/Volumes")):
            full = os.path.join("/Volumes", d)
            if os.path.ismount(full) and os.path.realpath(full) != "/" and not d.startswith(".") and d not in ("Macintosh HD", "Recovery", "Preboot", "VM", "Data") and os.access(full, os.W_OK):
                return full
    return None


def library_store(driver):
    """The sound libraries installed here (libraries.py), into this device's instrument sounds."""
    st = getattr(driver, "_library_store", None)
    if sound_libraries and (st is None or st.instrument is not driver.instrument):
        st = sound_libraries.LibraryStore(driver.config["data_root"], driver.instrument)
        driver._library_store = st
        driver._library_jobs = getattr(driver, "_library_jobs", {})
    return st


def library_state(driver):
    st = library_store(driver)
    if not st:
        return {"available": False, "installed": [], "jobs": {}}
    jobs = {}
    for lib_id, job in list(getattr(driver, "_library_jobs", {}).items()):
        j = dict(job)
        j.update(st.progress.get(lib_id) or {})
        jobs[lib_id] = j
    return {"available": True, "installed": st.listing(), "jobs": jobs}


def library_installed(driver, rec):
    """After an install or a removal: the Instrument page's sounds and IRs refresh themselves."""
    try:
        if driver.instrument:
            driver.emit(driver.instrument.status())
        driver.emit({"type": "libraries", "installed": library_store(driver).listing()})
    except Exception:  # noqa: BLE001
        pass


def library_install_async(driver, payload):
    """Downloads and installs a library from the website's list in the background (GET /libraries shows how it goes)."""
    st = library_store(driver)
    lib_id = str(payload.get("id") or "")
    if not st or not re.match(r"^[a-z0-9-]{3,60}$", lib_id):
        raise ValueError("no such library")
    jobs = driver._library_jobs
    if (jobs.get(lib_id) or {}).get("state") in ("downloading", "installing"):
        return {"ok": True, "started": False, "busy": True}
    jobs[lib_id] = {"state": "downloading", "done": 0, "total": int(payload.get("size") or 0), "error": None}

    def run():
        try:
            rec = st.install_url(str(payload.get("url") or ""), str(payload.get("sha256") or ""), lib_id, int(payload.get("size") or 0))
            jobs[lib_id] = {"state": "done", "version": rec["version"], "counts": rec.get("counts"), "error": None}
            library_installed(driver, rec)
        except Exception as error:  # noqa: BLE001
            jobs[lib_id] = {"state": "failed", "error": str(error)}
    threading.Thread(target=run, daemon=True, name="library-" + lib_id).start()
    return {"ok": True, "started": True}


def local_origin_ok(headers):
    """Requests that change things on the local API (127.0.0.1:8766) must come from the app itself - not from
    some other web page open in a browser on this computer (the API answers CORS for the app's own pages)."""
    origin = (headers.get("Origin") or "").strip()
    return origin in ("", "http://127.0.0.1:8766", "http://localhost:8766")


class PracticeMixes:
    """Practice mixes: the app renders a mix of each song for each musician (their part up, the click, the
    guide, slower...) and hands the WAVs here. They are kept in <data>/practice/<folder>/, turned into MP3s
    when ffmpeg is there and that was asked for, copied onto a USB stick if wanted, and listed for phones on
    the companion page (http://<pedal>.local:8080/practice/) - open to anyone on the network, only with the
    pairing code, or not at all (a setting)."""

    SHARES = ("open", "code", "off")

    def __init__(self, driver):
        self.driver = driver
        self.root = os.path.join(driver.config["data_root"], "practice")
        os.makedirs(self.root, exist_ok=True)
        self.settings_path = os.path.join(self.root, "settings.json")
        self.settings = read_json(self.settings_path, {}) or {}
        if self.settings.get("share") not in self.SHARES:
            self.settings["share"] = "open"
        if not re.match(r"^[A-Za-z0-9]{4,12}$", str(self.settings.get("code") or "")):
            self.settings["code"] = "%06d" % random.SystemRandom().randrange(1000000)   # the band's own code (not the pairing PIN)
            write_json(self.settings_path, self.settings)
        self.fails = {}

    def share(self):
        return self.settings.get("share", "open")

    def configure(self, patch):
        if isinstance(patch, dict):
            if patch.get("share") in self.SHARES:
                self.settings["share"] = patch["share"]
            if "title" in patch:
                self.settings["title"] = str(patch.get("title") or "")[:80]
            if re.match(r"^[A-Za-z0-9]{4,12}$", str(patch.get("code") or "")):
                self.settings["code"] = str(patch["code"])
            write_json(self.settings_path, self.settings)
        return self.caps()

    def caps(self):
        return {"ffmpeg": shutil.which("ffmpeg") is not None, "usb": first_usb(self.driver.config.get("media_roots")) is not None,
                "share": self.share(), "title": self.settings.get("title") or "", "code": self.settings.get("code"), "lanPort": self.driver.config.get("lan_port"),
                "folderCopy": PEDAL_CONTROL, "hostname": socket.gethostname()}

    def _dir(self, folder):
        folder = safe_name(folder or "Practice")
        d = os.path.realpath(os.path.join(self.root, folder))
        if os.path.dirname(d) != os.path.realpath(self.root):
            raise ValueError("bad folder name")
        return folder, d

    def path(self, folder, name):
        folder, d = self._dir(folder)
        p = os.path.realpath(os.path.join(d, safe_name(name)))
        return p if p.startswith(os.path.realpath(self.root) + os.sep) and os.path.isfile(p) else None

    def save(self, folder, name, data, fmt="wav", kbps=192, usb=False):
        if not data:
            raise ValueError("empty file")
        folder, d = self._dir(folder)
        os.makedirs(d, exist_ok=True)
        name = safe_name(name)
        path = os.path.join(d, name)
        with open(path + ".part", "wb") as handle:
            handle.write(data)
        os.replace(path + ".part", path)
        note = ""
        if fmt == "mp3" and name.lower().endswith(".wav"):
            ff = shutil.which("ffmpeg")
            if ff:
                mp3 = path[:-4] + ".mp3"
                kbps = max(64, min(320, int(kbps or 192)))
                try:
                    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", path, "-codec:a", "libmp3lame", "-b:a", "%dk" % kbps, mp3],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=900)
                    if r.returncode == 0 and os.path.isfile(mp3):
                        os.remove(path)
                        path = mp3
                    else:
                        note = "MP3 failed (" + (r.stderr or b"").decode(errors="replace").strip()[-160:] + ") - kept the WAV"
                except Exception as error:
                    note = "MP3 failed (%s) - kept the WAV" % error
            else:
                note = "no ffmpeg on this computer - kept the WAV"
        reply = {"ok": True, "folder": folder, "name": os.path.basename(path), "size": os.path.getsize(path), "format": path.rsplit(".", 1)[-1].lower()}
        if note:
            reply["note"] = note
        if usb:
            reply.update(self.to_usb(folder, os.path.basename(path)))
        return reply

    def to_usb(self, folder, name=None):
        stick = first_usb(self.driver.config.get("media_roots"))
        if not stick:
            return {"usb": None, "usbError": "no USB stick or SD card found"}
        folder, d = self._dir(folder)
        target = os.path.join(stick, "Central Control", "Practice", folder)
        os.makedirs(target, exist_ok=True)
        names = [safe_name(name)] if name else [f for f in sorted(os.listdir(d)) if os.path.isfile(os.path.join(d, f))]
        for n in names:
            if os.path.isfile(os.path.join(d, n)):
                shutil.copyfile(os.path.join(d, n), os.path.join(target, n))
        return {"usb": target, "copied": len(names)}

    def copy_to(self, folder, dest):
        """Central Pedal Control: copy a folder of mixes into a folder the musician picked on the Mac."""
        if not PEDAL_CONTROL:
            raise ValueError("copying to a folder works in Central Pedal Control")
        dest = os.path.realpath(os.path.expanduser(str(dest or "")))
        if not dest or not os.path.isdir(dest) or not os.access(dest, os.W_OK):
            raise ValueError("can't write to " + str(dest))
        folder, d = self._dir(folder)
        if not os.path.isdir(d):
            raise ValueError("no such practice folder")
        target = os.path.join(dest, folder)
        os.makedirs(target, exist_ok=True)
        n = 0
        for f in sorted(os.listdir(d)):
            if os.path.isfile(os.path.join(d, f)):
                shutil.copyfile(os.path.join(d, f), os.path.join(target, f))
                n += 1
        return {"ok": True, "path": target, "copied": n}

    def delete(self, folder, name=None):
        folder, d = self._dir(folder)
        if not os.path.isdir(d):
            return {"ok": False, "error": "no such folder"}
        if name:
            p = self.path(folder, name)
            if p:
                os.remove(p)
        else:
            shutil.rmtree(d, ignore_errors=True)
        return {"ok": True, "folders": self.listing()}

    def listing(self):
        out = []
        for folder in os.listdir(self.root):
            d = os.path.join(self.root, folder)
            if not os.path.isdir(d):
                continue
            files = [{"name": f, "size": os.path.getsize(os.path.join(d, f))} for f in sorted(os.listdir(d))
                     if os.path.isfile(os.path.join(d, f)) and not f.endswith(".part")]
            out.append({"folder": folder, "files": files, "made": int(os.path.getmtime(d)), "size": sum(f["size"] for f in files)})
        out.sort(key=lambda e: -e["made"])
        return out

    def allowed(self, code, ip=""):
        share = self.share()
        if share == "open":
            return True
        if share != "code" or not code:
            return False
        now = time.time()
        recent = [t for t in self.fails.get(ip, []) if now - t < 300]
        if len(recent) >= 10:   # (10 wrong codes in 5 minutes: wait)
            self.fails[ip] = recent
            return False
        if hmac.compare_digest(str(code), str(self.settings.get("code") or "")):
            return True
        self.fails[ip] = recent + [now]
        return False

    def page(self, code="", ip=""):
        esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
        title = esc(self.settings.get("title") or "Practice mixes")
        head = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                "<title>" + title + "</title><style>body{font:16px system-ui,sans-serif;background:#08111d;color:#e8eef6;margin:0;padding:16px;max-width:760px;margin:auto}"
                "h1{font-size:22px}h2{font-size:17px;margin:22px 0 6px;color:#9fc3ff}.f{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #1d2b3d}"
                ".f span{flex:1 1 200px;word-break:break-word}audio{width:100%;max-width:340px;height:34px}a{color:#7fd0ff}.m{color:#8aa0b8;font-size:13px}"
                "input,button{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid #2b3d55;background:#122033;color:inherit}</style></head><body>")
        if self.share() == "off":
            return head + "<h1>" + title + "</h1><p>Practice mixes aren't shared from this Central Pedal.</p></body></html>"
        if not self.allowed(code, ip):
            return head + "<h1>" + title + "</h1><form><p>" + ("Wrong code - " if code else "") + "Type the practice code (the music director has it).</p><input name=code inputmode=numeric autofocus> <button>Open</button></form></body></html>"
        q = ("?code=" + urllib.parse.quote(code)) if code and self.share() == "code" else ""
        body = "<h1>" + title + "</h1>"
        folders = self.listing()
        if not folders:
            body += "<p class=m>No practice mixes yet. Make them on the Central Pedal: Tracks → 🎧 Practice mixes.</p>"
        for e in folders:
            body += "<h2>" + esc(e["folder"]) + ' <span class=m>' + time.strftime("%b %d, %Y", time.localtime(e["made"])) + "</span></h2>"
            for f in e["files"]:
                href = "/practice/" + urllib.parse.quote(e["folder"]) + "/" + urllib.parse.quote(f["name"]) + q
                audio = f["name"].lower().rsplit(".", 1)[-1] in ("mp3", "wav", "m4a")
                body += ('<div class=f><span>' + esc(f["name"]) + ' <span class=m>' + "%.1f MB" % (f["size"] / 1048576.0) + "</span></span>" +
                         ('<audio controls preload=none src="' + esc(href) + '"></audio>' if audio else "") + '<a href="' + esc(href) + '" download>Download</a></div>')
        return head + body + "</body></html>"


# ---- stemtool (begin): the stem splitter's clean-up pass, run with the splitter's own Python (written to <data>/stem-splitter/stemtool.py)
STEMTOOL = r'''
#!/usr/bin/env python3
"""Central Pedal - the stem splitter's clean-up pass (run by the driver after a split, with the splitter's own Python;
needs only numpy). It reads a job file (JSON) and:
  - makes the extra drum tracks: "perc" (what is in the drums but not in the kit pieces) and "cymbals" (hi-hat + ride +
    crash together), when asked
  - removes bleed ("sharp" 0.5..3 says how hard): every stem is re-shaped from the song itself, frame by frame, by how much of each frequency it
    owns (a Wiener mask over all the stems) - so a guitar left in the vocals goes back to the guitar, and the stems
    add up to the song again. "bleed" (0..1) says how much of that to use.
  - trims the silence at the start and the end of the song - every track by the same amount, so they stay in time
  - measures each stem (level, peak, mono or stereo, silent) and writes mono files for the ones that are mono
  - finds the drum hits (kick, snare, hi-hat, crash) for the lights: from the kit pieces when there are some, else from
    the drums by frequency band
It prints "NN%|" progress lines and, at the end, "RESULT {json}" with the files it wrote and their numbers.
    python3 stemtool.py job.json """
import json
import os
import struct
import sys

import numpy as np


def read_wav(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a WAV file: " + os.path.basename(path))
    pos, fmt, raw = 12, None, None
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            fmt = body
        elif cid == b"data":
            raw = body
        pos += 8 + size + (size & 1)
    if fmt is None or raw is None:
        raise ValueError("a WAV without fmt / data: " + os.path.basename(path))
    tag, ch, rate = struct.unpack("<HHI", fmt[:8])
    bits = struct.unpack("<H", fmt[14:16])[0]
    if tag == 0xFFFE and len(fmt) >= 26:
        tag = struct.unpack("<H", fmt[24:26])[0]
    if tag == 3 and bits == 32:
        x = np.frombuffer(raw[:len(raw) // 4 * 4], dtype="<f4").astype(np.float32)
    elif tag == 3 and bits == 64:
        x = np.frombuffer(raw[:len(raw) // 8 * 8], dtype="<f8").astype(np.float32)
    elif bits == 16:
        x = np.frombuffer(raw[:len(raw) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
    elif bits == 24:
        b = np.frombuffer(raw[:len(raw) // 3 * 3], dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        x = v.astype(np.float32) / 8388608.0
    elif bits == 32:
        x = np.frombuffer(raw[:len(raw) // 4 * 4], dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError("unsupported WAV (%d-bit, format %d): %s" % (bits, tag, os.path.basename(path)))
    n = len(x) // ch
    x = x[:n * ch].reshape(n, ch).T
    if ch == 1:
        x = np.vstack([x, x])
    return np.ascontiguousarray(x[:2]), rate


def write_wav(path, x, rate, bits):
    ch, n = x.shape
    if bits == 32:
        payload = np.clip(x, -1, 1).T.astype("<f4").tobytes()
        tag = 3
    elif bits == 24:
        v = np.clip(np.round(x.T * 8388607.0), -8388608, 8388607).astype(np.int32).reshape(-1)
        b = np.empty((len(v), 3), dtype=np.uint8)
        b[:, 0] = v & 255
        b[:, 1] = (v >> 8) & 255
        b[:, 2] = (v >> 16) & 255
        payload = b.tobytes()
        tag = 1
    else:
        bits = 16
        payload = np.clip(np.round(x.T * 32767.0), -32768, 32767).astype("<i2").tobytes()
        tag = 1
    ba = bits // 8
    head = b"RIFF" + struct.pack("<I", 36 + len(payload)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, tag, ch, rate, rate * ch * ba, ch * ba, bits)
    with open(path + ".part", "wb") as handle:
        handle.write(head + b"data" + struct.pack("<I", len(payload)) + payload)
    os.replace(path + ".part", path)


def progress(p):
    sys.stdout.write("%3d%%|\r" % max(0, min(100, int(p))))
    sys.stdout.flush()


def db(v):
    return float(20 * np.log10(max(float(v), 1e-9)))


def _debleed_block(S, R, win, N, H, sharp=1.0):
    """S (k, 2, n), R (2, n): the masked stems for this block (STFT 4096 / hop 1024, sqrt-Hann in and out)."""
    k, _, n = S.shape
    pad = N
    S = np.pad(S, ((0, 0), (0, 0), (pad, pad + N)))
    R = np.pad(R, ((0, 0), (pad, pad + N)))
    out = np.zeros_like(S)
    frames = (n + pad) // H + 1
    B = 32
    for start in range(0, frames, B):
        idx = np.arange(start, min(frames, start + B)) * H
        cols = idx[:, None] + np.arange(N)[None, :]
        for c in range(2):
            spec = np.fft.rfft(S[:, c][:, cols] * win, axis=-1)
            P = (spec.real ** 2 + spec.imag ** 2).astype(np.float32)
            if sharp != 1.0:
                P = P ** sharp
            X = np.fft.rfft(R[c][cols] * win, axis=-1)
            Y = np.fft.irfft(P / (P.sum(axis=0) + 1e-12) * X[None], n=N, axis=-1).astype(np.float32) * win
            for j in range(len(idx)):
                out[:, c, idx[j]:idx[j] + N] += Y[:, j]
    return out[:, :, pad:pad + n] / 2.0   # (sqrt-Hann squared at 75 % overlap sums to 2)


def debleed(stems, ref, amount, report, sharp=1.0):
    """Every stem re-made from the reference (the song, or all the stems together) through its share of each
    frequency in each frame: mask_i = P_i^sharp / sum(P^sharp) (sharp 1: a Wiener mask - a bleed at a quarter of the
        level ends up at 1/16; higher is stronger, with more of the "watery" sound). Done in place, in blocks of ~45 s
    (each with 4096 samples of margin on both sides, the margin before it kept from before it was changed), so a
    long song with many stems needs little more memory than the stems themselves."""
    N, H, C = 4096, 1024, 1 << 21   # (C and N multiples of H: every block has the same frame grid, so blocks join exactly)
    keys = list(stems)
    n = ref.shape[1]
    win = np.sqrt(0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)).astype(np.float32)
    kept = None   # the original of the margin before this block (the block before it has changed it)
    for a in range(0, n, C):
        b = min(n, a + C)
        lo, hi = max(0, a - N), min(n, b + N)
        S = np.stack([stems[key][:, lo:hi] for key in keys])
        if kept is not None:
            S[:, :, :a - lo] = kept
        kept = np.stack([stems[key][:, max(0, b - N):b] for key in keys]).copy()
        Y = _debleed_block(S, ref[:, lo:hi], win, N, H, sharp)
        for i, key in enumerate(keys):
            stems[key][:, a:b] = (1 - amount) * S[i, :, a - lo:a - lo + (b - a)] + amount * Y[i, :, a - lo:a - lo + (b - a)]
        del S, Y
        report(b / float(n))
    return stems


BANDS = {"kick": (35, 130), "snare": (150, 2500), "hat": (6000, 16000), "crash": (3500, 12000)}
OFFSET = 0.75   # (where in its frame a hit is found: calibrated on clicks at known times)
GAPS = {"kick": 0.09, "snare": 0.09, "hat": 0.05, "crash": 0.35}


def _fluxes(x, rate, bands):
    """Spectral flux (log magnitude, positive differences) in each band: {name: array per hop of 512}. In blocks."""
    N, H = 2048, 512
    m = x.mean(axis=0) if x.ndim > 1 else x
    frames = (len(m) - N) // H + 1
    if frames < 3:
        return {}
    win = np.hanning(N).astype(np.float32)
    freqs = np.fft.rfftfreq(N, 1.0 / rate)
    sels = {k: (freqs >= lo) & (freqs <= hi) for k, (lo, hi) in bands.items()}
    out = {k: np.zeros(frames, dtype=np.float32) for k in bands}
    prev = None
    for a in range(0, frames, 256):
        idx = np.arange(a, min(frames, a + 256)) * H
        lg = np.log1p(100.0 * np.abs(np.fft.rfft(m[idx[:, None] + np.arange(N)[None, :]] * win, axis=-1)))
        both = lg if prev is None else np.vstack([prev[None], lg])
        d = np.maximum(0.0, np.diff(both, axis=0))
        if prev is None:
            d = np.vstack([np.zeros((1, d.shape[1])), d])
        for k, sel in sels.items():
            out[k][a:a + len(d)] = d[:, sel].sum(axis=1)
        prev = lg[-1]
    return out


def _peaks(flux, rate, gap, sens):
    """Frames where the flux peaks above a moving median and a share of the loudest hits, at least <gap> s apart
    (within the gap only the stronger one stays)."""
    if not flux.any():
        return []
    H = 512
    fps = rate / float(H)
    k = max(3, int(fps * 0.4)) | 1
    if len(flux) < 4000:
        pad = np.pad(flux, (k // 2, k // 2), mode="edge")
        med = np.array([np.median(pad[i:i + k]) for i in range(len(flux))], dtype=np.float32)
    else:
        med = _running_median(flux, k)
    top = float(np.percentile(flux, 99.5))
    thr = med * 1.5 + top * 0.18 / max(0.25, sens)   # (above the local level, and a fair share of the loudest hits)
    cand = np.nonzero((flux[1:-1] > thr[1:-1]) & (flux[1:-1] >= flux[:-2]) & (flux[1:-1] > flux[2:]))[0] + 1
    out = []
    for i in cand:
        if out and (i - out[-1]) / fps < gap:
            if flux[i] > flux[out[-1]]:
                out[-1] = i
            continue
        out.append(int(i))
    return out


def _times(frames, rate):
    return [round(max(0.0, (i * 512 + OFFSET * 2048) / float(rate)), 3) for i in frames]


def onsets(x, rate, band=None, gap=0.08, sens=1.0):
    """The times (s) one part (a kick track, a snare track...) is hit."""
    fl = _fluxes(x, rate, {"b": band or (30, rate / 2.0)})
    return _times(_peaks(fl["b"], rate, gap, sens), rate) if fl else []


def _running_median(v, k):
    """A cheap moving median for long signals (median of 9 sub-block medians)."""
    step = max(1, k // 9)
    sub = np.array([np.median(v[i:i + step]) for i in range(0, len(v), step)], dtype=np.float32)
    padded = np.pad(sub, (4, 4), mode="edge")
    med = np.array([np.median(padded[i:i + 9]) for i in range(len(sub))], dtype=np.float32)
    return np.repeat(med, step)[:len(v)]


def drum_hits(stems, spec, rate, sens):
    """spec: {"kick": key, "snare": key, "hat": key, "crash": key} (the kit pieces) or {"drums": key} (the whole kit:
    a kick also rings in the snare's band and a snare in the kick's, so a kick or snare hit only counts when its own
    band is at least 80 % as strong as the other one, each measured against its own loudest hits)."""
    hits = {}
    if spec.get("drums") in stems:
        parts = ("kick", "snare", "hat")
        fl = _fluxes(stems[spec["drums"]], rate, {p: BANDS[p] for p in parts})
        if not fl:
            return {}
        norm = {p: fl[p] / (float(np.percentile(fl[p], 99.5)) + 1e-9) for p in parts}
        for p in parts:
            keep = []
            for i in _peaks(fl[p], rate, GAPS[p], sens):
                mine = norm[p][max(0, i - 1):i + 2].max()
                rival = {"kick": "snare", "snare": "kick"}.get(p)
                if not rival or mine >= 0.8 * norm[rival][max(0, i - 1):i + 2].max():
                    keep.append(i)
            hits[p] = _times(keep, rate)
        return hits
    for part in ("kick", "snare", "hat", "crash"):
        key = spec.get(part)
        if key in stems:
            hits[part] = onsets(stems[key], rate, BANDS[part] if part in ("kick", "hat") else None, GAPS[part], sens)
    return hits


def main():
    job = json.load(open(sys.argv[1]))
    out_dir = job["out"]
    os.makedirs(out_dir, exist_ok=True)
    stems, rate = {}, None
    for s in job["stems"]:
        x, r = read_wav(s["path"])
        if rate is None:
            rate = r
        if r != rate:
            raise ValueError("the stems have different sample rates (%s: %d Hz)" % (s["key"], r))
        stems[s["key"]] = x
    n = max(x.shape[1] for x in stems.values())
    for key in stems:
        if stems[key].shape[1] < n:
            stems[key] = np.pad(stems[key], ((0, 0), (0, n - stems[key].shape[1])))
    progress(5)
    hits = drum_hits(stems, job["hits"], rate, float(job.get("hitSens") or 1.0)) if isinstance(job.get("hits"), dict) else {}
    aside = set(job.get("aside") or [])
    # the extra drum tracks
    perc = job.get("perc")
    if perc and perc.get("drums") in stems and all(p in stems for p in perc.get("parts", [])):
        rest = stems[perc["drums"]].copy()
        for p in perc["parts"]:
            rest -= stems[p]
        stems["drum_perc"] = rest
        if not perc.get("keepDrums"):
            stems.pop(perc["drums"], None)
        else:
            aside.add(perc["drums"])   # (the whole kit next to its pieces: not part of the bleed sharing)
    for m in job.get("merge") or []:
        parts = [p for p in m.get("from", []) if p in stems]
        if parts:
            stems[m["key"]] = np.sum([stems.pop(p) for p in parts], axis=0)
    progress(10)
    # bleed: re-shape every stem from the song
    amount = float(job.get("bleed") or 0)
    shared = {k: v for k, v in stems.items() if k not in aside}
    if amount > 0 and len(shared) > 1:
        ref = None
        if job.get("mix"):
            try:
                mx, mr = read_wav(job["mix"])
                if mr == rate:
                    ref = np.pad(mx, ((0, 0), (0, max(0, n - mx.shape[1]))))[:, :n]
            except (OSError, ValueError):
                ref = None
        if ref is None:
            ref = np.zeros((2, n), dtype=np.float32)
            for x in shared.values():
                ref += x
        stems.update(debleed(shared, ref, max(0.0, min(1.0, amount)), lambda f: progress(10 + 75 * f), max(0.5, min(3.0, float(job.get("sharp") or 1.0)))))
    progress(85)
    # the same trim for every track
    start, end = 0, n
    if job.get("trim"):
        loud = np.zeros(n, dtype=np.float32)
        for x in stems.values():
            loud += np.abs(x).max(axis=0)
        above = np.nonzero(loud > 10 ** (-60 / 20.0))[0]
        if len(above):
            start = max(0, int(above[0]) - int(rate * 0.5))
            end = min(n, int(above[-1]) + int(rate * 0.5))
    hidden = set(job.get("hidden") or [])
    bits = int(job.get("bits") or 32)
    silent_db = float(job.get("silentDb") if job.get("silentDb") is not None else -55)
    files = []
    for key, x in stems.items():
        if key in hidden:
            continue
        x = x[:, start:end]
        mid, side = (x[0] + x[1]) * 0.5, (x[0] - x[1]) * 0.5
        rms = float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if x.size else 0.0
        mono = bool(job.get("mono")) and float(np.sqrt(np.mean(side.astype(np.float64) ** 2))) < 0.03 * float(np.sqrt(np.mean(mid.astype(np.float64) ** 2)) + 1e-12)
        y = mid[None, :] if mono else x
        path = os.path.join(out_dir, key + ".wav")
        write_wav(path, y, rate, bits)
        files.append({"key": key, "path": path, "db": round(db(rms), 1), "peakDb": round(db(np.max(np.abs(x)) if x.size else 0), 1), "mono": mono, "silent": db(rms) < silent_db})
    progress(100)
    t0 = start / float(rate)
    hits = {k: [round(t - t0, 3) for t in v if t >= t0 and t < end / float(rate)] for k, v in hits.items()}
    result = {"files": files, "rate": rate, "trimmed": [round(t0, 3), round((n - end) / float(rate), 3)], "hits": hits}
    if job.get("result"):
        with open(job["result"], "w") as handle:
            json.dump(result, handle)
    sys.stdout.write("\nRESULT " + json.dumps(result) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
'''
# ---- stemtool (end)


class StemSplitter:
    """Split a song (one stereo file) into stems on this computer. Nothing is installed until the musician asks:
    then uv (a small Python manager) is fetched, a private Python with Demucs and audio-separator (the UVR models:
    RoFormer, MDX23C) is set up in <data>/stem-splitter/, and the models download on first use.
    A split is a few steps: the best-quality vocal model (BS-RoFormer) takes the vocals out, Demucs splits the band
    into drums, bass, guitar, piano and the rest, then - if asked - a karaoke model splits the vocals into lead and
    backing, and DrumSep splits the drums into kick, snare, toms, hi-hat, ride and crash. Or Demucs alone (faster).
    Every setting is the musician's: the models, shifts, overlap, segment length, the device (CPU, Apple GPU,
    NVIDIA), the file format. CC_DEMUCS_CMD / CC_SEPARATOR_CMD run other copies (tests, your own install)."""

    MODELS = ("htdemucs", "htdemucs_ft", "htdemucs_6s", "hdemucs_mmi", "mdx_extra", "mdx_extra_q")
    BAGS = {"htdemucs_ft": 4, "mdx_extra": 4, "mdx_extra_q": 4, "hdemucs_mmi": 1, "htdemucs": 1, "htdemucs_6s": 1}
    SEP_MODELS = {   # audio-separator model files (it downloads each the first time); the first of each kind is the default
        "vocals": [["model_bs_roformer_ep_317_sdr_12.9755.ckpt", "BS-RoFormer (best vocals)"], ["mel_band_roformer_kim_ft_unwa.ckpt", "Mel-Band RoFormer (Kim, fine-tuned)"],
                   ["MDX23C-8KFFT-InstVoc_HQ.ckpt", "MDX23C InstVoc HQ (faster)"]],
        "karaoke": [["mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt", "Mel-Band RoFormer karaoke (lead / backing)"]],
        "drums": [["MDX23C-DrumSep-aufr33-jarredou.ckpt", "MDX23C DrumSep (kick, snare, toms, hi-hat, ride, crash)"]],
        "dereverb": [["UVR-DeEcho-DeReverb.pth", "UVR DeEcho-DeReverb"], ["dereverb_mel_band_roformer_anvuew_sdr_19.1729.ckpt", "Mel-Band RoFormer de-reverb (anvuew)"]],
    }
    ENSEMBLE = ["mel_band_roformer_kim_ft_unwa.ckpt"]   # (Studio: these vote with the vocal model)
    ENSEMBLE_ALGOS = ["avg_fft", "avg_wave", "median_fft", "median_wave", "max_fft", "min_fft", "uvr_max_spec", "uvr_min_spec"]
    RESPLIT = ("vocals", "lead", "drums", "band6", "dereverb")

    def __init__(self, driver):
        self.driver = driver
        self.root = os.path.join(driver.config["data_root"], "stem-splitter")
        os.makedirs(self.root, exist_ok=True)
        self.cfg_path = os.path.join(self.root, "settings.json")
        self.cfg = read_json(self.cfg_path, {}) or {}
        self.jobs = {}
        self.install_state = {"running": False, "step": "", "log": "", "error": ""}
        self.lock = threading.Lock()
        self.last_emit = 0.0

    # ----- where things are
    def env_python(self):
        exe = os.path.join(self.root, "env", "Scripts", "python.exe") if os.name == "nt" else os.path.join(self.root, "env", "bin", "python")
        return exe if os.path.isfile(exe) else None

    def command(self):
        """The Demucs command (a list), or None when it isn't installed."""
        custom = os.environ.get("CC_DEMUCS_CMD") or ""   # (only from the environment: never from a request)
        if custom.strip():
            import shlex
            return shlex.split(custom, posix=os.name != "nt")
        py = self.env_python()
        return [py, "-m", "demucs.separate"] if py and os.path.isfile(os.path.join(self.root, "env", ".demucs-ok")) else None

    def separator_command(self):
        """The audio-separator command (a list), or None when the best-quality models aren't installed."""
        custom = os.environ.get("CC_SEPARATOR_CMD") or ""
        if custom.strip():
            import shlex
            return shlex.split(custom, posix=os.name != "nt")
        exe = os.path.join(self.root, "env-sep", "Scripts", "audio-separator.exe") if os.name == "nt" else os.path.join(self.root, "env-sep", "bin", "audio-separator")
        return [exe] if os.path.isfile(exe) and os.path.isfile(os.path.join(self.root, "env-sep", ".separator-ok")) else None

    def devices(self):
        out = ["cpu"]
        if sys.platform == "darwin" and os.uname().machine == "arm64":
            out.append("mps")
        if shutil.which("nvidia-smi"):
            out.append("cuda")
        return out

    def slow(self):
        """True on a Raspberry Pi: it works, but it takes a long time (and needs 4 GB+)."""
        try:
            with open("/proc/device-tree/model") as handle:
                return "raspberry" in handle.read().lower()
        except OSError:
            return False

    def memory_gb(self):
        try:
            with open("/proc/meminfo") as handle:
                for line in handle:
                    if line.startswith("MemTotal:"):
                        return round(int(line.split()[1]) / 1048576.0, 1)
        except OSError:
            pass
        return None

    def status(self):
        with self.lock:
            jobs = [self._public(j) for j in self.jobs.values()]
        envdir = os.path.join(self.root, "env")
        return {"installed": self.command() is not None, "custom": bool(os.environ.get("CC_DEMUCS_CMD")), "partial": os.path.isdir(envdir) and self.command() is None,
                "separator": self.separator_command() is not None, "sepModels": self.SEP_MODELS, "ensembleAlgos": self.ENSEMBLE_ALGOS, "ensemble": self.ENSEMBLE,
                "cleanup": self.tool_python() is not None,
                "install": dict(self.install_state, log=self.install_state["log"][-2500:]), "devices": self.devices(), "models": list(self.MODELS),
                "slow": self.slow(), "memoryGb": self.memory_gb(), "platform": sys.platform, "jobs": jobs,
                "settings": {"packages": self.cfg.get("packages") or "", "python": self.cfg.get("python") or "3.11"}}

    def configure(self, patch):
        if isinstance(patch, dict):
            if "packages" in patch:   # PyPI names and versions only (no URLs, paths or options)
                pk = str(patch.get("packages") or "").split()
                if all(re.match(r"^[A-Za-z0-9_.\-]+(\[[A-Za-z0-9_,\-]+\])?([=<>!~]=?[A-Za-z0-9_.*+\-]+)?(,[=<>!~]=?[A-Za-z0-9_.*+\-]+)*$", x) for x in pk):
                    self.cfg["packages"] = " ".join(pk)[:400]
            if "python" in patch and re.match(r"^3\.\d{1,2}$", str(patch.get("python") or "")):
                self.cfg["python"] = str(patch["python"])
            write_json(self.cfg_path, self.cfg)
        return self.status()

    # ----- installing (on demand)
    def _log(self, text):
        self.install_state["log"] = (self.install_state["log"] + text)[-20000:]

    def _uv(self):
        found = shutil.which("uv")
        if found:
            return found
        exe = os.path.join(self.root, "bin", "uv.exe" if os.name == "nt" else "uv")
        if os.path.isfile(exe):
            return exe
        mach = (os.uname().machine if hasattr(os, "uname") else os.environ.get("PROCESSOR_ARCHITECTURE", "x86_64")).lower()
        arch = "aarch64" if mach in ("arm64", "aarch64") else "x86_64"
        if sys.platform == "darwin":
            target, ext = arch + "-apple-darwin", ".tar.gz"
        elif os.name == "nt":
            target, ext = arch + "-pc-windows-msvc", ".zip"
        else:
            target, ext = arch + "-unknown-linux-gnu", ".tar.gz"
        url = "https://github.com/astral-sh/uv/releases/latest/download/uv-" + target + ext
        self.install_state["step"] = "Downloading uv"
        self._log("Downloading " + url + "\n")
        os.makedirs(os.path.dirname(exe), exist_ok=True)
        archive = os.path.join(self.root, "bin", "uv" + ext)
        with urllib.request.urlopen(url, timeout=120) as r, open(archive, "wb") as handle:
            shutil.copyfileobj(r, handle)
        if ext == ".zip":
            with zipfile.ZipFile(archive) as zf:
                for n in zf.namelist():
                    if n.endswith("uv.exe"):
                        with zf.open(n) as src, open(exe, "wb") as dst:
                            shutil.copyfileobj(src, dst)
        else:
            import tarfile
            with tarfile.open(archive) as tf:
                for m in tf.getmembers():
                    if m.name.endswith("/uv") or m.name == "uv":
                        with tf.extractfile(m) as src, open(exe, "wb") as dst:
                            shutil.copyfileobj(src, dst)
            os.chmod(exe, 0o755)
        os.remove(archive)
        return exe

    def _run(self, args, env=None):
        self._log("$ " + " ".join(args) + "\n")
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
        for line in iter(proc.stdout.readline, b""):
            self._log(line.decode(errors="replace"))
            self._emit_status()
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError("%s failed (exit %s)" % (os.path.basename(args[0]), proc.returncode))

    def packages(self):
        if self.cfg.get("packages"):
            return self.cfg["packages"].split()
        if sys.platform == "darwin" and os.uname().machine == "x86_64":
            torch = ["torch==2.2.2", "torchaudio==2.2.2", "numpy<2"]   # (the last PyTorch for Intel Macs)
        else:
            torch = ["torch==2.5.1", "torchaudio==2.5.1"]
        return torch + ["demucs==4.0.1", "soundfile"]

    def install(self):
        if self.install_state["running"]:
            return self.status()
        self.install_state = {"running": True, "step": "Starting", "log": "", "error": ""}

        def work():
            try:
                uv = self._uv()
                env = dict(os.environ, UV_CACHE_DIR=os.path.join(self.root, "cache"), UV_PYTHON_INSTALL_DIR=os.path.join(self.root, "python"))
                envdir = os.path.join(self.root, "env")
                shutil.rmtree(envdir, ignore_errors=True)   # (what a failed try left behind)
                self.install_state["step"] = "Setting up Python"
                self._run([uv, "venv", "--python", self.cfg.get("python") or "3.11", "--seed", envdir], env)
                py = self.env_python()
                pkgs = self.packages()
                torch = [p for p in pkgs if p.split("=")[0].split("<")[0] in ("torch", "torchaudio")]
                rest = [p for p in pkgs if p not in torch]
                cuda = "cuda" in self.devices()
                if torch and sys.platform != "darwin" and not cuda and not self.cfg.get("packages"):
                    self.install_state["step"] = "Installing PyTorch (CPU)"
                    self._run([uv, "pip", "install", "--python", py, "--index-url", "https://download.pytorch.org/whl/cpu"] + torch, env)
                    pkgs = rest
                self.install_state["step"] = "Installing Demucs"
                self._run([uv, "pip", "install", "--python", py] + pkgs, env)
                self.install_state["step"] = "Checking"
                self._run([py, "-c", "import demucs.separate, torch; print('demucs ok, torch', torch.__version__)"], env)
                with open(os.path.join(envdir, ".demucs-ok"), "w") as handle:
                    handle.write(time.strftime("%Y-%m-%d %H:%M"))
                # the best-quality models (RoFormer, MDX23C, DrumSep): audio-separator in a Python of its own, with the
                # PyTorch it wants (Demucs keeps its pinned one). If it can't install here (an old Intel Mac), Demucs alone works.
                self.install_state["step"] = "Installing the best-quality models (audio-separator)"
                sepdir = os.path.join(self.root, "env-sep")
                shutil.rmtree(sepdir, ignore_errors=True)
                try:
                    self._run([uv, "venv", "--python", self.cfg.get("python") or "3.11", "--seed", sepdir], env)
                    spy = os.path.join(sepdir, "Scripts", "python.exe") if os.name == "nt" else os.path.join(sepdir, "bin", "python")
                    if sys.platform != "darwin" and not cuda:
                        self._run([uv, "pip", "install", "--python", spy, "--index-url", "https://download.pytorch.org/whl/cpu", "torch", "torchaudio"], env)
                    self._run([uv, "pip", "install", "--python", spy, "audio-separator[%s]" % ("gpu" if cuda else "cpu")], env)
                    self._run([spy, "-c", "import audio_separator.separator; print('audio-separator ok')"], env)
                    with open(os.path.join(sepdir, ".separator-ok"), "w") as handle:
                        handle.write(time.strftime("%Y-%m-%d %H:%M"))
                except Exception as error:
                    shutil.rmtree(sepdir, ignore_errors=True)
                    self._log("\nThe best-quality models could not be installed here (%s) - Demucs works on its own.\n" % error)
                    self.install_state["warning"] = "Demucs is installed; the best-quality models could not be installed on this computer"
                self.install_state["step"] = "Installed"
            except Exception as error:
                self.install_state["error"] = str(error)
                self.install_state["step"] = "Failed"
                self._log("\nERROR: %s\n" % error)
            finally:
                self.install_state["running"] = False
                self._emit_status(force=True)

        threading.Thread(target=work, daemon=True).start()
        return self.status()

    def uninstall(self):
        if self.install_state["running"]:
            return self.status()
        for sub in ("env", "env-sep", "python", "cache", "bin", "models"):
            shutil.rmtree(os.path.join(self.root, sub), ignore_errors=True)
        return self.status()

    # ----- splitting
    def prune(self, days=2):
        """Uploaded songs and split files nobody fetched, older than a couple of days (the SD card is small)."""
        live = set(self.jobs)
        for sub in ("in", "out"):
            base = os.path.join(self.root, sub)
            for d in os.listdir(base) if os.path.isdir(base) else []:
                p = os.path.join(base, d)
                if d not in live and os.path.isdir(p) and time.time() - os.path.getmtime(p) > days * 86400:
                    shutil.rmtree(p, ignore_errors=True)

    def upload(self, name, data):
        if not data:
            raise ValueError("empty file")
        self.prune()
        d = os.path.join(self.root, "in", secrets.token_hex(6))
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, safe_name(name))
        with open(path, "wb") as handle:
            handle.write(data)
        return {"ok": True, "path": path}

    def _input_ok(self, path):
        path = os.path.realpath(str(path or ""))
        if not os.path.isfile(path):
            return None
        ok_roots = [os.path.realpath(os.path.join(self.root, "in")), os.path.realpath(self.driver.config["data_root"])]
        ok_roots += [os.path.realpath(r) for r in (self.driver.config.get("media_roots") or [])]
        return path if any(path.startswith(r + os.sep) for r in ok_roots) else None

    def args_for(self, opts, src, out, two_stems=None, model=None, shifts=None):
        model = model if model in self.MODELS else (opts.get("model") if opts.get("model") in self.MODELS else "htdemucs")
        a = ["-n", model, "-o", out, "--filename", "{stem}.{ext}"]
        if shifts is None:
            shifts = max(0, min(20, int(opts["shifts"]) if opts.get("shifts") not in (None, "") else 1))
        a += ["--shifts", str(shifts)]
        overlap = float(opts.get("overlap") if opts.get("overlap") is not None else 0.25)
        a += ["--overlap", "%.2f" % max(0.0, min(0.99, overlap))]
        if opts.get("segment"):
            a += ["--segment", str(max(1, min(60, int(opts["segment"]))))]
        a += ["-d", self.device(opts)]
        two = opts.get("twoStems") if two_stems is None else two_stems
        if two:
            a += ["--two-stems", re.sub(r"[^a-z]", "", str(two))]
        fmt = opts.get("format") or "wav"
        if fmt == "mp3":
            a += ["--mp3", "--mp3-bitrate", str(max(96, min(320, int(opts.get("mp3Kbps") or 320))))]
        elif fmt == "flac":
            a += ["--flac"]
        elif fmt == "wav24":
            a += ["--int24"]
        elif fmt == "float":
            a += ["--float32"]
        if opts.get("clipMode") in ("rescale", "clamp"):
            a += ["--clip-mode", opts["clipMode"]]
        if opts.get("jobs"):
            a += ["-j", str(max(1, min(16, int(opts["jobs"]))))]
        return a + [src]

    def device(self, opts):
        device = opts.get("device") or "auto"
        if device == "auto" or device not in self.devices():
            device = "cuda" if "cuda" in self.devices() else ("mps" if "mps" in self.devices() else "cpu")
        return device

    def sep_args(self, opts, model, src, out, extra=None, algo=None):
        """audio-separator (the UVR models: RoFormer, MDX23C...): one model on one file - or an ensemble, where
        more models vote on the same split (--extra_models, --ensemble_algorithm)."""
        fmt = {"mp3": "MP3", "flac": "FLAC"}.get(opts.get("format") or "wav", "WAV")
        a = [src, "-m", model, "--output_dir", out, "--model_file_dir", os.path.join(self.root, "models", "uvr"), "--output_format", fmt, "--log_level", "info"]
        if extra:
            a += ["--extra_models"] + list(extra) + ["--ensemble_algorithm", algo if algo in self.ENSEMBLE_ALGOS else self.ENSEMBLE_ALGOS[0]]
        if opts.get("sepSegment"):
            a += ["--mdxc_segment_size", str(max(32, min(4096, int(opts["sepSegment"]))))]
        if opts.get("sepOverlap"):
            a += ["--mdxc_overlap", str(max(2, min(50, int(opts["sepOverlap"]))))]
        if opts.get("autocast"):
            a += ["--use_autocast"]
        return a

    @staticmethod
    def _file_ok(v):
        return bool(re.match(r"^[A-Za-z0-9_][A-Za-z0-9_.\-]*\.(ckpt|onnx|pth|yaml|th)$", str(v or "")))   # (never "-..." - it would look like an option)

    def _model(self, opts, key, kind):
        """A model file name the musician picked (or typed), else the first of its kind."""
        v = str(opts.get(key) or "")
        return v if self._file_ok(v) else self.SEP_MODELS[kind][0][0]

    def _ensemble(self, opts, main):
        """The models that vote with the vocal model in Studio (the musician's list, else ENSEMBLE)."""
        got = opts.get("ensembleModels")
        names = got if isinstance(got, list) else self.ENSEMBLE
        return [m for m in names if self._file_ok(m) and m != main][:4]

    def plan(self, opts, src, out):
        """The steps of a split. Each: label, kind (demucs / sep), what it splits ("in"), its folder, its weight, and
        what it does with the files ("does"): vox (vocals / band), band (Demucs: keep = the stems to keep, else all),
        lead (lead / backing), drums (kit pieces), dry (the reverb off). "optional" steps can fail without failing
        the split (it says so). opts["only"] = one step on a stem of an earlier split (Split again)."""
        only = str(opts.get("only") or "")
        if only:
            one = {"vocals": {"label": "Vocals and the rest", "kind": "sep", "model": self._model(opts, "vocalModel", "vocals"), "does": "vox"},
                   "lead": {"label": "Lead and backing vocals", "kind": "sep", "model": self._model(opts, "karaokeModel", "karaoke"), "does": "lead"},
                   "drums": {"label": "Kick, snare, toms and cymbals", "kind": "sep", "model": self._model(opts, "drumModel", "drums"), "does": "drums"},
                   "band6": {"label": "Guitar, piano and the rest (Demucs 6 stems)", "kind": "demucs", "model": "htdemucs_6s", "does": "band"},
                   "dereverb": {"label": "Taking the reverb off", "kind": "sep", "model": self._model(opts, "dereverbModel", "dereverb"), "does": "dry"}}.get(only)
            if not one:
                raise ValueError("can't split a stem that way")
            return [dict(one, **{"in": "src", "dir": "1-" + only, "weight": 3})]
        quality = opts.get("quality")
        two = str(opts.get("twoStems") or "")
        steps = []
        if quality in ("best", "studio") and two in ("", "vocals"):
            vm = self._model(opts, "vocalModel", "vocals")
            extra = self._ensemble(opts, vm) if quality == "studio" and opts.get("ensemble") is not False else []
            steps.append({"label": "Vocals (%s)" % ("%d models together" % (1 + len(extra)) if extra else "best-quality model"), "kind": "sep", "model": vm, "extra": extra,
                          "algo": opts.get("ensembleAlgo"), "in": "src", "dir": "1-vocals", "weight": 3 + 2 * len(extra), "does": "vox"})
            if not two:
                if quality == "studio":
                    band = opts.get("bandModel") if opts.get("bandModel") in self.MODELS else "htdemucs_ft"
                    six = opts.get("band6Model", "htdemucs_6s")
                    six = six if six in self.MODELS else ""
                    sh = max(2, min(20, int(opts["shifts"]) if opts.get("shifts") not in (None, "") else 2))
                    steps.append({"label": "Drums and bass (Demucs, %s)" % band, "kind": "demucs", "model": band, "shifts": sh, "in": "instrumental", "dir": "2-band", "weight": 4,
                                  "does": "band", "keep": ["drums", "bass"] if six else None})
                    if six:
                        steps.append({"label": "Guitar, keys and the rest (Demucs, 6 stems)", "kind": "demucs", "model": six, "shifts": max(1, sh // 2), "in": "instrumental",
                                      "dir": "3-band6", "weight": 2, "does": "band", "keep": ["guitar", "piano", "other"]})
                else:
                    steps.append({"label": "Drums, bass and the rest (Demucs)", "kind": "demucs", "in": "instrumental", "dir": "2-band", "weight": 3, "does": "band"})
        else:
            steps.append({"label": "Splitting (Demucs)", "kind": "demucs", "in": "src", "dir": "1-demucs", "weight": 4, "two": two, "does": "band"})
        if opts.get("leadBacking") and two in ("", "vocals"):
            steps.append({"label": "Lead and backing vocals", "kind": "sep", "model": self._model(opts, "karaokeModel", "karaoke"), "in": "vocals", "dir": "4-lead", "weight": 2, "does": "lead"})
        if opts.get("dereverb") and two in ("", "vocals") and quality in ("best", "studio"):
            steps.append({"label": "Taking the reverb off the vocals", "kind": "sep", "model": self._model(opts, "dereverbModel", "dereverb"), "in": "lead" if opts.get("leadBacking") else "vocals",
                          "dir": "5-dry", "weight": 1, "does": "dry", "optional": True})
        if opts.get("drumParts") and not two:
            steps.append({"label": "Kick, snare, toms and cymbals", "kind": "sep", "model": self._model(opts, "drumModel", "drums"), "in": "drums", "dir": "6-drums", "weight": 2, "does": "drums"})
        return steps

    def start(self, path, opts, parent=None):
        cmd = self.command()
        if not cmd:
            raise ValueError("the stem splitter isn't installed yet")
        src = self._input_ok(path)
        if not src:
            raise ValueError("can't find that file")
        opts = dict(opts) if isinstance(opts, dict) else {}
        if opts.get("kit") == "drums" and opts.get("cleanup"):
            opts["keepDrums"] = False   # (the kit pieces become the Drums track again)
        steps = self.plan(opts, src, None)
        if any(s["kind"] == "sep" for s in steps) and not self.separator_command():
            raise ValueError("the best-quality models aren't installed yet - press Install (or Update) in the stem splitter")
        jid = secrets.token_hex(5)
        out = os.path.join(self.root, "out", jid)
        os.makedirs(out, exist_ok=True)
        model = opts.get("model") if opts.get("model") in self.MODELS else "htdemucs"
        job = {"id": jid, "name": os.path.basename(src), "state": "running", "progress": 0.0, "model": model, "opts": opts, "step": steps[0]["label"],
               "steps": [s["label"] for s in steps] + (["Cleaning up the tracks"] if self._cleanup_on(opts) else []), "files": [], "error": "", "started": time.time(),
               "eta": None, "out": out, "proc": None, "log": "", "notes": [], "hits": {}, "parent": parent}
        with self.lock:
            self.jobs[jid] = job
        threading.Thread(target=self._work, args=(job, src, steps), daemon=True).start()
        return self._public(job)

    def resplit(self, jid, rel, kind, opts=None):
        """Split one stem of a finished split again (Split again in the review): its lead and backing, its kit
        pieces, guitar / piano / the rest, or its reverb off. Same settings as the first split, no trim (the new
        tracks stay in time with the others), and the stem itself is what they add up to."""
        parent = self.jobs.get(str(jid))
        if not parent or parent.get("state") != "done":
            raise ValueError("that split isn't finished")
        if kind not in self.RESPLIT:
            raise ValueError("can't split a stem that way")
        src = self.file_path(jid, rel)
        if not src:
            raise ValueError("can't find that stem")
        o = dict(parent.get("opts") or {}, only=kind, trim=False, review=True, dropSilent=False, keepReverb=True)
        if isinstance(opts, dict):
            o.update({k: v for k, v in opts.items() if k not in ("only", "trim")})
        if kind == "drums":
            o["kit"] = "pieces"   # (asked for the kit pieces: they stay apart)
        if kind in ("band6",) and o.get("quality") not in ("best", "studio"):
            o["quality"] = "best"
        o.pop("twoStems", None)
        return self.start(src, o, parent=str(jid))

    def _run_step(self, job, argv, done_w, weight, total_w, bars_expected, env):
        bars, last_pct = 0, 0.0
        if job["state"] == "cancelled":
            raise InterruptedError()
        job["proc"] = proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
        buf = b""
        while True:
            ch = proc.stdout.read(1)
            if not ch:
                break
            if ch in (b"\r", b"\n"):
                line = buf.decode(errors="replace")
                buf = b""
                m = re.search(r"(\d{1,3})%\|", line)
                if m:
                    pct = int(m.group(1)) / 100.0
                    if pct < last_pct - 0.5:
                        bars += 1
                    last_pct = pct
                    frac = min(1.0, (min(bars, bars_expected - 1) + pct) / max(1, bars_expected))
                    job["progress"] = min(0.99, (done_w + frac * weight) / total_w)
                    el = time.time() - job["started"]
                    job["eta"] = int(el * (1 - job["progress"]) / job["progress"]) if job["progress"] > 0.03 else None
                    self._emit_job(job)
                elif line.strip() and not line.startswith("RESULT "):
                    job["log"] = (job["log"] + line + "\n")[-4000:]
            else:
                buf += ch
        proc.wait()
        job["proc"] = None
        if job["state"] == "cancelled":
            raise InterruptedError()
        if proc.returncode != 0:
            raise RuntimeError((job["log"].strip().splitlines() or ["stopped (exit %s)" % proc.returncode])[-1][:300])

    @staticmethod
    def _outputs(d):
        """Stem name -> file in a step's folder: Demucs writes <model>/<stem>.<ext>; audio-separator writes
        <song>_(<Stem>)_<model>.<ext>."""
        found = {}
        for base, _dirs, names in os.walk(d):
            for n in sorted(names):
                p = os.path.join(base, n)
                m = re.findall(r"_\(([^)]+)\)", n)   # (the last one: a split of a split is named <song>_(Vocals)_<m1>_(Instrumental)_<m2>)
                key = (m[-1] if m else n.rsplit(".", 1)[0]).strip().lower().replace(" ", "_").replace("-", "_")
                found[key] = p
        return found

    @staticmethod
    def _dry_wet(got):
        """A de-reverb model's two files: (dry, wet). They are called No Reverb / Reverb, No Echo / Echo, dry / wet..."""
        dry = next((p for k, p in got.items() if k.startswith("no") or "dry" in k), None)
        dry = dry or next((p for k, p in got.items() if not re.search(r"reverb|echo|wet", k)), None)
        wet = next((p for k, p in got.items() if p != dry), None)
        return dry, wet

    # ----- the clean-up pass (stemtool: numpy, in the splitter's own Python)
    def tool_python(self):
        custom = os.environ.get("CC_STEMTOOL_PYTHON") or ""
        if custom.strip():
            import shlex
            return shlex.split(custom, posix=os.name != "nt")
        if self.env_python() and os.path.isfile(os.path.join(self.root, "env", ".demucs-ok")):
            return [self.env_python()]
        spy = os.path.join(self.root, "env-sep", "Scripts", "python.exe") if os.name == "nt" else os.path.join(self.root, "env-sep", "bin", "python")
        return [spy] if os.path.isfile(spy) and os.path.isfile(os.path.join(self.root, "env-sep", ".separator-ok")) else None

    def tool_path(self):
        """The clean-up tool, written next to the splitter's settings (it is part of this file, so the bundled
        driver and the Pi have it too)."""
        p = os.path.join(self.root, "stemtool.py")
        try:
            with open(p) as handle:
                same = handle.read() == STEMTOOL
        except OSError:
            same = False
        if not same:
            with open(p + ".part", "w") as handle:
                handle.write(STEMTOOL)
            os.replace(p + ".part", p)
        return p

    def _cleanup_on(self, opts):
        return bool(opts.get("cleanup")) and self.tool_python() is not None

    def _mix_ref(self, job, src):
        """The song as a WAV (44.1 kHz float, the rate the models write) for the bleed step: the stems are made to
        add up to it. Without ffmpeg, the song itself when it is a WAV (or nothing: the stems' own sum is used)."""
        ff = shutil.which("ffmpeg")
        if ff:
            p = os.path.join(job["out"], "0-mix.wav")
            r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", src, "-ac", "2", "-ar", "44100", "-c:a", "pcm_f32le", p], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
            if r.returncode == 0 and os.path.isfile(p):
                return p
        return src if src.lower().endswith(".wav") else None

    def _cleanup(self, job, src, final, hidden, done_w, total_w, env):
        o = job["opts"]
        clean = os.path.join(job["out"], "clean")
        os.makedirs(clean, exist_ok=True)
        stems = [{"key": k, "path": p} for k, p in final.items()] + [{"key": k, "path": p} for k, p in hidden.items() if k not in final]
        ff = shutil.which("ffmpeg")
        for x in list(stems):   # (the clean-up reads WAV: a re-split of an MP3 / FLAC track is converted first)
            if not x["path"].lower().endswith(".wav"):
                conv = os.path.join(clean, "_in-" + x["key"] + ".wav")
                r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", x["path"], "-c:a", "pcm_f32le", conv], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600) if ff else None
                if r is not None and r.returncode == 0 and os.path.isfile(conv):
                    x["path"] = conv
                else:
                    stems.remove(x)
                    hidden.pop(x["key"], None)
        drum_keys = [k for k in final if k.startswith("drum_") and k != "drum_perc"]
        spec = {"out": clean, "stems": stems, "mix": self._mix_ref(job, src), "result": os.path.join(clean, "result.json"),
                "bleed": max(0.0, min(1.0, float(o.get("bleed") if o.get("bleed") is not None else 50) / 100.0)), "sharp": max(0.5, min(3.0, float(o.get("bleedSharp") or 1.0))),
                "trim": o.get("trim") is not False and not o.get("only"), "mono": o.get("mono") is not False, "hidden": sorted(hidden),
                "silentDb": float(o.get("silentDb") if o.get("silentDb") is not None else -55), "hitSens": float(o.get("hitSens") or 1.0),
                "bits": {"wav24": 24, "float": 32, "mp3": 32, "flac": 32}.get(o.get("format") or "wav", 16)}
        if "drums_all" in hidden:   # (the whole kit, next to its pieces: never shares the song with them)
            if drum_keys and o.get("perc") is not False:
                spec["perc"] = {"drums": "drums_all", "parts": drum_keys, "keepDrums": bool(o.get("keepDrums"))}   # Perc = the kit minus its pieces
            elif o.get("keepDrums"):
                spec["aside"] = ["drums_all"]
            else:
                spec["stems"] = [x for x in stems if x["key"] != "drums_all"]
            if o.get("keepDrums"):
                spec["hidden"] = [k for k in spec["hidden"] if k != "drums_all"]
        kit = o.get("kit") if o.get("kit") in ("drums", "cymbals", "pieces") else "pieces"
        if drum_keys and kit == "drums":     # MultiTracks style: Drums (the kit pieces together) + Perc (the rest)
            spec["merge"] = [{"key": "drums", "from": drum_keys}]
        elif drum_keys and kit == "cymbals":   # Kick, Snare, Toms, Cymbals (hi-hat + ride + crash), Perc
            spec["merge"] = [{"key": "drum_cymbals", "from": [k for k in ("drum_hh", "drum_ride", "drum_crash") if k in final]}]
        if o.get("hits") is not False:
            if drum_keys:
                spec["hits"] = {p: "drum_" + k for p, k in (("kick", "kick"), ("snare", "snare"), ("hat", "hh"), ("crash", "crash")) if "drum_" + k in final}
            elif "drums" in final:
                spec["hits"] = {"drums": "drums"}
        jp = os.path.join(clean, "job.json")
        write_json(jp, spec)
        self._run_step(job, self.tool_python() + [self.tool_path(), jp], done_w, 1, total_w, 1, env)
        res = read_json(spec["result"], None)
        if not isinstance(res, dict):
            raise RuntimeError("the clean-up didn't finish")
        return res

    def _work(self, job, src, steps):
        o = job["opts"]
        want = o.get("format") or "wav"
        cleanup = self._cleanup_on(o)
        if o.get("cleanup") and not cleanup:
            job["notes"].append("The clean-up pass was skipped: it needs the stem splitter's own Python (Install in the stem splitter).")
        step_opts = dict(o, format="float") if (want in ("mp3", "flac") and len(steps) > 1) or cleanup else o   # (no lossy steps in between)
        try:
            env = dict(os.environ, PYTHONUNBUFFERED="1", TORCH_HOME=os.path.join(self.root, "models"))
            total = float(sum(s["weight"] for s in steps) + (1 if cleanup else 0)) or 1.0
            done = 0.0
            have = {"src": src}
            final = {}    # stem key -> file
            hidden = {}   # stems that take their share of the song in the clean-up, but aren't kept
            for s in steps:
                job["step"] = s["label"]
                self._emit_job(job, force=True)
                inp = have.get(s["in"])
                if not inp:
                    if s.get("optional"):
                        continue
                    raise RuntimeError("nothing to split for: " + s["label"])
                d = os.path.join(job["out"], s["dir"])
                os.makedirs(d, exist_ok=True)
                try:
                    if s["kind"] == "demucs":
                        model = s.get("model") or (o.get("model") if o.get("model") in self.MODELS else "htdemucs")
                        argv = self.command() + self.args_for(step_opts, inp, d, two_stems=s.get("two", ""), model=model, shifts=s.get("shifts"))
                        bags = self.BAGS.get(model, 1) * max(1, s.get("shifts") or (int(o["shifts"]) if o.get("shifts") not in (None, "") else 1))
                        self._run_step(job, argv, done, s["weight"], total, bags, env)
                    else:
                        try:
                            self._run_step(job, self.separator_command() + self.sep_args(step_opts, s["model"], inp, d, s.get("extra"), s.get("algo")), done, s["weight"], total, 1 + len(s.get("extra") or []), env)
                        except RuntimeError as error:
                            if not s.get("extra"):
                                raise
                            # the ensemble didn't work here (a model that won't download, an old audio-separator): one model then
                            job["notes"].append("The vocal models couldn't work together (%s) - the vocals are from %s alone." % (str(error)[:120], s["model"]))
                            shutil.rmtree(d, ignore_errors=True)
                            os.makedirs(d, exist_ok=True)
                            self._run_step(job, self.separator_command() + self.sep_args(step_opts, s["model"], inp, d), done, s["weight"], total, 1, env)
                    got = self._outputs(d)
                    if not got:
                        raise RuntimeError(s["label"] + ": no files came out")
                except RuntimeError as error:
                    if not s.get("optional"):
                        raise
                    job["notes"].append("%s didn't work (%s) - left as it was." % (s["label"], str(error)[:160]))
                    done += s["weight"]
                    continue
                done += s["weight"]
                does = s.get("does")
                if does == "vox":   # vocals / instrumental (some models call it "other")
                    voc = got.get("vocals")
                    inst = got.get("instrumental") or got.get("no_vocals") or next((p for k, p in got.items() if k != "vocals"), None)
                    if voc:
                        have["vocals"] = have["lead"] = voc
                        final["vocals"] = voc
                    if inst:
                        have["instrumental"] = inst
                        if len(steps) == 1 or str(o.get("twoStems") or "") == "vocals":
                            final["no_vocals"] = inst
                elif does == "band":
                    keep = s.get("keep")
                    for k, p in got.items():
                        if s["in"] == "instrumental" and k == "vocals":
                            hidden["rest_vocals"] = p   # (what is left of the vocals in the band: the RoFormer vocals are better)
                            continue
                        if keep and k not in keep:
                            continue
                        have[k] = p
                        final[k] = p
                elif does == "lead":
                    final.pop("vocals", None)
                    if got.get("vocals"):
                        final["lead_vocals"] = have["lead"] = got["vocals"]
                    back = got.get("instrumental") or got.get("no_vocals") or got.get("backing_vocals") or next((p for k, p in got.items() if k != "vocals"), None)
                    if back:
                        final["backing_vocals"] = back
                elif does == "dry":
                    dry, wet = self._dry_wet(got)
                    target = "lead_vocals" if "lead_vocals" in final else "vocals"
                    if dry:
                        final[target] = dry
                    if wet:
                        if o.get("keepReverb"):
                            final["vox_fx"] = wet
                        else:
                            hidden["vox_fx"] = wet
                elif does == "drums":
                    whole = final.get("drums") or have.get("src")
                    if o.get("keepDrums") is not True:
                        final.pop("drums", None)
                    if whole:
                        hidden["drums_all"] = whole
                    for k, p in got.items():
                        final["drum_" + k] = p
            stats = {}
            if cleanup:
                job["step"] = "Cleaning up the tracks"
                self._emit_job(job, force=True)
                if o.get("keepDrums") and "drums" in final and "drums_all" in hidden:
                    hidden.pop("drums_all")   # (Drums is kept as it is, next to its pieces: stemtool sets it aside)
                    hidden["drums_all"] = final.pop("drums")
                res = self._cleanup(job, src, final, hidden, done, total, env)
                final = {f["key"]: f["path"] for f in res.get("files", [])}
                stats = {f["key"]: f for f in res.get("files", [])}
                if "drums_all" in final:   # (kept: it is the Drums track)
                    final["drums"] = final.pop("drums_all")
                    stats["drums"] = stats.pop("drums_all")
                job["hits"] = res.get("hits") or {}
                job["trimmed"] = res.get("trimmed") or [0, 0]
            # the finished stems, with their names and roles, in final/
            out = os.path.join(job["out"], "final")
            os.makedirs(out, exist_ok=True)
            files = []
            ff = shutil.which("ffmpeg")
            mt = o.get("trackSet") == "multitracks"
            for key in sorted(final, key=self._order):
                st = stats.get(key) or {}
                if st.get("silent") and o.get("dropSilent") is not False and not o.get("review"):
                    job["notes"].append("%s was silent - left out." % self._nice(key, mt, final)[0])
                    continue
                p = final[key]
                nice, role = self._nice(key, mt, final)
                ext = p.rsplit(".", 1)[-1].lower()
                if want in ("mp3", "flac") and ext == "wav" and ff:   # (the format asked for, made once from the WAV)
                    name = nice + "." + want
                    codec = ["-codec:a", "libmp3lame", "-b:a", "%dk" % max(96, min(320, int(o.get("mp3Kbps") or 320)))] if want == "mp3" else ["-codec:a", "flac"]
                    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", p] + codec + [os.path.join(out, name)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
                    if r.returncode != 0:
                        name = nice + ".wav"
                        shutil.copyfile(p, os.path.join(out, name))
                else:
                    name = nice + "." + ext
                    shutil.copyfile(p, os.path.join(out, name))
                f = {"name": name, "stem": key, "role": role, "size": os.path.getsize(os.path.join(out, name)), "rel": "final/" + name}
                if st:
                    f.update({"db": st.get("db"), "peakDb": st.get("peakDb"), "mono": st.get("mono"), "silent": st.get("silent")})
                files.append(f)
            job["files"] = files
            job["state"] = "done"
            job["progress"] = 1.0
            job["eta"] = 0
        except InterruptedError:
            shutil.rmtree(job["out"], ignore_errors=True)
            return
        except Exception as error:
            job["state"] = "failed"
            job["error"] = str(error)[:300]
        finally:
            job["proc"] = None
            job["finished"] = time.time()
            self._emit_job(job, force=True)

    ORDER = ["lead_vocals", "backing_vocals", "vocals", "vox_fx", "drums", "drum_kick", "drum_snare", "drum_toms", "drum_hh", "drum_ride", "drum_crash", "drum_cymbals", "drum_perc",
             "bass", "guitar", "piano", "other", "no_vocals", "no_drums", "no_bass", "no_other"]
    NICE = {"lead_vocals": ("Lead vocals", "vocals"), "backing_vocals": ("Backing vocals", "vocals"), "vocals": ("Vocals", "vocals"), "vox_fx": ("Vocal reverb", "vocals"),
            "drums": ("Drums", "drums"), "drum_kick": ("Kick", "drums"), "drum_snare": ("Snare", "drums"), "drum_toms": ("Toms", "drums"), "drum_hh": ("Hi-hat", "drums"),
            "drum_ride": ("Ride", "drums"), "drum_crash": ("Crash", "drums"), "drum_cymbals": ("Cymbals", "drums"), "drum_perc": ("Percussion", "drums"), "bass": ("Bass", "bass"),
            "guitar": ("Guitar", "guitar"), "piano": ("Piano", "keys"), "other": ("Other", "music"), "no_vocals": ("Band (no vocals)", "music"), "no_drums": ("No drums", "music"),
            "no_bass": ("No bass", "music"), "no_other": ("Rest", "music")}
    MT = {"lead_vocals": "Lead Vox", "backing_vocals": "BGVs", "vocals": "Vox", "vox_fx": "Vox FX", "drum_hh": "Hi-Hat", "drum_perc": "Perc", "guitar": "Guitars", "piano": "Keys",
          "other": "Synth & Pads", "no_vocals": "Band"}

    def _order(self, key):
        return (self.ORDER.index(key), key) if key in self.ORDER else (len(self.ORDER), key)

    def _nice(self, key, multitracks=False, keys=()):
        """(file name, role). The MultiTracks-style set: Lead Vox, BGVs, Vox FX, Kick, Snare, Toms, Cymbals, Perc, Bass,
        Guitars, Keys, Synth & Pads... ("other" is Synth & Pads when guitar or keys has its own track, else Instruments)."""
        if multitracks and key in self.MT:
            if key == "other" and "guitar" not in keys and "piano" not in keys:
                return ("Instruments", "music")
            return (self.MT[key], "keys" if key == "other" else self.NICE.get(key, ("", "music"))[1])
        if key in self.NICE:
            return self.NICE[key]
        base = key[5:] if key.startswith("drum_") else key
        return (safe_name(base.replace("_", " ").strip().title()) or "Stem", "drums" if key.startswith("drum_") else "music")

    def cancel(self, jid):
        job = self.jobs.get(str(jid))
        if job and job.get("state") == "running":
            job["state"] = "cancelled"   # (between two steps there is no process: the next step sees this)
            if job.get("proc"):
                try:
                    job["proc"].terminate()
                except Exception:
                    pass
        return {"ok": bool(job)}

    def forget(self, jid):
        self.cancel(jid)
        with self.lock:
            job = self.jobs.pop(str(jid), None)
        if job:
            shutil.rmtree(job["out"], ignore_errors=True)
        return {"ok": bool(job)}

    def file_path(self, jid, rel):
        job = self.jobs.get(str(jid))
        if not job:
            return None
        p = os.path.realpath(os.path.join(job["out"], str(rel or "")))
        return p if p.startswith(os.path.realpath(job["out"]) + os.sep) and os.path.isfile(p) else None

    def _public(self, job):
        for _ in range(5):   # (the worker may add a key meanwhile)
            try:
                return {k: v for k, v in list(job.items()) if k not in ("proc", "out")}
            except RuntimeError:
                time.sleep(0.01)
        return {"id": job.get("id"), "state": job.get("state")}

    def _emit_job(self, job, force=False):
        now = time.time()
        if not force and now - self.last_emit < 0.5:
            return
        self.last_emit = now
        self.driver.emit({"type": "stemSplit", "job": self._public(job)})

    def _emit_status(self, force=False):
        now = time.time()
        if not force and now - self.last_emit < 1.0:
            return
        self.last_emit = now
        self.driver.emit({"type": "stemSplitStatus", "install": dict(self.install_state, log=self.install_state["log"][-1500:]), "installed": self.command() is not None, "separator": self.separator_command() is not None})


class PedalTransfer:
    """Central Pedal Control (the editor on a Mac or an iPad) <-> this Central Pedal.

    Upload: the editor gives the pairing PIN once (begin) and gets a token, sends each file (stems, a pad's own
    sample) and then the package (the settings it picked and the songs). The app on this Central Pedal is told
    ("pedalUpload"), asks before it applies the package, reads the files back from here and keeps them.
    Download: the editor asks (export), the app here packs its settings, songs and pad samples and hands them to
    the driver, and the editor fetches the package and the files with its token."""

    TTL = 3 * 3600

    def __init__(self, driver):
        self.driver = driver
        self.root = os.path.join(driver.config["data_root"], "pedal-transfer")
        self.entries = {}
        self.lock = threading.Lock()

    def _prune(self):
        now = time.time()
        for tok, e in list(self.entries.items()):
            if now - e["made"] > self.TTL:
                self.entries.pop(tok, None)
                shutil.rmtree(os.path.join(self.root, tok), ignore_errors=True)

    def _entry(self, token, kind=None):
        e = self.entries.get(str(token or ""))
        if not e or (kind and e["kind"] != kind):
            return None
        return e

    def begin(self, payload, kind="in"):
        payload = payload or {}
        if not self.driver.code_ok(payload.get("code")):
            return 403, {"error": "That PIN is not right - it is this Central Pedal's pairing PIN (its Settings, or its screen)."}
        sender = str(payload.get("from") or "Central Pedal Control")[:60]
        is_set = kind == "in" and payload.get("mode") == "set"
        with self.lock:
            self._prune()
            old = self.entries.get(str(payload.get("resume") or ""))
            if is_set and old and old["kind"] == "in" and old.get("set") and old["from"] == sender and not old.get("applied"):
                token = str(payload["resume"])   # (the same upload again: what already arrived stays)
                old["made"] = time.time()
                old["package"] = None
            else:
                token = secrets.token_hex(16)
                self.entries[token] = {"kind": kind, "made": time.time(), "from": sender, "set": is_set, "meta": {},
                                       "files": {}, "package": None, "ready": False, "want": payload.get("want") if isinstance(payload.get("want"), list) else None}
            os.makedirs(os.path.join(self.root, token), exist_ok=True)
        if kind == "out":
            self.driver.emit({"type": "pedalExport", "token": token, "from": self.entries[token]["from"], "want": self.entries[token]["want"]})
        sync = getattr(self.driver, "sync", None)
        out = {"token": token, "name": sync.name if sync else socket.gethostname(), "appVersion": APP_VERSION}
        if is_set:
            cur = self.current_set()
            out.update({"free": self.free_bytes(), "loadedSet": self.loaded_set(), "received": self.received(token), "banks": self.bank_sizes(),
                        "have": sorted(set((cur.get("index") or {}).keys()) | set((cur.get("samples") or {}).values()))})
        return 200, out

    # ----- a set: one setlist with its tracks, pads and sounds at a time -----------------------------------------
    # Central Pedal Control keeps the songs, tracks, pads and sounds; an upload of a set replaces the one here. The
    # files arrive in pieces into this upload's own folder (nothing here changes while they come in: a dropped
    # Wi-Fi leaves the set that's here working, and pressing Upload again continues where it stopped). When the app
    # here applies it, the files go in next to the old set's, the songs switch, and only then is what the old set
    # brought (and the new one doesn't use) removed. Pedals, plugins, the free sounds and the sound libraries
    # installed here are never touched: only what an upload of a set brought is removed.
    CHUNK_MAX = 32 << 20
    MARGIN = 64 << 20   # (room left on the card after an upload)

    def set_file(self):
        return os.path.join(self.driver.config["data_root"], "current-set.json")

    def current_set(self):
        cur = read_json(self.set_file(), {})
        return cur if isinstance(cur, dict) else {}

    def free_bytes(self):
        try:
            return shutil.disk_usage(self.driver.config["data_root"]).free
        except OSError:
            return 0

    def project_now(self):
        return read_json(os.path.join(self.driver.config["data_root"], "project.json"), {})

    def loaded_set(self):
        cur = self.current_set()
        if not cur.get("at"):
            return None
        out = {k: cur.get(k) for k in ("name", "from", "at", "songs", "files", "bytes", "missing", "digest")}
        out["changed"] = bool(cur.get("changed"))
        out["rebase"] = bool(cur.get("rebase"))
        return out

    def set_state(self, payload):
        """The app here: the set's songs and pads were edited here (changed) or its digest (what "unchanged" is)."""
        cur = self.current_set()
        if not cur.get("at") or not isinstance(payload, dict):
            return 404, {"error": "no set here"}
        if payload.get("digest"):
            cur["digest"], cur["changed"], cur["rebase"] = str(payload["digest"])[:80], False, False
        if payload.get("changed") and not cur.get("changed"):
            cur["changed"] = True
            log.info("the set %r was changed on this pedal", cur.get("name"))
        write_json(self.set_file(), cur)
        self.driver.emit({"type": "loadedSet", "set": self.loaded_set()})
        return 200, {"ok": True, "set": self.loaded_set()}

    def received(self, token):
        """{file id: bytes here} for an upload (whole files and the part of one that was coming in)."""
        d = os.path.join(self.root, str(token))
        out = {}
        try:
            for f in os.listdir(d):
                if f == "package.json":
                    continue
                out[f[:-5] if f.endswith(".part") else f] = os.path.getsize(os.path.join(d, f))
        except OSError:
            pass
        return out

    def put_chunk(self, token, fid, offset, total, data, meta):
        e = self._entry(token, "in")
        if not e:
            return 403, {"error": "This upload is too old - press Upload again."}
        fid = re.sub(r"[^A-Za-z0-9_.-]", "", str(fid or ""))[:80]
        try:
            offset, total = int(offset), int(total)
        except (TypeError, ValueError):
            return 400, {"error": "offset / total"}
        if not fid or fid == "package.json" or total <= 0 or len(data) > self.CHUNK_MAX or not data:
            return 400, {"error": "empty"}
        d = os.path.join(self.root, token)
        part, final = os.path.join(d, fid + ".part"), os.path.join(d, fid)
        e.setdefault("meta", {})[fid] = {k: str(meta.get(k) or "")[:200] for k in ("kind", "name", "song", "sha")}
        if os.path.isfile(final) and os.path.getsize(final) == total:
            e["files"][fid] = final
            return 200, {"ok": True, "size": total, "done": True}
        have = os.path.getsize(part) if os.path.isfile(part) else 0
        if offset != have:
            return 409, {"error": "offset", "size": have}
        if self.free_bytes() < len(data) + self.MARGIN:
            return 507, {"error": "The Central Pedal's card is full - it has %d MB free." % (self.free_bytes() >> 20)}
        with open(part, "ab") as fh:
            fh.write(data)
        size = have + len(data)
        if size > total:
            os.remove(part)
            return 400, {"error": "more than the file's size", "size": 0}
        if size < total:
            return 200, {"ok": True, "size": size}
        sha = e["meta"][fid]["sha"]
        if re.match(r"^[0-9a-f]{64}$", sha) and file_sha256(part) != sha:
            os.remove(part)
            return 422, {"error": "the file arrived damaged - it is sent again", "size": 0}
        os.replace(part, final)
        e["files"][fid] = final
        return 200, {"ok": True, "size": size, "done": True}

    def resolve_set(self, e, package):
        """The files of a set package that this upload doesn't carry because the pedal has them already (the same
        sha-256 in the set that's here): where they are here. Returns the file ids still missing."""
        cur = self.current_set()
        index = cur.get("index") or {}
        samples = cur.get("samples") or {}
        missing = []
        for ref in (package.get("stems") or []) + (package.get("banks") or []):
            fid = str(ref.get("fid") or "")
            if fid in e["files"] and os.path.isfile(e["files"][fid]):
                continue
            path = index.get(str(ref.get("sha") or ""))
            if path and os.path.isfile(path):
                e["files"][fid] = path
                e.setdefault("reused", {})[fid] = path
            else:
                missing.append(fid)
        for ref in package.get("samples") or []:
            fid = str(ref.get("fid") or "")
            if fid in e["files"] and os.path.isfile(e["files"][fid]):
                continue
            if ref.get("sha") and samples.get(str(ref.get("sampleId"))) == ref.get("sha"):
                ref["reuse"] = True   # (the app here has that sound already)
            else:
                missing.append(fid)
        return missing

    def _place(self, folder, name, src, sha):
        """Put an arrived file into a folder under its name; the same file there already is used as it is; another
        file with that name stays, and this one gets " (2)"."""
        os.makedirs(folder, exist_ok=True)
        target = os.path.join(folder, safe_name(name))
        base, ext = os.path.splitext(target)
        n = 2
        while os.path.exists(target):
            if os.path.getsize(target) == os.path.getsize(src) and file_sha256(target) == (sha or file_sha256(src)):
                os.remove(src)
                return target
            target = "%s (%d)%s" % (base, n, ext)
            n += 1
        shutil.move(src, target)
        return target

    def set_commit(self, token):
        """The app here applies a set: its files go in next to the old set's (nothing is removed yet). Returns
        {files: {file id: path here}, bankMap: {path on the sending device: path here}, notHere: [bank names]}."""
        e = self._entry(token, "in")
        if not e or not e.get("package"):
            return 404, {"error": "the upload is gone - send it again"}
        pkg = e["package"]
        missing = self.resolve_set(e, pkg)
        if missing:
            return 409, {"error": "%d file(s) did not arrive - send the set again" % len(missing), "missing": missing}
        inst = getattr(self.driver, "instrument", None)
        sf2_dir = getattr(inst, "sf2_user_dir", None) or os.path.join(self.driver.config["data_root"], "sounds", "sf2")
        placed = dict(e.get("placed") or {})
        reused = e.get("reused") or {}
        for ref in pkg.get("stems") or []:
            fid = ref.get("fid")
            src = e["files"].get(fid)
            if fid in placed and placed[fid] and os.path.isfile(placed[fid]):
                continue
            if fid in reused or not src:
                placed[fid] = src
                continue
            sid = re.sub(r"[^A-Za-z0-9_-]", "", str(ref.get("song") or ""))[:64] or "upload"
            placed[fid] = self._place(self.driver.library.song_dir(sid), ref.get("name") or fid, src, ref.get("sha"))
        bank_map, tiers_lines = {}, []
        for ref in pkg.get("banks") or []:
            fid = ref.get("fid")
            src = e["files"].get(fid)
            if not (fid in placed and placed[fid] and os.path.isfile(placed[fid])):
                placed[fid] = src if (fid in reused or not src) else self._place(sf2_dir, ref.get("name") or (str(fid) + ".sf2"), src, ref.get("sha"))
            if placed[fid] and ref.get("path"):
                bank_map[ref["path"]] = placed[fid]
            tier = re.sub(r"[^a-z]", "", str(ref.get("tier") or ""))
            base = os.path.splitext(os.path.basename(placed[fid] or ""))[0]
            if tier and " - " in base:
                tiers_lines.append("%s|%s|set|central-set" % (base.split(" - ")[0], tier))   # (its plan still opens it here)
        if tiers_lines:
            tpath = os.path.join(sf2_dir, "tiers.txt")
            try:
                with open(tpath, encoding="utf-8") as fh:
                    have = set(line.split("|")[0] for line in fh.read().splitlines() if "|" in line)
            except OSError:
                have = set()
            new = [line for line in tiers_lines if line.split("|")[0] not in have]
            if new:
                with open(tpath, "a", encoding="utf-8") as fh:
                    fh.write("".join(line + "\n" for line in new))
        # the sounds the set uses that the pedal has already (the free ones, a library installed here): by file name
        catalog = []
        try:
            if inst is not None:
                catalog = inst.keys_catalog() if hasattr(inst, "keys_catalog") else ((inst.status() or {}).get("keysCatalog") or [])
        except Exception as error:
            log.debug("set: keys catalog: %s", error)
        by_name = {}
        for b in catalog:
            f = b.get("file") or ""
            by_name.setdefault(os.path.basename(f).lower(), f)
        not_here = []
        for path in pkg.get("bankRefs") or []:
            if path in bank_map:
                continue
            here = by_name.get(os.path.basename(str(path)).lower())
            if here:
                bank_map[path] = here
            else:
                not_here.append(os.path.basename(str(path)))
        e["placed"] = placed
        return 200, {"files": {k: v for k, v in placed.items() if v}, "bankMap": bank_map, "notHere": sorted(set(not_here))}

    def set_done(self, token, payload):
        """The app here has switched to the new set: remember it, then remove what the old set brought that nothing
        uses now. Returns the old set's pad sounds the app can drop."""
        e = self._entry(token, "in")
        if not e or not e.get("package") or e.get("placed") is None:
            return 404, {"error": "the upload is gone"}
        pkg = e["package"]
        placed = e.get("placed") or {}
        old = self.current_set()
        index = {}
        for ref in (pkg.get("stems") or []) + (pkg.get("banks") or []):
            path = placed.get(ref.get("fid"))
            if path and ref.get("sha"):
                index[str(ref["sha"])] = path
        samples = {}
        for ref in pkg.get("samples") or []:
            if ref.get("sampleId") and ref.get("sha"):
                samples[str(ref["sampleId"])] = str(ref["sha"])
        files = sorted(set(v for v in placed.values() if v))
        project = self.project_now()
        text = json.dumps(project)
        removed, drop = 0, []
        keep = set(os.path.realpath(p) for p in files)
        for path in old.get("filesList") or []:
            real = os.path.realpath(path)
            if real in keep or path in text or real in text or not os.path.isfile(real):
                continue
            try:
                if self.driver.library.inside(real):
                    self.driver.library.remove(real)
                else:
                    os.remove(real)
                removed += 1
            except OSError as error:
                log.warning("set: could not remove %s: %s", path, error)
        for sid in old.get("samples") or {}:
            if sid not in samples and sid not in text:
                drop.append(sid)
        size = 0
        for path in files:
            try:
                size += os.path.getsize(path)
            except OSError:
                pass
        info = pkg.get("set") or {}
        rec = {"name": str(info.get("name") or (pkg.get("settings") or {}).get("name") or "Set")[:80],
               "setlistId": info.get("setlistId"), "from": e["from"], "at": time.time(),
               "songs": len(pkg.get("songs") or []), "files": len(files), "bytes": size, "index": index, "samples": samples,
               "filesList": files, "missing": [str(x)[:80] for x in ((payload or {}).get("missing") or [])][:50],
               "digest": str((payload or {}).get("digest") or "")[:80], "changed": False}
        write_json(self.set_file(), rec)
        e["applied"] = True
        shutil.rmtree(os.path.join(self.root, token), ignore_errors=True)
        self.driver.emit({"type": "loadedSet", "set": self.loaded_set()})
        return 200, {"ok": True, "removed": removed, "dropSamples": drop, "set": self.loaded_set()}

    def bank_known(self, path):
        """A keys / instrument sound bank this device lists (its catalog) - the only files /set/bank hands out."""
        inst = getattr(self.driver, "instrument", None)
        if not path or inst is None:
            return None
        try:
            catalog = inst.keys_catalog() if hasattr(inst, "keys_catalog") else ((inst.status() or {}).get("keysCatalog") or [])
        except Exception:
            return None
        real = os.path.realpath(path)
        for b in catalog:
            f = b.get("file") or ""
            if f and os.path.realpath(f) == real and os.path.isfile(real):
                return dict(b, file=real)
        return None

    def bank_sizes(self):
        """{file name (lower case): bytes} of the keys / instrument sounds here - one with the same name and size
        isn't sent again."""
        inst = getattr(self.driver, "instrument", None)
        out = {}
        try:
            catalog = (inst.keys_catalog() if hasattr(inst, "keys_catalog") else ((inst.status() or {}).get("keysCatalog") or [])) if inst is not None else []
            for b in catalog:
                f = b.get("file") or ""
                if os.path.isfile(f):
                    out[os.path.basename(f).lower()] = os.path.getsize(f)
        except Exception as error:
            log.debug("set: banks: %s", error)
        return out

    def sha_cached(self, path):
        st = os.stat(path)
        key = "%s|%d|%d" % (path, st.st_size, int(st.st_mtime))
        cache = self.__dict__.setdefault("_sha", {})
        if key not in cache:
            cache[key] = file_sha256(path)
        return cache[key]

    def set_brought_back(self):
        """The set here went back to Central Pedal Control (a Download): it counts as unchanged again."""
        cur = self.current_set()
        if cur.get("at"):
            cur["changed"], cur["rebase"] = False, True   # (the app here takes what it has now as the set's content)
            write_json(self.set_file(), cur)
            self.driver.emit({"type": "loadedSet", "set": self.loaded_set()})

    def put_file(self, token, fid, name, song, kind, data, out=False):
        e = self._entry(token, "out" if out else "in")
        if not e:
            return 403, {"error": "unknown or old token"}
        fid = re.sub(r"[^A-Za-z0-9_.-]", "", str(fid or ""))[:80]
        if not fid or not data:
            return 400, {"error": "empty"}
        if kind == "stem" and not out:
            sid = re.sub(r"[^A-Za-z0-9_-]", "", str(song or ""))[:64] or "upload"
            path = self.driver.library.store(sid, name or fid, data)
        else:
            path = os.path.join(self.root, token, fid)
            with open(path + ".part", "wb") as fh:
                fh.write(data)
            os.replace(path + ".part", path)
        e["files"][fid] = path
        return 200, {"ok": True, "id": fid, "path": path}

    def commit(self, token, package):
        e = self._entry(token, "in")
        if not e:
            return 403, {"error": "unknown or old token"}
        if not isinstance(package, dict):
            return 400, {"error": "no package"}
        if e.get("set"):
            missing = self.resolve_set(e, package)
            if missing:
                return 409, {"error": "%d file(s) did not arrive" % len(missing), "missing": missing}
        e["package"] = package
        write_json(os.path.join(self.root, token, "package.json"), package)
        songs = package.get("songs") or []
        self.driver.emit({"type": "pedalUpload", "token": token, "from": e["from"], "set": (package.get("set") or {}).get("name") if e.get("set") else None, "summary": {
            "songs": [str((s or {}).get("name") or "")[:80] for s in songs][:200], "settings": [str(x) for x in (package.get("parts") or [])][:20],
            "files": len(e["files"])}})
        return 200, {"ok": True}

    def export_done(self, token, package):
        e = self._entry(token, "out")
        if not e:
            return 403, {"error": "unknown or old token"}
        e["package"] = package if isinstance(package, dict) else {}
        e["ready"] = True
        return 200, {"ok": True}

    def export_state(self, token):
        e = self._entry(token, "out")
        if not e:
            return 403, {"error": "unknown or old token"}
        if not e["ready"]:
            return 200, {"ready": False}
        return 200, {"ready": True, "package": e["package"], "files": sorted(e["files"])}

    def file_path(self, token, fid, kind=None):
        e = self._entry(token, kind)
        if not e:
            return None
        path = e["files"].get(str(fid or ""))
        if not path and kind == "out":
            # a stem from the library, named by its path in the package (only the ones the package lists)
            refs = {}
            for sg in ((e.get("package") or {}).get("songs") or []):
                for st in (((sg or {}).get("tracks") or {}).get("stems") or []):
                    for f in ([st.get("file")] if st.get("file") else []) + list(st.get("files") or []):
                        refs[f] = True
            if fid in refs and self.driver.library.inside(fid):
                path = fid
        return path if path and os.path.isfile(path) else None

    def local_package(self, token):
        e = self._entry(token, "in")
        if not e or not e.get("package"):
            return None
        return {"package": e["package"], "files": e["files"], "from": e["from"]}


class ServiceLog:
    """The service report: what the app did on each day (songs, play / stop, sections, Safe Stop, the lock, audio
    dropouts), one JSON line per event in <data>/service-log/YYYY-MM-DD.jsonl (local date), each with the Pi's
    temperature then. Kept for 120 days."""

    KEEP_DAYS = 120
    KINDS = ("song", "play", "pause", "stop", "end", "section", "jump", "vamp", "safeStop", "panic", "lock", "unlock",
             "dropout", "health", "segue", "ready", "note")

    def __init__(self, folder):
        self.folder = folder
        self.lock = threading.Lock()

    def day_of(self, t):
        return time.strftime("%Y-%m-%d", time.localtime(t))

    def add(self, event):
        if not isinstance(event, dict) or event.get("kind") not in self.KINDS:
            return False
        rec = {"kind": event["kind"]}
        try:
            t = float(event.get("t") or time.time())
        except (TypeError, ValueError):
            t = time.time()
        if abs(t - time.time()) > 7 * 86400:
            t = time.time()
        rec["t"] = round(t, 2)
        for k, v in event.items():
            if k in ("kind", "t") or not re.match(r"^[a-zA-Z]{1,16}$", str(k)):
                continue
            if isinstance(v, (int, float, bool)) or v is None:
                rec[k] = v
            elif isinstance(v, str):
                rec[k] = v[:120]
        health = pi_health_quick()
        if rec["kind"] == "health" and shutil.which("vcgencmd"):
            _code, text, _err = run(["vcgencmd", "get_throttled"], timeout=3)
            m = re.search(r"0x([0-9a-fA-F]+)", text or "")
            if m:
                bits = int(m.group(1), 16)
                health["underVoltage"] = bool(bits & 0x1)
                health["throttled"] = bool(bits & 0x6)
        for k, v in health.items():
            rec.setdefault(k, v)
        try:
            os.makedirs(self.folder, exist_ok=True)
            with self.lock, open(os.path.join(self.folder, self.day_of(t) + ".jsonl"), "a") as fh:
                fh.write(json.dumps(rec) + "\n")
        except OSError as error:
            log.debug("service log: %s", error)
            return False
        return True

    def days(self):
        try:
            names = sorted((n[:-6] for n in os.listdir(self.folder) if re.match(r"^\d{4}-\d{2}-\d{2}\.jsonl$", n)), reverse=True)
        except OSError:
            return []
        for old in names[self.KEEP_DAYS:]:
            try:
                os.remove(os.path.join(self.folder, old + ".jsonl"))
            except OSError:
                pass
        out = []
        for d in names[: self.KEEP_DAYS]:
            try:
                with open(os.path.join(self.folder, d + ".jsonl")) as fh:
                    lines = fh.read().splitlines()
                out.append({"day": d, "events": len(lines), "songs": sum(1 for l in lines if '"kind": "play"' in l)})
            except OSError:
                pass
        return out

    def get(self, day):
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(day or "")):
            return []
        out = []
        try:
            with open(os.path.join(self.folder, day + ".jsonl")) as fh:
                for line in fh:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        pass
        except OSError:
            pass
        return out


def preset_license_key(data_root):
    """A built pedal's P key, put there before it ships: <data>/license-key.txt, or pad-pedal-key.txt on the SD card's
    boot partition (build-image.sh PEDAL_KEY=..., or copied onto the card from a computer). The app offers it the first
    time it opens."""
    for p in (os.path.join(data_root, "license-key.txt"), "/boot/firmware/pad-pedal-key.txt", "/boot/pad-pedal-key.txt"):
        try:
            with open(p) as handle:
                k = re.sub(r"[^A-Za-z0-9]", "", handle.read()).upper()
            if 12 <= len(k) <= 20:
                return k
        except OSError:
            pass
    return ""


def device_id():
    """This computer's own id for its license key (the same after the app's data or the browser profile is wiped):
    a hash of the machine id - never the machine id itself."""
    for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            with open(p) as handle:
                mid = handle.read().strip()
            if mid:
                return "dev-" + hashlib.sha256(("central-pedal:" + mid).encode()).hexdigest()[:24]
        except OSError:
            pass
    try:   # (Windows, Mac: the network card's address)
        return "dev-" + hashlib.sha256(("central-pedal:%x" % uuid.getnode()).encode()).hexdigest()[:24]
    except Exception:
        return ""


def pi_health_quick():
    """Temperature (and under-voltage when vcgencmd is there) for each service-log line."""
    out = {}
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as fh:
            out["tempC"] = round(int(fh.read().strip()) / 1000, 1)
    except (OSError, ValueError):
        pass
    return out


class ServicePlan:
    """Up to 4 services (e.g. Sunday 9:00, Sunday 11:00, Wednesday, Youth), each a run order of items with
    minutes and the roles each item uses (lighting, production/cameras, slides, lyrics, mix, in-ears, band).
    The main admin edits them and runs one (Start / Next / Back / Stop). Every Central Control shows a countdown
    to the service and to its own next part; the stage display shows the service countdown.
    Kept in /data/pad-pedal/services.json."""

    MAX = 4

    def __init__(self, driver, path):
        self.driver = driver
        self.path = path
        j = read_json(path, {})
        self.services = [self.clean(x) for x in (j.get("services") or [])][:self.MAX]
        self.run = j.get("run") if isinstance(j.get("run"), dict) else None

    @staticmethod
    def clean(sv):
        sv = sv if isinstance(sv, dict) else {}
        out = {"id": re.sub(r"[^A-Za-z0-9_-]", "", str(sv.get("id") or "")) or "sv" + secrets.token_hex(4),
               "name": str(sv.get("name") or "Service").strip()[:40] or "Service",
               "day": max(0, min(6, int(sv.get("day", 0) or 0))) if str(sv.get("day", "0")).lstrip("-").isdigit() else 0,
               "time": str(sv.get("time") or "09:00") if re.match(r"^\d{1,2}:\d{2}$", str(sv.get("time") or "")) else "09:00",
               "roles": [r for r in (sv.get("roles") or list(SERVICE_ROLES)) if r in SERVICE_ROLES],
               "record": bool(sv.get("record")), "items": []}
        for it in (sv.get("items") or [])[:80]:
            if not isinstance(it, dict):
                continue
            try:
                mins = max(0.0, min(240.0, float(it.get("minutes", 5) or 0)))
            except (TypeError, ValueError):
                mins = 5.0
            out["items"].append({"id": re.sub(r"[^A-Za-z0-9_-]", "", str(it.get("id") or "")) or "it" + secrets.token_hex(4),
                                 "title": str(it.get("title") or "").strip()[:60] or "Item", "kind": it.get("kind") if it.get("kind") in SERVICE_KINDS else "other",
                                 "minutes": round(mins, 2), "roles": [r for r in (it.get("roles") or []) if r in SERVICE_ROLES and r in out["roles"]],
                                 "song": str(it.get("song") or "")[:64], "note": str(it.get("note") or "")[:120]})
        return out

    def save(self):
        write_json(self.path, {"services": self.services, "run": self.run})

    def state(self):
        return {"type": "services", "services": self.services, "run": self.run, "now": int(time.time() * 1000), "roles": list(SERVICE_ROLES), "kinds": list(SERVICE_KINDS), "max": self.MAX}

    def broadcast(self):
        st = self.state()
        for ws, info in list(self.driver.lan_clients.items()):
            if info.get("cuId") or info.get("auth"):
                self.driver.send_to(ws, st)
        self.driver.emit(st)

    def mirror(self, m):
        """The center (the main admin's Central Control) plans and runs the services; this Central Pedal keeps a copy
        for its stage display, in its own clock."""
        try:
            offset = int(m.get("now") or 0) - int(time.time() * 1000)
        except (TypeError, ValueError):
            offset = 0
        self.services = [self.clean(x) for x in (m.get("services") or [])][:self.MAX]
        run = m.get("run") if isinstance(m.get("run"), dict) else None
        if run:
            run = dict(run)
            for k in ("itemStart", "startedAt"):
                try:
                    run[k] = int(run.get(k) or 0) - offset
                except (TypeError, ValueError):
                    pass
        self.run = run
        self.mirrored = True
        self.save()
        self.broadcast()

    def handle(self, ws, m):
        action = m.get("action")
        if action == "get":
            return self.state()
        if getattr(self, "mirrored", False) and self.driver.center_link and self.driver.center_link.paired:
            return {"type": "serviceReply", "ok": False, "action": action, "error": "Services are planned on the main admin's computer now."}
        roles = self.driver.cu_roles
        if not roles.is_main(ws):
            return {"type": "serviceReply", "ok": False, "action": action, "error": "Only the main admin plans and runs services."}
        now = int(time.time() * 1000)
        if action == "save":
            lst = [self.clean(x) for x in (m.get("services") or [])]
            if len(lst) > self.MAX:
                return {"type": "serviceReply", "ok": False, "action": action, "error": "Up to %d services." % self.MAX}
            self.services = lst
            if self.run and not any(x["id"] == self.run.get("service") for x in lst):
                self.run = None
        elif action == "start":
            sv = next((x for x in self.services if x["id"] == m.get("service")), None)
            if not sv or not sv["items"]:
                return {"type": "serviceReply", "ok": False, "action": action, "error": "Pick a service with items in it."}
            self.run = {"service": sv["id"], "item": 0, "itemStart": now, "startedAt": now}
        elif action in ("next", "prev", "goto"):
            if not self.run:
                return {"type": "serviceReply", "ok": False, "action": action, "error": "No service is running."}
            sv = next((x for x in self.services if x["id"] == self.run.get("service")), None)
            n = len(sv["items"]) if sv else 0
            i = self.run["item"] + (1 if action == "next" else -1) if action != "goto" else int(m.get("item") or 0)
            if i >= n:
                self.run = None      # past the last item: the service is over
            else:
                self.run["item"] = max(0, i)
                self.run["itemStart"] = now
        elif action == "stop":
            self.run = None
        else:
            return {"type": "serviceReply", "ok": False, "action": action, "error": "Unknown action."}
        self.save()
        self.broadcast()
        return {"type": "serviceReply", "ok": True, "action": action}


CENTER_BEACON_PORT = 8097


class CenterLink:
    """Pairs this Central Pedal with the center - the MAIN ADMIN's Central Control - the same way every other device
    does: with the pairing PIN. The center then tells every Central Control where this Central Pedal is (songs,
    charts, lyrics and tracks come from here), shows its health on the main admin's Devices tab, and hands it the
    services for the stage display. The center is found by its "here is the center" broadcast (UDP 8097) or at an
    address set in /data/pad-pedal/center.json ({"address": "192.168.1.20", "port": 8095}) or CC_CENTER=host:port."""

    def __init__(self, driver, path):
        self.driver = driver
        self.path = path
        j = read_json(path, {})
        self.id = re.sub(r"[^A-Za-z0-9_-]", "", str(j.get("id") or "")) or "pedal-" + secrets.token_hex(5)
        self.address = str(j.get("address") or "").strip()
        self.port = int(j.get("port") or 8095)
        env = os.environ.get("CC_CENTER", "").strip()
        if env:
            host, _, port = env.partition(":")
            self.address, self.port = host, int(port or 8095)
        self.unpaired = bool(j.get("unpaired"))
        self.heard = {}            # "host:port" -> {host, port, name, at}
        self.ws = None
        self.connected = False
        self.paired = False
        self.state = "searching"   # searching / connecting / paired / wrongPin / needPin / removed
        self.error = ""
        self.name = ""             # the main admin's name
        self.target = None
        self.job = str(j.get("job") or "player")   # player / controller / instrument / standby (the main admin picks it)
        self.player = None         # the Central Pedal that plays (when it is not this one): {name, address, port, wsPort}
        self.peers = []            # the other Central Pedals (their songs stay the same as ours)
        self.linked = set()        # song-sync links made ("address:port")
        self.remote = None         # controller: the socket to the player
        self.remote_key = ""
        self.player_display = None
        self.pc_player = None      # 10.0: no main admin, but a linked Central Pedal Control runs the tracks - this pedal controls it
        self._save()

    def _save(self):
        write_json(self.path, {"id": self.id, "address": self.address if not os.environ.get("CC_CENTER") else "", "port": self.port, "unpaired": self.unpaired, "job": getattr(self, "job", "player")})

    def info(self):
        t = self.target or {}
        p = self.player_now() or {}
        return {"state": self.state, "name": self.name, "address": t.get("host") if self.connected else None, "port": t.get("port") if self.connected else None,
                "error": self.error, "configured": self.address or "", "job": self.job_now(),
                "player": {"name": p.get("name"), "address": p.get("address"), "online": bool(p.get("online")), "kind": p.get("kind")} if p else None,
                "remote": bool(self.remote is not None), "paired": bool(self.paired), "via": "pedal-control" if (self.pc_player and not self.paired) else ("center" if self.paired else None)}

    def job_now(self):
        """What this Central Pedal does right now: paired with a main admin, what it says; else, while a linked Central
        Pedal Control runs the tracks, the foot controller for it; on its own it plays."""
        if self.paired:
            return self.job
        return "controller" if self.pc_player else "player"

    def player_now(self):
        return self.player if self.paired else self.pc_player

    def set_pc_player(self, host):
        """The song sync found (or lost) a linked Central Pedal Control that runs the tracks."""
        if self.paired:   # (a main admin decides; Central Control's own player window is the computer then)
            host = None
        def key(h):
            return ((h or {}).get("address"), (h or {}).get("wsPort"))
        if key(host) == key(self.pc_player):
            return
        was = self.pc_player
        self.pc_player = dict(host) if host else None
        if host:
            log.info("tracks: %s (Central Pedal Control) runs the tracks - this Central Pedal controls them", host.get("name"))
        else:
            log.info("tracks: %s is gone - this Central Pedal plays the tracks again", (was or {}).get("name") or "Central Pedal Control")
        self.driver.emit({"type": "pedalRole", "job": self.job_now(), "player": self.pc_player, "center": None, "via": "pedal-control"})
        self.driver.emit(self.driver.hello())
        self.follow_player()

    def set_state(self, state, error=""):
        if state == self.state and error == self.error:
            return
        was = self.state
        self.state, self.error = state, error
        # the app hears about it when it matters (paired, a PIN problem, unpaired) - not every "looking / connecting"
        quiet = ("searching", "connecting")
        if self.driver.loop is not None and not (state in quiet and was in quiet):
            self.driver.emit(self.driver.hello())

    def listen(self):
        """The center's broadcast every 2 s (in a thread)."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):
                try:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except OSError:
                    pass
            sock.bind(("", CENTER_BEACON_PORT))
        except OSError as error:
            log.info("center: cannot listen for the main admin on udp %s (%s)", CENTER_BEACON_PORT, error)
            return
        while True:
            try:
                data, addr = sock.recvfrom(2048)
                j = json.loads(data.decode("utf-8", "replace"))
                if j.get("app") == "central-control-center" and j.get("port"):
                    self.heard["%s:%s" % (addr[0], j["port"])] = {"host": addr[0], "port": int(j["port"]), "name": str(j.get("name") or "")[:40], "at": time.time()}
            except Exception:
                time.sleep(0.5)

    def pick(self):
        if self.address:
            return {"host": self.address, "port": self.port, "name": ""}
        now = time.time()
        fresh = [h for h in self.heard.values() if now - h["at"] < 8]
        if not fresh:
            self._loop_try = not getattr(self, "_loop_try", False)
            return {"host": "127.0.0.1", "port": 8095, "name": "", "guess": True} if self._loop_try else None
        fresh.sort(key=lambda h: (h["name"] != self.name, -h["at"]))
        return fresh[0]

    def hello_message(self, action="hello"):
        d = self.driver
        m = {"type": "cuRole", "action": action, "id": self.id, "role": "pedal", "name": socket.gethostname() or "Central Pedal", "code": d.code,
             "pedal": {"addresses": ip_addresses(), "port": int(d.config["lan_port"]), "wsPort": int(d.config["lan_ws_port"]), "app": APP_VERSION}}
        if action == "join":
            m["pair"] = d.code
        return m

    def send(self, m):
        ws, loop = self.ws, self.driver.loop
        if ws is None or loop is None:
            return
        async def go():
            try:
                await ws.send(json.dumps(m))
            except Exception:
                pass
        try:
            in_loop = asyncio.get_running_loop() is loop
        except RuntimeError:
            in_loop = False
        if in_loop:
            asyncio.ensure_future(go())
        else:
            asyncio.run_coroutine_threadsafe(go(), loop)

    def pin_changed(self):
        """The person typed a (new) pairing PIN on this Central Pedal: pair again with it."""
        self.unpaired = False
        self._save()
        if self.connected and not self.paired:
            self.send(self.hello_message("join"))

    async def loop(self):
        import websockets
        threading.Thread(target=self.listen, daemon=True).start()
        while True:
            target = self.pick()
            if not target:
                self.set_state("searching")
                await asyncio.sleep(2)
                continue
            self.target = target
            if not target.get("guess"):
                self.set_state("connecting")
            try:
                ws = await asyncio.wait_for(websockets.connect("ws://%s:%s" % (target["host"], target["port"]), max_size=1 << 20), 5)
            except Exception as error:
                if not target.get("guess"):
                    log.debug("center: %s:%s not reachable (%s)", target["host"], target["port"], error)
                await asyncio.sleep(1 if target.get("guess") else 3)
                continue
            self.ws, self.connected = ws, True
            health_task = asyncio.ensure_future(self.health_loop())
            try:
                await ws.send(json.dumps({"type": "auth", "code": self.driver.code}))
                await ws.send(json.dumps(self.hello_message()))
                async for raw in ws:
                    try:
                        m = json.loads(raw)
                    except ValueError:
                        continue
                    self.on_message(m)
            except Exception as error:
                log.debug("center: link closed (%s)", error)
            finally:
                health_task.cancel()
                self.ws, self.connected, self.paired = None, False, False
                if self.state == "paired":
                    self.set_state("connecting")
                log.info("center: lost the main admin (%s:%s)", target["host"], target["port"])
            await asyncio.sleep(2)

    async def health_loop(self):
        n = 0
        while True:
            await asyncio.sleep(0.5)
            n += 1
            if self.paired and self.job == "player":
                self.send({"type": "ping", "t": int(time.time() * 1000), "beat": True})   # (a heartbeat: a backup takes over when it stops)
            if n % 10:
                continue
            if self.paired:
                h = self.driver.pedal_health()
                song = (self.driver.display or {}).get("song") or {}
                if isinstance(song, dict) and song.get("name"):
                    h["song"] = str(song.get("name"))[:50]
                h["playing"] = bool((self.driver.display or {}).get("playing"))   # (the main admin hands the tracks back only when nothing plays)
                self.send({"type": "cuRole", "action": "health", "id": self.id, "health": h})

    def on_role(self, m):
        """The main admin says what this Central Pedal does, who plays, and which other pedals there are."""
        job = m.get("job") if m.get("job") in ("player", "controller", "instrument", "standby", "backup") else "controller"
        player = m.get("player") if isinstance(m.get("player"), dict) else None
        peers = [p for p in (m.get("peers") or []) if isinstance(p, dict) and p.get("address")]
        before = (self.job, (self.player or {}).get("address"), (self.player or {}).get("online"))
        self.job, self.player, self.peers = job, player, peers
        self.paired = True
        if before != (self.job, (player or {}).get("address"), (player or {}).get("online")):
            self._save()
            log.info("center: this Central Pedal is now the %s%s", job, (" (player: %s)" % player.get("name")) if player else "")
            self.driver.emit({"type": "pedalRole", "job": job, "player": player, "center": self.name})
            self.driver.emit(self.driver.hello())
        # songs: every pedal keeps the same library (linked once with the pairing PIN; the sync does the rest)
        for p in peers:
            key = "%s:%s" % (p["address"], p.get("port") or 8080)
            if p.get("online") and key not in self.linked:
                self.linked.add(key)
                threading.Thread(target=self._link_songs, args=(p["address"], int(p.get("port") or 8080)), daemon=True).start()
        self.follow_player()
        # its audio goes to the main admin's audio host by itself (each track, click, pads, the instrument)
        if job in ("player", "instrument") and getattr(self.driver, "netaudio", None):
            self.driver.netaudio.auto_on()

    def _link_songs(self, address, port):
        try:
            sync = self.driver.sync
            if not any(q.get("address") == address and sync.group and q.get("group") == sync.group["id"] for q in sync.peers.values()):
                sync.link(address, port, self.driver.code)
                log.info("center: songs linked with %s:%s", address, port)
        except Exception as error:
            log.info("center: could not link songs with %s:%s (%s)", address, port, error)
            self.linked.discard("%s:%s" % (address, port))

    # ----- foot controller: this pedal's buttons drive the player
    def follow_player(self):
        p = self.player_now() or {}
        want = "%s:%s" % (p.get("address"), p.get("wsPort") or 8081) if self.job_now() in ("controller", "backup") and p.get("address") and p.get("online") else ""
        if want == self.remote_key:
            return
        self.remote_key = want
        old, self.remote = self.remote, None
        if old is not None and self.driver.loop is not None:
            asyncio.run_coroutine_threadsafe(old.close(), self.driver.loop) if not self._in_loop() else asyncio.ensure_future(old.close())
        if want and self.driver.loop is not None:
            coro = self.remote_loop(want)
            asyncio.run_coroutine_threadsafe(coro, self.driver.loop) if not self._in_loop() else asyncio.ensure_future(coro)

    def _in_loop(self):
        try:
            return asyncio.get_running_loop() is self.driver.loop
        except RuntimeError:
            return False

    async def remote_loop(self, key):
        import websockets
        while self.remote_key == key:
            try:
                ws = await asyncio.wait_for(websockets.connect("ws://" + key, max_size=1 << 22), 5)
            except Exception:
                await asyncio.sleep(2)
                continue
            self.remote = ws
            self.driver.emit(self.driver.hello())
            try:
                await ws.send(json.dumps({"type": "client", "app": "central-pedal", "mode": "controller", "name": socket.gethostname()}))
                await ws.send(json.dumps({"type": "auth", "code": self.remote_code()}))
                async for raw in ws:
                    if self.remote_key != key:
                        break
                    try:
                        m = json.loads(raw)
                    except ValueError:
                        continue
                    if m.get("type") == "display" and self.job == "backup":   # the backup player follows it silently
                        keep = {k: m.get(k) for k in ("songId", "playing", "pos", "countIn", "loop", "speed", "tracksMode", "duration")}
                        song = m.get("song") if isinstance(m.get("song"), dict) else {}
                        keep.update({"type": "backupFollow", "song": str(song.get("name") or "")[:80], "index": song.get("index"),
                                     "pads": [i for i, pd in enumerate(m.get("pads") or []) if isinstance(pd, dict) and pd.get("playing")][:8], "at": time.monotonic()})
                        self.driver.emit(keep)
                    if m.get("type") == "display":   # what the player is doing, for this pedal's screen
                        song = m.get("song") if isinstance(m.get("song"), dict) else {}
                        sec = m.get("section") if isinstance(m.get("section"), dict) else {}
                        nxt = m.get("next") if isinstance(m.get("next"), dict) else {}
                        self.player_display = {"type": "playerDisplay", "song": str(song.get("name") or "")[:80], "section": str(sec.get("name") or "")[:40], "next": str(nxt.get("name") or "")[:40],
                                               "playing": bool(m.get("playing")), "bpm": m.get("bpm"), "key": m.get("key"), "index": song.get("index"), "count": song.get("count")}
                        self.driver.emit(self.player_display)
            except Exception:
                pass
            finally:
                if self.remote is ws:
                    self.remote = None
                    self.driver.emit(self.driver.hello())
                    if self.job == "backup":
                        self.driver.emit({"type": "backupLost", "why": "link"})
            await asyncio.sleep(1)

    def takeover(self):
        """The backup player lost the track player mid-song: ask the main admin to make this pedal the player."""
        if self.ws is None:
            return False
        self.send({"type": "cuRole", "action": "takeover", "id": self.id})
        return True

    def remote_code(self):
        """How this pedal proves itself to the player: the main admin's pairing PIN (paired), or the song-sync link it
        shares with Central Pedal Control (that computer has its own pairing code)."""
        if self.paired or not self.pc_player:
            return self.driver.code
        g = getattr(self.driver.sync, "group", None) or {}
        return "sync:" + g.get("key", "") if g.get("key") else self.driver.code

    def forward(self, message):
        """An action from this pedal's buttons, for the player (controller job)."""
        ws = self.remote
        if ws is None:
            return False
        out = {"type": "action", "name": str(message.get("name") or "")[:40], "args": message.get("args") or {}, "code": self.remote_code()}
        for k in ("value", "delta"):
            if isinstance(message.get(k), (int, float)):
                out[k] = message[k]
        async def go():
            try:
                await ws.send(json.dumps(out))
            except Exception:
                pass
        asyncio.ensure_future(go()) if self._in_loop() else asyncio.run_coroutine_threadsafe(go(), self.driver.loop)
        return True

    def on_message(self, m):
        kind = m.get("type")
        if kind == "cuRoleReply":
            act = m.get("action")
            if act == "hello" and m.get("needPair"):
                if self.unpaired:
                    self.set_state("removed", "The main admin unpaired this Central Pedal. Type the pairing PIN again to pair.")
                elif not self.driver.code_chosen():
                    self.set_state("needPin", "Type the main admin's pairing PIN.")
                else:
                    self.send(self.hello_message("join"))
            elif act == "takeover":   # the main admin's answer to the backup player taking over
                self.driver.emit({"type": "backupTakeoverReply", "ok": bool(m.get("ok")), "error": m.get("error"), "playerAlive": bool(m.get("playerAlive"))})
            elif act == "join":
                if m.get("ok"):
                    self.paired = True
                    self.unpaired = False
                    self._save()
                    self.name = str(m.get("center") or self.name)[:40]
                    self.set_state("paired")
                    log.info("center: paired with the main admin %s", self.name)
                else:
                    self.set_state("wrongPin", str(m.get("error") or "The main admin did not accept the pairing PIN.")[:200])
        elif kind == "cuRoles":
            you = m.get("you") or {}
            if you.get("role") == "pedal":
                self.paired = True
                self.name = str(m.get("centerName") or self.name)[:40]
                self.set_state("paired")
        elif kind == "services":
            self.driver.service_plan.mirror(m)
        elif kind == "pairReady":
            if not self.paired and not self.unpaired and self.driver.code_chosen():
                self.send(self.hello_message("join"))
        elif kind == "pedalRole":
            self.on_role(m)
        elif kind == "pairCodeChanged":
            code = str(m.get("code") or "")
            if re.match(r"^\d{4}$", code) and code != self.driver.code:
                self.driver.set_code(code, from_center=True)
        elif kind == "cuRoleAssigned" and m.get("removed"):
            self.player, self.peers = None, []
            self.follow_player()
            self.paired = False
            self.unpaired = True
            self._save()
            self.set_state("removed", "The main admin unpaired this Central Pedal. Type the pairing PIN again to pair.")


class NetAudio:
    """The tracks (each stem on its own channel), click, pads, the tracks mix and the instrument go to
    Central Control over the network. The app renders the channels and sends them here as binary packets;
    the Pi adds the instrument channel, captured from its output with pw-record. Every Central Control
    that subscribed (with the pairing code) gets the packets. "ethernet" / "wifi" only serve computers
    that reach the Pi over that kind of connection; "interface" means the outputs are cabled into the
    other computer's audio interface (nothing goes over the network); "off" sends nothing.

    Packet: b"CCA1", u8 source (0 app, 1 instrument), u8 channels, u16 frames, u32 seq, f64 Pi ms,
    then frames x channels int16 little endian (interleaved)."""
    MODES = ("off", "ethernet", "wifi", "interface")
    HEADER = struct.Struct("<4sBBHId")

    def __init__(self, driver, path):
        self.driver = driver
        self.path = path
        # auto: a paired track player / instrument rig turns network audio on by itself (until it is set by hand)
        self.cfg = {"mode": "off", "rate": 48000, "instrument": True, "quality": "full", "auto": True}
        saved = read_json(path, {})
        if isinstance(saved, dict):
            self.cfg.update({k: v for k, v in saved.items() if k in self.cfg})
        self.subs = {}          # ws -> {"sources": set(), "name": str, "address": str, "dropped": int}
        self.sources = {}       # source id -> {"channels": [...], "rate": int}
        self.packets = 0
        self.bytes = 0
        self.inst = None        # pw-record process
        self.inst_error = None
        self.inst_seq = 0
        self.lock = threading.Lock()

    # ----- settings / status
    def configure(self, cfg):
        if isinstance(cfg, dict):
            if cfg.get("mode") in self.MODES:
                self.cfg["mode"] = cfg["mode"]
                self.cfg["auto"] = bool(cfg.get("auto", False))   # (set by hand: it stays as set)
            if "auto" in cfg and "mode" not in cfg:
                self.cfg["auto"] = bool(cfg["auto"])
            if cfg.get("quality") in ("full", "saver"):
                self.cfg["quality"] = cfg["quality"]
            if "instrument" in cfg:
                self.cfg["instrument"] = bool(cfg["instrument"])
            write_json(self.path, self.cfg)
        for ws in list(self.subs):   # listeners that the new setting no longer serves are told why
            error = self.allowed(ws)
            if error:
                self.driver.send_to(ws, {"type": "audioSubscribed", "ok": False, "error": error})
                self.subs.pop(ws, None)
        self.update()
        return self.status()

    def auto_on(self):
        """Paired as the track player or an instrument rig: send to the main admin, over the cable when there is one."""
        if not self.cfg.get("auto", True) or self.cfg["mode"] != "off":
            return False
        kinds = [i["kind"] for i in ip_interfaces()]
        self.cfg["mode"] = "ethernet" if "ethernet" in kinds else "wifi"
        write_json(self.path, self.cfg)
        log.info("network audio on (%s) - paired with the main admin", self.cfg["mode"])
        self.update()
        self.driver.emit(self.status())
        return True

    def refusal(self):
        mode = self.cfg["mode"]
        if mode == "off":
            return "Network audio is off on the Central Pedal (I/O tab)."
        if mode == "interface":
            return "The Central Pedal sends its audio through the audio interface (I/O tab), not the network."
        return None

    def status(self):
        ifaces = ip_interfaces()
        want = self.cfg["mode"]
        address = next((i["address"] for i in ifaces if i["kind"] == want), None)
        return {"type": "netAudio", "config": dict(self.cfg), "sending": self.sending(), "listeners": [{"name": v["name"], "address": v["address"], "dropped": v["dropped"]} for v in self.subs.values()],
                "interfaces": ifaces, "address": address, "sources": self.sources, "packets": self.packets, "bytes": self.bytes,
                "instrument": {"capturing": bool(self.inst), "error": self.inst_error}}

    def sending(self):
        return self.cfg["mode"] in ("ethernet", "wifi") and any(0 in v["sources"] for v in self.subs.values())

    def update(self):
        """Tell the app whether to send, start / stop the instrument capture."""
        self.driver.emit(self.status())
        want_inst = self.cfg["mode"] in ("ethernet", "wifi") and self.cfg["instrument"] and any(1 in v["sources"] for v in self.subs.values())
        if want_inst and not self.inst:
            self.start_instrument()
        elif not want_inst and self.inst:
            self.stop_instrument()

    # ----- who may listen
    def allowed(self, ws):
        mode = self.cfg["mode"]
        if mode not in ("ethernet", "wifi"):
            return self.refusal()
        if self.driver.config.get("simulated"):
            return None
        try:
            local = ws.local_address[0] if hasattr(ws, "local_address") else ws.transport.get_extra_info("sockname")[0]
        except Exception:
            local = None
        kinds = {i["address"]: i["kind"] for i in ip_interfaces()}
        if not any(k == mode for k in kinds.values()):
            return "The Central Pedal has no %s connection right now." % ("Ethernet" if mode == "ethernet" else "Wi-Fi")
        if local in kinds and kinds[local] != mode:
            return "Audio goes over %s only: connect to the Central Pedal's %s address." % (("Ethernet", "Ethernet") if mode == "ethernet" else ("Wi-Fi", "Wi-Fi"))
        return None

    def subscribe(self, ws, message):
        error = self.allowed(ws)
        if error:
            return {"type": "audioSubscribed", "ok": False, "error": error}
        try:
            peer = ws.remote_address[0]
        except Exception:
            peer = "?"
        sources = set(int(x) for x in (message.get("sources") or [0, 1]) if str(x).isdigit())
        self.subs[ws] = {"sources": sources, "name": str(message.get("name") or "Central Control")[:40], "address": peer, "dropped": 0}
        self.update()
        return {"type": "audioSubscribed", "ok": True, "sources": self.sources, "mode": self.cfg["mode"]}

    def unsubscribe(self, ws):
        if self.subs.pop(ws, None) is not None:
            self.update()

    # ----- the packets
    def set_info(self, message):
        names = [str(n)[:40] for n in (message.get("channels") or [])][:64]
        pans = []
        for p in (message.get("pans") or [])[:len(names)]:   # (each channel's pan: Central Control's channel starts there)
            try:
                pans.append(max(-1.0, min(1.0, round(float(p), 2))))
            except (TypeError, ValueError):
                pans.append(0.0)
        self.sources[0] = {"channels": names, "pans": pans + [0.0] * (len(names) - len(pans)), "rate": int(message.get("rate") or 48000)}
        self.broadcast_info()

    def broadcast_info(self):
        for ws in list(self.subs):
            self.driver.send_to(ws, {"type": "audioStream", "sources": self.sources})

    async def relay(self, data, source=0):
        if len(data) < self.HEADER.size or data[:4] != b"CCA1":
            return
        self.packets += 1
        for ws, sub in list(self.subs.items()):
            if source not in sub["sources"]:
                continue
            try:
                transport = getattr(ws, "transport", None)
                if transport is not None and transport.get_write_buffer_size() > 768 * 1024:
                    sub["dropped"] += 1      # this listener's network can't keep up: drop rather than lag behind
                    continue
                await ws.send(data)
                self.bytes += len(data)
            except Exception:
                self.subs.pop(ws, None)

    # ----- the instrument: captured from the Pi's output (the channel the instrument is routed to)
    def instrument_channel(self):
        routing = getattr(self.driver, "routing", None) or {}
        bus = (routing.get("buses") or {}).get("instrument") or {}
        return int(bus.get("ch") or 4)

    def start_instrument(self):
        if not shutil.which("pw-record"):
            self.inst_error = "pw-record not found (PipeWire tools)"
            return
        audio = self.driver.audio_config() if hasattr(self.driver, "audio_config") else {}
        chans = len((audio or {}).get("channels") or []) or 4
        ch = self.instrument_channel()
        if ch < 1 or ch > chans:
            self.inst_error = "the instrument is not routed to an output"
            return
        env = dict(os.environ)
        env.setdefault("XDG_RUNTIME_DIR", "/run/user/%d" % os.getuid())
        try:
            proc = subprocess.Popen(["pw-record", "--target", "padpedal_out", "--rate", "48000", "--channels", str(chans), "--format", "s16", "-"],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        except OSError as error:
            self.inst_error = str(error)
            return
        self.inst = proc
        self.inst_error = None
        self.sources[1] = {"channels": ["Instrument"], "rate": 48000}
        self.broadcast_info()
        threading.Thread(target=self.instrument_reader, args=(proc, chans, ch - 1), daemon=True).start()

    def stop_instrument(self):
        proc, self.inst = self.inst, None
        self.sources.pop(1, None)
        if proc:
            try:
                proc.terminate()
            except Exception:
                pass

    def instrument_reader(self, proc, chans, index):
        frame_bytes = chans * 2
        head = b""
        while len(head) < 12:  # pw-record writes a WAV header when the output is a pipe: skip to the data
            chunk = proc.stdout.read(12 - len(head))
            if not chunk:
                return
            head += chunk
        if head[:4] == b"RIFF":
            buf = b""
            while b"data" not in buf and len(buf) < 8192:
                chunk = proc.stdout.read(64)
                if not chunk:
                    return
                buf += chunk
            i = buf.find(b"data")
            if i < 0:
                return
            rest = buf[i + 8:]
        else:
            rest = head
        block = 1024 * frame_bytes
        pending = rest
        while self.inst is proc:
            while len(pending) < block:
                chunk = proc.stdout.read(block - len(pending))
                if not chunk:
                    self.inst_error = "the capture stopped"
                    return
                pending += chunk
            raw, pending = pending[:block], pending[block:]
            mono = bytearray(1024 * 2)   # one channel out of the interleaved frames
            mono[0::2] = raw[index * 2::frame_bytes]
            mono[1::2] = raw[index * 2 + 1::frame_bytes]
            self.inst_seq += 1
            packet = self.HEADER.pack(b"CCA1", 1, 1, 1024, self.inst_seq & 0xFFFFFFFF, time.monotonic() * 1000) + bytes(mono)
            if self.driver.loop:
                asyncio.run_coroutine_threadsafe(self.relay(packet, 1), self.driver.loop)


# ---------------------------------------------------------------------------
# The driver
# ---------------------------------------------------------------------------
class PedalDriver:
    def __init__(self, config, pin_factory=None, i2c_bus=None, fb_override=None):
        self.config = config
        self.config_path = None
        self.pin_factory = pin_factory
        self.i2c_bus = i2c_bus
        self.fb_override = fb_override
        self.clients = set()
        self.app_clients = set()    # (the app pages: the ones that send the small screen's lists)
        self.app_seen = False       # (an app page that sends them has been here: a change kept while it's away goes in when it's back)
        self.mini_pending = []      # the small screen's effects changes made while no app page was there
        self.lan_clients = {}
        self.loop = None
        self.devices = []
        self.buttons = {}        # input id -> gpiozero Button
        self.leds = {}           # led id -> {"led", "follows"}
        self.analog = []
        self.adcs = {}
        self.expander = None
        self.expander_buttons = []
        self.expander_state = 0xFFFF
        self.encoder_ok = False
        self.local = None
        self.companion = None
        self.midi = None
        self.link = None
        self.usb = None
        self.mini = None
        self.devices_dirty = True
        data_root = config["data_root"]
        self.uploads_dir = os.path.join(data_root, "uploads")
        for sub in ("stems", "sounds", "charts"):
            os.makedirs(os.path.join(self.uploads_dir, sub), exist_ok=True)
        self.charts = Charts(os.path.join(data_root, "charts"))
        self.cues = Cues(config["app_root"], data_root)
        self.library = Library(data_root)
        # (the player window inside Central Control updates with Central Control - it does not look for Pi updates)
        self.updater = sources.Updater(os.path.join(data_root, "updates.json"), APP_VERSION, os.path.join(data_root, "updates"), api=config.get("update_api")) if sources and hasattr(sources, "Updater") and os.environ.get("CC_PLAYER") != "1" and not PEDAL_CONTROL else None
        self.propresenter = sources.ProPresenter(os.path.join(data_root, "propresenter.json")) if sources and hasattr(sources, "ProPresenter") else None
        self.pco = sources.PlanningCenter(os.path.join(data_root, "sources.json"), config.get("pco_base") or "https://api.planningcenteronline.com") if sources else None
        self.instrument = instrument_host.InstrumentHost(self, data_root, config["app_root"]) if instrument_host else None
        if native_rig and (not self.instrument or not getattr(self.instrument, "available", False) or os.environ.get("CC_RIG") == "1") and native_rig.find_binary(config["app_root"]):
            self.instrument = native_rig.NativeRig(self, data_root, config["app_root"])   # Windows / macOS: no PipeWire
        self.netaudio = NetAudio(self, os.path.join(data_root, "netaudio.json"))
        self.audio_host = None        # the Central Control computer that makes the in-ear mixes: {name, address, port, ws}
        self.cu_roles = CuRoles(self, os.path.join(data_root, "cu-roles.json"))
        self.service_plan = ServicePlan(self, os.path.join(data_root, "services.json"))
        self.center_link = CenterLink(self, os.path.join(data_root, "center.json"))
        self.factory = Factory(self)
        self.phone_setup = PhoneSetup(self)
        self.service_log = ServiceLog(os.path.join(data_root, "service-log"))
        self.transfer = PedalTransfer(self)
        self.practice = PracticeMixes(self)
        self.splitter = StemSplitter(self)
        self.sync = SongSync(self)
        self.hub_dir = os.path.join(data_root, "hub")
        self.slides_dir = os.path.join(data_root, "slides")
        os.makedirs(self.hub_dir, exist_ok=True)
        os.makedirs(self.slides_dir, exist_ok=True)
        self.slide = {"type": "slide", "kind": "none"}
        self.state = {"playing": [], "selected": 0}
        self.display = {}
        self.display_sheet = None
        self.learn = None
        self.scan_devices = []
        self.analog_baseline = {}
        self.touch_calibrating = False
        self.touch_points = []
        self.mini_timer = None
        self.last_mini_render = 0.0
        self.led_states = {}
        self.led_bpm = 120.0
        self.sim = None
        self.code = self.load_code()
        self.touch_select = None
        self.tuner_view = None

    # ----- pairing code ----------------------------------------------------
    def load_code(self):
        path = os.path.join(self.config["data_root"], "code")
        try:
            with open(path) as handle:
                code = handle.read().strip()
                if re.match(r"^\d{4}$", code):
                    return code
        except OSError:
            pass
        code = "%04d" % random.randint(0, 9999)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as handle:
                handle.write(code)
        except OSError:
            pass
        return code

    def tracks_host_info(self):
        """Where the tracks run, for the app's Setlists panel: here, or on a computer this pedal controls."""
        link = getattr(self, "center_link", None)
        sync = getattr(self, "sync", None)
        me = "pedal-control" if PEDAL_CONTROL else "player" if os.environ.get("CC_PLAYER") == "1" else ("pc" if sync and sync.kind == "pc" else "pi")
        job = link.job_now() if link else "player"
        p = (link.player_now() if link else None) or {}
        controllers = sorted(set(str(c.get("name") or "a Central Pedal")[:40] for c in self.lan_clients.values() if c.get("app") == "central-pedal" and c.get("mode") == "controller" and c.get("auth")))
        return {"me": me, "plays": job == "player", "job": job, "player": {"name": p.get("name"), "kind": p.get("kind") or ("center" if link and link.paired else None), "online": bool(p.get("online"))} if job != "player" and p else None,
                "via": ("pedal-control" if link and link.pc_player and not link.paired else "center" if link and link.paired else None),
                "controllers": controllers, "oneSetlist": bool(sync and sync.stems_mode == "current"), "runTracks": bool(sync and sync.runs_tracks()),
                "keptOnlyHere": (sync.activity.get("kept", 0) if sync else 0)}

    def code_ok(self, code):
        code = str(code or "").strip()
        if code.startswith("sync:"):   # a Central Pedal linked with this one (the song sync's shared key): its foot controller
            g = getattr(getattr(self, "sync", None), "group", None) or {}
            return bool(g.get("key")) and hmac.compare_digest(code[5:], g["key"])
        return code == self.code

    def pedal_health(self):
        """The pedal's own numbers for the main admin's Devices tab."""
        out = {"app": APP_VERSION, "clients": len(self.lan_clients)}
        try:
            out["load"] = round(os.getloadavg()[0] / max(1, os.cpu_count() or 1) * 100)
        except (OSError, AttributeError):
            pass
        try:
            with open("/sys/class/thermal/thermal_zone0/temp") as fh:
                out["tempC"] = round(int(fh.read().strip()) / 1000)
        except (OSError, ValueError):
            pass
        try:
            with open("/proc/uptime") as fh:
                out["uptime"] = int(float(fh.read().split()[0]))
        except (OSError, ValueError):
            pass
        return out

    def code_chosen(self):
        return os.path.exists(os.path.join(self.config["data_root"], "code-chosen"))

    def set_code(self, pin, from_center=False):
        """The person picks the 4-digit pairing PIN (asked the first time the Central Pedal starts; Settings can
        change it). It must differ from the main admin's PIN (that one changes roles in Central Control)."""
        pin = str(pin or "").strip()
        if not re.match(r"^\d{4}$", pin):
            return {"ok": False, "error": "The PIN is 4 digits."}
        roles = getattr(self, "cu_roles", None)
        main = roles.main if roles else None
        if not from_center and main and main.get("pinHash") and _salted(pin, main.get("pinSalt", "")) == main["pinHash"]:
            return {"ok": False, "error": "Use a different PIN from the main admin's PIN (that one is for changing roles)."}
        root = self.config["data_root"]
        try:
            os.makedirs(root, exist_ok=True)
            with open(os.path.join(root, "code"), "w") as handle:
                handle.write(pin)
            with open(os.path.join(root, "code-chosen"), "w") as handle:
                handle.write("1")
        except OSError as error:
            return {"ok": False, "error": "Could not save the PIN (%s)." % error}
        changed = pin != self.code
        self.code = pin
        if changed and self.loop is not None:
            # computers paired with the old PIN and online now keep working: they get the new one
            for ws, info in list(self.lan_clients.items()):
                if info.get("auth"):
                    self.send_to(ws, {"type": "pairCodeChanged", "code": pin})
        link = getattr(self, "center_link", None)
        if link and not from_center:
            link.pin_changed()          # pair with the main admin using it
        if self.loop is not None:
            self.emit(self.hello())     # the pedal's own screen (its pairing question closes when the main admin set the PIN)
        return {"ok": True, "code": pin, "changed": changed}

    # ----- messaging ------------------------------------------------------
    def hello(self):
        return {
            "type": "hello",
            "appVersion": APP_VERSION,
            "version": VERSION,
            "inputs": self.config.get("inputs") or [],
            "reservedPins": reserved_pins(self.config),
            "screen35": screen_on(self.config),
            "screenAvailable": os.path.exists(SYSTEM_SCRIPT) or self.fb_override is not None,
            "screenOverlay": self.config.get("tft_overlay_choice") or "waveshare35a",
            "touchScreen": touch_screen_id(self.config),
            "touchKind": touch_kind(self.config),
            "soundCards": sound_cards(),
            "mouse": self.usb.pointer["mouse"] if self.usb else False,
            "keyboard": self.usb.pointer["keyboard"] if self.usb else False,
            "addresses": ip_addresses(),
            "interfaces": ip_interfaces(),
            "code": self.code,
            "codeChosen": self.code_chosen(),
            "center": self.center_link.info() if getattr(self, "center_link", None) else None,
            "pedalJob": self.center_link.job_now() if getattr(self, "center_link", None) else "player",
            "pedalControl": PEDAL_CONTROL,
            "player": os.environ.get("CC_PLAYER") == "1",
            "licenseKey": preset_license_key(self.config["data_root"]),
            "licenseState": read_json(os.path.join(self.config["data_root"], "license-state.json"), None),
            "packages": read_json(os.path.join(self.config["data_root"], "packages.json"), []),
            "loadedSet": self.transfer.loaded_set() if getattr(self, "transfer", None) else None,
            "tracksHost": self.tracks_host_info(),
            "deviceId": device_id(),
            "hostname": socket.gethostname(),
            "midi": bool(self.midi and self.midi.available),
            "midiOut": bool(self.midi and self.midi.available and self.midi.want_out),
            "link": bool(self.link and self.link.available),
            "tts": shutil.which("espeak-ng") is not None,
            "charts": shutil.which("pdftoppm") is not None,
            "lanPort": self.config["lan_port"],
            "lanWsPort": self.config["lan_ws_port"],
            "leds": sorted(self.leds),
            "adcs": ["0x%02x" % a for a, adc in self.adcs.items() if adc],
            "factory": self.factory.info() if getattr(self, "factory", None) else None,
            "phoneSetup": self.phone_setup.status() if getattr(self, "phone_setup", None) else None,
        }

    async def broadcast(self, message, lan=False):
        targets = list(self.lan_clients) if lan else list(self.clients)
        if not targets:
            return
        data = json.dumps(message)
        for ws in targets:
            try:
                await ws.send(data)
            except Exception:
                if lan:
                    self.lan_clients.pop(ws, None)
                else:
                    self.clients.discard(ws)

    MINI_FX_EDITS = ("fxValue", "fxToggle", "fxCycle")

    def mini_fx_edit(self, message):
        t = message.get("type")
        return (t == "action" and message.get("name") in self.MINI_FX_EDITS) or (t == "miniPick" and message.get("what") == "fxPresets")

    def app_page(self, ws):
        """An app page sent the small screen's lists: the effects changes kept while no app page was here go to it now."""
        if ws is None or ws in self.app_clients:
            return
        self.app_clients.add(ws)
        self.app_seen = True
        pending, self.mini_pending = self.mini_pending, []
        for m in pending:
            self.send_to(ws, m)
        if pending:
            log.info("small screen: %d effects change%s made while the app was away sent to it", len(pending), "" if len(pending) == 1 else "s")

    def emit(self, message, lan=False):
        # an effects change on the small screen while no app page is here (it plays the sound): kept, and sent when one
        # connects (a value slid several times is kept once, at its last place)
        if self.mini_fx_edit(message) and not self.app_clients and (self.app_seen or not self.clients):
            m = dict(message)
            if "from_" in m:
                m["from"] = m.pop("from_")
            same = lambda o: o.get("type") == m.get("type") and o.get("name") == m.get("name") and m.get("name") == "fxValue" and o.get("args") == m.get("args")
            self.mini_pending = [o for o in self.mini_pending if not same(o)][-40:] + [m]
            if self.mini:
                self.mini.kept_edit(m)
            return
        if self.loop is None:
            return
        if "from_" in message:
            message["from"] = message.pop("from_")
        if message.get("type") in ("control", "display", "devices"):
            log.debug("-> %s", json.dumps(message)[:200])
        else:
            log.info("-> %s", json.dumps(message)[:240])
        asyncio.run_coroutine_threadsafe(self.broadcast(message, lan), self.loop)

    def send_to(self, ws, message):
        if ws is None or self.loop is None:
            return
        asyncio.run_coroutine_threadsafe(ws.send(json.dumps(message)), self.loop)

    async def handle_client(self, ws, *_):
        self.clients.add(ws)
        log.info("app connected (%d client%s)", len(self.clients), "" if len(self.clients) == 1 else "s")
        try:
            await ws.send(json.dumps(self.hello()))
            for analog in self.analog:
                if analog.sent is not None:
                    await ws.send(json.dumps({"type": "control", "id": analog.id, "value": analog.sent}))
            if self.usb:
                self.devices_dirty = True
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):   # network audio from the app -> Central Control
                    await self.netaudio.relay(bytes(raw), 0)
                    continue
                try:
                    self.handle_app_message(json.loads(raw), ws)
                except Exception as error:
                    log.warning("bad message %r (%s)", raw[:200], error)
        finally:
            self.clients.discard(ws)
            self.app_clients.discard(ws)
            log.info("app disconnected")

    def public_audio_host(self):
        h = self.audio_host
        return {k: h[k] for k in ("name", "address", "port", "since")} if h else None

    def lan_hello(self):
        return {"type": "hello", "hostname": socket.gethostname(), "version": VERSION, "appVersion": APP_VERSION, "needsCode": True,
                "interfaces": ip_interfaces(), "netAudio": {"mode": self.netaudio.cfg["mode"], "sources": self.netaudio.sources}, "audioHost": self.public_audio_host()}

    async def handle_lan_client(self, ws, *_):
        self.lan_clients[ws] = {"auth": False, "app": None}
        try:
            await ws.send(json.dumps(self.lan_hello()))
            if self.slide.get("kind") != "none":
                await ws.send(json.dumps(self.slide))
            first = dict(self.display, type="display") if self.display else {"type": "display", "song": None}
            sheet = getattr(self, "display_sheet", None)
            if sheet and self.display and sheet.get("id") == self.display.get("songId"):
                first["sheet"] = sheet   # (the song's chart travels only when it changes: a screen that joins late gets it here)
            await ws.send(json.dumps(first))
            if getattr(self, "lan_clock", None):
                await ws.send(json.dumps(dict(self.lan_clock, type="clock")))
            async for raw in ws:
                try:
                    message = json.loads(raw)
                except Exception:
                    continue
                kind = message.get("type")
                if kind == "auth":
                    ok = self.code_ok(message.get("code"))
                    self.lan_clients[ws]["auth"] = ok
                    await ws.send(json.dumps({"type": "auth", "ok": ok}))
                elif kind == "action":
                    authed = self.lan_clients[ws]["auth"] or self.code_ok(message.get("code"))
                    if not authed:
                        await ws.send(json.dumps({"type": "auth", "ok": False}))
                    elif self.lan_clients[ws].get("app") == "central-usage" and message.get("name") not in CU_ACTIONS:
                        # only the Central Pedal itself starts, stops and moves the tracks
                        await ws.send(json.dumps({"type": "refused", "action": message.get("name"), "error": "Only the Central Pedal plays, stops and skips the tracks."}))
                    else:
                        source = "central-usage" if self.lan_clients[ws].get("app") == "central-usage" else "companion"
                        source = "controller" if self.lan_clients[ws].get("app") == "central-pedal" else source
                        act = {"type": "action", "name": message.get("name"), "args": message.get("args") or {}, "from": source}
                        for k in ("value", "delta"):
                            if isinstance(message.get(k), (int, float)):
                                act[k] = message[k]
                        self.emit(act)
                elif kind == "ping":  # clock sync: the client's t comes back with the Pi's clock
                    await ws.send(json.dumps({"type": "pong", "t": message.get("t"), "serverT": int(time.monotonic() * 1000), "clock": getattr(self, "lan_clock", None)}))
                elif kind == "client":   # who is this: {app: "central-usage", mode: admin / user, name}
                    self.lan_clients[ws]["app"] = str(message.get("app") or "")[:40]
                    self.lan_clients[ws]["mode"] = str(message.get("mode") or "")[:20]
                    self.lan_clients[ws]["name"] = str(message.get("name") or "")[:40]
                elif kind == "songWords":   # words heard in a song's vocal track (Central Control), with their times
                    authed = self.lan_clients[ws]["auth"] or self.code_ok(message.get("code"))
                    if not authed or not self.cu_roles.admin_ok(ws):
                        await ws.send(json.dumps({"type": "refused", "for": kind, "error": "Only an admin computer with the code can send lyrics."}))
                    else:
                        words = []
                        for w in (message.get("words") or [])[:6000]:
                            try:
                                words.append({"text": str(w.get("text") or "")[:60], "start": round(float(w.get("start") or 0), 3), "end": round(float(w.get("end") or w.get("start") or 0), 3)})
                            except Exception:
                                continue
                        self.emit({"type": "songWords", "song": re.sub(r"[^A-Za-z0-9_-]", "", str(message.get("song") or ""))[:64], "words": words})
                elif kind == "cuRole":
                    reply = self.cu_roles.handle(ws, message)
                    if reply:
                        await ws.send(json.dumps(reply))
                elif kind == "service":
                    if not (self.lan_clients[ws].get("auth") or self.lan_clients[ws].get("cuId")):
                        await ws.send(json.dumps({"type": "auth", "ok": False}))
                    else:
                        reply = self.service_plan.handle(ws, message)
                        if reply:
                            await ws.send(json.dumps(reply))
                elif kind in ("audioSubscribe", "audioUnsubscribe", "audioHost", "slide"):
                    authed = self.lan_clients[ws]["auth"] or self.code_ok(message.get("code"))
                    if kind == "audioUnsubscribe":
                        self.netaudio.unsubscribe(ws)
                    elif not authed:
                        await ws.send(json.dumps({"type": "auth", "ok": False, "for": kind}))
                    elif kind == "audioSubscribe":
                        await ws.send(json.dumps(self.netaudio.subscribe(ws, message)))
                    elif not self.cu_roles.admin_ok(ws):
                        await ws.send(json.dumps({"type": "refused", "for": kind, "error": "Only an admin can do that - ask the main admin."}))
                    elif kind == "audioHost":
                        self.audio_host_message(ws, message)
                    else:
                        self.set_slide(message)
        finally:
            self.cu_roles.gone(ws)
            self.lan_clients.pop(ws, None)
            self.netaudio.unsubscribe(ws)
            if self.audio_host and self.audio_host.get("ws") is ws:
                self.audio_host = None
                self.emit({"type": "audioHost", "host": None}, lan=True)

    def audio_host_message(self, ws, message):
        """One Central Control computer makes the in-ear mixes (the audio host); every other one finds it here."""
        if message.get("action") == "register":
            try:
                address = ws.remote_address[0]
            except Exception:
                address = None
            address = str(message.get("address") or address or "")[:64]
            self.audio_host = {"name": str(message.get("name") or "Central Control")[:40], "address": address, "port": int(message.get("port") or 8092), "since": int(time.time() * 1000), "ws": ws}
            codes = {k: str(message[k])[:12] for k in ("userCode", "adminCode") if message.get(k)}
            if codes:
                self.audio_host["codes"] = codes
        elif message.get("action") == "unregister" and self.audio_host and self.audio_host.get("ws") is ws:
            self.audio_host = None
        self.emit({"type": "audioHost", "host": self.public_audio_host()}, lan=True)
        self.cu_roles.push()

    def audio_host_codes(self):
        """The audio host's in-ear / admin codes - handed to each Central Control by its role, never shown to phones."""
        return (self.audio_host or {}).get("codes") or {}

    def set_slide(self, message):
        """Slides / lyrics from Central Control for a screen on the Pi (HDMI 2 set to "Slides")."""
        slide = {"type": "slide", "kind": message.get("kind") if message.get("kind") in ("none", "image", "video", "text", "lyrics", "black") else "none"}
        for key in ("file", "bgFile", "text", "title", "fit", "loop", "background", "color", "size", "align", "muted"):
            if key in message:
                slide[key] = message[key] if not isinstance(message[key], str) else message[key][:4000]
        for key in ("file", "bgFile"):
            if slide.get(key):
                slide[key] = safe_name(str(slide[key]))
        slide["t"] = int(time.time() * 1000)
        self.slide = slide
        self.emit(slide, lan=True)

    def hub_store(self, songs):
        """Songs with tracks on the Central Pedal, for Central Control (lighting songs, waveform, sections, hits)."""
        changed = []
        for song in songs if isinstance(songs, list) else []:
            sid = re.sub(r"[^A-Za-z0-9_-]", "", str(song.get("id") or ""))[:64]
            if not sid:
                continue
            path = os.path.join(self.hub_dir, sid + ".json")
            old = read_json(path, {})
            if not song.get("overview") and old.get("overview"):
                song["overview"] = old["overview"]
            song["id"] = sid
            song["updated"] = int(time.time() * 1000)
            keep = {k: v for k, v in song.items() if k != "updated"}
            if {k: v for k, v in old.items() if k != "updated"} != keep:
                write_json(path, song)
                changed.append(sid)
        if changed:
            self.emit({"type": "hub", "changed": changed}, lan=True)
        return changed

    def hub_listing(self):
        out = []
        for name in sorted(os.listdir(self.hub_dir)):
            if name.endswith(".json"):
                j = read_json(os.path.join(self.hub_dir, name), {})
                if j.get("id"):
                    out.append({k: j.get(k) for k in ("id", "name", "key", "bpm", "bpb", "duration", "updated", "hasTracks")})
        return out

    def handle_app_message(self, message, ws=None):
        kind = message.get("type")
        if kind == "role":
            self.send_to(ws, self.hello())
            self.devices_dirty = True
        elif kind == "state":
            playing = message.get("playingAll")
            if playing is None:
                p = message.get("playing", -1)
                playing = [] if not isinstance(p, int) or p < 0 else [p]
            self.state["playing"] = [int(i) for i in playing]
            self.state["selected"] = int(message.get("selected", 0))
        elif kind == "factory" and getattr(self, "factory", None):
            self.factory.handle(message, ws)
        elif kind == "pairCode":
            result = self.set_code(message.get("pin"))
            self.send_to(ws, dict(result, type="pairCodeReply"))
            if result.get("ok"):
                log.info("pairing PIN set by the user")
                self.emit(self.hello())
        elif kind == "backupTakeover":   # the backup player took over (js/backup.js)
            ok = self.center_link.takeover()
            self.send_to(ws, {"type": "backupTakeoverSent", "ok": bool(ok)})
        elif kind == "forwardAction":   # a foot controller's button, for the Central Pedal that plays
            if not self.center_link.forward(message):
                self.send_to(ws, {"type": "forwardFailed", "name": message.get("name"), "error": "Not connected to the Central Pedal that plays."})
        elif kind == "tracksHost":   # 10.0: Central Pedal Control runs the tracks for a linked pedal (on by default)
            if message.get("action") == "set" and PEDAL_CONTROL:
                self.config["run_tracks"] = bool(message.get("on"))
                self.save_config()
                self.sync.emit_status()
            self.send_to(ws, dict(self.tracks_host_info(), type="tracksHost"))
        elif kind == "miniMirror":
            self.mini_mirror(message)
        elif kind == "touchSelect":
            # what a touch-select knob holds right now (shown on the 3.5" screen)
            self.touch_select = {k: message.get(k) for k in ("knob", "label", "value", "pickup")} if message.get("label") else None
            self.schedule_mini_render()
        elif kind == "serviceLog":   # the service report (js/report.js)
            action = message.get("action")
            if action == "add":
                for ev in (message.get("events") or [])[:200]:
                    self.service_log.add(ev)
            elif action == "days":
                self.send_to(ws, {"type": "serviceLogDays", "days": self.service_log.days()})
            elif action == "get":
                self.send_to(ws, {"type": "serviceLogDay", "day": message.get("day"), "events": self.service_log.get(message.get("day"))})
        elif kind == "serviceLock":   # the LIVE screen's service lock: shown on the small screen
            self.service_lock = bool(message.get("on"))
            self.schedule_mini_render()
        elif kind == "packages":   # the sound plan packages: kept with the pedal, so the app, Pedal Control and both small screens see the same ones
            path = os.path.join(self.config["data_root"], "packages.json")
            if message.get("action") == "save":
                items = clean_packages(message.get("packages"))
                write_json(path, items)
                self.emit({"type": "packages", "packages": items}, lan=True)
                self.schedule_mini_render(force=True)
            else:
                self.send_to(ws, {"type": "packages", "packages": read_json(path, [])})
        elif kind in ("miniList", "miniPush"):   # the small screen's lists (effects, scenes, sounds, boards, controls…), from the app
            self.app_page(ws)
            if self.mini:
                if kind == "miniPush":   # (sent when the app connects and whenever a list changes: the screen never waits)
                    for key, value in (message.get("lists") or {}).items():
                        if isinstance(value, dict):
                            self.mini.lists[str(key)] = {k: v for k, v in value.items() if k != "kind"}
                else:
                    what = str(message.get("what") or "") + (":" + str(message["kind"]) if message.get("kind") else "")
                    self.mini.lists[what] = {k: v for k, v in message.items() if k not in ("type", "what", "kind")}
                self.mini.save_lists()
                self.schedule_mini_render(force=True)
        elif kind == "miniResult":
            if self.mini and message.get("text"):
                self.mini.say(str(message["text"])[:120])
                self.schedule_mini_render(force=True)
        elif kind == "tunerView":
            self.tuner_view = {k: message.get(k) for k in ("note", "cents", "on")} if message.get("on") else None
            self.schedule_mini_render()
        elif kind == "display":
            # the heavy parts (beat grid, hits) only travel when they change; keep the last ones for late joiners
            prev = self.display or {}
            if "sheet" in message:
                self.display_sheet = message.get("sheet")   # (charts, lyrics, sections for every chart screen)
            if "grid" not in message and prev.get("songId") == message.get("songId"):
                for k in ("grid", "hits"):
                    if k in prev:
                        message[k] = prev[k]
            self.display = message
            self.emit(message, lan=True)
            self.schedule_mini_render()
        elif kind == "miniTheme":
            # Settings → Colours in the app: the 3.5" screen uses the same colours (None: our own look)
            colors = message.get("colors") if isinstance(message.get("colors"), dict) else None
            if colors != self.config.get("mini_theme"):
                if colors:
                    self.config["mini_theme"] = {k: str(v)[:9] for k, v in colors.items() if isinstance(k, str)}
                else:
                    self.config.pop("mini_theme", None)
                self.save_config()
            if self.mini and self.mini.set_theme(self.config.get("mini_theme")):
                self.schedule_mini_render(True)
        elif kind == "leds":
            self.led_states = message.get("states") or {}
            if message.get("bpm"):
                self.led_bpm = float(message["bpm"])
            self.update_leds()
        elif kind == "inputs":
            if isinstance(message.get("inputs"), list) and message["inputs"]:
                self.config["inputs"] = message["inputs"]
                if message.get("save", True):
                    self.save_config()
                self.reload_hardware()
                self.send_to(ws, self.hello())
        elif kind == "learn":
            self.start_learn(message.get("target"), message.get("kind"), bool(message.get("allowKeyboard")))
            self.send_to(ws, {"type": "learning", "target": message.get("target")})
        elif kind == "learnCancel":
            self.stop_learn()
        elif kind == "system":
            self.system_action(message, ws)
        elif kind == "link":
            if self.link:
                self.link.configure(bool(message.get("enabled")), message.get("bpm"), message.get("playing"))
                self.emit(dict(self.link.status(), type="linkStatus"))
        elif kind == "netAudio":
            action = message.get("action")
            if action == "info":
                self.netaudio.set_info(message)
            elif action == "config":
                self.send_to(ws, self.netaudio.configure(message.get("config")))
            else:
                self.send_to(ws, self.netaudio.status())
        elif kind == "hub":
            self.hub_store(message.get("songs"))
            if message.get("remove"):
                for sid in message["remove"]:
                    sid = re.sub(r"[^A-Za-z0-9_-]", "", str(sid))[:64]
                    if sid and os.path.exists(os.path.join(self.hub_dir, sid + ".json")):
                        os.remove(os.path.join(self.hub_dir, sid + ".json"))
        elif kind == "midiClock":
            if self.midi:
                self.midi.set_clock(message.get("bpm"), message.get("running"))
            # Central Control (lighting computers) generate their own MIDI clock from this
            self.lan_clock = {"bpm": message.get("bpm"), "running": bool(message.get("running")), "t": int(time.monotonic() * 1000)}
            self.emit(dict(self.lan_clock, type="clock"), lan=True)
        elif kind == "midiLed":
            # a learned MIDI button's light (control-surface.js): back to the device it came from, never to the lights
            if self.midi:
                for m in message.get("messages") or []:
                    self.midi.send_bytes(m.get("data") or [], m.get("port") or None)
        elif kind == "midiOut":
            if self.midi:
                self.midi.send_messages(message.get("messages") or [])
            # the same notes (hits for the lights, section notes, program changes) go to Central Control
            # with the Pi's clock so they can be lined up on the other computer: `at` is ms from `t`
            if self.lan_clients:
                self.emit({"type": "midi", "messages": message.get("messages") or [], "t": int(time.monotonic() * 1000)}, lan=True)
        elif kind == "updates":
            up = self.updater
            action = message.get("action")
            if not up:
                self.send_to(ws, {"type": "updateStatus", "error": "not available"})
            elif action == "config":
                self.send_to(ws, up.save(message.get("config") or {}))
            elif action in ("check", "opened"):
                if action == "opened" and not up.cfg.get("auto"):
                    self.send_to(ws, up.status())
                    return
                def job():
                    up.busy = True
                    st = up.check()
                    up.busy = False
                    self.emit(dict(st, busy=False))
                threading.Thread(target=job, daemon=True).start()
            elif action == "install":
                def install():
                    up.busy = True
                    self.emit(up.status())
                    try:
                        if not up.latest:
                            up.check()
                        path = up.download()
                        res = self.software_update(path)
                        if not res.get("ok"):
                            up.error = res.get("error")
                    except Exception as error:
                        up.error = str(error)[:200]
                    up.busy = False
                    self.emit(up.status())
                threading.Thread(target=install, daemon=True).start()
            else:
                self.send_to(ws, up.status())
        elif kind == "propresenter":
            pp = self.propresenter
            action = message.get("action")
            if not pp:
                self.send_to(ws, {"type": "propresenterStatus", "ok": False, "error": "not available"})
            elif action == "config":
                pp.save(message.get("config") or {})
                threading.Thread(target=lambda: self.send_to(ws, pp.test()), daemon=True).start()
            elif action == "test":
                threading.Thread(target=lambda: self.send_to(ws, pp.test()), daemon=True).start()
            elif action == "status":
                self.send_to(ws, pp.status())
            else:
                pp.submit(message)
        elif kind == "instrument":
            if self.instrument:
                self.instrument.handle(message, lambda reply: self.send_to(ws, reply))
            elif ws is not None:
                self.send_to(ws, {"type": "instrumentStatus", "available": False, "error": "instrument host not available on this system", "inputs": [], "midiInputs": [], "keysCatalog": []})
        elif kind == "routing":
            self.routing = message.get("routing") or {}
            if self.instrument:
                self.instrument.handle({"action": "routing", "routing": self.routing}, lambda r: None)
        elif kind == "sim" and self.sim:
            self.sim.apply(message)
        elif kind == "hardware":
            action = message.get("action")
            if action == "calibrateTouch":
                self.start_touch_calibration()
            elif action == "touchTest":
                self.start_touch_test()
            elif action == "get":
                self.send_to(ws, {"type": "hardware", "config": self.config})
            elif action == "save":
                for key, value in (message.get("config") or {}).items():
                    if key in ("leds", "expander", "mini_screen", "debounce_s", "hold_s", "tft_overlay_choice"):
                        self.config[key] = value
                self.save_config()
                self.reload_hardware()
                self.send_to(ws, {"type": "hardware", "config": self.config, "saved": True})

    # ----- uploads ----------------------------------------------------------
    def install_sound_zip(self, name, data):
        """Unpack a sound zip safely (names flattened, sizes capped) and add it to the keys sounds: every .sf2 inside, else
        one bank built from the WAVs named by note."""
        base = re.sub(r"[^\w.\- ]+", "", os.path.splitext(os.path.basename(name or "Sound"))[0])[:40] or "Sound"
        added, total = [], 0
        with zipfile.ZipFile(io.BytesIO(data)) as zf, tempfile.TemporaryDirectory(prefix="ct-sound-") as tmp:
            for zi in zf.infolist():
                fn = os.path.basename(zi.filename)
                if zi.is_dir() or not fn or fn.startswith((".", "_")) or not fn.lower().endswith((".sf2", ".sf3", ".wav")):
                    continue
                total += zi.file_size
                if zi.file_size > 600 * 1024 * 1024 or total > 1200 * 1024 * 1024:
                    raise ValueError("that sound is too big to unpack")
                if fn.lower().endswith((".sf2", ".sf3")):
                    added.append(self.instrument.add_sf2(base + " - " + fn, zf.read(zi))["file"])
                else:
                    with zf.open(zi) as src, open(os.path.join(tmp, re.sub(r"[^\w#.\- ]+", "", fn)), "wb") as out:
                        shutil.copyfileobj(src, out)
            if not added:
                info = self.instrument.add_wav_bank(base, tmp)
                return {"file": info["file"], "banks": 1, "samples": info.get("samples", 0)}
        return {"file": added[-1], "banks": len(added)}

    def handle_upload(self, kind, name, song, data, announce=True):
        kind = kind if kind in UPLOAD_KINDS else "stems"
        name = safe_name(name)
        if kind == "sf2":
            if not self.instrument:
                return {"error": "instrument host not available"}
            try:
                info = self.instrument.add_sf2(name, data)
            except ValueError as error:
                return {"error": str(error)}
            if announce:  # the Instrument tab's sound list refreshes itself
                try:
                    self.emit(self.instrument.status())
                except Exception:
                    pass
            return {"ok": True, "kind": "sf2", "name": name, "presets": info["presets"], "file": info["file"]}
        if kind == "soundzip":   # a Central Tracks "Sound": a zip with .sf2 banks, or WAVs named by note (C4.wav…) -> a keys / instrument bank
            if not self.instrument:
                return {"error": "instrument host not available"}
            try:
                info = self.install_sound_zip(name, data)
            except (ValueError, OSError, zipfile.BadZipFile) as error:
                return {"error": str(error)}
            if announce:
                try:
                    self.emit(self.instrument.status())
                except Exception:
                    pass
            return dict(info, ok=True, kind="soundzip", name=name)
        if kind == "charts":
            info = self.charts.from_file(name, data)
            result = {"ok": True, "kind": "charts", "name": name, "song": song, "chart": info}
            if announce:
                self.emit({"type": "uploaded", "kind": "charts", "name": name, "song": song, "chart": info})
            return result
        target = os.path.join(self.uploads_dir, kind, name)
        base, ext = os.path.splitext(target)
        n = 1
        while os.path.exists(target):
            n += 1
            target = "%s (%d)%s" % (base, n, ext)
        with open(target + ".part", "wb") as handle:
            handle.write(data)
        os.replace(target + ".part", target)
        result = {"ok": True, "kind": kind, "name": os.path.basename(target), "path": target, "song": song, "size": len(data)}
        if announce:
            self.emit({"type": "uploaded", "kind": kind, "name": os.path.basename(target), "path": target, "song": song})
        return result

    # ----- system ---------------------------------------------------------
    def source_action(self, path, payload):
        """Planning Center and track-pack imports; files land in the song's library folder."""
        if path == "/pco/connect":
            self.pco.save(payload.get("appId"), payload.get("secret"))
            try:
                me = self.pco.me()
            except ValueError:
                self.pco.forget()
                raise
            return dict(me, ok=True)
        if path == "/pco/forget":
            self.pco.forget()
            return {"ok": True}
        if path == "/pco/import":
            item = payload.get("item") or {}
            song_dir = self.library.song_dir(payload.get("song") or item.get("title") or "song")
            arr = self.pco.arrangement(item.get("songId"), item.get("arrangementId")) if item.get("songId") and item.get("arrangementId") else {}
            title = item.get("title") or "Song"
            head = ["{title: %s}" % title]
            if item.get("key"):
                head.append("{key: %s}" % item["key"])
            if item.get("bpm"):
                head.append("{tempo: %d}" % round(float(item["bpm"])))
            if item.get("meter"):
                head.append("{time: %s}" % item["meter"])
            chart = None
            text = arr.get("chord_chart") or arr.get("lyrics") or ""
            if text.strip():
                chart = self.charts.from_text(title, "\n".join(head) + "\n\n" + text)
            atts = self.pco.attachments(item["songId"], item["arrangementId"]) if item.get("songId") and item.get("arrangementId") else []
            want = payload.get("attachments")
            if want is None:  # default: the stems (not the full mix unless it is all there is), and a PDF chart when there is no text one
                stems = [a for a in atts if not a["name"].lower().endswith(".pdf")]
                real = [a for a in stems if not a["fullMix"]]
                want = [a["id"] for a in (real or stems)] if payload.get("audio", True) else []
                if not chart:
                    want += [a["id"] for a in atts if a["name"].lower().endswith(".pdf")][:1]
            files, pdf_charts = [], []
            for a in atts:
                if a["id"] not in want:
                    continue
                target = os.path.join(song_dir, safe_name(a["name"]))
                self.pco.download(a["id"], target)
                if a["name"].lower().endswith(".pdf"):
                    with open(target, "rb") as handle:
                        info = self.charts.from_file(a["name"], handle.read())
                    pdf_charts.append(info)
                    if not chart:
                        chart = info
                else:
                    files.append({"path": target, "name": a["name"], "role": a["role"]})
            return {"ok": True, "title": title, "key": item.get("key"), "bpm": item.get("bpm"), "bpb": item.get("bpb"), "sequence": arr.get("sequence") or item.get("sequence") or [],
                    "chart": chart, "files": files, "attachments": atts, "pdfCharts": pdf_charts}
        if path in ("/pack/scan", "/pack/import", "/pack/scanMany"):
            ok, real = self.local.allowed(payload.get("path") or "") if self.local else (False, "")
            if not ok or not os.path.exists(real):
                raise ValueError("that file or folder is not on a USB stick / SD card / the uploads")
            if path == "/pack/scan":
                return sources.scan_pack(real)
            if path == "/pack/scanMany":
                return sources.scan_many(real)
            info = sources.import_pack(real, self.library.song_dir(payload.get("song") or "pack"), payload.get("members"))
            charts = []
            for c in info["chartFiles"]:
                try:
                    with open(c["path"], "rb") as handle:
                        charts.append(self.charts.from_file(c["name"], handle.read()))
                except Exception as error:  # an unreadable chart doesn't stop the stems
                    log.warning("chart %s: %s", c["name"], error)
            info["chartInfos"] = charts
            return info
        raise ValueError("unknown")

    def update_loop(self):
        """Once a day: look for a newer release (the app also asks for a look every time it opens). Only looks -
        the app asks "Update now?" and installs only on Yes."""
        time.sleep(60 if not self.sim else 5)
        while True:
            try:
                if self.updater.due():
                    st = self.updater.check()
                    if st.get("available"):
                        log.info("update available: %s", st.get("latest"))
                    self.emit(st)
            except Exception as error:
                log.debug("update check: %s", error)
            time.sleep(300)   # due() decides: once a day, or 10 minutes after a failed look

    def software_update(self, zip_path):
        """Install a central-control-source zip from a USB stick: the root helper copies the files
        into /opt/pad-pedal (and into the read-only system partition when safe mode is on), then the
        driver restarts itself and the app reloads. On a PC (simulation) it only reports what it would do."""
        if self.sim or not os.path.exists("/usr/local/sbin/pad-pedal-system") or not os.path.isdir("/etc/pad-pedal"):
            return {"ok": False, "error": "software updates from USB work on the Central Pedal itself"}
        self.emit({"type": "update", "state": "installing"})
        code, out, err = run(["sudo", "-n", "/usr/local/sbin/pad-pedal-system", "update", zip_path], timeout=600)
        if code != 0:
            self.emit({"type": "update", "state": "failed", "message": (err or out).strip()[-400:]})
            return {"ok": False, "error": (err or out).strip()[-400:] or "update failed"}
        self.emit({"type": "update", "state": "done", "message": out.strip()[-400:]})
        threading.Timer(2.0, lambda: run(["sudo", "-n", "/usr/local/sbin/pad-pedal-system", "restart-app"], timeout=30)).start()
        return {"ok": True, "message": out.strip()[-400:]}

    def usb_audio_cards(self):
        """The USB audio interfaces plugged in now (from /proc/asound/cards)."""
        return sorted(c.split(" ", 1)[1].split(" - ", 1)[-1].strip() for c in sound_cards() if "USB-Audio" in c)

    def audio_devices_changed(self):
        """A USB interface plugged in (or out) since the screens started: its outputs are used once the screens restart
        (the combined output is made when they start). None when nothing changed."""
        now = self.usb_audio_cards()
        planned = [c.get("desc") or c.get("name") or "" for c in self.audio_config().get("cards") or [] if c.get("kind") == "usb"]
        if bool(now) == bool(planned) and len(now) == len(planned):
            return None
        return {"type": "audioDevicesChanged", "usb": now, "inUse": planned,
                "message": ("%s is plugged in: restart the screens to use its outputs (from 5 up)." % now[0]) if now and not planned else
                           ("The USB interface is unplugged: restart the screens to go back to the jack and the DAC board.") if planned and not now else
                           "The USB interfaces changed: restart the screens to use them."}

    def watch_audio_devices(self):
        if not os.path.exists(SYSTEM_SCRIPT):
            return
        time.sleep(20)
        last = None
        tick = 0
        while True:
            tick += 1
            if tick % 3 == 1:   # (every ~12 s: the app's sound stays on the combined output - see steer_app_audio)
                try:
                    steer_app_audio()
                except Exception as error:
                    log.debug("sound steer: %s", error)
            try:
                ch = self.audio_devices_changed()
                key = json.dumps(ch, sort_keys=True) if ch else None
                if key != last and self.loop is not None:
                    last = key
                    self.loop.call_soon_threadsafe(self.emit, ch or {"type": "audioDevicesChanged", "usb": self.usb_audio_cards(), "settled": True})
            except Exception as error:
                log.debug("audio devices: %s", error)
            time.sleep(4)

    def audio_config(self):
        cfg = read_json(os.path.join(self.config["data_root"], "audio.json"), {"hdmi": False, "usbFirst": False})
        chans = read_json(os.path.join(self.config["data_root"], "audio-channels.json"), {})
        cfg["channels"] = chans.get("channels") or []
        cfg["cards"] = chans.get("cards") or []
        return cfg

    def refresh_screen_lines(self, config_txt=None):
        """A card made before its screen's config.txt lines changed (9.8: the 3.5" screen updates 50 times a second,
        not 20) gets the new lines - they take effect at the next start. Only the same screen's own block is touched.
        True = rewritten, False = already current, None = nothing to do here."""
        c = self.config
        if config_txt is None and (c.get("simulated") or not os.path.exists(SYSTEM_SCRIPT)):
            return None
        sid = touch_screen_id(c)
        s = screen_by_id(c.get("app_root"), sid) if sid != "off" else None
        if not s or s.get("kind") != "spi":
            return None
        path = config_txt or next((p for p in ("/boot/firmware/config.txt", "/boot/config.txt") if os.path.isfile(p)), None)
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except (OSError, TypeError):
            return None
        m = re.search(r"^# central-pedal-screen begin\n(.*?)^# central-pedal-screen end$", text, re.M | re.S)
        if not m:
            return None
        have = [ln.strip() for ln in m.group(1).splitlines() if ln.strip() and ln.strip() != "[all]"]
        want = list(s.get("config") or [])
        if have == want:
            return False
        overlays = lambda lines: [re.split(r"[:,]", ln[len("dtoverlay="):])[0] for ln in lines if ln.startswith("dtoverlay=")]
        if overlays(have) != overlays(want):
            return None   # (another screen's lines, or edited by hand: left alone)
        if config_txt is None:
            ok = run_privileged(SYSTEM_SCRIPT, "screen", sid)
            log.info("touch screen %s: config.txt lines brought up to date%s", sid, " (next start)" if ok else " - failed")
        return True

    def auto_touch_screen(self, wait=8.0):
        """A Pi with nothing on HDMI or the ribbon port, and no touch screen picked yet, most likely has the common 3.5"
        GPIO screen - which stays white until its driver is on. Turn that one on (once) and restart. Picking a screen
        (or "None") in Settings → Touch screen always wins."""
        c = self.config
        if c.get("simulated") and not os.environ.get("CC_DRM_DIR"):
            return None
        if c.get("touch_screen") or screen_on(c) or c.get("touch_screen_auto"):
            return None
        if not os.path.exists(SYSTEM_SCRIPT) and not os.environ.get("CC_DRM_DIR"):
            return None
        time.sleep(wait)   # (an HDMI monitor can take a moment to answer)
        ports = display_connectors(os.environ.get("CC_DRM_DIR", "/sys/class/drm"))
        if not ports["seen"] or ports["hdmi"] or ports["dsi"]:
            return None
        sid = "rpi35-xpt2046"
        c["touch_screen_auto"] = sid
        self.save_config()
        result = self.set_touch_screen(sid)
        log.info("no screen on HDMI or the ribbon port: turned on the 3.5\" GPIO screen (%s): %s", sid, result)
        if result.get("ok") and not c.get("simulated"):
            run_privileged("/usr/sbin/shutdown", "-r", "now")
        return result

    def set_touch_screen(self, sid):
        """Settings → Touch screen: the screen's config.txt lines (and the maker's driver, downloaded), its touch panel,
        and what HDMI 1 shows. Takes effect after a restart."""
        s = screen_by_id(self.config.get("app_root"), sid) if sid != "off" else None
        if sid != "off" and not s:
            return {"ok": False, "error": "Unknown screen."}
        if os.path.exists(SYSTEM_SCRIPT):
            code, out, err = run(["sudo", "-n", SYSTEM_SCRIPT, "screen", sid], timeout=120)
            if code != 0:
                text = (err or out).strip().splitlines()
                msg = text[-1] if text else "The screen could not be set."
                if code == 4:
                    msg = "Could not download this screen's driver - connect the Central Pedal to the internet (Wi-Fi or a cable) and try again."
                return {"ok": False, "error": msg}
        elif not self.config.get("simulated"):
            return {"ok": False, "error": "Touch screens are set on the Central Pedal (Raspberry Pi) itself."}
        kind = (s or {}).get("kind", "off")
        self.config["touch_screen"] = sid
        if sid != "off":
            self.config["touch_screen_last"] = sid
        if kind == "spi":
            self.config["tft_overlay"] = sid
            mini = dict(self.config.get("mini_screen") or {})
            mini["touch"] = s.get("touch") or ""
            if s.get("calibration"):
                mini["calibration"] = s["calibration"]
            mini["fb_size"] = s.get("res") or [480, 320]
            self.config["mini_screen"] = mini
        else:
            self.config["tft_overlay"] = "none"
        self.config["touch_screen_pending"] = boot_id()
        self.save_config()
        # the screens: HDMI 1 shows a copy of a small touch screen; an HDMI / ribbon touch screen is screen 1 itself
        cfg = self.displays_config()
        cfg["touchKind"] = kind
        if kind != "spi" and cfg.get("hdmi1") in ("touch", "mini"):
            cfg["hdmi1"] = "app"   # (a small GPIO screen leaves HDMI 1 on the app: Settings → Screens can show a copy)
        write_json(os.path.join(self.config["data_root"], "displays.json"), cfg)
        log.info("touch screen: %s (%s) - after a restart", sid, kind)
        return {"ok": True, "screen": sid, "kind": kind, "name": (s or {}).get("name", "No touch screen"), "restart": True}

    def displays_config(self):
        path = os.path.join(self.config["data_root"], "displays.json")
        d = read_json(path, {"hdmi2": "lyrics", "cursor": "auto"})
        if (d.get("v") or 1) < 2:
            # (before 9.3.6 picking a small GPIO screen switched HDMI 1 to a copy of it - with no way back to Settings
            # when the small screen didn't come on. HDMI 1 shows the app again; the copy stays one pick away.)
            if d.get("hdmi1") in ("touch", "mini"):
                d["hdmi1"] = "app"
            d["v"] = 2
            if os.path.exists(path):
                write_json(path, d)
        if not d.get("hdmi1"):
            d["hdmi1"] = "app"
        d.setdefault("touchKind", touch_kind(self.config))
        return d

    def system_status(self):
        return {
            "type": "systemStatus",
            "version": VERSION,
            "hostname": socket.gethostname(),
            "addresses": ip_addresses(),
            "code": self.code,
            "safeMode": safe_mode_active(),
            "safeModeNext": safe_mode_configured(),
            "safeModePending": safe_mode_configured() != safe_mode_active(),
            "safeModeAvailable": os.path.exists(SYSTEM_SCRIPT),
            "midiPorts": self.midi.ports() if self.midi else {"inputs": [], "outputs": []},
            "link": self.link.status() if self.link else {"available": False, "peers": 0},
            "screen35": screen_on(self.config),
            "screenAvailable": os.path.exists(SYSTEM_SCRIPT),
            "screenOverlay": self.config.get("tft_overlay_choice") or "waveshare35a",
            "touchScreen": touch_screen_id(self.config),
            "touchKind": touch_kind(self.config),
            "touchScreens": screens_catalog(self.config.get("app_root")),
            "touchScreenPending": bool(self.config.get("touch_screen_pending")) and self.config.get("touch_screen_pending") == boot_id(),
            "miniScreen": bool(self.mini and self.mini.available and self.mini.fb_present()),
            "miniTouch": getattr(self.mini, "touch_name", None) if self.mini else None,
            "framebuffers": framebuffers(),
            "audio": self.audio_config(),
            "soundCards": sound_cards(),
            "displays": self.displays_config(),
            "connectedDisplays": connected_displays(),
            "screens": read_json(os.environ.get("CC_SCREENS", "/tmp/central-control-screens.json"), None),
            "i2sDac": bool(self.config.get("i2s_dac", True)),
            "lanPort": self.config["lan_port"],
            "companion": "http://%s.local:%s/" % (socket.gethostname(), self.config["lan_port"]),
            "charts": shutil.which("pdftoppm") is not None,
            "tts": shutil.which("espeak-ng") is not None,
            "interfaces": ip_interfaces(),
            "netAudio": self.netaudio.status(),
            "audioHost": self.public_audio_host(),
            "centralUsage": [{"name": v.get("name") or "Central Control", "mode": v.get("mode") or ""} for v in self.lan_clients.values() if v.get("app") == "central-usage"],
            "health": pi_health(self.config["data_root"]),
            "center": self.center_link.info() if getattr(self, "center_link", None) else None,
            "phoneSetup": self.phone_setup.status() if getattr(self, "phone_setup", None) else None,
        }

    def system_action(self, message, ws):
        action = message.get("action")
        value = message.get("value")

        def reply(extra=None):
            status = self.system_status()
            if extra:
                status.update(extra)
            if ws is not None:
                self.send_to(ws, status)

        def worker():
            if action == "status":
                status = self.system_status()
                status["wifi"] = wifi_status(scan=False)
                self.send_to(ws, status)
                return
            if action == "wifiCountry":
                cc = re.sub(r"[^A-Za-z]", "", str(value or ""))[:2].upper()
                ok = len(cc) == 2 and _wifi_helper() and run_privileged(SYSTEM_SCRIPT, "wifi", "country", cc)
                self.emit({"type": "wifiResult", "ok": bool(ok), "message": ("Wi-Fi country: " + cc) if ok else "Could not set the Wi-Fi country.", "country": True})
            if action == "wifiForget":
                if _wifi_helper():
                    run_privileged(SYSTEM_SCRIPT, "wifi", "forget")
                else:
                    run(["nmcli", "connection", "delete", "padpedal-wifi"], timeout=10)
                self.emit({"type": "wifiResult", "ok": True, "message": "Forgot the Wi-Fi network.", "forgot": True})
            if action in ("wifi", "wifiCountry", "wifiForget"):
                if message.get("ssid") and action == "wifi":
                    ssid = str(message["ssid"])[:64]
                    self.emit({"type": "wifiResult", "busy": True, "message": "Connecting to %s…" % ssid, "ssid": ssid})
                    ok, text = wifi_connect(ssid, str(message.get("password") or "")[:128], bool(message.get("hidden")))
                    log.info("wifi: %s %s", ssid, "connected" if ok else "failed: " + text)
                    self.emit({"type": "wifiResult", "ok": ok, "message": text, "ssid": ssid})
                status = self.system_status()
                status["wifi"] = wifi_status(scan=True)
                self.emit(status)
                return
            if action == "safeMode" and value in ("on", "off"):
                run_privileged(SYSTEM_SCRIPT, "safe-mode", value)
            elif action == "shutdown":
                log.info("shutting down (requested from the app)")
                run_privileged("/usr/sbin/shutdown", "-h", "now")
            elif action == "reboot":
                log.info("restarting (requested from the app)")
                if getattr(self, "factory", None):
                    self.factory.continue_next()   # (during the factory test: back into the test)
                run_privileged("/usr/sbin/shutdown", "-r", "now")
            elif action == "audio":
                path = os.path.join(self.config["data_root"], "audio.json")
                cfg = dict(read_json(path, {}) or {}, hdmi=bool(message.get("hdmi")), usbFirst=bool(message.get("usbFirst")))   # (keeps "dac")
                write_json(path, cfg)
                run_privileged(SYSTEM_SCRIPT, "audio", "hdmi" if cfg["hdmi"] else "nohdmi", "usbfirst" if cfg["usbFirst"] else "jackfirst")
            if action in ("audio", "reapplyAudio"):   # the outputs made again now (a USB interface came or went, a setting changed)
                def again():
                    ok, text = reapply_audio(self.config.get("app_root"))
                    self.emit({"type": "audioReapplied", "ok": ok, "message": text, "reload": True})
                    self.emit(self.system_status())
                threading.Thread(target=again, daemon=True).start()
                return
            elif action == "audioCheck":   # Settings → Audio → Test sound: where the app's sound goes (and fix what's off)
                self.emit(audio_path_check(self.config["data_root"], fix=message.get("fix", True) is not False))
                return
            elif action == "audioCardTest":   # a tone straight on each sound card, one after the other
                planned = (read_json(os.path.join(self.config["data_root"], "audio-channels.json"), {}) or {}).get("cards") or []
                sinks = [s[1] for s in pactl_short("sinks") if len(s) > 1 and (s[1].startswith("alsa_output") or s[1] in ("padpedal_jack", "padpedal_dac"))]
                for name in sinks:
                    desc = next((c.get("desc") for c in planned if c.get("name") == name), None) or name
                    self.emit({"type": "audioCardTest", "sink": name, "desc": desc, "busy": True})
                    ok, err = card_tone(name)
                    self.emit({"type": "audioCardTest", "sink": name, "desc": desc, "ok": ok, "error": err})
                    time.sleep(0.4)
                self.emit({"type": "audioCardTest", "done": True, "count": len(sinks)})
                return
            elif action == "dac" and value in ("on", "off"):   # the DAC board (outputs 3-4): it can't be detected - this says so
                self.config["i2s_dac"] = value == "on"
                self.save_config()
                path = os.path.join(self.config["data_root"], "audio.json")
                write_json(path, dict(read_json(path, {}) or {}, dac=value == "on"))   # (the outputs follow at once)
                run_privileged(SYSTEM_SCRIPT, "dac", value)   # (its overlay, after a restart)

                def again():
                    ok, text = reapply_audio(self.config.get("app_root"))
                    self.emit({"type": "audioReapplied", "ok": ok, "message": text})
                    self.emit(self.system_status())
                threading.Thread(target=again, daemon=True).start()
            elif action == "phoneSetup":
                ps = self.phone_setup
                threading.Thread(target=(ps.stop if value == "off" else lambda: ps.start("asked in the app")), daemon=True).start()
                return
            elif action == "touchScreen":
                result = self.set_touch_screen(str(value or "off"))
                self.emit(dict(result, type="touchScreenResult"))
            elif action == "screen" and value in ("on", "off") and self.config.get("touch_screen"):
                result = self.set_touch_screen(self.config.get("touch_screen_last") or "rpi35-xpt2046" if value == "on" else "off")
                self.emit(dict(result, type="touchScreenResult"))
            elif action == "screen":
                overlay = self.config.get("tft_overlay_choice") or "waveshare35a"
                if value == "on":
                    self.config["tft_overlay"] = overlay if overlay in TFT_OVERLAYS else "waveshare35a"
                elif value == "off":
                    self.config["tft_overlay"] = "none"
                elif value in TFT_OVERLAYS:
                    self.config["tft_overlay"] = value
                    self.config["tft_overlay_choice"] = value
                self.save_config()
                if run_privileged(SYSTEM_SCRIPT, "tft", self.config["tft_overlay"]):
                    reply()
                    time.sleep(1.5)
                    run_privileged("/usr/sbin/shutdown", "-r", "now")
                    return
            elif action == "screenType":
                if value in TFT_OVERLAYS:
                    self.config["tft_overlay_choice"] = value
                    if screen_on(self.config):
                        self.config["tft_overlay"] = value
                        run_privileged(SYSTEM_SCRIPT, "tft", value)
                    self.save_config()
            elif action == "displays":
                # merged, not replaced: the screen session watches this file and redoes the layout in place
                # (resolution, edge margin) or restarts the windows (what a screen shows, zoom)
                cfg = self.displays_config()
                for key, val in (message.get("config") or {}).items():
                    if key in DISPLAY_KEYS:
                        cfg[key] = val
                write_json(os.path.join(self.config["data_root"], "displays.json"), cfg)
            elif action == "restartSession":
                run(["pkill", "-x", "Xorg"], timeout=5)
            elif action == "hostname":
                name = re.sub(r"[^a-z0-9-]", "", str(value or "").lower())[:32]
                if name:
                    run_privileged(SYSTEM_SCRIPT, "hostname", name)
            elif action == "calibrateTouch":
                self.start_touch_calibration()
            elif action == "touchTest":
                self.start_touch_test()
            reply()

        threading.Thread(target=worker, daemon=True).start()

    # ----- config -----------------------------------------------------------
    def save_config(self):
        path = CONFIG_CANDIDATES[0] if self.config_path in (None, CONFIG_CANDIDATES[1]) else self.config_path
        return write_json(path, self.config)

    def input_by_id(self, input_id):
        for spec in self.config.get("inputs") or []:
            if spec.get("id") == input_id:
                return spec
        return None

    def used_gpio(self):
        used = {}
        for spec in self.config.get("inputs") or []:
            if spec.get("gpio") is not None:
                used[int(spec["gpio"])] = spec["id"]
            for k in ("gpio_a", "gpio_b", "gpio_button"):
                if spec.get(k) is not None:
                    used[int(spec[k])] = spec["id"]
        for led in self.config.get("leds") or []:
            if led.get("gpio") is not None:
                used[int(led["gpio"])] = led["id"]
        return used

    def free_pins(self):
        reserved = set(reserved_pins(self.config))
        used = self.used_gpio()
        return [p for p in ALL_GPIO if p not in reserved and p not in used]

    # ----- learn ------------------------------------------------------------
    def start_learn(self, target, kind, allow_keyboard=False):
        self.stop_learn()
        spec = self.input_by_id(target)
        kind = kind or (spec.get("kind") if spec else "button")
        self.learn = {"target": target, "kind": kind, "allowKeyboard": allow_keyboard, "started": time.monotonic()}
        if kind in ("button", "encoder"):
            try:
                from gpiozero import Button
                kw = {"pin_factory": self.pin_factory} if self.pin_factory else {}
                for pin in self.free_pins():
                    try:
                        button = Button(pin, pull_up=True, bounce_time=0.03, **kw)
                        button.when_pressed = lambda pin=pin: self.learned({"gpio": pin})
                        self.scan_devices.append(button)
                    except Exception as error:
                        log.debug("learn: GPIO %s unavailable (%s)", pin, error)
            except Exception as error:
                log.info("learn: gpiozero unavailable (%s)", error)
        if kind in ("knob", "slider", "expression"):
            self.analog_baseline = {}
            self.probe_adcs()
        log.info("learning %s (%s): free pins %s", target, kind, self.free_pins())

    def stop_learn(self):
        self.learn = None
        self.close_scan_devices()

    def close_scan_devices(self):
        devices, self.scan_devices = self.scan_devices, []
        for device in devices:
            try:
                device.close()
            except Exception:
                pass

    def learned(self, found):
        learn = self.learn
        if not learn:
            return
        target = learn["target"]
        already = None
        if "gpio" in found:
            owner = self.used_gpio().get(int(found["gpio"]))
            if owner and owner != target:
                already = owner
        elif "adc" in found:
            for spec in self.config.get("inputs") or []:
                adc = spec.get("adc")
                if adc and spec["id"] != target and parse_address(adc["address"]) == parse_address(found["adc"]["address"]) and int(adc["channel"]) == int(found["adc"]["channel"]):
                    already = spec["id"]
        # the press that taught us may still be inside a gpiozero callback: close the scan pins a moment later
        self.learn = None
        if self.loop:
            self.loop.call_soon_threadsafe(lambda: self.loop.call_later(0.05, self.close_scan_devices))
        else:
            threading.Timer(0.05, self.close_scan_devices).start()
        message = {"type": "learned", "target": target, "input": found}
        if already:
            message["alreadyUsedBy"] = already
        self.emit(message)

    def probe_adcs(self):
        bus = self.i2c_bus if self.i2c_bus is not None else open_i2c_bus(self.config["i2c_bus"])
        if bus is None:
            return
        self.i2c_bus = bus
        for address in (0x48, 0x49, 0x4A, 0x4B):
            if self.adcs.get(address):
                continue
            adc = ADS1115(bus, address)
            try:
                adc.read(0)
                self.adcs[address] = adc
                log.info("found ADS1115 at 0x%02x", address)
            except Exception:
                self.adcs.setdefault(address, None)

    def poll_learn_analog(self):
        if not (self.learn and self.learn["kind"] in ("knob", "slider", "expression")):
            return
        for address, adc in list(self.adcs.items()):
            if not adc:
                continue
            for channel in range(4):
                try:
                    raw = adc.read(channel)
                except Exception:
                    continue
                key = (address, channel)
                base = self.analog_baseline.setdefault(key, raw)
                if abs(raw - base) > 2600:
                    self.learned({"adc": {"address": "0x%02x" % address, "channel": channel}})
                    return

    # ----- touch calibration ---------------------------------------------------
    def start_touch_calibration(self):
        """The 3.5" screen's touch: 5 crosses (corners and centre), then a check - tap the dot, SAVE or REDO."""
        if self.mini and self.mini.available:
            self.mini.start_calibration()

    def touch_calibration_point(self, raw_x, raw_y):   # (one cross by hand: older callers and tests)
        if self.mini:
            self.mini.calibration_press([(raw_x, raw_y)] * 3)

    def start_touch_test(self):
        if self.mini and self.mini.available:
            self.mini.start_test()

    # ----- LEDs ---------------------------------------------------------------
    def update_leds(self):
        held = getattr(getattr(self, "factory", None), "led_until", {})
        for led_id, entry in self.leds.items():
            if led_id in held:   # (the factory test is blinking it)
                continue
            state = self.led_states.get(entry.get("follows") or led_id, "off")
            led = entry["led"]
            try:
                if state == "on":
                    led.on()
                elif state == "blink":
                    led.blink(on_time=0.08, off_time=1.4, background=True)
                elif state == "beat":
                    period = 60.0 / max(20.0, min(300.0, self.led_bpm))
                    led.blink(on_time=min(0.06, period / 2), off_time=max(0.02, period - 0.06), background=True)
                else:
                    led.off()
            except Exception as error:
                log.debug("LED %s failed (%s)", led_id, error)

    # ----- input events ----------------------------------------------------------
    def button_event(self, input_id, event):
        if self.learn and event == "press" and self.learn["kind"] in ("button", "encoder"):
            spec = self.input_by_id(input_id)
            if spec and spec.get("gpio") is not None:
                self.learned({"gpio": int(spec["gpio"])})
                return
        self.emit({"type": "control", "id": input_id, "event": event})

    def analog_event(self, input_id, value):
        self.emit({"type": "control", "id": input_id, "value": round(float(value), 4)})

    # ----- GPIO ----------------------------------------------------------------
    def start_gpio(self):
        try:
            from gpiozero import LED, Button, RotaryEncoder
        except Exception as error:
            log.warning("gpiozero unavailable (%s) - buttons, LEDs and encoder disabled", error)
            return
        kw = {"pin_factory": self.pin_factory} if self.pin_factory else {}
        cfg = self.config
        bounce = cfg["debounce_s"] or None
        reserved = set(reserved_pins(cfg))
        for spec in cfg.get("inputs") or []:
            kind, iid = spec.get("kind"), spec.get("id")
            if kind == "button" and spec.get("gpio") is not None:
                pin = int(spec["gpio"])
                if pin in reserved:
                    log.warning("%s is on GPIO %s, which the screen / DAC needs - skipped", iid, pin)
                    spec["active"] = False
                    continue
                try:
                    button = Button(pin, pull_up=True, bounce_time=bounce, hold_time=cfg["hold_s"], **kw)
                    button.when_pressed = lambda iid=iid: self.button_event(iid, "press")
                    button.when_released = lambda iid=iid: self.button_event(iid, "release")
                    button.when_held = lambda iid=iid: self.button_event(iid, "hold")
                    self.devices.append(button)
                    self.buttons[iid] = button
                    spec["active"] = True
                except Exception as error:
                    log.warning("%s on GPIO %s unavailable (%s)", iid, pin, error)
                    spec["active"] = False
            elif kind == "encoder" and spec.get("gpio_a") is not None and spec.get("gpio_b") is not None:
                pins = [int(spec["gpio_a"]), int(spec["gpio_b"])] + ([int(spec["gpio_button"])] if spec.get("gpio_button") is not None else [])
                if any(p in reserved for p in pins):
                    log.info("%s uses pins the screen / DAC needs - skipped (turn the screen off or move it)", iid)
                    spec["active"] = False
                    continue
                try:
                    encoder = RotaryEncoder(pins[0], pins[1], max_steps=0, **kw)
                    encoder.when_rotated_clockwise = lambda iid=iid: self.emit({"type": "control", "id": iid, "delta": 1})
                    encoder.when_rotated_counter_clockwise = lambda iid=iid: self.emit({"type": "control", "id": iid, "delta": -1})
                    self.devices.append(encoder)
                    self.encoder_ok = True
                    if len(pins) > 2:
                        push = Button(pins[2], pull_up=True, bounce_time=bounce, hold_time=cfg["hold_s"], **kw)
                        push.when_pressed = lambda iid=iid: self.button_event(iid, "press")
                        push.when_released = lambda iid=iid: self.button_event(iid, "release")
                        push.when_held = lambda iid=iid: self.button_event(iid, "hold")
                        self.devices.append(push)
                    spec["active"] = True
                except Exception as error:
                    log.warning("encoder %s unavailable (%s)", iid, error)
                    spec["active"] = False
        for spec in cfg.get("leds") or []:
            if spec.get("gpio") is None:
                continue
            try:
                led = LED(int(spec["gpio"]), **kw)
                self.leds[spec["id"]] = {"led": led, "follows": spec.get("follows")}
                self.devices.append(led)
            except Exception as error:
                log.warning("LED %s on GPIO %s unavailable (%s)", spec.get("id"), spec.get("gpio"), error)
        log.info("GPIO ready: %d buttons, %d LEDs, encoder %s", len(self.buttons), len(self.leds), "on" if self.encoder_ok else "off")

    # ----- ADS1115 / MCP23017 -------------------------------------------------------
    def start_analog(self):
        specs = [s for s in (self.config.get("inputs") or []) if s.get("adc")]
        bus = self.i2c_bus if self.i2c_bus is not None else open_i2c_bus(self.config["i2c_bus"])
        if bus is None:
            for spec in specs:
                spec["active"] = False
            return
        self.i2c_bus = bus
        for spec in specs:
            analog = AnalogInput(spec, self.config)
            if analog.address not in self.adcs:
                adc = ADS1115(bus, analog.address)
                try:
                    adc.read(0)
                    self.adcs[analog.address] = adc
                    log.info("ADS1115 found at 0x%02x", analog.address)
                except Exception as error:
                    (log.info if spec.get("optional") else log.warning)("no ADS1115 answering at 0x%02x (%s) - skipping its inputs", analog.address, error)
                    self.adcs[analog.address] = None
            if self.adcs.get(analog.address):
                self.analog.append(analog)
                spec["active"] = True
            else:
                spec["active"] = False
        log.info("analog inputs: %s", ", ".join(a.id for a in self.analog) or "none")
        exp = self.config.get("expander")
        if exp:
            try:
                chip = MCP23017(bus, parse_address(exp.get("address", "0x20")))
                in_mask = sum(1 << int(b["pin"]) for b in exp.get("buttons") or [])
                out_mask = sum(1 << int(l["pin"]) for l in exp.get("leds") or [])
                chip.setup(in_mask, out_mask)
                self.expander_state = chip.read()
                self.expander = chip
                self.expander_buttons = list(exp.get("buttons") or [])
                for l in exp.get("leds") or []:
                    self.leds[l["id"]] = {"led": _ExpanderLed(chip, int(l["pin"])), "follows": l.get("follows")}
                log.info("MCP23017 at 0x%02x: %d buttons, %d LEDs", chip.address, len(self.expander_buttons), len(exp.get("leds") or []))
            except Exception as error:
                log.warning("MCP23017 expander unavailable (%s)", error)
        for led in self.config.get("leds") or []:
            if led.get("expander") is not None and self.expander:
                self.leds[led["id"]] = {"led": _ExpanderLed(self.expander, int(led["expander"])), "follows": led.get("follows")}

    def poll_analog_once(self):
        messages = []
        for analog in self.analog:
            try:
                raw = self.adcs[analog.address].read(analog.channel)
            except Exception as error:
                log.debug("read %s failed (%s)", analog.id, error)
                continue
            value = analog.update(raw)
            if value is not None:
                if self.learn and self.learn["kind"] in ("knob", "slider", "expression") and analog.sent is not None and abs(value - (self.analog_baseline.get(analog.id, value))) > 0.1:
                    self.learned({"adc": {"address": "0x%02x" % analog.address, "channel": analog.channel}})
                    return messages
                self.analog_baseline.setdefault(analog.id, value)
                messages.append({"type": "control", "id": analog.id, "value": value})
        if self.expander:
            try:
                state = self.expander.read()
                changed = state ^ self.expander_state
                self.expander_state = state
                for b in self.expander_buttons:
                    bit = 1 << int(b["pin"])
                    if changed & bit:
                        self.button_event(b["id"], "release" if state & bit else "press")
            except Exception as error:
                log.debug("expander read failed (%s)", error)
        self.poll_learn_analog()
        return messages

    async def analog_loop(self):
        period = 1.0 / float(self.config["analog_poll_hz"])
        while True:
            if self.analog or self.expander or (self.learn and self.learn["kind"] in ("knob", "slider", "expression")):
                started = time.monotonic()
                for message in await asyncio.to_thread(self.poll_analog_once):
                    await self.broadcast(message)
                await asyncio.sleep(max(0.0, period - (time.monotonic() - started)))
            else:
                await asyncio.sleep(0.5)

    def reload_hardware(self):
        self.stop_learn()
        for device in self.devices:
            try:
                device.close()
            except Exception:
                pass
        self.devices = []
        self.buttons = {}
        self.leds = {}
        self.analog = []
        self.adcs = {}
        self.expander = None
        self.expander_buttons = []
        self.encoder_ok = False
        self.start_gpio()
        self.start_analog()
        self.update_leds()
        if self.usb:
            self.usb.relearn()
        if self.mini:
            self.mini.spec = self.config.get("mini_screen") or {}

    # ----- 3.5" screen ---------------------------------------------------------
    APP_TO_MINI = {"pads": "pads", "tracks": "tracks", "instrument": "instrument", "looper": "looper", "settings": "settings"}

    def mini_mirror(self, message):
        """(10.0.1) The owner clicked something with the mouse on the app on HDMI: the 3.5" screen (and an HDMI
        "Copy of this screen") goes to the same tab and lights the matching button for a moment. A finger on the
        3.5" a moment ago wins (MiniScreen.mirror)."""
        tab = self.APP_TO_MINI.get(str(message.get("tab") or ""))
        press = message.get("press") if isinstance(message.get("press"), dict) else None
        if not tab:
            return False
        moved = False
        if self.mini and self.mini.available:
            moved = self.mini.mirror(tab, press, sub=message.get("sub"))
            if moved:
                self.schedule_mini_render(True)
                if press and self.loop:   # the light goes off again
                    self.loop.call_soon_threadsafe(lambda: self.loop.call_later(MiniScreen.FLASH_FOR + 0.05, lambda: self.schedule_mini_render(True)))
        else:
            moved = True
        if moved:   # the web copy (/mini on an HDMI screen) follows too
            self.emit({"type": "miniView", "tab": tab, "sub": message.get("sub"), "press": press, "at": time.time()}, lan=True)
        return moved

    def schedule_mini_render(self, force=False):
        if not (self.mini and self.mini.available):
            return
        now = time.monotonic()
        if not force and now - self.last_mini_render < 0.05:
            if self.mini_timer is None and self.loop:
                self.mini_timer = self.loop.call_later(0.06, lambda: self.schedule_mini_render(True))
            return
        self.mini_timer = None
        self.last_mini_render = now
        if getattr(self, "_mini_wake", None) is None:
            self._mini_wake = threading.Event()

            def worker():   # one drawing thread: a burst of changes draws once, with the newest state
                try:   # (it gives way to the touch panel's thread and the sound: a tap is read first, then drawn)
                    os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), 5)
                except (AttributeError, OSError):
                    pass
                while True:
                    self._mini_wake.wait()
                    self._mini_wake.clear()
                    try:
                        self.mini.render(self.display)
                        self.mini.push()
                    except Exception as error:
                        log.debug("mini render failed (%s)", error)
            threading.Thread(target=worker, daemon=True, name="mini-screen").start()
        self._mini_wake.set()

    # ----- lifecycle ----------------------------------------------------------
    async def run(self, stop_event=None):
        import websockets
        self.loop = asyncio.get_running_loop()
        # the web servers first: at power-on the screen's start-up page opens the app the moment :8766 answers
        self.local = LocalServer(self, int(self.config["http_port"]))
        self.local.start()
        self.companion = CompanionServer(self, int(self.config["lan_port"]))
        self.companion.start()
        try:
            self.displays_config()   # (an older version's "HDMI 1 = copy of the small screen" becomes the full app before the screens start)
        except Exception as error:
            log.debug("displays: %s", error)
        threading.Thread(target=self.auto_touch_screen, daemon=True).start()
        threading.Thread(target=self.refresh_screen_lines, daemon=True).start()
        threading.Thread(target=self.phone_setup.watch, daemon=True).start()
        threading.Thread(target=self.watch_audio_devices, daemon=True).start()
        self.start_gpio()
        self.start_analog()
        tasks = []
        if self.config.get("midi", True):
            self.midi = Midi(self.emit, want_out=bool(self.config.get("midi_out", True)))
            if self.midi.available:
                tasks.append(asyncio.create_task(self.midi.loop()))
        self.link = LinkSync(self.emit, enabled=bool(self.config.get("link", True)))
        if self.updater:
            threading.Thread(target=self.update_loop, daemon=True).start()
        self.usb = UsbInputs(self)
        if self.usb.available:
            tasks.append(asyncio.create_task(self.usb.loop()))
        server = await websockets.serve(self.handle_client, self.config["ws_host"], int(self.config["ws_port"]))
        log.info("listening on ws://%s:%s", self.config["ws_host"], self.config["ws_port"])
        # the 3.5" screen (fonts, first picture) after the app's socket is up; it draws whatever the app has sent by then
        mini_spec = self.config.get("mini_screen") or {}
        if mini_spec.get("enabled", True):
            self.mini = MiniScreen(self, mini_spec, self.fb_override)
            if self.mini.available and self.usb.available:
                threading.Thread(target=self.mini.touch_loop, args=(self.usb,), daemon=True).start()
            if self.mini.available and self.mini.fb_present():
                self.schedule_mini_render(force=True)
        lan_server = None
        try:
            lan_server = await websockets.serve(self.handle_lan_client, "0.0.0.0", int(self.config["lan_ws_port"]))
            self.sync.start()
            log.info("companion websocket on ws://0.0.0.0:%s (pairing code %s)", self.config["lan_ws_port"], self.code)
        except Exception as error:
            log.warning("companion websocket could not start (%s)", error)
        tasks.append(asyncio.create_task(self.analog_loop()))
        if self.config.get("center", True) and not PEDAL_CONTROL:
            pin = os.environ.get("CC_PAIR_PIN", "").strip()   # opened from the main admin's Central Control: its pairing PIN
            if re.match(r"^\d{4}$", pin) and (pin != self.code or not self.code_chosen()):
                self.set_code(pin, from_center=True)
            tasks.append(asyncio.create_task(self.center_link.loop()))   # pair with the main admin (the center)
        stop_event = stop_event or asyncio.Event()
        await stop_event.wait()
        for task in tasks:
            task.cancel()
        for s in (self.local, self.companion):
            if s:
                s.stop()
        if self.midi:
            self.midi.close()
        if self.usb:
            self.usb.close()
        server.close()
        await server.wait_closed()
        if lan_server:
            lan_server.close()
            await lan_server.wait_closed()
        for device in self.devices:
            try:
                device.close()
            except Exception:
                pass


class Simulator:
    """--simulate: no Pi needed. Simulated pins / ADS1115 / framebuffer, driven by {"type":"sim"} messages
    from a test: {"sim":"press","id":"b1"} {"sim":"release","id":"b1"} {"sim":"knob","id":"k1","value":0.7} {"sim":"gpio","pin":17,"low":true}"""

    def __init__(self, driver, factory, bus):
        self.driver = driver
        self.factory = factory
        self.bus = bus

    def apply(self, m):
        what = m.get("sim")
        if what in ("press", "release"):
            spec = self.driver.input_by_id(m.get("id"))
            pin = spec.get("gpio") if spec else None
            if spec and spec.get("kind") == "encoder":
                pin = spec.get("gpio_button")
            if pin is not None:
                (self.factory.pin(int(pin)).drive_low if what == "press" else self.factory.pin(int(pin)).drive_high)()
        elif what == "gpio":
            (self.factory.pin(int(m["pin"])).drive_low if m.get("low") else self.factory.pin(int(m["pin"])).drive_high)()
        elif what == "knob":
            spec = self.driver.input_by_id(m.get("id"))
            if spec and spec.get("adc"):
                self.bus.volts[(parse_address(spec["adc"]["address"]), int(spec["adc"]["channel"]))] = 3.3 * float(m.get("value", 0))
        elif what == "encoder":
            spec = self.driver.input_by_id(m.get("id") or "enc")
            if spec and spec.get("gpio_a") is not None:
                a, b = self.factory.pin(int(spec["gpio_a"])), self.factory.pin(int(spec["gpio_b"]))
                seq = ((0, 1), (0, 0), (1, 0), (1, 1)) if int(m.get("delta", 1)) > 0 else ((1, 0), (0, 0), (0, 1), (1, 1))
                for sa, sb in seq:
                    (a.drive_low if sa == 0 else a.drive_high)()
                    (b.drive_low if sb == 0 else b.drive_high)()
                    time.sleep(0.004)


class _SimBus:
    def __init__(self, addresses):
        self.addresses = set(addresses)
        self.mux = {}
        self.volts = {}

    def write_i2c_block_data(self, addr, reg, data):
        if addr not in self.addresses:
            raise OSError(121, "Remote I/O error")
        if reg == 0x01:
            self.mux[addr] = ((data[0] >> 4) & 0x7) - 4

    def read_i2c_block_data(self, addr, reg, length):
        if addr not in self.addresses:
            raise OSError(121, "Remote I/O error")
        if reg == 0x01:
            return [0x80, 0x00]
        raw = int(round(self.volts.get((addr, self.mux.get(addr, 0)), 1.65) / 4.096 * 32767))
        return [(raw >> 8) & 0xFF, raw & 0xFF]



class UiErrorHandler(logging.Handler):
    """Errors the driver logs go to the app on the pedal's screen, which reports them to the Motion Audio website (the
    support email hears about each new kind). The same message at most once every 10 minutes."""

    def __init__(self, driver):
        super().__init__(level=logging.ERROR)
        self.driver, self.sent = driver, {}

    def emit(self, record):
        try:
            message = record.getMessage()[:400]
            key, now = message[:120], time.time()
            if now - self.sent.get(key, 0) < 600:
                return
            self.sent[key] = now
            stack = logging.Formatter().formatException(record.exc_info) if record.exc_info else ""
            self.driver.emit({"type": "driverError", "message": message, "stack": stack[-3000:]})
        except Exception:  # never let reporting break the driver
            pass

def main():
    parser = argparse.ArgumentParser(description="Pad Pedal hardware / system driver")
    parser.add_argument("--config", default=None, help="default: first of " + ", ".join(CONFIG_CANDIDATES))
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--render", default=None, help="render the 3.5\" screen once to this PNG and exit (test)")
    parser.add_argument("--simulate", default=None, metavar="DIR", help="no Pi: simulated pins/knobs/screen, data in DIR (tests)")
    parser.add_argument("--app-root", default=None, help="folder with index.html (default /opt/pad-pedal, or this folder with --simulate)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s pedal-driver %(levelname)s: %(message)s")
    config_path = args.config or next((p for p in CONFIG_CANDIDATES if os.path.exists(p)), CONFIG_CANDIDATES[-1])
    config = load_config(config_path)
    if args.render:
        mini = MiniScreen(None, config.get("mini_screen"))
        mini.render({"song": {"name": "Great Is Thy Faithfulness", "key": "G", "bpm": 72}, "key": "G", "bpm": 72, "tracksMode": True, "playing": True, "pos": 83, "bar": 21, "loop": -1,
                     "section": {"name": "Chorus 2"}, "pads": [{"name": "Warm Pad", "playing": True}, {"name": "Ambient Clouds", "selected": True}, {"name": "Worship Swell"}, {"name": "Dream Choir"},
                                                             {"name": "Soft Strings"}, {"name": "Shimmer Pad"}, {"name": "Gentle Pluck"}, {"name": "Cinematic Swell"}]})
        mini.image.save(args.render)
        print("wrote", args.render)
        return
    try:
        import websockets  # noqa: F401
    except ImportError:
        log.error("python3-websockets is required:  sudo apt install python3-websockets")
        raise SystemExit(1)
    if args.simulate:
        from gpiozero import Device
        from gpiozero.pins.mock import MockFactory
        factory = MockFactory()
        Device.pin_factory = factory
        bus = _SimBus([0x48, 0x49])
        config["data_root"] = os.path.abspath(args.simulate)
        config["simulated"] = True
        config["app_root"] = os.path.abspath(args.app_root or os.path.dirname(os.path.abspath(__file__)))
        config["media_roots"] = [os.path.join(config["data_root"], "media")]
        if os.environ.get("CC_PCO_BASE"):  # tests point Planning Center at a stand-in
            config["pco_base"] = os.environ["CC_PCO_BASE"]
        os.makedirs(config["media_roots"][0], exist_ok=True)
        config["midi"] = False
        config["link"] = False
        config["hold_s"] = 0.5
        config["debounce_s"] = None
        fb = os.path.join(config["data_root"], "fb1")
        with open(fb, "wb") as handle:
            handle.write(b"\0" * (480 * 320 * 2))
        driver = PedalDriver(config, pin_factory=factory, i2c_bus=bus, fb_override=fb)
        driver.sim = Simulator(driver, factory, bus)
        driver.config_path = os.path.join(config["data_root"], "hardware.json")
        log.info("SIMULATION: data in %s, app from %s", config["data_root"], config["app_root"])
    else:
        driver = PedalDriver(config)
        driver.config_path = config_path

    logging.getLogger().addHandler(UiErrorHandler(driver))
    threading.excepthook = lambda a: log.error("thread %s crashed: %s", getattr(a.thread, "name", "?"), a.exc_value, exc_info=(a.exc_type, a.exc_value, a.exc_traceback))

    async def runner():
        stop_event = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop_event.set)
            except NotImplementedError:
                pass
        await driver.run(stop_event)

    asyncio.run(runner())


def utf8_mode():
    """Text files are UTF-8 here (the touch screen list says "480×320", songs have accents). A Pi set to a language
    that isn't installed makes Python read them as plain ASCII - the screen list came up empty. So: UTF-8 mode, always
    (for the helpers it starts too)."""
    os.environ["PYTHONUTF8"] = "1"
    if sys.flags.utf8_mode or getattr(sys, "frozen", False):   # (the packed driver in the desktop apps: not restartable like this)
        return
    import locale
    if (locale.getpreferredencoding(False) or "").lower().replace("-", "") != "utf8":
        os.execv(sys.executable, [sys.executable, "-X", "utf8"] + sys.argv)


if __name__ == "__main__":
    utf8_mode()
    main()
