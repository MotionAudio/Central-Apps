/* Central FX - the browser runtime for plugins made in the plugin builder (10.2; docs/PLUGIN-BUILDER.md).
 * tools/build-cmfx.sh builds central-usage/native/cmfx/ (the same C the rig and the Central Pedal play) to WebAssembly
 * and writes it into cmfx.js beside this file, so one self-contained file plays a plugin anywhere: in an AudioWorklet
 * for live sound, or directly (a Web Worker, Node) for checks and offline renders. Don't edit cmfx.js: edit this file
 * and run tools/build-cmfx.sh (it also copies cmfx.js to every app that uses it).
 *
 *   CMFx.create(audioContext, plugin, { values, onError, onStatus })
 *       -> { node, setParam(id, value), dispose(), ready (Promise), params }
 *       node is one AudioNode: connect into it and from it. Until the plugin is running (a moment) the sound passes
 *       straight through, and it does the same if the plugin can't load (onError says why).
 *   CMFx.prepare(audioContext) -> Promise          (loads the worklet once per context; create does it too)
 *   CMFx.check(plugin, sampleRate) -> { ok, error, name, params }
 *   CMFx.checkCode(text) -> { ok, error, line }
 *   CMFx.render(plugin, sampleRate, left, right, values) -> { left, right, status }   (Float32Arrays, offline)
 *   CMFx.Direct(plugin, sampleRate)                 a plugin played directly (process 128 at a time)
 * plugin: the parsed .cmfx.json object (or its text). */
