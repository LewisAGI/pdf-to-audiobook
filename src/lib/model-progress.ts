export type ModelFileProgress = { loaded: number; total: number };

export type ModelProgressEvent = {
  status?: string;
  file?: string;
  name?: string;
  loaded?: number;
  total?: number;
  progress?: number;
};

export function modelProgressRatio(progress: { progress?: number; loaded?: number; total?: number }): number {
  let raw = 0;
  if (typeof progress.progress === 'number' && Number.isFinite(progress.progress)) raw = progress.progress;
  else if (progress.total) raw = (progress.loaded ?? 0) / progress.total;
  const ratio = raw > 1 ? raw / 100 : raw;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

export function aggregateModelProgress(files: Map<string, ModelFileProgress>, event: ModelProgressEvent): number {
  const id = event.file || event.name || '';
  const status = event.status ?? '';
  if (id && (status === 'progress' || status === 'download' || status === 'done' || status === 'initiate')) {
    const total = event.total && event.total > 0 ? event.total : 1;
    const ratio = status === 'done' ? 1 : modelProgressRatio({ ...event, total });
    const loaded = Math.min(total, Math.max(0, ratio * total));
    const previous = files.get(id);
    files.set(id, {
      loaded: status === 'initiate' && previous ? previous.loaded : loaded,
      total: event.total && event.total > 0 ? event.total : (previous?.total ?? total),
    });
  }
  let loaded = 0;
  let total = 0;
  for (const file of files.values()) {
    loaded += file.loaded;
    total += file.total;
  }
  if (total <= 0) return modelProgressRatio(event);
  return Math.max(0, Math.min(1, loaded / total));
}
