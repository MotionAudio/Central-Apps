"""Central Control - the Instrument tab's audio on Windows and macOS (and Linux without PipeWire).

The Raspberry Pi (and a Linux PC with PipeWire) runs the instrument through instrument_host.py: real LV2 /
LADSPA pedals and FluidSynth. Where that isn't available, the driver runs cu-rig instead - the built-in rig
from Central Usage (built-in effects for every pedal of the catalogue, SoundFont keys) - and passes the
Instrument tab's messages to it unchanged. MIDI keyboards are read here (mido + python-rtmidi) and passed on.

The program is found through CC_RIG_BIN, or next to the app (native/cu-rig[.exe]); its sounds through
CC_RIG_SOUNDS and its pedal map through CC_RIG_MAP (the desktop app sets all three)."""
import json
import logging
import os
import re
import subprocess
import sys
import threading

log = logging.getLogger("pedal-driver.rig")
EXE = ".exe" if sys.platform == "win32" else ""


def find_binary(app_root):
    candidates = [os.environ.get("CC_RIG_BIN") or ""]
    for base in (app_root, os.path.dirname(app_root or ""), os.path.dirname(os.path.abspath(sys.executable))):
        if base:
            candidates += [os.path.join(base, "native", "cu-rig" + EXE), os.path.join(base, "cu-rig" + EXE)]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


