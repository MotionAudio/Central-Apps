#!/usr/bin/env python3
"""Adds Central Pedals (our own pedals, central-usage/native/mapedals) to instrument-plugins.json, the pedal catalogue's
control list, from the pedal table the C library prints:

    make -C central-usage/native test-mapedals-bin && central-usage/native/build/test-mapedals --json > /tmp/p.json
    python3 tools/make-pedal-plugins.py /tmp/p.json            # write instrument-plugins.json
    python3 tools/make-pedal-plugins.py /tmp/p.json --check    # fail if it's out of date (CI)
    python3 tools/make-pedal-plugins.py /tmp/p.json --ports ports.txt   # the port list test-mapedals-ladspa checks
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "instrument-plugins.json")
SO = "central-pedals.so"


def entry(p):
    controls = []
    for c in p["controls"]:
        lo, hi, unit = c["min"], c["max"], c["unit"] or None
        log = bool(unit in ("Hz", "ms", "s") and lo > 0 and hi / lo >= 10)
        toggled = bool(c["integer"] and lo == 0 and hi == 1)
        controls.append({"sym": c["sym"], "name": c["name"], "min": lo, "max": hi, "def": c["def"], "log": log, "toggled": toggled,
                         "integer": bool(c["integer"]), "enum": False, "unit": unit, "scale": []})
    return {"name": p["name"], "ladspa": SO, "label": p["id"], "audio": [{"sym": "in", "dir": "in"}, {"sym": "out", "dir": "out"}],
            "controls": controls, "ain": 1, "aout": 1, "knobs": {}, "own": True}


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    with open(args[0]) as f:
        table = json.load(f)
    with open(OUT) as f:
        cat = json.load(f)
    want = {"ladspa:%s:%s" % (SO, p["id"]): entry(p) for p in table}
    if "--ports" in args:
        with open(args[args.index("--ports") + 1], "w") as f:
            for uri, e in want.items():
                f.write(" ".join([e["label"]] + [c["sym"] for c in e["controls"]] + ["in", "out"]) + "\n")
    have = {u: e for u, e in cat.items() if u.startswith("ladspa:%s:" % SO)}
    if "--check" in args:
        if have != want:
            stale = sorted(set(have) ^ set(want)) + sorted(u for u in want if u in have and have[u] != want[u])
            print("instrument-plugins.json is out of date for Central Pedals (%s): run tools/make-pedal-plugins.py" % ", ".join(stale[:6]))
            return 1
        print("instrument-plugins.json: %d Central Pedals, up to date" % len(want))
        return 0
    out = {u: e for u, e in cat.items() if not u.startswith("ladspa:%s:" % SO)}
    out.update(want)
    with open(OUT + ".part", "w") as f:
        json.dump(out, f)
    os.replace(OUT + ".part", OUT)
    print("instrument-plugins.json: %d plugins, %d of them Central Pedals" % (len(out), len(want)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
