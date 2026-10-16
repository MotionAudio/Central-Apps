# Central Control

A Raspberry Pi 4 that boots straight into Central Control and nothing else
(a full-screen app, not a browser): an ambient / worship pad instrument, a
multitrack player (stems, click, spoken cues, chord charts, lyrics) and a
guitar / keys rig, with a touch screen, 12 footswitches, 6 knobs, 2 sliders,
an expression pedal, MIDI in/out, Ableton Link, four separate audio outputs
and a projector output. **Central Usage** (`central-usage/`) is the companion
app for a laptop: chord charts for any instrument, lyrics, and a full
lighting controller (fixtures, looks, a cue timeline, USB-DMX / Art-Net /
sACN) that follows the song over Wi-Fi.

**New in version 7.1:** the HDMI picture is right on any monitor - its own
native resolution (sharp, not stretched), the whole app on screen, a monitor
that wakes up late or gets swapped mid-service is picked up by itself without
stopping the sound, and Settings → Screens can pick the resolution, the zoom
and pull the picture in on screens that cut the edges off · the Inter typeface
built in, so the app looks the same everywhere · the version shown on the
start-up screen and in the top bar · it starts on the tab you used last
(the very first time: Tracks) · proper text boxes everywhere (a pasted chord
chart keeps its lines; the Wi-Fi password is hidden; works in the PC app too) ·
a clean-up pass over every button.

**Version 7:** a full **mixer** (a fader, meter, mute / solo and pan
for every track) · **scenes** saved with each song (up to 4 pad layers with
their levels, the track mix, the instrument rig) recalled automatically, from a
footswitch or by MIDI · **segues** between songs (gapless or crossfaded) ·
**ProPresenter** slides that follow the sections · **Mix and Level on every
pedal** · **8 keys layers** with splits · an **IR loader** · a **looper** ·
**update checks** that ask before installing · in Central Usage: the **fixture
library** (QLC+ / Open Fixture Library), **moving-head positions and shapes**,
a **phone remote** for the lights and **timecode** (MTC / LTC) out.

**Version 6:** songs from Planning Center, MultiTracks.com / Loop
Community track packs or your own files · tempo and time-signature changes
inside a song · live arrangement (flow) with gapless jumps · per-stem outputs
on a USB interface · your own recorded cue words · a stage display ·
backup, restore and software update from a USB stick · every imported file
kept in a library on the Pi · lighting in Central Usage.

## Quick start

