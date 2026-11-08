# Central Pedal main board rev B - ordering at PCBWay

## PCB
- Size: 390 x 278 mm, 4 layers (F.Cu signal / In1 GND / In2 5V1 + 5V2 / B.Cu signal), 1.6 mm FR-4 TG150+, 1 oz outer, 0.5 oz inner
- Solder mask BLACK (matte if offered), silkscreen WHITE, surface finish ENIG (gold - it is the look, and the hub / audio pads like it)
- Min track / space 0.15 / 0.15 mm, min via 0.45 mm pad / 0.2 mm drill, min hole 0.3 mm (slots on the footswitch and jack pads: plated slots)
- Board outline and mounting holes are on Edge.Cuts in the Gerbers; no v-score, no panel
- Quantity 5 (or 2 for a first check)
- Impedance control: not needed

## Assembly
- Upload `central-pedal-main-board-bom-pcbway.csv` (or `central-pedal-main-board-bom.csv`, the JLC layout) and `central-pedal-main-board-cpl.csv`
- Both sides are populated: top = everything else; BOTTOM = the 2x20 Pi socket J1 (through-hole, body on the bottom, pin 1 = the square hole at the LEFT end of the row seen from the top), the JST headers (battery, fan, display power, USB hub upstream, bar screen) and the bar-screen ESD diode D_BAR
- Every component has an LCSC number where LCSC stocks it (479 of 535 placements); PCBWay may buy from LCSC, Digi-Key or Mouser by the manufacturer part number
- Parts LCSC does not stock (sourced by part number / description, see the Notes column): the 10 footswitches, the 18 0.91" OLED modules
- Through-hole parts to be soldered: footswitches, encoders, faders, 1/4" jacks, 3.5 mm jacks, USB-A, 2x20 header (BACK side), JST headers (BACK side), 5 mm LEDs (stand 15 mm proud), OLED modules (straight into their 4-pin sockets, screen up)
- Do NOT fit the parts in `not-fitted.txt`
- Polarity: follow the Gerber silkscreen for diodes, LEDs, electrolytic / polymer caps and ICs (pin 1 marks); the CPL rotations use KiCad's convention - please check them on your assembly preview
- The HAT EEPROM (U_EEP) may stay blank: the software recognises the board by its chips; `eeprom/` has the image if you can program it
- No conformal coating; clean flux (audio board)

## Mechanical (for our top plate, not for PCBWay)
- A top plate sits 15.5 mm above the board: footswitch bushings (M12), encoder shafts (7.5 mm clearance, no nut), fader levers, LEDs and the OLED windows pass through it; the Raspberry Pi 4 hangs behind the board, component side toward it, on ~20 mm M2.5 standoffs (holes at 166.7/224.7 x 63.8/112.8 mm) - a 2x20 extra-long stacking header (e.g. Adafruit 2223 or any 2x20 'GPIO stacking header' with ~11 mm pins) on the Pi's GPIO pins reaches the board's socket; the Pi's USB / Ethernet block is 16 mm tall, which is why it cannot sit closer. Seen from the front the Pi is not mirrored: pin 1 at the left end of the header

## Files in this folder
- `central-pedal-main-board-gerbers.zip` - Gerbers (RS-274X) + Excellon drills + drill map
- `central-pedal-main-board-bom-pcbway.csv`, `central-pedal-main-board-bom.csv` - the BOM in PCBWay's and JLC's layouts
- `central-pedal-main-board-cpl.csv` - pick and place (mm, both sides)
- `central-pedal-main-board-top.pdf`, `central-pedal-main-board-bottom.pdf` - assembly drawings; `*-front.png`, `*-back.png`, `*-in1.png`, `*-in2.png` - renders
- `central-pedal-main-board-netlist.txt` - every net, pin by pin, for review; `design-notes.txt` - every design assumption
- `drc-report.txt` - KiCad's design rule check of this exact board
- `central-pedal-main-board.kicad_pcb` / `.kicad_pro` + `custom.pretty/` - the KiCad 7 project
