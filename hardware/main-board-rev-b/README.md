# Central Pedal main board - rev B

390 x 278 mm, 4 layers (signal / GND / 5V1 + 5V2 / signal), 1.6 mm, ENIG, black mask, white silk. The whole pedal on
one board: 10 footswitches with lights, 6 click-knobs (encoders), 2 faders, 18 label screens, the 7" Raspberry Pi
Touch Display 2 (ribbon), the 11.9" bar touch screen (HDMI 1 + USB), 6 mono 1/4" outputs, 2 instrument inputs,
2 external footswitch jacks, MIDI in / out, headphones, USB-C PD charging of a 2S battery, fan, power button. The
Raspberry Pi 4 sits under the board on the enclosure floor, component side toward it, on ~20 mm M2.5 standoffs - a
2x20 extra-long stacking header on its GPIO pins reaches the board's socket (the Pi's USB / Ethernet block is 16 mm
tall); a top plate sits 16 mm above the board.

The 7" Touch Display 2 and the 11.9" bar screen screw onto the front of the board (into their own stand-offs, screws
from the back); two slots in the board take the bar screen's HDMI and touch-USB plug bodies. The 40 mm fan and the Pi
mount in the enclosure base. You fit all of these yourself - the order and the parts are in `enclosure/README.md` and
`enclosure/central-pedal-blueprints.pdf`.

Rev B.3 (cost-down): HOOYA PJ-611E 1/4" jacks (3/8in bushing + nut through the back panel, $0.54 instead of $2.82),
generic EC11 encoders with a 30 mm shaft, onsemi ESD5Z5.0T1G ESD diodes, and SMT on the top side only (the bar-screen
ESD part moved to the front).

Wiring and pin map: `../../docs/MAIN-BOARD.md`. The layout that was approved: `layout-plan.png`.

## Ordering (PCBWay)

Everything PCBWay needs is in `fab/` - read `fab/PCBWAY-ORDER.md` first:

| File | What |
| --- | --- |
| `central-pedal-main-board-gerbers.zip` | Gerbers + Excellon drills + drill map (board edge included) |
| `central-pedal-main-board-bom-pcbway.csv` | BOM in PCBWay's layout: LCSC number + manufacturer part number for every part, sourcing notes; the last lines (type BOX BUILD) are the screens, fan, leads and hardware the assembler fits after soldering |
| `central-pedal-main-board-bom.csv` | the same BOM in JLC's layout |
| `central-pedal-main-board-cpl.csv` | Pick-and-place, both sides |
| `central-pedal-main-board-top.pdf` / `-bottom.pdf` | Assembly drawings (the silkscreen outlines show where the screens, the plugs and the fan go) |
| `board-with-screens.png`, `board-back-with-fan.png` | What the assembled board looks like, front and back |
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
I2C; both common pin orders fit with the 0R links) and the 6 EC11 encoders (30 mm D shaft, push switch, 20 detents /
20 pulses; the Bourns PEC11R-4230F-S0024 fits too). Everything else - including the jacks, the faders, the JST headers
and the Pi header - has an LCSC number and was in stock when this was made.

## Enclosure

A 3D-printed box for this board and the Pi: `enclosure/` (the blueprint PDF, STEP of the whole assembly, printable
tiles as STEP + STL, and the CadQuery script that generates them from the routed board). The Pi screws into threaded
inserts in the base floor and its Ethernet, two USB 3.0 and second HDMI come out on the right side panel through
panel-mount leads; the fan screws to the floor. The top plate sits 16 mm above the board with rounded
edges and chamfered windows; the footswitches come through it and take their nuts on top, the knobs come through plain
Ø 8 holes (the BOM's encoders have 30 mm shafts for this), the fader caps run in shallow recessed trays, and the two
touch screens (on the board, meeting the plate through foam gaskets) and 18 label screens sit behind bezelled windows. Read `enclosure/README.md` - it lists the dimensions
the model assumes that should be checked against the parts you actually buy, and the hardware (inserts, screws, knobs,
caps) to buy with it. `fab/PCBWAY-ORDER.md` has the PCBWay order settings step by step and how the parts are confirmed
with them.

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
python3 screens.py && python3 cleanup.py out/pass6-src.kicad_pcb --no-helpers && python3 route.py 30 out/pass6-src.kicad_pcb
                                     # rev B.2: screen / fan mounting holes and the two plug slots on the routed board, then route what they cut
python3 cheapparts.py && python3 pass3.py && python3 route.py 25 out/pass3-src.kicad_pcb --rippable
python3 cleanup.py --no-helpers && python3 touchup.py && MAZE_VIA=80 python3 maze.py --margin 10
python3 fanout.py --stitch && python3 islandvias.py && python3 fixrefs.py && python3 upsizevias.py
                                     # rev B.3: PJ-611E jacks + D_BAR to the front, re-route, fan holes off, title rev B.3,
                                     # capacitor designators back in step with design.py, 0.3 mm drills where they fit
python3 geometry.py                  # -> out/board-geometry.json for the enclosure
python3 export.py                    # -> out/fab/
```

Things learned on this board, built into the scripts: the pre-routes go to Freerouting as *fixed wires*, not as
keep-outs (oversized keep-outs walled in the pins next to them and most connections failed); holes without copper
and the ribbon slot get keep-outs (Freerouting cannot see them); the 5V1 plane polygon is cut where the 5V2 band
starts, because KiCad exports zone outlines, not fills; a wide trunk or a power via is never ripped by the helper
scripts (`trunkfix.py` puts any missing one back); `maze.py --rip REF PAD` clears the strip in front of a boxed-in
pin (`MAZE_VIA` sets what a via costs it, `MAZE_W` how greedy its search is; it straightens its own staircases).
`fixrefs.py` checks every board footprint against the design part of the same name by its pin nets and renames the
capacitors that drifted (rev B.0-B.2 had them two numbers off from C89 up, so the BOM and the pick-and-place
disagreed - do not use fab packages from before rev B.3). `fixzones.py` holds the In2 plane decision (5V1 base + a 5V2 region from y = 156 down); `build.py` makes them
that way already. `jlc.py KEYWORD` looks a part up in the JLC/LCSC library (stock, price, LCSC number).
