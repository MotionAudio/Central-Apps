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
import hashlib
import json
import logging
import mimetypes
import os
import random
import re
import shutil
import signal
import socket
import struct
import sys
import subprocess
import threading
import zipfile
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import instrument_host
except Exception as _error:  # the host is optional (needs PipeWire tools on the Pi)
    instrument_host = None
    logging.getLogger("pedal-driver").info("instrument host unavailable: %s", _error)
try:
    import sources  # Planning Center + track packs (MultiTracks.com, Loop Community)
except Exception as _error:
    sources = None
    logging.getLogger("pedal-driver").info("sources unavailable: %s", _error)

log = logging.getLogger("pedal-driver")

VERSION = 7
APP_VERSION = "8.0.0"
CONFIG_CANDIDATES = ["/data/pad-pedal/hardware.json", "/etc/pad-pedal/hardware.json"]
SYSTEM_SCRIPT = "/usr/local/sbin/pad-pedal-system"
AUDIO_EXTENSIONS = (".wav", ".mp3", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".aif", ".aiff", ".opus")
CHART_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg", ".txt", ".cho", ".chopro", ".crd", ".pro", ".onsong")
SF2_EXTENSIONS = (".sf2", ".sf3")
UPLOAD_KINDS = ("stems", "sounds", "charts", "sf2")

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
    return (config.get("tft_overlay") or "none") != "none"


def reserved_pins(config):
    pins = set(RESERVED_ALWAYS)
    if screen_on(config):
        pins.update(RESERVED_TFT)
    return sorted(pins)


def slug(text):
    text = re.sub(r"\(.*?\)", "", str(text or "")).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def safe_name(name):
    name = os.path.basename(name or "").strip().replace("\\", "_")
    name = re.sub(r"[^A-Za-z0-9 ._\-()&'+#,]", "_", name)
    return name[:120] or "file"


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


def ip_addresses():
    code, out, _ = run(["hostname", "-I"], timeout=5)
    if code != 0:
        return []
    return [a for a in out.split() if re.match(r"^\d+\.\d+\.\d+\.\d+$", a) and not a.startswith("127.")]


def wifi_status(scan=False):
    status = {"connected": None, "signal": None, "addresses": ip_addresses(), "networks": [], "available": shutil.which("nmcli") is not None}
    if not status["available"]:
        return status
    code, out, _ = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes" if scan else "no"], timeout=30 if scan else 8)
    seen = {}
    if code == 0:
        for line in out.splitlines():
            parts = line.replace("\\:", "\u0000").split(":")
            if len(parts) < 4:
                continue
            active, ssid, signal, security = parts[0] == "yes", parts[1].replace("\u0000", ":"), int(parts[2] or 0), parts[3]
            if not ssid:
                continue
            if active:
                status["connected"], status["signal"] = ssid, signal
            if ssid in seen and seen[ssid]["signal"] >= signal and not active:
                continue
            seen[ssid] = {"ssid": ssid, "signal": signal, "security": security, "active": active}
    status["networks"] = sorted(seen.values(), key=lambda n: (-int(n["active"]), -n["signal"]))
    return status


def wifi_connect(ssid, password, hidden=False):
    if not shutil.which("nmcli"):
        return False, "NetworkManager is not available"
    run(["nmcli", "connection", "delete", "padpedal-wifi"], timeout=10)
    cmd = ["nmcli", "connection", "add", "type", "wifi", "con-name", "padpedal-wifi", "ifname", "wlan0", "ssid", ssid,
           "connection.autoconnect", "yes", "connection.autoconnect-retries", "0", "connection.autoconnect-priority", "10"]
    if password:
        cmd += ["wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", password]
    if hidden:
        cmd += ["802-11-wireless.hidden", "yes"]
    code, out, err = run(cmd, timeout=20)
    if code != 0:
        return False, (err or out).strip()
    code, out, err = run(["nmcli", "connection", "up", "padpedal-wifi"], timeout=60)
    return code == 0, (err or out).strip()


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


