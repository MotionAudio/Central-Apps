# Installing Central Pedal and Central Control

**The easy way: the download page - https://motionaudio.github.io/Central-Apps/** - picks the right file
for the computer you open it on. Every release is also on the
[Releases page](https://github.com/MotionAudio/Central-Apps/releases).

| | Central Pedal | Central Control |
|---|---|---|
| Raspberry Pi | the pedal on stage (below) | - |
| Windows 10 / 11 | - (the player window in Central Control) | `central-usage-<v>-win-x64.exe` |
| Mac, Apple Silicon (M1 and newer) | - | `central-usage-<v>-mac-arm64.dmg` |
| Mac, Intel | - | `central-usage-<v>-mac-x64.dmg` |
| Linux | - | `.deb` / `.AppImage` (below) |
| iPhone / iPad | - | the user side (User 1 / User 2), opened from the main admin's computer (below) |

**Central Pedal runs only on the Raspberry Pi** (from 8.3). On a computer, the main admin's Central Control runs the
tracks, charts and lyrics in its **player window** (Devices tab → Open the player) - the same app, built in. The
Central Pedal for PC / Mac installs of earlier versions are no longer updated; uninstall them and use Central Control.

**Names:** the installer files keep their old names so every install keeps updating itself: `central-usage-…` is
Central Control, `central-control-source.zip` is the Central Pedal (Raspberry Pi) update.

Everything you install updates itself: each app looks for a new release every time it opens (and once a day) and asks
"Update now?" - Yes or No.

---

## Windows

1. Download the `.exe` from the download page and open it.
2. Windows says *"Windows protected your PC"* (the apps aren't signed with a paid certificate):
   click **More info** → **Run anyway**. It installs and opens by itself.

## Mac

1. Download the `.dmg` for your Mac (Apple Silicon = M1 or newer, otherwise Intel), open it and drag the
   app into **Applications**.
2. Open the app once. The Mac refuses (the app isn't signed with a paid Apple certificate): click **Done**.
3. **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to the app, confirm.
4. Allow the microphone when asked (the audio interface, in-ears and instrument need it).

If the Mac says the app *"is damaged"*, run this in Terminal. The app file keeps its old name (so updates and settings
carry on): Central Control is `Central Usage.app`:
`xattr -dr com.apple.quarantine "/Applications/Central Usage.app"`

## iPhone, iPad and Android phones / tablets

Central Control runs in the browser, served by the main admin's computer (or by a Central Pedal) - nothing to install from a store:

1. Join the same Wi-Fi as the main admin's computer.
2. Open **http://&lt;main admin's address&gt;:8095/cu/** in Safari (iPhone / iPad) or Chrome (Android) - the address is in
   the main admin's Central Control → Settings → This computer. With a Central Pedal, **http://padpedal.local:8080/cu/** works too.
3. Choose **User 1** or **User 2** and type the main admin's pairing PIN (main admin → Settings → This computer).
4. iPhone / iPad: **Share → Add to Home Screen**. Android: **⋮ → Add to Home screen**. It now opens full screen like an app.
   (An App Store version is ready to switch on: IOS-APP-STORE.md.)

It is always the version your Central Pedal runs, so it updates with it. On a phone or tablet you are
User 1 or User 2: the chord chart or any instrument's part, the lyrics, and your own in-ear mix.

---

## Linux, from a terminal

The commands below always fetch the **newest** release, so they keep working when new
versions come out. Copy them into a terminal (Ctrl + Alt + T on Ubuntu) one block at a time.

> When `apt` installs a file from your Downloads folder it may print
> *"Download is performed unsandboxed as root…"*. That note is harmless.

---

### Central Control (Ubuntu / Debian PC or laptop)

```bash
mkdir -p ~/Downloads/central && cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-usage.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-usage-[^"]*amd64\.deb')"
sudo apt install ./central-usage.deb
sudo apt install pipewire-jack
```

Open **Central Control** from the app menu, then **Find** → Connect to reach the Central Pedal.

`pipewire-jack` lets the Mix, In-ears and recording reach your audio interface. It is
normally installed with the app; running the line again does no harm.

### Optional extras
* **Slides over NDI** – install the free *NDI Runtime* from ndi.video (NDI Tools for Linux, Windows or
  Mac). The second screen and the Central Pedal's HDMI 2 work without it.
* **Dante** (audio host) – Audinate's Dante Virtual Soundcard (Windows / Mac, needs its licence) or a
  Dante PCIe / USB card shows up like any interface on the I/O tab; two can be joined for 128 channels.
* **The lighting chat's optional AI model** – install `llama-server` (from the llama.cpp
  project), then *Settings → Lights: AI model → Download the model*. The built-in engine works without it.

---

### No install: the AppImage

Download the `.AppImage` from the Releases page instead of the `.deb`, then right-click it →
**Properties → Permissions → Allow executing file as program**, and double-click it.

---

## Setting up a team (8.3)

1. **The main admin first** - Central Control on the sound desk computer: choose **Main admin**, its inputs and
   outputs, a 4-digit **pairing PIN** and its own **role PIN**. That computer is the center: keep Central Control open
   on it during the service.
2. **Tracks, charts and lyrics:** on the main admin, Devices tab → **▶ Open the player on this computer** (built into
   Central Control - nothing else to install) - or add a **Central Pedal** (Raspberry Pi).
3. **Every other computer, phone and tablet:** Admin, User 1 or User 2, and the pairing PIN.
4. **Each Central Pedal:** type the main admin's pairing PIN on its screen. On the main admin's Devices tab pick what
   it does: **Track player**, **Foot controller** or **Instrument rig**. Add as many as you like.

## The Raspberry Pi

### Already running Central Pedal 7 or newer
Nothing to download. Connect the Pi to the internet, open **Settings**, and when
**Update ready** appears press **Install**. The download is checked before it installs;
your songs and settings stay.

No internet on the Pi? Put the newest `central-control-source.zip` on a USB stick and use
**Settings → Update software from USB…**.

### A fresh SD card
Build the image on your Ubuntu PC (40–60 minutes the first time, about 15 GB free):

```bash
mkdir -p ~/Downloads/central && cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-control-source.zip "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-control-source\.zip')"
rm -rf source && unzip -q central-control-source.zip -d source && cd source
sudo WIFI_SSID="your network" WIFI_PASS="your password" bash build-image.sh
```

Type your own Wi-Fi name and password in place of `your network` / `your password`
(never put them in a file you share). You get `central-control-os-<version>.img`.

Flash it with **Raspberry Pi Imager** → Choose OS → **Use custom** → the `.img` → your SD
card. When it asks about *OS customisation*, choose **No**. The first boot takes about a
minute longer and restarts once; the screen then shows *Central Pedal* and its version.

More options for the image (screen, password, sounds) are in [README.md](README.md).

### Start-up time
From power-on the app should be on the screen in roughly 15 seconds (a computer monitor that is
slow to wake up can add a few). The start-up settings (no boot pause, quiet boot, services the
Pi never needs turned off) are applied by the image and again after every software update;
`sudo pad-pedal-system boot-tune` applies them by hand. To see where the time goes, log in over SSH:

```bash
systemd-analyze                          # firmware + kernel + system start
systemd-analyze critical-chain getty@tty1.service   # what the screen session waited for
systemd-analyze blame | head -20         # the slowest services
journalctl -b -u pad-pedal-driver | head # when the driver started and was listening
cat /tmp/pad-pedal-session.log           # the screen session (screens found, windows opened)
```

---

## Updating later
* **Pi:** Settings → Install when *Update ready* appears.
* **Windows / Mac / Linux apps:** they check for updates themselves and ask before installing
  (Windows: the new installer runs by itself; Mac: the app is replaced and restarts; Linux: the new
  .deb or AppImage). Or download the newest from the download page again.
* **iPhone / iPad:** the web app always has the Central Pedal's version - nothing to do.
