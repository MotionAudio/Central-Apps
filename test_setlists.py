#!/usr/bin/env python3
"""10.0 setlists on the pedal side: Central Pedal Control on a computer keeps the songs and runs the tracks; a linked
Pi controls it (its buttons reach the computer) and plays them itself when the computer goes away. A Pi keeps one
setlist's tracks at a time: opening another lets the old one's tracks go - only those a computer still has.
Run: python3 test_setlists.py"""
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
UDP = 18294


def check(label, ok, detail=""):
    print(("  ✓ " if ok else "  ✗ ") + label + ("" if ok else "\n      " + str(detail)[:600]))
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


def wait(fn, timeout=25.0, step=0.25):
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


def start(name, ports, extra, env=None):
    root = tempfile.mkdtemp(prefix="cc-sl-%s-" % name.replace(" ", ""))
    cfg = dict({"ws_port": ports[0], "http_port": ports[1], "lan_port": ports[2], "lan_ws_port": ports[3], "sync_interval": 1, "sync_udp_port": UDP, "device_name": name,
                "sync_prune_delay": 0.3, "center": False}, **extra)
    with open(os.path.join(root, "config.json"), "w") as h:
        json.dump(cfg, h)
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, "pedal-driver.py"), "--simulate", os.path.join(root, "data"), "--app-root", HERE, "--config", os.path.join(root, "config.json")],
                            stdout=subprocess.DEVNULL, stderr=open(os.path.join(root, "log.txt"), "w"), env=dict(os.environ, **(env or {})))
    return root, proc


def project(setlist_id, name, songs):
    return {"name": name, "setlistId": setlist_id, "songs": songs, "pads": []}


def put_stem(port, song, name, data):
    status, body = http("http://127.0.0.1:%d/library?song=%s&name=%s" % (port, song, name), data=data, method="PUT")
    return json.loads(body)["path"]


class App:
    """An app window on a driver: everything it hears, and a way to wait for one message."""
    def __init__(self, ws):
        self.ws, self.seen = ws, []

    async def until(self, pred, timeout=25.0):
        deadline = time.monotonic() + timeout
        for m in self.seen:
            if pred(m):
                return m
        while time.monotonic() < deadline:
            try:
                m = json.loads(await asyncio.wait_for(self.ws.recv(), max(0.05, deadline - time.monotonic())))
            except asyncio.TimeoutError:
                break
            except Exception:
                break
            self.seen.append(m)
            if pred(m):
                return m
        return None

    async def send(self, m):
        await self.ws.send(json.dumps(m))


async def hello(port):
    ws = await websockets.connect("ws://127.0.0.1:%d" % port)
    try:
        while True:
            m = json.loads(await asyncio.wait_for(ws.recv(), 5))
            if m.get("type") == "hello":
                return m
    finally:
        await ws.close()


