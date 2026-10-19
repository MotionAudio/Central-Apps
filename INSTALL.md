# Installing the Central apps

**The easy way: the download page - https://motionaudio.github.io/Central-Apps/** - picks the right file
for the device you open it on. Every release is also on the
[Releases page](https://github.com/MotionAudio/Central-Apps/releases).

The four apps:

| App | Who it is for | Runs on | Files |
|---|---|---|---|
| **Central Pedal** | the pedal on stage: pads, multitracks, click, the guitar and keys rig | Raspberry Pi | `central-control-source.zip` (the update; a new card: below) |
| **Central Pedal Control** | getting the pedal ready anywhere: songs, tracks, pads, controls, the instrument - then **Upload** to the pedal | macOS, Windows, Linux, iPad, iPhone, Android | `central-pedal-control-<v>-mac-arm64.dmg` / `-mac-x64.dmg`, `-win-x64.exe`, `-amd64.deb`, `-x86_64.AppImage`, `-android.apk`; iPhone / iPad: TestFlight / App Store (IOS-APP-STORE.md) |
| **Central Control** | the main admin and the admins: lights, slides, lyrics, cameras, in-ears, tracks, mixing | Windows, Mac, Linux | `central-usage-<v>-win-x64.exe`, `-mac-arm64.dmg`, `-mac-x64.dmg`, `-amd64.deb`, `-x86_64.AppImage` |
| **Central Usage** | the musicians and singers (User 1 / User 2): chord chart, instrument, lyrics, their in-ear mix | macOS, Windows, Linux, Android, iPhone, iPad | `CentralUsage-<v>-win-x64.exe`, `-mac-arm64.dmg`, `-mac-x64.dmg`, `-amd64.deb`, `-x86_64.AppImage`, `CentralUsage-<v>.apk`; iPhone / iPad: Safari today, the App Store app once the Apple account is set up |

**Names:** Central Control's files keep their old name (`central-usage-…`, and `Central Usage.app` on a Mac) so every
computer that has it keeps updating itself. Central Usage is the new musicians' app: `CentralUsage-…`.

**A musician's laptop that runs Central Control today** keeps working as User 1 / User 2. New musicians' computers,
phones and tablets get Central Usage; it can't become an admin (the main admin's Devices tab shows which app each
device runs).

Everything you install updates itself: each app looks for a new release every time it opens (and once a day) and asks
"Update now?" - Yes or No. (Android: the app opens the newest Central Usage from the main admin's computer; a new
`.apk` is only needed when the app itself changes.)

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

If the Mac says the app *"is damaged"*, run the line for that app in Terminal (Central Control's file keeps its old
name, so updates and settings carry on):
`xattr -dr com.apple.quarantine "/Applications/Central Usage.app"` - Central Control
`xattr -dr com.apple.quarantine "/Applications/CentralUsage.app"` - Central Usage
`xattr -dr com.apple.quarantine "/Applications/Central Pedal Control.app"` - Central Pedal Control

## Central Pedal Control: Upload to the pedal

1. Set things up on the Mac: the setlist (Tracks → **+ Add songs**: MultiTracks.com / Loop Community downloads, your
   own WAVs), the pads, the footswitches and knobs (Configure), the instrument, the setups.
2. Take the Mac to church (same Wi-Fi or a network cable as the Central Pedal), press **⇪ Upload** (top right, or
   File → Upload…, ⌘U), type the pedal's name or address (e.g. `padpedal.local`) and its pairing PIN, tick what to
   send - songs and their tracks, pads and sounds, buttons and MIDI, instrument, setups, colours; outputs and screens
   only if the Mac's outputs match the pedal's - and press Upload.
3. On the Central Pedal a bar says what arrived: **Apply now** (never while it plays - it waits), **Later** or
   **Discard**. Songs replace the pedal's setlist, or are added to it (same songs updated).
4. **⇩ Download** does the opposite: the pedal's songs and setup come to the Mac.

Also in **⇪ Upload**: the Stream Deck, the network audio to the main admin (each track, the click, the pads and the
instrument on their own channels) with the backup player's settings, and the practice-mix and stem splitter settings.

