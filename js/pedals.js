/* Central Control - the pedal catalogue: 100+ stompboxes, amps, cabs and studio
 * effects, each one a real free LV2 / LADSPA plugin that runs natively on the Pi
 * (Guitarix, Calf, LSP, x42, Zam, Dragonfly, mda, swh, TAP, CAPS, Invada...).
 * `knobs` map a friendly label to the plugin's control symbol; ranges and
 * defaults come from the plugin itself (the driver reads them with lilv).
 * The "custom" category are our own boards made from several plugins. */
(function (global) {
  "use strict";
  var GX = "http://guitarix.sourceforge.net/plugins/";
  var CALF = "http://calf.sourceforge.net/plugins/";
  var SWH = "http://plugin.org.uk/swh-plugins/";
  var LSP = "http://lsp-plug.in/plugins/lv2/";
  var MDA = "http://drobilla.net/plugins/mda/";
  var X42 = "http://gareus.org/oss/lv2/";
  // category: colour + icon used by the pedal graphics
  var CATEGORIES = {
    boost: { name: "Boost & overdrive", color: "#3f9f5a" }, dist: { name: "Distortion", color: "#d9542b" }, fuzz: { name: "Fuzz", color: "#8e44ad" },
    comp: { name: "Compressor & gate", color: "#2a7fd4" }, eq: { name: "EQ & tone", color: "#2d8f8b" }, wah: { name: "Wah & filter", color: "#c9a227" },
    mod: { name: "Chorus, phaser, flanger", color: "#1f8ba6" }, trem: { name: "Tremolo & vibrato", color: "#b0557e" }, pitch: { name: "Octave & pitch", color: "#6a5acd" },
    delay: { name: "Delay & echo", color: "#2f6b9a" }, reverb: { name: "Reverb & ambience", color: "#5b8c5a" }, amp: { name: "Amps & preamps", color: "#8a6d3b" },
    cab: { name: "Cabinets", color: "#555f6b" }, util: { name: "Utility", color: "#6c757d" }, acoustic: { name: "Acoustic", color: "#c8793b" }
  };
  // id, name, category, plugin uri, knobs {label: symbol}, optional {mono: true} notes
  var P = [
    // ---- boost / overdrive (Guitarix)
    ["booster", "Clean Booster", "boost", GX + "gxbooster#booster", { Level: "Level", Bass: "Bass", Treble: "Treble" }],
    ["ts9", "Green Screamer (TS9)", "boost", GX + "gxts9#ts9sim", { Drive: "drive", Tone: "tone", Level: "level" }],
    ["scream", "Scream Drive", "boost", GX + "gx_scream_#_scream_", { Drive: "Drive", Tone: "Tone", Level: "Level" }],
    ["rangem", "Treble Rangemaster", "boost", GX + "gx_rangem_#_rangem_", { Boost: "Boost" }],
    ["tilttone", "Tilt Tone", "eq", GX + "gxtilttone#tilttone", { Tilt: "Tilt", Freq: "Freq" }],
    ["hornet", "Hornet Overdrive", "boost", GX + "gx_hornet_#_hornet_", { Gain: "Gain", Tone: "Tone", Volume: "Volume" }],
    ["hogsfoot", "Hogs Foot (Blues OD)", "boost", GX + "gx_hogsfoot_#_hogsfoot_", { Drive: "Drive", Tone: "Tone", Level: "Level" }],
    ["alembic", "Alembic Preamp", "amp", GX + "gx_alembic#alembic", { Volume: "Volume", Bass: "Bass", Treble: "Treble", Bright: "Bright" }],
    ["mole", "Mole (bass OD)", "boost", GX + "gx_mole_#_mole_", { Drive: "Drive", Tone: "Tone", Level: "Level" }],
    // ---- distortion
    ["ds1", "Orange Distortion (DS-1)", "dist", GX + "gx_bossds1_#_bossds1_", { Dist: "Dist", Tone: "Tone", Level: "Level" }],
    ["mxrdist", "Yellow Dist+", "dist", GX + "gx_mxrdist_#_mxrdist_", { Distortion: "Distortion", Output: "Output" }],
    ["susta", "Sustainer", "dist", GX + "gx_susta_#_susta_", { Sustain: "Sustain", Level: "Level" }],
    ["aclipper", "Asymmetric Clipper", "dist", GX + "gx_aclipper_#_aclipper_", { Drive: "Drive", Tone: "Tone", Level: "Level" }],
    ["mbdist", "Multiband Distortion", "dist", GX + "gx_mbdistortion_#_mbdistortion_", { Drive1: "drive1", Drive2: "drive2", Drive3: "drive3", Drive4: "drive4", Drive5: "drive5", Level: "level" }],
    ["mda-od", "mda Overdrive", "dist", MDA + "Overdrive", { Drive: "drive", Muffle: "muffle", Output: "output" }],
    ["mda-combo", "mda Combo (amp + cab)", "amp", MDA + "Combo", { Drive: "drive", Bias: "bias", Output: "output", Model: "model" }],
    ["caps-sat", "C* Saturate", "dist", "ladspa:caps.so:Saturate", {}, { ladspa: "caps.so", label: "Saturate" }],
    ["caps-tonestack", "C* Tone Stack (amp EQ)", "amp", "ladspa:caps.so:ToneStack", {}, { ladspa: "caps.so", label: "ToneStack" }],
    ["caps-compress", "C* Compress", "comp", "ladspa:caps.so:Compress", {}, { ladspa: "caps.so", label: "Compress" }],
    ["caps-chorus", "C* Chorus I", "mod", "ladspa:caps.so:ChorusI", {}, { ladspa: "caps.so", label: "ChorusI" }],
    ["caps-phaser", "C* Phaser II", "mod", "ladspa:caps.so:PhaserII", {}, { ladspa: "caps.so", label: "PhaserII" }],
    ["caps-autofilter", "C* Auto Filter", "wah", "ladspa:caps.so:AutoFilter", {}, { ladspa: "caps.so", label: "AutoFilter" }],
    ["caps-noisegate", "C* Noise Gate", "comp", "ladspa:caps.so:Noisegate", {}, { ladspa: "caps.so", label: "Noisegate" }],
    ["caps-eq10", "C* 10-band EQ", "eq", "ladspa:caps.so:Eq10", {}, { ladspa: "caps.so", label: "Eq10" }],
    ["caps-spice", "C* Spice (enhancer)", "eq", "ladspa:caps.so:Spice", {}, { ladspa: "caps.so", label: "Spice" }],
    // ---- fuzz
    ["fuzz", "Classic Fuzz", "fuzz", GX + "gx_fuzz_#fuzz_", { Fuzz: "fuzz", Level: "level" }],
    ["fuzzface", "Fuzz Face", "fuzz", GX + "gx_fuzzface_#_fuzzface_", { Fuzz: "Fuzz", Level: "Level" }],
    ["fuzzfacefm", "Fuzz Face FM", "fuzz", GX + "gx_fuzzfacefm_#_fuzzfacefm_", { Fuzz: "Fuzz", Level: "Level" }],
    ["muff", "Big Muff", "fuzz", GX + "gx_muff_#_muff_", { Sustain: "Sustain", Tone: "Tone", Volume: "Volume" }],
    ["bmp", "Big Muff Pi", "fuzz", GX + "gx_bmp_#_bmp_", { Sustain: "Sustain", Tone: "Tone", Volume: "Volume" }],
    ["cstb", "Tone Bender", "fuzz", GX + "gx_cstb_#_cstb_", { Fuzz: "Fuzz", Level: "Level" }],
    ["fumaster", "Fuzz Master", "fuzz", GX + "gx_fumaster_#_fumaster_", { Fuzz: "Fuzz", Tone: "Tone", Level: "Level" }],
    ["hfb", "Harmonic Fuzz Box", "fuzz", GX + "gx_hfb_#_hfb_", { Fuzz: "Fuzz", Level: "Level" }],
    ["swh-fold", "Foldover Distortion", "fuzz", SWH + "foldover", { Drive: "drive", "Skew": "push" }],
    // ---- compressor / gate
    ["gxcomp", "Studio Compressor", "comp", GX + "gx_compressor#_compressor", { Threshold: "threshold", Ratio: "ratio", Attack: "attack", Release: "release", Knee: "knee" }],
    ["gxmbcomp", "Multiband Compressor", "comp", GX + "gx_mbcompressor_#_mbcompressor_", { Low: "Makeup1", Mid: "Makeup3", High: "Makeup5" }],
    ["expander", "Expander", "comp", GX + "gx_expander#_expander", { Threshold: "threshold", Ratio: "ratio", Attack: "attack", Release: "release" }],
    ["calfcomp", "Calf Compressor", "comp", CALF + "Compressor", { Threshold: "threshold", Ratio: "ratio", Attack: "attack", Release: "release", Makeup: "makeup", Knee: "knee" }],
    ["calfgate", "Calf Noise Gate", "comp", CALF + "Gate", { Threshold: "threshold", Range: "range", Attack: "attack", Release: "release" }],
    ["calflim", "Calf Limiter", "comp", CALF + "Limiter", { Limit: "limit", Release: "release", Attack: "attack" }],
    ["zamcomp", "Zam Comp", "comp", "urn:zamaudio:ZamComp", { Attack: "att", Release: "rel", Knee: "knee", Ratio: "ratio", Threshold: "thresh", Makeup: "makeup" }],
    ["zamgate", "Zam Gate", "comp", "urn:zamaudio:ZamGate", { Attack: "att", Release: "rel", Threshold: "thresh", Makeup: "makeup" }],
    ["swh-sc4", "SC4 Compressor", "comp", SWH + "sc4", { Attack: "attack_time", Release: "release_time", Threshold: "threshold_level", Ratio: "ratio", Knee: "knee_radius", Makeup: "makeup_gain" }],
    ["swh-lim", "Fast Lookahead Limiter", "comp", SWH + "fastLookaheadLimiter", { Gain: "input_gain", Limit: "limit", Release: "release_time" }],
    ["abgate", "abGate", "comp", "http://hippie.lt/lv2/gate", { Threshold: "threshold", Attack: "attack", Hold: "hold", Decay: "decay", Range: "range" }],
    // ---- EQ / tone
    ["geq", "Graphic EQ (10 band)", "eq", GX + "gx_graphiceq_#_graphiceq_", { "31 Hz": "band1", "62 Hz": "band2", "125 Hz": "band3", "250 Hz": "band4", "500 Hz": "band5", "1 kHz": "band6", "2 kHz": "band7", "4 kHz": "band8", "8 kHz": "band9", "16 kHz": "band10" }],
    ["barkeq", "Bark Graphic EQ", "eq", GX + "gx_barkgraphiceq_#_barkgraphiceq_", {}],
    ["calfeq5", "Calf 5-band EQ", "eq", CALF + "Equalizer5Band", { "Low shelf": "ls_level", "Low freq": "ls_freq", "Mid 1": "p1_level", "Mid 1 freq": "p1_freq", "Mid 2": "p2_level", "Mid 2 freq": "p2_freq", "Mid 3": "p3_level", "Mid 3 freq": "p3_freq", "High shelf": "hs_level", "High freq": "hs_freq" }],
    ["calfeq8", "Calf 8-band EQ", "eq", CALF + "Equalizer8Band", { "Low shelf": "ls_level", "High shelf": "hs_level", "Band 1": "p1_level", "Band 2": "p2_level", "Band 3": "p3_level", "Band 4": "p4_level" }],
    ["zameq2", "Zam EQ2 (parametric)", "eq", "urn:zamaudio:ZamEQ2", { "Band 1 gain": "boostdb1", "Band 1 freq": "freq1", "Band 2 gain": "boostdb2", "Band 2 freq": "freq2", "Low shelf": "boostdbl", "High shelf": "boostdbh", Master: "master" }],
    ["zamgeq31", "Zam 31-band EQ", "eq", "urn:zamaudio:ZamGEQ31", { Master: "master" }],
    ["x42-fil4", "x42 Parametric EQ", "eq", X42 + "fil4#mono", { "Low shelf": "LSgain", "Band 1": "gain1", "Band 2": "gain2", "Band 3": "gain3", "Band 4": "gain4", "High shelf": "HSgain", Output: "gain" }],
    ["eq10q", "EQ10Q (10 band)", "eq", "http://eq10q.sourceforge.net/eq/eq10qm", { Gain: "input_gain", Output: "output_gain" }],
    ["calfbass", "Bass Enhancer", "eq", CALF + "BassEnhancer", { Amount: "amount", Drive: "drive", Freq: "freq", Blend: "blend" }],
    ["calfexc", "Exciter", "eq", CALF + "Exciter", { Amount: "amount", Drive: "drive", Freq: "freq", Blend: "blend" }],
    // ---- wah / filter
    ["crybaby", "Cry Baby Wah (GCB-95)", "wah", GX + "gx_gcb_95_#_gcb_95_", { Wah: "Wah" }, { expression: "Wah" }],
    ["colwah", "Colour Wah", "wah", GX + "gx_colwah_#_colwah_", { Wah: "Wah" }, { expression: "Wah" }],
    ["autowah", "Auto Wah", "wah", GX + "gxautowah#autowah", { Mode: "mode", Freq: "freq", Wet: "wet_dry", Level: "level" }],
    ["gxwah", "Wah (manual)", "wah", GX + "gxautowah#wah", { Wah: "wah", Wet: "wet_dry", Level: "level" }, { expression: "wah" }],
    ["calfenv", "Envelope Filter", "wah", CALF + "EnvelopeFilter", { Sensitivity: "sensitivity", Freq: "freq", Resonance: "q", Range: "range" }],
    ["calffilter", "Calf Filter", "wah", CALF + "Filter", { Cutoff: "freq", Resonance: "res", Mode: "mode" }],
    ["zyn-alienwah", "Alien Wah", "wah", "http://zynaddsubfx.sourceforge.net/fx#AlienWah", {}],
    // ---- modulation
    ["gxchorus", "Stereo Chorus", "mod", GX + "gx_chorus_stereo#_chorus_stereo", { Level: "level", Depth: "depth", Delay: "delay", Freq: "freq" }],
    ["gxflanger", "Flanger", "mod", GX + "gx_flanger#_flanger", { Delay: "delay", Depth: "depth", Freq: "freq", Feedback: "feedback", Level: "level" }],
    ["gxphaser", "Phaser", "mod", GX + "gx_phaser#_phaser", { Depth: "depth", Freq: "freq", Feedback: "feedback", Level: "level" }],
    ["calfchorus", "Calf Multi Chorus", "mod", CALF + "MultiChorus", { Depth: "mod_depth", Rate: "mod_rate", Voices: "voices", "Min delay": "min_delay", Amount: "amount" }],
    ["calfphaser", "Calf Phaser", "mod", CALF + "Phaser", { Depth: "mod_depth", Rate: "lfo_rate", Feedback: "feedback", Stages: "stages", Amount: "amount" }],
    ["calfflanger", "Calf Flanger", "mod", CALF + "Flanger", { Depth: "mod_depth", Rate: "lfo_rate", Feedback: "feedback", "Min delay": "min_delay", Amount: "amount" }],
    ["calfrotary", "Rotary Speaker", "mod", CALF + "RotarySpeaker", { Speed: "vib_speed", "Horn speed": "fast_speed_horn", "Rotor speed": "fast_speed_rotor", Spacing: "spacing" }],
    ["mda-tzf", "Thru-Zero Flanger", "mod", MDA + "ThruZero", { Rate: "rate", Depth: "depth", Mix: "mix", Feedback: "feedback" }],
    ["mda-leslie", "mda Leslie", "mod", MDA + "Leslie", { Speed: "speed", "Low width": "lo_width", "Low throb": "lo_throb", "High width": "hi_width", "High depth": "hi_depth" }],
    ["mda-detune", "mda Detune", "mod", MDA + "Detune", { Detune: "detune", Mix: "mix", Output: "output" }],
    ["swh-mvchorus", "Multivoice Chorus", "mod", SWH + "multivoiceChorus", { Voices: "voices", Delay: "delay_base", Separation: "voice_spread", Detune: "detune", Rate: "law_freq" }],
    ["swh-rflanger", "Retro Flanger", "mod", SWH + "retroFlange", { Delay: "delay_time", "Stall": "law_freq" }],
    ["tap-chorus", "TAP Chorus / Flanger", "mod", "ladspa:tap_chorusflanger.so:tap_chorusflanger", {}, { ladspa: "tap_chorusflanger.so", label: "tap_chorusflanger" }],
    // ---- tremolo / vibrato
    ["gxtrem", "Tremolo", "trem", GX + "gx_tremolo#_tremolo", { Depth: "depth", Freq: "freq", Wave: "wave" }],
    ["gxswtrem", "Switched Tremolo", "trem", GX + "gx_switched_tremolo_#_switched_tremolo_", { Depth: "Depth", Speed: "Speed" }],
    ["tubetrem", "Tube Tremolo", "trem", GX + "gxtubetremelo#tubetremelo", { Depth: "depth", Freq: "freq", Level: "level" }],
    ["tubevib", "Tube Vibrato", "trem", GX + "gxtubevibrato#tubevibrato", { Depth: "depth", Freq: "freq", Level: "level" }],
    ["tap-trem", "TAP Tremolo", "trem", "ladspa:tap_tremolo.so:tap_tremolo", {}, { ladspa: "tap_tremolo.so", label: "tap_tremolo" }],
    ["tap-vib", "TAP Vibrato", "trem", "ladspa:tap_vibrato.so:tap_vibrato", {}, { ladspa: "tap_vibrato.so", label: "tap_vibrato" }],
    ["tap-pan", "TAP Auto Panner", "trem", "ladspa:tap_autopan.so:tap_autopan", {}, { ladspa: "tap_autopan.so", label: "tap_autopan" }],
    ["calfpuls", "Calf Pulsator", "trem", CALF + "Pulsator", { Rate: "freq", Amount: "amount", Mode: "mode", Offset: "offset" }],
    // ---- pitch
    ["oc2", "Octaver (OC-2)", "pitch", GX + "gx_oc_2_#_oc_2_", { Direct: "Direct", "Oct 1": "Oct1", "Oct 2": "Oct2" }],
    ["detune", "Detune", "pitch", GX + "gx_detune_#_detune_", { Detune: "Detune", Mix: "Wet", Level: "Level" }],
    ["swh-pitch", "Pitch Scaler", "pitch", SWH + "pitchScaleHQ", { Pitch: "mult" }],
    ["tap-pitch", "TAP Pitch Shifter", "pitch", "ladspa:tap_pitch.so:tap_pitch", {}, { ladspa: "tap_pitch.so", label: "tap_pitch" }],
    ["mda-sub", "mda Sub Synth", "pitch", MDA + "SubSynth", { Type: "type", Level: "level", Tune: "tune", Dry: "dry_mix", Threshold: "thresh" }],
    ["autotalent", "Auto-tune (Autotalent)", "pitch", "ladspa:autotalent.so:autotalent", {}, { ladspa: "autotalent.so", label: "autotalent" }],
    // ---- delay
    ["gxdelay", "Stereo Delay", "delay", GX + "gx_delay_stereo#_delay_stereo", { Time: "delay", Feedback: "feedback", Level: "level" }],
    ["digdelay", "Digital Delay", "delay", GX + "gx_digital_delay_#_digital_delay_", { Time: "Time", Feedback: "Feedback", Mix: "Wet", "Low cut": "Low", "High cut": "High" }, { tempo: "Time" }],
    ["duckdelay", "Ducking Delay", "delay", GX + "gx_duck_delay_#_duck_delay_", { Time: "Time", Feedback: "Feedback", Mix: "Wet", Threshold: "Threshold" }, { tempo: "Time" }],
    ["gxecho", "Stereo Echo", "delay", GX + "gx_echo_stereo#_echo_stereo", { Time: "time", Percent: "percent", Level: "level" }],
    ["echocat", "Echo Cat (tape echo)", "delay", GX + "gxechocat#echocat", { Time: "time", Feedback: "feedback", Tone: "tone", Level: "level" }, { tempo: "time" }],
    ["tubedelay", "Tube Delay", "delay", GX + "gxtubedelay#tubedelay", { Time: "time", Feedback: "feedback", Tone: "tone", Level: "level" }, { tempo: "time" }],
    ["mbdelay", "Multiband Delay", "delay", GX + "gx_mbdelay_#_mbdelay_", { Time: "delay1", Feedback: "feedback1", Level: "level" }],
    ["mbecho", "Multiband Echo", "delay", GX + "gx_mbecho_#_mbecho_", { Time: "delay1", Feedback: "feedback1", Level: "level" }],
    ["calfvdelay", "Vintage Delay", "delay", CALF + "VintageDelay", { Time: "subdiv", Feedback: "feedback", Amount: "amount", Width: "width", "Dry": "dry" }, { tempoBpm: "bpm" }],
    ["calfrev-delay", "Reverse Delay", "delay", CALF + "ReverseDelay", { Time: "subdiv", Feedback: "feedback", Amount: "amount", Width: "width" }, { tempoBpm: "bpm" }],
    ["zamdelay", "Zam Delay", "delay", "urn:zamaudio:ZamDelay", { Time: "divide", Feedback: "feedback", Mix: "wet", Tone: "lpf", Gain: "gain" }, { tempoBpm: "bpm" }],
    ["swh-tape", "Tape Delay", "delay", SWH + "tapeDelay", { Speed: "speed", Delay: "da_db", "Tap 1": "t1a", "Tap 2": "t2a" }],
    ["tap-echo", "TAP Stereo Echo", "delay", "ladspa:tap_echo.so:tap_stereo_echo", {}, { ladspa: "tap_echo.so", label: "tap_stereo_echo" }],
    ["mda-delay", "mda Delay", "delay", MDA + "Delay", { "Left": "l_delay", "Right": "r_delay", Feedback: "feedback", "FB tone": "fb_tone", Mix: "fx_mix", Output: "output" }],
    // ---- reverb
    ["gxreverb", "Stereo Reverb", "reverb", GX + "gx_reverb_stereo#_reverb_stereo", { Roomsize: "roomsize", Damp: "damp", Level: "level" }],
    ["zitarev", "Zita Rev1 (hall)", "reverb", GX + "gx_zita_rev1_stereo#_zita_rev1_stereo", { "Low RT60": "low_rt60", "Mid RT60": "mid_rt60", "HF damping": "hf_damping", Delay: "in_delay", Dry: "dry_wet_mix" }],
    ["shimmer", "Shimmer Reverb", "reverb", GX + "gx_shimmizita_#_shimmizita_", { Shimmer: "ShimmerPitch", "Low RT60": "lrt60", "Mid RT60": "mrt60", Mix: "dw" }],
    ["roomsim", "Room Simulator", "reverb", GX + "gx_room_simulator_#_room_simulator_", { Room: "Room", Damp: "Damp", Level: "Level" }],
    ["mbreverb", "Multiband Reverb", "reverb", GX + "gx_mbreverb_#_mbreverb_", { Level: "level" }],
    ["calfreverb", "Calf Reverb", "reverb", CALF + "Reverb", { Decay: "decay_time", "High damp": "hf_damp", Room: "room_size", Diffusion: "diffusion", Amount: "amount", Dry: "dry", Predelay: "predelay" }],
    ["dfly-hall", "Dragonfly Hall", "reverb", "https://github.com/michaelwillis/dragonfly-reverb", { Dry: "dry_level", Early: "early_level", Late: "late_level", Size: "size", Width: "width", Predelay: "delay", Decay: "decay", "Low cut": "low_cut", "High cut": "high_cut" }],
    ["dfly-plate", "Dragonfly Plate", "reverb", "urn:dragonfly:plate", { Dry: "dry_level", Wet: "wet_level", Width: "width", Predelay: "delay", Decay: "decay", "Low cut": "low_cut", "High cut": "high_cut" }],
    ["dfly-room", "Dragonfly Room", "reverb", "urn:dragonfly:room", { Dry: "dry_level", Early: "early_level", Late: "late_level", Size: "size", Width: "width", Predelay: "delay", Decay: "decay" }],
    ["dfly-early", "Dragonfly Early Reflections", "reverb", "urn:dragonfly:early", { Dry: "dry_level", Wet: "wet_level", Size: "size", Width: "width" }],
    ["zamverb", "Zam Verb", "reverb", "urn:zamaudio:ZamVerb", { Mix: "wet", Type: "type" }],
    ["mda-amb", "mda Ambience", "reverb", MDA + "Ambience", { Size: "size", "HF damp": "hf_damp", Mix: "mix", Output: "output" }],
    ["swh-gverb", "GVerb", "reverb", SWH + "gverb", { Roomsize: "roomsize", "Reverb time": "revtime", Damping: "damping", "Input bandwidth": "inputbandwidth", "Dry": "drylevel", "Early": "earlylevel", "Tail": "taillevel" }],
    ["swh-plate", "Plate Reverb", "reverb", SWH + "plate", { Time: "time", Damping: "damping", Wet: "wet" }],
    ["tap-reverb", "TAP Reverberator", "reverb", "ladspa:tap_reverb.so:tap_reverb", {}, { ladspa: "tap_reverb.so", label: "tap_reverb" }],
    ["caps-plate", "C* Plate", "reverb", "ladspa:caps.so:Plate", {}, { ladspa: "caps.so", label: "Plate" }],
    // ---- amps / preamps
    ["gxamp", "Guitarix Amp (tube stack)", "amp", GX + "gx_amp#GUITARIX", { Pregain: "pregain", Drive: "drive", Wet: "wet_dry", Bass: "Bass", Middle: "Middle", Treble: "Treble", Presence: "Presence", Master: "mastergain" }],
    ["jcm800", "British 800 Preamp", "amp", GX + "gx_jcm800pre_#_jcm800pre_", { Gain: "Gain", Bass: "Bass", Middle: "Middle", Treble: "Treble", Volume: "Volume" }],
    ["studiopre", "Studio Preamp", "amp", GX + "gx_studiopre#studiopre", { Gain: "Gain", Bass: "Bass", Middle: "Middle", Treble: "Treble", Volume: "Volume" }],
    ["metalamp", "Metal Amp", "amp", GX + "gxmetal_amp#metal_amp", { Gain: "Gain", Bass: "Bass", Middle: "Middle", Treble: "Treble", Volume: "Volume" }],
    ["metalhead", "Metal Head", "amp", GX + "gxmetal_head#metal_head", { Gain: "Gain", Bass: "Bass", Middle: "Middle", Treble: "Treble", Volume: "Volume" }],
    ["chump", "Red Eye Chump (tweed)", "amp", GX + "gx_redeye#chump", { Volume: "Volume", Tone: "Tone", Gain: "Gain" }],
    ["bigchump", "Red Eye Big Chump", "amp", GX + "gx_redeye#bigchump", { Volume: "Volume", Tone: "Tone", Gain: "Gain" }],
    ["vibrochump", "Red Eye Vibro Chump", "amp", GX + "gx_redeye#vibrochump", { Volume: "Volume", Tone: "Tone", Speed: "Speed", Intensity: "Intensity" }],
    ["w20", "W20 Preamp", "amp", GX + "gx_w20#w20", { Gain: "Gain", Volume: "Volume" }],
    ["zamtube", "Zam Tube", "amp", "urn:zamaudio:ZamTube", { Gain: "tubedrive", Bass: "bass", Mids: "mids", Treble: "treble", Output: "mastergain", Tone: "tonestack" }],
    ["gxtape", "Tape Saturation", "amp", GX + "gxtape#tape", { Drive: "drive", "Tape": "tapemode", Level: "level" }],
    ["caps-amp", "C* AmpVTS (tube amp)", "amp", "ladspa:caps.so:AmpVTS", {}, { ladspa: "caps.so", label: "AmpVTS" }],
    ["calfsat", "Calf Saturator", "amp", CALF + "Saturator", { Drive: "drive", Blend: "blend", "Low cut": "lp_pre_freq", "High cut": "hp_pre_freq" }],
    ["tap-tube", "TAP TubeWarmth", "amp", "ladspa:tap_tubewarmth.so:tap_tubewarmth", {}, { ladspa: "tap_tubewarmth.so", label: "tap_tubewarmth" }],
    ["swh-valve", "Valve Saturation", "amp", SWH + "valve", { Distortion: "q_level", "Char": "dist", }],
    // ---- cabinets
    ["gxcab", "Cabinet (28 models)", "cab", GX + "gx_cabinet#CABINET", { Cabinet: "c_model", Level: "Level", Bass: "Bass", Treble: "Treble" }],
    ["caps-cab", "C* Cabinet IV", "cab", "ladspa:caps.so:CabinetIV", {}, { ladspa: "caps.so", label: "CabinetIV" }],
    ["ir-cab", "IR loader: cab / acoustic body (.wav)", "cab", "builtin:convolver", {}, { builtin: true, irFile: true }],
    ["ir", "Impulse Response (IR) loader", "cab", "http://tomszilagyi.github.io/plugins/lv2/ir", { Gain: "gain", Predelay: "predelay", Length: "length", "Dry": "dry_gain", "Wet": "wet_gain" }, { file: true }],
    // ---- acoustic
    ["acoustic-sim", "Acoustic Simulator", "acoustic", CALF + "Equalizer5Band", { Body: "p1_level", Air: "hs_level", Warmth: "ls_level" }],
    ["acoustic-comp", "Acoustic Compressor", "acoustic", "urn:zamaudio:ZamComp", { Attack: "att", Release: "rel", Ratio: "ratio", Threshold: "thresh", Makeup: "makeup" }],
    ["feedback-killer", "Feedback Notch", "acoustic", X42 + "fil4#mono", { Freq: "freq2", Cut: "gain2", Q: "q2" }],
    // ---- utility
    ["tuner", "Tuner", "util", GX + "gxtuner#tuner", {}],
    ["livelooper", "Live Looper (4 tracks)", "util", GX + "gx_livelooper_#_livelooper_", { Gain: "gain", "Mix": "dry_wet" }],
    ["volume", "Volume pedal", "util", CALF + "MonoInput", { Level: "level_in" }, { expression: "level_in" }],
    ["stereo", "Stereo Tools", "util", CALF + "StereoTools", { Balance: "balance_out", Width: "stereo_base" }],
    ["crusher", "Bit Crusher", "util", CALF + "Crusher", { Bits: "bits", "Sample reduce": "samples", Morph: "morph", Blend: "mix" }],
    ["ringmod", "Ring Modulator", "util", CALF + "RingModulator", { Freq: "mod_frequency", Amount: "mod_amount", Mode: "mod_mode" }],
    ["mda-degrade", "mda Degrade", "util", MDA + "Degrade", { Headroom: "headroom", Quantize: "quant", Rate: "rate", "Post filter": "post_filt", Output: "output" }],
    ["vinyl", "Vinyl / Phono", "util", "urn:zamaudio:ZamPhono", { Type: "type" }],
    ["swh-vinyl", "Vynil effect", "util", SWH + "vynil", { Year: "year", RPM: "rpm", Warp: "warp", Click: "click", Wear: "wear" }]
  ];
  var pedals = P.map(function (p) { return { id: p[0], name: p[1], category: p[2], uri: p[3], knobs: p[4] || {}, opts: p[5] || {} }; });

  // ---- our own boards: presets made of several pedals (name, instrument kind, chain)
  var BOARDS = [
    { id: "clean-worship", name: "Clean Worship", kind: "electric", chain: [["gxcomp", {}], ["booster", {}], ["gxchorus", { level: 0.3 }], ["digdelay", { Time: 375, Feedback: 0.35, Wet: 0.3 }], ["dfly-hall", { Decay: 3.2 }], ["gxamp", {}], ["gxcab", {}]] },
    { id: "ambient-swell", name: "Ambient Swell", kind: "electric", chain: [["volume", {}], ["gxcomp", {}], ["shimmer", {}], ["echocat", {}], ["dfly-hall", { Decay: 6 }], ["gxamp", {}], ["gxcab", {}]] },
    { id: "edge-delay", name: "Edge Dotted-Eighth", kind: "electric", chain: [["gxcomp", {}], ["ts9", { Drive: 0.3 }], ["digdelay", { Feedback: 0.45, Wet: 0.4 }], ["calfvdelay", {}], ["gxreverb", {}], ["jcm800", {}], ["gxcab", {}]] },
    { id: "blues-crunch", name: "Blues Crunch", kind: "electric", chain: [["ts9", { Drive: 0.55 }], ["hogsfoot", {}], ["gxtrem", {}], ["gxreverb", {}], ["chump", {}], ["gxcab", {}]] },
    { id: "modern-gain", name: "Modern High Gain", kind: "electric", chain: [["calfgate", {}], ["ts9", { Drive: 0.2, Level: 0.8 }], ["metalhead", {}], ["gxcab", {}], ["calfeq5", {}], ["digdelay", { Wet: 0.15 }]] },
    { id: "fuzz-wall", name: "Fuzz Wall", kind: "electric", chain: [["muff", {}], ["oc2", {}], ["gxphaser", {}], ["gxamp", {}], ["gxcab", {}]] },
    { id: "acoustic-natural", name: "Acoustic Natural", kind: "acoustic", chain: [["feedback-killer", {}], ["acoustic-comp", {}], ["acoustic-sim", {}], ["dfly-plate", {}]] },
    { id: "acoustic-shimmer", name: "Acoustic Shimmer", kind: "acoustic", chain: [["acoustic-comp", {}], ["gxchorus", {}], ["shimmer", {}], ["dfly-hall", {}]] },
    { id: "acoustic-dry", name: "Acoustic Dry (DI)", kind: "acoustic", chain: [["calfgate", {}], ["acoustic-comp", {}], ["calfeq5", {}]] },
    { id: "keys-stage", name: "Keys: Stage", kind: "keys", chain: [["calfcomp", {}], ["calfeq5", {}], ["dfly-hall", { Decay: 2.6 }]] },
    { id: "keys-ambient", name: "Keys: Ambient Pad", kind: "keys", chain: [["calfchorus", {}], ["calfvdelay", {}], ["dfly-hall", { Decay: 6 }]] },
    { id: "keys-ep", name: "Keys: EP Tremolo", kind: "keys", chain: [["tap-trem", {}], ["calfphaser", {}], ["dfly-plate", {}]] },
    { id: "keys-organ", name: "Keys: Organ Leslie", kind: "keys", chain: [["calfrotary", {}], ["gxreverb", {}]] }
  ];
  var api = { CATEGORIES: CATEGORIES, pedals: pedals, boards: BOARDS, byId: function (id) { return pedals.filter(function (p) { return p.id === id; })[0] || null; } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PPPedals = api;
})(typeof window !== "undefined" ? window : globalThis);
