export type WavData = {
  samples: Float32Array;
  sampleRate: number;
};

export function floatTo16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    out[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return out;
}

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const scale = (input.length - 1) / Math.max(1, length - 1);
  for (let index = 0; index < length; index += 1) {
    const position = index * scale;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const mix = position - left;
    out[index] = (input[left] ?? 0) * (1 - mix) + (input[right] ?? 0) * mix;
  }
  return out;
}

export function concatFloats(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function silence(sampleRate: number, seconds: number): Float32Array {
  return new Float32Array(Math.max(0, Math.round(sampleRate * seconds)));
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const pcm = floatTo16(samples);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  let offset = 44;
  for (let index = 0; index < pcm.length; index += 1) {
    view.setInt16(offset, pcm[index] ?? 0, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function decodeWav(bytes: Uint8Array): WavData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44) throw new Error('Invalid WAV');
  const sampleRate = view.getUint32(24, true);
  let offset = 12;
  let dataOffset = 44;
  let dataLength = bytes.length - 44;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const count = Math.floor(dataLength / 2);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 0x8000;
  }
  return { samples, sampleRate };
}

export function tone(sampleRate: number, seconds: number, frequency = 220): Float32Array {
  const length = Math.floor(sampleRate * seconds);
  const out = new Float32Array(length);
  const fade = Math.min(length / 8, sampleRate * 0.05);
  for (let index = 0; index < length; index += 1) {
    const envelope = index < fade ? index / fade : index > length - fade ? (length - index) / fade : 1;
    out[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.18 * envelope;
  }
  return out;
}

export function stubSpeech(text: string): WavData {
  const seconds = 12;
  const sampleRate = 16000;
  return { samples: tone(sampleRate, seconds, text.length % 2 === 0 ? 196 : 247), sampleRate };
}

const LAME_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

export function nearestRate(sampleRate: number, rates = LAME_RATES): number {
  return rates.reduce((best, rate) => (Math.abs(rate - sampleRate) < Math.abs(best - sampleRate) ? rate : best));
}
