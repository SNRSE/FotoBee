#!/usr/bin/env node
/**
 * Backend tests for server.js – no browser needed.
 *
 *   node --test test/server.test.js      (npm run test:server)
 *
 * Every suite starts server.js as a child process on a random free port with a
 * fresh temporary CAPTURE_DIR and POSTPROCESS=0. The ffmpeg and HTTPS suites
 * only run when ffmpeg / openssl are available on this machine, the file
 * descriptor test only on Linux (it reads /proc/<pid>/fd of the server).
 */
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const MAKE_CERT = path.join(ROOT, 'scripts', 'make-cert.sh');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// A real 3-frame VP8 WebM (64x48) written in "live" mode: no duration and no
// cues – exactly what Chrome's MediaRecorder produces. 1292 bytes.
const FIXTURE_WEBM = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHLTbuMU6uEElTDZ1OsggEc7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmpSrXsYMPQkBNgIxMYXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDAWVK5rzK4BAAAAAAAAQ9eBAXPFiOrJa+z4e4LxnIEAIrWcg3VuZIiBAIaFVl9WUDiDgQEj44OEDuaygOCUsIFAuoEwmoECVbCIVbeBAlW4gQISVMNn1nNzn2PAgGfImUWjh0VOQ09ERVJEh4xMYXZmNjEuMS4xMDBzc7FjwItjxYjqyWvs+HuC8WfIoEWjh0VOQ09ERVJEh5NMYXZjNjEuMy4xMDAgbGlidnB4H0O2dUNf54EAo0FjgQAAgPAIAJ0BKkAAMAAABwiFhYiFhIgCAgJ1uiTBvwHCM8yEF9gB2AH0AcsB8rVogOYAvRX/Zvsr6VnsB+M01MZBvvq1d29t+sT22US+xgmS4QqXAP78d1R9V3KSZhFtokbxmp7I/F1vmScEj9M3EurS8Qz/8wCh9/NjB8d/Nl1dNl/+Gv8Ncf6/X/1wH84pEfrjqmRKzqGyFKaJTfEoDx/pTwT7cx4lv24cNDEACLHcQ+b/0nrh4AyaR5QY8SP9eUpq3af96o5xmk4HiKQyXm6DvDy8py6hfVti5NIsm0rycc/1N6dAOHf4sHbw/7POekSUcNRLLbiOCV/bfu4IkE+tFca1B7CR+kLUHzsJWAM3AL2Awt7IHBwBC1/KwthX6DlAts8v5C3pheF2xamKx/0efHP8OYP5oUsw0/syUgRumDVjnj9gt3HrN+6Quor/c2NhE8p0G2knK3FDaRMZwIUkAKNBSYEA+oCwCACdASpAADAAAAcIhYWIhYSIAgICdbolBCLvsNwAOSAwgH+A+gH+OflB7nuaf5H/1fuB/JnRjOqxEzU5Bpya2ePm+wQ9EvTs9gK2pCwA/v9wGs/xufwgP6swzOfVbfOYDE6sh5BtLIabPoVtr5J73JPkrhkgveqdUDe/8Bu/nopf/BBdGLf48gm1n0D7Rf/5crANNH9FnVIygM2SOXdZj/+nOp6/9G6jJYwYcFoeUC4XdPMCgT3MuX1L9nbsvtG3ajybX8Xuv3dItjGM/u/YEqbTTf2TlprRdIVs325zKgR3/CA/hTDQJ9gN879ibxA7/GefFhkTgRr07aujZWK0jpUBavsAnp+V5ayr5kUO6g+tZO4CxdOEn/4z6Z/6jWgn8nRrny3/PoD25P45+rJQWrYk+ByB/VwG1YTBxM4nSua9KPEAo0CngQH0gFAFAJ0BKkAAMAAABwiFhYiFhIgCAgLszCX4whOwxQzMqxEzU59rFXmKBd90UHiZepD7cAD+//5KBz58Szdv6A1xUZ7Mmn/2LPW72c/bZvQvMyq6JGMMutqYfOXv+aCp7Ag+nhrAhIZXMELXPqI5EK8JnnhEwO3CAwR4itwAxsJZW+ufmC4s+Kpl1SKBtSsLV0Lg9gk+vL5RGOxW2zuYwIV7wAA=',
  'base64'
);
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(2048)]);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function canRun(file, args) {
  try {
    execFileSync(file, args, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (err) {
    return false;
  }
}

/** Same lookup the server does (FFMPEG_PATH, then PATH) plus Playwright's bundled ffmpeg. */
function findFfmpeg() {
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean);
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(os.homedir(), '.cache', 'ms-playwright')];
  for (const root of roots.filter(Boolean)) {
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch (err) {
      continue;
    }
    for (const entry of entries.filter((name) => name.startsWith('ffmpeg-'))) {
      for (const bin of ['ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg-mac-arm64', 'ffmpeg-win64.exe']) {
        candidates.push(path.join(root, entry, bin));
      }
    }
  }
  return candidates.find((candidate) => canRun(candidate, ['-version'])) || null;
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `check` until it returns a truthy value or the timeout passes. */
async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return value;
    await sleep(100);
  }
}

