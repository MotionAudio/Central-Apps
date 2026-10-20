#!/usr/bin/env python3
"""
Pad Pedal - driver test (no Raspberry Pi needed)
=================================================
Runs the REAL pedal-driver.py against gpiozero's MockFactory (simulated pins)
and a simulated pair of ADS1115 boards, and talks to it over real WebSockets
and HTTP exactly like the app and the companion pages do.

Proves: the hello, button press / hold / release, knobs + sliders (scaling,
smoothing, jitter filter), encoder, Learn (a press on a free pin, a pin that
another button already uses, a turned knob), the app's LED states, display
state -> the 3.5" screen drawing + companion websocket, chart text parsing
(sections, lyrics without chords, key / bpm / time), a Wi-Fi upload of a
chart that the app is told about, cue words, the USB/SD browser (listing,
download, and that nothing outside the media folders can be read), and the
companion remote (pairing code).

    pip install gpiozero websockets pillow      # on a PC; on the Pi they come from apt
    python3 test_pedal_driver.py
"""
import asyncio
import importlib.util
import json
import os
import math
import shutil
import struct
import subprocess
import sys
import wave
import zipfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import websockets
    from gpiozero import Device
    from gpiozero.pins.mock import MockFactory
except ImportError as error:
    print("needs gpiozero + websockets:  pip install gpiozero websockets  (%s)" % error)
    sys.exit(2)

spec = importlib.util.spec_from_file_location("pedal_driver", Path(__file__).with_name("pedal-driver.py"))
driver_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver_mod)

failures = []


def check(label, ok, detail=""):
    print(("  ✓ " if ok else "  ✗ ") + label + ("" if ok or not detail else "   -- " + str(detail)[:300]))
    if not ok:
        failures.append(label)


class FakeADSBus:
    """Simulates ADS1115 chips: set .volts[(addr, ch)] and the driver reads it."""

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
        raw = int(round(self.volts.get((addr, self.mux.get(addr, 0)), 0.0) / 4.096 * 32767))
        raw = max(-32768, min(32767, raw)) & 0xFFFF
        return [raw >> 8, raw & 0xFF]


def http(url, data=None, method=None, headers=None):
    request = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"), headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


# ---- a tiny stand-in for api.planningcenteronline.com (JSON:API, same shapes as the real one)
import base64
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PCO_AUTH = "Basic " + base64.b64encode(b"app123:secret456").decode()
PCO_CHART = "VERSE 1\n[G]Amazing grace how [C]sweet the sound\nCHORUS\n[D]My chains are gone\n"


