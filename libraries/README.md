# Sound libraries

One library per sound plan, each a versioned zip with a `manifest.json`. Anyone can download them (the website's
Downloads page, or Settings → Packages → Libraries in any app); what's inside only opens with the plan's package key.

| Library | Plan | What's in it | Source and license | Size |
|---|---|---|---|---|
| Central Keys Library 1.0 | Central Keys | 3 SoundFonts: **Pianos** (Upright Piano, Soft Upright, FM Piano, FM Piano & Upright, Clavisynth, Harpsichord), **Organs** (Pipe Organ with pedals, manual only, Quiet Organ, Organ Swell, Positive Organ), **Mallets** (Vibraphone soft / hard, Marimba, Glockenspiel, Tubular Bells, Hand Chimes, Chime Pad, Vibes & Chimes) + 12 presets | VCSL (Versilian Studios), CC0 1.0 | about 150 MB |
| Central Instrument Library 1.0 | Central Instrument | 3 SoundFonts: **Harps** (Folk Harp, Concert Harp, Harp Pad, Kalimba, Strumstick), **Winds** (Alto / Tenor Recorder, Recorder Consort, Harmonica, Tenor Sax, Ocarina), **Percussion** (Hand Percussion and Orchestral Percussion kits) + 11 presets | VCSL, CC0 1.0 | about 105 MB |
| Central Plugins Library 1.0 | Central Plugins | 11 mix-ready boards (ambient electric, dotted-eighth lead, swell pad, studio electric, acoustic and bass channel strips, keys pad / piano polish / room for vocals) | ours | under 0.1 MB |
| Central Pedals Library 1.0 | Central Pedals | 14 impulse responses for the IR loader (7 guitar cabinets, 3 bass cabinets, 4 acoustic bodies) + 14 boards that use them | ours (synthesised by `tools/make-irs.py`, no recording) | under 0.2 MB |

VCSL: https://github.com/sgossner/VCSL at commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e` - "CC0 1.0, no special
terms" (its LICENSE and README). Its file list at that commit is `tools/vcsl-names.txt`. No IR from anyone else is used:
the cabinets and bodies are drawn from filter and resonance models, so they are ours to sell. Reverb IRs are left out on
purpose: the computers' built-in rig keeps only the first 4096 samples (85 ms) of an IR, enough for a cabinet, not a hall.

## Building

- `libraries.json` - what each library holds (sounds, IRs, presets, boards). Raise a library's `version` when it changes.
- `tools/sounds-vcsl.py` - the VCSL SoundFonts (downloads each WAV, renders it mono and levelled, deletes it).
- `tools/make-irs.py` - the IRs. `tools/build-libraries.py` - the zips, `libraries-index.json`, `SHA256SUMS`.
- `tools/build-libraries.sh [out]` runs all three locally; CI does the same: **.github/workflows/libraries.yml** (by hand
  from Actions, and when these files change on main) and publishes to the GitHub release tagged `libraries` (a
  pre-release, never "latest", so the apps' update checks never see it).
- After changing `libraries.json`: `python3 tools/build-libraries.py --write-builtin server/src/libraries-builtin.json`
  (the list the website shows until an index is published; `test_libraries.py` checks it).

## Where the files are, and switching to Cloudflare R2

Today: `https://github.com/MotionAudio/central-apps/releases/download/libraries/<file>` - the website's default
`LIBRARIES_BASE_URL`. (Release downloads need the repository to be public; if it is private, use R2.)

To move to Cloudflare R2: make a bucket with public access (a custom domain or r2.dev), an API token with Object Read &
Write on it, put `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in GitHub → Settings →
Secrets (never in a chat or a file), set the repository variables `R2_UPLOAD = on` and `R2_PUBLIC_URL = <the bucket's
public address>`, run the workflow, then set `LIBRARIES_BASE_URL` on Render to the same public address. The details are
at the top of `.github/workflows/libraries.yml`.

## Installing (the apps)

- The Central Pedal: its driver (`libraries.py`): `GET /libraries`, `POST /libraries/install` (url, sha256, size from
  the website's list), `PUT /libraries/file` (Install from a file…), `POST /libraries/remove` - local app only.
- Computers (Central Control / Central Usage): `central-usage/libraries.js` in the app, into the built-in rig's folders.
- Both check the download's sha256 before unpacking, every file's sha256 from the manifest, and write each sound's and
  IR's plan to its folder's `tiers.txt`; the app keeps the plan on the presets and boards. Without the plan they show
  locked.
