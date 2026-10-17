# Installing Central Control and Central Usage from GitHub

Every release is on the [Releases page](https://github.com/MotionAudio/Central-Apps/releases).
The commands below always fetch the **newest** release, so they keep working when new
versions come out. Copy them into a terminal (Ctrl + Alt + T on Ubuntu) one block at a time.

> When `apt` installs a file from your Downloads folder it may print
> *"Download is performed unsandboxed as root…"*. That note is harmless.

---

## Central Usage (Ubuntu / Debian PC or laptop)

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
* **Slides over NDI** – install the free *NDI Runtime* from ndi.video (NDI Tools → Linux).
  The second screen and the Central Control's HDMI 2 work without it.
* **The lighting chat's optional AI model** – install `llama-server` (from the llama.cpp
  project), then *Settings → Lights: AI model → Download the model*. The built-in engine works without it.

---

## Central Control on a PC (optional)

The same app as on the Pi, for trying it out or building setlists on a computer.

```bash
mkdir -p ~/Downloads/central && cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-control.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-control-[0-9][^"]*amd64\.deb')"
sudo apt install ./central-control.deb
```

---

## No install: the AppImage

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

## iPhone, iPad and Android phones / tablets

Central Usage runs in the browser, served by your Central Control - nothing to install from a store:

1. Join the same Wi-Fi as the Central Control.
2. Open **http://padpedal.local:8080/cu/** in Safari (iPhone / iPad) or Chrome (Android).
   If that name does not open, use the Central Control's address from its Settings, e.g. `http://192.168.1.40:8080/cu/`.
3. Choose **Join** and type the pairing code from the main admin's Settings (before there is a main admin:
   the Central Control's own 4-digit code).
4. iPhone / iPad: **Share → Add to Home Screen**. Android: **⋮ → Add to Home screen**. It now opens full screen like an app.

It is always the version your Central Control runs, so it updates with it. On a phone or tablet you are
User 1 or User 2: the chord chart or any instrument's part, the lyrics, and your own in-ear mix.

---

## Updating later
* **Pi:** Settings → Install when *Update ready* appears.
* **PC apps:** they check for updates themselves and ask before installing. Or run the
  commands above again.
* **Phones and tablets:** nothing to do - they always open the Central Control's current version.
