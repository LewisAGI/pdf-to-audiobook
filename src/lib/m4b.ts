export type M4bChapter = {
  title: string;
  startMs: number;
};

export type AacFrame = {
  data: Uint8Array;
  durationSamples: number;
};

export type M4bInput = {
  frames: AacFrame[];
  sampleRate: number;
  channels: number;
  chapters: M4bChapter[];
  audioSpecificConfig?: Uint8Array;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0);
  return bytes;
}

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(value / 2 ** 32));
  view.setUint32(4, value >>> 0);
  return bytes;
}

function i16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value);
  return bytes;
}

function fourcc(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(8 + body.length), fourcc(type), body]);
}

function fullbox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, ((version & 0xff) << 24) | (flags & 0xffffff));
  return box(type, head, ...parts);
}

function zeros(length: number): Uint8Array {
  return new Uint8Array(length);
}

function matrix(): Uint8Array {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint32(16, 0x00010000);
  view.setUint32(32, 0x40000000);
  return bytes;
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function audioSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const index = AAC_RATES.indexOf(sampleRate);
  const rateIndex = index >= 0 ? index : 4;
  const value = (2 << 11) | (rateIndex << 7) | ((channels & 0x0f) << 3);
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function descriptor(tag: number, body: Uint8Array): Uint8Array {
  const size = new Uint8Array(4);
  size[0] = ((body.length >> 21) & 0x7f) | 0x80;
  size[1] = ((body.length >> 14) & 0x7f) | 0x80;
  size[2] = ((body.length >> 7) & 0x7f) | 0x80;
  size[3] = body.length & 0x7f;
  return concat([u8(tag), size, body]);
}

function esdsBox(config: Uint8Array, bitrate: number): Uint8Array {
  const specific = descriptor(0x05, config);
  const decoder = descriptor(
    0x04,
    concat([
      u8(0x40),
      u8(0x15),
      new Uint8Array([0x00, 0x18, 0x00]),
      u32(bitrate),
      u32(bitrate),
      specific,
    ]),
  );
  const sl = descriptor(0x06, u8(0x02));
  const es = descriptor(0x03, concat([u16(1), u8(0), decoder, sl]));
  return fullbox('esds', 0, 0, es);
}

export function utf8Clip(text: string, maxBytes: number): Uint8Array {
  const bytes = textEncoder.encode(text);
  if (bytes.byteLength <= maxBytes) return bytes;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.slice(0, end);
}

export function buildChpl(chapters: M4bChapter[]): Uint8Array {
  const limited = chapters.slice(0, 255);
  const body: Uint8Array[] = [u8(1), new Uint8Array([0, 0, 0]), u32(0), u8(limited.length)];
  for (const chapter of limited) {
    const title = utf8Clip(chapter.title, 255);
    const ticks = Math.max(0, Math.round(chapter.startMs * 10000));
    body.push(u64(ticks), u8(title.length), title);
  }
  return box('chpl', ...body);
}

const TEXT_SAMPLE_ENTRY = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0d, 0x66,
  0x74, 0x61, 0x62, 0, 1, 0, 1, 0,
]);

const ENCD = concat([u32(12), fourcc('encd'), new Uint8Array([0x00, 0x00, 0x01, 0x00])]);

function textSample(title: string): Uint8Array {
  const text = utf8Clip(title, 65535);
  return concat([u16(text.length), text, ENCD]);
}

function chapterSpans(chapters: M4bChapter[], durationMs: number): { title: string; durationMs: number }[] {
  const list = chapters.length ? chapters : [{ title: 'Chapter 1', startMs: 0 }];
  const safeDuration = Math.max(1, durationMs);
  return list.map((chapter, index) => {
    const start = Math.max(0, Math.min(safeDuration, Math.round(chapter.startMs)));
    const nextStart = index + 1 < list.length ? Math.round(list[index + 1]!.startMs) : safeDuration;
    const end = Math.max(start + 1, Math.min(safeDuration, Math.max(nextStart, start + 1)));
    return { title: chapter.title || `Chapter ${index + 1}`, durationMs: Math.max(1, end - start) };
  });
}

