# Credits

Motion Audio makes Central, but plenty of it is built on work other people shared. These are the parts that came from someone else, and the licence each one is under.

## Lighting

- **Open Fixture Library** (https://open-fixture-library.org) for real light profiles, under the MIT licence.
- **QLC+ fixture definitions** (https://www.qlcplus.org) for more light profiles, under the Apache License 2.0.

Where a light is in both, the Open Fixture Library version is used. `tools/make-fixture-library.py` turns both into the offline library the lights page reads.

## Sounds

- **Salamander Grand Piano V3** by Alexander Holm, under CC-BY 3.0 (archive.org/details/SalamanderGrandPianoV3), with the SFZ mapping by kinwie (sfzinstruments). It's the piano in the hymn tracks and the big grand in Central Keys. CC-BY means it has to be credited wherever the tracks or sounds are sold.
- **FreePats** sound banks (freepats.zenvoid.org and github.com/freepats), under CC0 or CC-BY 3.0 depending on the bank. This includes the YDP Grand Piano (CC-BY 3.0). `get-sounds.sh` writes a `CREDITS.txt` next to the banks with each one's author and licence.
- **Virtuosity Drums** by Austin McMahon, recorded at Virtuosity Musical Instruments in Boston, under CC0 1.0 (sfzinstruments).
- **Growlybass** and **Black And Green Guitars** by Karoryfer Samples (Brian Wood), under CC0 1.0 (sfzinstruments).
- **Versilian Community Sample Library (VCSL)** and **VSCO 2 Community Edition** by Versilian Studios, under CC0 1.0.
- **Greg Sullivan E-Pianos** (Wurlitzer EP200, Yamaha CP80, Hohner Pianet T) recorded by Greg Sullivan, SFZ by kinwie, under CC-BY 3.0 (github.com/sfzinstruments/GregSullivan.E-Pianos). The electric pianos in Central Keys since 10.5 - credited on the bank and in each library's CREDITS.txt.
- **Gogodze Phu Vol II** (the Lo-fi Kit), **Swirly Drums** (the Vintage Kit), **Sneakybass** (the Quiet Upright Bass) by Karoryfer Samples, and **ganjo** (the Banjo), all under CC0 1.0 (sfzinstruments) - in Central Instrument since 10.5.
- **Splendid Grand Piano** sampled by AKAI and released as public domain (2000), with the SFZ mapping from sfzinstruments (github.com/sfzinstruments/SplendidGrandPiano) - the Pop Grand in Central Keys since 10.5.
- The guide voice in the hymn tracks is the **Piper** LJSpeech voice (MIT), trained on the **LJ Speech** dataset (public domain).

The pads, synths, loops, clicks, impulse responses and lyric backgrounds are made by Motion Audio's own code in `tools/`, `central-usage/app/backgrounds.js` and `central-usage/app/backgrounds-seasons.js`. Every scene, silhouette and texture in the seasonal backgrounds is drawn by that code. There are no stock photos.

Each sound library and the Central Tracks release carry their own `CREDITS.txt` listing exactly what's inside.

## Guitar pedals on the Central Pedal

The pedals on the Pi are built from free LV2 and LADSPA plugins installed in the image: **Guitarix**, **Calf**, **Invada**, **TAP**, **CAPS**, **swh**, **x42**, **Dragonfly**, **ZamAudio**, **MDA** and others. Each keeps its own licence, mostly the GNU GPL, and comes from Raspberry Pi OS's own packages.

## Words

- **Bibles:** the King James Version, World English Bible, American Standard Version (1901) and Reina-Valera 1909, all in the public domain.
- **Hymns:** words and tunes published before 1929, which are in the public domain in the US. The text comes from the **Open Hymnal** (github.com/mzealey/openhymnal, a copy of openhymnal.org), and each hymn was checked as public domain before it was used. The arrangements are Motion Audio's.

## Software

- **pdf.js** (Mozilla), under the Apache License 2.0.
- **three.js**, under the MIT licence.
- **llama.cpp**, under the MIT licence, and **Qwen2.5-0.5B-Instruct** (Alibaba Cloud), under the Apache License 2.0.
- **FFmpeg** 9.0.2, the pinned GPL build bundled with Central Control. It runs as a separate program for video, shorts and converting TIFF and HEIC pictures. It's under the GNU GPL v3. `tools/fetch-ffmpeg.sh` fetches it and writes `LICENSE.ffmpeg.txt` next to it, which says where its source is.
- **FluidSynth** plays the keys on the Pi, under the GNU LGPL 2.1.
- **Electron**, **Capacitor** and the npm packages listed in each app's `package.json`, each under its own licence.
- The **Archivo** and **Inter** fonts, under the SIL Open Font License 1.1.
- The **VST3 SDK** interface headers (Steinberg), under the MIT licence (the copy in `central-usage/native/vendor/vst3sdk`), and **CLAP**, under the MIT licence, for hosting your own plugins.
- **miniaudio**, **TinySoundFont** and **cJSON** in `central-usage/native/vendor/`, each under its own licence (public domain or MIT).
