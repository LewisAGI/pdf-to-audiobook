import type { Paragraph } from './clean';

export type OutlineItem = {
  title: string;
  page: number;
  y: number | null;
  level: number;
};

export type ChapterDraft = {
  title: string;
  text: string;
  pageStart: number;
  pageEnd: number;
};

export type Chapter = {
  id: string;
  title: string;
  text: string;
  summary: string;
  summaryKind: '' | 'extractive' | 'llm';
  mode: 'full' | 'summary';
  skipped: boolean;
  pageStart: number;
  pageEnd: number;
};

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function titleFrom(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  const words = sentence.split(/\s+/).slice(0, 8).join(' ');
  const clipped = words.length > 48 ? `${words.slice(0, 47).trimEnd()}…` : words;
  return clipped.replace(/[.!?…]+$/g, '').trim() || 'Reading';
}

function paragraphText(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function startsAtOrAfter(paragraph: Paragraph, item: OutlineItem): boolean {
  if (paragraph.page > item.page) return true;
  if (paragraph.page < item.page) return false;
  if (item.y == null) return true;
  return paragraph.y + 1 >= item.y;
}

export function selectOutline(outline: OutlineItem[]): OutlineItem[] | null {
  const items = outline
    .filter((item) => item.title.trim() && item.page >= 1)
    .map((item) => ({ ...item, title: item.title.replace(/\s+/g, ' ').trim() }));
  if (items.length < 2) return null;
  const levels = [...new Set(items.map((item) => item.level))].sort((a, b) => a - b);
  for (const level of levels) {
    const atLevel = items
      .filter((item) => item.level === level)
      .sort((a, b) => a.page - b.page || (a.y ?? 0) - (b.y ?? 0));
    if (atLevel.length >= 2) return atLevel;
  }
  return null;
}

export function detectFromOutline(paragraphs: Paragraph[], outline: OutlineItem[]): ChapterDraft[] | null {
  const items = selectOutline(outline);
  if (!items) return null;
  const first = items[0]!;
  const leading = paragraphs.filter((paragraph) => !startsAtOrAfter(paragraph, first));
  const buckets = items.map(() => [] as Paragraph[]);
  for (const paragraph of paragraphs) {
    if (!startsAtOrAfter(paragraph, first)) continue;
    let index = 0;
    for (let cursor = 0; cursor < items.length; cursor += 1) {
      if (startsAtOrAfter(paragraph, items[cursor]!)) index = cursor;
    }
    buckets[index]!.push(paragraph);
  }
  if (leading.length && wordCount(paragraphText(leading)) >= 40) {
    buckets.unshift(leading);
    items.unshift({
      title: titleFrom(paragraphText(leading)),
      page: leading[0]!.page,
      y: leading[0]!.y,
      level: first.level,
    });
  } else if (leading.length) {
    buckets[0] = [...leading, ...(buckets[0] ?? [])];
  }
  const drafts: ChapterDraft[] = [];
  items.forEach((item, index) => {
    const group = buckets[index] ?? [];
    const text = paragraphText(group);
    if (!text) return;
    drafts.push({
      title: item.title,
      text,
      pageStart: group[0]?.page ?? item.page,
      pageEnd: group[group.length - 1]?.page ?? item.page,
    });
  });
  return drafts.length ? drafts : null;
}

export function detectFromHeadings(paragraphs: Paragraph[]): ChapterDraft[] | null {
  const heads = paragraphs
    .map((paragraph, index) => ({ paragraph, index }))
    .filter(({ paragraph }) => paragraph.kind === 'heading');
  if (heads.length < 2) return null;
  const drafts: ChapterDraft[] = [];
  const first = heads[0]!;
  if (first.index > 0) {
    const lead = paragraphs.slice(0, first.index);
    const text = paragraphText(lead);
    if (wordCount(text) >= 40) {
      drafts.push({
        title: titleFrom(text),
        text,
        pageStart: lead[0]!.page,
        pageEnd: lead[lead.length - 1]!.page,
      });
    }
  }
  for (let index = 0; index < heads.length; index += 1) {
    const start = heads[index]!.index;
    const end = index + 1 < heads.length ? heads[index + 1]!.index : paragraphs.length;
    const slice = paragraphs.slice(start, end);
    const text = paragraphText(slice);
    if (!text) continue;
    drafts.push({
      title: heads[index]!.paragraph.text,
      text,
      pageStart: slice[0]!.page,
      pageEnd: slice[slice.length - 1]!.page,
    });
  }
  return drafts.length >= 2 ? drafts : null;
}

export function detectByLength(paragraphs: Paragraph[], targetWords = 1600): ChapterDraft[] {
  if (!paragraphs.length) return [{ title: 'Reading', text: '', pageStart: 1, pageEnd: 1 }];
  const drafts: ChapterDraft[] = [];
  let bucket: Paragraph[] = [];
  let words = 0;
  const flush = () => {
    const text = paragraphText(bucket);
    if (!text) {
      bucket = [];
      words = 0;
      return;
    }
    drafts.push({
      title: titleFrom(text),
      text,
      pageStart: bucket[0]!.page,
      pageEnd: bucket[bucket.length - 1]!.page,
    });
    bucket = [];
    words = 0;
  };
  for (const paragraph of paragraphs) {
    const count = wordCount(paragraph.text);
    if (bucket.length && words >= targetWords) flush();
    bucket.push(paragraph);
    words += count;
  }
  if (bucket.length) {
    if (drafts.length && words < 400) {
      const previous = drafts[drafts.length - 1]!;
      previous.text = `${previous.text}\n\n${paragraphText(bucket)}`.trim();
      previous.pageEnd = bucket[bucket.length - 1]!.page;
    } else flush();
  }
  return drafts.length ? drafts : [{ title: 'Reading', text: '', pageStart: 1, pageEnd: 1 }];
}

export function detectChapters(paragraphs: Paragraph[], outline: OutlineItem[] | null): ChapterDraft[] {
  if (!paragraphs.length) return [{ title: 'Reading', text: '', pageStart: 1, pageEnd: 1 }];
  const fromOutline = outline ? detectFromOutline(paragraphs, outline) : null;
  if (fromOutline?.length) return fromOutline;
  const fromHeadings = detectFromHeadings(paragraphs);
  if (fromHeadings?.length) return fromHeadings;
  return detectByLength(paragraphs);
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function materialize(drafts: ChapterDraft[]): Chapter[] {
  return drafts.map((draft) => ({
    id: createId(),
    title: draft.title || 'Reading',
    text: draft.text,
    summary: '',
    summaryKind: '',
    mode: 'full' as const,
    skipped: false,
    pageStart: draft.pageStart,
    pageEnd: draft.pageEnd,
  }));
}

export function renameChapter(chapters: Chapter[], index: number, title: string): Chapter[] {
  return chapters.map((chapter, cursor) =>
    cursor === index ? { ...chapter, title: title.trim() || chapter.title } : chapter,
  );
}

export function mergeWithNext(chapters: Chapter[], index: number): Chapter[] {
  const current = chapters[index];
  const next = chapters[index + 1];
  if (!current || !next) return chapters;
  const merged: Chapter = {
    ...current,
    id: createId(),
    text: [current.text, next.text].filter(Boolean).join('\n\n'),
    summary: '',
    summaryKind: '',
    mode: 'full',
    pageEnd: next.pageEnd,
    skipped: current.skipped && next.skipped,
  };
  return [...chapters.slice(0, index), merged, ...chapters.slice(index + 2)];
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function splitChapter(chapters: Chapter[], index: number, atParagraph: number): Chapter[] {
  const chapter = chapters[index];
  if (!chapter) return chapters;
  const parts = splitParagraphs(chapter.text);
  if (atParagraph <= 0 || atParagraph >= parts.length) return chapters;
  const left = parts.slice(0, atParagraph).join('\n\n');
  const right = parts.slice(atParagraph).join('\n\n');
  const head: Chapter = { ...chapter, id: createId(), text: left, summary: '', summaryKind: '', mode: 'full' };
  const tail: Chapter = {
    ...chapter,
    id: createId(),
    title: titleFrom(right),
    text: right,
    summary: '',
    summaryKind: '',
    mode: 'full',
    skipped: false,
  };
  return [...chapters.slice(0, index), head, tail, ...chapters.slice(index + 1)];
}

export function toggleSkip(chapters: Chapter[], index: number): Chapter[] {
  return chapters.map((chapter, cursor) => (cursor === index ? { ...chapter, skipped: !chapter.skipped } : chapter));
}

export function setChapterMode(chapters: Chapter[], index: number, mode: 'full' | 'summary'): Chapter[] {
  return chapters.map((chapter, cursor) => (cursor === index ? { ...chapter, mode } : chapter));
}

export function spokenText(chapter: Chapter): string {
  if (chapter.mode === 'summary' && chapter.summary.trim()) return chapter.summary.trim();
  return chapter.text.trim();
}
