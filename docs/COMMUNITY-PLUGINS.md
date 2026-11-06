# Make & sell, and community plugins

Musicians make samples, loops, pads, instruments, pedal boards and plugins on the website, either through **Make & sell** at `/create/` or in the browser studio at `/studio/`. A machine checks every upload first, and then a person reviews it on the review site before anyone can download it. Approved items belong to a sound plan and show up in the apps on the **Community** tab under Packages in Settings.

| What | Sound plan | Installs as |
| --- | --- | --- |
| Loops, pads | Central Pads | library `loop` or `pad` items |
| Samples, instruments | Central Keys or Central Instrument (the creator picks) | a SoundFont (`sound`). WAVs by note and SFZ are turned into an .sf2 when they're uploaded. |
| Pedal boards | Central Pedals | `board` |
| Plugins | Central Plugins | `plugin`. Older apps don't know this kind and skip it. |
| Tracks | Central Tracks | the usual publishing flow, with review |

Each item becomes an ordinary library zip with a `manifest.json`, a sha256 for every file and the id `community-<n>`. That means the installers we already have (`libraries.py` on the pedal, `central-usage/libraries.js` on computers) install it, locked to its plan.

## Review and who does what

The review site has its own address, `/review-<20 hex>`, worked out from `TOKEN_SECRET` (or set with `REVIEW_PATH`). No public page links to it, it's sent with `noindex` and `no-store`, and every call needs a signed-in staff account plus the phone code. Staff find the link on their account page, which is the only place it's shown.

Review admins listen to uploads, read the checks, grade them from 1 to 5 stars, approve them, reject them with a reason (which is emailed to the creator) and take things down. The stars set a track's single-sale price and weight its share of the pool.

The owner account is `samuelbarfieldofficial@gmail.com`. It's built in alongside `ADMIN_EMAILS` and `OWNER_EMAILS`, and only counts once its email is confirmed. The owner also picks the review admins and sets the creators' share for each plan (with a history and the month each change starts), the minimum payout, Motion Audio's own star weight, and whether new Central Tracks uploads wait for review. That last one is on by default in production.

## The pool

Every month, each plan's money is shared between its creators. A yearly payment counts as a twelfth in each of its 12 months, split across the plans it pays for by their prices, and a payment that's refunded or disputed stops counting from then on. That monthly amount is multiplied by the creators' share (75% unless staff change it) and split by **downloads × stars**.

A download counts once per item, per downloader (a package key or an account), per month. Default and demo keys never count. Motion Audio's own library installs count towards the total at the official star weight, and Motion Audio keeps that part. Creators are paid with the monthly payouts through Stripe Connect, the same way Central Tracks publishers are, once they're owed at least the minimum.

## How plugins are checked

### When they're uploaded

`server/src/creatorfiles.js` does this for every platform. The creator uploads one zip per platform holding exactly one bundle (`.lv2`, `.vst3`, `.clap` or `.component`) and nothing else. The formats allowed depend on the platform:

| Platform | Formats |
| --- | --- |
| Linux x64 | LV2, VST3, CLAP |
| Central Pedal and Linux ARM | LV2 |
| Mac | VST3, CLAP, AU |
| Windows x64 | VST3, CLAP |

The zip can't hold links, anything outside its folder, scripts, installers or any other programs. There must be between 1 and 8 program files, and each has to be the right kind for its platform: ELF x86-64 or AArch64 `.so` files, Mach-O inside `Contents/MacOS`, or PE x64. LV2 bundles need a `manifest.ttl`. The limit is 300 MB. The zip and every program file are checked against the list of blocked hashes, and then a person reviews it.

### On the device

Community plugins stay off unless **Allow community plugins** is switched on for that device. It's off by default. On the pedal the driver keeps the setting, and on computers the app does.

A plugin unpacks into its own folder, `<data>/libraries/community-plugins/<id>/`. Every program file is checked again against the sha256 recorded at review, and links or paths that point outside the folder are refused. When the apps start, and every 6 hours after that, they check the website's **revoke list** and remove anything Motion Audio has taken down or anything holding a blocked program file. Every plugin is labelled "Community plugin - made by <creator>, checked by Motion Audio", and anyone can report one.

## Playing them live

