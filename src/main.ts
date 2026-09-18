import './style.css';
import { flower, icon, weave } from './icons';
import { cameraMessage, openCamera, recorderType, stopCamera, takePhoto, VIDEO_SECONDS, wait } from './camera';
import { memoryStore } from './storage';
import type { Memory, MemoryKind } from './storage';

type Mode = 'photo' | 'video';
type Screen = 'home' | 'camera' | 'review' | 'saved' | 'gallery';
const app = document.querySelector<HTMLDivElement>('#app')!;
let screen: Screen = 'home';
let mode: Mode = 'photo';
let session = new AbortController();
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let homeTimer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let saving = false;
let microphone = true;
let captures: Blob[] = [];
let selected = new Set<number>();
let objectUrls: string[] = [];
let galleryItems: Memory[] = [];
let savedCount = 0;

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const urlFor = (blob: Blob) => { const url = URL.createObjectURL(blob); objectUrls.push(url); return url; };
const announce = (text: string) => { document.querySelector('#announcer')!.textContent = text; };

function stopRecordingTimers() {
  clearInterval(countdownTimer);
  clearTimeout(stopTimer);
}
function releaseCamera() {
  stopRecordingTimers();
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  stopCamera(stream);
  stream = null;
}
function resetSession() {
  session.abort();
  session = new AbortController();
  releaseCamera();
  clearTimeout(homeTimer);
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  captures = [];
  selected.clear();
  busy = false;
}
function header() {
  return `<header class="site-header">
    <button class="brand" data-action="home" aria-label="FotoBee home"><span class="brand-flower">${flower}</span><span>fotobee<span class="brand-dot">.</span></span></button>
    <span class="header-note">YOUR PEOPLE. YOUR MOMENTS.</span>
    <div class="header-actions"><button class="gallery-link" data-action="gallery">${icon('gallery')}<span>Our memories</span><span class="count-badge">${savedCount}</span></button>
    <button class="icon-button fullscreen-button" data-action="fullscreen" aria-label="Toggle fullscreen" title="Fullscreen">${icon('full')}</button></div>
  </header>`;
}
function footer() {
  return `<footer class="site-footer"><span>A little love. A lot of memories.</span><span class="footer-center">${icon('heart')} MADE TO BE REMEMBERED</span><span>Made with <span class="tiny-heart">♡</span> by FotoBee</span></footer>`;
}
function shell(content: string, className = '') {
  app.innerHTML = `${header()}<main id="main" class="${className}" tabindex="-1">${content}</main>${footer()}<div id="toast" class="toast" role="status"></div>`;
  document.querySelector<HTMLElement>('#main')?.focus({ preventScroll: true });
  void updateCount();
}
async function updateCount() {
  try {
    savedCount = await memoryStore.count();
    document.querySelectorAll('.count-badge').forEach(element => element.textContent = String(savedCount));
  } catch { /* Storage errors are actionable when saving or opening the gallery. */ }
}
function toast(message: string) {
  const element = document.querySelector('#toast');
  if (element) { element.textContent = message; element.classList.add('visible'); }
}
function home(message?: string) {
  resetSession();
  screen = 'home';
  shell(`<div class="home-decoration left">${weave}</div><div class="home-decoration right">${weave}</div>
    <section class="hero"><div class="eyebrow"><span></span>THE WEDDING PHOTOBOOTH<span></span></div>
      <h1>Made of <em>moments.</em></h1>
      <p>The big smiles. The happy tears. The wonderfully silly bits.<br>Make a little memory of being here, together.</p>
    </section>
    <section class="mode-grid" aria-label="Choose your experience">
      <button class="mode-card photo-card" data-action="photo"><div class="card-image">
        <img src="/images/photo-moment.jpg" alt="" width="1000" height="680" fetchpriority="high">
        <span class="mode-pill">${icon('camera')} THE STILL MOMENTS</span>
        <span class="photo-frame frame-back"></span><span class="photo-frame frame-front"><span>oh, happy day ♡</span></span>
      </div><div class="card-copy"><div><div class="card-title"><h2>Foto</h2><span class="handwritten">Strike a little pose</span></div><p>Two photos. All the feels. Keep your favorites.</p><div class="card-detail"><span>2 PHOTOS</span><span class="dot"></span><span>3-SECOND COUNTDOWNS</span></div></div><span class="card-arrow">${icon('arrow')}</span></div></button>
      <button class="mode-card video-card" data-action="video"><div class="card-image">
        <img src="/images/video-moment.jpg" alt="" width="1000" height="680" fetchpriority="high">
        <span class="mode-pill">${icon('video')} THE MOVING MOMENTS</span>
        <span class="video-stamp"><span class="record-dot"></span> 00:15 <span class="stamp-line"></span></span>
        <span class="play-circle"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m9 5 11 7-11 7z"/></svg></span>
      </div><div class="card-copy"><div><div class="card-title"><h2>Video</h2><span class="handwritten">Say it with love</span></div><p>A little message. A happy dance. Fifteen seconds of you.</p><div class="card-detail"><span>15 SECONDS</span><span class="dot"></span><span>AS MANY RETAKES AS YOU LIKE</span></div></div><span class="card-arrow">${icon('arrow')}</span></div></button>
    </section>
    <div class="home-bottom"><span class="little-flower">${flower}</span><p>No perfect poses needed.<br><strong>Just you, being you.</strong></p></div>
    <div class="home-footnote">${icon('camera')} Tap an experience to begin <span>·</span> We’ll ask for camera access</div>`, 'home-page');
  if (message) toast(message);
}
function pageHeading(kicker: string, title: string, description: string) {
  return `<div class="page-heading"><button class="back-link" data-action="home">${icon('back')} Back to home</button><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>`;
}
function cameraMarkup() {
  return `${pageHeading(mode === 'photo' ? 'LET’S MAKE A MEMORY' : 'A MESSAGE FROM THE HEART', mode === 'photo' ? 'Your good <em>side.</em>' : 'Fifteen seconds of <em>you.</em>', mode === 'photo' ? 'Get close, get comfortable. We’ll take two photos, one after the other.' : 'Send a little love, share a wish, or show us your best dance move.')}
    <section class="capture-layout"><div class="camera-frame">
      <video id="live-video" class="${mode === 'photo' ? 'mirrored' : ''}" autoplay muted playsinline aria-label="Live camera preview"></video>
      <div class="camera-top"><span class="live-pill"><span></span> LIVE PREVIEW</span><span id="shot-status" class="camera-tag">${mode === 'photo' ? 'PHOTO 1 OF 2' : '15-SECOND VIDEO'}</span></div>
      <div id="camera-overlay" class="camera-overlay"><span class="loading-ring"></span><p>Let’s meet your camera…</p></div>
      <div id="flash" class="camera-flash"></div><div class="viewfinder top-left"></div><div class="viewfinder top-right"></div><div class="viewfinder bottom-left"></div><div class="viewfinder bottom-right"></div>
      <div id="recording-progress" class="recording-progress"><div></div></div>
    </div><div id="camera-notice" class="notice" role="status"></div>
    <p id="capture-hint" class="capture-hint">${mode === 'photo' ? 'A 3–2–1 countdown before each photo. You choose what to keep.' : 'Recording stops automatically at 15 seconds. Retakes are always welcome.'}</p>
    <div id="camera-controls" class="action-row"><button class="primary-button" data-action="capture" disabled>${icon(mode === 'photo' ? 'camera' : 'video')} ${mode === 'photo' ? 'Take my photos' : 'Record a video'}</button>${mode === 'video' ? `<button class="secondary-button mic-button" data-action="microphone" aria-pressed="${microphone}">${icon(microphone ? 'mic' : 'mute')} Microphone ${microphone ? 'on' : 'off'}</button>` : ''}</div></section>`;
}
async function begin(nextMode: Mode) {
  resetSession();
  mode = nextMode;
  screen = 'camera';
  shell(cameraMarkup(), 'flow-page');
  const signal = session.signal;
  try {
    if (mode === 'video' && typeof MediaRecorder === 'undefined') throw new Error('Video recording isn’t supported in this browser. Try the latest Chrome, Edge, Firefox, or Safari.');
    const result = await openCamera(mode === 'video' && microphone);
    if (signal.aborted) { stopCamera(result.stream); return; }
    stream = result.stream;
    if (result.silent) {
      microphone = false;
      const micButton = document.querySelector<HTMLButtonElement>('[data-action="microphone"]');
      if (micButton) { micButton.innerHTML = `${icon('mute')} Microphone off`; micButton.setAttribute('aria-pressed', 'false'); }
      notice('Your microphone isn’t available. You can still record a silent video.');
    }
    const video = document.querySelector<HTMLVideoElement>('#live-video')!;
    video.srcObject = stream;
    await video.play();
    if (signal.aborted) return;
    document.querySelector('#camera-overlay')!.classList.add('hidden');
    document.querySelector<HTMLButtonElement>('[data-action="capture"]')!.disabled = false;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (!signal.aborted && screen === 'camera') cameraFailure(new Error('The camera disconnected. Reconnect it, then try again.'));
    }, { once: true });
  } catch (error) { if (!signal.aborted) cameraFailure(error); }
}
function notice(message: string) {
  const element = document.querySelector('#camera-notice');
  if (element) { element.textContent = message; element.classList.add('visible'); }
}
function cameraFailure(error: unknown) {
  session.abort();
  releaseCamera();
  busy = false;
  const overlay = document.querySelector('#camera-overlay');
  if (!overlay) return;
  overlay.className = 'camera-overlay camera-error';
  overlay.innerHTML = `${icon('camera')}<h2>A little camera help?</h2><p>${escape(cameraMessage(error))}</p><button class="light-button" data-action="retry">Try again ${icon('redo')}</button>`;
  document.querySelector<HTMLButtonElement>('[data-action="capture"]')?.setAttribute('disabled', '');
}
async function countdown(signal: AbortSignal, label: string) {
  const overlay = document.querySelector('#camera-overlay')!;
  overlay.className = 'camera-overlay countdown-overlay';
  for (const value of [3, 2, 1]) {
    overlay.innerHTML = `<span class="countdown-number">${value}</span><span class="countdown-label">${label}</span>`;
    announce(`${label}. ${value}`);
    await wait(1000, signal);
  }
  overlay.classList.add('hidden');
}
async function capture() {
  if (busy || !stream || session.signal.aborted) return;
  busy = true;
  const signal = session.signal;
  document.querySelectorAll<HTMLButtonElement>('#camera-controls button').forEach(button => button.disabled = true);
  try {
    if (mode === 'photo') {
      const video = document.querySelector<HTMLVideoElement>('#live-video')!;
      for (let index = 0; index < 2; index++) {
        document.querySelector('#shot-status')!.textContent = `PHOTO ${index + 1} OF 2`;
        await countdown(signal, index === 0 ? 'Here comes your first photo' : 'One more little moment');
        const blob = await takePhoto(video);
        if (signal.aborted) return;
        captures.push(blob);
        const flash = document.querySelector('#flash')!;
        flash.classList.add('active');
        await wait(170, signal);
        flash.classList.remove('active');
        if (index === 0) {
          document.querySelector('#capture-hint')!.textContent = 'Lovely! Switch it up — one more photo coming.';
          await wait(1100, signal);
        }
      }
      review();
    } else {
      await countdown(signal, 'Your message starts in');
      await recordVideo(signal);
    }
  } catch (error) {
    if (!signal.aborted) cameraFailure(error);
  }
}
function recordVideo(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const chunks: Blob[] = [];
    const mimeType = recorderType();
    const recording = new MediaRecorder(stream!, mimeType ? { mimeType } : undefined);
    recorder = recording;
    let failed = false;
    recording.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
    recording.onerror = () => { failed = true; reject(new Error('This recording was interrupted. Please try again.')); };
    recording.onstop = () => {
      stopRecordingTimers();
      if (signal.aborted || failed) { resolve(); return; }
      const blob = new Blob(chunks, { type: recording.mimeType || chunks[0]?.type || 'video/webm' });
      if (!blob.size) { reject(new Error('We didn’t receive any video. Please try again.')); return; }
      captures = [blob];
      review();
      resolve();
    };
    recording.onstart = () => {
      const startedAt = performance.now();
      const status = document.querySelector('#shot-status')!;
      const progress = document.querySelector<HTMLElement>('#recording-progress > div')!;
      document.querySelector('#recording-progress')!.classList.add('active');
      document.querySelector('#capture-hint')!.textContent = 'You’re recording. Make it a moment.';
      status.classList.add('recording');
      const tick = () => {
        const elapsed = (performance.now() - startedAt) / 1000;
        status.textContent = `● REC 00:${String(Math.max(0, VIDEO_SECONDS - Math.floor(elapsed))).padStart(2, '0')}`;
        progress.style.width = `${Math.min(100, elapsed / VIDEO_SECONDS * 100)}%`;
      };
      tick();
      countdownTimer = setInterval(tick, 100);
      stopTimer = setTimeout(() => { if (recording.state === 'recording') recording.stop(); }, VIDEO_SECONDS * 1000);
      announce('Recording started. Fifteen seconds.');
    };
    recording.start(250);
  });
}
function review() {
  releaseCamera();
  busy = false;
  screen = 'review';
  selected = new Set(captures.map((_, index) => index));
  const cards = mode === 'photo'
    ? `<div class="photo-review-grid">${captures.map((blob, index) => `<button class="review-photo selected" data-action="select" data-index="${index}" aria-pressed="true" aria-label="Keep photo ${index + 1}"><div class="review-image"><img src="${urlFor(blob)}" alt="Your captured photo ${index + 1}"><span class="selection-check">${icon('check')}</span></div><span class="photo-caption">Moment ${String(index + 1).padStart(2, '0')}<span class="handwritten">a little keeper ♡</span></span></button>`).join('')}</div>`
    : `<div class="video-review"><video src="${urlFor(captures[0])}" controls playsinline preload="metadata" aria-label="Your recorded video"></video><span class="video-review-label">${icon('heart')} YOUR FIFTEEN SECONDS, FOREVER.</span></div>`;
  shell(`${pageHeading('THESE ARE THE GOOD OLD DAYS', mode === 'photo' ? 'Pick your <em>keepers.</em>' : 'One for the <em>memories.</em>', mode === 'photo' ? 'Keep them both, choose one, or let this moment stay in the moment.' : 'Have a watch. Love it? Keep it. Fancy another go? It’s all yours.')}
    <section class="review-layout">${cards}<div id="save-error" class="notice" role="alert"></div>
      ${mode === 'photo' ? '<p class="selection-hint">Tap a photo to select or deselect it.</p>' : ''}
      <div class="action-row"><button class="secondary-button" data-action="retake">${icon('redo')} ${mode === 'photo' ? 'Retake photos' : 'Retake video'}</button><button id="save-button" class="primary-button" data-action="save">${icon('heart')} ${mode === 'photo' ? 'Save both photos' : 'Save my video'}</button></div>
      <button class="text-button discard-button" data-action="home">${mode === 'photo' ? 'Keep neither & finish' : 'Discard & finish'}</button>
      <p class="storage-note">Saved in this browser. Download your favorites from Our memories.</p>
    </section>`, 'flow-page');
}
function togglePhoto(index: number) {
  if (screen !== 'review' || mode !== 'photo' || !captures[index]) return;
  selected.has(index) ? selected.delete(index) : selected.add(index);
  const card = document.querySelector(`[data-action="select"][data-index="${index}"]`)!;
  card.classList.toggle('selected', selected.has(index));
  card.setAttribute('aria-pressed', String(selected.has(index)));
  const button = document.querySelector('#save-button')!;
  button.innerHTML = `${icon(selected.size ? 'heart' : 'arrow')} ${selected.size === 2 ? 'Save both photos' : selected.size === 1 ? 'Save 1 photo' : 'Finish without saving'}`;
  announce(`${selected.size} photos selected.`);
}
async function save() {
  if (screen !== 'review' || saving) return;
  if (!selected.size) { home(); return; }
  saving = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach(button => button.disabled = true);
  const button = document.querySelector('#save-button')!;
  button.textContent = 'Saving your memory…';
  try {
    const count = selected.size;
    await memoryStore.save([...selected].map(index => ({ kind: mode as MemoryKind, blob: captures[index] })));
    saving = false;
    resetSession();
    screen = 'saved';
    shell(`<section class="success"><span class="success-flower">${flower}</span><div class="eyebrow">A LITTLE PIECE OF TODAY</div><h1>Consider it <em>kept.</em></h1><p>${mode === 'photo' ? (count === 2 ? 'Both photos are' : 'Your photo is') : 'Your video is'} safely saved on this device.<br>Thanks for adding a little more love to the day.</p><button class="primary-button" data-action="home">Another little moment ${icon('arrow')}</button><span class="return-note">Back to the start in a moment…</span></section>`, 'flow-page success-page');
    announce('Saved on this device.');
    homeTimer = setTimeout(() => home(), 4500);
  } catch {
    saving = false;
    buttons.forEach(element => element.disabled = false);
    button.innerHTML = `${icon('heart')} Try saving again`;
    const error = document.querySelector('#save-error')!;
    error.textContent = 'We couldn’t save on this device. Storage may be full or unavailable. Your captures are still here — try again or download them below.';
    error.classList.add('visible');
    if (!document.querySelector('[data-action="download-capture"]')) {
      const downloads = document.createElement('div');
      downloads.className = 'action-row recovery-downloads';
      downloads.innerHTML = [...selected].map(index => `<button class="secondary-button" data-action="download-capture" data-index="${index}">${icon('download')} Download ${mode === 'photo' ? 'photo ' + (index + 1) : 'video'}</button>`).join('');
      error.after(downloads);
    }
  }
}
async function gallery() {
  resetSession();
  screen = 'gallery';
  const signal = session.signal;
  shell(`${pageHeading('COLLECTED WITH LOVE', 'Our <em>memories.</em>', 'The little moments that make the whole day.')}<section id="gallery-content" class="gallery-content"><p class="empty-message">Gathering the good bits…</p></section><p class="storage-note gallery-storage">Stored in this browser on this device. Download your favorites to keep a backup.</p>`, 'flow-page');
  try {
    galleryItems = await memoryStore.list();
    if (signal.aborted) return;
    document.querySelector('#gallery-content')!.innerHTML = galleryItems.length
      ? `<div class="memory-grid">${galleryItems.map((item, index) => `<article class="memory-card"><div class="memory-image">${item.kind === 'photo' ? `<img src="${urlFor(item.blob)}" alt="Saved photo ${index + 1}" loading="lazy">` : `<video src="${urlFor(item.blob)}" controls playsinline preload="metadata" aria-label="Saved video ${index + 1}"></video>`}</div><div class="memory-meta"><span>${icon(item.kind === 'photo' ? 'camera' : 'video')}${new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><button class="icon-button" data-action="download" data-index="${index}" aria-label="Download ${item.kind} ${index + 1}">${icon('download')}</button></div></article>`).join('')}</div>`
      : `<div class="empty-gallery"><span class="success-flower">${flower}</span><h2>Every story starts somewhere.</h2><p>Your first memory is just a little moment away.</p><button class="primary-button" data-action="home">Make a memory ${icon('arrow')}</button></div>`;
  } catch {
    if (!signal.aborted) document.querySelector('#gallery-content')!.innerHTML = '<div class="empty-gallery"><h2>Your memories couldn’t load.</h2><p>Check that browser storage is enabled, then try again.</p><button class="secondary-button" data-action="gallery">Try again</button></div>';
  }
}
function download(blob: Blob, kind: MemoryKind, date = Date.now()) {
  const extension = kind === 'photo' ? 'jpg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `fotobee-${kind}-${new Date(date).toISOString().replace(/[:.]/g, '-') }.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
app.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!target || target.disabled || saving) return;
  const index = Number(target.dataset.index);
  switch (target.dataset.action) {
    case 'home': home(); break;
    case 'photo': void begin('photo'); break;
    case 'video': void begin('video'); break;
    case 'retry': case 'retake': void begin(mode); break;
    case 'capture': void capture(); break;
    case 'select': togglePhoto(index); break;
    case 'save': void save(); break;
    case 'gallery': void gallery(); break;
    case 'microphone': microphone = !microphone; void begin('video'); break;
    case 'download': {
      const item = galleryItems[index];
      if (item) download(item.blob, item.kind, item.createdAt);
      break;
    }
    case 'download-capture': if (captures[index]) download(captures[index], mode); break;
    case 'fullscreen':
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => toast('Fullscreen isn’t available in this browser.'));
      else if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => toast('Fullscreen isn’t available in this browser.'));
      else toast('Fullscreen isn’t available in this browser.');
      break;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'camera') home('Your session was paused. Tap an experience when you’re ready.');
});
window.addEventListener('pagehide', () => { session.abort(); releaseCamera(); });
home();

