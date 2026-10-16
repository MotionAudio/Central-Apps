# Central Usage

The companion app for Central Control: chord charts (transposed for your
instrument), lyrics, and a lighting controller that follows the song — out
of a USB-DMX box, Art-Net or sACN, or as MIDI to your lighting software.
A real desktop application (Electron), not a browser tab. Version 1.3.0.

## Install on Linux

* Ubuntu / Debian: `sudo apt install ./dist/central-usage-1.3.0-amd64.deb`
  then open **Central Usage** from the app menu.
* Any Linux: `chmod +x dist/central-usage-1.3.0-x86_64.AppImage` and run it.

## Use

1. Put the computer on the same Wi-Fi as the Central Control.
2. **File → Find** (or type `padpedal.local` / its IP) → **Connect**.
3. **Chord chart** — pick your instrument: concert pitch, guitar / ukulele /
   banjo (capo + chord shapes: "song in A, G shapes → capo 2"), B♭ (trumpet,
   clarinet, tenor sax…), E♭ (alto / bari sax), F (horn)…; Nashville numbers;
   chords-only view; the chart follows the song, the key changes and the
   section the Central Control is on. PDF charts are shown as pages.
4. **Lyrics** — words only, big, with what comes next.
5. **Lighting** — a light controller in the style of Lightkey, four views:
   * **Fixtures**: patch your lights. Pick a type (dimmer, RGB / RGBW /
     RGBAW+UV pars, LED bars, moving-head wash / spot, strobe, blinder,
     hazer, fogger, or *Custom* with your own channel list), how many, the
     DMX universe and start address; overlapping addresses are flagged.
     Drag them on the stage plot, put them in groups (front / key, back / colour,
     beams / movers, house, strobes / blinders, haze), *Find* flashes one so you know which is which. *Save rig to a
     file…* / *Open rig file…* keep the patch for another building.
     **Fixture library**: the exact channel layout of real fixtures -
     *Import fixture files* takes QLC+ `.qxf` files and Open Fixture Library
     `.json` files (open-fixture-library.org → a fixture → Download), and
     *Search the QLC+ library* finds the thousands that come with QLC+
     (`sudo apt install qlcplus`). Every mode becomes a type in *Add
     fixtures*. Movers hung the other way round: *invert pan / tilt*.
   * **Looks**: Walk-in, Worship blue, Warm verse, Build, Chorus (full),
     Bridge, Breakdown, Prayer / response, Ending, Celebrate, hits and
     strobes are built in; make your own (colour, intensity, movement and
     effects per group — chase, pulse on the beat, breathe,
     sweep, alternate, rainbow, strobe). **Moving heads**: drag the dot on
     the position pad (pan across, tilt down) or pick a position (Audience,
     Stage, Ceiling, Cross L / R, Fan out, Floor); *Fan out* spreads the
     movers of a group; shapes: circle, figure 8, pan wave, tilt wave,
     ballyhoo, sweep — with speed, size and phase.
   * **Show**: a timeline per song, under the song's sections. *✨ Auto
     show* makes the cues for you from the sections (verse, chorus, bridge…)
     and the big hits the Central Control found. Then edit it: click the
     timeline to add a cue, drag cues to move them (snap to bar, beat or ½
     beat), pick a look and fade for each. **● Record hits**: while the song
     plays, every *Flash* press (or the **H** key) adds a hit cue right there.
     *▶ Follow the show* runs the cues with the track; *Blackout* and *Flash*
     work live on top. Shows are saved on the Central Control (with the
     pairing code), so every laptop gets the same show and it is in the
     Pi's backups.
   * **Output (DMX · MIDI)**:
     - **USB-DMX interface**: ENTTEC DMX USB Pro and compatibles (DMXking
       ultraDMX Pro / Micro, Eurolite USB-DMX512 PRO…). Plug it in and pick
       it; the installer adds a udev rule so it works without being root
       (or add yourself to the `dialout` group and log in again).
     - **Art-Net** (to a node's IP, or broadcast) or **sACN / E1.31**
       (multicast or a node's IP), any number of universes.
     - A live monitor of universe 1's 512 channels.
     - **MIDI output**: choose the MIDI port your lights listen to
       (Lightkey in MIDI mode, QLC+, a console, a USB MIDI box). The Central
       Control's hits (note 48, channel 1), section notes (60+, channel 1
       when enabled), program changes (channel 2) and MIDI clock arrive over
       Wi-Fi with the Pi's clock and are sent out on that port, lined up with
       the tracks. Use *Timing offset* to nudge them.
     - **Timecode out**: MTC on that MIDI port and / or LTC as audio on any
       sound output (24 / 25 / 30 fps, start time, or hour = song number),
       running with the song, so show software, consoles or video servers
       can follow along.
     - **Phone remote**: switch it on, open the address shown on a phone on
       the same Wi-Fi and enter the 4-digit code: looks, Follow, Flash,
       Blackout, master and group faders.
   The lights blackout when Central Usage quits.

6. **Updates** — Help → *Check for updates…*: set the update source (the
   GitHub repository the releases are published to). Central Usage looks
   once a day and shows *Update ready*; *Install & restart* replaces the
   AppImage, or installs the new .deb with your password. Every download is
   checked against the release's SHA256SUMS first.

Controlling the Central Control from here (jump to a section, play / pause,
lyrics pages) needs its 4-digit pairing code: **Code** (shown on the Pi under
Settings → Companion devices).

Keys: F1 / F2 / F3 tabs · ← → previous / next section (lyrics: pages) ·
Space play / pause · H hit (Lighting) · Ctrl+K connect · Ctrl+F find · Ctrl+= / Ctrl+- text size.

## Build it yourself

```bash
cd central-usage
npm install
npm start              # run from source
npm run dist           # .deb + AppImage into dist/ (x64; add --arm64 for ARM laptops)
```
macOS (`npx electron-builder --mac`) and Windows (`--win`) builds use the same
code; the iPhone / iPad / Android versions come after the desktop design is approved.

## Test

`node test-usage.mjs` (needs `npm i playwright && npx playwright install chromium`)
runs the page against the simulated Central Control driver: chart transposition,
capo, horns, Nashville, lyrics, remote actions, the MIDI relay timing and the
lighting controller (patch, auto show, recorded hits, shows saved on the
Central Control, fixture library, movers, phone remote, timecode).
`xvfb-run -a node test-app.mjs` runs the real app: the phone remote's web
server, the update check and its checksum guard. `node test-dmx.mjs` checks the ENTTEC, Art-Net and sACN
packets and sends real frames over UDP.
