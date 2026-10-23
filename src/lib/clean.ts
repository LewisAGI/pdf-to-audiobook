export type Glyph = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
};

export type RawPage = {
  pageNumber: number;
  width: number;
  height: number;
  glyphs: Glyph[];
  hasImages: boolean;
};

export type Line = {
  text: string;
  page: number;
  y: number;
  yNorm: number;
  x: number;
  width: number;
  fontSize: number;
  fontName: string;
  bold: boolean;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

export type Paragraph = {
  text: string;
  page: number;
  y: number;
  fontSize: number;
  bold: boolean;
  kind: 'body' | 'heading';
};

const PAGE_NUM = /^(?:page\s+)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?[.\s]*$/i;

const REF_HEAD =
  /^(?:references|bibliography|works cited|literature cited|works consulted)\b[:.\s]*$/i;

const KEEP_HYPHEN = new Set([
  'well-known',
  'long-term',
  'short-term',
  'real-time',
  'full-time',
  'part-time',
  'high-quality',
  'co-author',
  're-enter',
  're-elect',
  'non-profit',
  'self-aware',
  'cross-section',
  'state-of-the-art',
]);

export function isBoldFont(name: string): boolean {
  return /bold|black|heavy|semibold|demi/i.test(name);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function commonFontSize(values: number[]): number {
  if (!values.length) return 12;
  const counts = new Map<number, number>();
  for (const value of values) {
    const size = Math.round(value * 2) / 2;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  let best = 12;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount || (count === bestCount && size < best)) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

export function pageNeedsOcr(page: RawPage): boolean {
  const chars = page.glyphs.reduce((sum, glyph) => sum + glyph.text.replace(/\s/g, '').length, 0);
  return chars < 12 && page.hasImages;
}

function dropMarkers(glyphs: Glyph[]): Glyph[] {
  const medianSize = median(glyphs.map((glyph) => glyph.fontSize).filter((size) => size > 0)) || 12;
  return glyphs.filter((glyph) => {
    const text = glyph.text.trim();
    if (!text) return false;
    if (/^[\u00B9\u00B2\u00B3\u2070-\u2079]+$/.test(text)) return false;
    if (/^\d{1,3}$/.test(text) && glyph.fontSize < medianSize * 0.75) return false;
    return true;
  });
}

function bandGlyphs(glyphs: Glyph[]): Glyph[][] {
  const sorted = [...glyphs].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: Glyph[][] = [];
  for (const glyph of sorted) {
    const current = groups[groups.length - 1];
    if (!current) {
      groups.push([glyph]);
      continue;
    }
    const anchor = median(current.map((item) => item.y));
    const tolerance = Math.max(2, (glyph.fontSize || 12) * 0.45);
    if (Math.abs(glyph.y - anchor) <= tolerance) current.push(glyph);
    else groups.push([glyph]);
  }
  return groups;
}

function lineFromGlyphs(page: RawPage, group: Glyph[]): Line | null {
  if (!group.length) return null;
  const glyphs = [...group].sort((a, b) => a.x - b.x);
  let text = '';
  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index]!;
    if (index > 0) {
      const previous = glyphs[index - 1]!;
      const gap = glyph.x - (previous.x + previous.width);
      if (gap > Math.max(1.5, glyph.fontSize * 0.18)) text += ' ';
    }
    text += glyph.text.replace(/[\u00B9\u00B2\u00B3\u2070-\u2079]/g, '');
  }
  text = text.replace(/[ \t]+/g, ' ').trim();
  if (!text) return null;
  const first = glyphs[0]!;
  const last = glyphs[glyphs.length - 1]!;
  const fontSize = median(glyphs.map((glyph) => glyph.fontSize)) || first.fontSize;
  const y = Math.min(...glyphs.map((glyph) => glyph.y));
  return {
    text,
    page: page.pageNumber,
    y,
    yNorm: page.height > 0 ? y / page.height : 0,
    x: first.x,
    width: last.x + last.width - first.x,
    fontSize,
    fontName: glyphs.map((glyph) => glyph.fontName).join(' '),
    bold: glyphs.some((glyph) => isBoldFont(glyph.fontName)),
    height: Math.max(...glyphs.map((glyph) => glyph.height || glyph.fontSize || fontSize)),
    pageWidth: page.width,
    pageHeight: page.height,
  };
}

function columnGutter(page: RawPage, glyphs: Glyph[]): number | null {
  const body = glyphs.filter((glyph) => {
    const y = page.height > 0 ? glyph.y / page.height : 0;
    return y > 0.05 && y < 0.95;
  });
  if (page.width < 240 || body.length < 4) return null;
  const bins = 48;
  const counts = new Array<number>(bins).fill(0);
  for (const glyph of body) {
    const center = glyph.x + glyph.width / 2;
    const bin = Math.max(0, Math.min(bins - 1, Math.floor((center / page.width) * bins)));
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  const startBin = Math.floor(bins * 0.3);
  const endBin = Math.floor(bins * 0.7);
  let bestStart = -1;
  let bestLength = 0;
  let run = 0;
  let runStart = startBin;
  for (let index = startBin; index <= endBin; index += 1) {
    if ((counts[index] ?? 0) === 0) {
      if (run === 0) runStart = index;
      run += 1;
      if (run > bestLength) {
        bestLength = run;
        bestStart = runStart;
      }
    } else run = 0;
  }
  if (bestStart < 0) return null;
  const gapWidth = (bestLength / bins) * page.width;
  if (gapWidth < page.width * 0.08) return null;
  const gutter = ((bestStart + bestLength / 2) / bins) * page.width;
  const left = body.filter((glyph) => glyph.x + glyph.width / 2 < gutter).length;
  const right = body.filter((glyph) => glyph.x + glyph.width / 2 >= gutter).length;
  if (left < 2 || right < 2) return null;
  return gutter;
}

function overlapsGutter(glyphs: Glyph[], gutter: number, pageWidth: number): boolean {
  const margin = Math.max(4, pageWidth * 0.015);
  return glyphs.some((glyph) => glyph.x < gutter + margin && glyph.x + glyph.width > gutter - margin);
}

export function linesFromPage(page: RawPage): Line[] {
  const glyphs = dropMarkers(page.glyphs);
  const bands = bandGlyphs(glyphs);
  const gutter = columnGutter(page, glyphs);
  if (gutter == null) {
    return bands.flatMap((band) => {
      const line = lineFromGlyphs(page, band);
      return line ? [line] : [];
    });
  }
  const header: Line[] = [];
  const footer: Line[] = [];
  type Segment = { full: Line | null; left: Line[]; right: Line[] };
  const segments: Segment[] = [];
  let current: Segment = { full: null, left: [], right: [] };
  const pushCurrent = () => {
    if (current.full || current.left.length || current.right.length) segments.push(current);
    current = { full: null, left: [], right: [] };
  };
  for (const band of bands) {
    const y = page.height > 0 ? Math.min(...band.map((glyph) => glyph.y)) / page.height : 0;
    if (y <= 0.055 || y >= 0.94) {
      const line = lineFromGlyphs(page, band);
      if (!line) continue;
      if (y <= 0.1) header.push(line);
      else footer.push(line);
      continue;
    }
    if (overlapsGutter(band, gutter, page.width)) {
      const line = lineFromGlyphs(page, band);
      if (!line) continue;
      pushCurrent();
      segments.push({ full: line, left: [], right: [] });
      continue;
    }
    const left = lineFromGlyphs(
      page,
      band.filter((glyph) => glyph.x + glyph.width / 2 < gutter),
    );
    const right = lineFromGlyphs(
      page,
      band.filter((glyph) => glyph.x + glyph.width / 2 >= gutter),
    );
    if (left) current.left.push(left);
    if (right) current.right.push(right);
  }
  pushCurrent();
  const ordered = [...header];
  for (const segment of segments) {
    if (segment.full) ordered.push(segment.full);
    ordered.push(...segment.left, ...segment.right);
  }
  ordered.push(...footer);
  return ordered;
}

function zoneOf(line: Line): 'header' | 'footer' | 'body' {
  if (line.yNorm <= 0.1) return 'header';
  if (line.yNorm >= 0.9) return 'footer';
  return 'body';
}

function chromeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[^a-z# ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripChrome(lines: Line[], pageCount: number): Line[] {
  const counts = new Map<string, Set<number>>();
  for (const line of lines) {
    const zone = zoneOf(line);
    if (zone === 'body') continue;
    const keyText = chromeKey(line.text);
    if (!keyText) continue;
    const key = `${zone}|${keyText}`;
    const pages = counts.get(key) ?? new Set<number>();
    pages.add(line.page);
    counts.set(key, pages);
  }
  const threshold = pageCount <= 1 ? Number.POSITIVE_INFINITY : Math.max(2, Math.ceil(pageCount * 0.4));
  const repeated = new Set<string>();
  for (const [key, pages] of counts) {
    if (pages.size >= threshold) repeated.add(key);
  }
  return lines.filter((line) => {
    const zone = zoneOf(line);
    if (zone !== 'body' && PAGE_NUM.test(line.text.trim())) return false;
    if (zone !== 'body' && repeated.has(`${zone}|${chromeKey(line.text)}`)) return false;
    return true;
  });
}

export function stripFootnotes(lines: Line[]): Line[] {
  const bodySizes = lines.filter((line) => zoneOf(line) === 'body').map((line) => line.fontSize);
  const body = commonFontSize(bodySizes.length ? bodySizes : lines.map((line) => line.fontSize));
  const kept: Line[] = [];
  let page = -1;
  let inFootnotes = false;
  for (const line of lines) {
    if (line.page !== page) {
      page = line.page;
      inFootnotes = false;
    }
    const small = line.fontSize <= body * 0.86;
    const low = line.yNorm >= 0.78;
    const marked = /^(?:\d{1,3}|\[\d{1,3}\]|[*†‡§])\s+\S/.test(line.text);
    if (low && small && (marked || inFootnotes)) {
      inFootnotes = true;
      continue;
    }
    inFootnotes = false;
    kept.push(line);
  }
  return kept;
}

export function joinWrapped(left: string, right: string): string {
  const end = left.replace(/\s+$/g, '');
  const start = right.replace(/^\s+/g, '');
  if (!start) return end;
  if (!end) return start;
  if (end.endsWith('\u00AD')) return end.slice(0, -1) + start;
  if (end.endsWith('-') && /^[a-z]/.test(start)) {
    const withHyphen = `${end}${start}`;
    const around = withHyphen.toLowerCase();
    if ([...KEEP_HYPHEN].some((phrase) => around.includes(phrase))) return withHyphen;
    return `${end.slice(0, -1)}${start}`;
  }
  return `${end} ${start}`.replace(/[ \t]+/g, ' ');
}

export function dehyphenate(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let out = '';
  for (const line of lines) {
    if (!line.trim()) {
      out = out.replace(/[ \t]+$/g, '');
      if (!out.endsWith('\n')) out += '\n';
      continue;
    }
    out = out ? joinWrapped(out, line.trim()) : line.trim();
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

function isHeadingLine(line: Line, bodySize: number): boolean {
  const words = line.text.split(/\s+/).filter(Boolean);
  if (words.length > 14 || line.text.length > 90) return false;
  if (/[,:;]$/.test(line.text)) return false;
  if (line.fontSize >= bodySize * 1.15) return true;
  return line.bold && line.fontSize >= bodySize * 0.98 && words.length <= 12;
}

export function linesToParagraphs(lines: Line[]): Paragraph[] {
  const bodySize = commonFontSize(lines.map((line) => line.fontSize));
  const widths = lines.map((line) => line.width).filter((width) => width > 0);
  const contentWidth = Math.max(median(widths), 1);
  const paragraphs: Paragraph[] = [];
  let buffer: Line[] = [];

  const flush = () => {
    if (!buffer.length) return;
    let text = buffer[0]!.text;
    for (let index = 1; index < buffer.length; index += 1) text = joinWrapped(text, buffer[index]!.text);
    text = text.replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    const fontSize = median(buffer.map((line) => line.fontSize)) || bodySize;
    const bold = buffer.every((line) => line.bold) || buffer[0]!.bold;
    const heading =
      words.length > 0 &&
      words.length <= 14 &&
      text.length <= 90 &&
      !/[,:;]$/.test(text) &&
      (fontSize >= bodySize * 1.15 || (bold && fontSize >= bodySize * 0.98 && words.length <= 12));
    if (text) {
      paragraphs.push({
        text,
        page: buffer[0]!.page,
        y: buffer[0]!.y,
        fontSize,
        bold,
        kind: heading ? 'heading' : 'body',
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const previous = buffer[buffer.length - 1];
    if (!previous) {
      buffer = [line];
      continue;
    }
    const samePage = previous.page === line.page;
    const gap = line.y - (previous.y + (previous.height || previous.fontSize));
    const bigGap = samePage && gap > Math.max(previous.fontSize * 0.85, 10);
    const endedSentence = /[.!?]["'”’)\]]*$/.test(previous.text) && !previous.text.endsWith('-');
    const shortLine = previous.width < contentWidth * 0.82;
    const pageBreak = !samePage && endedSentence;
    const headingBreak =
      (isHeadingLine(line, bodySize) || isHeadingLine(previous, bodySize)) && !previous.text.endsWith('-');
    if (bigGap || pageBreak || headingBreak || (shortLine && endedSentence)) flush();
    buffer.push(line);
  }
  flush();
  return paragraphs;
}

export function stripReferences(paragraphs: Paragraph[]): Paragraph[] {
  const start = paragraphs.findIndex((paragraph) => {
    const text = paragraph.text.trim();
    return REF_HEAD.test(text) && (paragraph.kind === 'heading' || text.length < 48);
  });
  if (start < 0) return paragraphs;
  const next = paragraphs.findIndex((paragraph, index) => index > start && paragraph.kind === 'heading');
  if (next < 0) return paragraphs.slice(0, start);
  return [...paragraphs.slice(0, start), ...paragraphs.slice(next)];
}

export function cleanPages(pages: RawPage[]): Paragraph[] {
  const lines = pages.flatMap(linesFromPage);
  return stripReferences(linesToParagraphs(stripFootnotes(stripChrome(lines, pages.length))));
}

function plainHeading(line: string): boolean {
  if (/^#{1,3}\s+\S/.test(line)) return true;
  const text = line.trim();
  if (text.length < 2 || text.length > 70) return false;
  if (/[.!?,:;]$/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 10) return false;
  const titled = words.filter((word) => /^[A-Z0-9]/.test(word)).length;
  return titled >= Math.ceil(words.length * 0.6);
}

export function cleanPlainText(input: string): Paragraph[] {
  const text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/^https?:\/\/\S+$/i.test(text.trim())) return [];
  const paragraphs: Paragraph[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const rawLines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !PAGE_NUM.test(line));
    if (!rawLines.length) continue;
    let joined = rawLines[0]!;
    for (let index = 1; index < rawLines.length; index += 1) joined = joinWrapped(joined, rawLines[index]!);
    joined = joined.replace(/^#{1,3}\s+/, '').replace(/\s+/g, ' ').trim();
    if (!joined) continue;
    const heading = plainHeading(rawLines.length === 1 ? rawLines[0]! : joined) && rawLines.length === 1;
    paragraphs.push({
      text: joined,
      page: 1,
      y: paragraphs.length,
      fontSize: heading ? 18 : 12,
      bold: heading,
      kind: heading ? 'heading' : 'body',
    });
  }
  return stripReferences(paragraphs);
}
