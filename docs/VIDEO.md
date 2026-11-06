# How Central Control's Video switcher works

This is the design behind the Video tab. For where it hooks into the rest of the app, see [VIDEO-INTEGRATION.md](VIDEO-INTEGRATION.md).

## What it does

It takes up to 48 cameras from four kinds of source: NDI cameras; USB and HDMI capture devices and webcams; SRT, RTMP, RTSP and HTTP IP cameras and encoders; and phones, which join from a web page. Looping media files and test patterns count as sources too, and the Slides tab's picture is one more tile.

On the multiview you choose which cameras show, the grid size and the page. Tally shows red for program and green for preview, along with which output each is on.

There are two outputs, and each has its own Preview and Program. **MAIN** goes full screen on one of this computer's displays. **STREAM** goes to several RTMP(S) and SRT destinations at once, to a recording, and to NDI as "Central Control Stream" and "Central Control Main" for OBS, vMix or Streamlabs.

Each output can cut, or do an Auto transition with a fade, a dip to black or a wipe. It can show a **lyrics** lower third from the Central Pedal, where lines cross-fade and a new section dips out and back in. It can show **slides** full screen or keyed over the camera. And it can fade to black.

Stream audio has two sources, A and B, each a device plus a channel pair on an interface or on Dante. You pick one, with gain, meters and a delay. The sound in the room isn't touched.

## How it's built

In short, Chromium is the vision mixer, ffmpeg moves the pictures around, and a small C helper does what neither of them can.

| Job | Where | Why |
|---|---|---|
| Compositing (sources to outputs, transitions, keys, lyrics) | WebGL2 in the Central Control page, on one off-screen canvas | It's the GPU on every OS without any native graphics code. Each source is a texture and each output renders into its own framebuffer. |
| USB and HDMI capture, webcams | `getUserMedia` in the page | Capture that works on every OS, with device names, at full frame rate, straight into textures. |
| IP cameras (SRT, RTMP, RTSP, HTTP) and media files | one `ffmpeg` per source (`video-service.js`), sending raw I420 to the page | ffmpeg handles every protocol and codec, and decodes in hardware when it can. |
| NDI cameras | `cu-video ndi-recv`, with the NDI runtime loaded at run time, sending I420 to the page | It uses NDI's own SDK. The runtime is free, but its licence keeps it out of our bundle. |
| Phones | an HTTPS page (`camera.html`) that encodes H.264 with WebCodecs (or JPEG if it can't), sent over WSS and decoded in the page with `VideoDecoder` | Nothing to install. The phone encodes in hardware and the desk decodes in hardware. |
| Slides | the existing `output.html`, rendered off screen (`paint`) into the page | It's exactly what the Slides tab shows, videos included. |
| Main output | a window the page opens itself (`window.open`, in the same renderer process), drawn from the off-screen canvas | No frames are copied between processes, and it goes full screen on the chosen display. |
| Stream output | RGBA to I420 on the GPU in a shader, read back asynchronously (pixel-pack buffers and fences), then into the `ffmpeg` encoder | 1.5 bytes per pixel and no colour conversion on the CPU. |
| Encoding | one ffmpeg using NVENC, Quick Sync, AMF, VideoToolbox or VAAPI, or x264 if none of those is there | Each one is tried with a test encode at start. |
| Destinations and recording | one light `ffmpeg -c copy` per destination, fed the encoder's MPEG-TS | One destination can drop, reconnect or stop without affecting the others, and there's no second encode. |
| Stream audio | `cu-video audio` (miniaudio in shared mode: WASAPI, CoreAudio, ALSA, Pulse or JACK), into the encoder's second input | It opens any interface or Dante Virtual Soundcard channel pair without taking the device away from the audio host. It runs off the device's clock and never faster than real time. The delay is a hold-back in its ring buffer. |

### Why not one native process with libav, SDL and NDI?

That would mean building and shipping libav, SDL2 and a GPU path for three operating systems, plus a second interface for monitoring. Chromium already has WebGL2 through ANGLE on Direct3D, Metal and GL, camera capture, WebCodecs, and windows on any display, on every OS. What it's missing is protocol input and stream encoding, and the ffmpeg command line covers both with one static binary per OS.

## Keeping the CPU in check

On the multiview, each camera comes in small, at 384×216 and 10 fps by default. For NDI that's the camera's own low-bandwidth stream. For IP cameras it's an optional sub-stream address, or ffmpeg scales it down.

Only cameras in a Preview or on a Program, or ones set to "always full quality", come in at full size and the stream's frame rate. Putting a camera in Preview starts that switch before you cut to it.

The page only ever gets the newest frame from each source, and frames are dropped if the page falls behind. If the GPU is busy, the readback skips a frame rather than queueing it.

A worker's timer drives the outputs, and the window's background throttling is off, so streaming carries on with the window minimised.

## Phones and HTTPS

Browsers only let a page use the camera in a secure context. So the app makes a small local CA and a server certificate for this computer's names and IP addresses (`video-cert.js`, node:crypto, EC P-256). A plain HTTP start page then offers the CA, which each phone installs once, and links to the HTTPS camera page. On an iPhone or iPad, installing it means Settings → Profile Downloaded → Install, and then turning it on under General → About → Certificate Trust Settings.

Accepting the browser's warning instead also works on most phones. Phones need the camera code shown on the Phones page, and a phone that's on a program shows ON AIR.

## Limits, and what hasn't been tested

Some things haven't been tested here: receiving and sending NDI (there's no runtime in the test container), hardware encoders other than x264, the device names `getUserMedia` gives on Windows and macOS, and Dante Virtual Soundcard. Those paths follow the SDK and platform documentation.

