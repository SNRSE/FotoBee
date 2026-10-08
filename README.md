# FotoBee – Wedding FotoBox

A browser-based photo booth for a wedding: guests choose **Foto** or **Video**,
the booth runs a countdown over the live camera feed, and captures are saved on
the booth computer. The look is warm and natural – ivory, gold, brown and a
macramé wall hanging. The guest-facing UI is German.

## Features

- **Photo mode** – tapping *Foto* starts a 5 second countdown right away
  (time to get in position), then four pictures follow with a quick 2‑1
  countdown between them; flash + shutter sound; the review screen shows all
  four and lets guests keep all, some or none.
- **Video mode** – tapping *Video* starts a 5 second countdown, then records a
  15 second message (progress bar, stop early); review with playback, retake as
  often as you like, save or discard.
- **Print strip** – the selected pictures are also composed into a print-ready
  JPEG: a classic 2x6" photo strip for 3–4 pictures, a 4x6" postcard for 1–2,
  with the couple's names and the date (`<session>_strip.jpg`, 300 dpi).
- **Gallery & slideshow** page for the hosts, see below.
- **Back to start** after every session, idle timeout returns to the start
  screen automatically.
- **Wedding styling** – natural tones, serif typography, macramé décor, big
  touch-friendly buttons, works in landscape and portrait.
- **German UI**, all texts in one file (`public/js/i18n.js`).
- **Bundled fonts** (Cormorant Garamond, Jost) – works fully offline.
- **Physical button support** – `Enter`/`Space` triggers the primary action,
  `Esc` goes back, `P`/`V` pick a mode on the start screen, `F` toggles
  fullscreen.
- **Node.js backend** (no dependencies) that stores captures in `captures/`.
  Without the backend (e.g. opened as a static page) files are downloaded via
  the browser instead. If the server becomes unreachable while saving, the
  files are downloaded in the booth browser and the thanks overlay says
  "Server nicht erreichbar – auf diesem Gerät heruntergeladen"; the next guest's
  save checks the server again.

## Quick start

```bash
npm start            # http://localhost:3000
```

Open the URL in Chrome/Edge/Firefox on the booth computer, allow the camera
and microphone, and click **Fullscreen** (or press `F`).

For a real kiosk, launch Chrome in kiosk mode:

```bash
google-chrome --kiosk --autoplay-policy=no-user-gesture-required http://localhost:3000
```

Saved files:

```
captures/photos/2026-10-10_20-14-05_1.jpg      # <session>_<picture>.jpg  (1–4 per session)
captures/photos/2026-10-10_20-14-05_2.jpg
captures/photos/2026-10-10_20-14-05_strip.jpg  # print strip (2x6") or postcard (4x6")
captures/videos/2026-10-10_20-16-40.mp4        # .webm on browsers without MP4 recording
```

> The camera only works in a *secure context*: `http://localhost` is fine on the
> booth computer itself. If you want to open the booth from another device
> (tablet on the same Wi‑Fi), you need HTTPS – see below.

## Configuration

Edit `public/js/config.js`:

| Key | Default | Meaning |
| --- | --- | --- |
| `coupleNames` / `eventDate` | `'Lena & Lami'` / `'10.10.2026'` | Shown under the title (empty = hidden) |
| `photoAutoStart` | `true` | Tapping *Foto* starts the countdown immediately |
| `photoFirstCountdownSeconds` | `5` | Countdown before the first picture |
| `countdownSeconds` | `2` | Quick countdown before every further picture |
| `photoCount` | `4` | Pictures per photo session (1–4) |
| `pauseBetweenShotsMs` | `0` | Optional "Noch eins…" pause between pictures |
| `mirrorPreview` | `true` | Mirror the live feed |
| `mirrorSavedPhotos` | `false` | Save mirrored photos (text would be reversed) |
| `videoAutoStart` | `true` | Tapping *Video* starts the countdown immediately |
| `videoFirstCountdownSeconds` | `5` | Countdown before recording starts |
| `videoSeconds` | `15` | Maximum video length |
| `allowStopEarly` | `true` | Stop button while recording |
| `saveStrip` | `true` | Also save the print strip / postcard |
| `stripDpi` | `300` | Resolution of the strip (2x6" or 4x6") |
| `photoCaption` | `false` | Stamp "Namen · Datum" bottom-right on every saved photo |
| `preferredCamera` | `''` | Part of the camera label (e.g. `Logitech`) or a deviceId; `Camera.listCameras()` in the browser console lists them |
| `dslr` | `'auto'` | Real camera through the Lumix Bridge (server started with `--dslr`): `'auto'` uses it when the server reports it connected, `true` requires it, `false` = webcam only. See "DSLR" below |
| `dslrTimeoutMs` | `8000` | How long to wait for the camera to deliver a picture before the preview frame is used instead |
| `dslrCountdownSeconds` | `5` | Countdown between pictures with the real camera; the transfer of the previous picture runs during it |
| `dslrHidePreview` | `true` | Hide the live view while a picture is transferred; the pictures appear on the review screen only |
| `previewFit` | `'auto'` | `'auto'` letterboxes when camera and screen orientation differ, `'cover'` always fills, `'contain'` always letterboxes |
| `sound` | `true` | Countdown beeps and shutter click |
| `idleTimeoutMs` | `90000` | Return to start screen after inactivity |