/**
 * Start server.js as a child process. Resolves once it prints its "running"
 * line with the actual port (PORT=0 -> random free port). The child's output is
 * collected in `.log` so tests can look for ffmpeg / startup messages.
 */
function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      env: Object.assign({}, process.env, { PORT: '0', POSTPROCESS: '0' }, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const handle = {
      child,
      log: '',
      stderr: '',
      port: 0,
      exitCode: null,
      stop() {
        if (handle.exitCode !== null) return Promise.resolve(handle.exitCode);
        return new Promise((done) => {
          child.once('exit', (code) => done(code));
          child.kill('SIGTERM');
        });
      },
    };
    const timer = setTimeout(() => reject(new Error(`server start timeout\n${handle.log}${handle.stderr}`)), 10000);
    child.stdout.on('data', (chunk) => {
      handle.log += chunk;
      const match = /running at https?:\/\/localhost:(\d+)/.exec(handle.log);
      if (match && !handle.port) {
        handle.port = Number(match[1]);
        clearTimeout(timer);
        resolve(handle);
      }
    });
    child.stderr.on('data', (chunk) => {
      handle.stderr += chunk;
    });
    child.on('exit', (code) => {
      handle.exitCode = code;
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}\n${handle.stderr}`));
    });
  });
}

/** Run server.js and wait for it to exit on its own (used for error cases). */
function runServerUntilExit(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], {
      env: Object.assign({}, process.env, { PORT: '0', POSTPROCESS: '0' }, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    setTimeout(() => child.kill('SIGKILL'), 10000).unref();
  });
}

/** Minimal HTTP(S) client: resolves with { status, headers, body, json() }. */
function request(srv, method, urlPath, options = {}) {
  const tls = Boolean(options.tls);
  return new Promise((resolve, reject) => {
    const req = (tls ? https : http).request(
      {
        host: 'localhost',
        port: srv.port,
        method,
        path: urlPath,
        headers: options.headers || {},
        agent: false,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, body, json: () => JSON.parse(body.toString('utf8')) });
        });
      }
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

function upload(srv, route, body, headers) {
  return request(srv, 'POST', route, { body, headers });
}

function listDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function isTempName(name) {
  return name.endsWith('.part') || name.includes('.tmp.');
}

/**
 * Request `urlPath` over a raw TCP connection and drop the connection either
 * as soon as the first bytes of the response arrive ('after-first-bytes') or
 * right after sending the request ('immediately') – what a browser does when
 * the guest seeks in a gallery video or navigates away mid-download. Resolves
 * once the socket is closed.
 */
function abortDownload(srv, urlPath, when, headers = {}) {
  return new Promise((resolve) => {
    const lines = [`GET ${urlPath} HTTP/1.1`, 'Host: localhost'];
    for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
    const socket = net.connect(srv.port, '127.0.0.1', () => {
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (when === 'immediately') socket.destroy();
    });
    if (when === 'after-first-bytes') socket.once('data', () => socket.destroy());
    socket.on('error', () => {}); // ECONNRESET is expected here
    socket.on('close', resolve);
  });
}

const hasProcFd = (() => {
  try {
    fs.readdirSync('/proc/self/fd');
    return true;
  } catch (err) {
    return false;
  }
})();

/** How many file descriptors of process `pid` point at `filePath` (Linux only, via /proc). */
function openHandlesOn(pid, filePath) {
  const target = fs.realpathSync(filePath);
  let count = 0;
  for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
    try {
      if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === target) count += 1;
    } catch (err) {
      /* closed while we were looking */
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Main suite (POSTPROCESS=0)                                          */
/* ------------------------------------------------------------------ */

describe('FotoBee server', () => {
  let srv;
  let captureDir;

  before(async () => {
    captureDir = makeTempDir('fotobee-test-');
    srv = await startServer({ CAPTURE_DIR: captureDir, MAX_UPLOAD_MB: '1' });
  });

  after(async () => {
    await srv.stop();
    fs.rmSync(captureDir, { recursive: true, force: true });
  });

  test('GET /api/health reports the expected shape', async () => {
    const res = await request(srv, 'GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['content-type'], /^application\/json/);
    const health = res.json();
    assert.equal(health.ok, true);
    assert.equal(health.captureDir, path.resolve(captureDir));
    assert.equal(health.https, false);
    assert.equal(typeof health.ffmpeg, 'boolean');
    assert.equal(health.postprocess, false, 'POSTPROCESS=0 disables post-processing');
    assert.equal(health.version, PKG.version);
    assert.ok(!Number.isNaN(Date.parse(health.time)), 'time is an ISO date');
  });

  test('startup log prints the gallery URL and the LAN addresses', () => {
    assert.ok(srv.log.includes(`Galerie: http://localhost:${srv.port}/gallery.html`), srv.log);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const iface of list || []) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
          assert.ok(srv.log.includes(`http://${iface.address}:${srv.port}`), `LAN address ${iface.address} is logged`);
        }
      }
    }
  });

  test('POST /api/photos saves <session>_<index>.jpg and serves it back', async () => {
    const res = await upload(srv, '/api/photos', FAKE_JPEG, { 'Content-Type': 'image/jpeg', 'X-Session': 'test-session', 'X-Index': '1' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.json(), { ok: true, file: 'photos/test-session_1.jpg', url: '/captures/photos/test-session_1.jpg', bytes: FAKE_JPEG.length });
    const saved = fs.readFileSync(path.join(captureDir, 'photos', 'test-session_1.jpg'));
    assert.ok(saved.equals(FAKE_JPEG), 'file content matches the upload');

    const get = await request(srv, 'GET', '/captures/photos/test-session_1.jpg');
    assert.equal(get.status, 200);
    assert.equal(get.headers['content-type'], 'image/jpeg');
    assert.equal(get.headers['x-content-type-options'], 'nosniff');
    assert.ok(get.body.equals(FAKE_JPEG), 'served content matches');

    const head = await request(srv, 'HEAD', '/captures/photos/test-session_1.jpg');
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers['content-length']), FAKE_JPEG.length);
    assert.equal(head.body.length, 0);
  });

  test('duplicate names get a -2 / -3 suffix', async () => {
    const headers = { 'Content-Type': 'image/jpeg', 'X-Session': 'test-session', 'X-Index': '1' };
    const second = await upload(srv, '/api/photos', FAKE_JPEG, headers);
    assert.equal(second.status, 201);
    assert.equal(second.json().file, 'photos/test-session_1-2.jpg');
    const third = await upload(srv, '/api/photos', FAKE_JPEG, headers);
    assert.equal(third.json().file, 'photos/test-session_1-3.jpg');
  });

  test('simultaneous uploads with the same name never share a file', async () => {
    const headers = { 'Content-Type': 'image/png', 'X-Session': 'burst', 'X-Index': '2' };
    const results = await Promise.all(Array.from({ length: 6 }, () => upload(srv, '/api/photos', FAKE_JPEG, headers)));
    const files = results.map((res) => (assert.equal(res.status, 201), res.json().file));
    assert.equal(new Set(files).size, 6, `all names distinct: ${files.join(', ')}`);
    for (const file of files) assert.equal(fs.statSync(path.join(captureDir, file)).size, FAKE_JPEG.length);
  });

  test('header values are sanitised and a missing session falls back to a timestamp', async () => {
    const res = await upload(srv, '/api/photos', FAKE_JPEG, { 'Content-Type': 'image/jpeg', 'X-Session': '../evil/..', 'X-Index': '1 2' });
    assert.equal(res.json().file, 'photos/evil_12.jpg');
    const fallback = await upload(srv, '/api/photos', FAKE_JPEG, { 'Content-Type': 'image/jpeg' });
    assert.match(fallback.json().file, /^photos\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?\.jpg$/);
  });

  test('415 on wrong content type', async () => {
    const text = await upload(srv, '/api/photos', Buffer.from('hello'), { 'Content-Type': 'text/plain' });
    assert.equal(text.status, 415);
    assert.equal(text.json().ok, false);
    const videoAsPhoto = await upload(srv, '/api/photos', FIXTURE_WEBM, { 'Content-Type': 'video/webm' });
    assert.equal(videoAsPhoto.status, 415);
    const photoAsVideo = await upload(srv, '/api/videos', FAKE_JPEG, { 'Content-Type': 'image/jpeg' });
    assert.equal(photoAsVideo.status, 415);
    const none = await upload(srv, '/api/photos', FAKE_JPEG, {});
    assert.equal(none.status, 415);
  });

  test('400 on empty body', async () => {
    const res = await upload(srv, '/api/photos', Buffer.alloc(0), { 'Content-Type': 'image/jpeg', 'X-Session': 'empty' });
    assert.equal(res.status, 400);
    assert.equal(res.json().ok, false);
    assert.ok(!fs.existsSync(path.join(captureDir, 'photos', 'empty.jpg')), 'nothing written');
  });

  test('413 on oversized body (MAX_UPLOAD_MB) and nothing is written', async () => {
    const big = Buffer.alloc(1.5 * 1024 * 1024, 1);
    // The server pauses the request, answers 413 and only then drops the socket,
    // so the client reliably sees the response.
    const result = await upload(srv, '/api/photos', big, { 'Content-Type': 'image/jpeg', 'X-Session': 'toolarge' });
    assert.equal(result.status, 413);
    assert.equal(result.json().ok, false);
    await sleep(100);
    assert.ok(!listDir(path.join(captureDir, 'photos')).some((name) => name.startsWith('toolarge')), 'no file written');
    const health = await request(srv, 'GET', '/api/health');
    assert.equal(health.status, 200, 'server still healthy');
  });

  test('POST /api/videos saves <session>.<ext> under captures/videos', async () => {
    const webm = await upload(srv, '/api/videos', FIXTURE_WEBM, { 'Content-Type': 'video/webm;codecs=vp8,opus', 'X-Session': 'vid-1' });
    assert.equal(webm.status, 201);
    assert.equal(webm.json().file, 'videos/vid-1.webm');
    assert.equal(webm.json().url, '/captures/videos/vid-1.webm');
    assert.ok(fs.readFileSync(path.join(captureDir, 'videos', 'vid-1.webm')).equals(FIXTURE_WEBM));

    const mp4 = await upload(srv, '/api/videos', FIXTURE_WEBM, { 'Content-Type': 'video/mp4', 'X-Session': 'vid-2' });
    assert.equal(mp4.json().file, 'videos/vid-2.mp4');

    const get = await request(srv, 'GET', '/captures/videos/vid-1.webm');
    assert.equal(get.headers['content-type'], 'video/webm');
    assert.equal(get.headers['accept-ranges'], 'bytes');
  });

  test('no .part files are left behind after uploads', () => {
    for (const kind of ['photos', 'videos']) {
      const leftovers = listDir(path.join(captureDir, kind)).filter(isTempName);
      assert.deepEqual(leftovers, [], `${kind} has no temp files`);
    }
  });

  test('Range requests are honoured for video playback', async () => {
    const partial = await request(srv, 'GET', '/captures/videos/vid-1.webm', { headers: { Range: 'bytes=0-3' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['content-range'], `bytes 0-3/${FIXTURE_WEBM.length}`);
    assert.ok(partial.body.equals(EBML_MAGIC));
    const tail = await request(srv, 'GET', '/captures/videos/vid-1.webm', { headers: { Range: 'bytes=-10' } });
    assert.equal(tail.status, 206);
    assert.equal(tail.body.length, 10);
    const bad = await request(srv, 'GET', '/captures/videos/vid-1.webm', { headers: { Range: 'bytes=999999-' } });
    assert.equal(bad.status, 416);
  });

  test('aborted downloads release their file descriptors', { skip: hasProcFd ? false : 'needs /proc (Linux)' }, async () => {
    // Every seek in a gallery video aborts the running Range request; a read
    // stream that is not destroyed with it keeps its fd until the process dies.
    const name = 'fd-probe.webm';
    const file = path.join(captureDir, 'videos', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(24 * 1024 * 1024, 1)); // larger than the socket buffers -> every abort is mid-transfer
    const pid = srv.child.pid;
    try {
      assert.equal(openHandlesOn(pid, file), 0, 'nothing open before the downloads');
      const aborts = [];
      for (let i = 0; i < 10; i += 1) {
        aborts.push(abortDownload(srv, `/captures/videos/${name}`, 'after-first-bytes', { Range: 'bytes=0-' }));
        aborts.push(abortDownload(srv, `/captures/videos/${name}`, 'immediately'));
      }
      await Promise.all(aborts);
      const released = await waitFor(() => openHandlesOn(pid, file) === 0);
      assert.ok(released, `${openHandlesOn(pid, file)} read stream(s) still open 5 s after the clients went away`);
      const again = await request(srv, 'GET', `/captures/videos/${name}`, { headers: { Range: 'bytes=0-3' } });
      assert.equal(again.status, 206, 'server still serves the file afterwards');
      assert.ok(!srv.stderr.includes('[error] serving'), `aborted downloads are not logged as errors:
${srv.stderr}`);
    } finally {
      fs.rmSync(file, { force: true }); // keep the gallery expectations below intact
    }
  });

  test('GET /api/gallery lists newest first and hides temp / hidden files', async () => {
    const photos = path.join(captureDir, 'photos');
    const videos = path.join(captureDir, 'videos');
    const now = Date.now() / 1000;
    fs.writeFileSync(path.join(photos, 'old.jpg'), FAKE_JPEG);
    fs.utimesSync(path.join(photos, 'old.jpg'), now - 86400, now - 86400);
    fs.writeFileSync(path.join(photos, 'new photo.jpg'), FAKE_JPEG);
    fs.utimesSync(path.join(photos, 'new photo.jpg'), now + 3600, now + 3600);
    fs.writeFileSync(path.join(photos, 'half.jpg.part'), FAKE_JPEG);
    fs.writeFileSync(path.join(photos, '.DS_Store'), 'x');
    fs.writeFileSync(path.join(videos, 'busy.tmp.webm'), FIXTURE_WEBM);
    fs.writeFileSync(path.join(videos, 'upload.webm.part'), FIXTURE_WEBM);

    const res = await request(srv, 'GET', '/api/gallery');
    assert.equal(res.status, 200);
    const gallery = res.json();
    assert.equal(gallery.ok, true);
    const photoNames = gallery.photos.map((p) => p.name);
    const videoNames = gallery.videos.map((v) => v.name);
    assert.equal(photoNames[0], 'new photo.jpg', 'newest photo first');
    assert.equal(photoNames[photoNames.length - 1], 'old.jpg', 'oldest photo last');
    assert.ok(!photoNames.some((n) => isTempName(n) || n.startsWith('.')), `temp files hidden: ${photoNames.join(', ')}`);
    assert.deepEqual(videoNames, ['vid-2.mp4', 'vid-1.webm'], 'videos newest first, temp files hidden');
    for (const list of [gallery.photos, gallery.videos]) {
      for (let i = 1; i < list.length; i += 1) assert.ok(list[i - 1].modified >= list[i].modified, 'sorted by modified desc');
    }
    const entry = gallery.photos[0];
    assert.equal(entry.url, '/captures/photos/new%20photo.jpg');
    assert.equal(entry.type, 'image/jpeg');
    assert.equal(entry.bytes, FAKE_JPEG.length);
    assert.ok(!Number.isNaN(Date.parse(entry.modified)));
    const encoded = await request(srv, 'GET', entry.url);
    assert.equal(encoded.status, 200, 'encoded gallery URL resolves');
    for (const hidden of ['/captures/photos/half.jpg.part', '/captures/photos/.DS_Store', '/captures/videos/busy.tmp.webm']) {
      const blocked = await request(srv, 'GET', hidden);
      assert.equal(blocked.status, 404, `${hidden} is not served either`);
    }
  });

  test('path traversal attempts are blocked', async () => {
    const attempts = [
      '/captures/../server.js',
      '/captures/%2e%2e/server.js',
      '/..%5c',
      '/..%5cserver.js',
      '/captures/..%2fserver.js',
      '/captures/..%5c..%5cserver.js',
      '/captures/photos/%2e%2e%2f%2e%2e%2fserver.js',
      '/captures/photos/..%2f..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/captures/%00',
      '/captures/%E0%A4%A',
    ];
    for (const urlPath of attempts) {
      const res = await request(srv, 'GET', urlPath);
      assert.ok(res.status === 403 || res.status === 404, `${urlPath} -> ${res.status}`);
      const text = res.body.toString('utf8');
      assert.ok(!text.includes('createServer') && !text.includes('"scripts"'), `${urlPath} leaks nothing`);
    }
  });

  test('static index is served as text/html', async () => {
    const res = await request(srv, 'GET', '/');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.body.toString('utf8').includes('<title>FotoBox</title>'));
    const js = await request(srv, 'GET', '/js/app.js');
    assert.equal(js.status, 200);
    assert.match(js.headers['content-type'], /^application\/javascript/);
    const missing = await request(srv, 'GET', '/does-not-exist.html');
    assert.equal(missing.status, 404);
    assert.equal(missing.json().ok, false);
  });

  test('unknown /api route -> 404 JSON, wrong method -> 405', async () => {
    const res = await request(srv, 'GET', '/api/nope');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /^application\/json/);
    assert.deepEqual(res.json(), { ok: false, error: 'Unknown API route' });
    const post = await request(srv, 'POST', '/api/gallery');
    assert.equal(post.status, 404);
    const put = await request(srv, 'PUT', '/index.html');
    assert.equal(put.status, 405);
  });

  test('a second server on the same port reports EADDRINUSE without a stack trace', async () => {
    const result = await runServerUntilExit({ PORT: String(srv.port), CAPTURE_DIR: captureDir });
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes(`Port ${srv.port} is already in use`), result.stderr);
    assert.ok(!result.stderr.includes('    at '), 'no stack trace');
  });
});

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

