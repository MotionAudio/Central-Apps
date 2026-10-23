/* Central Pedal - the pedal catalogue: 100+ stompboxes, amps, cabs and studio
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
    cab: { name: "Cabinets", color: "#555f6b" }, util: { name: "Utility", color: "#6c757d" }, acoustic: { name: "Acoustic", color: "#c8793b" },
    studio: { name: "Studio: compressor, EQ, limiter", color: "#b8893f" }
  };
  // id, name, category, plugin uri, knobs {label: symbol}, optional {mono: true} notes
  var P = [
    // ---- boost / overdrive (Guitarix)
    ["booster", "Clean Booster", "boost", GX + "gxbooster#booster", { Treble: "fslider0_", Bass: "fslider1_" }],
    ["ts9", "Green Screamer (TS9)", "boost", GX + "gxts9#ts9sim", { Drive: "fslider2_", Tone: "fslider1_", Level: "fslider0_" }],
    ["scream", "Scream Drive", "boost", GX + "gx_scream_#_scream_", { Drive: "SCREAM" }],
    ["rangem", "Treble Rangemaster", "boost", GX + "gx_rangem_#_rangem_", { Boost: "BOOST" }],
    ["tilttone", "Tilt Tone", "eq", GX + "gxtilttone#tilttone", { Tilt: "tone", Body: "body", Drive: "drive", Level: "level" }],
    ["hornet", "Hornet Overdrive", "boost", GX + "gx_hornet_#_hornet_", { Fuzz: "FUZZ", Sustain: "SUSTAIN", Volume: "VOLUME" }],
    ["hogsfoot", "Hogs Foot (Blues OD)", "boost", GX + "gx_hogsfoot_#_hogsfoot_", { Level: "VOLUME", Mix: "WET_DRY" }],
    ["alembic", "Alembic Preamp", "amp", GX + "gx_alembic#alembic", { Input: "input", Bass: "bass", Middle: "middle", Treble: "treble", Volume: "volume" }],
    ["mole", "Mole (bass OD)", "boost", GX + "gx_mole_#_mole_", { Drive: "BOOST", Mix: "WET_DRY" }],
    // ---- distortion
    ["ds1", "Orange Distortion (DS-1)", "dist", GX + "gx_bossds1_#_bossds1_", { Dist: "DRIVE", Tone: "TONE", Level: "LEVEL" }],
    ["mxrdist", "Yellow Dist+", "dist", GX + "gx_mxrdist_#_mxrdist_", { Distortion: "DRIVE", Output: "VOLUME" }],
    ["susta", "Sustainer", "dist", GX + "gx_susta_#_susta_", { Sustain: "SUSTAIN", Level: "VOLUME" }],
    ["aclipper", "Asymmetric Clipper", "dist", GX + "gx_aclipper_#_aclipper_", { Drive: "DRIVE", Tone: "TONE", Level: "LEVEL" }],
    ["mbdist", "Multiband Distortion", "dist", GX + "gx_mbdistortion_#_mbdistortion_", { Drive1: "DRIVE1", Drive2: "DRIVE2", Drive3: "DRIVE3", Drive4: "DRIVE4", Drive5: "DRIVE5", Level: "GAIN" }],
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
    ["fuzz", "Classic Fuzz", "fuzz", GX + "gx_fuzz_#fuzz_", { Fuzz: "DRIVE", Level: "OUTPUT" }],
    ["fuzzface", "Fuzz Face", "fuzz", GX + "gx_fuzzface_#_fuzzface_", { Fuzz: "FUZZ", Level: "LEVEL" }],
    ["fuzzfacefm", "Fuzz Face FM", "fuzz", GX + "gx_fuzzfacefm_#_fuzzfacefm_", { Fuzz: "FUZZ", Level: "LEVEL" }],
    ["muff", "Big Muff", "fuzz", GX + "gx_muff_#_muff_", { Tone: "TONE", Volume: "VOLUME" }],
    ["bmp", "Big Muff Pi", "fuzz", GX + "gx_bmp_#_bmp_", { Sustain: "SUSTAIN", Tone: "TONE", Volume: "VOLUME" }],
    ["cstb", "Tone Bender", "fuzz", GX + "gx_cstb_#_cstb_", { Fuzz: "ATTACK", Level: "LEVEL" }],
    ["fumaster", "Fuzz Master", "fuzz", GX + "gx_fumaster_#_fumaster_", { Tone: "TONE", Level: "VOLUME", Mix: "WET_DRY" }],
    ["hfb", "Harmonic Fuzz Box", "fuzz", GX + "gx_hfb_#_hfb_", { Fuzz: "INTENSITY", Level: "VOLUME" }],
    ["swh-fold", "Foldover Distortion", "fuzz", SWH + "foldover", { Drive: "drive_p", Skew: "push" }],
    // ---- compressor / gate
    ["gxcomp", "Guitarix Compressor", "comp", GX + "gx_compressor#_compressor", { Threshold: "THRESHOLD", Ratio: "RATIO", Attack: "ATTACK", Release: "RELEASE", Knee: "KNEE" }],
    ["gxmbcomp", "Multiband Compressor", "comp", GX + "gx_mbcompressor_#_mbcompressor_", { Low: "MAKEUP1", Mid: "MAKEUP3", High: "MAKEUP5" }],
    ["expander", "Expander", "comp", GX + "gx_expander#_expander", { Threshold: "THRESHOLD", Ratio: "RATIO", Attack: "ATTACK", Release: "RELEASE" }],
    ["calfcomp", "Calf Compressor", "comp", CALF + "Compressor", { Threshold: "threshold", Ratio: "ratio", Attack: "attack", Release: "release", Makeup: "makeup", Knee: "knee" }],
    ["calfgate", "Calf Noise Gate", "comp", CALF + "Gate", { Threshold: "threshold", Range: "range", Attack: "attack", Release: "release" }],
    ["calflim", "Calf Limiter", "comp", CALF + "Limiter", { Limit: "limit", Release: "release", Attack: "attack" }],
    ["zamcomp", "Zam Comp", "comp", "urn:zamaudio:ZamComp", { Attack: "att", Release: "rel", Knee: "kn", Ratio: "rat", Threshold: "thr", Makeup: "mak" }],
    ["zamgate", "Zam Gate", "comp", "urn:zamaudio:ZamGate", { Attack: "att", Release: "rel", Threshold: "thr", Makeup: "mak" }],
    ["swh-sc4", "SC4 Compressor", "comp", SWH + "sc4", { Attack: "attack", Release: "release", Threshold: "threshold", Ratio: "ratio", Knee: "knee", Makeup: "makeup_gain" }],
    ["swh-lim", "Fast Lookahead Limiter", "comp", SWH + "fastLookaheadLimiter", { Gain: "ingain", Limit: "limit", Release: "release" }],
    ["abgate", "abGate", "comp", "http://hippie.lt/lv2/gate", { Threshold: "threshold", Attack: "attack", Hold: "hold", Decay: "decay", Range: "gaterange" }],
    // ---- EQ / tone
    ["geq", "Graphic EQ (10 band)", "eq", GX + "gx_graphiceq_#_graphiceq_", { "31 Hz": "G1", "62 Hz": "G2", "125 Hz": "G3", "250 Hz": "G4", "500 Hz": "G5", "1 kHz": "G6", "2 kHz": "G7", "4 kHz": "G8", "8 kHz": "G9", "16 kHz": "G10" }],
    ["barkeq", "Bark Graphic EQ", "eq", GX + "gx_barkgraphiceq_#_barkgraphiceq_", {}],
    ["calfeq5", "Calf 5-band EQ", "eq", CALF + "Equalizer5Band", { "Low shelf": "ls_level", "Low freq": "ls_freq", "Mid 1": "p1_level", "Mid 1 freq": "p1_freq", "Mid 2": "p2_level", "Mid 2 freq": "p2_freq", "Mid 3": "p3_level", "Mid 3 freq": "p3_freq", "High shelf": "hs_level", "High freq": "hs_freq" }],
    ["calfeq8", "Calf 8-band EQ", "eq", CALF + "Equalizer8Band", { "Low shelf": "ls_level", "High shelf": "hs_level", "Band 1": "p1_level", "Band 2": "p2_level", "Band 3": "p3_level", "Band 4": "p4_level" }],
    ["zameq2", "Zam EQ2 (parametric)", "eq", "urn:zamaudio:ZamEQ2", { "Band 1 gain": "boost1", "Band 1 freq": "f1", "Band 2 gain": "boost2", "Band 2 freq": "f2", "Low shelf": "boostl", "High shelf": "boosth" }],
    ["zamgeq31", "Zam 31-band EQ", "eq", "urn:zamaudio:ZamGEQ31", { Master: "master" }],
    ["x42-fil4", "x42 Parametric EQ", "eq", X42 + "fil4#mono", { "Low shelf": "LSgain", "Band 1": "gain1", "Band 2": "gain2", "Band 3": "gain3", "Band 4": "gain4", "High shelf": "HSgain", Output: "gain" }],
    ["eq10q", "EQ10Q (10 band)", "eq", "http://eq10q.sourceforge.net/eq/eq10qm", { Gain: "input_gain", Output: "output_gain" }],
    ["calfbass", "Bass Enhancer", "eq", CALF + "BassEnhancer", { Amount: "amount", Drive: "drive", Freq: "freq", Blend: "blend" }],
    ["calfexc", "Exciter", "eq", CALF + "Exciter", { Amount: "amount", Drive: "drive", Freq: "freq", Blend: "blend" }],
    // ---- wah / filter
    ["crybaby", "Cry Baby Wah (GCB-95)", "wah", GX + "gx_gcb_95_#_gcb_95_", { Wah: "HOTPOTZ" }, { expression: "Wah" }],
    ["colwah", "Colour Wah", "wah", GX + "gx_colwah_#_colwah_", { Wah: "WAH" }, { expression: "Wah" }],
    ["autowah", "Auto Wah", "wah", GX + "gxautowah#autowah", {}],
    ["gxwah", "Wah (manual)", "wah", GX + "gxautowah#wah", { Wah: "fslider1_" }, { expression: "wah" }],
    ["calfenv", "Envelope Filter", "wah", CALF + "EnvelopeFilter", { Sensitivity: "gain", Resonance: "res", Range: "upper", Attack: "attack", Release: "release", Mix: "mix" }],
    ["calffilter", "Calf Filter", "wah", CALF + "Filter", { Cutoff: "freq", Resonance: "res", Mode: "mode" }],
    ["zyn-alienwah", "Alien Wah", "wah", "http://zynaddsubfx.sourceforge.net/fx#AlienWah", {}],
    // ---- modulation
    ["gxchorus", "Stereo Chorus", "mod", GX + "gx_chorus_stereo#_chorus_stereo", { Level: "level", Depth: "depth", Delay: "delay", Freq: "freq" }],
    ["gxflanger", "Flanger", "mod", GX + "gx_flanger#_flanger", { Depth: "depth", Width: "width", Freq: "freq", Feedback: "feedback", Mix: "dry_wet" }],
    ["gxphaser", "Phaser", "mod", GX + "gx_phaser#_phaser", { Speed: "speed", Mix: "dry_wet", Level: "level" }],
    ["calfchorus", "Calf Multi Chorus", "mod", CALF + "MultiChorus", { Depth: "mod_depth", Rate: "mod_rate", Voices: "voices", "Min delay": "min_delay", Amount: "amount" }],
    ["calfphaser", "Calf Phaser", "mod", CALF + "Phaser", { Depth: "mod_depth", Rate: "mod_rate", Feedback: "feedback", Stages: "stages", Amount: "amount" }],
    ["calfflanger", "Calf Flanger", "mod", CALF + "Flanger", { Depth: "mod_depth", Rate: "mod_rate", Feedback: "feedback", "Min delay": "min_delay", Amount: "amount" }],
    ["calfrotary", "Rotary Speaker", "mod", CALF + "RotarySpeaker", { Speed: "vib_speed", Spacing: "spacing", "Horn speed": "treble_speed", "Rotor speed": "bass_speed" }],
    ["mda-tzf", "Thru-Zero Flanger", "mod", MDA + "ThruZero", { Rate: "rate", Depth: "depth", Mix: "mix", Feedback: "feedback" }],
    ["mda-leslie", "mda Leslie", "mod", MDA + "Leslie", { Speed: "speed", "Low width": "lo_width", "Low throb": "lo_throb", "High width": "hi_width", "High depth": "hi_depth" }],
    ["mda-detune", "mda Detune", "mod", MDA + "Detune", { Detune: "detune", Mix: "mix", Output: "output" }],
    ["swh-mvchorus", "Multivoice Chorus", "mod", SWH + "multivoiceChorus", { Voices: "voices", Delay: "delay_base", Separation: "voice_spread", Detune: "detune", Rate: "law_freq" }],
    ["swh-rflanger", "Retro Flanger", "mod", SWH + "retroFlange", { Delay: "delay_depth_avg", Stall: "law_freq" }],
    ["tap-chorus", "TAP Chorus / Flanger", "mod", "ladspa:tap_chorusflanger.so:tap_chorusflanger", {}, { ladspa: "tap_chorusflanger.so", label: "tap_chorusflanger" }],
    // ---- tremolo / vibrato
    ["gxtrem", "Tremolo", "trem", GX + "gx_tremolo#_tremolo", { Depth: "depth", Freq: "freq", Mix: "dry_wet", Wave: "mode" }],
    ["gxswtrem", "Switched Tremolo", "trem", GX + "gx_switched_tremolo_#_switched_tremolo_", { Depth: "DEPTH", Speed: "FREQ0" }],
    ["tubetrem", "Tube Tremolo", "trem", GX + "gxtubetremelo#tubetremelo", { Depth: "depth", Freq: "speed", Level: "output" }],
    ["tubevib", "Tube Vibrato", "trem", GX + "gxtubevibrato#tubevibrato", { Depth: "depth", Freq: "speed", Level: "output" }],
    ["tap-trem", "TAP Tremolo", "trem", "ladspa:tap_tremolo.so:tap_tremolo", {}, { ladspa: "tap_tremolo.so", label: "tap_tremolo" }],
    ["tap-vib", "TAP Vibrato", "trem", "ladspa:tap_vibrato.so:tap_vibrato", {}, { ladspa: "tap_vibrato.so", label: "tap_vibrato" }],
    ["tap-pan", "TAP Auto Panner", "trem", "ladspa:tap_autopan.so:tap_autopan", {}, { ladspa: "tap_autopan.so", label: "tap_autopan" }],
    ["calfpuls", "Calf Pulsator", "trem", CALF + "Pulsator", { Rate: "hz", Amount: "amount", Mode: "mode", Offset: "offset_l" }],
    // ---- pitch
    ["oc2", "Octaver (OC-2)", "pitch", GX + "gx_oc_2_#_oc_2_", { Direct: "DIRECT", "Oct 1": "OCTAVE1", "Oct 2": "OCTAVE2" }],
    ["detune", "Detune", "pitch", GX + "gx_detune_#_detune_", { Detune: "DETUNE", Octave: "OCTAVE", Mix: "WET" }],
    ["swh-pitch", "Pitch Scaler", "pitch", SWH + "pitchScaleHQ", { Pitch: "mult" }],
    ["tap-pitch", "TAP Pitch Shifter", "pitch", "ladspa:tap_pitch.so:tap_pitch", {}, { ladspa: "tap_pitch.so", label: "tap_pitch" }],
    ["mda-sub", "mda Sub Synth", "pitch", MDA + "SubSynth", { Type: "type", Level: "level", Tune: "tune", Dry: "dry_mix", Threshold: "thresh" }],
    ["autotalent", "Auto-tune (Autotalent)", "pitch", "ladspa:autotalent.so:autotalent", {}, { ladspa: "autotalent.so", label: "autotalent" }],
    // ---- delay
    ["gxdelay", "Stereo Delay", "delay", GX + "gx_delay_stereo#_delay_stereo", { Time: "timt_l", Level: "level_l", "Time R": "timt_r", "Level R": "level_r", Link: "link" }],
    ["digdelay", "Digital Delay", "delay", GX + "gx_digital_delay_#_digital_delay_", { Tempo: "BPM", Notes: "NOTES", Feedback: "FEEDBACK", Mix: "LEVEL", "Low cut": "HIGHPASS", "High cut": "HOWPASS" }, { tempo: "Time" }],
    ["duckdelay", "Ducking Delay", "delay", GX + "gx_duck_delay_#_duck_delay_", { Time: "TIME", Feedback: "FEEDBACK", Duck: "AMOUNT", Attack: "ATTACK", Release: "RELESE" }, { tempo: "Time" }],
    ["gxecho", "Stereo Echo", "delay", GX + "gx_echo_stereo#_echo_stereo", { Time: "timt_l", Feedback: "level_l", "Time R": "timt_r", "Feedback R": "level_r", Link: "link" }],
    ["echocat", "Echo Cat (tape echo)", "delay", GX + "gxechocat#echocat", { Tempo: "bpm", Sustain: "sustain", Swell: "swell", Output: "output", "Head 1": "head1", "Head 2": "head2", "Head 3": "head3" }, { tempo: "time" }],
    ["tubedelay", "Tube Delay", "delay", GX + "gxtubedelay#tubedelay", { Time: "delay", Feedback: "feedback", Level: "level" }, { tempo: "time" }],
    ["mbdelay", "Multiband Delay", "delay", GX + "gx_mbdelay_#_mbdelay_", { Time: "DELAY1", Feedback: "FEEDBACK1", Level: "GAIN1" }],
    ["mbecho", "Multiband Echo", "delay", GX + "gx_mbecho_#_mbecho_", { Time: "TIME1", Feedback: "PERCENT1" }],
    ["calfvdelay", "Vintage Delay", "delay", CALF + "VintageDelay", { Time: "subdiv", Feedback: "feedback", Amount: "amount", Width: "width", "Dry": "dry" }, { tempoBpm: "bpm" }],
    ["calfrev-delay", "Reverse Delay", "delay", CALF + "ReverseDelay", { Time: "subdiv", Feedback: "feedback", Amount: "amount", Width: "width" }, { tempoBpm: "bpm" }],
    ["zamdelay", "Zam Delay", "delay", "urn:zamaudio:ZamDelay", { Time: "time", Feedback: "feedb", Mix: "drywet", Tone: "lpf", Gain: "gain" }, { tempoBpm: "bpm" }],
    ["swh-tape", "Tape Delay", "delay", SWH + "tapeDelay", { Speed: "speed", Delay: "da_db", "Tap 1": "t1d", "Tap 2": "t2d" }],
    ["tap-echo", "TAP Stereo Echo", "delay", "ladspa:tap_echo.so:tap_stereo_echo", {}, { ladspa: "tap_echo.so", label: "tap_stereo_echo" }],
    ["mda-delay", "mda Delay", "delay", MDA + "Delay", { "Left": "l_delay", "Right": "r_delay", Feedback: "feedback", "FB tone": "fb_tone", Mix: "fx_mix", Output: "output" }],
    // ---- reverb
    ["gxreverb", "Stereo Reverb", "reverb", GX + "gx_reverb_stereo#_reverb_stereo", { Roomsize: "roomsize", Damp: "damp", Mix: "dry_wet" }],
    ["zitarev", "Zita Rev1 (hall)", "reverb", GX + "gx_zita_rev1_stereo#_zita_rev1_stereo", { "Low RT60": "LOW_RT60", "Mid RT60": "MID_RT60", "HF damping": "HF_DAMPING", Delay: "IN_DELAY", Dry: "DRY_WET_MIX" }],
    ["shimmer", "Shimmer Reverb", "reverb", GX + "gx_shimmizita_#_shimmizita_", { Shimmer: "SHIFT", "Mid RT60": "T60M", Mix: "DRYWET" }],
    ["roomsim", "Room Simulator", "reverb", GX + "gx_room_simulator_#_room_simulator_", { Room: "ROOMSIZE", Decay: "RT", Predelay: "PREDELAYMS", Mix: "DRYWET" }],
    ["mbreverb", "Multiband Reverb", "reverb", GX + "gx_mbreverb_#_mbreverb_", {}],
    ["calfreverb", "Calf Reverb", "reverb", CALF + "Reverb", { Decay: "decay_time", "High damp": "hf_damp", Room: "room_size", Diffusion: "diffusion", Amount: "amount", Dry: "dry", Predelay: "predelay" }],
    ["dfly-hall", "Dragonfly Hall", "reverb", "https://github.com/michaelwillis/dragonfly-reverb", { Dry: "dry_level", Early: "early_level", Late: "late_level", Size: "size", Width: "width", Predelay: "delay", Decay: "decay", "Low cut": "low_cut", "High cut": "high_cut" }],
    ["dfly-plate", "Dragonfly Plate", "reverb", "urn:dragonfly:plate", { Dry: "dry_level", Wet: "early_level", Width: "width", Predelay: "predelay", Decay: "decay", "Low cut": "low_cut", "High cut": "high_cut" }],
    ["dfly-room", "Dragonfly Room", "reverb", "urn:dragonfly:room", { Dry: "dry_level", Early: "early_level", Late: "late_level", Size: "size", Width: "width", Predelay: "predelay", Decay: "decay" }],
    ["dfly-early", "Dragonfly Early Reflections", "reverb", "urn:dragonfly:early", { Dry: "dry_level", Wet: "early_level", Size: "size", Width: "width" }],
    ["zamverb", "Zam Verb", "reverb", "urn:zamaudio:ZamVerb", { Mix: "wetdry", Room: "room", Level: "master" }],
    ["mda-amb", "mda Ambience", "reverb", MDA + "Ambience", { Size: "size", "HF damp": "hf_damp", Mix: "mix", Output: "output" }],
    ["swh-gverb", "GVerb", "reverb", SWH + "gverb", { Roomsize: "roomsize", "Reverb time": "revtime", Damping: "damping", "Input bandwidth": "inputbandwidth", "Dry": "drylevel", "Early": "earlylevel", "Tail": "taillevel" }],
    ["swh-plate", "Plate Reverb", "reverb", SWH + "plate", { Time: "time", Damping: "damping", Wet: "wet" }],
    ["tap-reverb", "TAP Reverberator", "reverb", "ladspa:tap_reverb.so:tap_reverb", {}, { ladspa: "tap_reverb.so", label: "tap_reverb" }],
    ["caps-plate", "C* Plate", "reverb", "ladspa:caps.so:Plate", {}, { ladspa: "caps.so", label: "Plate" }],
    // ---- amps / preamps
    ["gxamp", "Guitarix Amp (tube stack)", "amp", GX + "gx_amp#GUITARIX", { Pregain: "PreGain", Drive: "Drive", Bass: "Bass", Middle: "Middle", Treble: "Treble", Presence: "Presence", Master: "MasterGain" }],
    ["jcm800", "British 800 Preamp", "amp", GX + "gx_jcm800pre_#_jcm800pre_", { Preamp: "P6v", Bass: "Bass", Middle: "Middle", Treble: "Treble", Presence: "WET_DRY", Master: "GAIN" }],
    ["studiopre", "Studio Preamp", "amp", GX + "gx_studiopre#studiopre", { Bass: "bass", Middle: "middle", Treble: "treble", Volume: "volume" }],
    ["metalamp", "Metal Amp", "amp", GX + "gxmetal_amp#metal_amp", { Drive: "DRIVE", Tone: "TONE", Gain: "PREGAIN", Volume: "GAIN1" }],
    ["metalhead", "Metal Head", "amp", GX + "gxmetal_head#metal_head", { Drive: "DRIVE", Tone: "TONE", Gain: "PREGAIN", Volume: "GAIN1" }],
    ["chump", "Red Eye Chump (tweed)", "amp", GX + "gx_redeye#chump", { Volume: "Volume", Tone: "Tone", Gain: "Gain" }],
    ["bigchump", "Red Eye Big Chump", "amp", GX + "gx_redeye#bigchump", { Volume: "Volume", Tone: "Tone", Gain: "Gain" }],
    ["vibrochump", "Red Eye Vibro Chump", "amp", GX + "gx_redeye#vibrochump", { Volume: "Volume", Tone: "Tone", Speed: "Speed", Intensity: "Intensity" }],
    ["w20", "W20 Preamp", "amp", GX + "gx_w20#w20", { Gain: "gain", Volume: "level" }],
    ["zamtube", "Zam Tube", "amp", "urn:zamaudio:ZamTube", { Gain: "tubedrive", Bass: "bass", Mids: "mids", Treble: "treb", Output: "gain", Tone: "tonestack" }],
    ["gxtape", "Tape Saturation", "amp", GX + "gxtape#tape", { Drive: "drive", Tape: "type", Level: "gain" }],
    ["caps-amp", "C* AmpVTS (tube amp)", "amp", "ladspa:caps.so:AmpVTS", {}, { ladspa: "caps.so", label: "AmpVTS" }],
    ["calfsat", "Calf Saturator", "amp", CALF + "Saturator", { Drive: "drive", Blend: "blend", "Low cut": "lp_pre_freq", "High cut": "hp_pre_freq" }],
    ["tap-tube", "TAP TubeWarmth", "amp", "ladspa:tap_tubewarmth.so:tap_tubewarmth", {}, { ladspa: "tap_tubewarmth.so", label: "tap_tubewarmth" }],
    ["swh-valve", "Valve Saturation", "amp", SWH + "valve", { Distortion: "q_p", Character: "dist_p" }],
    // ---- cabinets
    ["gxcab", "Cabinet (28 models)", "cab", GX + "gx_cabinet#CABINET", { Cabinet: "c_model", Level: "CLevel", Bass: "CBass", Treble: "CTreble" }],
    ["caps-cab", "C* Cabinet IV", "cab", "ladspa:caps.so:CabinetIV", {}, { ladspa: "caps.so", label: "CabinetIV" }],
    ["ir-cab", "IR loader: cab / acoustic body (.wav)", "cab", "builtin:convolver", {}, { builtin: true, irFile: true }],
    ["ir", "Impulse Response (IR) loader", "cab", "http://tomszilagyi.github.io/plugins/lv2/ir", { Gain: "port_agc_sw", Predelay: "port_predelay", Length: "port_length", Dry: "port_dry_sw", Wet: "port_wet_sw" }, { file: true }],
    // ---- acoustic
    ["acoustic-sim", "Acoustic Simulator", "acoustic", CALF + "Equalizer5Band", { Body: "p1_level", Air: "hs_level", Warmth: "ls_level" }],
    ["acoustic-comp", "Acoustic Compressor", "acoustic", "urn:zamaudio:ZamComp", { Attack: "att", Release: "rel", Ratio: "rat", Threshold: "thr", Makeup: "mak" }],
    ["feedback-killer", "Feedback Notch", "acoustic", X42 + "fil4#mono", { Freq: "freq2", Cut: "gain2", Q: "q2" }],
    // ---- utility
    ["tuner", "Tuner", "util", GX + "gxtuner#tuner", {}],
    ["livelooper", "Live Looper (4 tracks)", "util", GX + "gx_livelooper_#_livelooper_", { Gain: "gain", Mix: "mix" }],
    ["volume", "Volume pedal", "util", CALF + "MonoInput", { Level: "level_in" }, { expression: "level_in" }],
    ["stereo", "Stereo Tools", "util", CALF + "StereoTools", { Balance: "balance_out", Width: "stereo_base" }],
    ["crusher", "Bit Crusher", "util", CALF + "Crusher", { Bits: "bits", "Sample reduce": "samples", Morph: "morph" }],
    ["ringmod", "Ring Modulator", "util", CALF + "RingModulator", { Freq: "mod_freq", Amount: "mod_amount", Mode: "mod_mode" }],
    ["mda-degrade", "mda Degrade", "util", MDA + "Degrade", { Headroom: "headroom", Quantize: "quant", Rate: "rate", "Post filter": "post_filt", Output: "output" }],
    ["vinyl", "Vinyl / Phono", "util", "urn:zamaudio:ZamPhono", { Type: "type" }],
    ["swh-vinyl", "Vynil effect", "util", SWH + "vynil", { Year: "year", RPM: "rpm", Warp: "warp", Click: "click", Wear: "wear" }],
    // ---- v8: 59 more (Calf, mda, EQ10Q, x42, Guitarix stereo, Invada, LSP, SWH, Zam)
    ["calf-monocomp", "Calf Mono Compressor", "comp", "http://calf.sourceforge.net/plugins/MonoCompressor", {"Input": "level_in", "Threshold": "threshold", "Ratio": "ratio", "Attack": "attack", "Release": "release"}],
    ["calf-tape", "Tape Simulator", "util", "http://calf.sourceforge.net/plugins/TapeSimulator", {"Input Gain": "level_in", "Output Gain": "level_out", "Mix": "mix", "Filter": "lowpass", "Noise": "noise"}],
    ["calf-transient", "Transient Designer", "comp", "http://calf.sourceforge.net/plugins/TransientDesigner", {"Input Gain": "level_in", "Output Gain": "level_out", "Mix": "mix", "Attack Time": "attack_time", "Attack Boost": "attack_boost"}],
    ["calf-spread", "Multi Spread (wide stereo)", "mod", "http://calf.sourceforge.net/plugins/MultiSpread", {"Input Gain": "level_in", "Output Gain": "level_out", "Filters": "filters", "Intensity Sub": "amount0", "Intensity Low": "amount1"}],
    ["calf-haas", "Haas Stereo Widener", "mod", "http://calf.sourceforge.net/plugins/HaasEnhancer", {"Input Gain": "level_in", "Output Gain": "level_out", "Side Gain": "s_gain", "Left Delay": "s_delay1", "Left Balance": "s_balance1"}],
    ["mda-bandisto", "Band Distortion", "dist", "http://drobilla.net/plugins/mda/Bandisto", {"L <> M": "l_m", "M <> H": "m_h", "L Dist": "l_dist", "M Dist": "m_dist", "H Dist": "h_dist"}],
    ["mda-dubdelay", "Dub Delay", "delay", "http://drobilla.net/plugins/mda/DubDelay", {"Delay": "delay", "Feedback": "feedback", "Fb Tone": "fb_tone", "LFO Depth": "lfo_depth", "LFO Rate": "lfo_rate"}],
    ["mda-repsycho", "RePsycho! (pitch drop)", "pitch", "http://drobilla.net/plugins/mda/RePsycho", {"Tune": "tune", "Fine": "fine", "Decay": "decay", "Thresh": "thresh", "Hold": "hold"}],
    ["mda-rezfilter", "Resonant Auto-Filter", "wah", "http://drobilla.net/plugins/mda/RezFilter", {"Freq": "freq", "Res": "res", "Output": "output", "Env->VCF": "env_vcf", "Attack": "attack"}],
    ["mda-ringmod", "Ring Modulator", "mod", "http://drobilla.net/plugins/mda/RingMod", {"Freq": "freq", "Fine": "fine", "Feedback": "feedback"}],
    ["mda-transient", "Attack Shaper", "comp", "http://drobilla.net/plugins/mda/Transient", {"Attack": "attack", "Release": "release", "Output": "output", "Filter": "filter", "Att Hold": "att_hold"}],
    ["mda-limiter", "Brickwall Limiter", "comp", "http://drobilla.net/plugins/mda/Limiter", {"Thresh": "thresh", "Output": "output", "Release": "release", "Attack": "attack"}],
    ["mda-image", "Stereo Image", "util", "http://drobilla.net/plugins/mda/Image", {"S Width": "s_width", "S Pan": "s_pan", "M Level": "m_level", "M Pan": "m_pan", "Output": "output"}],
    ["mda-shepard", "Shepard Rise", "pitch", "http://drobilla.net/plugins/mda/Shepard", {"Rate": "rate", "Output": "output"}],
    ["eq10q-comp", "CS10 Compressor", "comp", "http://eq10q.sourceforge.net/compressor", {"Threshold": "threshold", "Attack": "attack", "Makeup": "compmakeup", "Decay": "decay", "Ratio": "compratio"}],
    ["eq10q-eq4", "EQ4Q Parametric", "eq", "http://eq10q.sourceforge.net/eq/eq4qm", {"Input Gain": "input_gain", "Output Gain": "output_gain", "Filter 1 Gain": "filter1_gain", "Filter 2 Gain": "filter2_gain", "Filter 3 Gain": "filter3_gain"}],
    ["eq10q-gate", "GT10 Noise Gate", "comp", "http://eq10q.sourceforge.net/gate", {"Threshold": "threshold", "Attack": "attack", "Hold": "hold", "Decay": "decay", "Ratio": "compratio"}],
    ["eq10q-bassup", "Bass Up", "eq", "http://eq10q.sourceforge.net/bassup", {"Amount": "amount"}],
    ["x42-comp", "Studio Compressor", "studio", "http://gareus.org/oss/lv2/darc#mono", { "Input": "inputgain", "Threshold": "threshold", "Ratio": "Ratio", "Attack": "attack", "Release": "release" }, { values: { threshold: -24, Ratio: 0.6, attack: 0.01, release: 0.15 } }],
    ["x42-limiter", "Studio Limiter", "studio", "http://gareus.org/oss/lv2/dpl#mono", { "Input": "gain", "Ceiling": "threshold", "Release": "release" }],
    // ---- studio: our own 7-band parametric EQ (PipeWire's own filters on the Pi, the same filters in the computer rig) and a de-esser
    ["studio-eq", "Studio EQ (7-band parametric)", "studio", "builtin:studioeq", { "Low cut": "hp_freq", "Low shelf": "ls_gain", "Low freq": "ls_freq", "Bell 1": "p1_gain", "Bell 1 freq": "p1_freq", "Bell 1 width": "p1_q", "Bell 2": "p2_gain", "Bell 2 freq": "p2_freq", "Bell 2 width": "p2_q", "Bell 3": "p3_gain", "Bell 3 freq": "p3_freq", "Bell 3 width": "p3_q", "High shelf": "hs_gain", "High freq": "hs_freq", "High cut": "lp_freq", "Output": "out_gain" }, { builtin: true, graph: "eq" }],
    ["studio-deess", "Studio De-esser", "studio", MDA + "DeEss", { "Threshold": "thresh", "Frequency": "freq", "Highs": "hf_drive" }],
    ["x42-autotune", "Autotune (vocals)", "pitch", "http://gareus.org/oss/lv2/fat1", {"Tuning": "tuning", "Bias": "bias", "Filter": "filter", "Correction": "corr", "Offset": "offset"}],
    ["gx-digidelay-st", "Digital Delay Stereo", "delay", "http://guitarix.sourceforge.net/plugins/gx_digital_delay_st_#_digital_delay_st_", {"FEEDBACK": "FEEDBACK", "GAIN": "GAIN", "HIGHPASS": "HIGHPASS", "HOWPASS": "HOWPASS", "LEVEL": "LEVEL"}],
    ["gx-duckdelay-st", "Ducking Delay Stereo", "delay", "http://guitarix.sourceforge.net/plugins/gx_duck_delay_st_#_duck_delay_st_", {"AMOUNT": "AMOUNT", "ATTACK": "ATTACK", "COLORATION": "COLORATION", "EFFECT": "EFFECT", "FEEDBACK": "FEEDBACK"}],
    ["gx-tape-st", "Tape Echo Stereo", "delay", "http://guitarix.sourceforge.net/plugins/gxtape_st#tape", {"Drive": "drive", "WowDepth": "wowdepth", "WowFreq": "wowfreq", "FlutterDepth": "flutdepth", "FluterFreq": "flutfreq"}],
    ["gx-studiopre-st", "Studio Preamp Stereo", "amp", "http://guitarix.sourceforge.net/plugins/gx_studiopre_st#studiopre_st", {"Volume_L": "volume_l", "Bass_L": "bass_l", "Middle_L": "middle_l", "Treble_L": "treble_l", "Master_L": "master_l"}],
    ["gx-jcm800-st", "Plexi 800 Preamp Stereo", "amp", "http://guitarix.sourceforge.net/plugins/gx_jcm800pre_st#_jcm800pre_st", {"Pre Amp": "P6v", "Middle": "Middle", "Bass": "Bass", "Treble": "Treble", "Presence": "WET_DRY"}],
    ["invada-comp", "Invada Compressor", "comp", "http://invadarecords.com/plugins/lv2/compressor/mono", {"RMS": "rms", "Attack": "attack", "Release": "release", "Threshold": "threshold", "Ratio": "ratio"}],
    ["invada-delay", "Delay Munge", "delay", "http://invadarecords.com/plugins/lv2/delay/mono", {"Munge": "munge", "LFO": "LFOcycle", "Depth": "LFOdepth", "Delay 1": "delay1", "Feedback 1": "fb1"}],
    ["invada-er", "Early Reflections Room", "reverb", "http://invadarecords.com/plugins/lv2/erreverb/mono", {"Room Length": "roomLength", "Room Width": "roomWidth", "Room Height": "roomHeight", "Source Pan": "sourceLR", "Source": "sourceFB"}],
    ["invada-hpf", "High Pass Filter", "eq", "http://invadarecords.com/plugins/lv2/filter/hpf/mono", {"Frequency": "freq", "Gain": "gain"}],
    ["invada-lpf", "Low Pass Filter", "eq", "http://invadarecords.com/plugins/lv2/filter/lpf/mono", {"Frequency": "freq", "Gain": "gain"}],
    ["invada-phaser", "Stereo Phaser", "mod", "http://invadarecords.com/plugins/lv2/phaser/mono", {"Period": "cycle", "Width": "width", "Depth": "depth"}],
    ["invada-tube", "Tube Distortion", "dist", "http://invadarecords.com/plugins/lv2/tube/mono", {"Drive": "drive", "DC Offset": "dcoffset", "Mix": "mix"}],
    ["lsp-clipper", "LSP Soft Clipper", "dist", "http://lsp-plug.in/plugins/lv2/clipper_mono", {"Input gain": "g_in", "Output gain": "g_out", "Input LUFS lim": "lufs_th", "Clipping thres": "thresh", "Overdrive prot": "th"}],
    ["lsp-filter", "LSP Studio Filter", "eq", "http://lsp-plug.in/plugins/lv2/filter_mono", {"Input gain": "g_in", "Output gain": "g_out", "FFT reactivity": "react", "Shift gain": "shift", "Frequency": "f"}],
    ["lsp-limiter", "LSP Limiter", "comp", "http://lsp-plug.in/plugins/lv2/limiter_mono", {"Input gain": "g_in", "Output gain": "g_out", "Automatic leve": "alr_at", "Threshold": "th", "Knee": "knee"}],
    ["swh-autophaser", "Auto Phaser", "mod", "http://plugin.org.uk/swh-plugins/autoPhaser", {"Attack time": "attack_p", "Decay time": "decay_p", "Modulation dep": "depth_p", "Feedback": "fb", "Spread": "spread"}],
    ["swh-decimator", "Bit Crusher", "fuzz", "http://plugin.org.uk/swh-plugins/decimator", {"Bit depth": "bits", "Sample rate": "fs"}],
    ["swh-delayorama", "Delayorama (multi-tap)", "delay", "http://plugin.org.uk/swh-plugins/delayorama", {"Random seed": "seed", "Input gain": "gain", "Feedback": "feedback_pc", "Number of taps": "tap_count", "First delay": "first_delay"}],
    ["swh-djflanger", "DJ Flanger", "mod", "http://plugin.org.uk/swh-plugins/djFlanger", {"LFO period": "period", "LFO depth": "depth", "Feedback": "feedback"}],
    ["swh-flanger", "Flanger", "mod", "http://plugin.org.uk/swh-plugins/flanger", {"Delay base": "delay_base", "Max slowdown": "detune", "LFO frequency": "law_freq", "Feedback": "feedback"}],
    ["swh-giantflange", "Giant Flange", "mod", "http://plugin.org.uk/swh-plugins/giantFlange", {"LFO frequency ": "freq1", "Delay 1 range": "delay1", "Delay 2 range": "delay2", "Feedback": "feedback", "Dry/Wet level": "wet"}],
    ["swh-gate", "Gate", "comp", "http://plugin.org.uk/swh-plugins/gate", {"LF key filter": "lf_fc", "HF key filter": "hf_fc", "Threshold": "threshold", "Attack": "attack", "Hold": "hold"}],
    ["swh-harmonic", "Harmonic Generator", "dist", "http://plugin.org.uk/swh-plugins/harmonicGen", {"Fundamental ma": "mag_1", "2nd harmonic m": "mag_2", "3rd harmonic m": "mag_3", "4th harmonic m": "mag_4", "5th harmonic m": "mag_5"}],
    ["swh-lfophaser", "LFO Phaser", "mod", "http://plugin.org.uk/swh-plugins/lfoPhaser", {"LFO rate": "lfo_rate", "LFO depth": "lfo_depth", "Feedback": "fb", "Spread": "spread"}],
    ["swh-mbeq", "15-band Graphic EQ", "eq", "http://plugin.org.uk/swh-plugins/mbeq", {"50Hz gain": "band_1", "100Hz gain": "band_2", "156Hz gain": "band_3", "220Hz gain": "band_4", "311Hz gain": "band_5"}],
    ["swh-revdelay", "Reverse Delay", "delay", "http://plugin.org.uk/swh-plugins/revdelay", {"Delay Time": "delay_time", "Dry Level": "dry_level", "Wet Level": "wet_level", "Feedback": "feedback", "Crossfade samp": "xfade_samp"}],
    ["swh-ringmod", "Ring Mod LFO", "mod", "http://plugin.org.uk/swh-plugins/ringmod_1i1o1l", {"Modulation dep": "depthp", "Frequency": "freq", "Sine level": "sin", "Triangle level": "tri", "Sawtooth level": "saw"}],
    ["swh-satan", "Satan Maximiser", "dist", "http://plugin.org.uk/swh-plugins/satanMaximiser", {"Decay time": "env_time_p", "Knee point": "knee_point"}],
    ["swh-sc1", "SC1 Compressor", "comp", "http://plugin.org.uk/swh-plugins/sc1", {"Attack time": "attack", "Release time": "release", "Threshold leve": "threshold", "Ratio": "ratio", "Knee radius": "knee"}],
    ["swh-triplepara", "3-band Parametric EQ", "eq", "http://plugin.org.uk/swh-plugins/triplePara", {"Low-shelving g": "gain_L", "Low-shelving f": "fc_L", "Band 1 gain": "gain_1", "Band 1 frequen": "fc_1", "Band 1 bandwid": "bw_1"}],
    ["swh-valverect", "Valve Rectifier", "dist", "http://plugin.org.uk/swh-plugins/valveRect", { Sag: "sag", Distortion: "dist_p" }],
    ["swh-divider", "Octave Down (divider)", "pitch", "http://plugin.org.uk/swh-plugins/divider", {"Denominator": "denominator"}],
    ["swh-ampitch", "AM Pitch Shifter", "pitch", "http://plugin.org.uk/swh-plugins/amPitchshift", {"Pitch shift": "pitch", "Buffer size": "size"}],
    ["swh-foverdrive", "Fast Overdrive", "boost", "http://plugin.org.uk/swh-plugins/foverdrive", {"Drive level": "drive"}],
    ["swh-cheb", "Chebyshev Fuzz", "fuzz", "http://plugin.org.uk/swh-plugins/chebstortion", {"Distortion": "dist"}],
    ["swh-crossover", "Crossover Fuzz", "fuzz", "http://plugin.org.uk/swh-plugins/crossoverDist", {"Crossover ampl": "amp", "Smoothing": "smooth"}],
    ["zam-grains", "Grains (granular)", "pitch", "urn:zamaudio:ZamGrains", {"Output Gain": "gain", "Grains": "grains", "Grain Speed": "gs", "Play Speed": "ps", "Loop time": "time"}],
    ["zam-maxim", "ZaMaxim Loudness", "comp", "urn:zamaudio:ZaMaximX2", {"Release": "rel", "Output Ceiling": "ceil", "Threshold": "thresh"}],
    // ---- v8.1: 30 more (Zyn, swh, mda, Zam, Invada) - every knob checked against the plugin's own controls
    ["zyn-dist", "Zyn Distortion (14 curves)", "dist", "http://zynaddsubfx.sourceforge.net/fx#Distortion", { Drive: "drive", Level: "level", Curve: "type", Tone: "lpf", "Low cut": "hpf" }],
    ["diode", "Diode Rectifier", "fuzz", SWH + "diode", { Mode: "mode" }],
    ["waveshaper", "Waveshaper", "dist", SWH + "shaper", { Shape: "shapep" }],
    ["glitch", "Glitch Distortion", "fuzz", SWH + "pointerCastDistortion", { Cutoff: "cutoff", Mix: "wet" }],
    ["lofi", "Lo-Fi Decimator", "fuzz", SWH + "smoothDecimate", { Rate: "rate", Smooth: "smooth" }],
    ["wavefolder", "Wave Folder", "fuzz", SWH + "sinusWavewrapper", { Fold: "wrap" }],
    ["mda-dyn", "Dynamics (compressor + gate)", "comp", MDA + "Dynamics", { Threshold: "thresh", Ratio: "ratio", Output: "output", Attack: "attack", Release: "release", Gate: "gate_thr" }],
    ["se4", "Smooth Compressor (SE4)", "comp", SWH + "se4", { Threshold: "threshold", Ratio: "ratio", Attack: "attack", Release: "release", Knee: "knee" }],
    ["leveler", "Dyson Leveler", "comp", SWH + "dysonCompress", { Limit: "peak_limit", Ratio: "crate", Fast: "cfrate", Release: "release_time" }],
    ["transient", "Transient Shaper", "comp", SWH + "transient", { Attack: "attack", Sustain: "sustain" }],
    ["deesser", "De-esser", "acoustic", MDA + "DeEss", { Threshold: "thresh", Freq: "freq", "HF drive": "hf_drive" }],
    ["dyn-eq", "Dynamic EQ", "eq", "urn:zamaudio:ZamDynamicEQ", { Threshold: "thr", Ratio: "rat", Freq: "detectfreq", "Max cut / boost": "max", Attack: "att", Release: "rel" }],
    ["kill-eq", "Kill EQ (3-band)", "eq", SWH + "dj_eq_mono", { Low: "lo", Mid: "mid", High: "hi" }],
    ["synth-filter", "Synth Filter", "wah", SWH + "svf", { Type: "filt_type", Freq: "filt_freq", Q: "filt_q", Resonance: "filt_res" }],
    ["env-filter", "Envelope Filter", "wah", "http://zynaddsubfx.sourceforge.net/fx#DynamicFilter", { Sensitivity: "ampsns", Smooth: "ampsmooth", "LFO rate": "lfofreq", "LFO depth": "lfodepth" }],
    ["comb", "Comb Filter", "wah", SWH + "comb", { Freq: "freq", Feedback: "fb" }],
    ["zyn-chorus", "Zyn Chorus / Flanger", "mod", "http://zynaddsubfx.sourceforge.net/fx#Chorus", { Rate: "lfofreq", Depth: "depth", Delay: "delay", Feedback: "fb", Flange: "flang" }],
    ["zyn-phaser", "Zyn Phaser (12 stages)", "mod", "http://zynaddsubfx.sourceforge.net/fx#Phaser", { Rate: "lfofreq", Depth: "depth", Feedback: "fb", Stages: "stages", Width: "phase" }],
    ["stereo-phaser", "Stereo Phaser", "mod", "http://invadarecords.com/plugins/lv2/phaser/sum", { Period: "cycle", Offset: "phase", Width: "width", Depth: "depth" }],
    ["freq-shift", "Frequency Shifter", "pitch", SWH + "bodeShifter", { Shift: "shift" }],
    ["varispeed", "Vari-Speed (tape)", "pitch", SWH + "rateShifter", { Rate: "rate" }],
    ["synth-tracker", "Synth Tracker", "pitch", MDA + "Tracker", { Mode: "mode", Mix: "mix", Glide: "glide", Transpose: "transpose", Output: "output" }],
    ["zyn-echo", "Zyn Echo", "delay", "http://zynaddsubfx.sourceforge.net/fx#Echo", { Time: "delay", Feedback: "fb", Damp: "damp", Spread: "lrdelay" }],
    ["munge-delay", "Munge Delay", "delay", "http://invadarecords.com/plugins/lv2/delay/sum", { Time: "delay1", Feedback: "fb1", Munge: "munge", "Mod depth": "LFOdepth", "Time 2": "delay2" }],
    ["triple-tap", "Triple-Tap Delay", "delay", SWH + "lcrDelay", { Left: "ldel", Center: "cdel", Right: "rdel", Feedback: "feedback", Mix: "wet" }, { values: { wet: 0.4 } }],
    ["zyn-reverb", "Zyn Reverb", "reverb", "http://zynaddsubfx.sourceforge.net/fx#Reverb", { Time: "time", Size: "size", Damp: "damp", Tone: "lpf", Type: "type" }],
    ["er-room", "Early Reflection Room", "reverb", "http://invadarecords.com/plugins/lv2/erreverb/sum", { Length: "roomLength", Width: "roomWidth", Height: "roomHeight", Warmth: "warmth", Diffusion: "diffusion" }],
    ["widener", "Stereo Widener", "util", MDA + "Stereo", { Width: "width", Delay: "delay", Mod: "mod", Rate: "rate" }],
    ["auto-pan", "Auto Pan", "trem", MDA + "RoundPan", { Pan: "pan", Speed: "auto" }],
    ["hard-limit", "Hard Limiter", "util", SWH + "hardLimiter", { Limit: "limit_db", Wet: "wet_gain" }],
    // ---- 9.6: more studio tools and pedals (Ardour's ACE, LSP, Zam, DISTRHO, Fons Adriaensen's fomp, Rubber Band - all
    // GPL / LGPL plugins installed from Raspberry Pi OS / Debian, the same way as the ones above)
    ["ace-comp", "ACE Compressor", "comp", "urn:ardour:a-comp", { Threshold: "thr", Ratio: "rat", Attack: "att", Release: "rel", Knee: "kn", Makeup: "mak" }, { values: { thr: -18 } }],
    ["ace-exp", "ACE Expander / Gate", "comp", "urn:ardour:a-exp", { Threshold: "thr", Ratio: "rat", Attack: "att", Release: "rel" }],
    ["lsp-comp", "LSP Compressor", "comp", LSP + "compressor_mono", { Threshold: "al", Ratio: "cr", Attack: "at", Release: "rt", Knee: "kn", Makeup: "mk" }],
    ["lsp-gate", "LSP Gate", "comp", LSP + "gate_mono", { Threshold: "gt", Reduction: "gr", Attack: "at", Release: "rt" }],
    ["zam-multicomp", "Zam 3-Band Compressor", "studio", "urn:zamaudio:ZaMultiComp", { "Low thresh": "thr1", "Mid thresh": "thr2", "High thresh": "thr3", "Low/mid split": "xover1", "Mid/high split": "xover2", Output: "globalgain" }],
    ["ace-eq", "ACE 6-Band EQ", "eq", "urn:ardour:a-eq", { "Low shelf": "gl", "Low mid": "g1", Mid: "g2", Presence: "g3", Air: "g4", "High shelf": "gh", Output: "master" }],
    ["dpf-3band", "3-Band EQ", "eq", "http://distrho.sf.net/plugins/3BandEQ", { Low: "low", Mid: "mid", High: "high", Output: "master" }],
    ["fomp-para", "4-Band Parametric", "eq", "http://drobilla.net/plugins/fomp/parametric1", { "Band 1": "gain_1", "Freq 1": "freq_1", "Band 2": "gain_2", "Freq 2": "freq_2", "Band 3": "gain_3", "Freq 3": "freq_3", "Band 4": "gain_4", "Freq 4": "freq_4", Output: "gain" }, { values: { filter: 1, sec_1: 1, sec_2: 1, sec_3: 1, sec_4: 1 } }],
    ["ace-delay", "ACE Delay", "delay", "urn:ardour:a-delay", { Time: "time", Feedback: "feedback", Mix: "drywet", Tone: "lpf" }, { tempo: "time", values: { drywet: 30 } }],
    ["mverb", "MVerb Hall", "reverb", "http://distrho.sf.net/plugins/MVerb", { Mix: "mix", Decay: "decay", Size: "size", Damping: "damping", Predelay: "predelay" }, { values: { mix: 30 } }],
    ["gigaverb", "Gigaverb Cathedral", "reverb", "http://distrho.sf.net/plugins/MaGigaverb", { Time: "revtime", Room: "roomsize", Damping: "damping", Tail: "tail", Early: "early", Dry: "dry" }, { values: { revtime: 6 } }],
    ["ace-reverb", "ACE Reverb", "reverb", "urn:ardour:a-reverb", { Mix: "blend", Room: "roomsz" }],
    ["zita-rev", "Zita Room Reverb", "reverb", "http://drobilla.net/plugins/fomp/reverb", { Mix: "out_mix", "Low decay": "rt_low", "Mid decay": "rt_mid", Damping: "damping", Predelay: "delay" }, { values: { out_mix: 0.3 } }],
    ["pingpong", "Ping Pong Pan", "trem", "http://distrho.sf.net/plugins/PingPongPan", { Rate: "freq", Width: "width" }],
    ["zam-autosat", "Auto Saturation", "boost", "urn:zamaudio:ZamAutoSat", {}],
    ["soulforce", "Soul Force (wavefolder drive)", "dist", "http://www.niallmoody.com/ndcplugs/soulforce.htm", { Shape: "shape", Feedback: "fback" }],
    ["bitcrush", "Bit Crusher", "dist", "http://distrho.sf.net/plugins/MaBitcrush", { Bits: "resolution" }],
    ["fomp-autowah", "Auto-Wah", "wah", "http://drobilla.net/plugins/fomp/autowah", { Drive: "drive", Decay: "decay", Range: "range", Freq: "freq", Mix: "mix" }],
    ["cs-chorus", "CS Chorus", "mod", "http://drobilla.net/plugins/fomp/cs_chorus1", { Delay: "delay", Rate: "mod_freq_1", Depth: "mod_amp_1", "Rate 2": "mod_freq_2", "Depth 2": "mod_amp_2" }],
    ["cs-phaser", "CS Phaser", "mod", "http://drobilla.net/plugins/fomp/cs_phaser1_lfo", { Rate: "lfo_freq", Depth: "mod_gain", Stages: "sections", Feedback: "fb_gain", Mix: "out_mix" }, { values: { sections: 4, fb_gain: 0.3, out_mix: 0.5 } }],
    ["rb-pitch", "Pitch Shifter (Rubber Band)", "pitch", "http://breakfastquay.com/rdf/lv2-rubberband#mono", { Semitones: "semitones", Octaves: "octaves", Cents: "cents", Mix: "wetdry" }],
    ["ma-pitch", "Granular Pitch", "pitch", "http://distrho.sf.net/plugins/MaPitchshift", { Ratio: "ratio", Window: "window", Blur: "blur" }],
  ];
  // ---- the plans (yearly, per person): which plan unlocks each pedal. "free" ones come with every Central Pedal and app.
  var PLANS = {
    keys: { name: "Central Keys", price: "$50 a year", what: "pianos, electric pianos, organs, synths and pads" },
    plugins: { name: "Central Plugins", price: "$120 a year", what: "EQ, compressors, reverb, delay and mix effects" },
    instrument: { name: "Central Instrument", price: "$80 a year", what: "basses, guitars, strings, brass and winds to play from your guitar" },
    pedals: { name: "Central Pedals", price: "$50 a year", what: "drive, fuzz, wah, modulation, pitch, amps, cabs and acoustic pedals" }
  };
  var TIER_OF_CATEGORY = { comp: "plugins", eq: "plugins", delay: "plugins", reverb: "plugins", studio: "plugins", util: "plugins",
    boost: "pedals", dist: "pedals", fuzz: "pedals", wah: "pedals", mod: "pedals", trem: "pedals", pitch: "pedals", amp: "pedals", cab: "pedals", acoustic: "pedals" };
  // the free starter set: one or two essentials of each kind (boost, drive, compressor, gate, EQ, chorus, delay, reverb, amp, cab), the tuner and the volume pedal
  var FREE = { booster: 1, ts9: 1, gxcomp: 1, calfcomp: 1, calfgate: 1, calfeq5: 1, calfbass: 1, gxchorus: 1, digdelay: 1, "dfly-hall": 1, gxamp: 1, gxcab: 1, "acoustic-comp": 1, tuner: 1, volume: 1 };
  var pedals = P.map(function (p) { return { id: p[0], name: p[1], category: p[2], uri: p[3], knobs: p[4] || {}, opts: p[5] || {}, tier: FREE[p[0]] ? "free" : TIER_OF_CATEGORY[p[2]] || "pedals" }; });

  // ---- our own boards: presets made of several pedals (name, instrument kind, chain)
  var BOARDS = [
    { id: "clean-worship", name: "Clean Worship", kind: "electric", chain: [["gxcomp", {}], ["booster", {}], ["gxchorus", { Level: 0.3 }], ["digdelay", { Feedback: 35, Mix: 30 }], ["dfly-hall", { Decay: 3.2 }], ["gxamp", {}], ["gxcab", {}]] },
    { id: "ambient-swell", name: "Ambient Swell", kind: "electric", chain: [["volume", {}], ["gxcomp", {}], ["shimmer", {}], ["echocat", {}], ["dfly-hall", { Decay: 6 }], ["gxamp", {}], ["gxcab", {}]] },
    { id: "edge-delay", name: "Edge Dotted-Eighth", kind: "electric", chain: [["gxcomp", {}], ["ts9", { Drive: 0.3 }], ["digdelay", { Feedback: 45, Mix: 40 }], ["calfvdelay", {}], ["gxreverb", {}], ["jcm800", {}], ["gxcab", {}]] },
    { id: "blues-crunch", name: "Blues Crunch", kind: "electric", chain: [["ts9", { Drive: 0.55 }], ["hogsfoot", {}], ["gxtrem", {}], ["gxreverb", {}], ["chump", {}], ["gxcab", {}]] },
    { id: "modern-gain", name: "Modern High Gain", kind: "electric", chain: [["calfgate", {}], ["ts9", { Drive: 0.2, Level: 0.8 }], ["metalhead", {}], ["gxcab", {}], ["calfeq5", {}], ["digdelay", { Mix: 15 }]] },
    { id: "fuzz-wall", name: "Fuzz Wall", kind: "electric", chain: [["muff", {}], ["oc2", {}], ["gxphaser", {}], ["gxamp", {}], ["gxcab", {}]] },
    { id: "acoustic-natural", name: "Acoustic Natural", kind: "acoustic", chain: [["feedback-killer", {}], ["acoustic-comp", {}], ["acoustic-sim", {}], ["dfly-plate", {}]] },
    { id: "acoustic-shimmer", name: "Acoustic Shimmer", kind: "acoustic", chain: [["acoustic-comp", {}], ["gxchorus", {}], ["shimmer", {}], ["dfly-hall", {}]] },
    { id: "acoustic-dry", name: "Acoustic Dry (DI)", kind: "acoustic", chain: [["calfgate", {}], ["acoustic-comp", {}], ["calfeq5", {}]] },
    { id: "bass-di", name: "Bass: Clean DI", kind: "bass", chain: [["calfgate", {}], ["gxcomp", {}], ["calfbass", {}], ["calfeq5", {}]] },
    { id: "bass-amp", name: "Bass: Warm Amp", kind: "bass", chain: [["gxcomp", {}], ["alembic", {}], ["caps-tonestack", {}], ["gxcab", {}]] },
    { id: "bass-drive", name: "Bass: Grit", kind: "bass", chain: [["calf-monocomp", {}], ["mole", {}], ["calfbass", {}], ["gxcab", {}]] },
    { id: "bass-synth", name: "Bass: Octave Synth", kind: "bass", chain: [["gxcomp", {}], ["oc2", {}], ["mda-sub", {}], ["eq10q-bassup", {}]] },
    { id: "keys-stage", name: "Keys: Stage", kind: "keys", chain: [["calfcomp", {}], ["calfeq5", {}], ["dfly-hall", { Decay: 2.6 }]] },
    { id: "keys-ambient", name: "Keys: Ambient Pad", kind: "keys", chain: [["calfchorus", {}], ["calfvdelay", {}], ["dfly-hall", { Decay: 6 }]] },
    { id: "keys-ep", name: "Keys: EP Tremolo", kind: "keys", chain: [["tap-trem", {}], ["calfphaser", {}], ["dfly-plate", {}]] },
    { id: "keys-organ", name: "Keys: Organ Leslie", kind: "keys", chain: [["calfrotary", {}], ["gxreverb", {}]] },
    { id: "studio-acoustic", name: "Studio: Acoustic Channel Strip", kind: "acoustic", chain: [["feedback-killer", {}], ["studio-eq", { hp_freq: 80, p1_gain: -3, p1_freq: 250, p3_gain: 2, p3_freq: 5000, hs_gain: 1.5 }], ["x42-comp", { threshold: -24, Ratio: 0.6 }], ["x42-limiter", {}]] },
    { id: "studio-bass", name: "Studio: Bass Channel Strip", kind: "bass", chain: [["studio-eq", { hp_freq: 35, p1_gain: -3, p1_freq: 300, p1_q: 1.2, p3_gain: 2, p3_freq: 2500, lp_freq: 9000 }], ["x42-comp", { threshold: -26, Ratio: 0.75, attack: 0.02, release: 0.2 }], ["x42-limiter", {}]] },
    { id: "studio-keys", name: "Studio: Keys Polish", kind: "keys", chain: [["studio-eq", { hp_freq: 40, p1_gain: -2, p1_freq: 350, hs_gain: 1.5, hs_freq: 10000 }], ["x42-comp", { threshold: -22, Ratio: 0.5, attack: 0.02, release: 0.3 }], ["dfly-plate", {}], ["x42-limiter", {}]] },
    // ---- 9.5: finished presets. A keys board can bring its sound too ("sound": the first sound whose name matches)
    { id: "worship-grand", name: "Worship Grand", kind: "keys", sound: "salamander|ydp|grand piano|concert grand|grand", chain: [["calfcomp", { Threshold: 0.25, Ratio: 2.5 }], ["calfeq5", {}], ["dfly-hall", { Decay: 2.8, Late: 22 }]] },
    { id: "ambient-keys", name: "Ambient Keys", kind: "keys", sound: "sweep pad|new age|bowed|choir|pad", chain: [["gxchorus", { Level: 0.35 }], ["digdelay", { Feedback: 55, Mix: 35 }], ["dfly-hall", { Decay: 7.5, Late: 35 }]] },
    { id: "fingerstyle-bass", name: "Bass: Fingerstyle", kind: "bass", chain: [["calfgate", {}], ["studio-eq", { hp_freq: 32, p1_gain: -2.5, p1_freq: 250, p1_q: 1, p3_gain: 2.5, p3_freq: 1800, lp_freq: 7000 }], ["x42-comp", { threshold: -24, Ratio: 0.7, attack: 0.025, release: 0.18 }], ["calfbass", { Amount: 0.35 }]] },
    { id: "clean-strat", name: "Clean Strat-ish", kind: "electric", chain: [["gxcomp", {}], ["chump", { Gain: 0.25, Tone: 0.65 }], ["gxcab", {}], ["tubetrem", { Depth: 0.25 }], ["gxchorus", { Level: 0.2 }], ["digdelay", { Feedback: 25, Mix: 18 }], ["dfly-hall", { Decay: 1.8 }]] },
    // ---- 9.6: the orchestra (VSCO 2: CE - free with every app, so "soundPlan: free") and boards for the new pedals
    { id: "worship-strings", name: "Worship Strings", kind: "keys", sound: "worship strings|violins|string", soundPlan: "free", chain: [["calfeq5", {}], ["dfly-hall", { Decay: 3.6, Late: 25 }]] },
    { id: "cello-pad", name: "Cello Pad", kind: "keys", sound: "cello pad|cellos|cello", soundPlan: "free", chain: [["gxchorus", { Level: 0.15 }], ["dfly-hall", { Decay: 6.5, Late: 30 }]] },
    { id: "brass-swell", name: "Brass Swell", kind: "keys", sound: "brass swell|french horn|brass", soundPlan: "free", chain: [["calfcomp", { Threshold: 0.3, Ratio: 2 }], ["dfly-hall", { Decay: 2.6 }]] },
    { id: "flute-lead", name: "Flute Lead", kind: "keys", sound: "flute lead|flute", soundPlan: "free", chain: [["digdelay", { Feedback: 30, Mix: 20 }], ["dfly-hall", { Decay: 2.2 }]] },
    { id: "studio-keys-ace", name: "Studio: Warm Keys", kind: "keys", chain: [["ace-eq", { "Low mid": -2, Air: 1.5 }], ["ace-comp", { Threshold: -20, Ratio: 3 }], ["mverb", { Mix: 22, Decay: 55 }]] },
    { id: "funk-wah", name: "Auto-Wah Funk", kind: "electric", chain: [["gxcomp", {}], ["fomp-autowah", { Drive: 4, Range: 0.7 }], ["gxamp", {}], ["gxcab", {}], ["cs-phaser", { Rate: 0.6 }]] },
    { id: "bass-octave-down", name: "Bass: Octave Down", kind: "bass", chain: [["calfgate", {}], ["gxcomp", {}], ["rb-pitch", { Octaves: -1, Mix: 0.5 }], ["calfbass", {}]] }
  ];
  var BY_ID = {}; pedals.forEach(function (p) { BY_ID[p.id] = p; });
  function byId(id) { return BY_ID[id] || null; }
  // a board needs the plans of its pedals (a board of free pedals is free)
  function boardPlans(board) { var need = []; ((board && board.chain) || []).forEach(function (item) { var p = item && !(item[0] === "plug") ? byId(item[0] || item.pedal) : null; if (p && p.tier !== "free" && need.indexOf(p.tier) < 0) need.push(p.tier); }); return need; }
  BOARDS.forEach(function (b) { b.plans = boardPlans(b); var sp = b.soundPlan || "keys"; if (b.sound && sp !== "free" && b.plans.indexOf(sp) < 0) b.plans.unshift(sp); b.tier = b.plans.length ? b.plans[0] : "free"; });

  // ---- keys & instrument sounds: a bank's own tier (get-sounds.sh lists it), else by what the sound is
  var INSTRUMENT_CATS = { "Guitars & harp": 1, Bass: 1, "Brass & winds": 1, Strings: 1 };
  function soundTier(sound) {
    if (!sound) return "free";
    if (sound.user || sound.plugin) return "free";   // (the musician's own banks, Central Tracks sounds and plugins)
    if (sound.bankTier) return sound.bankTier;
    if (/synth|\bfm\b|analog|saw|square/i.test(sound.name || "")) return "keys";
    return INSTRUMENT_CATS[sound.category] ? "instrument" : "keys";
  }
  // is a plan active? (PPLicense knows; licensing off, or no license file here: everything is)
  function lic() { var L = global.PPLicense; if (L && typeof L.hasPlan === "function") return L; try { if (global.parent && global.parent !== global && global.parent.PPLicense && global.parent.PPLicense.hasPlan) return global.parent.PPLicense; } catch (_) { } return null; }
  function has(tier) { if (!tier || tier === "free") return true; var L = lic(); return L ? !!L.hasPlan(tier) : true; }
  function missing(tiers) { return (Array.isArray(tiers) ? tiers : [tiers]).filter(function (t) { return t && t !== "free" && !has(t); }); }
  function planText(tiers) { var m = Array.isArray(tiers) ? tiers : [tiers]; return m.filter(function (t) { return PLANS[t]; }).map(function (t) { return PLANS[t].name + " · " + PLANS[t].price; }).join(" + "); }
  function lockText(tiers) { var t = planText(tiers); return t ? "Part of " + t : ""; }
  var api = { CATEGORIES: CATEGORIES, pedals: pedals, boards: BOARDS, byId: byId, PLANS: PLANS, FREE: FREE, boardPlans: boardPlans, soundTier: soundTier, has: has, missing: missing, planText: planText, lockText: lockText,
    pedalLocked: function (p) { p = typeof p === "string" ? byId(p) : p; return !!(p && p.tier && !has(p.tier)); },
    boardLocked: function (b) { return missing(b && (b.plans || boardPlans(b))).length > 0; } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PPPedals = api;
})(typeof window !== "undefined" ? window : globalThis);