Every key can be overridden per session with URL parameters, e.g.
`http://localhost:3000/?videoSeconds=20&photoFirstCountdownSeconds=7`.

Server options via environment variables: `PORT` (3000), `HOST` (0.0.0.0),
`CAPTURE_DIR` (`./captures`), `SSL_KEY`/`SSL_CERT` (HTTPS), `FFMPEG_PATH`,
`POSTPROCESS` (`0` disables ffmpeg), `MAX_UPLOAD_MB` (512), `DSLR_URL` (Lumix
Bridge, e.g. `http://localhost:9002`), `DSLR_BRIDGE_EXE` (bridge executable to
start automatically, `0` = never).

## DSLR: Panasonic LUMIX with flash (GH5)

Photos can be taken with a real camera instead of the webcam frame, so a flash
fires and the full-size JPEG from the camera is saved. This uses the ByteHive
**Lumix Bridge** (`LumixWsBridge.exe`, built on Panasonic's LUMIX SDK, from the
*ControllBee for Lumix* project), which talks to the camera over USB on Windows
without any driver changes.

Setup:

1. Camera: USB mode **PC(Tether)**, firmware 2.3 or newer, photo mode (M, e.g.
   1/160 s, f/4–5.6, ISO 200–400, flash on), **JPEG only** (RAW+JPEG works but
   is slower), focus fixed on the spot where the guests stand or AFS.
2. Live preview: the camera's **HDMI** output into a UVC capture card (e.g.
   Cam Link 4K). Set `preferredCamera: 'Cam Link'` so the booth shows the
   camera's view; the video mode records this feed as before.
3. Install the Lumix Bridge (`LumixBridge-Setup.exe`, or copy the
   `LumixBridge` folder next to the FotoBee executable) and start FotoBee with
   `--dslr` (or `DSLR_URL=http://localhost:9002`). The server starts the bridge
   when it is not running, connects the camera over USB, and prints
   `DSLR: DC-GH5 connected`.

Every picture of a photo session then goes: countdown → `POST /api/camera/shoot`
→ bridge releases the shutter → the camera delivers the file (about 1.5 s on a
GH5, 20 MP JPEG) while the next countdown (`dslrCountdownSeconds`, 5 s) already
runs with the live view hidden → after the last picture a short "die Fotos
kommen…" message → review screen and print strip as usual. There is no freeze
frame per picture with the real camera; the guests see all pictures on the
review screen. If the camera does
not answer, the booth falls back to the preview frame for that picture (unless
`dslr: true` requires the camera). Status: `GET /api/camera`, health shows
`dslr: true`. The bridge's own page at `http://localhost:9002` has live view,
ISO/aperture/shutter controls and a **Capture (Shutter)** test button.

## Galerie & Diashow (for the hosts)

`http://localhost:3000/gallery.html` is an unlisted page for the couple – it is
not linked from the guest UI. It lists every saved photo (newest first, print
strips `*_strip.jpg` are marked as "Fotostreifen") and video, refreshes itself
every 20 s (paused while the tab is hidden) and opens files in a lightbox with
prev/next (buttons or arrow keys), the capture time and a **Herunterladen**
link. Names and date come from `coupleNames` / `eventDate` in `config.js`.

**Diashow / TV mode:** the *Diashow* button (or `?slideshow=1`) shows the
photos fullscreen with a slow Ken‑Burns drift and crossfade, 7 s per photo,
newest first, looping. Photos that guests save while the show runs are queued
and shown next, so they appear on the TV within about 30 s. Keys: `Esc`/click
exits, `Space` pauses, `←`/`→` navigate. For a TV in the party room:

```bash
google-chrome --kiosk "http://<booth-computer>:3000/gallery.html?slideshow=1"
```

URL parameters: `?slideshow=1` starts the slideshow immediately, `?interval=10`
seconds per photo (default 7), `?poll=5` polling interval in seconds (default
20). Browsers only allow real fullscreen after a click, so with `?slideshow=1`
start the browser itself in kiosk/fullscreen mode. The page has no login – it is
meant for the booth's own network.

Test: `npm run test:gallery`.

## Portable Windows build (single EXE)

```bash
npm run build:exe            # -> dist/FotoBee-<version>-win-x64/FotoBee.exe and a .zip of the folder
```

`scripts/build-exe.js` uses Node's built-in *Single Executable Application*
feature: it embeds `server.js`, `package.json` and everything under `public/`
(fonts included) into a copy of the official Node.js binary for the target
platform. Nothing has to be installed on the booth computer – copy the folder
(or unzip the archive) and double-click:

