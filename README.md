# Motion Studio

Motion Audio's own DAW, for macOS (Apple Silicon and Intel) and Linux. Black and gold, built for making worship
tracks, pads, loops and full songs, with every Motion Audio pedal and plugin built in.

## Get it running on your Mac

1. Open Terminal in this folder (right-click the folder in Finder > New Terminal at Folder).
2. Run:

   ```
   bash scripts/build-mac.sh
   ```

   The first time, macOS may ask to install the Xcode Command Line Tools: say yes, then run the line again.
   The first build takes 20 to 40 minutes. You get `MotionStudio.dmg` here.
3. Open the .dmg and drag **Motion Studio** into Applications.
4. The first time you open it: right-click the app > **Open** > **Open** (it isn't signed with an Apple developer
   account, so macOS asks once). If macOS says it "can't be opened", go to System Settings > Privacy & Security and
   press **Open Anyway**.

GitHub can build the .dmg for you instead: push this folder to a branch called `motion-studio` and the workflow in
`.github/workflows/build-mac.yml` builds it on a Mac runner (Actions tab > the run > Artifacts > MotionStudio-mac).

## What's in it

**Three views** (top right): **Tracks** (the timeline, like Logic and Pro Tools), **Live** (clips and scenes you
launch in time, like Ableton's Session view) and **Mixer**.

- **Tracks:** instrument and audio tracks, clips you drag, copy (Alt-drag), trim (edges), fade (top corners) and split
  (Cmd T). Cycle range on the ruler, snap to grid, zoom (Cmd scroll), follow playhead, record with count-in and punch.
- **Live:** a grid of clip slots per track and 8+ scenes. Launch quantised to the bar (or 2 / 4 bars, a beat, or
  immediately). "Back to Tracks" hands every track back to its timeline.
- **Mixer:** instrument slot, inserts, sends to the returns, pan, fader with a gold meter, mute / solo / record,
  master inserts.
- **Editor** (bottom): the piano roll (draw, move, resize, velocity lane, quantize, drum names for Motion Drums),
  audio clip settings (gain, pitch, follow tempo / warp, loop, reverse, fades), the selected track's devices with
  their knobs (like Ableton's device view), and a playable keyboard.
- **Browser** (left): drag anything onto a track or a mixer channel; double-click to add it to the selected track.
- **Plugins:** Audio Units and VST3 (Settings > Plugins > Scan). Motion Audio's own are always there.
- **Bounce** the mix (Cmd B) or **stems** (Cmd Shift B) to WAV, AIFF or FLAC, 24-bit.
- **Musical Typing** (Cmd K): play the selected instrument from the computer keyboard.
- Saves `.motionstudio` songs in their own folders under `~/Music/Motion Studio/Projects`, with a backup every
  two minutes.

## Motion Audio's plugins, built in

All of these are the same code the Central Pedal and the Central apps run, so they sound the same:

- **55 Central Pedals** (drives, fuzzes, amps with cabinets, compressors, acoustic preamp and body, chorus, phaser,
  vibe, rotary, tremolos, octaves, harmonizer, whammy, filters and wahs, analog / tape / dotted-eighth / multi-head /
  backwards delays, spring, plate, hall, shimmer, swell and freeze reverbs, EQs) - each a plugin with its own stompbox.
- **Motion Pedalboard** with Motion Audio's **32 boards** as presets (Worship Lead: Dotted Eighth, Worship Swells,
  Ambient Freeze Pad, Blues: Gold Horse Push, Acoustic: Worship, Bass: Modern Grind, Keys: Pad Into Shimmer...).
  An Expression knob can drive the wah, whammy and volume pedals.
- **The Central FX plugin collection** (32: Lush Hall, Vocal Plate, Worship Shimmer, Dotted Eighth, Tape Echo, FET
  Compressor, Opto Leveler, Multiband Compressor, True-Peak Limiter, Tape Saturation, Exciter, De-esser Pro...).
  Drop your own plugins from Central Production's plugin builder (`.cmfx.json`) in `~/Music/Motion Studio/Plugins`.
- **Motion Keys:** plays SoundFont banks. "Get Motion Audio sounds" downloads the free FreePats banks the Central apps
  use (pianos, organs, pads, strings, basses, guitars, bells). With no bank it plays a built-in electric piano.
- **Motion Pads:** a worship pad synth (Warm, Worship, Sunday, Air, Shimmer, String, Choir, Glass, Swell, Analog
  Sweep, Dark, Bell) through the Central Pedals' Octave Shimmer, with one-finger fifths.
- **Motion Drums:** a General MIDI kit (Studio, 808, Soft / Brushes).

Plus Tracktion's built-ins (4OSC synth, sampler, EQ, compressor, reverb, delay, chorus, phaser, pitch shifter,
impulse responses) and 186 Airwindows effects.

## Building on Linux

```
sudo apt install build-essential cmake ninja-build libasound2-dev libjack-jackd2-dev ladspa-sdk libcurl4-openssl-dev \
  libfreetype-dev libfontconfig1-dev libx11-dev libxcomposite-dev libxcursor-dev libxext-dev libxinerama-dev \
  libxrandr-dev libxrender-dev libxi-dev libgl1-mesa-dev
bash scripts/get-deps.sh
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build
./build/MotionStudio_artefacts/Release/Motion\ Studio
```

## Checks

- `Motion Studio --render-demo demo.wav` builds the demo song and bounces it (no window).
- `Motion Studio --test-roundtrip` saves a song with Motion Audio plugins, reopens it and compares.
- `Motion Studio --plugin-shot motion:board:worship-dotted board.png` draws a plugin's editor.

## Licences

Motion Studio is for Motion Audio's own use. It's built on JUCE and Tracktion Engine under the GPLv3
(`ThirdParty/TRACKTION-LICENSE.md`). TinySoundFont is MIT (`ThirdParty/tsf/LICENSE-TinySoundFont`). The Archivo
font is OFL. The Central Pedals and Central FX code is Motion Audio's own. Sound banks from FreePats are CC0 or
CC-BY 3.0 (the Salamander / YDP grand pianos: Alexander Holm et al.).
