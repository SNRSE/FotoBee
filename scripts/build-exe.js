#!/usr/bin/env node
/**
 * Build a portable FotoBee executable (single file) with Node's Single
 * Executable Application (SEA) feature.
 *
 *   npm run build:exe                      # Windows x64 -> dist/FotoBee-<version>-win-x64/FotoBee.exe (+ .zip)
 *   node scripts/build-exe.js --platform host          # for the machine you are on
 *   node scripts/build-exe.js --platform linux-arm64   # e.g. Raspberry Pi 4/5 (64-bit OS)
 *
 * What it does:
 *   1. embeds server.js, package.json and every file under public/ into a SEA blob
 *   2. fetches the official Node.js binary for the target platform (same version
 *      as the Node running this script; cached in dist/.cache) - or reuses the
 *      running Node for --platform host
 *   3. injects the blob with postject (fetched on demand via npx, build time only)
 *   4. writes launcher scripts + README next to the executable and zips the folder
 *
 * Options:
 *   --platform <win-x64|win-arm64|linux-x64|linux-arm64|darwin-x64|darwin-arm64|host>  (default win-x64)
 *   --out <dir>            output directory (default dist)
 *   --node-version <vX.Y.Z> Node version to bundle (default: the running Node)
 *   --no-zip               do not create the zip archive
 *
 * Requirements: Node >= 20.12, network access for the Node download and postject
 * (curl is used for downloads when available, so proxies work), unzip/tar for
 * extracting the Node archive. No project dependencies are installed.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const POSTJECT = 'postject@1.0.0-alpha.6';
const NODE_DIST = process.env.NODE_DIST_URL || 'https://nodejs.org/dist';

const PLATFORMS = {
  'win-x64': { archive: 'zip', binary: 'node.exe', exeName: 'FotoBee.exe' },
  'win-arm64': { archive: 'zip', binary: 'node.exe', exeName: 'FotoBee.exe' },
  'linux-x64': { archive: 'tar.gz', binary: 'bin/node', exeName: 'fotobee' },
  'linux-arm64': { archive: 'tar.gz', binary: 'bin/node', exeName: 'fotobee' },
  'darwin-x64': { archive: 'tar.gz', binary: 'bin/node', exeName: 'fotobee' },
  'darwin-arm64': { archive: 'tar.gz', binary: 'bin/node', exeName: 'fotobee' },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function log(message) {
  console.log(`[build] ${message}`);
}

function fail(message) {
  console.error(`[build] ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { platform: 'win-x64', out: 'dist', nodeVersion: process.version, zip: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => (inlineValue !== undefined ? inlineValue : argv[(i += 1)]);
    if (flag === '--platform') out.platform = value();
    else if (flag === '--out') out.out = value();
    else if (flag === '--node-version') out.nodeVersion = value();
    else if (flag === '--no-zip') out.zip = false;
    else if (flag === '--help' || flag === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 27).join('\n').replace(/^ \*\s?/gm, ''));
      process.exit(0);
    } else fail(`Unknown option ${arg} (try --help)`);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(out.nodeVersion)) fail(`--node-version must look like v22.12.0 (got ${out.nodeVersion})`);
  return out;
}

function hostPlatform() {
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  return `${platform}-${process.arch}`;
}

function hasCommand(cmd, args = ['--version']) {
  const result = spawnSync(cmd, args, { stdio: 'ignore', shell: process.platform === 'win32' });
  return !result.error && result.status === 0;
}

function run(cmd, args, options = {}) {
  const pretty = [cmd, ...args].join(' ');
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.error) fail(`${pretty}: ${result.error.message}`);
  if (result.status !== 0) fail(`${pretty} exited with code ${result.status}`);
}

function walk(dir, base = dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, list);
    else if (entry.isFile()) list.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return list;
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

/* ------------------------------------------------------------------ */
/* Download + extract the Node.js binary for the target                */
/* ------------------------------------------------------------------ */

function downloadWithNode(url, dest) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadWithNode(new URL(res.headers.location, url).toString(), dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  if (hasCommand('curl')) {
    // curl honours HTTPS_PROXY / corporate CA bundles, which Node's https does not.
    run('curl', ['-fL', '--retry', '3', '--progress-bar', '-o', tmp, url]);
  } else {
    await downloadWithNode(url, tmp);
  }
  fs.renameSync(tmp, dest);
}

