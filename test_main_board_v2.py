#!/usr/bin/env python3
"""
Central Pedal main board rev B - driver checks (no Raspberry Pi needed).   python3 test_main_board_v2.py

Proves, against fake I2C chips: the board preset (10 footswitches, 6 click-knobs, 2 faders, 4 external footswitch
inputs, 11 lights, 18 label screens, no pin used twice), the board's detection (EEPROM text or its chips answering),
the quadrature decoder (one step per detent, bounce ignored), the two expanders (a knob turned, a knob pushed, an
external footswitch, the plug detect and charger lines), the BQ25798 set-up (2 A, 3 A in, watchdog off) and status,
the TPA6130A2 volume, the label screens (which mux channel each one is on, what gets drawn) and the display settings.
"""
import importlib.util
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("pedal_driver", os.path.join(HERE, "pedal-driver.py"))
drv = importlib.util.module_from_spec(spec)
sys.modules["pedal_driver"] = drv
spec.loader.exec_module(drv)

failures = 0


def check(ok, text):
    global failures
    print(("  ✓ " if ok else "  ✗ ") + text)
    if not ok:
        failures += 1


# ---- the preset ------------------------------------------------------------------
print("rev B preset")
cfg = drv.apply_board(drv.load_config(None), "central-main-v2")
inputs = cfg["inputs"]
by_id = {i["id"]: i for i in inputs}
fs = [i for i in inputs if i["kind"] == "button" and i.get("gpio") is not None]
check([i["gpio"] for i in fs] == [5, 6, 7, 8, 9, 10, 11, 16, 17, 22], "10 footswitches on GPIO 5-11, 16, 17, 22 (%s)" % [i["gpio"] for i in fs])
knobs = [i for i in inputs if i["kind"] == "encoder"]
check(len(knobs) == 6 and all(k["expander_enc"]["address"] == "0x20" for k in knobs), "6 click-knobs are encoders on expander 1")
check([k["expander_enc"]["a"] for k in knobs] == [0, 2, 4, 6, 8, 10], "encoder A lines on pins 0, 2, 4, 6, 8, 10 (B = A + 1)")
clicks = [by_id["k%dc" % i] for i in range(1, 7)]
check([(c["expander"], c["expander_pin"]) for c in clicks] == [("0x20", 12), ("0x20", 13), ("0x20", 14), ("0x20", 15), ("0x21", 0), ("0x21", 1)], "knob pushes: expander 1 pins 12-15, expander 2 pins 0-1")
check([(by_id["x%d" % i]["expander"], by_id["x%d" % i]["expander_pin"]) for i in range(1, 5)] == [("0x21", 2), ("0x21", 3), ("0x21", 4), ("0x21", 5)], "external footswitches A tip/ring, B tip/ring on expander 2 pins 2-5")
check(by_id["s1"]["adc"] == {"address": "0x48", "channel": 0} and by_id["s2"]["adc"] == {"address": "0x48", "channel": 1}, "faders on the ADS1115 (0x48) channels 0 and 1")
leds = cfg["leds"]
check(len(leds) == 11 and all(l["pca9685"]["address"] == "0x41" for l in leds) and [l["pca9685"]["channel"] for l in leds] == list(range(11)), "11 lights on the PCA9685 channels 0-10 (10 footswitches + status)")
check(all(leds[i]["follows"] == "b%d" % (i + 1) for i in range(10)) and leds[10]["follows"] == "@running", "each footswitch light follows its footswitch; channel 10 = running")
screens = cfg["labels"]["screens"]
check(len(screens) == 18 and len(set(s["id"] for s in screens)) == 18, "18 label screens, one per control")
check(all(s["id"] in by_id for s in screens), "every label screen belongs to an input")
check(sorted((s["mux"], s["channel"]) for s in screens) == sorted([("0x70", c) for c in range(8)] + [("0x71", c) for c in range(8)] + [("0x72", 0), ("0x72", 1)]), "mux channels: 0x70 x8, 0x71 x8, 0x72 x2 - each used once")
check(next(s for s in screens if s["id"] == "k1")["mux"] == "0x71" and next(s for s in screens if s["id"] == "k1")["channel"] == 2, "knob 1's screen is mux 0x71 channel 2 (after footswitches 9 and 10)")
reserved = set(drv.reserved_pins(cfg))
check(not any(i["gpio"] in reserved for i in fs), "no footswitch sits on a pin the board uses for something else")
check({2, 3, 12, 13, 14, 15, 18, 19, 20, 21, 23, 24, 25, 26} <= reserved, "I2C, headphone PWM (12/13), MIDI, I2S, expander INTs (23/25), power-off, fan are reserved")
check(cfg["charger"]["chip"] == "bq25798" and cfg["headphones"]["chip"] == "tpa6130a2" and cfg["battery"]["address"] == "0x45", "charger, headphone amp and battery monitor named")
check(cfg["touch_screen"] == "dsi-rpi2-7", "the board's screen is the Pi Touch Display 2 (DSI)")
ids = [i["id"] for i in inputs]
check(len(ids) == len(set(ids)) == 28, "28 inputs (10 + 6 + 6 + 2 + 4), no id twice (%d)" % len(ids))
c2 = drv.apply_board(dict(cfg, touch_screen="hdmi-7-1024"), "central-main-v2")
check(c2["touch_screen"] == "hdmi-7-1024", "a screen picked in Settings is kept when the board's map is applied")
back = drv.apply_board(cfg, "none")
check(back.get("board") is None and "labels" not in back and "expanders" not in back and len(back["inputs"]) == len(drv.DEFAULT_INPUTS), "back to the hand-wired map takes the rev B parts out")

