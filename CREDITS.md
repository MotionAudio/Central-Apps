# Credits

Central is made by Motion Audio. These parts come from other people, under the licences named.

## Lighting
- **Open Fixture Library** (https://open-fixture-library.org) - real light profiles. MIT licence.
- **QLC+ fixture definitions** (https://www.qlcplus.org) - real light profiles. Apache License 2.0.
  Where a light is in both, the Open Fixture Library version is used. Both are converted by
  `tools/make-fixture-library.py` into the offline library the lights page reads.

## Sounds
- **Versilian Community Sample Library (VCSL)** by Versilian Studios - CC0 1.0.
- **VSCO 2 Community Edition** by Versilian Studios - CC0 1.0.
- Everything else (pads, synths, loops, hymn arrangements, clicks, impulse responses, lyric backgrounds) is made by
  Motion Audio's own code in `tools/`, `central-usage/app/backgrounds.js` and `central-usage/app/backgrounds-seasons.js`
  (the seasonal set: every scene, silhouette and texture is drawn by that code; no stock photos).

## Words
- **Bibles**: King James Version, World English Bible, American Standard Version (1901) and Reina-Valera 1909 -
  public domain.
- **Hymns**: words and tunes published before 1929 (public domain in the US); the arrangements are Motion Audio's.

## Software
- **pdf.js** (Mozilla) - Apache License 2.0.
- **three.js** - MIT licence.
- **llama.cpp** - MIT licence. **Qwen2.5-0.5B-Instruct** (Alibaba Cloud) - Apache License 2.0.
- **FFmpeg** 9.0.2 (the pinned GPL build bundled with Central Control, run as a separate program for video, shorts and
  converting TIFF / HEIC pictures) - GNU GPL v3; where its source is: `tools/fetch-ffmpeg.sh` and LICENSE.ffmpeg.txt.
- **Electron**, **Capacitor** and the npm packages listed in each app's `package.json` - their own licences.
- **Archivo** and **Inter** fonts - SIL Open Font License 1.1.
- **VST3 SDK** (Steinberg) - MIT licence (the copy in `central-usage/native/vendor/vst3sdk`), for plugin hosting;
  **CLAP** - MIT licence.
