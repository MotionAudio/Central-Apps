# Central Pedal main board — what goes to what

The main board stacks on the Raspberry Pi 4 and carries everything physical: 8 footswitches, 6 push-knobs,
2 faders, an external footswitch jack, instrument input, MIDI in/out, 4 line outs + headphones, footswitch
lights, a fan, a front power button, USB-C charging and a 2S battery. The full hardware spec (parts, power,
fab settings) is the "Central Pedal Main Board — Design & Manufacturing Spec" doc.

Turn it on in **Settings → Output routing → "Central Pedal main board fitted"**, then restart. That writes the
board's pin map into `hardware.json` (driver: `CENTRAL_BOARD_V1` in `pedal-driver.py`) and its lines into
`config.txt` (`pad-pedal-system board central-main-v1`).

**Every control is programmable.** Configure tab: any action per control, a second action on hold for every
footswitch, knob click and external switch, and for every knob and fader its own range ("from __ to __ %") and
curve (linear, slow start, fast start, S-curve). The faders are expression A and B. Learn tab: any control can be
re-learned to another pin.

## Raspberry Pi header

| Pin | GPIO | Goes to |
| --- | --- | --- |
| 2, 4 | — | 5.1 V from the board (back-power — never plug the Pi's own USB-C in too) |
| 6, 9, 14, 20, 25, 30, 34, 39 | — | Ground |
| 1, 17 | — | Pi 3.3 V (logic pull-ups only) |
| 27, 28 | 0 / 1 | HAT ID EEPROM |
| 3, 5 | 2 / 3 | I2C: INA226 battery 0x40, PCA9685 lights 0x41, MCP23017 expander 0x20 |
| 8 | 14 | MIDI OUT (UART0 TX) |
| 10 | 15 | MIDI IN (UART0 RX, via 6N138) |
| 12 | 18 | I2S BCK (from the PCM1808 — it is the clock master) |
| 35 | 19 | I2S LRCK (from the PCM1808) |
| 38 | 20 | I2S data in ← PCM1808 (instrument input) |
| 40 | 21 | I2S data out → PCM5102A (outputs 3–4) |
| 19, 21, 23, 24 | 10 / 9 / 11 / 8 | SPI0 → MCP3208 (knobs + faders) |
| 29 | 5 | Footswitch 1 |
| 31 | 6 | Footswitch 2 |
| 32 | 12 | Footswitch 3 |
| 33 | 13 | Footswitch 4 |
| 36 | 16 | Footswitch 5 |
| 11 | 17 | Footswitch 6 |
| 15 | 22 | Footswitch 7 |
| 16 | 23 | Footswitch 8 |
| 7 | 4 | Power button controller INT (pressed with the pedal on → clean shutdown) |
| 18 | 24 | Power controller KILL (`gpio-poweroff`: cuts power after shutdown) |
| 22 | 25 | DAC 1 mute (PCM5102A XSMT) |
| 13 | 27 | Status LED (on while the driver runs) |
| 37 | 26 | Fan on/off (`gpio-fan`, on at 140 °F) |
| 26 | 7 | Instrument jack plug switch |

## MCP3208 (SPI0, CE0) — knobs and faders

| Channel | Control | Input id | Default job |
| --- | --- | --- | --- |
| 0 | Left knob 1 | k1 | Selected pad's level |
| 1 | Left knob 2 | k2 | Tone (darker ↔ brighter) |
| 2 | Left knob 3 | k3 | Reverb amount |
| 3 | Right knob 1 | k4 | Tracks level |
| 4 | Right knob 2 | k5 | Click level |
| 5 | Right knob 3 | k6 | Instrument output level |
| 6 | Left fader | s1 | Expression A: pad swell |
| 7 | Right fader | s2 | Expression B: instrument expression (volume / wah) |

## MCP23017 (I2C 0x20) — knob clicks and external footswitches

| Pin | Control | Input id | Default job |
| --- | --- | --- | --- |
| 0 | Left knob 1 push | k1c | Select next pad |
| 1 | Left knob 2 push | k2c | Key up (hold: key down) |
| 2 | Left knob 3 push | k3c | Freeze on / off |
| 3 | Right knob 1 push | k4c | Repeat section on / off |
| 4 | Right knob 2 push | k5c | Count-in off / 1 / 2 bars |
| 5 | Right knob 3 push | k6c | Tuner on / off |
| 6 | External footswitch jack, tip | x1 | Next section |
| 7 | External footswitch jack, ring | x2 | Previous section |
| 8 | Charger status (read only) | — | Shows "charging" in Settings |
| 9–15 | spare | — | — |

## Footswitches (GPIO) and their lights (PCA9685, I2C 0x41)

| Footswitch | GPIO | Light channel | Default job | Hold |
| --- | --- | --- | --- | --- |
| 1 | 5 | 0 | Play (tracks + pad) | Stop everything |
| 2 | 6 | 1 | Next section | — |
| 3 | 12 | 2 | Previous section | Restart section |
| 4 | 13 | 3 | Play / fade the selected pad | Layer mode |
| 5 | 16 | 4 | Next song | Next song and play |
| 6 | 17 | 5 | Previous song | — |
| 7 | 22 | 6 | Tap tempo | Freeze |
| 8 | 23 | 7 | Click on / off | Voice cues on / off |

Each footswitch's 4-pin JST-XH: 1 switch, 2 ground, 3 LED + (5.1 V via 330 Ω), 4 LED − (PCA9685 channel).
A light follows its footswitch's job: lit when on, a faint glow when off, blinking on the beat for tap tempo.

## Audio

| Outputs | Where from | Linux sees |
| --- | --- | --- |
| 1–2 | Pi's own 3.5 mm jack | `Headphones` card |
| 3–4 | PCM5102A on I2S | `CentralPedal` card (`central-pedal-audio` overlay) |
| 5–6 + headphone jack | PCM2706C USB DAC (pigtail to a Pi USB port) → headphone amp with its own volume knob | USB audio card |
| Instrument in | 1/4" jack → OPA1678 → PCM1808 on I2S | `CentralPedal` card, capture |

Settings → Output routing sends any bus (tracks, pads, click + cues, instrument, looper) to any output or pair.
Whatever goes to 5–6 is also what the headphone jack plays.

## config.txt lines the board needs

```
dtparam=i2c_arm=on
dtparam=spi=on
enable_uart=1
dtoverlay=central-pedal-audio
dtoverlay=midi-uart0
dtoverlay=gpio-fan,gpiopin=26,temp=60000
dtoverlay=gpio-poweroff,gpiopin=24,active_low=1
```

The serial console is taken off UART0 (the MIDI jacks need it); debug over SSH or HDMI. `setup-pi.sh` builds
`overlays/central-pedal-audio-overlay.dts` into `/boot/firmware/overlays/central-pedal-audio.dtbo`.

## Checks

`python3 test_main_board.py` — ADC reads and scaling, footswitch lights, battery, MIDI parsing and the pin map,
against simulated chips. On a real board, follow the bring-up checklist in the spec doc.

**Rev A note:** the audio overlay uses the ADAU7002 driver as a stand-in for the PCM1808 (it has no driver of its
own) with the Pi as I2S slave. Confirm on the first boards with `arecord -l` / `aplay -l` before shipping.
