#!/usr/bin/env python3
"""Central Control - tests for the native instrument host against a real PipeWire.

Needs a running PipeWire (XDG_RUNTIME_DIR set) with a 4-channel sink named
"padpedal_out" and a 2-channel source whose name starts with "alsa_input" (the
Pi has them; on a PC create them with pw-cli create-node adapter ... null sinks).
LADSPA pedals (CAPS / TAP) are used so the test also runs where PipeWire has no
LV2 loader; on the Pi every pedal in the catalogue is LV2 or LADSPA.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import instrument_host  # noqa: E402

passed = failed = 0


def check(label, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print("  ✓ " + label)
    except Exception as error:  # noqa: BLE001
        failed += 1
        print("  ✗ " + label + "\n      " + str(error).replace("\n", "\n      ")[:600])


class Driver:
    midi = None

    def __init__(self):
        self.events = []

    def emit(self, m):
        self.events.append(m)


def pw_dump(env):
    return json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True, env=env).stdout or "[]")


def links(env):
    out = []
    objs = pw_dump(env)
    ports = {o["id"]: o for o in objs if o["type"] == "PipeWire:Interface:Port"}
    nodes = {o["id"]: o for o in objs if o["type"] == "PipeWire:Interface:Node"}
    for o in objs:
        if o["type"] != "PipeWire:Interface:Link":
            continue
        a, b = ports.get(o["info"]["output-port-id"]), ports.get(o["info"]["input-port-id"])
        if not a or not b:
            continue
        na, nb = nodes.get(a["info"]["props"].get("node.id")), nodes.get(b["info"]["props"].get("node.id"))
        out.append("%s:%s -> %s:%s" % (na["info"]["props"].get("node.name") if na else "?", a["info"]["props"].get("port.name"), nb["info"]["props"].get("node.name") if nb else "?", b["info"]["props"].get("port.name")))
    return out


def main():
    if not shutil.which("pw-cli") or not shutil.which("pw-dump"):
        print("SKIP: PipeWire tools not installed")
        return 0
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", "/run/user/%d" % os.getuid())
    if subprocess.run(["pw-cli", "info", "0"], capture_output=True, env=env).returncode != 0:
        print("SKIP: PipeWire is not running (XDG_RUNTIME_DIR=%s)" % env["XDG_RUNTIME_DIR"])
        return 0
    os.environ["XDG_RUNTIME_DIR"] = env["XDG_RUNTIME_DIR"]
    data = tempfile.mkdtemp(prefix="pp-inst-")
    drv = Driver()
    host = instrument_host.InstrumentHost(drv, data, HERE)
    plugins = host.plugins
    ladspa = [u for u, v in plugins.items() if v.get("ladspa") and v.get("ain") == 1 and v.get("aout") == 1]
    stereo_ladspa = [u for u, v in plugins.items() if v.get("ladspa") and v.get("ain") == 2 and v.get("aout") == 2]
    print("instrument host: %d plugins known, %d mono LADSPA, %d stereo LADSPA usable here" % (len(plugins), len(ladspa), len(stereo_ladspa)))

    def pedal(uri, uid, on=True, values=None):
        return {"uid": uid, "id": uid, "uri": uri, "on": on, "values": values or {}}

    sat = [u for u in ladspa if "Saturate" in u] or ladspa[:1]
    comp = [u for u in ladspa if "Compress" in u] or ladspa[1:2]
    echo = [u for u in stereo_ladspa if "echo" in u.lower()] or stereo_ladspa[:1]
    chain = [pedal(comp[0], "c1"), pedal(sat[0], "s1", values={"gain": 0.4}), pedal(echo[0], "e1", on=False)] if comp and sat and echo else [pedal(u, "p%d" % i) for i, u in enumerate(ladspa[:3])]

    print("\nGuitar chain:")
    host.config = {"kind": "electric", "input": {"device": "auto", "channel": "L", "gainDb": 6, "gateOn": True, "gateDb": -60}, "chain": chain, "keys": {}, "levelDb": -3, "routing": {"mode": "mono4", "buses": {"instrument": {"ch": 4}}}}

    def t_apply():
        host._apply_safe()
        st = host.status()
        assert st["running"] and not st["error"], "status: %s" % st.get("error")
        assert "guitar-in" in host.node_ids and "guitar-out" in host.node_ids, host.node_ids
    check("a chain of LADSPA pedals starts as its own PipeWire client (input gain, gate, pedals, bypass mixers, level)", t_apply)

    def t_links():
        ls = links(env)
        assert any(l.startswith("alsa_input") and "padpedal-guitar-in" in l for l in ls), "input not linked: %s" % ls
        assert any("padpedal-guitar-out" in l and l.endswith("padpedal_out:playback_RR") for l in ls), "output not on channel 4 (RR): %s" % ls
        assert not any("padpedal-guitar-out" in l and "playback_FL" in l for l in ls), "chain leaked onto channel 1"
    check("the input comes from the USB interface's input 1 and the output goes to channel 4 only", t_links)

    def t_set():
        host.set_control("s1", "gain", 0.9)
        assert host.config["chain"][1]["values"]["gain"] == 0.9
        host.bypass("e1", True)
        assert host.config["chain"][2]["on"] is True
        host.config["levelDb"] = -12
        host.apply_level()
        host.config["input"]["gainDb"] = 12
        host.apply_input_gain()
        assert host.procs["guitar"].poll() is None, "chain process died after live changes"
    check("knob, bypass, level and input gain change live (no restart)", t_set)

    def params_of(name):
        objs = json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True, env=env).stdout)
        for o in objs:
            if o.get("type") == "PipeWire:Interface:Node" and o["info"]["props"].get("node.name") == name:
                for prm in (o["info"].get("params") or {}).get("Props", []):
                    if "params" in prm:
                        pl = prm["params"]
                        return {pl[i]: pl[i + 1] for i in range(0, len(pl) - 1, 2)}
        return {}

    def t_mix():
        host.pedal_mix("s1", mix=0.25, level_db=-6)
        it = host.config["chain"][1]
        assert abs(it["mix"] - 0.25) < 1e-6 and it["levelDb"] == -6, it
        wet, dry = instrument_host.mix_gains(True, 0.25, -6)
        assert abs(wet - 0.25 * 0.5012) < 0.01 and abs(dry - 0.75 * 0.5012) < 0.01, (wet, dry)
        assert instrument_host.mix_gains(False, 0.25, -6) == (0.0, 1.0)
        time.sleep(0.3)
        pr = params_of("padpedal-guitar-in")
        if pr:  # newer PipeWire reports the mixer gains: wet / dry must be what we set
            assert abs(float(pr.get("ms1:Gain 1", wet)) - wet) < 0.01, pr
        host.handle({"action": "scene", "pedals": [{"uid": "c1", "on": False}, {"uid": "s1", "on": True, "mix": 1, "levelDb": 0}]}, lambda m: None)
        assert host.config["chain"][0]["on"] is False and host.config["chain"][1]["mix"] == 1
        assert host.procs["guitar"].poll() is None, "chain died"
    check("every pedal has its own wet / dry Mix and Level, changed live; a scene switches several pedals at once", t_mix)

    def t_ir():
        import struct, wave, math
        os.makedirs(host.ir_dir, exist_ok=True)
        irf = os.path.join(host.ir_dir, "Test_Cab.wav")
        w = wave.open(irf, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
        w.writeframes(b"".join(struct.pack("<h", int(20000 * math.exp(-i / 200.0))) for i in range(2400))); w.close()
        assert host.status()["irs"][0]["name"] == "Test Cab"
        saved = host.config["chain"]
        host.config["chain"] = saved + [{"uid": "ir1", "id": "ir", "uri": instrument_host.CONVOLVER_URI, "on": True, "file": irf, "mix": 1, "levelDb": 0}]
        host._apply_safe()
        assert host.running and not host.error, host.error
        conf = open(os.path.join(host.dir, "guitar.conf")).read()
        assert "label = convolver" in conf and irf in conf, conf[-600:]
        host.config["chain"] = saved
    check("IR loader: an impulse-response .wav becomes a convolver pedal (cab / acoustic body), listed from /data", t_ir)

    def t_loop():
        host.handle({"action": "looper", "on": True}, lambda m: None)
        time.sleep(2.5)
        objs = json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True, env=env).stdout)
        names = [o["info"]["props"].get("node.name") for o in objs if o.get("type") == "PipeWire:Interface:Node"]
        assert "padpedal-loop-src" in names, names
        ls = links(env)
        assert any("padpedal-guitar-out" in l and "padpedal-loop-in" in l for l in ls), ls
        host.handle({"action": "looper", "on": False}, lambda m: None)
        time.sleep(1)
    check("looper tap: the instrument also feeds a 'Central Control loop' source the app records from", t_loop)

    def t_relink():
        host.config["routing"] = {"mode": "mono4", "buses": {"instrument": {"ch": 2}}}
        host._relink_safe()
        ls = links(env)
        assert any("padpedal-guitar-out" in l and l.endswith("padpedal_out:playback_FR") for l in ls), ls
        assert not any("padpedal-guitar-out" in l and "playback_RR" in l for l in ls), ls
    check("changing the routing moves the chain to channel 2", t_relink)

    def t_stereo():
        host.config["routing"] = {"mode": "stereo", "buses": {"instrument": {"ch": 3}}}
        host.config["input"]["channel"] = "stereo"
        host._apply_safe()
        assert host.running and not host.error, host.error
        ls = links(env)
        assert any("padpedal-guitar-out" in l and l.endswith("padpedal_out:playback_RL") for l in ls) and any("padpedal-guitar-out" in l and l.endswith("padpedal_out:playback_RR") for l in ls), ls
    check("a stereo input + stereo pair output builds a two-channel chain on channels 3-4", t_stereo)

    print("\nKeys:")
    sf2 = [os.path.join(d, f) for d in instrument_host.SF2_DIRS if os.path.isdir(d) for f in os.listdir(d) if f.lower().endswith(".sf2")]
    if not shutil.which("fluidsynth") or not sf2:
        print("  (fluidsynth or a SoundFont is missing here - keys tests skipped)")
    else:
        host.config = {"kind": "keys", "input": {}, "chain": [pedal(echo[0], "k1")] if echo else [], "keys": {"patch": None, "volume": 0.8, "transpose": 2, "velocity": "soft", "sustain": True}, "levelDb": 0, "routing": {"mode": "mono4", "buses": {"instrument": {"ch": 4}}}}

        def t_keys():
            host._apply_safe()
            assert host.running and not host.error, host.error
            assert host.keys_engine == "FluidSynth"
            assert host.procs["fluid"].poll() is None
            cat = host.keys_catalog()
            assert cat and cat[0]["presets"], "no presets in the catalogue"
            ls = links(env)
            assert any("padpedal-keys-synth" in l and "padpedal-keys-in" in l for l in ls), "synth not linked into the keys chain: %s" % ls
            assert any("padpedal-keys-out" in l and l.endswith("playback_RR") for l in ls), ls
        check("FluidSynth starts with a SoundFont, feeds the keys effects chain, which goes to channel 4", t_keys)

        def t_notes():
            host.note(60, True, 100)
            time.sleep(0.2)
            host.note(60, False, 0)
            out = host.fluid("get synth.gain")
            assert float(out.strip().split()[-1]) > 0, out
        check("notes reach FluidSynth and the shell answers", t_notes)

        def t_patch():
            cat = host.keys_catalog()
            pr = cat[0]["presets"][min(5, len(cat[0]["presets"]) - 1)]
            host.config["keys"]["patch"] = {"file": cat[0]["file"], "bank": pr["bank"], "prog": pr["prog"], "name": pr["name"]}
            host._keys_safe()
            assert not host.error, host.error
        check("choosing another sound selects it without restarting", t_patch)

        def t_layers():
            cat = host.keys_catalog(); f = cat[0]["file"]; ps = cat[0]["presets"]
            layers = [{"patch": {"file": f, "bank": ps[i % len(ps)]["bank"], "prog": ps[i % len(ps)]["prog"]}, "volume": 0.5 + i * 0.05, "on": True, "lo": 0 if i else 60, "hi": 127 if i else 127, "octave": 1 if i == 1 else 0} for i in range(8)]
            host.config["keys"]["layers"] = layers
            host._keys_safe()
            assert not host.error, host.error
            r = instrument_host.MidiRouter.__new__(instrument_host.MidiRouter)
            r.layers = layers; r.transpose = 0
            tg = r.targets(48, 100)    # below layer 1's split point: 7 layers, layer 2 an octave up
            assert len(tg) == 7 and (1, 60) in tg and all(ch != 0 for ch, _ in tg), tg
            assert len(r.targets(72, 100)) == 8
            layers[3]["on"] = False; layers[4]["velLo"] = 90
            assert len(r.targets(72, 60)) == 6
            out = host.fluid("channels")
            assert out.strip(), out
            host.note(64, True, 90); time.sleep(0.1); host.note(64, False, 0)
            assert host.procs["fluid"].poll() is None
        check("keys: 8 layers on their own FluidSynth channels, with splits, octave and velocity ranges", t_layers)

    def t_off():
        host.config["kind"] = "off"
        host._apply_safe()
        assert not host.running and not host.procs, host.procs
        ls = links(env)
        assert not any("padpedal-" in l for l in ls), ls
    check("Off stops every process and removes the links", t_off)

    def t_sf2_tools():
        presets = instrument_host.sf2_presets(sf2[0]) if sf2 else []
        if sf2:
            assert presets and all("bank" in p and "prog" in p and p["name"] for p in presets), presets[:2]
        folder = tempfile.mkdtemp(prefix="wavs-")
        import struct, wave, math
        for name, midi in (("C4", 60), ("G4", 67)):
            w = wave.open(os.path.join(folder, name + ".wav"), "wb")
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
            f = 440 * 2 ** ((midi - 69) / 12)
            w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * f * i / 44100))) for i in range(22050)))
            w.close()
        out = os.path.join(data, "mybank.sf2")
        n = instrument_host.build_sf2_from_wavs(folder, out, "My Bank")
        assert n == 2 and os.path.getsize(out) > 1000, (n, os.path.getsize(out) if os.path.exists(out) else None)
        back = instrument_host.sf2_presets(out)
        assert back and back[0]["name"] == "My Bank", back
    check("SoundFont reading and 'folder of WAVs named by note' -> .sf2 writing round-trip", t_sf2_tools)

    host.stop_all()
    shutil.rmtree(data, ignore_errors=True)
    print("\n%s" % ("ALL INSTRUMENT HOST CHECKS PASSED" if not failed else "%d CHECK(S) FAILED" % failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
