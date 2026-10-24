import { expect, test } from 'playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/outline.pdf');

async function openOutline(page: import('playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(fixture);
  await expect(page.locator('.chapter-name')).toHaveText('Arrival', { timeout: 30_000 });
}

async function hangFirstChapterPlay(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    const timeout = 6_000;
    const delay = 5_000;
    localStorage.setItem('pta-media-timeout', String(timeout));
    const originalPlay = HTMLMediaElement.prototype.play;
    const originalPause = HTMLMediaElement.prototype.pause;
    let chapterPlays = 0;
    let interrupt: (() => void) | null = null;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (this.loop) return originalPlay.call(this);
      chapterPlays += 1;
      const mark = window as unknown as { __chapterPlays: number; __oldDeadline: number };
      mark.__chapterPlays = chapterPlays;
      if (chapterPlays === 1) {
        mark.__oldDeadline = Date.now() + timeout;
        return new Promise(() => undefined);
      }
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          interrupt = null;
          originalPlay.call(this).then(resolve, reject);
        }, delay);
        interrupt = () => {
          window.clearTimeout(timer);
          reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
        };
      });
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      const pending = interrupt;
      interrupt = null;
      const result = originalPause.call(this);
      pending?.();
      return result;
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pta-tts', 'stub');
  });
});

