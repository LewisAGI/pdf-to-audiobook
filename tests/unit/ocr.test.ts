import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recognizeText } from '../../src/lib/ocr';

describe('OCR', () => {
  it('reads the scanned fixture image', async () => {
    const png = await readFile(new URL('../fixtures/scanned-page.png', import.meta.url));
    const text = await recognizeText(png, { langPath: path.resolve('public/tessdata') });
    expect(text.toLowerCase()).toContain('council');
    expect(text.toLowerCase()).toContain('dawn');
  });
});
