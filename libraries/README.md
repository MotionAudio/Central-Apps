# Sound libraries

One library per sound plan, each a versioned zip with a `manifest.json`, `CREDITS.txt` and `sounds/CREDITS.txt` (every
source of every sound and IR: what it is, its license, its URL). Anyone can download them (the website's Downloads page,
or Settings → Packages → Libraries in any app); what's inside only opens with the plan's package key.

| Library | Plan | Sound banks (presets) | Sources and licenses | Size (est.) |
|---|---|---|---|---|
| Central Keys Library 1.0 | Central Keys | **Grand Pianos** (Concert Grand - Steinway B, Studio Grand - Kawai, Soft Grand, Grand & FM, FM Piano 2), **Pianos** (Upright, Soft Upright, FM Piano, FM & Upright, Clavisynth, Harpsichord), **Organs** (Pipe Organ with pedals, manual only, Quiet, Swell, Positive), **Mallets** (Vibraphone soft / hard, Marimba, Xylophone, Glockenspiel, Tubular Bells, Church Bells, Hand Chimes, Chime Pad, Vibes & Chimes), **Pads** (Warm, Air, Choir Aah, Choir Ooh, Shimmer, String, Glass, Swell, Worship) + 25 presets | VCSL (CC0 1.0); pads made by us | about 420 MB |
| Central Instrument Library 1.0 | Central Instrument | **Drum Kits** (Studio, Rusty Rock, Unruly, Brushes), **Guitars and Basses** (Gretsch hollowbody, Hofner archtop, clean electric, upright bass plucked / bowed, jazz bass, hollowbody bass), **Saxophones** (alto, baritone, sax section), **Harps**, **Winds** (recorders, harmonicas, tenor sax, saxello, ocarina), **World** (dan tranh, psaltery bowed / plucked, balafon, mbira, kalimba), **Percussion** (hand and orchestral kits) + 30 presets | VCSL (CC0); Virtuosity Drums, Karoryfer Big Rusty Drums, Unruly Drums, Black And Green Guitars, Emily Guitar, Meatbass, Growlybass, Big Little Bass, Weresax, Bear Sax (all CC0 1.0, sfzinstruments on GitHub) | about 520 MB |
| Central Plugins Library 1.0 | Central Plugins | **Textures** (Ambient Drone; Transitions: risers, downlifter, sub drop, cymbal swells, reverse cymbal / crash / gong, impact, wind, shimmer hit) + 2 presets and 18 boards | made by us; cymbals, gong, bass drum from VCSL (CC0) | about 12 MB |
| Central Pedals Library 1.0 | Central Pedals | 28 impulse responses for the IR loader (7 guitar cabinets × centre / edge / room mic, 3 bass cabinets, 4 acoustic bodies) + 22 boards that use them | made by us (`tools/make-irs.py`, no recording) | under 1 MB |

Every source was checked on its own page:
- VCSL - https://github.com/sgossner/VCSL at `c1ea7bcc…`: "CC0 1.0, no special terms" (LICENSE, README).
- sfzinstruments / Karoryfer - each repository's LICENSE is CC0 1.0 Universal; the Karoryfer readmes add
  "Royalty-free for all commercial and non-commercial use". Pinned commits are in `tools/sounds-sfz.py`.
- The pads, textures and IRs are synthesised here, so they are ours.

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
- Computers (Central Control / Central Usage): `central-usage/libraries.js` in the app, into the built-in rig's folders.
- Both check the download's sha256 before unpacking, every file's sha256 from the manifest, and write each sound's and
  IR's plan to its folder's `tiers.txt` (any plan - Central Plugins has a sound bank too); the app keeps the plan on the
  presets and boards. Without the plan they show locked.
