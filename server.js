#!/usr/bin/env node
/**
 * FotoBee – minimal zero-dependency Node.js backend.
 *
 *  - Serves the static frontend from ./public
 *  - POST /api/photos  (body: image/jpeg|png)  -> captures/photos/<session>_<index>.jpg
 *  - POST /api/videos  (body: video/webm|mp4)  -> captures/videos/<session>.webm
 *  - GET  /api/health  -> { ok, captureDir, https, ffmpeg, postprocess, version, time }
 *  - GET  /api/gallery -> list of saved photos and videos (newest first)
 *  - GET  /captures/*  -> serves saved files (read-only, supports Range requests)
 *
 * Uploads are written to "<file>.part" first and renamed into place, so the
 * gallery never sees half-written files. Videos are optionally remuxed with
 * ffmpeg after the upload (adds the duration/cues Chrome's MediaRecorder omits).
 *
 * Portable build: scripts/build-exe.js bundles this file plus ./public into a
 * single executable (Node SEA). When running as that executable the frontend is
 * served from the embedded assets (files next to the executable override them)
 * and captures are stored next to the executable.
 *
 * Command line:
 *  --open           open the booth in the default browser after start
 *  --kiosk          open Chrome/Edge in kiosk mode (fullscreen, camera pre-approved)
 *  --port N         listen on port N (same as PORT)
 *  --captures DIR   store photos and videos in DIR (same as CAPTURE_DIR)
 *
 * Environment:
 *  FOTOBEE_OPEN   "1" = like --open, "kiosk" = like --kiosk
 *  PORT           port to listen on (default 3000, 0 = random free port)
 *  HOST           interface to bind (default 0.0.0.0)
 *  CAPTURE_DIR    where to store captures (default ./captures)
 *  SSL_KEY        PEM private key  } both set -> HTTPS instead of HTTP
 *  SSL_CERT       PEM certificate  } (create with: npm run cert)
 *  FFMPEG_PATH    ffmpeg binary (default: "ffmpeg" on PATH)
 *  POSTPROCESS    "0" disables the ffmpeg post-processing of videos
 *  MAX_UPLOAD_MB  upload size limit in MB (default 512)
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream');
const { execFile, spawn } = require('child_process');

const sea = detectSea(); // node:sea module when running as a portable single executable, else null
const APP_DIR = sea ? path.dirname(process.execPath) : __dirname;
const PKG = readPackage();
const ARGS = parseArgs(process.argv.slice(2));
const PORT = ARGS.port != null ? ARGS.port : process.env.PORT === '0' ? 0 : Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const CAPTURE_DIR = path.resolve(ARGS.captures || process.env.CAPTURE_DIR || path.join(APP_DIR, 'captures'));
const OPEN_MODE = ARGS.kiosk
  ? 'kiosk'
  : ARGS.open
    ? 'open'
    : process.env.FOTOBEE_OPEN === 'kiosk'
      ? 'kiosk'
      : process.env.FOTOBEE_OPEN === '1'
        ? 'open'
        : null;
const MAX_BODY_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 512) * 1024 * 1024; // plenty for a 15 s video
const POSTPROCESS_ENABLED = process.env.POSTPROCESS !== '0';
const FFMPEG_CANDIDATE = process.env.FFMPEG_PATH || 'ffmpeg';
const FFMPEG_TIMEOUT_MS = 120000;
const SHUTDOWN_GRACE_MS = 10000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const EXT_FOR_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'video/x-matroska': '.mkv',
};

// ffmpeg arguments per container: a pure remux (no re-encoding) that rewrites the
// header. WebM gets its missing duration/cues, MP4 gets a "faststart" moov atom.
const REMUX_ARGS = {
  '.webm': ['-c', 'copy'],
  '.mp4': ['-c', 'copy', '-movflags', '+faststart'],
};

let server = null;
let tlsEnabled = false;
let ffmpeg = null; // { path, version } once detected
let shuttingDown = false;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function detectSea() {
  try {
    const mod = require('node:sea');
    return mod.isSea() ? mod : null;
  } catch (err) {
    return null;
  }
}

function readPackage() {
  try {
    if (sea) return JSON.parse(sea.getAsset('package.json', 'utf8'));
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  } catch (err) {
    return { version: '0.0.0' };
  }
}

function usage() {
  return [
    `FotoBee ${PKG.version} – wedding photo booth server`,
    '',
    'Usage: fotobee [--open | --kiosk] [--port N] [--captures DIR]',
    '',
    '  --open           open the booth in the default browser after start',
    '  --kiosk          open Chrome/Edge in kiosk mode (fullscreen, camera pre-approved)',
    '  --port N         listen on port N (default 3000, 0 = random free port)',
    '  --captures DIR   store photos and videos in DIR (default ./captures)',
    '  --help           show this help',
    '',
    'Environment: PORT, HOST, CAPTURE_DIR, FOTOBEE_OPEN (1|kiosk), SSL_KEY, SSL_CERT,',
    '             FFMPEG_PATH, POSTPROCESS (0 = off), MAX_UPLOAD_MB',
  ].join('\n');
}

function parseArgs(argv) {
  const out = { open: false, kiosk: false, port: null, captures: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => (inlineValue !== undefined ? inlineValue : argv[(i += 1)]);
    if (flag === '--open') out.open = true;
    else if (flag === '--kiosk') out.kiosk = true;
    else if (flag === '--help' || flag === '-h') out.help = true;
    else if (flag === '--port') out.port = Number(value());
    else if (flag === '--captures') out.captures = value();
    else console.warn(`Ignoring unknown option ${arg} (try --help)`);
  }
  if (out.port != null && (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535)) {
    console.error('--port expects a number between 0 and 65535');
    process.exit(2);
  }
  if (out.help) {
    console.log(usage());
    process.exit(0);
  }
  return out;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestamp(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

function safeName(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
}

/** Files that are still being written (upload) or processed (ffmpeg). */
function isTempFile(name) {
  return name.endsWith('.part') || name.includes('.tmp.');
}