# ---- detection ---------------------------------------------------------------------
print("detection")
tmp = tempfile.mkdtemp()
hat = os.path.join(tmp, "hat")
os.makedirs(hat)
check(drv.detect_board(hat_dir=hat, bus=None) is None, "no EEPROM, no bus: no board")
with open(os.path.join(hat, "product"), "wb") as fh:
    fh.write(b"Central Pedal Main Board rev B\0")
check(drv.detect_board(hat_dir=hat, bus=None) == "central-main-v2", "the HAT EEPROM's product text names the board")
bus = drv._SimBus([0x48, "v2"])
check(drv.detect_board(hat_dir=os.path.join(tmp, "nothing"), bus=bus) == "central-main-v2", "no EEPROM: the mux, expander 2 and the BQ25798 answering is enough")
plain = drv._SimBus([0x48, 0x49])
check(drv.detect_board(hat_dir=os.path.join(tmp, "nothing"), bus=plain) is None, "a hand-wired pedal (ADS1115s only) is not the board")
wrong = drv._SimBus([0x48, "v2"])
wrong.read_i2c_block_data = lambda a, r, n, _o=wrong.read_i2c_block_data: [0x00] if (a, r) == (0x6B, 0x48) else _o(a, r, n)
check(drv.detect_board(hat_dir=os.path.join(tmp, "nothing"), bus=wrong) is None, "a different chip at 0x6b: not the board")
c = drv.load_config(None)
check(drv.auto_board(c, "central-main-v2") and c["board"] == "central-main-v2" and c["board_auto"] == "central-main-v2", "auto: the board found -> its pin map")
check(not drv.auto_board(c, "central-main-v2"), "auto: found again -> nothing to change")
check(drv.auto_board(c, None) and not c.get("board") and "board_auto" not in c, "auto: board gone -> back to hand-wired")
c = drv.load_config(None)
c["board_manual"] = True
check(not drv.auto_board(c, "central-main-v2") and not c.get("board"), "set by hand in Settings: detection leaves it alone")

# ---- quadrature -------------------------------------------------------------------
print("quadrature decoder")
dec = drv.QuadratureDecoder()
cw = [(1, 1), (0, 1), (0, 0), (1, 0), (1, 1)]           # one detent clockwise (A leads)
ccw = [(1, 1), (1, 0), (0, 0), (0, 1), (1, 1)]
steps = [dec.feed(a, b) for a, b in cw]
check(sum(steps) == 1 and steps.count(0) == 4, "one clockwise detent = exactly one +1 step (%s)" % steps)
steps = [dec.feed(a, b) for a, b in ccw]
check(sum(steps) == -1, "one anticlockwise detent = exactly one -1 step (%s)" % steps)
dec2 = drv.QuadratureDecoder()
dec2.feed(1, 1)
bounce = [dec2.feed(a, b) for a, b in [(0, 1), (1, 1), (0, 1), (1, 1), (0, 1), (0, 0), (1, 0), (1, 1)]]
check(sum(bounce) == 1, "contact bounce on one line while turning still counts one step (%s)" % bounce)
dec3 = drv.QuadratureDecoder()
dec3.feed(1, 1)
half = [dec3.feed(a, b) for a, b in [(0, 1), (0, 0), (0, 1), (1, 1)]]
check(sum(half) == 0, "a half turn that comes back counts nothing (%s)" % half)

