# Sound libraries

One library per sound plan, each a versioned zip with a `manifest.json`, `CREDITS.txt` and `sounds/CREDITS.txt` (every
source of every sound and IR: what it is, its license, its URL). Anyone can download them (the website's Downloads page,
or Settings → Packages → Libraries in any app); what's inside only opens with the plan's package key. Central Pads comes
with every other plan, so its library opens with any package key.

| Library | Plan | Sound banks (presets) | Sources and licenses | Size (est.) |
|---|---|---|---|---|
| Central Keys Library 1.1 | Central Keys | **Grand Pianos** (Concert Grand - Steinway B, Studio Grand - Kawai, Soft Grand, Grand & FM, FM Piano 2), **Pianos** (Upright, Soft Upright, FM Piano, FM & Upright, Clavisynth, Harpsichord), **Organs** (Pipe Organ with pedals, manual only, Quiet, Swell, Positive), **Mallets** (Vibraphone soft / hard, Marimba, Xylophone, Glockenspiel, Tubular Bells, Church Bells, Hand Chimes, Chime Pad, Vibes & Chimes), **Pads** (Warm, Air, Choir Aah, Choir Ooh, Shimmer, String, Glass, Swell, Worship), **Synths** (10.0: Saw / Square / Soft Lead, Synth Brass, Super Saw, String Machine, Sub Bass, Synth Bass, Pluck, Electric Bells) + 32 presets | VCSL (CC0 1.0); pads and synths made by us (`tools/make-synths.py`) | about 450 MB |
| Central Instrument Library 1.1 | Central Instrument | **Drum Kits** (Studio, Rusty Rock, Unruly, Brushes), **Guitars and Basses** (Gretsch hollowbody, Hofner archtop, clean electric, upright bass plucked / bowed, jazz bass, hollowbody bass, 10.0: electric upright bass plucked / bowed), **Saxophones** (alto, baritone, sax section), **Harps**, **Winds** (recorders, harmonicas, tenor sax, saxello, ocarina), **World** (dan tranh, psaltery bowed / plucked, balafon, mbira, kalimba), **Percussion** (hand and orchestral kits) + 30 presets; 10.0: **Drum loops** for the texture channels (10 grooves at 70 and 100 BPM, played on the drum kits) | VCSL (CC0); Virtuosity Drums, Karoryfer Big Rusty Drums, Unruly Drums, Black And Green Guitars, Emily Guitar, Meatbass, Growlybass, Big Little Bass, Weresax, Bear Sax, Ergo (all CC0 1.0, sfzinstruments on GitHub); drum loops written and rendered by us (`tools/make-loops.py`) | about 560 MB |
| Central Plugins Library 1.1 | Central Plugins | **Textures** (Ambient Drone; Transitions: risers, downlifter, sub drop, cymbal swells, reverse cymbal / crash / gong, impact, wind, shimmer hit) + 2 presets and 22 boards (10.0: four more for the new studio tools) | made by us; cymbals, gong, bass drum from VCSL (CC0) | about 12 MB |
| Central Pads Library 1.1 | Central Pads (and every other plan) | 20 pads for the pad pedal - Warm, Air, Choir Aah, Choir Ooh, Shimmer, Strings, Glass, Swell, Worship, Ambient Drone, Deep, Heaven, and in 10.0 Felt, Organ, Analog, Bowed, Bells, Choir Hum, Cinematic, Morning - each a seamless 6-second stereo loop of the key's chord (root, fifth, octave) in all 12 keys (`pads/<style>/<key>.wav`, C# as `Cs`); the pad pedal plays the song's key as it is, no pitch shifting; 10.0: **Ambient loops** for the texture channels (Sparkle, Drift, Breath, 12 s in every key) | made by us (`tools/make-pad-loops.py`, `tools/make-loops.py`, synthesised, no recording) | about 240 MB |
| Central Pedals Library 1.1 | Central Pedals | 28 impulse responses for the IR loader (7 guitar cabinets × centre / edge / room mic, 3 bass cabinets, 4 acoustic bodies) + 26 boards that use them and the 10.0 pedals | made by us (`tools/make-irs.py`, no recording) | under 1 MB |

Every source was checked on its own page:
- Ergo (10.0) - https://github.com/sfzinstruments/karoryfer.ergo at `c3232f03…`: LICENSE CC0 1.0, readme "Royalty-free for all commercial and
  non-commercial use".
- VCSL - https://github.com/sgossner/VCSL at `c1ea7bcc…`: "CC0 1.0, no special terms" (LICENSE, README).
- sfzinstruments / Karoryfer - each repository's LICENSE is CC0 1.0 Universal; the Karoryfer readmes add
  "Royalty-free for all commercial and non-commercial use". Pinned commits are in `tools/sounds-sfz.py`.
- The pads, textures and IRs are synthesised here, so they are ours.

Also found with CC0 licenses in 10.0 and not used yet: Ganjo (a six-string banjo), Gogodze Phu Vol II (a vintage kit),
Squidpipes, Caveman Cosmonaut, Cowsynth and String Cyborgs (Karoryfer). The last four are Sforzando synths whose sound
depends on its filters and envelopes, which a plain SoundFont render would lose; the first two are good candidates.

