import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { tone } from '../../src/lib/audio';
import { escapeFfmeta, exportMp3Zip, ffmetadata, joinForM4b, mp3EntryName } from '../../src/lib/export';
import { StorageQuotaError } from '../../src/lib/storage';
import { encodeMp3, mp3HasSync } from '../../src/lib/mp3';

describe('MP3 export', () => {
  it('encodes PCM to an MPEG frame and zips one file per chapter', async () => {
    const samples = tone(24000, 0.4, 440);
    const mp3 = encodeMp3(samples, 24000, 96);
    expect(mp3.byteLength).toBeGreaterThan(100);
    expect(mp3HasSync(mp3)).toBe(true);

    const { blob, filename } = await exportMp3Zip('Sample Book', [
      { title: 'Arrival', samples, sampleRate: 24000 },
      { title: 'Departure', samples: tone(16000, 0.3, 330), sampleRate: 16000 },
    ]);
    expect(filename.endsWith('.zip')).toBe(true);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(['01 Arrival.mp3', '02 Departure.mp3']);
    const first = await zip.files['01 Arrival.mp3']!.async('uint8array');
    expect(mp3HasSync(first)).toBe(true);
  });

  it('zero-pads names wide enough for 100 chapters and escapes metadata', () => {
    expect(mp3EntryName(0, 100, 'Arrival')).toBe('001 Arrival.mp3');
    expect(mp3EntryName(99, 100, 'End')).toBe('100 End.mp3');
    expect(mp3EntryName(1, 9, 'Arrival')).toBe('02 Arrival.mp3');
    const meta = ffmetadata([{ title: 'A=B; C#\nD', startMs: 0 }], 1);
    expect(meta).toContain(`title=${escapeFfmeta('A=B; C#\nD')}`);
    expect(meta).toContain('title=A\\=B\\; C\\#\\nD');
  });

  it('leaves a gap before the next M4B chapter and refuses a huge join', () => {
    const samples = new Float32Array(44100);
    const joined = joinForM4b([
      { title: 'A', samples, sampleRate: 44100 },
      { title: 'B', samples, sampleRate: 44100 },
    ]);
    expect(joined.chapters[1]?.startMs).toBeCloseTo(1150, 0);
    const huge = { length: 44100 * 60 * 180 } as Float32Array;
    expect(() => joinForM4b([{ title: 'Long', samples: huge, sampleRate: 44100 }])).toThrow(StorageQuotaError);
  });
});