(function (root) {
  "use strict";
  var WASM_B64 = "@WASM@";
  var bytes = null, mod = null;
  function b64(s) {
    if (typeof atob === "function") { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(s, "base64"));
  }
  function wasmBytes() { if (!bytes) bytes = b64(WASM_B64); return bytes; }
  function wasmModule() { if (!mod) mod = new WebAssembly.Module(wasmBytes()); return mod; }
  function text(p) { return typeof p === "string" ? p : JSON.stringify(p); }
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    var out = [], i, c; for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00); }
      if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63); else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63); else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63); }
    return new Uint8Array(out);
  }
  function cstr(ex, p) {
    if (!p) return ""; var m = new Uint8Array(ex.memory.buffer), e = p; while (m[e]) e++;
    var b = m.subarray(p, e); if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(b);
    var s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); try { return decodeURIComponent(escape(s)); } catch (_) { return s; }
  }
  function put(ex, u8) { var p = ex.cmw_alloc(u8.length + 1); var m = new Uint8Array(ex.memory.buffer); m.set(u8, p); m[p + u8.length] = 0; return p; }
  function paramsOf(plugin) { var p = typeof plugin === "string" ? safeParse(plugin) : plugin; return p && Array.isArray(p.params) ? p.params : []; }
  function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
  function lineOf(err) { var m = /line (\d+)/.exec(err || ""); return m ? +m[1] : 0; }

  /* ---------------------------------------------------------------- played directly (no audio device) */
  function Direct(plugin, sampleRate) {
    var ex = new WebAssembly.Instance(wasmModule(), {}).exports, t = utf8(text(plugin)), p = put(ex, t);
    this.ex = ex; this.sr = sampleRate || 48000; this.fx = ex.cmw_new(p, t.length, this.sr);
    this.error = this.fx ? "" : cstr(ex, ex.cmw_error()) || "the plugin didn't load";
    this.bufs = ex.cmw_alloc(4 * 128 * 4);
    this.params = [];
    if (this.fx) for (var i = 0; i < ex.cmw_param_count(this.fx); i++) this.params.push(cstr(ex, ex.cmw_param_id(this.fx, i)));
    this.name = this.fx ? cstr(ex, ex.cmw_name(this.fx)) : "";
  }
  Direct.prototype.setParam = function (id, v) { if (!this.fx) return; var i = typeof id === "number" ? id : this.params.indexOf(id); if (i >= 0) this.ex.cmw_set_param(this.fx, i, +v); };
  Direct.prototype.reset = function () { if (this.fx) this.ex.cmw_reset(this.fx); };
  Direct.prototype.status = function () { return this.fx ? cstr(this.ex, this.ex.cmw_status(this.fx)) : this.error; };
  /* left / right in, left / right out (Float32Array, any length; right may be null for mono in) */
  Direct.prototype.process = function (inL, inR, outL, outR) {
    var n = outL.length, ex = this.ex, b = this.bufs;
    if (!this.fx) { outL.set(inL.subarray(0, n)); if (outR) outR.set((inR || inL).subarray(0, n)); return; }
    for (var off = 0; off < n; off += 128) {
      var m = Math.min(128, n - off), F = new Float32Array(ex.memory.buffer), o = b >> 2;
      F.set(inL.subarray(off, off + m), o); F.set((inR || inL).subarray(off, off + m), o + 128);
      ex.cmw_process(this.fx, b, b + 512, b + 1024, b + 1536, m);
      F = new Float32Array(ex.memory.buffer);
      outL.set(F.subarray(o + 256, o + 256 + m), off); if (outR) outR.set(F.subarray(o + 384, o + 384 + m), off);
    }
  };

  function check(plugin, sampleRate) {
    var src = text(plugin), parsed = typeof plugin === "string" ? safeParse(plugin) : plugin;
    var ex = new WebAssembly.Instance(wasmModule(), {}).exports, t = utf8(src), p = put(ex, t);
    var r = ex.cmw_check(p, t.length, sampleRate || 48000), err = r ? cstr(ex, ex.cmw_error()) : "";
    return { ok: !r, error: err, line: lineOf(err), name: parsed && parsed.name || "", params: paramsOf(parsed) };
  }
  function checkCode(code) {
    var ex = new WebAssembly.Instance(wasmModule(), {}).exports, t = utf8(String(code || "")), p = put(ex, t);
    var r = ex.cmw_check_code(p, t.length), err = r ? cstr(ex, ex.cmw_error()) : "";
    return { ok: !r, error: err, line: lineOf(err) };
  }
  function render(plugin, sampleRate, left, right, values) {
    var d = new Direct(plugin, sampleRate);
    if (values) Object.keys(values).forEach(function (k) { d.setParam(k, values[k]); });
    d.reset();
    var L = new Float32Array(left.length), R = new Float32Array(left.length); d.process(left, right || left, L, R);
    return { left: L, right: R, error: d.error, status: d.status() };
  }

  /* ---------------------------------------------------------------- live, in an AudioWorklet */
  var WORKLET = "(" + function () {
    function cs(ex, p) { if (!p) return ""; var m = new Uint8Array(ex.memory.buffer), s = ""; while (m[p]) s += String.fromCharCode(m[p++]); try { return decodeURIComponent(escape(s)); } catch (_) { return s; } }
    class CentralFx extends AudioWorkletProcessor {
      constructor(opts) {
        super(); var o = opts.processorOptions || {}, self = this; this.fx = 0; this.alive = true; this.tick = 0; this.lastStatus = "";
        try {
          var m = o.module instanceof WebAssembly.Module ? o.module : new WebAssembly.Module(o.bytes);
          var ex = this.ex = new WebAssembly.Instance(m, {}).exports, j = o.json, p = ex.cmw_alloc(j.length + 1);
          var mem = new Uint8Array(ex.memory.buffer); mem.set(j, p); mem[p + j.length] = 0;
          this.fx = ex.cmw_new(p, j.length, sampleRate);
          if (!this.fx) this.port.postMessage({ error: cs(ex, ex.cmw_error()) || "the plugin didn't load" });
          else {
            this.b = ex.cmw_alloc(4 * 128 * 4);
            (o.values || []).forEach(function (v, i) { if (v != null && isFinite(v)) ex.cmw_set_param(self.fx, i, v); });
            ex.cmw_reset(this.fx);
            this.port.postMessage({ ready: true });
          }
        } catch (e) { this.port.postMessage({ error: "the plugin couldn't start here (" + (e && e.message || e) + ")" }); }
        this.port.onmessage = function (e) {
          var d = e.data || {};
          if (d.dispose) { self.alive = false; return; }
          if (self.fx && typeof d.i === "number") self.ex.cmw_set_param(self.fx, d.i, d.v);
          if (self.fx && d.reset) self.ex.cmw_reset(self.fx);
        };
      }
      process(inputs, outputs) {
        var inp = inputs[0] || [], out = outputs[0], n = out[0].length;
        if (!this.fx) { for (var c = 0; c < out.length; c++) { var s = inp[c] || inp[0]; if (s) out[c].set(s); } return this.alive; }
        var ex = this.ex, b = this.b, F = new Float32Array(ex.memory.buffer), o = b >> 2, l = inp[0], r = inp[1] || inp[0];
        if (l) { F.set(l, o); F.set(r, o + 128); } else { F.fill(0, o, o + 256); }
        ex.cmw_process(this.fx, b, b + 512, b + 1024, b + 1536, n);
        F = new Float32Array(ex.memory.buffer);
        out[0].set(F.subarray(o + 256, o + 256 + n)); if (out[1]) out[1].set(F.subarray(o + 384, o + 384 + n));
        if (++this.tick >= 200) { this.tick = 0; var st = cs(ex, ex.cmw_status(this.fx)); if (st !== this.lastStatus) { this.lastStatus = st; this.port.postMessage({ status: st }); } }
        return this.alive;
      }
    }
    registerProcessor("central-fx", CentralFx);
  } + ")();";
  var loaded = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function prepare(ctx) {
    if (!ctx || !ctx.audioWorklet) return Promise.reject(new Error("this browser can't play Central FX plugins (no AudioWorklet)"));
    var p = loaded && loaded.get(ctx); if (p) return p;
    var url = CMFx.workletUrl || URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    p = ctx.audioWorklet.addModule(url).catch(function () {
      /* (a page whose content rules refuse blob: addresses) */
      return ctx.audioWorklet.addModule("data:application/javascript;base64," + btoa(WORKLET));
    });
    if (loaded) loaded.set(ctx, p);
    return p;
  }
  function create(ctx, plugin, opts) {
    opts = opts || {};
    var params = paramsOf(plugin), ids = params.map(function (q) { return q.id; }), values = params.map(function (q) { var v = opts.values && opts.values[q.id]; return v != null ? +v : null; });
    var input = ctx.createGain(), output = ctx.createGain(), wnode = null, dead = false, queue = [];
    input.connect(output);   /* (straight through until the plugin runs) */
    var node = input;
    node.connect = function () { return output.connect.apply(output, arguments); };
    node.disconnect = function () { return output.disconnect.apply(output, arguments); };
    var api = { node: node, params: params, error: "", status: "" };
    api.setParam = function (id, v) {
      var i = typeof id === "number" ? id : ids.indexOf(id); if (i < 0) return; v = +v; if (!isFinite(v)) return; values[i] = v;
      if (wnode) wnode.port.postMessage({ i: i, v: v }); else queue.push({ i: i, v: v });
    };
    api.reset = function () { if (wnode) wnode.port.postMessage({ reset: true }); };
    api.dispose = function () {
      dead = true; try { input.disconnect(); } catch (_) { } try { output.disconnect(); } catch (_) { }
      if (wnode) { try { wnode.port.postMessage({ dispose: true }); wnode.disconnect(); } catch (_) { } wnode = null; }
    };
    api.ready = prepare(ctx).then(function () {
      if (dead) return api;
      var json = utf8(text(plugin)), make = function (useModule) {
        return new AudioWorkletNode(ctx, "central-fx", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
          processorOptions: useModule ? { module: wasmModule(), json: json, values: values } : { bytes: wasmBytes(), json: json, values: values } });
      };
      var w; try { w = make(true); } catch (_) { w = make(false); }
      return new Promise(function (resolve) {
        w.port.onmessage = function (e) {
          var d = e.data || {};
          if (d.ready && !dead) {
            wnode = w; queue.forEach(function (m) { w.port.postMessage(m); }); queue = [];
            try { input.disconnect(); } catch (_) { } input.connect(w); w.connect(output); resolve(api);
          } else if (d.error) { api.error = d.error; if (opts.onError) opts.onError(d.error); try { w.port.postMessage({ dispose: true }); } catch (_) { } resolve(api); }
          else if (d.status != null) { api.status = d.status; if (opts.onStatus) opts.onStatus(d.status); }
        };
      });
    }).catch(function (e) { api.error = e && e.message || String(e); if (opts.onError) opts.onError(api.error); return api; });
    return api;
  }

  var CMFx = { create: create, prepare: prepare, check: check, checkCode: checkCode, render: render, Direct: Direct, workletUrl: null, version: 1 };
  root.CMFx = CMFx;
  if (typeof module !== "undefined" && module.exports) module.exports = CMFx;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
