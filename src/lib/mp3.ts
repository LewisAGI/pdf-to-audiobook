import { Mp3Encoder } from 'lamejs';
import { floatTo16, nearestRate, resampleLinear } from './audio';

export function encodeMp3(samples: Float32Array, sampleRate: number, kbps = 96): Uint8Array {
  const rate = nearestRate(sampleRate);
  const pcm = rate === sampleRate ? samples : resampleLinear(samples, sampleRate, rate);
  const encoder = new Mp3Encoder(1, rate, kbps);
  const ints = floatTo16(pcm);
  const chunks: Uint8Array[] = [];
  const block = 1152;
  for (let offset = 0; offset < ints.length; offset += block) {
    const slice = ints.subarray(offset, Math.min(ints.length, offset + block));
    const encoded = encoder.encodeBuffer(slice);
    if (encoded.length) chunks.push(Uint8Array.from(encoded));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Uint8Array.from(tail));
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

export function mp3HasSync(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 1, 256);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0xff && ((bytes[index + 1] ?? 0) & 0xe0) === 0xe0) return true;
  }
  return false;
}
