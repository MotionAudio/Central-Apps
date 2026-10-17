#!/usr/bin/env python3
"""Central Usage - the Instrument tab's audio: the same native instrument host the Central Control runs
(guitar / bass through real LV2 / LADSPA pedals in PipeWire, keys on FluidSynth), on this computer.
JSON lines: one message per line on stdin (the Instrument tab's messages), replies and status on stdout."""
import json
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
out_lock = threading.Lock()


def emit(message):
    with out_lock:
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()


class Driver:   # what the instrument host needs from the driver
    midi = None

    def emit(self, message, lan=False):
        emit(message)


def main():
    data_root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), ".local", "share", "central-usage", "instrument")
    os.makedirs(data_root, exist_ok=True)
    try:
        import instrument_host
    except Exception as error:   # noqa: BLE001
        emit({"type": "instrumentStatus", "available": False, "error": "instrument host not available: %s" % error, "inputs": [], "midiInputs": [], "keysCatalog": []})
        return
    host = instrument_host.InstrumentHost(Driver(), data_root, HERE)
    emit(host.status())
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        try:
            if message.get("type") == "routing":
                host.handle({"action": "routing", "routing": message.get("routing") or {}}, emit)
            else:
                host.handle(message, emit)
        except Exception as error:   # noqa: BLE001
            emit({"type": "instrumentStatus", "available": False, "error": str(error), "inputs": [], "midiInputs": [], "keysCatalog": []})
    try:
        host.handle({"action": "apply", "config": {"kind": "off"}}, lambda _r: None)
    except Exception:   # noqa: BLE001
        pass


if __name__ == "__main__":
    main()