# ---- expanders ----------------------------------------------------------------------
print("expanders")
events, stepsq, lines = [], [], []
bus = drv._SimBus([0x48, "v2"])
cfg = drv.apply_board(drv.load_config(None), "central-main-v2")
cfg["hold_s"] = 0.05
ex = drv.BoardExpanders(bus, cfg, lambda i, e: events.append((i, e)), lambda i, d: stepsq.append((i, d)), lambda n, h: lines.append((n, h)), hold_s=0.05)
check(set(ex.chips) == {0x20, 0x21} and len(ex.buttons) == 10 and len(ex.encoders) == 6, "both chips, 10 buttons (6 pushes + 4 external), 6 encoders")
check(bus.regs.get((0x20, 0x04)) == 0xFF and bus.regs.get((0x20, 0x05)) == 0xFF and bus.regs.get((0x20, 0x0A)) == 0x40, "interrupt on any pin change, INTA mirrors INTB")
# knob 2 turned one detent clockwise: A = pin 2, B = pin 3 (both high at rest)
for a, b in [(0, 1), (0, 0), (1, 0), (1, 1)]:
    bus.pins[0x20] = (bus.pins[0x20] & ~0x0C) | (a << 2) | (b << 3)
    ex.poll()
check(stepsq == [("k2", 1)], "knob 2 turned one detent -> k2 +1 (%s)" % stepsq)
stepsq.clear()
for a, b in [(1, 0), (0, 0), (0, 1), (1, 1)]:
    bus.pins[0x20] = (bus.pins[0x20] & ~0x0C) | (a << 2) | (b << 3)
    ex.poll()
check(stepsq == [("k2", -1)], "and back one detent -> k2 -1 (%s)" % stepsq)
# knob 5's push: expander 2 pin 0
bus.pins[0x21] &= ~0x01
ex.poll()
check(events == [("k5c", "press")], "knob 5 pushed -> k5c press (%s)" % events)
time.sleep(0.07)
ex.poll()
check(events[-1] == ("k5c", "hold"), "held past hold_s -> hold once (%s)" % events[-1:])
ex.poll()
check(events.count(("k5c", "hold")) == 1, "hold is sent once per press")
bus.pins[0x21] |= 0x01
ex.last_change.clear()
ex.poll()
check(events[-1] == ("k5c", "release"), "let go -> release")
# external footswitch B ring: expander 2 pin 5
events.clear()
bus.pins[0x21] &= ~0x20
ex.last_change.clear()
ex.poll()
check(events == [("x4", "press")], "external footswitch B (ring) -> x4 press")
# plug detect A (pin 6): low = nothing plugged; goes high when a cable is plugged in
bus.pins[0x21] &= ~0x40
ex.last_change.clear()
ex.poll()
check(lines[-1] == ("instrumentA", False), "instrument A jack: switch closed (nothing plugged) -> line low")
bus.pins[0x21] |= 0x40
ex.poll()
check(lines[-1] == ("instrumentA", True) and ex.line("instrumentA") is True, "cable plugged -> line high")
bus.pins[0x21] &= ~0x100
ex.poll()
check(lines[-1] == ("charging", False) and ex.line("charging") is False, "charger STAT pulled low -> charging line low")
ex.close()

