#!/usr/bin/env python3
"""Generates wiring.html from the same defaults the driver uses (pedal-driver.py DEFAULT_INPUTS)."""
import html
import importlib.util
import re
import sys

src, out, template = sys.argv[1], sys.argv[2], sys.argv[3]
spec = importlib.util.spec_from_file_location("d", src + "/pedal-driver.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
INPUTS = d.DEFAULT_INPUTS
TFT_PINS = d.RESERVED_TFT
DAC_PINS = {18: "DAC BCK", 19: "DAC LCK", 21: "DAC DIN"}

BCM_TO_PIN = {2: 3, 3: 5, 4: 7, 14: 8, 15: 10, 17: 11, 18: 12, 27: 13, 22: 15, 23: 16, 24: 18, 10: 19, 9: 21,
              25: 22, 11: 23, 8: 24, 7: 26, 0: 27, 1: 28, 5: 29, 6: 31, 12: 32, 13: 33, 19: 35, 16: 36, 26: 37,
              20: 38, 21: 40}
PIN_TO_BCM = {v: k for k, v in BCM_TO_PIN.items()}
TFT_NAMES = {7: "screen touch CS", 8: "screen LCD CS", 9: "screen MISO", 10: "screen MOSI", 11: "screen SCLK", 17: "screen touch IRQ", 24: "screen D/C", 25: "screen reset"}

roles = {}
for p in (1, 17):
    roles[p] = ("v33", "3.3 V power")
for p in (2, 4):
    roles[p] = ("v5", "5 V (DAC VIN only)")
for p in (6, 9, 14, 20, 25, 30, 34, 39):
    roles[p] = ("gnd", "Ground")
roles[3] = ("i2c", "I2C SDA (ADS1115 ×3)")
roles[5] = ("i2c", "I2C SCL (ADS1115 ×3)")
buttons = [i for i in INPUTS if i["kind"] == "button"]
for b in buttons:
    roles[BCM_TO_PIN[b["gpio"]]] = ("sw", b["name"])
for g, name in DAC_PINS.items():
    roles[BCM_TO_PIN[g]] = ("dac", name)
enc = next(i for i in INPUTS if i["kind"] == "encoder")
for g in TFT_PINS:
    roles[BCM_TO_PIN[g]] = ("tft", TFT_NAMES.get(g, "3.5\" screen"))
for g, why in ((0, "HAT ID"), (1, "HAT ID")):
    roles.setdefault(BCM_TO_PIN[g], ("res", "Keep free (%s)" % why))
for p in range(1, 41):
    if p not in roles:
        roles[p] = ("free", "Spare")


def pin_name(p):
    if p in PIN_TO_BCM:
        return "GPIO %d" % PIN_TO_BCM[p]
    return {1: "3V3", 17: "3V3", 2: "5V", 4: "5V"}.get(p, "GND")


def gp(g):
    return "GPIO %d <span class=\"pinno\">pin %d</span>" % (g, BCM_TO_PIN[g])


# ---------------------------------------------------------------- header SVG
ROW, TOP, W = 27, 38, 700
CX_ODD, CX_EVEN = 332, 368
H = TOP + 20 * ROW + 26
svg = ['<svg class="hdr" viewBox="0 0 %d %d" role="img" aria-labelledby="hdr-t"><title id="hdr-t">Raspberry Pi 4 40-pin header with Central Pedal connections</title>' % (W, H)]
svg.append('<rect class="hdr-body" x="314" y="%d" width="72" height="%d" rx="6"/>' % (TOP - 18, 20 * ROW + 10))
svg.append('<text class="hdr-cap" x="350" y="%d" text-anchor="middle">board edge &#8594;</text>' % (TOP - 24))
for r in range(20):
    y = TOP + r * ROW
    for p, cx, side in ((2 * r + 1, CX_ODD, "l"), (2 * r + 2, CX_EVEN, "r")):
        role, label = roles[p]
        shape = ('<rect class="pin %s" x="%d" y="%d" width="18" height="18" rx="2"/>' % (role, cx - 9, y - 9)) if p == 1 else \
            '<circle class="pin %s" cx="%d" cy="%d" r="9"/>' % (role, cx, y)
        num = '<text class="pnum %s" x="%d" y="%d" text-anchor="middle">%d</text>' % (role, cx, y + 3.5, p)
        if side == "l":
            txt = '<text class="plab" x="%d" y="%d" text-anchor="end"><tspan class="t-%s">%s</tspan><tspan class="gpn" dx="8">%s</tspan></text>' % (cx - 18, y + 4, role, html.escape(label), pin_name(p))
            line = '<line class="lead %s" x1="%d" y1="%d" x2="%d" y2="%d"/>' % (role, cx - 16, y, cx - 10, y)
        else:
            txt = '<text class="plab" x="%d" y="%d"><tspan class="gpn">%s</tspan><tspan class="t-%s" dx="8">%s</tspan></text>' % (cx + 18, y + 4, pin_name(p), role, html.escape(label))
            line = ""
        svg.append('<g class="prow" data-role="%s">%s%s%s%s</g>' % (role, line, shape, num, txt))
svg.append("</svg>")
header_svg = "\n".join(svg)

# ---------------------------------------------------------------- tables
PAD_JOBS = {"b1": "Pad 1", "b2": "Pad 2", "b3": "Pad 3", "b4": "Pad 4", "b5": "Pad 5", "b6": "Pad 6", "b7": "Pad 7", "b8": "Pad 8",
            "b9": "Stop (hold: panic)", "b10": "Tap tempo (hold: freeze)", "b11": "Previous song", "b12": "Next song"}
TRK_JOBS = {"b1": "Play / pause", "b2": "Stop (hold: start over)", "b3": "Restart section", "b4": "Repeat section", "b5": "Previous section", "b6": "Next section",
            "b7": "Key down", "b8": "Key up", "b9": "Start over (hold: panic)", "b10": "Tap tempo (hold: freeze)", "b11": "Previous song", "b12": "Next song (hold: next + play)"}
button_rows = "".join("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % (b["name"], gp(b["gpio"]), PAD_JOBS[b["id"]], TRK_JOBS[b["id"]]) for b in buttons)
KNOB_JOBS = {"k1": ("Volume", "Volume"), "k2": ("Tone", "Tone"), "k3": ("Reverb", "Reverb"), "k4": ("Fade time", "Fade time"), "k5": ("Texture 1 level", "Tracks level"), "k6": ("Texture 2 level", "Click level"),
             "s1": ("Expression / swell", "Expression / swell"), "s2": ("Morph A ↔ B", "Pads ↔ Tracks balance"), "exp": ("Expression / swell", "Expression / swell")}
analog_rows = "".join("<tr><td>%s</td><td>ADS1115 <code>%s</code></td><td>A%d</td><td>%s</td><td>%s</td></tr>" % (
    i["name"], i["adc"]["address"], i["adc"]["channel"], KNOB_JOBS[i["id"]][0], KNOB_JOBS[i["id"]][1]) for i in INPUTS if i.get("adc"))

page = open(template, encoding="utf-8").read()
style = re.search(r"<style>.*?</style>", page, re.S).group(0)
script = re.search(r"<script>.*?</script>", page, re.S).group(0)
style = style.replace("--enc:#7444bd; --res:#b7c0bb; --free:#ffffff;", "--enc:#7444bd; --dac:#0d8f8a; --tft:#b23a8b; --res:#b7c0bb; --free:#ffffff;") \
    .replace("--enc:#ad8ff2; --res:#4a5752; --free:#0e1513; color-scheme:dark; } }", "--enc:#ad8ff2; --dac:#3dd6cf; --tft:#f07ad0; --res:#4a5752; --free:#0e1513; color-scheme:dark; } }") \
    .replace("--enc:#ad8ff2; --res:#4a5752; --free:#0e1513; color-scheme:dark; }", "--enc:#ad8ff2; --dac:#3dd6cf; --tft:#f07ad0; --res:#4a5752; --free:#0e1513; color-scheme:dark; }") \
    .replace(".pin.enc { fill:var(--enc); }", ".pin.enc { fill:var(--enc); } .pin.dac { fill:var(--dac); } .pin.tft { fill:var(--tft); }") \
    .replace(".lead.enc { stroke:var(--enc); }", ".lead.enc { stroke:var(--enc); } .lead.dac { stroke:var(--dac); } .lead.tft { stroke:var(--tft); }") \
    .replace(".t-enc { fill:var(--enc); }", ".t-enc { fill:var(--enc); } .t-dac { fill:var(--dac); } .t-tft { fill:var(--tft); } .w.dac { stroke:var(--dac); } .w.tft { stroke:var(--tft); } .c-dac { fill:var(--dac); } .c-tft { fill:var(--tft); }") \
    .replace('.hdr[data-focus="res"] .prow[data-role="res"], .hdr[data-focus="res"] .prow[data-role="v5"] { opacity:1; }',
             '.hdr[data-focus="res"] .prow[data-role="res"], .hdr[data-focus="dac"] .prow[data-role="dac"], .hdr[data-focus="tft"] .prow[data-role="tft"] { opacity:1; }')

head = page.split("<style>")[0]
body = """
<div class="wrap">
  <header>
    <div class="eyebrow">Central Pedal · Raspberry Pi 4 control surface</div>
    <h1>Central Pedal Wiring</h1>
    <p class="lede">Everything you connect to the Pi: 12 buttons, 6 knobs, 2 sliders, an optional expression pedal, the PCM5102A I2S DAC board for the click / cue (in-ear) output, and the optional 3.5″ SPI touch screen. These pins are exactly what the driver expects out of the box; the Learn tab can move any of them without re-flashing.</p>
  </header>

  <div class="rules" aria-label="Safety rules">
    <div class="rule"><b>3.3 V only</b><span>Buttons, knobs, sliders and the ADS1115 boards run from 3.3 V (pin 1 or 17). The only thing that takes 5 V is the DAC board's VIN.</span></div>
    <div class="rule"><b>Power off to wire</b><span>Unplug the Pi before connecting or moving any wire. Plug the 3.5″ screen on with the Pi off.</span></div>
    <div class="rule"><b>Count from pin 1</b><span>Pin 1 has a square pad and sits at the end of the header furthest from the USB ports.</span></div>
  </div>

  <section>
    <h2>System overview</h2>
    <div class="fig">
      <svg viewBox="0 0 760 330" role="img" aria-labelledby="ov-t"><title id="ov-t">Block diagram: 12 buttons on GPIO, three ADS1115 boards on I2C, the I2S DAC, the SPI touch screen, two HDMI screens, USB and Wi-Fi</title>
        <path class="w sw" d="M200 52 H236 V150 H270"/><path class="w tft" d="M200 122 H236"/><path class="w enc" d="M200 192 H236 V150"/>
        <path class="w i2c" d="M540 62 H484 V150 H450"/><path class="w i2c" d="M540 142 H484"/><path class="w dac" d="M540 222 H484 V150"/>
        <path class="w sig" d="M110 270 V250 H310 V200"/><path class="w sig" d="M330 270 V200"/><path class="w sig" d="M430 270 V200"/><path class="w v33" d="M640 270 V250 H440 V200"/>
        <rect class="box" x="270" y="100" width="180" height="100" rx="8"/>
        <text class="big" x="360" y="140" text-anchor="middle">Raspberry Pi 4</text><text class="sm" x="360" y="160" text-anchor="middle">Central Pedal</text>
        <text class="mono" x="246" y="142" text-anchor="middle">GPIO</text><text class="mono" x="482" y="134" text-anchor="middle">I2C</text><text class="mono" x="482" y="206" text-anchor="middle">I2S</text>
        <rect class="boxsoft" x="20" y="30" width="180" height="44" rx="6"/><text class="lbl" x="34" y="57">12 buttons (footswitches)</text>
        <rect class="boxsoft" x="20" y="100" width="180" height="44" rx="6"/><text class="lbl" x="34" y="127">3.5″ SPI touch screen</text>
        <rect class="boxsoft" x="20" y="170" width="180" height="44" rx="6"/><text class="lbl" x="34" y="197">Encoder (optional)</text>
        <rect class="boxsoft" x="540" y="34" width="200" height="56" rx="6"/><text class="lbl" x="554" y="58">ADS1115 #1 · 0x48</text><text class="sm" x="554" y="77">knobs 1–4</text>
        <rect class="boxsoft" x="540" y="114" width="200" height="56" rx="6"/><text class="lbl" x="554" y="138">ADS1115 #2 · 0x49</text><text class="sm" x="554" y="157">knobs 5–6, sliders 1–2 (#3 0x4A: expression)</text>
        <rect class="boxsoft" x="540" y="194" width="200" height="56" rx="6"/><text class="lbl" x="554" y="218">PCM5102A I2S DAC</text><text class="sm" x="554" y="237">click + spoken cues → in-ears</text>
        <rect class="boxsoft" x="20" y="270" width="180" height="44" rx="6"/><text class="lbl" x="34" y="297">HDMI 1: app · HDMI 2: lyrics</text>
        <rect class="boxsoft" x="240" y="270" width="180" height="44" rx="6"/><text class="lbl" x="254" y="297">3.5 mm jack: pads + tracks</text>
        <rect class="boxsoft" x="440" y="270" width="140" height="44" rx="6"/><text class="lbl" x="454" y="297">USB: audio, MIDI, pedals</text>
        <rect class="boxsoft" x="600" y="270" width="140" height="44" rx="6"/><text class="lbl" x="614" y="297">5 V 3 A USB-C</text>
      </svg>
    </div>
    <p class="cap">Sound: four mono outputs by default - <b>1</b> tracks, <b>2</b> pads, <b>3</b> click + MD voice, <b>4</b> guitar / keys - spread over the Pi's 3.5 mm jack (channels 1-2), the PCM5102A board (3-4) and any USB audio interface (its outputs come next). Settings → Output routing moves any of them, or switches to stereo pairs. Phones, tablets and the Central Control app on the Wi-Fi open the chord charts; a projector on HDMI 2 shows lyrics.</p>
  </section>

  <section>
    <h2>GPIO header map</h2>
    <p>Hold the Pi with the USB ports pointing toward you; the header is on the right edge and pin 1 is at the top, as drawn. Tap a colour to pick out one group.</p>
    <div class="legend" id="legend">
      <button class="chip" style="--c:var(--sw)" data-role="sw" aria-pressed="false"><i></i>Buttons</button>
      <button class="chip" style="--c:var(--i2c)" data-role="i2c" aria-pressed="false"><i></i>I2C (ADS1115)</button>
      <button class="chip" style="--c:var(--dac)" data-role="dac" aria-pressed="false"><i></i>I2S DAC</button>
      <button class="chip" style="--c:var(--tft)" data-role="tft" aria-pressed="false"><i></i>3.5″ screen</button>
      <button class="chip" style="--c:var(--v33)" data-role="v33" aria-pressed="false"><i></i>3.3 V</button>
      <button class="chip" style="--c:var(--gnd)" data-role="gnd" aria-pressed="false"><i></i>Ground</button>
      <button class="chip" style="--c:var(--res)" data-role="res" aria-pressed="false"><i></i>Keep free</button>
    </div>
    <div class="fig">%(HEADER_SVG)s</div>
    <p class="cap">The 3.5″ screen plugs straight onto the header and covers all 40 pins: everything else connects through a 40-pin ribbon + breakout board, or to the screen's pass-through header if it has one. The screen only uses the pink pins; the rest pass through. With no screen, those pink pins are spare (the encoder uses three of them).</p>
  </section>

  <section>
    <h2>12 buttons</h2>
    <div class="fig">
      <svg viewBox="0 0 680 130" role="img" aria-labelledby="fs-t"><title id="fs-t">One button: GPIO to a momentary switch to ground</title>
        <rect class="box" x="16" y="50" width="150" height="42" rx="6"/><text class="lbl" x="91" y="68" text-anchor="middle">Pi GPIO 4</text><text class="mono" x="91" y="84" text-anchor="middle">pin 7</text>
        <path class="w sw" d="M166 71 H254"/>
        <circle class="term" cx="258" cy="71" r="4"/><circle class="term" cx="318" cy="71" r="4"/>
        <path class="sym" d="M261 69 L314 52"/><path class="sym" d="M288 60 V40 M279 40 H297"/>
        <text class="lbl" x="288" y="28" text-anchor="middle">Button 1</text><text class="sm" x="288" y="100" text-anchor="middle">momentary, normally open</text>
        <path class="w gnd" d="M322 71 H420 V96"/><path class="sym" d="M405 96 H435 M410 102 H430 M415 108 H425"/><text class="mono" x="442" y="106">GND</text>
        <text class="sm" x="490" y="56">No resistor needed: the driver</text><text class="sm" x="490" y="72">switches on the Pi's internal pull-up.</text><text class="sm" x="490" y="88">Any footswitch or arcade button works.</text>
      </svg>
    </div>
    <p class="cap">Wire all 12 the same way; one shared ground wire can run along the whole row. What each button does is set on the Configure tab, separately for the Pad layout and the Tracks layout (the defaults are below). Any button can also have a "hold 0.8 s" job. Lit buttons: their LED can go on any spare pin through a 330 Ω resistor and be listed in <code>hardware.json</code> under <code>leds</code> (<code>{"id":"led1","gpio":20,"follows":"b1"}</code>).</p>
    <div class="tbl"><table>
      <thead><tr><th>Button</th><th>Pin</th><th>Pad layout (default)</th><th>Tracks layout (default)</th></tr></thead>
      <tbody>%(BUTTON_ROWS)s</tbody>
    </table></div>
  </section>

  <section>
    <h2>6 knobs + 2 sliders (ADS1115 #1 and #2)</h2>
    <div class="fig">
      <svg viewBox="0 0 720 310" role="img" aria-labelledby="kn-t"><title id="kn-t">ADS1115 number 1 wired to the Pi I2C bus with four 10k potentiometers on inputs A0 to A3</title>
        <rect class="box" x="240" y="36" width="130" height="254" rx="6"/>
        <text class="big" x="305" y="60" text-anchor="middle">ADS1115 #1</text>
        <g class="mono"><text x="250" y="94">VDD</text><text x="250" y="129">GND</text><text x="250" y="164">SCL</text><text x="250" y="199">SDA</text><text x="250" y="234">ADDR</text><text x="250" y="269">ALRT</text>
          <text x="360" y="94" text-anchor="end">A0</text><text x="360" y="144" text-anchor="end">A1</text><text x="360" y="194" text-anchor="end">A2</text><text x="360" y="244" text-anchor="end">A3</text></g>
        <path class="w v33" d="M240 90 H160"/><text class="lbl c-v33" x="152" y="94" text-anchor="end">Pi pin 1 · 3.3 V</text>
        <path class="w gnd" d="M240 125 H160"/><text class="lbl" x="152" y="129" text-anchor="end">Pi pin 9 · GND</text>
        <path class="w i2c" d="M240 160 H160"/><text class="lbl c-i2c" x="152" y="164" text-anchor="end">Pi pin 5 · SCL</text>
        <path class="w i2c" d="M240 195 H160"/><text class="lbl c-i2c" x="152" y="199" text-anchor="end">Pi pin 3 · SDA</text>
        <path class="w gnd" d="M240 230 H204 V246"/><path class="sym" d="M189 246 H219 M194 252 H214 M199 258 H209"/><text class="sm" x="186" y="234" text-anchor="end">ADDR to GND = 0x48</text>
        <path class="w gnd" d="M240 265 H228"/><text class="sm" x="220" y="269" text-anchor="end">ALERT: leave empty</text>
        <g><path class="w sig" d="M370 90 H515 V78"/><path class="arrowhead" d="M515 72 L509 82 H521 Z"/><rect class="sym" x="470" y="58" width="90" height="12" rx="1"/><path class="w gnd" d="M452 64 H470"/><path class="w v33" d="M560 64 H578"/><text class="mono" x="448" y="68" text-anchor="end">GND</text><text class="mono c-v33" x="583" y="68">3.3 V</text><text class="lbl" x="628" y="68">KNOB 1</text></g>
        <g><path class="w sig" d="M370 140 H515 V128"/><path class="arrowhead" d="M515 122 L509 132 H521 Z"/><rect class="sym" x="470" y="108" width="90" height="12" rx="1"/><path class="w gnd" d="M452 114 H470"/><path class="w v33" d="M560 114 H578"/><text class="mono" x="448" y="118" text-anchor="end">GND</text><text class="mono c-v33" x="583" y="118">3.3 V</text><text class="lbl" x="628" y="118">KNOB 2</text></g>
        <g><path class="w sig" d="M370 190 H515 V178"/><path class="arrowhead" d="M515 172 L509 182 H521 Z"/><rect class="sym" x="470" y="158" width="90" height="12" rx="1"/><path class="w gnd" d="M452 164 H470"/><path class="w v33" d="M560 164 H578"/><text class="mono" x="448" y="168" text-anchor="end">GND</text><text class="mono c-v33" x="583" y="168">3.3 V</text><text class="lbl" x="628" y="168">KNOB 3</text></g>
        <g><path class="w sig" d="M370 240 H515 V228"/><path class="arrowhead" d="M515 222 L509 232 H521 Z"/><rect class="sym" x="470" y="208" width="90" height="12" rx="1"/><path class="w gnd" d="M452 214 H470"/><path class="w v33" d="M560 214 H578"/><text class="mono" x="448" y="218" text-anchor="end">GND</text><text class="mono c-v33" x="583" y="218">3.3 V</text><text class="lbl" x="628" y="218">KNOB 4</text></g>
        <text class="sm" x="470" y="276">Each knob / slider: 10 kΩ linear (B10K).</text><text class="sm" x="470" y="292">Middle lug (arrow) to the ADS input.</text>
      </svg>
    </div>
    <p class="cap">ADS1115 #2 is wired exactly the same, with its ADDR pin on 3.3 V instead of GND (= address 0x49), and carries knobs 5–6 on A0–A1 and the two sliders on A2–A3. A slide pot is just a long pot: its two end lugs go to GND and 3.3 V, the wiper to the ADS input. Both boards share the same four wires (3.3 V, GND, SCL, SDA). If a control works backwards, swap its two outer lugs or tick <em>invert</em> on the Configure tab. Jobs are defaults; change any of them on the Configure tab.</p>
    <div class="tbl"><table>
      <thead><tr><th>Control</th><th>Board</th><th>Input</th><th>Pad layout (default)</th><th>Tracks layout (default)</th></tr></thead>
      <tbody>%(ANALOG_ROWS)s</tbody>
    </table></div>
  </section>

  <section>
    <h2>Expression pedal (ADS1115 #3, optional)</h2>
    <div class="fig">
      <svg viewBox="0 0 700 250" role="img" aria-labelledby="ex-t"><title id="ex-t">ADS1115 number 3 at address 0x4A with a TRS jack: tip to A0, ring to 3.3 volts through 1k, sleeve to ground</title>
        <rect class="box" x="240" y="30" width="130" height="190" rx="6"/>
        <text class="big" x="305" y="54" text-anchor="middle">ADS1115 #3</text>
        <g class="mono"><text x="250" y="74">VDD</text><text x="250" y="104">GND</text><text x="250" y="134">SCL</text><text x="250" y="164">SDA</text><text x="250" y="194">ADDR</text><text x="360" y="104" text-anchor="end">A0</text></g>
        <path class="w v33" d="M240 70 H160"/><text class="lbl c-v33" x="152" y="74" text-anchor="end">same 3.3 V</text>
        <path class="w gnd" d="M240 100 H160"/><text class="lbl" x="152" y="104" text-anchor="end">same GND</text>
        <path class="w i2c" d="M240 130 H160"/><text class="lbl c-i2c" x="152" y="134" text-anchor="end">same SCL (shared)</text>
        <path class="w i2c" d="M240 160 H160"/><text class="lbl c-i2c" x="152" y="164" text-anchor="end">same SDA (shared)</text>
        <path class="w i2c" d="M240 190 H160"/><text class="lbl c-i2c" x="152" y="194" text-anchor="end">ADDR to SDA = 0x4A</text>
        <path class="w sig" d="M370 100 H560"/>
        <path class="w gnd" d="M420 100 V112"/><path class="sym" d="M408 112 H432 M408 118 H432"/><path class="w gnd" d="M420 118 V126"/><path class="sym" d="M405 126 H435 M410 132 H430 M415 138 H425"/>
        <text class="sm" x="442" y="124">100 nF (optional)</text>
        <text class="mono c-v33" x="446" y="154" text-anchor="end">3.3 V</text><path class="w v33" d="M450 150 H470"/>
        <path class="sym" d="M470 150 L476 141 L486 159 L496 141 L506 159 L516 141 L526 159 L530 150"/><text class="lbl" x="500" y="176" text-anchor="middle">1 kΩ</text>
        <path class="w v33" d="M530 150 H560"/>
        <path class="w gnd" d="M560 196 H524 V206"/><path class="sym" d="M509 206 H539 M514 212 H534 M519 218 H529"/>
        <rect class="box" x="560" y="62" width="122" height="156" rx="8"/>
        <text class="lbl" x="621" y="84" text-anchor="middle">¼″ TRS jack</text>
        <text class="lbl" x="576" y="104">Tip</text><text class="sm" x="612" y="104">wiper</text>
        <text class="lbl" x="576" y="154">Ring</text><text class="sm" x="612" y="154">top</text>
        <text class="lbl" x="576" y="200">Sleeve</text><text class="sm" x="630" y="200">GND</text>
      </svg>
    </div>
    <p class="cap">A third ADS1115 (ADDR wired to SDA = 0x4A) carries the expression pedal; the 1 kΩ resistor protects the Pi from the brief short when a plug goes in. Use a TRS expression pedal with the tip as the wiper (Roland EV-5, Boss FV-500L, M-Audio EX-P on its "M-Audio" setting). The driver calibrates itself: rock the pedal heel-to-toe once after power-on. Without this board, slider 1 is the swell control.</p>
  </section>

  <section>
    <h2>I2S DAC board (PCM5102A) – click and cue output</h2>
    <div class="fig">
      <svg viewBox="0 0 700 250" role="img" aria-labelledby="dac-t"><title id="dac-t">PCM5102A board: SCK to ground, BCK to GPIO 18, DIN to GPIO 21, LCK to GPIO 19, GND to ground, VIN to 5 volts; line out to the in-ear mixer</title>
        <rect class="box" x="300" y="26" width="200" height="204" rx="8"/><text class="big" x="400" y="52" text-anchor="middle">PCM5102A</text><text class="sm" x="400" y="70" text-anchor="middle">"GY-PCM5102" purple board</text>
        <g class="mono"><text x="310" y="98">SCK</text><text x="310" y="120">BCK</text><text x="310" y="142">DIN</text><text x="310" y="164">LCK</text><text x="310" y="186">GND</text><text x="310" y="208" >VIN</text></g>
        <path class="w gnd" d="M300 94 H200"/><text class="lbl" x="194" y="98" text-anchor="end">GND (any ground pin)</text>
        <path class="w dac" d="M300 116 H200"/><text class="lbl c-dac" x="194" y="120" text-anchor="end">GPIO 18 · pin 12</text>
        <path class="w dac" d="M300 138 H200"/><text class="lbl c-dac" x="194" y="142" text-anchor="end">GPIO 21 · pin 40</text>
        <path class="w dac" d="M300 160 H200"/><text class="lbl c-dac" x="194" y="164" text-anchor="end">GPIO 19 · pin 35</text>
        <path class="w gnd" d="M300 182 H200"/><text class="lbl" x="194" y="186" text-anchor="end">GND · pin 39</text>
        <path class="w v33" d="M300 204 H200"/><text class="lbl c-v33" x="194" y="208" text-anchor="end">5 V · pin 2 (this board only)</text>
        <rect class="boxsoft" x="560" y="90" width="120" height="60" rx="6"/><text class="lbl" x="620" y="114" text-anchor="middle">LINE OUT</text><text class="sm" x="620" y="134" text-anchor="middle">3.5 mm → in-ear mix</text>
        <path class="w sig" d="M500 120 H560"/>
      </svg>
    </div>
    <p class="cap">SCK must be tied to GND (the chip then makes its own clock). Set the four solder jumpers on the back of the board: <strong>1 = L, 2 = L, 3 = H, 4 = L</strong> (filter normal, de-emphasis off, un-muted, I2S format); most boards ship that way, but check. The Pi sees it as the "hifiberry-dac" sound card. Its line out goes to the monitor mixer / in-ear system, so the click and the spoken cues never reach the house. The app's Settings → Output device lists the board's two channels (outputs 3-4: click + MD voice, instrument) once it is found.</p>
  </section>

  <section>
    <h2>3.5″ SPI touch screen (optional)</h2>
    <p>A Waveshare / Kuman / "LCD35" style 480×320 screen plugs straight onto the 40-pin header (pin 1 to pin 1). Turn it on in <em>Settings → 3.5-inch touch screen</em> (choose the type: waveshare35a is the common one) and the Central Pedal restarts with it. It shows the pads and the tracks transport as a touch remote; HDMI 1 keeps showing the full app (or a big copy of the small screen, if you prefer, in Settings → Screens). It uses GPIO %(TFT_LIST)s, so those pins are reserved while it is on; the encoder is only available with the screen off.</p>
  </section>

  <section>
    <h2>Rotary encoder (optional, screen off)</h2>
    <div class="fig">
      <svg viewBox="0 0 700 200" role="img" aria-labelledby="en-t"><title id="en-t">KY-040 rotary encoder module: CLK, DT and SW to GPIO 10, 9 and 11; plus to 3.3 volts; ground to ground</title>
        <rect class="box" x="380" y="36" width="140" height="146" rx="8"/><circle class="boxsoft" cx="470" cy="109" r="30"/><circle class="sym" cx="470" cy="109" r="12"/>
        <g class="mono"><text x="388" y="64">CLK</text><text x="388" y="89">DT</text><text x="388" y="114">SW</text><text x="388" y="139">+</text><text x="388" y="164">GND</text></g>
        <path class="w enc" d="M380 60 H250"/><text class="lbl c-enc" x="244" y="64" text-anchor="end">%(ENC_A_T)s</text>
        <path class="w enc" d="M380 85 H250"/><text class="lbl c-enc" x="244" y="89" text-anchor="end">%(ENC_B_T)s</text>
        <path class="w enc" d="M380 110 H250"/><text class="lbl c-enc" x="244" y="114" text-anchor="end">%(ENC_SW_T)s</text>
        <path class="w v33" d="M380 135 H250"/><text class="lbl c-v33" x="244" y="139" text-anchor="end">3.3 V · pin 17 (never 5 V)</text>
        <path class="w gnd" d="M380 160 H250"/><text class="lbl" x="244" y="164" text-anchor="end">GND · pin 25</text>
        <text class="lbl" x="450" y="28" text-anchor="middle">KY-040 encoder</text>
        <text class="sm" x="540" y="64">Turn: key (or section)</text><text class="sm" x="540" y="84">Press: play / fade the</text><text class="sm" x="540" y="100">selected pad (play/pause)</text><text class="sm" x="540" y="120">Hold: Perform / Edit</text>
      </svg>
    </div>
    <p class="cap">The encoder shares pins with the 3.5″ screen, so use one or the other, or move the encoder to three spare pins with the Learn tab. A bare encoder works too: outer pins to %(ENC_A)s and %(ENC_B)s, middle pin to GND, push-switch between %(ENC_SW)s and GND.</p>
  </section>

  <section>
    <h2>Parts list</h2>
    <div class="cols">
      <div><h3>Core</h3><ul class="bom">
        <li>Raspberry Pi 4 (2 GB or more) + official 5 V 3 A USB-C supply</li>
        <li>microSD card, 16 GB or larger (Class 10 / A1)</li>
        <li>HDMI touchscreen for HDMI 1 (any size); a projector or TV on HDMI 2 for lyrics</li>
        <li>PCM5102A I2S DAC board (the purple "GY-PCM5102") for the click / cue output</li>
        <li>Optional: 3.5″ SPI touch screen (waveshare35a type) and a 40-pin ribbon + breakout board</li>
        <li>Optional: USB MIDI interface (lights + general MIDI out), USB foot pedals</li>
        <li>Instrument tab: any class-compliant USB audio interface with a ¼″ instrument input (guitar) and / or a USB MIDI keyboard (keys)</li>
      </ul></div>
      <div><h3>Control surface</h3><ul class="bom">
        <li>12 × momentary footswitches or buttons (SPST, normally open)</li>
        <li>6 × 10 kΩ linear pots (B10K) + knobs, 2 × 10 kΩ linear slide pots</li>
        <li>2 × ADS1115 16-bit ADC boards (+ a third for the expression pedal)</li>
        <li>Optional: ¼″ TRS panel jack, 1 kΩ resistor, 100 nF capacitor (expression pedal)</li>
        <li>Optional: KY-040 rotary encoder; LEDs + 330 Ω resistors for lit buttons</li>
        <li>Hook-up wire (22–26 AWG), female Dupont jumpers, an enclosure</li>
      </ul></div>
    </div>
  </section>

  <section>
    <h2>Guitar, keys and other USB gear</h2>
    <p>The Instrument tab needs no wiring at all: a guitar goes into the <b>¼″ instrument / Hi-Z input</b> of any class-compliant USB audio interface plugged into the Pi (Focusrite Scarlett, Behringer UMC, PreSonus AudioBox, M-Audio, Zoom… anything that needs no driver on a Mac works here), and a keyboard goes into a USB port directly (USB MIDI) or through a USB-MIDI cable. The Pi lists what it finds under Instrument → Input / MIDI keyboard; "Auto" picks the first one. The instrument's sound leaves on output 4 (Settings → Output routing), which can be the interface's own output 1 - so one interface can be both the guitar input and the stage output.</p>
    <ul>
      <li><b>Latency</b>: 128 samples at 48 kHz (under 3 ms in the Pi) plus the interface's own; keep the interface on the Pi's blue USB 3 ports and use a powered hub if several USB devices share it.</li>
      <li><b>Acoustic guitar</b> with a piezo pickup: use the interface's instrument (Hi-Z) switch; the Instrument tab's <em>Auto</em> button sets the input gain and noise gate from what it hears.</li>
      <li><b>Keys sounds</b>: free SoundFonts are installed (pianos, electric pianos, organs, pads, strings, leads, bells). Add your own <code>.sf2</code> files or a folder of WAV samples named by note (<code>C4.wav</code>, <code>F#3.wav</code>…) from a USB stick (Instrument → Sounds → Add sounds…), or send an <code>.sf2</code> from a phone or computer with the Upload page.</li>
      <li><b>Lights</b>: a USB MIDI interface (or the Central Control app on a laptop over Wi-Fi) carries the hits, section notes and MIDI clock to Lightkey, QLC+ or a console.</li>
    </ul>
  </section>

  <section>
    <h2>Power-on checks</h2>
    <p>Do these over SSH (<code>ssh pi@padpedal.local</code>) after the first boot with the hardware connected, or just open the Learn tab: it shows which board inputs answer.</p>
    <div class="cmds">
      <div class="cmd"><pre id="c1">i2cdetect -y 1</pre><button class="copy" data-copy="c1" type="button">Copy</button><p>You should see <code>48</code> and <code>49</code> (and <code>4a</code> with the expression board). Missing one? Check that board's SDA/SCL wires and its ADDR pin.</p></div>
      <div class="cmd"><pre id="c2">aplay -l</pre><button class="copy" data-copy="c2" type="button">Copy</button><p>Lists the sound cards: <code>Headphones</code> (the jack), <code>sndrpihifiberry</code> (the DAC board) and any USB interface. <code>arecord -l</code> shows the interface's inputs; <code>aconnect -l</code> the MIDI keyboard.</p></div>
      <div class="cmd"><pre id="c3">journalctl -u pad-pedal-driver -f</pre><button class="copy" data-copy="c3" type="button">Copy</button><p>Live log. Every button press, knob move, learned pin and companion device prints a line. Ctrl+C stops watching.</p></div>
    </div>
  </section>
</div>
""" % {"HEADER_SVG": header_svg, "BUTTON_ROWS": button_rows, "ANALOG_ROWS": analog_rows, "TFT_LIST": ", ".join(str(p) for p in TFT_PINS),
       "ENC_A_T": "GPIO %d · pin %d" % (enc["gpio_a"], BCM_TO_PIN[enc["gpio_a"]]), "ENC_B_T": "GPIO %d · pin %d" % (enc["gpio_b"], BCM_TO_PIN[enc["gpio_b"]]), "ENC_SW_T": "GPIO %d · pin %d" % (enc["gpio_button"], BCM_TO_PIN[enc["gpio_button"]]),
       "ENC_A": gp(enc["gpio_a"]), "ENC_B": gp(enc["gpio_b"]), "ENC_SW": gp(enc["gpio_button"])}
open(out, "w", encoding="utf-8").write(head + style + body + script)
print("wrote", out)
