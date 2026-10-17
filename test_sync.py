#!/usr/bin/env python3
"""Two Central Controls keep the same songs and setlists: a PC (takes every stem) and a Pi-like device
(takes stems only for songs in a setlist). Run: python3 test_sync.py"""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
failures = []


def check(label, ok, detail=""):
    print(("  ✓ " if ok else "  ✗ ") + label + ("" if ok else "\n      " + str(detail)[:400]))
    if not ok:
        failures.append(label)


def http(url, data=None, method=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data is not None else "GET"), headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def jget(port, path):
    status, body = http("http://127.0.0.1:%d%s" % (port, path))
    return json.loads(body) if status == 200 else None


def jpost(port, path, obj):
    status, body = http("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(obj).encode(), headers={"Content-Type": "application/json"})
    return json.loads(body) if body else None


def wait(fn, timeout=20.0, step=0.25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    return None


def start(name, ports, extra):
    root = tempfile.mkdtemp(prefix="cc-sync-%s-" % name)
    cfg = dict({"ws_port": ports[0], "http_port": ports[1], "lan_port": ports[2], "lan_ws_port": ports[3], "sync_interval": 1, "sync_udp_port": 18094, "device_name": name}, **extra)
    with open(os.path.join(root, "config.json"), "w") as h:
        json.dump(cfg, h)
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, "pedal-driver.py"), "--simulate", os.path.join(root, "data"), "--app-root", HERE, "--config", os.path.join(root, "config.json")],
                            stdout=subprocess.DEVNULL, stderr=open(os.path.join(root, "log.txt"), "w"))
    return root, proc


def project(setlist_id, name, songs):
    return {"name": name, "setlistId": setlist_id, "songs": songs, "pads": []}


