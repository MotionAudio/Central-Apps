# Central Pedal Control (Mac and iPad)

The Central Pedal app away from the Central Pedal: make the setlist, import tracks (MultiTracks.com and Loop
Community downloads, your own WAVs), set up the pads, the buttons and knobs, the instrument and the look - then
**⇪ Upload** them to the Central Pedal (the Raspberry Pi) over the network, or **⇩ Download** what is on it.

- **Mac** (Apple Silicon and Intel): this folder - an Electron app that runs the same app and driver as the Pi.
  `bash prepare.sh && npm install && npx electron-builder --mac dmg --arm64` (CI builds it: `.github/workflows/build.yml`).
- **iPad:** `../central-pedal-control-ios` - the same app in an iPad app (TestFlight / App Store once the Apple
  Developer account is set up - see `IOS-APP-STORE.md`).

Upload needs the Central Pedal's pairing PIN; the Central Pedal shows what arrived and applies it when you say so
(never while it plays). The driver on the Pi: `PedalTransfer` in `pedal-driver.py`; the app: `js/transfer.js`;
the test: `node test-transfer.mjs`.