async def main():
    PC, PI = (19065, 19066, 19080, 19081), (19165, 19166, 19180, 19181)
    pc_root, pc = start("Office Mac", PC, {}, {"CC_PEDAL_CONTROL": "1"})
    pi_root, pi = start("Stage Pi", PI, {"sync_kind": "pi"})
    procs = [pc, pi]
    try:
        ok = wait(lambda: jget(PC[1], "/sync/status") and jget(PI[1], "/sync/status"))
        check("Central Pedal Control (a computer) and a Pi start", ok, open(os.path.join(pi_root, "log.txt")).read()[-800:])
        pst, cst = jget(PI[1], "/sync/status"), jget(PC[1], "/sync/status")
        check("the Pi keeps one setlist's tracks; Central Pedal Control keeps every song and runs the tracks", pst["stems"] == "current" and cst["stems"] == "all" and cst["runsTracks"] and not pst["runsTracks"], (pst["stems"], cst["stems"], cst.get("runsTracks")))
        h = await hello(PI[0])
        check("on its own the Pi plays the tracks itself", h.get("pedalJob") == "player" and (h.get("tracksHost") or {}).get("plays") and (h.get("tracksHost") or {}).get("oneSetlist"), h.get("tracksHost"))

        # a song made only on the Pi: switching setlists there never loses it (no computer has it)
        only = os.urandom(120000)
        c_path = put_stem(PI[1], "sC", "Only.wav", only)
        sC = {"id": "sC", "name": "Pi Song", "key": "D", "bpm": 70, "tracks": {"stems": [{"id": "stC", "name": "Only", "file": c_path}]}}
        http("http://127.0.0.1:%d/project" % PI[1], data=json.dumps(project("pi1", "Pi set", [sC])).encode())
        http("http://127.0.0.1:%d/project" % PI[1], data=json.dumps(project("pi2", "Empty", [])).encode())
        time.sleep(1.5)
        st = jget(PI[1], "/sync/status")
        check("opening another setlist on a Pi with no computer keeps the tracks that are only there", os.path.isfile(c_path) and st.get("keptOnlyHere", 0) >= 1, st.get("keptOnlyHere"))

        # songs on the computer: A in Sunday, B in Wednesday
        a_data, b_data = os.urandom(300000), os.urandom(200000)
        a_pc, b_pc = put_stem(PC[1], "sA", "A.wav", a_data), put_stem(PC[1], "sB", "B.wav", b_data)
        sA = {"id": "sA", "name": "Way Maker", "key": "E", "bpm": 68, "tracks": {"stems": [{"id": "stA", "name": "A", "file": a_pc}]}}
        sB = {"id": "sB", "name": "Goodness of God", "key": "A", "bpm": 63, "tracks": {"stems": [{"id": "stB", "name": "B", "file": b_pc}]}}
        http("http://127.0.0.1:%d/project" % PC[1], data=json.dumps(project("wed", "Wednesday", [sB])).encode())
        http("http://127.0.0.1:%d/project" % PC[1], data=json.dumps(project("sun", "Sunday", [sA])).encode())

        pi_code = open(os.path.join(pi_root, "data", "code")).read().strip()
        r = jpost(PC[1], "/sync/link", {"address": "127.0.0.1", "port": PI[2], "code": pi_code})
        check("Central Pedal Control links with the pedal's code once", r and r.get("ok"), r)

        pi_app = App(await websockets.connect("ws://127.0.0.1:%d" % PI[0]))
        role = await pi_app.until(lambda m: m.get("type") == "pedalRole" and m.get("via") == "pedal-control" and m.get("job") == "controller", 30)
        check("the Pi hears that Central Pedal Control runs the tracks: it becomes its foot controller", role and (role.get("player") or {}).get("name") == "Office Mac", role)
        h = await hello(PI[0])
        th = h.get("tracksHost") or {}
        check("...the app's Setlists panel is told where the tracks run", h.get("pedalJob") == "controller" and not th.get("plays") and th.get("via") == "pedal-control" and (th.get("player") or {}).get("name") == "Office Mac", th)

        # the Pi's buttons reach the computer's app
        pc_app = App(await websockets.connect("ws://127.0.0.1:%d" % PC[0]))
        got = None
        for _ in range(30):
            await pi_app.send({"type": "forwardAction", "name": "nextSong", "args": {}})
            got = await pc_app.until(lambda m: m.get("type") == "action" and m.get("name") == "nextSong", 1.0)
            if got:
                break
        check("a footswitch on the Pi (Next song) plays out on the computer that runs the tracks", got and got.get("from") == "controller", got)
        await pc_app.send({"type": "tracksHost"})
        info = await pc_app.until(lambda m: m.get("type") == "tracksHost" and m.get("controllers"), 5)
        check("Central Pedal Control knows which pedal controls it", info and info.get("me") == "pedal-control" and info.get("runTracks") and info["controllers"], info)
        bad = await websockets.connect("ws://127.0.0.1:%d" % PC[3])
        await bad.send(json.dumps({"type": "action", "name": "stopAll", "code": "sync:not-the-key"}))
        refused = {}
        for _ in range(10):
            refused = json.loads(await asyncio.wait_for(bad.recv(), 5))
            if refused.get("type") == "auth":
                break
        await bad.close()
        check("a made-up link key is refused", refused.get("type") == "auth" and refused.get("ok") is False, refused)

        # the Pi opens Sunday: A's tracks come over; B's (Wednesday) don't
        sun = wait(lambda: (lambda j: j if j and j["songs"] else None)(jget(PI[1], "/sync/setlist/sun")))
        check("the computer's setlists show up on the Pi", sun and sun["name"] == "Sunday", sun)
        http("http://127.0.0.1:%d/project" % PI[1], data=json.dumps(project("sun", "Sunday", sun["songs"])).encode())
        fa = sun["songs"][0]["tracks"]["stems"][0]["file"]
        check("the open setlist's tracks are copied to the Pi", wait(lambda: os.path.isfile(fa) and open(fa, "rb").read() == a_data), fa)
        songs = {x["id"]: x for x in jget(PI[1], "/sync/songs")["songs"]}
        check("...a song in another setlist isn't (one setlist at a time on the card)", "sB" in songs and not songs["sB"]["stemsHere"], songs.get("sB"))

        # the Pi opens Wednesday: Sunday's tracks go (the computer keeps them), Wednesday's come
        wed = wait(lambda: jget(PI[1], "/sync/setlist/wed"))
        http("http://127.0.0.1:%d/project" % PI[1], data=json.dumps(project("wed", "Wednesday", wed["songs"])).encode())
        fb = wed["songs"][0]["tracks"]["stems"][0]["file"]
        check("opening another setlist on the Pi brings its tracks", wait(lambda: os.path.isfile(fb) and open(fb, "rb").read() == b_data), fb)
        check("...and lets the old setlist's tracks go, because the computer has them", wait(lambda: not os.path.isfile(fa)), fa)
        check("...the computer still has every song", os.path.isfile(a_pc) and os.path.isfile(b_pc))
        back = wait(lambda: os.path.isfile(fa), 0.1) is None
        http("http://127.0.0.1:%d/project" % PI[1], data=json.dumps(project("sun", "Sunday", sun["songs"])).encode())
        check("opening Sunday again brings its tracks back from the computer", back and wait(lambda: os.path.isfile(fa) and open(fa, "rb").read() == a_data), fa)

        # Central Pedal Control stops running the tracks: the Pi plays again; on again: it controls it again
        await pc_app.send({"type": "tracksHost", "action": "set", "on": False})
        pi_app.seen.clear()
        mine = await pi_app.until(lambda m: m.get("type") == "pedalRole" and m.get("job") == "player", 30)
        check("Central Pedal Control set to only edit: the pedal plays the tracks again", mine, [m.get("type") for m in pi_app.seen][-10:])
        await pc_app.send({"type": "tracksHost", "action": "set", "on": True})
        pi_app.seen.clear()
        again = await pi_app.until(lambda m: m.get("type") == "pedalRole" and m.get("job") == "controller", 30)
        check("...turned back on: the pedal controls it again", again)
        # the computer goes away mid-week: the pedal plays by itself
        pc.terminate()
        try:
            pc.wait(5)
        except Exception:
            pc.kill()
        pi_app.seen.clear()
        alone = await pi_app.until(lambda m: m.get("type") == "pedalRole" and m.get("job") == "player", 40)
        check("the computer is switched off: the pedal plays the tracks itself (the open setlist's tracks are on it)", alone and os.path.isfile(fa))
        await pi_app.ws.close()
        await pc_app.ws.close()
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
                try:
                    p.wait(5)
                except Exception:
                    p.kill()
        shutil.rmtree(pc_root, ignore_errors=True)
        shutil.rmtree(pi_root, ignore_errors=True)
    print("\n" + ("ALL SETLIST CHECKS PASSED" if not failures else "%d CHECK(S) FAILED" % len(failures)))
    sys.exit(1 if failures else 0)


asyncio.run(main())
