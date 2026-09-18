# FotoBee – Wedding FotoBox

A browser-based photo booth for a wedding: guests choose **Photo** or **Video**,
the booth runs a 3‑2‑1 countdown over the live camera feed, and captures are
saved on the booth computer. The look is warm and natural – ivory, gold, brown
and a macramé wall hanging.

## Features

- **Photo mode** – two shots, each with a 3‑2‑1 countdown over the live feed,
  flash + shutter sound, then a review screen where guests pick which photos to
  keep: both, one or none.
- **Video mode** – 15 second message (countdown, progress bar, stop early),
  review with playback, retake as often as you like, save or discard.
- **Back to start** after every session, idle timeout returns to the start
  screen automatically.
- **Wedding styling** – natural tones, serif typography, macramé décor, big
  touch-friendly buttons, works in landscape and portrait.
- **English / German** UI, switchable on the start screen.
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
captures/photos/2027-06-12_20-14-05_1.jpg   # <session>_<shot>.jpg
captures/photos/2027-06-12_20-14-05_2.jpg
captures/videos/2027-06-12_20-16-40.mp4     # .webm on browsers without MP4 recording
```

> The camera only works in a *secure context*: `http://localhost` is fine on the
> booth computer itself. If you want to open the booth from another device
> (tablet on the same Wi‑Fi), you need HTTPS – see below.

## Configuration

Edit `public/js/config.js`:

| Key | Default | Meaning |
| --- | --- | --- |
| `lang` | `'en'` | Default language (`'en'` or `'de'`); resets after each guest |
| `coupleNames` / `eventDate` | `'Anna & Max'` / `'12.06.2027'` | Shown under the title (empty = hidden) |
| `countdownSeconds` | `3` | Countdown before each shot / recording |
| `photoCount` | `2` | Shots per photo session |
| `pauseBetweenShotsMs` | `1600` | "One more…" pause |
| `mirrorPreview` | `true` | Mirror the live feed |
| `mirrorSavedPhotos` | `false` | Save mirrored photos (text would be reversed) |
| `videoSeconds` | `15` | Maximum video length |
| `videoCountdown` | `true` | 3‑2‑1 before recording |
| `allowStopEarly` | `true` | Stop button while recording |
| `sound` | `true` | Countdown beeps and shutter click |
| `idleTimeoutMs` | `90000` | Return to start screen after inactivity |

Every key can be overridden per session with URL parameters, e.g.
`http://localhost:3000/?lang=de&videoSeconds=20`.

Server options via environment variables: `PORT` (3000), `HOST` (0.0.0.0),
`CAPTURE_DIR` (`./captures`).

## Project layout

```
server.js            Node.js server: static files + /api/photos, /api/videos, /api/gallery
public/index.html    Screens: start, capture, photo review, video review
public/css/          Styling (wedding palette, macramé SVG pattern lives in index.html)
public/js/config.js  Booth configuration
public/js/i18n.js    Translations
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
