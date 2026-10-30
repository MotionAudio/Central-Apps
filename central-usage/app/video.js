/* Central Control - the Video tab: a switcher for up to 48 cameras with two outputs.
 *   MAIN    full screen on a display of this computer (the room's screens)
 *   STREAM  the live stream (YouTube / Facebook / RTMP / SRT, several at once), a recording, and NDI for OBS / vMix
 * Each output has its own Preview and Program, Cut and Auto (fade, dip to black, wipe), the lyrics as a lower third
 * and the Slides tab's picture (full screen, or keyed over the camera), and fade to black.
 *
 * The pictures are put together here on the GPU (WebGL2 on one off-screen canvas): every camera is a texture, the
 * outputs are rendered into their own framebuffers, the Main output is drawn into a full-screen window this page
 * opens, and the Stream output is turned into I420 on the GPU and read back for the encoder (video-service.js). */
(function () {
  "use strict";
  var CU = window.CentralUsage, V = window.CUVideo, root = document.getElementById("videoRoot");
  if (!CU || !root) return;
  function $(s, r) { return (r || root).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || root).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var visible = function () { return CU.prefs.tab === "video"; };
  if (!V) {
    root.innerHTML = '<div class="card"><h3>Video</h3><p class="muted">The video switcher needs the Central Control app on a computer, because it uses that computer\'s cameras and outputs.</p></div>';
    return;
  }

  var MAX_SOURCES = 48;
  var S = {
    init: null, cfg: null, status: {}, ndi: { sources: [], error: null }, audio: { devices: [], status: null, meters: null, backend: "" },
    stream: null, phones: null, screens: [], encoders: null, captureDevices: [],
    view: CU.store.get("vidView", "switch"), bus: CU.store.get("vidBus", "main"), page: 0,
    out: { main: newOut("main"), stream: newOut("stream") },
    lyr: { lines: [], section: "", key: "", sectionKey: "" }, ready: false, error: null
  };
  function newOut(name) { var o = CU.store.get("vidOut-" + name, null) || {}; return { name: name, pgm: o.pgm || null, pvw: o.pvw || null, trans: null, lyrics: false, lyricsA: 0, slides: o.slides || "off", slidesA: 0, ftb: false, ftbA: 0 }; }
  function saveOut(o) { CU.store.set("vidOut-" + o.name, { pgm: o.pgm, pvw: o.pvw, slides: o.slides }); }
  function cfgSources() { return (S.cfg && S.cfg.sources) || []; }
  function srcName(id) { if (id === S.init.slidesId) return "Slides"; var s = cfgSources().find(function (x) { return x.id === id; }); return s ? s.name : "—"; }

  /* ================================================================== GPU compositor */
  var G = { canvas: null, gl: null, W: 1920, H: 1080, tex: new Map(), fb: {}, progs: {}, pbo: [], pboAt: 0, lyrics: null };
  var VS = "#version 300 es\nuniform vec4 uRect; uniform vec4 uUV; uniform float uFlip; out vec2 vUV; out vec2 vPos;\n" +
    "void main(){ vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1)); vec2 p=uRect.xy+c*uRect.zw; vPos=p; vUV=mix(uUV.xy,uUV.zw,c); gl_Position=vec4(p.x*2.0-1.0,(uFlip>0.5?1.0-p.y*2.0:p.y*2.0-1.0),0.0,1.0);}";
  var FS_YUV = "#version 300 es\nprecision highp float; in vec2 vUV; uniform sampler2D uY,uU,uV; out vec4 o;\n" +
    "void main(){ float y=texture(uY,vUV).r-0.0627451, u=texture(uU,vUV).r-0.5, v=texture(uV,vUV).r-0.5; y*=1.1643836;" +
    " o=vec4(clamp(vec3(y+1.7927411*v, y-0.2132486*u-0.5329093*v, y+2.1124018*u),0.0,1.0),1.0);}";
  var FS_DRAW = "#version 300 es\nprecision highp float; in vec2 vUV; uniform sampler2D uT; uniform float uA; uniform int uMode; uniform int uBgra; uniform vec4 uWipe; uniform vec2 uKey; out vec4 o;\n" +
    "void main(){ vec4 c=texture(uT,vUV); if(uBgra==1) c=c.bgra; float a=uA;" +
    " if(uWipe.z>0.5){ a*=clamp((uWipe.x-gl_FragCoord.x)/max(uWipe.y,1.0)+0.5,0.0,1.0); }" +
    " if(uMode==1){ float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722)); float k=smoothstep(uKey.x,uKey.y,l); o=vec4(c.rgb*k*a,k*a); }" +
    " else if(uMode==2){ o=c*a; } else if(uMode==3){ o=vec4(0.0,0.0,0.0,a); } else { o=vec4(c.rgb*a,a); } }";
  // RGBA -> packed I420 bytes (BT.709 limited): the target is (W/4) x (H*3/2) RGBA8, read back as the I420 planes in order
  var FS_I420 = "#version 300 es\nprecision highp float; precision highp int; uniform sampler2D uT; uniform ivec2 uSize; out vec4 o;\n" +
    "float val(int b){ int W=uSize.x,H=uSize.y,ys=W*H,cs=ys/4; vec3 c; if(b<ys){ int py=b/W,px=b-py*W; c=texture(uT,vec2((float(px)+0.5)/float(W),(float(py)+0.5)/float(H))).rgb;" +
    " return (16.0+219.0*dot(c,vec3(0.2126,0.7152,0.0722)))/255.0; } int i=b-ys; bool isV=i>=cs; if(isV) i-=cs; int hw=W/2; int py=i/hw,px=i-py*hw;" +
    " c=texture(uT,vec2((float(px)*2.0+1.0)/float(W),(float(py)*2.0+1.0)/float(H))).rgb;" +
    " return isV?(128.0+224.0*dot(c,vec3(0.5,-0.4542,-0.0458)))/255.0:(128.0+224.0*dot(c,vec3(-0.1146,-0.3854,0.5)))/255.0; }" +
    "void main(){ ivec2 f=ivec2(gl_FragCoord.xy); int base=(f.y*(uSize.x/4)+f.x)*4; o=vec4(val(base),val(base+1),val(base+2),val(base+3)); }";

  function glInit() {
    try {
      G.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(G.W, G.H) : Object.assign(document.createElement("canvas"), { width: G.W, height: G.H });
      G.gl = G.canvas.getContext("webgl2", { alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
    } catch (e) { G.gl = null; }
    var gl = G.gl; if (!gl) { S.error = "WebGL2 is not available on this computer's graphics."; return false; }
    function prog(fs) {
      var p = gl.createProgram();
      [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]].forEach(function (x) { var sh = gl.createShader(x[0]); gl.shaderSource(sh, x[1]); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); gl.attachShader(p, sh); });
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (var i = 0; i < n; i++) { var a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p: p, u: u };
    }
    try { G.progs.yuv = prog(FS_YUV); G.progs.draw = prog(FS_DRAW); G.progs.i420 = prog(FS_I420); } catch (e) { S.error = "The graphics could not start the video compositor: " + e.message; return false; }
    G.vao = gl.createVertexArray(); gl.bindVertexArray(G.vao);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    G.black = makeTex(2, 2); return true;
  }
  function makeTex(w, h, fmt) {
    var gl = G.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (fmt === "r8") gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  function target(name, w, h) {   // an off-screen picture (framebuffer + texture), made again when its size changes
    var gl = G.gl, f = G.fb[name];
    if (f && f.w === w && f.h === h) return f;
    if (f) { gl.deleteFramebuffer(f.fbo); gl.deleteTexture(f.tex); }
    f = { w: w, h: h, tex: makeTex(w, h), fbo: gl.createFramebuffer() };
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.tex, 0);
    G.fb[name] = f; return f;
  }
  function bindTarget(f) { var gl = G.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fbo : null); var w = f ? f.w : G.W, h = f ? f.h : G.H; gl.viewport(0, 0, w, h); return { w: w, h: h, flip: f ? 0 : 1 }; }
  // draw a texture into the bound target: rect in target pixels from the top left
  function quad(t, tw, th, rect, opt) {
    var gl = G.gl, P = G.progs.draw; opt = opt || {};
    gl.useProgram(P.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, opt.mode === 3 ? G.black : t); gl.uniform1i(P.u.uT, 0);
    gl.uniform4f(P.u.uRect, rect[0] / tw, rect[1] / th, rect[2] / tw, rect[3] / th); gl.uniform4f(P.u.uUV, 0, 0, 1, 1); gl.uniform1f(P.u.uFlip, opt.flip || 0);
    gl.uniform1f(P.u.uA, opt.a == null ? 1 : opt.a); gl.uniform1i(P.u.uMode, opt.mode || 0); gl.uniform1i(P.u.uBgra, opt.bgra ? 1 : 0);
    gl.uniform4f(P.u.uWipe, opt.wipe == null ? 0 : opt.wipe, opt.soft || 1, opt.wipe == null ? 0 : 1, 0); gl.uniform2f(P.u.uKey, opt.keyLo == null ? 0.05 : opt.keyLo, opt.keyHi == null ? 0.18 : opt.keyHi);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function fit(sw, sh, x, y, w, h, cover) { var k = cover ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh), dw = sw * k, dh = sh * k; return [x + (w - dw) / 2, y + (h - dh) / 2, dw, dh]; }

  // ---- sources' textures
  function srcTex(id) { var t = G.tex.get(id); if (!t) { t = { tex: makeTex(16, 16), w: 16, h: 16, bgra: false, at: 0, yuv: null }; G.tex.set(id, t); } return t; }
  function uploadI420(id, w, h, data) {
    var gl = G.gl, t = srcTex(id);
    if (!t.yuv || t.yuv.w !== w || t.yuv.h !== h) {
      if (t.yuv) ["y", "u", "v"].forEach(function (k) { gl.deleteTexture(t.yuv[k]); });
      t.yuv = { w: w, h: h, y: makeTex(w, h, "r8"), u: makeTex(w / 2, h / 2, "r8"), v: makeTex(w / 2, h / 2, "r8") };
    }
    if (t.w !== w || t.h !== h || !t.fbo) { gl.deleteTexture(t.tex); t.tex = makeTex(w, h); t.w = w; t.h = h; t.fbo = t.fbo || gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0); }
    var ys = w * h, cs = ys / 4;
    gl.bindTexture(gl.TEXTURE_2D, t.yuv.y); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, data.subarray(0, ys));
    gl.bindTexture(gl.TEXTURE_2D, t.yuv.u); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w / 2, h / 2, gl.RED, gl.UNSIGNED_BYTE, data.subarray(ys, ys + cs));
    gl.bindTexture(gl.TEXTURE_2D, t.yuv.v); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w / 2, h / 2, gl.RED, gl.UNSIGNED_BYTE, data.subarray(ys + cs, ys + 2 * cs));
    var P = G.progs.yuv; gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.viewport(0, 0, w, h); gl.disable(gl.BLEND); gl.useProgram(P.p);
    [["uY", t.yuv.y], ["uU", t.yuv.u], ["uV", t.yuv.v]].forEach(function (x, i) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, x[1]); gl.uniform1i(P.u[x[0]], i); });
    gl.uniform4f(P.u.uRect, 0, 0, 1, 1); gl.uniform4f(P.u.uUV, 0, 0, 1, 1); gl.uniform1f(P.u.uFlip, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.activeTexture(gl.TEXTURE0);
    t.bgra = false; t.at = performance.now();
  }
  function uploadRGBA(id, w, h, data, bgra) {
    var gl = G.gl, t = srcTex(id);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (t.w !== w || t.h !== h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); t.w = w; t.h = h; }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    t.bgra = !!bgra; t.at = performance.now();
  }
  function uploadImage(id, img, w, h) {   // a <video>, VideoFrame or ImageBitmap
    var gl = G.gl, t = srcTex(id); if (!w || !h) return;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    try { if (t.w !== w || t.h !== h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img); t.w = w; t.h = h; } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img); } catch (e) { return; }
    t.bgra = false; t.at = performance.now();
  }
  // a camera with no new picture for 3 s is "no signal"; a slide is a still picture, it stays
  function live(id) { var t = G.tex.get(id); return !!(t && t.at && (id === S.init.slidesId || performance.now() - t.at < 3000)); }
  function drawSource(id, f, a, opt) {
    var t = G.tex.get(id), d = bindTargetCached; if (!t || !t.at || a <= 0) return;
    var s = cfgSources().find(function (x) { return x.id === id; }), r = fit(t.w, t.h, 0, 0, d.w, d.h, s && s.cover);
    quad(t.tex, d.w, d.h, r, Object.assign({ a: a, bgra: t.bgra, flip: d.flip }, opt || {}));
  }
  var bindTargetCached = null;

  /* ---- the lyrics as a lower third: drawn with the 2D canvas, then a texture (premultiplied) */
  var LY = { canvas: null, ctx: null, cur: null, prev: null, x: 1, dip: false, key: "" };
  function lyricsTex(text, section) {
    var st = S.cfg.lyrics, W = 1920, H = 1080;
    if (!LY.canvas) { LY.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H }); LY.ctx = LY.canvas.getContext("2d"); }
    var c = LY.ctx; c.clearRect(0, 0, W, H);
    var lines = text ? text.split("\n").slice(0, Math.max(1, st.lines | 0 || 2)) : [];
    if (lines.length) {
      var px = Math.round(H * (Number(st.size) || 5.5) / 100), lh = px * 1.22, pad = px * 0.55;
      c.font = "700 " + px + "px " + (st.font || "Inter") + ", system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      if (st.upper) lines = lines.map(function (l) { return l.toUpperCase(); });
      var maxW = Math.max.apply(null, lines.map(function (l) { return c.measureText(l).width; })), bh = lines.length * lh + pad * 2;
      var y0 = st.position === "top" ? H * 0.07 : st.position === "middle" ? (H - bh) / 2 : H - H * 0.07 - bh;
      if (st.box !== "none") {
        c.globalAlpha = clamp(Number(st.boxOpacity), 0, 1); c.fillStyle = st.boxColor || "#000";
        if (st.box === "bar") c.fillRect(0, y0, W, bh);
        else { var bw = maxW + pad * 3, bx = (W - bw) / 2, rr = px * 0.35; c.beginPath(); c.moveTo(bx + rr, y0); c.arcTo(bx + bw, y0, bx + bw, y0 + bh, rr); c.arcTo(bx + bw, y0 + bh, bx, y0 + bh, rr); c.arcTo(bx, y0 + bh, bx, y0, rr); c.arcTo(bx, y0, bx + bw, y0, rr); c.fill(); }
        c.globalAlpha = 1;
      }
      if (st.shadow) { c.shadowColor = "rgba(0,0,0,.75)"; c.shadowBlur = px * 0.25; c.shadowOffsetY = px * 0.05; }
      c.fillStyle = st.color || "#fff";
      lines.forEach(function (l, i) { c.fillText(l, W / 2, y0 + pad + lh * (i + 0.5)); });
      c.shadowColor = "transparent";
    }
    var gl = G.gl, t = makeTex(W, H);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, LY.canvas); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return { tex: t, empty: !lines.length };
  }
  function lyricsUpdate(force) {
    var text = S.lyr.lines.join("\n"), key = text + "|" + JSON.stringify(S.cfg.lyrics);
    if (!force && key === LY.key) return;
    var sectionChanged = S.lyr.section !== LY.section; LY.key = key; LY.section = S.lyr.section;
    if (LY.prev) G.gl.deleteTexture(LY.prev.tex);
    LY.prev = LY.cur; LY.cur = lyricsTex(text, S.lyr.section); LY.x = LY.prev ? 0 : 1; LY.dip = sectionChanged || (LY.prev && LY.prev.empty) || LY.cur.empty;
  }

  /* ---- one output: program (or a transition), slides, lyrics, fade to black */
  function renderOutput(o, f, overlays) {
    var d = bindTargetCached = bindTarget(f), gl = G.gl;
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (o.trans) {
      var p = o.trans.p;
      if (o.trans.type === "dip") { if (p < 0.5) drawSource(o.trans.from, f, 1 - p * 2); else drawSource(o.trans.to, f, p * 2 - 1); }
      else if (o.trans.type === "wipe") { drawSource(o.trans.from, f, 1); drawSource(o.trans.to, f, 1, { wipe: p * (d.w + d.w * 0.04) - d.w * 0.02, soft: d.w * 0.02 }); }
      else { drawSource(o.trans.from, f, 1); drawSource(o.trans.to, f, p); }
    } else if (o.pgm != null) drawSource(o.pgm, f, 1);
    if (!overlays) return d;
    if (o.slidesA > 0 && o.slides !== "off" && live(S.init.slidesId)) drawSource(S.init.slidesId, f, o.slidesA, o.slides === "overlay" ? { mode: 1, keyLo: S.cfg.lyrics.keyLo || 0.04, keyHi: S.cfg.lyrics.keyHi || 0.16 } : null);
    if (o.lyricsA > 0 && LY.cur) {
      var ca = LY.dip ? Math.max(0, LY.x * 2 - 1) : LY.x, pa = LY.dip ? Math.max(0, 1 - LY.x * 2) : 1 - LY.x;
      if (LY.prev && pa > 0) quad(LY.prev.tex, d.w, d.h, [0, 0, d.w, d.h], { a: o.lyricsA * pa, mode: 2, flip: d.flip });
      if (ca > 0) quad(LY.cur.tex, d.w, d.h, [0, 0, d.w, d.h], { a: o.lyricsA * ca, mode: 2, flip: d.flip });
    }
    if (o.ftbA > 0) quad(G.black, d.w, d.h, [0, 0, d.w, d.h], { a: o.ftbA, mode: 3, flip: d.flip });
    return d;
  }
  function blit(f, x, y, w, h) { var d = bindTargetCached = bindTarget(null); quad(f.tex, d.w, d.h, [x, y, w, h], { flip: 1 }); G.gl.disable(G.gl.BLEND); }
  function blitSource(id, x, y, w, h) { var d = bindTargetCached = bindTarget(null); var t = G.tex.get(id); if (!t || !t.at) return; var r = fit(t.w, t.h, x, y, w, h); quad(t.tex, d.w, d.h, r, { bgra: t.bgra, flip: 1 }); }

  /* ---- read an output back as I420 (asynchronously, through pixel-pack buffers) */
  var RB = { stream: { q: [] }, main: { q: [] } };
  function readI420(which, f, fps) {
    var gl = G.gl, W = f.w, H = f.h, y = target("i420-" + which, W / 4, H * 3 / 2), P = G.progs.i420, size = W * H * 3 / 2, r = RB[which];
    gl.bindFramebuffer(gl.FRAMEBUFFER, y.fbo); gl.viewport(0, 0, y.w, y.h); gl.disable(gl.BLEND); gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, f.tex); gl.uniform1i(P.u.uT, 0); gl.uniform2i(P.u.uSize, W, H);
    gl.uniform4f(P.u.uRect, 0, 0, 1, 1); gl.uniform4f(P.u.uUV, 0, 0, 1, 1); gl.uniform1f(P.u.uFlip, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (r.q.length >= 3) return;   // the GPU is behind: skip this one
    var buf = r.free && r.free.size === size ? r.free.buf : gl.createBuffer(); r.free = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf); gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
    gl.readPixels(0, 0, y.w, y.h, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    r.q.push({ buf: buf, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), w: W, h: H, fps: fps, size: size }); gl.flush();
  }
  function collect(which, kind) {
    var gl = G.gl, r = RB[which];
    while (r.q.length) {
      var it = r.q[0], st = gl.clientWaitSync(it.fence, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) break;
      r.q.shift(); gl.deleteSync(it.fence);
      var out = new Uint8Array(8 + it.size); out[0] = kind; out[1] = it.w & 255; out[2] = it.w >> 8; out[3] = it.h & 255; out[4] = it.h >> 8; out[5] = it.fps & 255; out[6] = it.fps >> 8;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, it.buf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out, 8, it.size); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      if (r.free) gl.deleteBuffer(r.free.buf); r.free = { buf: it.buf, size: it.size };
      if (media && media.readyState === 1 && media.bufferedAmount < 3 * it.size) media.send(out);
    }
  }

  /* ================================================================== sources in the page: capture devices and phones */
  var caps = new Map();   // source id -> { video, stream, fresh, deviceId }
  async function captureOpen(s) {
    var c = caps.get(s.id); if (c && c.deviceId === s.deviceId) return;
    captureClose(s.id);
    c = { video: document.createElement("video"), stream: null, fresh: false, deviceId: s.deviceId }; caps.set(s.id, c);
    c.video.muted = true; c.video.playsInline = true;
    try {
      c.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: s.deviceId ? { exact: s.deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
      if (caps.get(s.id) !== c) { c.stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      c.video.srcObject = c.stream; await c.video.play().catch(function () { });
      var mark = function () { c.fresh = true; if (c.video.requestVideoFrameCallback) c.video.requestVideoFrameCallback(mark); };
      if (c.video.requestVideoFrameCallback) c.video.requestVideoFrameCallback(mark); else c.poll = true;
      setStatus(s.id, { state: "live", width: c.video.videoWidth, height: c.video.videoHeight });
    } catch (e) { setStatus(s.id, { state: "offline", error: (e && e.name === "NotFoundError" ? "the device is not connected" : (e && e.message) || String(e)) }); }
  }
  function captureClose(id) { var c = caps.get(id); if (!c) return; caps.delete(id); if (c.stream) c.stream.getTracks().forEach(function (t) { t.stop(); }); c.video.srcObject = null; }
  function captureUpload() { caps.forEach(function (c, id) { if ((c.fresh || c.poll) && c.video.readyState >= 2) { c.fresh = false; uploadImage(id, c.video, c.video.videoWidth, c.video.videoHeight); } }); }
  async function listCaptureDevices() {
    try { var d = await navigator.mediaDevices.enumerateDevices(); S.captureDevices = d.filter(function (x) { return x.kind === "videoinput"; }).map(function (x, i) { return { id: x.deviceId, label: x.label || "Camera " + (i + 1) }; }); } catch (_) { S.captureDevices = []; }
  }
  var phones = new Map();   // source id -> { decoder, codec, waitKey }
  function phoneConfig(m) {
    var p = phones.get(m.id); if (p && p.decoder) { try { p.decoder.close(); } catch (_) { } }
    p = { codec: m.codec, waitKey: true, decoder: null }; phones.set(m.id, p);
    if (m.codec !== "jpeg" && window.VideoDecoder) {
      p.decoder = new VideoDecoder({ output: function (fr) { uploadImage(m.id, fr, fr.displayWidth, fr.displayHeight); fr.close(); }, error: function (e) { p.waitKey = true; setStatus(m.id, { state: "offline", error: "decoder: " + e.message }); } });
      try { p.decoder.configure({ codec: m.codec, optimizeForLatency: true }); } catch (e) { setStatus(m.id, { state: "offline", error: "this computer can't decode " + m.codec }); }
    }
  }
  function phoneChunk(id, buf) {
    var p = phones.get(id); if (!p) return;
    var type = buf[0], ts = new DataView(buf.buffer, buf.byteOffset + 1, 8).getFloat64(0, true), data = buf.subarray(9);
    if (type === 2) { createImageBitmap(new Blob([data], { type: "image/jpeg" })).then(function (bmp) { uploadImage(id, bmp, bmp.width, bmp.height); bmp.close(); }).catch(function () { }); return; }
    if (!p.decoder || p.decoder.state !== "configured") return;
    if (p.waitKey && type !== 0) return; p.waitKey = false;
    if (p.decoder.decodeQueueSize > 6) { p.waitKey = true; return; }
    try { p.decoder.decode(new EncodedVideoChunk({ type: type === 0 ? "key" : "delta", timestamp: ts, data: data })); } catch (e) { p.waitKey = true; }
  }

  /* ================================================================== media socket */
  var media = null;
  function mediaConnect() {
    media = new WebSocket("ws://127.0.0.1:" + S.init.port + "/?t=" + S.init.token); media.binaryType = "arraybuffer";
    media.onmessage = function (e) {
      if (!G.gl) return;
      var b = new Uint8Array(e.data), kind = b[0], dv = new DataView(e.data);
      if (kind === 1) { var id = dv.getUint16(1, true), w = dv.getUint16(3, true), h = dv.getUint16(5, true), fmt = b[7]; var data = b.subarray(9); if (fmt === 0) uploadI420(id, w, h, data); else uploadRGBA(id, w, h, data, fmt === 1); frameSeen(id); }
      else if (kind === 2) { try { phoneConfig(JSON.parse(new TextDecoder().decode(b.subarray(1)))); } catch (_) { } }
      else if (kind === 3) { var pid = dv.getUint16(1, true); phoneChunk(pid, b.subarray(3)); frameSeen(pid); }
    };
    media.onclose = function () { setTimeout(mediaConnect, 1000); };
  }
  var seen = {}; function frameSeen(id) { seen[id] = (seen[id] || 0) + 1; }

  /* ================================================================== the outputs' logic */
  function outs(bus) { return bus === "both" ? [S.out.main, S.out.stream] : [S.out[bus] || S.out.main]; }
  function setPreview(id, bus) { outs(bus || S.bus).forEach(function (o) { o.pvw = id; saveOut(o); }); changed(); }
  function cut(bus) { outs(bus || S.bus).forEach(function (o) { if (o.trans) { o.trans.p = 1; finishTrans(o); return; } var a = o.pgm; o.pgm = o.pvw; o.pvw = a; saveOut(o); }); changed(); }
  function auto(bus) {
    var tr = S.cfg.transition || { type: "fade", ms: 600 };
    outs(bus || S.bus).forEach(function (o) {
      if (o.trans) return;
      if (tr.type === "cut" || !(tr.ms > 0)) { var a = o.pgm; o.pgm = o.pvw; o.pvw = a; saveOut(o); return; }
      o.trans = { from: o.pgm, to: o.pvw, type: tr.type, ms: tr.ms, t0: performance.now(), p: 0 };
    });
    changed();
  }
  function finishTrans(o) { var t = o.trans; o.trans = null; o.pgm = t.to; o.pvw = t.from; saveOut(o); changed(); }
  function take(id, bus) { outs(bus || S.bus).forEach(function (o) { o.pvw = id; }); auto(bus); }
  function animate(o, dt) {
    if (o.trans) { o.trans.p = clamp((performance.now() - o.trans.t0) / o.trans.ms, 0, 1); if (o.trans.p >= 1) finishTrans(o); }
    var fade = Math.max(0.05, Number(S.cfg.lyrics.fade) || 0.4), step = dt / 1000 / fade;
    o.lyricsA = clamp(o.lyricsA + (o.lyrics ? step : -step), 0, 1);
    o.slidesA = clamp(o.slidesA + (o.slides !== "off" ? step : -step), 0, 1);
    o.ftbA = clamp(o.ftbA + (o.ftb ? dt / 1000 : -dt / 1000), 0, 1);
  }
  // tally: red = on a program (or in a transition), green = in a preview
  function tally() {
    var t = {};
    ["main", "stream"].forEach(function (k) { var o = S.out[k]; [o.pgm].concat(o.trans ? [o.trans.from, o.trans.to] : []).forEach(function (id) { if (id != null) (t[id] = t[id] || { on: [], pvw: [] }).on.push(k); }); if (o.pvw != null && !o.trans) (t[o.pvw] = t[o.pvw] || { on: [], pvw: [] }).pvw.push(k); });
    return t;
  }

  // what each source must deliver: "hi" on a program / preview, "lo" on the multiview page, otherwise off
  var wantKey = "", wantTimer = 0;
  function changed() { clearTimeout(wantTimer); wantTimer = setTimeout(applyWants, 60); paintControls(); }
  function mvSources() { return cfgSources().filter(function (s) { return s.mv !== false; }).concat(S.cfg.multiview.slides !== false ? [{ id: S.init.slidesId, name: "Slides", kind: "slides" }] : []); }
  function grid(n) { var g = S.cfg.multiview.grid; if (g && g !== "auto") { var p = g.split("x").map(Number); return { c: p[0], r: p[1] }; } return fitGrid(n); }
  // Auto: every camera on one screen (up to 48 + the slides), in the columns × rows that make the tiles biggest in the space there is
  function fitGrid(n) {
    n = Math.max(1, n); var b = S.mvBox || { w: 1200, h: 520 }, best = { c: 1, r: n, t: 0 };
    for (var c = 1; c <= Math.min(n, 12); c++) { var r = Math.ceil(n / c), t = Math.min(b.w / c, b.h / r * 16 / 9); if (t > best.t + 0.5) best = { c: c, r: r, t: t }; }
    return { c: best.c, r: best.r };
  }
  function pageItems() { var all = mvSources(), g = grid(all.length), per = g.c * g.r, pages = Math.max(1, Math.ceil(all.length / per)); S.page = clamp(S.page, 0, pages - 1); return { items: all.slice(S.page * per, S.page * per + per), g: g, pages: pages }; }
  function applyWants() {
    var map = {}, t = tally(), onPage = {};
    pageItems().items.forEach(function (s) { onPage[s.id] = true; });
    cfgSources().forEach(function (s) { map[s.id] = (t[s.id] || s.alwaysHi) ? "hi" : onPage[s.id] ? "lo" : "off"; });
    var key = JSON.stringify(map);
    if (key !== wantKey) { wantKey = key; V.want(map); }
    cfgSources().forEach(function (s) { if (s.kind === "capture") { if (map[s.id] !== "off") captureOpen(s); else { captureClose(s.id); setStatus(s.id, { state: "idle" }); } } });
    var slidesUsed = onPage[S.init.slidesId] || t[S.init.slidesId] || S.out.main.slides !== "off" || S.out.stream.slides !== "off";
    if (slidesUsed !== S.slidesOn) { S.slidesOn = slidesUsed; V.slides(slidesUsed); }
    var tl = {}; Object.keys(t).forEach(function (id) { tl[id] = { on: t[id].on.length > 0, pvw: t[id].pvw.length > 0 }; });
    if (V.tally) V.tally(tl);
  }

  /* ================================================================== the Main window */
  var MW = { win: null, ctx: null, canvas: null };
  async function mainOpen(on) {
    if (!on) { if (MW.win && !MW.win.closed) MW.win.close(); MW.win = null; paintControls(); return; }
    if (MW.win && !MW.win.closed) return;
    var w = window.open("", "cu-video-main");
    if (!w) { alert("The Main output window could not open (this version of Central Control is missing its window hook)."); return; }
    MW.win = w; var d = w.document;
    d.title = "Central Control - Main"; d.body.style.cssText = "margin:0;background:#000;overflow:hidden;cursor:none";
    MW.canvas = d.createElement("canvas"); MW.canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#000";
    d.body.appendChild(MW.canvas); MW.ctx = MW.canvas.getContext("2d", { alpha: false });
    w.addEventListener("keydown", function (e) { if (e.key === "Escape") mainOpen(false); });
    paintControls();
  }
  function mainSize() { var d = S.screens.find(function (x) { return x.id === S.cfg.main.displayId; }) || S.screens.find(function (x) { return !x.primary; }) || S.screens[0]; var w = d ? d.size.width : 1920, h = d ? d.size.height : 1080, k = Math.min(1, 1920 / w, 1080 / h); return [Math.round(w * k / 4) * 4, Math.round(h * k / 2) * 2]; }

  /* ================================================================== the loop */
  var last = performance.now(), monAt = 0, statAt = 0, ticks = 0;
  function tick() {
    if (!G.gl) return;
    var now = performance.now(), dt = Math.min(200, now - last); last = now; ticks++;
    captureUpload();
    if (LY.x < 1) LY.x = clamp(LY.x + dt / 1000 / Math.max(0.05, (Number(S.cfg.lyrics.fade) || 0.4) * (LY.dip ? 2 : 1)), 0, 1);
    animate(S.out.main, dt); animate(S.out.stream, dt);
    var preset = S.init.presets[S.cfg.stream.preset] || [1920, 1080, 30], st = S.stream || {};
    var streamNeeded = (st.encoder && st.encoder.on) || (st.ndi && st.ndi.stream && st.ndi.stream.on) || visible();
    var fs = target("stream", preset[0], preset[1]);
    if (streamNeeded) { renderOutput(S.out.stream, fs, true); if ((st.encoder && st.encoder.on) || (st.ndi && st.ndi.stream && st.ndi.stream.on)) readI420("stream", fs, preset[2]); }
    var mainOpenNow = MW.win && !MW.win.closed, ms = mainSize(), fm = target("main", ms[0], ms[1]);
    if (mainOpenNow || visible() || (st.ndi && st.ndi.main && st.ndi.main.on)) {
      renderOutput(S.out.main, fm, true);
      if (st.ndi && st.ndi.main && st.ndi.main.on) readI420("main", fm, preset[2]);
      if (mainOpenNow) {
        if (MW.canvas.width !== fm.w || MW.canvas.height !== fm.h) { MW.canvas.width = fm.w; MW.canvas.height = fm.h; }
        blit(fm, 0, 0, fm.w, fm.h); MW.ctx.drawImage(G.canvas, 0, 0, fm.w, fm.h, 0, 0, fm.w, fm.h);
      }
    } else if (MW.win && MW.win.closed) { MW.win = null; paintControls(); }
    collect("stream", 10); collect("main", 11);
    if (visible() && S.view === "switch" && now - monAt > 1000 / 20) { monAt = now; drawMonitors(fm, fs); drawMultiview(); }
    if (now - statAt > 1000) { statAt = now; paintStatus(); }
  }
  function drawMonitors(fm, fs) {
    var mons = [["main-pvw", S.out.main, false], ["main-pgm", fm, true], ["stream-pvw", S.out.stream, false], ["stream-pgm", fs, true]];
    var tw = 480, th = 270;
    mons.forEach(function (m, i) {
      var cv = $('[data-mon="' + m[0] + '"]'); if (!cv) return;
      var x = i * tw;
      bindTargetCached = bindTarget(null); var gl = G.gl; gl.enable(gl.SCISSOR_TEST); gl.scissor(x, G.H - th, tw, th); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
      if (m[2]) { var r = fit(m[1].w, m[1].h, x, 0, tw, th); blit(m[1], r[0], r[1], r[2], r[3]); }
      else if (m[1].pvw != null) blitSource(m[1].pvw, x, 0, tw, th);
      var ctx = cv._ctx || (cv._ctx = cv.getContext("2d", { alpha: false })); if (cv.width !== tw) { cv.width = tw; cv.height = th; }
      ctx.drawImage(G.canvas, x, 0, tw, th, 0, 0, tw, th);
    });
  }
  function drawMultiview() {
    var cv = $(".vd-mv"); if (!cv) return;
    // the multiview fits the space under the outputs: no scrolling to reach a camera
    var wrap = cv.parentNode, bw = Math.max(200, wrap.clientWidth || 960), bh = Math.max(120, wrap.clientHeight || 500); S.mvBox = { w: bw, h: bh };
    var pi = pageItems(), g = pi.g, cssT = Math.min(bw / g.c, bh / g.r * 16 / 9), cssW = Math.floor(cssT * g.c), cssH = Math.floor(cssT * 9 / 16 * g.r);
    var tw = Math.max(32, Math.floor(Math.min(cssT * (window.devicePixelRatio || 1), 1920 / g.c, (1080 - 280) / g.r * 16 / 9))), th = Math.round(tw * 9 / 16), W = tw * g.c, H = th * g.r;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    if (cv.style.width !== cssW + "px") { cv.style.width = cssW + "px"; cv.style.height = cssH + "px"; }
    var gl = G.gl; bindTargetCached = bindTarget(null);
    var oy = 280;   // below the monitors' strip
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, G.H - oy - H, W, H); gl.clearColor(0.03, 0.06, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
    pi.items.forEach(function (s, i) { var x = (i % g.c) * tw, y = oy + Math.floor(i / g.c) * th; blitSource(s.id, x + 2, y + 2, tw - 4, th - 4); });
    var ctx = cv._ctx || (cv._ctx = cv.getContext("2d")); ctx.drawImage(G.canvas, 0, oy, W, H, 0, 0, W, H);
    var t = tally(), fsz = Math.max(11, Math.round(th / 11));
    ctx.font = "700 " + fsz + "px Inter, system-ui, sans-serif"; ctx.textBaseline = "bottom";
    pi.items.forEach(function (s, i) {
      var x = (i % g.c) * tw, y = Math.floor(i / g.c) * th, tl = t[s.id], on = tl && tl.on.length, pv = tl && tl.pvw.length;
      ctx.lineWidth = on || pv ? Math.max(3, tw / 90) : 1; ctx.strokeStyle = on ? "#ff3b3b" : pv ? "#2fd15a" : "#343A44"; ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, tw - ctx.lineWidth, th - ctx.lineWidth);
      var label = (S.page * g.c * g.r + i + 1) + "  " + s.name + (on ? "  ● " + tl.on.map(function (k) { return k === "main" ? "M" : "S"; }).join("") : pv ? "  ○ " + tl.pvw.map(function (k) { return k === "main" ? "M" : "S"; }).join("") : "");
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(x + 4, y + th - fsz * 1.6, Math.min(tw - 8, ctx.measureText(label).width + 12), fsz * 1.45);
      ctx.fillStyle = on ? "#ff8a8a" : pv ? "#8cf5a8" : "#ECE7DD"; ctx.fillText(label, x + 10, y + th - fsz * 0.35);
      if (s.id !== S.init.slidesId && !live(s.id)) { var stt = S.status[s.id] || {}; ctx.fillStyle = "#9AA1AB"; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText(stt.state === "connecting" ? "connecting…" : stt.error ? "no signal" : "no signal", x + tw / 2, y + th / 2); ctx.textAlign = "left"; ctx.textBaseline = "bottom"; }
    });
    cv._layout = { tw: tw, th: th, g: g, items: pi.items, W: W, H: H };
  }
  // a timer that keeps running when the window is in the background (a worker's timers are not throttled)
  var ticker = null;
  function startTicker() {
    var fps = (S.init.presets[S.cfg.stream.preset] || [0, 0, 30])[2];
    if (ticker) ticker.terminate();
    // one tick at a time: the next is only sent once the page has finished the last one (a slow GPU drops frames, never piles them up)
    var src = "var t=0,busy=false;onmessage=function(e){if(e.data==='done'){busy=false;return;}clearInterval(t);t=setInterval(function(){if(!busy){busy=true;postMessage(0);}}," + (1000 / fps).toFixed(3) + ")};";
    try { ticker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))); ticker.onmessage = function () { try { tick(); } catch (e) { console.warn("video tick", e); } setTimeout(function () { if (ticker) ticker.postMessage("done"); }, 0); }; ticker.postMessage(0); }
    catch (_) { setInterval(tick, 1000 / fps); }
  }

  /* ================================================================== the page */
  var VIEWS = [["switch", "Switcher"], ["sources", "Sources"], ["stream", "Stream"], ["audio", "Audio"], ["overlays", "Lyrics & slides"], ["phones", "Phones"]];
  function shell() {
    root.innerHTML = '<div class="vd"><div class="vd-top"><nav class="vd-nav">' + VIEWS.map(function (v) { return '<button data-vview="' + v[0] + '">' + v[1] + "</button>"; }).join("") + '</nav><div class="vd-chips" id="vdChips"></div></div>' +
      '<div class="vd-body" id="vdBody"></div></div>';
    paintView();
  }
  function paintView() {
    $$("[data-vview]").forEach(function (b) { b.classList.toggle("on", b.dataset.vview === S.view); });
    var body = $("#vdBody"); if (!body) return; body.classList.toggle("sw", S.view === "switch");
    if (S.error) { body.innerHTML = '<div class="card"><p class="bad">' + esc(S.error) + "</p></div>"; return; }
    if (!S.cfg || !S.init) { body.innerHTML = '<p class="muted">Starting the video switcher…</p>'; return; }
    body.innerHTML = S.view === "switch" ? switcherHtml() : S.view === "sources" ? sourcesHtml() : S.view === "stream" ? streamHtml() : S.view === "audio" ? audioHtml() : S.view === "overlays" ? overlaysHtml() : phonesHtml();
    paintControls(); paintStatus();
  }
  function outHtml(k, title) {
    var o = S.out[k];
    return '<section class="vd-out" data-out="' + k + '"><header><b>' + title + '</b><span class="vd-outinfo" data-outinfo="' + k + '"></span></header>' +
      '<div class="vd-mons"><figure><canvas data-mon="' + k + '-pvw"></canvas><figcaption>Preview <span data-cap="' + k + '-pvw"></span></figcaption></figure><figure class="pgm"><canvas data-mon="' + k + '-pgm"></canvas><figcaption>Program <span data-cap="' + k + '-pgm"></span></figcaption></figure></div>' +
      '<div class="vd-ctl"><button class="vd-cut" data-act="cut" data-k="' + k + '">CUT</button><button class="vd-auto" data-act="auto" data-k="' + k + '">AUTO</button>' +
      '<button class="vd-tog" data-act="lyrics" data-k="' + k + '">LYRICS</button>' +
      '<select data-act="slides" data-k="' + k + '" title="The Slides tab\'s picture on this output"><option value="off">Slides off</option><option value="overlay">Slides over camera</option><option value="full">Slides full screen</option></select>' +
      '<button class="vd-tog" data-act="ftb" data-k="' + k + '" title="Fade to black">FTB</button>' +
      (k === "main" ? '<button class="vd-tog" data-act="mainwin">SCREEN</button>' : '<button class="vd-live" data-act="golive">GO LIVE</button><button class="vd-rec" data-act="rec">REC</button>') + "</div></section>";
  }
  function switcherHtml() {
    var tr = S.cfg.transition || {};
    return '<div class="vd-outs">' + outHtml("main", "MAIN") + outHtml("stream", "STREAM") + "</div>" +
      '<div class="vd-mvbar"><span class="vd-seg">Click a camera for <button data-bus="main">Main</button><button data-bus="stream">Stream</button><button data-bus="both">Both</button></span>' +
      '<label>Transition <select data-tr="type"><option value="fade">Fade</option><option value="dip">Dip to black</option><option value="wipe">Wipe</option><option value="cut">Cut</option></select></label>' +
      '<label><input type="number" data-tr="ms" min="0" max="5000" step="100" value="' + (tr.ms || 600) + '" style="width:76px"> ms</label>' +
      '<label>Grid <select data-mv="grid">' + ["auto", "2x2", "3x3", "4x4", "5x5", "6x6", "8x6"].map(function (g) { return '<option value="' + g + '"' + ((S.cfg.multiview.grid || "auto") === g ? " selected" : "") + ">" + (g === "auto" ? "All on one screen" : g.replace("x", " × ") + " (pages)") + "</option>"; }).join("") + "</select></label>" +
      '<span class="vd-pages" id="vdPages"></span><span class="muted small">Click = preview · double-click = take · Space = cut · Enter = auto</span></div>' +
      '<div class="vd-mvwrap"><canvas class="vd-mv" tabindex="0"></canvas></div>' + (cfgSources().length ? "" : '<p class="muted vd-empty">No cameras yet - add them on <a href="#" data-vview="sources">Sources</a>.</p>');
  }
  function paintControls() {
    if (!S.ready || S.view !== "switch") return;
    ["main", "stream"].forEach(function (k) {
      var o = S.out[k];
      var lb = $('[data-act="lyrics"][data-k="' + k + '"]'); if (lb) lb.classList.toggle("on", o.lyrics);
      var fb = $('[data-act="ftb"][data-k="' + k + '"]'); if (fb) fb.classList.toggle("on", o.ftb);
      var sl = $('[data-act="slides"][data-k="' + k + '"]'); if (sl) sl.value = o.slides;
      var cp = $('[data-cap="' + k + '-pvw"]'); if (cp) cp.textContent = o.pvw != null ? "· " + srcName(o.pvw) : "";
      var cg = $('[data-cap="' + k + '-pgm"]'); if (cg) cg.textContent = o.trans ? "· " + srcName(o.trans.from) + " → " + srcName(o.trans.to) : o.pgm != null ? "· " + srcName(o.pgm) : "";
    });
    var mw = $('[data-act="mainwin"]'); if (mw) mw.classList.toggle("on", !!(MW.win && !MW.win.closed));
    $$("[data-bus]").forEach(function (b) { b.classList.toggle("on", b.dataset.bus === S.bus); });
    var ty = $('[data-tr="type"]'); if (ty) ty.value = (S.cfg.transition || {}).type || "fade";
    var pi = pageItems(), pg = $("#vdPages"); if (pg) pg.innerHTML = pi.pages > 1 ? '<button data-page="-1">‹</button> ' + (S.page + 1) + " / " + pi.pages + ' <button data-page="1">›</button>' : "";
  }
  function paintStatus() {
    var st = S.stream || {}, enc = st.encoder || {}, dests = st.destinations || [], liveN = dests.filter(function (d) { return d.status === "live"; }).length, onN = dests.filter(function (d) { return d.on; }).length;
    var chips = $("#vdChips");
    if (chips) chips.innerHTML = '<span class="vd-chip' + (MW.win && !MW.win.closed ? " on" : "") + '">MAIN ' + (MW.win && !MW.win.closed ? "on screen" : "off") + "</span>" +
      '<span class="vd-chip' + (liveN ? " live" : onN ? " warn" : "") + '">STREAM ' + (liveN ? "LIVE " + liveN + "/" + onN : onN ? "connecting…" : "off") + "</span>" +
      (S.notice ? '<span class="vd-chip bad">' + esc(S.notice) + "</span>" : "") + (st.record && st.record.on ? '<span class="vd-chip live">REC</span>' : "") + (enc.on ? '<span class="vd-chip">' + esc(enc.codec || "") + " · " + (enc.fps || 0) + " fps" + (enc.drop ? " · " + enc.drop + " dropped" : "") + "</span>" : enc.error ? '<span class="vd-chip bad" title="' + esc(enc.error) + '">encoder: ' + esc(enc.error.slice(0, 60)) + "</span>" : "");
    var gl = $('[data-act="golive"]'); if (gl) { gl.classList.toggle("on", onN > 0); gl.textContent = onN ? (liveN ? "LIVE" : "STARTING…") : "GO LIVE"; }
    var rb = $('[data-act="rec"]'); if (rb) rb.classList.toggle("on", !!(st.record && st.record.on));
    if (S.view === "stream") paintDestStatus();
    if (S.view === "sources") $$("[data-srcstate]").forEach(function (el) { var id = Number(el.dataset.srcstate), s = S.status[id] || {}; el.textContent = live(id) ? "● live" + (s.width ? " " + s.width + "×" + s.height : "") + (s.level ? " (" + s.level + ")" : "") : s.state === "connecting" ? "connecting…" : s.error ? "✕ " + s.error : s.state || "idle"; el.className = "small " + (live(id) ? "ok" : s.error ? "bad" : "muted"); });
  }

  // ---- Sources
  var KINDS = { ndi: "NDI camera", ip: "IP camera (SRT / RTMP / RTSP / HTTP)", capture: "USB / HDMI capture or webcam", phone: "Phone", file: "Media file (loops)", test: "Test pattern" };
  function sourcesHtml() {
    var rows = cfgSources().map(function (s, i) {
      var addr = s.kind === "ndi" ? s.ndiName || s.name : s.kind === "capture" ? ((S.captureDevices.find(function (d) { return d.id === s.deviceId; }) || {}).label || "device") : s.kind === "phone" ? "joins from the phone page" : s.url || "";
      return '<tr data-sid="' + s.id + '"><td>' + (i + 1) + '</td><td><input data-sf="name" value="' + esc(s.name) + '"></td><td class="small muted">' + esc(KINDS[s.kind] || s.kind) + '<br><span class="vd-addr">' + esc(addr) + "</span></td>" +
        '<td><label class="toggle"><input type="checkbox" data-sf="mv"' + (s.mv !== false ? " checked" : "") + '> multiview</label><label class="toggle"><input type="checkbox" data-sf="alwaysHi"' + (s.alwaysHi ? " checked" : "") + '> always full quality</label><label class="toggle"><input type="checkbox" data-sf="cover"' + (s.cover ? " checked" : "") + '> fill (crop)</label></td>' +
        '<td><span data-srcstate="' + s.id + '"></span></td><td class="vd-rowbtn"><button data-sa="up">↑</button><button data-sa="down">↓</button>' + (s.kind === "ip" ? '<button data-sa="edit">Edit</button>' : "") + '<button data-sa="remove">✕</button></td></tr>';
    }).join("");
    var ndi = S.ndi.error ? '<p class="warn small">' + esc(S.ndi.error) + "</p>" : S.ndi.sources.length ? S.ndi.sources.map(function (n) { var have = cfgSources().some(function (s) { return s.kind === "ndi" && s.ndiName === n.name; }); return '<button data-addndi="' + esc(n.name) + '"' + (have ? " disabled" : "") + ">" + (have ? "✓ " : "+ ") + esc(n.name) + "</button>"; }).join("") : '<p class="muted small">Looking for NDI sources on the network…</p>';
    var capd = S.captureDevices.length ? S.captureDevices.map(function (d) { var have = cfgSources().some(function (s) { return s.kind === "capture" && s.deviceId === d.id; }); return '<button data-addcap="' + esc(d.id) + '"' + (have ? " disabled" : "") + ">" + (have ? "✓ " : "+ ") + esc(d.label) + "</button>"; }).join("") : '<p class="muted small">No capture devices or webcams found.</p>';
    return '<div class="vd-grid"><section class="card wide"><h3>Cameras (' + cfgSources().length + " / " + MAX_SOURCES + ")</h3>" +
      (rows ? '<table class="io-t vd-srcs">' + rows + "</table>" : '<p class="muted">No cameras yet.</p>') + "</section>" +
      '<section class="card"><h3>NDI on the network</h3><div class="vd-adds">' + ndi + '</div><label>Sources on other networks (IP addresses, comma separated) <input data-ndi="extra" placeholder="10.0.5.20, 10.0.5.21"></label><p class="muted small">Needs the free NDI Tools (ndi.video). The camera grid uses each camera\'s small stream to save the network; whatever is in preview or on air comes in at full quality.</p></section>' +
      '<section class="card"><h3>USB / HDMI capture and webcams</h3><div class="vd-adds">' + capd + '</div><button data-sa="rescan">Look again</button></section>' +
      '<section class="card"><h3>IP camera, encoder or media file</h3><label>Name <input data-new="name" placeholder="Camera 3 - wide"></label>' +
      '<label>Address <input data-new="url" placeholder="srt://10.0.0.21:9000 · rtsp://user:pass@10.0.0.21/stream1 · rtmp://…"></label>' +
      '<label>Small stream for the multiview (optional) <input data-new="loUrl" placeholder="rtsp://…/stream2 (the camera\'s sub stream)"></label>' +
      '<div class="row"><button class="primary" data-sa="addip">Add camera</button><button data-sa="addfile">Add a media file…</button><button data-sa="addtest">Add a test pattern</button></div>' +
      '<p class="muted small">SRT, RTMP, RTSP and HTTP (HLS / MJPEG) all work. Phones join from the Phones page.</p></section></div>';
  }
  async function saveSources(list) { S.cfg = await V.config({ sources: list }); changed(); if (S.view === "sources") paintView(); }

  // ---- Stream
  function streamHtml() {
    var c = S.cfg.stream, enc = S.encoders || { list: [] };
    var dests = S.cfg.destinations.map(function (d) {
      return '<tr data-did="' + esc(d.id) + '"><td><label class="toggle"><input type="checkbox" data-df="on"' + (d.on ? " checked" : "") + "></label></td><td><select data-df=\"kind\">" + Object.keys(S.init.destKinds).map(function (k) { return '<option value="' + k + '"' + (d.kind === k ? " selected" : "") + ">" + S.init.destKinds[k].label + "</option>"; }).join("") + '</select></td>' +
        '<td><input data-df="name" value="' + esc(d.name || "") + '" placeholder="Name"></td><td><input data-df="url" value="' + esc(d.url || "") + '" placeholder="' + esc((S.init.destKinds[d.kind] || {}).url || "rtmp://…") + '"></td>' +
        '<td>' + (d.kind === "srt" ? '<span class="muted small">(in the address)</span>' : '<input type="password" data-df="key" value="' + esc(d.key || "") + '" placeholder="Stream key">') + '</td><td data-dstat="' + esc(d.id) + '" class="small"></td><td><button data-da="remove">✕</button></td></tr>';
    }).join("");
    return '<div class="vd-grid"><section class="card wide"><h3>Where the stream goes</h3>' + (dests ? '<table class="io-t vd-dests"><tr class="muted small"><td>On</td><td>Service</td><td>Name</td><td>Address</td><td>Key</td><td>Status</td><td></td></tr>' + dests + "</table>" : '<p class="muted">No destinations yet.</p>') +
      '<div class="row"><button data-da="add" data-kind="youtube">+ YouTube</button><button data-da="add" data-kind="facebook">+ Facebook</button><button data-da="add" data-kind="rtmp">+ RTMP / RTMPS</button><button data-da="add" data-kind="srt">+ SRT</button><span class="spacer"></span><button class="primary" data-da="all-on">Go live on all</button><button data-da="all-off">Stop all</button></div>' +
      '<p class="muted small">Each destination runs on its own, so one can drop and reconnect without the others noticing. Your internet upload has to carry all of them at once.</p></section>' +
      '<section class="card"><h3>Quality</h3><label>Picture <select data-sc="preset">' + Object.keys(S.init.presets).map(function (k) { return '<option value="' + k + '"' + (c.preset === k ? " selected" : "") + ">" + k + "</option>"; }).join("") + '</select></label>' +
      '<label>Video bitrate <input type="number" data-sc="bitrate" min="800" max="20000" step="100" value="' + (c.bitrate || 6000) + '"> kbps</label><label>Audio bitrate <select data-sc="audioBitrate">' + [96, 128, 160, 192, 256].map(function (b) { return '<option' + ((c.audioBitrate || 160) === b ? " selected" : "") + ">" + b + "</option>"; }).join("") + '</select> kbps</label>' +
      '<label>Encoder <select data-sc="encoder"><option value="auto">Automatic' + (enc.best ? " (" + esc(enc.best) + ")" : "") + "</option>" + enc.list.map(function (e) { return '<option value="' + e + '"' + (c.encoder === e ? " selected" : "") + ">" + e + "</option>"; }).join("") + "</select></label>" +
      '<p class="muted small">' + (enc.list.length ? "Found: " + esc(enc.list.join(", ")) + ". A graphics card's encoder (NVENC, Quick Sync, VideoToolbox, AMF, VAAPI) leaves the processor free." : S.encoders ? "No H.264 encoder found." : "Checking the encoders…") + "</p></section>" +
      '<section class="card"><h3>Recording</h3><p class="muted small">Records what goes out on the stream, picture and sound, as an MP4. The file still plays even if the computer stops halfway.</p><div class="row"><button data-da="rec">● Record</button><button data-da="folder">Open the folder</button></div><p class="small" data-recstat></p></section>' +
      '<section class="card"><h3>To OBS / vMix / Streamlabs on this computer</h3><label class="toggle"><input type="checkbox" data-ndiout="stream"' + (S.cfg.stream.ndi ? " checked" : "") + '> NDI source "Central Control Stream"</label><label class="toggle"><input type="checkbox" data-ndiout="main"' + (S.cfg.main.ndi ? " checked" : "") + '> NDI source "Central Control Main"</label><p class="small" data-ndistat></p>' +
      '<p class="muted small">In OBS add an NDI Source (the free DistroAV plugin) and pick it; the sound comes in through OBS as usual. Needs NDI Tools.</p></section></div>';
  }
  function paintDestStatus() {
    var st = S.stream || {};
    (st.destinations || []).forEach(function (d) { var el = $('[data-dstat="' + d.id + '"]'); if (!el) return; el.textContent = d.status === "live" ? "● live " + d.kbps + " kbps" : d.status === "off" ? "off" : d.status === "reconnecting" ? "reconnecting… (" + (d.error || "") + ")" : d.error ? "✕ " + d.error : d.status; el.className = "small " + (d.status === "live" ? "ok" : d.error ? "bad" : "muted"); });
    var rs = $("[data-recstat]"); if (rs) rs.textContent = st.record && st.record.on ? "● recording " + (st.record.file || "") + " (" + Math.round((st.record.bytes || 0) / 1048576) + " MB)" : "Saved in " + (S.cfg.record.dir || "");
    var rb = $('[data-da="rec"]'); if (rb) rb.textContent = st.record && st.record.on ? "■ Stop recording" : "● Record";
    var ns = $("[data-ndistat]"); if (ns && st.ndi) ns.textContent = ["stream", "main"].map(function (k) { var x = st.ndi[k] || {}; return x.on ? (k === "stream" ? "Stream" : "Main") + ": sending" + (x.receivers != null ? " (" + x.receivers + " watching)" : "") : x.error ? (k === "stream" ? "Stream" : "Main") + ": " + x.error : ""; }).filter(Boolean).join(" · ");
  }

  // ---- Audio
  function audioHtml() {
    var a = S.cfg.audio, devs = S.audio.devices || [];
    function srcCard(i) {
      var s = a.sources[i] || {}, dev = devs.find(function (d) { return d.name === s.device; }), n = Math.max(2, dev ? dev.channels : 2), opts = function (v) { var h = ""; for (var c = 0; c < n; c++) h += '<option value="' + c + '"' + (v === c ? " selected" : "") + ">" + (c + 1) + "</option>"; return h; };
      return '<section class="card vd-asrc' + (a.use === i ? " on" : "") + '" data-asrc="' + i + '"><h3><label class="toggle"><input type="radio" name="vdUse" value="' + i + '"' + (a.use === i ? " checked" : "") + "> Source " + (i ? "B" : "A") + "</label></h3>" +
        '<label>Interface / Dante <select data-af="device"><option value="">— none —</option>' + devs.map(function (d) { return '<option value="' + esc(d.name) + '"' + (d.name === s.device ? " selected" : "") + ">" + esc(d.name) + " (" + d.channels + " ch)</option>"; }).join("") + (s.device && !dev ? '<option selected value="' + esc(s.device) + '">' + esc(s.device) + " (not connected)</option>" : "") + "</select></label>" +
        '<div class="row"><label>Left <select data-af="l">' + opts(s.l | 0) + '</select></label><label>Right <select data-af="r">' + opts(s.r == null ? 1 : s.r | 0) + '</select></label><label>Gain <input type="range" data-af="gain" min="-30" max="18" step="0.5" value="' + (Number(s.gain) || 0) + '"><output>' + (Number(s.gain) || 0) + ' dB</output></label></div>' +
        '<div class="vd-meter"><i data-meter="' + i + '-0"></i></div><div class="vd-meter"><i data-meter="' + i + '-1"></i></div><p class="small muted" data-astat="' + i + '"></p></section>';
    }
    var mixCard = '<section class="card vd-asrc' + (a.use === 2 ? " on" : "") + '"><h3><label class="toggle"><input type="radio" name="vdUse" value="2"' + (a.use === 2 ? " checked" : "") + "> Stream mix</label></h3>" +
      '<p class="muted small">The Mix tab\'s stream mix, straight from the sound desk (Central Control\'s audio host - this computer or another one): no cable, no interface channels. Its levels, compressor and reverb are on the Mix tab ("Faders: Stream mix").</p>' +
      '<div class="vd-meter"><i data-mixmeter="0"></i></div><div class="vd-meter"><i data-mixmeter="1"></i></div><p class="small muted" data-mixstat>' + (a.use === 2 ? "Starts with the stream (or the recording)." : "") + "</p></section>";
    return '<div class="vd-grid">' + srcCard(0) + srcCard(1) + mixCard + '<section class="card"><h3>The stream\'s sound</h3><p class="muted small">The stream uses whichever source is ticked. Usually A is the sound desk\'s main left and right, B is a separate stream mix from the desk, or you use the Stream mix straight from Central Control. None of this changes the sound in the room.</p>' +
      '<label>Delay (to line the sound up with the cameras) <input type="range" data-a="delay" min="0" max="' + (a.use === 2 ? 2000 : 1000) + '" step="10" value="' + (a.delay | 0) + '"><output>' + (a.delay | 0) + ' ms</output></label>' +
      '<p class="muted small">Audio system: ' + esc(S.audio.backend || "…") + '. Dante: install Audinate\'s Dante Virtual Soundcard (Windows / Mac, its own licence) or use a Dante card that shows up as a sound card; its channels appear here like any interface.</p><button data-a="rescan">Look for devices again</button></section></div>';
  }
  // the stream mix from an audio host on another computer: the page listens to it (the Mix tab's link) and passes it on
  var mixFwd = { on: false };
  function mixForward(on) {
    var X = window.CUMix; if (!X || on === mixFwd.on) return;
    mixFwd.on = on; X.listen("stream", on);
  }
  if (window.CUMix) window.CUMix.on("audio", function (pcm, frames, ch, rate, tap) {
    if (!mixFwd.on || tap !== 65 || ch !== 2 || rate !== 48000) return;
    V.mixPcm(new Uint8Array(pcm.buffer, pcm.byteOffset, frames * 4));
  });
  function paintMixMeters(m) {
    if (S.view !== "audio") return;
    for (var c = 0; c < 2; c++) { var el = $('[data-mixmeter="' + c + '"]'); if (!el) continue; var v = m.peak[c], db = v > 0 ? 20 * Math.log10(v) : -90; el.style.width = clamp((db + 60) / 60 * 100, 0, 100) + "%"; el.className = db > -3 ? "clip" : db > -12 ? "hot" : ""; }
    var st = $("[data-mixstat]"); if (st) st.textContent = m.receiving ? "● receiving the stream mix" + (m.local ? " (this computer is the audio host)" : " from the audio host") : (window.CUMix && window.CUMix.kind === "none" ? "No sound desk link - turn on the audio host (I/O tab) or enter its admin code." : "Waiting for the stream mix… (is anything in it? Mix tab → Faders: Stream mix)");
  }
  function paintMeters(m) {
    if (S.view !== "audio") return;
    for (var i = 0; i < 2; i++) for (var c = 0; c < 2; c++) { var el = $('[data-meter="' + i + "-" + c + '"]'); if (!el) continue; var v = m.peak[i][c], db = v > 0 ? 20 * Math.log10(v) : -90; el.style.width = clamp((db + 60) / 60 * 100, 0, 100) + "%"; el.className = db > -3 ? "clip" : db > -12 ? "hot" : ""; }
  }

  // ---- Lyrics & slides
  function overlaysHtml() {
    var l = S.cfg.lyrics;
    return '<div class="vd-grid"><section class="card"><h3>Lyrics lower third</h3><p class="muted small">The words come from the Central Pedal as the song moves along. Press LYRICS on Main or Stream to show them. Lines fade from one to the next, and a new section fades out and back in.</p>' +
      '<label>Font <select data-ly="font">' + ["Inter", "Arial", "Helvetica", "Georgia", "Verdana", "Trebuchet MS", "Montserrat", "Open Sans"].map(function (f) { return "<option" + (l.font === f ? " selected" : "") + ">" + f + "</option>"; }).join("") + "</select></label>" +
      '<label>Size <input type="range" data-ly="size" min="2.5" max="10" step="0.25" value="' + l.size + '"><output>' + l.size + '% of the height</output></label>' +
      '<label>Text colour <input type="color" data-ly="color" value="' + esc(l.color) + '"></label>' +
      '<label>Behind the text <select data-ly="box"><option value="bar"' + (l.box === "bar" ? " selected" : "") + '>A band across</option><option value="box"' + (l.box === "box" ? " selected" : "") + '>A box</option><option value="none"' + (l.box === "none" ? " selected" : "") + ">Nothing</option></select></label>" +
      '<div class="row"><label>Box colour <input type="color" data-ly="boxColor" value="' + esc(l.boxColor) + '"></label><label>Opacity <input type="range" data-ly="boxOpacity" min="0" max="1" step="0.05" value="' + l.boxOpacity + '"></label></div>' +
      '<div class="row"><label>Position <select data-ly="position"><option value="bottom"' + (l.position === "bottom" ? " selected" : "") + '>Bottom</option><option value="middle"' + (l.position === "middle" ? " selected" : "") + '>Middle</option><option value="top"' + (l.position === "top" ? " selected" : "") + '>Top</option></select></label><label>Lines <select data-ly="lines">' + [1, 2, 3, 4].map(function (n) { return "<option" + ((l.lines | 0) === n ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="row"><label class="toggle"><input type="checkbox" data-ly="shadow"' + (l.shadow ? " checked" : "") + '> Shadow</label><label class="toggle"><input type="checkbox" data-ly="upper"' + (l.upper ? " checked" : "") + '> CAPITALS</label><label>Fade <input type="number" data-ly="fade" min="0" max="3" step="0.1" value="' + l.fade + '" style="width:64px"> s</label></div>' +
      '<p class="muted small">Now: ' + (S.lyr.lines.length ? esc(S.lyr.lines.join(" / ")) : "no lyrics on the Central Pedal right now") + "</p></section>" +
      '<section class="card"><h3>Slides on the outputs</h3><p class="muted small">Whatever is on the Slides tab can go on Main, the Stream or both (use the Slides menu on each). Show it full screen, or over the camera: that drops the black background, so text slides and name captions sit on top of the picture. Slides is also a tile in the camera grid you can cut to like a camera.</p>' +
      '<label class="toggle"><input type="checkbox" data-mvslides' + (S.cfg.multiview.slides !== false ? " checked" : "") + '> Show Slides on the multiview</label>' +
      '<label>Keying: black below <input type="range" data-ly="keyLo" min="0" max="0.4" step="0.01" value="' + (l.keyLo == null ? 0.04 : l.keyLo) + '"></label><label>fully shown above <input type="range" data-ly="keyHi" min="0.02" max="0.6" step="0.01" value="' + (l.keyHi == null ? 0.16 : l.keyHi) + '"></label></section></div>';
  }

  // ---- Phones
  function phonesHtml() {
    var p = S.phones || {};
    return '<div class="vd-grid"><section class="card"><h3>Phones as cameras</h3><label class="toggle"><input type="checkbox" data-ph="on"' + (p.on ? " checked" : "") + "> Let phones join</label>" +
      (p.error ? '<p class="bad small">' + esc(p.error) + "</p>" : "") +
      '<table class="io-t"><tr><td>Camera code</td><td><b class="io-code">' + esc(p.code || "") + '</b> <button data-ph="newcode">New code</button></td></tr>' +
      "<tr><td>On the phone, open</td><td>" + (p.start || []).map(function (u) { return "<b>" + esc(u) + "</b>"; }).join("<br>") + "</td></tr></table>" +
      '<ol class="small"><li>On the phone (same Wi-Fi) open the address above.</li><li>Once per phone: install the certificate it offers. iPhone / iPad: Settings → <b>Profile Downloaded</b> → Install, then Settings → General → About → <b>Certificate Trust Settings</b> → turn on "Central Control local CA".</li><li>Tap <b>Open the camera page</b>, give it a name and the camera code, Start. It appears here as a camera.</li></ol>' +
      '<p class="muted small">Phones send 720p or 1080p video. Keep the phone plugged in; the page keeps its screen on. The phone shows a red ON AIR light when it\'s live.</p></section>' +
      '<section class="card"><h3>Connected</h3>' + ((p.connected || []).length ? (p.connected || []).map(function (c) { return "<p>● " + esc(c.name) + "</p>"; }).join("") : '<p class="muted">No phones right now.</p>') + "</section></div>";
  }

  /* ================================================================== events */
  function setStatus(id, st) { S.status[id] = Object.assign({}, S.status[id] || {}, st); }
  root.addEventListener("click", async function (e) {
    var b = e.target.closest("button, a"); if (!b) return;
    if (b.dataset.vview) { e.preventDefault(); S.view = b.dataset.vview; CU.store.set("vidView", S.view); if (S.view === "sources") { await listCaptureDevices(); V.ndiFind().then(function (r) { S.ndi = r; if (S.view === "sources") paintView(); }); } if (S.view === "stream" && !S.encoders) V.encoders().then(function (r) { S.encoders = r; if (S.view === "stream") paintView(); }); if (S.view === "audio") V.audio({ cmd: "list" }); if (S.view === "phones") S.phones = await V.phones(null); paintView(); return; }
    if (b.dataset.bus) { S.bus = b.dataset.bus; CU.store.set("vidBus", S.bus); paintControls(); return; }
    if (b.dataset.page) { S.page += Number(b.dataset.page); changed(); return; }
    var act = b.dataset.act, k = b.dataset.k;
    if (act === "cut") return cut(k);
    if (act === "auto") return auto(k);
    if (act === "lyrics") { S.out[k].lyrics = !S.out[k].lyrics; paintControls(); return; }
    if (act === "ftb") { S.out[k].ftb = !S.out[k].ftb; paintControls(); return; }
    if (act === "mainwin") { await mainOpen(!(MW.win && !MW.win.closed)); return; }
    if (act === "golive") { var anyOn = S.cfg.destinations.some(function (d) { return d.on; }); if (!S.cfg.destinations.length) { S.view = "stream"; paintView(); return; } if (anyOn && !confirm("Stop the live stream on every destination?")) return; S.stream = await V.streamAll(!anyOn); S.cfg = await V.config({}); paintStatus(); return; }
    if (act === "rec") { S.stream = await V.record(!(S.stream && S.stream.record && S.stream.record.on)); paintStatus(); return; }
    // sources
    var sa = b.dataset.sa, tr = b.closest("[data-sid]"), sid = tr ? Number(tr.dataset.sid) : null, list = cfgSources().slice();
    if (sa === "remove") { if (!confirm("Remove " + srcName(sid) + "?")) return; captureClose(sid); return saveSources(list.filter(function (s) { return s.id !== sid; })); }
    if (sa === "up" || sa === "down") { var i = list.findIndex(function (s) { return s.id === sid; }), j = i + (sa === "up" ? -1 : 1); if (j < 0 || j >= list.length) return; var t = list[i]; list[i] = list[j]; list[j] = t; return saveSources(list); }
    if (sa === "edit") { var s0 = list.find(function (s) { return s.id === sid; }); var u = await CU.askText("Address:", s0.url || ""); if (u == null) return; var lo = await CU.askText("Small stream for the multiview (optional):", s0.loUrl || ""); s0.url = u.trim(); s0.loUrl = (lo || "").trim(); return saveSources(list); }
    if (sa === "rescan") { await listCaptureDevices(); paintView(); return; }
    if (sa === "addip" || sa === "addtest" || sa === "addfile") {
      if (list.length >= MAX_SOURCES) return alert("Up to " + MAX_SOURCES + " cameras.");
      if (sa === "addtest") list.push({ kind: "test", name: "Test pattern " + (list.filter(function (s) { return s.kind === "test"; }).length + 1), url: "test:testsrc2", mv: true });
      else if (sa === "addfile") { var files = window.CU && window.CU.slides ? await window.CU.slides.open() : null; if (!files || !files.length) return; files.forEach(function (f) { var p = f.path || f; list.push({ kind: "file", name: String(p).split(/[\\/]/).pop(), url: p, mv: true }); }); }
      else { var url = ($('[data-new="url"]') || {}).value.trim(); if (!url) return alert("Type the camera's address."); list.push({ kind: "ip", name: ($('[data-new="name"]') || {}).value.trim() || "Camera " + (list.length + 1), url: url, loUrl: ($('[data-new="loUrl"]') || {}).value.trim(), mv: true }); }
      return saveSources(list);
    }
    if (b.dataset.addndi) { if (list.length >= MAX_SOURCES) return alert("Up to " + MAX_SOURCES + " cameras."); list.push({ kind: "ndi", name: b.dataset.addndi.replace(/^[^(]*\(([^)]*)\).*$/, "$1") || b.dataset.addndi, ndiName: b.dataset.addndi, mv: true }); return saveSources(list); }
    if (b.dataset.addcap) { if (list.length >= MAX_SOURCES) return alert("Up to " + MAX_SOURCES + " cameras."); var dv = S.captureDevices.find(function (d) { return d.id === b.dataset.addcap; }); list.push({ kind: "capture", name: dv ? dv.label : "Capture", deviceId: b.dataset.addcap, mv: true }); return saveSources(list); }
    // stream
    var da = b.dataset.da, drow = b.closest("[data-did]"), dests = S.cfg.destinations.slice();
    if (da === "add") { dests.push({ kind: b.dataset.kind, name: S.init.destKinds[b.dataset.kind].label, url: S.init.destKinds[b.dataset.kind].url, key: "", on: false }); S.cfg = await V.config({ destinations: dests }); paintView(); return; }
    if (da === "remove") { S.cfg = await V.config({ destinations: dests.filter(function (d) { return d.id !== drow.dataset.did; }) }); paintView(); return; }
    if (da === "all-on" || da === "all-off") { S.stream = await V.streamAll(da === "all-on"); S.cfg = await V.config({}); paintView(); return; }
    if (da === "rec") { S.stream = await V.record(!(S.stream && S.stream.record && S.stream.record.on)); paintStatus(); return; }
    if (da === "folder") return V.openRecordings();
    if (b.dataset.a === "rescan") { V.audio({ cmd: "list" }); return; }
    if (b.dataset.ph === "newcode") { S.phones = await V.phones("newcode"); paintView(); return; }
  });
  root.addEventListener("dblclick", function (e) { var hit = mvHit(e); if (hit) take(hit.id); });
  root.addEventListener("pointerdown", function (e) { if (e.button !== 0) return; var hit = mvHit(e); if (hit) setPreview(hit.id); });
  function mvHit(e) { var cv = e.target.closest && e.target.closest(".vd-mv"); if (!cv || !cv._layout) return null; var L = cv._layout, r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * L.W / r.width, y = (e.clientY - r.top) * L.H / r.height, i = Math.floor(y / L.th) * L.g.c + Math.floor(x / L.tw); return L.items[i] || null; }
  document.addEventListener("keydown", function (e) {
    if (!visible() || S.view !== "switch" || e.target.matches("input,select,textarea")) return;
    if (e.key === " ") { e.preventDefault(); cut(); } else if (e.key === "Enter") { e.preventDefault(); auto(); }
    else if (/^[1-9]$/.test(e.key)) { var it = pageItems().items[Number(e.key) - 1]; if (it) setPreview(it.id); }
  });
  root.addEventListener("change", async function (e) {
    var t = e.target, k = t.dataset.k;
    if (t.dataset.act === "slides") { S.out[k].slides = t.value; saveOut(S.out[k]); changed(); return; }
    if (t.dataset.tr) { var tr = Object.assign({}, S.cfg.transition); tr[t.dataset.tr] = t.dataset.tr === "ms" ? clamp(Number(t.value) || 0, 0, 5000) : t.value; S.cfg = await V.config({ transition: tr }); return; }
    if (t.dataset.mv === "grid") { S.page = 0; S.cfg = await V.config({ multiview: { grid: t.value } }); changed(); return; }
    if (t.matches("[data-mvslides]")) { S.cfg = await V.config({ multiview: { slides: t.checked } }); changed(); return; }
    var tr2 = t.closest("[data-sid]");
    if (tr2 && t.dataset.sf) { var list = cfgSources().map(function (s) { if (s.id !== Number(tr2.dataset.sid)) return s; var n = Object.assign({}, s); n[t.dataset.sf] = t.type === "checkbox" ? t.checked : t.value; return n; }); S.cfg = await V.config({ sources: list }); changed(); return; }
    if (t.dataset.ndi === "extra") { V.ndiExtraIps(t.value); return; }
    var drow = t.closest("[data-did]");
    if (drow && t.dataset.df) {
      var dests = S.cfg.destinations.map(function (d) { if (d.id !== drow.dataset.did) return d; var n = Object.assign({}, d); n[t.dataset.df] = t.type === "checkbox" ? t.checked : t.value; if (t.dataset.df === "kind") { n.url = S.init.destKinds[t.value].url; } return n; });
      if (t.dataset.df === "on") { S.stream = await V.dest(drow.dataset.did, t.checked); S.cfg = await V.config({}); paintStatus(); return; }
      S.cfg = await V.config({ destinations: dests }); if (t.dataset.df === "kind") paintView(); return;
    }
    if (t.dataset.sc) { var p = {}; p[t.dataset.sc] = t.dataset.sc === "bitrate" || t.dataset.sc === "audioBitrate" ? Number(t.value) : t.value; if (t.dataset.sc === "preset") p.bitrate = S.init.presets[t.value][3]; S.cfg = await V.config({ stream: p }); if (t.dataset.sc === "preset") { startTicker(); paintView(); } return; }
    if (t.dataset.ndiout) { S.stream = await V.ndiOut(t.dataset.ndiout, t.checked); paintStatus(); return; }
    var asrc = t.closest("[data-asrc]");
    if (t.name === "vdUse") { S.cfg = await V.config({ audio: { use: Number(t.value) } }); paintView(); return; }
    if (asrc && t.dataset.af) { var a = JSON.parse(JSON.stringify(S.cfg.audio)), i = Number(asrc.dataset.asrc); a.sources[i][t.dataset.af] = t.dataset.af === "device" ? t.value : Number(t.value); if (t.dataset.af === "device") { a.sources[i].l = 0; a.sources[i].r = 1; } S.cfg = await V.config({ audio: { sources: a.sources } }); if (t.dataset.af === "device") paintView(); return; }
    if (t.dataset.a === "delay") { S.cfg = await V.config({ audio: { delay: Number(t.value) } }); return; }
    if (t.dataset.ly) { var l = {}; l[t.dataset.ly] = t.type === "checkbox" ? t.checked : t.type === "range" || t.type === "number" || t.dataset.ly === "lines" ? Number(t.value) : t.value; S.cfg = await V.config({ lyrics: l }); lyricsUpdate(true); return; }
    if (t.dataset.ph === "on") { S.phones = await V.phones(t.checked); paintView(); return; }
  });
  root.addEventListener("input", function (e) { var t = e.target; if (t.type === "range") { var o = t.parentNode.querySelector("output"); if (o) o.textContent = t.value + (t.dataset.af === "gain" ? " dB" : t.dataset.a === "delay" ? " ms" : t.dataset.ly === "size" ? "% of the height" : ""); } });

  V.on(function (ev) {
    if (ev.type === "source") { setStatus(ev.id, ev.status); }
    else if (ev.type === "ndi") { S.ndi = { error: ev.error, sources: ev.sources || [] }; if (S.view === "sources") paintView(); }
    else if (ev.type === "stream") { S.stream = ev.status; paintStatus(); }
    else if (ev.type === "audioMeters") { S.audio.meters = ev; paintMeters(ev); }
    else if (ev.type === "mixAudio") mixForward(!!ev.on);
    else if (ev.type === "mixMeters") paintMixMeters(ev);
    else if (ev.type === "audioDevices") { S.audio.devices = ev.devices; S.audio.backend = ev.backend; if (S.view === "audio") paintView(); }
    else if (ev.type === "audioStatus") { S.audio.status = ev.status; if (S.view === "audio") (ev.status.sources || []).forEach(function (s, i) { var el = $('[data-astat="' + i + '"]'); if (el) el.textContent = s.running ? "● running · " + s.channels + " channels" : s.error ? "✕ " + s.error : s.device ? "not running" : ""; }); }
    else if (ev.type === "phones") { S.phones = ev.info; if (S.view === "phones") paintView(); }
    else if (ev.type === "config") { S.cfg = ev.cfg; changed(); if (S.view === "sources") paintView(); }
  });
  // the lyrics from the Central Pedal
  CU.on("message", function (m) {
    if (m.type !== "display") return;
    var ls = m.lyrics || {}, lines = (ls.lines || []).filter(function (x) { return String(x).trim(); });
    S.lyr.lines = lines; S.lyr.section = ls.section || (m.section && m.section.name) || "";
    if (G.gl && S.cfg) lyricsUpdate(false);
  });
  CU.on("tab", function (t) { if (t === "video") { if (!S.ready) start(); else { paintView(); changed(); } } });

  async function start() {
    if (S.starting) return; S.starting = true;
    shell();
    try { S.init = await V.init(); } catch (e) { S.error = "The video service did not start: " + e.message; paintView(); return; }
    S.cfg = S.init.cfg; S.status = S.init.status || {};
    S.screens = await V.screens();
    try { if (!glInit()) { paintView(); return; } } catch (e) { S.error = "The video compositor could not start: " + e.message; paintView(); return; }
    lyricsUpdate(true); mediaConnect(); S.ready = true; startTicker(); paintView(); changed();
    V.status().then(function (st) { S.stream = st; paintStatus(); });
    V.audio(null).then(function (r) { S.audio.devices = r.devices || []; S.audio.backend = r.backend; });
    if (S.view === "sources") { listCaptureDevices().then(paintView); V.ndiFind().then(function (r) { S.ndi = r; }); }
    if (S.view === "phones") S.phones = await V.phones(null);
    if (!S.init.ffmpeg) { S.notice = "ffmpeg is missing from this installation: IP cameras, streaming and recording won't work."; paintStatus(); }
  }
  var start0 = start; start = function () { return start0().catch(function (e) { S.error = "The Video tab could not start: " + (e && e.message || e); console.error("video start", e); paintView(); }); };
  if (visible()) start();
  window.CUVideoTab = { state: S, G: G, seen: seen, cut: cut, auto: auto, take: take, setPreview: setPreview, start: start, mainOpen: mainOpen, outs: outs, tick: tick };
})();