class NativeRig:
    """Looks like instrument_host.InstrumentHost to the driver: handle(), status(), add_sf2(), add_ir(), add_wav_bank()."""

    def __init__(self, driver, data_root, app_root, binary=None):
        self.driver = driver
        self.app_root = app_root
        self.binary = binary or find_binary(app_root)
        self.dir = os.path.join(data_root, "instrument")
        self.sf2_user_dir = os.path.join(self.dir, "sounds", "sf2")
        self.ir_dir = os.path.join(self.dir, "sounds", "ir")
        for d in (self.sf2_user_dir, self.ir_dir):
            os.makedirs(d, exist_ok=True)
        self.available = bool(self.binary)
        self.proc = None
        self.lock = threading.Lock()
        self.last = {"type": "instrumentStatus", "available": self.available, "running": False, "kind": "off", "error": None if self.available else "the built-in rig (cu-rig) is missing",
                     "inputs": [], "midiInputs": [], "keysCatalog": [], "engine": "cu-rig"}
        self.kind = "off"
        self.midi_want = "auto"
        self.midi_ports = []
        self.midi_thread = None

    # ----- the process -------------------------------------------------------
    def start(self):
        with self.lock:
            if self.proc and self.proc.poll() is None:
                return True
            if not self.binary:
                return False
            args = [self.binary, "--data", self.dir]
            sounds = os.environ.get("CC_RIG_SOUNDS") or next((p for p in (os.path.join(self.app_root, "sounds"), os.path.join(os.path.dirname(self.app_root), "sounds")) if os.path.isdir(p)), "")
            rmap = os.environ.get("CC_RIG_MAP") or next((p for p in (os.path.join(os.path.dirname(self.binary), "rig-map.json"), os.path.join(self.app_root, "native", "rig-map.json")) if os.path.isfile(p)), "")
            if sounds:
                args += ["--sounds", sounds]
            if rmap:
                args += ["--map", rmap]
            if os.environ.get("CC_RIG_BACKEND"):
                args += ["--backend", os.environ["CC_RIG_BACKEND"]]
            flags = 0x08000000 if sys.platform == "win32" else 0   # CREATE_NO_WINDOW
            try:
                self.proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=flags)
            except OSError as error:
                self.last["error"] = "could not start the rig: %s" % error
                return False
            threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
            log.info("built-in rig started: %s", " ".join(args))
            return True

    def _reader(self, proc):
        for raw in proc.stdout:
            try:
                msg = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                continue
            if msg.get("type") == "instrumentStatus":
                msg["midiInputs"] = list(self.midi_ports)
                self.last = msg
                self.kind = msg.get("kind") or "off"
            try:
                self.driver.emit(msg)
            except Exception:  # noqa: BLE001
                pass

    def send(self, message):
        if not self.start():
            return
        try:
            self.proc.stdin.write((json.dumps(message) + "\n").encode())
            self.proc.stdin.flush()
        except (OSError, ValueError):
            self.proc = None

    # ----- what the driver calls ---------------------------------------------
    def status(self):
        return dict(self.last, midiInputs=list(self.midi_ports))

    def handle(self, message, reply):
        message = dict(message)
        message.pop("type", None)
        action = message.get("action")
        if action == "status" and not (self.proc and self.proc.poll() is None):
            reply(self.status())
        keys = (message.get("config") or {}).get("keys") if action == "apply" else message.get("keys") if action in ("keys", "scene") else None
        if isinstance(keys, dict) and keys.get("midi"):
            self.midi_want = keys.get("midi")
        self.start_midi()
        self.send(message)

    def add_sf2(self, name, data):
        name = re.sub(r"[^\w.\- ]+", "", os.path.basename(name)) or "bank.sf2"
        if not name.lower().endswith(".sf2"):
            name += ".sf2"
        if data[:4] != b"RIFF" or data[8:12] != b"sfbk":
            raise ValueError("not a SoundFont (.sf2) file (.sf3 banks are not supported by the built-in rig)")
        path = os.path.join(self.sf2_user_dir, name)
        with open(path + ".part", "wb") as handle:
            handle.write(data)
        os.replace(path + ".part", path)
        self.send({"action": "rescan"})
        return {"file": path, "presets": 1}

    def add_ir(self, name, data):
        if not (data[:4] == b"RIFF" and data[8:12] == b"WAVE"):
            raise ValueError("not a WAV impulse response")
        base = re.sub(r"[^\w.\- ]+", "", os.path.basename(name)) or "ir.wav"
        path = os.path.join(self.ir_dir, base)
        with open(path + ".part", "wb") as handle:
            handle.write(data)
        os.replace(path + ".part", path)
        self.send({"action": "rescan"})
        return {"file": path}

    def add_wav_bank(self, name, folder):
        import instrument_host  # the SoundFont builder is plain Python
        out = os.path.join(self.sf2_user_dir, re.sub(r"[^\w.\- ]+", "", name)[:40] + ".sf2")
        n = instrument_host.build_sf2_from_wavs(folder, out, name)
        if not n:
            raise ValueError("no WAV files named by note (C4.wav, F#3.wav, 60.wav...) in that folder")
        self.send({"action": "rescan"})
        return {"file": out, "presets": 1, "samples": n}

    # ----- MIDI keyboards ------------------------------------------------------
    def start_midi(self):
        if self.midi_thread:
            return
        try:
            import mido
            mido.get_input_names()
        except Exception as error:  # noqa: BLE001
            log.info("MIDI keyboards for the rig: off (%s)", error)
            self.midi_thread = False
            return
        self.midi_thread = threading.Thread(target=self._midi_loop, args=(mido,), daemon=True)
        self.midi_thread.start()

    def _midi_loop(self, mido):
        import time
        opened = {}
        while True:
            try:
                names = [n for n in mido.get_input_names() if "Central Control" not in n and "Through" not in n and "RtMidi" not in n]
            except Exception:  # noqa: BLE001
                names = []
            self.midi_ports = names
            for n in names:
                if n not in opened:
                    try:
                        opened[n] = mido.open_input(n, callback=lambda msg, port=n: self._midi(msg, port))
                    except Exception:  # noqa: BLE001
                        opened[n] = None
            for n in list(opened):
                if n not in names:
                    try:
                        opened[n] and opened[n].close()
                    except Exception:  # noqa: BLE001
                        pass
                    del opened[n]
            time.sleep(2.0)

    def _midi(self, msg, port):
        if self.kind != "keys" or (self.midi_want not in ("auto", "", None) and self.midi_want != port):
            return
        data = msg.bytes() if hasattr(msg, "bytes") else []
        if data and (data[0] & 0xF0) in (0x80, 0x90, 0xB0, 0xE0):
            self.send({"action": "midi", "data": data[:3]})
