#!/usr/bin/env node
/**
 * FotoBee – minimal zero-dependency Node.js backend.
 *
 *  - Serves the static frontend from ./public
 *  - POST /api/photos  (body: image/jpeg|png)  -> captures/photos/<session>_<index>.jpg
 *  - POST /api/videos  (body: video/webm|mp4)  -> captures/videos/<session>.webm
 *  - GET  /api/health  -> { ok: true }
 *  - GET  /api/gallery -> list of saved photos and videos
 *  - GET  /captures/*  -> serves saved files (read-only)
 *
 * Environment:
 *  PORT         port to listen on (default 3000)
 *  HOST         interface to bind (default 0.0.0.0)
 *  CAPTURE_DIR  where to store captures (default ./captures)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CAPTURE_DIR = path.resolve(process.env.CAPTURE_DIR || path.join(__dirname, 'captures'));
const MAX_BODY_BYTES = 512 * 1024 * 1024; // 512 MB – plenty for a 15 s video

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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, base + ext);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${counter}${ext}`);
    counter += 1;
  }
  return candidate;
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
  fs.mkdirSync(dir, { recursive: true });
  const filePath = uniquePath(dir, base, ext);
  await fs.promises.writeFile(filePath, body);

  const relative = path.relative(CAPTURE_DIR, filePath).split(path.sep).join('/');
  console.log(`[save] ${kind}: ${relative} (${(body.length / 1024).toFixed(0)} kB)`);
  sendJson(res, 201, { ok: true, file: relative, url: `/captures/${relative}`, bytes: body.length });
}

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
      if (!entry.isFile()) continue;
      const stat = await fs.promises.stat(path.join(dir, entry.name));
      files.push({
        name: entry.name,
        url: `/captures/${kind}/${encodeURIComponent(entry.name)}`,
        bytes: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
    files.sort((a, b) => (a.modified < b.modified ? 1 : -1));
    result[kind] = files;
  }
  return result;
}

function serveFile(res, rootDir, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const resolved = path.normalize(path.join(rootDir, decoded));
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': rootDir === PUBLIC_DIR ? 'no-cache' : 'private, max-age=60',
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  try {
    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true, captureDir: CAPTURE_DIR, time: new Date().toISOString() });
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
      serveFile(res, CAPTURE_DIR, pathname.slice('/captures/'.length));
      return;
    }
    serveFile(res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  } catch (err) {
    const status = err.status || 500;
    console.error(`[error] ${req.method} ${pathname}:`, err.message);
    if (!res.headersSent) sendJson(res, status, { ok: false, error: err.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FotoBee running at http://localhost:${PORT}`);
  console.log(`Captures are stored in ${CAPTURE_DIR}`);
  console.log('Tip: open the URL on the kiosk device in fullscreen / kiosk mode.');
});
