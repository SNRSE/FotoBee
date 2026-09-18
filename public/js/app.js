/* FotoBee – application flow (start screen → photo / video → review → save → start screen). */
(function () {
  'use strict';

  const cfg = window.FOTOBOX_CONFIG;
  const I18N = window.I18N;
  const Camera = window.Camera;
  const Saver = window.Saver;
  const t = I18N.t;
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ */
  /* Config overrides via URL (?lang=de&videoSeconds=10)                 */
  /* ------------------------------------------------------------------ */
  (function applyUrlOverrides() {
    const params = new URLSearchParams(location.search);
    params.forEach((value, key) => {
      if (!Object.prototype.hasOwnProperty.call(cfg, key)) return;
      const current = cfg[key];
      if (typeof current === 'number') {
        const num = Number(value);
        if (!Number.isNaN(num)) cfg[key] = num;
      } else if (typeof current === 'boolean') {
        cfg[key] = value === '1' || value === 'true';
      } else if (typeof current === 'string') {
        cfg[key] = value;
      }
    });
  })();

  /* ------------------------------------------------------------------ */
  /* Elements                                                            */
  /* ------------------------------------------------------------------ */
  const el = {
    app: $('app'),
    coupleLine: $('couple-line'),
    btnPhoto: $('btn-photo'),
    btnVideo: $('btn-video'),
    btnLang: $('btn-lang'),
    btnFullscreen: $('btn-fullscreen'),
    preview: $('preview'),
    freeze: $('freeze'),
    countdown: $('countdown'),
    countdownNumber: $('countdown-number'),
    ringProgress: $('ring-progress'),
    stageMessage: $('stage-message'),
    flash: $('flash'),
    rec: $('rec'),
    recTime: $('rec-time'),
    recProgress: $('rec-progress'),
    recProgressBar: $('rec-progress-bar'),
    shotCounter: $('shot-counter'),
    btnBack: $('btn-back'),
    btnStart: $('btn-start'),
    btnStop: $('btn-stop'),
    reviewPhotos: $('review-photos'),
    btnPhotoRetake: $('btn-photo-retake'),
    btnPhotoNone: $('btn-photo-none'),
    btnPhotoSave: $('btn-photo-save'),
    playback: $('playback'),
    btnVideoDiscard: $('btn-video-discard'),
    btnVideoRetake: $('btn-video-retake'),
    btnVideoSave: $('btn-video-save'),
    overlay: $('overlay'),
    overlayIcon: $('overlay-icon'),
    overlayText: $('overlay-text'),
    overlayBtn: $('overlay-btn'),
  };

  const ICONS = {
    heart:
      '<svg viewBox="0 0 64 64" focusable="false"><path d="M32 54 C 12 40, 6 30, 8 20 C 10 11, 22 8, 32 20 C 42 8, 54 11, 56 20 C 58 30, 52 40, 32 54 Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>',
    leaf:
      '<svg viewBox="0 0 64 64" focusable="false"><path d="M14 50 C 14 26, 30 12, 52 12 C 52 36, 38 50, 14 50 Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M14 50 C 24 38, 34 30, 46 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    error:
      '<svg viewBox="0 0 64 64" focusable="false"><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M32 18 v18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="44" r="2.4" fill="currentColor"/></svg>',
    spinner: '<span class="spinner"></span>',
  };

  const CHECK_ICON =
    '<svg class="icon-check" viewBox="0 0 24 24" focusable="false"><path d="M5 12.5 l4.5 4.5 L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const X_ICON =
    '<svg class="icon-x" viewBox="0 0 24 24" focusable="false"><path d="M7 7 l10 10 M17 7 l-10 10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  let mode = null; // 'photo' | 'video'
  let flowToken = 0; // incremented to cancel any running async flow
  let shots = []; // [{ blob, url, selected, index }]
  let session = null;
  let videoBlob = null;
  let videoUrl = null;
  let recorder = null;
  let recTimer = null;
  let recFrame = null;
  let idleTimer = null;
  let audioCtx = null;
  let overlayTimer = null;
  let overlayResolve = null;

  class Cancelled extends Error {}

  function check(token) {
    if (token !== flowToken) throw new Cancelled();
  }

  function wait(ms, token) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (token !== undefined && token !== flowToken) reject(new Cancelled());
        else resolve();
      }, ms);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Sounds                                                              */
  /* ------------------------------------------------------------------ */
  function ensureAudio() {
    if (!cfg.sound) return null;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    } catch (err) {
      return null;
    }
  }

  function beep(freq, seconds, volume) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume || 0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + seconds + 0.02);
  }

  function shutterSound() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const length = Math.floor(ctx.sampleRate * 0.09);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, 3);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  /* ------------------------------------------------------------------ */
  /* Overlay                                                             */
  /* ------------------------------------------------------------------ */
  function showOverlay(opts) {
    clearTimeout(overlayTimer);
    if (overlayResolve) {
      const previous = overlayResolve;
      overlayResolve = null;
      previous();
    }
    el.overlayIcon.innerHTML = ICONS[opts.icon] || '';
    el.overlayText.textContent = opts.text || '';
    if (opts.sub) {
      const sub = document.createElement('span');
      sub.className = 'overlay-sub';
      sub.textContent = opts.sub;
      el.overlayText.appendChild(sub);
    }
    el.overlayBtn.hidden = !opts.button;
    if (opts.button) el.overlayBtn.textContent = opts.button;
    el.overlay.hidden = false;

    return new Promise((resolve) => {
      if (opts.duration) {
        overlayResolve = resolve;
        overlayTimer = setTimeout(hideOverlay, opts.duration);
      } else if (opts.button) {
        overlayResolve = resolve;
      } else {
        overlayResolve = null;
        resolve();
      }
    });
  }

  function hideOverlay() {
    clearTimeout(overlayTimer);
    el.overlay.hidden = true;
    if (overlayResolve) {
      const resolve = overlayResolve;
      overlayResolve = null;
      resolve();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Screens & helpers                                                   */
  /* ------------------------------------------------------------------ */
  function setScreen(name) {
    el.app.dataset.screen = name;
    resetIdle();
  }

  function currentScreen() {
    return el.app.dataset.screen;
  }

  function showMessage(text) {
    el.stageMessage.textContent = text;
    el.stageMessage.hidden = false;
  }

  function hideMessage() {
    el.stageMessage.hidden = true;
  }

  function fireFlash() {
    el.flash.classList.remove('fire');
    void el.flash.offsetWidth; // restart animation
    el.flash.classList.add('fire');
  }

  function readyMessage() {
    return mode === 'photo' ? t('photo.getReady') : t('video.ready', { s: cfg.videoSeconds });
  }

  function startLabel() {
    return mode === 'photo' ? t('common.start') : t('video.record');
  }

  function showCaptureControls() {
    el.btnStart.hidden = false;
    el.btnStart.disabled = false;
    el.btnStart.textContent = startLabel();
    el.btnStop.hidden = true;
    el.btnBack.hidden = false;
    el.shotCounter.textContent = '';
    el.freeze.hidden = true;
    showMessage(readyMessage());
  }

  function cleanupShots() {
    shots.forEach((shot) => URL.revokeObjectURL(shot.url));
    shots = [];
    el.reviewPhotos.innerHTML = '';
    el.freeze.hidden = true;
    el.freeze.removeAttribute('src');
  }

  function cleanupVideo() {
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (err) {
        /* ignore */
      }
    }
    recorder = null;
    setRecording(false);
    el.playback.pause();
    el.playback.removeAttribute('src');
    el.playback.load();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = null;
    videoBlob = null;
  }

  function goHome() {
    flowToken += 1;
    hideOverlay();
    cleanupVideo();
    cleanupShots();
    hideMessage();
    el.countdown.hidden = true;
    Camera.stop();
    el.preview.srcObject = null;
    mode = null;
    I18N.setLang(cfg.lang); // each guest starts with the default language
    setScreen('home');
  }

  /* ------------------------------------------------------------------ */
  /* Idle timeout                                                        */
  /* ------------------------------------------------------------------ */
  function resetIdle() {
    clearTimeout(idleTimer);
    if (!cfg.idleTimeoutMs || currentScreen() === 'home') return;
    idleTimer = setTimeout(() => {
      if (recorder && recorder.state === 'recording') {
        resetIdle();
        return;
      }
      goHome();
    }, cfg.idleTimeoutMs);
  }

  /* ------------------------------------------------------------------ */
  /* Capture screen                                                      */
  /* ------------------------------------------------------------------ */
  async function enterCapture(newMode) {
    mode = newMode;
    const token = ++flowToken;
    ensureAudio(); // user gesture: unlock audio for the countdown beeps
    setScreen('capture');
    el.btnStart.hidden = false;
    el.btnStart.disabled = true;
    el.btnStart.textContent = t('common.startingCamera');
    el.btnStop.hidden = true;
    el.btnBack.hidden = false;
    el.shotCounter.textContent = '';
    el.freeze.hidden = true;
    el.countdown.hidden = true;
    el.preview.classList.toggle('mirrored', Boolean(cfg.mirrorPreview));
    showMessage(readyMessage());

    try {
      await Camera.start({ audio: mode === 'video' });
      check(token);
      await Camera.attach(el.preview);
      check(token);
    } catch (err) {
      if (err instanceof Cancelled) return;
      console.error('Camera error', err);
      await showOverlay({ icon: 'error', text: t('error.camera'), button: 'OK' });
      goHome();
      return;
    }
    showCaptureControls();
  }

  async function runCountdown(seconds, token) {
    el.countdown.hidden = false;
    for (let n = seconds; n >= 1; n -= 1) {
      check(token);
      const num = el.countdownNumber;
      num.textContent = String(n);
      num.classList.remove('pop');
      void num.offsetWidth;
      num.classList.add('pop');
      const ring = el.ringProgress;
      ring.classList.remove('animate');
      void ring.getBoundingClientRect();
      ring.classList.add('animate');
      beep(n === 1 ? 1046 : 784, 0.14, 0.18);
      await wait(1000, token);
    }
    el.countdown.hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /* Photo flow                                                          */
  /* ------------------------------------------------------------------ */
  async function runPhotoSequence() {
    const token = ++flowToken;
    hideMessage();
    el.btnStart.hidden = true;
    cleanupShots();
    session = Saver.sessionId();

    try {
      for (let i = 0; i < cfg.photoCount; i += 1) {
        el.shotCounter.textContent = t('photo.shotOf', { n: i + 1, total: cfg.photoCount });
        if (i > 0) {
          showMessage(t('photo.oneMore'));
          await wait(cfg.pauseBetweenShotsMs, token);
          hideMessage();
        }
        await runCountdown(cfg.countdownSeconds, token);
        fireFlash();
        shutterSound();
        const blob = await Camera.capturePhoto(el.preview, {
          mirror: Boolean(cfg.mirrorSavedPhotos),
          quality: cfg.photoQuality,
        });
        check(token);
        const url = URL.createObjectURL(blob);
        shots.push({ blob, url, selected: true, index: i + 1 });

        // Freeze frame: show the still exactly as the guests saw the preview.
        el.freeze.src = url;
        el.freeze.classList.toggle('mirrored', Boolean(cfg.mirrorPreview) !== Boolean(cfg.mirrorSavedPhotos));
        el.freeze.hidden = false;
        await wait(cfg.freezeFrameMs, token);
        el.freeze.hidden = true;
      }
      showPhotoReview();
    } catch (err) {
      if (err instanceof Cancelled) return;
      console.error('Photo sequence failed', err);
      await showOverlay({ icon: 'error', text: t('error.camera'), button: 'OK' });
      goHome();
    }
  }

  function showPhotoReview() {
    el.reviewPhotos.innerHTML = '';
    shots.forEach((shot) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'photo-card selected';
      card.setAttribute('aria-pressed', 'true');
      card.innerHTML =
        `<img alt="Photo ${shot.index}">` +
        `<span class="badge" aria-hidden="true">${CHECK_ICON}${X_ICON}</span>` +
        `<span class="photo-index">${shot.index}</span>`;
      card.querySelector('img').src = shot.url;
      card.addEventListener('click', () => {
        shot.selected = !shot.selected;
        card.classList.toggle('selected', shot.selected);
        card.setAttribute('aria-pressed', String(shot.selected));
        updateSaveButton();
        resetIdle();
      });
      el.reviewPhotos.appendChild(card);
    });
    updateSaveButton();
    setScreen('photo-review');
  }

  function updateSaveButton() {
    const count = shots.filter((s) => s.selected).length;
    let label;
    if (count === 0) label = t('review.selectOne');
    else if (count === shots.length) label = shots.length === 2 ? t('review.saveBoth') : t('review.saveAll');
    else if (count === 1) label = t('review.saveOne');
    else label = t('review.saveSelected', { n: count });
    el.btnPhotoSave.textContent = label;
    el.btnPhotoSave.disabled = count === 0;
  }

  async function savePhotos() {
    const selected = shots.filter((s) => s.selected);
    if (!selected.length) return;
    flowToken += 1;
    showOverlay({ icon: 'spinner', text: t('saving') });
    try {
      let method = 'backend';
      for (const shot of selected) {
        const result = await Saver.savePhoto(shot.blob, { session, index: shot.index });
        method = result.method;
      }
      await showOverlay({
        icon: 'heart',
        text: t('saved.thanks'),
        sub: method === 'download' ? t('saved.downloaded') : '',
        duration: cfg.thanksDurationMs,
      });
    } catch (err) {
      console.error('Saving failed', err);
      await showOverlay({ icon: 'error', text: t('error.save'), button: 'OK' });
    }
    goHome();
  }

  async function discardPhotos() {
    flowToken += 1;
    await showOverlay({ icon: 'leaf', text: t('discarded'), duration: cfg.thanksDurationMs });
    goHome();
  }

  function retakePhotos() {
    flowToken += 1;
    cleanupShots();
    setScreen('capture');
    showCaptureControls();
  }

  /* ------------------------------------------------------------------ */
  /* Video flow                                                          */
  /* ------------------------------------------------------------------ */
  function formatSeconds(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function setRecording(on) {
    cancelAnimationFrame(recFrame);
    clearTimeout(recTimer);
    if (!on) {
      el.rec.hidden = true;
      el.btnStop.hidden = true;
      el.recProgress.hidden = true;
      el.recProgressBar.style.transition = 'none';
      el.recProgressBar.style.width = '100%';
      return;
    }
    const total = cfg.videoSeconds * 1000;
    const started = performance.now();
    el.rec.hidden = false;
    el.btnStop.hidden = !cfg.allowStopEarly;
    el.recTime.textContent = formatSeconds(total);
    el.recProgress.hidden = false;
    el.recProgressBar.style.transition = 'none';
    el.recProgressBar.style.width = '100%';
    void el.recProgressBar.offsetWidth;
    el.recProgressBar.style.transition = `width ${total}ms linear`;
    el.recProgressBar.style.width = '0%';

    const tick = () => {
      const remaining = Math.max(0, total - (performance.now() - started));
      el.recTime.textContent = formatSeconds(remaining);
      if (remaining > 0) recFrame = requestAnimationFrame(tick);
    };
    tick();
    recTimer = setTimeout(stopRecording, total);
  }

  function stopRecording() {
    clearTimeout(recTimer);
    if (recorder && recorder.state === 'recording') {
      try {
        recorder.stop();
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function startVideoRecording() {
    const token = ++flowToken;
    hideMessage();
    el.btnStart.hidden = true;
    try {
      if (cfg.videoCountdown) await runCountdown(cfg.countdownSeconds, token);
      check(token);
      recorder = Camera.createRecorder();
      if (!recorder) throw new Error('MediaRecorder unsupported');
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
        recorder.onerror = (event) => reject(event.error || new Error('Recorder error'));
      });
      recorder.start(250);
      beep(1046, 0.12, 0.12);
      setRecording(true);
      const blob = await stopped;
      setRecording(false);
      check(token);
      if (!blob.size) throw new Error('Empty recording');
      showVideoReview(blob);
    } catch (err) {
      setRecording(false);
      if (err instanceof Cancelled) return;
      console.error('Recording failed', err);
      await showOverlay({ icon: 'error', text: t('error.recorder'), button: 'OK' });
      goHome();
    }
  }

  function showVideoReview(blob) {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoBlob = blob;
    videoUrl = URL.createObjectURL(blob);
    el.playback.src = videoUrl;
    el.playback.muted = false;
    setScreen('video-review');
    el.playback.play().catch(() => {});
  }

  async function saveVideo() {
    if (!videoBlob) return;
    flowToken += 1;
    el.playback.pause();
    showOverlay({ icon: 'spinner', text: t('saving') });
    try {
      const result = await Saver.saveVideo(videoBlob, { session: Saver.sessionId() });
      await showOverlay({
        icon: 'heart',
        text: t('saved.thanks'),
        sub: result.method === 'download' ? t('saved.downloaded') : '',
        duration: cfg.thanksDurationMs,
      });
    } catch (err) {
      console.error('Saving failed', err);
      await showOverlay({ icon: 'error', text: t('error.save'), button: 'OK' });
    }
    goHome();
  }

  function retakeVideo() {
    flowToken += 1;
    cleanupVideo();
    setScreen('capture');
    showCaptureControls();
  }

  async function discardVideo() {
    flowToken += 1;
    el.playback.pause();
    await showOverlay({ icon: 'leaf', text: t('discarded'), duration: cfg.thanksDurationMs });
    goHome();
  }

  /* ------------------------------------------------------------------ */
  /* Static texts, language, fullscreen                                  */
  /* ------------------------------------------------------------------ */
  function renderTexts() {
    I18N.applyTranslations();
    const parts = [cfg.coupleNames, cfg.eventDate].filter(Boolean);
    el.coupleLine.textContent = parts.join('  ·  ');
    if (currentScreen() === 'capture') {
      if (!el.btnStart.disabled) el.btnStart.textContent = startLabel();
      if (!el.stageMessage.hidden && mode) showMessage(readyMessage());
    }
    if (currentScreen() === 'photo-review') updateSaveButton();
  }

  function toggleLanguage() {
    const langs = I18N.available();
    const next = langs[(langs.indexOf(I18N.getLang()) + 1) % langs.length];
    I18N.setLang(next);
  }

  function toggleFullscreen() {
    const doc = document;
    if (!doc.fullscreenElement) {
      if (!doc.documentElement.requestFullscreen) return;
      const request = doc.documentElement.requestFullscreen();
      if (request && request.catch) request.catch(() => {});
    } else if (doc.exitFullscreen) {
      const exit = doc.exitFullscreen();
      if (exit && exit.catch) exit.catch(() => {});
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */
  el.btnPhoto.addEventListener('click', () => enterCapture('photo'));
  el.btnVideo.addEventListener('click', () => enterCapture('video'));
  el.btnLang.addEventListener('click', toggleLanguage);
  el.btnFullscreen.addEventListener('click', toggleFullscreen);
  el.btnBack.addEventListener('click', goHome);
  el.btnStart.addEventListener('click', () => {
    if (el.btnStart.disabled) return;
    if (mode === 'photo') runPhotoSequence();
    else if (mode === 'video') startVideoRecording();
  });
  el.btnStop.addEventListener('click', stopRecording);
  el.btnPhotoRetake.addEventListener('click', retakePhotos);
  el.btnPhotoNone.addEventListener('click', discardPhotos);
  el.btnPhotoSave.addEventListener('click', savePhotos);
  el.btnVideoDiscard.addEventListener('click', discardVideo);
  el.btnVideoRetake.addEventListener('click', retakeVideo);
  el.btnVideoSave.addEventListener('click', saveVideo);
  el.overlayBtn.addEventListener('click', hideOverlay);
  document.addEventListener('fotobox:langchange', renderTexts);
  document.addEventListener('pointerdown', resetIdle, { passive: true });

  // Keyboard: works with a physical "big button" mapped to Enter/Space.
  document.addEventListener('keydown', (event) => {
    resetIdle();
    const key = event.key;
    const isActivate = key === 'Enter' || key === ' ';
    if (!el.overlay.hidden) {
      if (isActivate && !el.overlayBtn.hidden) {
        event.preventDefault();
        el.overlayBtn.click();
      }
      return;
    }
    if (isActivate && event.target && event.target.tagName === 'BUTTON') return; // native activation
    const screen = currentScreen();
    if (key === 'Escape') {
      if (screen === 'capture') goHome();
      else if (screen === 'photo-review') discardPhotos();
      else if (screen === 'video-review') discardVideo();
      return;
    }
    if (key === 'f' || key === 'F') {
      toggleFullscreen();
      return;
    }
    if (screen === 'home') {
      if (key === 'p' || key === 'P') enterCapture('photo');
      else if (key === 'v' || key === 'V') enterCapture('video');
      return;
    }
    if (!isActivate) return;
    event.preventDefault();
    if (screen === 'capture') {
      if (!el.btnStart.hidden && !el.btnStart.disabled) el.btnStart.click();
      else if (!el.btnStop.hidden) stopRecording();
    } else if (screen === 'photo-review') {
      if (!el.btnPhotoSave.disabled) savePhotos();
    } else if (screen === 'video-review') {
      saveVideo();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  I18N.setLang(cfg.lang);
  renderTexts();
  el.preview.classList.toggle('mirrored', Boolean(cfg.mirrorPreview));
  Saver.detectBackend().then((available) => {
    console.info(available ? 'FotoBee backend detected – captures are saved on the server.' : 'No backend – captures will be downloaded.');
  });
  setScreen('home');

  // Expose a tiny debug API (handy for testing and kiosk scripts).
  window.FotoBox = { goHome, enterCapture, getState: () => ({ mode, screen: currentScreen(), shots: shots.length, hasVideo: Boolean(videoBlob) }) };
})();
