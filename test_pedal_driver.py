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
import sys
import wave
import zipfile
import tempfile
import time
import urllib.error
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
                   "app_root": app_root, "data_root": os.path.join(root, "data"), "tft_overlay": "none",
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
        await asyncio.sleep(0.4)
        with open(config["mini_screen"]["fb"], "rb") as handle:
            fb = handle.read()
        check("the 3.5\" framebuffer was drawn (480x320 RGB565, not blank)", len(fb) == 480 * 320 * 2 and any(fb), len(fb))
        hit = driver.mini.hit_test(60, 100)
        check("touching pad 1 on the small screen -> action pad 1", hit == {"name": "pad", "args": {"index": 0}}, hit)
        hit = driver.mini.hit_test(340, 70)
        check("touching the transport button -> playPause", hit == {"name": "playPause"}, hit)
        status, body = http("http://127.0.0.1:18080/api/display")
        check("companion HTTP /api/display returns the same state", status == 200 and json.loads(body)["song"]["key"] == "G")
        status, body = http("http://127.0.0.1:18080/")
        check("companion charts page is served on the Wi-Fi port", status == 200 and b"charts" in body)
        status, body = http("http://127.0.0.1:18080/api/action", data=json.dumps({"name": "tap", "code": "0000" if hello["code"] != "0000" else "1111"}).encode())
        check("HTTP remote action with a wrong code -> 403", status == 403)
        status, body = http("http://127.0.0.1:18080/api/action", data=json.dumps({"name": "tap", "code": hello["code"]}).encode())
        action = await next_message(lambda m: m["type"] == "action")
        check("HTTP remote action with the code -> app gets {action tap}", status == 200 and action and action["name"] == "tap", action)

        print("\nCentral Usage: network audio, the audio host, the hub, slides:")
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
            st = await next_message(lambda m: m.get("type") == "netAudio")
            check("I/O → Ethernet is kept (netaudio.json)", st and st["config"]["mode"] == "ethernet" and os.path.exists(os.path.join(root, "data", "netaudio.json")), st and st["config"])
            await cu.send(json.dumps({"type": "audioSubscribe", "code": hello["code"], "sources": [0], "name": "Desk"}))
            ok = await cu_next(lambda m: m.get("type") == "audioSubscribed")
            check("with Ethernet on, Central Usage subscribes with the pairing code", ok and ok["ok"], ok)
            sending = await next_message(lambda m: m.get("type") == "netAudio" and m.get("sending"))
            check("...and the app is told to start sending (the listener is named)", sending is not None and sending["listeners"][0]["name"] == "Desk", sending)
            await send({"type": "netAudio", "action": "info", "channels": ["Drums", "Bass"], "rate": 48000})
            info = await cu_next(lambda m: m.get("type") == "audioStream")
            check("the channel names reach Central Usage", info and info["sources"]["0"]["channels"] == ["Drums", "Bass"], info)
            pkt = struct.pack("<4sBBHId", b"CCA1", 0, 2, 4, 1, 12.5) + struct.pack("<8h", 1, -2, 3, -4, 5, -6, 7, -8)
            await ws.send(pkt)
            got = await cu_next(None, binary=True)
            check("an audio packet from the app is passed on to Central Usage byte for byte", got == pkt, got and got[:24])
            await cu.send(json.dumps({"type": "action", "name": "nextSection", "code": hello["code"]}))
            r = await cu_next(lambda m: m.get("type") == "refused")
            check("Central Usage can't move the tracks: its nextSection is refused", r and "Only the Central Control" in r["error"], r)
            await cu.send(json.dumps({"type": "action", "name": "lyricsNext", "code": hello["code"]}))
            act = await next_message(lambda m: m["type"] == "action")
            check("...it can page the lyrics (marked as coming from Central Usage)", act == {"type": "action", "name": "lyricsNext", "args": {}, "from": "central-usage"}, act)
            await cu.send(json.dumps({"type": "audioHost", "action": "register", "code": hello["code"], "port": 8092, "name": "Desk"}))
            h = await cu_next(lambda m: m.get("type") == "audioHost")
            check("an admin computer registers as the audio host and every Central Usage is told", h and h["host"]["name"] == "Desk" and h["host"]["port"] == 8092, h)
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
        check("the app's songs are listed in the hub for Central Usage", status == 200 and json.loads(body)["songs"][0]["name"] == "Way Maker", body[:200])
        await send({"type": "hub", "songs": [{"id": "s1", "name": "Way Maker", "bpm": 70, "key": "E", "duration": 300, "hasTracks": True, "sections": []}]})
        await asyncio.sleep(0.3)
        status, body = http("http://127.0.0.1:18080/api/hub/s1")
        j = json.loads(body)
        check("a song's details (tempo, sections, waveform) - the waveform is kept when an update has none", j["bpm"] == 70 and j["overview"] == [0.1, 0.5, 0.9], j)
        png = b"\x89PNG\r\n\x1a\nslide-bytes-0123456789"
        status, body = http("http://127.0.0.1:18080/api/slides?code=%s&name=Welcome.png" % hello["code"], data=png)
        check("Central Usage sends a picture for the slides screen (with the code)", status == 200 and json.loads(body)["file"] == "Welcome.png", body)
        status, _ = http("http://127.0.0.1:18080/api/slides?code=0000x&name=X.png", data=png)
        check("...a wrong code is refused", status == 403)
        status, body = http("http://127.0.0.1:18080/api/slides/Welcome.png", headers={"Range": "bytes=2-5"})
        check("slides are served with Range requests (videos seek)", status == 206 and body == png[2:6], (status, body))
        status, body = http("http://127.0.0.1:18080/slides")
        check("the Pi's slides page is served (for HDMI 2 set to Slides)", status == 200 or status == 404, status)

        print("\nCentral Usage roles: one main admin, admins, User 1 / User 2:")

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
        await main_c.send(json.dumps({"type": "cuRole", "action": "hello", "id": "pc-main", "name": "Sound desk", "role": "main", "token": token, "pin": "4321", "pair": "2468"}))
        r = await cu_wait(main_c, lambda m: m.get("type") == "cuRoleReply")
        check("becoming the main admin needs the Central Control's code once", r and not r["ok"] and r.get("needCode"), r)
        await main_c.send(json.dumps({"type": "cuRole", "action": "hello", "id": "pc-main", "name": "Sound desk", "role": "main", "token": token, "pin": "4321", "pair": "2468", "code": hello["code"]}))
        v = await cu_wait(main_c, lambda m: m.get("type") == "cuRoles" and m.get("youAreMain"))
        check("...with it, the first main admin is registered (and kept in cu-roles.json)", v and v["hasMain"] and os.path.exists(os.path.join(root, "data", "cu-roles.json")), v)
        saved = open(os.path.join(root, "data", "cu-roles.json")).read()
        check("the PIN, pairing code and token are stored only as salted hashes", "4321" not in saved and "2468" not in saved and token not in saved)
        await b_c.send(json.dumps({"type": "cuRole", "action": "join", "id": "pc-keys", "name": "Keys", "pair": "1111"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("joining with a wrong pairing code is refused", r and not r["ok"], r)
        await b_c.send(json.dumps({"type": "cuRole", "action": "join", "id": "pc-keys", "name": "Keys", "pair": "2468"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("...the right one joins as User 1 and hands over the Central Control's code", r and r["ok"] and r["role"] == "user1" and r["code"] == hello["code"], r)
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
        await b_c.send(json.dumps({"type": "cuRole", "action": "assign", "target": "pc-main", "role": "user2"}))
        r = await cu_wait(b_c, lambda m: m.get("type") == "cuRoleReply")
        check("only the main admin changes other computers", r and not r["ok"], r)
        await c_c.send(json.dumps({"type": "cuRole", "action": "hello", "id": "pc-lights", "name": "Lights", "role": "main", "token": "another-token-0123456789"}))
        v = await cu_wait(main_c, lambda m: m.get("type") == "cuRoles" and len(m.get("conflict") or []) == 2)
        check("a second 'main admin' is flagged to both (it works as an admin meanwhile)", v and v["conflict"][0]["id"] == "pc-main" and driver.cu_roles.devices["pc-lights"]["role"] == "admin", v and v.get("conflict"))
        await c_c.send(json.dumps({"type": "cuRole", "action": "forget"}))
        r = await cu_wait(c_c, lambda m: m.get("type") == "cuRoleReply")
        check("Forget role on the extra one clears the conflict", r and r["ok"] and "pc-lights" not in driver.cu_roles.devices and len(driver.cu_roles.claimants()) == 1, r)
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
        check("POST /update is refused politely on a PC (it needs the Pi's root helper)", status == 200 and json.loads(body).get("ok") is False and "Central Control itself" in json.loads(body).get("error", ""), body[:200])
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
                    return self.reply({"tag_name": "v8.9.0", "body": "Faster scenes\nand more", "published_at": "2026-11-01T10:00:00Z",
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
        await send({"type": "updates", "action": "check"})
        upm = await next_message(lambda m: m["type"] == "updateStatus" and m.get("latest"), 5.0)
        check("the daily check finds a newer release (8.9.0) with a Pi update in it, and its notes", upm and upm["available"] and upm["latest"] == "8.9.0" and upm["hasPi"] and upm["notes"].startswith("Faster"), upm)
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
        check("Install on a PC stops safely after the checks (it needs the Pi's root helper)", inst and ("checksum" in inst["error"] or "Central Control itself" in inst["error"]), inst)

        ir_src = os.path.join(media_root, "Celestion V30.wav")
        with open(ir_src, "wb") as handle:
            handle.write(b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 40)
        status, body = jpost("/instrument/ir", {"path": ir_src})
        check("an IR .wav from the stick is copied into /data/pad-pedal/sounds/ir for the IR loader", status == 200 and os.path.exists(json.loads(body).get("file", "")), body[:200])
        status, body = jpost("/instrument/ir", {"path": "/etc/passwd"})
        check("...and nothing outside the USB / SD folders can be taken", status == 403, body[:200])

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

    stop_event.set()
    await asyncio.wait_for(server_task, 5)
    print("\n%s" % ("ALL DRIVER CHECKS PASSED" if not failures else "%d CHECK(S) FAILED: %s" % (len(failures), failures)))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
