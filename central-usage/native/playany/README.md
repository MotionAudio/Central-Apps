# Play any sound

A guitar, bass or acoustic (anything with a ¼″ or ⅛″ output) plays any installed sound, analysed live:

- **Notes**: a single note (a lead line) is tracked and played as a MIDI note by the keys engine with the chosen
  sound: note on / off, plus pitch bend for bends and vibrato (±2 semitones).
- **Synth**: chords play a guitar-synth sound made from the input itself, with no note detection, so it follows
  chords at once.
- **Auto** switches between the two by itself. A clear single pitch plays notes. A chord switches to the synth:
  either no clear pitch arrives by about 1.6 periods of the lowest note, or the spectrum shows two or more
  harmonic series.
- **Dry blend** mixes in the guitar itself (with its pedals). **Sensitivity** sets the gate level, the onset
  threshold and the pitch thresholds.

## Files

| file | what |
|---|---|
| `playany.h`, `playany.c` | The DSP: plain C99, no dependencies, no allocation while processing. |
| `playany-plugin.c` | The DSP as a plugin for the Raspberry Pi: one `.so` that is both LADSPA (`central_playany`) and LV2 (`central-playany.lv2/`). |
| `test-playany.c` | Unit test with synthetic signals: pitch accuracy, lead vs chord, latency in samples, CPU. |
| `test-playany-plugin.c` | Loads the plugin the way PipeWire does and checks that its notes reach a stand-in FluidSynth shell. |

## How it works (`playany.c`)

```
input → DC block ─┬─ synth mode: 6 band-pass filters (one per string region) → a square wave per band at
                  │   the band's level (+ a ÷2 sub octave) → resonant low-pass that follows the playing
                  │   → swell / gate → synth output
                  └─ anti-alias → ~12 kHz (6 kHz for bass) → 2 kHz one-pole → ring buffer
                       every sample:  onset = the level doubles within 8 ms, or a pick burst (high frequencies)
                       every ~1.3 ms: pitch = MPM (normalised square difference) over the samples since the onset,
                                      decided after (1 + 0.6) periods (2 hops agreeing, or clarity ≥ 0.97)
                       every ~5 ms:   spectrum (512 / 1024-point FFT) → peaks that are new since the onset →
                                      grouping into harmonic series = how many notes sound
```

These details keep lead lines clean:

- **The previous notes may still ring.** In a lead line played across strings, the notes before the new one
  keep sounding. The pitch is also measured with those notes cancelled by comb filters at their periods, and
  the clearer result wins. The spectrum only counts peaks that grew at least 6 dB since the onset, so a decaying
  old note isn't mistaken for a chord.
- **Virtual pitches.** A power chord or a third can look like one low note, because together they are periodic
  at a "virtual" fundamental. That pitch only counts as a note when the spectrum has a real peak at that
  fundamental.
- **Legato.** A pitch that settles on a new note without a new pluck (hammer-on, pull-off, slide) starts a new
  note. Slow movement (a bend or vibrato) becomes pitch bend instead.
- **Strumming after a rest.** In Auto, if the last thing played was a chord less than 2 s ago, a new strum
  starts the synth at once. A single note found in the next few milliseconds takes over.

## Where it runs

- **Raspberry Pi**, and Linux with PipeWire (`instrument_host.py`):
  - `central-playany.so` is a LADSPA node inside the guitar's PipeWire filter-chain. It hears the input after
    the input gain and before the gate. A mixer per channel blends the chain's output at the dry blend with the
    plugin's synth output.
  - Notes go from a thread of the plugin to FluidSynth's shell on channel 10, which plays the chosen SoundFont
    preset. The audio thread never waits.
  - FluidSynth's output is linked to the same output channel(s) as the instrument.
  - On / off, mode, sensitivity, dry blend and sound change live with `pw-cli set-param`. Only the first time
    play any sound is turned on for an instrument is the chain rebuilt.
  - The plugin comes from `bin/linux-<arch>/` in the Pi release (CI cross-compiles it for arm64), from
    `native/` in Central Control, or from the dev build. Failing those, it is compiled on the Pi from these
    sources the first time.
- **Windows, macOS, and Linux without PipeWire** (`cu-rig`): `playany.c` is built into the rig. Notes play the
  chosen bank through TinySoundFont on its own channel, in the same audio block. The synth output and the dry
  guitar are mixed after the pedal chain.

## Measured

Measured with `test-playany` at 48 kHz, x86-64. The same test passes on arm64 under qemu.

| signal | first note right | right at 300 ms | note-on delay: median | lowest octave | second octave | above |
|---|---|---|---|---|---|---|
| sine, E2–E6 | 49/49 | 49/49 | 6.2 ms (299 samples) | 17.5 ms | 8.7 ms | 5.0 ms |
| plucked string, E2–E6 | 49/49 | 49/49 | 6.2 ms | 16.2 ms | 8.7 ms | 3.7 ms |
| bridge pickup, quiet (−26 dBFS) | 49/49 | 49/49 | 6.2 ms | 16.2 ms | 8.7 ms | 5.0 ms |
| bass, E1–G4 | 40/40 | 40/40 | 16.6 ms | 33.3 ms | 20.0 ms | 10.0 ms |

- **Note-on delay.** The note is decided about 1.6 periods after the pluck. That is the physical limit for the
  lowest notes: the low E string's period alone is 12 ms, and a bass's low E is 24 ms.
- **Lead lines.** Half the notes are on the same string and the rest ring on: 124–127 of 128 notes are right
  over several random seeds, with 0.2–0.6 % of the time in synth mode. When every note rings on under the next
  ones (an arpeggio, really), 122–127 of 128 are right.
- **Chords.** In Auto, 16 of 16 strummed chords switch to synth mode: E, A, D, G, C, Em, Am, a barre E, the
  triads, power chords, a 2-note third, Dm7 and B. The first strum takes 25–30 ms. Strumming again after a rest
  switches at once (≤ 2.7 ms, one block).
- **Synth mode.** The output starts 0.7 ms after the input (median; at most 1.9 ms). Through PipeWire on a real
  filter-chain it starts 2 ms after the dry guitar.
- **Note mode through PipeWire + FluidSynth.** Measured end to end against the guitar itself
  (`test_instrument_host.py`): the piano is heard 12–14 ms after the guitar. That covers detection, FluidSynth's
  buffer and the piano's own attack.
- **CPU.** 3 % of one x86 core for guitar in Auto with the synth on.
