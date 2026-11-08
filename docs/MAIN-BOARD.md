# Central Pedal main board — what goes to what

The main board carries everything physical. **Rev B** (11.0, the current board, 390 × 278 mm) is the whole pedal on
one PCB: 10 footswitches with lights, 6 click-knobs, 2 faders, 18 small label screens (one above every control),
the 7" touch screen (Raspberry Pi Touch Display 2 on the ribbon connector), the 11.9" bar touch screen above the
footswitches (HDMI 1 + USB), 6 mono 1/4" outputs, 2 instrument inputs, 2 external footswitch jacks, MIDI in/out,
headphones, USB-C charging of a 2S battery, a fan and a power button. The Raspberry Pi 4 hangs behind the board,
component side toward it, on ~20 mm M2.5 standoffs: a 2x20 extra-long stacking header on the Pi's GPIO pins reaches
the board's 2x20 socket (the Pi's USB / Ethernet block is 16 mm tall, so it cannot sit closer). Seen from the
front, the Pi is not mirrored: header along its top edge, pin 1 at the left end, USB / Ethernet at the right. **Rev A** (10.6, 270 × 160 mm: 8 footswitches, 6 push-pots, 4 outputs) stays supported.

The board lives in `hardware/main-board/` (rev A) and `hardware/main-board-rev-b/` (rev B): the KiCad 7 project,
the generator that made it (`design.py` = every part, pin and net; `build.py` / `route.py` / `export.py` = board,
autoroute, fab files) and `fab/` with the Gerber zip, BOM (LCSC + manufacturer numbers), pick-and-place, DRC report
and renders. The full spec (parts, power, fab settings, assumptions) is the "Central Pedal Main Board — Design &
Manufacturing Spec" doc.

**The software finds the board by itself.** At every start the driver reads the board's HAT EEPROM
(`/proc/device-tree/hat/product` = "Central Pedal Main Board rev B") or, with a blank EEPROM, checks that the chips
only rev B has all answer on I2C (a label-screen mux at 0x70, expander 2 at 0x21, the BQ25798 charger at 0x6b).
Found → its pin map goes into `hardware.json` (`CENTRAL_BOARD_V2` in `pedal-driver.py`) and its lines into
`config.txt` (`pad-pedal-system board central-main-v2`; they take effect after one restart - Settings says so).
Gone → back to the hand-wired pins. **Settings → Output routing → Control board** can also pick a board by hand
(rev B / rev A / none / found by itself); a hand pick always wins. Without any board the software runs exactly as
before: a 3.5" screen, hand-wired buttons, knobs on ADS1115s.

**Every control is programmable.** Configure tab: any action per control, a second action on hold for every
footswitch, knob click and external switch, and for every knob and fader its own range ("from __ to __ %") and
curve. Learn tab: turn a knob, press a footswitch or an external switch to re-learn which control is which. The
label screen above each control shows the job it has now (and the pad / song / loop it points at, and its level
when it moves) - `js/labels.js` works the words out, the driver draws them.

## Rev B — Raspberry Pi header