# ---- charger + headphone amp -------------------------------------------------------------
print("charger / headphone amp")
bus = drv._SimBus([0x48, "v2"])
bus.regs[(0x6B, 0x10)] = 0xA5                         # whatever the chip had, with watchdog bits set
chg = drv.BQ25798(bus, 0x6B, charge_a=2.0, input_a=3.0)
check((bus.regs[(0x6B, 0x03)] << 8 | bus.regs[(0x6B, 0x04)]) == 200, "charge current 2.0 A = 200 x 10 mA")
check((bus.regs[(0x6B, 0x06)] << 8 | bus.regs[(0x6B, 0x07)]) == 300, "input limit 3.0 A = 300 x 10 mA")
check((bus.regs[(0x6B, 0x01)] << 8 | bus.regs[(0x6B, 0x02)]) == 840, "charge voltage 8.40 V (2S)")
check(bus.regs[(0x6B, 0x10)] == 0xA0, "watchdog bits cleared, the rest of REG10 kept")
check(bus.regs[(0x6B, 0x2E)] & 0x80, "ADC switched on")
bus.regs[(0x6B, 0x1B)] = 0x09                          # VBUS present + power good
bus.regs[(0x6B, 0x1C)] = 0x03 << 5                     # fast charge
bus.regs[(0x6B, 0x35)], bus.regs[(0x6B, 0x36)] = 0x3A, 0x98   # 15000 mV
st = chg.status()
check(st["usb"] and st["powerGood"] and st["state"] == "charging" and st["charging"] and st["usbVolts"] == 15.0, "status: USB-C in at 15 V, charging (%s)" % st)
bus.regs[(0x6B, 0x1C)] = 0x07 << 5
check(chg.status()["state"] == "done" and not chg.status()["charging"], "status: charge done")
chg.set_charge_current(1.0)
check((bus.regs[(0x6B, 0x03)] << 8 | bus.regs[(0x6B, 0x04)]) == 100, "charge current changed to 1.0 A")
amp = drv.TPA6130A2(bus, 0x60, volume=0.6)
check(bus.regs[(0x60, 0x01)] == 0xC0, "both headphone channels enabled")
check(bus.regs[(0x60, 0x02)] == 38, "60 % volume = code 38 of 63")
amp.set(1.0)
check(bus.regs[(0x60, 0x02)] == 63, "full = 63 (+4 dB)")
amp.set(0.0)
check(bus.regs[(0x60, 0x02)] == 0xC0, "zero = both channels muted")
amp.close()
check(bus.regs[(0x60, 0x01)] == 0x00, "close() shuts the amp down")

# ---- label screens -----------------------------------------------------------------------
print("label screens")
try:
    import PIL  # noqa: F401
    have_pil = True
except ImportError:
    have_pil = False
if have_pil:
    bus = drv._SimBus([0x48, "v2"])
    cfg = drv.apply_board(drv.load_config(None), "central-main-v2")
    lab = drv.LabelScreens(bus, cfg["labels"]["screens"], fonts_dir=os.path.join(HERE, "fonts"))
    check(sum(1 for v in lab.present.values() if v) == 18, "all 18 screens answered their init")
    changed = lab.set_items({"b1": {"top": "Footswitch 1", "bottom": "Warm Pad"}, "k1": {"top": "Left knob 1", "bottom": "Master volume", "value": 0.7}})
    check(sorted(changed) == ["b1", "k1"], "two screens changed")
    check(lab.set_items({"b1": {"top": "Footswitch 1", "bottom": "Warm Pad"}}) == [], "the same words again: nothing to redraw")
    time.sleep(0.6)
    drawn = bus.oled.get((0x70, 0))
    check(drawn is not None and len(drawn) % 512 == 0 and any(drawn), "footswitch 1's screen (mux 0x70 ch 0) received a 512-byte picture with something on it")
    drawn_k1 = bus.oled.get((0x71, 2))
    check(drawn_k1 is not None and any(drawn_k1), "knob 1's screen (mux 0x71 ch 2) drawn too")
    data = lab.render("b1")
    check(len(data) == 512 and sum(1 for b in data if b) > 40, "render: 4 pages x 128 columns, text lit")
    blank = lab.render("b7")
    lit_blank = sum(1 for b in blank if b)
    check(lit_blank > 0, "a screen with no job still shows its name and a dash")
    lab.show_value("s1", 0.25)
    bar = lab.render("s1")
    check(bar != lab.render("b7") and sum(1 for b in bar if b) > 60, "a moving fader draws a bar")
    lab.pressed("b1")
    inv = lab.render("b1")
    check(sum(1 for b in inv if b) > sum(1 for b in data if b), "a press shows inverted for a moment")
    check(all(lab.render(s["id"]) is not None for s in cfg["labels"]["screens"]), "every screen renders")
    lab.close()
    check(bus.mux_sel.get(0x70) == 0 and bus.mux_sel.get(0x71) == 0, "muxes left with no channel selected")
else:
    print("  - PIL not installed here: label screen drawing not checked")