A community plugin is somebody else's program, so it never loads inside any of our own processes. That rules out the rig on computers (`cu-rig`), the pedal's PipeWire filter-chain, the pedal driver and the apps. Instead each plugin runs in a process of its own called **`cm-plugbridge`** (`central-usage/native/cm-plugbridge.cpp` and `plughost/bridge_main.cpp`). That's our plugin host without any windows, hosting just that one plugin. It starts inside a wall, and the audio crosses over **shared memory** (`plughost/bridge.h`).

### Timing

The engine fills a shared block with stereo input and up to 64 MIDI messages, writes a 4-byte sequence number on a socket, and waits for the answer for at most **60% of the block's time**. That's between 1 and 20 ms, or 1.6 ms for 128 frames at 48 kHz. If the answer comes back in time, the plugin's output is used, with NaN or runaway values turned into silence. If it's late, that block plays **dry** and the answer is picked up with the next one. The sound never waits for a plugin. In the test, on a shared machine, a 128-frame block took about 0.2 ms to go there and back (p99 under 0.6 ms), with no added latency in samples.

### The watchdog

`plughost/bridge_client.c`, on the engine's side, watches for three things. No answer for 1.5 seconds means the plugin has stopped responding. A closed socket or a dead process means it crashed. More than half its blocks late over about 2 seconds means it's too heavy for the device. In any of those cases the plugin is **bypassed** and plays dry from then on, its process is killed, and the app is told with `{"type":"pluginBypassed","uid","reason":"crashed"|"hung"|"heavy"}`. The board shows the plugin as bypassed with the reason and a **Try again** button, which sends `pluginRestart` and loads it afresh from its saved state.

### Limits

On Linux, `cm-plugbridge` sets limits before the plugin loads. The kernel kills a real-time thread that doesn't yield for 0.2 seconds (`RLIMIT_RTTIME`). The plugin gets at most 1.5 GB of its own memory (`RLIMIT_DATA`) and no core dumps. The per-block time budget above applies on top of these.

### Parameters and presets

These cross the wall on a control socket. The app's quick controls use `pluginParams` and `pluginSet`. The plugin's state is saved with its slot like any other plugin's, in `<data>/plugin-states/<uid>.state`, and restored into a fresh process. Community plugins don't get an editor window, because there's no window system inside the wall. The quick controls in the app are all there is.

### Checks every time it starts

Not just at install: each time a community plugin starts, `plughost/fmt_remote.cpp` checks that the device's **Allow community plugins** switch is on, that its library's record lists it, and that **each program file still matches the sha256 Motion Audio reviewed**. If any of that fails, it doesn't start and the app says why.

### Turned off or revoked while it's playing

About once a second the engine checks the switch and the plugin's folder. If someone switches community plugins off, or the revoke list removes the library (and so its folder), the process stops **while it's playing** with `reason: "off"` or `"revoked"`. The board carries on dry and the app takes the item off its boards.

## The wall on each platform

| | Central Pedal (Raspberry Pi) | Linux computers | macOS | Windows |
| --- | --- | --- | --- | --- |
| Plays them | the **community stage**, `cm-pwnode` (below) | the rig, `cu-rig` | the rig, `cu-rig` | **no** |
| Wall | bubblewrap and seccomp | bubblewrap and seccomp | `sandbox-exec` | none |
| Formats | LV2, CLAP, VST3 | LV2, CLAP, VST3 | CLAP, VST3 (not AU) | none |

### Linux and the Central Pedal: bubblewrap

The command is built by `wallArgv` in `plughost/fmt_remote.cpp`, and it's the same one `community_sandbox.py` and `community-sandbox.js` use. It runs with `--unshare-all`, which gives the plugin its own network (that is, none), IPC, PID, UTS and cgroup namespaces, plus `--cap-drop ALL`, `--die-with-parent`, `--new-session` and `--clearenv`.

