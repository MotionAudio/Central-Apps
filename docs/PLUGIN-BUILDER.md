# The plugin builder (Central FX)

Central Production's plugin builder lets anyone make their own effect, either by wiring blocks together or by writing a little code, or both. What you make is a **Central FX plugin**: one small `.cmfx.json` file. It plays the same in every app:

- the Central Pedal (boards, through the pedal's extra stage)
- Central Usage and Central Control (boards, and the Studio's effects)
- the website's studio
- Central Production

Because every app plays it with the same engine, a plugin sounds the same on the pedal as it does in your browser.

## Making one with blocks

1. Drag blocks from the list on the left onto the canvas.
2. Wire them together: drag from a block's right-hand dot to another block's left-hand dot. **Sound in** is where the sound arrives and **Sound out** is what your plugin plays.
3. Click a block to change its settings on the right.
4. If a setting should be something people turn, choose **Make it a knob** under it. It then shows on your plugin's panel at the bottom.

**Wire colours:**
- Round dots and solid wires carry sound.
- Diamond dots and dashed wires carry control: something that moves a setting. For example, an LFO wired into a filter's frequency makes the filter sweep.

**The blocks:**
- **Sound in and out**
- **Tone:** filter (lowpass, highpass, bandpass, notch, peak, shelves) and EQ band
- **Space:** delay (with feedback, tone and ping-pong) and reverb
- **Movement:** chorus/flanger, phaser, tremolo/auto-pan and pitch shift
- **Grit:** drive (soft, hard, tube, fuzz, fold) and bitcrush
- **Dynamics:** compressor (with a key input for side-chain), limiter and gate
- **Mixing:** volume, blend (dry/wet) and stereo (width, pan, mono, swap)
- **Control:**
  - LFO: a slow wave
  - envelope follower: follows how loud the sound is
  - maths: add, multiply, map, smooth and more
  - knob: sends one of your knobs into the wiring
- **Code:** your own code, as one block in the wiring

**Rules the builder enforces for you:**
- A wire can't go round in a loop. For repeats, use a delay's feedback.
- A plugin needs a Sound out.
- A plugin can have up to 64 blocks, 256 wires and 32 knobs.

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

**Sections:**
- `@init` runs once at the start.
- `@block` runs before each block of samples.
- `@sample` runs for every sample. It's the default if you don't write any sections.

**The sound:**
- `inL` and `inR` are the sound coming in.
- `outL` and `outR` are what you send out. They start as the input.
- `srate` is the number of samples per second.

**Your knobs:** each knob is a name you can read, by its id. In a code block, `c1` to `c4` are its control inputs.

**Maths:**
- Operators: `+ - * / % ^`, comparisons, `&& || !`, and `c ? a : b`
- Functions: `sin cos tan tanh exp log log10 log2 sqrt abs floor ceil round sign atan atan2 pow min max clamp mix fmod db2gain gain2db rand noise`

**Memory:**
- Variables keep their value from one sample to the next.
- `array buf[1024]` is a list of numbers. `buf[i]` wraps around, so it never goes past the end.
- `delay echo[2000]` is a delay line up to 2000 ms long. Use `echo.write(x)` and `echo.read(ms)`.

**Control:** `if (...) { } else { }` and `loop (n) { }`. A loop runs at most 4096 times, and there are no `while` or `for` loops.

## Why it's safe

A Central FX plugin isn't a program. It's a description that our own engine plays:

- There are no files, no internet and no system calls.
- Loops are bounded.
- Code that does too much work for each sample is switched off, and the sound passes straight through.
- A number that blows up (dividing by zero, for example) restarts the code instead of making noise.

That's why Central FX plugins play on Windows too, and don't need the walled-off process that other community plugins use (see [COMMUNITY-PLUGINS.md](COMMUNITY-PLUGINS.md)).

Shared ones still go through the same steps as every community item:

1. **Upload:** on the website, upload the `.cmfx.json` under **Plugin → Every device**. The website checks it with the same engine.
2. **Review:** Motion Audio reviews it and gives it its stars.
3. **Install:** the apps check the file's sha256 before they install it, and again each time it starts.
4. **Off switch:** turning **Allow community plugins** off stops it live.
5. **Taken down:** if Motion Audio takes it down, it stops live and is removed.

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

## For developers

**Where the code lives:**

| What | Where |
|---|---|
| The engine (C) | `central-usage/native/cmfx/` |
| The browser player | `production/cmfx/cmfx.js` |
| The builder | `production/plugin-builder/` (`CPPluginBuilder.mount(el, plugin, { onChange, onTest })`) |

`tools/build-cmfx.sh` builds the engine to WebAssembly into `production/cmfx/cmfx.js` and copies that file into `central-usage/app/`, `js/` and `server/public/studio/lib/`. Run it after changing the C.

The browser player's calls:
- `CMFx.create(audioContext, plugin)` returns `{ node, setParam, dispose }`.
- `CMFx.check(plugin)` and `CMFx.checkCode(text)` check a plugin or a piece of code.
- `CMFx.render(...)` renders sound without an audio device.

**The rig and the Central Pedal** play format `"cmfx"` plugins through `plughost/fmt_cmfx.cpp`. A scan finds `.cmfx.json` files in `<data>/central-fx` and in `CENTRAL_FX_PATH`.

**Tests:**

| Test | What it checks |
|---|---|
| `node test-cmfx.mjs` | native and WebAssembly sound the same for every block, the code language, hostile scripts, the presets, the upload check and both installers |
| `node central-usage/native/cmfx/test-rig-cmfx.mjs` | the rig and the Pi's stage |
| `node test-plugin-builder.mjs` | the builder in a browser |
