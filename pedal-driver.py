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
  system {action: status|safeMode|shutdown|reboot|wifi|audio|screen|displays|restartSession|hostname}
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
    import sources  # Planning Center + track packs (MultiTracks.com, Loop Community)
except Exception as _error:
    sources = None
    logging.getLogger("pedal-driver").info("sources unavailable: %s", _error)

log = logging.getLogger("pedal-driver")

VERSION = 7
APP_VERSION = "9.5.0"
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
BUILTIN_SCREENS_JSON = r'''{"_about":"Central Pedal touch screens. kind: spi = a small screen on the GPIO pins (Central Pedal draws its own remote on it; HDMI 1 can show a copy), hdmi = a touch monitor on HDMI 1 (shows the app; its touch is USB), dsi = a screen on the ribbon-cable display port (shows the app). config = lines for config.txt; video = the mode forced on HDMI 1 when the screen does not say its size; driver = the maker's overlay, downloaded when the screen is picked (built-in ones need nothing). pins = GPIO pins the screen uses (kept free of buttons).","groups":[{"id":"spi","name":"Small screens on the GPIO pins (2.2\" - 4\")"},{"id":"hdmi","name":"HDMI touch screens (USB touch)"},{"id":"dsi","name":"Ribbon-cable (DSI) touch screens"}],"screens":[{"id":"rpi35-xpt2046","kind":"spi","size":3.5,"res":[480,320],"name":"3.5\" RPi Display - XPT2046 touch (the common blue board)","also":"LCDwiki MPI3501, Waveshare 3.5\" (A) and its clones (Kuman, OSOYOO, Elegoo, iUniker, Quimat...), 480\u00d7320, ILI9486","config":["dtparam=spi=on","dtoverlay=piscreen,speed=16000000,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25],"calibration":{"xmin":200,"xmax":3900,"ymin":200,"ymax":3900,"swap":true,"flip_x":false,"flip_y":true}},{"id":"waveshare35a","kind":"spi","size":3.5,"res":[480,320],"name":"Waveshare 3.5\" (A) - Waveshare's own driver","also":"the same board as above, with the overlay from Waveshare's LCD-show","config":["dtparam=spi=on","dtoverlay=waveshare35a:rotate=90"],"driver":{"name":"waveshare35a","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare35a-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"waveshare35b","kind":"spi","size":3.5,"res":[480,320],"name":"Waveshare 3.5\" (B) IPS","config":["dtparam=spi=on","dtoverlay=waveshare35b:rotate=90"],"driver":{"name":"waveshare35b","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare35b-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"waveshare35b-v2","kind":"spi","size":3.5,"res":[480,320],"name":"Waveshare 3.5\" (B) Rev 2.0","config":["dtparam=spi=on","dtoverlay=waveshare35b-v2:rotate=90"],"driver":{"name":"waveshare35b-v2","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare35b-v2-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"waveshare35c","kind":"spi","size":3.5,"res":[480,320],"name":"Waveshare 3.5\" (C) high speed","config":["dtparam=spi=on","dtoverlay=waveshare35c:rotate=90"],"driver":{"name":"waveshare35c","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare35c-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"piscreen2r","kind":"spi","size":3.5,"res":[480,320],"name":"OzzMaker PiScreen 2 (3.5\")","config":["dtparam=spi=on","dtoverlay=piscreen2r,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,17,24,25]},{"id":"pitft35","kind":"spi","size":3.5,"res":[480,320],"name":"Adafruit PiTFT 3.5\" (resistive)","config":["dtparam=spi=on","dtoverlay=pitft35-resistive,rotate=90,speed=32000000,fps=25"],"touch":"stmpe","pins":[7,8,9,10,11,24,25],"calibration":{"xmin":300,"xmax":3800,"ymin":200,"ymax":3900,"swap":true,"flip_x":false,"flip_y":false}},{"id":"tinylcd35","kind":"spi","size":3.5,"res":[480,320],"name":"TinyLCD 3.5\"","config":["dtparam=spi=on","dtoverlay=tinylcd35,touch,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,5,25]},{"id":"mz61581","kind":"spi","size":3.2,"res":[480,320],"name":"Tontec 3.2\" / 3.5\" (MZ61581)","config":["dtparam=spi=on","dtoverlay=mz61581,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,4,15,18,25]},{"id":"waveshare32b","kind":"spi","size":3.2,"res":[320,240],"name":"Waveshare 3.2\" (B)","config":["dtparam=spi=on","dtoverlay=waveshare32b:rotate=270"],"driver":{"name":"waveshare32b","url":"https://raw.githubusercontent.com/waveshare/LCD-show/master/waveshare32b-overlay.dtb"},"touch":"ADS7846","pins":[7,8,9,10,11,17,22,27]},{"id":"pitft28r","kind":"spi","size":2.8,"res":[320,240],"name":"Adafruit PiTFT 2.8\" (resistive)","config":["dtparam=spi=on","dtoverlay=pitft28-resistive,rotate=90,speed=64000000,fps=30"],"touch":"stmpe","pins":[7,8,9,10,11,24,25],"calibration":{"xmin":300,"xmax":3800,"ymin":200,"ymax":3900,"swap":true,"flip_x":false,"flip_y":false}},{"id":"pitft28c","kind":"spi","size":2.8,"res":[320,240],"name":"Adafruit PiTFT 2.8\" (capacitive)","config":["dtparam=spi=on","dtparam=i2c_arm=on","dtoverlay=pitft28-capacitive,rotate=90,speed=64000000,fps=30"],"touch":"EP0110M09|ft6236|ft6x06","pins":[7,8,9,10,11,24,25],"calibration":{"xmin":0,"xmax":240,"ymin":0,"ymax":320,"swap":true,"flip_x":false,"flip_y":true}},{"id":"rpi-display","kind":"spi","size":2.8,"res":[320,240],"name":"Watterott RPi-Display 2.8\"","config":["dtparam=spi=on","dtoverlay=rpi-display,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,18,23,24,25]},{"id":"hy28b","kind":"spi","size":2.8,"res":[320,240],"name":"HY28B 2.8\"","config":["dtparam=spi=on","dtoverlay=hy28b,rotate=90"],"touch":"ADS7846","pins":[7,8,9,10,11,17,18,25]},{"id":"pitft22","kind":"spi","size":2.2,"res":[320,240],"name":"Adafruit PiTFT 2.2\" (no touch - buttons only)","config":["dtparam=spi=on","dtoverlay=pitft22,rotate=270,speed=32000000,fps=30"],"touch":"","pins":[7,8,9,10,11,25]},{"id":"hdmi-auto","kind":"hdmi","name":"HDMI touch screen - any size (it says its own size)","also":"most screens sold for the Pi: Waveshare, Elecrow, SunFounder, ROADOM, the official monitors","config":[]},{"id":"hdmi-35","kind":"hdmi","size":3.5,"res":[480,320],"name":"3.5\" HDMI touch (MPI3508) 480\u00d7320","config":[],"video":"480x320M@60"},{"id":"hdmi-4","kind":"hdmi","size":4,"res":[800,480],"name":"4\" HDMI touch (MPI4008) 800\u00d7480","config":[],"video":"800x480M@60"},{"id":"hdmi-5","kind":"hdmi","size":5,"res":[800,480],"name":"5\" HDMI touch 800\u00d7480 (Waveshare 5\", Elecrow, MPI5008)","config":[],"video":"800x480M@60"},{"id":"hdmi-7-800","kind":"hdmi","size":7,"res":[800,480],"name":"7\" HDMI touch 800\u00d7480","config":[],"video":"800x480M@60"},{"id":"hdmi-7-1024","kind":"hdmi","size":7,"res":[1024,600],"name":"7\" HDMI touch 1024\u00d7600 (Waveshare 7\" C, Elecrow, SunFounder)","config":[],"video":"1024x600M@60"},{"id":"hdmi-10","kind":"hdmi","size":10.1,"res":[1280,800],"name":"10.1\" HDMI touch 1280\u00d7800","config":[],"video":"1280x800M@60"},{"id":"dsi-rpi7","kind":"dsi","size":7,"res":[800,480],"name":"Raspberry Pi Touch Display 7\" (the original)","also":"and the Waveshare 4.3\" / 5\" / 7\" DSI screens made to work like it","config":["dtoverlay=vc4-kms-dsi-7inch"]},{"id":"dsi-rpi2-7","kind":"dsi","size":7,"res":[720,1280],"name":"Raspberry Pi Touch Display 2 (7\")","config":["dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=90"]},{"id":"dsi-rpi2-5","kind":"dsi","size":5,"res":[720,1280],"name":"Raspberry Pi Touch Display 2 (5\")","config":["dtoverlay=vc4-kms-dsi-ili9881-5inch,rotation=90"]},{"id":"dsi-ws-28","kind":"dsi","size":2.8,"res":[480,640],"name":"Waveshare 2.8\" DSI","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,2_8_inch"]},{"id":"dsi-ws-34","kind":"dsi","size":3.4,"res":[800,800],"name":"Waveshare 3.4\" round DSI","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,3_4_inch"]},{"id":"dsi-ws-40","kind":"dsi","size":4,"res":[480,800],"name":"Waveshare 4\" DSI","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,4_0_inch"]},{"id":"dsi-ws-50","kind":"dsi","size":5,"res":[720,1280],"name":"Waveshare 5\" DSI (720\u00d71280)","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,5_0_inch"]},{"id":"dsi-ws-70c","kind":"dsi","size":7,"res":[1024,600],"name":"Waveshare 7\" DSI (C) 1024\u00d7600","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,7_0_inchC"]},{"id":"dsi-ws-79","kind":"dsi","size":7.9,"res":[400,1280],"name":"Waveshare 7.9\" DSI (bar)","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,7_9_inch"]},{"id":"dsi-ws-101","kind":"dsi","size":10.1,"res":[800,1280],"name":"Waveshare 10.1\" DSI","config":["dtoverlay=vc4-kms-dsi-waveshare-panel,10_1_inch"]}]}'''


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
        status["error"] = "NetworkManager is not installed."
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


