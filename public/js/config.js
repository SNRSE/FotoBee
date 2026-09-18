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
  countdownSeconds: 3,           // countdown before every further picture / before the video
  photoCount: 2,                 // number of shots per session
  pauseBetweenShotsMs: 1600, // "one more…" pause between the shots
  photoQuality: 0.92,        // JPEG quality 0..1
  mirrorPreview: true,       // mirror the live feed like a mirror
  mirrorSavedPhotos: false,  // save the photo as the camera sees it (text readable)
  freezeFrameMs: 900,        // show the captured still briefly after the flash

  // Video mode
  videoSeconds: 15,
  videoCountdown: true,      // 3-2-1 before recording starts
  allowStopEarly: true,      // show a stop button while recording

  // General
  sound: true,               // countdown beeps + shutter click
  idleTimeoutMs: 90000,      // return to start screen after inactivity (0 = never)
  thanksDurationMs: 2200,    // "Saved! Thank you" overlay duration

  // Camera constraints passed to getUserMedia
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    facingMode: 'user',
  },
};
