// A tiny SoundFont for the tests (test-studio-native.mjs, test-studio.mjs): "Test Sine" (bank 0, program 0) - a looped
// sine at middle C - and "Test Kit" (bank 128, program 0) - a short noise burst on note 36 and a click on 38.
// makeSf2() returns the file's bytes (a Uint8Array); node make-test-sf2.mjs <file> writes it.
import fs from "node:fs";

export function makeSf2() {
  const rate = 22050;
  const sine = new Int16Array(2205);   // 0.1 s, a whole number of cycles of 261.63 Hz is close enough with a loop over the body
  for (let i = 0; i < sine.length; i++) sine[i] = Math.round(16000 * Math.sin(2 * Math.PI * 261.6256 * i / rate));
  const kick = new Int16Array(4410); let seed = 7;
  for (let i = 0; i < kick.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; kick[i] = Math.round(20000 * Math.exp(-i / 600) * Math.sin(2 * Math.PI * 60 * i / rate) + 3000 * Math.exp(-i / 200) * ((seed / 0x7fffffff) * 2 - 1)); }
  const snare = new Int16Array(2205);
  for (let i = 0; i < snare.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; snare[i] = Math.round(14000 * Math.exp(-i / 400) * ((seed / 0x7fffffff) * 2 - 1)); }
  const samples = [{ name: "sine", data: sine, root: 60, loop: [200, sine.length - 5] }, { name: "kick", data: kick, root: 36 }, { name: "snare", data: snare, root: 38 }];
  // sdta: every sample followed by 46 zero samples
  const parts = []; let pos = 0; const starts = [];
  for (const s of samples) { starts.push(pos); parts.push(s.data, new Int16Array(46)); pos += s.data.length + 46; }
  const smpl = new Int16Array(pos); let o = 0; for (const p of parts) { smpl.set(p, o); o += p.length; }

  const enc = new TextEncoder();
  const chunk = (id, body) => { const b = new Uint8Array(8 + body.length + (body.length & 1)); b.set(enc.encode(id), 0); new DataView(b.buffer).setUint32(4, body.length, true); b.set(body, 8); return b; };
  const list = (type, chunks) => { const inner = cat([enc.encode(type), ...chunks]); return chunk("LIST", inner); };
  const cat = (arr) => { const n = arr.reduce((a, b) => a + b.length, 0), out = new Uint8Array(n); let k = 0; for (const a of arr) { out.set(a, k); k += a.length; } return out; };
  const rec = (size, fill, count) => { const b = new Uint8Array(size * count), v = new DataView(b.buffer); for (let i = 0; i < count; i++) fill(v, i * size, i); return b; };
  const name20 = (v, off, s) => { for (let i = 0; i < 20; i++) v.setUint8(off + i, i < s.length ? s.charCodeAt(i) : 0); };

  // instruments: 0 "Sine" (one zone: sample 0, looped), 1 "Kit" (two zones: kick on 36, snare on 38)
  const igens = [];   // [oper, amountLo, amountHi | amount16]
  const ibagStarts = [];
  ibagStarts.push(igens.length); igens.push([43, 0, 127], [54, 1], [53, 0]);
  ibagStarts.push(igens.length); igens.push([43, 36, 36], [53, 1]);
  ibagStarts.push(igens.length); igens.push([43, 38, 38], [53, 2]);
  const instBags = [0, 1, 3];   // instrument i's first bag
  const pgens = [[41, 0], [41, 1]]; const pbagStarts = [0, 1];
  const presets = [{ name: "Test Sine", preset: 0, bank: 0, bag: 0 }, { name: "Test Kit", preset: 0, bank: 128, bag: 1 }];

  const gen = (list) => rec(4, (v, off, i) => { const g = list[i]; if (!g) { v.setUint16(off, 0, true); v.setUint16(off + 2, 0, true); return; } v.setUint16(off, g[0], true); if (g.length === 3) { v.setUint8(off + 2, g[1]); v.setUint8(off + 3, g[2]); } else v.setUint16(off + 2, g[1], true); }, list.length + 1);
  const bag = (starts, total) => rec(4, (v, off, i) => { v.setUint16(off, i < starts.length ? starts[i] : total, true); v.setUint16(off + 2, 0, true); }, starts.length + 1);
  const phdr = rec(38, (v, off, i) => { const p = presets[i]; if (!p) { name20(v, off, "EOP"); v.setUint16(off + 24, pbagStarts.length, true); return; } name20(v, off, p.name); v.setUint16(off + 20, p.preset, true); v.setUint16(off + 22, p.bank, true); v.setUint16(off + 24, p.bag, true); }, presets.length + 1);
  const inst = rec(22, (v, off, i) => { if (i >= 2) { name20(v, off, "EOI"); v.setUint16(off + 20, ibagStarts.length, true); return; } name20(v, off, i ? "Kit" : "Sine"); v.setUint16(off + 20, instBags[i], true); }, 3);
  const shdr = rec(46, (v, off, i) => {
    const s = samples[i]; if (!s) { name20(v, off, "EOS"); return; }
    name20(v, off, s.name); const st = starts[i];
    v.setUint32(off + 20, st, true); v.setUint32(off + 24, st + s.data.length, true);
    v.setUint32(off + 28, st + (s.loop ? s.loop[0] : 0), true); v.setUint32(off + 32, st + (s.loop ? s.loop[1] : s.data.length - 1), true);
    v.setUint32(off + 36, rate, true); v.setUint8(off + 40, s.root); v.setInt8(off + 41, 0); v.setUint16(off + 42, 0, true); v.setUint16(off + 44, 1, true);
  }, samples.length + 1);
  const info = list("INFO", [chunk("ifil", new Uint8Array([2, 0, 1, 0])), chunk("isng", enc.encode("EMU8000\0")), chunk("INAM", enc.encode("Central test bank\0"))]);
  const sdta = list("sdta", [chunk("smpl", new Uint8Array(smpl.buffer))]);
  const pdta = list("pdta", [chunk("phdr", phdr), chunk("pbag", bag(pbagStarts, pgens.length)), chunk("pmod", new Uint8Array(10)), chunk("pgen", gen(pgens)),
    chunk("inst", inst), chunk("ibag", bag(ibagStarts, igens.length)), chunk("imod", new Uint8Array(10)), chunk("igen", gen(igens)), chunk("shdr", shdr)]);
  const body = cat([enc.encode("sfbk"), info, sdta, pdta]);
  return chunk("RIFF", body);
}

if (process.argv[1] && process.argv[1].endsWith("make-test-sf2.mjs") && process.argv[2]) fs.writeFileSync(process.argv[2], makeSf2());