test('upload, chapters, play, resume, and export', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(fixture);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Book', { timeout: 30_000 });
  await expect(page.locator('.chapter-name')).toHaveText('Arrival');

  await page.getByRole('button', { name: 'Chapters' }).click();
  await expect(page.getByRole('button', { name: 'Arrival' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Departure' })).toBeVisible();
  await page.locator('.sheet header').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Forward 15 seconds' }).click();
  await expect
    .poll(async () => Number((await page.getByTestId('elapsed').getAttribute('data-saved')) ?? '0'))
    .toBeGreaterThan(5);

  const saved = await page.getByTestId('elapsed').getAttribute('data-saved');
  await page.screenshot({ path: info.outputPath('player.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Book');
  await expect
    .poll(async () => Number((await page.getByTestId('elapsed').getAttribute('data-saved')) ?? '0'))
    .toBeGreaterThan(5);
  const restored = await page.getByTestId('elapsed').getAttribute('data-saved');
  expect(Number(restored)).toBeCloseTo(Number(saved), 0);

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP3' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect((await download.createReadStream()) !== null).toBe(true);
});

test('exports an M4B through the ffmpeg fallback', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('pta-encoder', 'ffmpeg');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(fixture);
  await expect(page.locator('.chapter-name')).toHaveText('Arrival', { timeout: 30_000 });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
  await page.getByRole('button', { name: 'Export M4B' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.m4b$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const bytes = await import('node:fs/promises').then((fs) => fs.readFile(filePath!));
  expect(bytes.includes(Buffer.from('ftyp'))).toBe(true);
});

test('reads a scanned page with OCR', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(path.resolve('tests/fixtures/scanned.pdf'));
  await expect(page.locator('.chapter-name')).toContainText(/council|dawn|reconvened/i, { timeout: 120_000 });
});

test('invalidates cached audio when chapters are merged and split', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(fixture);
  await expect(page.locator('.chapter-name')).toHaveText('Arrival', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const first = await page.evaluate(() => document.querySelector('audio')?.duration ?? 0);
  expect(first).toBeGreaterThan(12);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.getByRole('button', { name: 'Edit chapter' }).first().click();
  await page.getByRole('button', { name: 'Merge with next' }).click();
  await page.locator('.sheet header').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const merged = await page.evaluate(() => document.querySelector('audio')?.duration ?? 0);
  expect(merged).toBeGreaterThan(first + 2);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.getByRole('button', { name: 'Edit chapter' }).first().click();
  await page.getByRole('button', { name: 'Split' }).click();
  await page.locator('[data-action="do-split"]').first().click();
  await page.locator('.sheet header').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const split = await page.evaluate(() => document.querySelector('audio')?.duration ?? 0);
  expect(split).toBeLessThan(merged - 2);
});

test('keeps the Play button through the click', async ({ page }) => {
  await openOutline(page);
  const live = page.locator('#live-status');
  await expect(live).toHaveAttribute('aria-live', 'assertive');
  await expect(page.locator('#app #live-status')).toHaveCount(0);
  await page.evaluate(() => {
    const button = document.querySelector('button.play');
    if (!(button instanceof HTMLButtonElement)) throw new Error('Play button missing');
    const rec = () => {
      (window as unknown as { __playClick: { connected: boolean; same: boolean } }).__playClick = {
        connected: button.isConnected,
        same: document.querySelector('button.play') === button,
      };
    };
    button.addEventListener(
      'click',
      () => {
        document.addEventListener('click', () => queueMicrotask(rec), { once: true });
      },
      true,
    );
  });
  await page.getByRole('button', { name: 'Play' }).click();
  const during = await page.evaluate(
    () => (window as unknown as { __playClick?: { connected: boolean; same: boolean } }).__playClick,
  );
  expect(during).toEqual({ connected: true, same: true });
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('main.shell')).toHaveAttribute('data-engine', 'kokoro');
  await expect(page.getByText('Neural voice unavailable')).toHaveCount(0);
});

test('keeps a Play retry going after the first play hangs', async ({ page }) => {
  await hangFirstChapterPlay(page);
  await openOutline(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForFunction(() => (window as unknown as { __chapterPlays?: number }).__chapterPlays === 1);
  await page.waitForTimeout(1_500);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Date.now() > (window as unknown as { __oldDeadline: number }).__oldDeadline + 400);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('#live-status')).toHaveText('');
  await expect(page.getByText("Playback didn't start. Try again.")).toHaveCount(0);
  await expect(page.locator('main.shell')).toHaveAttribute('data-engine', 'kokoro');
});

test('keeps a chapter jump playing after the first play hangs', async ({ page }) => {
  await hangFirstChapterPlay(page);
  await openOutline(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForFunction(() => (window as unknown as { __chapterPlays?: number }).__chapterPlays === 1);
  await page.waitForTimeout(1_500);
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.getByRole('button', { name: 'Departure' }).click();
  await expect(page.locator('.chapter-name')).toHaveText('Departure');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Date.now() > (window as unknown as { __oldDeadline: number }).__oldDeadline + 400);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.locator('.chapter-name')).toHaveText('Departure');
  await expect(page.getByText("Playback didn't start. Try again.")).toHaveCount(0);
  await expect(page.locator('main.shell')).toHaveAttribute('data-engine', 'kokoro');
});

test('shows a retry when chapter audio does not load', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pta-media-timeout', '400');
    localStorage.setItem('pta-hang-media', 'load');
  });
  await openOutline(page);
  await page.getByRole('button', { name: 'Play' }).click();
  const live = page.locator('#live-status');
  await expect(live).toHaveText("Playback didn't start. Try again.");
  await expect(live).toHaveAttribute('aria-live', 'assertive');
  await expect(page.locator('#app #live-status')).toHaveCount(0);
  await expect(page.locator('main.shell')).toHaveAttribute('data-engine', 'kokoro');
  await expect(page.getByText('Neural voice unavailable')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('shows a retry when playback does not start', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pta-media-timeout', '400');
    localStorage.setItem('pta-hang-media', 'play');
  });
  await openOutline(page);
  await page.getByRole('button', { name: 'Play' }).click();
  const live = page.locator('#live-status');
  await expect(live).toHaveText("Playback didn't start. Try again.");
  await expect(live).toHaveAttribute('aria-live', 'assertive');
  await expect(page.locator('main.shell')).toHaveAttribute('data-engine', 'kokoro');
  await expect(page.getByText('Neural voice unavailable')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('keeps the chapter after a mid-book references heading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(path.resolve('tests/fixtures/references.pdf'));
  await expect(page.locator('.chapter-name')).toHaveText('Opening', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Chapters' }).click();
  await expect(page.getByRole('button', { name: 'The Return' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'References' })).toHaveCount(0);
  await page.locator('.sheet header').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Paste text' }).click();
  await page.getByLabel('Article text').fill('Opening\n\nThe river kept its name.\n\nReferences\n\nSmith, A. 1999.\n\nThe Return\n\nThey came back at dusk.');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Chapters' }).click();
  await expect(page.getByRole('button', { name: 'The Return' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'References' })).toHaveCount(0);
});

test('reads a two-column page down the left column first', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(path.resolve('tests/fixtures/columns.pdf'));
  await expect(page.locator('.chapter-name')).toHaveText('LEFTMARK', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Chapters' }).click();
  await expect(page.locator('.chapter-main')).toHaveText(['LEFTMARK', 'LEFTEND', 'RIGHTMARK', 'RIGHTEND']);
});

test('clears the API key when the endpoint origin changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Paste text' }).click();
  await page.getByLabel('Article text').fill('Opening\n\nThe river kept its name.\n\nLater\n\nThey left at dusk.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.chapter-name')).toHaveText('Opening');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Summary' }).click();
  await page.getByLabel('Endpoint').fill('https://one.example/v1');
  await page.getByLabel('API key').fill('sk-one-secret');
  await page.getByRole('button', { name: 'API summary' }).click();
  await expect(page.getByLabel('API key')).toHaveValue('sk-one-secret');
  await expect(page.getByLabel('Endpoint')).toHaveValue('https://one.example/v1');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Summary' }).click();
  await expect(page.getByLabel('API key')).toHaveValue('sk-one-secret');
  await page.getByLabel('Endpoint').fill('https://two.example/v1');
  await expect(page.getByLabel('API key')).toHaveValue('');
  const stored = await page.evaluate(() => localStorage.getItem('pta-llm-key:https://one.example'));
  expect(stored).toBe('sk-one-secret');
  expect(await page.evaluate(() => localStorage.getItem('pta-llm-key:https://two.example'))).toBeNull();
});

