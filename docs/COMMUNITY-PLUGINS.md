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

**Walled-off running:**

* **Central Pedal (Raspberry Pi) and Linux computers** - `community_sandbox.py` / `central-usage/community-sandbox.js`
  build the bubblewrap command: own namespaces (no network), no capabilities, `--die-with-parent`, `--new-session`,
  read-only system, the plugin read-only at `/plugin`, empty `/tmp` and `HOME`, minimal `/dev`, own `/proc`, only the
  PipeWire socket shared in; on the Pi a seccomp filter (python3-seccomp) refuses ptrace, mount, kernel modules, bpf,
  keyrings, namespaces, perf and internet / netlink / raw sockets. *Needs the `bubblewrap` (and `python3-seccomp`)
  packages on the image.*
* **macOS** - `sandbox-exec` with a deny-by-default profile: no network, no launching programs, reads only the system
  libraries, audio parts and the plugin's folder, writes only to its own temporary folder, reaches only Core Audio.
  (`sandbox-exec` is deprecated by Apple but still works; the long-term route is an XPC helper with the App Sandbox.)
* **Windows** - **not walled off yet.** The plan is a restricted token at low integrity inside a job object (no child
  processes, no writes outside its folder), which needs native code in the plugin host. Until then the apps don't offer
  community plugins on Windows (no switch; plugins say why).

**Not done yet (honestly):** the hosts that play plugins live - the built-in rig on computers (`cu-rig`, in-process
plughost) and the Central Pedal's PipeWire filter-chain - don't yet start community plugins through these walls. So
today community plugins can be uploaded, reviewed, downloaded, kept and revoked, but they are not played live until the
hosts run them out of process (cu-rig's `--scan-one` child and a per-plugin host such as `jalv` on the Pi, both through
`wrap()` / `community_sandbox.start()`).