async def main():
    pc_root, pc = start("Office PC", (18865, 18866, 18880, 18881), {"sync_peers": ["127.0.0.1:18980"]})
    pi_root, pi = start("Stage Pi", (18965, 18966, 18980, 18981), {"sync_peers": ["127.0.0.1:18880"], "sync_kind": "pi", "sync_stems": "setlists"})
    try:
        ok = wait(lambda: jget(18866, "/sync/status") and jget(18966, "/sync/status"))
        check("two Central Controls start (a PC and a Pi)", ok, open(os.path.join(pc_root, "log.txt")).read()[-800:])
        st = jget(18966, "/sync/status")
        check("the Pi-like one keeps stems of setlist songs only, the PC everything", st["stems"] == "setlists" and jget(18866, "/sync/status")["stems"] == "all", st)

        # songs made on the PC before linking: one in the Sunday setlist, one taken out of every setlist again
        kick = os.urandom(300000)
        pad = os.urandom(200000)
        status, body = http("http://127.0.0.1:18866/library?song=s1&name=Kick.wav", data=kick, method="PUT")
        kick_path = json.loads(body)["path"]
        status, body = http("http://127.0.0.1:18866/library?song=s3&name=Pad.wav", data=pad, method="PUT")
        pad_path = json.loads(body)["path"]
        s1 = {"id": "s1", "name": "Way Maker", "key": "E", "bpm": 68, "tracks": {"stems": [{"id": "st1", "name": "Kick", "file": kick_path}]}}
        s3 = {"id": "s3", "name": "Goodness of God", "key": "A", "bpm": 63, "tracks": {"stems": [{"id": "st3", "name": "Pad", "file": pad_path}]}}
        http("http://127.0.0.1:18866/project", data=json.dumps(project("sl1", "Sunday", [s1])).encode())
        http("http://127.0.0.1:18866/project", data=json.dumps(project("sl3", "Spare", [s3])).encode())
        http("http://127.0.0.1:18866/project", data=json.dumps(project("sl3", "Spare", [])).encode())
        lists = jget(18866, "/sync/setlists")["setlists"]
        check("every saved project is a setlist on its own device", sorted(x["name"] for x in lists) == ["Spare", "Sunday"], lists)

        unauth = http("http://127.0.0.1:18980/api/sync/index")[0]
        check("an unlinked device can't read the songs", unauth == 403, unauth)
        pi_code = open(os.path.join(pi_root, "data", "code")).read().strip()
        bad = jpost(18866, "/sync/link", {"address": "127.0.0.1", "port": 18980, "code": "0000" if pi_code != "0000" else "1111"})
        check("linking with a wrong code is refused", bad and not bad["ok"], bad)
        app = await websockets.connect("ws://127.0.0.1:18965")
        r = jpost(18866, "/sync/link", {"address": "127.0.0.1", "port": 18980, "code": pi_code})
        check("the PC links with the Pi's code once", r and r["ok"] and r["name"] == "Stage Pi", r)

        sl = wait(lambda: (lambda j: j if j and j["songs"] else None)(jget(18966, "/sync/setlist/sl1")))
        check("the PC's setlist shows up on the Pi, ready to open", sl and sl["name"] == "Sunday" and sl["songs"][0]["name"] == "Way Maker", sl)
        f = sl and sl["songs"][0]["tracks"]["stems"][0].get("file")
        got = wait(lambda: f and os.path.isfile(f) and open(f, "rb").read() == kick)
        check("...with its stems, copied byte for byte into the Pi's own library", got and f.startswith(os.path.realpath(pi_root)), f)
        songs = jget(18966, "/sync/songs")["songs"]
        spare = [x for x in songs if x["id"] == "s3"]
        check("a song in no setlist reaches the Pi without its stems (cards are small)", spare and not spare[0]["stemsHere"], songs)

        seen = []
        async def collect():
            try:
                while True:
                    m = json.loads(await asyncio.wait_for(app.recv(), 0.5))
                    if m.get("type") == "sync":
                        seen.append(m)
            except Exception:
                pass
        await collect()
        check("the Pi's app is told about the arriving songs", any(m.get("event") == "song" and m["song"]["id"] == "s1" for m in seen) or any(m.get("event") == "status" for m in seen), [m.get("event") for m in seen])

        # an edit on the Pi goes back to the PC (newest edit wins)
        s1_pi = dict(sl["songs"][0], bpm=70)
        http("http://127.0.0.1:18966/project", data=json.dumps(project("sl1", "Sunday", [s1_pi])).encode())
        back = wait(lambda: (jget(18866, "/sync/song/s1") or {}).get("bpm") == 70)
        check("an edit made on the Pi reaches the PC", back, jget(18866, "/sync/song/s1"))
        pcs = jget(18866, "/sync/song/s1")
        check("...and the PC's copy still points at its own stem file", pcs and pcs["tracks"]["stems"][0]["file"] == os.path.realpath(kick_path), pcs)

        # a light show saved for the song (by Central Usage) travels too
        show = {"code": pi_code, "song": "s1", "show": {"cues": [{"bar": 1, "look": "verse"}]}}
        http("http://127.0.0.1:18980/api/lighting", data=json.dumps(show).encode())
        got = wait(lambda: os.path.isfile(os.path.join(pc_root, "data", "lighting", "s1.json")) and "verse" in open(os.path.join(pc_root, "data", "lighting", "s1.json")).read())
        check("a light show saved on the Pi (from Central Usage) reaches the PC", got)

        # putting the spare song in a setlist on the Pi brings its stems over
        s3_pi = jget(18966, "/sync/song/s3")
        http("http://127.0.0.1:18966/project", data=json.dumps(project("sl1", "Sunday", [s1_pi, s3_pi])).encode())
        f3 = s3_pi["tracks"]["stems"][0]["file"]
        got = wait(lambda: os.path.isfile(f3) and open(f3, "rb").read() == pad)
        check("a song added to a setlist on the Pi gets its stems then", got, f3)

        # delete here only / everywhere
        r = jpost(18966, "/sync/delete", {"kind": "song", "id": "s3", "scope": "here"})
        check("'Delete on this device' removes it from the Pi only (stems gone there)", r["ok"] and not os.path.isfile(f3) and jget(18866, "/sync/song/s3"), r)
        time.sleep(2.5)
        check("...and it does not come back with the next sync", not [x for x in jget(18966, "/sync/songs")["songs"] if x["id"] == "s3" and x["here"]])
        r = jpost(18866, "/sync/delete", {"kind": "song", "id": "s1", "scope": "everywhere"})
        gone = wait(lambda: jget(18966, "/sync/song/s1") is None)
        check("'Delete everywhere' on the PC removes it on the Pi too (and its stem)", r["ok"] and gone and not os.path.isfile(f), r)
        st = jget(18966, "/sync/status")
        check("the status lists the linked device", any(p["linked"] and p["online"] for p in st["peers"]), st["peers"])
        await app.close()
    finally:
        for p in (pc, pi):
            p.terminate()
            try:
                p.wait(5)
            except Exception:
                p.kill()
        shutil.rmtree(pc_root, ignore_errors=True)
        shutil.rmtree(pi_root, ignore_errors=True)
    print("\n" + ("ALL SYNC CHECKS PASSED" if not failures else "%d CHECK(S) FAILED" % len(failures)))
    sys.exit(1 if failures else 0)


asyncio.run(main())
