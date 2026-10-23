import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AutoTokenizer, StyleTextToSpeech2Model } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { KOKORO_MODEL, KOKORO_REVISION } from '../src/lib/kokoro-model';

const voiceFile = path.resolve('node_modules/kokoro-js/voices/af_heart.bin');
try {
  await access(voiceFile);
} catch {
  const response = await fetch(
    `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${KOKORO_REVISION}/voices/af_heart.bin`,
  );
  if (!response.ok) throw new Error(`voice download failed ${response.status}`);
  await mkdir(path.dirname(voiceFile), { recursive: true });
  await writeFile(voiceFile, Buffer.from(await response.arrayBuffer()));
}

const [model, tokenizer] = await Promise.all([
  StyleTextToSpeech2Model.from_pretrained(KOKORO_MODEL, {
    dtype: 'q8',
    device: 'cpu',
    revision: KOKORO_REVISION,
  }),
  AutoTokenizer.from_pretrained(KOKORO_MODEL, { revision: KOKORO_REVISION }),
]);
const tts = new KokoroTTS(model, tokenizer);
const audio = await tts.generate('The council reconvened at dawn.', { voice: 'af_heart' });
const out = path.resolve('test-results/neural-proof.wav');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, Buffer.from(audio.toWav()));
console.log(`wrote ${out} samples=${audio.audio.length} rate=${audio.sampling_rate}`);
