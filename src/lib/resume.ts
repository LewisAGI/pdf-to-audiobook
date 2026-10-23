export type ResumePoint = {
  chapterIndex: number;
  time: number;
};

export function clampTime(time: number, duration: number | null): number {
  if (!Number.isFinite(time) || time < 0) return 0;
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return time;
  return Math.min(time, Math.max(0, duration - 0.05));
}

export function sanitizeResume(
  saved: ResumePoint | null,
  chapters: { skipped: boolean }[],
  duration: number | null,
): ResumePoint {
  if (!chapters.length) return { chapterIndex: 0, time: 0 };
  const requested = saved && Number.isFinite(saved.chapterIndex) ? Math.round(saved.chapterIndex) : 0;
  const clamped = Math.max(0, Math.min(chapters.length - 1, requested));
  let index = clamped;
  let moved = requested !== clamped || Boolean(chapters[clamped]?.skipped);
  if (chapters[index]?.skipped) {
    const forward = chapters.findIndex((chapter, cursor) => cursor > index && !chapter.skipped);
    if (forward >= 0) index = forward;
    else {
      let back = -1;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (!chapters[cursor]?.skipped) {
          back = cursor;
          break;
        }
      }
      index = back >= 0 ? back : clamped;
    }
    moved = true;
  }
  return {
    chapterIndex: index,
    time: moved ? 0 : clampTime(saved?.time ?? 0, duration),
  };
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remain = whole % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(remain).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}
