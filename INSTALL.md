# Installing the Central apps

The easiest way is the download page, **https://motionaudio.github.io/Central-Apps/**. Open it on the computer or phone you're installing on and it offers the right file. Every file is also on the [latest release](https://github.com/MotionAudio/Central-Apps/releases/latest) if you'd rather pick it yourself.

## Which file is which

`<v>` is the version, for example `10.4.1`.

| App | Who it's for | Windows | Mac | Linux | Android |
|---|---|---|---|---|---|
| **Central Pedal Control** | Getting the pedal's songs ready | `central-pedal-control-<v>-win-x64.exe` | `central-pedal-control-<v>-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel) | `central-pedal-control-<v>-amd64.deb` or `-x86_64.AppImage` | `central-pedal-control-<v>-android.apk` |
| **Central Control** | The main admin and admins | `CentralControl-<v>-win-x64.exe` | `CentralControl-<v>-mac-arm64.dmg` or `-mac-x64.dmg` | `CentralControl-<v>-amd64.deb` or `-x86_64.AppImage` | |
| **Central Usage** | Musicians and singers | `CentralUsage-<v>-win-x64.exe` | `CentralUsage-<v>-mac-arm64.dmg` or `-mac-x64.dmg` | `CentralUsage-<v>-amd64.deb` or `-x86_64.AppImage` | `CentralUsage-<v>.apk` |
| **Central Services** | Everyone on the schedule | `central-services-<v>-win-x64.exe` | `central-services-<v>-mac-arm64.dmg` or `-mac-x64.dmg` | `central-services-<v>-amd64.deb` or `-x86_64.AppImage` | `central-services-<v>-android.apk` |
| **Central Production** | Anyone making sounds | `central-production-<v>-win-x64.exe` | `central-production-<v>-mac-arm64.dmg` or `-mac-x64.dmg` | `central-production-<v>-amd64.deb` or `-x86_64.AppImage` | |

