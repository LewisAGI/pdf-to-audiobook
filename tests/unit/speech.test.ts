import { describe, expect, it } from 'vitest';
import { modelProgressRatio } from '../../src/lib/model-progress';
import { speechChunks } from '../../src/lib/speech-text';
import { stubAllowed } from '../../src/lib/tts';

describe('speech helpers', () => {
  it('treats transformer progress percents as a fraction of one', () => {
    expect(modelProgressRatio({ progress: 37 })).toBeCloseTo(0.37);
    expect(modelProgressRatio({ progress: 100 })).toBe(1);
    expect(modelProgressRatio({ loaded: 25, total: 100 })).toBeCloseTo(0.25);
  });

  it('splits a long sentence instead of emitting it whole', () => {
    const sentence = Array.from({ length: 70 }, (_, index) => `word${index}`).join(' ');
    expect(sentence.length).toBeGreaterThan(280);
    const parts = speechChunks(sentence);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 280)).toBe(true);
    expect(parts.join(' ')).toContain('word0');
    expect(parts.join(' ')).toContain('word69');
    const bare = 'A'.repeat(600);
    const broken = speechChunks(bare);
    expect(broken.length).toBeGreaterThan(1);
    expect(broken.every((part) => [...part].length <= 280)).toBe(true);
    expect(broken.join('')).toBe(bare);
  });

  it('allows the stub voice only in dev and test builds', () => {
    expect(stubAllowed({ DEV: false, MODE: 'production' })).toBe(false);
    expect(stubAllowed({ DEV: false, MODE: 'test' })).toBe(true);
    expect(stubAllowed({ DEV: true, MODE: 'production' })).toBe(true);
  });
});
