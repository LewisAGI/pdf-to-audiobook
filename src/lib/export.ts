import JSZip from 'jszip';
import { concatFloats, decodeWav, encodeWav, silence } from './audio';
import { encodeAac } from './aac';
import { buildM4b, type M4bChapter } from './m4b';
import { encodeMp3 } from './mp3';
import { StorageQuotaError } from './storage';

export type ExportChapter = {
  title: string;
  samples: Float32Array;
  sampleRate: number;
};

export function safeName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim();
  return (cleaned || 'chapter').slice(0, 60);
}

export function mp3EntryName(index: number, count: number, title: string): string {
  const width = Math.max(2, String(Math.max(count, 1)).length);
  return `${String(index + 1).padStart(width, '0')} ${safeName(title)}.mp3`;
}

export function forceFfmpeg(): boolean {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'test')) return false;
  try {
    if (localStorage.getItem('pta-encoder') === 'ffmpeg') return true;
    return new URLSearchParams(location.search).get('encoder') === 'ffmpeg';
  } catch {
    return false;
  }
}

export async function exportMp3Zip(title: string, chapters: ExportChapter[]): Promise<{ blob: Blob; filename: string }> {
  const zip = new JSZip();
  chapters.forEach((chapter, index) => {
    const mp3 = encodeMp3(chapter.samples, chapter.sampleRate);
    zip.file(mp3EntryName(index, chapters.length, chapter.title), mp3);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, filename: `${safeName(title)}.zip` };
}

const MAX_JOIN_BYTES = 1_500_000_000;

export function joinForM4b(chapters: ExportChapter[]): { samples: Float32Array; sampleRate: number; chapters: M4bChapter[] } {
  const sampleRate = 44100;
  let estimate = 0;
  chapters.forEach((chapter, index) => {
    const rate = chapter.sampleRate || sampleRate;
    estimate += Math.max(1, Math.round((chapter.samples.length * sampleRate) / rate)) * 4;
    if (index < chapters.length - 1) estimate += Math.round(sampleRate * 0.15) * 4;
    if (estimate > MAX_JOIN_BYTES) throw new StorageQuotaError();
  });
  const pieces: Float32Array[] = [];
  const markers: M4bChapter[] = [];
  let cursor = 0;
  chapters.forEach((chapter, index) => {
    const rate = chapter.sampleRate;
    const scaled =
      rate === sampleRate
        ? chapter.samples
        : Float32Array.from({ length: Math.max(1, Math.round((chapter.samples.length * sampleRate) / rate)) }, (_, i) => {
            const position = (i * rate) / sampleRate;
            const left = Math.floor(position);
            const right = Math.min(chapter.samples.length - 1, left + 1);
            const mix = position - left;
            return (chapter.samples[left] ?? 0) * (1 - mix) + (chapter.samples[right] ?? 0) * mix;
          });
    markers.push({ title: chapter.title || `Chapter ${index + 1}`, startMs: (cursor / sampleRate) * 1000 });
    pieces.push(scaled);
    cursor += scaled.length;
    if (index < chapters.length - 1) {
      const gap = silence(sampleRate, 0.15);
      pieces.push(gap);
      cursor += gap.length;
    }
  });
  return { samples: concatFloats(pieces), sampleRate, chapters: markers };
}

export async function exportM4b(title: string, chapters: ExportChapter[]): Promise<{ blob: Blob; filename: string }> {
  const joined = joinForM4b(chapters);
  const encoded = forceFfmpeg() ? null : await encodeAac(joined.samples, joined.sampleRate);
  if (!encoded) {
    const ffmpeg = await encodeWithFfmpeg(joined.samples, joined.sampleRate, joined.chapters);
    return { blob: bytesToBlob(ffmpeg, 'audio/mp4'), filename: `${safeName(title)}.m4b` };
  }
  const bytes = buildM4b({
    frames: encoded.frames,
    sampleRate: encoded.sampleRate,
    channels: 1,
    chapters: joined.chapters,
    audioSpecificConfig: encoded.config,
  });
  return { blob: bytesToBlob(bytes, 'audio/mp4'), filename: `${safeName(title)}.m4b` };
}

async function encodeWithFfmpeg(samples: Float32Array, sampleRate: number, chapters: M4bChapter[]): Promise<Uint8Array> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const coreVersion = '0.12.10';
  const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${coreVersion}/dist/esm`;
  const worker = (await import('@ffmpeg/ffmpeg/worker?url')).default as string;
  const toBlob = async (url: string, type: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load audio encoder');
    return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type }));
  };
  await ffmpeg.load({
    classWorkerURL: worker,
    coreURL: await toBlob(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlob(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  const wav = encodeWav(samples, sampleRate);
  const meta = ffmetadata(chapters, samples.length / sampleRate);
  await ffmpeg.writeFile('in.wav', wav);
  await ffmpeg.writeFile('chapters.txt', new TextEncoder().encode(meta));
  const code = await ffmpeg.exec([
    '-i',
    'in.wav',
    '-i',
    'chapters.txt',
    '-map_metadata',
    '1',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    'out.m4b',
  ]);
  if (code !== 0) throw new Error('M4B encoder failed');
  const out = await ffmpeg.readFile('out.m4b');
  return out instanceof Uint8Array ? out : new Uint8Array(out as unknown as ArrayBuffer);
}

export function escapeFfmeta(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[=;#]/g, (char) => `\\${char}`);
}

export function ffmetadata(chapters: M4bChapter[], durationSeconds: number): string {
  const lines = [';FFMETADATA1'];
  chapters.forEach((chapter, index) => {
    const start = Math.round(chapter.startMs);
    const endMs =
      index + 1 < chapters.length ? Math.round(chapters[index + 1]!.startMs) : Math.round(durationSeconds * 1000);
    lines.push(
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${start}`,
      `END=${Math.max(start + 1, endMs)}`,
      `title=${escapeFfmeta(chapter.title)}`,
    );
  });
  return lines.join('\n');
}

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  return encodeWav(samples, sampleRate);
}

export { decodeWav };
