# Central Usage

The companion app for Central Control on the other computers in the room. It is
a real desktop application (Electron), not a browser tab. Version 2.0.0.

Each computer is set to one of two roles (Settings; it asks the first time):

* **Admin** (the sound, lights or media desk): **Lighting · Mix · In-ears ·
  Lyrics · Slides · I/O**
* **User** (a musician on stage): **Chord chart · Instrument · Lyrics · In-ears
  (my mix) · I/O**

You can have several admins and many users. **Only the Central Control plays,
stops and skips the tracks**, and every computer follows it. From here you can
only page the lyrics, and while the tracks are playing that paging stays inside
the current section.

## Install on Linux

* Ubuntu / Debian: `sudo apt install ./dist/central-usage-2.0.0-amd64.deb`, then
  open **Central Usage** from the app menu. The .deb recommends `pipewire-jack`
  (the audio interface for the mixer), `python3` and `fluidsynth` (the instrument).
* Any Linux: `chmod +x dist/central-usage-2.0.0-x86_64.AppImage` and run it.

## Connect

1. Put the computer on the same network as the Central Control (Ethernet or
   Wi-Fi).
2. Use **File → Find**, or type `padpedal.local` or its IP, then **Connect**.
3. Click **Code** and enter the 4-digit pairing code from Central Control →
   Settings.

## The audio host (Admin)

One admin computer is the **audio host**. To set it up, go to **I/O → This
computer is the audio host**. The audio host:

* **Gets the Central Control's audio.** Every track arrives on its own channel,
  together with the click, the pads, the tracks mix and the instrument. Under
  *Audio from the Central Control*, pick the same transport the Central Control
  uses (its I/O tab):
  * **Ethernet**: the best.
  * **Wi-Fi**: a little more delay. Use the *Buffer* slider to set how much.
  * **Audio interface**: its outputs are cabled into this computer's inputs.
* **Runs the mixer.** The audio engine (`cu-mixer`) runs through PipeWire's
  JACK, which is the normal set-up on current Ubuntu with `pipewire-jack`. Under
  **I/O → Audio interface**, pick the device, the buffer size, and see what every
  input and output carries. With no interface (*No interface*), the network
  channels are still mixed, recorded and streamed to the in-ears.
* **Registers with the Central Control**, so every other Central Usage finds it
  by itself.
* **Serves the in-ear page for phones** at `http://<this computer>:8092/`.

Other admins mix the same mixer from their own computer. They need the **admin
code** shown on the audio host's I/O tab.

## Mix (Admin)

* Every track has a strip with a fader, meter, pan, mute, high-pass, a 3-band EQ
  (low shelf, bell, high shelf, with the curve drawn) and a compressor with a
  gain-reduction meter. Click a strip's name to open the details.
* **Tracks out** sets where the tracks go: **summed** to two interface outputs
  (L / R), or **each track on its own output**, starting at the output you
  choose. A single track can also have its own direct output.
* A track keeps its settings from song to song, because the Central Control's
  channels are matched by name. "Drums" stays "Drums".
* **Listen here** plays the main mix or any in-ear mix on this computer's
  headphones (pick the output).
* **Record the service** writes a 48 kHz WAV of the main mix to
  `~/Music/Central Usage`.
* The live waveform shows what is going out.
* **Save mixer… / Open mixer…** save the whole set-up to a file and load it back.

## In-ears

**Admin.** The tab has three parts:

* **Channels** (up to 128): each one is the Central Control's channel or an
  interface input, with a name, *Tracks* or *Band*, and whether the users see it.
* **Mixes** (up to 48): each has a name, its owner, *reserved*, and a mode:
  * **Cloud**: the mix leaves the audio interface on the outputs you pick, to a
    wireless pack. There is no delay.
  * **Local**: the mix goes back over Wi-Fi to the owner's device.
* **The selected mix's send levels.** Here you can also **listen to any mix**,
  copy a mix, or free it. The in-ear code and the phone address are shown at the
  top.

**User, and phones.** Pick a free mix (1–48), then set your own levels for the
channels the sound desk routed to you. Choose **Local** to hear it on this
device (headphones, with a delay slider), or **Cloud** to send it to your pack
from the sound desk. You can only change your own mix.

## Lighting (Admin)

A light controller in the style of Lightkey that follows the song:

