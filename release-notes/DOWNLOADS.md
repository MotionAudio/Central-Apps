## Which file do I need?

The easiest way to get the right one is the download page, which picks it for you: https://motionaudio.github.io/Central-Apps/

If you'd rather choose here, find your app and your computer below. On a Mac, pick **mac-arm64** if it has an Apple chip (M1 or newer) and **mac-x64** if it's an older Intel Mac. If you're not sure, Apple menu → About This Mac tells you. On Linux, the **.deb** is for Ubuntu, Debian, Mint and Pop!_OS, and the **.AppImage** runs almost anywhere.

| App | Windows | Mac | Linux | Android |
|---|---|---|---|---|
| **Central Pedal Control**: get the pedal's songs, pads and controls ready | `central-pedal-control-{VER}-win-x64.exe` | `central-pedal-control-{VER}-mac-arm64.dmg` or `-mac-x64.dmg` | `central-pedal-control-{VER}-amd64.deb` or `-x86_64.AppImage` | `central-pedal-control-{VER}-android.apk` |
| **Central Control**: the desk (lights, slides, lyrics, cameras, in-ear mixes) | `CentralControl-{VER}-win-x64.exe` | `CentralControl-{VER}-mac-arm64.dmg` or `-mac-x64.dmg` | `CentralControl-{VER}-amd64.deb` or `-x86_64.AppImage` | |
| **Central Usage**: musicians and singers (chart, lyrics, your own in-ear mix) | `CentralUsage-{VER}-win-x64.exe` | `CentralUsage-{VER}-mac-arm64.dmg` or `-mac-x64.dmg` | `CentralUsage-{VER}-amd64.deb` or `-x86_64.AppImage` | `CentralUsage-{VER}.apk` |
| **Central Services**: the schedule (who's playing which Sunday) | `central-services-{VER}-win-x64.exe` | `central-services-{VER}-mac-arm64.dmg` or `-mac-x64.dmg` | `central-services-{VER}-amd64.deb` or `-x86_64.AppImage` | `central-services-{VER}-android.apk` |
| **Central Production**: the studio (tracks, sounds, plugins) | `central-production-{VER}-win-x64.exe` | `central-production-{VER}-mac-arm64.dmg` or `-mac-x64.dmg` | `central-production-{VER}-amd64.deb` or `-x86_64.AppImage` | |

On an iPhone or iPad, open Central Usage in Safari from the main admin's computer (`http://<main admin's computer>:8095/cu/`) and Central Pedal Control from the pedal (`http://padpedal.local:8080/control/`), then tap Share → **Add to Home Screen**.

The other files are there for the apps and the pedal to update themselves, so you don't need to download them:

- `central-usage-{VER}-…` is Central Control under its old name, kept so copies installed before it was renamed can still update.
- `central-control-source.zip` is the update for the Central Pedal itself. A pedal updates from Settings → Software updates & backup.
- `SHA256SUMS` lists every file's checksum.

The apps aren't signed yet, so Windows may show "Windows protected your PC" (click **More info** → **Run anyway**) and a Mac may say it can't check the app (go to System Settings → Privacy & Security and click **Open Anyway**). INSTALL.md has the details: https://github.com/MotionAudio/Central-Apps/blob/main/INSTALL.md
