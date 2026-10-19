/* electron-builder config for Central Usage - the musicians' app (User 1 / User 2: the chord chart, the instrument,
 * the lyrics and their in-ear mix) for Mac and Windows. Same code as Central Control (package.json's "build"), with
 * its own name, id, files (CentralUsage-<version>-…) and settings folder; "edition": "usage" tells main.js which app it is.
 *   npx electron-builder --config usage-builder.js --mac dmg --arm64      (or --win nsis --x64) */
"use strict";
const pkg = require("./package.json");
const b = JSON.parse(JSON.stringify(pkg.build));
const NAME = "Central Usage", FILE = "CentralUsage";
b.appId = "org.centralcontrol.musicians";
b.productName = FILE;   // (the app's file: CentralUsage.app / CentralUsage.exe - it can sit next to Central Control)
b.extraMetadata = { edition: "usage", productName: FILE, description: "Central Usage: the chord chart, your instrument, the lyrics and your in-ear mix - for the musicians of a Central Pedal team." };
b.artifactName = FILE + "-${version}-${arch}.${ext}";
b.extraResources = (b.extraResources || []).filter((r) => !/player-src|driver-dist/.test(r.from));   // (the player window is the main admin's)
b.mac.artifactName = FILE + "-${version}-mac-${arch}.${ext}";
b.dmg = Object.assign({}, b.dmg, { artifactName: FILE + "-${version}-mac-${arch}.${ext}" });
b.mac.extendInfo = Object.assign({}, b.mac.extendInfo, {
  NSMicrophoneUsageDescription: "Central Usage plays your instrument through the rig and listens for the tuner.",
  NSLocalNetworkUsageDescription: "Central Usage gets the chord chart, the lyrics and your in-ear mix from the main admin's computer on this network.",
  NSCameraUsageDescription: "Central Usage does not use the camera.",
  CFBundleDisplayName: NAME, CFBundleName: NAME });
b.win.artifactName = FILE + "-${version}-win-x64.${ext}";
b.nsis = Object.assign({}, b.nsis, { artifactName: FILE + "-${version}-win-x64.${ext}", shortcutName: NAME, uninstallDisplayName: NAME });
delete b.linux; delete b.deb;   // (Central Usage: Mac, Windows, iPhone / iPad, Android)
module.exports = b;
