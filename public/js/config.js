/**
 * FotoBee configuration.
 * Edit the values below to personalise the booth. Any key can also be
 * overridden for a single session via URL parameters, e.g.
 *   http://localhost:3000/?lang=de&videoSeconds=10&coupleNames=Anna%20%26%20Max
 */
window.FOTOBOX_CONFIG = {
  // 'en' or 'de'
  lang: 'en',

  // Shown on the start screen under the title. Leave empty to hide.
  coupleNames: 'Anna & Max',
  eventDate: '12.06.2027',

  // Photo mode
  countdownSeconds: 3,       // 3 - 2 - 1
  photoCount: 2,             // number of shots per session
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
