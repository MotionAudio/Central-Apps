# Video tab – integration steps

Everything for the Video tab lives in new files. These are the edits the rest of the app
needs. `central-usage/test-video.mjs` applies exactly these edits to a temporary copy of the
app before it runs, so the steps are tested.

## New files (branch `video`)

| File | What |
|---|---|
| `central-usage/app/video.js`, `app/video.css` | The tab: GPU compositor (WebGL2), multiview, Main/Stream outputs, Sources / Stream / Audio / Lyrics & slides / Phones pages |
| `central-usage/app/camera.html` | The page a phone opens to be a camera (served by the app over HTTPS) |
| `central-usage/video-service.js` | Main process: sources (ffmpeg / NDI / phones / slides), encoder + destinations + recording, stream audio, NDI out, the Main window hook |
| `central-usage/video-cert.js` | Local CA + server certificate for the phone page (node:crypto only) |
| `central-usage/preload-video.js` | `window.CUVideo` bridge |
| `central-usage/native/video/cu-video.c`, `miniaudio.h`, `Makefile`, `CMakeLists.txt` | Native helper: `cu-video audio` (stream audio, miniaudio), `cu-video ndi-recv`, `cu-video ndi-send NAME` |
| `central-usage/test-video.mjs` | End-to-end test (Electron + fake camera + local RTMP/SRT servers + a phone in Chromium) |
| `docs/VIDEO.md` | Design note |

## Edits to existing files

### `central-usage/main.js`
After `const svc = require("./services")(app, () => win);` add:

```js
const { screen } = require("electron");
const videoSvc = require("./video-service").setup({
  ipcMain, getWin: () => win, userData: app.getPath("userData"), app, screen, BrowserWindow,
  binDir: app.isPackaged ? path.join(process.resourcesPath, "native") : path.join(__dirname, "native", "build")
});
```

In `createWindow()` the window-open handler lets the Video tab open its Main output window. That
window is opened by the page itself, which keeps it in the same renderer so the page can draw into it:

```js
win.webContents.setWindowOpenHandler((details) => { const v = videoSvc.windowOpen(details); if (v) return v; shell.openExternal(details.url); return { action: "deny" }; });
```

On macOS, ask for the camera once at startup so capture devices and webcams work:
`if (process.platform === "darwin") require("electron").systemPreferences.askForMediaAccess("camera");`
(`allowPermissions()` already allows `media`.)

### `central-usage/preload.js`
Add at the end: `require("./preload-video")();`

### `central-usage/app/index.html` (already done on the parent side)
- tab button `<button class="tab" data-tab="video">Video</button>`
- `<section class="view" id="view-video"><div id="videoRoot" class="pad-view"></div></section>`
- `<link rel="stylesheet" href="video.css">`
- `<script src="video.js"></script>` (before `io.js`)

### `central-usage/app/app.js`
Add `"video"` to the tabs of the roles that get it: the main admin, General admins and
Production admins. Gating is the parent's job.

### `central-usage/package.json`
- `build.files`: add `"video-service.js"`, `"video-cert.js"`, `"preload-video.js"`. `app/**/*` already covers `video.js`, `video.css` and `camera.html`.
- `build.extraResources` (per platform):
  - Linux / macOS: `{ "from": "native/build/cu-video", "to": "native/cu-video" }` and `{ "from": "native/build/ffmpeg", "to": "native/ffmpeg" }`
  - Windows: `{ "from": "native/build/cu-video.exe", "to": "native/cu-video.exe" }` and `{ "from": "native/build/ffmpeg.exe", "to": "native/ffmpeg.exe" }`
- macOS `build.mac.extendInfo`:
  - `"NSCameraUsageDescription": "Central Usage shows your cameras and capture cards in the Video switcher."`
  - `"NSMicrophoneUsageDescription": "The stream's sound comes from your audio interface or Dante."`
  - `"NSLocalNetworkUsageDescription": "Central Usage finds NDI cameras, phones and the Central Control on your network."`
- No new npm dependencies: `ws` is already there, and the certificate code uses only `node:crypto`.

### `central-usage/native/Makefile` / `prepare-shared.sh`
Build the helper with the others: `make -C native/video` writes `native/build/cu-video`.
Also add `cu-video` to the `chmod +x` loop in `services.js`, or leave it: `video-service.js` does its own chmod.

## For the platform worker (CI)

1. **Build cu-video on each OS**
   - Linux: `make -C central-usage/native/video`
   - macOS: same, with clang; build arm64 and x86_64, or one `lipo` universal binary
   - Windows: `cmake -S central-usage/native/video -B out -A x64 && cmake --build out --config Release`, then copy `out/Release/cu-video.exe` to `native/build/`
   - It needs no SDKs: miniaudio is vendored, and NDI is loaded at run time.
2. **Bundle an ffmpeg binary** as `native/build/ffmpeg[.exe]`. It must have libx264, libsrt, TLS (for RTMPS) and the hardware encoders.
   - Linux x64 and Windows x64: BtbN's FFmpeg-Builds, GPL static (`ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz`, `ffmpeg-n7.1-latest-win64-gpl-7.1.zip`); Linux arm64: `linuxarm64-gpl`.
   - macOS: a static build per arch (e.g. osxexperts.net arm64 / evermeet.cx x86_64), or Homebrew's ffmpeg with its dylibs bundled.
   - Ship `LICENSE.ffmpeg.txt` (GPL) with an offer of the source, as the GPL requires.
   - Pin the download URLs and checksums in the workflow.
3. **NDI** is the user's install (NDI Tools / NDI Runtime from ndi.video), not bundled. The helper finds it through `NDI_RUNTIME_DIR_V6/V5` (Windows), `/usr/local/lib/libndi.dylib` (macOS) or `libndi.so.6` (Linux).
4. **Smoke test per OS**:
   - `native/build/cu-video version` prints `cu-video 1`.
   - `printf '{"cmd":"list"}\n{"cmd":"quit"}\n' | native/build/cu-video audio` writes a framed `{"ev":"devices"…}`.
   - `ffmpeg -hide_banner -f lavfi -i testsrc2=size=320x180:rate=30 -frames:v 30 -c:v libx264 -f null -` exits 0.