The Central Pedal itself updates from `central-control-source.zip`, and it does that by itself (see [The pedal](#the-pedal) below).

A release also has files called `central-usage-<v>-…`. Those are Central Control under the name it had before 9.2.1, so old copies can still find their update. You don't need them. When an old copy updates, it becomes Central Control and keeps its settings and library.

A Mac with an M1 chip or newer is Apple Silicon. Anything older is Intel.

---

## Windows

1. Download the `.exe` and open it.
2. The installers aren't signed yet, so Windows may say *"Windows protected your PC"*. Click **More info**, then **Run anyway**. It installs and opens by itself.

## Mac

1. Download the `.dmg` for your Mac, open it and drag the app into **Applications**.
2. Open the app. Because it isn't signed yet, the Mac will refuse the first time. Click **Done**.
3. Go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to the app, then confirm.
4. Allow the microphone when it asks. The audio interface, in-ears and instrument need it.

If the Mac says the app *"is damaged"*, paste the line for that app into Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Central Control.app"
xattr -dr com.apple.quarantine "/Applications/CentralUsage.app"
xattr -dr com.apple.quarantine "/Applications/Central Pedal Control.app"
xattr -dr com.apple.quarantine "/Applications/Central Services.app"
xattr -dr com.apple.quarantine "/Applications/Central Production.app"
```

## Linux

The quickest way is one line per app. Open a terminal (Ctrl+Alt+T on Ubuntu), paste the line for the app you want, press Enter, and type your password when it asks.

```bash
curl -fsSL https://motionaudio.github.io/Central-Apps/install.sh | bash -s control         # Central Control
curl -fsSL https://motionaudio.github.io/Central-Apps/install.sh | bash -s usage           # Central Usage
curl -fsSL https://motionaudio.github.io/Central-Apps/install.sh | bash -s pedal-control   # Central Pedal Control
curl -fsSL https://motionaudio.github.io/Central-Apps/install.sh | bash -s services        # Central Services
curl -fsSL https://motionaudio.github.io/Central-Apps/install.sh | bash -s production      # Central Production
```

It finds the newest version, checks the download against the release's checksums, and installs it with everything it needs. Ubuntu, Debian, Mint, Pop!_OS and similar get the `.deb`. Other Linux systems get the AppImage in `~/Applications` with a menu entry. Leave off the app name and it asks which one you want. Run the same line again any time to update by hand.

### By hand

If you'd rather do it yourself, these always fetch the newest release. Paste one block at a time.

```bash
mkdir -p ~/Downloads/central && cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-control.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*CentralControl-[^"]*amd64\.deb')"
sudo apt install ./central-control.deb
sudo apt install pipewire-jack
```

`pipewire-jack` lets the mix, the in-ears and recording reach your audio interface. It normally comes with the app, and running the line again does no harm. If `apt` prints *"Download is performed unsandboxed as root…"*, that's harmless.

The other apps work the same way with their own file names, and each one installs next to the others:

```bash
cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-pedal-control.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-pedal-control-[^"]*amd64\.deb')"
sudo apt install ./central-pedal-control.deb
wget -O centralusage.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*CentralUsage-[^"]*amd64\.deb')"
sudo apt install ./centralusage.deb
wget -O central-production.deb "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-production-[^"]*amd64\.deb')"
sudo apt install ./central-production.deb
```

### The AppImage, with nothing to install

Download the `.AppImage` instead of the `.deb`, right-click it, choose **Properties → Permissions → Allow executing file as program**, and double-click it.

## Android

1. On the phone or tablet, open the download page and tap **Download for Android**.
2. Open the file. Android asks whether to allow installs from your browser: choose **Settings → Allow from this source**, go back, and tap **Install**.
3. In **Central Usage**, on the church Wi-Fi, tap **Find the main admin** (or type its address), pick User 1 or User 2, and type the pairing code. **Central Pedal Control** opens straight into the pedal's app.

## iPhone and iPad

The App Store versions are waiting on the Apple developer account ([IOS-APP-STORE.md](IOS-APP-STORE.md)). Until then, Central Usage runs in Safari, served by the main admin's computer, with nothing to install:

1. Join the same Wi-Fi as the main admin's computer.
2. Open **http://&lt;main admin's address&gt;:8095/cu/** in Safari. The address is in Central Control under Settings → This computer. With a Central Pedal, **http://padpedal.local:8080/cu/** works too.
3. Pick **User 1** or **User 2** and type the main admin's pairing code.
4. Tap **Share → Add to Home Screen**, and it opens full screen like an app from then on.

It's always the version the main admin runs, so it updates with it.

Central Pedal Control works the same way from the pedal: open `http://padpedal.local:8080/control/` in Safari and add it to the Home Screen.

---

## Central Pedal Control: sending songs to the pedal

1. Set things up at home: the setlist (Tracks → **+ Add songs**), the pads, the footswitches and knobs (Controls), the instrument and your setups.
2. At church, on the same Wi-Fi or network cable as the pedal, press **⇪ Upload** (top right, or File → Upload…). Type the pedal's name or address (like `padpedal.local`) and its code, tick what to send, and press Upload. Only send the outputs and screens if your computer's outputs match the pedal's.
3. On the pedal, a bar shows what arrived. **Apply now** waits until nothing is playing. You can also choose **Later** or **Discard**. Songs either replace the pedal's setlist or get added to it.
4. **⇩ Download** goes the other way and brings the pedal's songs and setup to your computer.

Upload also carries the Stream Deck setup, the network audio settings, the backup player's settings, and the practice mix and stem splitter settings.

## Setting up a church

1. On the Motion Audio website, make the **church account**, then the **main admin**. That can be the same account, or type someone else's name and email to send them the main admin link.
2. **Buy the keys** or a church pack. The church page shows how many keys are left of each kind.
3. Go to **Teams**, choose Admins, Users or Pedal Control, and **Add members** with each person's name, email and role. Press **Done** and each person gets an email with a link to make their account, their app's download link and their key.
4. **Each person** makes their account, downloads the app, connects to Wi-Fi (skipped if they're already online) and types their key. An admin key works on one device. A user or Pedal Control key works on two, like one at church and one at home, signed in with the same account so the settings follow them.
5. **Central Services** uses the same account. Admins open on the whole schedule and users on their own requests.
6. The main admin and admins sign in with their email, password and a code texted to their phone, once per device. The main admin changes roles and hands over the main admin role under Account → People, and looks after the card and receipts under **Billing**.
7. People who haven't made their account get a reminder after 3 and 7 days. **Move to…** puts someone on another team, and they get the new app's key by email. Every sign-in has **Forgot password?**.

## Setting up a team

1. **Start with the main admin.** Open Central Control on the sound desk computer, choose **Main admin**, set its inputs and outputs, a 4-digit **pairing code** and its own **role code**. That computer is the centre of everything, so keep Central Control open on it during the service.
2. **Tracks, charts and lyrics** can play on the main admin itself (Devices → **▶ Open the player on this computer**, with nothing else to install), or on a Central Pedal.
3. **Every other computer, phone and tablet** picks Admin, User 1 or User 2 and types the pairing code.
4. **Each Central Pedal** takes the main admin's pairing code on its screen. Then, on the main admin's Devices tab, choose what it does: **Track player**, **Foot controller** or **Instrument rig**. You can add as many as you like.

## Optional extras

- **Slides over NDI.** Install the free *NDI Runtime* from ndi.video. The second screen and the pedal's HDMI 2 work without it.
- **Dante.** Audinate's Dante Virtual Soundcard (Windows or Mac, with its own licence) or a Dante PCIe or USB card shows up like any interface on the I/O tab. Two can be joined for 128 channels.
- **The stem splitter.** Tracks → ✂ Stem splitter → **Install**. It downloads about 2.5 GB into the app's own folder (a private Python, PyTorch, Demucs and audio-separator) and needs the internet once. Each separation model downloads the first time you use it. **Remove it** takes it all away again. It runs best on a computer with Central Pedal Control or on the main admin's computer, and a GPU (Apple Silicon or NVIDIA) makes it much faster. Studio mode runs several models in turn, so it takes several times longer than Best.
- **MP3 practice mixes** need `ffmpeg`. It's already on the pedal. On Linux, `sudo apt install ffmpeg`; on a Mac, `brew install ffmpeg`. Without it you get WAVs.
- **Elgato Stream Deck.** Plug it in, then Settings → Stream Deck → **Connect a Stream Deck**. The first time, the computer asks which device: pick the Stream Deck.
- **The lighting chat's AI model** is optional. Install `llama-server` (from the llama.cpp project), then choose Settings → Lights: AI model → Download the model. The built-in engine works without it.

---

## The pedal

### Updating

Nothing to download. With the pedal online, it looks for a new version every time it starts and installs it by itself after a short notice on its screen, never while something is playing. You can also go to Settings → Software updates & backup and press **Install** when **Update ready** shows. The download is checked before it installs, and your songs and settings stay.

No internet at the pedal? Put the newest `central-control-source.zip` on a USB stick and use **Update software from USB…** in the same place.

### Setting up a new pedal

It arrives with its card in, already tested.

1. Plug in the power and your outputs. A screen on HDMI 1 is optional.
2. On your phone, join the Wi-Fi called **Central Pedal Setup**. The setup page opens by itself. If it doesn't, go to http://10.42.0.1.
3. Pick the church Wi-Fi and type its password.
4. Type a 4-digit code. If you use Central Control, use the main admin's code so the pedal pairs with it. Otherwise any four digits will do. Central Pedal Control uses the same code.
5. Press **Upload**. The pedal joins the Wi-Fi and it's ready. If the password was wrong, Central Pedal Setup comes back after about a minute and the page says what happened.

When you move to a new building, Settings → Network & devices → **Turn the setup Wi-Fi on** runs it again.

### Building an SD card by hand

This is for people who build pedals. It takes 40 to 60 minutes the first time and needs about 15 GB free on an Ubuntu or Debian PC.

```bash
mkdir -p ~/Downloads/central && cd ~/Downloads/central
NEWEST=$(wget -qO- https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest)
wget -O central-control-source.zip "$(echo "$NEWEST" | grep -o 'https://github.com/[^"]*central-control-source\.zip')"
rm -rf source && unzip -q central-control-source.zip -d source && cd source
sudo WIFI_SSID="your network" WIFI_PASS="your password" bash build-image.sh
```

Put your own Wi-Fi name and password in place of `your network` and `your password`, and never save them in a file you share. Leave the Wi-Fi out and the pedal does the phone setup instead. You get `central-pedal-<version>.img`. The blue 3.5" touch screen is on from the first start and HDMI 1 shows the full app. Use `TFT=none` if there's no small screen. The other options are in the [README](README.md#building-a-card-by-hand).

Flash it with **Raspberry Pi Imager**: Choose OS → **Use custom** → the `.img` → your SD card. When it asks about *OS customisation*, choose **No**. The first start takes about a minute longer and restarts once, then opens the factory test.

**The factory test.** Plug a screen into HDMI 1 with a keyboard and mouse. It walks through every footswitch (its LED blinks), knob, slider, the expression pedal, the touch screen (a test pattern, its corners and calibration), the outputs, the instrument input, MIDI, Wi-Fi, temperature, power, storage and the sound banks. You can switch to a different touch screen there, and the pedal restarts back into the test. **Save report** keeps `factory-report.json` on the pedal. Press **Finish** and unplug it. The next start is the customer's: the Wi-Fi from the test is forgotten, the touch screen setting stays, and it asks for the church Wi-Fi on their phone. `FACTORY=0` builds a card without the test.

### How long it takes to start

From power-on the app should be on the screen in about 15 seconds. A monitor that's slow to wake up can add a few. The start-up settings are applied by the image and again after every update, and `sudo pad-pedal-system boot-tune` applies them by hand. To see where the time goes, log in over SSH:

```bash
systemd-analyze                                     # firmware, kernel and system start
systemd-analyze critical-chain getty@tty1.service   # what the screen waited for
systemd-analyze blame | head -20                    # the slowest services
journalctl -b -u pad-pedal-driver | head            # when the driver started listening
cat /tmp/pad-pedal-session.log                      # the screen session
```

---

## Updates

- **The pedal** looks every time it starts and installs a new version by itself after a short notice, never while something plays.
- **Windows, Mac and Linux apps** look every time they open and once a day, and install a new version by themselves, never while something plays. If something is playing they ask first. On Windows the new installer runs by itself, on a Mac the app is replaced and restarts, and on Linux the new `.deb` or AppImage goes in.
- **Android apps** look every time they open. The new `.apk` downloads and Android shows **Update**, which takes one tap.
- **iPhone and iPad** in the browser always have the main admin's version, so there's nothing to do.

Songs, settings, keys and sign-ins are never touched by an update.

## For whoever looks after the releases

**The Android signing key.** Run `bash tools/make-android-key.sh` once, keep the `.keystore` file and its password somewhere safe, and add two repository secrets on GitHub (Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_B64`, which is the text it prints, and `ANDROID_KEYSTORE_PASSWORD`. Every `.apk` after that is signed with it, so new versions install over old ones. Until then the `.apk` is signed with a temporary key: it installs, but a newer one has to replace it, which means uninstalling first.

**Signing the Windows and Mac installers** is in [docs/SIGNING.md](docs/SIGNING.md).
