# Central Pedal main board - rev B

390 x 278 mm, 4 layers (signal / GND / 5V1 + 5V2 / signal), 1.6 mm, ENIG, black mask, white silk. The whole pedal on
one board: 10 footswitches with lights, 6 click-knobs (encoders), 2 faders, 18 label screens, the 7" Raspberry Pi
Touch Display 2 (ribbon), the 11.9" bar touch screen (HDMI 1 + USB), 6 mono 1/4" outputs, 2 instrument inputs,
2 external footswitch jacks, MIDI in / out, headphones, USB-C PD charging of a 2S battery, fan, power button. The
Raspberry Pi 4 plugs onto the BACK of the board (2x20 header, 8.5-9 mm standoffs); a top plate sits 15.5 mm above it.

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

`design.py` is the whole design (every part, pin and net - 579 placements, 324 nets). On a machine with KiCad 7
(pcbnew Python + kicad-cli), Java 17+ and Freerouting 1.9 (`/home/claude/tools/freerouting.jar` in the scripts):

```
python3 build.py                     # place parts, planes, outline, power trunks -> out/central-pedal-main-board.kicad_pcb
python3 fanout.py --pre              # plane-pad vias before routing (-> *-prefan.kicad_pcb + prefan.json)
python3 route.py 14 out/central-pedal-main-board-prefan.kicad_pcb   # Freerouting, SES import, outer GND pours, DRC
python3 fanout.py && python3 fanout.py --stitch                      # vias for anything left floating, widen, stitch
python3 maze.py                      # finish any connection the router left open
python3 export.py                    # -> out/fab/
```

`fixzones.py` holds the final In2 plane decision (5V1 base + a 5V2 region from y = 156 down); `build.py` makes them
that way already. `jlc.py KEYWORD` looks a part up in the JLC/LCSC library (stock, price, LCSC number).
