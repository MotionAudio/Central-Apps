/* Pad Pedal - multitrack player (runs on the audio thread as an AudioWorklet).
 *
 * The code lives inside a function so the page can load it from a data: URL
 * (file:// pages cannot load worklets from blob: URLs). Everything happens here
 * with sample accuracy: stem mixing (gain / pan / mute / solo), the click
 * (accent on the downbeat, optional subdivision, count-in), spoken cues,
 * section loops, seeking, and live key / tempo shifting (WSOLA + resampling
 * on the stereo mix, so it costs the same for 1 stem or 12).
 *
 * Output 0 = music (L, R)      Output 1 = click + cues (L, R)
 * Output 2 = direct outs (one stem per channel)   Output 3 = network send to Central Control (every stem, raw)
 */
window.PP_MULTITRACK_WORKLET = function () {
  var N = 2048, HS = 1024, SEARCH = 288, SEARCH_STEP = 4, CORR = 512;
  var win = new Float32Array(N);
  for (var i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);

  function makeClick(rate, freq, ms, noise) {
    var n = Math.floor(rate * ms / 1000), out = new Float32Array(n), ph = 0, step = 2 * Math.PI * freq / rate;
    for (var i = 0; i < n; i++) {
      var env = Math.exp(-i / n * 7), t = Math.sin(ph) * env;
      ph += step;
      if (noise && i < n * 0.25) t += (Math.random() * 2 - 1) * noise * Math.exp(-i / n * 24);
      out[i] = t;
    }
    return out;
  }

  class Multitrack extends AudioWorkletProcessor {
    constructor() {
      super();
      this.rate = sampleRate;
      this.stems = [];
      this.length = 0;
      this.pos = 0;
      this.playing = false;
      this.loop = null;
      this.jump = null;
      this.speed = 1;
      this.pitch = 1;
      this.musicLevel = 1;
      this.outGain = 1; this.outTarget = 1; this.outStep = 0;   // the whole player's output: the backup player follows silently (0), then fades in
      this.fadeGain = 1;
      this.fadeStep = 0;
      this.beats = null;      // Float64Array, song-time in samples
      this.downbeats = null;  // Uint8Array, 1 = first beat of a bar
      this.click = { enabled: true, level: 0.8, sub: 1, sound: "wood" };
      this.clickBufs = this.buildClicks("wood");
      this.liveClicks = [];
      this.cueBuffers = {};
      this.cues = [];         // {time (samples), id, level}
      this.cueIdx = 0;
      this.liveCues = [];
      this.cueLevel = 1;
      this.countIn = { beats: 0, active: false, target: 0, beatLen: 0, nextBeat: 0, remaining: 0, voice: true };
      this.events = [];
      this.eventIdx = 0;
      this.lookahead = Math.floor(this.rate * 0.25);
      this.posCounter = 0;
      this.resetShifter();
      this.port.onmessage = this.onMessage.bind(this);
    }

    buildClicks(sound) {
      var r = this.rate, u = this.userClicks && this.userClicks[sound];
      if (u && u.hi && u.hi.length) {   // a click set from Central Tracks: its own two samples (the sub-beat is the beat, quieter)
        var rs = function (buf) { if (!buf || !buf.length) return new Float32Array(1); var ratio = (u.rate || r) / r; if (Math.abs(ratio - 1) < 1e-3) return buf; var n = Math.floor(buf.length / ratio), out = new Float32Array(n); for (var i = 0; i < n; i++) { var x = i * ratio, j = Math.floor(x), f = x - j; out[i] = (buf[j] || 0) * (1 - f) + (buf[j + 1] || 0) * f; } return out; };
        var hi = rs(u.hi), lo = rs(u.lo && u.lo.length ? u.lo : u.hi), sub = new Float32Array(lo.length); for (var k = 0; k < lo.length; k++) sub[k] = lo[k] * 0.55;
        return { hi: hi, lo: lo, sub: sub };
      }
      if (sound === "beep") return { hi: makeClick(r, 1760, 60, 0), lo: makeClick(r, 1175, 50, 0), sub: makeClick(r, 880, 25, 0) };
      if (sound === "sticks") return { hi: makeClick(r, 2800, 18, 0.9), lo: makeClick(r, 2200, 16, 0.7), sub: makeClick(r, 2000, 10, 0.4) };
      return { hi: makeClick(r, 2000, 32, 0.5), lo: makeClick(r, 1400, 28, 0.35), sub: makeClick(r, 1100, 16, 0.2) };
    }

    resetShifter() {
      this.yL = new Float32Array(16384); this.yR = new Float32Array(16384);
      this.yWrite = 0; this.yRead = 0; this.prevFrameStart = -1;
      this.frameL = new Float32Array(N); this.frameR = new Float32Array(N);
      this.mono = new Float32Array(N + 2 * SEARCH + CORR);
      this.natMono = new Float32Array(CORR);
    }

    onMessage(e) {
      var m = e.data;
      switch (m.cmd) {
        case "load":
          this.stems = (m.stems || []).map(function (s) {
            return { id: s.id, L: s.L, R: s.R || s.L, gain: s.gain == null ? 1 : s.gain, pan: s.pan || 0, mute: !!s.mute, solo: !!s.solo, role: s.role || "music", bus: s.bus === "click" ? "click" : "music", out: s.out >= 0 ? s.out : -1 };
          });
          this.length = m.length || 0;
          this.pos = Math.min(this.pos, this.length);
          this.resetShifter();
          this.refreshGains(0);
          break;
        case "clear": this.stems = []; this.length = 0; this.pos = 0; this.playing = false; this.loop = null; this.jump = null; this.beats = null; this.cues = []; this.events = []; break;
        case "stem":
          this.stems.forEach(function (s) { if (s.id === m.id) { if (m.gain != null) s.gain = m.gain; if (m.pan != null) s.pan = m.pan; if (m.mute != null) s.mute = !!m.mute; if (m.solo != null) s.solo = !!m.solo; if (m.role) s.role = m.role; if (m.bus) s.bus = m.bus === "click" ? "click" : "music"; if (m.out != null) s.out = m.out >= 0 ? m.out : -1; } });
          this.refreshGains(m.ramp || 0.02);
          break;
        case "play": this.start(m.countIn || 0, m.voice !== false); break;
        case "pause": this.playing = false; this.countIn.active = false; this.post({ type: "pos", pos: this.pos / this.rate, playing: false }); break;
        case "stop": this.playing = false; this.countIn.active = false; this.seekTo(m.to != null ? m.to * this.rate : 0); break;
        case "seek": this.seekTo(m.time * this.rate); break;
        case "fold": this.fold = !!m.on; break;
        case "net": this.netOn = !!m.on; break;   // every stem on its own channel of output 4, at unity (Central Control mixes them)   // direct outs folded back into the mix (no multi-channel output available)
        case "loop": this.loop = m.start != null && m.end != null && m.end > m.start ? { start: m.start * this.rate, end: m.end * this.rate } : null; break;
        // the flow (live arrangement): when the playhead reaches `at`, carry on at `to` (gapless), or stop there (to < 0)
        case "jump": this.jump = m.at != null && m.at > 0 ? { at: m.at * this.rate, to: m.to != null && m.to >= 0 ? m.to * this.rate : -1, id: m.id || 0 } : null; break;
        case "set":
          if (m.speed != null) this.speed = Math.min(2, Math.max(0.5, m.speed));
          if (m.pitch != null) this.pitch = Math.min(2, Math.max(0.5, m.pitch));
          if (m.musicLevel != null) this.musicLevel = m.musicLevel;
          if (m.cueLevel != null) this.cueLevel = m.cueLevel;
          if (m.out != null) { this.outTarget = Math.max(0, Math.min(1, m.out)); var fs = Math.max(1, (m.fadeMs || 0) / 1000 * this.rate); this.outStep = Math.abs(this.outTarget - this.outGain) / fs; if (!m.fadeMs) this.outGain = this.outTarget; }
          break;
        case "beats": this.beats = m.times; this.downbeats = m.downbeats; this.syncBeatIndex(); break;
        case "click":
          if (m.enabled != null) this.click.enabled = !!m.enabled;
          if (m.stems != null) this.clickStemsOn = !!m.stems;
          if (m.level != null) this.click.level = m.level;
          if (m.sub != null) this.click.sub = m.sub;
          if (m.sound && m.sound !== this.click.sound) { this.click.sound = m.sound; this.clickBufs = this.buildClicks(m.sound); }
          break;
        case "clickSets": this.userClicks = m.sets || {}; if (this.userClicks[this.click.sound]) this.clickBufs = this.buildClicks(this.click.sound); break;
        case "cueBuffers": var self = this; Object.keys(m.buffers).forEach(function (k) { self.cueBuffers[k] = m.buffers[k]; }); break;
        case "cues": this.cues = (m.list || []).map(function (c) { return { time: c.time * sampleRate, id: c.id, level: c.level == null ? 1 : c.level }; }).sort(function (a, b) { return a.time - b.time; }); this.syncCueIndex(); break;
        case "sayNow": if (this.cueBuffers[m.id]) this.liveCues.push({ buf: this.cueBuffers[m.id], i: 0, level: (m.level == null ? 1 : m.level) }); break;
        case "events": this.events = (m.list || []).map(function (ev) { return { time: ev.time * sampleRate, id: ev.id, fired: false }; }).sort(function (a, b) { return a.time - b.time; }); this.syncEventIndex(); break;
        // several stems at once (a mix scene): [{id, gain, mute, pan}], faded over `ramp` seconds
        case "mix":
          var byId = {}; (m.stems || []).forEach(function (q) { byId[q.id] = q; });
          this.stems.forEach(function (s) { var q = byId[s.id]; if (!q) return; if (q.gain != null) s.gain = q.gain; if (q.mute != null) s.mute = !!q.mute; if (q.pan != null) s.pan = q.pan; });
          this.refreshGains(m.ramp == null ? 0.5 : m.ramp);
          break;
        case "meters": this.metersOn = !!m.on; break;
        case "ping": this.post({ type: "pos", pos: this.pos / this.rate, playing: this.playing }); break;
      }
    }

    post(m) { this.port.postMessage(m); }

    // target gains; process() glides the live gains to them (no clicks when a fader jumps or a scene changes)
    refreshGains(ramp) {
      var anySolo = this.stems.some(function (s) { return s.solo && s.bus !== "click"; }), blocks = Math.max(1, Math.round((ramp || 0) * this.rate / 128));
      this.stems.forEach(function (s) {
        var g = anySolo ? (s.solo ? s.gain : 0) : (s.mute ? 0 : s.gain), a = (s.pan + 1) * Math.PI / 4;
        s.tL = g * Math.cos(a) * Math.SQRT2 * 0.5 * (1 / 32768);
        s.tR = g * Math.sin(a) * Math.SQRT2 * 0.5 * (1 / 32768);
        if (!ramp || s.gL == null) { s.gL = s.tL; s.gR = s.tR; s.rampN = 0; }
        else { s.rampN = blocks; s.dL = (s.tL - s.gL) / blocks; s.dR = (s.tR - s.gR) / blocks; }
      });
    }
    glideGains() {
      for (var i = 0; i < this.stems.length; i++) { var s = this.stems[i]; if (s.rampN > 0) { s.rampN--; if (s.rampN === 0) { s.gL = s.tL; s.gR = s.tR; } else { s.gL += s.dL; s.gR += s.dR; } } }
    }
    // post-fader peak of every stem over the last ~2048 samples (sparse scan: cheap enough for 16 stems on a Pi)
    stemMeters(pos, span) {
      var out = new Float32Array(this.stems.length), s0 = Math.max(0, Math.floor(pos - span)), s1 = Math.min(this.length, Math.floor(pos));
      for (var s = 0; s < this.stems.length; s++) {
        var st = this.stems[s], L = st.L, R = st.R, pk = 0;
        if (st.gL || st.gR) for (var k = s0; k < s1; k += 6) { var a = L[k] * st.gL, b = R[k] * st.gR; if (a < 0) a = -a; if (b < 0) b = -b; if (a > pk) pk = a; if (b > pk) pk = b; }
        out[s] = pk * 1.41421356 * (st.bus === "click" ? 1 : this.musicLevel);
      }
      return out;
    }

    beatLengthAt(pos) {
      var b = this.beats;
      if (!b || b.length < 2) return this.rate * 0.5;
      var i = this.beatIndexFor(pos);
      if (i >= b.length - 1) i = b.length - 2;
      if (i < 0) i = 0;
      return Math.max(1, b[i + 1] - b[i]);
    }

    beatIndexFor(pos) {
      var b = this.beats; if (!b) return 0;
      var lo = 0, hi = b.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (b[mid] < pos) lo = mid + 1; else hi = mid; }
      return lo; // first beat at or after pos
    }

    syncBeatIndex() { this.beatIdx = this.beats ? this.beatIndexFor(this.pos) : 0; this.subNext = -1; }
    syncCueIndex() { var p = this.pos; this.cueIdx = 0; while (this.cueIdx < this.cues.length && this.cues[this.cueIdx].time < p) this.cueIdx++; }
    syncEventIndex() { var p = this.pos; this.eventIdx = 0; this.events.forEach(function (e) { e.fired = false; }); while (this.eventIdx < this.events.length && this.events[this.eventIdx].time < p) { this.events[this.eventIdx].fired = true; this.eventIdx++; } }

    seekTo(samples) {
      this.countIn.active = false;   // a jump during a count-in cancels the count-in (otherwise it would snap back to its target)
      this.pos = Math.max(0, Math.min(this.length, samples));
      this.resetShifter();
      this.fadeGain = 0; this.fadeStep = 1 / (this.rate * 0.004);
      this.syncBeatIndex(); this.syncCueIndex(); this.syncEventIndex();
      this.liveClicks = [];
      this.post({ type: "pos", pos: this.pos / this.rate, playing: this.playing, seek: true });
    }

    start(countInBeats, voice) {
      if (this.playing) return;
      this.countIn.active = false;
      if (countInBeats > 0 && this.beats) {
        var beatLen = this.beatLengthAt(this.pos), target = this.pos;
        // snap the start to the nearest beat so the count-in lands on the grid
        var i = this.beatIndexFor(target);
        if (this.beats.length) {
          var before = i > 0 ? this.beats[i - 1] : this.beats[0], after = i < this.beats.length ? this.beats[i] : before;
          target = (target - before) < (after - target) ? before : after;
        }
        this.countIn = { beats: countInBeats, active: true, target: target, beatLen: beatLen, remaining: countInBeats, nextBeat: 0, voice: voice, count: 0, downbeatPhase: this.phaseAt(target, countInBeats) };
        this.pos = target - countInBeats * beatLen;
      }
      this.playing = true;
      this.fadeGain = 0; this.fadeStep = 1 / (this.rate * 0.01);
      this.resetShifter();
      this.syncBeatIndex(); this.syncCueIndex(); this.syncEventIndex();
      this.post({ type: "pos", pos: this.pos / this.rate, playing: true, countIn: this.countIn.active ? this.countIn.remaining : 0 });
    }

    phaseAt(pos, beats) {
      // beats per bar as seen in the grid (distance between downbeat flags)
      var d = this.downbeats, b = this.beats; if (!d || !b) return 4;
      var i = this.beatIndexFor(pos), first = -1, bpb = 4;
      for (var k = 0; k < d.length; k++) if (d[k]) { if (first < 0) first = k; else { bpb = k - first; break; } }
      return bpb;
    }

    // ---- source access: mixed stems at song positions [start, start+count) into L/R arrays
    readMix(start, count, outL, outR, bus, add) {
      var stems = this.stems, len = this.length;
      bus = bus || "music";
      if (!add) for (var i = 0; i < count; i++) { outL[i] = 0; outR[i] = 0; }
      var s0 = Math.floor(start);
      for (var s = 0; s < stems.length; s++) {
        var st = stems[s], gL = st.gL, gR = st.gR;
        if ((!gL && !gR) || st.bus !== bus || (st.out >= 0 && !this.folding && bus === "music")) continue;
        var L = st.L, R = st.R, from = Math.max(0, -s0), to = Math.min(count, len - s0);
        for (var i2 = from; i2 < to; i2++) { var k = s0 + i2; outL[i2] += L[k] * gL; outR[i2] += R[k] * gR; }
      }
    }

    // ---- WSOLA time stretch + resampler (used only when speed != 1 or pitch != 1)
    fillFifo(needed) {
      var s = this.speed, p = this.pitch, rate = this.rate;
      while (this.yWrite - this.yRead < needed) {
        var W = this.yWrite, center = W + N / 2;
        var P = this.pos + s * ((center - this.yRead) / p);   // song position this frame's centre must represent
        var nom = Math.round(P - N / 2), start = nom;
        if (this.prevFrameStart >= 0) {
          var nat = this.prevFrameStart + HS, mono = this.mono, natMono = this.natMono;
          this.readMix(nat, CORR, natMono, natMono);          // natural continuation (L into natMono, R discarded)
          this.readMono(nom - SEARCH, CORR + 2 * SEARCH, mono);
          var best = -Infinity, bestD = 0;
          for (var d = -SEARCH; d <= SEARCH; d += SEARCH_STEP) {
            var sum = 0, o = d + SEARCH;
            for (var i = 0; i < CORR; i += 2) sum += mono[o + i] * natMono[i];
            if (sum > best) { best = sum; bestD = d; }
          }
          start = nom + bestD;
        }
        this.readMix(start, N, this.frameL, this.frameR);
        var yL = this.yL, yR = this.yR, mask = yL.length - 1;
        for (var i2 = 0; i2 < N; i2++) {
          var idx = (W + i2) & mask, w = win[i2];
          if (i2 < HS && this.prevFrameStart >= 0) { yL[idx] += this.frameL[i2] * w; yR[idx] += this.frameR[i2] * w; }
          else { yL[idx] = this.frameL[i2] * w; yR[idx] = this.frameR[i2] * w; }
        }
        this.prevFrameStart = start;
        this.yWrite += HS;
      }
    }

    readDirect(start, count, direct) {  // each direct-out stem, mono (L+R), onto its own channel of output 3
      var stems = this.stems, len = this.length, s0 = Math.floor(start), lvl = this.musicLevel * this.fadeGain;
      for (var s = 0; s < stems.length; s++) {
        var st = stems[s], gL = st.gL, gR = st.gR; if ((!gL && !gR) || st.bus !== "music" || st.out < 0 || st.out >= direct.length) continue;
        var out = direct[st.out], L = st.L, R = st.R, from = Math.max(0, -s0), to = Math.min(count, len - s0);
        for (var i2 = from; i2 < to; i2++) { var k = s0 + i2; out[i2] += (L[k] * gL + R[k] * gR) * lvl; }
      }
    }
    readNet(start, count, net) {  // every stem, mono (L+R)/2, raw (the Pi's faders don't apply), one per channel
      var stems = this.stems, len = this.length, s0 = Math.floor(start), k0 = this.fadeGain * (0.5 / 32768);
      for (var s = 0; s < stems.length && s < net.length; s++) {
        var st = stems[s], out = net[s], L = st.L, R = st.R, from = Math.max(0, -s0), to = Math.min(count, len - s0);
        for (var i2 = from; i2 < to; i2++) { var k = s0 + i2; out[i2] = (L[k] + R[k]) * k0; }
      }
    }
    readMono(start, count, out) {
      var stems = this.stems, len = this.length, s0 = Math.floor(start);
      for (var i = 0; i < count; i++) out[i] = 0;
      for (var s = 0; s < stems.length; s++) {
        var st = stems[s], gL = st.gL, gR = st.gR; if ((!gL && !gR) || st.bus !== "music" || (st.out >= 0 && !this.folding)) continue;
        var L = st.L, R = st.R, from = Math.max(0, -s0), to = Math.min(count, len - s0);
        for (var i2 = from; i2 < to; i2++) { var k = s0 + i2; out[i2] += L[k] * gL + R[k] * gR; }
      }
    }

    applyOut(outputs, n) {   // every output (music, click, direct outs, network) follows outGain, ramping to outTarget
      var g = this.outGain, t = this.outTarget, st = this.outStep || 1;
      for (var i = 0; i < n; i++) {
        if (g !== t) g = g < t ? Math.min(t, g + st) : Math.max(t, g - st);
        for (var o = 0; o < outputs.length; o++) { var out = outputs[o]; for (var c = 0; c < out.length; c++) out[c][i] *= g; }
      }
      this.outGain = g;
    }

    process(inputs, outputs) {
      var music = outputs[0], clickOut = outputs[1], direct = outputs[2] || [], net = this.netOn ? outputs[3] || [] : [], mL = music[0], mR = music[1], cL = clickOut[0], cR = clickOut[1];
      var n = mL.length, rate = this.rate;
      for (var i = 0; i < n; i++) { mL[i] = 0; mR[i] = 0; cL[i] = 0; cR[i] = 0; }
      for (var d = 0; d < direct.length; d++) { var dch = direct[d]; for (var di = 0; di < n; di++) dch[di] = 0; }
      for (var nd = 0; nd < net.length; nd++) { var nch = net[nd]; for (var ni = 0; ni < n; ni++) nch[ni] = 0; }
      this.glideGains();
      if (this.playing && this.stems.length) {
        var s = this.speed, p = this.pitch, shifting = Math.abs(s - 1) > 0.0005 || Math.abs(p - 1) > 0.0005;
        // direct outs can't go through the time / pitch shifter: while the song is shifted they rejoin the mix
        this.folding = !!this.fold || shifting || !direct.length;
        var startPos = this.pos, inCount = this.countIn.active;
        if (!inCount) {
          if (!shifting) {
            this.readMix(startPos, n, mL, mR);
          } else {
            this.fillFifo(Math.ceil(n * p) + 2);
            var yL = this.yL, yR = this.yR, mask = yL.length - 1, r = this.yRead;
            for (var i2 = 0; i2 < n; i2++) {
              var ri = Math.floor(r), fr = r - ri, a = ri & mask, b = (ri + 1) & mask;
              mL[i2] = yL[a] + (yL[b] - yL[a]) * fr; mR[i2] = yR[a] + (yR[b] - yR[a]) * fr;
              r += p;
            }
            this.yRead = r;
            // keep the ring from wrapping into unread data: shift indexes down occasionally
            if (this.yRead > 1 << 20) { this.yRead -= 1 << 20; this.yWrite -= 1 << 20; }
          }
          var lvl = this.musicLevel;
          for (var i3 = 0; i3 < n; i3++) {
            var g = this.fadeGain * lvl;
            if (this.fadeGain < 1) { this.fadeGain += this.fadeStep; if (this.fadeGain > 1) this.fadeGain = 1; }
            mL[i3] *= g; mR[i3] *= g;
          }
        }
        if (!inCount && !shifting && this.clickStemsOn !== false) { this.readMix(startPos, n, cL, cR, "click", true); }
        if (!inCount && !this.folding) this.readDirect(startPos, n, direct);
        if (!inCount && !shifting && net.length) this.readNet(startPos, n, net);
        // advance the song position; handle loop / count-in / end
        var endPos = startPos + n * s;
        if (inCount) {
          this.countInClicks(startPos, endPos, s, cL, cR);
          if (endPos >= this.countIn.target) { this.countIn.active = false; this.pos = this.countIn.target; this.fadeGain = 0; this.fadeStep = 1 / (rate * 0.004); this.syncBeatIndex(); this.syncCueIndex(); this.syncEventIndex(); this.post({ type: "pos", pos: this.pos / rate, playing: true, countIn: 0, started: true }); }
          else this.pos = endPos;
        } else {
          this.gridClicks(startPos, endPos, s, cL, cR);
          this.fireCues(startPos, endPos, s);
          this.fireEvents(startPos, endPos, s);
          if (this.loop && endPos >= this.loop.end && startPos < this.loop.end) {
            this.pos = this.loop.start + (endPos - this.loop.end);
            this.resetShifter(); this.fadeGain = 0; this.fadeStep = 1 / (rate * 0.003);
            this.syncBeatIndex(); this.syncCueIndex(); this.syncEventIndex();
            this.post({ type: "looped", pos: this.pos / rate });
          } else if (this.jump && endPos >= this.jump.at && startPos < this.jump.at) {
            var j = this.jump; this.jump = null;
            if (j.to < 0) { this.pos = Math.min(this.length, j.at); this.playing = false; this.post({ type: "ended", pos: this.pos / rate, flow: true, id: j.id }); }
            else {
              this.pos = j.to + (endPos - j.at);
              this.resetShifter(); this.fadeGain = 0; this.fadeStep = 1 / (rate * 0.003);
              this.syncBeatIndex(); this.syncCueIndex(); this.syncEventIndex();
              this.post({ type: "jumped", pos: this.pos / rate, id: j.id });
            }
          } else if (endPos >= this.length) {
            this.pos = this.length; this.playing = false;
            this.post({ type: "ended", pos: this.pos / rate });
          } else this.pos = endPos;
        }
      }
      this.renderClicks(cL, cR, n);
      this.renderCues(cL, cR, n);
      if (this.outGain !== 1 || this.outTarget !== 1) this.applyOut(outputs, n);
      this.posCounter += n;
      if (this.posCounter >= 2048) {
        var msg = { type: "pos", pos: this.pos / rate, playing: this.playing, countIn: this.countIn.active ? this.countIn.remaining : 0 };
        if (this.metersOn && this.stems.length) msg.meters = this.playing && !this.countIn.active ? this.stemMeters(this.pos, 2048 * this.speed) : new Float32Array(this.stems.length);
        if (msg.meters) msg.ids = this.stems.map(function (q) { return q.id; });
        this.posCounter = 0; this.post(msg);
      }
      return true;
    }

    gridClicks(from, to, speed, cL, cR) {
      var b = this.beats; if (!b || !this.click.enabled) return;
      var i = this.beatIdx;
      while (i < b.length && b[i] < to) {
        if (b[i] >= from) {
          var accent = this.downbeats && this.downbeats[i];
          this.liveClicks.push({ buf: accent ? this.clickBufs.hi : this.clickBufs.lo, i: -Math.round((b[i] - from) / speed), level: this.click.level * (accent ? 1 : 0.75) });
          if (this.click.sub > 1 && i < b.length - 1) {
            var len = b[i + 1] - b[i];
            for (var k = 1; k < this.click.sub; k++) this.liveClicks.push({ buf: this.clickBufs.sub, i: -Math.round((b[i] + len * k / this.click.sub - from) / speed), level: this.click.level * 0.45 });
          }
        }
        i++;
      }
      this.beatIdx = i;
    }

    countInClicks(from, to, speed, cL, cR) {
      var c = this.countIn, k;
      for (k = c.beats; k >= 1; k--) {
        var t = c.target - k * c.beatLen;
        if (t >= from && t < to) {
          var num = c.beats - k + 1, bpb = c.downbeatPhase || 4, inBar = ((num - 1) % bpb) + 1;
          this.liveClicks.push({ buf: inBar === 1 ? this.clickBufs.hi : this.clickBufs.lo, i: -Math.round((t - from) / speed), level: this.click.level });
          c.remaining = k - 1;
          if (c.voice && this.cueBuffers[String(inBar)]) this.liveCues.push({ buf: this.cueBuffers[String(inBar)], i: -Math.round((t - from) / speed), level: this.cueLevel });
          this.post({ type: "countIn", remaining: k - 1, beat: inBar });
        }
      }
    }

    fireCues(from, to, speed) {
      var i = this.cueIdx;
      while (i < this.cues.length && this.cues[i].time < to) {
        var c = this.cues[i];
        if (c.time >= from && this.cueBuffers[c.id]) this.liveCues.push({ buf: this.cueBuffers[c.id], i: -Math.round((c.time - from) / speed), level: c.level * this.cueLevel });
        i++;
      }
      this.cueIdx = i;
    }

    fireEvents(from, to, speed) {
      var ahead = to + this.lookahead * speed, i = this.eventIdx;
      while (i < this.events.length && this.events[i].time < ahead) {
        var e = this.events[i];
        if (!e.fired && e.time >= from) { e.fired = true; this.post({ type: "event", id: e.id, inMs: Math.max(0, (e.time - from) / speed / this.rate * 1000) }); }
        i++;
      }
      // eventIdx only moves past events that are behind us
      while (this.eventIdx < this.events.length && this.events[this.eventIdx].time < to) this.eventIdx++;
    }

    renderClicks(cL, cR, n) {
      var list = this.liveClicks;
      for (var j = list.length - 1; j >= 0; j--) {
        var c = list[j], buf = c.buf, i = c.i, lvl = c.level, done = false;
        for (var k = 0; k < n; k++, i++) {
          if (i < 0) continue;
          if (i >= buf.length) { done = true; break; }
          var v = buf[i] * lvl; cL[k] += v; cR[k] += v;
        }
        c.i = i;
        if (done || c.i >= buf.length) list.splice(j, 1);
      }
    }

    renderCues(cL, cR, n) {
      var list = this.liveCues;
      for (var j = list.length - 1; j >= 0; j--) {
        var c = list[j], buf = c.buf, i = c.i, lvl = c.level * 0.9, done = false;
        for (var k = 0; k < n; k++, i++) {
          if (i < 0) continue;
          if (i >= buf.length) { done = true; break; }
          var v = buf[i] * lvl; cL[k] += v; cR[k] += v;
        }
        c.i = i;
        if (done || c.i >= buf.length) list.splice(j, 1);
      }
    }
  }
  registerProcessor("pp-multitrack", Multitrack);
};
