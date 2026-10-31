#!/usr/bin/env python3
"""Central Pedal - community items (10.1), no internet and no audio hardware:
  * a community loop from Make & sell installs like any library (its creator kept for the label);
  * a community plugin installs only while "Allow community plugins" is on (off by default), into its own folder, every
    program file checked against the sha256 Motion Audio's review recorded; a link or a path outside its folder is
    refused; Remove takes it away;
  * the website's revoke list takes away the items it names and anything holding a blocked program file;
  * the driver's /libraries/community route (the switch and the revoke list) is there;
  * community_sandbox.py: the bubblewrap command walls the plugin host off (no network, no capabilities, a read-only
    system, the plugin read-only at /plugin, only the PipeWire socket shared in, a seccomp filter when it's there).
    python3 test_community.py"""
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import community_sandbox  # noqa: E402
import libraries  # noqa: E402

fails = 0


def ok(cond, label, detail=None):
    global fails
    print(("  ✓ " if cond else "  ✗ ") + label + ("" if cond or detail is None else "   -- " + str(detail)[:600]))
    if not cond:
        fails += 1


def sha(b):
    return hashlib.sha256(b).hexdigest()


def wav(seconds=1.0, rate=22050):
    n = int(seconds * rate)
    b = io.BytesIO()
    import wave
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(b"\x00\x10" * n)
    return b.getvalue()


def zip_bytes(files, links=()):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for name, data in files:
            z.writestr(name, data)
        for name, target in links:
            info = zipfile.ZipInfo(name)
            info.external_attr = (0o120777 << 16)
            z.writestr(info, target)
    return b.getvalue()


def library(lib_id, plan, items, community=None):
    man = {"format": 1, "id": lib_id, "plan": plan, "version": "1", "title": "T " + lib_id, "items": [dict(it[0]) for it in items]}
    if community:
        man["community"] = community
    for m, (meta, name, data) in zip(man["items"], items):
        m["file"] = name; m["sha256"] = sha(data)
    return zip_bytes([("manifest.json", json.dumps(man))] + [(name, data) for _, name, data in items])


def elf_arm(tag):
    b = bytearray(256); b[0:4] = b"\x7fELF"; b[4] = 2; b[18] = 183; b[64:64 + len(tag)] = tag.encode()
    return bytes(b)


