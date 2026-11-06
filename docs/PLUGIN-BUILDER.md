# The plugin builder (Central FX)

Central Production's plugin builder lets you make your own effect by wiring blocks together, by writing a little code, or with a mix of both. What you end up with is a **Central FX plugin**, which is one small `.cmfx.json` file.

It plays on the Central Pedal (on boards, through the pedal's extra stage), in Central Usage and Central Control (on boards and in the Studio's effects), in the website's studio and in Central Production. They all play it with the same engine, so a plugin sounds the same on the pedal as it does in your browser.

## Making one with blocks

1. Drag blocks from the list on the left onto the canvas.
2. Wire them together: drag from a block's right-hand dot to another block's left-hand dot. **Sound in** is where the sound arrives and **Sound out** is what your plugin plays.
3. Click a block to change its settings on the right.
4. If a setting should be something people turn, choose **Make it a knob** under it. It then shows on your plugin's panel at the bottom.

Round dots and solid wires carry sound. Diamond dots and dashed wires carry control, meaning something that moves a setting. An LFO wired into a filter's frequency, for example, makes the filter sweep.

| Group | Blocks |
|---|---|
| Sound in and out | where the sound arrives and leaves |
| Tone | filter (lowpass, highpass, bandpass, notch, peak, shelves) and EQ band |
| Space | delay (with feedback, tone and ping-pong) and reverb |
| Movement | chorus/flanger, phaser, tremolo/auto-pan and pitch shift |
| Grit | drive (soft, hard, tube, fuzz, fold) and bitcrush |
| Dynamics | compressor (with a key input for side-chain), limiter and gate |
| Mixing | volume, blend (dry/wet) and stereo (width, pan, mono, swap) |
| Control | LFO (a slow wave), envelope follower (follows how loud the sound is), maths (add, multiply, map, smooth and more) and knob (sends one of your knobs into the wiring) |
| Code | your own code, as one block in the wiring |

### Keeping a delay in time with the song

Select a Delay block and pick a note under **Sync to tempo** (a quarter, a dotted
eighth, an eighth triplet and so on). The builder adds a Tempo knob to the plugin (or uses the one it has) and wires a
Maths block into the delay's time: the note's length × 60000 ÷ the Tempo knob, in ms. The apps turn every knob with the
unit BPM to the song's tempo, so the repeats stay on the note wherever the plugin plays. Pick Off and the two blocks go
again. Those are ordinary blocks, so the plugin plays the same on the Central Pedal, in the rig and in a browser.

A knob in ms that sets a delay's time can follow the tempo too: give it `"tempoSync": true` (the collection's Delay, Tape
Echo and Ping-Pong do), or call it `time` or `delay` with the unit `ms`. The apps then show **Sync to tempo** with a note
next to the plugin, and set that knob from the song's tempo when it's on.

### What the builder won't let you do

A wire can't go round in a loop, so for repeats use a delay's feedback. A plugin has to have a Sound out. And a plugin can have up to 64 blocks, 256 wires and 32 knobs.

**Tidy up** lines the blocks up in the order the sound flows. **Undo** and **Redo** work everywhere, and Ctrl+Z works too.

## Making one with code

Open the **Code** tab. Code can be one block inside the wiring, or the whole plugin (**Make the whole plugin code**). Mistakes show straight away with their line number.

```
// A ring modulator
@sample
ph += freq / srate
ph -= floor(ph)
m = sin(2 * pi * ph)
outL = mix(inL, inL * m, amount)
outR = mix(inR, inR * m, amount)
```

Code comes in sections. `@init` runs once at the start, `@block` runs before each block of samples, and `@sample` runs for every sample. If you don't write any sections, it's all `@sample`.

`inL` and `inR` are the sound coming in. `outL` and `outR` are what you send out, and they start out as the input. `srate` is the number of samples per second. Each of your knobs is a name you can read, by its id, and in a code block `c1` to `c4` are the block's control inputs.

You get the operators `+ - * / % ^`, comparisons, `&& || !` and `c ? a : b`, and these functions:

```
sin cos tan tanh exp log log10 log2 sqrt abs floor ceil round sign atan atan2 pow min max clamp mix fmod db2gain gain2db rand noise
```

Variables keep their value from one sample to the next. `array buf[1024]` is a list of numbers, and `buf[i]` wraps around so it never runs off the end. `delay echo[2000]` is a delay line up to 2000 ms long, used with `echo.write(x)` and `echo.read(ms)`.

For control there's `if (...) { } else { }` and `loop (n) { }`. A loop runs at most 4096 times, and there are no `while` or `for` loops.

## Why it's safe

