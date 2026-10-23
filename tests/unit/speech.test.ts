import { describe, expect, it, vi } from 'vitest';
import { KOKORO_REVISION } from '../../src/lib/kokoro-model';
import { installKokoroVoicePin } from '../../src/lib/kokoro-voices';
import { aggregateModelProgress, modelProgressRatio, monotonicProgress, phaseProgress } from '../../src/lib/model-progress';

const posted: Array<{ type?: string; phase?: string; ratio?: number }> = [];
let modelCallback: ((info: unknown) => void) | null = null;

vi.mock('@huggingface/transformers', () => ({
  env: {
    allowLocalModels: false,
    useBrowserCache: true,
    backends: { onnx: { wasm: {} as { wasmPaths?: string; numThreads?: number } } },
  },
  StyleTextToSpeech2Model: {
    from_pretrained: async (_id: string, options: { progress_callback?: (info: unknown) => void }) => {
      modelCallback = options.progress_callback ?? null;
      return {};
    },
  },
  AutoTokenizer: {
    from_pretrained: async () => ({}),
  },
}));

vi.mock('kokoro-js', () => ({
  KokoroTTS: class {
    constructor(
      public model: unknown,
      public tokenizer: unknown,
    ) {}
    async generate() {
      return { audio: new Float32Array(8), sampling_rate: 24000 };
    }
  },
}));
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

  it('gives model loading and speech separate shares of the bar', () => {
    expect(phaseProgress('model', 1)).toBeCloseTo(0.3);
    expect(phaseProgress('speech', 0)).toBeCloseTo(0.3);
    expect(phaseProgress('speech', 1)).toBe(1);
    let mark = 0;
    const steps: Array<['model' | 'speech', number]> = [
      ['model', 0.02],
      ['model', 0],
      ['model', 1],
      ['speech', 0],
      ['speech', 0.04],
      ['speech', 0.03],
    ];
    for (const [phase, ratio] of steps) mark = monotonicProgress(mark, phaseProgress(phase, ratio));
    expect(mark).toBeCloseTo(0.3 + 0.04 * 0.7);
    expect(mark).toBeLessThan(0.5);
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
  });

  it('loads the worker with the voice pin and aggregated model progress', async () => {
    const calls: string[] = [];
    const scope = globalThis as typeof globalThis & {
      self: typeof globalThis;
      onmessage: ((event: MessageEvent) => void) | null;
      postMessage: (message: unknown) => void;
      location: Location;
      crossOriginIsolated: boolean;
    };
    scope.self = scope;
    scope.location = { origin: 'http://127.0.0.1:4173' } as Location;
    scope.crossOriginIsolated = false;
    scope.postMessage = (message) => {
      posted.push(message as { type?: string; phase?: string; ratio?: number });
    };
    if (!globalThis.caches) {
      globalThis.caches = {
        open: async () => ({}) as Cache,
      } as CacheStorage;
    }
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return new Response('ok');
    }) as typeof fetch;
    await import('../../src/workers/tts.worker.ts');
    const voice = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin';
    await globalThis.fetch(voice);
    expect(calls[0]).toContain(KOKORO_REVISION);
    expect(calls[0]).not.toContain('/resolve/main/');
    scope.onmessage?.({ data: { type: 'generate', jobId: 'job-1', text: 'Hello there.', voice: 'af_heart', speed: 1, resumeFrom: 0 } } as MessageEvent);
    await vi.waitFor(() => {
      if (!modelCallback) throw new Error('model progress callback missing');
    });
    modelCallback?.({ status: 'progress', file: 'model.onnx', loaded: 100, total: 100, progress: 100 });
    modelCallback?.({ status: 'progress', file: 'tokenizer.json', loaded: 4, total: 100, progress: 4 });
    const ratios = posted.filter((message) => message.type === 'progress' && message.phase === 'model').map((message) => message.ratio ?? 0);
    expect(ratios.at(-1)).toBeCloseTo(0.52);
    expect(ratios.at(-1)).toBeLessThan(0.8);
  });

  it('allows the stub voice only in dev and test builds', () => {
    expect(stubAllowed({ DEV: false, MODE: 'production' })).toBe(false);
    expect(stubAllowed({ DEV: false, MODE: 'test' })).toBe(true);
    expect(stubAllowed({ DEV: true, MODE: 'production' })).toBe(true);
  });
});
