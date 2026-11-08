# Central Pedal main board rev B - ordering at PCBWay

## PCB
- Size: 390 x 278 mm, 4 layers (F.Cu signal / In1 GND / In2 5V1 + 5V2 / B.Cu signal), 1.6 mm FR-4 TG150+, 1 oz outer, 0.5 oz inner
- Solder mask BLACK (matte if offered), silkscreen WHITE, surface finish ENIG (gold - it is the look, and the hub / audio pads like it)
- Min track / space 0.15 / 0.15 mm, vias 0.6 mm pad / 0.3 mm drill (a few at 0.5 / 0.25 mm), min hole 0.25 mm (slots on the footswitch and jack pads: plated slots)
- Board outline and mounting holes are on Edge.Cuts in the Gerbers; no v-score, no panel
- Quantity 5 (or 2 for a first check)
- Impedance control: not needed

## Assembly
- Upload `central-pedal-main-board-bom-pcbway.csv` (or `central-pedal-main-board-bom.csv`, the JLC layout) and `central-pedal-main-board-cpl.csv`
- Both sides are populated: top = everything else; BOTTOM = the 2x20 Pi socket J1 (through-hole, body on the bottom, pin 1 = the square hole at the LEFT end of the row seen from the top), the JST headers (battery, fan, display power, USB hub upstream, bar screen) and the bar-screen ESD diode D_BAR
- Every component has an LCSC number where LCSC stocks it (479 of 535 placements); PCBWay may buy from LCSC, Digi-Key or Mouser by the manufacturer part number
- Parts LCSC does not stock (sourced by part number / description, see the Notes column): the 10 footswitches, the 18 0.91" OLED modules
- Through-hole parts to be soldered: footswitches, encoders, faders, 1/4" jacks, 3.5 mm jacks, USB-A, 2x20 header (BACK side), JST headers (BACK side), 5 mm LEDs (stand 15 mm proud), OLED modules (straight into their 4-pin sockets, screen up)
- Box build after soldering (the last 10 BOM lines, type BOX BUILD): the 7" Touch Display 2 and the 11.9" bar screen are screwed onto the FRONT of the board into their own stand-offs, the 40 mm fan onto the BACK on stand-offs, and their leads plugged in - see "Box build" below. The board ships with the screens and fan on it; the customer adds only the Raspberry Pi, the knobs / fader caps and the enclosure
- Do NOT fit the parts in `not-fitted.txt`
- Polarity: follow the Gerber silkscreen for diodes, LEDs, electrolytic / polymer caps and ICs (pin 1 marks); the CPL rotations use KiCad's convention - please check them on your assembly preview
- The HAT EEPROM (U_EEP) may stay blank: the software recognises the board by its chips; `eeprom/` has the image if you can program it
- No conformal coating; clean flux (audio board)

## Step by step on pcbway.com

1. **PCB Instant Quote** (Quick-order PCB): Board type *Single pieces*; Size **390 x 278 mm**; Quantity 5 (or 2);
   Layers **4**; Material FR-4, TG **150** or higher; Thickness **1.6 mm**; Min track / spacing **6/6 mil**;
   Min hole size **0.25 mm** (pick 0.25 or "0.2-0.25" - there are 239 vias with 0.25 mm drills); Solder mask **Black**; Silkscreen **White**; Surface finish **ENIG** (immersion gold);
   Via process *Tenting vias*; Finished copper **1 oz** outer, inner copper 0.5 oz (1 oz is fine too);
   Impedance control *No*; Castellated holes *No*; Edge plating *No*; Panelization *No* (one board).
   Stackup: leave their default 4-layer stackup; the inner layers are power/ground planes.
2. Tick **Assembly Service** on the same page: *Turnkey* (they buy the parts), assembly side **Both sides**,
   quantity = board quantity, unique parts **86** (+ 10 box-build lines), no BGA, no conformal coating, no X-ray needed.
   In the notes / "special requirements" box write: *through-hole footswitches, 1/4" jacks and OLED modules
   hand-soldered; the Pi socket J1 goes on the BOTTOM side; box build: two display modules screwed to the front and a
   40 mm fan to the back, three leads plugged in, per PCBWAY-ORDER.md "Box build" and the BOX BUILD lines of the BOM.*
   PCBWay quotes mechanical assembly by hand from that description (it is a normal service for them; expect a few
   dollars per board and a question or two from the engineer).
3. Add to cart, then on the order page upload **`central-pedal-main-board-gerbers.zip`** as the PCB file.
4. In the assembly section upload **`central-pedal-main-board-bom-pcbway.csv`** as the BOM and **`central-pedal-main-board-cpl.csv`**
   as the pick-and-place (centroid / XY) file. If their form wants an Excel BOM, open the CSV in Excel and
   save as .xlsx - keep the columns.