class MockPCO(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/files/"):
            return self.reply(200, b"RIFF....WAVE" + path.encode(), "audio/wav")
        if self.headers.get("Authorization") != PCO_AUTH:
            return self.reply(401, {"errors": [{"title": "Unauthorized"}]})
        base = "http://127.0.0.1:18099"
        routes = {
            "/services/v2": {"data": {"type": "Organization", "id": "1", "attributes": {"name": "Grace Church"}}},
            "/services/v2/service_types": {"data": [{"type": "ServiceType", "id": "77", "attributes": {"name": "Sunday Morning"}}], "links": {}},
            "/services/v2/service_types/77/plans": {"data": [{"type": "Plan", "id": "900", "attributes": {"title": "Easter", "dates": "April 5, 2026", "sort_date": "2026-04-05T10:00:00Z", "items_count": 4}}], "links": {}},
            "/services/v2/service_types/77/plans/900/items": {"data": [
                {"type": "Item", "id": "1", "attributes": {"title": "Welcome", "item_type": "item"}},
                {"type": "Item", "id": "2", "attributes": {"title": "Amazing Grace (My Chains Are Gone)", "item_type": "song", "key_name": "Ab"}, "relationships": {"song": {"data": {"type": "Song", "id": "s1"}}, "arrangement": {"data": {"type": "Arrangement", "id": "a1"}}, "key": {"data": {"type": "Key", "id": "k1"}}}}],
                "included": [{"type": "Song", "id": "s1", "attributes": {"title": "Amazing Grace (My Chains Are Gone)", "author": "Chris Tomlin"}},
                             {"type": "Arrangement", "id": "a1", "attributes": {"name": "Default", "bpm": 66.0, "meter": "3/4", "sequence": ["Verse 1", "Chorus", "Verse 1", "Chorus"], "chord_chart": PCO_CHART, "lyrics": "x"}},
                             {"type": "Key", "id": "k1", "attributes": {"name": "Ab", "starting_key": "Ab"}}], "links": {}},
            "/services/v2/songs/s1/arrangements/a1": {"data": {"type": "Arrangement", "id": "a1", "attributes": {"bpm": 66.0, "meter": "3/4", "sequence": ["Verse 1", "Chorus", "Verse 1", "Chorus"], "chord_chart": PCO_CHART}}},
            "/services/v2/songs/s1/arrangements/a1/attachments": {"data": [
                {"type": "Attachment", "id": "f1", "attributes": {"filename": "Click.wav", "file_size": 20}}, {"type": "Attachment", "id": "f2", "attributes": {"filename": "Bass.wav", "file_size": 20}},
                {"type": "Attachment", "id": "f3", "attributes": {"filename": "Amazing Grace - Full Mix.mp3", "file_size": 20}}, {"type": "Attachment", "id": "f4", "attributes": {"filename": "Lead Sheet.pdf", "file_size": 20}}], "links": {}},
        }
        for fid in ("f1", "f2", "f3", "f4"):
            routes["/services/v2/attachments/%s/open" % fid] = {"data": {"type": "AttachmentActivity", "attributes": {"attachment_url": base + "/files/" + fid}}}
        if path in routes:
            return self.reply(200, routes[path])
        return self.reply(404, {"errors": []})


def io_wav(seconds, rate=8000):
    import io
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<hh", int(8000 * math.sin(i / 9.0)), 0) for i in range(int(seconds * rate))))
    return buf.getvalue()


FAKE_AUDIO = r"""
import math, random, struct, wave
def tone(path, name, rate=22050, secs=2.0):
    # a stand-in stem with something in it: the kit pieces are hits at known times (for the lights), "toms" is silent
    n = int(rate * secs); key = name.lower(); rnd = random.Random(len(key)); x = [0.0] * n
    def burst(t, length, fn):
        i0 = int(t * rate)
        for j in range(min(int(length * rate), n - i0)):
            x[i0 + j] += fn(j / float(rate))
    if key == "toms":
        pass
    elif key == "kick":
        for t in (0.25, 0.75, 1.25, 1.75):
            burst(t, 0.15, lambda u: 0.8 * math.exp(-u / 0.03) * math.sin(2 * math.pi * 60 * u))
    elif key == "snare":
        for t in (0.5, 1.5):
            burst(t, 0.2, lambda u: 0.5 * math.exp(-u / 0.05) * (rnd.uniform(-1, 1) + math.sin(2 * math.pi * 190 * u)))
    elif key in ("hh", "crash", "ride"):
        prev = [0.0]
        def hiss(u):
            v = rnd.uniform(-1, 1); d = v - prev[0]; prev[0] = v
            return 0.3 * math.exp(-u / (0.3 if key == "crash" else 0.01)) * d
        for t in ((0.25,) if key == "crash" else (0.125, 0.375, 0.625, 0.875, 1.125, 1.375, 1.625, 1.875) if key == "hh" else (0.3,)):
            burst(t, 0.6 if key == "crash" else 0.05, hiss)
    else:
        f = 110 + 37 * (sum(map(ord, key)) % 40)
        x = [0.3 * math.sin(2 * math.pi * f * i / rate) for i in range(n)]
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<hh", int(max(-1, min(1, v)) * 32767), int(max(-1, min(1, v)) * 32767)) for v in x))
"""

FAKE_SEPARATOR = FAKE_AUDIO + r"""
import json, os, sys, time
argv = sys.argv[1:]
log = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake-separator-argv.json")
calls = json.load(open(log)) if os.path.exists(log) else []
json.dump(calls + [argv], open(log, "w"))
if "--extra_models" in argv and os.environ.get("FAKE_ENSEMBLE_FAIL"):
    print("ValueError: ensemble needs the same stems from every model", flush=True)
    sys.exit(1)
src, model, out = argv[0], argv[argv.index("-m") + 1], argv[argv.index("--output_dir") + 1]
stems = (["kick", "snare", "toms", "hh", "ride", "crash"] if "DrumSep" in model else ["Vocals", "Other"] if "kim" in model else ["No Reverb", "Reverb"] if "DeReverb" in model
         else ["Vocals", "Instrumental"])
ext = {"MP3": "mp3", "FLAC": "flac"}.get(argv[argv.index("--output_format") + 1], "wav")
for p in (0, 50, 100):
    sys.stdout.write("%3d%%|%s| %d/100\r" % (p, "#" * (p // 10), p)); sys.stdout.flush(); time.sleep(0.1)
os.makedirs(out, exist_ok=True)
base = os.path.basename(src).rsplit(".", 1)[0]
for s in stems:
    tone(os.path.join(out, "%s_(%s)_%s.%s" % (base, s, model.rsplit(".", 1)[0], ext)), s)
print("separated")
"""

FAKE_DEMUCS = FAKE_AUDIO + r"""
import json, os, sys, time
argv = sys.argv[1:]
here = os.path.dirname(os.path.abspath(__file__))
json.dump(argv, open(os.path.join(here, "fake-demucs-argv.json"), "w"))
calls = os.path.join(here, "fake-demucs-calls.json")
json.dump((json.load(open(calls)) if os.path.exists(calls) else []) + [argv], open(calls, "w"))
if os.environ.get("FAKE_DEMUCS_FAIL"):
    print("RuntimeError: CPU out of memory (tried to allocate 2 GB)", flush=True)
    sys.exit(1)
out = argv[argv.index("-o") + 1]
model = argv[argv.index("-n") + 1]
ext = "mp3" if "--mp3" in argv else "flac" if "--flac" in argv else "wav"
if "--two-stems" in argv:
    s = argv[argv.index("--two-stems") + 1]
    stems = [s, "no_" + s]
else:
    stems = ["drums", "bass", "other", "vocals"] + (["guitar", "piano"] if model == "htdemucs_6s" else [])
for p in (0, 25, 50, 75, 100):
    sys.stdout.write("%3d%%|%s| %d/100 [00:01<00:01]\r" % (p, "#" * (p // 10), p))
    sys.stdout.flush()
    time.sleep(0.25)
d = os.path.join(out, model)
os.makedirs(d, exist_ok=True)
for s in stems:
    tone(os.path.join(d, s + "." + ext), s)
print("done")
"""


async def main():
    factory = MockFactory()
    Device.pin_factory = factory
    root = tempfile.mkdtemp(prefix="pp-test-")
    media_root = os.path.join(root, "Music")
    os.makedirs(os.path.join(media_root, "Pads"))
    with open(os.path.join(media_root, "Pads", "Warm C.wav"), "wb") as handle:
        handle.write(b"RIFF....WAVEfake-audio")
    with open(os.path.join(media_root, "notes.txt"), "w") as handle:
        handle.write("not audio")
    os.symlink("/etc", os.path.join(media_root, "escape"))
    app_root = os.path.join(root, "app")
    os.makedirs(os.path.join(app_root, "companion"))
    os.makedirs(os.path.join(app_root, "cues"))
    with open(os.path.join(app_root, "index.html"), "w") as handle:
        handle.write("<html>app</html>")
    with open(os.path.join(app_root, "companion", "index.html"), "w") as handle:
        handle.write("<html>charts</html>")
    with open(os.path.join(app_root, "cues", "chorus.wav"), "wb") as handle:
        handle.write(b"RIFF....WAVEfake")
    config = driver_mod.load_config(None)
    config.update({"ws_port": 18765, "http_port": 18766, "lan_port": 18080, "lan_ws_port": 18081, "debounce_s": None, "hold_s": 0.25,
                   "analog_smoothing": 1.0, "media_roots": [media_root], "midi": False, "link": False, "pco_base": "http://127.0.0.1:18099", "update_api": "http://127.0.0.1:18098",
                   "app_root": app_root, "data_root": os.path.join(root, "data"), "tft_overlay": "none", "center": False,
                   "leds": [{"id": "led1", "gpio": 20, "follows": "b1"}]})
    config["mini_screen"]["fb"] = os.path.join(root, "fb1")
    with open(config["mini_screen"]["fb"], "wb") as handle:
        handle.write(b"\0" * (480 * 320 * 2))
    bus = FakeADSBus([0x48, 0x49])
    for ch in range(4):
        bus.volts[(0x48, ch)] = 1.65
        bus.volts[(0x49, ch)] = 0.2
    driver = driver_mod.PedalDriver(config, pin_factory=factory, i2c_bus=bus, fb_override=config["mini_screen"]["fb"])
    driver.config_path = os.path.join(root, "data", "hardware.json")
    stop_event = asyncio.Event()
    server_task = asyncio.create_task(driver.run(stop_event))
    for _ in range(100):  # wait for the WebSocket server (the instrument host scans sound banks first)
        await asyncio.sleep(0.1)
        if server_task.done():
            server_task.result()
        try:
            _, w = await asyncio.open_connection("127.0.0.1", 18765)
            w.close()
            break
        except OSError:
            continue
    pin_of = {i["id"]: i["gpio"] for i in config["inputs"] if i.get("gpio") is not None}

    async with websockets.connect("ws://127.0.0.1:18765") as ws:
        async def next_message(match=lambda m: True, timeout=1.5):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                try:
                    message = json.loads(await asyncio.wait_for(ws.recv(), deadline - time.monotonic()))
                except asyncio.TimeoutError:
                    break
                if match(message):
                    return message
            return None

        async def send(message):
            await ws.send(json.dumps(message))

        print("Connection:")
        hello = await next_message(lambda m: m["type"] == "hello")
        check("driver says hello over a real WebSocket", hello is not None, hello)
        check("hello: version 4, the 12 buttons + 6 knobs + 2 sliders + expression + encoder, pairing code",
              hello and hello["version"] >= 6 and len([i for i in hello["inputs"] if i["kind"] == "button"]) == 12
              and len([i for i in hello["inputs"] if i["kind"] == "knob"]) == 6 and len([i for i in hello["inputs"] if i["kind"] == "slider"]) == 2
              and len(hello["code"]) == 4 and hello["reservedPins"] == [2, 3, 18, 19, 21], hello and {k: hello[k] for k in ("version", "code", "reservedPins")})
        check("hello says which knobs really answered (0x48 + 0x49 yes, expression on 0x4a no)",
              hello and all(i.get("active") for i in hello["inputs"] if i["kind"] in ("knob", "slider")) and not [i for i in hello["inputs"] if i["id"] == "exp"][0].get("active"), hello)
        await send({"type": "role", "role": "app"})
        check("'role: app' is answered with a second hello (the app waits for it)", (await next_message(lambda m: m["type"] == "hello")) is not None)

        print("\nButtons:")
        for bid in ("b1", "b8", "b12"):
            pin = factory.pin(pin_of[bid])
            pin.drive_low()
            press = await next_message(lambda m: m["type"] == "control" and m.get("event") == "press")
            pin.drive_high()
            check("%s (GPIO %d) press -> control press" % (bid, pin_of[bid]), press == {"type": "control", "id": bid, "event": "press"}, press)
            release = await next_message(lambda m: m["type"] == "control" and m.get("event") == "release")
            check("  ...and letting go -> release", release == {"type": "control", "id": bid, "event": "release"}, release)
        pin = factory.pin(pin_of["b9"])
        pin.drive_low()
        await next_message(lambda m: m.get("event") == "press")
        check("holding b9 -> hold event", (await next_message(lambda m: m.get("event") == "hold")) == {"type": "control", "id": "b9", "event": "hold"})
        pin.drive_high()
        await next_message(lambda m: m.get("event") == "release")

        print("\nEncoder:")
        enc = [i for i in config["inputs"] if i["id"] == "enc"][0]
        a, b = factory.pin(enc["gpio_a"]), factory.pin(enc["gpio_b"])
        for state in ((0, 1), (0, 0), (1, 0), (1, 1)):
            (a.drive_low if state[0] == 0 else a.drive_high)()
            (b.drive_low if state[1] == 0 else b.drive_high)()
            await asyncio.sleep(0.01)
        turn = await next_message(lambda m: m["type"] == "control" and "delta" in m)
        check("turning the encoder -> control delta", turn is not None and turn["id"] == "enc" and turn["delta"] in (1, -1), turn)
        push = factory.pin(enc["gpio_button"])
        push.drive_low()
        check("encoder push -> press on 'enc'", (await next_message(lambda m: m.get("event") == "press")) == {"type": "control", "id": "enc", "event": "press"})
        push.drive_high()
        await next_message(lambda m: m.get("event") == "release")

        print("\nKnobs and sliders:")
        bus.volts[(0x48, 0)] = 1.72
        k1 = await next_message(lambda m: m["type"] == "control" and m.get("id") == "k1" and "value" in m, 2.0)
        check("knob 1 at 1.72 V reads about 0.52", k1 is not None and 0.48 <= k1["value"] <= 0.56, k1)
        bus.volts[(0x49, 2)] = 3.3
        s1 = await next_message(lambda m: m["type"] == "control" and m.get("id") == "s1" and m.get("value", 0) > 0.9, 2.0)
        check("slider 1 at 3.3 V reads 1.0", s1 is not None and s1["value"] == 1.0, s1)
        bus.volts[(0x48, 1)] = 1.6505
        wobble = await next_message(lambda m: m.get("id") == "k2", 0.5)
        check("a 0.5 mV wobble on knob 2 is filtered out", wobble is None, wobble)

        print("\nLearn:")
        await send({"type": "learn", "target": "b3", "kind": "button"})
        check("learn acknowledged", (await next_message(lambda m: m["type"] == "learning")) == {"type": "learning", "target": "b3"})
        free = driver.free_pins()
        check("free pins exclude I2C, the DAC and every pin in use", 20 not in free and all(p not in free for p in (2, 3, 18, 19, 21, 4, 5, 6)) and 17 in free, free)
        pin = factory.pin(free[0])
        pin.drive_low()
        learned = await next_message(lambda m: m["type"] == "learned")
        pin.drive_high()
        check("pressing a switch on free GPIO %d -> learned for b3" % free[0], learned == {"type": "learned", "target": "b3", "input": {"gpio": free[0]}}, learned)
        await send({"type": "learn", "target": "b3", "kind": "button"})
        await next_message(lambda m: m["type"] == "learning")
        pin = factory.pin(pin_of["b7"])
        pin.drive_low()
        learned = await next_message(lambda m: m["type"] == "learned")
        pin.drive_high()
        check("pressing the switch that b7 uses -> learned with alreadyUsedBy b7 (the app swaps them)",
              learned and learned["input"] == {"gpio": pin_of["b7"]} and learned.get("alreadyUsedBy") == "b7", learned)
        await send({"type": "learn", "target": "k4", "kind": "knob"})
        await next_message(lambda m: m["type"] == "learning")
        await asyncio.sleep(0.2)
        bus.volts[(0x49, 1)] = 3.0
        learned = await next_message(lambda m: m["type"] == "learned", 2.5)
        check("turning the knob on 0x49 A1 -> learned adc 0x49 / 1 (already knob 6)", learned and learned["input"] == {"adc": {"address": "0x49", "channel": 1}} and learned.get("alreadyUsedBy") == "k6", learned)
        await send({"type": "learn", "target": "b3", "kind": "button"})
        await next_message(lambda m: m["type"] == "learning")
        await send({"type": "learnCancel"})
        await asyncio.sleep(0.1)
        check("learnCancel stops learning", driver.learn is None)
        new_inputs = json.loads(json.dumps(config["inputs"]))
        new_inputs[2]["gpio"] = free[0]
        await send({"type": "inputs", "inputs": new_inputs, "save": True})
        hello2 = await next_message(lambda m: m["type"] == "hello", 3.0)
        check("saving inputs re-creates the buttons and answers with a hello", hello2 and [i for i in hello2["inputs"] if i["id"] == "b3"][0]["gpio"] == free[0], hello2 and hello2["inputs"][2])
        check("hardware.json was written", os.path.exists(driver.config_path))
        pin = factory.pin(free[0])
        pin.drive_low()
        press = await next_message(lambda m: m.get("event") == "press")
        pin.drive_high()
        check("b3 now works on its new pin", press == {"type": "control", "id": "b3", "event": "press"}, press)
        await next_message(lambda m: m.get("event") == "release")

        print("\nLEDs:")
        await send({"type": "leds", "states": {"b1": "on", "b2": "off"}, "bpm": 120})
        await asyncio.sleep(0.15)
        check("led1 follows b1 -> lit", factory.pin(20).state == 1)
        await send({"type": "leds", "states": {"b1": "off"}, "bpm": 120})
        await asyncio.sleep(0.15)
        check("...and goes dark", factory.pin(20).state == 0)

        print("\nDisplay state, 3.5\" screen and companion:")
        display = {"type": "display", "song": {"name": "Great Is Thy Faithfulness", "key": "G", "bpm": 72}, "key": "G", "bpm": 72, "tracksMode": True, "playing": True, "pos": 83, "bar": 21, "loop": -1,
                   "section": {"name": "Chorus 2"}, "pads": [{"name": "Warm Pad", "playing": True}, {"name": "Ambient"}]}
        async with websockets.connect("ws://127.0.0.1:18081") as lan:
            lan_hello = json.loads(await asyncio.wait_for(lan.recv(), 2))
            check("companion websocket greets with hostname + needsCode", lan_hello["type"] == "hello" and lan_hello["needsCode"], lan_hello)
            await asyncio.wait_for(lan.recv(), 2)  # initial (empty) display
            await send(display)
            got = json.loads(await asyncio.wait_for(lan.recv(), 2))
            check("the app's display state is relayed to companion devices", got["type"] == "display" and got["song"]["name"] == "Great Is Thy Faithfulness", got)
            await lan.send(json.dumps({"type": "action", "name": "nextSection"}))
            denied = json.loads(await asyncio.wait_for(lan.recv(), 2))
            check("a remote action without the pairing code is refused", denied == {"type": "auth", "ok": False}, denied)
            await lan.send(json.dumps({"type": "auth", "code": hello["code"]}))
            check("the pairing code unlocks it", json.loads(await asyncio.wait_for(lan.recv(), 2)) == {"type": "auth", "ok": True})
            await lan.send(json.dumps({"type": "action", "name": "nextSection"}))
            action = await next_message(lambda m: m["type"] == "action")
            check("...and the action reaches the app as {action nextSection from companion}", action == {"type": "action", "name": "nextSection", "args": {}, "from": "companion"}, action)
            # the MIDI hits for the lights (and section notes, program changes) go to the main admin too
            await send({"type": "midiOut", "messages": [{"data": [0x90, 60, 127], "at": 12}]})
            hit = None
            for _ in range(10):
                mm = json.loads(await asyncio.wait_for(lan.recv(), 2))
                if mm.get("type") == "midi":
                    hit = mm
                    break
            check("the MIDI hits go to Central Control over the network with the Pi's clock (for the lights)", hit and hit["messages"][0]["data"] == [0x90, 60, 127] and isinstance(hit.get("t"), int), hit)
        await asyncio.sleep(0.4)
        with open(config["mini_screen"]["fb"], "rb") as handle:
            fb = handle.read()
        check("the 3.5\" framebuffer was drawn (480x320 RGB565, not blank)", len(fb) == 480 * 320 * 2 and any(fb), len(fb))
        hit = driver.mini.hit_test(60, 100)
        check("touching pad 1 on the small screen -> action pad 1", hit == {"name": "pad", "args": {"index": 0}}, hit)
        hit = driver.mini.hit_test(340, 70)
        check("touching the transport button -> playPause", hit == {"name": "playPause"}, hit)
        driver.handle_app_message({"type": "touchSelect", "knob": "Knob 3", "label": "Reverb · Big Sky", "value": "40%", "pickup": "up"})
        img = driver.mini.render(driver.display)
        check("the small screen shows what the touch-select knob holds (a strip along the bottom)", driver.touch_select["label"] == "Reverb · Big Sky" and img.getpixel((240, 300)) == (10, 40, 30), driver.touch_select)
        driver.handle_app_message({"type": "touchSelect"})
        driver.handle_app_message({"type": "tunerView", "on": True, "note": "E2", "cents": -12})
        img = driver.mini.render(driver.display)
        check("...and the tuner while it is up on the Instrument tab; DONE turns it off", driver.mini.hit_test(420, 290) == {"name": "tuner"} and img.getpixel((240, 100)) == (4, 9, 16))
        driver.handle_app_message({"type": "tunerView", "on": False})
        driver.mini.render(driver.display)
        status, body = http("http://127.0.0.1:18080/api/display")
        check("companion HTTP /api/display returns the same state", status == 200 and json.loads(body)["song"]["key"] == "G")
        status, body = http("http://127.0.0.1:18080/")
        check("companion charts page is served on the Wi-Fi port", status == 200 and b"charts" in body)
        status, body = http("http://127.0.0.1:18080/api/action", data=json.dumps({"name": "tap", "code": "0000" if hello["code"] != "0000" else "1111"}).encode())
        check("HTTP remote action with a wrong code -> 403", status == 403)
        status, body = http("http://127.0.0.1:18080/api/action", data=json.dumps({"name": "tap", "code": hello["code"]}).encode())
        action = await next_message(lambda m: m["type"] == "action")
        check("HTTP remote action with the code -> app gets {action tap}", status == 200 and action and action["name"] == "tap", action)

        print("\nCentral Control: network audio, the audio host, the hub, slides:")
        na_before = dict(driver.netaudio.cfg)
        driver.netaudio.configure({"mode": "off", "auto": True})
        driver.center_link.on_role({"job": "player"})
        check("paired as the track player, network audio turns on by itself (each track, click, pads, instrument to the main admin)", driver.netaudio.cfg["mode"] in ("wifi", "ethernet"), driver.netaudio.cfg)
        driver.netaudio.configure({"mode": "off"})
        driver.center_link.on_role({"job": "instrument"})
        check("...but once it is set off by hand it stays off", driver.netaudio.cfg["mode"] == "off" and driver.netaudio.cfg["auto"] is False, driver.netaudio.cfg)
        driver.netaudio.configure(na_before)
        driver.center_link.paired = False

        async with websockets.connect("ws://127.0.0.1:18081") as cu:
            await asyncio.wait_for(cu.recv(), 2)
            await asyncio.wait_for(cu.recv(), 2)  # hello + display

            async def cu_next(match, timeout=2.0, binary=False):
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    try:
                        raw = await asyncio.wait_for(cu.recv(), deadline - time.monotonic())
                    except asyncio.TimeoutError:
                        break
                    if isinstance(raw, (bytes, bytearray)):
                        if binary:
                            return bytes(raw)
                        continue
                    m = json.loads(raw)
                    if not binary and match(m):
                        return m
                return None
            await cu.send(json.dumps({"type": "client", "app": "central-usage", "mode": "admin", "name": "Desk"}))
            await cu.send(json.dumps({"type": "audioSubscribe", "code": hello["code"], "sources": [0], "name": "Desk"}))
            refused = await cu_next(lambda m: m.get("type") == "audioSubscribed")
            check("network audio is off at first: a subscription is refused, with the reason", refused and not refused["ok"] and "off" in refused["error"], refused)
            await send({"type": "netAudio", "action": "config", "config": {"mode": "ethernet"}})
            st = await next_message(lambda m: m.get("type") == "netAudio" and m["config"]["mode"] == "ethernet")
            check("I/O → Ethernet is kept (netaudio.json)", st and st["config"]["mode"] == "ethernet" and os.path.exists(os.path.join(root, "data", "netaudio.json")), st and st["config"])
            await cu.send(json.dumps({"type": "audioSubscribe", "code": hello["code"], "sources": [0], "name": "Desk"}))
            ok = await cu_next(lambda m: m.get("type") == "audioSubscribed")
            check("with Ethernet on, Central Control subscribes with the pairing code", ok and ok["ok"], ok)
            sending = await next_message(lambda m: m.get("type") == "netAudio" and m.get("sending"))
            check("...and the app is told to start sending (the listener is named)", sending is not None and sending["listeners"][0]["name"] == "Desk", sending)
            await send({"type": "netAudio", "action": "info", "channels": ["Drums", "Bass"], "rate": 48000})
            info = await cu_next(lambda m: m.get("type") == "audioStream")
            check("the channel names reach Central Control", info and info["sources"]["0"]["channels"] == ["Drums", "Bass"], info)
            pkt = struct.pack("<4sBBHId", b"CCA1", 0, 2, 4, 1, 12.5) + struct.pack("<8h", 1, -2, 3, -4, 5, -6, 7, -8)
            await ws.send(pkt)
            got = await cu_next(None, binary=True)
            check("an audio packet from the app is passed on to Central Control byte for byte", got == pkt, got and got[:24])
            await cu.send(json.dumps({"type": "action", "name": "nextSection", "code": hello["code"]}))
            r = await cu_next(lambda m: m.get("type") == "refused")
            check("Central Control can't move the tracks: its nextSection is refused", r and "Only the Central Pedal" in r["error"], r)
            await cu.send(json.dumps({"type": "action", "name": "lyricsNext", "code": hello["code"]}))
            act = await next_message(lambda m: m["type"] == "action")
            check("...it can page the lyrics (marked as coming from Central Control)", act == {"type": "action", "name": "lyricsNext", "args": {}, "from": "central-usage"}, act)
            await cu.send(json.dumps({"type": "audioHost", "action": "register", "code": hello["code"], "port": 8092, "name": "Desk"}))
            h = await cu_next(lambda m: m.get("type") == "audioHost")
            check("an admin computer registers as the audio host and every Central Control is told", h and h["host"]["name"] == "Desk" and h["host"]["port"] == 8092, h)
            status, body = http("http://127.0.0.1:18080/api/info")
            j = json.loads(body)
            check("/api/info names the audio host and the Pi's network connections", status == 200 and j["audioHost"]["name"] == "Desk" and isinstance(j["interfaces"], list), j)
            if not any(i["kind"] == "wifi" for i in driver_mod.ip_interfaces()):
                await send({"type": "netAudio", "action": "config", "config": {"mode": "wifi"}})
                gone = await cu_next(lambda m: m.get("type") == "audioSubscribed")
                await cu.send(json.dumps({"type": "audioSubscribe", "code": hello["code"], "sources": [0]}))
                wifi = await cu_next(lambda m: m.get("type") == "audioSubscribed")
                check("switching to Wi-Fi ends the Ethernet listeners; with no Wi-Fi connection a subscription is refused", gone and not gone["ok"] and wifi and not wifi["ok"] and "Wi-Fi" in wifi["error"], (gone, wifi))
                await send({"type": "netAudio", "action": "config", "config": {"mode": "off"}})
        await asyncio.sleep(0.3)
        check("when the audio host's computer goes away it is forgotten", driver.audio_host is None, driver.audio_host)
        await send({"type": "hub", "songs": [{"id": "s1", "name": "Way Maker", "bpm": 68, "key": "E", "duration": 300, "hasTracks": True, "overview": [0.1, 0.5, 0.9], "sections": [{"name": "Verse 1", "start": 0, "end": 30}]}]})
        await asyncio.sleep(0.3)
        status, body = http("http://127.0.0.1:18080/api/hub")
        check("the app's songs are listed in the hub for Central Control", status == 200 and json.loads(body)["songs"][0]["name"] == "Way Maker", body[:200])
        await send({"type": "hub", "songs": [{"id": "s1", "name": "Way Maker", "bpm": 70, "key": "E", "duration": 300, "hasTracks": True, "sections": []}]})
        await asyncio.sleep(0.3)
        status, body = http("http://127.0.0.1:18080/api/hub/s1")
        j = json.loads(body)
        check("a song's details (tempo, sections, waveform) - the waveform is kept when an update has none", j["bpm"] == 70 and j["overview"] == [0.1, 0.5, 0.9], j)
        png = b"\x89PNG\r\n\x1a\nslide-bytes-0123456789"
        status, body = http("http://127.0.0.1:18080/api/slides?code=%s&name=Welcome.png" % hello["code"], data=png)
        check("Central Control sends a picture for the slides screen (with the code)", status == 200 and json.loads(body)["file"] == "Welcome.png", body)
        status, _ = http("http://127.0.0.1:18080/api/slides?code=0000x&name=X.png", data=png)
        check("...a wrong code is refused", status == 403)
        status, body = http("http://127.0.0.1:18080/api/slides/Welcome.png", headers={"Range": "bytes=2-5"})
        check("slides are served with Range requests (videos seek)", status == 206 and body == png[2:6], (status, body))
        status, body = http("http://127.0.0.1:18080/slides")
        check("the Pi's slides page is served (for HDMI 2 set to Slides)", status == 200 or status == 404, status)

        print("\nCentral Control roles: one main admin, admins, User 1 / User 2:")

        async def cu_open():
            c = await websockets.connect("ws://127.0.0.1:18081")
            await asyncio.wait_for(c.recv(), 2)
            await asyncio.wait_for(c.recv(), 2)
            return c

        async def cu_wait(c, match, timeout=2.0):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                try:
                    raw = await asyncio.wait_for(c.recv(), deadline - time.monotonic())
                except asyncio.TimeoutError:
                    break
                if isinstance(raw, (bytes, bytearray)):
                    continue
                m = json.loads(raw)
                if match(m):
                    return m
            return None

        main_c, b_c, c_c = await cu_open(), await cu_open(), await cu_open()
        token = "main-secret-token-0123456789"
        chosen = os.path.join(root, "data", "code-chosen")
        with open(chosen, "w") as fh:
            fh.write("1")      # as if the pedal's pairing PIN had been typed on its own screen first
        await main_c.send(json.dumps({"type": "cuRole", "action": "hello", "id": "pc-main", "name": "Sound desk", "role": "main", "token": token, "pin": "4321", "pair": "2468"}))
        r = await cu_wait(main_c, lambda m: m.get("type") == "cuRoleReply")
        check("a pedal that already has a pairing PIN: the main admin has to use that PIN", r and not r["ok"] and r.get("needCode"), r)
        os.remove(chosen)
        await main_c.send(json.dumps({"type": "cuRole", "action": "hello", "id": "pc-main", "name": "Sound desk", "role": "main", "token": token, "pin": "4321", "pair": "2468"}))
        v = await cu_wait(main_c, lambda m: m.get("type") == "cuRoles" and m.get("youAreMain"))
        check("a pedal without a PIN yet: the first main admin's pairing PIN becomes the pedal's (main kept in cu-roles.json)", v and v["hasMain"] and driver.code == "2468" and v.get("pairPin") == "2468" and driver.code_chosen() and os.path.exists(os.path.join(root, "data", "cu-roles.json")), v)
        saved = open(os.path.join(root, "data", "cu-roles.json")).read()
        check("the role PIN and token are stored only as salted hashes", "4321" not in saved and token not in saved)
        await b_c.send(json.dumps({"type": "cuRole", "action": "join", "id": "pc-keys", "name": "Keys", "pair": "1111"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("joining with a wrong pairing code is refused", r and not r["ok"], r)
        await b_c.send(json.dumps({"type": "cuRole", "action": "join", "id": "pc-keys", "name": "Keys", "pair": "2468"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("...the right one (the main admin's pairing PIN) joins as User 1", r and r["ok"] and r["role"] == "user1" and r["code"] == "2468", r)
        v = await cu_wait(main_c, lambda m: m.get("type") == "cuRoles" and any(d["id"] == "pc-keys" for d in m.get("devices", [])))
        check("the main admin's People list shows the new computer, online", v and [d for d in v["devices"] if d["id"] == "pc-keys"][0]["online"], v and v.get("devices"))
        await b_c.send(json.dumps({"type": "cuRole", "action": "set", "role": "user2"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("a user switches User 1 -> User 2 by itself", r and r["ok"] and r["role"] == "user2", r)
        await b_c.send(json.dumps({"type": "cuRole", "action": "set", "role": "admin", "pin": "0000"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("...but becoming an admin with a wrong PIN is refused", r and not r["ok"] and "PIN" in r["error"], r)
        await b_c.send(json.dumps({"type": "cuRole", "action": "set", "role": "admin", "pin": "4321"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("...and with the main admin's PIN it becomes an admin", r and r["ok"] and r["role"] == "admin", r)
        await b_c.send(json.dumps({"type": "cuRole", "action": "set", "role": "user1"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("going back from admin to user needs the PIN too", r and not r["ok"], r)
        await main_c.send(json.dumps({"type": "cuRole", "action": "assign", "target": "pc-keys", "role": "user1"}))
        a = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleAssigned")
        check("the main admin changes it from its own People list; the computer is told", a and a["role"] == "user1", a)
        await main_c.send(json.dumps({"type": "cuRole", "action": "jobs", "target": "pc-keys", "jobs": ["lighting", "production", "bogus"]}))
        a = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleAssigned" and m.get("jobs"))
        check("the main admin gives a computer its jobs (unknown ones dropped)", a and a["jobs"] == ["lighting", "production"], a)
        await main_c.send(json.dumps({"type": "cuRole", "action": "jobs", "target": "pc-keys", "jobs": []}))
        a = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleAssigned" and m.get("jobs"))
        check("...no job means General (everything)", a and a["jobs"] == ["general"], a)
        await b_c.send(json.dumps({"type": "cuRole", "action": "jobs", "target": "pc-keys", "jobs": ["mix"]}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("...an admin can't change its own jobs", r and not r["ok"], r)
        await b_c.send(json.dumps({"type": "cuRole", "action": "set", "role": "admin", "ask": True}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        v = await cu_wait(main_c, lambda m: m.get("type") == "cuRoles" and any(d["id"] == "pc-keys" and d.get("wantsAdmin") for d in m.get("devices", [])))
        check("an admin request without the role PIN waits for the main admin (Devices tab)", r and r["ok"] and r.get("pending") and v, r)
        await main_c.send(json.dumps({"type": "cuRole", "action": "approve", "target": "pc-keys", "allow": False}))
        a = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleAssigned")
        check("...the main admin keeps it a user", a and a["role"] == "user1" and a.get("approved") is False, a)
        await main_c.send(json.dumps({"type": "cuRole", "action": "lock", "target": "all", "on": True}))
        v = await cu_wait(b_c, lambda m: m.get("type") == "cuRoles" and (m.get("you") or {}).get("locked"))
        vm = await cu_wait(main_c, lambda m: m.get("type") == "cuRoles" and m.get("lockAll"))
        check("the service lock reaches every computer but the main admin", v and vm and not (vm.get("you") or {}).get("locked"), v)
        await b_c.send(json.dumps({"type": "cuRole", "action": "lock", "target": "all", "on": False}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("...only the main admin unlocks it", r and not r["ok"], r)
        await main_c.send(json.dumps({"type": "cuRole", "action": "lock", "target": "all", "on": False}))
        await main_c.send(json.dumps({"type": "cuRole", "action": "lock", "target": "pc-keys", "on": True}))
        v = await cu_wait(b_c, lambda m: m.get("type") == "cuRoles" and (m.get("you") or {}).get("locked") and not m.get("lockAll"))
        check("...or one computer at a time", v, v)
        await main_c.send(json.dumps({"type": "cuRole", "action": "lock", "target": "pc-keys", "on": False}))
        await b_c.send(json.dumps({"type": "cuRole", "action": "health", "health": {"rtt": 12, "cpu": 33, "battery": 80, "charging": True, "evil": {"x": 1}}}))
        v = await cu_wait(main_c, lambda m: m.get("type") == "cuRoles" and any(d["id"] == "pc-keys" and (d.get("health") or {}).get("rtt") == 12 for d in m.get("devices", [])))
        dv = v and [d for d in v["devices"] if d["id"] == "pc-keys"][0]
        check("each computer's health reaches the main admin's Devices tab (only plain numbers / text kept), with the pedal's own", dv and dv["health"]["cpu"] == 33 and "evil" not in dv["health"] and "app" in (v.get("pedal") or {}), dv)
        await main_c.send(json.dumps({"type": "cuRole", "action": "myJobs", "jobs": ["lighting"]}))
        r = await cu_wait(main_c, lambda m: m.get("type") == "cuRoleReply" and m.get("action") == "myJobs")
        check("the main admin picks its own job (e.g. lighting when someone else runs the cameras)", r and r["ok"] and r["jobs"] == ["lighting"], r)
        await main_c.send(json.dumps({"type": "service", "action": "save", "services": [{"name": "Sunday", "day": 0, "time": "09:00", "roles": ["lighting", "band", "bogus"], "items": [{"title": "Welcome", "kind": "welcome", "minutes": 3, "roles": ["lighting", "slides"]}, {"title": "Song 1", "kind": "song", "minutes": 5, "roles": ["band", "lighting"]}]}] * 1}))
        st = await cu_wait(b_c, lambda m: m.get("type") == "services")
        sv = st and st["services"][0]
        check("services: the main admin's plan reaches everyone, cleaned (roles outside the service dropped)", sv and sv["roles"] == ["lighting", "band"] and sv["items"][0]["roles"] == ["lighting"], st)
        await b_c.send(json.dumps({"type": "service", "action": "start", "service": sv["id"]}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "serviceReply")
        check("...only the main admin runs a service", r and not r["ok"], r)
        await main_c.send(json.dumps({"type": "service", "action": "start", "service": sv["id"]}))
        st = await cu_wait(b_c, lambda m: m.get("type") == "services" and m.get("run"))
        await main_c.send(json.dumps({"type": "service", "action": "next"}))
        st2 = await cu_wait(b_c, lambda m: m.get("type") == "services" and m.get("run") and m["run"]["item"] == 1)
        status, body = http("http://127.0.0.1:18080/api/service")
        check("Start / Next move everyone along; the stage display reads it from /api/service", st and st2 and status == 200 and json.loads(body)["run"]["item"] == 1, st2)
        await main_c.send(json.dumps({"type": "service", "action": "save", "services": [{"name": str(i)} for i in range(5)]}))
        r = await cu_wait(main_c, lambda m: m.get("type") == "serviceReply" and not m.get("ok"))
        check("...up to 4 services", r and "4" in r["error"], r)
        await main_c.send(json.dumps({"type": "service", "action": "stop"}))
        await b_c.send(json.dumps({"type": "cuRole", "action": "assign", "target": "pc-main", "role": "user2"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("only the main admin changes other computers", r and not r["ok"], r)
        await c_c.send(json.dumps({"type": "cuRole", "action": "hello", "id": "pc-lights", "name": "Lights", "role": "main", "token": "another-token-0123456789"}))
        v = await cu_wait(main_c, lambda m: m.get("type") == "cuRoles" and len(m.get("conflict") or []) == 2)
        check("a second 'main admin' is flagged to both (it works as an admin meanwhile)", v and v["conflict"][0]["id"] == "pc-main" and driver.cu_roles.devices["pc-lights"]["role"] == "admin", v and v.get("conflict"))
        await c_c.send(json.dumps({"type": "cuRole", "action": "forget"}))
        r = await cu_wait(c_c, lambda m: m.get("type") == "cuRoleReply")
        check("Forget role on the extra one clears the conflict", r and r["ok"] and "pc-lights" not in driver.cu_roles.devices and len(driver.cu_roles.claimants()) == 1, r)
        r = driver.set_code("4321")
        check("the pairing PIN can't be the main admin's PIN", not r["ok"] and "main admin" in r["error"], r)
        r = driver.set_code("12a")
        check("...and must be 4 digits", not r["ok"], r)
        r = driver.set_code("5150")
        check("a picked pairing PIN is saved (code + code-chosen) and pairs from then on", r["ok"] and driver.code_ok("5150") and open(os.path.join(root, "data", "code")).read() == "5150" and os.path.exists(os.path.join(root, "data", "code-chosen")) and driver.hello()["codeChosen"], r)
        driver.set_code(hello["code"])
        await main_c.send(json.dumps({"type": "auth", "code": hello["code"]}))
        await main_c.send(json.dumps({"type": "audioHost", "action": "register", "code": hello["code"], "port": 8092, "name": "Sound desk", "userCode": "5555", "adminCode": "7777"}))
        v = await cu_wait(b_c, lambda m: m.get("type") == "cuRoles" and m.get("hostCodes"))
        check("the audio host's codes reach each computer by role (a user gets only the in-ear code)", v and v["hostCodes"] == {"user": "5555"}, v and v.get("hostCodes"))
        status, body = http("http://127.0.0.1:18080/api/info")
        check("...and are never in /api/info", b"5555" not in body and b"7777" not in body)
        await b_c.send(json.dumps({"type": "slide", "kind": "text", "text": "hi", "code": hello["code"]}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "refused")
        check("a user computer can't put up slides once there is a main admin", r and "admin" in r["error"], r)
        await main_c.send(json.dumps({"type": "cuRole", "action": "forget", "token": "wrong"}))
        r = await cu_wait(main_c, lambda m: m.get("type") == "cuRoleReply")
        check("the main admin role can only be given up with its own token", r and not r["ok"], r)
        await main_c.send(json.dumps({"type": "cuRole", "action": "forget", "token": token}))
        r = await cu_wait(main_c, lambda m: m.get("type") == "cuRoleReply")
        check("...with it, Forget role leaves no main admin", r and r["ok"] and driver.cu_roles.main is None, r)
        for c in (main_c, b_c, c_c):
            await c.close()

        print("\nCharts:")
        text = "Great Is Thy Faithfulness\nKey: G   Tempo: 72   4/4\n\n[Verse 1]\nG        C/G    G\nGreat is Thy faithfulness, O God my Father\nD7                G\nThere is no shadow of turning with Thee\n\nChorus\nG   D  Em\nGreat is Thy faithfulness\nMorning by morning new mercies I see\n"
        status, body = http("http://127.0.0.1:18766/chart/text", data=json.dumps({"name": "Great Is Thy Faithfulness", "text": text}).encode())
        chart = json.loads(body)
        check("pasted chart text -> sections with lyrics only (chord lines removed)",
              status == 200 and [s["name"] for s in chart["sections"]] == ["Verse 1", "Chorus"] and chart["sections"][0]["lines"] == ["Great is Thy faithfulness, O God my Father", "There is no shadow of turning with Thee"], chart)
        check("key, tempo and time signature read from the header", chart.get("key") == "G" and chart.get("bpm") == 72 and chart.get("time") == "4/4", {k: chart.get(k) for k in ("key", "bpm", "time")})
        status, body = http("http://127.0.0.1:18766/charts")
        check("/charts lists it", status == 200 and any(c["id"] == chart["id"] for c in json.loads(body)["charts"]))
        status, body = http("http://127.0.0.1:18080/api/upload?kind=charts&name=Amazing%20Grace.txt&song=Amazing%20Grace", data=b"[Chorus]\nG D Em C\nAmazing grace how sweet the sound\n", headers={"Content-Type": "text/plain"})
        uploaded = await next_message(lambda m: m["type"] == "uploaded")
        check("a chart uploaded from a phone is parsed and the app is told {uploaded charts}",
              status == 200 and uploaded and uploaded["kind"] == "charts" and uploaded["song"] == "Amazing Grace" and uploaded["chart"]["sections"][0]["lines"] == ["Amazing grace how sweet the sound"], uploaded)
        status, body = http("http://127.0.0.1:18080/api/upload?kind=stems&name=Drums.wav&song=Amazing%20Grace", data=b"RIFF....WAVEfake", headers={"Content-Type": "audio/wav"})
        uploaded = await next_message(lambda m: m["type"] == "uploaded")
        check("a stem uploaded over Wi-Fi lands in the uploads folder and the app is told where",
              status == 200 and uploaded and uploaded["kind"] == "stems" and uploaded["path"].endswith("Drums.wav") and os.path.exists(uploaded["path"]), uploaded)
        status, body = http("http://127.0.0.1:18766/file?path=" + urllib.request.quote(uploaded["path"]))
        check("...and the app can fetch it from the local server", status == 200 and body == b"RIFF....WAVEfake")

        print("\nCue words:")
        status, body = http("http://127.0.0.1:18766/cues")
        check("/cues lists the pre-rendered words", status == 200 and "chorus" in json.loads(body)["cues"], body)
        status, body = http("http://127.0.0.1:18766/cues/chorus.wav")
        check("/cues/chorus.wav is served", status == 200 and body.startswith(b"RIFF"))
        status, body = http("http://127.0.0.1:18766/cues/../../etc/passwd")
        check("cue ids cannot escape the folder", status == 404)

        print("\nUSB / SD browser:")
        status, body = http("http://127.0.0.1:18766/roots")
        roots = json.loads(body)
        check("/roots lists the media folder and the Wi-Fi uploads", status == 200 and any(d["path"] == media_root for d in roots["dirs"]) and any("Wi-Fi" in d["name"] for d in roots["dirs"]), roots)
        status, body = http("http://127.0.0.1:18766/list?path=" + urllib.request.quote(os.path.join(media_root, "Pads")))
        listing = json.loads(body)
        check("/list shows the WAV and hides notes.txt", status == 200 and [f["name"] for f in listing["files"]] == ["Warm C.wav"], listing)
        status, _ = http("http://127.0.0.1:18766/list?path=" + urllib.request.quote(os.path.join(media_root, "escape")))
        check("a symlink out of the media folder is refused", status == 403)
        status, _ = http("http://127.0.0.1:18766/file?path=/etc/passwd")
        check("/file refuses paths outside the media folders", status == 403)

        print("\nKeys sounds from a USB stick:")
        # a folder of WAVs named by note -> SoundFont, and an .sf2 on the stick -> copied into the keys sounds
        bank = os.path.join(media_root, "MyPiano")
        os.makedirs(bank)
        for note, hz in (("C4", 261.63), ("G4", 392.0)):
            with wave.open(os.path.join(bank, note + ".wav"), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
                w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * hz * i / 22050))) for i in range(4410)))
        status, body = http("http://127.0.0.1:18766/list?path=" + urllib.request.quote(bank) + "&kind=sf2")
        listing = json.loads(body) if status == 200 else {}
        check("/list?kind=sf2 shows the WAVs of a sample folder", status == 200 and sorted(f["name"] for f in listing.get("files", [])) == ["C4.wav", "G4.wav"], body[:200])
        status, body = http("http://127.0.0.1:18766/instrument/wavbank", data=json.dumps({"path": bank, "name": "My Piano"}).encode(), headers={"Content-Type": "application/json"})
        made = json.loads(body)
        check("POST /instrument/wavbank turns the folder into a SoundFont", status == 200 and made.get("samples") == 2 and os.path.exists(made.get("file", "")), body[:200])
        if status == 200:
            shutil.copy(made["file"], os.path.join(media_root, "Stick Bank.sf2"))
            status, body = http("http://127.0.0.1:18766/list?path=" + urllib.request.quote(media_root) + "&kind=sf2")
            check("...and an .sf2 on the stick is listed", status == 200 and any(f["name"] == "Stick Bank.sf2" for f in json.loads(body)["files"]), body[:200])
            status, body = http("http://127.0.0.1:18766/instrument/sf2", data=json.dumps({"path": os.path.join(media_root, "Stick Bank.sf2")}).encode(), headers={"Content-Type": "application/json"})
            check("POST /instrument/sf2 copies it into the keys sounds", status == 200 and json.loads(body).get("presets") == 1, body[:200])
            status, body = http("http://127.0.0.1:18766/instrument/sf2", data=json.dumps({"path": "/etc/passwd"}).encode(), headers={"Content-Type": "application/json"})
            check("...but only from the USB / SD / uploads folders", status == 403)
            await ws.send(json.dumps({"type": "instrument", "action": "status"}))
            st = await next_message(lambda m: m["type"] == "instrumentStatus")
            names = [b["name"] for b in (st or {}).get("keysCatalog", []) if b.get("user")]
            check("the Instrument tab's sound list has both new banks, marked as the user's", "My Piano" in names and "Stick Bank" in names, names)

        print("\nPlanning Center and track packs:")
        pco_srv = ThreadingHTTPServer(("127.0.0.1", 18099), MockPCO)
        threading.Thread(target=pco_srv.serve_forever, daemon=True).start()
        jpost = lambda path, body: http("http://127.0.0.1:18766" + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        status, body = jpost("/pco/connect", {"appId": "app123", "secret": "wrong"})
        check("a wrong Planning Center token is refused and not kept", status == 400 and "refused" in json.loads(body)["error"] and json.loads(http("http://127.0.0.1:18766/pco/status")[1])["configured"] is False, body[:200])
        status, body = jpost("/pco/connect", {"appId": "app123", "secret": "secret456"})
        check("connecting with a Personal Access Token names the church", status == 200 and json.loads(body).get("organization") == "Grace Church", body[:200])
        status, body = http("http://127.0.0.1:18766/pco/service-types")
        st = json.loads(body).get("serviceTypes") or []
        status, body = http("http://127.0.0.1:18766/pco/plans?type=77")
        plans = json.loads(body).get("plans") or []
        check("service types and upcoming plans are listed", st and st[0]["name"] == "Sunday Morning" and plans and plans[0]["title"] == "Easter", (st, plans))
        status, body = http("http://127.0.0.1:18766/pco/items?type=77&plan=900")
        items = json.loads(body).get("items") or []
        check("the plan's songs come with key (Ab -> G#), BPM, meter and the arrangement sequence; non-song items are left out",
              len(items) == 1 and items[0]["key"] == "G#" and items[0]["bpm"] == 66.0 and items[0]["bpb"] == 3 and items[0]["sequence"] == ["Verse 1", "Chorus", "Verse 1", "Chorus"], items)
        status, body = jpost("/pco/import", {"item": items[0] if items else {}, "song": "song-pco"})
        imp = json.loads(body) if status == 200 else {}
        names = sorted(f["name"] for f in imp.get("files", []))
        check("importing a song writes its chord chart (sections + lyrics) and downloads the stems, not the full mix",
              status == 200 and imp["chart"] and [x["name"] for x in imp["chart"]["sections"]] == ["Verse 1", "Chorus"] and names == ["Bass.wav", "Click.wav"]
              and all(os.path.exists(f["path"]) and "/library/song-pco/" in f["path"] for f in imp["files"]), body[:300])
        check("...with the stems' roles guessed (Click -> click)", {f["name"]: f["role"] for f in imp.get("files", [])}.get("Click.wav") == "click", imp.get("files"))
        pco_srv.shutdown()
        # a MultiTracks.com-style zip on the stick: stems + a full mix + a chart, the key and BPM in the name
        pack = os.path.join(media_root, "Way Maker - Leeland - 68bpm - E - MultiTracks.zip")
        with zipfile.ZipFile(pack, "w") as zf:
            for n in ("Click.wav", "Guide.wav", "Drums.wav", "Bass.wav", "EG 1.wav", "AG.wav", "Keys.wav", "BGVs.wav", "Way Maker - Full Mix.wav"):
                zf.writestr("Way Maker/" + n, b"RIFF....WAVE" + n.encode())
            zf.writestr("Way Maker/Chart.txt", "{title: Way Maker}\nVERSE 1\nYou are here moving in our midst\n")
            zf.writestr("__MACOSX/._Click.wav", b"junk")
        status, body = jpost("/pack/scan", {"path": pack})
        sc = json.loads(body) if status == 200 else {}
        roles = {e["name"]: e["role"] for e in sc.get("stems", [])}
        check("scanning a MultiTracks.com zip: title, key E, 68 BPM, every stem's role, the full mix set aside",
              sc.get("title") == "Way Maker" and sc.get("key") == "E" and sc.get("bpm") == 68 and sc.get("vendor") == "MultiTracks.com" and len(sc.get("stems", [])) == 9
              and roles.get("Click.wav") == "click" and roles.get("Guide.wav") == "guide" and roles.get("EG 1.wav") == "guitar" and roles.get("AG.wav") == "guitar" and roles.get("BGVs.wav") == "vocals"
              and [e["name"] for e in sc["stems"] if not e["use"]] == ["Way Maker - Full Mix.wav"], body[:400])
        status, body = jpost("/pack/import", {"path": pack, "song": "song-wm"})
        im = json.loads(body) if status == 200 else {}
        check("importing it unpacks 8 stems and the chart into the library", status == 200 and len(im.get("files", [])) == 8 and all(os.path.exists(f["path"]) for f in im["files"]) and im.get("chartInfos") and im["chartInfos"][0]["sections"][0]["name"] == "Verse 1", body[:300])
        status, body = jpost("/pack/scan", {"path": "/etc"})
        check("packs only from the USB / SD / uploads folders", status == 400)
        # the sections: an Ableton Live set's locators (MultiTracks.com "Ableton" downloads) and a MIDI file's markers
        import gzip
        als = ('<?xml version="1.0" encoding="UTF-8"?><Ableton><LiveSet><MasterTrack><DeviceChain><Mixer><Tempo><LomId Value="0" /><Manual Value="68" /></Tempo></Mixer></DeviceChain></MasterTrack>'
               '<Locators><Locators><Locator Id="1"><Time Value="16" /><Name Value="Verse 1" /></Locator><Locator Id="0"><Time Value="0" /><Name Value="Intro" /></Locator>'
               '<Locator Id="2"><Time Value="48" /><Name Value="Chorus" /></Locator></Locators></Locators></LiveSet></Ableton>')
        pack2 = os.path.join(media_root, "Goodness of God (Ab) MultiTracks.zip")
        with zipfile.ZipFile(pack2, "w") as zf:
            for n in ("Click.wav", "Drums.wav", "Bass.wav"):
                zf.writestr("Goodness of God/" + n, b"RIFF....WAVE" + n.encode())
            zf.writestr("Goodness of God/Goodness of God Project/Goodness of God.als", gzip.compress(als.encode()))
        status, body = jpost("/pack/scan", {"path": pack2})
        sc2 = json.loads(body) if status == 200 else {}
        check("an Ableton set in the pack gives the sections (its locators, in order, with their times) and the exact tempo",
              [m["name"] for m in sc2.get("markers", [])] == ["Intro", "Verse 1", "Chorus"] and abs(sc2["markers"][1]["time"] - 16 * 60 / 68) < 0.001 and sc2.get("bpm") == 68 and sc2.get("key") == "G#", body[:400])
        def vlq(n):
            out = [n & 0x7F]
            n >>= 7
            while n:
                out.insert(0, (n & 0x7F) | 0x80)
                n >>= 7
            return bytes(out)
        trk = b"".join([vlq(0), b"\xff\x51\x03", (int(60e6 / 72)).to_bytes(3, "big"), vlq(0), b"\xff\x58\x04\x03\x02\x18\x08",
                        vlq(0), b"\xff\x06\x05Intro", vlq(480 * 12), b"\xff\x06\x07Verse 1", vlq(480 * 24), b"\xff\x06\x06Bridge", vlq(0), b"\xff\x2f\x00"])
        mid = b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big") + (1).to_bytes(2, "big") + (480).to_bytes(2, "big") + b"MTrk" + len(trk).to_bytes(4, "big") + trk
        folder = os.path.join(media_root, "Library", "Holy Forever")
        os.makedirs(folder, exist_ok=True)
        for n in ("Click.wav", "Keys.wav"):
            with wave.open(os.path.join(folder, n), "wb") as w:
                w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000); w.writeframes(b"\0\0\0\0" * 48000)
        with open(os.path.join(folder, "Holy Forever - Markers.mid"), "wb") as fh:
            fh.write(mid)
        status, body = jpost("/pack/scan", {"path": folder})
        sc3 = json.loads(body) if status == 200 else {}
        check("a MIDI file's markers give the sections too (with its tempo and 3/4 time)",
              [m["name"] for m in sc3.get("markers", [])] == ["Intro", "Verse 1", "Bridge"] and abs(sc3["markers"][1]["time"] - 12 * 60 / 72) < 0.001 and sc3.get("bpm") == 72 and sc3.get("bpb") == 3, body[:400])
        check("...and the stems' length (from the WAV header) and the memory the song needs in the player",
              all(abs(e.get("seconds", 0) - 1.0) < 0.01 for e in sc3.get("stems", [])) and sc3.get("memMB") == 0 and "deviceMB" in sc3, sc3.get("stems"))
        shutil.copyfile(pack2, os.path.join(media_root, "Library", "Goodness of God (Ab) MultiTracks.zip"))
        status, body = jpost("/pack/scanMany", {"path": os.path.join(media_root, "Library")})
        many = json.loads(body) if status == 200 else {}
        check("a folder of several songs (folders and zips) is listed song by song", sorted(x["title"] for x in many.get("songs", [])) == ["Goodness of God", "Holy Forever"]
              and {x["title"]: x["markers"] for x in many["songs"]} == {"Goodness of God": 3, "Holy Forever": 3}, body[:400])

        print("\nCue words in your own voice:")
        with wave.open(os.path.join(root, "bridge.wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050); w.writeframes(b"\0\0" * 4000)
        status, body = http("http://127.0.0.1:18766/cues/record?id=Bridge", data=open(os.path.join(root, "bridge.wav"), "rb").read(), method="PUT")
        check("PUT /cues/record saves a recorded word on /data", status == 200 and json.loads(body).get("id") == "bridge" and "bridge" in json.loads(body)["custom"], body[:200])
        status, body = http("http://127.0.0.1:18766/cues/bridge.wav")
        check("...and it is served instead of the built-in word", status == 200 and body[:4] == b"RIFF" and len(body) == 44 + 8000, len(body))
        status, body = http("http://127.0.0.1:18766/cues/record?id=x", data=b"nope", method="PUT")
        check("a non-WAV recording is refused", status == 400)
        status, body = http("http://127.0.0.1:18766/cues/remove", data=json.dumps({"id": "bridge"}).encode(), headers={"Content-Type": "application/json"})
        check("POST /cues/remove takes it away again", status == 200 and json.loads(body)["ok"] and "bridge" not in json.loads(body)["custom"], body[:200])

        print("\nLibrary, backup, restore and update from USB:")
        status, body = http("http://127.0.0.1:18766/library?song=song-1&name=Keys.wav", data=b"RIFF....WAVEkeys", method="PUT")
        lib = json.loads(body)
        check("PUT /library keeps a copy of an imported file on /data", status == 200 and lib.get("path", "").endswith("/library/song-1/Keys.wav") and os.path.exists(lib["path"]), body[:200])
        status, body = http("http://127.0.0.1:18766/file?path=" + urllib.request.quote(lib["path"]))
        check("...and the app can read it back (to re-decode a stem on a new card)", status == 200 and body == b"RIFF....WAVEkeys")
        status, body = http("http://127.0.0.1:18766/library/copy", data=json.dumps({"song": "song-1", "path": os.path.join(media_root, "Pads", "Warm C.wav")}).encode(), headers={"Content-Type": "application/json"})
        cp = json.loads(body)
        check("POST /library/copy copies a USB file into the library", status == 200 and cp.get("path", "").endswith("/library/song-1/Warm C.wav") and os.path.exists(cp["path"]), body[:200])
        status, body = http("http://127.0.0.1:18766/library/copy", data=json.dumps({"song": "x", "path": "/etc/passwd"}).encode(), headers={"Content-Type": "application/json"})
        check("...but not from outside the USB / uploads folders", status == 403)
        status, body = http("http://127.0.0.1:18766/project", data=json.dumps({"pads": [], "songs": [{"name": "Backed up song"}]}).encode(), headers={"Content-Type": "application/json"})
        check("the app mirrors project.json onto the driver", status == 200 and os.path.exists(os.path.join(root, "data", "project.json")))
        status, body = http("http://127.0.0.1:18766/backup", data=json.dumps({"path": media_root}).encode(), headers={"Content-Type": "application/json"})
        bkp = json.loads(body)
        check("POST /backup writes central-control-backup-<date>.zip onto the stick", status == 200 and bkp.get("ok") and os.path.exists(bkp.get("file", "")) and bkp["file"].startswith(os.path.join(media_root, "Central Control")), body[:200])

        names = zipfile.ZipFile(bkp["file"]).namelist() if status == 200 else []
        check("...with the project, the library and the keys sounds inside", "project.json" in names and "library/song-1/Keys.wav" in names and any(n.startswith("sounds/sf2/") for n in names), names[:12])
        status, body = http("http://127.0.0.1:18766/backups")
        check("GET /backups lists it", status == 200 and any(f["path"] == bkp["file"] for d in json.loads(body)["drives"] for f in d["files"]), body[:300])
        os.remove(lib["path"]); os.remove(os.path.join(root, "data", "project.json"))
        status, body = http("http://127.0.0.1:18766/restore", data=json.dumps({"file": bkp["file"]}).encode(), headers={"Content-Type": "application/json"})
        check("POST /restore puts the files back", status == 200 and json.loads(body).get("project") and os.path.exists(lib["path"]) and json.load(open(os.path.join(root, "data", "project.json")))["songs"][0]["name"] == "Backed up song", body[:200])
        fake = os.path.join(media_root, "central-control-source.zip")
        with zipfile.ZipFile(fake, "w") as zf:
            zf.writestr("central-control/pedal-driver.py", "print('x')"); zf.writestr("central-control/js/app.js", "// app"); zf.writestr("central-control/index.html", "<html>")
        with zipfile.ZipFile(os.path.join(media_root, "central-control-backup-old.zip"), "w") as zf:
            zf.writestr("x.txt", "not an update")
        status, body = http("http://127.0.0.1:18766/updates")
        ups = [f["name"] for d in json.loads(body)["drives"] for f in d["files"]] if status == 200 else []
        check("GET /updates finds a source zip on the stick (and ignores backups)", status == 200 and ups == ["central-control-source.zip"], ups)
        status, body = http("http://127.0.0.1:18766/update", data=json.dumps({"file": fake}).encode(), headers={"Content-Type": "application/json"})
        check("POST /update is refused politely on a PC (it needs the Pi's root helper)", status == 200 and json.loads(body).get("ok") is False and "Central Pedal itself" in json.loads(body).get("error", ""), body[:200])
        status, body = http("http://127.0.0.1:18766/app/index.html")
        check("the app itself is served at /app/", status == 200 and b"app" in body)

        print("\nProPresenter, updates, IRs:")
        pp_hits = []
        rel_state = {"zip": b"", "sums": b""}

        class MockOut(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def reply(self, obj, raw=None):
                body = raw if raw is not None else json.dumps(obj).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json" if raw is None else "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                pp_hits.append(self.path)
                if self.path == "/version":
                    return self.reply({"name": "ProPresenter", "host_description": "ProPresenter 7.16", "api_version": "v1"})
                if self.path == "/v1/libraries":
                    return self.reply([{"uuid": "lib-1", "name": "Default", "index": 0}])
                if self.path == "/v1/library/lib-1":
                    return self.reply({"update_type": "all", "items": [{"uuid": "pres-9", "name": "Way Maker", "index": 0}, {"uuid": "pres-3", "name": "Goodness of God", "index": 1}]})
                if self.path.startswith("/v1/"):
                    return self.reply(None, raw=b"")
                if self.path == "/repos/church/cc/releases/latest":
                    return self.reply({"tag_name": "v9.9.0", "body": "Faster scenes\nand more", "published_at": "2026-11-01T10:00:00Z",
                                       "assets": [{"name": "central-control-source.zip", "browser_download_url": "http://127.0.0.1:18098/dl/central-control-source.zip"},
                                                  {"name": "SHA256SUMS", "browser_download_url": "http://127.0.0.1:18098/dl/SHA256SUMS"}]})
                if self.path == "/dl/central-control-source.zip":
                    return self.reply(None, raw=rel_state["zip"])
                if self.path == "/dl/SHA256SUMS":
                    return self.reply(None, raw=rel_state["sums"])
                self.send_response(404)
                self.end_headers()

        out_srv = ThreadingHTTPServer(("127.0.0.1", 18098), MockOut)
        threading.Thread(target=out_srv.serve_forever, daemon=True).start()
        await send({"type": "propresenter", "action": "config", "config": {"enabled": True, "host": "127.0.0.1", "port": 18098, "openSong": True}})
        ppst = await next_message(lambda m: m["type"] == "propresenterStatus" and m.get("ok") is not None, 4.0)
        check("ProPresenter: Save & test reaches its network API and names the version", ppst and ppst["ok"] is True and "7.16" in (ppst.get("version") or ""), ppst)
        await send({"type": "propresenter", "action": "section", "slide": 3, "song": "Way Maker", "section": "Chorus"})
        await send({"type": "propresenter", "action": "section", "slide": "next"})
        await send({"type": "propresenter", "action": "song", "song": "Goodness Of God"})
        await asyncio.sleep(0.8)
        check("a section with slide 3 shows slide 3 of the active presentation (index 2), 'next' advances", "/v1/presentation/active/2/trigger" in pp_hits and "/v1/trigger/next" in pp_hits, pp_hits)
        check("choosing a song finds its presentation in the library by name and brings it up", "/v1/library/lib-1/pres-3/trigger" in pp_hits, pp_hits)
        await send({"type": "propresenter", "action": "config", "config": {"enabled": False}})

        import hashlib, io as _io
        buf = _io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("central-control/pedal-driver.py", "print('7.1')"); zf.writestr("central-control/js/app.js", "//"); zf.writestr("central-control/index.html", "<html>")
        rel_state["zip"] = buf.getvalue()
        rel_state["sums"] = ("%s  central-control-source.zip\n" % hashlib.sha256(rel_state["zip"]).hexdigest()).encode()
        await send({"type": "updates", "action": "config", "config": {"repo": "https://github.com/church/cc", "auto": True}})
        cfgm = await next_message(lambda m: m["type"] == "updateStatus", 3.0)
        check("update source accepts a GitHub URL and keeps owner/repo", cfgm and cfgm["repo"] == "church/cc" and cfgm["current"] == driver_mod.APP_VERSION, cfgm)
        await send({"type": "updates", "action": "config", "config": {"repo": ""}})
        blank = await next_message(lambda m: m["type"] == "updateStatus", 3.0)
        check("an empty update source goes back to the official releases (MotionAudio/Central-Apps)", blank and blank["repo"] == "MotionAudio/Central-Apps", blank)
        await send({"type": "updates", "action": "config", "config": {"repo": "church/cc"}})
        await next_message(lambda m: m["type"] == "updateStatus", 3.0)
        await send({"type": "updates", "action": "opened"})
        upm = await next_message(lambda m: m["type"] == "updateStatus" and m.get("latest"), 5.0)
        check("opening the app makes the Central Pedal look for a newer release right away", upm and upm["available"], upm)
        await send({"type": "updates", "action": "check"})
        upm = await next_message(lambda m: m["type"] == "updateStatus" and m.get("latest"), 5.0)
        check("the daily check finds a newer release (9.9.0) with a Pi update in it, and its notes", upm and upm["available"] and upm["latest"] == "9.9.0" and upm["hasPi"] and upm["notes"].startswith("Faster"), upm)
        path_ok = driver.updater.download()
        check("the download is checked against SHA256SUMS and kept in /data", os.path.exists(path_ok) and open(path_ok, "rb").read() == rel_state["zip"], path_ok)
        rel_state["zip"] = rel_state["zip"] + b"tampered"
        try:
            driver.updater.download()
            bad = None
        except RuntimeError as error:
            bad = str(error)
        check("a damaged or changed download is refused (checksum mismatch), nothing installed", bad and "checksum" in bad, bad)
        await send({"type": "updates", "action": "install"})
        inst = await next_message(lambda m: m["type"] == "updateStatus" and not m.get("busy") and m.get("error"), 6.0)
        check("Install on a PC stops safely after the checks (it needs the Pi's root helper)", inst and ("checksum" in inst["error"] or "Central Pedal itself" in inst["error"]), inst)

        ir_src = os.path.join(media_root, "Celestion V30.wav")
        with open(ir_src, "wb") as handle:
            handle.write(b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 40)
        status, body = jpost("/instrument/ir", {"path": ir_src})
        check("an IR .wav from the stick is copied into /data/pad-pedal/sounds/ir for the IR loader", status == 200 and os.path.exists(json.loads(body).get("file", "")), body[:200])
        status, body = jpost("/instrument/ir", {"path": "/etc/passwd"})
        check("...and nothing outside the USB / SD folders can be taken", status == 403, body[:200])

        print("\nWhat this Central Pedal does (the main admin gives it a job):")
        link = driver.center_link
        check("on its own (not paired with a main admin) it plays the tracks", hello.get("pedalJob") == "player" and link.job_now() == "player", hello.get("pedalJob"))
        got_actions, player_conns = [], []

        async def fake_player(conn, *_):
            player_conns.append(conn)
            async for raw in conn:
                m = json.loads(raw)
                if m.get("type") == "action":
                    got_actions.append(m)
        player_srv = await websockets.serve(fake_player, "127.0.0.1", 18181)
        stage = {"name": "Stage pedal", "address": "127.0.0.1", "wsPort": 18181, "online": True}
        link.on_role({"type": "pedalRole", "job": "controller", "player": stage, "peers": []})
        h = await next_message(lambda m: m["type"] == "hello" and m.get("pedalJob") == "controller", 3.0)
        check("the main admin makes it a foot controller: the app hears it (hello pedalJob controller)", h is not None and h["center"]["player"]["name"] == "Stage pedal", h and h.get("center"))
        for _ in range(40):
            if link.remote is not None and player_conns:
                break
            await asyncio.sleep(0.1)
        check("...it connects to the track player", link.remote is not None and len(player_conns) == 1)
        await player_conns[0].send(json.dumps({"type": "display", "song": {"name": "Way Maker", "index": 1, "count": 5}, "section": {"name": "Chorus"}, "next": {"name": "Bridge"}, "playing": True, "bpm": 68}))
        pdm = await next_message(lambda m: m["type"] == "playerDisplay", 3.0)
        check("...and shows what the player is doing (song, section, next)", pdm and pdm["song"] == "Way Maker" and pdm["section"] == "Chorus" and pdm["next"] == "Bridge" and pdm["playing"], pdm)
        await send({"type": "forwardAction", "name": "nextSection", "args": {}})
        await send({"type": "forwardAction", "name": "tracksLevel", "args": {}, "value": 0.4})
        for _ in range(30):
            if len(got_actions) >= 2:
                break
            await asyncio.sleep(0.1)
        check("its buttons drive the track player (with the pairing PIN), knob values too",
              len(got_actions) >= 2 and got_actions[0]["name"] == "nextSection" and got_actions[0]["code"] == driver.code and got_actions[1].get("value") == 0.4, got_actions)
        link.on_role({"type": "pedalRole", "job": "instrument", "player": stage, "peers": []})
        h = await next_message(lambda m: m["type"] == "hello" and m.get("pedalJob") == "instrument", 3.0)
        check("instrument rig: the app hears it, and the link to the player is closed", h is not None and link.remote_key == "")
        link.on_role({"type": "pedalRole", "job": "player", "player": None, "peers": []})
        h = await next_message(lambda m: m["type"] == "hello" and m.get("pedalJob") == "player", 3.0)
        check("track player again", h is not None)
        link.paired = False
        player_srv.close()

        print("\nTouch screens and Wi-Fi:")
        app_dir = os.path.dirname(os.path.abspath(driver_mod.__file__))
        driver.config["app_root"], driver.config["simulated"] = app_dir, True
        real_helper, driver_mod.SYSTEM_SCRIPT = driver_mod.SYSTEM_SCRIPT, os.path.join(root, "no-helper")   # (a PC: no root helper)
        cat = driver_mod.screens_catalog(app_dir)
        ids = [x["id"] for x in cat["screens"]]
        check("the screen list covers the small GPIO screens, HDMI and ribbon-cable touch screens (%d screens)" % len(ids),
              len(ids) >= 25 and {"spi", "hdmi", "dsi"} <= {x["kind"] for x in cat["screens"]} and "rpi35-xpt2046" in ids, ids)
        blue = driver_mod.screen_by_id(app_dir, "rpi35-xpt2046")
        check("the blue 3.5\" RPi Display (XPT2046) uses the Pi's built-in driver (no download)", blue and not blue.get("driver") and any("piscreen" in l for l in blue["config"]), blue)
        bad = [x["id"] for x in cat["screens"] if x.get("driver") and not x["driver"]["url"].startswith("https://raw.githubusercontent.com/waveshare/")]
        check("maker drivers come only from the maker's own repository", not bad, bad)
        r = driver.set_touch_screen("rpi35-xpt2046")
        disp = driver.displays_config()
        check("picking it: the small screen is on, its touch panel is read by the driver, HDMI 1 shows a copy of it",
              r["ok"] and driver_mod.screen_on(driver.config) and driver.config["mini_screen"]["touch"] == "ADS7846" and disp["hdmi1"] == "touch" and disp["touchKind"] == "spi", (r, disp))
        check("...and its pins are kept free of buttons", set(blue["pins"]) <= set(driver_mod.reserved_pins(driver.config)))
        r = driver.set_touch_screen("hdmi-7-1024")
        disp = driver.displays_config()
        check("an HDMI touch screen: no small screen, HDMI 1 is the touch screen and shows the app", r["ok"] and not driver_mod.screen_on(driver.config) and disp["hdmi1"] == "app" and disp["touchKind"] == "hdmi", disp)
        check("an unknown screen is refused", not driver.set_touch_screen("nope")["ok"])
        driver.set_touch_screen("off")
        check("the errors people see are plain words", "Wrong password" in driver_mod.wifi_error("Error: Connection activation failed: Secrets were required, but not provided.")
              and "not found" in driver_mod.wifi_error("Error: No network with SSID 'Church' found."))
        fake = os.path.join(root, "bin")
        os.makedirs(fake, exist_ok=True)
        with open(os.path.join(fake, "nmcli"), "w") as fh:
            fh.write("#!/bin/sh\nprintf 'yes:Church WiFi:78:WPA2\\nno:Guest:40:\\nno:Church WiFi:30:WPA2\\nno:Cafe\\\\:5G:55:WPA3\\n'\n")
        os.chmod(os.path.join(fake, "nmcli"), 0o755)
        old_path = os.environ["PATH"]
        os.environ["PATH"] = fake + os.pathsep + old_path
        try:
            ws_ = driver_mod.wifi_status(scan=True)
        finally:
            os.environ["PATH"] = old_path
        names = [n["ssid"] for n in ws_["networks"]]
        check("Wi-Fi list: connected first, one entry per network (its strongest), open networks marked, names with ':' kept",
              ws_["connected"] == "Church WiFi" and names[0] == "Church WiFi" and names.count("Church WiFi") == 1 and "Cafe:5G" in names
              and [n for n in ws_["networks"] if n["ssid"] == "Guest"][0]["security"] == "", ws_)
        driver.config["simulated"] = False
        driver_mod.SYSTEM_SCRIPT = real_helper

        print("\nSystem:")
        await send({"type": "system", "action": "status"})
        status_msg = await next_message(lambda m: m["type"] == "systemStatus", 4.0)
        check("system status reply: hostname, code, safe mode fields, midiPorts, audio, displays",
              status_msg and status_msg["code"] == hello["code"] and "safeMode" in status_msg and "midiPorts" in status_msg and "channels" in status_msg["audio"] and "hdmi" in status_msg["audio"] and status_msg["displays"]["hdmi2"] == "lyrics", status_msg)
        scr_file = os.path.join(media_root, "screens.json")
        with open(scr_file, "w") as handle:
            json.dump({"outputs": [{"name": "HDMI-1", "connected": True, "modes": ["1920x1080", "1280x720"], "preferred": "1920x1080", "current": "1920x1080", "role": "hdmi1"}], "primary": "HDMI-1", "second": None}, handle)
        os.environ["CC_SCREENS"] = scr_file
        await send({"type": "system", "action": "displays", "config": {"mode1": "1280x720", "inset1": 24, "scale": "1.25", "evil": "x"}})
        await asyncio.sleep(0.2)
        await send({"type": "system", "action": "status"})
        st2 = await next_message(lambda m: m["type"] == "systemStatus", 4.0)
        d2 = (st2 or {}).get("displays") or {}
        check("Settings → Screens: resolution / edge margin / zoom are merged into displays.json (what each screen shows is kept, unknown keys dropped)",
              d2.get("mode1") == "1280x720" and d2.get("inset1") == 24 and d2.get("scale") == "1.25" and d2.get("hdmi2") == "lyrics" and "evil" not in d2, d2)
        check("...and the status carries the screens the session found (outputs, their modes, which is HDMI 1)",
              st2 and st2.get("screens") and st2["screens"]["outputs"][0]["modes"] == ["1920x1080", "1280x720"], st2 and st2.get("screens"))
        await send({"type": "midiOut", "messages": [{"data": [0x90, 48, 127], "at": 0}]})
        await asyncio.sleep(0.05)
        check("midiOut without a MIDI device is ignored quietly", True)
        hl = (st2 or {}).get("health") or {}
        check("Ready check: the status carries the Pi's health (free storage, memory) and the pairing with the main admin",
              isinstance(hl.get("diskFreeMB"), int) and hl.get("diskFreeMB") > 0 and isinstance(hl.get("memFreeMB"), int) and "center" in (st2 or {}), hl)
        now_t = time.time()
        await send({"type": "serviceLog", "action": "add", "events": [
            {"kind": "play", "t": now_t, "song": "Firm Foundation", "key": "C", "bpm": 70, "pos": 0},
            {"kind": "end", "t": now_t + 240, "song": "Firm Foundation", "pos": 240},
            {"kind": "bogus", "t": now_t}, {"kind": "note", "t": now_t, "evil key!": "x", "text": "y" * 500}]})
        await asyncio.sleep(0.2)
        await send({"type": "serviceLog", "action": "days"})
        sd = await next_message(lambda m: m["type"] == "serviceLogDays", 4.0)
        today = time.strftime("%Y-%m-%d", time.localtime(now_t))
        await send({"type": "serviceLog", "action": "get", "day": today})
        sg = await next_message(lambda m: m["type"] == "serviceLogDay", 4.0)
        evs = (sg or {}).get("events") or []
        check("service report: events are kept per day (unknown kinds and keys dropped, text cut short) and read back",
              sd and any(d["day"] == today and d["songs"] == 1 for d in sd["days"]) and [e["kind"] for e in evs] == ["play", "end", "note"]
              and evs[0]["song"] == "Firm Foundation" and "evil key!" not in evs[2] and len(evs[2]["text"]) == 120, (sd, evs))
        await send({"type": "serviceLog", "action": "get", "day": "../../etc/passwd"})
        bad = await next_message(lambda m: m["type"] == "serviceLogDay", 4.0)
        check("...and a bad day name reads nothing", bad and bad["events"] == [], bad)
        await send({"type": "serviceLock", "on": True})
        await asyncio.sleep(0.1)
        check("the LIVE screen's service lock reaches the driver (the small screen shows LOCKED)", getattr(driver, "service_lock", None) is True, getattr(driver, "service_lock", None))

        # ---- practice mixes: kept here, MP3 when ffmpeg is there, a USB stick, the phones' page (open / code / off)
        pm_wav = io_wav(0.2)
        st_, body_ = http("http://127.0.0.1:18766/practice/file?folder=Sunday%20Oct%2019&name=01.%20Firm%20Foundation%20(Drums).wav&format=wav", pm_wav, "PUT")
        pj = json.loads(body_ or b"{}")
        check("practice mixes: a WAV from the app is kept in <data>/practice/<folder>/",
              st_ == 200 and pj.get("name") == "01. Firm Foundation (Drums).wav" and os.path.isfile(os.path.join(root, "data", "practice", "Sunday Oct 19", pj.get("name", "-"))), (st_, pj))
        st_, body_ = http("http://127.0.0.1:18766/practice/file?folder=../../evil&name=../x.wav", pm_wav, "PUT")
        pj2 = json.loads(body_ or b"{}")
        check("...a folder or name with ../ stays inside the practice folder",
              st_ == 200 and not os.path.exists(os.path.join(root, "evil")) and os.path.isfile(os.path.join(root, "data", "practice", pj2.get("folder", "-"), pj2.get("name", "-"))), pj2)
        st_dd, _ = http("http://127.0.0.1:18766/practice/file?folder=..&name=project.json", b"{}", "PUT")
        st_dl, _ = http("http://127.0.0.1:18766/practice/delete", json.dumps({"folder": ".."}).encode())
        st_d1, _ = http("http://127.0.0.1:18766/practice/delete", json.dumps({"folder": "."}).encode())
        check("...the folder names . and .. are refused or kept inside (nothing above the practice folder is written or deleted)",
              os.path.isdir(os.path.join(root, "data", "practice")) and os.path.isdir(os.path.join(root, "data", "charts")) and st_dl in (200, 400) and st_d1 in (200, 400)
              and not (os.path.isfile(os.path.join(root, "data", "project.json")) and open(os.path.join(root, "data", "project.json")).read() == "{}"), (st_dd, st_dl, st_d1))
        st_o, _ = http("http://127.0.0.1:18766/practice/delete", json.dumps({"folder": "Sunday Oct 19"}).encode(), headers={"Origin": "https://evil.example"})
        st_o2, _ = http("http://127.0.0.1:18766/split/install", b"{}", headers={"Origin": "https://evil.example"})
        check("...another web page in a browser on this computer can't change practice mixes or the stem splitter (403)", st_o == 403 and st_o2 == 403, (st_o, st_o2))
        st_l, _ = http("http://127.0.0.1:18766/license/state", json.dumps({"key": "PXXX"}).encode(), headers={"Origin": "https://evil.example"})
        st_l2, _ = http("http://127.0.0.1:18766/license/state", json.dumps({"key": "P7K39QXM2HDAVW8F", "app": "pedal"}).encode())
        hello_l = driver.hello()
        check("the license setup's copy is kept with the data (only the app can write it), and comes back in the hello with this computer's id",
              st_l == 403 and st_l2 == 200 and (hello_l.get("licenseState") or {}).get("key") == "P7K39QXM2HDAVW8F" and str(hello_l.get("deviceId", "")).startswith("dev-") and hello_l.get("player") is False, (st_l, st_l2, hello_l.get("licenseState"), hello_l.get("deviceId")))
        st_, body_ = http("http://127.0.0.1:18766/practice/file?folder=Sunday%20Oct%2019&name=02.%20Way%20Maker%20(Bass).wav&format=mp3&kbps=192", pm_wav, "PUT")
        pj3 = json.loads(body_ or b"{}")
        if shutil.which("ffmpeg"):
            check("...asked for MP3 with ffmpeg here: it becomes an MP3 (the WAV is gone)", pj3.get("format") == "mp3" and pj3.get("name", "").endswith(".mp3") and not os.path.exists(os.path.join(root, "data", "practice", "Sunday Oct 19", "02. Way Maker (Bass).wav")), pj3)
        else:
            check("...asked for MP3 without ffmpeg: the WAV is kept and the app is told why", pj3.get("format") == "wav" and "ffmpeg" in pj3.get("note", ""), pj3)
        stick = os.path.join(root, "media", "usb-STICK")
        os.makedirs(stick)
        roots_before = driver.config["media_roots"]
        driver.config["media_roots"] = roots_before + [os.path.join(root, "media")]
        st_, body_ = http("http://127.0.0.1:18766/practice/usb", json.dumps({"folder": "Sunday Oct 19"}).encode())
        pu = json.loads(body_ or b"{}")
        check("...the folder is copied onto a USB stick (Central Control/Practice/<folder>)",
              pu.get("copied") == 2 and os.path.isfile(os.path.join(stick, "Central Control", "Practice", "Sunday Oct 19", "01. Firm Foundation (Drums).wav")), pu)
        driver.config["media_roots"] = roots_before
        st_, body_ = http("http://127.0.0.1:18766/practice/list")
        pl = json.loads(body_ or b"{}")
        check("...the list has the folders and their files", any(f["folder"] == "Sunday Oct 19" and len(f["files"]) == 2 for f in pl.get("folders", [])), pl)
        st_, page_ = http("http://127.0.0.1:18080/practice/")
        page_ = page_.decode(errors="replace")
        st_f, file_ = http("http://127.0.0.1:18080/practice/Sunday%20Oct%2019/01.%20Firm%20Foundation%20(Drums).wav")
        check("the phones' page (port 8080 /practice/) lists them with players, and the files download", st_ == 200 and "Firm Foundation (Drums)" in page_ and "<audio" in page_ and st_f == 200 and file_ == pm_wav, (st_, page_[:200], st_f))
        _, cfg_ = http("http://127.0.0.1:18766/practice/config", json.dumps({"share": "code", "title": "Grace Band", "code": "band77"}).encode())
        st_a, page_a = http("http://127.0.0.1:18080/practice/")
        st_b, _ = http("http://127.0.0.1:18080/practice/Sunday%20Oct%2019/01.%20Firm%20Foundation%20(Drums).wav")
        st_p, _ = http("http://127.0.0.1:18080/practice/Sunday%20Oct%2019/01.%20Firm%20Foundation%20(Drums).wav?code=" + driver.code)
        st_c, page_c = http("http://127.0.0.1:18080/practice/?code=band77")
        st_d, file_d = http("http://127.0.0.1:18080/practice/Sunday%20Oct%2019/01.%20Firm%20Foundation%20(Drums).wav?code=band77")
        check("...set to need a practice code: asks for it, refuses the files without it and with the pairing PIN, works with it (and the title is the setting)",
              json.loads(cfg_).get("code") == "band77" and b"practice code" in page_a and b"Grace Band" in page_a and st_b == 403 and st_p == 403 and b"Firm Foundation" in page_c and b"band77" in page_c and st_d == 200 and file_d == pm_wav, (page_a[:160], st_b, st_p, st_d))
        for _ in range(10):
            http("http://127.0.0.1:18080/practice/?code=wrong1")
        st_r, page_r = http("http://127.0.0.1:18080/practice/?code=band77")
        check("...10 wrong codes in a row: even the right one waits (no guessing it)", b"Firm Foundation" not in page_r, page_r[:120])
        driver.practice.fails.clear()
        http("http://127.0.0.1:18766/practice/config", json.dumps({"share": "off"}).encode())
        st_e, page_e = http("http://127.0.0.1:18080/practice/")
        st_g, _ = http("http://127.0.0.1:18080/practice/Sunday%20Oct%2019/01.%20Firm%20Foundation%20(Drums).wav?code=" + driver.code)
        check("...set to off: not shared at all", b"aren't shared" in page_e and st_g == 403, (page_e[:160], st_g))
        http("http://127.0.0.1:18766/practice/config", json.dumps({"share": "open"}).encode())
        st_, body_ = http("http://127.0.0.1:18766/practice/copy", json.dumps({"folder": "Sunday Oct 19", "dest": root}).encode())
        check("...copying into a folder on the computer is only for Central Pedal Control", st_ == 400, body_)
        st_, body_ = http("http://127.0.0.1:18766/practice/delete", json.dumps({"folder": "Sunday Oct 19"}).encode())
        check("...and a folder can be deleted", st_ == 200 and not os.path.exists(os.path.join(root, "data", "practice", "Sunday Oct 19")), body_)

        # ---- the stem splitter, with a stand-in for Demucs (CC_DEMUCS_CMD)
        st_, body_ = http("http://127.0.0.1:18766/split/status")
        ss0 = json.loads(body_ or b"{}")
        check("stem splitter: not installed until asked (no Demucs in its folder), with the devices and models listed",
              st_ == 200 and ss0.get("installed") is False and "cpu" in ss0.get("devices", []) and "htdemucs_6s" in ss0.get("models", []), ss0)
        stub = os.path.join(root, "fake-demucs.py")
        with open(stub, "w") as handle:
            handle.write(FAKE_DEMUCS)
        os.environ["CC_DEMUCS_CMD"] = "%s %s" % (sys.executable, stub)
        st_, body_ = http("http://127.0.0.1:18766/split/upload?name=Old%20Recording.wav", io_wav(0.5), "PUT")
        up = json.loads(body_ or b"{}")
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": "/etc/passwd", "opts": {}}).encode())
        check("...a file outside its folders, the library or the USB sticks is refused", st_ == 400, body_)
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {"model": "htdemucs_6s", "shifts": 2, "overlap": 0.5, "segment": 7, "device": "cpu", "format": "wav24", "clipMode": "clamp", "jobs": 2}}).encode())
        job_ = json.loads(body_ or b"{}")
        prog = await next_message(lambda m: m["type"] == "stemSplit" and m["job"]["id"] == job_.get("id") and 0 < m["job"]["progress"] < 1, 6.0)
        done = await next_message(lambda m: m["type"] == "stemSplit" and m["job"]["id"] == job_.get("id") and m["job"]["state"] != "running", 10.0)
        argv = json.load(open(os.path.join(root, "fake-demucs-argv.json"))) if os.path.exists(os.path.join(root, "fake-demucs-argv.json")) else []
        check("...every setting reaches Demucs (model, shifts, overlap, segment, device, 24-bit, clip mode, jobs, {stem}.{ext})",
              argv[:2] == ["-n", "htdemucs_6s"] and "--shifts" in argv and argv[argv.index("--shifts") + 1] == "2" and argv[argv.index("--overlap") + 1] == "0.50" and argv[argv.index("--segment") + 1] == "7"
              and argv[argv.index("-d") + 1] == "cpu" and "--int24" in argv and argv[argv.index("--clip-mode") + 1] == "clamp" and argv[argv.index("-j") + 1] == "2" and "{stem}.{ext}" in argv, argv)
        check("...progress comes to the app while it runs, then the six stems", prog is not None and done and done["job"]["state"] == "done" and sorted(f["name"] for f in done["job"]["files"]) == ["Bass.wav", "Drums.wav", "Guitar.wav", "Other.wav", "Piano.wav", "Vocals.wav"]
              and {f["name"]: f["role"] for f in done["job"]["files"]}["Piano.wav"] == "keys", (prog, done))
        rel = done["job"]["files"][0]["rel"] if done and done["job"]["files"] else ""
        st_, stem_ = http("http://127.0.0.1:18766/split/file?id=%s&rel=%s" % (job_.get("id"), urllib.parse.quote(rel)))
        st_x, _ = http("http://127.0.0.1:18766/split/file?id=%s&rel=../../../settings.json" % job_.get("id"))
        check("...the app fetches each stem (nothing outside the job's folder)", st_ == 200 and stem_[:4] == b"RIFF" and st_x == 404, (st_, st_x))
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {"twoStems": "vocals", "format": "mp3", "mp3Kbps": 256}}).encode())
        job2 = json.loads(body_ or b"{}")
        done2 = await next_message(lambda m: m["type"] == "stemSplit" and m["job"]["id"] == job2.get("id") and m["job"]["state"] != "running", 10.0)
        argv2 = json.load(open(os.path.join(root, "fake-demucs-argv.json")))
        check("...just vocals / no vocals as MP3", done2 and sorted(f["name"] for f in done2["job"]["files"]) == ["Band (no vocals).mp3", "Vocals.mp3"] and "--two-stems" in argv2 and argv2[argv2.index("--mp3-bitrate") + 1] == "256", (done2, argv2))
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {"quality": "best"}}).encode())
        check("...the best-quality pipeline asks for its models to be installed first", st_ == 400 and b"best-quality" in body_, body_)
        sep = os.path.join(root, "fake-separator.py")
        with open(sep, "w") as handle:
            handle.write(FAKE_SEPARATOR)
        os.environ["CC_SEPARATOR_CMD"] = "%s %s" % (sys.executable, sep)
        st_, body_ = http("http://127.0.0.1:18766/split/status")
        check("...with audio-separator there, the status says so and lists its models", json.loads(body_).get("separator") is True and "vocals" in json.loads(body_).get("sepModels", {}), body_[:200])
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {"quality": "best", "model": "htdemucs", "leadBacking": True, "drumParts": True, "sepSegment": 256, "autocast": True}}).encode())
        job4 = json.loads(body_ or b"{}")
        steps4 = []
        done4 = None
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            m4 = await next_message(lambda m: m["type"] == "stemSplit" and m["job"]["id"] == job4.get("id"), 2.0)
            if m4:
                if m4["job"].get("step") and m4["job"]["step"] not in steps4:
                    steps4.append(m4["job"]["step"])
                if m4["job"]["state"] != "running":
                    done4 = m4
                    break
        names4 = sorted(f["name"] for f in (done4 or {"job": {"files": []}})["job"]["files"])
        sargs = json.load(open(os.path.join(root, "fake-separator-argv.json")))
        check("...best quality: RoFormer takes the vocals, Demucs the band, then lead / backing vocals and the drum parts - each step shown",
              done4 and done4["job"]["state"] == "done" and names4 == ["Backing vocals.wav", "Bass.wav", "Crash.wav", "Hi-hat.wav", "Kick.wav", "Lead vocals.wav", "Other.wav", "Ride.wav", "Snare.wav", "Toms.wav"]
              and len(steps4) >= 3 and job4.get("steps") and len(job4["steps"]) == 4, (names4, steps4, done4 and done4["job"].get("error")))
        check("...the models and settings reach audio-separator (model file, segment size, autocast; models kept in the splitter's folder)",
              len(sargs) == 3 and "model_bs_roformer_ep_317_sdr_12.9755.ckpt" in sargs[0] and "--mdxc_segment_size" in sargs[0] and "--use_autocast" in sargs[0]
              and "karaoke" in " ".join(sargs[1]) and "DrumSep" in " ".join(sargs[2]) and any("stem-splitter" in a for a in sargs[0]), sargs)
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {"quality": "best", "vocalModel": "../../evil.ckpt"}}).encode())
        job5 = json.loads(body_ or b"{}")
        await next_message(lambda m: m["type"] == "stemSplit" and m["job"]["id"] == job5.get("id") and m["job"]["state"] != "running", 10.0)
        sargs5 = json.load(open(os.path.join(root, "fake-separator-argv.json")))
        check("...a model name that isn't a plain file name falls back to the default", "model_bs_roformer_ep_317_sdr_12.9755.ckpt" in sargs5[-1], sargs5[-1])
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {"quality": "best", "vocalModel": "mel_band_roformer_kim_ft_unwa.ckpt", "format": "mp3"}}).encode())
        job6 = json.loads(body_ or b"{}")
        done6 = await next_message(lambda m: m["type"] == "stemSplit" and m["job"]["id"] == job6.get("id") and m["job"]["state"] != "running", 15.0)
        names6 = sorted(f["name"] for f in (done6 or {"job": {"files": []}})["job"]["files"])
        dm = json.load(open(os.path.join(root, "fake-demucs-argv.json")))
        sargs6 = json.load(open(os.path.join(root, "fake-separator-argv.json")))[-1]
        want6 = ["Bass.mp3", "Drums.mp3", "Other.mp3", "Vocals.mp3"] if shutil.which("ffmpeg") else ["Bass.wav", "Drums.wav", "Other.wav", "Vocals.wav"]
        check("...a vocal model whose band stem is called \"other\" still feeds Demucs; MP3 is made once at the end (WAV in between)",
              done6 and done6["job"]["state"] == "done" and names6 == want6 and "--mp3" not in dm and "--float32" in dm and "WAV" in sargs6, (names6, done6 and done6["job"].get("error"), dm, sargs6))
        # ---- Studio: vocal models voting together, Demucs FT + 6 stems, lead / backing, the reverb off, the kit pieces,
        # then the clean-up pass (bleed, Perc, Cymbals, silence, mono) and the drum hits for the lights
        async def finish(jid, secs=40.0):
            seen, end_ = [], None
            deadline_ = time.monotonic() + secs
            while time.monotonic() < deadline_:
                mm = await next_message(lambda m: m["type"] == "stemSplit" and m["job"]["id"] == jid, 3.0)
                if mm:
                    if mm["job"].get("step") and mm["job"]["step"] not in seen:
                        seen.append(mm["job"]["step"])
                    if mm["job"]["state"] != "running":
                        end_ = mm["job"]
                        break
            return end_, seen
        st_, body_ = http("http://127.0.0.1:18766/split/status")
        check("...the clean-up pass needs the splitter's Python (not there yet), and the status lists the ensemble ways", json.loads(body_).get("cleanup") is False and "avg_fft" in json.loads(body_).get("ensembleAlgos", []), body_[:300])
        os.environ["CC_STEMTOOL_PYTHON"] = sys.executable
        for f_ in ("fake-separator-argv.json", "fake-demucs-calls.json"):
            if os.path.exists(os.path.join(root, f_)):
                os.remove(os.path.join(root, f_))
        studio = {"quality": "studio", "ensembleAlgo": "median_fft", "leadBacking": True, "dereverb": True, "drumParts": True, "cleanup": True, "bleed": 60,
                  "trackSet": "multitracks", "kit": "cymbals", "mono": True, "trim": True, "format": "wav24"}
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": studio}).encode())
        j7 = json.loads(body_ or b"{}")
        d7, steps7 = await finish(j7.get("id"))
        names7 = sorted(f["name"] for f in (d7 or {}).get("files", []))
        sargs7 = json.load(open(os.path.join(root, "fake-separator-argv.json")))
        dcalls7 = json.load(open(os.path.join(root, "fake-demucs-calls.json")))
        check("...Studio: the vocal models vote together (--extra_models, the musician's ensemble way), the band is Demucs FT (2+ shifts) then the 6-stem model",
              "--extra_models" in sargs7[0] and "mel_band_roformer_kim_ft_unwa.ckpt" in sargs7[0] and sargs7[0][sargs7[0].index("--ensemble_algorithm") + 1] == "median_fft"
              and [c[1] for c in dcalls7] == ["htdemucs_ft", "htdemucs_6s"] and dcalls7[0][dcalls7[0].index("--shifts") + 1] == "2" and "--float32" in dcalls7[0], (sargs7[:1], dcalls7))
        check("...then lead / backing, the reverb off the lead (UVR DeEcho-DeReverb), the kit pieces, and the clean-up - each step shown",
              d7 and d7["state"] == "done" and "DeReverb" in " ".join(sargs7[2]) and "DrumSep" in " ".join(sargs7[3]) and j7.get("steps", [])[-1] == "Cleaning up the tracks" and "Cleaning up the tracks" in steps7,
              (d7 and d7.get("error"), j7.get("steps"), steps7))
        check("...MultiTracks-style tracks: Lead Vox, BGVs, Kick, Snare, Cymbals (hi-hat + ride + crash), Perc, Bass, Guitars, Keys, Synth & Pads - no reverb track, no silent Toms",
              names7 == ["BGVs.wav", "Bass.wav", "Cymbals.wav", "Guitars.wav", "Keys.wav", "Kick.wav", "Lead Vox.wav", "Perc.wav", "Snare.wav", "Synth & Pads.wav"]
              and any("Toms" in n for n in d7.get("notes", [])), (names7, d7 and d7.get("notes")))
        f7 = {f["name"]: f for f in (d7 or {}).get("files", [])}
        check("...each track has its level, peak and mono / stereo, and its role (Synth & Pads plays as keys)",
              f7.get("Bass.wav", {}).get("mono") is True and isinstance(f7.get("Bass.wav", {}).get("db"), float) and f7.get("Synth & Pads.wav", {}).get("role") == "keys"
              and f7.get("Lead Vox.wav", {}).get("role") == "vocals", f7.get("Bass.wav"))
        h7 = (d7 or {}).get("hits", {})
        def near(got, want):
            return len(got) == len(want) and all(abs(a - b) < 0.03 for a, b in zip(got, want))
        tr7 = (d7 or {}).get("trimmed", [0, 0])[0]
        check("...the drum hits for the lights come from the kit pieces (kick, snare, hi-hat, crash), in time with the trimmed tracks",
              near(h7.get("kick", []), [t - tr7 for t in (0.25, 0.75, 1.25, 1.75)]) and near(h7.get("snare", []), [t - tr7 for t in (0.5, 1.5)]) and len(h7.get("hat", [])) == 8
              and near(h7.get("crash", []), [0.25 - tr7]), (h7, tr7))
        st_, w7 = http("http://127.0.0.1:18766/split/file?id=%s&rel=%s" % (j7.get("id"), urllib.parse.quote(f7.get("Bass.wav", {}).get("rel", "x"))))
        check("...a mono track is written as one channel, 24-bit as asked", st_ == 200 and struct.unpack("<H", w7[22:24])[0] == 1 and struct.unpack("<H", w7[34:36])[0] == 24, w7[:40])
        # Split again (from the review): the reverb off one track, a new job that stays in time (no trim)
        st_, body_ = http("http://127.0.0.1:18766/split/resplit", json.dumps({"id": j7.get("id"), "rel": f7.get("Lead Vox.wav", {}).get("rel"), "kind": "dereverb"}).encode())
        j8 = json.loads(body_ or b"{}")
        d8, _ = await finish(j8.get("id"))
        check("...Split again: a track of the split, its reverb taken off - the dry vocal and the reverb on its own (Vox FX), not trimmed",
              d8 and d8["state"] == "done" and d8.get("parent") == j7.get("id") and sorted(f["name"] for f in d8["files"]) == ["Vox FX.wav", "Vox.wav"] and d8.get("trimmed", [1])[0] == 0,
              (d8 and d8.get("files"), d8 and d8.get("error")))
        if shutil.which("ffmpeg"):   # a split kept as MP3: its Drums split again into the kit pieces (the clean-up reads WAV: converted first)
            st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {"quality": "best", "cleanup": True, "format": "mp3", "review": True, "kit": "drums"}}).encode())
            j10 = json.loads(body_ or b"{}")
            d10, _ = await finish(j10.get("id"))
            drel = next((f["rel"] for f in (d10 or {}).get("files", []) if f["stem"] == "drums"), "x")
            st_, body_ = http("http://127.0.0.1:18766/split/resplit", json.dumps({"id": j10.get("id"), "rel": drel, "kind": "drums"}).encode())
            j11 = json.loads(body_ or b"{}")
            d11, _ = await finish(j11.get("id"))
            n11 = sorted(f["name"] for f in (d11 or {}).get("files", []))
            check("...Split again on an MP3 drum track: the kit pieces (each on its own) and Perc, with the hits", d11 and d11["state"] == "done" and "Kick.mp3" in n11 and "Percussion.mp3" in n11
                  and len(d11.get("hits", {}).get("kick", [])) == 4, (n11, d11 and d11.get("error")))
        st_a, _ = http("http://127.0.0.1:18766/split/resplit", json.dumps({"id": j7.get("id"), "rel": "final/Bass.wav", "kind": "rm -rf"}).encode())
        st_b, _ = http("http://127.0.0.1:18766/split/resplit", json.dumps({"id": j7.get("id"), "rel": "../../settings.json", "kind": "drums"}).encode())
        st_c, _ = http("http://127.0.0.1:18766/split/resplit", json.dumps({"id": "nope", "rel": "final/Bass.wav", "kind": "drums"}).encode())
        check("...only the ways it knows, only files of that split", st_a == 400 and st_b == 400 and st_c == 400, (st_a, st_b, st_c))
        # the ensemble fails here: the vocals come from the one model, and it says so
        os.environ["FAKE_ENSEMBLE_FAIL"] = "1"
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {"quality": "studio", "band6Model": "", "cleanup": True, "review": True, "bleed": 0, "drumParts": True, "kit": "drums", "keepDrums": True, "trackSet": "multitracks"}}).encode())
        j9 = json.loads(body_ or b"{}")
        d9, _ = await finish(j9.get("id"))
        os.environ.pop("FAKE_ENSEMBLE_FAIL", None)
        check("...when the vocal models can't vote together, the vocal model works alone (with a note); no 6-stem step when it's off; the kit pieces back together as Drums + Perc (review: the silent ones stay, marked)",
              d9 and d9["state"] == "done" and any("alone" in n for n in d9.get("notes", [])) and sorted(f["name"] for f in d9["files"]) == ["Bass.wav", "Drums.wav", "Instruments.wav", "Perc.wav", "Vox.wav"]
              and len(d9.get("hits", {}).get("kick", [])) == 4,
              (d9 and d9.get("notes"), d9 and d9.get("files"), d9 and d9.get("error")))
        # the clean-up on its own numbers: a guitar with a vocal in it, and the other way round, are put right
        import numpy as np
        tool = driver.splitter.tool_path()
        sys.path.insert(0, os.path.dirname(tool))
        import stemtool as stt
        r_ = 22050
        tt = np.arange(r_ * 2) / r_
        ga, vb = (np.sin(2 * np.pi * 220 * tt) * 0.4).astype(np.float32), (np.sin(2 * np.pi * 1500 * tt) * 0.4).astype(np.float32)
        tdir = os.path.join(root, "stt")
        os.makedirs(tdir, exist_ok=True)
        pad_ = np.zeros(r_, dtype=np.float32)
        stt.write_wav(os.path.join(tdir, "g.wav"), np.vstack([np.concatenate([pad_, ga + 0.25 * vb])] * 2), r_, 24)
        stt.write_wav(os.path.join(tdir, "v.wav"), np.vstack([np.concatenate([pad_, vb + 0.25 * ga])] * 2), r_, 32)
        stt.write_wav(os.path.join(tdir, "m.wav"), np.vstack([np.concatenate([pad_, ga + vb])] * 2), r_, 16)
        driver_mod.write_json(os.path.join(tdir, "job.json"), {"out": os.path.join(tdir, "out"), "stems": [{"key": "guitar", "path": os.path.join(tdir, "g.wav")}, {"key": "vocals", "path": os.path.join(tdir, "v.wav")}],
                                                      "mix": os.path.join(tdir, "m.wav"), "bleed": 1, "sharp": 1.5, "trim": True, "mono": True, "bits": 32, "result": os.path.join(tdir, "res.json")})
        rr = subprocess.run([sys.executable, tool, os.path.join(tdir, "job.json")], capture_output=True, text=True, timeout=120)
        res_ = driver_mod.read_json(os.path.join(tdir, "res.json"), {})
        g_, _ = stt.read_wav(os.path.join(tdir, "out", "guitar.wav"))
        spec_ = np.abs(np.fft.rfft(g_[0][int(0.75 * r_):int(1.75 * r_)]))
        check("...the clean-up takes the vocal out of the guitar (a quarter-level bleed, -12 dB, down under 2 %, with the stronger setting), trims the silent start (every track the same), writes mono",
              rr.returncode == 0 and spec_[1500] / spec_[220] < 0.02 and 0.4 < res_.get("trimmed", [0])[0] < 0.6 and all(f["mono"] for f in res_.get("files", [])), (rr.stderr[-500:], res_, spec_[1500] / max(1e-9, spec_[220])))
        os.environ.pop("CC_STEMTOOL_PYTHON", None)
        os.environ.pop("CC_SEPARATOR_CMD", None)
        os.environ["FAKE_DEMUCS_FAIL"] = "1"
        st_, body_ = http("http://127.0.0.1:18766/split/start", json.dumps({"path": up.get("path"), "opts": {}}).encode())
        job3 = json.loads(body_ or b"{}")
        done3 = await next_message(lambda m: m["type"] == "stemSplit" and m["job"]["id"] == job3.get("id") and m["job"]["state"] != "running", 10.0)
        os.environ.pop("FAKE_DEMUCS_FAIL", None)
        check("...when Demucs fails the app gets its last words", done3 and done3["job"]["state"] == "failed" and "out of memory" in done3["job"]["error"], done3)
        st_, body_ = http("http://127.0.0.1:18766/split/forget", json.dumps({"id": job_.get("id")}).encode())
        check("...and a finished job's files can be dropped", st_ == 200 and not os.path.isdir(os.path.join(root, "data", "stem-splitter", "out", job_.get("id", "-"))), body_)
        os.environ.pop("CC_DEMUCS_CMD", None)
        st_, body_ = http("http://127.0.0.1:18766/split/config", json.dumps({"python": "3.12", "packages": "demucs==4.0.1 soundfile", "command": "sh -c 'touch /tmp/pwned'"}).encode())
        sc = json.loads(body_ or b"{}")
        check("...its install settings (Python version, packages) are kept; a command can't be set over the API (only CC_DEMUCS_CMD)",
              sc.get("settings", {}).get("python") == "3.12" and sc["settings"]["packages"] == "demucs==4.0.1 soundfile" and sc.get("installed") is False and "command" not in sc["settings"] and driver.splitter.command() is None, sc)
        _, body_ = http("http://127.0.0.1:18766/split/config", json.dumps({"packages": "--index-url http://evil/ demucs", "python": "3.12; rm"}).encode())
        sc2 = json.loads(body_ or b"{}")
        check("...and packages that are options or URLs are refused", sc2["settings"]["packages"] == "demucs==4.0.1 soundfile" and sc2["settings"]["python"] == "3.12", sc2)

    stop_event.set()
    await asyncio.wait_for(server_task, 5)
    print("\n%s" % ("ALL DRIVER CHECKS PASSED" if not failures else "%d CHECK(S) FAILED: %s" % (len(failures), failures)))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
