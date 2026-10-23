import { resampleLinear } from './audio';
import { audioSpecificConfig, type AacFrame } from './m4b';

export type AacEncode = {
  frames: AacFrame[];
  config: Uint8Array;
  sampleRate: number;
};

const RATES = [48000, 44100, 24000, 22050, 16000];

function copyBuffer(source: AllowSharedBufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  const view = source as ArrayBufferView;
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy;
}

export async function encodeAac(samples: Float32Array, sampleRate: number): Promise<AacEncode | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const rate = RATES.includes(sampleRate) ? sampleRate : 44100;
  const pcm = rate === sampleRate ? samples : resampleLinear(samples, sampleRate, rate);
  let supported = false;
  try {
    const check = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: rate,
      numberOfChannels: 1,
      bitrate: 64000,
    });
    supported = Boolean(check.supported);
  } catch {
    supported = false;
  }
  if (!supported) return null;

  const frames: AacFrame[] = [];
  let config: Uint8Array | undefined;
  let failed: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const durationSamples = Math.max(1, Math.round(((chunk.duration ?? 0) / 1_000_000) * rate));
      frames.push({ data, durationSamples });
      const description = meta?.decoderConfig?.description;
      if (description && !config) config = copyBuffer(description);
    },
    error: (error) => {
      failed = error;
    },
  });
  encoder.configure({
    codec: 'mp4a.40.2',
    sampleRate: rate,
    numberOfChannels: 1,
    bitrate: 64000,
  });
  const frameSize = 1024;
  for (let offset = 0; offset < pcm.length; offset += frameSize) {
    const slice = pcm.subarray(offset, Math.min(pcm.length, offset + frameSize));
    const padded = new Float32Array(frameSize);
    padded.set(slice);
    const audio = new AudioData({
      format: 'f32-planar',
      sampleRate: rate,
      numberOfFrames: frameSize,
      numberOfChannels: 1,
      timestamp: Math.round((offset / rate) * 1_000_000),
      data: padded,
    });
    encoder.encode(audio);
    audio.close();
    if (failed) break;
  }
  if (failed) {
    try {
      encoder.close();
    } catch {
      /* already failed */
    }
    return null;
  }
  await encoder.flush();
  encoder.close();
  if (!frames.length) return null;
  return { frames, config: config ?? audioSpecificConfig(rate, 1), sampleRate: rate };
}
