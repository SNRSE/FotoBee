/* FotoBee – Galerie & Diashow für das Brautpaar (unlisted page: /gallery.html).
 *
 * Polls /api/gallery, keeps the photo/video grid in sync without re-creating
 * existing tiles, offers a lightbox and a fullscreen TV slideshow.
 *
 * URL parameters:
 *   ?slideshow=1        start the slideshow right away (TV in the party room)
 *   ?interval=seconds   seconds per photo in the slideshow (default 7)
 *   ?poll=seconds       polling interval (default 20)
 */
(function () {
  'use strict';

  const cfg = window.FOTOBOX_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);

  const POLL_MS = Math.max(1, Number(params.get('poll')) || 20) * 1000;
  const SLIDE_MS = Math.max(2, Number(params.get('interval')) || 7) * 1000;
  const FADE_MS = 1200;
  const CURSOR_IDLE_MS = 3000;
  const HINT_MS = 6000;
  const AUTO_SLIDESHOW = params.get('slideshow') === '1' || params.get('slideshow') === 'true';

  const TEXT = {
    loading: 'Wird geladen…',
    error: 'Die Galerie konnte nicht geladen werden – läuft der FotoBox-Server? Wir versuchen es gleich noch einmal.',
    updated: 'Zuletzt aktualisiert um {time} Uhr',
    photo: 'Foto',
    photos: 'Fotos',
    video: 'Video',
    videos: 'Videos',
    strip: 'Fotostreifen',
  };

  const PLAY_ICON =
    '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 4.5 l12 7.5 l-12 7.5 z" fill="currentColor"/></svg>';

  const el = {
    coupleLine: $('couple-line'),
    counts: $('counts'),
    status: $('status'),
    error: $('error'),
    empty: $('empty'),
    sectionPhotos: $('section-photos'),
    sectionVideos: $('section-videos'),
    photoCount: $('photo-count'),
    videoCount: $('video-count'),
    photoGrid: $('photo-grid'),
    videoGrid: $('video-grid'),
    btnSlideshow: $('btn-slideshow'),
    btnRefresh: $('btn-refresh'),
    lightbox: $('lightbox'),
    lbImg: $('lb-img'),
    lbVideo: $('lb-video'),
    lbName: $('lb-name'),
    lbTime: $('lb-time'),
    lbDownload: $('lb-download'),
    lbClose: $('lb-close'),
    lbPrev: $('lb-prev'),
    lbNext: $('lb-next'),
    slideshow: $('slideshow'),
    slides: [$('slide-a'), $('slide-b')],
    slideEmpty: $('slide-empty'),
    slideCouple: $('slide-couple'),
    slideCounter: $('slide-counter'),
    slidePaused: $('slide-paused'),
    slideHint: $('slide-hint'),
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  const state = {
    photos: [], // API order (newest first)
    videos: [],
    items: [], // photos + videos, for lightbox navigation; each { key, kind, name, url, modified }
    tiles: new Map(), // key -> tile element
    loaded: false, // first successful fetch done
    loading: false,
    pollTimer: null,
  };

  const lightbox = { open: false, key: null };

  const show = {
    active: false,
    paused: false,
    wasFullscreen: false,
    timer: null,
    token: 0, // invalidates image preloads of a superseded slide
    layer: 0, // index of the slide layer currently on top
    hideTimer: null,
    cursorTimer: null,
    hintTimer: null,
    currentName: null, // photo currently on screen
    loopName: null, // last photo shown from the regular loop (queue jumps do not move it)
    pending: [], // new photos discovered while polling: shown next
    shown: 0, // slides shown so far (drives the Ken-Burns variant)
  };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** "10.10.2026, 20:14" from an ISO string; '' when unparsable. */
  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** "20:14" from an ISO string or Date; '' when unparsable. */
  function formatClock(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function isStrip(name) {
    return /_strip\.jpe?g$/i.test(name);
  }

  function count(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, (m, key) => (vars[key] != null ? vars[key] : m));
  }

  function lockScroll() {
    document.body.classList.toggle('lock', lightbox.open || show.active);
  }

  function slidePhotos() {
    return state.photos.filter((p) => !isStrip(p.name));
  }

  /* ------------------------------------------------------------------ */
  /* Loading & polling                                                   */
  /* ------------------------------------------------------------------ */
  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((f) => f && typeof f.name === 'string' && typeof f.url === 'string');
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    try {
      const res = await fetch('/api/gallery', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.ok) throw new Error('Unerwartete Antwort');
      render(sanitize(data.photos), sanitize(data.videos));
      setError(false);
      el.status.textContent = fill(TEXT.updated, { time: formatClock(new Date()) });
    } catch (err) {
      console.warn('[galerie] Laden fehlgeschlagen:', err && err.message ? err.message : err);
      setError(true);
    } finally {
      state.loading = false;
    }
  }

  function setError(on) {
    el.error.hidden = !on;
    el.error.textContent = on ? TEXT.error : '';
    if (on) el.empty.hidden = true;
    else updateEmptyState();
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(load, POLL_MS);
  }

  function stopPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  /* ------------------------------------------------------------------ */
  /* Grid rendering                                                      */
  /* ------------------------------------------------------------------ */
  function render(photos, videos) {
    state.photos = photos;
    state.videos = videos;
    const freshPhotos = syncGrid(el.photoGrid, 'photo', photos);
    syncGrid(el.videoGrid, 'video', videos);
    state.items = photos
      .map((p) => Object.assign({ key: 'photo:' + p.name, kind: 'photo' }, p))
      .concat(videos.map((v) => Object.assign({ key: 'video:' + v.name, kind: 'video' }, v)));

    el.counts.textContent = `${count(photos.length, TEXT.photo, TEXT.photos)} · ${count(videos.length, TEXT.video, TEXT.videos)}`;
    el.photoCount.textContent = photos.length ? String(photos.length) : '';
    el.videoCount.textContent = videos.length ? String(videos.length) : '';
    el.sectionPhotos.hidden = photos.length === 0;
    el.sectionVideos.hidden = videos.length === 0;

    const wasLoaded = state.loaded;
    state.loaded = true;
    updateEmptyState();
    if (lightbox.open) refreshLightbox();
    onPhotosChanged(wasLoaded ? freshPhotos.filter((p) => !isStrip(p.name)) : []);
  }

  function updateEmptyState() {
    el.empty.hidden = !state.loaded || state.items.length > 0 || !el.error.hidden;
  }

  /**
   * Bring the grid in line with the API list without touching tiles that
   * already exist: new tiles are inserted at their position (normally the
   * front), tiles of deleted files are removed. Returns the new items.
   */
  function syncGrid(grid, kind, list) {
    const fresh = [];
    const wanted = new Set();
    list.forEach((item, index) => {
      const key = kind + ':' + item.name;
      wanted.add(key);
      let tile = state.tiles.get(key);
      if (!tile) {
        tile = createTile(kind, item, key);
        state.tiles.set(key, tile);
        if (state.loaded) {
          tile.classList.add('is-new');
          fresh.push(item);
        }
      } else if (tile.dataset.modified !== item.modified) {
        tile.dataset.modified = item.modified;
        tile.querySelector('.tile-meta').textContent = formatClock(item.modified);
      }
      const at = grid.children[index] || null;
      if (at !== tile) grid.insertBefore(tile, at);
    });
    Array.from(grid.children).forEach((tile) => {
      if (wanted.has(tile.dataset.key)) return;
      grid.removeChild(tile);
      state.tiles.delete(tile.dataset.key);
    });
    return fresh;
  }

  function createTile(kind, item, key) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `tile tile-${kind}`;
    tile.dataset.key = key;
    tile.dataset.name = item.name;
    tile.dataset.modified = item.modified || '';
    tile.setAttribute('aria-label', `${kind === 'photo' ? TEXT.photo : TEXT.video} ${item.name}`);

    if (kind === 'photo') {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.src = item.url;
      tile.appendChild(img);
      if (isStrip(item.name)) {
        tile.classList.add('tile-strip');
        const badge = document.createElement('span');
        badge.className = 'tile-badge';
        badge.textContent = TEXT.strip;
        tile.appendChild(badge);
      }
    } else {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.addEventListener('error', () => tile.classList.add('is-broken'));
      video.src = item.url;
      tile.appendChild(video);
      const play = document.createElement('span');
      play.className = 'play-icon';
      play.innerHTML = PLAY_ICON; // constant markup, no user data
      tile.appendChild(play);
    }

    const meta = document.createElement('span');
    meta.className = 'tile-meta';
    meta.textContent = formatClock(item.modified);
    tile.appendChild(meta);

    tile.addEventListener('click', () => openLightbox(key));
    return tile;
  }

  /* ------------------------------------------------------------------ */
  /* Lightbox                                                            */
  /* ------------------------------------------------------------------ */
  function itemIndex(key) {
    return state.items.findIndex((item) => item.key === key);
  }

  function openLightbox(key) {
    if (itemIndex(key) < 0) return;
    lightbox.open = true;
    el.lightbox.hidden = false;
    lockScroll();
    showLightboxItem(key);
    el.lbClose.focus({ preventScroll: true });
  }

  function closeLightbox() {
    if (!lightbox.open) return;
    lightbox.open = false;
    lightbox.key = null;
    el.lightbox.hidden = true;
    stopLightboxVideo();
    el.lbImg.removeAttribute('src');
    lockScroll();
  }

  function stopLightboxVideo() {
    el.lbVideo.pause();
    el.lbVideo.removeAttribute('src');
    el.lbVideo.load();
    el.lbVideo.hidden = true;
  }

  function showLightboxItem(key) {
    const item = state.items[itemIndex(key)];
    if (!item) return;
    lightbox.key = key;
    if (item.kind === 'photo') {
      stopLightboxVideo();
      el.lbImg.src = item.url;
      el.lbImg.hidden = false;
    } else {
      el.lbImg.hidden = true;
      el.lbImg.removeAttribute('src');
      el.lbVideo.hidden = false;
      el.lbVideo.src = item.url;
      el.lbVideo.play().catch(() => {});
    }
    el.lbName.textContent = item.name;
    el.lbTime.textContent = formatDateTime(item.modified);
    el.lbDownload.href = item.url;
    el.lbDownload.setAttribute('download', item.name);
    const single = state.items.length < 2;
    el.lbPrev.hidden = single;
    el.lbNext.hidden = single;
  }

  function stepLightbox(step) {
    if (!lightbox.open || !state.items.length) return;
    const index = itemIndex(lightbox.key);
    const next = (index + step + state.items.length) % state.items.length;
    showLightboxItem(state.items[next].key);
  }

  /** After polling: the current file may have vanished. */
  function refreshLightbox() {
    if (itemIndex(lightbox.key) < 0) {
      if (state.items.length) showLightboxItem(state.items[0].key);
      else closeLightbox();
    } else {
      const single = state.items.length < 2;
      el.lbPrev.hidden = single;
      el.lbNext.hidden = single;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Slideshow                                                           */
  /* ------------------------------------------------------------------ */
  function startSlideshow() {
    if (show.active) return;
    closeLightbox();
    show.active = true;
    show.paused = false;
    show.pending = [];
    show.currentName = null;
    show.loopName = null;
    el.slideshow.hidden = false;
    el.slidePaused.hidden = true;
    el.slideshow.classList.remove('paused', 'idle');
    el.slideHint.classList.remove('fade');
    el.slideCouple.textContent = coupleText();
    el.slideCounter.textContent = '';
    lockScroll();
    requestFullscreen();
    resetCursorTimer();
    clearTimeout(show.hintTimer);
    show.hintTimer = setTimeout(() => el.slideHint.classList.add('fade'), HINT_MS);
    advanceSlide(1);
  }

  function exitSlideshow() {
    if (!show.active) return;
    show.active = false;
    show.token += 1;
    clearTimeout(show.timer);
    clearTimeout(show.hideTimer);
    clearTimeout(show.cursorTimer);
    clearTimeout(show.hintTimer);
    el.slideshow.hidden = true;
    el.slideshow.classList.remove('paused', 'idle');
    el.slides.forEach((layer) => {
      layer.classList.remove('show');
      layer.style.zIndex = '';
    });
    lockScroll();
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    show.wasFullscreen = false;
  }

  function requestFullscreen() {
    const root = document.documentElement;
    if (document.fullscreenElement || !root.requestFullscreen) return;
    let request;
    try {
      request = root.requestFullscreen();
    } catch (err) {
      return;
    }
    if (request && request.then) {
      request.then(() => { show.wasFullscreen = true; }).catch(() => {});
    }
  }

  function scheduleSlide(ms) {
    clearTimeout(show.timer);
    if (!show.active || show.paused) return;
    show.timer = setTimeout(() => advanceSlide(1), ms == null ? SLIDE_MS : ms);
  }

  /** Move by `step` (+1/-1) in the loop; a pending new photo jumps the queue on +1. */
  function advanceSlide(step) {
    if (!show.active) return;
    const list = slidePhotos();
    if (!list.length) {
      el.slideEmpty.hidden = false;
      el.slideCounter.textContent = '';
      show.currentName = null;
      return;
    }
    el.slideEmpty.hidden = true;

    let item = null;
    if (step > 0) {
      while (show.pending.length && !item) {
        const name = show.pending.shift();
        item = list.find((p) => p.name === name) || null;
      }
    }
    if (!item) {
      const index = list.findIndex((p) => p.name === show.loopName);
      const next = index < 0 ? 0 : (index + step + list.length) % list.length;
      item = list[next];
      show.loopName = item.name;
    }
    showSlide(item, list);
  }

  function showSlide(item, list) {
    const token = ++show.token;
    clearTimeout(show.timer);
    const img = new Image();
    img.onload = () => {
      if (token !== show.token || !show.active) return;
      paintSlide(item, list);
      scheduleSlide();
    };
    img.onerror = () => {
      if (token !== show.token || !show.active) return;
      // unreadable file: move on quickly instead of showing a blank screen
      show.currentName = item.name;
      scheduleSlide(500);
    };
    img.src = item.url;
  }

  /** Crossfade the decoded photo in on the inactive layer. */
  function paintSlide(item, list) {
    const outgoing = el.slides[show.layer];
    show.layer = 1 - show.layer;
    const incoming = el.slides[show.layer];
    clearTimeout(show.hideTimer);

    incoming.classList.remove('show');
    incoming.querySelectorAll('img').forEach((img) => { img.src = item.url; });
    incoming.dataset.kb = String(show.shown % 4);
    incoming.style.zIndex = '3';
    outgoing.style.zIndex = '2';
    void incoming.offsetWidth; // restart the Ken-Burns animation and the fade
    incoming.classList.add('show');
    // The outgoing layer stays fully visible underneath until the fade is done,
    // then it is hidden (unnoticed, it is covered) so it can be reused.
    show.hideTimer = setTimeout(() => outgoing.classList.remove('show'), FADE_MS + 80);

    show.shown += 1;
    show.currentName = item.name;
    const position = list.findIndex((p) => p.name === item.name) + 1;
    el.slideCounter.textContent = `${position} / ${list.length}`;
  }

  function togglePause() {
    if (!show.active) return;
    show.paused = !show.paused;
    el.slideshow.classList.toggle('paused', show.paused);
    el.slidePaused.hidden = !show.paused;
    if (show.paused) clearTimeout(show.timer);
    else scheduleSlide();
  }

  /** Called after every render with the photos that were not there before. */
  function onPhotosChanged(freshPhotos) {
    if (!show.active) return;
    freshPhotos.forEach((p) => {
      if (!show.pending.includes(p.name)) show.pending.push(p.name);
    });
    // Nothing on screen yet (started before the first picture arrived): go.
    if (!show.currentName && slidePhotos().length) advanceSlide(1);
  }

  function resetCursorTimer() {
    el.slideshow.classList.remove('idle');
    clearTimeout(show.cursorTimer);
    show.cursorTimer = setTimeout(() => el.slideshow.classList.add('idle'), CURSOR_IDLE_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Header texts                                                        */
  /* ------------------------------------------------------------------ */
  function coupleText() {
    return [cfg.coupleNames, cfg.eventDate].filter(Boolean).join(' · ');
  }

  function renderHeader() {
    el.coupleLine.textContent = coupleText();
    el.counts.textContent = TEXT.loading;
    const title = cfg.coupleNames ? `Galerie – ${cfg.coupleNames}` : 'Galerie – FotoBox';
    document.title = title;
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */
  el.btnSlideshow.addEventListener('click', startSlideshow);
  el.btnRefresh.addEventListener('click', load);
  el.lbClose.addEventListener('click', closeLightbox);
  el.lbPrev.addEventListener('click', () => stepLightbox(-1));
  el.lbNext.addEventListener('click', () => stepLightbox(1));
  el.lightbox.addEventListener('click', (event) => {
    if (event.target === el.lightbox) closeLightbox(); // backdrop
  });
  el.slideshow.addEventListener('click', exitSlideshow);
  el.slideshow.addEventListener('mousemove', resetCursorTimer, { passive: true });

  document.addEventListener('keydown', (event) => {
    const key = event.key;
    if (show.active) {
      if (key === 'Escape') exitSlideshow();
      else if (key === ' ') togglePause();
      else if (key === 'ArrowRight') advanceSlide(1);
      else if (key === 'ArrowLeft') advanceSlide(-1);
      else return;
      event.preventDefault();
      return;
    }
    if (lightbox.open) {
      if (key === 'Escape') closeLightbox();
      else if (key === 'ArrowRight') stepLightbox(1);
      else if (key === 'ArrowLeft') stepLightbox(-1);
      else return;
      event.preventDefault();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    // Leaving fullscreen (e.g. Esc handled by the browser) ends the TV mode.
    if (!document.fullscreenElement && show.active && show.wasFullscreen) exitSlideshow();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      load();
      startPolling();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  document.documentElement.style.setProperty('--fade-ms', `${FADE_MS}ms`);
  document.documentElement.style.setProperty('--slide-ms', `${SLIDE_MS + FADE_MS}ms`);
  renderHeader();
  if (AUTO_SLIDESHOW) startSlideshow();
  load();
  if (!document.hidden) startPolling();

  // Small debug API for tests and kiosk scripts.
  window.Gallery = {
    load,
    startSlideshow,
    exitSlideshow,
    getState: () => ({
      photos: state.photos.length,
      videos: state.videos.length,
      lightbox: lightbox.open ? lightbox.key : null,
      slideshow: show.active ? { current: show.currentName, paused: show.paused, pending: show.pending.slice() } : null,
    }),
  };
})();