The system is mounted read-only (`/usr`, `/lib` and the loader's files), along with **the plugin's own folder at `/plugin`** and `cm-plugbridge` itself. The plugin gets an empty `/tmp` and `HOME`, which is the only place it can write and which disappears when it stops, a minimal `/dev` and its own `/proc`. It can't see anything of the musician's, and **no PipeWire socket or any other socket is shared in**. The audio arrives over the shared memory the engine hands it.

Then, **before any of the plugin's code runs**, `cm-plugbridge` puts up a **seccomp filter** itself (`cmb_seccomp`, written as raw BPF, so no library is needed). It sets `no_new_privs` and refuses ptrace and reading other processes' memory; mount, pivot_root and chroot; kernel modules, kexec, bpf, perf and keyrings; `unshare`, `setns` and `clone` with namespace flags (`clone3` is told "not here" so the C library falls back to `clone`); personality, userfaultfd and setting the clock; **starting programs** (`execve`); and **any socket that isn't local**, so no internet, netlink, raw or packet sockets.

This needs the `bubblewrap` package. `setup-pi.sh` installs it along with `liblilv-0-0` and `python3-seccomp`. On a Linux computer, run `sudo apt install bubblewrap`. Without it, community plugins don't run at all, and the app says so. They're never run without the wall.

### macOS: sandbox-exec

The profile denies everything by default. There's no network, and the only program the plugin's process may start is `cm-plugbridge` itself, so the plugin can't start anything. It can read the system libraries, `/Library/Audio`, the dyld cache, `cm-plugbridge`'s folder and the plugin's folder. It can read and write only its own temporary folder, which is made for that plugin and removed afterwards. The only Mach service it can reach is the system logger. Because the audio comes over shared memory, it doesn't need Core Audio either.

Audio Units can't be hosted behind the wall, because Apple loads them through its own services, so a community AU doesn't run. Apple has deprecated `sandbox-exec`, but it still works. The long-term plan is an XPC helper with the App Sandbox.

### Windows: not offered

There's no wall on Windows yet, so community plugins aren't offered there. Settings has no switch for them, the plugins say they can't run walled off on Windows, and the engine refuses them in `fmt_remote.cpp`. Offering them would need a restricted token at low integrity, or an AppContainer, inside a job object with no child processes, no network and no writes outside its folder. That hasn't been built.

## The community stage on the Central Pedal

The Pi's pedals run in a PipeWire filter-chain (`instrument_host.py`) that only loads our own LV2 and LADSPA pedals. When a board has community plugins on it, `instrument_host.py` also starts **`cm-pwnode`** (`central-usage/native/cm-pwnode.c`). It's one small PipeWire node called `cm-community`, with 2 inputs and 2 outputs and libpipewire loaded at run time. It plays the board's community plugins **one after another, after the board's own pedals**, each through its own walled `cm-plugbridge`, and links them up as input → `padpedal-guitar` (or `-keys`) → `cm-community` → the outputs. It refuses any plugin that isn't a community one.

It's light enough for a Pi 4. No plugin code runs inside `cm-pwnode`, its audio thread only copies blocks to and from shared memory, and it isn't running at all while no board has a community plugin. Each plugin's on/off switch and mix change live, and its quick controls, presets and Try again use the same messages as on computers.

`cm-plugbridge` and `cm-pwnode` ship for arm64 in the Pi release (`bin/linux-aarch64/`, built in CI). If they're missing, the Pi builds them the first time, which needs `make`, `g++`, and the lilv and PipeWire headers.

Community plugins don't play in the Studio or in track and pad effects. Those run in the browser on Web Audio, where native plugins can't. Community plugins go on instrument boards, meaning the pedal board and the keys chains, on the Central Pedal and on Mac and Linux computers.

## Tests

`central-usage/native/plughost/test/test-plugin-wall.mjs` runs with `make test-wall`, and in CI on Linux and macOS. It installs test plugins the same way the apps do, then checks through both the plugin host and `cu-rig` that:

- audio goes there and back with bounded latency, and parameters and presets cross the wall;
- the badly behaved test plugin (`evil-test.clap`) can't send a packet to the internet, read or write a file outside its folder, or start a program;
- a plugin that crashes, hangs or is too heavy is bypassed while every block still comes back on time (dry);
- a plugin whose program file has changed doesn't start;
- a revoked or switched-off plugin is stopped live and its process is gone;
- the Pi's community stage hosts, refuses and revokes plugins in the same way. Its PipeWire node needs a PipeWire server, which CI doesn't have.

`test_community.py` checks the wiring on the Pi side, and `test-libraries.mjs` checks the board: Add pedal → Community, the label, the bypassed notice and Try again.
