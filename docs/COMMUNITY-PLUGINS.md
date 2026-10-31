# Make & sell, and community plugins (10.1)

Musicians make samples, loops, pads, instruments, pedal boards and plugins on the website (**Make & sell**, `/create/`,
or the browser studio at `/studio/`). Every upload is checked by machine, then reviewed by a person on the review site
before anyone can download it. Approved items are part of a sound plan and show in the apps under
**Settings → Packages → Community**.

| What | Sound plan | Installs as |
| --- | --- | --- |
| Loops, pads | Central Pads | library `loop` / `pad` items |
| Samples, instruments | Central Keys or Central Instrument (the creator picks) | a SoundFont (`sound`) - WAVs by note and SFZ are turned into an .sf2 on upload |
| Pedal boards | Central Pedals | `board` |
| Plugins | Central Plugins | `plugin` (new kind; older apps skip it) |
| Tracks | Central Tracks | as before (the publishing flow), now with review |

Each item becomes a standard library zip (`manifest.json`, a sha256 per file, id `community-<n>`), so the existing
installers (`libraries.py` on the Central Pedal, `central-usage/libraries.js` on computers) install it, locked by the plan.

## Review and roles

* The review site has its own address: `/review-<20 hex>` worked out from `TOKEN_SECRET` (or `REVIEW_PATH`). It isn't
  linked from any public page, is sent `noindex` / `no-store`, and every call needs a signed-in staff account with the
  phone code. Staff find the link on their account page (only shown to them).
* **Review admins** listen, read the checks, grade 1-5 stars, approve, reject with a reason (emailed), and take things
  down. Stars set a track's single-sale price and weight the pool.
* **The owner** (`samuelbarfieldofficial@gmail.com`, built in, alongside `ADMIN_EMAILS` and `OWNER_EMAILS`; only once
  its email is confirmed) also chooses the review admins, the creators' share per plan (with history and the month it
  starts), the minimum payout, Motion Audio's own star weight, and whether new Central Tracks uploads are held for review
  (on by default in production).

## The pool

Each month, for each plan: the plan's money that month (every yearly payment counts 1/12 in each of its 12 months,
split across the plans it pays for by their prices; refunded or disputed payments stop counting from then), times the
creators' share (75% until staff change it), is split by **downloads × stars**. A download counts once per item, per
downloader (package key or account), per month; default and demo keys never count. Motion Audio's own library installs
count in the total with the official star weight and keep their part. Creators are paid with the monthly payouts
(Stripe Connect, the same as Central Tracks publishers), once they're owed the minimum.

## Plugin protection, per platform - exactly what is done

**On upload (all platforms, `server/src/creatorfiles.js`):** one zip per platform holding exactly one bundle
(`.lv2` / `.vst3` / `.clap` / `.component`) and nothing else; formats per platform (Linux x64: LV2/VST3/CLAP;
Central Pedal / Linux ARM: LV2; Mac: VST3/CLAP/AU; Windows x64: VST3/CLAP); no links, nothing outside the folder, no
scripts, installers or other programs; every program file must be the right kind for the platform (ELF x86-64 /
AArch64 `.so`, Mach-O inside `Contents/MacOS`, PE x64) - 1 to 8 of them; LV2 needs `manifest.ttl`; size limit 300 MB;
the zip and every program file are checked against the blocked-hash list. Then a person reviews it.

