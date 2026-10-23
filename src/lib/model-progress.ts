export function modelProgressRatio(progress: { progress?: number; loaded?: number; total?: number }): number {
  let raw = 0;
  if (typeof progress.progress === 'number' && Number.isFinite(progress.progress)) raw = progress.progress;
  else if (progress.total) raw = (progress.loaded ?? 0) / progress.total;
  const ratio = raw > 1 ? raw / 100 : raw;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}