function gmhdBox(): Uint8Array {
  const gmin = concat([
    u32(0x18),
    fourcc('gmin'),
    u32(0),
    u16(0x40),
    u16(0x8000),
    u16(0x8000),
    u16(0x8000),
    u16(0),
    u16(0),
  ]);
  const text = Uint8Array.from([
    0x00, 0x00, 0x00, 0x2c, 0x74, 0x65, 0x78, 0x74, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  return box('gmhd', gmin, text);
}

function chapterTrack(spans: { title: string; durationMs: number }[], now: number, textOffset: number): { trak: Uint8Array; samples: Uint8Array } {
  const samples = spans.map((span) => textSample(span.title));
  const payload = concat(samples);
  const duration = spans.reduce((sum, span) => sum + span.durationMs, 0);
  const stsd = fullbox('stsd', 0, 0, u32(1), box('text', TEXT_SAMPLE_ENTRY));
  const stts = fullbox('stts', 0, 0, u32(spans.length), ...spans.flatMap((span) => [u32(1), u32(span.durationMs)]));
  const stsc = fullbox('stsc', 0, 0, u32(1), u32(1), u32(spans.length), u32(1));
  const stsz = fullbox('stsz', 0, 0, u32(0), u32(spans.length), ...samples.map((sample) => u32(sample.length)));
  const stco = fullbox('stco', 0, 0, u32(1), u32(textOffset));
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
  const dinf = box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
  const minf = box('minf', gmhdBox(), dinf, stbl);
  const mdhd = fullbox('mdhd', 0, 0, u32(now), u32(now), u32(1000), u32(duration), u16(0x55c4), u16(0));
  const hdlr = fullbox('hdlr', 0, 0, u32(0), fourcc('text'), zeros(12), textEncoder.encode('TextHandler\0'));
  const mdia = box('mdia', mdhd, hdlr, minf);
  const tkhd = fullbox(
    'tkhd',
    0,
    0x7,
    u32(now),
    u32(now),
    u32(2),
    u32(0),
    u32(duration),
    zeros(8),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    matrix(),
    u32(0),
    u32(0),
  );
  return { trak: box('trak', tkhd, mdia), samples: payload };
}

export function buildM4b(input: M4bInput): Uint8Array {
  const channels = input.channels || 1;
  const sampleRate = input.sampleRate;
  const frames = input.frames.length ? input.frames : [{ data: new Uint8Array([0]), durationSamples: 1024 }];
  const config = input.audioSpecificConfig ?? audioSpecificConfig(sampleRate, channels);
  const totalSamples = frames.reduce((sum, frame) => sum + frame.durationSamples, 0);
  const durationMs = Math.round((totalSamples / sampleRate) * 1000);
  const now = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(Date.UTC(1904, 0, 1) / 1000));
  const bitrate = 64000;

  const ftyp = box('ftyp', fourcc('M4B '), u32(0), fourcc('M4B '), fourcc('isom'), fourcc('iso2'), fourcc('mp41'));
  const audioPayload = concat(frames.map((frame) => frame.data));
  const mdatDataOffset = ftyp.length + 8;
  const spans = chapterSpans(input.chapters, durationMs);
  const textPayload = concat(spans.map((span) => textSample(span.title)));
  const mdat = box('mdat', audioPayload, textPayload);
  const textOffset = mdatDataOffset + audioPayload.length;

  const sameDelta = frames.every((frame) => frame.durationSamples === frames[0]!.durationSamples);
  const stts = sameDelta
    ? fullbox('stts', 0, 0, u32(1), u32(frames.length), u32(frames[0]!.durationSamples))
    : fullbox(
        'stts',
        0,
        0,
        u32(frames.length),
        ...frames.flatMap((frame) => [u32(1), u32(frame.durationSamples)]),
      );
  const stsc = fullbox('stsc', 0, 0, u32(1), u32(1), u32(frames.length), u32(1));
  const stsz = fullbox(
    'stsz',
    0,
    0,
    u32(0),
    u32(frames.length),
    ...frames.map((frame) => u32(frame.data.length)),
  );
  const stco = fullbox('stco', 0, 0, u32(1), u32(mdatDataOffset));
  const mp4a = box(
    'mp4a',
    zeros(6),
    u16(1),
    u16(0),
    u16(0),
    u32(0),
    u16(channels),
    u16(16),
    u16(0),
    u16(0),
    u32(sampleRate << 16),
    esdsBox(config, bitrate),
  );
  const stsd = fullbox('stsd', 0, 0, u32(1), mp4a);
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
  const smhd = fullbox('smhd', 0, 0, i16(0), u16(0));
  const url = fullbox('url ', 0, 1);
  const dref = fullbox('dref', 0, 0, u32(1), url);
  const dinf = box('dinf', dref);
  const minf = box('minf', smhd, dinf, stbl);
  const mdhd = fullbox(
    'mdhd',
    0,
    0,
    u32(now),
    u32(now),
    u32(sampleRate),
    u32(totalSamples),
    u16(0x55c4),
    u16(0),
  );
  const hdlr = fullbox('hdlr', 0, 0, u32(0), fourcc('soun'), zeros(12), textEncoder.encode('SoundHandler\0'));
  const mdia = box('mdia', mdhd, hdlr, minf);
  const tkhd = fullbox(
    'tkhd',
    0,
    0x7,
    u32(now),
    u32(now),
    u32(1),
    u32(0),
    u32(durationMs),
    zeros(8),
    u16(0),
    u16(0),
    u16(0x0100),
    u16(0),
    matrix(),
    u32(0),
    u32(0),
  );
  const tref = box('tref', box('chap', u32(2)));
  const trak = box('trak', tkhd, tref, mdia);
  const chapters = chapterTrack(spans, now, textOffset);
  const mvhd = fullbox(
    'mvhd',
    0,
    0,
    u32(now),
    u32(now),
    u32(1000),
    u32(durationMs),
    u32(0x00010000),
    u16(0x0100),
    zeros(10),
    matrix(),
    zeros(24),
    u32(3),
  );
  const marked = input.chapters.length ? input.chapters : [{ title: 'Chapter 1', startMs: 0 }];
  const udta = box('udta', buildChpl(marked));
  const moov = box('moov', mvhd, trak, chapters.trak, udta);
  return concat([ftyp, mdat, moov]);
}

export type Mp4Box = {
  type: string;
  start: number;
  size: number;
  header: number;
};

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'udta', 'tref']);

