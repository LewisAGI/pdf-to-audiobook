import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const headers = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');

describe('response headers', () => {
  it('sets nosniff, no-referrer, and frame-ancestors none', () => {
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Referrer-Policy: no-referrer');
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain("frame-ancestors 'none'");
  });

  it('allows wasm compilation and https connections without opening scripts to the network', () => {
    const policy = headers.split('\n').find((line) => line.includes('Content-Security-Policy'));
    expect(policy).toBeTruthy();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).not.toMatch(/script-src[^;]*blob:/);
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(policy).toContain("connect-src 'self' https: blob:");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("object-src 'none'");
  });

  it('licenses the application under GPL-3.0-or-later', () => {
    const license = readFileSync(new URL('../../LICENSE', import.meta.url));
    expect(createHash('sha256').update(license).digest('hex')).toBe('3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986');
    expect(license.toString('utf8')).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(license.toString('utf8')).toContain('Version 3, 29 June 2007');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { license: string };
    expect(pkg.license).toBe('GPL-3.0-or-later');
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
      packages: { '': { license: string } };
    };
    expect(lock.packages[''].license).toBe('GPL-3.0-or-later');
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('GPL-3.0-or-later');
    const notices = readFileSync(new URL('../../public/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8').split('\n');
    expect(notices[3]).toBe(
      'This application is licensed under GPL-3.0-or-later. Source: https://github.com/LewisAGI/pdf-to-audiobook. The components below keep their own licenses.',
    );
    expect(notices.slice(0, 6).join('\n')).not.toMatch(/MIT/);
    const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(vite).toContain('THIRD_PARTY_NOTICES.txt');
  });

  it('publishes third-party notices for lamejs, eSpeak NG, and ffmpeg', () => {
    const notices = readFileSync(new URL('../../public/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');
    expect(notices).toMatch(/lamejs/i);
    expect(notices).toMatch(/LGPL-3\.0/);
    expect(notices).toMatch(/GNU LESSER GENERAL PUBLIC LICENSE/);
    expect(notices).toMatch(/eSpeak NG/);
    expect(notices).toMatch(/GPL-3\.0/);
    expect(notices).toMatch(/GNU GENERAL PUBLIC LICENSE/);
    expect(notices).toMatch(/Version 3, 29 June 2007/);
    expect(notices).toMatch(/ffmpeg/i);
    expect(notices).toMatch(/GPL-2\.0-or-later/);
    expect(notices).toMatch(/Version 2, June 1991/);
    expect(notices).toMatch(/phonemizer 1\.2\.1/);
    expect(notices).toMatch(/onnxruntime-web 1\.22\.0-dev\.20250409-89f8206ba4/);
    expect(notices).toMatch(/pdf\.js/);
    expect(notices).toMatch(/Apache-2\.0/);
    expect(notices).toMatch(/onnxruntime-web/);
    expect(notices).toMatch(/MIT/);
    expect(notices).toMatch(/transformers\.js/);
    expect(notices).toMatch(/tesseract\.js/);
    expect(notices).toMatch(/kokoro-js/);
    expect(notices).toMatch(/workbox/);
    expect(notices).toMatch(/jszip/);
    expect(notices).toMatch(/@ffmpeg\/ffmpeg/);
    expect(notices).toMatch(/Copyright/);
    expect(notices).toMatch(/Permission is hereby granted/);
    expect(notices).toMatch(/Apache License/);
    expect(notices).toMatch(/Version 2\.0, January 2004/);
    const app = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('/THIRD_PARTY_NOTICES.txt');
  });
});
