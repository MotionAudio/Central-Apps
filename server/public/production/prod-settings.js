/* Central Production - Settings: your sound plan packages (the same package key as the other apps: it opens the better
 * sounds, effects and pedals here) and, in the app, the sound libraries to download; the Motion Audio website's address
 * (the app); Audio (devices, sample rate, buffer, input channels, lining up recordings: the DAW's panel); MIDI devices;
 * updates (the app). */
(function () {
  "use strict";
  var H = window.CPHost;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return window.CP.esc(s); }
  var tab = "packages";
  function open(which) {
    tab = which || tab;
    var d = window.CP.modal('<div class="cp-set"><nav class="cp-set-nav"><button data-st="packages">Sound plans</button>' + (H.kind === "desktop" ? '<button data-st="website">Website</button><button data-st="updates">Updates</button>' : "") + '<button data-st="audio">Audio</button><button data-st="midi">MIDI &amp; sound</button><button data-st="about">About</button></nav><div class="cp-set-body" id="setBody"></div></div><div class="cp-row end"><button class="primary" data-close>Done</button></div>', { wide: true });
    d.querySelector(".cp-set-nav").onclick = function (e) { var b = e.target.closest("[data-st]"); if (b) { tab = b.dataset.st; draw(d); } };
    draw(d);
  }
  function draw(d) {
    Array.prototype.forEach.call(d.querySelectorAll("[data-st]"), function (b) { b.classList.toggle("on", b.dataset.st === tab); });
    var body = $("#setBody", d), L = window.PPLicense;
    if (tab === "packages") {
      body.innerHTML = '<p class="muted">Central Production is free. Your sound plan\'s package key (it starts with S) opens the better instruments, pads, effects and pedals here too. It\'s the same key as in your other apps, and works on ' + "3 of your devices at a time, each a different app.</p>" + (L && L.packagesHtml ? L.packagesHtml("cp-pk") : "") +
        (H.kind === "web" ? '<p class="muted small">The sound libraries (the plans\' pianos, strings, pads…) download in the Central Production app on a computer. Here in the browser you have the built-in sounds, plus any SoundFont you bring in: Sound tab → Add a bank.</p>' : "");
      if (window.PPLibraries && window.PPLibraries.load) try { window.PPLibraries.load(); } catch (_) { }
    } else if (tab === "website") {
      body.innerHTML = '<h3>The Motion Audio website</h3><p class="muted">Signing in, saving to your account, publishing and package keys go through it.</p><form id="wsForm" class="cp-form"><label>Address<input id="wsUrl" placeholder="https://motionaudio.org" value="' + esc(H.server()) + '"></label><div class="cp-row"><button class="primary">Save</button><span class="muted small" id="wsState"></span></div></form>';
      $("#wsForm", d).onsubmit = function (e) {
        e.preventDefault(); var v = $("#wsUrl", d).value.trim().replace(/\/+$/, "");
        if (v && !/^https?:\/\/[^\s/]+/.test(v)) { $("#wsState", d).textContent = "That doesn't look like a web address."; return; }
        H.desktop.setServer(v).then(function () { $("#wsState", d).textContent = "Saved. Restarting the page…"; setTimeout(function () { location.reload(); }, 600); });
      };
    } else if (tab === "updates") {
      body.innerHTML = '<h3>Updates</h3><p id="upState" class="muted">Looking…</p><div class="cp-row"><button id="upCheck">Check now</button><button id="upInstall" class="primary" hidden>Install the update</button></div><label class="check"><input type="checkbox" id="upAuto"> Look for updates when the app opens (and install them after a short notice)</label>';
      var U = H.desktop.updates;
      function show(st) { if (!st) return; $("#upState", d).textContent = st.error ? st.error : st.busy ? (st.phaseText || "Installing…") : st.available ? "Central Production " + st.latest + " is ready to install (you have " + st.current + ")." : "Central Production is up to date (" + (st.current || "") + ")."; $("#upInstall", d).hidden = !st.available || st.busy; $("#upAuto", d).checked = !!st.auto; }
      U.status().then(show); U.on(show);
      $("#upCheck", d).onclick = function () { $("#upState", d).textContent = "Looking…"; U.check().then(show); };
      $("#upInstall", d).onclick = function () { U.install().then(function (r) { if (r && !r.ok) $("#upState", d).textContent = r.error; }); };
      $("#upAuto", d).onchange = function () { U.config({ auto: this.checked }).then(show); };
    } else if (tab === "audio") {
      body.innerHTML = '<h3>Audio</h3><div id="auPanel"></div>';
      if (window.CDawUI && window.CDawUI.audioPanel) window.CDawUI.audioPanel($("#auPanel", d));
    } else if (tab === "midi") {
      body.innerHTML = '<h3>MIDI keyboards and pads</h3><div id="miList" class="muted">Looking…</div><p class="muted small">Any keyboard plugged in plays the selected track on the timeline, and plays the sampler in an Instrument project. Set which device plays which track in the timeline\'s MIDI devices tab.</p>' +
        "<h3>Sound</h3><p class=\"muted\">" + (H.kind === "desktop" ? "What you play goes through the low-delay player when it's installed (about 3 ms), and the rest plays through this computer's sound output." : "In the browser there's a little more delay when you play live. The app on a computer plays with almost none.") + "</p>";
      if (window.CUMidiIn) window.CUMidiIn.start().then(function () { var ins = window.CUMidiIn.inputs(); $("#miList", d).innerHTML = ins.length ? "<ul>" + ins.map(function (i) { return "<li>" + esc(i.name) + "</li>"; }).join("") + "</ul>" : "No MIDI devices plugged in."; }).catch(function () { $("#miList", d).textContent = "MIDI isn't available here."; });
    } else {
      var v = H.desktop && H.desktop.version ? H.desktop.version() : (window.CP_VERSION || "");
      body.innerHTML = "<h3>Central Production " + esc(v) + "</h3><p>Make tracks, loops, samples, pads, instruments, plugins and pedal boards for your church's apps, or for other churches through Make &amp; sell.</p>" +
        '<p class="muted small">MP3 export uses LAME (LGPL, lame.sourceforge.net), as a separate file. The timeline is the Studio from Central Usage.</p>';
    }
  }
  window.CPSettings = { open: open };
})();