describe('lifecycle', () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    test(`${signal} shuts the server down with exit code 0`, async () => {
      const dir = makeTempDir('fotobee-life-');
      const srv = await startServer({ CAPTURE_DIR: dir });
      const code = await new Promise((resolve) => {
        srv.child.once('exit', resolve);
        srv.child.kill(signal);
      });
      assert.equal(code, 0);
      assert.ok(srv.log.includes(`[${signal}] shutting down`), srv.log);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  test('missing SSL files give a clear error', async () => {
    const dir = makeTempDir('fotobee-ssl-');
    const result = await runServerUntilExit({ CAPTURE_DIR: dir, SSL_KEY: '/does/not/exist.pem', SSL_CERT: '/does/not/exist.pem' });
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes('Cannot read SSL_KEY'), result.stderr);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/* ------------------------------------------------------------------ */
/* HTTPS with a certificate from scripts/make-cert.sh                  */
/* ------------------------------------------------------------------ */

const hasOpenssl = canRun('openssl', ['version']) && canRun('bash', ['-c', 'true']);

describe('HTTPS (scripts/make-cert.sh)', { skip: hasOpenssl ? false : 'openssl or bash not available' }, () => {
  let dir;
  let certDir;
  let srv;

  before(() => {
    dir = makeTempDir('fotobee-https-');
    certDir = path.join(dir, 'certs');
  });

  after(async () => {
    if (srv) await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('make-cert.sh creates a key/cert pair with localhost + 127.0.0.1 in the SAN', () => {
    const out = execFileSync('bash', [MAKE_CERT, '--out', certDir], { encoding: 'utf8' });
    assert.ok(fs.existsSync(path.join(certDir, 'dev-key.pem')));
    assert.ok(fs.existsSync(path.join(certDir, 'dev-cert.pem')));
    assert.ok(out.includes('SSL_KEY=') && out.includes('SSL_CERT='), 'prints how to start with SSL env vars');
    const text = execFileSync('openssl', ['x509', '-in', path.join(certDir, 'dev-cert.pem'), '-noout', '-text'], { encoding: 'utf8' });
    assert.ok(text.includes('DNS:localhost'), 'SAN has localhost');
    assert.ok(text.includes('IP Address:127.0.0.1'), 'SAN has 127.0.0.1');
  });

  test('make-cert.sh is idempotent and honours --force', () => {
    const before = fs.readFileSync(path.join(certDir, 'dev-cert.pem'), 'utf8');
    const out = execFileSync('bash', [MAKE_CERT, '--out', certDir], { encoding: 'utf8' });
    assert.ok(out.includes('already exists'), out);
    assert.equal(fs.readFileSync(path.join(certDir, 'dev-cert.pem'), 'utf8'), before, 'not overwritten');
    execFileSync('bash', [MAKE_CERT, '--out', certDir, '--force'], { encoding: 'utf8' });
    assert.notEqual(fs.readFileSync(path.join(certDir, 'dev-cert.pem'), 'utf8'), before, 'regenerated with --force');
  });

  test('server speaks HTTPS with SSL_KEY / SSL_CERT and reports https: true', async () => {
    srv = await startServer({
      CAPTURE_DIR: path.join(dir, 'captures'),
      SSL_KEY: path.join(certDir, 'dev-key.pem'),
      SSL_CERT: path.join(certDir, 'dev-cert.pem'),
    });
    assert.ok(srv.log.includes(`running at https://localhost:${srv.port}`), srv.log);
    const res = await request(srv, 'GET', '/api/health', { tls: true });
    assert.equal(res.status, 200);
    assert.equal(res.json().https, true);
    const page = await request(srv, 'GET', '/', { tls: true });
    assert.match(page.headers['content-type'], /^text\/html/);
  });
});

/* ------------------------------------------------------------------ */
/* ffmpeg post-processing (only when ffmpeg is available)              */
/* ------------------------------------------------------------------ */

const ffmpegPath = findFfmpeg();

describe('ffmpeg post-processing', { skip: ffmpegPath ? false : 'ffmpeg not available' }, () => {
  let srv;
  let captureDir;
  let videosDir;

  before(async () => {
    captureDir = makeTempDir('fotobee-ffmpeg-');
    videosDir = path.join(captureDir, 'videos');
    srv = await startServer({ CAPTURE_DIR: captureDir, POSTPROCESS: '1', FFMPEG_PATH: ffmpegPath });
  });

  after(async () => {
    const code = await srv.stop();
    assert.equal(code, 0, 'shutdown waits for post-processing and exits 0');
    fs.rmSync(captureDir, { recursive: true, force: true });
  });

  test('health reports ffmpeg and post-processing as active', async () => {
    const health = (await request(srv, 'GET', '/api/health')).json();
    assert.equal(health.ffmpeg, true);
    assert.equal(health.postprocess, true);
    assert.ok(srv.log.includes('videos are remuxed after upload'), srv.log);
  });

  test('a WebM upload is remuxed in place without leaving temp files', async () => {
    const res = await upload(srv, '/api/videos', FIXTURE_WEBM, { 'Content-Type': 'video/webm', 'X-Session': 'remux-test' });
    assert.equal(res.status, 201, 'response is sent before ffmpeg runs');
    assert.equal(res.json().bytes, FIXTURE_WEBM.length);

    const done = await waitFor(() => srv.log.includes('[ffmpeg] remuxed videos/remux-test.webm'));
    assert.ok(done, `remux logged within 5 s\n${srv.log}${srv.stderr}`);
    const file = path.join(videosDir, 'remux-test.webm');
    assert.ok(fs.existsSync(file), 'remuxed file still exists');
    const remuxed = fs.readFileSync(file);
    assert.ok(remuxed.length > 0, 'remuxed file is not empty');
    assert.ok(remuxed.subarray(0, 4).equals(EBML_MAGIC), 'still a WebM');
    assert.ok(!remuxed.equals(FIXTURE_WEBM), 'file was rewritten (duration/cues added)');
    assert.deepEqual(listDir(videosDir).filter(isTempName), [], 'no .tmp / .part files left');
  });

  test('a broken upload is kept as uploaded and its temp file removed', async () => {
    const garbage = Buffer.from('definitely not a video');
    const res = await upload(srv, '/api/videos', garbage, { 'Content-Type': 'video/webm', 'X-Session': 'broken' });
    assert.equal(res.status, 201);
    const failed = await waitFor(() => srv.stderr.includes('videos/broken.webm kept as uploaded'));
    assert.ok(failed, `failure logged within 5 s\n${srv.stderr}`);
    assert.ok(fs.readFileSync(path.join(videosDir, 'broken.webm')).equals(garbage), 'original untouched');
    assert.deepEqual(listDir(videosDir).filter(isTempName), [], 'temp file removed');
  });

  test('several uploads in a row are all processed', async () => {
    const sessions = ['queue-a', 'queue-b', 'queue-c'];
    await Promise.all(sessions.map((session) => upload(srv, '/api/videos', FIXTURE_WEBM, { 'Content-Type': 'video/webm', 'X-Session': session })));
    const all = await waitFor(() => sessions.every((session) => srv.log.includes(`[ffmpeg] remuxed videos/${session}.webm`)));
    assert.ok(all, `all three remuxed\n${srv.log}`);
    for (const session of sessions) assert.ok(fs.statSync(path.join(videosDir, `${session}.webm`)).size > 0);
    assert.deepEqual(listDir(videosDir).filter(isTempName), []);
    const gallery = (await request(srv, 'GET', '/api/gallery')).json();
    assert.equal(gallery.videos.length, 5, 'gallery lists every finished video');
  });
});