PLAN_NAMES = {"keys": "Central Keys", "plugins": "Central Plugins", "instrument": "Central Instrument", "pedals": "Central Pedals"}


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
        names = ", ".join(PLAN_NAMES[k] for k in ("keys", "plugins", "instrument", "pedals") if k in plans) or "no plans"
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
                    return self.send_file(wav, "audio/wav", cache=True) if wav else self.send_json(404, {"error": "no speech engine"})
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
                if url.path in ("/practice/file", "/split/upload") and not local_origin_ok(self.headers):
                    return self.send_json(403, {"error": "only the app can do that"})
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
        time.sleep(15)
        offline_since = None
        while not self.stopping:
            try:
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
        return {"setupWifi": self.on, "local": bool(local and self.on), "networks": self.networks if self.on else (wifi_status(scan=True).get("networks") or []),
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
            for name, out in self.outputs.items():
                if port and port != name:
                    continue
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
        self.notice, self.notice_at = "", 0.0   # (a line along the bottom for a few seconds: "Part of Central Pedals · $50 a year…")
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
           "btn": (35, 39, 46), "on": (226, 194, 126), "ontext": (26, 20, 8), "warn": (255, 190, 110), "track": (46, 51, 60)}
    TABS = [("pads", "PADS"), ("tracks", "TRACKS"), ("instrument", "INSTRUMENT"), ("settings", "SETTINGS")]
    SUBS = {"tracks": [("play", "Play"), ("mix", "Mixer"), ("songs", "Setlist")],
            "instrument": [("sound", "Sound"), ("pedals", "Pedals"), ("eq", "EQ · Comp"), ("tune", "Tuner · Level")],
            "settings": [("audio", "In & out"), ("screens", "Screens"), ("touch", "Touch"), ("system", "System")]}
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
    def fit(self, g, text, font, width):
        text = str(text or "")
        try:
            if g.textlength(text, font=font) <= width:
                return text
            while text and g.textlength(text + "…", font=font) > width:
                text = text[:-1]
            return text.rstrip() + "…"
        except Exception:
            n = max(1, int(width / 7))
            return text if len(text) <= n else text[: n - 1] + "…"

    def text(self, g, xy, text, font, fill, anchor="la", width=None):
        if width:
            text = self.fit(g, text, font, width)
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
    def render(self, d):
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
        try:
            getattr(self, "page_" + tab)(g, hits, d)
        except Exception as error:   # (a page with odd data never blanks the screen)
            log.debug("small screen page %s: %s", tab, error)
            self.text(g, (W / 2, H / 2), "…", self.F["num"], C["muted"], "mm")
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
            g.text((8, H - 37), self.clip(ts.get("label"), 46), font=self.font, fill=C["text"])
            pick = ts.get("pickup")
            sub = ("turn UP ▲ to pick it up" if pick == "up" else "turn DOWN ▼ to pick it up" if pick == "down" else str(ts.get("value") or ""))
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
        ps = getattr(self.driver, "phone_setup", None)
        if ps and (ps.on or ps.busy):
            # phone setup takes the whole small screen: what to do on the phone
            g.rectangle([0, 0, W, H], fill=C["bg"])
            self.text(g, (14, 12), "Set up with your phone", self.F["title"], C["text"])
            lines = (["The pedal is joining the Wi-Fi…"] if ps.busy else
                     ["1. On your phone, join the Wi-Fi", "    \"%s\"" % SETUP_SSID, "2. The setup page opens by itself", "    (or go to %s)" % SETUP_IP, "3. Pick the Wi-Fi, screen and code,", "    then Upload"])
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
        C, W, H = self.COL, self.w, self.h
        pads = d.get("pads") or []
        gx, gy, gw, gh = 6, 46, 296, H - 46 - 46
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
            self.text(g, (x0 + 8, y0 + ch - 7), pad.get("name"), self.F["label"], C["text"], "ld", cw - 14)
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
                   ("START", {"name": "startOver"}, False, None), ("SECTION ›", {"name": "nextSection"}, False, None),
                   ("REPEAT", {"name": "repeatSection"}, loop >= 0, None),
                   ("CLICK", {"name": "toggleClick"}, bool(d.get("click", True)), None),
                   ("KEY −", {"name": "keyDown"}, False, None), ("KEY +", {"name": "keyUp"}, False, None),
                   ("NEXT SONG", {"name": "nextSong"}, False, None)]
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
        C, W, H = self.COL, self.w, self.h
        songs = d.get("songs") or []
        cur = (d.get("song") or {}).get("index")
        if cur is not None and self.pages.get("songs_cur") != cur:
            self.pages["songs_cur"] = cur
            self.pages["songs"] = int(cur) // 6
        items = [dict(s, index=i) for i, s in enumerate(songs)]
        shown, page, pages = self.paged("songs", items, 6)
        self.chips(g, hits, "tracks", pager=("songs", page, pages) if pages > 1 else None)
        y, rh = 76, (H - 46 - 76) / 6
        for s in shown:
            on = s["index"] == cur
            box = [6, y + 2, W - 6, y + rh - 2]
            g.rounded_rectangle(box, 8, fill=C["selected"] if on else C["btn"], outline=C["accent"] if on else C["line"])
            self.text(g, (16, (box[1] + box[3]) / 2), str(s["index"] + 1), self.F["label"], C["accent"] if on else C["muted"], "lm")
            self.text(g, (44, (box[1] + box[3]) / 2), s.get("name") or "Song", self.F["name"], C["text"], "lm", W - 44 - 70)
            self.text(g, (W - 30, (box[1] + box[3]) / 2), s.get("key") or "", self.F["label"], C["muted"], "rm")
            if s.get("hasTracks"):   # (a dot: the song has tracks)
                cy = (box[1] + box[3]) / 2
                g.ellipse([W - 22, cy - 4, W - 14, cy + 4], fill=C["accent"])
            hits.append((list(map(int, box)), {"name": "loadSong", "args": {"index": s["index"]}}))
            y += rh
        if not songs:
            self.text(g, (W / 2, 170), "The setlist is empty", self.F["sub"], C["muted"], "mm")

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
        vol = (d.get("mini") or {}).get("volume")
        if vol is None:
            vol = (d.get("performance") or {}).get("volume", 1)
        self.fader(g, hits, [6, 186, W - 6, 228], "Pads volume", vol or 0, {"name": "volume"})
        self.button(g, hits, [6, 234, W - 6, H - 46], "AUTO SET-UP", {"name": "instrumentAuto"}, sub="listens to you play and sets the gain")

    # ----- SETTINGS -------------------------------------------------------------------------------------------------
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
            self.text(g, (W / 2, 200), "Outputs: set on the Central Pedal app (Settings → Audio)", self.F["sub"], C["muted"], "mm")

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
        bw = (W - 12 - 5) / 2
        flipped = int((self.spec or {}).get("rotate") or 0) == 180
        self.button(g, hits, [6, 208, 6 + bw, H - 46], "CALIBRATE", {"local": "calibrate"}, sub="touch the two crosses")
        self.button(g, hits, [6 + bw + 5, 208, W - 6, H - 46], "FLIP 180°", {"local": "flip"}, on=flipped, sub="upside down" if flipped else "for a screen mounted upside down")

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
        try:
            pk = package_lines(read_json(os.path.join(self.driver.config["data_root"], "packages.json"), [])) if self.driver else []
        except Exception:
            pk = []
        lines += [("Packages" if i == 0 else "", v) for i, v in enumerate(pk[:2])] or [("Packages", "none - free sounds and pedals")]
        y = 80
        for k, v in lines:
            self.text(g, (10, y), k, self.F["label"], C["muted"])
            self.text(g, (130, y), v, self.F["label"], C["text"], "la", W - 140)
            y += 22
        self.text(g, (130, y), "Add a package in the app or Pedal Control", self.F["sub"], C["muted"], "la", W - 140)
        bw = (W - 12 - 10) / 3
        by0, by1 = H - 46 - 64, H - 50
        self.button(g, hits, [6, by0, 6 + bw, by1], "CALIBRATE", {"local": "calibrate"}, sub="the touch")
        self.button(g, hits, [6 + bw + 5, by0, 6 + 2 * bw + 5, by1], "RESTART", {"local": "reboot"}, on=self.confirm == "reboot", sub="tap again" if self.confirm == "reboot" else "the pedal")
        self.button(g, hits, [6 + 2 * bw + 10, by0, W - 6, by1], "SHUT DOWN", {"local": "shutdown"}, on=self.confirm == "shutdown", fill=C["stop"], sub="tap again" if self.confirm == "shutdown" else "safely")

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
        elif kind == "sub":
            self.tab = a.get("tab") or self.tab
            self.sub[self.tab] = a.get("value")
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
        elif kind == "setupStop" and self.driver and getattr(self.driver, "phone_setup", None):
            threading.Thread(target=self.driver.phone_setup.stop, daemon=True).start()
        elif kind == "calibrate" and self.driver:
            self.driver.start_touch_calibration()
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
        """One touch on the panel (raw panel numbers): a calibration point, or the button under it."""
        if self.driver and self.driver.touch_calibrating:
            self.driver.touch_calibration_point(raw_x, raw_y)
            return None
        x, y = self.map_touch(raw_x, raw_y)
        action = self.hit_test(x, y)
        self.active = None
        if not action:
            return None
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
            self.send_value(action, x)
            return action
        if self.driver:
            self.driver.emit({"type": "action", "name": action["name"], "args": action.get("args") or {}, "from_": "screen"})
        return action

    def drag(self, raw_x, raw_y):
        """A finger sliding on a fader: its value follows (about 25 a second)."""
        a = self.active
        if not a or time.monotonic() - self.drag_at < 0.04:
            return None
        self.drag_at = time.monotonic()
        x, _ = self.map_touch(raw_x, raw_y)
        return self.send_value(a, x)

    def push(self):
        if not self.available or self.image is None or not self.fb_present():
            return False
        img = self.image
        if self.spec.get("rotate"):
            img = img.rotate(int(self.spec["rotate"]), expand=True)
        size = self.fb_size()
        if size and tuple(size) != img.size:   # a 320×240 screen: the same picture, scaled
            img = img.resize(tuple(size), getattr(self.Image, "LANCZOS", 1))
        try:
            with open(self.fb, "r+b") as handle:
                handle.write(self.to_rgb565(img))
            return True
        except Exception as error:
            log.debug("framebuffer write failed (%s)", error)
            return False

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
        with self.lock:
            for box, action in self.hits:
                if box[0] <= x <= box[2] and box[1] <= y <= box[3]:
                    return action
        return None

    def map_touch(self, raw_x, raw_y):
        c = self.spec.get("calibration") or {}
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
            x = y = None
            down = pending = False
            samples, down_at = [], 0.0
            try:
                for event in dev.read_loop():
                    if usb.stop_flag.is_set():
                        break
                    # The panel sends "touched" before the place it was touched (both in one report): the tap is acted
                    # on at the end of the report, with this touch's place - not the last one's (or none at all).
                    if event.type == ev.ecodes.EV_ABS:
                        if event.code in (ev.ecodes.ABS_X, getattr(ev.ecodes, "ABS_MT_POSITION_X", -1)):
                            x = event.value
                        elif event.code in (ev.ecodes.ABS_Y, getattr(ev.ecodes, "ABS_MT_POSITION_Y", -1)):
                            y = event.value
                    elif event.type == ev.ecodes.EV_KEY and event.code == ev.ecodes.BTN_TOUCH:
                        if event.value == 1 and not down:
                            down = pending = True
                            samples, down_at = [], time.monotonic()
                        elif event.value == 0:
                            if pending and samples:   # (a very quick tap: what was read so far)
                                self.tap(*self.steady(samples))
                            down = pending = False
                            self.active = None
                    elif event.type == ev.ecodes.EV_SYN and x is not None and y is not None:
                        if pending:
                            # A resistive panel's first readings jump while the finger settles: the tap goes off on the
                            # middle of the first few (about 30 ms), not on the very first one.
                            samples.append((x, y))
                            if len(samples) >= 4 or time.monotonic() - down_at > 0.05:
                                pending = False
                                self.tap(*self.steady(samples))
                        elif down and self.active:
                            self.drag(x, y)   # (a finger sliding along a fader)
            except Exception as error:
                log.debug("touch loop ended (%s)", error)
                time.sleep(2)

    @staticmethod
    def steady(samples):
        """The touch's place from its first readings: the middle value of each (the first reading left out when there
        are enough)."""
        pts = samples[1:] if len(samples) >= 3 else samples
        xs, ys = sorted(p[0] for p in pts), sorted(p[1] for p in pts)
        return xs[len(xs) // 2], ys[len(ys) // 2]

    def draw_calibration(self, step):
        img = self.Image.new("RGB", (self.w, self.h), self.COL["bg"])
        g = self.ImageDraw.Draw(img)
        pts = [(20, 20), (self.w - 20, self.h - 20)]
        g.text((self.w / 2 - 90, self.h / 2 - 10), "Touch the cross (%d of 2)" % (step + 1), font=self.font, fill=self.COL["text"])
        px, py = pts[min(step, 1)]
        g.line([px - 12, py, px + 12, py], fill=self.COL["accent"], width=2)
        g.line([px, py - 12, px, py + 12], fill=self.COL["accent"], width=2)
        with self.lock:
            self.image = img
            self.hits = []
        self.push()


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
        self.kind = "pc" if driver.config.get("simulated") or driver.config.get("sync_kind") == "pc" else "pi"
        self.stems_mode = driver.config.get("sync_stems") or ("all" if self.kind == "pc" else "setlists")
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

    def drop_files(self, song):
        """Remove a song's stems here unless another song still uses them."""
        used = set()
        for rid, rec in self.songs.items():
            if rid != song.get("id") and not rec.get("deleted") and rid not in self.hidden:
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
            return {"id": self.id, "name": self.name, "kind": self.kind,
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
                              "linked": bool(self.group and p.get("group") == self.group["id"]), "lastSync": p.get("lastSync"), "error": p.get("error")})
            return {"type": "sync", "event": "status", "id": self.id, "name": self.name, "kind": self.kind, "linked": bool(self.group), "stems": self.stems_mode,
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
                           "group": self.group["id"] if self.group else None, "v": APP_VERSION}).encode()

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
        last = 0
        while not self.stopping:
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
                p.update({"name": str(j.get("name") or "")[:60], "address": addr[0], "port": int(j.get("port") or 8080), "group": j.get("group"), "kind": j.get("kind"), "seen": time.time(), "version": j.get("v")})
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
            self.emit_status()

    def pull(self, peer):
        idx = self.fetch(peer, "/api/sync/index")
        if idx.get("id") and peer.get("static"):
            peer["name"] = idx.get("name") or peer["name"]
            peer["kind"] = idx.get("kind")
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
        wanted = self.setlist_song_ids()
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
        wanted = self.setlist_song_ids() if self.stems_mode != "all" else None
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
        with self.lock:
            self._prune()
            token = secrets.token_hex(16)
            self.entries[token] = {"kind": kind, "made": time.time(), "from": str(payload.get("from") or "Central Pedal Control")[:60],
                                   "files": {}, "package": None, "ready": False, "want": payload.get("want") if isinstance(payload.get("want"), list) else None}
            os.makedirs(os.path.join(self.root, token), exist_ok=True)
        if kind == "out":
            self.driver.emit({"type": "pedalExport", "token": token, "from": self.entries[token]["from"], "want": self.entries[token]["want"]})
        sync = getattr(self.driver, "sync", None)
        return 200, {"token": token, "name": sync.name if sync else socket.gethostname(), "appVersion": APP_VERSION}

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
        e["package"] = package
        write_json(os.path.join(self.root, token, "package.json"), package)
        songs = package.get("songs") or []
        self.driver.emit({"type": "pedalUpload", "token": token, "from": e["from"], "summary": {
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
        self._save()

    def _save(self):
        write_json(self.path, {"id": self.id, "address": self.address if not os.environ.get("CC_CENTER") else "", "port": self.port, "unpaired": self.unpaired, "job": getattr(self, "job", "player")})

    def info(self):
        t = self.target or {}
        p = self.player or {}
        return {"state": self.state, "name": self.name, "address": t.get("host") if self.connected else None, "port": t.get("port") if self.connected else None,
                "error": self.error, "configured": self.address or "", "job": self.job if self.paired else "player",
                "player": {"name": p.get("name"), "address": p.get("address"), "online": bool(p.get("online"))} if p and self.paired else None,
                "remote": bool(self.remote is not None), "paired": bool(self.paired)}

    def job_now(self):
        """What this Central Pedal does right now: on its own (not paired) it always plays."""
        return self.job if self.paired else "player"

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
        p = self.player or {}
        want = "%s:%s" % (p.get("address"), p.get("wsPort") or 8081) if self.job in ("controller", "backup") and p.get("address") and p.get("online") else ""
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
                await ws.send(json.dumps({"type": "auth", "code": self.driver.code}))
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

    def forward(self, message):
        """An action from this pedal's buttons, for the player (controller job)."""
        ws = self.remote
        if ws is None:
            return False
        out = {"type": "action", "name": str(message.get("name") or "")[:40], "args": message.get("args") or {}, "code": self.driver.code}
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

    def code_ok(self, code):
        return str(code or "").strip() == self.code

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

    def emit(self, message, lan=False):
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
            await ws.send(json.dumps(dict(self.display, type="display")) if self.display else json.dumps({"type": "display", "song": None}))
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
        elif kind == "tunerView":
            self.tuner_view = {k: message.get(k) for k in ("note", "cents", "on")} if message.get("on") else None
            self.schedule_mini_render()
        elif kind == "display":
            # the heavy parts (beat grid, hits) only travel when they change; keep the last ones for late joiners
            prev = self.display or {}
            if "grid" not in message and prev.get("songId") == message.get("songId"):
                for k in ("grid", "hits"):
                    if k in prev:
                        message[k] = prev[k]
            self.display = message
            self.emit(message, lan=True)
            self.schedule_mini_render()
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

    def audio_config(self):
        cfg = read_json(os.path.join(self.config["data_root"], "audio.json"), {"hdmi": False, "usbFirst": False})
        chans = read_json(os.path.join(self.config["data_root"], "audio-channels.json"), {})
        cfg["channels"] = chans.get("channels") or []
        cfg["cards"] = chans.get("cards") or []
        return cfg

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
                run_privileged("/usr/sbin/shutdown", "-r", "now")
            elif action == "audio":
                cfg = {"hdmi": bool(message.get("hdmi")), "usbFirst": bool(message.get("usbFirst"))}
                write_json(os.path.join(self.config["data_root"], "audio.json"), cfg)
                run_privileged(SYSTEM_SCRIPT, "audio", "hdmi" if cfg["hdmi"] else "nohdmi", "usbfirst" if cfg["usbFirst"] else "jackfirst")
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
        if not (self.mini and self.mini.available):
            return
        self.touch_calibrating = True
        self.touch_points = []
        self.mini.draw_calibration(0)

    def touch_calibration_point(self, raw_x, raw_y):
        self.touch_points.append((raw_x, raw_y))
        if len(self.touch_points) < 2:
            self.mini.draw_calibration(1)
            return
        (x1, y1), (x2, y2) = self.touch_points
        cal = dict((self.config.get("mini_screen") or {}).get("calibration") or {})
        swap = abs(x2 - x1) < abs(y2 - y1)
        if swap:
            x1, y1, x2, y2 = y1, x1, y2, x2
        W, H = self.mini.w, self.mini.h
        fx, fy = 20 / (W - 1), 20 / (H - 1)
        span_x = (x2 - x1) / (1 - 2 * fx)
        span_y = (y2 - y1) / (1 - 2 * fy)
        cal.update({"swap": swap, "flip_x": span_x < 0, "flip_y": span_y < 0})
        xmin, xmax = (x1 - fx * span_x, x1 + (1 - fx) * span_x)
        ymin, ymax = (y1 - fy * span_y, y1 + (1 - fy) * span_y)
        cal.update({"xmin": int(min(xmin, xmax)), "xmax": int(max(xmin, xmax)), "ymin": int(min(ymin, ymax)), "ymax": int(max(ymin, ymax))})
        self.config.setdefault("mini_screen", {})["calibration"] = cal
        self.mini.spec["calibration"] = cal
        self.touch_calibrating = False
        self.save_config()
        self.emit({"type": "touchCalibrated", "calibration": cal})
        self.schedule_mini_render(force=True)

    # ----- LEDs ---------------------------------------------------------------
    def update_leds(self):
        for led_id, entry in self.leds.items():
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
    def schedule_mini_render(self, force=False):
        if not (self.mini and self.mini.available):
            return
        now = time.monotonic()
        if not force and now - self.last_mini_render < 0.1:
            if self.mini_timer is None and self.loop:
                self.mini_timer = self.loop.call_later(0.12, lambda: self.schedule_mini_render(True))
            return
        self.mini_timer = None
        self.last_mini_render = now

        def work():
            try:
                self.mini.render(self.display)
                self.mini.push()
            except Exception as error:
                log.debug("mini render failed (%s)", error)

        threading.Thread(target=work, daemon=True).start()

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
        threading.Thread(target=self.phone_setup.watch, daemon=True).start()
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
