#!/usr/bin/env python3
"""Adds LV2 plugins to instrument-plugins.json (the pedal catalogue's control list), read with lilv from the plugins
installed on this computer - the same entry shape the Instrument tab, the Pi's instrument host and the desktop rig
(tools/make-rig-map.js) use: name, audio ins / outs, required host features, audio ports and every input control
(range, default, log / toggled / integer / enum, unit, labelled values).
    sudo apt install python3-lilv <the plugin packages>
    python3 tools/make-plugin-list.py <uri> [<uri> ...]          (adds / refreshes those entries)
Plugins that need a host feature the instrument host doesn't give are refused (their names are printed)."""
import json
import os
import sys

import lilv

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "instrument-plugins.json")
LV2 = "http://lv2plug.in/ns/lv2core#"
EXT = "http://lv2plug.in/ns/ext/"
# what PipeWire's filter-chain (the Pi) and the rig give a plugin: anything else it requires -> not added
GIVEN = {EXT + "urid#map", EXT + "urid#unmap", EXT + "options#options", EXT + "buf-size#boundedBlockLength",
         EXT + "buf-size#fixedBlockLength", EXT + "buf-size#powerOf2BlockLength", EXT + "log#log", LV2 + "isLive",
         LV2 + "hardRTCapable", EXT + "state#mapPath", EXT + "state#makePath", EXT + "state#freePath"}
KEPT = {EXT + "worker#schedule": "worker#schedule"}   # (given, and listed: the host sets the worker up)


def unit_name(node):
    """lv2 units: the unit's own name (db, hz, ms, pc, bpm...); a unit written in place (a blank node) has none."""
    if node is None or node.is_blank():
        return None
    name = str(node).rsplit("#", 1)[-1]
    return name if name.isalpha() or name == "semitone12TET" else None


def main(uris):
    world = lilv.World()
    world.load_all()
    plugins = world.get_all_plugins()
    ns = lambda s: world.new_uri(s)
    audio, control, inp, outp = ns(LV2 + "AudioPort"), ns(LV2 + "ControlPort"), ns(LV2 + "InputPort"), ns(LV2 + "OutputPort")
    props = {k: ns(LV2 + k) for k in ("toggled", "integer", "enumeration")}
    logp, unit_p = ns("http://lv2plug.in/ns/ext/port-props#logarithmic"), ns("http://lv2plug.in/ns/extensions/units#unit")
    try:
        with open(OUT) as handle:
            cat = json.load(handle)
    except (OSError, ValueError):
        cat = {}
    done = []
    for uri in uris:
        p = plugins.get_by_uri(ns(uri))
        if p is None:
            print("not installed here: " + uri)
            continue
        req = [str(f) for f in p.get_required_features()]
        bad = [f for f in req if f not in GIVEN and f not in KEPT]
        if bad:
            print("needs %s - not added: %s" % (", ".join(bad), uri))
            continue
        entry = {"name": str(p.get_name()), "ain": 0, "aout": 0, "required": [KEPT[f] for f in req if f in KEPT], "audio": [], "controls": []}
        for i in range(p.get_num_ports()):
            port = p.get_port_by_index(i)
            sym = str(port.get_symbol())
            if port.is_a(audio):
                d = "in" if port.is_a(inp) else "out"
                entry["audio"].append({"sym": sym, "dir": d})
                entry["ain" if d == "in" else "aout"] += 1
            elif port.is_a(control) and port.is_a(inp):
                rng = port.get_range()
                num = lambda n, fb: float(str(n)) if n is not None else fb
                lo, hi = num(rng[1], 0.0), num(rng[2], 1.0)
                unit = port.get(unit_p)
                entry["controls"].append({"sym": sym, "name": str(port.get_name()), "min": lo, "max": hi, "def": num(rng[0], lo),
                                          "log": port.has_property(logp), "toggled": port.has_property(props["toggled"]),
                                          "integer": port.has_property(props["integer"]), "enum": port.has_property(props["enumeration"]),
                                          "unit": unit_name(unit),
                                          "scale": sorted([float(str(sp.get_value())), str(sp.get_label())] for sp in (port.get_scale_points() or []))})
        if entry["ain"] < 1 or entry["aout"] < 1:
            print("no audio in / out - not added: " + uri)
            continue
        if uri in cat and cat[uri].get("knobs"):
            entry["knobs"] = cat[uri]["knobs"]
        cat[uri] = entry
        done.append(uri)
    with open(OUT, "w") as handle:
        json.dump(cat, handle)
    print("%d plugin(s) added / refreshed; %d in the list" % (len(done), len(cat)))


if __name__ == "__main__":
    main(sys.argv[1:])
