# FotoBee

A wedding photo booth built with TypeScript, Vite, and browser media APIs. Ivory, gold, warm brown, olive accents, and a subtle macramé-inspired motif. No application backend is required for this MVP.

## Run

Requires Node.js 22.12+ (developed with Node.js 24).

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite and allow the camera. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

```sh
npm run build
npm run preview
npm test
```

Browser tests use an installed Google Chrome with a simulated camera and microphone. They never use the computer's real camera or microphone.

## Guest experience

- **Foto:** a live preview, a 3–2–1 countdown, the first photo, a brief pause, then another live countdown and photo. Select both, either, or neither. Retaking replaces the entire pair.
- **Video:** optional microphone, a 3–2–1 lead-in, then a 15-second recording that stops automatically. Play it back, retake, save, or discard.
- Saving shows a confirmation and returns to the home screen after 4.5 seconds. Discarding returns immediately.
- **Our memories:** view saved media and download individual JPEG photos or WebM/MP4 videos.
- Camera streams and recording timers stop when leaving capture. Hiding the tab cancels a capture session. Pending camera permissions cannot reopen an abandoned session.
- If the microphone is denied or unavailable, guests can still record a silent video.
- If saving fails, the review stays open and offers direct downloads.

## Storage and deployment

Approved media is saved atomically in IndexedDB, in this browser on this device. Rejected media is never persisted. Nothing is uploaded.

This is local browser storage, not a backup: clearing site data, using a private session, or browser eviction can remove memories. Download memories before clearing the browser. The gallery is shared by guests using the same browser; there is no organizer authentication in this MVP.

Camera access requires localhost or HTTPS. For a separate phone or kiosk accessing a deployed app, use an HTTPS host; a plain HTTP LAN address does not enable the camera. Serve the contents of `dist/` after `npm run build`. All fonts and images are bundled locally, with no external requests during normal app use.

Video format is selected at runtime using `MediaRecorder.isTypeSupported`. Files keep their actual MIME type and extension. Photos match the mirrored photo preview; videos use an unmirrored preview and recording.

The 15-second stop uses a browser timer. Hiding the tab cancels capture to avoid background timer throttling. This is a browser recorder, not a frame-accurate video editor.

## Structure

- `src/main.ts`: screens, session lifecycle, countdowns, recording, review, and downloads.
- `src/camera.ts`: camera acquisition, permission messages, still capture, media compatibility.
- `src/storage.ts`: the persistence boundary (`save`, `list`, `count`).
- `src/style.css`: responsive visual system.
- `tests/booth.spec.ts`: end-to-end workflows and failure paths.

## A next step with Node.js

Keep the guest flow and replace the storage adapter with an API-backed implementation. A useful next increment is:

1. An event-scoped `POST /api/memories` endpoint accepting multipart uploads with size and MIME validation.
2. Files in managed object storage, with a database holding IDs, event IDs, timestamps, media types, and storage keys.
3. Authenticated organizer access, bulk exports, event configuration, and explicit retention controls.
4. A local upload queue, retry handling, and confirmed server acknowledgements before showing cloud-save success.

There is no server upload, cloud storage, authentication, printing, or QR sharing implemented yet.

## Validation

The Playwright suite checks both-photo and single-photo saves, discarding both, persistence after reload, downloads, 15-second video recording and playback, retakes, camera denial, microphone fallback, countdown cancellation, storage failures, and mobile layout.

Screenshots are written to `test-results/` during testing. Only Chromium/Chrome was exercised automatically; test the actual event camera, microphone, and target browser before the event.

## Assets and API references

- Decorative wedding photography: [photo image](https://images.unsplash.com/photo-1519741497674-611481863552), [video image](https://images.unsplash.com/photo-1511285560929-80b456fea0bc), from [Unsplash](https://unsplash.com/license). These are landing-page decoration; guest captures always use the camera.
- Cormorant Garamond and Manrope from Google Fonts. SIL Open Font License files are included in `public/fonts/`.
- [Camera access and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).
- [Recording format detection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).

