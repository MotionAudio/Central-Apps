# Central Control for a PC (desktop app)

The same Central Control that runs on the Raspberry Pi, as a real desktop
application (Electron): its own window, menu and launcher entry - not a
browser tab. It starts the driver in simulation mode (no GPIO board), so
uploads, chord charts, the phone / projector pages on port 8080, USB and MIDI
pedals and the Instrument tab (with PipeWire) all work on a laptop.

## Install on Linux

* Ubuntu / Debian: `sudo apt install ./dist/central-control-7.0.1-amd64.deb`
  then open **Central Control** from the app menu (it pulls in the Python
  modules the driver needs; `pipewire`, `fluidsynth` and the LADSPA pedal
  packages are recommended for the Instrument tab).
* Any Linux: `chmod +x dist/central-control-7.0.1-x86_64.AppImage` and run it
  (needs `python3`, `python3-websockets`, `python3-gpiozero`, `python3-pil`,
  `python3-evdev` installed).

Songs, pads, charts and settings live in `~/.config/Central Control/`.
F1–F6 switch tabs, F11 is full screen; File → opens the phone pages or the
data folder.

## Build it yourself

```bash
cd central-control-desktop
mkdir -p src && cp -r ../index.html ../css ../js ../companion ../cues ../hardware.json ../pedal-driver.py ../instrument_host.py ../instrument-plugins.json src/
npm install
npm start          # run from source
npm run dist       # .deb + AppImage into dist/
```
macOS (`npx electron-builder --mac`) and Windows (`--win`) use the same code;
those builds, and the iPad / iPhone / Android versions, come after the design
is approved.
