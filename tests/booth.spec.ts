import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as any;
    state.cameraStreams = [];
    state.recordingDurations = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      state.cameraStreams.push(stream);
      return stream;
    };
    const NativeRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        let started = 0;
        this.addEventListener('start', () => { started = performance.now(); });
        this.addEventListener('stop', () => { state.recordingDurations.push(performance.now() - started); });
      }
    };
  });
  await page.goto('/');
});
async function photos(page: import('@playwright/test').Page) {
  await page.locator('[data-action="photo"]').click();
  await expect(page.locator('#live-video')).toBeVisible();
  await page.getByRole('button', { name: 'Take my photos', exact: true }).click();
  await expect(page.locator('.countdown-number')).toHaveText('3');
  await expect(page.getByRole('heading', { name: 'Pick your keepers.' })).toBeVisible({ timeout: 16000 });
  await expect(page.locator('.review-photo img')).toHaveCount(2);
}
async function expectStopped(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => (window as any).cameraStreams.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
}

test('home is responsive and assets load without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Made of moments.' })).toBeVisible();
  await expect(page.locator('.mode-card')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator('.card-image img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('two countdown photos can both be saved and persist after reload', async ({ page }) => {
  await photos(page);
  await expectStopped(page);
  await page.screenshot({ path: 'test-results/photo-review.png', fullPage: true });
  await page.getByRole('button', { name: 'Save both photos' }).click();
  await expect(page.getByRole('heading', { name: 'Consider it kept.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Made of moments.' })).toBeVisible();
  await page.reload();
  await page.locator('[data-action="gallery"]').click();
  await expect(page.locator('.memory-card')).toHaveCount(2);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download photo 1' }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.jpg$/);
});

test('guests can keep exactly one photo', async ({ page }) => {
  await photos(page);
  await page.getByRole('button', { name: 'Keep photo 2' }).click();
  await expect(page.getByRole('button', { name: 'Keep photo 2' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Save 1 photo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consider it kept.' })).toBeVisible();
  await page.locator('[data-action="gallery"]').click();
  await expect(page.locator('.memory-card')).toHaveCount(1);
});

test('neither photo is saved when both are deselected', async ({ page }) => {
  await photos(page);
  await page.getByRole('button', { name: 'Keep photo 1' }).click();
  await page.getByRole('button', { name: 'Keep photo 2' }).click();
  await page.getByRole('button', { name: 'Finish without saving' }).click();
  await expect(page.getByRole('heading', { name: 'Made of moments.' })).toBeVisible();
  await page.locator('[data-action="gallery"]').click();
  await expect(page.getByRole('heading', { name: 'Every story starts somewhere.' })).toBeVisible();
});

test('video records for 15 seconds, retakes, and saves a playable clip', async ({ page }) => {
  await page.locator('[data-action="video"]').click();
  await page.getByRole('button', { name: 'Record a video', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'One for the memories.' })).toBeVisible({ timeout: 24000 });
  await expectStopped(page);
  const duration = await page.evaluate(() => (window as any).recordingDurations[0]);
  expect(duration).toBeGreaterThanOrEqual(14900);
  expect(duration).toBeLessThan(17000);
  const playback = page.locator('.video-review video');
  await expect.poll(() => playback.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await playback.evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => playback.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Retake video', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record a video', exact: true })).toBeEnabled();
  await expect(page.locator('.count-badge')).toHaveText('0');
  await page.getByRole('button', { name: 'Record a video', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'One for the memories.' })).toBeVisible({ timeout: 24000 });
  await page.getByRole('button', { name: 'Save my video', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consider it kept.' })).toBeVisible();
  await page.locator('[data-action="gallery"]').click();
  await expect(page.locator('.memory-card')).toHaveCount(1);
  await expect(page.locator('.memory-card video')).toBeVisible();
});

test('camera denial shows a helpful error and retry', async ({ page }) => {
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError')); });
  await page.locator('[data-action="photo"]').click();
  await expect(page.getByText('Camera access is turned off.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take my photos', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/camera-denied.png', fullPage: true });
});

test('microphone denial falls back to silent video', async ({ page }) => {
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => constraints?.audio
      ? Promise.reject(new DOMException('Denied', 'NotAllowedError'))
      : original(constraints);
  });
  await page.locator('[data-action="video"]').click();
  await expect(page.getByText('Your microphone isn’t available.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Microphone off' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Record a video', exact: true })).toBeEnabled();
});

test('leaving during countdown cancels capture and releases camera', async ({ page }) => {
  await page.locator('[data-action="photo"]').click();
  await page.getByRole('button', { name: 'Take my photos', exact: true }).click();
  await expect(page.locator('.countdown-number')).toHaveText('3');
  await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  await expectStopped(page);
  await page.waitForTimeout(8000);
  await expect(page.getByRole('heading', { name: 'Made of moments.' })).toBeVisible();
  await expect(page.locator('.count-badge')).toHaveText('0');
});

test('storage failure preserves captures and offers emergency downloads', async ({ page }) => {
  await photos(page);
  await page.evaluate(() => { IDBObjectStore.prototype.add = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Save both photos' }).click();
  await expect(page.getByText('We couldn’t save on this device.', { exact: false })).toBeVisible();
  await expect(page.locator('.review-photo img')).toHaveCount(2);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download photo 1', exact: true }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.jpg$/);
  await expect(page.getByRole('button', { name: 'Try saving again' })).toBeEnabled();
});

test('mobile capture and review fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await photos(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/photo-review-mobile.png', fullPage: true });
});


test('a late camera permission response cannot revive an abandoned session', async ({ page }) => {
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      return new Promise<MediaStream>(resolve => { (window as any).releasePermission = () => resolve(stream); });
    };
  });
  await page.locator('[data-action="photo"]').click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releasePermission)).toBe('function');
  await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  await page.evaluate(() => (window as any).releasePermission());
  await expectStopped(page);
  await expect(page.getByRole('heading', { name: 'Made of moments.' })).toBeVisible();
});

test('leaving an active recording stops all tracks and discards the clip', async ({ page }) => {
  await page.locator('[data-action="video"]').click();
  await page.getByRole('button', { name: 'Record a video', exact: true }).click();
  await expect(page.locator('#shot-status')).toContainText('REC');
  await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  await expectStopped(page);
  await page.locator('[data-action="gallery"]').click();
  await expect(page.getByRole('heading', { name: 'Every story starts somewhere.' })).toBeVisible();
});

test('a disconnected camera cancels the countdown and allows retry', async ({ page }) => {
  await page.locator('[data-action="photo"]').click();
  await page.getByRole('button', { name: 'Take my photos', exact: true }).click();
  await expect(page.locator('.countdown-number')).toHaveText('3');
  await page.evaluate(() => (window as any).cameraStreams[0].getVideoTracks()[0].dispatchEvent(new Event('ended')));
  await expect(page.getByText('The camera disconnected.', { exact: false })).toBeVisible();
  await expectStopped(page);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Take my photos', exact: true })).toBeEnabled();
});

