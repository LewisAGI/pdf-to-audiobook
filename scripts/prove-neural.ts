import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { KokoroTTS } from 'kokoro-js';

const voiceFile = path.resolve('node_modules/kokoro-js/voices/af_heart.bin');
try {
  await access(voiceFile);
} catch {
  const response = await fetch(
    'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin',
  );
  if (!response.ok) throw new Error(`voice download failed ${response.status}`);
  await mkdir(path.dirname(voiceFile), { recursive: true });
  await writeFile(voiceFile, Buffer.from(await response.arrayBuffer()));
}

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'q8',
  device: 'cpu',
});
const audio = await tts.generate('The council reconvened at dawn.', { voice: 'af_heart' });
const out = path.resolve('test-results/neural-proof.wav');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, Buffer.from(audio.toWav()));
console.log(`wrote ${out} samples=${audio.audio.length} rate=${audio.sampling_rate}`);
