# Central Pedals (10.3)

Motion Audio's own pedals: 55 effects written in plain C (`mapedals.c`), all our own code.

The same code runs in two places, so a board sounds the same on both:

- **Computers.** It's built into cu-rig, which Central Control, Central Usage, Central Production and Central Pedal Control use.
- **The Raspberry Pi.** It's built as `central-pedals.so`, a LADSPA library that PipeWire's filter-chain loads. `instrument_host.py` finds it in `bin/linux-<arch>/`. If it isn't there, the host builds it from these sources.

The families:
- drives and fuzzes (clear, mid hump, low-gain blues, Gold Horse with a clean blend, British, high gain, germanium, silicon, octave fuzz)
- bass drive and bass preamp
- amps with their own cabinet, which you can switch off to use an IR from the IR library (American clean, British crunch, high gain, bass)
- compressors (VCA, optical, squash) and a gate
- acoustic preamp (with a feedback notch) and acoustic body
- chorus, tri chorus, flanger, phaser, uni vibe, rotary, harmonic and square tremolo, ring modulator
- octave up, sub octave, harmonizer, whammy
- envelope filter, auto wah, wah, synth filter
- delays: analog, tape, digital, dotted eighth, multi-head, backwards
- reverbs: spring, plate, hall, shimmer, auto-swell, freeze
- utility: volume, 7-band graphic EQ, parametric EQ, clean boost, tuner mute

## Adding or changing a pedal

1. Edit the `DEFS` table, and the DSP if it needs any.
2. Update the plugin list:
   ```
   make -C central-usage/native build/test-mapedals
   central-usage/native/build/test-mapedals --json > /tmp/p.json
   python3 tools/make-pedal-plugins.py /tmp/p.json
   ```
   This writes the entries in `instrument-plugins.json`.
3. Add the pedal to `js/pedals.js` with its knob labels.

`make test-mapedals` checks these things:
- every pedal on its own, with every knob at its lowest, at its highest and at random settings (finite, never runs away, quiet after silence);
- what each family is meant to do (drive adds harmonics, compressors close the gap, delays repeat on time, reverbs fade at about the length asked for, octaves and harmonies land on the right notes, and so on);
- that the plugin list is up to date;
- the LADSPA library, loaded the way PipeWire loads it.

## CPU

`make pedals-cpu` prints what each pedal costs at the rig's block of 128.

On the CI-class x86 machine (Xeon at 2.1 GHz, one core), the best of three runs:
- **Median pedal:** 44 ns a sample.
- **Dearest pedal:** 157 ns a sample (Tri Chorus; the plate and hall are about 130).
- **"Worship Lead: Dotted Eighth" board** (6 pedals): 356 ns a sample, which is 1.7% of one core at 48 kHz.

A Raspberry Pi 4 (Cortex-A72 at 1.5 GHz) is about 3 to 4 times slower on this kind of scalar float code. That puts it at:
- **The dearest pedal:** about 3% of one core.
- **A full six-pedal board:** about 7% of one core.

The Pi runs the chain at 128 frames (2.7 ms). That leaves plenty of room beside the pads and FluidSynth.
