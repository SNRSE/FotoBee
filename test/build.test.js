/**
 * Builds the portable executable for this machine (scripts/build-exe.js
 * --platform host) and smoke-tests it: embedded frontend, file overrides,
 * captures next to the executable. Needs network access once for postject
 * (fetched via npx); the test is skipped when that is not available.
 *
 *   npm run test:build
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function request(port, urlPath, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let out = '';
    const onData = (chunk) => {
      out += String(chunk);
      const match = /running at https?:\/\/localhost:(\d+)/.exec(out);
      if (match) resolve({ port: Number(match[1]), log: () => out });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('exit', (code) => reject(new Error(`executable exited with ${code}\n${out}`)));
    setTimeout(() => reject(new Error(`no "running at" line within 15 s\n${out}`)), 15000).unref();
  });
}

test('portable build serves the embedded frontend and stores captures next to the executable', { timeout: 600000 }, async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fotobee-build-'));
  const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-exe.js'), '--platform', 'host', '--out', outDir, '--no-zip'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300000,
  });
  const buildLog = `${build.stdout}\n${build.stderr}`;
  if (build.status !== 0) {
    if (/npx|postject|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network|registry/i.test(buildLog)) {
      t.skip(`build tooling not available (offline?): ${buildLog.trim().split('\n').slice(-3).join(' | ')}`);
      return;
    }
    assert.fail(`build failed:\n${buildLog}`);
  }
  const bundleDir = fs.readdirSync(outDir).map((n) => path.join(outDir, n)).find((p) => path.basename(p).startsWith('FotoBee-') && fs.statSync(p).isDirectory());
  assert.ok(bundleDir, `bundle folder created in ${outDir}`);
  const exe = fs.readdirSync(bundleDir).map((n) => path.join(bundleDir, n)).find((p) => /^(FotoBee\.exe|fotobee)$/.test(path.basename(p)));
  assert.ok(exe, 'executable exists');
  assert.ok(fs.existsSync(path.join(bundleDir, 'README.txt')), 'README.txt written');
  assert.ok(fs.statSync(exe).size > 20 * 1024 * 1024, 'executable contains the Node runtime');

  // The bundle must be self-sufficient: run it from a folder without the sources.
  const child = spawn(exe, ['--port', '0'], { cwd: bundleDir, env: { ...process.env, POSTPROCESS: '0' } });
  t.after(() => child.kill('SIGTERM'));
  const { port, log } = await waitForPort(child);

  const health = await request(port, '/api/health');
  assert.equal(health.status, 200);
  const info = JSON.parse(health.body.toString());
  assert.equal(info.ok, true);
  assert.equal(info.portable, true, 'server knows it runs as a portable build');
  assert.equal(info.version, require(path.join(ROOT, 'package.json')).version);
  assert.equal(path.resolve(info.captureDir), path.join(bundleDir, 'captures'), 'captures live next to the executable');

  const index = await request(port, '/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /text\/html/);
  assert.match(index.body.toString(), /FotoBox/);
  for (const [file, type] of [
    ['/css/styles.css', /text\/css/],
    ['/css/fonts.css', /text\/css/],
    ['/js/app.js', /javascript/],
    ['/js/config.js', /javascript/],
    ['/gallery.html', /text\/html/],
    ['/fonts/cormorant-garamond-italic-latin.woff2', /font\/woff2/],
  ]) {
    const res = await request(port, file);
    assert.equal(res.status, 200, `${file} served from the embedded assets`);
    assert.match(res.headers['content-type'], type, `${file} content type`);
    assert.ok(res.body.length > 0, `${file} has content`);
  }
  const head = await request(port, '/js/app.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0, 'HEAD has no body');
  assert.equal((await request(port, '/js/missing.js')).status, 404, 'unknown embedded file -> 404');
  assert.equal((await request(port, '/..%2f..%2fserver.js')).status, 403, 'traversal blocked');

  // A file next to the executable overrides the embedded one (config customisation).
  fs.mkdirSync(path.join(bundleDir, 'public', 'js'), { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'public', 'js', 'config.js'), "window.FOTOBOX_CONFIG = { coupleNames: 'Override & Test' };\n");
  const override = await request(port, '/js/config.js');
  assert.match(override.body.toString(), /Override & Test/, 'file next to the executable wins');
  const stillEmbedded = await request(port, '/js/app.js');
  assert.match(stillEmbedded.body.toString(), /FotoBee|FotoBox/, 'other files still come from the embedded assets');

  // Uploads land in captures/ next to the executable.
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
  const saved = await request(port, '/api/photos', 'POST', jpeg, { 'Content-Type': 'image/jpeg', 'X-Session': 'portable', 'X-Index': '1' });
  assert.equal(saved.status, 201, `upload accepted (${saved.body})`);
  assert.ok(fs.existsSync(path.join(bundleDir, 'captures', 'photos', 'portable_1.jpg')), 'photo stored next to the executable');
  assert.match(log(), /Portable build/, 'startup log mentions the portable build');
});
