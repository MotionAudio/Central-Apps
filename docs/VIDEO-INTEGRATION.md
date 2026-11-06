# How the Video tab plugs into Central Control

The Video tab lives mostly in its own files, and a handful of small edits connect it to the rest of the app. Those edits are already in the code. This page lists them so you know where to look, and so you know what to keep if you move things around. `central-usage/test-video.mjs` makes the same edits to a temporary copy of the app before it runs (skipping any that are already there), so if one of these places changes shape, that test fails and tells you which file.

## The Video tab's own files

| File | What it is |
|---|---|
| `central-usage/app/video.js`, `app/video.css` | The tab itself: the GPU compositor (WebGL2), multiview, the Main and Stream outputs, and the Sources, Stream, Audio, Lyrics & slides and Phones pages |
| `central-usage/app/camera.html` | The page a phone opens to become a camera, served by the app over HTTPS |
| `central-usage/video-service.js` | The main-process side: sources (ffmpeg, NDI, phones, slides), the encoder, destinations and recording, stream audio, NDI out, and the Main window hook |
| `central-usage/video-cert.js` | The local CA and server certificate for the phone page, using only `node:crypto` |
| `central-usage/preload-video.js` | The `window.CUVideo` bridge |
| `central-usage/native/video/cu-video.c`, `miniaudio.h`, `Makefile`, `CMakeLists.txt` | The native helper: `cu-video audio` (stream audio through miniaudio), `cu-video ndi-recv` and `cu-video ndi-send NAME` |
| `central-usage/test-video.mjs` | The end-to-end test: Electron, a fake camera, local RTMP and SRT servers, and a phone in Chromium |
| `docs/VIDEO.md` | How the switcher is designed |

## Where it hooks into the rest of the app

### `central-usage/main.js`

The video service is set up after `const svc = require("./services")(app, () => win);`:

```js
const { screen } = require("electron");
const videoSvc = require("./video-service").setup({
  ipcMain, getWin: () => win, userData: app.getPath("userData"), app, screen, BrowserWindow,
  binDir: app.isPackaged ? path.join(process.resourcesPath, "native") : path.join(__dirname, "native", "build")
});
```

In `createWindow()`, the window-open handler lets the Video tab open its Main output window. The page opens that window itself, which keeps it in the same renderer so the page can draw straight into it:

```js
win.webContents.setWindowOpenHandler((details) => { const v = videoSvc.windowOpen(details); if (v) return v; shell.openExternal(details.url); return { action: "deny" }; });
```

On macOS the app asks for the camera once at startup so capture devices and webcams work:

```js
if (process.platform === "darwin") require("electron").systemPreferences.askForMediaAccess("camera");
```

`allowPermissions()` already allows `media`.

### `central-usage/preload.js`

The last line is `require("./preload-video")();`.

### `central-usage/app/index.html`

It has the tab button `<button class="tab" data-tab="video">Video</button>`, the section `<section class="view" id="view-video"><div id="videoRoot" class="pad-view"></div></section>`, the stylesheet `<link rel="stylesheet" href="video.css">`, and `<script src="video.js"></script>`, which has to come before `io.js`.

### `central-usage/app/app.js`

`"video"` is in the tabs for the roles that get it: the main admin, General admins and Production admins. Which roles see it is decided here, not in the Video tab.

### `central-usage/package.json`

`build.files` lists `"video-service.js"`, `"video-cert.js"` and `"preload-video.js"`. `app/**/*` already covers `video.js`, `video.css` and `camera.html`.

`build.extraResources` copies the helpers for each platform. On Linux and macOS that's `{ "from": "native/build/cu-video", "to": "native/cu-video" }` and `{ "from": "native/build/ffmpeg", "to": "native/ffmpeg" }`. On Windows it's the same with `.exe` on the end.

On macOS, `build.mac.extendInfo` carries the permission messages people see:

- `"NSCameraUsageDescription": "Central Control shows your cameras and capture cards in the Video switcher."`
- `"NSMicrophoneUsageDescription": "The stream's sound comes from your audio interface or Dante."`
- `"NSLocalNetworkUsageDescription": "Central Control finds NDI cameras, phones and the Central Pedal on your network."`

There are no extra npm dependencies. `ws` was already there, and the certificate code only uses `node:crypto`.

### The native build

`make -C native/video` builds the helper into `native/build/cu-video` alongside the others. `video-service.js` sets the execute bit on it itself, so it doesn't need adding to the `chmod +x` loop in `services.js`.

## In CI

`.github/workflows/build.yml` takes care of all of this. If you're setting up a new build machine, this is what it does.

1. **It builds cu-video for each platform.** On Linux that's `make -C central-usage/native/video`. The Windows helper is cross-built on the same Linux machine with `make -C central-usage/native/video CC=x86_64-w64-mingw32-gcc EXE=.exe LIBS="-lole32 -lwinmm -static"`. Each Mac job builds it for its own architecture with clang. No SDKs are needed, because miniaudio is included and NDI is loaded at run time. `CMakeLists.txt` is there if you'd rather build the Windows helper with MSVC.
2. **It bundles a pinned ffmpeg** as `native/build/ffmpeg` (or `ffmpeg.exe`) using `tools/fetch-ffmpeg.sh <linux-x64|win-x64|mac-arm64|mac-x64> <dest>`. That's ffmpeg 9.0.2, from BtbN's GPL static builds for Linux and Windows and from ffmpeg.martin-riedl.de for the Macs, with libx264, SRT, TLS for RTMPS and the hardware encoders. Each download is checked against its SHA-256 and the build stops if it doesn't match. The script also writes `LICENSE.ffmpeg.txt` next to the binary, saying where the source is, as the GPL requires. To move to a newer ffmpeg, change the URLs and checksums at the top of that script.
3. **NDI isn't bundled.** People install it themselves (NDI Tools or the NDI Runtime from ndi.video). The helper looks for it through `NDI_RUNTIME_DIR_V6` or `NDI_RUNTIME_DIR_V5` on Windows, `/usr/local/lib/libndi.dylib` on macOS, and `libndi.so.6` on Linux.

To check a build by hand on any platform:

- `native/build/cu-video version` should print `cu-video 1`.
- `printf '{"cmd":"list"}\n{"cmd":"quit"}\n' | native/build/cu-video audio` should write a framed `{"ev":"devices"…}`.
- `ffmpeg -hide_banner -f lavfi -i testsrc2=size=320x180:rate=30 -frames:v 30 -c:v libx264 -f null -` should exit with 0. If it complains about libx264, the wrong ffmpeg was bundled.
