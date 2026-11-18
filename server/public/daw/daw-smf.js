/* The DAW's MIDI files (10.8): read a Standard MIDI File (.mid, format 0 or 1) into tracks of notes, and write a clip or
 * a track back out as one. Dropping a .mid on the timeline makes an instrument track for each part (a part is one MIDI
 * track and channel; channel 10 is drums), with its notes in a clip, named from the file and given a sound that fits its
 * General MIDI instrument. The sustain pedal is baked into the notes' lengths (a held pedal keeps them sounding), the
 * same as most DAWs do when they bring a file in without a pedal lane.
 *
 *   CDawSMF.read(bytes) -> { ppq, format, bpm, tempos: [{ beat, bpm }], sigs: [{ beat, n, d }], name,
 *                            parts: [{ name, channel, program, drums, notes: [{ p, v, s, d }] (beats), cc: [{ s, c, v }], bend: [{ s, v }] }] }
 *   CDawSMF.write({ bpm, sig, name, parts: [{ name, channel, program, notes: [{ p, v, s, d }] }] }) -> Uint8Array (format 1, 480 ppq)
 *   CDawSMF.gmName(program) / gmFamily(program)   the General MIDI name, and the browser's category for it
 *   CDawSMF.isMidi(bytes)
 * Shared file: server/public/daw/ (Central Production and the Studio in Central Usage). */
