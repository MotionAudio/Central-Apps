#!/usr/bin/env python3
"""
Central Pedal main board - driver checks (no Raspberry Pi needed).   python3 test_main_board.py

Proves, against fake SPI / I2C chips: the MCP3208 knob/fader reads, 12-bit scaling, the PCA9685 footswitch lights
(on / dim / blink, open-drain inverted), the INA226 battery reading and its charge %, the MIDI byte parser
(running status, clock inside a message, SysEx skipped), the board preset (every input, pin and light, back to the
hand-wired map) and that the Learn tab won't put a footswitch on a pin the board uses.
"""
import importlib.util
import os
import sys
import time
import types

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


# ---- MCP3208 over a fake spidev -------------------------------------------------
class FakeSpi:
    values = [0, 1000, 2048, 3000, 4095, 12, 4083, 777]

    def open(self, bus, dev):
        self.opened = (bus, dev)

    def xfer2(self, data):
        ch = ((data[0] & 1) << 2) | (data[1] >> 6)
        v = self.values[ch]
        return [0, (v >> 8) & 0x0F, v & 0xFF]

    def close(self):
        pass


sys.modules["spidev"] = types.SimpleNamespace(SpiDev=FakeSpi)
adc = drv.MCP3208(0, 0)
check([adc.read(c) for c in range(8)] == FakeSpi.values, "MCP3208: all 8 channels read back the right 12-bit value")
check(drv.adc_key({"chip": "mcp3208", "bus": 0, "cs": 0, "channel": 3}) == "spi0.0" and drv.adc_key({"address": "0x49", "channel": 1}) == 0x49,
      "ADC keys: SPI chip vs ADS1115 address")

cfg = dict(drv.DEFAULT_CONFIG)
drv.apply_board(cfg, "central-main-v1")
fader = next(i for i in cfg["inputs"] if i["id"] == "s1")
a = drv.AnalogInput(fader, cfg)
a.alpha = 1.0
check(a.spi and a.update(12) == 0.0 and a.update(4083) == 1.0, "a fader on the board ADC: bottom = 0, top = 1 (12-bit range)")
mid = a.update(2048)
check(mid is not None and 0.49 < mid < 0.51, "...and the middle reads 0.5 (%s)" % mid)


# ---- PCA9685 lights over a fake I2C bus ---------------------------------------------
class FakeBus:
    def __init__(self):
        self.bytes, self.blocks, self.regs = {}, {}, {}

    def write_byte_data(self, addr, reg, val):
        self.bytes[(addr, reg)] = val

    def write_i2c_block_data(self, addr, reg, data):
        self.blocks[(addr, reg)] = list(data)

    def read_i2c_block_data(self, addr, reg, n):
        return self.regs.get((addr, reg), [0, 0])[:n]


bus = FakeBus()
pca = drv.PCA9685(bus, 0x41)
check(bus.bytes[(0x41, 0xFE)] == 5, "PCA9685: 1 kHz light PWM (prescale 5)")
led = drv._PcaLed(pca, 3, brightness=1.0, dim=0.06)
led.on()
check(bus.blocks[(0x41, 0x06 + 12)] == [0, 0, 0, 0x10], "footswitch light ON = output fully low (open drain sinks the LED)")
led.off()
reg = bus.blocks[(0x41, 0x06 + 12)]
off = reg[2] | (reg[3] << 8)
check(3800 < off < 3900, "footswitch light OFF = a faint 6 %% glow, not dark (%d/4095 high)" % off)
led.blink(0.02, 0.02)
time.sleep(0.07)
led.close()
check(bus.blocks[(0x41, 0x06 + 12)] == [0, 0x10, 0, 0], "blink thread stops and close() turns the light fully off")

# ---- INA226 battery --------------------------------------------------------------------
bus.regs[(0x45, 0x02)] = [0x17, 0x20]          # 5920 * 1.25 mV = 7.40 V
bus.regs[(0x45, 0x01)] = [0x0F, 0xA0]          # 4000 * 2.5 uV / 5 mOhm = 2.0 A
ina = drv.INA226(bus, 0x45, 0.005)
v, i = ina.read()
check(abs(v - 7.40) < 0.01 and abs(i - 2.0) < 0.01, "INA226: 7.40 V, 2.0 A (%.2f V, %.2f A)" % (v, i))
check(drv.battery_percent(8.4) == 100 and drv.battery_percent(7.4) == 50 and drv.battery_percent(5.9) == 0 and drv.battery_percent(7.3) == 40,
      "2S charge %: 8.4 V full, 7.4 V half, 6.0 V empty")

# ---- MIDI byte stream --------------------------------------------------------------------
p = drv.MidiStream()
got = p.feed(bytes([0x90, 60, 100, 62, 90, 0xB0, 7, 0xF8, 127, 0xF0, 1, 2, 3, 0xF7, 0xC1, 5, 0xFA]))
check(got == [[0x90, 60, 100], [0x90, 62, 90], [0xF8], [0xB0, 7, 127], [0xC1, 5], [0xFA]],
      "MIDI jacks: running status, a clock tick inside a CC, SysEx skipped, program change, start (%s)" % got)

# ---- the board preset ------------------------------------------------------------------------
ids = [i["id"] for i in cfg["inputs"]]
check(ids[:8] == ["b%d" % n for n in range(1, 9)] and [i["gpio"] for i in cfg["inputs"][:8]] == [5, 6, 12, 13, 16, 17, 22, 23],
      "board: footswitches 1-8 on GPIO 5, 6, 12, 13, 16, 17, 22, 23")
check(all(("k%d" % n) in ids and ("k%dc" % n) in ids for n in range(1, 7)), "board: 6 knobs and their 6 push-clicks")
check([i["expander_pin"] for i in cfg["inputs"] if i.get("expander_pin") is not None] == [0, 1, 2, 3, 4, 5, 6, 7],
      "board: knob clicks + external footswitches on expander pins 0-7")
check({"s1", "s2", "x1", "x2"} <= set(ids), "board: both faders and both external footswitches are inputs (programmable)")
check(len([l for l in cfg["leds"] if l.get("pca9685")]) == 8 and cfg["leds"][0]["follows"] == "b1", "board: a light per footswitch, following it")
gpios = [i["gpio"] for i in cfg["inputs"] if i.get("gpio") is not None]
check(not set(gpios) & set(drv.reserved_pins(cfg)), "board: no footswitch sits on a pin the board uses for something else")
check({14, 15, 20, 26, 24}.issubset(drv.reserved_pins(cfg)), "board: MIDI (14/15), I2S in (20), fan (26), power-off (24) are reserved")
drv.apply_board(cfg, "none")
check(cfg["inputs"] == drv.DEFAULT_INPUTS and cfg["leds"] == [] and "board" not in cfg and cfg.get("expander") is None, "back to the hand-wired map")

print("\nALL MAIN BOARD CHECKS PASSED" if not failures else "\n%d CHECK(S) FAILED" % failures)
sys.exit(1 if failures else 0)
