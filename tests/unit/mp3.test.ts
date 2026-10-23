import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { tone } from '../../src/lib/audio';
import { exportMp3Zip } from '../../src/lib/export';
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
});
