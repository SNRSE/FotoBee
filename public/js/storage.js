/* Saving captures: upload to the Node backend when available, otherwise download in the browser. */
(function () {
  'use strict';

  const HEALTH_TIMEOUT_MS = 4000; // an unreachable host must not stall a save for longer than this

  let backend = null; // null = not checked yet, true = server answers, false = unreachable at the last check
  let failedSession = null; // save session whose health check failed: its remaining files skip the re-check
  let seenBackend = false; // the server answered at least once since the page was loaded

  /** GET /api/health with a timeout; resolves true only for a { ok: true } answer. */
  async function probeHealth() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
      const data = await res.json();
      return Boolean(data && data.ok);
    } catch (err) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Is the backend reachable? A positive answer is cached until an upload fails. A negative answer
   * is never permanent (the server may be restarted any time): it is only reused for the remaining
   * files of the same save session, so every new guest checks the server again.
   * @param session  optional save session id (see saveBlob)
   */
  async function detectBackend(session) {
    if (backend === true) return true;
    if (location.protocol === 'file:') return false; // a static page never has a backend
    if (backend === false && session && session === failedSession) return false;
    backend = await probeHealth();
    failedSession = backend ? null : session || null;
    if (backend) seenBackend = true;
    return backend;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function sessionId(date) {
    const d = date || new Date();
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
    );
  }

  function extensionFor(type) {
    const base = String(type || '').split(';')[0];
    return (
      {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'video/webm': 'webm',
        'video/mp4': 'mp4',
        'video/x-matroska': 'mkv',
      }[base] || 'bin'
    );
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function upload(route, blob, headers) {
    const mime = String(blob.type || '').split(';')[0];
    const res = await fetch(route, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': mime }, headers),
      body: blob,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return res.json();
  }

  /**
   * Upload when the backend is reachable, otherwise download. If the upload fails although the
   * backend was there (server down, Wi-Fi gone, 5xx) the file is downloaded instead and the next
   * file checks the server again. A download is flagged as `fallback` whenever the server answered
   * earlier in this page load, so the hosts learn that it is unreachable now.
   * Returns { method: 'backend'|'download', file, url?, fallback?, error? }.
   */
  async function saveBlob(route, blob, session, headers, filename) {
    if (await detectBackend(session)) {
      try {
        const data = await upload(route, blob, headers);
        return { method: 'backend', file: data.file, url: data.url };
      } catch (err) {
        console.warn(`Upload to ${route} failed – downloading ${filename} instead.`, err);
        backend = false;
        download(blob, filename);
        return { method: 'download', file: filename, fallback: true, error: err };
      }
    }
    download(blob, filename);
    const result = { method: 'download', file: filename };
    if (seenBackend) result.fallback = true; // an outage, not a booth that runs without a server
    return result;
  }

  /** Save one photo (meta.index may be a number or e.g. 'strip'). */
  function savePhoto(blob, meta) {
    const session = (meta && meta.session) || sessionId();
    const index = meta && meta.index != null ? String(meta.index) : '';
    const name = `fotobox_${session}${index ? '_' + index : ''}.${extensionFor(blob.type)}`;
    return saveBlob('/api/photos', blob, session, { 'X-Session': session, 'X-Index': index }, name);
  }

  function saveVideo(blob, meta) {
    const session = (meta && meta.session) || sessionId();
    const name = `fotobox_${session}.${extensionFor(blob.type)}`;
    return saveBlob('/api/videos', blob, session, { 'X-Session': session }, name);
  }

  window.Saver = { detectBackend, savePhoto, saveVideo, sessionId };
})();
