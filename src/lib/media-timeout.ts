export const MEDIA_TIMEOUT_MS = 15_000;

export const PLAYBACK_RETRY_MESSAGE = "Playback didn't start. Try again.";

type Env = { DEV?: boolean; MODE?: string };

export class PlaybackTimeoutError extends Error {
  constructor() {
    super(PLAYBACK_RETRY_MESSAGE);
    this.name = 'PlaybackTimeoutError';
  }
}

export function isPlaybackTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'PlaybackTimeoutError';
}

function testSeam(env: Env): boolean {
  return Boolean(env.DEV) || env.MODE === 'test';
}

function readFlag(read: (key: string) => string | null, key: string): string {
  try {
    return read(key) ?? '';
  } catch {
    return '';
  }
}

export function mediaTimeoutMs(env: Env = import.meta.env, read?: (key: string) => string | null): number {
  // import.meta.env is folded in the production build so the localStorage hook is removed.
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'test')) return MEDIA_TIMEOUT_MS;
  if (!testSeam(env)) return MEDIA_TIMEOUT_MS;
  const raw = readFlag(read ?? ((key) => localStorage.getItem(key)), 'pta-media-timeout');
  if (!raw) return MEDIA_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return MEDIA_TIMEOUT_MS;
  return value;
}

export type MediaHang = 'load' | 'play';

export function mediaHang(env: Env = import.meta.env, read?: (key: string) => string | null): MediaHang | null {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'test')) return null;
  if (!testSeam(env)) return null;
  const flag = readFlag(read ?? ((key) => localStorage.getItem(key)), 'pta-hang-media');
  if (flag === 'load' || flag === 'play') return flag;
  return null;
}
