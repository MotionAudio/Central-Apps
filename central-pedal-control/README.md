# Central Pedal Control (macOS, Windows, Linux, iPhone, iPad, Android)

The Central Pedal app away from the Central Pedal. You can:
- make the setlist
- add songs: your own stems, a whole song through the stem splitter, MultiTracks.com and Loop Community downloads,
  or Central Tracks
- set up the pads, the buttons and knobs, the instrument and the look

Then **⇪ Upload** them to the Central Pedal (the Raspberry Pi) over the network, or **⇩ Download** what is on it.

- **macOS** (Apple Silicon, Intel), **Windows** and **Linux**: this folder. It is an Electron app that runs the same
  app and driver as the Pi. Build it with:
  `bash prepare.sh && npm install && npx electron-builder --mac dmg --arm64` (or `--win nsis --x64`, or
  `--linux deb AppImage --x64`). CI builds all of them: `.github/workflows/build.yml`.
- **iPhone, iPad and Android**: `../central-pedal-control-mobile` has the same app as a Capacitor app.
  - Prepare it with `bash prepare.sh ios|android`.
  - Android: an `.apk` on the download page.
  - iPhone and iPad: TestFlight and the App Store once the Apple Developer account is set up (see
    `IOS-APP-STORE.md`).
  - Phones and tablets have no driver, so the stem splitter, MP3 practice mixes and library imports from a USB stick
    need a computer or the Central Pedal. Upload, Download, Central Tracks and your own files work.

Upload needs the Central Pedal's pairing PIN. The Central Pedal shows what arrived and applies it when you say so,
never while it plays.
- On the Pi, the driver part is `PedalTransfer` in `pedal-driver.py`.
- In the app, it is `js/transfer.js`.
- The test is `node test-transfer.mjs`.
