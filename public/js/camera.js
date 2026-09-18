/* Camera helpers: getUserMedia stream management, still capture, MediaRecorder setup. */
(function () {
  let stream = null;
  let streamHasAudio = false;

  function stop() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      streamHasAudio = false;
    }
  }

  async function start(options) {
    const wantAudio = Boolean(options && options.audio);
    if (stream && streamHasAudio === wantAudio && stream.active) return stream;
    stop();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia unsupported');
    }
    const videoConstraints = Object.assign({}, (window.FOTOBOX_CONFIG && window.FOTOBOX_CONFIG.video) || {});
    const constraints = { video: videoConstraints, audio: wantAudio };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Retry with relaxed constraints (e.g. camera cannot do 1080p or has no mic).
      if (wantAudio) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err2) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    }
    streamHasAudio = stream.getAudioTracks().length > 0;
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

  /** Grab the current frame from a <video> as a JPEG Blob. */
  function capturePhoto(videoEl, options) {
    const opts = Object.assign({ mirror: false, quality: 0.92, type: 'image/jpeg' }, options);
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

  window.Camera = { start, stop, attach, capturePhoto, createRecorder, getStream };
})();
