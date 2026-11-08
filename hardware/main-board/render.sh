#!/bin/bash
# render the board to PNG for a look: $1 = board, $2 = out prefix
set -e
B="$1"; P="$2"
kicad-cli pcb export svg --layers "F.Cu,F.SilkS,Edge.Cuts,F.Fab" --page-size-mode 2 --exclude-drawing-sheet -o "$P-front.svg" "$B" >/dev/null
kicad-cli pcb export svg --layers "B.Cu,B.SilkS,Edge.Cuts" --page-size-mode 2 --exclude-drawing-sheet --mirror -o "$P-back.svg" "$B" >/dev/null
kicad-cli pcb export svg --layers "In1.Cu,Edge.Cuts" --page-size-mode 2 --exclude-drawing-sheet -o "$P-in1.svg" "$B" >/dev/null
kicad-cli pcb export svg --layers "In2.Cu,Edge.Cuts" --page-size-mode 2 --exclude-drawing-sheet -o "$P-in2.svg" "$B" >/dev/null
for f in front back in1 in2; do rsvg-convert -w 2700 -b white "$P-$f.svg" -o "$P-$f.png" 2>/dev/null || python3 -c "import cairosvg" 2>/dev/null; done
ls -la "$P"-*.png 2>/dev/null