function relativeCapture(filePath) {
  return path.relative(CAPTURE_DIR, filePath).split(path.sep).join('/');
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.pause(); // the handler answers 413 and then closes the connection
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Uploads (atomic writes)                                             */
/* ------------------------------------------------------------------ */

/**
 * Reserve a free file name by creating "<final>.part" exclusively. Checking the
 * final name AND creating the .part with the "wx" flag means two simultaneous
 * uploads with the same base name can never end up on the same file.
 */
async function openUniquePart(dir, base, ext) {
  for (let counter = 1; counter < 10000; counter += 1) {
    const finalPath = path.join(dir, counter === 1 ? `${base}${ext}` : `${base}-${counter}${ext}`);
    const partPath = `${finalPath}.part`;
    if (fs.existsSync(finalPath)) continue;
    try {
      const handle = await fs.promises.open(partPath, 'wx');
      return { finalPath, partPath, handle };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`No free file name for ${base}${ext}`);
}

/** Write body to "<final>.part", flush it and rename it into place. */
async function writeAtomically(dir, base, ext, body) {
  const { finalPath, partPath, handle } = await openUniquePart(dir, base, ext);
  let open = true;
  try {
    await handle.writeFile(body);
    await handle.sync().catch(() => {}); // best effort – not every filesystem supports fsync
    open = false;
    await handle.close();
    await fs.promises.rename(partPath, finalPath);
    return finalPath;
  } catch (err) {
    if (open) await handle.close().catch(() => {});
    await fs.promises.unlink(partPath).catch(() => {});
    throw err;
  }
}

async function handleUpload(req, res, kind) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_FOR_TYPE[contentType];
  if (!ext) {
    sendJson(res, 415, { ok: false, error: `Unsupported content type: ${contentType || 'none'}` });
    return;
  }
  const expectedPrefix = kind === 'photos' ? 'image/' : 'video/';
  if (!contentType.startsWith(expectedPrefix)) {
    sendJson(res, 415, { ok: false, error: `Expected ${expectedPrefix}* for /api/${kind}` });
    return;
  }

  const body = await readBody(req, MAX_BODY_BYTES);
  if (!body.length) {
    sendJson(res, 400, { ok: false, error: 'Empty body' });
    return;
  }

  const session = safeName(req.headers['x-session']) || timestamp();
  const index = safeName(req.headers['x-index']);
  const base = index ? `${session}_${index}` : session;
  const dir = path.join(CAPTURE_DIR, kind);
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = await writeAtomically(dir, base, ext, body);

  const relative = relativeCapture(filePath);
  console.log(`[save] ${kind}: ${relative} (${(body.length / 1024).toFixed(0)} kB)`);
  sendJson(res, 201, { ok: true, file: relative, url: `/captures/${relative}`, bytes: body.length });

  // Post-processing runs after the response – the guest never waits for ffmpeg.
  if (kind === 'videos') schedulePostprocess(filePath);
}

/* ------------------------------------------------------------------ */
/* ffmpeg post-processing (optional)                                   */
/* ------------------------------------------------------------------ */

function detectFfmpeg(candidate) {
  return new Promise((resolve) => {
    execFile(candidate, ['-version'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve({ path: candidate, version: String(stdout).split('\n')[0].trim() });
    });
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const options = { timeout: FFMPEG_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 };
    execFile(ffmpeg.path, args, options, (err, stdout, stderr) => {
      if (!err) {
        resolve();
        return;
      }
      const detail = String(stderr || '').trim().split('\n').slice(-3).join(' | ');
      reject(new Error(detail || err.message));
    });
  });
}

/**
 * Remux one video in place: ffmpeg writes "<name>.tmp.<ext>", which replaces the
 * original atomically on success. On failure the original is kept untouched.
 */
async function remuxVideo(filePath, ext) {
  const tmpPath = `${filePath.slice(0, -ext.length)}.tmp${ext}`;
  const started = Date.now();
  try {
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', filePath, ...REMUX_ARGS[ext], tmpPath]);
    const stat = await fs.promises.stat(tmpPath);
    if (!stat.size) throw new Error('ffmpeg produced an empty file');
    await fs.promises.rename(tmpPath, filePath);
    console.log(`[ffmpeg] remuxed ${relativeCapture(filePath)} in ${Date.now() - started} ms`);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// Videos are processed one after another (a simple promise chain), so several
// uploads in a row never fight for the CPU or for the same file.
let postprocessChain = Promise.resolve();
let postprocessPending = 0;

function schedulePostprocess(filePath) {
  if (!ffmpeg || !POSTPROCESS_ENABLED) return;
  const ext = path.extname(filePath).toLowerCase();
  if (!REMUX_ARGS[ext]) return;
  postprocessPending += 1;
  postprocessChain = postprocessChain
    .then(() => remuxVideo(filePath, ext))
    .catch((err) => console.error(`[ffmpeg] ${relativeCapture(filePath)} kept as uploaded: ${err.message}`))
    .finally(() => {
      postprocessPending -= 1;
    });
}

/* ------------------------------------------------------------------ */
/* Gallery + static files                                              */
/* ------------------------------------------------------------------ */

async function listGallery() {
  const result = { photos: [], videos: [] };
  for (const kind of ['photos', 'videos']) {
    const dir = path.join(CAPTURE_DIR, kind);
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || isTempFile(entry.name)) continue;
      let stat;
      try {
        stat = await fs.promises.stat(path.join(dir, entry.name));
      } catch (err) {
        continue; // vanished between readdir and stat
      }
      files.push({
        name: entry.name,
        url: `/captures/${kind}/${encodeURIComponent(entry.name)}`,
        type: MIME[path.extname(entry.name).toLowerCase()] || 'application/octet-stream',
        bytes: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
    files.sort((a, b) => (a.modified === b.modified ? (a.name < b.name ? 1 : -1) : a.modified < b.modified ? 1 : -1));
    result[kind] = files;
  }
  return result;
}

/**
 * Map a URL path onto a file inside rootDir. Returns null when the path is
 * malformed or would escape the directory ("..", encoded dots, backslashes,
 * NUL bytes) – the caller answers 403.
 */
function resolveInside(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (err) {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.split('/').some((segment) => segment === '..')) return null;
  const resolved = path.resolve(rootDir, decoded.replace(/^\/+/, ''));
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) return null;
  return resolved;
}

/** Parse a single "bytes=start-end" range. Returns null (no/ignored range), 'invalid' or {start, end}. */
function parseRange(header, size) {
  if (!header || !size) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start = match[1] === '' ? size - Number(match[2]) : Number(match[1]);
  let end = match[2] === '' || match[1] === '' ? size - 1 : Number(match[2]);
  if (start < 0) start = 0;
  if (end > size - 1) end = size - 1;
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

function serveFile(req, res, rootDir, urlPath) {
  const resolved = resolveInside(rootDir, urlPath);
  if (!resolved) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      if (sea && rootDir === PUBLIC_DIR) {
        serveEmbedded(req, res, resolved); // portable build: fall back to the built-in frontend
        return;
      }
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    const base = path.basename(resolved);
    if (rootDir === CAPTURE_DIR && (base.startsWith('.') || isTempFile(base))) {
      // half-written uploads / files being remuxed are not served, matching the gallery listing
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    const range = parseRange(req.headers.range, stat.size);
    if (range === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;
    const headers = {
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size ? end - start + 1 : 0,
      'Accept-Ranges': 'bytes',
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': rootDir === PUBLIC_DIR ? 'no-cache' : 'private, max-age=60',
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD' || !stat.size) {
      res.end();
      return;
    }
    // pipeline() destroys the read stream when the client goes away mid-transfer
    // (every seek in a gallery video aborts a Range request); a plain pipe() only
    // unpipes and would keep the file descriptor open until the process exits.
    // A read error destroys the response instead, so the client sees a reset.
    pipeline(fs.createReadStream(resolved, { start, end }), res, (err) => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(`[error] serving ${urlPath}:`, err.message);
    });
  });
}

/** Serve a frontend file embedded in the portable executable (see scripts/build-exe.js). */
function serveEmbedded(req, res, resolved) {
  const key = `public/${path.relative(PUBLIC_DIR, resolved).split(path.sep).join('/')}`;
  let data;
  try {
    data = Buffer.from(sea.getAsset(key));
  } catch (err) {
    sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(data);
}

/* ------------------------------------------------------------------ */
/* Browser launcher (--open / --kiosk)                                 */
/* ------------------------------------------------------------------ */

function whichSync(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (err) {
      /* keep looking */
    }
  }
  return null;
}

/** Find an installed Chromium-based browser (Chrome, Edge, Chromium, Brave) for kiosk mode. */
function findChromiumBrowser() {
  let candidates;
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    candidates = [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ];
  } else if (process.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  } else {
    candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']
      .map(whichSync)
      .filter(Boolean);
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function openBrowser(mode, url) {
  const browser = mode === 'kiosk' ? findChromiumBrowser() : null;
  if (browser) {
    // A private profile makes --kiosk work even if the browser is already open and
    // skips the "restore pages?" bubble; the media flag pre-approves the camera.
    const args = [
      '--kiosk',
      `--user-data-dir=${path.join(APP_DIR, 'browser-profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--noerrdialogs',
      '--disable-session-crashed-bubble',
      '--disable-infobars',
      '--overscroll-history-navigation=0',
    ];
    if (/msedge/i.test(browser)) args.push('--edge-kiosk-type=fullscreen');
    args.push(url);
    try {
      spawn(browser, args, { detached: true, stdio: 'ignore' }).unref();
      console.log(`Kiosk: opened ${browser}`);
      return;
    } catch (err) {
      console.log(`Kiosk: could not start ${browser} (${err.message})`);
    }
  } else if (mode === 'kiosk') {
    console.log('Kiosk: no Chrome/Edge found – opening the default browser instead (press F for fullscreen)');
  }
  const launcher =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(launcher[0], launcher[1], { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`Could not open a browser – open ${url} yourself`));
    child.unref();
  } catch (err) {
    console.log(`Could not open a browser (${err.message}) – open ${url} yourself`);
  }
}

/* ------------------------------------------------------------------ */
/* Request routing                                                     */
/* ------------------------------------------------------------------ */

function healthPayload() {
  return {
    ok: true,
    captureDir: CAPTURE_DIR,
    https: tlsEnabled,
    ffmpeg: Boolean(ffmpeg),
    postprocess: Boolean(ffmpeg) && POSTPROCESS_ENABLED,
    portable: Boolean(sea),
    version: PKG.version,
    time: new Date().toISOString(),
  };
}

async function handleRequest(req, res) {
  setSecurityHeaders(res);
  if (shuttingDown) res.setHeader('Connection', 'close'); // let keep-alive clients go so close() finishes quickly
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (err) {
    sendJson(res, 400, { ok: false, error: 'Bad request' });
    return;
  }

  try {
    if (pathname === '/api/health') {
      sendJson(res, 200, healthPayload());
      return;
    }
    if (req.method === 'POST' && pathname === '/api/photos') {
      await handleUpload(req, res, 'photos');
      return;
    }
    if (req.method === 'POST' && pathname === '/api/videos') {
      await handleUpload(req, res, 'videos');
      return;
    }
    if (req.method === 'GET' && pathname === '/api/gallery') {
      sendJson(res, 200, { ok: true, ...(await listGallery()) });
      return;
    }
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: 'Unknown API route' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    if (pathname.startsWith('/captures/')) {
      serveFile(req, res, CAPTURE_DIR, pathname.slice('/captures/'.length));
      return;
    }
    serveFile(req, res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  } catch (err) {
    const status = err.status || 500;
    console.error(`[error] ${req.method} ${pathname}:`, err.message);
    if (!res.headersSent) sendJson(res, status, { ok: false, error: err.message });
    else res.end();
    if (status === 413) res.once('finish', () => req.destroy()); // drop the rest of the oversized body
  }
}

/* ------------------------------------------------------------------ */
/* Startup / shutdown                                                  */
/* ------------------------------------------------------------------ */

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Read SSL_KEY / SSL_CERT; returns null when HTTPS is not configured. */
function loadTls() {
  const keyPath = process.env.SSL_KEY;
  const certPath = process.env.SSL_CERT;
  if (!keyPath && !certPath) return null;
  if (!keyPath || !certPath) {
    fail('HTTPS needs both SSL_KEY and SSL_CERT (create a dev certificate with: npm run cert).');
  }
  const read = (label, file) => {
    try {
      return fs.readFileSync(file);
    } catch (err) {
      return fail(`Cannot read ${label}=${file}: ${err.message}\nCreate a dev certificate with: npm run cert`);
    }
  };
  return { key: read('SSL_KEY', keyPath), cert: read('SSL_CERT', certPath) };
}

/** IPv4 addresses of this machine that other devices on the LAN can reach. */
function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      // Node 18.0–18.3 reported family as the number 4 instead of 'IPv4'.
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) addresses.push(iface.address);
    }
  }
  return addresses;
}

function logStartup() {
  const port = server.address().port;
  const scheme = tlsEnabled ? 'https' : 'http';
  const bindsAll = HOST === '0.0.0.0' || HOST === '::' || HOST === '';
  console.log(`FotoBee ${PKG.version} running at ${scheme}://localhost:${port}`);
  for (const ip of bindsAll ? lanAddresses() : [HOST]) {
    console.log(`  on the network: ${scheme}://${ip}:${port}`);
  }
  console.log(`Galerie: ${scheme}://localhost:${port}/gallery.html`);
  console.log(`Captures are stored in ${CAPTURE_DIR}`);
  if (!ffmpeg) {
    console.log(`ffmpeg: not found (${FFMPEG_CANDIDATE}) – videos are stored exactly as uploaded`);
  } else if (!POSTPROCESS_ENABLED) {
    console.log(`ffmpeg: ${ffmpeg.path} – post-processing disabled (POSTPROCESS=0)`);
  } else {
    console.log(`ffmpeg: ${ffmpeg.path} – videos are remuxed after upload`);
  }
  console.log(
    tlsEnabled
      ? 'HTTPS: on – tablets on the same Wi-Fi must accept the self-signed certificate once'
      : 'HTTPS: off – needed for the camera on other devices; run "npm run cert" and start with SSL_KEY/SSL_CERT'
  );
  if (sea) console.log('Portable build: files next to the executable (e.g. public/js/config.js) override the built-in ones');
  if (OPEN_MODE) openBrowser(OPEN_MODE, `${scheme}://localhost:${port}/`);
  else console.log('Tip: start with --kiosk to open the booth fullscreen in Chrome/Edge. Ctrl+C stops the server.');
}

function onServerError(err) {
  if (err.code === 'EADDRINUSE') {
    fail(
      `Port ${PORT} is already in use – is another FotoBee still running?\n` +
        `Stop it or start on a different port, e.g.  PORT=${PORT + 1} npm start`
    );
  }
  if (err.code === 'EACCES') fail(`No permission to listen on ${HOST}:${PORT}. Try a port above 1024, e.g.  PORT=3000 npm start`);
  fail(`Server error: ${err.message}`);
}

function shutdown(signal) {
  if (shuttingDown) process.exit(0); // second Ctrl+C: leave immediately
  shuttingDown = true;
  console.log(`\n[${signal}] shutting down…`);
  setTimeout(() => {
    console.log('[shutdown] still busy – forcing exit');
    process.exit(0);
  }, SHUTDOWN_GRACE_MS).unref();
  // Keep-alive sockets only become idle after their in-flight response, so sweep repeatedly.
  const sweepIdle = () => {
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  };
  sweepIdle();
  const sweep = setInterval(sweepIdle, 250);
  sweep.unref();
  server.close(async () => {
    clearInterval(sweep);
    if (postprocessPending) {
      console.log(`[shutdown] waiting for ${postprocessPending} video(s) to finish processing…`);
      await postprocessChain;
    }
    console.log('[shutdown] bye');
    process.exit(0);
  });
}

async function main() {
  const tls = loadTls();
  tlsEnabled = Boolean(tls);
  try {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  } catch (err) {
    fail(`Cannot create capture directory ${CAPTURE_DIR}: ${err.message}`);
  }
  ffmpeg = await detectFfmpeg(FFMPEG_CANDIDATE);
  try {
    server = tls ? https.createServer(tls, handleRequest) : http.createServer(handleRequest);
  } catch (err) {
    fail(`Invalid SSL_KEY/SSL_CERT: ${err.message}`);
  }
  server.on('error', onServerError);
  server.listen(PORT, HOST, logStartup);
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