* **Show**: the stage plot, the presets, the faders and the song's timeline. The
  timeline shows the waveform (from the Central Control's tracks), the sections
  in their colours, the hits as yellow lines, and the cues. Each song has a mode:
  * **Auto**: the sections and the hits run the lights, and the lights move with
    the music.
  * **Semi-auto**: the same, plus your own cues on top.
  * **Manual**: only your cues.
  * Click the timeline to add a cue. Drag a cue to move it; it snaps to the bar,
    beat, ½ beat or ¼ beat.
  * **Tell it the show**: type something like *"dimmers blue 20% red and
    shimmers 30% blue for the verse, then chorus full white, strobes on the
    hits"* and it makes the presets and the cues. Optionally, a small local AI
    model reads freer sentences (Settings).
  * **● Record**: while the song plays (on the Central Control, or
    **▶ Preview here**), everything you press goes on the timeline: presets,
    flashes, each light's colour. Record again over any part to replace just
    that part.
  * **Lights**: a list of every light under the plot. Change one light's colour
    and level live, then use *+ Cue with these colours* to put them on the
    timeline.
* **Songs**: every song on the Central Control (it uploads them by itself),
  with or without tracks, plus your own songs. A song can have any number of
  **scenes**, each on a bar and beat or at a section. A scene programmed at 93
  BPM stays on its bar and beat when the song plays at 112. A song without
  tracks follows the Central Control's click, or the click here.
* **Presets**: each preset's colour, second colour, white, amber, UV, strobe,
  motion (effects, mover position, fan, phase) and timing (how often, depth,
  fade in).
* **Fixtures**: the patch (types, the fixture library from QLC+ and Open
  Fixture Library, universe, address, group, stage plot).
* **Output**:
  * **One DMX output per universe**: USB-DMX (ENTTEC Pro and compatibles),
    Art-Net or sACN, with a monitor for each universe.
  * **MIDI out**: Lightkey, QLC+ or a console.
  * **The click**: hear it while programming, have the lights follow it, and send
    it to an audio output. Each of these can be turned on or off.
  * **The lights and the music**: how much the lights react, and flashes on the
    strong beats.
  * **Timecode** (MTC / LTC) and the **phone remote**.

## Slides and lyrics (Admin)

* **Slides**: add pictures, videos and text slides. Click one to preview it, and
  double-click it (or **Go live**) to show it. The **outputs** are this
  computer's second screen, the Central Control's **HDMI 2** (set it to
  *Slides* on its I/O tab) and **NDI** on the network.
* **Lyrics follow the Central Control**: the current lyrics go to the same
  outputs. You can set the size, colour, alignment and a picture or video
  background.
* NDI needs the free NDI runtime (`libndi.so.6`, from ndi.video).

## Chord chart, Instrument, Lyrics (User)

* **Chord chart**: transposed for your instrument. This covers concert pitch,
  guitar with capo and chord shapes, B♭ / E♭ / F horns and Nashville numbers. It
  follows the song and the section.
* **Instrument**: the Central Control's guitar / bass / keys rig, running on this
  computer. It uses real LV2 / LADSPA pedals through PipeWire and FluidSynth for
  the keys, so it needs `python3`, `fluidsynth` and the LV2 plugins.
* **Lyrics**: big, with what comes next.

## Settings

This is where you set this computer's name and role (Admin or User), the
optional AI model for the lights, and updates (*Check for updates…*).

Keys:
* `F1`–`F9`: the tabs
* `H`: a hit on the Lighting tab
* `←` / `→`: lyrics pages
* `Ctrl+K`: connect
* `Ctrl+F`: find

## Build it yourself

```bash
cd central-usage
npm install
npm start              # copies the shared files from the Central Control folder, builds native/, runs it
npm run dist           # .deb + AppImage into dist/
```
`prepare-shared.sh` copies the Instrument page and the instrument host from the
Central Control folder. It also builds `native/` (the engine `cu-mixer` and the
NDI sender `cu-ndi`). These need only a C compiler, because libjack and libndi
are loaded at run time.

## Test

* `node test-usage.mjs` runs the page against the simulated Central Control. It
  covers the chart, the lyrics, the rule that only the Central Control moves the
  tracks, the MIDI relay, and the lighting: modes, songs and scenes at another
  tempo, recording and recording over, every light's colour, the chat box, DMX
  values, the fixture library, movers, the phone remote and timecode.
* `xvfb-run -a node test-host.mjs` covers the audio host end to end. The
  simulated Central Control sends its tracks over the network, and the real app
  maps them, mixes them and records them. A phone takes a mix, sets its own
  levels and hears it over Wi-Fi. It also checks that users can't change other
  mixes, and that the lights get the waveform and the music's level.
* `xvfb-run -a node test-app.mjs` covers the phone remote and the updater.
* `node test-dmx.mjs` covers the packets and one output per universe.