## Android (Central Usage, Central Pedal Control)

1. On the phone or tablet, open the download page and tap **Download for Android** (`CentralUsage-<v>.apk`, or
   `central-pedal-control-<v>-android.apk` for Central Pedal Control).
2. Open it; Android asks to allow installs from the browser: **Settings → Allow from this source**, back, **Install**.
3. Open **Central Usage** on the church Wi-Fi and tap **Find the main admin** (or type its address), then pick
   User 1 or User 2 and type the pairing PIN. **Central Pedal Control** opens the Central Pedal app at once: set up
   your songs, then **⇪ Upload** to the pedal on the same Wi-Fi.

**For whoever looks after the releases - the Android signing key (once):** run `bash tools/make-android-key.sh`, keep
the `.keystore` file and its password safe, and add two repository secrets on GitHub (Settings → Secrets and variables
→ Actions): `ANDROID_KEYSTORE_B64` (the text it prints) and `ANDROID_KEYSTORE_PASSWORD`. Every later `.apk` is signed
with it, so new versions install over the old one. Until then the `.apk` is signed with a temporary key: it installs,
but a newer one has to replace it (uninstall first).

## iPhone, iPad (and any phone or tablet) in the browser

Central Usage also runs in the browser, served by the main admin's computer (or by a Central Pedal) - nothing to install:

1. Join the same Wi-Fi as the main admin's computer.
2. Open **http://&lt;main admin's address&gt;:8095/cu/** in Safari (iPhone / iPad) or Chrome (Android) - the address is in
   the main admin's Central Control → Settings → This computer. With a Central Pedal, **http://padpedal.local:8080/cu/** works too.
3. Choose **User 1** or **User 2** and type the main admin's pairing PIN (main admin → Settings → This computer).
4. iPhone / iPad: **Share → Add to Home Screen**. Android: **⋮ → Add to Home screen**. It now opens full screen like an app.
   (The Central Usage app for iPhone / iPad is ready for TestFlight once the Apple account is set up: IOS-APP-STORE.md.)

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

### Central Pedal Control and Central Usage on Linux

The same way, with their own file names. Each installs next to Central Control without replacing it:

```bash
cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-pedal-control.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-pedal-control-[^"]*amd64\.deb')"
sudo apt install ./central-pedal-control.deb          # Central Pedal Control
wget -O centralusage.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*CentralUsage-[^"]*amd64\.deb')"
sudo apt install ./centralusage.deb                   # Central Usage (the musicians' app)
```

### Optional extras
* **Slides over NDI** – install the free *NDI Runtime* from ndi.video (NDI Tools for Linux, Windows or
  Mac). The second screen and the Central Pedal's HDMI 2 work without it.
* **Dante** (audio host) – Audinate's Dante Virtual Soundcard (Windows / Mac, needs its licence) or a
  Dante PCIe / USB card shows up like any interface on the I/O tab; two can be joined for 128 channels.
* **Stem splitter** – Tracks → ✂ Stem splitter → **Install**. It downloads uv, a private Python, PyTorch, Demucs and
  audio-separator into the app's own folder. That is about 2.5 GB, and it needs an internet connection once. The
  separation models download the first time each one is used. **Remove it** takes it all away. It works best on a
  computer with Central Pedal Control, or on the main admin's computer; a GPU (Apple Silicon or NVIDIA) makes it much
  faster. Studio mode runs several models one after the other, so it takes several times as long as Best; the
  clean-up pass needs a few hundred MB of memory per minute of song. The de-reverb
  model downloads the first time it is used, like the others.
* **MP3 practice mixes** – need `ffmpeg` (on the Central Pedal image already; `sudo apt install ffmpeg` on Linux,
  `brew install ffmpeg` on a Mac). Without it they are WAVs.
* **Elgato Stream Deck** – plug it in; Settings → Stream Deck → **Connect a Stream Deck** (the first time a computer asks which
  device: pick the Stream Deck). On a Central Pedal made from 8.6 or newer it is allowed already; on an older card,
  update and restart once.
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