A Central FX plugin isn't a program. It's a description that our own engine plays. It has no files, no internet and no system calls, and its loops have a limit. Code that does too much work per sample is switched off and the sound passes straight through. A number that blows up, from dividing by zero for example, restarts the code instead of making noise.

That's why Central FX plugins play on Windows too, and don't need the walled-off process that other community plugins use (see [COMMUNITY-PLUGINS.md](COMMUNITY-PLUGINS.md)).

Shared ones still go through the same steps as any community item:

1. On the website, upload the `.cmfx.json` under **Plugin → Every device**. The website checks it with the same engine.
2. Motion Audio reviews it and gives it its stars.
3. The apps check the file's sha256 before they install it, and again every time it starts.

After that, turning **Allow community plugins** off stops it while it plays, and if Motion Audio takes it down, it stops and is removed.

## The examples

The builder ships with these, under **Examples…**:

| Example | What it does |
|---|---|
| Shimmer Reverb | a big reverb with a soft octave above |
| Tape Delay | darker repeats with a little wobble |
| Vocal De-esser | tames sharp S sounds |
| Tremolo | the classic amp pulse |
| Auto-Wah | opens up as you play harder |
| Lo-Fi Radio | thin and crunchy |
| Soft Clipper (code) | a whole plugin in code |
| Ring Modulator (code) | a whole plugin in code |

## The Central FX collection

Motion Audio's own effects are built on the same engine. There are 32 of them, in `production/plugin-collection/`, made by `tools/make-cmfx-collection.py`. The basic one of each kind is free. The others come with the Central Plugins plan.

| Kind | Free | With Central Plugins |
|---|---|---|
| Reverb | Room Reverb | Vocal Plate, Lush Hall, Worship Shimmer |
| Delay | Delay (its time can follow the tempo) | Dotted Eighth (follows the song's tempo), Ping-Pong and Tape Echo (their time can follow the tempo) |
| Compressor | Compressor | FET (1176-style), Opto Leveler (LA-2A-style), Bus Glue, Multiband, De-esser Pro |
| Dynamics | Gate | Transient Shaper |
| EQ | 4-Band EQ, Low & High Cut | 8-Band Parametric, Tilt EQ |
| Character | Chorus, Tremolo / Auto-pan | Dimension Chorus, Rotary Speaker, Phaser, Flanger, Tape Saturation, Exciter, Lo-Fi Filter |
| Stereo and level | Limiter | Stereo Widener, True-Peak Limiter |

Each one has its own knobs and three or four starting points. You'll find them wherever effects go: the track, pad and stem effects, Add effect in the Studio and Central Production, Add pedal → Central FX on pedal boards, and Central Control's channel inserts (up to 4 per channel, after the compressor). The locked ones say which plan they need.

The engine picked up a few things along the way to make these. The reverb is an 8-line feedback network with slowly moving delays, so it's dense and doesn't ring. In the pitch shifter each new grain lines up with the one already playing, so held notes stay steady, which makes for a better shimmer. The compressor has styles (clean, fet, opto, glue), RMS or peak detection and a side-chain low cut. Drive can oversample 2x or 4x so the harmonics it makes don't alias. The limiter has look-ahead and true-peak detection. And there are three new blocks: band split, transient shaper and rotary speaker.

`node test-cmfx-collection.mjs` checks every plugin and starting point (native and WebAssembly sound the same) and its CPU use, and measures the engine against reference behaviour.

## For developers

### Where the code lives

| What | Where |
|---|---|
| The engine (C) | `central-usage/native/cmfx/` |
| The browser player | `production/cmfx/cmfx.js` |
| The builder | `production/plugin-builder/` (`CPPluginBuilder.mount(el, plugin, { onChange, onTest })`) |

`tools/build-cmfx.sh` builds the engine to WebAssembly into `production/cmfx/cmfx.js` and copies that file into `central-usage/app/`, `js/` and `server/public/studio/lib/`. Run it after changing the C.

The browser player has `CMFx.create(audioContext, plugin)`, which returns `{ node, setParam, dispose }`, `CMFx.check(plugin)` and `CMFx.checkCode(text)` to check a plugin or a piece of code, and `CMFx.render(...)` to render sound without an audio device.

The rig and the Central Pedal play format `"cmfx"` plugins through `plughost/fmt_cmfx.cpp`. A scan finds `.cmfx.json` files in `<data>/central-fx` and in `CENTRAL_FX_PATH`.

### Tests

| Test | What it checks |
|---|---|
| `node test-cmfx.mjs` | native and WebAssembly sound the same for every block, the code language, hostile scripts, the presets, the upload check and both installers |
| `node central-usage/native/cmfx/test-rig-cmfx.mjs` | the rig and the Pi's stage |
| `node test-plugin-builder.mjs` | the builder in a browser |