# ---- the driver with the rev B bus -----------------------------------------------------------
print("driver")
cfg = drv.apply_board(drv.load_config(None), "central-main-v2")
tmp2 = tempfile.mkdtemp()
cfg["data_root"] = tmp2
cfg["app_root"] = HERE
cfg["simulated"] = True
cfg["midi"] = False
cfg["link"] = False
bus = drv._SimBus([0x48, "v2"])
try:
    from gpiozero import Device
    from gpiozero.pins.mock import MockFactory
    factory = MockFactory()
    Device.pin_factory = factory
except Exception:
    factory = None
d = drv.PedalDriver(cfg, pin_factory=factory, i2c_bus=bus)
sent = []
d.emit = lambda m, lan=False: sent.append(m)
d.start_analog()
check(len(d.analog) == 2 and d.adcs.get(0x48), "both faders read from the ADS1115")
check(d.expanders is not None and d.encoder_ok, "expanders up, knobs on")
check(d.charger is not None and d.headamp is not None, "charger and headphone amp up")
check(len([l for l in d.leds if l.startswith("led")]) == 10 and "status" in d.leds, "10 footswitch lights + status on the PCA9685")
check(d.labels is not None if have_pil else True, "label screens up")
bs = d.battery_status()
check(bs and bs["charging"] and "state" in bs and bs["volts"] == 7.9 and bs["amps"] == -0.4, "battery: 7.9 V, 0.4 A in, charging (INA226 + BQ25798)")
d.encoder_step("k3", 1)
check(sent[-1] == {"type": "control", "id": "k3", "delta": 1}, "a knob step is a control message with delta")
d.button_event("k3c", "press")
check(sent[-1] == {"type": "control", "id": "k3c", "event": "press"}, "a knob push is a press")
d.board_line("instrumentB", True)
check(sent[-1]["type"] == "instrumentJack" and sent[-1]["jack"] == "B" and sent[-1]["plugged"], "plugging into instrument B says so")
st = d.system_status()
check(st["board"] == "central-main-v2" and st["boardStatus"]["knobs"] and st["boardStatus"]["charger"] and st["phonesVolume"] == 0.6, "system status carries the board's state")
disp = d.displays_config()
check(disp["main"] == "builtin" and disp["strip"] == "strip" and disp["board"] == "central-main-v2", "display defaults: app on the 7\", bar screen = strip")
d.handle_app_message({"type": "labels", "items": {"b2": {"top": "Footswitch 2", "bottom": "Next song"}}})
if have_pil:
    check(d.labels.items["b2"]["bottom"] == "Next song", "the app's words reach the label screens")
d.handle_app_message({"type": "miniPush", "lists": {"scenes": {"items": [{"id": 0, "label": "Verse"}], "current": 0}}})
check(d.strip_lists.get("scenes", {}).get("items") == [{"id": 0, "label": "Verse"}], "the app's lists are kept for the bar screen")
d.handle_app_message({"type": "strip", "action": "run", "name": "pad", "args": {"index": 3}})
check(sent[-1] == {"type": "action", "name": "pad", "args": {"index": 3}, "from": "strip"}, "the bar screen runs an action through the app")
d.handle_app_message({"type": "strip", "action": "pick", "what": "scenes", "id": 2})
check(sent[-1]["type"] == "miniPick" and sent[-1]["id"] == 2, "the bar screen picks from a list like the small screen does")
d.learn = {"target": "k6", "kind": "encoder", "started": 0}
d.encoder_step("k2", 1)
check(sent[-1]["type"] == "learned" and sent[-1]["input"] == {"expander_enc": {"address": "0x20", "a": 2, "b": 3}} and sent[-1].get("alreadyUsedBy") == "k2", "Learn: turning a knob teaches its encoder lines (and says who has them)")
d.learn = {"target": "x9", "kind": "button", "started": 0}
d.button_event("x3", "press")
check(sent[-1]["type"] == "learned" and sent[-1]["input"] == {"expander": "0x21", "expander_pin": 4}, "Learn: pressing an external footswitch teaches its expander pin")
d.reload_hardware()
check(d.expanders is not None and d.labels is not None if have_pil else True, "reload: everything comes back")
for dev in d.devices:
    try:
        dev.close()
    except Exception:
        pass

print()
if failures:
    print("%d CHECK%s FAILED" % (failures, "" if failures == 1 else "S"))
    sys.exit(1)
print("ALL REV B CHECKS PASSED")
