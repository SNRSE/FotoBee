export const VIDEO_SECONDS = 15;
export function cameraMessage(error: unknown): string {
  if (!window.isSecureContext) return 'Your camera needs a secure connection. Open FotoBee on localhost or an HTTPS address.';
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera access is turned off. Allow the camera in your browser’s site settings, then try again.';
    if (error.name === 'NotFoundError') return 'We couldn’t find a camera. Connect a webcam, then try again.';
    if (error.name === 'NotReadableError') return 'Your camera is busy. Close other apps using it, then try again.';
  }
  return error instanceof Error ? error.message : 'The camera couldn’t start. Please try again.';
}
export async function openCamera(audio: boolean): Promise<{ stream: MediaStream; silent: boolean }> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t open the camera. Use a recent browser on localhost or HTTPS.');
  const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' };
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ video, audio }), silent: false };
  } catch (error) {
    if (!audio) throw error;
    // A missing or denied microphone should not prevent a silent video.
    return { stream: await navigator.mediaDevices.getUserMedia({ video, audio: false }), silent: true };
  }
}
export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}
export function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export function takePhoto(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || video.readyState < 2) return Promise.reject(new Error('The camera isn’t ready yet. Please try again.'));
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d')!;
  // Match the mirrored live preview.
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('We couldn’t capture this photo. Please try again.')),
    'image/jpeg', 0.94,
  ));
}
export function recorderType(): string | undefined {
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type));
}

