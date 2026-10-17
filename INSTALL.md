# Installing Central Control and Central Usage

**The easy way: the download page - https://motionaudio.github.io/Central-Apps/** - picks the right file
for the computer you open it on. Every release is also on the
[Releases page](https://github.com/MotionAudio/Central-Apps/releases).

| | Central Control | Central Usage |
|---|---|---|
| Raspberry Pi | the main device (below) | - |
| Windows 10 / 11 | `central-control-<v>-win-x64.exe` | `central-usage-<v>-win-x64.exe` |
| Mac, Apple Silicon (M1 and newer) | `central-control-<v>-mac-arm64.dmg` | `central-usage-<v>-mac-arm64.dmg` |
| Mac, Intel | `central-control-<v>-mac-x64.dmg` | `central-usage-<v>-mac-x64.dmg` |
| Linux | `.deb` / `.AppImage` (below) | `.deb` / `.AppImage` (below) |
| iPhone / iPad / Android | - | web app from the Central Control (below) |

Everything you install updates itself: each app looks for a new release once a day and asks before installing.

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

If the Mac says the app *"is damaged"*, run this in Terminal (use the app's name):
`xattr -dr com.apple.quarantine "/Applications/Central Usage.app"`

## iPhone, iPad and Android phones / tablets

Central Usage runs in the browser, served by your Central Control - nothing to install from a store:

1. Join the same Wi-Fi as the Central Control.
2. Open **http://padpedal.local:8080/cu/** in Safari (iPhone / iPad) or Chrome (Android).
   If that name does not open, use the Central Control's address from its Settings, e.g. `http://192.168.1.40:8080/cu/`.
3. Choose **Join** and type the pairing code from the main admin's Settings (before there is a main admin:
   the Central Control's own 4-digit code).
4. iPhone / iPad: **Share → Add to Home Screen**. Android: **⋮ → Add to Home screen**. It now opens full screen like an app.
   (An App Store version is ready to switch on: IOS-APP-STORE.md.)

It is always the version your Central Control runs, so it updates with it. On a phone or tablet you are
User 1 or User 2: the chord chart or any instrument's part, the lyrics, and your own in-ear mix.

---

## Linux, from a terminal

The commands below always fetch the **newest** release, so they keep working when new
versions come out. Copy them into a terminal (Ctrl + Alt + T on Ubuntu) one block at a time.

> When `apt` installs a file from your Downloads folder it may print
> *"Download is performed unsandboxed as root…"*. That note is harmless.

---

### Central Usage (Ubuntu / Debian PC or laptop)

```bash
mkdir -p ~/Downloads/central && cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-usage.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-usage-[^"]*amd64\.deb')"
sudo apt install ./central-usage.deb
sudo apt install pipewire-jack
```

Open **Central Usage** from the app menu, then **Find** → Connect to reach the Central Control.

`pipewire-jack` lets the Mix, In-ears and recording reach your audio interface. It is
normally installed with the app; running the line again does no harm.

### Optional extras
* **Slides over NDI** – install the free *NDI Runtime* from ndi.video (NDI Tools for Linux, Windows or
  Mac). The second screen and the Central Control's HDMI 2 work without it.
* **Dante** (audio host) – Audinate's Dante Virtual Soundcard (Windows / Mac, needs its licence) or a
  Dante PCIe / USB card shows up like any interface on the I/O tab; two can be joined for 128 channels.
* **The lighting chat's optional AI model** – install `llama-server` (from the llama.cpp
  project), then *Settings → Lights: AI model → Download the model*. The built-in engine works without it.

---

### Central Control on a PC (optional)

The same app as on the Pi, for trying it out or building setlists on a computer.

```bash
mkdir -p ~/Downloads/central && cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-control.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-control-[0-9][^"]*amd64\.deb')"
sudo apt install ./central-control.deb
```

---

### No install: the AppImage

Download the `.AppImage` from the Releases page instead of the `.deb`, then right-click it →
**Properties → Permissions → Allow executing file as program**, and double-click it.

---

## The Raspberry Pi

### Already running Central Control 7 or newer
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
minute longer and restarts once; the screen then shows *Central Control* and its version.

More options for the image (screen, password, sounds) are in [README.md](README.md).

---

## Updating later
* **Pi:** Settings → Install when *Update ready* appears.
* **Windows / Mac / Linux apps:** they check for updates themselves and ask before installing
  (Windows: the new installer runs by itself; Mac: the app is replaced and restarts; Linux: the new
  .deb or AppImage). Or download the newest from the download page again.
* **iPhone / iPad:** the web app always has the Central Control's version - nothing to do.
