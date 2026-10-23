import { describe, expect, it } from 'vitest';
import { audioSpecificConfig, buildM4b, readChpl, walkBoxes } from '../../src/lib/m4b';

describe('M4B chapter atoms', () => {
  it('writes a Nero chpl atom with titles and start times', () => {
    const bytes = buildM4b({
      sampleRate: 44100,
      channels: 1,
      audioSpecificConfig: audioSpecificConfig(44100, 1),
      frames: [
        { data: Uint8Array.from([0x21, 0x10, 0x04, 0x60]), durationSamples: 1024 },
        { data: Uint8Array.from([0x21, 0x10, 0x04, 0x61]), durationSamples: 1024 },
        { data: Uint8Array.from([0x21, 0x10, 0x04, 0x62]), durationSamples: 1024 },
      ],
      chapters: [
        { title: 'Arrival', startMs: 0 },
        { title: 'Départure', startMs: 1500 },
      ],
    });
    const types = walkBoxes(bytes).map((box) => box.type);
    expect(types).toContain('ftyp');
    expect(types).toContain('mdat');
    expect(types).toContain('moov');
    expect(types).toContain('chpl');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('M4B ');
    expect(readChpl(bytes)).toEqual([
      { title: 'Arrival', startMs: 0 },
      { title: 'Départure', startMs: 1500 },
    ]);
    const mdat = walkBoxes(bytes).find((box) => box.type === 'mdat');
    expect(mdat && mdat.size).toBeGreaterThan(8);
  });

  it('builds a known AAC-LC configuration', () => {
    expect([...audioSpecificConfig(44100, 2)]).toEqual([0x12, 0x10]);
    expect([...audioSpecificConfig(24000, 1)]).toEqual([0x13, 0x08]);
  });
});
