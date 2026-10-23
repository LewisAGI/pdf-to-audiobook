import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KOKORO_REVISION } from '../../src/lib/kokoro-model';
import { installKokoroVoicePin } from '../../src/lib/kokoro-voices';
import { aggregateModelProgress, modelProgressRatio } from '../../src/lib/model-progress';
import { speechChunks } from '../../src/lib/speech-text';
import { stubAllowed } from '../../src/lib/tts';

describe('speech helpers', () => {
  it('treats transformer progress percents as a fraction of one', () => {
    expect(modelProgressRatio({ progress: 37 })).toBeCloseTo(0.37);
    expect(modelProgressRatio({ progress: 100 })).toBe(1);
    expect(modelProgressRatio({ loaded: 25, total: 100 })).toBeCloseTo(0.25);
  });

  it('splits a long sentence instead of emitting it whole', () => {
    const sentence = Array.from({ length: 70 }, (_, index) => `word${index}`).join(' ');
    expect(sentence.length).toBeGreaterThan(280);
    const parts = speechChunks(sentence);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 280)).toBe(true);
    expect(parts.join(' ')).toContain('word0');
    expect(parts.join(' ')).toContain('word69');
    const bare = 'A'.repeat(600);
    const broken = speechChunks(bare);
    expect(broken.length).toBeGreaterThan(1);
    expect(broken.every((part) => [...part].length <= 280)).toBe(true);
    expect(broken.join('')).toBe(bare);
  });

  it('aggregates model download progress across files', () => {
    const files = new Map<string, { loaded: number; total: number }>();
    const first = aggregateModelProgress(files, { status: 'progress', file: 'model.onnx', loaded: 100, total: 100, progress: 100 });
    expect(first).toBeCloseTo(1);
    const second = aggregateModelProgress(files, { status: 'progress', file: 'tokenizer.json', loaded: 4, total: 100, progress: 4 });
    expect(second).toBeCloseTo(0.52);
    expect(second).toBeLessThan(0.8);
  });

  it('pins Kokoro voice files away from resolve/main', async () => {
    const calls: string[] = [];
    const cache = {
      async match(url: string) {
        calls.push(`match:${url}`);
        return undefined;
      },
      async put(url: string) {
        calls.push(`put:${url}`);
      },
    };
    const target = {
      fetch: (async (url: string) => {
        calls.push(`fetch:${url}`);
        return new Response('ok');
      }) as typeof fetch,
      caches: { open: async () => cache } as unknown as CacheStorage,
    };
    installKokoroVoicePin(target);
    const main = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin';
    await target.fetch(main);
    expect(calls[0]).toContain(KOKORO_REVISION);
    expect(calls[0]).not.toContain('/resolve/main/');
    const opened = await target.caches.open('kokoro-voices');
    await opened.match(main);
    expect(calls.some((call) => call.startsWith('match:') && call.includes(KOKORO_REVISION))).toBe(true);
    const worker = readFileSync(new URL('../../src/workers/tts.worker.ts', import.meta.url), 'utf8');
    expect(worker).toContain('installKokoroVoicePin');
    expect(worker).toContain('setTimeout(resolve, 0)');
  });

  it('allows the stub voice only in dev and test builds', () => {
    expect(stubAllowed({ DEV: false, MODE: 'production' })).toBe(false);
    expect(stubAllowed({ DEV: false, MODE: 'test' })).toBe(true);
    expect(stubAllowed({ DEV: true, MODE: 'production' })).toBe(true);
  });
});
