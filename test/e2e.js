#!/usr/bin/env node
/**
 * End-to-end smoke test: drives the booth in headless Chromium with a fake camera.
 *
 *   npm test
 *
 * Requires Playwright (`npm i -D playwright` or a global install). Chromium is
 * started with fake media devices so no real webcam is needed. Screenshots are
 * written to test/screenshots/.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
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
const PORT = 3100 + Math.floor(Math.random() * 500);
const CAPTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fotobee-captures-'));
// Short timings so the whole run stays fast; the flows themselves are unchanged.
const FAST_PARAMS =
  'photoFirstCountdownSeconds=2&countdownSeconds=1&pauseBetweenShotsMs=600&freezeFrameMs=300&videoFirstCountdownSeconds=1&videoSeconds=3&thanksDurationMs=700';

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

function listFiles(kind) {
  const dir = path.join(CAPTURE_DIR, kind);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** Files in captures/<kind> that were not there before. */
function newFiles(kind, before) {
  return listFiles(kind).filter((f) => !before.includes(f));
}

/** Read width/height from a JPEG's SOF marker (no image library needed). */
function jpegSize(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // padding
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2; // standalone markers
      continue;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** Run the photo capture until the review screen is shown (auto-start countdown, four pictures). */
async function captureToReview(page) {
  await page.click('#btn-photo');
  await page.waitForSelector('#screen-photo-review', { state: 'visible', timeout: 30000 });
  return page.$$('#review-photos .photo-card');
}

/** Show a saved strip in a second tab, screenshot it and return its decoded size. */
async function screenshotStrip(context, base, file, screenshotName) {
  const size = jpegSize(path.join(CAPTURE_DIR, 'photos', file)) || { width: 600, height: 1800 };
  const height = 1350;
  const width = Math.round((height * size.width) / size.height);
  const viewer = await context.newPage();
  await viewer.setViewportSize({ width: width + 80, height: height + 80 });
  await viewer.setContent(
    `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#2B2118">` +
      `<img src="${base}/captures/photos/${encodeURIComponent(file)}" style="height:${height}px;box-shadow:0 24px 60px rgba(0,0,0,.6)"></body>`
  );
  await viewer.waitForFunction(() => {
    const img = document.querySelector('img');
    return img && img.complete && img.naturalWidth > 0;
  });
  const natural = await viewer.$eval('img', (img) => ({ width: img.naturalWidth, height: img.naturalHeight }));
  await viewer.screenshot({ path: path.join(SHOTS, screenshotName) });
  await viewer.close();
  return natural;
}

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const base = `http://localhost:${PORT}`;
  const gotoApp = (page, extra) => page.goto(`${base}/?${FAST_PARAMS}${extra ? '&' + extra : ''}`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['camera', 'microphone'],
      acceptDownloads: true,
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => {
      failures += 1;
      console.log(`  ✗ page error: ${err.message}`);
    });
    const consoleTexts = [];
    page.on('console', (msg) => {
      consoleTexts.push(msg.text());
      if (msg.type() === 'error') console.log(`  [console.error] ${msg.text()}`);
    });

    /* ---------------- Home ---------------- */
    console.log('\nHome screen');
    await gotoApp(page);
    await page.waitForSelector('#screen-home', { state: 'visible' });
    assert((await page.textContent('#btn-photo .option-label')).trim() === 'Foto', 'photo option is visible');
    assert((await page.textContent('#couple-line')).includes('Lena & Lami'), 'couple line shows the configured names');
    assert((await page.textContent('#btn-video .option-label')).trim() === 'Video', 'video option is visible');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, '01-home.png') });

    /* ---------------- Strip module ---------------- */
    console.log('\nStrip module');
    const stripInfo = await page.evaluate(async () => {
      const makePhoto = (color) =>
        new Promise((resolve) => {
          const c = document.createElement('canvas');
          c.width = 320;
          c.height = 180;
          const ctx = c.getContext('2d');
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 320, 180);
          c.toBlob(resolve, 'image/jpeg', 0.8);
        });
      const blobs = await Promise.all(['#a33', '#3a3', '#33a'].map(makePhoto));
      const shots = blobs.map((blob) => ({ blob }));
      const out = {};
      for (const n of [3, 2]) {
        const started = performance.now();
        const blob = await window.Strip.compose(shots.slice(0, n), { coupleNames: 'Lena & Lami', eventDate: '10.10.2026', brand: 'FotoBox', dpi: 300 });
        const bmp = await createImageBitmap(blob);
        out[n] = { width: bmp.width, height: bmp.height, type: blob.type, ms: Math.round(performance.now() - started) };
        bmp.close();
      }
      out.size150 = window.Strip.sizeFor(4, 150);
      return out;
    });
    assert(stripInfo[3].width === 600 && stripInfo[3].height === 1800, `three photos give a 2x6" strip (${stripInfo[3].width}x${stripInfo[3].height}, ${stripInfo[3].ms} ms)`);
    assert(stripInfo[2].width === 1200 && stripInfo[2].height === 1800, `two photos give a 4x6" postcard (${stripInfo[2].width}x${stripInfo[2].height}, ${stripInfo[2].ms} ms)`);
    assert(stripInfo[3].type === 'image/jpeg', 'strip is a JPEG');
    assert(stripInfo.size150.width === 300 && stripInfo.size150.height === 900, 'stripDpi scales the paper size');

    /* ---------------- Photo flow ---------------- */
    console.log('\nPhoto flow');
    let before = listFiles('photos');
    await page.click('#btn-photo');
    await page.waitForSelector('#screen-capture', { state: 'visible' });
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    assert(await page.isVisible('#preview'), 'live preview is shown');
    assert(await page.isHidden('#btn-start'), 'no start button – countdown begins right away');
    assert(!(await page.$('#preview.fit-contain')), 'landscape camera on a landscape stage fills the stage (cover)');
    const cameras = await page.evaluate(() => window.Camera.listCameras());
    assert(cameras.length >= 1 && cameras.every((c) => typeof c.deviceId === 'string'), `Camera.listCameras() lists ${cameras.length} camera(s)`);
    const firstNumber = await page.textContent('#countdown-number');
    assert(firstNumber === '2', `first countdown starts at photoFirstCountdownSeconds (got ${firstNumber})`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, '02-photo-countdown.png') });
    await page.waitForFunction(() => document.getElementById('shot-counter').textContent.startsWith('Foto 2'), null, { timeout: 15000 });
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    const secondNumber = await page.textContent('#countdown-number');
    assert(secondNumber === '1', `later countdowns use countdownSeconds (got ${secondNumber})`);
    assert(await page.isHidden('#stage-message'), 'no message between the pictures');
    await page.screenshot({ path: path.join(SHOTS, '03-photo-second-countdown.png') });

    await page.waitForSelector('#screen-photo-review', { state: 'visible', timeout: 30000 });
    const cards = await page.$$('#review-photos .photo-card');
    assert(cards.length === 4, `four photos on the review screen (got ${cards.length})`);
    const naturalWidths = await page.$$eval('#review-photos img', (imgs) => imgs.map((img) => img.naturalWidth));
    assert(naturalWidths.every((w) => w > 0), `captured images decode (${naturalWidths.join('x')})`);
    await page.waitForTimeout(400);
    const fits = await page.evaluate(() => {
      const box = document.getElementById('review-photos').getBoundingClientRect();
      return Array.from(document.querySelectorAll('#review-photos .photo-card')).every((c) => {
        const r = c.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 20 && r.bottom <= box.bottom + 20 && r.width > 100;
      });
    });
    assert(fits, 'all four photo cards fit inside the review area');
    assert((await page.textContent('#btn-photo-save')).trim() === 'Alle speichern', 'save button reads "Alle speichern"');
    await page.screenshot({ path: path.join(SHOTS, '04-photo-review.png') });

    await cards[1].click();
    assert((await page.textContent('#btn-photo-save')).trim() === '3 Fotos speichern', 'deselecting one photo updates the label');
    await cards[2].click();
    await cards[3].click();
    assert((await page.textContent('#btn-photo-save')).trim() === 'Dieses speichern', 'one selected photo reads "Dieses speichern"');
    await page.screenshot({ path: path.join(SHOTS, '05-photo-review-one-selected.png') });
    await cards[0].click();
    assert(await page.isDisabled('#btn-photo-save'), 'save button disabled when nothing is selected');
    await cards[0].click();

    await page.click('#btn-photo-save');
    await page.waitForSelector('#overlay:not([hidden])');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, '06-photo-saved.png') });
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 10000 });
    const oneRun = newFiles('photos', before);
    assert(oneRun.length === 2, `photo + strip saved on the server (${oneRun.join(', ')})`);
    assert(oneRun.some((f) => /_1\.jpg$/.test(f)), 'saved photo keeps its index');
    const strip1 = oneRun.find((f) => /_strip\.jpg$/.test(f));
    assert(Boolean(strip1), 'strip saved as <session>_strip.jpg');
    if (strip1) {
      const size = jpegSize(path.join(CAPTURE_DIR, 'photos', strip1));
      assert(size && size.width === 1200 && size.height === 1800, `one photo gives a 4x6" postcard strip (${size && size.width}x${size && size.height})`);
      const natural = await screenshotStrip(context, base, strip1, '13-strip-1.png');
      assert(natural.width === 1200 && natural.height === 1800, 'postcard strip decodes in the browser');
    }
    assert(await page.evaluate(() => !document.getElementById('preview').srcObject), 'camera released after returning home');

    /* ---------------- Photo: save none ---------------- */
    console.log('\nPhoto flow – save none');
    before = listFiles('photos');
    await captureToReview(page);
    await page.click('#btn-photo-none');
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 10000 });
    assert(newFiles('photos', before).length === 0, 'no additional photo saved');

    /* ---------------- Photo: keep all four ---------------- */
    console.log('\nPhoto flow – keep all four');
    before = listFiles('photos');
    await captureToReview(page);
    await page.click('#btn-photo-save');
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 15000 });
    const fourRun = newFiles('photos', before);
    assert(fourRun.length === 5, `four photos + strip saved (${fourRun.length} files)`);
    assert([1, 2, 3, 4].every((n) => fourRun.some((f) => f.endsWith(`_${n}.jpg`))), 'all four photos keep their index');
    const strip4 = fourRun.find((f) => /_strip\.jpg$/.test(f));
    if (strip4) {
      const size = jpegSize(path.join(CAPTURE_DIR, 'photos', strip4));
      assert(size && size.width === 600 && size.height === 1800, `four photos give a 2x6" strip (${size && size.width}x${size && size.height})`);
      const stat = fs.statSync(path.join(CAPTURE_DIR, 'photos', strip4));
      assert(stat.size > 20000, `strip has content (${stat.size} bytes)`);
      await screenshotStrip(context, base, strip4, '12-strip-4.png');
    } else {
      assert(false, 'strip saved for the four-photo run');
    }

    /* ---------------- Photo: strip disabled ---------------- */
    console.log('\nPhoto flow – saveStrip=false');
    await gotoApp(page, 'saveStrip=false');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    before = listFiles('photos');
    const cardsNoStrip = await captureToReview(page);
    await cardsNoStrip[1].click();
    await cardsNoStrip[2].click();
    await cardsNoStrip[3].click();
    await page.click('#btn-photo-save');
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 15000 });
    const noStrip = newFiles('photos', before);
    assert(noStrip.length === 1 && /_1\.jpg$/.test(noStrip[0]), `only the photo is saved with saveStrip=false (${noStrip.join(', ')})`);

    /* ---------------- Photo: caption + preferred camera ---------------- */
    console.log('\nPhoto flow – photoCaption=true, preferredCamera=fake');
    // Count camera enumerations so the preferred-camera lookup is provably exercised (and cached).
    await page.addInitScript(() => {
      const devices = navigator.mediaDevices;
      const original = devices.enumerateDevices.bind(devices);
      window.__enumCalls = 0;
      devices.enumerateDevices = () => {
        window.__enumCalls += 1;
        return original();
      };
    });
    await gotoApp(page, 'photoCaption=true&preferredCamera=fake');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    before = listFiles('photos');
    await page.click('#btn-photo');
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    const trackLabel = await page.evaluate(() => {
      const s = window.Camera.getStream();
      const track = s && s.getVideoTracks()[0];
      return track ? track.label : '';
    });
    assert(/fake/i.test(trackLabel), `preferred camera matched by label substring (${trackLabel})`);
    const enumCalls = await page.evaluate(() => window.__enumCalls);
    assert(enumCalls === 1, `preferred camera looked up via enumerateDevices exactly once (${enumCalls})`);
    await page.waitForSelector('#screen-photo-review', { state: 'visible', timeout: 30000 });
    const cardsCaption = await page.$$('#review-photos .photo-card');
    await cardsCaption[1].click();
    await cardsCaption[2].click();
    await cardsCaption[3].click();
    await page.click('#btn-photo-save');
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 15000 });
    const captionRun = newFiles('photos', before);
    assert(captionRun.length === 2, `captioned photo + strip saved (${captionRun.join(', ')})`);

    /* ---------------- Photo: preferred camera without a match ---------------- */
    console.log('\nPhoto flow – preferredCamera without a match');
    consoleTexts.length = 0;
    await gotoApp(page, 'preferredCamera=no-such-camera-xyz&saveStrip=false');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    await page.click('#btn-photo');
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    assert(consoleTexts.some((text) => /no camera matches/.test(text)), 'warns when no camera matches the preference');
    assert(await page.evaluate(() => Boolean(window.Camera.getStream() && window.Camera.getStream().active)), 'default camera still starts');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    await page.keyboard.press('v');
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    const enumCallsAfterSwitch = await page.evaluate(() => window.__enumCalls);
    assert(enumCallsAfterSwitch === 1, `lookup result is cached across photo → video (${enumCallsAfterSwitch} calls)`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    const captioned = captionRun.find((f) => /_1\.jpg$/.test(f));
    const captionedSize = captioned && jpegSize(path.join(CAPTURE_DIR, 'photos', captioned));
    assert(captionedSize && captionedSize.width > 0 && captionedSize.height > 0, `captioned photo is a valid JPEG (${captionedSize && captionedSize.width}x${captionedSize && captionedSize.height})`);

    /* ---------------- Save fallback (server error → download) ---------------- */
    console.log('\nSave fallback');
    await gotoApp(page, 'thanksDurationMs=1500');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    before = listFiles('photos');
    await page.route('**/api/photos', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"test"}' }));
    const cardsFallback = await captureToReview(page);
    await cardsFallback[1].click();
    await cardsFallback[2].click();
    await cardsFallback[3].click();
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.click('#btn-photo-save');
    const download = await downloadPromise;
    assert(/^fotobox_.+_1\.jpg$/.test(download.suggestedFilename()), `upload failure falls back to a browser download (${download.suggestedFilename()})`);
    await page.waitForSelector('#overlay .overlay-sub', { timeout: 15000 });
    const subText = await page.textContent('#overlay .overlay-sub');
    assert(subText.includes('Server nicht erreichbar'), `overlay explains the fallback in German ("${subText}")`);
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 15000 });
    await page.unroute('**/api/photos');
    assert(newFiles('photos', before).length === 0, 'nothing reached the server during the outage');
    const health = await page.evaluate(() => window.Saver.detectBackend());
    assert(health === true, 'backend is detected again after the outage');

    /* ---------------- Save fallback (server unreachable → download → server back) ---------------- */
    console.log('\nSave fallback – server unreachable, then back');
    before = listFiles('photos');
    const downloads = [];
    const collectDownload = (d) => downloads.push(d.suggestedFilename());
    page.on('download', collectDownload);
    await page.route('**/api/**', (route) => route.abort('connectionrefused')); // health check included
    const cardsOutage = await captureToReview(page);
    await cardsOutage[1].click();
    await cardsOutage[2].click();
    await cardsOutage[3].click();
    await page.click('#btn-photo-save');
    await page.waitForSelector('#overlay .overlay-sub', { timeout: 15000 });
    const outageSub = await page.textContent('#overlay .overlay-sub');
    assert(outageSub.includes('Server nicht erreichbar'), `outage is reported to the hosts ("${outageSub}")`);
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 15000 });
    await page.unroute('**/api/**');
    page.off('download', collectDownload);
    assert(newFiles('photos', before).length === 0, 'nothing reached the server while it was unreachable');
    assert(
      downloads.some((f) => /_1\.jpg$/.test(f)) && downloads.some((f) => /_strip\.jpg$/.test(f)),
      `photo and strip were downloaded instead (${downloads.join(', ')})`
    );

    // The server is back: the very next save must reach it again (a failed check is never final).
    before = listFiles('photos');
    const cardsBack = await captureToReview(page);
    await cardsBack[1].click();
    await cardsBack[2].click();
    await cardsBack[3].click();
    await page.click('#btn-photo-save');
    await page.waitForFunction(() => document.getElementById('overlay-text').textContent.startsWith('Gespeichert'), null, { timeout: 15000 });
    assert(!(await page.$('#overlay .overlay-sub')), 'no download hint once the server answers again');
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 15000 });
    const backRun = newFiles('photos', before);
    assert(backRun.length === 2, `photo + strip reach the server again after the outage (${backRun.join(', ')})`);

    /* ---------------- Video flow ---------------- */
    console.log('\nVideo flow');
    await page.click('#btn-video');
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    assert(await page.isHidden('#btn-start'), 'video mode starts its countdown right away');
    const videoCountdown = await page.textContent('#countdown-number');
    assert(videoCountdown === '1', `video countdown uses videoFirstCountdownSeconds (got ${videoCountdown})`);
    await page.waitForSelector('#rec:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(700);
    assert(await page.isVisible('#btn-stop'), 'stop button visible while recording');
    await page.screenshot({ path: path.join(SHOTS, '07-video-recording.png') });
    await page.waitForSelector('#screen-video-review', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(600);
    const playbackSrc = await page.getAttribute('#playback', 'src');
    assert(playbackSrc && playbackSrc.startsWith('blob:'), 'video playback has a blob source');
    await page.screenshot({ path: path.join(SHOTS, '08-video-review.png') });

    // Retake
    await page.click('#btn-video-retake');
    await page.waitForSelector('#screen-capture', { state: 'visible' });
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    assert(true, 'retake restarts the countdown immediately');
    await page.waitForSelector('#rec:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.click('#btn-stop'); // stop early
    await page.waitForSelector('#screen-video-review', { state: 'visible', timeout: 20000 });
    await page.click('#btn-video-save');
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 15000 });
    const videos = listFiles('videos');
    assert(videos.length === 1, `one video saved on the server (${videos.join(', ')})`);
    if (videos.length) {
      const size = fs.statSync(path.join(CAPTURE_DIR, 'videos', videos[0])).size;
      assert(size > 1000, `video file has content (${size} bytes)`);
    }

    /* ---------------- Keyboard ---------------- */
    console.log('\nKeyboard');
    await page.keyboard.press('v');
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    assert((await page.textContent('#stage-message')).includes('Aufnahme'), 'V opens video mode and shows the German get-ready message');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    assert(await page.evaluate(() => document.documentElement.lang === 'de'), 'document language is German');

    /* ---------------- Portrait layout ---------------- */
    console.log('\nPortrait layout');
    await page.setViewportSize({ width: 800, height: 1200 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, '10-home-portrait.png') });
    await page.click('#btn-photo');
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    const letterboxed = await page.evaluate(() => {
      const preview = document.getElementById('preview');
      const freeze = document.getElementById('freeze');
      return preview.classList.contains('fit-contain') && freeze.classList.contains('fit-contain') && getComputedStyle(preview).objectFit === 'contain';
    });
    assert(letterboxed, 'landscape camera on a portrait stage is letterboxed (previewFit auto)');
    await page.waitForTimeout(450); // let the screen fade-in finish
    await page.screenshot({ path: path.join(SHOTS, '09-capture-portrait-letterbox.png') });
    await page.waitForSelector('#screen-photo-review', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(400);
    const fitsPortrait = await page.evaluate(() => {
      const box = document.getElementById('review-photos').getBoundingClientRect();
      return Array.from(document.querySelectorAll('#review-photos .photo-card')).every((c) => {
        const r = c.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 20 && r.bottom <= box.bottom + 20 && r.width > 100;
      });
    });
    assert(fitsPortrait, 'four photo cards fit in portrait as well');
    await page.screenshot({ path: path.join(SHOTS, '11-photo-review-portrait.png') });
    await page.click('#btn-photo-none');
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 10000 });

    await gotoApp(page, 'previewFit=cover');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    await page.click('#btn-photo');
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    assert(!(await page.$('#preview.fit-contain')), 'previewFit=cover forces cover in portrait');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#screen-home', { state: 'visible' });

    /* ---------------- API ---------------- */
    console.log('\nAPI');
    const expectedPhotos = listFiles('photos').length;
    const gallery = await page.evaluate(() => fetch('/api/gallery').then((r) => r.json()));
    assert(gallery.ok && gallery.photos.length === expectedPhotos && gallery.videos.length === 1, `gallery lists saved files (${gallery.photos.length} photos, ${gallery.videos.length} video)`);
    const bad = await page.evaluate(() => fetch('/api/photos', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }).then((r) => r.status));
    assert(bad === 415, 'server rejects unsupported uploads');
    const traversal = await page.evaluate(() => fetch('/captures/../server.js').then((r) => r.status));
    assert(traversal === 404 || traversal === 403, 'path traversal blocked');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'} – screenshots in ${path.relative(ROOT, SHOTS)}/`);
  process.exit(failures ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
