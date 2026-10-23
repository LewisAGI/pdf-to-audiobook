import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';

type InMessage =
  | { type: 'generate'; jobId: string; text: string; voice: string; speed: number; resumeFrom: number }
  | { type: 'cancel'; jobId: string };

type OutMessage =
  | { type: 'progress'; jobId: string; phase: 'model' | 'speech'; ratio: number; sentence: number; total: number }
  | { type: 'sentence'; jobId: string; index: number; sampleRate: number; pcm: ArrayBuffer }
  | { type: 'done'; jobId: string; sampleRate: number }
  | { type: 'cancelled'; jobId: string }
  | { type: 'error'; jobId: string; message: string };

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let engine: KokoroTTS | null = null;
let loading: Promise<KokoroTTS> | null = null;
let activeJob = '';
let cancelJob = '';

function post(message: OutMessage, transfer?: Transferable[]) {
  if (transfer) (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);
  else (self as DedicatedWorkerGlobalScope).postMessage(message);
}

function chunks(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const source = sentences.length ? sentences : [text.trim()].filter(Boolean);
  const parts: string[] = [];
  for (const sentence of source) {
    if (sentence.length <= 280) {
      parts.push(sentence);
      continue;
    }
    let current = '';
    for (const bit of sentence.split(/,\s+/)) {
      const next = current ? `${current}, ${bit}` : bit;
      if (next.length > 280 && current) {
        parts.push(current);
        current = bit;
      } else current = next;
    }
    if (current) parts.push(current);
  }
  return parts;
}

async function loadModel(jobId: string): Promise<KokoroTTS> {
  if (engine) return engine;
  if (!loading) {
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number } };
    onnx.wasm = { ...(onnx.wasm ?? {}) };
    onnx.wasm.wasmPaths = new URL('/onnx/', self.location.origin).href;
    onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator.hardwareConcurrency || 1) : 1;
    loading = KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info) => {
        const progress = info as { status?: string; loaded?: number; total?: number; progress?: number };
        const ratio =
          typeof progress.progress === 'number'
            ? progress.progress
            : progress.total
              ? (progress.loaded ?? 0) / progress.total
              : 0;
        if (progress.status === 'progress' || progress.status === 'download' || ratio > 0) {
          post({ type: 'progress', jobId, phase: 'model', ratio: Math.max(0, Math.min(1, ratio)), sentence: 0, total: 0 });
        }
      },
    }).then((model) => {
      engine = model;
      return model;
    });
  }
  return loading;
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelJob = message.jobId;
    return;
  }
  activeJob = message.jobId;
  void run(message);
};

async function run(message: Extract<InMessage, { type: 'generate' }>) {
  try {
    const model = await loadModel(message.jobId);
    if (cancelJob === message.jobId || activeJob !== message.jobId) {
      post({ type: 'cancelled', jobId: message.jobId });
      return;
    }
    const parts = chunks(message.text);
    const total = parts.length || 1;
    let sampleRate = 24000;
    for (let index = message.resumeFrom; index < parts.length; index += 1) {
      if (cancelJob === message.jobId || activeJob !== message.jobId) {
        post({ type: 'cancelled', jobId: message.jobId });
        return;
      }
      post({
        type: 'progress',
        jobId: message.jobId,
        phase: 'speech',
        ratio: index / total,
        sentence: index,
        total,
      });
      const audio = await model.generate(parts[index] ?? '', {
        voice: message.voice as 'af_heart',
        speed: message.speed || 1,
      });
      sampleRate = audio.sampling_rate || 24000;
      const copy = new Float32Array(audio.audio);
      post(
        { type: 'sentence', jobId: message.jobId, index, sampleRate, pcm: copy.buffer },
        [copy.buffer],
      );
    }
    post({ type: 'done', jobId: message.jobId, sampleRate });
  } catch (error) {
    post({
      type: 'error',
      jobId: message.jobId,
      message: error instanceof Error ? error.message : 'Neural voice failed',
    });
  }
}