# what a Central Usage computer may ask the Central Control to do: page the lyrics. Starting, stopping and
# moving the tracks is only done on the Central Control.
CU_ACTIONS = ("lyricsNext", "lyricsPrev")
DISPLAY_KEYS = ("hdmi1", "hdmi2", "cursor", "mode1", "mode2", "scale", "inset1", "inset2")


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
        with open(path) as handle:
            return json.load(handle)
    except Exception:
        return default


def write_json(path, value):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".part", "w") as handle:
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
    BACKUP_FILES = ("project.json", "hardware.json", "audio.json", "code", "settings.json", "sources.json")

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
                raise ValueError("not a Central Control backup")
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
                if p == "/project":
                    pj = os.path.join(driver.config["data_root"], "project.json")
                    return self.send_file(pj, "application/json") if os.path.isfile(pj) else self.send_json(200, {})
                return self.send_json(404, {"error": "unknown"})

            def do_PUT(self):
                url = urllib.parse.urlparse(self.path)
                query = urllib.parse.parse_qs(url.query)
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
                    return self.send_json(200, {"ok": True, "size": len(data)})
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
                if p in pages:
                    return self.serve_static(root, pages[p])
                if p.startswith("/fonts/"):
                    return self.serve_static(os.path.join(driver.config["app_root"], "fonts"), p[len("/fonts/"):])
                if p == "/api/display":
                    return self.send_json(200, driver.display)
                if p == "/api/info":
                    return self.send_json(200, {"hostname": socket.gethostname(), "wsPort": driver.config["lan_ws_port"], "version": VERSION, "appVersion": APP_VERSION, "addresses": ip_addresses(),
                                                "interfaces": ip_interfaces(), "netAudio": {"mode": driver.netaudio.cfg["mode"]}, "audioHost": driver.public_audio_host()})
                if p == "/api/hub":   # songs on the Central Control, for Central Usage
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
                if p == "/api/lighting":  # the light show (cues) of one song, written by Central Usage
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
                    driver.emit({"type": "lighting", "song": sid, "updated": show["updated"], "by": show["by"]}, lan=True)
                    return self.send_json(200, {"ok": True, "updated": show["updated"]})
                if url.path == "/api/slides":   # a picture / video from Central Usage for the Pi's slides screen
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
            in_names = [n for n in self.mido.get_input_names() if "Through" not in n]
            out_names = [n for n in self.mido.get_output_names() if "Through" not in n] if self.want_out else []
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
    """Draws a compact Pad Pedal / Tracks remote on /dev/fb1 and reads its touch panel."""
    COL = {"bg": (8, 17, 29), "bar": (16, 30, 49), "text": (236, 247, 255), "muted": (155, 178, 201), "accent": (93, 230, 176),
           "idle": (22, 42, 66), "selected": (31, 68, 110), "playing": (34, 128, 92), "stop": (96, 34, 46), "line": (41, 73, 102), "on": (93, 230, 176)}

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
        try:
            from PIL import Image, ImageDraw, ImageFont
            self.Image, self.ImageDraw, self.ImageFont = Image, ImageDraw, ImageFont
        except Exception as error:
            log.info("3.5\" screen rendering disabled (%s) - install python3-pil", error)
            return
        self.available = True
        candidates = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                      "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"]
        path = next((c for c in candidates if os.path.isfile(c)), None)
        try:
            self.font = self.ImageFont.truetype(path, 15) if path else self.ImageFont.load_default()
            self.small = self.ImageFont.truetype(path, 12) if path else self.ImageFont.load_default()
            self.big = self.ImageFont.truetype(path, 24) if path else self.ImageFont.load_default()
        except Exception:
            self.font = self.small = self.big = self.ImageFont.load_default()

    def fb_present(self):
        return os.path.exists(self.fb)

    @staticmethod
    def clip(text, n):
        text = str(text or "")
        return text if len(text) <= n else text[: n - 1] + "…"

    def render(self, d):
        """Draw the whole screen from the app's display state. Returns the PIL image."""
        if not self.available:
            return None
        C, W, H = self.COL, self.w, self.h
        img = self.Image.new("RGB", (W, H), C["bg"])
        g = self.ImageDraw.Draw(img)
        hits = []
        d = d or {}
        song = d.get("song") or {}
        tracks = bool(d.get("tracksMode"))
        section = d.get("section") or {}
        key = str(d.get("key") or song.get("key") or "C").replace("#", "♯")
        g.rectangle([0, 0, W, 44], fill=C["bar"])
        g.text((8, 5), self.clip(song.get("name") or "Pad Pedal", 22), font=self.font, fill=C["text"])
        if tracks:
            sub = (section.get("name") or "") + ("  · bar %s" % d.get("bar") if d.get("bar") else "")
            if d.get("countIn"):
                sub = "Count-in %s" % d.get("countIn")
            elif d.get("loop", -1) >= 0:
                sub += "  ↻"
        else:
            sub = "Pads" + ("  · layer" if (d.get("performance") or {}).get("layerMode") else "") + ("  · frozen" if d.get("frozen") else "")
        g.text((8, 25), self.clip(sub, 32), font=self.small, fill=C["muted"])
        g.text((W - 150, 4), "KEY", font=self.small, fill=C["muted"])
        g.text((W - 150, 16), key, font=self.big, fill=C["accent"])
        g.text((W - 86, 4), "BPM", font=self.small, fill=C["muted"])
        g.text((W - 86, 16), str(int(round(d.get("bpm") or 0))), font=self.big, fill=C["text"])
        if tracks:
            pos = d.get("pos") or 0
            g.text((W - 218, 4), "TIME", font=self.small, fill=C["muted"])
            g.text((W - 218, 18), "%d:%02d" % (int(pos) // 60, int(pos) % 60), font=self.font, fill=C["text"])
            if d.get("playing"):
                g.ellipse([W - 12, 6, W - 4, 14], fill=C["accent"])
        pads = d.get("pads") or []
        gx, gy, gw, gh = 6, 50, 296, H - 56
        cols, rows = 3, 3
        cw, ch = (gw - (cols - 1) * 5) / cols, (gh - (rows - 1) * 5) / rows
        for i in range(9):
            r, c = divmod(i, cols)
            x0, y0 = gx + c * (cw + 5), gy + r * (ch + 5)
            box = [int(x0), int(y0), int(x0 + cw), int(y0 + ch)]
            if i == 8:
                g.rounded_rectangle(box, 8, fill=C["stop"], outline=(130, 65, 75))
                g.text((x0 + 10, y0 + ch / 2 - 10), "STOP", font=self.font, fill=(255, 255, 255))
                hits.append((box, {"name": "stop"}))
                continue
            pad = pads[i] if i < len(pads) else {"name": "Pad %d" % (i + 1)}
            state = "playing" if pad.get("playing") else "selected" if pad.get("selected") else "idle"
            g.rounded_rectangle(box, 8, fill=C[state], outline=C["accent"] if state == "playing" else C["line"])
            g.text((x0 + 7, y0 + 4), str(i + 1), font=self.small, fill=C["accent"] if state == "playing" else C["muted"])
            g.text((x0 + 7, y0 + ch - 24), self.clip(pad.get("name"), 11), font=self.small, fill=C["text"])
            hits.append((box, {"name": "pad", "args": {"index": i}}))
        bx, by, bw = 308, 50, W - 308 - 6
        if tracks:
            buttons = [("‖ PAUSE" if d.get("playing") else "▶ PLAY", {"name": "playPause"}, bool(d.get("playing"))),
                       ("|◀ START", {"name": "startOver"}, False), ("SECTION ▶|", {"name": "nextSection"}, False),
                       ("↻ REPEAT", {"name": "repeatSection"}, d.get("loop", -1) >= 0),
                       ("KEY −", {"name": "keyDown"}, False), ("KEY +", {"name": "keyUp"}, False),
                       ("CLICK", {"name": "toggleClick"}, bool(d.get("click", True))), ("NEXT SONG", {"name": "nextSong"}, False)]
        else:
            perf = d.get("performance") or {}
            buttons = [("TAP", {"name": "tap"}, False), ("FREEZE", {"name": "freeze"}, bool(d.get("frozen"))),
                       ("KEY −", {"name": "keyDown"}, False), ("KEY +", {"name": "keyUp"}, False),
                       ("LAYER", {"name": "layer"}, bool(perf.get("layerMode"))), ("NEXT SONG", {"name": "nextSong"}, False),
                       ("PREV SONG", {"name": "prevSong"}, False), ("TRACKS", {"name": "toggleTracks"}, False)]
        rows = 4
        bh = (H - by - 6 - (rows - 1) * 4) / rows
        for i, (label, action, on) in enumerate(buttons[:8]):
            r, c = divmod(i, 2)
            x0, y0 = bx + c * (bw / 2 + 2), by + r * (bh + 4)
            box = [int(x0), int(y0), int(x0 + bw / 2 - 2), int(y0 + bh)]
            g.rounded_rectangle(box, 7, fill=C["on"] if on else (21, 42, 67), outline=C["line"])
            g.text((x0 + 6, y0 + bh / 2 - 8), label, font=self.small, fill=(6, 34, 24) if on else C["text"])
            hits.append((box, action))
        with self.lock:
            self.image = img
            self.hits = hits
        return img

    def push(self):
        if not self.available or self.image is None or not self.fb_present():
            return False
        img = self.image
        if self.spec.get("rotate"):
            img = img.rotate(int(self.spec["rotate"]), expand=True)
        try:
            with open(self.fb, "r+b") as handle:
                handle.write(self.to_rgb565(img))
            return True
        except Exception as error:
            log.debug("framebuffer write failed (%s)", error)
            return False

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
        want = (self.spec.get("touch") or "ADS7846").lower()
        while not usb.stop_flag.is_set():
            dev = None
            try:
                for path in ev.list_devices():
                    d = ev.InputDevice(path)
                    if want in d.name.lower():
                        dev = d
                        break
                    d.close()
            except Exception:
                dev = None
            if dev is None:
                time.sleep(5)
                continue
            log.info("3.5\" touch panel: %s", dev.name)
            x = y = None
            down = False
            try:
                for event in dev.read_loop():
                    if usb.stop_flag.is_set():
                        break
                    if event.type == ev.ecodes.EV_ABS:
                        if event.code == ev.ecodes.ABS_X:
                            x = event.value
                        elif event.code == ev.ecodes.ABS_Y:
                            y = event.value
                    elif event.type == ev.ecodes.EV_KEY and event.code == ev.ecodes.BTN_TOUCH:
                        if event.value == 1 and not down and x is not None and y is not None:
                            down = True
                            if self.driver.touch_calibrating:
                                self.driver.touch_calibration_point(x, y)
                            else:
                                action = self.hit_test(*self.map_touch(x, y))
                                if action:
                                    self.driver.emit(dict(action, type="action", from_="screen"))
                        elif event.value == 0:
                            down = False
            except Exception as error:
                log.debug("touch loop ended (%s)", error)
                time.sleep(2)

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
# Network audio: Central Control -> Central Usage computers (Ethernet or Wi-Fi)
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
    return found


class NetAudio:
    """The tracks (each stem on its own channel), click, pads, the tracks mix and the instrument go to
    Central Usage over the network. The app renders the channels and sends them here as binary packets;
    the Pi adds the instrument channel, captured from its output with pw-record. Every Central Usage
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
        self.cfg = {"mode": "off", "rate": 48000, "instrument": True, "quality": "full"}
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

    def refusal(self):
        mode = self.cfg["mode"]
        if mode == "off":
            return "Network audio is off on the Central Control (I/O tab)."
        if mode == "interface":
            return "The Central Control sends its audio through the audio interface (I/O tab), not the network."
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
            return "The Central Control has no %s connection right now." % ("Ethernet" if mode == "ethernet" else "Wi-Fi")
        if local in kinds and kinds[local] != mode:
            return "Audio goes over %s only: connect to the Central Control's %s address." % (("Ethernet", "Ethernet") if mode == "ethernet" else ("Wi-Fi", "Wi-Fi"))
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
        self.subs[ws] = {"sources": sources, "name": str(message.get("name") or "Central Usage")[:40], "address": peer, "dropped": 0}
        self.update()
        return {"type": "audioSubscribed", "ok": True, "sources": self.sources, "mode": self.cfg["mode"]}

    def unsubscribe(self, ws):
        if self.subs.pop(ws, None) is not None:
            self.update()

    # ----- the packets
    def set_info(self, message):
        names = [str(n)[:40] for n in (message.get("channels") or [])][:64]
        self.sources[0] = {"channels": names, "rate": int(message.get("rate") or 48000)}
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
        self.updater = sources.Updater(os.path.join(data_root, "updates.json"), APP_VERSION, os.path.join(data_root, "updates"), api=config.get("update_api")) if sources and hasattr(sources, "Updater") else None
        self.propresenter = sources.ProPresenter(os.path.join(data_root, "propresenter.json")) if sources and hasattr(sources, "ProPresenter") else None
        self.pco = sources.PlanningCenter(os.path.join(data_root, "sources.json"), config.get("pco_base") or "https://api.planningcenteronline.com") if sources else None
        self.instrument = instrument_host.InstrumentHost(self, data_root, config["app_root"]) if instrument_host else None
        self.netaudio = NetAudio(self, os.path.join(data_root, "netaudio.json"))
        self.audio_host = None        # the Central Usage computer that makes the in-ear mixes: {name, address, port, ws}
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
            "soundCards": sound_cards(),
            "mouse": self.usb.pointer["mouse"] if self.usb else False,
            "keyboard": self.usb.pointer["keyboard"] if self.usb else False,
            "addresses": ip_addresses(),
            "interfaces": ip_interfaces(),
            "code": self.code,
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
                if isinstance(raw, (bytes, bytearray)):   # network audio from the app -> Central Usage
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
                        # only the Central Control itself starts, stops and moves the tracks
                        await ws.send(json.dumps({"type": "refused", "action": message.get("name"), "error": "Only the Central Control plays, stops and skips the tracks."}))
                    else:
                        source = "central-usage" if self.lan_clients[ws].get("app") == "central-usage" else "companion"
                        self.emit({"type": "action", "name": message.get("name"), "args": message.get("args") or {}, "from": source})
                elif kind == "ping":  # clock sync: the client's t comes back with the Pi's clock
                    await ws.send(json.dumps({"type": "pong", "t": message.get("t"), "serverT": int(time.monotonic() * 1000), "clock": getattr(self, "lan_clock", None)}))
                elif kind == "client":   # who is this: {app: "central-usage", mode: admin / user, name}
                    self.lan_clients[ws]["app"] = str(message.get("app") or "")[:40]
                    self.lan_clients[ws]["mode"] = str(message.get("mode") or "")[:20]
                    self.lan_clients[ws]["name"] = str(message.get("name") or "")[:40]
                elif kind in ("audioSubscribe", "audioUnsubscribe", "audioHost", "slide"):
                    authed = self.lan_clients[ws]["auth"] or self.code_ok(message.get("code"))
                    if kind == "audioUnsubscribe":
                        self.netaudio.unsubscribe(ws)
                    elif not authed:
                        await ws.send(json.dumps({"type": "auth", "ok": False, "for": kind}))
                    elif kind == "audioSubscribe":
                        await ws.send(json.dumps(self.netaudio.subscribe(ws, message)))
                    elif kind == "audioHost":
                        self.audio_host_message(ws, message)
                    else:
                        self.set_slide(message)
        finally:
            self.lan_clients.pop(ws, None)
            self.netaudio.unsubscribe(ws)
            if self.audio_host and self.audio_host.get("ws") is ws:
                self.audio_host = None
                self.emit({"type": "audioHost", "host": None}, lan=True)

    def audio_host_message(self, ws, message):
        """One Central Usage computer makes the in-ear mixes (the audio host); every other one finds it here."""
        if message.get("action") == "register":
            try:
                address = ws.remote_address[0]
            except Exception:
                address = None
            address = str(message.get("address") or address or "")[:64]
            self.audio_host = {"name": str(message.get("name") or "Central Usage")[:40], "address": address, "port": int(message.get("port") or 8092), "since": int(time.time() * 1000), "ws": ws}
        elif message.get("action") == "unregister" and self.audio_host and self.audio_host.get("ws") is ws:
            self.audio_host = None
        self.emit({"type": "audioHost", "host": self.public_audio_host()}, lan=True)

    def set_slide(self, message):
        """Slides / lyrics from Central Usage for a screen on the Pi (HDMI 2 set to "Slides")."""
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
        """Songs with tracks on the Central Control, for Central Usage (lighting songs, waveform, sections, hits)."""
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
            # Central Usage (lighting computers) generate their own MIDI clock from this
            self.lan_clock = {"bpm": message.get("bpm"), "running": bool(message.get("running")), "t": int(time.monotonic() * 1000)}
            self.emit(dict(self.lan_clock, type="clock"), lan=True)
        elif kind == "midiOut":
            if self.midi:
                self.midi.send_messages(message.get("messages") or [])
            # the same notes (hits for the lights, section notes, program changes) go to Central Usage
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
            elif action == "check":
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
        if path in ("/pack/scan", "/pack/import"):
            ok, real = self.local.allowed(payload.get("path") or "") if self.local else (False, "")
            if not ok or not os.path.exists(real):
                raise ValueError("that file or folder is not on a USB stick / SD card / the uploads")
            if path == "/pack/scan":
                return sources.scan_pack(real)
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
        """Once a day (and a minute after start-up): look for a newer release. Only looks - the app asks first."""
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
            time.sleep(3600)

    def software_update(self, zip_path):
        """Install a central-control-source zip from a USB stick: the root helper copies the files
        into /opt/pad-pedal (and into the read-only system partition when safe mode is on), then the
        driver restarts itself and the app reloads. On a PC (simulation) it only reports what it would do."""
        if self.sim or not os.path.exists("/usr/local/sbin/pad-pedal-system") or not os.path.isdir("/etc/pad-pedal"):
            return {"ok": False, "error": "software updates from USB work on the Central Control itself"}
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

    def displays_config(self):
        return read_json(os.path.join(self.config["data_root"], "displays.json"), {"hdmi1": "app", "hdmi2": "lyrics", "cursor": "auto"})

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
            "miniScreen": bool(self.mini and self.mini.available and self.mini.fb_present()),
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
            "centralUsage": [{"name": v.get("name") or "Central Usage", "mode": v.get("mode") or ""} for v in self.lan_clients.values() if v.get("app") == "central-usage"],
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
            if action == "wifi":
                if message.get("ssid"):
                    ok, text = wifi_connect(message["ssid"], message.get("password") or "", bool(message.get("hidden")))
                    self.emit({"type": "wifiResult", "ok": ok, "message": text, "ssid": message["ssid"]})
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
        self.start_gpio()
        self.start_analog()
        self.local = LocalServer(self, int(self.config["http_port"]))
        self.local.start()
        self.companion = CompanionServer(self, int(self.config["lan_port"]))
        self.companion.start()
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
        mini_spec = self.config.get("mini_screen") or {}
        if mini_spec.get("enabled", True):
            self.mini = MiniScreen(self, mini_spec, self.fb_override)
            if self.mini.available and self.usb.available:
                threading.Thread(target=self.mini.touch_loop, args=(self.usb,), daemon=True).start()
            if self.mini.available and self.mini.fb_present():
                self.schedule_mini_render(force=True)
        server = await websockets.serve(self.handle_client, self.config["ws_host"], int(self.config["ws_port"]))
        log.info("listening on ws://%s:%s", self.config["ws_host"], self.config["ws_port"])
        lan_server = None
        try:
            lan_server = await websockets.serve(self.handle_lan_client, "0.0.0.0", int(self.config["lan_ws_port"]))
            log.info("companion websocket on ws://0.0.0.0:%s (pairing code %s)", self.config["lan_ws_port"], self.code)
        except Exception as error:
            log.warning("companion websocket could not start (%s)", error)
        tasks.append(asyncio.create_task(self.analog_loop()))
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


if __name__ == "__main__":
    main()
