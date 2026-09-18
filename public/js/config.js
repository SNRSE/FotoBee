/**
 * FotoBee configuration.
 * Edit the values below to personalise the booth. Any key can also be
 * overridden for a single session via URL parameters, e.g.
 *   http://localhost:3000/?videoSeconds=10&coupleNames=Lena%20%26%20Lami
 */
window.FOTOBOX_CONFIG = {
  // Shown on the start screen under the title. Leave empty to hide.
  coupleNames: 'Lena & Lami',
  eventDate: '10.10.2026',

  // Photo mode
  photoAutoStart: true,          // tapping "Foto" starts the countdown right away (no extra button)
  photoFirstCountdownSeconds: 5, // countdown before the first picture (time to get in position)
  countdownSeconds: 2,           // quick countdown before every further picture (2 - 1)
  photoCount: 4,                 // number of pictures per session
  pauseBetweenShotsMs: 0,        // extra pause with a "Noch eins…" message between pictures (0 = none)
  photoQuality: 0.92,            // JPEG quality 0..1
  mirrorPreview: true,           // mirror the live feed like a mirror
  mirrorSavedPhotos: false,      // save the photo as the camera sees it (text readable)
  freezeFrameMs: 500,            // show the captured still briefly after the flash
  photoCaption: false,           // stamp "coupleNames · eventDate" bottom-right on every saved photo

  // Photo strip: a print-ready composite of the selected photos, saved as <session>_strip.jpg
  saveStrip: true,               // 3–4 photos → 2x6" strip, 1–2 photos → 4x6" postcard
  stripDpi: 300,                 // print resolution of the strip (600x1800 / 1200x1800 px at 300 dpi)

  // Video mode
  videoAutoStart: true,          // tapping "Video" starts the countdown right away (no extra button)
  videoFirstCountdownSeconds: 5, // countdown before the recording starts (0 = none)
  videoSeconds: 15,              // maximum recording length
  allowStopEarly: true,          // show a stop button while recording

  // General
  sound: true,               // countdown beeps + shutter click
  idleTimeoutMs: 90000,      // return to start screen after inactivity (0 = never)
  thanksDurationMs: 2200,    // "Saved! Thank you" overlay duration

  // Camera
  preferredCamera: '',       // part of the camera label (case-insensitive, e.g. 'Logitech') or a deviceId; '' = default
  previewFit: 'auto',        // 'auto' | 'cover' | 'contain' – 'auto' letterboxes when camera and screen orientation differ

  // Camera constraints passed to getUserMedia
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    facingMode: 'user',
  },
};