function extractArchive(archive, kind, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (kind === 'zip') {
    if (hasCommand('unzip', ['-v'])) run('unzip', ['-q', '-o', archive, '-d', destDir]);
    else if (hasCommand('tar')) run('tar', ['-xf', archive, '-C', destDir]); // bsdtar (Windows 10+, macOS) reads zip
    else if (process.platform === 'win32') run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${destDir}'`]);
    else if (hasCommand('python3')) run('python3', ['-m', 'zipfile', '-e', archive, destDir]);
    else fail('No tool found to extract a .zip (install unzip or tar)');
  } else {
    run('tar', ['-xzf', archive, '-C', destDir]);
  }
}

async function nodeBinaryFor(target, version, cacheDir) {
  const spec = PLATFORMS[target];
  if (target === hostPlatform() && version === process.version) {
    log(`using the running Node ${process.version} (${process.execPath})`);
    return process.execPath;
  }
  const name = `node-${version}-${target}`;
  const binary = path.join(cacheDir, name, spec.binary);
  if (fs.existsSync(binary)) {
    log(`using cached Node binary ${binary}`);
    return binary;
  }
  const archive = path.join(cacheDir, `${name}.${spec.archive}`);
  if (!fs.existsSync(archive)) {
    const url = `${NODE_DIST}/${version}/${name}.${spec.archive}`;
    log(`downloading ${url}`);
    await download(url, archive);
  }
  log(`extracting ${path.basename(archive)}`);
  extractArchive(archive, spec.archive, cacheDir);
  if (!fs.existsSync(binary)) fail(`Node binary not found after extraction: ${binary}`);
  return binary;
}

/* ------------------------------------------------------------------ */
/* Bundle extras                                                       */
/* ------------------------------------------------------------------ */

function writeLaunchers(bundleDir, target, exeName) {
  const isWindows = target.startsWith('win');
  if (isWindows) {
    const cmd = (args) => `@echo off\r\ncd /d "%~dp0"\r\n"${exeName}" ${args}\r\n`;
    fs.writeFileSync(path.join(bundleDir, 'FotoBee-Kiosk.cmd'), cmd('--kiosk'));
    fs.writeFileSync(path.join(bundleDir, 'FotoBee-Browser.cmd'), cmd('--open'));
    fs.writeFileSync(path.join(bundleDir, 'FotoBee-Server-only.cmd'), cmd('') + 'pause\r\n');
  } else {
    const sh = (args) => `#!/usr/bin/env bash\ncd "$(dirname "$0")"\nexec ./${exeName} ${args}\n`;
    fs.writeFileSync(path.join(bundleDir, 'start-kiosk.sh'), sh('--kiosk'), { mode: 0o755 });
    fs.writeFileSync(path.join(bundleDir, 'start-browser.sh'), sh('--open'), { mode: 0o755 });
  }
  fs.writeFileSync(
    path.join(bundleDir, 'README.txt'),
    [
      `FotoBee ${PKG.version} – portable wedding photo booth (${target})`,
      '',
      'Start:',
      isWindows
        ? '  FotoBee-Kiosk.cmd     opens the booth fullscreen in Chrome/Edge (camera pre-approved)\n  FotoBee-Browser.cmd   opens the booth in your default browser\n  FotoBee.exe --help    all options (port, capture folder, ...)'
        : '  ./start-kiosk.sh      opens the booth fullscreen in Chrome/Chromium\n  ./start-browser.sh    opens the booth in your default browser\n  ./fotobee --help      all options (port, capture folder, ...)',
      '',
      'Photos and videos are saved in the "captures" folder next to the executable',
      '(captures/photos, captures/videos). The hosts\' gallery + slideshow is at',
      '  http://localhost:3000/gallery.html',
      '',
      'Customise names, date, countdowns: create public/js/config.js next to the',
      'executable (copy it from the FotoBee source) – files in a "public" folder next',
      'to the executable override the built-in ones.',
      '',
      'Video post-processing (optional): put ffmpeg on the PATH or next to the',
      'executable and set FFMPEG_PATH; see the project README for details.',
      '',
      isWindows
        ? 'Windows may show a SmartScreen warning because the executable is not code-signed: choose "More info" -> "Run anyway".'
        : 'If the executable is not runnable: chmod +x fotobee',
      '',
    ].join('\n')
  );
}

