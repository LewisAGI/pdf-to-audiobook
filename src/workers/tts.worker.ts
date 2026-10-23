import { AutoTokenizer, StyleTextToSpeech2Model, env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { KOKORO_MODEL, KOKORO_REVISION } from '../lib/kokoro-model';
import { modelProgressRatio } from '../lib/model-progress';
import { speechChunks } from '../lib/speech-text';

type InMessage =
  | { type: 'generate'; jobId: string; text: string; voice: string; speed: number; resumeFrom: number }
  | { type: 'cancel'; jobId: string };

type OutMessage =
  | { type: 'progress'; jobId: string; phase: 'model' | 'speech'; ratio: number; sentence: number; total: number }
  | { type: 'sentence'; jobId: string; index: number; total: number; sampleRate: number; pcm: ArrayBuffer }
  | { type: 'done'; jobId: string; sampleRate: number }
  | { type: 'cancelled'; jobId: string }
  | { type: 'error'; jobId: string; message: string };

let engine: KokoroTTS | null = null;
let loading: Promise<KokoroTTS> | null = null;
let activeJob = '';
let cancelJob = '';

function post(message: OutMessage, transfer?: Transferable[]) {
  if (transfer) (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);
  else (self as DedicatedWorkerGlobalScope).postMessage(message);
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
    const progress_callback = (info: unknown) => {
      const progress = info as { status?: string; loaded?: number; total?: number; progress?: number };
      const ratio = modelProgressRatio(progress);
      if (progress.status === 'progress' || progress.status === 'download' || ratio > 0) {
        post({ type: 'progress', jobId, phase: 'model', ratio, sentence: 0, total: 0 });
      }
    };
    loading = Promise.all([
      StyleTextToSpeech2Model.from_pretrained(KOKORO_MODEL, {
        dtype: 'q8',
        device: 'wasm',
        revision: KOKORO_REVISION,
        progress_callback,
      }),
      AutoTokenizer.from_pretrained(KOKORO_MODEL, {
        revision: KOKORO_REVISION,
        progress_callback,
      }),
    ]).then(([model, tokenizer]) => {
      const ready = new KokoroTTS(model, tokenizer);
      engine = ready;
      return ready;
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
    const parts = speechChunks(message.text);
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
      post({ type: 'sentence', jobId: message.jobId, index, total, sampleRate, pcm: copy.buffer }, [copy.buffer]);
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
