import { concatFloats, stubSpeech, type WavData } from './audio';

export type SpeechProgress = {
  phase: 'model' | 'speech';
  ratio: number;
  sentence: number;
  total: number;
};

type WorkerIn =
  | { type: 'generate'; jobId: string; text: string; voice: string; speed: number; resumeFrom: number }
  | { type: 'cancel'; jobId: string };

type WorkerOut =
  | { type: 'progress'; jobId: string; phase: 'model' | 'speech'; ratio: number; sentence: number; total: number }
  | { type: 'sentence'; jobId: string; index: number; sampleRate: number; pcm: ArrayBuffer }
  | { type: 'done'; jobId: string; sampleRate: number }
  | { type: 'cancelled'; jobId: string }
  | { type: 'error'; jobId: string; message: string };

export function stubRequested(): boolean {
  try {
    if (localStorage.getItem('pta-tts') === 'stub') return true;
    return new URLSearchParams(location.search).get('tts') === 'stub';
  } catch {
    return false;
  }
}

export class SpeechEngine {
  private worker: Worker | null = null;
  private job = 0;

  cancel() {
    this.job += 1;
    this.worker?.postMessage({ type: 'cancel', jobId: String(this.job) } satisfies WorkerIn);
  }

  async synthesize(options: {
    text: string;
    voice: string;
    speed?: number;
    resumeFrom?: number;
    prior?: Float32Array;
    priorRate?: number;
    onProgress?: (progress: SpeechProgress) => void;
  }): Promise<WavData> {
    if (stubRequested()) return stubSpeech(options.text);
    const jobId = String(++this.job);
    const worker = this.ensure();
    const pieces: Float32Array[] = options.prior ? [options.prior] : [];
    let sampleRate = options.priorRate ?? 24000;
    const result = await new Promise<WavData>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerOut>) => {
        const message = event.data;
        if (message.jobId !== jobId) return;
        if (message.type === 'progress') options.onProgress?.(message);
        if (message.type === 'sentence') {
          sampleRate = message.sampleRate;
          pieces.push(new Float32Array(message.pcm));
          options.onProgress?.({
            phase: 'speech',
            ratio: (message.index + 1) / Math.max(1, pieces.length),
            sentence: message.index + 1,
            total: message.index + 1,
          });
        }
        if (message.type === 'done') {
          worker.removeEventListener('message', onMessage);
          resolve({ samples: concatFloats(pieces), sampleRate: message.sampleRate || sampleRate });
        }
        if (message.type === 'cancelled') {
          worker.removeEventListener('message', onMessage);
          reject(new DOMException('Cancelled', 'AbortError'));
        }
        if (message.type === 'error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.message));
        }
      };
      worker.addEventListener('message', onMessage);
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

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
    }
    return this.worker;
  }
}

export function webSpeechSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}