The multiview can show 48 full-HD cameras at once, but only a handful are at full size at any moment, on purpose: whatever's in a Preview or on a Program.

The test container's Chromium may fall back to JPEG for the phone. Safari 16.4 and later, and Chrome on phones, use H.264.

## Screens on the lights page's 3D stage

The lights page can show the room's screens and projectors in 3D, each with what its output is showing, live (`app/screen-feed.js` and `app/lights3d-screens.js`).

Each screen or projector shows one output: the Video tab's **Main** or **Stream**, the **Slides & lyrics** output (the second screen and NDI), or the Central Pedal's **HDMI 1** or **HDMI 2**. The names match the ones on the Video and Slides tabs.

Main and Stream are copied from the compositor at 15 fps into a 384 × 216 canvas (`CUVideoTab.previewTo`), and only while a screen on the 3D stage wants them. Slides & lyrics, HDMI 1 and HDMI 2 are drawn on the lights computer the same way `output.html` draws them, as the live slide or the lyrics on their background.

When Cameras or Slides is running on a different computer, the lights computer asks the center for a preview (`screenPreviewWant`), and the computer doing that job sends small JPEGs about 4 times a second (`screenPreview`) for as long as it's asked.

While the lights page plays a song on its own for a rehearsal, HDMI 2 and the Slides output step through the song's words or its parts.

## Lyric backgrounds

`app/backgrounds.js` draws 45 backgrounds in the app itself, with no downloads and nobody else's pictures. 32 of them move (gradients, light leaks, rays, dust, snow, fireflies, bokeh, clouds, aurora, stars, water, waves and shapes) and 13 are still (colours, gradients and textures). `app/backgrounds-seasons.js` adds a seasonal set on top of those. A slide names its background as `bg:<id>`.

On the Lyrics tab, **Background…** picks one for every song, for this song or for this part of the song, or uses your own picture or video, with a crossfade. The output page draws the background on its own layer, so the words can change without the background starting over. The Central Pedal's HDMI 2 doesn't draw these yet. It shows the lyrics on black or on a picture background.
