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
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(policy).toContain("connect-src 'self' https: blob:");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("object-src 'none'");
  });
});
