# Central Control

The companion app for Central Pedal on the other computers in the room. It is
a real desktop application (Electron), not a browser tab. Version 2.1.0.

Each computer has a role. The first time it starts it asks: **Main admin** or **Join**.

* **Main admin** (one, usually the sound desk): everything an admin has, plus a
  4-digit **PIN** and a **pairing code** (Settings → This computer) and the
  **People and devices** list, where it gives every other computer its role and,
  for admins, their **jobs**.
* **Admin**: **Lighting · Video · Mix · In-ears · Lyrics · Slides · I/O**, or only
  the tabs for the jobs the main admin gives it (any mix of Lighting, Production
  (cameras), Mix, In-ears, Slides & lyrics; *General* = all of them).
* **User 1** (a musician): **Chord chart (or any instrument's part) · Instrument ·
  Lyrics · In-ears (my mix) · I/O**
* **User 2**: **Lyrics · Chord chart (any instrument) · In-ears (my mix)**

A new computer chooses **Join** and types the main admin's pairing code; it starts
as User 1 and gets the Central Pedal's code and its in-ear code by itself. Users
switch between User 1 and User 2 any time (the buttons in the top bar). Moving
between the user side and the admin side needs the main admin's PIN, or the main
admin changes it in its People list. **Settings → Forget role** puts a computer
back to the first question (use it if two were set up as the main admin; the
Central Pedal shows a warning when that happens). The list lives on the Central
Pedal (only hashes of the PIN and codes), so roles hold while the main admin's
computer is off.

You can have several admins and many users. **Only the Central Pedal plays,
stops and skips the tracks**, and every computer follows it. From here you can
only page the lyrics, and while the tracks are playing that paging stays inside
the current section.

## Install

Download from https://motionaudio.github.io/Central-Apps/ (first-run help there and in ../INSTALL.md).

* **Windows 10 / 11**: `central-usage-<v>-win-x64.exe` (More info → Run anyway the first time).
* **macOS** (Apple Silicon or Intel): `central-usage-<v>-mac-arm64.dmg` / `-mac-x64.dmg`, drag to
  Applications, then System Settings → Privacy & Security → Open Anyway the first time. Allow the microphone.
* On Windows and macOS the audio host uses the system's audio devices (WASAPI / Core Audio) - any interface,
  Dante Virtual Soundcard or a Dante card, several joined into one (I/O tab) - and the Instrument tab plays
  through the built-in rig (built-in effects, SoundFont keys; your own `.sf2` banks go in the app's data folder
  under `instrument/sounds/sf2`).

### Linux

* Ubuntu / Debian: `sudo apt install ./dist/central-usage-2.1.0-amd64.deb`, then
  open **Central Control** from the app menu. The .deb recommends `pipewire-jack`
  (the audio interface for the mixer), `python3` and `fluidsynth` (the instrument).
* Any Linux: `chmod +x dist/central-usage-2.1.0-x86_64.AppImage` and run it.

## Connect

1. Put the computer on the same network as the Central Pedal (Ethernet or
   Wi-Fi).
2. Use **File → Find**, or type `padpedal.local` or its IP, then **Connect**.
3. The first time: **Join** with the main admin's pairing code (or, before there
   is a main admin, the Central Pedal's pairing PIN from Central Pedal → Settings). Later
   computers find the Central Pedal by themselves.

## The audio host (Admin)

One admin computer is the **audio host**. To set it up, go to **I/O → This
computer is the audio host**. The audio host:

* **Gets the Central Pedal's audio.** Every track arrives on its own channel,
  together with the click, the pads, the tracks mix and the instrument. Under
  *Audio from the Central Pedal*, pick the same transport the Central Pedal
  uses (its I/O tab):
  * **Ethernet**: the best.
  * **Wi-Fi**: a little more delay. Use the *Buffer* slider to set how much.
  * **Audio interface**: its outputs are cabled into this computer's inputs.
* **Runs the mixer.** The audio engine (`cu-mixer`) runs through PipeWire's
  JACK, which is the normal set-up on current Ubuntu with `pipewire-jack`. Under
  **I/O → Audio interface**, pick the device, the buffer size, and see what every
  input and output carries. With no interface (*No interface*), the network
  channels are still mixed, recorded and streamed to the in-ears.
* **Registers with the Central Pedal**, so every other Central Control finds it
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
* A track keeps its settings from song to song, because the Central Pedal's
  channels are matched by name. "Drums" stays "Drums".
* **Listen here** plays the main mix or any in-ear mix on this computer's
  headphones (pick the output).
* **Record the service** (also in the I/O tab's *Listening & recording* card)
  records every input of the interface / Dante (up to 128), the Central
  Pedal's tracks as they arrive, and a stereo **program** (the main mix): one
  WAV per source, 48 kHz / 24 bit, in a folder per recording named with the date,
  time and the service name you type, under `~/Music/Central Usage Recordings`
  (change it in the I/O tab). After the stop the program also becomes
  `Program.mp3` for the sermon podcast. The button shows the time and the free
  disk space (a warning under 10 GB). The engine writes on its own thread, so a
  slow disk never touches the sound; the WAV headers are updated every 5 s, and a
  recording a crash cut short is repaired the next time the app starts. An admin
  on another computer can start and stop it too. For other features (services):
  `window.CU.recorder.start({ name })`, `.stop()`, `.state()`, `.on(fn)`.
* The live waveform shows what is going out.
* **Save mixer… / Open mixer…** save the whole set-up to a file and load it back.

## Talkback

* **TALK** (the main admin, and admins with the Mix, In-ears or General job): on
  the In-ears and Mix tabs and in the top bar. **Hold to talk**; a **quick tap**
  keeps it on (tap again to stop). Choose who hears it: **All**, or tick the
  mixes (shown by who has them) - remembered on this computer. **Dim the music
  in their ears** while you talk (-12 dB unless changed). The mic: on the audio
  host, any input of the interface / Dante or this computer's mic; on another
  admin computer, its own mic, sent to the audio host over the network. The
  talkback reaches both the wired packs and the phones / computers.
* **Talk to the sound desk** (User 1 / User 2): only the desk's headphones hear
  it (the listen output of the main admin and the Mix admins), never the in-ears.
* The talker's screen shows a red **ON AIR**; the people hearing it see
  "🎙 *name* talking" on their in-ear screen.

## In-ears

**Admin.** The tab has three parts:

* **Channels** (up to 128): each one is the Central Pedal's channel or an
  interface input, with a name, *Tracks* or *Band*, and whether the users see it.
* **Mixes** (up to 64, stereo): each has a name, its owner, *reserved*, and where it goes - one,
  the other, or both:
  * **Wired**: out of the audio interface or Dante on the output pair you pick, to the in-rack
    in-ear transmitters. No delay. **Auto-assign pairs** numbers them in order.
  * **Local**: back over Wi-Fi to the owner's Central Control or phone.
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
  timeline shows the waveform (from the Central Pedal's tracks), the sections
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
  * **● Record**: while the song plays (on the Central Pedal, or
    **▶ Preview here**), everything you press goes on the timeline: presets,
    flashes, each light's colour. Record again over any part to replace just
    that part.
  * **Lights**: a list of every light under the plot. Change one light's colour
    and level live, then use *+ Cue with these colours* to put them on the
    timeline.
* **Songs**: every song on the Central Pedal (it uploads them by itself),
  with or without tracks, plus your own songs. A song can have any number of
  **scenes**, each on a bar and beat or at a section. A scene programmed at 93
  BPM stays on its bar and beat when the song plays at 112. A song without
  tracks follows the Central Pedal's click, or the click here.
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
  computer's second screen, the Central Pedal's **HDMI 2** (set it to
  *Slides* on its I/O tab) and **NDI** on the network.
* **Lyrics follow the Central Pedal**: the current lyrics go to the same
  outputs. You can set the size, colour, alignment and a picture or video
  background.
* NDI needs the free NDI runtime (`libndi.so.6`, from ndi.video).

## Chord chart, Instrument, Lyrics (User)

* **Chord chart**: transposed for your instrument. This covers concert pitch,
  guitar with capo and chord shapes, B♭ / E♭ / F horns and Nashville numbers. It
  follows the song and the section.
* **Part** (next to the instrument): instead of the chart, the part for **guitar**
  (chart with capo and a diagram for every chord shape, or tab), **bass**
  (notation / tab), **keys** (both hands), **vocals** (melody with the words under
  the notes), **trumpet, clarinet, alto / tenor sax, horn in F, trombone** (in their
  own keys), **violin, cello** and **drums** (a drum chart). When the Central Pedal
  has listened to the song's tracks (its *Parts → Listen to every track*), the part
  is what that track really plays; otherwise it is written from the chords: bass on
  the roots, keys voiced close, horns and strings on guide tones, drums that follow
  the sections with fills and the song's hits. Parts follow the key the Central
  Pedal is playing in.
* **Instrument**: the Central Pedal's guitar / bass / keys rig, running on this
  computer. It uses real LV2 / LADSPA pedals through PipeWire and FluidSynth for
  the keys, so it needs `python3`, `fluidsynth` and the LV2 plugins.
* **Lyrics**: big, with what comes next.

## Lyrics + chords from the vocal (Admin)

**Lyrics tab → ♫ Lyrics + chords from the vocal** listens to the vocal track of the
song the Central Pedal is on and writes a lyric chart: the sections, lines split
where the singer breathes, and each chord on the word it lands on (chord bars where
nobody sings). The chart and the words' timing go back to the Central Pedal, so
every phone, the projector and the vocal part get them. It uses an offline speech
model on this computer (**Settings → Lyrics from the vocal**: *Accurate*, about
500 MB, or *Fast*, about 140 MB; downloaded once, nothing is sent anywhere).

## Phones and tablets (iPhone, iPad, Android)

Open **http://padpedal.local:8080/cu/** (or the Central Pedal's address) in Safari
or Chrome, choose **Join** and type the pairing code. On an iPhone or iPad, **Share →
Add to Home Screen** makes it an app icon that opens full screen. It is User 1 /
User 2: the chord chart or any instrument's part, the lyrics and your own in-ear mix
(the mix plays on the phone over Wi-Fi). It always runs the Central Pedal's
current version. (An App Store version needs an Apple developer account - see
`IOS-APP-STORE.md`.)

## Settings

This is where you set this computer's name and role (and, on the main admin, the
PIN, the pairing code and the People list), the optional AI model for the lights,
the speech model for lyrics, and updates (*Check for updates…*).

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
npm start              # copies the shared files from the Central Pedal folder, builds native/, runs it
npm run dist           # .deb + AppImage into dist/
```
`prepare-shared.sh` copies the Instrument page and the instrument host from the
Central Pedal folder. It also builds `native/` (the engine `cu-mixer` and the
NDI sender `cu-ndi`). These need only a C compiler, because libjack and libndi
are loaded at run time.

## Test

* `node test-usage.mjs` runs the page against the simulated Central Pedal. It
  covers the chart, the lyrics, the rule that only the Central Pedal moves the
  tracks, the MIDI relay, and the lighting: modes, songs and scenes at another
  tempo, recording and recording over, every light's colour, the chat box, DMX
  values, the fixture library, movers, the phone remote and timecode.
* `xvfb-run -a node test-host.mjs` covers the audio host end to end. The
  simulated Central Pedal sends its tracks over the network, and the real app
  maps them, mixes them and records them. A phone takes a mix, sets its own
  levels and hears it over Wi-Fi. It also checks that users can't change other
  mixes, and that the lights get the waveform and the music's level.
* `xvfb-run -a node test-talkback.mjs` covers talkback (latch, hold, who hears
  it, ON AIR, another admin's mic over the network, a user talking to the desk,
  the note on a phone) and recording (the Mix tab's control, the files, the MP3,
  `CU.recorder`, an admin elsewhere starting it, the repair after a crash).
* `node native/test-mixer.mjs` covers the engine alone, including the talkback
  mix-in and dim, the recorded WAVs and `cu-mixer --repair`.
* `xvfb-run -a node test-app.mjs` covers the phone remote and the updater.
* `node test-dmx.mjs` covers the packets and one output per universe.