## Central Tracks hymns (10.0)

Not a library: Motion Audio's own multitracks of public-domain hymns, sold in Central Tracks (one track each, and part
of Central Tracks Unlimited). `hymns/hymns.json` holds each hymn's words (public domain), chords per bar, form and the
energy of each section; `tools/make-hymns.py` arranges and renders the stems on the libraries' own sounds (drums, bass,
grand piano, pad, clean electric, strings, plus a click and spoken section cues), and writes a song file with the
sections, lyrics, chords and a chord chart, so the apps don't have to guess any of it. CI renders them after the
libraries and publishes them on the GitHub release `central-tracks` with `hymns-index.json`; the website lists each hymn
once that index is there (`server/src/hymns.js`, `HYMNS_BASE_URL`). A hymn is only added when its words and tune were
published before 1929 and every writer died more than 70 years ago (`make-hymns.py --check`); modern worship songs and
recordings of anyone else's are never used.

Looked at and not used:
- **jRhodes3d** (sfzinstruments) - samples CC BY-NC 4.0: no commercial redistribution.
- **Salamander Drumkit** - CC BY-SA 3.0: share-alike applies to new sample libraries made from it, and BY-SA forbids
  technological measures that restrict recipients (our plan lock).
- **Splendid Grand Piano** - "public domain" is stated only by the repackager (the Akai release ~2000 can't be traced to a
  primary source), so it isn't sold. VCSL's Steinway B and Kawai grands are used instead.
- **University of Iowa MIS** - terms are clean ("may be downloaded and used for any projects, without restrictions"), but
  most instruments come as chromatic runs in one file that would need splitting, and the site can't be listed from the
  build machines here; a candidate for a later version.
- **Freesound CC0 items** - downloading original files needs a Freesound account token (OAuth2) for every file, so CI
  can't fetch them without a secret; previews are lossy MP3. A candidate later, with a `FREESOUND_TOKEN` secret and each
  sound's URL in the credits.
- **Sonatina Symphonic Orchestra** - Creative Commons Sampling Plus 1.0: not a clean commercial license.
- **Click / count-in voice sets ("Central Tracks starter")** - no app reads library clicks yet, and no voice set with a
  clean license was found (synthesised voices from TTS models have mixed model licenses); left out.
- **VCSL wine glasses, tubular glockenspiel** - only four notes / a non-standard tuning: not playable as keys.

## Building

- `libraries.json` - what each library holds (sounds with their sources, IRs, presets, boards). Raise a library's
  `version` when it changes.
- `tools/sounds-vcsl.py` (VCSL), `tools/sounds-sfz.py` + `tools/sfz_render.py` (the SFZ libraries: every microphone at a
  key and velocity mixed into one mono note), `tools/make-pads.py` (pads, textures), `tools/make-irs.py` (IRs),
  `tools/build-libraries.py` (the zips, `libraries-index.json`, `SHA256SUMS`; a zip over 1.5 GB stops the build).
- `tools/build-libraries.sh [out]` runs them all locally (needs numpy and ffmpeg); CI does the same:
  **.github/workflows/libraries.yml** (by hand from Actions, and when these files change on main or release/9.8.0)
  and publishes to the GitHub release tagged `libraries` (a pre-release, never "latest", so the apps' update checks
  never see it).
- After changing `libraries.json`: `python3 tools/build-libraries.py --write-builtin server/src/libraries-builtin.json`
  (the list the website shows until an index is published; `test_libraries.py` checks it).

## Where the files are, and switching to Cloudflare R2

Today: `https://github.com/MotionAudio/central-apps/releases/download/libraries/<file>` - the website's default
`LIBRARIES_BASE_URL` (the repository is public, so anyone can download them).

To move to Cloudflare R2: make a bucket with public access (a custom domain or r2.dev), an API token with Object Read &
Write on it, put `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in GitHub → Settings →
Secrets (never in a chat or a file), set the repository variables `R2_UPLOAD = on` and `R2_PUBLIC_URL = <the bucket's
public address>`, run the workflow, then set `LIBRARIES_BASE_URL` on Render to the same public address. The details are
at the top of `.github/workflows/libraries.yml`.

## Installing (the apps)

- The Central Pedal: its driver (`libraries.py`): `GET /libraries`, `POST /libraries/install` (url, sha256, size from
  the website's list), `PUT /libraries/file` (Install from a file…), `POST /libraries/remove` - local app only.
  Central Pads: `GET /libraries/pads` (the installed styles and their keys - the pad pedal's voice list, "Central Pads")
  and `GET /libraries/pad?lib=&style=&key=` (one loop, a WAV). A pad set to a Central Pads voice plays the loop of the
  song's key; without a plan it plays the free Warm Pad voice instead.
- Computers (Central Control / Central Usage): `central-usage/libraries.js` in the app, into the built-in rig's folders.
- Both check the download's sha256 before unpacking, every file's sha256 from the manifest, and write each sound's and
  IR's plan to its folder's `tiers.txt` (any plan - Central Plugins has a sound bank too); the app keeps the plan on the
  presets and boards. Without the plan they show locked.