function zipBundle(outDir, bundleName) {
  const zipPath = path.join(outDir, `${bundleName}.zip`);
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  const opts = { cwd: outDir };
  if (hasCommand('zip', ['-v'])) run('zip', ['-r', '-q', `${bundleName}.zip`, bundleName], opts);
  else if (process.platform === 'win32' && hasCommand('tar')) run('tar', ['-a', '-cf', `${bundleName}.zip`, bundleName], opts);
  else if (hasCommand('python3')) run('python3', ['-m', 'zipfile', '-c', `${bundleName}.zip`, bundleName], opts);
  else if (process.platform === 'win32') run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Force -Path '${bundleName}' -DestinationPath '${bundleName}.zip'`], opts);
  else {
    log('no zip tool found – skipping the archive');
    return null;
  }
  return zipPath;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.platform === 'host' ? hostPlatform() : args.platform;
  const spec = PLATFORMS[target];
  if (!spec) fail(`Unsupported platform "${target}". Choose one of: ${Object.keys(PLATFORMS).join(', ')}, host`);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 12)) fail(`Node >= 20.12 is required to build (running ${process.version})`);

  const outDir = path.resolve(ROOT, args.out);
  const workDir = path.join(outDir, '.sea');
  const cacheDir = path.join(outDir, '.cache');
  const bundleName = `FotoBee-${PKG.version}-${target}`;
  const bundleDir = path.join(outDir, bundleName);
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  // 1. SEA configuration: main script + embedded frontend
  const publicDir = path.join(ROOT, 'public');
  const assets = { 'package.json': path.join(ROOT, 'package.json') };
  for (const rel of walk(publicDir)) assets[`public/${rel}`] = path.join(publicDir, rel);
  const blobPath = path.join(workDir, 'fotobee.blob');
  const config = {
    main: path.join(ROOT, 'server.js'),
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false, // code cache is platform specific; keep the blob portable
    assets,
  };
  const configPath = path.join(workDir, 'sea-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  log(`embedding server.js + ${Object.keys(assets).length} files (${formatBytes(Object.values(assets).reduce((n, f) => n + fs.statSync(f).size, 0))})`);
  run(process.execPath, ['--experimental-sea-config', configPath], { cwd: ROOT, shell: false });

  // 2. Node binary for the target
  const nodeBinary = await nodeBinaryFor(target, args.nodeVersion, cacheDir);
  const exePath = path.join(bundleDir, spec.exeName);
  fs.copyFileSync(nodeBinary, exePath);
  if (!target.startsWith('win')) fs.chmodSync(exePath, 0o755);
  if (target.startsWith('darwin') && process.platform === 'darwin') run('codesign', ['--remove-signature', exePath]);

  // 3. Inject the blob (postject is fetched on demand; it is a build-time tool only)
  log('injecting the application blob with postject');
  const postjectArgs = ['--yes', POSTJECT, exePath, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', SENTINEL_FUSE];
  if (target.startsWith('darwin')) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  run('npx', postjectArgs, { cwd: ROOT });
  if (target.startsWith('darwin') && process.platform === 'darwin') run('codesign', ['--sign', '-', exePath]);

  // 4. Launchers, README, archive
  writeLaunchers(bundleDir, target, spec.exeName);
  fs.mkdirSync(path.join(bundleDir, 'captures'), { recursive: true });
  const zipPath = args.zip ? zipBundle(outDir, bundleName) : null;

  log(`done: ${path.relative(ROOT, exePath)} (${formatBytes(fs.statSync(exePath).size)})`);
  if (zipPath) log(`archive: ${path.relative(ROOT, zipPath)} (${formatBytes(fs.statSync(zipPath).size)})`);
  log(`copy the "${bundleName}" folder to the booth computer and run ${target.startsWith('win') ? 'FotoBee-Kiosk.cmd' : './start-kiosk.sh'}`);
}

main().catch((err) => fail(err.stack || err.message));