(function () {
  "use strict";
  var GM = ["Acoustic Grand Piano", "Bright Piano", "Electric Grand", "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet", "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Bandoneon", "Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar", "Muted Guitar", "Overdrive Guitar", "Distortion Guitar", "Guitar Harmonics",
    "Acoustic Bass", "Finger Bass", "Pick Bass", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2", "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Harp", "Timpani",
    "Strings", "Slow Strings", "Synth Strings 1", "Synth Strings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit", "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
    "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet", "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
    "Square Lead", "Saw Lead", "Calliope Lead", "Chiff Lead", "Charang Lead", "Voice Lead", "Fifths Lead", "Bass & Lead", "New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad", "Bowed Pad", "Metallic Pad", "Halo Pad", "Sweep Pad",
    "Rain", "Soundtrack", "Crystal", "Atmosphere", "Brightness", "Goblins", "Echoes", "Sci-fi", "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal", "Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone", "Helicopter", "Applause", "Gunshot"];
  // the browser's categories (daw-sounds.js CAT_ORDER), by General MIDI family of eight
  var FAM = ["Pianos", "Bells & mallets", "Organs", "Guitars & harp", "Bass", "Strings", "Strings", "Brass & winds", "Brass & winds", "Brass & winds", "Synths & leads", "Pads & choirs", "Other", "Other", "Drums", "Other"];
  function gmName(p) { return GM[(p | 0) & 127] || "Instrument"; }
  function gmFamily(p) { p = (p | 0) & 127; if (p === 4 || p === 5 || p === 7) return "Electric pianos"; if (p === 46) return "Guitars & harp"; if (p >= 52 && p <= 54) return "Pads & choirs"; if (p === 50 || p === 51) return "Strings"; return FAM[p >> 3]; }
  function isMidi(b) { b = b instanceof Uint8Array ? b : new Uint8Array(b); return b.length > 14 && b[0] === 0x4D && b[1] === 0x54 && b[2] === 0x68 && b[3] === 0x64; }

  // ------------------------------------------------------------- reading
  function read(input) {
    var b = input instanceof Uint8Array ? input : new Uint8Array(input), pos = 0;
    function u8() { if (pos >= b.length) throw new Error("the MIDI file ends too soon"); return b[pos++]; }
    function u16() { return (u8() << 8) | u8(); }
    function u32() { return ((u8() << 24) >>> 0) + (u8() << 16) + (u8() << 8) + u8(); }
    function vlq() { var v = 0, c, n = 0; do { c = u8(); v = (v << 7) | (c & 0x7F); if (++n > 4) throw new Error("a bad length in the MIDI file"); } while (c & 0x80); return v; }
    function tag() { return String.fromCharCode(u8(), u8(), u8(), u8()); }
    if (!isMidi(b)) throw new Error("That isn't a MIDI file.");
    tag(); var hlen = u32(), format = u16(), ntrk = u16(), div = u16(); pos = 8 + hlen;
    if (div & 0x8000) throw new Error("This MIDI file counts time in SMPTE frames, which isn't supported. Save it with beats (PPQ) from your other app.");
    var ppq = div || 480, tempos = [], sigs = [], raw = [], fileName = "";
    for (var ti = 0; ti < ntrk && pos + 8 <= b.length; ti++) {
      var id = tag(), len = u32(), end = Math.min(b.length, pos + len);
      if (id !== "MTrk") { pos = end; continue; }
      var tick = 0, run = 0, name = "", ev = [];
      while (pos < end) {
        tick += vlq(); var st = b[pos];
        if (st & 0x80) { pos++; if (st < 0xF0) run = st; } else if (run) st = run; else { pos = end; break; }
        if (st === 0xFF) {
          var mt = u8(), ml = vlq(), md = b.subarray(pos, pos + ml); pos += ml;
          if (mt === 0x51 && ml >= 3) tempos.push({ tick: tick, bpm: 60000000 / ((md[0] << 16) | (md[1] << 8) | md[2]) });
          else if (mt === 0x58 && ml >= 2) sigs.push({ tick: tick, n: md[0], d: Math.pow(2, md[1]) });
          else if ((mt === 0x03 || mt === 0x04) && !name) name = text(md);
          else if (mt === 0x2F) break;
        } else if (st === 0xF0 || st === 0xF7) { pos += vlq(); }
        else {
          var hi = st & 0xF0, ch = st & 15, d1 = u8(), d2 = hi === 0xC0 || hi === 0xD0 ? 0 : u8();
          ev.push({ tick: tick, t: hi, ch: ch, a: d1, b: d2 });
        }
      }
      pos = end;
      if (ti === 0 && name && !ev.length) fileName = name;
      raw.push({ name: name, ev: ev });
    }
    function beat(t) { return t / ppq; }
    tempos.sort(function (a, c) { return a.tick - c.tick; }); sigs.sort(function (a, c) { return a.tick - c.tick; });
    // the parts: one per MIDI track and channel that has notes
    var parts = [];
    raw.forEach(function (tr) {
      var byCh = {};
      tr.ev.forEach(function (e) { (byCh[e.ch] = byCh[e.ch] || []).push(e); });
      Object.keys(byCh).forEach(function (chs) {
        var ch = +chs, evs = byCh[chs], open = {}, notes = [], cc = [], bend = [], program = null, pedal = false, held = [];
        evs.forEach(function (e) {
          if (e.t === 0x90 && e.b > 0) {
            if (pedal) for (var k = held.length - 1; k >= 0; k--) if (held[k].p === e.a) { held[k].off = e.tick; notes.push(held.splice(k, 1)[0]); }   // (struck again under the pedal: the old one ends there)
            (open[e.a] = open[e.a] || []).push({ p: e.a, v: e.b, on: e.tick });
          }
          else if (e.t === 0x80 || (e.t === 0x90 && e.b === 0)) {
            var q = open[e.a]; if (!q || !q.length) return; var n = q.shift(); n.off = e.tick;
            if (pedal) held.push(n); else notes.push(n);
          } else if (e.t === 0xB0) {
            if (e.a === 64) { var down = e.b >= 64; if (pedal && !down) { held.forEach(function (n2) { n2.off = Math.max(n2.off, e.tick); notes.push(n2); }); held = []; } pedal = down; }
            cc.push({ s: beat(e.tick), c: e.a, v: e.b });
          } else if (e.t === 0xC0) { if (program == null) program = e.a; }
          else if (e.t === 0xE0) bend.push({ s: beat(e.tick), v: ((e.b << 7) | e.a) - 8192 });
        });
        var last = evs.length ? evs[evs.length - 1].tick : 0;
        held.forEach(function (n) { n.off = Math.max(n.off, last); notes.push(n); });
        Object.keys(open).forEach(function (k) { open[k].forEach(function (n) { n.off = Math.max(n.on + ppq / 4, last); notes.push(n); }); });
        if (!notes.length) return;
        notes.sort(function (a, c) { return a.on - c.on || a.p - c.p; });
        var drums = ch === 9;
        parts.push({ name: tr.name || (drums ? "Drums" : program != null ? gmName(program) : "MIDI " + (parts.length + 1)), channel: ch + 1, program: program == null ? 0 : program, drums: drums,
          notes: notes.map(function (n) { return { p: n.p, v: n.v, s: beat(n.on), d: Math.max(1 / 64, beat(n.off - n.on)) }; }), cc: cc, bend: bend });
      });
    });
    var bpm = tempos.length ? Math.round(tempos[0].bpm * 100) / 100 : 120;
    return { ppq: ppq, format: format, bpm: bpm, name: fileName,
      tempos: tempos.map(function (t) { return { beat: beat(t.tick), bpm: Math.round(t.bpm * 100) / 100 }; }),
      sigs: sigs.map(function (s) { return { beat: beat(s.tick), n: s.n, d: s.d }; }), parts: parts };
  }
  function text(u) { var s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); try { s = decodeURIComponent(escape(s)); } catch (_) { } return s.replace(/[\u0000-\u001f]+/g, " ").trim(); }

  // ------------------------------------------------------------- writing
  function write(song) {
    var PPQ = 480, out = [];
    function vlq(v) { v = Math.max(0, Math.round(v)); var bytes = [v & 0x7F]; while ((v >>= 7)) bytes.unshift((v & 0x7F) | 0x80); return bytes; }
    function str(s) { var u = unescape(encodeURIComponent(String(s || ""))), a = []; for (var i = 0; i < u.length && i < 120; i++) a.push(u.charCodeAt(i)); return a; }
    function chunk(id, data) { var h = [id.charCodeAt(0), id.charCodeAt(1), id.charCodeAt(2), id.charCodeAt(3), (data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255]; return h.concat(data); }
    function track(events) {   // [{ tick, bytes }]
      events.sort(function (a, b) { return a.tick - b.tick || a.order - b.order; });
      var d = [], last = 0; events.forEach(function (e) { d = d.concat(vlq(e.tick - last), e.bytes); last = e.tick; });
      return chunk("MTrk", d.concat([0x00, 0xFF, 0x2F, 0x00]));
    }
    var bpm = song.bpm || 120, us = Math.round(60000000 / bpm), sig = song.sig || [4, 4], parts = song.parts || [];
    var meta = [{ tick: 0, order: 0, bytes: [0xFF, 0x03].concat(vlq(str(song.name).length), str(song.name)) }, { tick: 0, order: 1, bytes: [0xFF, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
      { tick: 0, order: 2, bytes: [0xFF, 0x58, 0x04, sig[0], Math.round(Math.log2(sig[1] || 4)), 24, 8] }];
    out = out.concat(chunk("MThd", [0, 1, ((parts.length + 1) >> 8) & 255, (parts.length + 1) & 255, (PPQ >> 8) & 255, PPQ & 255]), track(meta));
    parts.forEach(function (p, i) {
      var ch = ((p.channel || (p.drums ? 10 : (i % 15) + 1 + (i >= 9 ? 1 : 0))) - 1) & 15, ev = [{ tick: 0, order: 0, bytes: [0xFF, 0x03].concat(vlq(str(p.name).length), str(p.name)) }];
      if (ch !== 9) ev.push({ tick: 0, order: 1, bytes: [0xC0 | ch, (p.program | 0) & 127] });
      (p.notes || []).forEach(function (n) {
        var on = Math.round(n.s * PPQ), off = Math.max(on + 1, Math.round((n.s + n.d) * PPQ));
        ev.push({ tick: on, order: 3, bytes: [0x90 | ch, n.p & 127, Math.max(1, Math.min(127, n.v | 0))] }, { tick: off, order: 2, bytes: [0x80 | ch, n.p & 127, 0] });
      });
      out = out.concat(track(ev));
    });
    return new Uint8Array(out);
  }
  window.CDawSMF = { read: read, write: write, gmName: gmName, gmFamily: gmFamily, isMidi: isMidi };
})();
