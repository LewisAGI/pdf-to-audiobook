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

const PAGE_NUM =
  /^(?:page\s+)?(?:[ivxlcdm]{1,8}|\d{1,4})(?:\s*(?:of|\/)\s*(?:[ivxlcdm]{1,8}|\d{1,4}))?[.\s]*$/i;

const REF_HEAD =
  /^(?:references|bibliography|works cited|literature cited|works consulted)\b[:.\s]*$/i;

const AFTER_REF = /^(?:appendix|index|glossary|acknowledgements|acknowledgments)\b/i;

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

export function linesFromPage(page: RawPage): Line[] {
  const glyphs = dropMarkers(page.glyphs).sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: Glyph[][] = [];
  for (const glyph of glyphs) {
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

  const lines: Line[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    let text = '';
    for (let index = 0; index < group.length; index += 1) {
      const glyph = group[index]!;
      if (index > 0) {
        const previous = group[index - 1]!;
        const gap = glyph.x - (previous.x + previous.width);
        if (gap > Math.max(1.5, glyph.fontSize * 0.18)) text += ' ';
      }
      text += glyph.text.replace(/[\u00B9\u00B2\u00B3\u2070-\u2079]/g, '');
    }
    text = text.replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const fontSize = median(group.map((glyph) => glyph.fontSize)) || first.fontSize;
    const fontName = group.map((glyph) => glyph.fontName).join(' ');
    lines.push({
      text,
      page: page.pageNumber,
      y: Math.min(...group.map((glyph) => glyph.y)),
      yNorm: page.height > 0 ? Math.min(...group.map((glyph) => glyph.y)) / page.height : 0,
      x: first.x,
      width: last.x + last.width - first.x,
      fontSize,
      fontName,
      bold: group.some((glyph) => isBoldFont(glyph.fontName)),
      height: Math.max(...group.map((glyph) => glyph.height || glyph.fontSize || fontSize)),
      pageWidth: page.width,
      pageHeight: page.height,
    });
  }
  return lines;
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
  const end = paragraphs.findIndex(
    (paragraph, index) => index > start && paragraph.kind === 'heading' && AFTER_REF.test(paragraph.text.trim()),
  );
  if (end < 0) return paragraphs.slice(0, start);
  return [...paragraphs.slice(0, start), ...paragraphs.slice(end)];
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
