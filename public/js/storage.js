/* Saving captures: upload to the Node backend when available, otherwise download in the browser. */
(function () {
  let backend = null; // null = unknown, true/false once detected

  async function detectBackend() {
    if (backend !== null) return backend;
    if (location.protocol === 'file:') {
      backend = false;
      return backend;
    }
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const data = await res.json();
      backend = Boolean(data && data.ok);
    } catch (err) {
      backend = false;
    }
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

  /** Save one photo; returns { method: 'backend'|'download', file }. */
  async function savePhoto(blob, meta) {
    const session = (meta && meta.session) || sessionId();
    const index = meta && meta.index != null ? String(meta.index) : '';
    if (await detectBackend()) {
      const data = await upload('/api/photos', blob, { 'X-Session': session, 'X-Index': index });
      return { method: 'backend', file: data.file };
    }
    const name = `fotobox_${session}${index ? '_' + index : ''}.${extensionFor(blob.type)}`;
    download(blob, name);
    return { method: 'download', file: name };
  }

  async function saveVideo(blob, meta) {
    const session = (meta && meta.session) || sessionId();
    if (await detectBackend()) {
      const data = await upload('/api/videos', blob, { 'X-Session': session });
      return { method: 'backend', file: data.file };
    }
    const name = `fotobox_${session}.${extensionFor(blob.type)}`;
    download(blob, name);
    return { method: 'download', file: name };
  }

  window.Saver = { detectBackend, savePhoto, saveVideo, sessionId };
})();
