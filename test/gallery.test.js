#!/usr/bin/env node
/**
 * Gallery page test: seeds a temporary capture directory through the API,
 * drives /gallery.html in headless Chromium and takes screenshots.
 *
 *   npm run test:gallery
 *
 * Same conventions as test/e2e.js: own server on a random port, temporary
 * CAPTURE_DIR, screenshots in test/screenshots/gallery-*.png, exit code 1 on
 * any failed check.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    const candidates = [
      process.env.PLAYWRIGHT_MODULE,
      '/opt/node22/lib/node_modules/playwright',
      '/usr/lib/node_modules/playwright',
      '/usr/local/lib/node_modules/playwright',
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        return require(candidate);
      } catch (err2) {
        /* try next */
      }
    }
    console.error('Playwright not found. Install with: npm i -D playwright');
    process.exit(1);
  }
}

const { chromium } = loadPlaywright();

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
const PORT = 3600 + Math.floor(Math.random() * 500);
const CAPTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fotobee-gallery-'));
const TZ = 'Europe/Berlin';
const SESSION = '2026-09-01_20-14-05';
const T0 = Date.UTC(2026, 8, 1, 18, 14, 0); // 01.09.2026, 20:14 in Berlin (CEST)

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: Object.assign({}, process.env, { PORT: String(PORT), CAPTURE_DIR }),
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('running')) resolve(child);
    });
    child.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
    setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}

/* ------------------------------------------------------------------ */
/* Seeding helpers                                                     */
/* ------------------------------------------------------------------ */

/** POST a raw body to the server from Node (no browser involved). */
function post(base, route, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(route, base),
      { method: 'POST', headers: Object.assign({ 'Content-Length': body.length }, headers) },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Draw a labelled picture on a canvas inside the page and POST it as JPEG. */
function seedPhoto(page, opts) {
  return page.evaluate(async (o) => {
    const canvas = document.createElement('canvas');
    canvas.width = o.width;
    canvas.height = o.height;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, o.width, o.height);
    gradient.addColorStop(0, `hsl(${o.hue}, 45%, 72%)`);
    gradient.addColorStop(1, `hsl(${o.hue + 40}, 40%, 38%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, o.width, o.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = `bold ${Math.round(Math.min(o.width, o.height) / 2.4)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.label, o.width / 2, o.height / 2);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    const res = await fetch('/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'X-Session': o.session, 'X-Index': o.index },
      body: blob,
    });
    return res.json();
  }, opts);
}

/** A few bytes of EBML header: enough to be listed as a .webm video. */
function seedVideo(base, session) {
  const bytes = Buffer.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
    0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x02, 0x42, 0x85,
    0x81, 0x02,
  ]);
  return post(base, '/api/videos', { 'Content-Type': 'video/webm', 'X-Session': session }, bytes);
}

function setMtime(kind, name, ms) {
  const file = path.join(CAPTURE_DIR, kind, name);
  fs.utimesSync(file, new Date(ms), new Date(ms));
}