export function walkBoxes(bytes: Uint8Array, start = 0, end = bytes.length): Mp4Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    let header = 8;
    if (size === 1 && offset + 16 <= end) {
      const high = view.getUint32(offset + 8);
      const low = view.getUint32(offset + 12);
      size = high * 2 ** 32 + low;
      header = 16;
    }
    if (size < header) break;
    boxes.push({ type, start: offset, size, header });
    const next = size === 0 ? end : offset + size;
    if (CONTAINERS.has(type)) boxes.push(...walkBoxes(bytes, offset + header, Math.min(next, end)));
    if (size === 0) break;
    offset = next;
  }
  return boxes;
}

export type ParsedChapter = {
  title: string;
  startMs: number;
};

export function chplTicks(bytes: Uint8Array, index: number): number {
  const chpl = walkBoxes(bytes).find((entry) => entry.type === 'chpl');
  if (!chpl) throw new Error('missing chpl');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = chpl.start + chpl.header + 9;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    const ticks = high * 2 ** 32 + low;
    if (cursor === index) return ticks;
    offset += 8;
    const length = bytes[offset] ?? 0;
    offset += 1 + length;
  }
  throw new Error('chapter missing');
}

export function readChapterTrack(bytes: Uint8Array): { title: string }[] {
  const traks = walkBoxes(bytes).filter((entry) => entry.type === 'trak');
  for (const trak of traks) {
    const slice = bytes.subarray(trak.start, Math.min(bytes.length, trak.start + trak.size));
    const inner = walkBoxes(slice);
    const hdlr = inner.find((entry) => entry.type === 'hdlr');
    if (!hdlr) continue;
    const handlerAt = hdlr.start + hdlr.header + 8;
    const handler = String.fromCharCode(
      slice[handlerAt] ?? 0,
      slice[handlerAt + 1] ?? 0,
      slice[handlerAt + 2] ?? 0,
      slice[handlerAt + 3] ?? 0,
    );
    if (handler !== 'text') continue;
    const stsz = inner.find((entry) => entry.type === 'stsz');
    const stco = inner.find((entry) => entry.type === 'stco');
    if (!stsz || !stco) continue;
    const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
    const file = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sampleSize = view.getUint32(stsz.start + stsz.header + 4);
    const count = view.getUint32(stsz.start + stsz.header + 8);
    const sizes: number[] = [];
    for (let index = 0; index < count; index += 1) {
      sizes.push(sampleSize || view.getUint32(stsz.start + stsz.header + 12 + index * 4));
    }
    let cursor = view.getUint32(stco.start + stco.header + 8);
    const titles: { title: string }[] = [];
    for (const size of sizes) {
      if (cursor + 2 > bytes.length) break;
      const length = file.getUint16(cursor);
      titles.push({ title: textDecoder.decode(bytes.subarray(cursor + 2, cursor + 2 + Math.min(length, size))) });
      cursor += size;
    }
    return titles;
  }
  return [];
}

export function readChpl(bytes: Uint8Array): ParsedChapter[] {
  const chpl = walkBoxes(bytes).find((entry) => entry.type === 'chpl');
  if (!chpl) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = chpl.start + chpl.header;
  const version = bytes[offset] ?? 0;
  if (version !== 0 && version !== 1) throw new Error(`Unexpected chpl version ${version}`);
  offset += 4;
  offset += 4;
  const count = bytes[offset] ?? 0;
  offset += 1;
  const chapters: ParsedChapter[] = [];
  for (let index = 0; index < count; index += 1) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    const ticks = high * 2 ** 32 + low;
    offset += 8;
    const length = bytes[offset] ?? 0;
    offset += 1;
    const title = textDecoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    chapters.push({ title, startMs: ticks / 10000 });
  }
  return chapters;
}
