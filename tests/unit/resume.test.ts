import { describe, expect, it } from 'vitest';
import { clampTime, formatClock, sanitizeResume } from '../../src/lib/resume';

const chapters = [{ skipped: false }, { skipped: false }, { skipped: true }, { skipped: false }];

describe('resume', () => {
  it('restores a saved chapter and clamps time into the audio', () => {
    expect(sanitizeResume({ chapterIndex: 1, time: 42 }, chapters, 80)).toEqual({ chapterIndex: 1, time: 42 });
    expect(sanitizeResume({ chapterIndex: 1, time: 90 }, chapters, 80).time).toBeCloseTo(79.95);
    expect(clampTime(-4, 10)).toBe(0);
    expect(clampTime(3, null)).toBe(3);
  });

  it('moves off a skipped chapter and drops a stale index', () => {
    expect(sanitizeResume({ chapterIndex: 2, time: 15 }, chapters, 30)).toEqual({ chapterIndex: 3, time: 0 });
    expect(sanitizeResume({ chapterIndex: 9, time: 15 }, chapters, 30)).toEqual({ chapterIndex: 3, time: 0 });
    expect(sanitizeResume(null, [], null)).toEqual({ chapterIndex: 0, time: 0 });
  });

  it('formats clocks without dropping the minute field', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3661)).toBe('1:01:01');
  });
});