test('keeps the neural engine when jumping chapters during generation', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem('pta-tts', 'worker');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(fixture);
  await expect(page.locator('.chapter-name')).toHaveText('Arrival', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  const speaking = page.locator('main.shell');
  const arrivalId = await speaking.getAttribute('data-chapter');
  expect(arrivalId).toBeTruthy();
  await expect(speaking).toHaveAttribute('data-speaking', arrivalId!, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.evaluate(() => {
    const frames: { name: string; armed: string; stat: boolean; sheet: boolean }[] = [];
    const take = () => {
      frames.push({
        name: document.querySelector('.chapter-name')?.textContent ?? '',
        armed: document.querySelector('main.shell')?.getAttribute('data-armed') ?? '',
        stat: Boolean(document.querySelector('.play .stat')),
        sheet: Boolean(document.querySelector('.sheet')),
      });
    };
    const observer = new MutationObserver(take);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    (window as unknown as { __jumpFrames: typeof frames }).__jumpFrames = frames;
  });
  await page.getByRole('button', { name: 'Departure' }).click();
  await expect(page.locator('.chapter-name')).toHaveText('Departure', { timeout: 1_000 });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __jumpFrames: { armed: string }[] }).__jumpFrames.some((frame) => frame.armed),
      ),
    )
    .toBe(true);
  const frames = await page.evaluate(
    () => (window as unknown as { __jumpFrames: { name: string; armed: string; sheet: boolean }[] }).__jumpFrames,
  );
  const closed = frames.find((frame) => !frame.sheet);
  expect(closed?.name).toBe('Departure');
  expect(closed?.armed).toBe('');
  expect(frames.some((frame) => frame.armed && frame.armed !== arrivalId)).toBe(true);
  await expect(speaking).toHaveAttribute('data-engine', 'kokoro');
  const chapterId = await speaking.getAttribute('data-chapter');
  expect(chapterId).toBeTruthy();
  expect(chapterId).not.toBe(arrivalId);
  await expect(speaking).toHaveAttribute('data-speaking', chapterId!, { timeout: 4_000 });
  await expect(page.locator('.play .stat')).toBeVisible();
  await expect(page.getByText('Neural voice unavailable')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  const duration = await page.evaluate(() => document.querySelector('audio')?.duration ?? 0);
  expect(duration).toBeGreaterThan(0.25);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText("Web Speech audio can't be exported")).toHaveCount(0);
});

test('imports a PDF after an offline reload', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('pta-sw', '1');
    localStorage.setItem('pta-tts', 'worker');
  });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) throw new Error('service worker is not controlling the page');
  });
  await page.evaluate(async () => {
    const response = await fetch('/onnx/ort-wasm-simd-threaded.jsep.wasm');
    if (!response.ok) throw new Error(`wasm ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 1_000_000) throw new Error('wasm was not fetched');
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const cache = await caches.open('onnx-runtime');
      const keys = await cache.keys();
      if (keys.some((key) => key.url.includes('ort-wasm-simd-threaded.jsep.wasm'))) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('onnx runtime cache missed the wasm');
  });
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(fixture);
  await expect(page.locator('.chapter-name')).toHaveText('Arrival', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('main.shell')).toHaveAttribute('data-engine', 'kokoro');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Neural voice unavailable')).toHaveCount(0);
});

test('serves third-party notices as text while the service worker controls the page', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pta-sw', '1');
  });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) throw new Error('service worker is not controlling the page');
  });
  const response = await page.goto('/THIRD_PARTY_NOTICES.txt');
  expect(response?.headers()['content-type'] ?? '').toContain('text/plain');
  const body = await response?.text();
  expect(body).toContain('lamejs');
  expect(body).toContain('LGPL-3.0');
  expect(body).toContain('pdf.js');
  expect(body).toContain('Apache-2.0');
  expect(body).toContain('workbox');
  expect(body).not.toContain('<div id="app">');
});

test('shows a storage message instead of switching voices when the disk is full', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pta-tts', 'worker');
    localStorage.setItem('pta-quota', '0');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.locator('#pdf-file').setInputFiles(fixture);
  await expect(page.locator('.chapter-name')).toHaveText('Arrival', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByText('Not enough storage')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('main.shell')).toHaveAttribute('data-engine', 'kokoro');
  await expect(page.getByText('Neural voice unavailable')).toHaveCount(0);
});

test('keeps a paste draft when the sheet redraws', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: 'Paste text' }).click();
  await page.getByLabel('Article text').fill('https://example.com/story');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('No article text')).toBeVisible();
  await expect(page.getByLabel('Article text')).toHaveValue('https://example.com/story');
});

test('hides a touch tooltip when the pointer is released', async ({ page }) => {
  await page.goto('/');
  const add = page.getByRole('button', { name: 'Add' });
  await add.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(page.locator('.tooltip')).toBeVisible();
  await add.dispatchEvent('pointerup', { pointerType: 'touch' });
  await expect(page.locator('.tooltip')).toBeHidden();
});
