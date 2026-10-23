import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.22;
  const set = (x, y, r, g, b, a) => {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
    raw[i + 3] = a;
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      const outside = dx < radius && dy < radius && (radius - dx) ** 2 + (radius - dy) ** 2 > radius * radius;
      if (outside) {
        set(x, y, 0, 0, 0, 0);
        continue;
      }
      const nx = x / size;
      const ny = y / size;
      const page = nx > 0.28 && nx < 0.72 && ny > 0.22 && ny < 0.78;
      const spine = nx > 0.28 && nx < 0.36 && ny > 0.22 && ny < 0.78;
      if (spine) set(x, y, 243, 239, 231, 255);
      else if (page) set(x, y, 243, 239, 231, 230);
      else set(x, y, 31, 77, 58, 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(path.join(root, 'public/icons'), { recursive: true });
writeFileSync(path.join(root, 'public/icons/icon-192.png'), png(192));
writeFileSync(path.join(root, 'public/icons/icon-512.png'), png(512));
console.log('icons written');
