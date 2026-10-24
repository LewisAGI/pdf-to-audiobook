import { describe, expect, it } from 'vitest';
import {
  MEDIA_TIMEOUT_MS,
  PlaybackTimeoutError,
  isPlaybackTimeout,
  mediaHang,
  mediaTimeoutMs,
} from '../../src/lib/media-timeout';

describe('media playback timeouts', () => {
  it('waits long enough for a slow device and then fails as a timeout', () => {
    expect(MEDIA_TIMEOUT_MS).toBe(15_000);
    expect(MEDIA_TIMEOUT_MS).toBeGreaterThan(4_000);
    const error = new PlaybackTimeoutError();
    expect(error.name).toBe('PlaybackTimeoutError');
    expect(error.name).not.toBe('AbortError');
    expect(error.message).toBe("Playback didn't start. Try again.");
    expect(isPlaybackTimeout(error)).toBe(true);
    expect(isPlaybackTimeout(new DOMException('Audio failed to load', 'AbortError'))).toBe(false);
  });

  it('uses a short deadline only in dev and test', () => {
    const read = (key: string) => (key === 'pta-media-timeout' ? '400' : null);
    expect(mediaTimeoutMs({ DEV: false, MODE: 'production' }, read)).toBe(15_000);
    expect(mediaTimeoutMs({ DEV: false, MODE: 'test' }, read)).toBe(400);
    expect(mediaTimeoutMs({ DEV: true, MODE: 'production' }, read)).toBe(400);
    expect(mediaTimeoutMs({ DEV: false, MODE: 'test' }, () => 'nope')).toBe(15_000);
  });

  it('hangs load or play only in dev and test', () => {
    const read = (key: string) => (key === 'pta-hang-media' ? 'load' : null);
    expect(mediaHang({ DEV: false, MODE: 'production' }, read)).toBeNull();
    expect(mediaHang({ DEV: false, MODE: 'test' }, read)).toBe('load');
    expect(mediaHang({ DEV: true, MODE: 'production' }, () => 'play')).toBe('play');
    expect(mediaHang({ DEV: false, MODE: 'test' }, () => 'pause')).toBeNull();
  });
});
