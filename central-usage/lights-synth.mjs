// Synthetic songs for the lighting tests: a slow, quiet pad and drum grooves at a given tempo.
export function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function pad(seconds = 60, rate = 22050) {
  const n = seconds * rate, x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate, sw = 0.55 + 0.45 * Math.sin(2 * Math.PI * t / 9);   // (a slow swell every 9 s)
    x[i] = 0.05 * sw * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) * 0.8 + Math.sin(2 * Math.PI * 329.6 * t) * 0.7 + Math.sin(2 * Math.PI * 110 * t) * 0.5);
  }
  return x;
}
export function drums(seconds = 30, bpm = 128, rate = 22050, seed = 1) {
  const n = seconds * rate, x = new Float32Array(n), r = rng(seed), beat = 60 / bpm;
  const add = (at, fn, len) => { const s0 = Math.round(at * rate); for (let i = 0; i < len * rate && s0 + i < n; i++) x[s0 + i] += fn(i / rate); };
  for (let b = 0; b * beat < seconds; b++) {
    const t = b * beat;
    add(t, (u) => 0.9 * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-u * 30)) * u) * Math.exp(-u * 18), 0.25);   // kick on every beat
    if (b % 2 === 1) add(t, (u) => 0.5 * (r() * 2 - 1) * Math.exp(-u * 22), 0.18);                          // snare on 2 and 4
    add(t, (u) => 0.18 * (r() * 2 - 1) * Math.exp(-u * 90), 0.04);                                          // hi-hat on the 8ths
    add(t + beat / 2, (u) => 0.15 * (r() * 2 - 1) * Math.exp(-u * 90), 0.04);
  }
  for (let i = 0; i < n; i++) { const t = i / rate; x[i] = Math.max(-1, Math.min(1, x[i] + 0.12 * Math.sin(2 * Math.PI * 55 * t))); }
  return x;
}
// a whole song as the overview the Central Pedal sends: quiet intro, verse, a building pre-chorus, a loud chorus,
// a breakdown, a last chorus (levels 0..1 over 480 bins)
export function songOverview(parts) {
  const total = parts.reduce((a, p) => a + p.len, 0), out = [];
  let at = 0; const secs = [];
  for (const p of parts) { secs.push({ name: p.name, start: at, end: at + p.len }); at += p.len; }
  for (let i = 0; i < 480; i++) {
    const t = (i + 0.5) / 480 * total, s = parts[secs.findIndex((q) => t >= q.start && t < q.end)] || parts[parts.length - 1], q = secs[parts.indexOf(s)];
    const f = (t - q.start) / (q.end - q.start), lvl = s.to != null ? s.lvl + (s.to - s.lvl) * f : s.lvl;
    out.push(Math.round(lvl * 1000) / 1000);
  }
  return { duration: total, sections: secs, overview: out };
}