| File | What it does |
| --- | --- |
| `FotoBee-Kiosk.cmd` | starts the server and opens Chrome/Edge fullscreen in kiosk mode with the camera pre-approved |
| `FotoBee-Browser.cmd` | starts the server and opens the booth in the default browser |
| `FotoBee.exe --help` | all options: `--kiosk`, `--open`, `--port N`, `--captures DIR` |

Photos and videos are written to `captures/` next to the executable, the
gallery is at `http://localhost:3000/gallery.html`. To customise names, date or
countdowns without rebuilding, put a `public/js/config.js` next to the
executable – any file in a `public` folder beside the EXE overrides the built-in
one. Windows shows a SmartScreen warning once because the EXE is not
code-signed ("More info" → "Run anyway").

Build details and other targets:

- The build needs Node ≥ 20.12, network access (once) for the Node.js download
  and for `postject` (fetched via `npx`, build-time only), and `unzip`/`tar`.
  Downloads are cached in `dist/.cache`.
- `node scripts/build-exe.js --platform host` builds for the machine you are
  on (used by `npm run test:build`, which builds and smoke-tests the binary);
  `--platform linux-arm64` targets a Raspberry Pi 4/5, `darwin-arm64` an Apple
  Silicon Mac (build on a Mac so the binary can be re-signed).
- The same server flags work without the EXE: `node server.js --kiosk`.

## Server details

- **Atomic saves** – uploads are written to `<file>.part` and renamed into
  place, so a crash never leaves a half photo behind. The gallery never lists
  (and the server never serves) `*.part` / `*.tmp.*` files.
- **HTTPS for tablets** – the camera only works in a secure context, so a
  tablet on the same Wi‑Fi needs HTTPS:

  ```bash
  npm run cert      # creates certs/dev-key.pem + dev-cert.pem (self-signed, SAN: localhost, hostname, all LAN IPs)
  SSL_KEY=certs/dev-key.pem SSL_CERT=certs/dev-cert.pem npm start
  ```

  Existing certificates are kept (`--force` regenerates, `--out DIR` changes
  the folder). Open `https://<ip>:3000` on the tablet (the server prints every
  LAN URL at startup) and accept the certificate warning once.
- **ffmpeg post-processing** – if `ffmpeg` is on the PATH (or `FFMPEG_PATH`
  points to it), every uploaded video is remuxed right after the upload: WebM
  gets the duration/cues that Chrome's MediaRecorder omits (fixes seeking and
  the "∞" duration), MP4 gets a fast-start header. Guests never wait for it and
  a failed remux keeps the original file. `POSTPROCESS=0` disables it.
- **Startup log** prints the booth URL, the LAN URLs, the gallery URL, the
  capture folder and the ffmpeg/HTTPS status. `Ctrl+C` shuts down gracefully
  (waits for uploads and pending remuxes); a port in use gives a clear hint.
- **Security** – `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
  `Referrer-Policy`, strict path checks (encoded `..`, backslashes, NUL bytes),
  upload size limit `MAX_UPLOAD_MB` (default 512). There is no login: run the
  booth on its own network.
- **Range requests** on `/captures/*` so gallery videos can be seeked.

Tests: `npm run test:server` (Node's built-in test runner, about 3 s).

## Project layout

```
server.js            Node.js server: static files, uploads, gallery API, optional HTTPS + ffmpeg
scripts/make-cert.sh Self-signed certificate for HTTPS on the local network
scripts/build-exe.js Portable single-file build (Windows EXE, Linux, macOS)
public/index.html    Screens: start, capture, photo review, video review
public/css/          Styling + bundled fonts (macramé SVG pattern lives in index.html)
public/js/config.js  Booth configuration
public/js/i18n.js    UI texts (German)
public/js/camera.js  getUserMedia, still capture, MediaRecorder
public/js/storage.js Upload to backend or download fallback
public/js/app.js     Application flow / state machine
public/js/strip.js   Print strip / postcard composite (canvas)
public/gallery.html  Hosts' gallery + slideshow (js/gallery.js, css/gallery.css)
test/e2e.js          Playwright smoke test with a fake camera
test/gallery.test.js Playwright test for the gallery page
test/server.test.js  Server tests (node --test)
test/build.test.js   Builds the portable binary for this machine and smoke-tests it
```

## Testing

```bash
npm i -D playwright     # once (Chromium is downloaded automatically)
npm test                # server tests + booth flows + gallery, about 3 minutes
npm run test:e2e        # booth flows only (fake camera, screenshots in test/screenshots/)
npm run test:server     # Node test runner, about 3 s
npm run test:gallery    # gallery page
npm run test:build      # portable build (needs network once for postject)
```

## Roadmap ideas

- Trigger a real camera (Panasonic GH5 / BGH1) and strobes via a capture driver
