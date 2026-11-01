/* Central Production - getting what you made out of the app:
 *   Publish: loops, samples, instruments, pads, pedal boards and plugins go to Make & sell (the website's creator uploads:
 *     reviewed by Motion Audio, then in the sound plan's pack, and you're paid from the pack's share by downloads x
 *     stars); a track goes to Central Tracks (stems + mix; the price comes from its grade).
 *   Install into my apps: a small library of your own (plan "free", personal) that Central Control, Central Usage and
 *     this app install from (on the website: a file to install with Settings → Packages → Libraries → Install from a file).
 */
(function () {
  "use strict";
  var H = window.CPHost, Z = window.CMProj, A = window.CPAudio;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return window.CP.esc(s); }
  var PACKS = { loop: [["pads", "Central Pads"]], pad: [["pads", "Central Pads"]], sample: [["keys", "Central Keys"], ["instrument", "Central Instrument"]], instrument: [["keys", "Central Keys"], ["instrument", "Central Instrument"]], board: [["pedals", "Central Pedals"]], plugin: [["plugins", "Central Plugins"]] };
  var KIND_NAME = { loop: "Loops", pad: "Pad", sample: "Samples", instrument: "Instrument", board: "Pedal board", plugin: "Plugin" };
  function sha256(bytes) { return crypto.subtle.digest("SHA-256", bytes).then(function (h) { return Array.from(new Uint8Array(h)).map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }); }

  // ------------------------------------------------------------- Publish
  function open() {
    var p = window.CP.project(), mod = window.CP.mod(); if (!p || !mod) return;
    var pub = mod.publish || {};
    if (!H.server() && H.kind === "desktop") return window.CP.toast("Set the Motion Audio website's address first: Settings → Website address.", "bad");
    if (!H.account.token()) return window.CP.signIn("Sign in to publish “" + p.name + "”. Your uploads and earnings are on the website's Make & sell page.").then(function (ok) { if (ok) open(); });
    if (pub.store === "tracks") return openTracks(p, mod);
    var packs = PACKS[pub.kind] || [];
    var d = window.CP.modal('<h2>Publish to Make &amp; sell</h2><p class="muted">“' + esc(p.name) + "” goes up as <b>" + esc(KIND_NAME[pub.kind]) + "</b>. Motion Audio listens to it (and tests plugins) before it goes live. Once it's approved, everyone with the sound plan can use it, and you're paid from the plan's share by how often it's downloaded and the stars the reviewer gives it.</p>" +
      '<form class="cp-form" id="pbForm"><label>Name<input id="pbName" maxlength="80" value="' + esc(p.name) + '"></label>' +
      (packs.length > 1 ? '<label>Sound plan<select id="pbPack">' + packs.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + "</option>"; }).join("") + "</select></label>" : '<p class="muted small">Goes in ' + esc((packs[0] || [])[1] || "") + ".</p>") +
      '<label>About it <span class="muted small">(what it is, what it\'s good for)</span><textarea id="pbDesc" rows="3" maxlength="1000"></textarea></label><label>Tags <span class="muted small">(commas)</span><input id="pbTags" placeholder="worship, warm, ambient"></label>' +
      '<label class="check"><input type="checkbox" id="pbRights"> I made this, or I have the rights to share and sell everything in it.</label>' +
      '<div class="cp-progress" id="pbProg" hidden><i></i></div><p class="muted small" id="pbState"></p><div class="err" id="pbErr"></div>' +
      '<div class="cp-row end"><button type="button" data-close>Cancel</button><button class="primary" id="pbSend">Publish for review</button></div></form>', { sticky: true });
    $("#pbForm", d).onsubmit = function (e) {
      e.preventDefault();
      var err = $("#pbErr", d), st = $("#pbState", d), prog = $("#pbProg", d), btn = $("#pbSend", d); err.textContent = "";
      if (!$("#pbRights", d).checked) { err.textContent = "Tick the box to confirm you made it, or have the rights to it."; return; }
      btn.disabled = true; prog.hidden = false;
      function step(f, text) { prog.firstChild.style.width = Math.round(f * 100) + "%"; st.textContent = text; }
      step(0.02, "Getting it ready…");
      Promise.resolve().then(function () { return pub.build(); }).then(function (b) {
        var files = [], meta = { kind: pub.kind, pack: packs.length > 1 ? $("#pbPack", d).value : packs[0] && packs[0][0], title: $("#pbName", d).value.trim() || p.name, description: $("#pbDesc", d).value.trim(), tags: $("#pbTags", d).value, rights: true, studio: true };
        if (b.loops) { b.loops.forEach(function (l, i) { files.push({ role: "source", name: Z.slug(l.name, "loop") + ".wav", blob: A.wavBlob(l.buf, 24) }); }); meta.bpm = b.bpm; meta.key = b.key; meta.bars = b.bars; }
        if (b.zip) files.push({ role: "source", name: b.zipName, blob: new Blob([b.zip], { type: "application/zip" }) });
        if (b.board) files.push({ role: "source", name: b.board.name, blob: new Blob([b.board.data], { type: "application/json" }) });
        if (b.fx) files.push({ role: "source", platform: "any", name: b.fx.name, blob: new Blob([b.fx.data], { type: "application/json" }) });
        if (b.demo) files.push({ role: "demo", name: Z.slug(meta.title, "demo") + "-demo.wav", blob: A.wavBlob(A.demo(b.demo, 30), 16) });
        return send(meta, files, step);
      }).then(function (item) {
        step(1, ""); d.close();
        var dd = window.CP.modal('<h2>Sent for review</h2><p>“' + esc(item.title || p.name) + "” is waiting for Motion Audio to listen to it. You'll get an email when it's approved (or if something needs changing).</p><p class=\"muted\">Your uploads, their stars and your earnings are on the website's Make &amp; sell page.</p><div class=\"cp-row end\"><button id=\"pbSite\">Open Make &amp; sell</button><button class=\"primary\" data-close>Done</button></div>");
        $("#pbSite", dd).onclick = function () { H.openExternal(H.server() + "/create/"); };
      }).catch(function (e2) { btn.disabled = false; prog.hidden = true; st.textContent = ""; err.textContent = e2.message || String(e2); });
    };
  }
  function send(meta, files, step) {
    return H.api("POST", "/creator/items", meta).then(function (r) {
      var id = r.item.id, total = files.reduce(function (a, f) { return a + (f.blob.size || 1); }, 0), done = 0, first = true;
      return files.reduce(function (pr, f) {
        return pr.then(function () {
          step(0.05 + 0.85 * done / total, "Uploading " + f.name + "…");
          return H.api("POST", "/creator/items/" + id + "/upload", { role: f.role, platform: f.platform, name: f.name, size: f.blob.size, type: f.blob.type, replace: f.role === "source" && first ? (first = false, true) : false })
            .then(function (u) { return f.blob.arrayBuffer().then(function (ab) { return H.put(u.url, new Uint8Array(ab), f.blob.type); }); })
            .then(function () { done += f.blob.size || 1; });
        });
      }, Promise.resolve()).then(function () { step(0.95, "Checking it…"); return H.api("POST", "/creator/items/" + id + "/submit", {}); }).then(function (s) { return s.item; });
    });
  }
  // a track: the mix and the stems to Central Tracks (POST /uploads for each, then /publish)
  function openTracks(p, mod) {
    var d = window.CP.modal('<h2>Publish to Central Tracks</h2><p class="muted">The mix and every stem go up to Central Tracks. The website grades the mix (1 to 5 stars) and the stars set the price. Churches buy it or add it with Central Tracks Unlimited, and you\'re paid for each.</p>' +
      '<form class="cp-form" id="ptForm"><label>Song title<input id="ptTitle" maxlength="140" value="' + esc((p.data && p.data.title) || p.name) + '"></label><label>Artist<input id="ptArtist" maxlength="140" value="' + esc((p.data && p.data.artist) || "") + '"></label>' +
      '<label class="check"><input type="checkbox" id="ptRights"> I own this recording, or have the rights to sell it (the song too, if it isn\'t in the public domain).</label>' +
      '<div class="cp-progress" id="ptProg" hidden><i></i></div><p class="muted small" id="ptState"></p><div class="err" id="ptErr"></div><div class="cp-row end"><button type="button" data-close>Cancel</button><button class="primary" id="ptSend">Publish</button></div></form>', { sticky: true });
    $("#ptForm", d).onsubmit = function (e) {
      e.preventDefault();
      var err = $("#ptErr", d), st = $("#ptState", d), prog = $("#ptProg", d), btn = $("#ptSend", d); err.textContent = "";
      var title = $("#ptTitle", d).value.trim(), artist = $("#ptArtist", d).value.trim();
      if (!title || !artist) { err.textContent = "Add the song title and the artist."; return; }
      if (!$("#ptRights", d).checked) { err.textContent = "Tick the box to confirm you have the rights to sell it."; return; }
      btn.disabled = true; prog.hidden = false;
      function step(f, t) { prog.firstChild.style.width = Math.round(f * 100) + "%"; st.textContent = t; }
      step(0.02, "Rendering the mix and the stems…");
      mod.publish.build().then(function (pk) {
        var ups = pk.files.filter(function (f) { return f.mix || f.stem; }), total = ups.length, done = 0, mix = null, stems = [];
        return ups.reduce(function (pr, f) {
          return pr.then(function () {
            step(0.1 + 0.8 * done / total, "Uploading " + f.name + "…");
            return H.api("POST", "/uploads", { name: f.name, size: f.data.length, type: "audio/wav" }).then(function (u) { return H.put(u.url, f.data, "audio/wav").then(function () { if (f.mix) mix = { key: u.key, name: f.name }; else stems.push({ key: u.key, name: f.stem.name, role: f.stem.role }); done++; }); });
          });
        }, Promise.resolve()).then(function () {
          step(0.93, "Grading the mix…");
          return H.api("POST", "/publish", { title: title, artist: artist, kind: "Multitrack", key: pk.song.key, bpm: pk.song.bpm, mix: mix, stems: stems, rights: true });
        });
      }).then(function (r) {
        d.close();
        var t = r.track || {}, g = r.grade || {};
        window.CP.modal("<h2>" + (r.waiting ? "Sent for review" : "Published") + "</h2><p>“" + esc(t.title || title) + "” " + (r.waiting ? "is waiting for Motion Audio to listen to it." : "is in Central Tracks") + (g.stars ? " with " + g.stars + " star" + (g.stars > 1 ? "s" : "") + (t.price ? " (" + esc(t.price) + ")" : "") : "") + '.</p><div class="cp-row end"><button class="primary" data-close>Done</button></div>');
      }).catch(function (e2) { btn.disabled = false; prog.hidden = true; st.textContent = ""; err.textContent = e2.message || String(e2); });
    };
  }

  // ------------------------------------------------------------- Install into my apps
  function install() {
    var p = window.CP.project(), mod = window.CP.mod(); if (!p || !mod || !mod.install) return;
    window.CP.busy("Getting it ready for your apps…");
    Promise.resolve().then(function () { return mod.install(); }).then(function (r) {
      if (r.song) return installSong(p, r.song);
      return libraryOf(p, r).then(function (lib) {
        if (H.kind === "desktop" && H.desktop.installPersonal) {
          return H.desktop.installPersonal(lib.zip, lib.id + ".zip").then(function (res) {
            window.CP.busy();
            if (!res || !res.ok) throw new Error((res && res.error) || "It couldn't be installed.");
            window.CP.modal('<h2>Installed</h2><p>“' + esc(p.name) + "” is in " + esc(res.apps.join(", ")) + " on this computer, as one of your own sounds (it needs no plan).</p>" +
              (res.saved ? '<p class="muted">For a Central Pedal: on the pedal, Settings → Packages → Libraries → Install from a file, with <b>' + esc(res.saved) + "</b>.</p>" : "") + '<div class="cp-row end"><button class="primary" data-close>Done</button></div>');
          });
        }
        window.CP.busy(); Z.download(lib.id + ".zip", lib.zip, "application/zip");
        window.CP.modal("<h2>Ready for your apps</h2><p>We saved <b>" + esc(lib.id) + ".zip</b> to your downloads. In Central Control, Central Usage or on the Central Pedal: Settings → Packages → Libraries → Install from a file, and pick it. It's yours: it needs no plan.</p><p class=\"muted\">The Central Production app on a computer puts it straight into your apps.</p><div class=\"cp-row end\"><button class=\"primary\" data-close>OK</button></div>");
      });
    }).catch(function (e) { window.CP.busy(); window.CP.toast(e.message || String(e), "bad"); });
  }
  // a personal library: manifest.json (plan "free", personal) + the items, each with its sha256
  function libraryOf(p, r) {
    var id = ("my-" + Z.slug(p.name, "item")).slice(0, 48) + "-" + String(p.id).slice(-6).toLowerCase().replace(/[^a-z0-9]/g, "x"), items = [], files = [];
    function addFile(kind, file, data, more) { files.push({ name: file, data: data }); items.push(Object.assign({ kind: kind, file: file, license: "Yours", name: p.name }, more || {})); }
    if (r.sf2) addFile("sound", "sounds/" + Z.slug(p.name, "sound").replace(/-/g, " ") + " - " + id + ".sf2", r.sf2);
    if (r.pads) r.pads.forEach(function (f) { addFile("pad", "pads/" + f.key.replace("#", "s") + ".wav", f.data, { key: f.key }); });
    if (r.loops) r.loops.forEach(function (l, i) { addFile("loop", "loops/" + String(i + 1).padStart(2, "0") + "-" + Z.slug(l.name, "loop") + ".wav", new Uint8Array(Z.wav(l.buf, 24)), { name: l.name, set: Z.slug(p.name, "loops"), group: "My loops", bpm: r.bpm, key: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"].indexOf(String(r.key).replace(/m$/, ""))] || undefined, bars: r.bars, seconds: Math.round(l.buf.duration * 100) / 100 }); });
    if (r.board) addFile("board", "boards/board.json", r.board.data);
    if (r.fx) addFile("fx", "fx/" + r.fx.name, r.fx.data, { format: "central-fx" });
    if (!items.length) return Promise.reject(new Error("There's nothing to install yet."));
    return Promise.all(files.map(function (f) { return sha256(f.data); })).then(function (sums) {
      items.forEach(function (it, i) { it.sha256 = sums[i]; });
      var man = { format: 1, id: id, plan: "free", personal: true, version: "1." + Math.floor(Date.now() / 1000), title: p.name, summary: "Made in Central Production", items: items };
      return { id: id, zip: Z.zip([{ name: "manifest.json", data: JSON.stringify(man, null, 1) }].concat(files)) };
    });
  }
  // a track: a Central Tracks song (stems + click + mix + song.json) saved as a zip
  function installSong(p, pk) {
    var zip = Z.zip(pk.files.map(function (f) { return { name: f.name, data: f.data }; })), name = Z.slug(pk.title, "song") + "-central-tracks.zip";
    var how = "In Central Pedal Control: + Add songs → Import, and pick it (the stems, sections, lyrics and chords come in together).";
    if (H.kind === "desktop" && H.desktop.saveSong) return H.desktop.saveSong(name, zip).then(function (where) { window.CP.busy(); window.CP.modal("<h2>Saved for your apps</h2><p>The song is in <b>" + esc(where) + "</b>.</p><p>" + esc(how) + '</p><div class="cp-row end"><button class="primary" data-close>OK</button></div>'); });
    window.CP.busy(); Z.download(name, zip, "application/zip");
    window.CP.modal("<h2>Saved for your apps</h2><p>We saved <b>" + esc(name) + "</b> to your downloads.</p><p>" + esc(how) + '</p><div class="cp-row end"><button class="primary" data-close>OK</button></div>');
    return null;
  }
  window.CPPublish = { open: open, install: install, libraryOf: libraryOf, send: send };
})();
