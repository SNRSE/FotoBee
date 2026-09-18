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

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const base = `http://localhost:${PORT}`;
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
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => {
      failures += 1;
      console.log(`  ✗ page error: ${err.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  [console.error] ${msg.text()}`);
    });

    /* ---------------- Home ---------------- */
    console.log('\nHome screen');
    await page.goto(`${base}/?photoFirstCountdownSeconds=2&countdownSeconds=1&pauseBetweenShotsMs=600&freezeFrameMs=300&videoSeconds=3&thanksDurationMs=700`);
    await page.waitForSelector('#screen-home', { state: 'visible' });
    assert((await page.textContent('#btn-photo .option-label')).trim() === 'Foto', 'photo option is visible');
    assert((await page.textContent('#couple-line')).includes('Lena & Lami'), 'couple line shows the configured names');
    assert((await page.textContent('#btn-video .option-label')).trim() === 'Video', 'video option is visible');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, '01-home.png') });

    /* ---------------- Photo flow ---------------- */
    console.log('\nPhoto flow');
    await page.click('#btn-photo');
    await page.waitForSelector('#screen-capture', { state: 'visible' });
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    assert(await page.isVisible('#preview'), 'live preview is shown');
    assert(await page.isHidden('#btn-start'), 'no start button – countdown begins right away');
    const firstNumber = await page.textContent('#countdown-number');
    assert(firstNumber === '2', `first countdown starts at photoFirstCountdownSeconds (got ${firstNumber})`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, '02-photo-countdown.png') });
    await page.waitForFunction(() => document.getElementById('shot-counter').textContent.startsWith('Foto 2'), null, { timeout: 15000 });
    await page.waitForSelector('#countdown:not([hidden])', { timeout: 10000 });
    const secondNumber = await page.textContent('#countdown-number');
    assert(secondNumber === '1', `second countdown uses countdownSeconds (got ${secondNumber})`);
    await page.screenshot({ path: path.join(SHOTS, '03-photo-second-countdown.png') });

    await page.waitForSelector('#screen-photo-review', { state: 'visible', timeout: 20000 });
    const cards = await page.$$('#review-photos .photo-card');
    assert(cards.length === 2, `two photos on the review screen (got ${cards.length})`);
    const naturalWidths = await page.$$eval('#review-photos img', (imgs) => imgs.map((img) => img.naturalWidth));
    assert(naturalWidths.every((w) => w > 0), `captured images decode (${naturalWidths.join('x')})`);
    assert((await page.textContent('#btn-photo-save')).trim() === 'Beide speichern', 'save button reads "Beide speichern"');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, '04-photo-review.png') });

    await cards[1].click();
    assert((await page.textContent('#btn-photo-save')).trim() === 'Dieses speichern', 'deselecting one photo updates the label');
    await page.screenshot({ path: path.join(SHOTS, '05-photo-review-one-selected.png') });
    await cards[0].click();
    assert(await page.isDisabled('#btn-photo-save'), 'save button disabled when nothing is selected');
    await cards[0].click();

    await page.click('#btn-photo-save');
    await page.waitForSelector('#overlay:not([hidden])');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, '06-photo-saved.png') });
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 10000 });
    const photos = listFiles('photos');
    assert(photos.length === 1, `one photo saved on the server (${photos.join(', ')})`);
    assert(photos.every((f) => /_1\.jpg$/.test(f)), 'saved photo keeps its index');
    assert(await page.evaluate(() => !document.getElementById('preview').srcObject), 'camera released after returning home');

    /* ---------------- Photo: save none ---------------- */
    console.log('\nPhoto flow – save none');
    await page.click('#btn-photo');
    await page.waitForSelector('#screen-photo-review', { state: 'visible', timeout: 20000 });
    await page.click('#btn-photo-none');
    await page.waitForSelector('#screen-home', { state: 'visible', timeout: 10000 });
    assert(listFiles('photos').length === 1, 'no additional photo saved');

    /* ---------------- Video flow ---------------- */
    console.log('\nVideo flow');
    await page.click('#btn-video');
    await page.waitForSelector('#btn-start:not([disabled])', { timeout: 10000 });
    assert((await page.textContent('#btn-start')).trim() === 'Aufnehmen', 'record button shown');
    await page.click('#btn-start');
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
    assert(!(await page.isHidden('#btn-start')), 'retake returns to the recording screen');
    await page.click('#btn-start');
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
    await page.waitForSelector('#btn-start:not([disabled])', { timeout: 10000 });
    assert((await page.textContent('#btn-start')).trim() === 'Aufnehmen', 'V opens video mode with the German record label');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#screen-home', { state: 'visible' });
    assert(await page.evaluate(() => document.documentElement.lang === 'de'), 'document language is German');

    /* ---------------- Portrait layout ---------------- */
    console.log('\nPortrait layout');
    await page.setViewportSize({ width: 800, height: 1200 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, '10-home-portrait.png') });

    /* ---------------- API ---------------- */
    console.log('\nAPI');
    const gallery = await page.evaluate(() => fetch('/api/gallery').then((r) => r.json()));
    assert(gallery.ok && gallery.photos.length === 1 && gallery.videos.length === 1, 'gallery lists saved files');
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