root = tempfile.mkdtemp(prefix="pp-community-")
try:
    store = libraries.LibraryStore(root, instrument=None)
    print("a community loop:")
    loop = library("community-7", "pads", [({"kind": "loop", "name": "Swells", "set": "swells", "bpm": 72, "key": "D"}, "loops/01-swells.wav", wav())], {"item": 7, "creator": "Ana Loops", "kind": "loop"})
    rec = store.install_bytes(loop, expected_sha256=sha(loop))
    ok(rec["counts"]["loop"] == 1 and rec["community"]["creator"] == "Ana Loops" and store.listing()[0]["community"]["creator"] == "Ana Loops", "installs like a library, keeping who made it (for the label)", rec.get("community"))

    print("a community plugin:")
    so = elf_arm("shimmer")
    bundle = zip_bytes([("Shimmer.lv2/manifest.ttl", "@prefix lv2: <http://lv2plug.in/ns/lv2core#> ."), ("Shimmer.lv2/shimmer.so", so)])
    item = {"kind": "plugin", "name": "Shimmer Verb", "platform": "linux-arm64", "format": "lv2", "bundle": "Shimmer.lv2", "binaries": [{"name": "Shimmer.lv2/shimmer.so", "sha256": sha(so)}]}
    plug = library("community-9", "plugins", [(item, "plugin/Shimmer.lv2.zip", bundle)], {"item": 9, "creator": "Ben Pads", "kind": "plugin"})
    ok(store.plugins_allowed() is False, "Allow community plugins is off by default")
    try:
        store.install_bytes(plug, expected_sha256=sha(plug)); ok(False, "refused while the switch is off")
    except libraries.LibraryError as e:
        ok("off on this device" in str(e) and not store.record("community-9") and not os.path.exists(os.path.join(store.plugins_dir(), "community-9")), "refused while the switch is off (nothing left behind)", e)
    ok(store.set_plugins_allowed(True) is True, "switched on")
    rec = store.install_bytes(plug, expected_sha256=sha(plug))
    p = rec["plugins"][0]
    so_path = os.path.join(p["path"], "shimmer.so")
    ok(rec["counts"]["plugin"] == 1 and p["format"] == "lv2" and p["path"].startswith(os.path.join(root, "libraries", "community-plugins", "community-9")) and os.path.isfile(so_path) and os.path.isfile(os.path.join(p["path"], "manifest.ttl")),
       "installed into its own folder (community-plugins/<id>/Shimmer.lv2)", p)
    ok(os.stat(so_path).st_mode & 0o111 and not os.stat(os.path.join(p["path"], "manifest.ttl")).st_mode & 0o111, "only the checked program file is executable")
    bad_item = dict(item, binaries=[{"name": "Shimmer.lv2/shimmer.so", "sha256": "0" * 64}])
    try:
        store.install_bytes(library("community-10", "plugins", [(bad_item, "plugin/x.zip", bundle)])); ok(False, "a changed program file is refused")
    except libraries.LibraryError as e:
        ok("doesn't match what Motion Audio checked" in str(e) and not os.path.exists(os.path.join(store.plugins_dir(), "community-10")), "a program file that isn't what Motion Audio checked: refused, nothing left", e)
    sneaky = zip_bytes([("Shimmer.lv2/manifest.ttl", "x"), ("Shimmer.lv2/shimmer.so", so)], links=[("Shimmer.lv2/evil", "/etc/passwd")])
    try:
        store.install_bytes(library("community-11", "plugins", [(item, "plugin/y.zip", sneaky)])); ok(False, "a link is refused")
    except libraries.LibraryError as e:
        ok("link" in str(e), "a link inside the bundle: refused", e)
    escape = zip_bytes([("Shimmer.lv2/../../escape.so", so)])
    try:
        store.install_bytes(library("community-12", "plugins", [(dict(item, binaries=[{"name": "escape.so", "sha256": sha(so)}]), "plugin/z.zip", escape)])); ok(False, "a path outside is refused")
    except libraries.LibraryError as e:
        ok("outside its folder" in str(e) and not os.path.exists(os.path.join(root, "libraries", "escape.so")), "a path outside its folder: refused", e)

    print("the revoke list:")
    gone = store.revoke(ids=["community-404"], hashes=[sha(so)])
    ok(gone == ["community-9"] and not store.record("community-9") and not os.path.exists(os.path.join(store.plugins_dir(), "community-9")), "a blocked program file's sha256 takes its plugin away (files and record)", gone)
    gone = store.revoke(ids=["community-7"], hashes=[])
    ok(gone == ["community-7"] and not store.installed(), "an item Motion Audio took down comes off by its id", gone)
    store.set_plugins_allowed(False)
    ok(store.plugins_allowed() is False, "switched off again")

    print("the driver:")
    src = open(os.path.join(HERE, "pedal-driver.py"), encoding="utf-8").read()
    ok('"/libraries/community"' in src and "set_plugins_allowed" in src and "st.revoke(" in src and '"pluginsAllowed": st.plugins_allowed()' in src, "/libraries/community: the switch and the revoke list (only from the app: local_origin_ok)")

    print("walled off (community_sandbox.py):")
    pdir = os.path.join(root, "plugin"); os.makedirs(pdir)
    cmd = community_sandbox.command(pdir, ["jalv", "-i", "urn:test"], pipewire=True, runtime_dir="/run/user/1000", seccomp_fd=7)
    s = " ".join(cmd)
    ok(cmd[0] == "bwrap" and "--unshare-all" in cmd and "--share-net" not in cmd and "--cap-drop ALL" in s and "--die-with-parent" in cmd and "--new-session" in cmd and "--clearenv" in cmd, "its own namespaces (no network), no capabilities, dies with the driver", s)
    ok("--ro-bind " + os.path.realpath(pdir) + " /plugin" in s and "--tmpfs /tmp" in s and "--ro-bind-try /usr /usr" in s and " --bind " not in s, "the system and the plugin read-only; nothing of the musician's writable", s)
    ok("/run/user/1000/pipewire-0 /tmp/run/pipewire-0" in s and s.count("pipewire") == 2, "only the PipeWire socket is shared in (for its audio)", s)
    ok("--seccomp 7" in s and cmd[-4:] == ["--", "jalv", "-i", "urn:test"], "the seccomp filter, then the host", cmd[-6:])
    ok("--seccomp" not in " ".join(community_sandbox.command(pdir, ["jalv"])), "no filter given: none passed")
    ok("ptrace" in community_sandbox.DENY_SYSCALLS and "bpf" in community_sandbox.DENY_SYSCALLS and set(community_sandbox.DENY_FAMILIES.values()) == {2, 10, 16, 17, 31}, "the filter refuses ptrace, bpf, mount, modules... and internet / netlink / raw sockets")
    try:
        community_sandbox.command(os.path.join(root, "nope"), ["jalv"]); ok(False, "a missing folder")
    except ValueError:
        ok(True, "a missing plugin folder: refused")
finally:
    shutil.rmtree(root, ignore_errors=True)
print("\n" + (str(fails) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
