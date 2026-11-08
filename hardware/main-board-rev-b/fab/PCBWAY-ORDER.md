# Central Pedal main board rev B.3 - ordering at PCBWay

## PCB
- Size: 390 x 278 mm, 4 layers (F.Cu signal / In1 GND / In2 5V1 + 5V2 / B.Cu signal), 1.6 mm FR-4 TG150+, 1 oz outer, 0.5 oz inner
- Solder mask BLACK (matte if offered), silkscreen WHITE, surface finish ENIG (gold - it is the look, and the hub / audio pads like it)
- Min track / space 0.15 / 0.15 mm, vias 0.6 mm pad / 0.3 mm drill (a few at 0.5 / 0.25 mm), min hole 0.25 mm (slots on the footswitch and jack pads: plated slots)
- Board outline and mounting holes are on Edge.Cuts in the Gerbers; no v-score, no panel
- Quantity 5 (or 2 for a first check)
- Impedance control: not needed

## Assembly
- Upload `central-pedal-main-board-bom-pcbway.csv` (or `central-pedal-main-board-bom.csv`, the JLC layout) and `central-pedal-main-board-cpl.csv`
- SMT on the TOP side only (one stencil). Through-hole on both sides: top = jacks, encoders, faders, footswitches, LEDs, OLED modules, USB-A; BOTTOM = the 2x20 Pi socket J1 (body on the bottom, pin 1 = the square hole at the LEFT end of the row seen from the top) and the five JST headers
- Every component has an LCSC number where LCSC stocks it (473 of 507 placements); PCBWay may buy from LCSC, Digi-Key or Mouser by the manufacturer part number
- Parts LCSC does not stock (sourced by description, see the Notes column): the 10 footswitches, the 18 0.91" OLED modules, the 6 EC11 encoders (generic, 30 mm shaft)
- Through-hole parts to be soldered: footswitches, encoders, faders, 1/4" jacks, 3.5 mm jacks, USB-A, 2x20 header (BACK side), JST headers (BACK side), 5 mm LEDs (stand 15 mm proud), OLED modules (straight into their 4-pin sockets, screen up)
- The 1/4" jacks come with a nut and washer each: leave them OFF and pack them with the board
- No box build: the board ships without the 7" and 11.9" screens and the fan (the customer fits them)
- Do NOT fit the parts in `not-fitted.txt`
- Polarity: follow the Gerber silkscreen for diodes, LEDs, electrolytic / polymer caps and ICs (pin 1 marks); the CPL rotations use KiCad's convention - please check them on your assembly preview
- The HAT EEPROM (U_EEP) may stay blank: the software recognises the board by its chips; `eeprom/` has the image if you can program it
- No conformal coating; clean flux (audio board)

## Step by step on pcbway.com

1. **PCB Instant Quote** (Quick-order PCB): Board type *Single pieces*; Size **390 x 278 mm**; Quantity 5 (or 2);
   Layers **4**; Material FR-4, TG **150** or higher; Thickness **1.6 mm**; Min track / spacing **6/6 mil**;
   Min hole size **0.25 mm** (pick 0.25 or "0.2-0.25" - there are 156 vias with 0.25 mm drills); Solder mask **Black**; Silkscreen **White**; Surface finish **ENIG** (immersion gold);
   Via process *Tenting vias*; Finished copper **1 oz** outer, inner copper 0.5 oz (1 oz is fine too);
   Impedance control *No*; Castellated holes *No*; Edge plating *No*; Panelization *No* (one board).
   Stackup: leave their default 4-layer stackup; the inner layers are power/ground planes.
2. Tick **Assembly Service** on the same page: *Turnkey* (they buy the parts), assembly side **Top** for SMT
   (through-hole on both sides), quantity = board quantity, unique parts **86**, no BGA, no conformal coating,
   no X-ray, no box build. In the notes box write: *SMT top side only. Through-hole hand-soldered: footswitches, 1/4"
   jacks, encoders, faders, LEDs (15 mm proud), OLED modules; the Pi socket J1 and the JST headers go on the BOTTOM
   side. Jack nuts and washers loose in the bag. Generic parts (OLED modules, footswitches, EC11 encoders) per the
   BOM Notes column.*
3. Add to cart, then on the order page upload **`central-pedal-main-board-gerbers.zip`** as the PCB file.
4. In the assembly section upload **`central-pedal-main-board-bom-pcbway.csv`** as the BOM and **`central-pedal-main-board-cpl.csv`**
   as the pick-and-place (centroid / XY) file. If their form wants an Excel BOM, open the CSV in Excel and
   save as .xlsx - keep the columns.
5. Submit. Within a day a PCBWay engineer reviews the Gerbers (they will ask you to confirm the board outline and
   the slot - say yes) and sends a parts quote. That is where you "tell them the parts": they take the **LCSC
   number** in the Notes column and the **Mfg Part #** column from the BOM and come back with a list of what they
   found, what is out of stock, and anything they cannot identify. Answer that email line by line; for the three
   parts with no LCSC number (footswitches, OLED modules, EC11 encoders) the Notes column already says what fits - any of the
   listed makes is fine. If they offer a substitute for a passive (same value, size, voltage) accept it; for ICs
   say no substitutes.
6. If you would rather send some parts yourself (footswitches, OLED modules, jacks), reply that those lines are
   *customer supplied* and ship them to the address they give; everything else stays turnkey.
7. Approve the quote, pay, and they build. Ask for photos of the first assembled board before the rest - and
   check J1 is on the back and the footswitch LED colour is right.

Not on this board (you buy them): the Raspberry Pi 4 + 2x20 stacking header + M2.5 x 20 standoffs, the 7" Touch
Display 2 and the 11.9" bar screen (they screw onto the board), a 40 mm 5 V fan (it screws to the case floor), the 2S
battery pack (JST-VH lead), knobs for the six 6 mm D-shafts, two fader caps, and the enclosure.

## Mechanical (for our top plate, not for PCBWay)
- A 3 mm top plate sits 16 mm above the board: footswitch bushings (M12, nut on top), the 30 mm encoder shafts (8 mm clearance holes, no nut), fader levers (in recessed trays), LEDs and the OLED windows pass through it; the 1/4" jacks' 3/8in bushings go through the back panel and take their nuts there; the Raspberry Pi 4 sits under the board on the case floor, component side toward the board, on ~20 mm M2.5 standoffs (holes at 166.7/224.7 x 63.8/112.8 mm) - a 2x20 extra-long stacking header (e.g. Adafruit 2223 or any 2x20 'GPIO stacking header' with ~11 mm pins) on the Pi's GPIO pins reaches the board's socket; the Pi's USB / Ethernet block is 16 mm tall, which is why it cannot sit closer. Seen from the front the Pi is not mirrored: pin 1 at the left end of the header

## Files in this folder
- `central-pedal-main-board-gerbers.zip` - Gerbers (RS-274X) + Excellon drills + drill map
- `central-pedal-main-board-bom-pcbway.csv`, `central-pedal-main-board-bom.csv` - the BOM in PCBWay's and JLC's layouts
- `central-pedal-main-board-cpl.csv` - pick and place (mm, both sides)
- `central-pedal-main-board-top.pdf`, `central-pedal-main-board-bottom.pdf` - assembly drawings; `*-front.png`, `*-back.png`, `*-in1.png`, `*-in2.png` - renders
- `central-pedal-main-board-netlist.txt` - every net, pin by pin, for review; `design-notes.txt` - every design assumption
- `drc-report.txt` - KiCad's design rule check of this exact board
- `central-pedal-main-board.kicad_pcb` / `.kicad_pro` + `custom.pretty/` - the KiCad 7 project