1. **Build the OS image** on your Ubuntu PC (40–60 minutes the first time, needs internet and ~15 GB free):

   ```bash
   sudo WIFI_SSID="Church WiFi" WIFI_PASS="password" bash build-image.sh
   ```
   You get `central-control-os-7.1.0.img` (the version is in the name - an
   older `pad-pedal-os.img` lying in the folder is a previous version: delete
   it so it can't be flashed by mistake). Always build from the folder you
   unzipped the newest `central-control-source.zip` into. Options: `PI_PASS=...`, `PI_HOSTNAME=...`,
   `TFT=waveshare35a` (3.5" screen on from the first boot), `I2S_DAC=off`,
   `SAFE_MODE=off`, `WIFI_COUNTRY=US`, `COMPRESS=1`, `SOUNDS=small` (skip the
   1.2 GB Salamander grand piano) or `SOUNDS=none` (no keys sound banks; the
   General MIDI bank is still there). The image is about 8 GB with all the
   sounds; a 16 GB card or bigger.

2. **Flash it** with Raspberry Pi Imager → Choose OS → *Use custom* → the
   `.img` → your SD card. When asked about *OS customisation*, choose **No**.

3. **Boot.** The first boot takes about a minute longer and restarts once
   (it creates the `/data` partition and turns on safe mode). After that every
   boot goes straight to the Central Control screen. The start-up screen says
   "Central Control 7.1.0" and the top-right of the app shows the same - if it
   doesn't, the card has an older image on it.

4. **Wire the control surface** with `wiring.html`. Every part is optional;
   the Learn tab can move any button or knob to any pin without re-flashing.
   A guitar needs a USB audio interface, a keyboard a USB MIDI port - no wiring.

5. **Central Usage** on a laptop: `sudo apt install ./central-usage/dist/central-usage-1.3.0-amd64.deb`
   (or run the AppImage), then **Find** → Connect. See `central-usage/README.md`.
   **Central Control on a PC** (no Pi, for trying it out or building setlists):
   `sudo apt install ./central-control-desktop/dist/central-control-7.1.0-amd64.deb`.

Maintenance login: `ssh pi@padpedal.local`, password `padpedal`.

**Wi-Fi later / another network:** put a file called `pad-pedal-wifi.txt` on
the small `bootfs` partition of the card with the network name on line 1 and
the password on line 2; it is imported (and deleted) at the next boot. Or use
Settings → Wi-Fi on the screen itself (scan, pick, type the password).

## The six tabs

`F1`–`F6`, or a button mapped to *Show tab*: **Pad · Tracks · Instrument ·
Configure · Learn · Settings**.

### Pad
The pad instrument. 8 pads per song (tap to crossfade, tap again to fade
out), STOP, key − / +, two texture channels, tap tempo, layer, morph, freeze.
- **Built-in pads** play in any key with no samples; **imported pads** (MP3,
  WAV, FLAC, OGG, M4A, AIFF) get their key detected automatically and are
  pitch-shifted to the song's key (set the root key yourself if it guessed wrong).
- **Textures**: 2 channels, 100+ presets (rain, vinyl, choir air, tape hiss,
  shimmer beds…), each with its own level knob.
- **Effects** on every pad: 6-band EQ, compressor (VCA / FET / Opto /
  Vari-Mu / Bus / Limiter), drive, auto-filter, phaser, chorus, tremolo,
  stereo width, tempo-synced delay, reverb with shimmer, LFO; all with live
  graphics drawn from the real audio.
- **Octave layers**, **auto-swell**, **audio input** (USB interface) with its
  own effects chain, and output meters with HOT / CLIP warnings.
- **Pad layers**: with LAYER on, up to **4 pads play at once**; each has its
  own level in the *Layers* box beside the pads (and on a knob: *Pad layer N
  level*). A fifth pad fades the oldest one out.

### Scenes (saved with each song)
A scene is a snapshot of any of: the **pads** (which pads, up to 4, and each
one's level), the **track mix** (every fader, mute, pan) and the
**instrument** (which pedals are on, each pedal's Mix and Level, the keys
layers and their volumes; tick *+ board* to store the whole pedalboard / keys
setup for that song). Song editor → **Scenes** → *Capture*.
- **Transitions**: *Smooth* (a fade of the seconds you set), *Swell* (slow),
  or *Cut*; *at once*, on the *next beat* or on the *next bar*.
- **Automatic**: a scene when the song is chosen, and a scene per section
  (Sections → *scene*), recalled as the section starts.
- **Triggered**: tap it (the scene buttons on the Tracks tab, the pads screen
  and the mixer), or a footswitch / button (*Scene: next*, *Scene: previous*,
  *Scene: recall scene N*).
- **MIDI-cued**: *MIDI learn* on a scene, then send the note, CC or program
  change that should call it (from a MIDI controller, Ableton, a console…);
  a song can have its own MIDI cue too.

### Tracks
A multitrack player built in; nothing else to install.
- **+ Song** opens *Add songs*, with three sources:
  - **Planning Center**: connect once with a Personal Access Token
    (api.planningcenteronline.com → Personal access tokens; the app ID and
    secret stay on the Pi). Pick a service type and an upcoming plan; every
    song in the plan comes in with its key, tempo, time signature, the
    arrangement's sequence (as the song's flow), its chord chart and lyrics,
    and any audio attached to the arrangement (pitched to the service key if
    the file is in another key). Tick the songs (or all of them) and import; they can go to the top of
    the setlist in service order.
  - **Track pack**: a MultiTracks.com or Loop Community download (the zip,
    or the unzipped folder) on a USB stick. Stems are recognised by name
    (click, guide, drums, bass, keys, EG / AG, vox, pads…), the full mix is
    left out, and title, key and tempo are read from the file names; you can
    change any stem's role before importing.
  - **Own files**: a single file (MP3 / WAV / FLAC…) or a folder of stems,
    from a USB stick, from a phone (the *Upload* companion page), or from
    this folder on your PC over the network.
- **Library**: every imported file is copied to `/data/pad-pedal/library/`,
  so a song still plays after the USB stick is gone or the browser storage is
  cleared, and is part of every backup.
- **Tempo and key are detected automatically** (with the runner-up guesses
  one tap away if it got it wrong), plus the beat grid, downbeats, sections
  and big hits; a **click track** is generated from the beat grid of the
  instruments (and the song's own click stem is used if it has one).
- **Any key, any tempo**: pitch and time change independently and
  correctly on the fly (the stems stay locked together).
- **Tempo map**: tempo and time-signature changes inside a song (*Tempo grid → Tempo &
  time signature changes* in the song editor: from bar N, the new BPM and beats per bar, with
  an optional ritardando over a few bars). The click, the count-in, the beat
  dots, the sections, MIDI clock and the light hits all follow it.
- **Flow (live arrangement)**: put the sections in the order you want to
  play them (Intro, V1, C, C, Bridge, C…); playback jumps between them
  gaplessly on the bar line. Live, **hold** a section button (or a footswitch
  mapped to *Flow: play section N next*) to go there next, ⟲ *again* to
  repeat the current one, ⤼ *skip* to drop the next, or turn flow off to play the song as recorded.
- **Mixer** (🎚 *Mixer*, or the *Show the mixer* action): every file you
  added gets a channel strip with a big fader (dB), a level meter, mute,
  solo, pan and (with a big USB interface) its own output, plus the Tracks,
  Click and Cues masters. The small strips on the Tracks tab are the same
  faders. Mix changes glide (no clicks), and mixes can be saved as scenes.
- **When the song ends** (song editor): stop · go to the next song, ready ·
  play the next song after a gap · **segue**: the next song is loaded on a
  second player while this one plays and starts the moment it ends
  (gapless), or crossfades over the seconds you set; pads carry on into it.
  *Setlist: go into the next song now* does it on a footswitch.
- **Stems**: each stem has its own volume (with a dB readout) and **pan**.
  When a USB interface with more than four outputs is plugged in, each stem
  also gets an **Out** picker to send it alone to an interface channel
  (e.g. drums and bass to their own console channels). The picker only
  appears when such an interface is detected.
- **Per-song settings**: key, tempo, count-in, loops, sections (Intro,
  Verse 1, Chorus… with markers you can drag), cue words, pad set.
- **Transport buttons**: play / pause, stop, start over, restart section,
  repeat section, previous / next section, key − / +, previous / next song;
  on the footswitches, the screen, the 3.5" screen or a phone.
- **Using tracks** toggle: on, the pads follow the song's key (and section
  pad sets) as the track plays; off, the pads follow the setlist's song key.
- **Pad transitions** can be fired from the track: a section marker can
  switch the pad, swell it in or out, or stop it.
- **Click + spoken MD cues** ("Chorus", "Bridge", "1 2 3 4"…) go to output 3;
  the band hears them, the house does not. **Your own cue words**: *Record cue
  words in your voice…* in the song editor records a word with any microphone (silence is
  trimmed) and it can be used on any section like the built-in ones.
- **Chord charts**: upload a PDF or text chart (ChordPro, chords-over-lyrics
  or `| G | C |` bars), or press **Listen & write chord chart** and the
  Central Control writes one by listening to the stems (beat-synchronous chord
  recognition with slash chords, lined up with the sections). The current
  chord is shown on the transport while the song plays. Charts are shared
  with phones, the projector and Central Usage.
- **Sheet music**: *Sheet music…* in the song editor listens to one stem
  (bass, keys, lead…) and writes what it plays as standard notation,
  guitar / bass tab, a piano roll that follows the playhead, Nashville
  numbers or a chord chart - you pick the view, the clef, the instrument
  and the note division; export as SVG (to a USB stick on the Pi).
- **Lyrics**: words only, split by section, for the projector and phones.
- **MIDI out**: channel 1 (or whichever you pick) sends *hits* for lights
  (a note on every accent / section start, nothing else); channel 2 sends
  general MIDI (program change per song, notes per section, clock).
  The same hits and clock go over Wi-Fi to Central Usage.
  **Ableton Link** and **MIDI clock** sync are in Settings.

### Instrument
Plug a guitar into a USB audio interface, or a keyboard into a USB port, and
the Central Control is the rig. Its sound leaves on **output 4**, never in
the way of the pads or tracks.
- **Electric / Acoustic guitar**: the input (any class-compliant USB
  interface, left / right / stereo channel), gain and noise gate, then a
  **pedalboard** drawn on screen: 149 pedals (boost, overdrive, distortion,
  fuzz, compressors, EQ, wah, chorus, flanger, phaser, tremolo, pitch,
  delays, reverbs, amps and cabinets, acoustic tools) built from the free
  LV2 / LADSPA plugins installed in the image (Guitarix, Calf, Invada, TAP,
  CAPS, swh, x42, Dragonfly, ZamAudio, MDA…) plus boards made here.
  Tap a pedal to switch it, open it for its knobs, drag to reorder, *Sync*
  a delay to the song tempo. **13 board presets** (Clean Worship, Ambient
  Swell, Edge Dotted-Eighth, Blues Crunch, Modern High Gain, Fuzz Wall,
  Acoustic Natural / Shimmer / DI, Keys: Stage / Ambient Pad / EP Tremolo /
  Organ Leslie) and your own boards.
- **Piano & keys**: a USB MIDI keyboard plays SoundFont sounds through
  FluidSynth: grand and upright pianos (Salamander, YDP, Upright KW),
  electric pianos, organs, pads, strings, leads, bells and a full General
  MIDI bank, then the same pedal chain (compressor, EQ, reverb, delay…).
  Transpose, velocity curve, sustain. **Add your own sounds**: an `.sf2`
  SoundFont or a folder of WAV samples named by note (`C4.wav`, `F#3.wav`,
  `60.wav`…) from a USB stick (*Sounds → Add sounds…*), or send an `.sf2`
  from a phone or computer with the Upload page.
- **Mix and Level on every pedal**: open a pedal - *Mix* blends the dry
  sound with the pedal (parallel compression, a touch of fuzz, a delay at
  30 %), *Level* sets what the pedal gives back. Live, no restart.
- **IR loader** (*IR loader: cab / acoustic body*): a cabinet or acoustic
  body impulse response (.wav) from a USB stick (*+ Add IR from USB…*).
- **Keys layers**: up to **8 sounds at once** (piano + pad + strings…), each
  with its own volume, pan, octave, key range (*Split at C4* in one tap) and
  velocity range; each layer is a footswitch toggle or knob too.
- **Looper**: *REC / PLAY / DUB* on one footswitch (record → play → overdub
  → play), *Stop*, *Undo* the last overdub, *Clear*. In time with the song
  (1–16 bars from the next bar line) or free. It records the instrument
  after its pedals and plays back on the instrument output.
- **Tuner** (mutes the output), input meter, **Auto** (listens to the
  input, sets gain and gate, guesses acoustic / electric, picks a board).
- Every pedal, board, sound, the tuner, the expression pedal (wah / volume)
  and the output level can be put on a footswitch, knob or MIDI control in
  **Configure** (*Instrument: pedal N on / off*, *… while held*, *next board*,
  *Keys: next sound*, *tuner*, *Auto set-up*…).
- Latency: 128 samples at 48 kHz in the Pi plus the interface's own.

### Configure
Every physical control, what it does in the Pad layout and what it does in
the Tracks layout, with a hold-action per button. Pick from the action list;
LEDs follow the mapping (on / off / blink on the beat).

### Learn
- **Add new button** → name it → Learn → press the pedal. Works for GPIO
  pins, USB foot controllers (any HID pedal / keyboard key), and MIDI
  (note, CC, program change).
- **Control board inputs**: the 6 knobs, 2 sliders and 12 buttons; *Learn*
  scans every usable GPIO and ADS1115 input for the one you move. Starts
  from the defaults in `wiring.html`; *Reset* puts them back.

### Settings
- **Appearance**: colour presets (Midnight, Worship warm, Stage black,
  Forest, Royal, Daylight, High contrast) or your own colours; interface size.
- **Audio engine**: sample rate (device default / 44.1 / 48 / 96 kHz) and
  latency (lowest / balanced / safest), applied with a restart of the engine.
- **Output routing** and **Output device** (below).
- **Screens**, **3.5-inch screen**, **Companion devices** (QR code, pairing
  code, Upload page), **Wi-Fi**, **MIDI in**, **Tempo / Link / MIDI clock**,
  **Power-cut safe mode**, keyboard shortcuts, shut down / restart.
- **ProPresenter**: Settings → *ProPresenter* (its IP and port; in
  ProPresenter 7: Settings → Network → Enable network). Each section can show
  a slide (Sections → *slide*: a number, or *next*), and choosing a song
  brings up its presentation from the library (*ProPresenter presentation*
  in the song editor, the song name by default).
- **Software updates**: set the *Update source* (the GitHub repository the
  releases are published to). The Central Control looks once a day; when a
  newer version is out, *Update ready* appears with *Install* - which waits
  until nothing is playing. The download is checked against the release's
  SHA256SUMS before anything is installed; your songs and settings stay.
- **Backup, restore & update** (USB stick):
  - *Back up to USB stick* writes `Central Control/central-control-backup-<date>.zip`
    on the stick: songs and their library audio, charts, lyrics, pads,
    keys sounds, recorded cues, lighting shows, setlists, the pin map,
    audio and app settings.
  - *Restore from USB…* lists the backups on the stick and puts one back (the app
    restarts).
  - *Update software from USB…* installs a newer Central Control from a zip on the
    stick (`central-control-source.zip` from this project), into the
    read-only system too when safe mode is on, and restarts the app. Your
    songs and settings are not touched.

## Audio: four mono outputs

| Output | What | Where it comes out (default) |
|---|---|---|
| 1 | Tracks (all stems except click / guide) | 3.5 mm jack, left |
| 2 | Pads + textures | 3.5 mm jack, right |
| 3 | Click + MD voice | PCM5102A I2S DAC, left |
| 4 | Guitar / keys | PCM5102A I2S DAC, right |

A USB interface adds its outputs after those (5, 6…; or first, with *USB
first* in Settings → Output device). Settings → Output routing moves any bus
to any channel, or switches to **stereo pairs** (tracks 1-2, pads 3-4…);
each bus has a *Test* tone. The OS builds one multi-channel PipeWire output
out of the jack, the DAC and the interface so they stay in sync.

- **Audio input** (guitar): any USB interface's input, chosen on the
  Instrument tab (and usable in the pad editor's audio-input chain).
- On a plain stereo output (a PC, or the Pi with the DAC off) the click can
  be mixed in, sent to the right channel or to a second device (Settings →
  Output device → click fallback).

## Hardware
12 buttons on GPIO, 6 knobs + 2 sliders on two ADS1115 boards (0x48, 0x49),
an optional expression pedal on a third (0x4A), the PCM5102A DAC on I2S
(GPIO 18 / 19 / 21), an optional 3.5" SPI screen, an optional rotary encoder,
USB MIDI, USB foot pedals, USB sticks, a USB audio interface and a USB MIDI
keyboard for the Instrument tab. Everything is in `wiring.html`.
The pin map lives in `/data/pad-pedal/hardware.json` (the Learn tab writes it);
`sudo systemctl restart pad-pedal-driver` reloads it by hand.

## Screens
- **HDMI 1**: the app (default). Or a big copy of the 3.5" view, lyrics, or charts.
- **HDMI 2**: lyrics only, for a projector (default). Or charts, the big
  3.5" view, the **stage display**, the app, or nothing. (Settings → Screens.)
- **Stage display** (`/stage`, on either HDMI or any tablet): the song, key,
  tempo and meter, the section now playing with a bar countdown, what comes
  next in the flow, the lyrics, beat dots and the song's progress, readable
  from across the stage.
- **3.5" SPI touch screen** on the GPIO header: pads + tracks transport only,
  never charts. Turn it on in Settings → 3.5-inch screen (choose the type),
  then *Calibrate touch*.
- **Phones, tablets, Macs** on the same Wi-Fi: open `http://padpedal.local:8080`
  (or scan the QR code in Settings). Pages: chord charts (follows the song),
  lyrics, remote, upload. The 4-digit pairing code shown in Settings is needed
  to control anything; viewing is free.
- **Central Usage** (Linux desktop app, `central-usage/`): chord chart
  transposed for the player's instrument (guitar shapes + capo, B♭ / E♭ / F
  horns, Nashville numbers), lyrics, and **lighting**: a built-in light
  controller (patch your fixtures and their channels, looks, a cue timeline
  per song that is filled in automatically from the sections and hits and
  that you can edit or record by hand) driving a USB-DMX box, Art-Net or
  sACN; or the light hits + MIDI clock relayed to a MIDI port for Lightkey,
  QLC+ or a console.
- **Cursor**: auto (shown while a mouse or keyboard is plugged in), always, never.
- **Resolution, zoom, edges** (Settings → Screens, per HDMI port): each screen
  runs at its own native resolution unless you pick another; the zoom is
  automatic (100 %, or 150 % / 200 % on 1440p / 4K monitors) or chosen; *Edges
  cut off?* pulls the picture in on TVs and monitors that overscan. Resolution
  and edge changes apply within seconds while the music keeps playing.
- **Plugging in late / swapping screens**: the Pi waits up to 20 s at start-up
  for the monitor to wake up, and afterwards watches the HDMI ports - a screen
  that appears, changes or comes back is laid out again by itself.
- **Picture problems?** Use the micro-HDMI port next to the power socket for
  HDMI 1. Blurry text means the screen isn't at its native resolution: set
  Settings → Screens → Resolution to *Automatic* (or the one marked
  *native*). Edges missing: turn on the monitor's "Just scan" / "1:1" / "Screen
  fit" picture setting, or use *Edges cut off?*. What the session did is in
  `/tmp/pad-pedal-session.log` (ssh in).

## MIDI in (USB keyboards and foot controllers)
Any note, CC or program change can be learned onto any input on the Learn
tab. Out of the box: notes play the pads in that key (or the keys sounds when
the Instrument tab is on *Piano & keys*), CC 64 (sustain) holds freeze /
sustain, CC 7 / 74 / 91 / 73 are the Volume / Tone / Reverb / Fade knobs,
CC 11 is expression, and MIDI clock sets the tempo (switchable in Settings).

## Power-cut safe mode (on by default)
The system partition is read-only and runs from memory, so pulling the plug
can never damage it. Songs, stems, pads, charts, keys sounds, the pin map and
Wi-Fi settings are on the separate `/data` partition, which keeps saving
normally. Settings shows the status and switches it (takes effect after a
restart); over SSH: `sudo pad-pedal-safe-mode on|off|status`. Software
updates from a USB stick (Settings → Backup, restore & update) work with
safe mode on.

## Keyboard shortcuts
`F1`–`F6` the six tabs · `1`–`8` pads · `Space` stop · `P` Perform / Edit ·
`↑`/`↓` key · `B` tap tempo · `Z` freeze · `L` layer · `[` `]` previous / next
song · `A W S E D F T G Y H U J` preview the pad in any key.
On the Tracks tab: `Space` play / pause · `←` `→` previous / next section ·
`R` repeat section · `Home` start over · `+` `−` key.

## Already have Raspberry Pi OS Lite on a card?
Copy this folder to the Pi and run `sudo bash install-kiosk.sh` (add
`TFT=waveshare35a` for the 3.5" screen), then reboot. Everything works except
safe mode, which needs the separate `/data` partition that the image creates.
`bash get-sounds.sh sounds` first if you want the free keys sound banks.

## Getting a shell on the Pi itself
Plug in a keyboard and press `Ctrl+Alt+F2`; `Ctrl+Alt+F1` returns to the app.
Logs: `journalctl -u pad-pedal-driver -f` and `/tmp/pad-pedal-session.log`.

## Testing on your PC (no Pi needed)
- `python3 pedal-driver.py --simulate /tmp/pp --app-root .` then open
  `http://127.0.0.1:8766/app/` in Chrome: the whole app with a simulated
  control surface (type `press b1`, `knob k1 0.5`, `gpio 4 low` in the
  terminal), the companion pages on `http://127.0.0.1:8080`, uploads, charts.
  (`pip install websockets gpiozero evdev pillow mido python-rtmidi`.)
  With PipeWire on the PC the Instrument tab works too (LADSPA pedals; the
  LV2 ones need PipeWire 1.2+ with its LV2 loader, as on the Pi image).
- `python3 test_pedal_driver.py` — the driver against simulated GPIO,
  ADS1115 boards, USB pedals, MIDI, uploads, keys sounds, cue words,
  Planning Center (against a mock server), track packs, the library,
  backup / restore / update, ProPresenter and the update checker against
  stand-in servers, IR import, the Screens settings (97 checks).
- `bash test-session.sh` — the HDMI screen session on a virtual screen (Xvfb)
  with a pretend HDMI port and a real Chromium: the start-up page, the window
  exactly on the screen, live edge margin, a monitor swap, restarts (7 checks).
- `node test-integration.mjs` — the real app in headless Chromium talking to
  the simulated driver: tracks, sections, keys, cues, chord chart from audio,
  sheet music, the Instrument tab, learn, companion pages, tempo map, flow,
  direct outputs, the stage display, Planning Center and track-pack import,
  backup, the mixer and meters, pad layers, scenes (automatic, MIDI-cued,
  MIDI learn), ProPresenter, segues, pedal Mix / Level, 8 keys layers,
  instrument scenes, the looper, the update banner (51 checks;
  `npm i playwright && npx playwright install chromium`).
- `node test-headless.mjs` — the app on its own (engine, effects, setlist).
- `python3 test_instrument_host.py` — the native pedal / keys host against a
  real PipeWire graph: pedal Mix / Level, the IR convolver, the looper tap,
  8 keys layers (13 checks; needs `pipewire`, `wireplumber`, `fluidsynth`).
- `cd central-usage && node test-usage.mjs` — Central Usage: transposition,
  capo, horns, Nashville, lyrics, remote, MIDI relay timing, the lighting
  controller, fixture library, movers, phone remote, timecode (18 checks);
  `node test-dmx.mjs` — the USB-DMX, Art-Net and sACN packets;
  `xvfb-run -a node test-app.mjs` — the real Electron app: the phone remote's
  server, the update check and its checksum guard.
- `bash make-release.sh 7.1.0 owner/repo` (with `GITHUB_TOKEN`) — packs and
  publishes a release the update checks find (see the script's header).

## Files
| File | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The app: pads, tracks, instrument, configure, learn, settings, engine, effects, graphics |
| `js/multitrack-worklet.js`, `js/analysis-worker.js` | Multitrack audio engine (key / tempo change, click, cues) and the BPM / key / section / chord / note analysis |
| `js/chords.js`, `js/notation.js` | Chord-chart parsing, transposition and instrument views (shared with Central Usage); sheet music, tab and piano roll |
| `js/pedals.js`, `js/plugin-ports.js`, `instrument-plugins.json` | The pedal catalogue and board presets; the plugin ports found in the image |
| `js/instrument.js`, `instrument_host.py` | The Instrument tab and the native PipeWire pedal chain / FluidSynth keys host behind it |
| `js/scenes.js`, `js/looper.js`, `js/integrations.js` | Scenes and pad layers; the looper; ProPresenter and update checks (page side) |
| `make-release.sh` | Builds a release (Pi zip, PC installers, SHA256SUMS) and publishes it to GitHub |
| `js/sources.js`, `sources.py` | *Add songs*: Planning Center, track packs, own files (page and driver side) |
| `companion/` | The pages phones, tablets and the projector open: charts, lyrics, remote, upload, mini, stage |
| `central-usage/` | The Central Usage desktop app (Electron) and its installers in `dist/` |
| `cues/` | Pre-rendered spoken cue words |
| `pedal-driver.py`, `hardware.json`, `pad-pedal-driver.service` | Hardware, USB, MIDI, Link, 3.5" screen, file, companion and Wi-Fi server; its default pin map; its service |
| `pad-pedal-session`, `xinitrc`, `bash_profile` | The kiosk session: audio, HDMI 1 / HDMI 2 (native resolution, zoom, edges, hot-plug), cursor, the full-screen app |
| `starting.html`, `99-central-control-vc4.conf` | The start-up screen shown until the service answers; the X setting that uses the Pi's own display driver |
| `fonts/` | Inter (SIL Open Font License), used by the app, the companion pages and Central Usage |
| `pad-pedal-audio-config` | Builds the multi-channel output (jack + DAC + USB) in PipeWire |
| `pad-pedal-system`, `pad-pedal-safe-mode`, `pad-pedal.sudoers` | Root helper for Settings (safe mode, screen, DAC, audio, Wi-Fi, hostname) |
| `build-image.sh` | Builds the SD card image on an Ubuntu / Debian PC |
| `setup-pi.sh` | The OS setup used by both the image builder and `install-kiosk.sh` |
| `get-sounds.sh` | Downloads the free keys sound banks (FreePats, Salamander…) for the image |
| `install-kiosk.sh` | Turns an existing Pi OS Lite install into Central Control |
| `firstboot.sh`, `pad-pedal-firstboot.service`, `pad-pedal-wifi-import.service` | First boot: /data partition, safe mode, Wi-Fi import |
| `99-pad-pedal-usb.rules`, `99-pad-pedal-touch.conf` | USB auto-mount; keeps the 3.5" touch panel away from X |
| `wiring.html` (`make_wiring.py`, `wiring.template.html`) | Wiring guide with the header map, and its generator |
| `test_pedal_driver.py`, `test-integration.mjs`, `test-headless.mjs`, `test_instrument_host.py` | Automated tests |
| `central-control-desktop/` | Central Control as a native desktop app for a regular Linux PC (Electron; installers in `dist/`: `sudo apt install ./central-control-7.1.0-amd64.deb`) |
