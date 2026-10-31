// Central Control / Central Usage on a computer - running a community plugin walled off (10.1).
// Community plugins (from Make & sell: checked and reviewed by Motion Audio) are kept in <userData>/libraries/
// community-plugins/ and never load into the app's own processes. wrap() turns "run this plugin host on that plugin" into
// the command that walls it off on this computer:
//   macOS:   sandbox-exec with the profile below - no network, no process launching, reading only the system's
//            libraries / audio parts and the plugin's own folder, writing only to its own temporary folder; Core Audio's
//            services are the only ones it can reach.
//   Linux:   bubblewrap - its own namespaces (no network), no capabilities, a read-only system, the plugin read-only at
//            /plugin, an empty /tmp, only the PipeWire socket shared in (the same as the Central Pedal:
//            community_sandbox.py).
//   Windows: not walled off yet. The plan is a restricted token at low integrity in a job object (no child processes, no
//            writes outside its own folder), which needs native code in the plugin host; until then community plugins
//            stay off on Windows (wrap() says why, and the app doesn't run them).
// What is NOT done yet (docs/COMMUNITY-PLUGINS.md): the built-in rig (cu-rig) doesn't start its plugin scan or a plugin
// host through wrap() yet - it hosts plugins in its own process - so installed community plugins are kept, not played.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const sbString = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
function macProfile(pluginDir, tmpDir) {
  return [
    "(version 1)",
    "(deny default)",
    "(deny network*)",
    "(deny process-exec*)",
    "(allow process-fork)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow file-read-metadata)",
    "(allow file-read* (subpath \"/System\") (subpath \"/usr/lib\") (subpath \"/usr/share\") (subpath \"/Library/Audio\") (subpath \"/private/var/db/timezone\") (literal \"/dev/null\") (literal \"/dev/urandom\")",
    "  (subpath " + sbString(pluginDir) + "))",
    "(allow file-read* file-write* (subpath " + sbString(tmpDir) + "))",
    "(allow file-write-data (literal \"/dev/null\"))",
    "(allow mach-lookup (global-name \"com.apple.audio.audiohald\") (global-name \"com.apple.audio.coreaudiod\") (global-name \"com.apple.system.logger\"))",
    "(allow ipc-posix-shm-read* ipc-posix-shm-write-data (ipc-posix-name-regex #\"^AudioIO\"))",
  ].join("\n");
}
const RO_SYSTEM = ["/usr", "/lib", "/lib64", "/lib32", "/bin", "/sbin", "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d", "/etc/alternatives", "/etc/fonts"];
function linuxArgs(pluginDir, runtimeDir) {
  const a = ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv"];
  for (const p of RO_SYSTEM) a.push("--ro-bind-try", p, p);
  a.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home", "--ro-bind", pluginDir, "/plugin", "--setenv", "HOME", "/tmp/home", "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "LV2_PATH", "/plugin", "--setenv", "VST3_PATH", "/plugin", "--setenv", "CLAP_PATH", "/plugin", "--chdir", "/tmp");
  if (runtimeDir) a.push("--dir", "/tmp/run", "--ro-bind-try", path.join(runtimeDir, "pipewire-0"), "/tmp/run/pipewire-0", "--setenv", "XDG_RUNTIME_DIR", "/tmp/run");
  return a;
}
// { cmd, args } to spawn, or { unsupported: "why" }. o: { platform, pluginDir, tmpDir, runtimeDir }
function wrap(exe, args, o) {
  o = o || {};
  const platform = o.platform || process.platform, pluginDir = o.pluginDir && path.resolve(o.pluginDir);
  if (!pluginDir) throw new Error("no plugin folder");
  if (platform === "darwin") {
    const tmpDir = path.resolve(o.tmpDir || fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cm-plugin-")));
    return { cmd: "/usr/bin/sandbox-exec", args: ["-p", macProfile(pluginDir, tmpDir), exe].concat(args || []), tmpDir };
  }
  if (platform === "linux") return { cmd: "bwrap", args: linuxArgs(pluginDir, o.runtimeDir === undefined ? process.env.XDG_RUNTIME_DIR : o.runtimeDir).concat(["--", exe], args || []) };
  return { unsupported: "Community plugins can't run walled off on Windows yet, so they stay off here." };
}

module.exports = { wrap, macProfile, linuxArgs };
