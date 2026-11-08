# Central Pedal main board - rev A

> **Superseded by rev B** (`../main-board-rev-b/`). Do not build rev A as it is: its Pi header frame (pin numbering, mounting holes,
> ribbon slot) was laid out for a mirrored Pi, which was corrected on rev B. Kept for reference only.

270 x 160 mm, 4 layers (signal / GND / 5V1 + VBAT island / signal), 1.6 mm, 1 oz, HASL or ENIG, blue or black.
Stacks behind the Raspberry Pi 4 (2x20 stacking header on the back) with the Raspberry Pi Touch Display 2 in front.
Wiring and pin map: `../../docs/MAIN-BOARD.md`. Full spec: the "Central Pedal Main Board - Design & Manufacturing Spec" doc.

## Ordering (JLCPCB / PCBWay)

Upload from `fab/`:

| File | What |
| --- | --- |
| `central-pedal-main-board-gerbers.zip` | Gerbers + Excellon drills (board edge included) |
| `central-pedal-main-board-bom-jlcpcb.csv` | BOM, with LCSC numbers where a stock part exists |
| `central-pedal-main-board-cpl-jlcpcb.csv` | Pick-and-place (top side only is populated) |
| `central-pedal-main-board-top.pdf` / `-bottom.pdf` | Assembly drawings |
| `central-pedal-main-board-netlist.txt` | Every net and the pins on it, for review |
| `not-fitted.txt` | DNP parts (gain / option jumpers) |
| `drc-report.txt` | KiCad DRC: 0 errors, 0 unconnected; warnings are silkscreen and thermal-relief notes |

Settings to pick: 4 layers, stack-up JLC04161H-7628 (or the fab's standard 4-layer), min track/space 0.15 mm, min
via 0.45 / 0.2 mm (via-in-pad on some ground pads - ask for "filled and capped" vias or accept plain), 5 boards.
Parts without an LCSC number (Neutrik jacks, pots, faders, JST connectors, the push-knobs) can be assembled by the
fab from their global sourcing or soldered by hand; the SMD side is what matters for assembly.

The CPL rotations follow KiCad's convention; the fab's review will rotate polarised parts (diodes, ICs, electrolytics)
to match the Gerbers - confirm them on the assembly preview before paying.

## Regenerating

`design.py` is the whole design (every part, pin and net). On a machine with KiCad 7 and Java:

```
python3 build.py            # place parts, planes, outline -> out/central-pedal-main-board.kicad_pcb
python3 fanout.py --pre     # plane-pad vias before routing
./pipeline.sh               # Freerouting (two passes) + fan-out + stitching
python3 maze.py             # finish any connection the router left open
python3 export.py           # -> out/fab/
```

`central-pedal-main-board.kicad_pcb` / `.kicad_pro` here are the exact routed board the rev A fab files came from.
