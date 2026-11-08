# Central Pedal main board - rev B

390 x 278 mm, 4 layers (signal / GND / 5V1 + 5V2 / signal), 1.6 mm, ENIG, black mask, white silk. The whole pedal on
one board: 10 footswitches with lights, 6 click-knobs (encoders), 2 faders, 18 label screens, the 7" Raspberry Pi
Touch Display 2 (ribbon), the 11.9" bar touch screen (HDMI 1 + USB), 6 mono 1/4" outputs, 2 instrument inputs,
2 external footswitch jacks, MIDI in / out, headphones, USB-C PD charging of a 2S battery, fan, power button. The
Raspberry Pi 4 hangs behind the board, component side toward it, on ~20 mm M2.5 standoffs - a 2x20 extra-long
stacking header on its GPIO pins reaches the board's socket (the Pi's USB / Ethernet block is 16 mm tall); a top
plate sits 15.5 mm above the board.

Wiring and pin map: `../../docs/MAIN-BOARD.md`. The layout that was approved: `layout-plan.png`.

## Ordering (PCBWay)

Everything PCBWay needs is in `fab/` - read `fab/PCBWAY-ORDER.md` first:

| File | What |
| --- | --- |
| `central-pedal-main-board-gerbers.zip` | Gerbers + Excellon drills + drill map (board edge included) |
| `central-pedal-main-board-bom-pcbway.csv` | BOM in PCBWay's layout: LCSC number + manufacturer part number for every part, sourcing notes |
| `central-pedal-main-board-bom.csv` | the same BOM in JLC's layout |
| `central-pedal-main-board-cpl.csv` | Pick-and-place, both sides |
| `central-pedal-main-board-top.pdf` / `-bottom.pdf` | Assembly drawings |
| `*-front.png`, `*-back.png`, `*-in1.png`, `*-in2.png` | Renders of each copper layer |
| `central-pedal-main-board-netlist.txt` | Every net and the pins on it, for review |
| `design-notes.txt` | Every design assumption, numbered |
| `not-fitted.txt` | DNP parts |
| `drc-report.txt` | KiCad DRC of this exact board |
| `eeprom/` | HAT EEPROM settings (optional - the software finds the board by its chips too) |
| `*.kicad_pcb`, `*.kicad_pro`, `custom.pretty/` | The KiCad 7 project |

Parts LCSC does not stock - PCBWay sources them by description (the BOM's Notes column says what fits): the
10 PCB-pin soft-touch footswitches (M12, two pins 6.3-6.9 mm apart - the slotted holes take Taiwan Alpha SF12020F,
Tayda SF13P-0102-23.5R-M12, Love My Switches PCB-mount soft touch) and the 18 0.91" SSD1306 OLED modules (4-pin
I2C; both common pin orders fit with the 0R links). Everything else - including the Neutrik jacks, the Bourns
encoders and faders, the JST headers and the Pi header - has an LCSC number and was in stock when this was made.

## Regenerating

`design.py` is the whole design (every part, pin and net). On a machine with KiCad 7 (pcbnew Python + kicad-cli),
Java 17+ and Freerouting 1.9 (`/home/claude/tools/freerouting.jar` in the scripts), with an X display for
Freerouting (`Xvfb :99` is started by `route.py`):

```
python3 build.py                     # place parts, planes, outline, power trunks -> out/central-pedal-main-board.kicad_pcb
python3 fanout.py --pre              # plane-stub vias before routing (-> *-prefan.kicad_pcb + prefan.json)
python3 route.py 14 out/central-pedal-main-board-prefan.kicad_pcb   # Freerouting (pre-routes fixed), SES import, GND pours, DRC
python3 pass2.py                     # rip what crossed a hole / the slot, plane stubs in the wrong In2 band -> out/pass2-src.kicad_pcb
python3 route.py 10 out/pass2-src.kicad_pcb                          # route what is open again
python3 cleanup.py && python3 maze.py                                # tidy, then the grid router for the last connections
python3 pass3.py && python3 route.py 20 out/pass3-src.kicad_pcb --rippable   # optional: let Freerouting rip up and redo the signal routes
python3 fanout.py --stitch           # widen power tracks, GND stitching vias, final DRC
python3 export.py                    # -> out/fab/
```

Things learned on this board, built into the scripts: the pre-routes go to Freerouting as *fixed wires*, not as
keep-outs (oversized keep-outs walled in the pins next to them and most connections failed); holes without copper
and the ribbon slot get keep-outs (Freerouting cannot see them); the 5V1 plane polygon is cut where the 5V2 band
starts, because KiCad exports zone outlines, not fills; a wide trunk or a power via is never ripped by the helper
scripts (`trunkfix.py` puts any missing one back); `maze.py --rip REF PAD` clears the strip in front of a boxed-in
pin. `fixzones.py` holds the In2 plane decision (5V1 base + a 5V2 region from y = 156 down); `build.py` makes them
that way already. `jlc.py KEYWORD` looks a part up in the JLC/LCSC library (stock, price, LCSC number).