| Pin | GPIO | Goes to |
| --- | --- | --- |
| 2, 4 | — | 5V1 from the board (back-power — never plug the Pi's own USB-C in too) |
| 6, 9, 14, 20, 25, 30, 34, 39 | — | Ground |
| 1, 17 | — | Pi 3.3 V (unused: the board has its own 3V3) |
| 27, 28 | 0 / 1 | HAT ID EEPROM (CAT24C32, write-protect jumper JP_WP) |
| 3, 5 | 2 / 3 | I2C (400 kHz): see the I2C map below |
| 8 | 14 | MIDI OUT (UART0 TX, 33 Ω / 10 Ω) |
| 10 | 15 | MIDI IN (UART0 RX, via 6N138S) |
| 12 | 18 | I2S BCK (from the PCM1808 — it is the clock master, 12.288 MHz oscillator) |
| 35 | 19 | I2S LRCK (from the PCM1808) |
| 38 | 20 | I2S data in ← PCM1808 (instrument inputs A = L, B = R) |
| 40 | 21 | I2S data out → PCM5102A DAC 1 (outputs 1–2) |
| 32 | 12 | Headphones left: the Pi's own PWM audio (`dtoverlay=audremap,pins_12_13`) → RC → TPA6130A2 |
| 33 | 13 | Headphones right |
| 29, 31, 26, 24, 21, 19, 23 | 5, 6, 7, 8, 9, 10, 11 | Footswitches 1–7 |
| 36, 11, 15 | 16, 17, 22 | Footswitches 8, 9, 10 |
| 7 | 4 | Power button controller INT (LTC2954-1: pressed with the pedal on → clean shutdown) |
| 18 | 24 | Power controller KILL (`gpio-poweroff`: cuts power after shutdown; 4.7k pull-up) |
| 16 | 23 | Expander 1 INT (knobs) |
| 22 | 25 | Expander 2 INT (knob pushes, external switches, plug detects, charger lines) |
| 37 | 26 | Fan on/off (`gpio-fan`, on at 60 °C / 140 °F) |
| 13 | 27 | DAC 1 mute (PCM5102A XSMT) |

Footswitch inputs: 100 Ω series + 100 nF + PESD5V0S1UB at the pin, pull-up inside the Pi. SPI is off (nothing
uses it); GPIO 12/13 are the headphone audio, so the Learn tab keeps them reserved.

## Rev B — I2C map (bus 1, 400 kHz)

| Address | Chip | Job |
| --- | --- | --- |
| 0x20 | MCP23017 expander 1 | knob encoders: A/B of knobs 1–6 on pins 0–11, the push of knobs 1–4 on pins 12–15 |
| 0x21 | MCP23017 expander 2 | pins 0–1 push of knobs 5–6 · 2–5 external footswitch A tip / ring, B tip / ring · 6–7 instrument jack A / B plug switch · 8 charger STAT · 9 USB-C PD fault · 10 charger INT · 11–15 spare (no test pads on rev B — bring them out on the next spin if needed) |
| 0x41 | PCA9685 | channels 0–9 footswitch lights (open-drain sinks, 5 mm yellow LEDs from 5V2 via 330 Ω) · 10 status LED · 11 headphone amp shutdown (HP_SD) |
| 0x45 | INA226 | battery volts / amps (5 mΩ shunt) |
| 0x48 | ADS1115 | AIN0 left fader (s1), AIN1 right fader (s2), AIN2 USB input volts (÷7.67) |
| 0x50 | CAT24C32 | HAT EEPROM (on the Pi's ID pins, not bus 1) |
| 0x60 | TPA6130A2 | headphone amp, volume in software (Settings → Output routing → Headphones) |
| 0x6b | BQ25798 | 2S buck-boost charger with power path: 8.4 V, 2 A charge, 3 A in (set by the driver; the PROG resistor gives the same) |
| 0x70, 0x71, 0x72 | TCA9548A ×3 | label-screen muxes: 0x70 ch 0–7 = footswitches 1–8 · 0x71 ch 0–1 = footswitches 9–10, ch 2–7 = knobs 1–6 · 0x72 ch 0–1 = faders A, B. Every channel has one 0.91" 128×32 SSD1306 OLED at 0x3c |

Knobs are Bourns PEC11R-4220F-S0024 encoders (24 detents, push). One detent = one step; a knob set to a level job
(volume, tone, a level) keeps its own position and moves it 2 % per detent (6 % when turned quickly). A knob that
turns the wrong way gets `"reverse": true` in its `expander_enc`.

## Rev B — controls and their default jobs

| Control | Input id | Where | Default job | Hold |
| --- | --- | --- | --- | --- |
| Footswitch 1 | b1 | GPIO 5 · light ch 0 | Play (tracks + pad) | Stop everything |
| Footswitch 2 | b2 | GPIO 6 · ch 1 | Previous section | Restart section |
| Footswitch 3 | b3 | GPIO 7 · ch 2 | Next section | — |
| Footswitch 4 | b4 | GPIO 8 · ch 3 | Play / fade the selected pad | Layer mode |
| Footswitch 5 | b5 | GPIO 9 · ch 4 | Select next pad | — |
| Footswitch 6 | b6 | GPIO 10 · ch 5 | Looper pedal (tap rec / play / overdub) | — |
| Footswitch 7 | b7 | GPIO 11 · ch 6 | Tap tempo | Freeze |
| Footswitch 8 | b8 | GPIO 16 · ch 7 | Click on / off | Voice cues on / off |
| Footswitch 9 (above 1) | b9 | GPIO 17 · ch 8 | Previous song | — |
| Footswitch 10 (above 8) | b10 | GPIO 22 · ch 9 | Next song | Next song and play |
| Left knob 1 / push | k1 / k1c | 0x20 pins 0–1 / 12 | Master volume / Select next pad | — |
| Left knob 2 / push | k2 / k2c | 0x20 pins 2–3 / 13 | Tone / Key up | Key down |
| Left knob 3 / push | k3 / k3c | 0x20 pins 4–5 / 14 | Reverb / Freeze | — |
| Right knob 1 / push | k4 / k4c | 0x20 pins 6–7 / 15 | Tracks level / Repeat section | — |
| Right knob 2 / push | k5 / k5c | 0x20 pins 8–9 / 0x21 pin 0 | Click level / Count-in | — |
| Right knob 3 / push | k6 / k6c | 0x20 pins 10–11 / 0x21 pin 1 | Instrument level / Tuner | — |
| Left fader | s1 | ADS1115 A0 | Expression A: pad swell | — |
| Right fader | s2 | ADS1115 A1 | Expression B: instrument expression | — |
| External footswitch A tip / ring | x1 / x2 | 0x21 pins 2 / 3 | Next section / Previous section | — |
| External footswitch B tip / ring | x3 / x4 | 0x21 pins 4 / 5 | Looper pedal / Stop everything | — |

## Rev B — audio

| Outputs | Where from | Linux sees |
| --- | --- | --- |
| 1–2 | PCM5102A DAC 1 on I2S | `CentralPedal` card (`central-pedal-audio` overlay), `padpedal_dac` |
| 3–4 | PCM5102A DAC 2 ← PCM2706C USB bridge on hub port 1 | USB card "Burr-Brown from TI USB Audio DAC" (path …-1.1) |
| 5–6 | PCM5102A DAC 3 ← PCM2706C USB bridge on hub port 2 | the second "USB Audio DAC" (path …-1.2) |
| Headphones | the Pi's own audio on GPIO 12/13 → TPA6130A2 | `Headphones` card, `padpedal_jack` |
| Instrument A / B in | 1/4" jack → OPA1678 (×4, or 0 dB with the solder jumper) → PCM1808 L / R | `CentralPedal` card, capture |

The SL2.1A hub (upstream: the board's USB header to a Pi USB port) has the two bridges on ports 1 and 2, the back
USB-A jack on port 3 and the bar screen's touch on port 4. `pad-pedal-audio-config` makes one 8-channel output:
1–6 the board's outputs (each slot keeps its place even when a card is missing), 7–8 the headphones. **Settings →
Output routing** sends any bus (tracks, pads, click + cues, instrument, looper) to any output or pair, and the
**Headphones** row says what the headphones hear: a mix of everything, a copy of 1–2 / 3–4 / 5–6, the click only, or
nothing - plus the amp's volume. (A USB interface of your own has no room: 8 channels is the most.)

## Rev B — screens

| Screen | Where | Shows |
| --- | --- | --- |
| 7" Raspberry Pi Touch Display 2 (720×1280, turned to landscape) | the board's ribbon connector | the app |
| 11.9" bar touch screen (320×1480, turned to landscape) | HDMI 1 + USB (hub port 4) | the strip: what's playing, and pages to swipe through - sounds, songs, loops, keys sounds, scenes (`strip.html`) |
| Projector / monitor | HDMI 2 | lyrics (or charts, stage display - Settings → Screens) |
| 18 × 0.91" OLED (128×32, not touch) | above every footswitch, knob and fader | the control's job, and its level while it moves |

**Settings → Output routing → Screen output** moves the app: the board's 7" screen (default), HDMI 1, HDMI 2, or
the 7" and HDMI 1 together (mirrored). The app looks the same wherever it shows; when it goes to HDMI, the 7"
screen shows the strip. **Bar screen** picks what the bar shows (the strip, lyrics, charts, stage display,
nothing). `pad-pedal-session` lays the three screens out (`displays.json`: `main`, `strip`, `rotate1`, `rotate2`).

## Rev B — config.txt lines the board needs

```
dtparam=i2c_arm=on
dtparam=i2c_arm_baudrate=400000
dtparam=audio=on
enable_uart=1
dtoverlay=audremap,pins_12_13
dtoverlay=central-pedal-audio
dtoverlay=midi-uart0
dtoverlay=gpio-fan,gpiopin=26,temp=60000
dtoverlay=gpio-poweroff,gpiopin=24,active_low=1
dtoverlay=vc4-kms-dsi-ili9881-7inch,rotation=90     (the 7" screen: Settings → Touch screen "dsi-rpi2-7")
```

`dtparam=spi=on` is removed (rev B has no SPI chip). The serial console is taken off UART0 (the MIDI jacks need it).

## Rev B — power

USB-C (HUSB238A asks the charger for 15 V / 3 A; 5 V-only adapters still work, slower) → BQ25798 buck-boost
charger with NVDC power path (the pedal runs from USB and charges at the same time; with no USB it runs from the
battery) → VSYS → three TPS565208 bucks: 5V1 (Pi + logic), 5V2 (screens, USB-A, lights, fan), 3V3 → TLV75533 3V3A
and a bead-filtered 5VA for the audio. Battery: 2S Li-ion on a JST-VH → 7.5 A PTC → AO4407A reverse-polarity PFET →
INA226 5 mΩ shunt → charger BAT pin. Power button: LTC2954-1 (tap = INT to GPIO 4 → clean shutdown; the Pi then
pulls KILL low to cut power; hold ~7 s = forced off).

## Checks

`python3 test_main_board_v2.py` — the rev B preset, detection, the quadrature decoder, both expanders (a knob
turned, pushed, an external footswitch, plug detect, charger lines), the BQ25798 set-up and status, the TPA6130A2
volume, the label screens and the driver with all of it, against simulated chips. `python3 test_main_board.py` — rev A.
`CC_SIM_BOARD=v2 python3 pedal-driver.py --simulate DIR` runs the whole driver against the simulated rev B board.

**Rev B notes (check on the first boards):**
- The BQ25798 register addresses in `BQ25798` follow the datasheet's register map; confirm the part info read
  (REG48 = 0x19 for a BQ25798) and the charge current on the first board with a meter.
- The encoder direction: a knob that turns the wrong way gets `"reverse": true` (Configure → the knob → wiring).
- The two USB DACs are told apart by hub port (…-1.1 = outputs 3–4, …-1.2 = 5–6). If the hub's upstream cable goes
  to a different Pi USB port the path prefix changes but the last number (the hub port) does not.
- The audio overlay uses the ADAU7002 driver as a stand-in for the PCM1808 (it has no driver of its own) with the
  Pi as I2S slave; confirm with `arecord -l` / `aplay -l`.
- The label screens come in two pin orders; the 0R links "A" (fitted) are for GND-VCC-SCL-SDA modules, move them to
  "B" for VCC-GND-SCL-SDA ones. A screen that doesn't answer is skipped (Settings shows "label screens n of 18").

---

## Rev A (10.6) — kept for the boards already built

8 footswitches on GPIO 5, 6, 12, 13, 16, 17, 22, 23 (lights on the PCA9685 0x41 channels 0–7), 6 push-pots and 2
faders on an MCP3208 (SPI0 CE0: knobs ch 0–5, faders 6–7), the pot clicks and the external footswitch jack on an
MCP23017 at 0x20 (pins 0–5 clicks, 6–7 tip / ring, 8 charger status), INA226 at 0x45, instrument jack plug switch on
GPIO 7, DAC 1 mute GPIO 25, status LED GPIO 27, MIDI on UART0, I2S as rev B. Audio: 1–2 the Pi's jack, 3–4 the
board's PCM5102A, 5–6 + headphones its PCM2706C USB DAC (headphone amp with its own volume knob). config.txt:
`dtparam=spi=on` plus the same overlays as rev B without `audremap`. Power: TPS54560 5.1 V buck, IP2368 charger -
the parts rev B replaced (their datasheet checks are listed in `hardware/main-board/README.md`).
