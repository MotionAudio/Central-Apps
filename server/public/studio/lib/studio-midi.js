/* Central Usage - MIDI in: every keyboard, pad controller, Launchpad or looper plugged into this computer.
 *
 * Written so any tab can use it (the Studio, and the controls / MIDI-learn pages): one place opens Web MIDI and passes
 * each message on with where it came from and when.
 *   CUMidiIn.start()                 -> Promise (asks the browser for MIDI once)
 *   CUMidiIn.inputs() / outputs()    [{ id, name, manufacturer, state, launchpad }]
 *   CUMidiIn.on(fn)                  fn({ device: {id, name}, data: [status, d1, d2], time: performance.now() ms }) - returns an off()
 *   CUMidiIn.onDevices(fn)           fn(inputs) when something is plugged in or out
 *   CUMidiIn.send(outputNameOrId, bytes, time?)
 *   CUMidiIn.launchpad(name)         { programmer(), light(note, colour), lightCC(cc, colour), clear() } for a Novation Launchpad (MK2, Mini MK3, X, Pro MK3)
 *   CUMidiIn.inject(name, data)      a message as if it came from a device (tests, on-screen keyboards)
 */
(function () {
  "use strict";
  var access = null, starting = null, listeners = [], devListeners = [], fake = {};
  function isLaunchpad(name) { return /launchpad/i.test(name || ""); }
  function list(map) { var out = []; if (map) map.forEach(function (p) { out.push({ id: p.id, name: p.name || "MIDI device", manufacturer: p.manufacturer || "", state: p.state, launchpad: isLaunchpad(p.name) }); }); return out; }
  function inputs() { return list(access && access.inputs).concat(Object.keys(fake).map(function (n) { return { id: "fake:" + n, name: n, manufacturer: "", state: "connected", launchpad: isLaunchpad(n), fake: true }; })); }
  function outputs() { return list(access && access.outputs); }
  function emit(dev, data, time) {
    var m = { device: dev, data: data, time: time == null ? performance.now() : time };
    listeners.slice().forEach(function (fn) { try { fn(m); } catch (e) { console.warn("midi listener", e); } });
  }
  function hook() {
    if (!access) return;
    access.inputs.forEach(function (p) {
      if (p.__cuHooked) return; p.__cuHooked = true;
      p.addEventListener("midimessage", function (e) { var d = e.data; if (!d || !d.length || d[0] === 0xFE || d[0] === 0xF8) return; emit({ id: p.id, name: p.name }, Array.prototype.slice.call(d), e.timeStamp || performance.now()); });
    });
  }
  function start() {
    if (access) return Promise.resolve(true);
    if (starting) return starting;
    if (!navigator.requestMIDIAccess) return Promise.resolve(false);
    starting = navigator.requestMIDIAccess({ sysex: true }).catch(function () { return navigator.requestMIDIAccess(); }).then(function (a) {
      access = a; hook();
      a.onstatechange = function () { hook(); var l = inputs(); devListeners.forEach(function (fn) { try { fn(l); } catch (_) { } }); };
      return true;
    }).catch(function () { starting = null; return false; });
    return starting;
  }
  function outFor(nameOrId) {
    if (!access) return null; var hit = null;
    access.outputs.forEach(function (o) { if (!hit && (o.id === nameOrId || o.name === nameOrId)) hit = o; });
    if (!hit) access.outputs.forEach(function (o) { if (!hit && nameOrId && o.name && (o.name.indexOf(nameOrId) >= 0 || nameOrId.indexOf(o.name.replace(/ MIDI.*$/, "")) >= 0)) hit = o; });   // (Windows names in and out ports a little differently)
    return hit;
  }
  function send(nameOrId, bytes, time) { var o = outFor(nameOrId); if (!o) return false; try { o.send(bytes, time); return true; } catch (_) { return false; } }
  // Novation Launchpads: programmer mode makes the 8x8 grid notes 11..88 (row 1 at the bottom) and the right-hand buttons CC 19..89
  function launchpad(name) {
    var model = /pro/i.test(name) ? 0x0E : /mini/i.test(name) ? 0x0D : /\bx\b|launchpad x/i.test(name) ? 0x0C : /mk2/i.test(name) ? 0x18 : 0x0C;
    return {
      programmer: function () { if (model === 0x18) return send(name, [0xF0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x22, 0x00, 0xF7]); return send(name, [0xF0, 0x00, 0x20, 0x29, 0x02, model, 0x0E, 0x01, 0xF7]); },
      light: function (note, colour) { return send(name, [0x90, note, colour | 0]); },
      flash: function (note, colour) { return send(name, [0x91, note, colour | 0]); },
      pulse: function (note, colour) { return send(name, [0x92, note, colour | 0]); },
      lightCC: function (cc, colour) { return send(name, [0xB0, cc, colour | 0]); },
      clear: function () { for (var r = 1; r <= 8; r++) for (var c = 1; c <= 8; c++) send(name, [0x90, r * 10 + c, 0]); for (var k = 19; k <= 89; k += 10) send(name, [0xB0, k, 0]); }
    };
  }
  window.CUMidiIn = {
    start: start, inputs: inputs, outputs: outputs, send: send, launchpad: launchpad, isLaunchpad: isLaunchpad,
    on: function (fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    onDevices: function (fn) { devListeners.push(fn); return function () { var i = devListeners.indexOf(fn); if (i >= 0) devListeners.splice(i, 1); }; },
    inject: function (name, data, time) { emit({ id: "fake:" + name, name: name }, data, time); },
    addFake: function (name) { fake[name] = 1; var l = inputs(); devListeners.forEach(function (fn) { try { fn(l); } catch (_) { } }); },
    removeFake: function (name) { delete fake[name]; var l = inputs(); devListeners.forEach(function (fn) { try { fn(l); } catch (_) { } }); }
  };
})();
