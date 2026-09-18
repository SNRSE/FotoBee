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
  the browser instead.

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
captures/photos/2026-10-10_20-14-05_1.jpg   # <session>_<picture>.jpg  (1–4 per session)
captures/photos/2026-10-10_20-14-05_2.jpg
captures/videos/2026-10-10_20-16-40.mp4     # .webm on browsers without MP4 recording
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
| `sound` | `true` | Countdown beeps and shutter click |
| `idleTimeoutMs` | `90000` | Return to start screen after inactivity |

Every key can be overridden per session with URL parameters, e.g.
`http://localhost:3000/?videoSeconds=20&photoFirstCountdownSeconds=7`.

Server options via environment variables: `PORT` (3000), `HOST` (0.0.0.0),
`CAPTURE_DIR` (`./captures`).

## Project layout

```
server.js            Node.js server: static files + /api/photos, /api/videos, /api/gallery
public/index.html    Screens: start, capture, photo review, video review
public/css/          Styling + bundled fonts (macramé SVG pattern lives in index.html)
public/js/config.js  Booth configuration
public/js/i18n.js    UI texts (German)
public/js/camera.js  getUserMedia, still capture, MediaRecorder
public/js/storage.js Upload to backend or download fallback
public/js/app.js     Application flow / state machine
test/e2e.js          Playwright smoke test with a fake camera
```

## Testing

```bash
npm i -D playwright   # once (Chromium is downloaded automatically)
npm test              # runs both flows headless, screenshots in test/screenshots/
```

## Roadmap ideas

- Photo strip composite (both photos + names/date) for printing
- Gallery page for the hosts
- Optional HTTPS for tablets on the same network
- ffmpeg post-processing (fix WebM duration metadata, convert to MP4)
