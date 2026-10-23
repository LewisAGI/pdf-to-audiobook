import { expect, test } from 'playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/outline.pdf');

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
