# Central Control – the Video switcher (design note)

## What it does
- **Cameras in:** up to 48 cameras, from four kinds of source:
  - NDI cameras
  - USB / HDMI capture devices and webcams
  - SRT / RTMP / RTSP / HTTP IP cameras and encoders
  - Phones, which join from a web page

  Media files that loop and test patterns are also sources. The Slides tab's picture is one more tile.
- **Multiview:** pick the cameras on it, the grid size and the page. Tally shows red for program and green for preview, with which output each is on.
- **Two outputs, each with its own Preview / Program:**
  - **MAIN** goes full screen on a display of this computer.
  - **STREAM** goes to several RTMP(S) / SRT destinations at once, to a recording, and to NDI ("Central Control Stream" / "Central Control Main") for OBS / vMix / Streamlabs.
- **Per output:**
  - Cut, and Auto with fade, dip to black or wipe.
  - **Lyrics** lower third from the Central Pedal. Lines cross-fade; a new section dips out and in.
  - **Slides**: full screen, or keyed over the camera.
  - Fade to black.
- **Stream audio:** two sources, A and B, each a device plus a channel pair on an interface or Dante. One is chosen, with gain, meters and a delay. The in-house audio is untouched.

## Architecture
**Chromium is the vision mixer, ffmpeg does the moving of pictures, and a small C helper covers what neither can.**

| Job | Where | Why |
|---|---|---|
| Compositing (sources → outputs, transitions, keys, lyrics) | WebGL2 in the Central Control page, on one off-screen canvas | It is the GPU on every OS with no native graphics code. Every source is a texture; each output renders into its own framebuffer. |
| USB / HDMI capture, webcams | `getUserMedia` in the page | Cross-platform capture with device names, at full frame rate, straight into textures. |
| IP cameras (SRT / RTMP / RTSP / HTTP), media files | one `ffmpeg` per source (`video-service.js`) → raw I420 → the page | ffmpeg handles every protocol and codec, and uses hardware decoding when present. |
| NDI cameras | `cu-video ndi-recv` (the NDI runtime is loaded at run time) → I420 → the page | NDI's own SDK; the runtime is free, but its licence keeps it out of the bundle. |
| Phones | an HTTPS page (`camera.html`) encodes H.264 with WebCodecs (JPEG fallback) → WSS → the page decodes with `VideoDecoder` | No app to install; hardware encode on the phone, hardware decode on the desk. |
| Slides | the existing `output.html` rendered off screen (`paint`) → the page | Exactly what the Slides tab shows, videos included. |
| Main output | a window the page opens itself (`window.open`, same renderer process) drawn from the off-screen canvas | No frame copies across processes; full screen on the chosen display. |
| Stream output | RGBA → I420 on the GPU (shader) → async readback (pixel-pack buffers + fences) → `ffmpeg` encoder | 1.5 bytes per pixel and no CPU colour conversion. |
| Encoding | one ffmpeg: NVENC / Quick Sync / AMF / VideoToolbox / VAAPI, x264 when none is present | Each is probed with a test encode at start. |
| Destinations, recording | one light `ffmpeg -c copy` per destination, fed the encoder's MPEG-TS | One destination can drop, reconnect or stop without touching the others, and there is no second encode. |
| Stream audio | `cu-video audio` (miniaudio, shared mode: WASAPI / CoreAudio / ALSA / Pulse / JACK) → the encoder's second input | It opens any interface or Dante Virtual Soundcard channel pair without taking the device from the audio host. It is paced by the device's clock and never faster than real time. Delay is a hold-back in its ring buffer. |

## Why not a single native process (libav + SDL + NDI)?
It would mean building and shipping libav*, SDL2 and a GPU path for three operating systems, plus a second UI for monitoring. Chromium already has the following on every OS:
- WebGL2 / ANGLE on Direct3D, Metal and GL
- camera capture
- WebCodecs
- windows on any display

What it lacks is protocol input and stream encoding, and the ffmpeg command line provides both. That pieces is one static binary per OS.

## Keeping the CPU sane
- **Multiview:** each camera arrives small (384×216 at 10 fps by default). For NDI that is the camera's own low-bandwidth stream; for IP cameras it is an optional sub-stream URL, or ffmpeg scaling.
- **On-air sources:** only cameras in a Preview or on a Program (or set "always full quality") come in full size at the stream frame rate. Putting a camera in Preview starts that upgrade before the cut.
- **Frame flow:** the page only gets the newest frame per source, and frames are dropped when the page is behind. The GPU readback skips a frame instead of queueing when the GPU is busy.
- **Background running:** a worker's timer drives the outputs, and the window's background throttling is turned off, so streaming goes on with the window minimised.

## Phones and HTTPS
Browsers only give a page the camera in a secure context. The app makes a small local CA and a server certificate for this computer's names and IP addresses (`video-cert.js`, node:crypto, EC P-256). A plain-HTTP start page then:
1. offers the CA, installed once per phone. On iPhone/iPad: Settings → Profile Downloaded → Install, then General → About → Certificate Trust Settings → enable;
2. links to the HTTPS camera page.

Accepting the browser's warning instead also works on most phones. Phones need the camera code shown on the Phones page. A phone that is on a program shows ON AIR.

## Limits and what is untested
- **Untested here:** NDI receive and send (no runtime in the test container), hardware encoders other than x264, Windows/macOS device names for `getUserMedia`, and Dante Virtual Soundcard. The paths follow the SDK and platform documentation.
- **Program sources:** 48 full-HD cameras can be on the multiview at once. Only a handful are full-size at a time, by design: what is in Preview or on a Program.
- **Phone codec:** the test container's Chromium may fall back to JPEG for the phone. Safari 16.4+ and Chrome on phones use H.264.