5. Submit. Within a day a PCBWay engineer reviews the Gerbers (they will ask you to confirm the board outline and
   the slot - say yes) and sends a parts quote. That is where you "tell them the parts": they take the **LCSC
   number** in the Notes column and the **Mfg Part #** column from the BOM and come back with a list of what they
   found, what is out of stock, and anything they cannot identify. Answer that email line by line; for the two
   parts with no LCSC number (footswitches, OLED modules) the Notes column already says what fits - any of the
   listed makes is fine. If they offer a substitute for a passive (same value, size, voltage) accept it; for ICs
   say no substitutes.
6. If you would rather send some parts yourself (footswitches, OLED modules, jacks), reply that those lines are
   *customer supplied* and ship them to the address they give; everything else stays turnkey.
7. Approve the quote, pay, and they build. Ask for photos of the first assembled board before the rest - and
   check J1 is on the back and the footswitch LED colour is right.

## Box build - what goes on after soldering, and where

Front of the board (component side), glass up - the silkscreen outlines show exactly where:

1. **Fan stand-offs first**: 4 x M3x10 F-F hex stand-offs on the BACK over HFAN_1-4, held by M3x6 screws from the
   FRONT (the screw heads end up under the 7" display, which is why they go in first).
2. **7" Touch Display 2** over HD7_1-4 (outline "7in TOUCH DISPLAY 2"), ribbon connector end toward +x (the right,
   seen from the front). 4 x M2.5x5 (or the display's own screws) from the back into the display's four stand-offs. Fit the supplied 15-way ribbon
   into the display's connector, route it through the 3 x 23 mm slot beside the Pi header to the back, coil and tape
   it. Cut the 3-way housing off the supplied power lead, crimp a JST PHR-2 (red = pin 2, black = pin 1), through the
   same slot into **J_DISP** on the back.
3. **11.9" bar screen** over HBAR_1-4 (outline "11.9in BAR SCREEN"), the mini-HDMI / button edge toward the 7"
   display, the touch micro-USB toward +x. 4 x M2.5x5 (or its own screws) from the back into its four brass stand-offs. Plug the slim
   mini-HDMI lead in: its plug body sits in the "HDMI PLUG" slot and the cable hangs through to the back - leave it
   for the customer's Pi (micro-HDMI 1). Plug the slim micro-USB of the touch lead into the screen's TOUCH port (it faces +x, in a notch of
   the screen's PCB): its body lies over the "TOUCH USB PLUG" slot, the lead bends down through it to the back into
   **J_USB_BAR**.
4. **Fan** on the back over its stand-offs, 4 x M3x16, airflow arrow pointing away from the board, lead into
   **J_FAN**.
5. Tape the loose leads (ribbon, HDMI) flat to the back of the board for shipping.

The screens are powered from the board (J_DISP, J_USB_BAR), so a powered board shows the Waveshare splash on the
bar screen (no HDMI signal yet) and the 7" stays dark until a Pi is plugged in - that is the expected test result.

Not on this board (you buy them): the Raspberry Pi 4 + 2x20 stacking header + M2.5 x 20 standoffs, the 2S battery
pack (JST-VH lead), knobs for the six 6 mm D-shafts, two fader caps, the enclosure (see `../enclosure/`) with its
foam screen gaskets.

## Mechanical (for our top plate, not for PCBWay)
- A 3 mm top plate sits 16 mm above the board: footswitch bushings (M12, nut on top), the 30 mm encoder shafts (8 mm clearance holes, no nut), fader levers (in recessed trays), LEDs and the OLED windows pass through it; the Raspberry Pi 4 hangs behind the board, component side toward it, on ~20 mm M2.5 standoffs (holes at 166.7/224.7 x 63.8/112.8 mm) - a 2x20 extra-long stacking header (e.g. Adafruit 2223 or any 2x20 'GPIO stacking header' with ~11 mm pins) on the Pi's GPIO pins reaches the board's socket; the Pi's USB / Ethernet block is 16 mm tall, which is why it cannot sit closer. Seen from the front the Pi is not mirrored: pin 1 at the left end of the header

## Files in this folder
- `central-pedal-main-board-gerbers.zip` - Gerbers (RS-274X) + Excellon drills + drill map
- `central-pedal-main-board-bom-pcbway.csv`, `central-pedal-main-board-bom.csv` - the BOM in PCBWay's and JLC's layouts
- `central-pedal-main-board-cpl.csv` - pick and place (mm, both sides)
- `central-pedal-main-board-top.pdf`, `central-pedal-main-board-bottom.pdf` - assembly drawings; `*-front.png`, `*-back.png`, `*-in1.png`, `*-in2.png` - renders
- `central-pedal-main-board-netlist.txt` - every net, pin by pin, for review; `design-notes.txt` - every design assumption
- `drc-report.txt` - KiCad's design rule check of this exact board
- `central-pedal-main-board.kicad_pcb` / `.kicad_pro` + `custom.pretty/` - the KiCad 7 project
