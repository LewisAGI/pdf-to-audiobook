import { concatFloats, stubSpeech, type WavData } from './audio';

export type SpeechProgress = {
  phase: 'model' | 'speech';
  ratio: number;
  sentence: number;
  total: number;
};

export type SentenceUpdate = {
  index: number;
  total: number;
  samples: Float32Array;
  sampleRate: number;
};

type WorkerIn =
  | { type: 'generate'; jobId: string; text: string; voice: string; speed: number; resumeFrom: number }
  | { type: 'cancel'; jobId: string };

type WorkerOut =
  | { type: 'progress'; jobId: string; phase: 'model' | 'speech'; ratio: number; sentence: number; total: number }
  | { type: 'sentence'; jobId: string; index: number; total: number; sampleRate: number; pcm: ArrayBuffer }
  | { type: 'done'; jobId: string; sampleRate: number }
  | { type: 'cancelled'; jobId: string }
  | { type: 'error'; jobId: string; message: string };

export function stubAllowed(env: { DEV?: boolean; MODE?: string } = import.meta.env): boolean {
  return Boolean(env.DEV) || env.MODE === 'test';
}

export function ttsMode(): 'off' | 'fast' | 'slow' {
  if (!stubAllowed()) return 'off';
  try {
    const flag = localStorage.getItem('pta-tts') || new URLSearchParams(location.search).get('tts') || '';
    if (flag === 'slow') return 'slow';
    if (flag === 'stub') return 'fast';
  } catch {
    return 'off';
  }
  return 'off';
}

export function stubRequested(): boolean {
  return ttsMode() !== 'off';
}

export class SpeechEngine {
  private worker: Worker | null = null;
  private job = 0;

  cancel() {
    const jobId = this.job > 0 ? String(this.job) : '';
    this.job += 1;
    if (jobId) this.worker?.postMessage({ type: 'cancel', jobId } satisfies WorkerIn);
  }

  async synthesize(options: {
    text: string;
    voice: string;
    speed?: number;
    resumeFrom?: number;
    prior?: Float32Array;
    priorRate?: number;
    onProgress?: (progress: SpeechProgress) => void;
    onSentence?: (update: SentenceUpdate) => void | Promise<void>;
  }): Promise<WavData> {
    const mode = ttsMode();
    if (mode === 'fast') return stubSpeech(options.text);
    if (mode === 'slow') return this.slowStub(options);
    const jobId = String(++this.job);
    const worker = this.ensure();
    const pieces: Float32Array[] = options.prior ? [options.prior] : [];
    let sampleRate = options.priorRate ?? 24000;
    const result = await new Promise<WavData>((resolve, reject) => {
      let settled = false;
      let chain = Promise.resolve();
      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        run();
      };
      const onError = () => {
        if (this.worker === worker) {
          this.worker = null;
          worker.terminate();
        }
        finish(() => reject(new Error('Neural voice failed')));
      };
      const onMessage = (event: MessageEvent<WorkerOut>) => {
        const message = event.data;
        if (!message || message.jobId !== jobId) return;
        if (message.type === 'progress') options.onProgress?.(message);
        if (message.type === 'sentence') {
          sampleRate = message.sampleRate;
          pieces.push(new Float32Array(message.pcm));
          const snapshot = concatFloats(pieces);
          const update = {
            index: message.index,
            total: message.total,
            samples: snapshot,
            sampleRate,
          };
          options.onProgress?.({
            phase: 'speech',
            ratio: (message.index + 1) / Math.max(1, message.total),
            sentence: message.index + 1,
            total: message.total,
          });
          chain = chain.then(() => options.onSentence?.(update)).catch((error: unknown) => {
            finish(() => reject(error instanceof Error ? error : new Error('Neural voice failed')));
          });
        }
        if (message.type === 'done') {
          const rate = message.sampleRate || sampleRate;
          chain
            .then(() => finish(() => resolve({ samples: concatFloats(pieces), sampleRate: rate })))
            .catch((error: unknown) => {
              finish(() => reject(error instanceof Error ? error : new Error('Neural voice failed')));
            });
        }
        if (message.type === 'cancelled') finish(() => reject(new DOMException('Cancelled', 'AbortError')));
        if (message.type === 'error') finish(() => reject(new Error(message.message)));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({
        type: 'generate',
        jobId,
        text: options.text,
        voice: options.voice,
        speed: options.speed ?? 1,
        resumeFrom: options.resumeFrom ?? 0,
      } satisfies WorkerIn);
    });
    return result;
  }

  private async slowStub(options: {
    text: string;
    onSentence?: (update: SentenceUpdate) => void | Promise<void>;
  }): Promise<WavData> {
    const jobId = String(++this.job);
    const audio = stubSpeech(options.text);
    const slices = 8;
    const size = Math.max(1, Math.ceil(audio.samples.length / slices));
    const pieces: Float32Array[] = [];
    for (let index = 0; index < slices; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (String(this.job) !== jobId) throw new DOMException('Cancelled', 'AbortError');
      const slice = audio.samples.subarray(index * size, Math.min(audio.samples.length, (index + 1) * size));
      pieces.push(new Float32Array(slice));
      await options.onSentence?.({
        index,
        total: slices,
        samples: concatFloats(pieces),
        sampleRate: audio.sampleRate,
      });
    }
    if (String(this.job) !== jobId) throw new DOMException('Cancelled', 'AbortError');
    return { samples: concatFloats(pieces), sampleRate: audio.sampleRate };
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('error', () => {
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    return worker;
  }
}

export function webSpeechSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}