**On the device (all platforms):** community plugins stay off unless that device's **Allow community plugins** is on
(off by default; on the Central Pedal it's kept by the driver, on computers by the app). They unpack into their own
folder (`<data>/libraries/community-plugins/<id>/`), every program file checked again against the sha256 recorded at
review, links and paths outside the folder refused. The apps check the website's **revoke list** on start and every 6
hours: anything Motion Audio took down, or holding a blocked program file, is removed. Every plugin shows
"Community plugin - made by <creator>, checked by Motion Audio", and anyone can report it.

## Playing them live - what runs where

A community plugin is someone else's program, so it **never loads inside our own processes** - not in the rig on
computers (`cu-rig`), not in the Central Pedal's PipeWire filter-chain, not in the pedal driver or the apps. Each one
runs in a process of its own, **`cm-plugbridge`** (`central-usage/native/cm-plugbridge.cpp` +
`plughost/bridge_main.cpp`: our plugin host, without windows, hosting exactly that one plugin), started inside a wall,
and its audio crosses over **shared memory** (`plughost/bridge.h`):

* The engine fills a shared block (stereo in, up to 64 MIDI messages), writes a 4-byte sequence number on a socket, and
  waits for the answer for at most **60% of the block's time** (1-20 ms; 1.6 ms for 128 frames at 48 kHz). On time,
  the plugin's output is used (NaN / runaway values become silence); late, that block plays **dry** and the answer is
  picked up with the next one - **the sound never stops waiting for a plugin**. Measured in the test on a shared
  machine: about 0.2 ms per 128-frame block round trip (p99 under 0.6 ms), no added latency in samples.
* **The watchdog** (`plughost/bridge_client.c`, on the engine's side): no answer for 1.5 s → *stopped responding*; the
  socket closes or the process dies → *crashed*; more than half its blocks late over about 2 s → *too heavy for this
  device*. Each one **bypasses** the plugin (dry from then on), kills its process, and tells the app
  (`{"type":"pluginBypassed","uid","reason":"crashed"|"hung"|"heavy"}`). The board shows it bypassed with the reason and
  a **Try again** button (`pluginRestart`: loaded afresh, from its saved state).
* **CPU and memory limits** (Linux, set by `cm-plugbridge` before the plugin loads): a real-time thread that doesn't
  yield for 0.2 s is killed by the kernel (`RLIMIT_RTTIME`), at most 1.5 GB of its own memory (`RLIMIT_DATA`), no core
  dumps; together with the per-block budget above.
* **Parameters and presets** cross the wall on a control socket: the app's quick controls (`pluginParams` /
  `pluginSet`), and the plugin's state saved with the slot like any plugin's (`<data>/plugin-states/<uid>.state`),
  restored into a fresh process. Community plugins have **no editor window** (the wall has no window system); their
  quick controls are what the app shows.
* **Every time it starts** (not only at install), `plughost/fmt_remote.cpp` checks: the device's **Allow community
  plugins** switch is on; its library's record lists it; and **each program file still matches the sha256 Motion Audio
  reviewed**. Otherwise it doesn't start, and the app says why.
* **Revoked or switched off - live:** about once a second the engine checks the switch and the plugin's folder. Switching
  community plugins off, or the revoke list removing the library (its folder goes), stops the process **while it plays**
  (`reason: "off"` / `"revoked"`), the board plays on dry, and the app takes the item off its boards.

### The wall, per platform

| | Central Pedal (Raspberry Pi) | Linux computers | macOS | Windows |
| --- | --- | --- | --- | --- |
| Plays them | the **community stage** `cm-pwnode` (below) | the rig, `cu-rig` | the rig, `cu-rig` | **no** |
| Wall | bubblewrap + seccomp | bubblewrap + seccomp | `sandbox-exec` | - |
| Formats | LV2, CLAP, VST3 | LV2, CLAP, VST3 | CLAP, VST3 (not AU) | - |

* **Linux and the Central Pedal - bubblewrap** (`wallArgv` in `plughost/fmt_remote.cpp`; the same command as
  `community_sandbox.py` / `community-sandbox.js`): `--unshare-all` (its own network - none -, IPC, PID, UTS and cgroup
  namespaces), `--cap-drop ALL`, `--die-with-parent`, `--new-session`, `--clearenv`; the system read-only (`/usr`,
  `/lib`, the loader's files), **the plugin's own folder read-only at `/plugin`**, `cm-plugbridge` read-only, an empty
  `/tmp` and `HOME` (its only writable place, gone when it stops), a minimal `/dev`, its own `/proc`. Nothing of the
  musician's is visible; **no PipeWire or other socket is shared in** - the audio comes over the shared memory the
  engine handed it. Then, **before the plugin's code runs at all**, `cm-plugbridge` puts up a **seccomp filter** itself
  (`cmb_seccomp`, raw BPF, no library needed): `no_new_privs`; refused: ptrace and reading other processes' memory,
  mount / pivot_root / chroot, kernel modules, kexec, bpf, perf, keyrings, `unshare` / `setns` and `clone` with
  namespace flags (`clone3` says "not here" so the C library uses `clone`), personality, userfaultfd, setting the clock,
  **starting programs** (`execve`), and **any socket but a local one** (no internet, netlink, raw or packet sockets).
  Needs the `bubblewrap` package (`setup-pi.sh` installs it with `liblilv-0-0` and `python3-seccomp`; on a Linux
  computer: `sudo apt install bubblewrap`). Without bubblewrap, community plugins don't run (the app says so) -
  never unwalled.
* **macOS - `sandbox-exec`** with a deny-by-default profile: no network; the only program it may start is
  `cm-plugbridge` itself (so the plugin can't start anything); reads only the system libraries, `/Library/Audio`, the
  dyld cache, `cm-plugbridge`'s folder and the plugin's folder; reads and writes only its own temporary folder (made
  per plugin, removed after); no Mach services but the system logger. The audio comes over shared memory, so it doesn't
  need Core Audio either. Audio Units plugins aren't hosted walled off (Apple loads them through its own services), so a
  community AU doesn't run. (`sandbox-exec` is deprecated by Apple but still works; the long-term route is an XPC
  helper with the App Sandbox.)
* **Windows - not walled off, so not offered.** No switch in Settings, community plugins say they can't run walled off
  there, and the engine refuses them (`fmt_remote.cpp`). Offering them needs a restricted token at low integrity /
  AppContainer inside a job object (no child processes, no network, no writes outside its folder) - not built yet.

### The Central Pedal: the community stage

The Pi's pedals run in a PipeWire filter-chain (`instrument_host.py`), which only loads our own LV2 / LADSPA pedals.
When a board has community plugins on it, `instrument_host.py` also starts **`cm-pwnode`**
(`central-usage/native/cm-pwnode.c`): one small PipeWire node (`cm-community`, 2 in, 2 out, libpipewire loaded at run
time) that plays the board's community plugins **in series, after the board's own pedals**, each through its own walled
`cm-plugbridge`, and links it: input → `padpedal-guitar` (or `-keys`) → `cm-community` → the outputs. It refuses any
plugin that isn't a community one. Light on the Pi 4: no plugin code runs in `cm-pwnode`; its audio thread only copies
blocks to and from shared memory; it isn't running at all while no board has a community plugin. Each plugin's on /
off and mix change live; its quick controls, presets and Try again go through the same messages as on computers.
`cm-plugbridge` and `cm-pwnode` ship for arm64 in the Pi release (`bin/linux-aarch64/`, built in CI), or are built on
the Pi the first time (`make`, `g++`, the lilv and PipeWire headers).

**Not played as community plugins:** the Studio and track / pad effects play in the browser (Web Audio), where native
plugins don't run - community plugins go on instrument boards (the pedal board and keys chains) on the Central Pedal
and on Mac / Linux computers.

### Tests

`central-usage/native/plughost/test/test-plugin-wall.mjs` (`make test-wall`; in CI on Linux and macOS) installs test
plugins the way the apps do and checks, through the plugin host and through `cu-rig`: audio round-trips with bounded
latency, parameters and presets cross the wall, the misbehaving test plugin (`evil-test.clap`) can't send a packet to
the internet, read or write a file outside its folder, or start a program; when it crashes, hangs or is too heavy it
is bypassed while every block still comes back (dry) on time; a changed program file doesn't start; a revoked or
switched-off plugin is stopped live and its process is gone; and the Pi's community stage hosts, refuses and revokes
the same way (its PipeWire node itself needs a PipeWire server, which CI doesn't have). `test_community.py` checks the
Pi side's wiring, `test-libraries.mjs` the board (Add pedal → Community, the label, the bypassed notice, Try again).