/** "01.09.2026, 20:14" for a timestamp, as the page renders it in Berlin time. */
function berlin(ms) {
  const parts = {};
  new Intl.DateTimeFormat('de-DE', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(ms))
    .forEach((p) => { parts[p.type] = p.value; });
  return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Page helpers                                                        */
/* ------------------------------------------------------------------ */
const photoTileNames = (page) => page.$$eval('.tile-photo', (tiles) => tiles.map((t) => t.dataset.name));
const currentSlide = (page) => page.evaluate(() => (window.Gallery.getState().slideshow || {}).current || null);
const text = async (page, selector) => ((await page.textContent(selector)) || '').trim();

function waitForSlide(page, suffix, timeout) {
  return page.waitForFunction(
    (s) => {
      const st = window.Gallery.getState().slideshow;
      if (!st || !st.current || !st.current.endsWith(s)) return false;
      const img = document.querySelector('.slide.show .slide-img');
      return Boolean(img && img.getAttribute('src') && img.getAttribute('src').endsWith(encodeURIComponent(st.current)));
    },
    suffix,
    { timeout: timeout || 8000 }
  );
}

function waitForPhotoTiles(page, n, timeout) {
  return page.waitForFunction((count) => document.querySelectorAll('.tile-photo').length === count, n, {
    timeout: timeout || 8000,
  });
}

/* ------------------------------------------------------------------ */
/* Test                                                                */
/* ------------------------------------------------------------------ */
async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const base = `http://localhost:${PORT}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: TZ });
    const page = await context.newPage();
    page.on('pageerror', (err) => {
      failures += 1;
      console.log(`  ✗ page error: ${err.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  [console.error] ${msg.text()}`);
    });

    /* ---------------- Empty state ---------------- */
    console.log('\nEmpty gallery');
    await page.goto(`${base}/gallery.html?poll=1`);
    await page.waitForSelector('#empty', { state: 'visible', timeout: 8000 });
    assert((await text(page, '#empty')).includes('Noch keine Bilder – die ersten Gäste sind unterwegs!'), 'German empty state is shown');
    assert((await text(page, '#counts')) === '0 Fotos · 0 Videos', `counts read "0 Fotos · 0 Videos" (got "${await text(page, '#counts')}")`);
    assert((await text(page, '#couple-line')) === 'Lena & Lami · 10.10.2026', 'couple line comes from config.js');
    assert(await page.isHidden('#section-photos'), 'photo section hidden while empty');
    assert(await page.evaluate(() => document.documentElement.lang === 'de'), 'document language is German');
    await page.screenshot({ path: path.join(SHOTS, 'gallery-empty.png') });

    /* ---------------- Seed 3 photos + 1 video ---------------- */
    console.log('\nSeeding');
    const seeded = [];
    for (let i = 1; i <= 3; i += 1) {
      const result = await seedPhoto(page, { session: SESSION, index: String(i), width: 800, height: 450, hue: 30 + i * 60, label: String(i) });
      assert(result.ok && /_\d\.jpg$/.test(result.file), `photo ${i} uploaded (${result.file})`);
      const name = path.basename(result.file);
      setMtime('photos', name, T0 + (i - 1) * 60000);
      seeded.push(name);
    }
    const video = await seedVideo(base, SESSION);
    assert(video.ok && /\.webm$/.test(video.file), `video uploaded (${video.file})`);
    setMtime('videos', path.basename(video.file), T0 + 6 * 60000);

    // The open page polls every second: the new files must glide in without a reload.
    await waitForPhotoTiles(page, 3);
    assert(await page.isHidden('#empty'), 'empty state disappears once files arrive');
    assert((await page.$$eval('.tile-photo.is-new', (t) => t.length)) === 3, 'files that arrive while polling get the fade-in class');

    /* ---------------- Grid ---------------- */
    console.log('\nGrid');
    await page.goto(`${base}/gallery.html?poll=1`);
    await waitForPhotoTiles(page, 3);
    assert((await text(page, '#counts')) === '3 Fotos · 1 Video', `counts read "3 Fotos · 1 Video" (got "${await text(page, '#counts')}")`);
    assert((await page.$$eval('.tile-video', (t) => t.length)) === 1, 'one video card');
    assert((await page.$$eval('.tile-photo.is-new', (t) => t.length)) === 0, 'initial load does not animate tiles');
    const names = await photoTileNames(page);
    assert(names[0] === seeded[2] && names[2] === seeded[0], `photos newest first (${names.join(', ')})`);
    assert((await text(page, '.tile-photo .tile-meta')) === '20:16', 'tile shows the capture time');
    assert(await page.$eval('.tile-video video', (v) => v.getAttribute('preload') === 'metadata'), 'video thumbnail uses preload=metadata');
    assert(await page.$('.tile-video .play-icon'), 'video card has a play icon');
    assert(await page.isVisible('#section-videos'), 'video section visible');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.tile-photo img')).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 8000 });
    assert(true, 'photo thumbnails decode');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-grid.png') });

    /* ---------------- Lightbox ---------------- */
    console.log('\nLightbox');
    await page.click('.tile-photo');
    await page.waitForSelector('#lightbox', { state: 'visible' });
    const lbSrc = () => page.getAttribute('#lb-img', 'src');
    assert((await lbSrc()).endsWith(encodeURIComponent(seeded[2])), 'lightbox opens the clicked (newest) photo');
    assert((await text(page, '#lb-name')) === seeded[2], 'file name shown via textContent');
    assert((await text(page, '#lb-time')) === berlin(T0 + 2 * 60000), `time formatted German (${await text(page, '#lb-time')})`);
    assert((await page.getAttribute('#lb-download', 'download')) === seeded[2], 'download link carries the file name');
    assert((await page.getAttribute('#lb-download', 'href')).endsWith(encodeURIComponent(seeded[2])), 'download link points at the file');
    assert((await text(page, '#lb-download')) === 'Herunterladen', 'download link reads "Herunterladen"');
    assert(await page.evaluate(() => document.body.classList.contains('lock')), 'page scroll locked behind the lightbox');
    await page.click('#lb-next');
    assert((await lbSrc()).endsWith(encodeURIComponent(seeded[1])), 'next button shows the second photo');
    await page.keyboard.press('ArrowRight');
    assert((await lbSrc()).endsWith(encodeURIComponent(seeded[0])), 'ArrowRight shows the third photo');
    await page.keyboard.press('ArrowLeft');
    assert((await lbSrc()).endsWith(encodeURIComponent(seeded[1])), 'ArrowLeft goes back');
    await page.waitForFunction(() => { const i = document.getElementById('lb-img'); return i.complete && i.naturalWidth > 0; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-lightbox.png') });
    await page.keyboard.press('Escape');
    assert(await page.isHidden('#lightbox'), 'Esc closes the lightbox');
    assert(await page.evaluate(() => !document.body.classList.contains('lock')), 'scroll lock released');

    await page.click('.tile-video');
    await page.waitForSelector('#lightbox', { state: 'visible' });
    assert(await page.isVisible('#lb-video'), 'video plays inline in the lightbox');
    assert((await page.getAttribute('#lb-video', 'src')).endsWith('.webm'), 'lightbox video has the file as source');
    assert(await page.$eval('#lb-video', (v) => v.hasAttribute('controls')), 'lightbox video has controls');
    assert(await page.isHidden('#lb-img'), 'image hidden while a video is shown');
    await page.click('#lb-close');
    assert(await page.isHidden('#lightbox'), 'close button closes the lightbox');
    assert(await page.$eval('#lb-video', (v) => !v.getAttribute('src')), 'video source released on close');
    await page.click('.tile-photo');
    await page.waitForSelector('#lightbox', { state: 'visible' });
    await page.click('#lightbox', { position: { x: 120, y: 30 } });
    assert(await page.isHidden('#lightbox'), 'click on the backdrop closes the lightbox');

    /* ---------------- Slideshow via button ---------------- */
    console.log('\nSlideshow (button)');
    await page.click('#btn-slideshow');
    await page.waitForSelector('#slideshow', { state: 'visible' });
    await waitForSlide(page, seeded[2]);
    assert(true, 'slideshow starts with the newest photo');
    assert((await text(page, '#slide-counter')) === '1 / 3', `counter reads "1 / 3" (got "${await text(page, '#slide-counter')}")`);
    assert((await text(page, '#slide-couple')) === 'Lena & Lami · 10.10.2026', 'caption shows names and date');
    assert(await page.$eval('.slide.show .slide-img', (img) => getComputedStyle(img).animationName.startsWith('kb-')), 'Ken-Burns animation runs');
    await page.keyboard.press('ArrowRight');
    await waitForSlide(page, seeded[1]);
    assert((await text(page, '#slide-counter')) === '2 / 3', 'ArrowRight advances to the next photo');
    await page.keyboard.press('ArrowLeft');
    await waitForSlide(page, seeded[2]);
    assert(true, 'ArrowLeft goes back');
    await page.keyboard.press(' ');
    assert(await page.isVisible('#slide-paused'), 'Space pauses the slideshow');
    await page.keyboard.press(' ');
    assert(await page.isHidden('#slide-paused'), 'Space resumes the slideshow');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-slideshow.png') });
    await page.mouse.move(400, 300);
    await page.waitForTimeout(3400);
    assert(await page.$eval('#slideshow', (s) => s.classList.contains('idle') && getComputedStyle(s).cursor === 'none'), 'cursor hidden after 3 s idle');
    await page.keyboard.press('Escape');
    assert(await page.isHidden('#slideshow'), 'Esc exits the slideshow');
    assert(await page.isVisible('#photo-grid'), 'grid visible again');

    await page.click('#btn-slideshow');
    await page.waitForSelector('#slideshow', { state: 'visible' });
    await page.click('#slideshow', { position: { x: 200, y: 200 } });
    assert(await page.isHidden('#slideshow'), 'click exits the slideshow');

    /* ---------------- Slideshow via URL, auto advance, queue jump ---------------- */
    console.log('\nSlideshow (?slideshow=1)');
    await page.goto(`${base}/gallery.html?slideshow=1&interval=2&poll=1`);
    assert(await page.isVisible('#slideshow'), 'slideshow starts immediately from the URL');
    await waitForSlide(page, seeded[2]);
    assert(true, 'first photo shown');
    await waitForSlide(page, seeded[1], 6000);
    assert(true, 'auto-advances after the configured interval');
    const jump = await seedPhoto(page, { session: SESSION, index: '4', width: 800, height: 450, hue: 300, label: '4' });
    const jumpName = path.basename(jump.file);
    await waitForSlide(page, jumpName, 9000);
    assert(true, 'a new photo jumps the queue and is shown next');
    assert((await page.$$eval('.tile-photo', (t) => t.length)) === 4, 'grid behind the slideshow picked up the new photo too');
    await page.keyboard.press('Escape');
    assert(await page.isHidden('#slideshow'), 'Esc exits the URL-started slideshow');

    /* ---------------- Print strips ---------------- */
    console.log('\nStrips');
    const strip = await seedPhoto(page, { session: SESSION, index: 'strip', width: 400, height: 1200, hue: 200, label: 'S' });
    assert(/_strip\.jpg$/.test(strip.file), `strip uploaded (${strip.file})`);
    await waitForPhotoTiles(page, 5);
    assert(await page.$('.tile-strip .tile-badge'), 'strip tile is marked');
    assert((await text(page, '.tile-strip .tile-badge')) === 'Fotostreifen', 'strip badge reads "Fotostreifen"');
    await page.click('#btn-slideshow');
    await waitForSlide(page, jumpName);
    assert((await text(page, '#slide-counter')).endsWith('/ 4'), `slideshow skips the strip (counter "${await text(page, '#slide-counter')}")`);
    await page.keyboard.press('Escape');

    /* ---------------- Polling keeps existing tiles ---------------- */
    console.log('\nPolling');
    await page.goto(`${base}/gallery.html?poll=1`);
    await waitForPhotoTiles(page, 5);
    await page.$$eval('.tile-photo img', (imgs) => imgs.forEach((img) => { img.dataset.mark = 'kept'; }));
    await wait(30);
    const late = await seedPhoto(page, { session: SESSION, index: '5', width: 800, height: 450, hue: 100, label: '5' });
    await waitForPhotoTiles(page, 6);
    const afterNames = await photoTileNames(page);
    assert(afterNames[0] === path.basename(late.file), 'new photo inserted at the front');
    assert(await page.$eval('.tile-photo', (t) => t.classList.contains('is-new')), 'new tile fades in');
    assert((await page.$$eval('.tile-photo img[data-mark="kept"]', (i) => i.length)) === 5, 'existing tiles were not re-created');
    await page.waitForFunction(() => document.getElementById('counts').textContent.trim() === '6 Fotos · 1 Video');
    assert(true, 'counts updated to "6 Fotos · 1 Video"');

    /* ---------------- Backend missing ---------------- */
    console.log('\nBackend missing');
    await page.route('**/api/gallery*', (route) => route.abort());
    await page.click('#btn-refresh');
    await page.waitForSelector('#error', { state: 'visible', timeout: 8000 });
    assert((await text(page, '#error')).includes('FotoBox-Server'), 'German error line when the backend is unreachable');
    assert((await page.$$eval('.tile-photo', (t) => t.length)) === 6, 'grid keeps the already loaded files');
    await page.screenshot({ path: path.join(SHOTS, 'gallery-error.png') });
    await page.unroute('**/api/gallery*');
    await page.waitForSelector('#error', { state: 'hidden', timeout: 8000 });
    assert(true, 'error disappears once polling succeeds again');

    /* ---------------- Phone ---------------- */
    console.log('\nPhone');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/gallery.html?poll=1`);
    await waitForPhotoTiles(page, 6);
    assert((await page.$eval('#photo-grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)) === 2, 'grid collapses to 2 columns');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
    assert(await page.$eval('#photo-grid', (g) => g.getBoundingClientRect().left >= 16), '16px gutter');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.tile-photo img')).slice(0, 4).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-phone.png') });
    await page.click('.tile-photo');
    await page.waitForSelector('#lightbox', { state: 'visible' });
    await page.waitForFunction(() => { const i = document.getElementById('lb-img'); return i.complete && i.naturalWidth > 0; });
    const fits = await page.evaluate(() => {
      const r = document.querySelector('.lb-frame').getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.width > 200;
    });
    assert(fits, 'lightbox fits on a phone');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'gallery-phone-lightbox.png') });
    await page.keyboard.press('Escape');
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(CAPTURE_DIR, { recursive: true, force: true });
  }

  console.log(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'} – screenshots in ${path.relative(ROOT, SHOTS)}/`);
  process.exit(failures ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
