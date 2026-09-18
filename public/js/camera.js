/* Camera helpers: getUserMedia stream management, preferred camera, still capture, MediaRecorder setup. */
(function () {
  'use strict';

  let stream = null;
  let streamHasAudio = false;
  let generation = 0; // bumped by stop(); lets a superseded start() release the camera it acquired
  let resolvedDeviceId; // undefined = preferred camera not looked up yet, null = no match, string = deviceId
  let loggedCamera = false;

  function config() {
    return window.FOTOBOX_CONFIG || {};
  }

  function stop() {
    generation += 1;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      streamHasAudio = false;
    }
  }

  function baseVideoConstraints() {
    return Object.assign({}, config().video || {});
  }

  function stopTracks(mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }

  /** getUserMedia with the given constraints, relaxing them step by step (no 1080p, no mic, no exact device). */
  async function acquire(video, wantAudio) {
    const attempts = [{ video, audio: wantAudio }];
    if (wantAudio) attempts.push({ video, audio: false }); // camera without a microphone
    if (video.deviceId) {
      attempts.push({ video: { deviceId: video.deviceId }, audio: wantAudio });
      if (wantAudio) attempts.push({ video: { deviceId: video.deviceId }, audio: false });
    }
    if (wantAudio) attempts.push({ video: true, audio: true });
    attempts.push({ video: true, audio: false });
    let lastError = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('getUserMedia failed');
  }

  /** All video inputs as [{ deviceId, label }] (labels need a granted camera permission). */
  async function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label || '' }));
  }

  /** Match config.preferredCamera: exact deviceId or case-insensitive substring of the label. */
  function findCamera(cameras, wanted) {
    const needle = wanted.toLowerCase();
    return (
      cameras.find((cam) => cam.deviceId === wanted) ||
      cameras.find((cam) => cam.label.toLowerCase().includes(needle)) ||
      null
    );
  }

  function currentDeviceId(mediaStream) {
    const track = mediaStream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : null;
    return (settings && settings.deviceId) || '';
  }

  /**
   * Switch to the configured preferred camera once permissions are granted (labels are only
   * readable then). Caches the resolved deviceId so later start() calls skip the enumeration.
   */
  async function switchToPreferred(current, wantAudio) {
    const wanted = String(config().preferredCamera || '').trim();
    resolvedDeviceId = null;
    if (!wanted) return current;
    let match = null;
    try {
      match = findCamera(await listCameras(), wanted);
    } catch (err) {
      console.warn('[camera] enumerateDevices failed', err);
    }
    if (!match) {
      console.warn(`[camera] no camera matches "${wanted}" – using the default camera.`);
      return current;
    }
    resolvedDeviceId = match.deviceId;
    if (currentDeviceId(current) === match.deviceId) return current;

    const video = baseVideoConstraints();
    delete video.facingMode; // meaningless together with an explicit device
    video.deviceId = { exact: match.deviceId };
    const open = () =>
      navigator.mediaDevices.getUserMedia({ video, audio: wantAudio }).catch((err) => {
        if (!wantAudio) throw err;
        return navigator.mediaDevices.getUserMedia({ video, audio: false }); // preferred camera, no microphone
      });
    try {
      const preferred = await open(); // keep the default stream alive until the switch succeeded
      stopTracks(current);
      return preferred;
    } catch (firstErr) {
      const busy = firstErr && (firstErr.name === 'NotReadableError' || firstErr.name === 'AbortError');
      if (busy) {
        // Some platforms refuse a second camera while the first one is open: release and retry once.
        stopTracks(current);
        try {
          return await open();
        } catch (err) {
          console.warn(`[camera] preferred camera "${match.label}" could not be opened – using the default.`, err);
          resolvedDeviceId = null;
          return acquire(baseVideoConstraints(), wantAudio);
        }
      }
      console.warn(`[camera] preferred camera "${match.label}" could not be opened – keeping the default.`, firstErr);
      resolvedDeviceId = null;
      return current;
    }
  }

  function logCamera(mediaStream) {
    if (loggedCamera) return;
    const track = mediaStream.getVideoTracks()[0];
    if (!track) return;
    loggedCamera = true;
    const settings = track.getSettings ? track.getSettings() : {};
    console.info(`[camera] using "${track.label || 'camera'}" ${settings.width || '?'}x${settings.height || '?'}`);
  }

  async function start(options) {
    const wantAudio = Boolean(options && options.audio);
    if (stream && streamHasAudio === wantAudio && stream.active) return stream;
    stop();
    const gen = generation;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia unsupported');
    }
    const video = baseVideoConstraints();
    if (typeof resolvedDeviceId === 'string') {
      delete video.facingMode;
      video.deviceId = { exact: resolvedDeviceId };
    }
    let acquired = await acquire(video, wantAudio);
    if (video.deviceId && currentDeviceId(acquired) !== resolvedDeviceId) {
      console.warn('[camera] preferred camera unavailable – it will be looked up again next time.');
      resolvedDeviceId = undefined;
    } else if (resolvedDeviceId === undefined && gen === generation) {
      acquired = await switchToPreferred(acquired, wantAudio);
    }
    if (gen !== generation) {
      // stop() ran while we were waiting (guest went back): release the camera again.
      stopTracks(acquired);
      throw new Error('Camera start cancelled');
    }
    stream = acquired;
    streamHasAudio = stream.getAudioTracks().length > 0;
    logCamera(stream);
    return stream;
  }

  function getStream() {
    return stream;
  }

  /** Attach the stream to a <video> element and resolve when frames are flowing. */
  function attach(videoEl) {
    return new Promise((resolve, reject) => {
      if (!stream) {
        reject(new Error('No stream'));
        return;
      }
      videoEl.srcObject = stream;
      videoEl.muted = true;
      const onReady = () => {
        videoEl.removeEventListener('loadedmetadata', onReady);
        videoEl.play().then(resolve).catch(resolve);
      };
      if (videoEl.readyState >= 1) onReady();
      else videoEl.addEventListener('loadedmetadata', onReady);
      setTimeout(resolve, 4000); // never hang forever
    });
  }

  /** Stamp a caption bottom-right (used for "names · date"); drawn unmirrored so text stays readable. */
  function drawCaption(ctx, width, height, opts) {
    const text = String(opts.caption || '').trim();
    if (!text) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const size = Math.max(14, Math.round(height * (opts.captionScale || 0.03)));
    const margin = Math.round(height * 0.03);
    ctx.font = opts.captionFont || `italic 500 ${size}px "Cormorant Garamond", Georgia, serif`;
    ctx.fillStyle = opts.captionColor || '#E9D5A0';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = size * 0.35;
    ctx.shadowOffsetY = size * 0.06;
    // Keep the text inside the 3:2 print area: the strip cover-crops 16:9 frames on both sides.
    const sideCrop = Math.max(0, Math.round((width - height * 1.5) / 2));
    ctx.fillText(text, width - margin - sideCrop, height - margin);
  }

  /** Grab the current frame from a <video> as a JPEG Blob. Options: mirror, quality, type, caption. */
  function capturePhoto(videoEl, options) {
    const opts = Object.assign({ mirror: false, quality: 0.92, type: 'image/jpeg', caption: '' }, options);
    const width = videoEl.videoWidth || 1280;
    const height = videoEl.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (opts.mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, width, height);
    drawCaption(ctx, width, height, opts);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        opts.type,
        opts.quality
      );
    });
  }

  const RECORDER_TYPES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
  ];

  function pickRecorderType() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const type of RECORDER_TYPES) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  function createRecorder() {
    if (typeof MediaRecorder === 'undefined' || !stream) return null;
    const mimeType = pickRecorderType();
    const options = { videoBitsPerSecond: 6000000 };
    if (mimeType) options.mimeType = mimeType;
    try {
      return new MediaRecorder(stream, options);
    } catch (err) {
      return new MediaRecorder(stream);
    }
  }

  window.Camera = { start, stop, attach, capturePhoto, createRecorder, getStream, listCameras };
})();
