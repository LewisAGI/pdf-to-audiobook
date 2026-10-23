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

type Span = { left: number; right: number };

function glyphWords(glyphs: Glyph[]): string[] {
  return glyphs
    .map((glyph) => glyph.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function interWordGaps(bands: Glyph[][]): number[] {
  const gaps: number[] = [];
  for (const band of bands) {
    const sorted = [...band].sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const next = sorted[index]!;
      const gap = next.x - (previous.x + previous.width);
      if (gap > 0.4) gaps.push(gap);
    }
  }
  return gaps;
}

function gapThreshold(bands: Glyph[][]): number {
  const gaps = interWordGaps(bands);
  const spacing = gaps.length >= 4 ? median(gaps) : 2.5;
  // A gutter has to clear ordinary word spacing, but justification can stretch
  // those gaps past a narrow columnsep (LaTeX is 10pt, and an 8pt gutter still
  // has to win). Cap the floor so it stays under that gutter. A fixed
  // max(30pt, 6% of the page) misses the narrow-gutter fixtures.
  return Math.min(7, Math.max(2.5, spacing * 0.45));
}

function minimumColumnBands(): number {
  return 3;
}

function minimumColumnWidth(pageWidth: number): number {
  return Math.max(72, pageWidth * 0.11);
}

function bodyBands(page: RawPage, glyphs: Glyph[]): Glyph[][] {
  return bandGlyphs(glyphs).filter((band) => {
    const y = page.height > 0 ? Math.min(...band.map((glyph) => glyph.y)) / page.height : 0;
    return y > 0.05 && y < 0.95;
  });
}

function bandGaps(band: Glyph[], minGap: number): Span[] {
  const sorted = [...band].sort((a, b) => a.x - b.x);
  const gaps: Span[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const next = sorted[index]!;
    const left = previous.x + previous.width;
    const right = next.x;
    if (right - left >= minGap) gaps.push({ left, right });
  }
  return gaps;
}

function bandCrosses(band: Glyph[], span: Span, minGap: number): boolean {
  const overlaps = band.some((glyph) => glyph.x < span.right && glyph.x + glyph.width > span.left);
  if (!overlaps) return false;
  return !bandGaps(band, minGap).some((gap) => gap.left < span.right && gap.right > span.left);
}

function whitespaceRuns(bands: Glyph[][], pageWidth: number, minGap: number): Span[] {
  const bins = 96;
  const cover = new Array<number>(bins).fill(0);
  let votes = 0;
  for (const band of bands) {
    const gaps = bandGaps(band, minGap).filter((gap) => gap.left > pageWidth * 0.06 && gap.right < pageWidth * 0.94);
    if (!gaps.length) continue;
    votes += 1;
    for (const gap of gaps) {
      const start = Math.max(0, Math.floor((gap.left / pageWidth) * bins));
      const end = Math.min(bins - 1, Math.ceil((gap.right / pageWidth) * bins) - 1);
      for (let index = start; index <= end; index += 1) cover[index] = (cover[index] ?? 0) + 1;
    }
  }
  const minBands = minimumColumnBands();
  if (votes < minBands || maxCover(cover) < minBands) return [];
  const threshold = maxCover(cover);
  const runs: Span[] = [];
  let start = -1;
  for (let index = 0; index <= bins; index += 1) {
    const hot = index < bins && (cover[index] ?? 0) >= threshold;
    if (hot && start < 0) start = index;
    if (!hot && start >= 0) {
      const left = (start / bins) * pageWidth;
      const right = (index / bins) * pageWidth;
      if (right - left >= minGap * 0.75) runs.push({ left, right });
      start = -1;
    }
  }
  return runs;
}

function maxCover(cover: number[]): number {
  return cover.reduce((best, value) => Math.max(best, value), 0);
}

function gutterFromRegion(bands: Glyph[][], region: Span, minGap: number): number | null {
  const kept = bands.filter((band) => !bandCrosses(band, region, minGap));
  let maxRight = Number.NEGATIVE_INFINITY;
  let minLeft = Number.POSITIVE_INFINITY;
  let leftCount = 0;
  let rightCount = 0;
  for (const band of kept) {
    for (const glyph of band) {
      const right = glyph.x + glyph.width;
      if (glyph.x < region.left && right <= region.right) {
        maxRight = Math.max(maxRight, right);
        leftCount += 1;
      } else if (glyph.x >= region.left) {
        minLeft = Math.min(minLeft, glyph.x);
        rightCount += 1;
      }
    }
  }
  if (leftCount < 2 || rightCount < 2 || !(minLeft > maxRight) || minLeft - maxRight < minGap * 0.5) return null;
  return (maxRight + minLeft) / 2;
}

function columnInkWidth(bands: Glyph[][], low: number, high: number): number {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const band of bands) {
    for (const glyph of band) {
      const center = glyph.x + glyph.width / 2;
      if (center < low || center >= high) continue;
      minX = Math.min(minX, glyph.x);
      maxX = Math.max(maxX, glyph.x + glyph.width);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return 0;
  return maxX - minX;
}

function columnsWideEnough(pageWidth: number, bands: Glyph[][], gutters: number[]): boolean {
  const minWidth = minimumColumnWidth(pageWidth);
  const edges = [Number.NEGATIVE_INFINITY, ...gutters, Number.POSITIVE_INFINITY];
  return edges.slice(0, -1).every((low, index) => columnInkWidth(bands, low, edges[index + 1]!) >= minWidth);
}

function sideRegion(bands: Glyph[][], pageWidth: number, minGap: number): Span[] {
  const minBands = minimumColumnBands();
  let bestX = -1;
  let bestScore = 0;
  const steps = 64;
  for (let step = 1; step < steps; step += 1) {
    const x = (step / steps) * pageWidth;
    if (x < pageWidth * 0.12 || x > pageWidth * 0.88) continue;
    let left = 0;
    let right = 0;
    for (const band of bands) {
      const minX = Math.min(...band.map((glyph) => glyph.x));
      const maxX = Math.max(...band.map((glyph) => glyph.x + glyph.width));
      if (maxX <= x) left += 1;
      else if (minX >= x) right += 1;
    }
    const score = Math.min(left, right);
    if (left < minBands || right < minBands || score <= bestScore) continue;
    bestScore = score;
    bestX = x;
  }
  if (bestX < 0) return [];
  let maxRight = Number.NEGATIVE_INFINITY;
  let minLeft = Number.POSITIVE_INFINITY;
  for (const band of bands) {
    for (const glyph of band) {
      const right = glyph.x + glyph.width;
      if (right <= bestX) maxRight = Math.max(maxRight, right);
      else if (glyph.x >= bestX) minLeft = Math.min(minLeft, glyph.x);
    }
  }
  if (!(minLeft > maxRight) || minLeft - maxRight < minGap) return [];
  return [{ left: maxRight, right: minLeft }];
}

function columnGutters(page: RawPage, glyphs: Glyph[]): number[] {
  if (page.width < 240) return [];
  let bands = bodyBands(page, glyphs);
  const minGap = gapThreshold(bands);
  let regions = whitespaceRuns(bands, page.width, minGap);
  if (!regions.length) regions = sideRegion(bands, page.width, minGap);
  if (!regions.length) return [];
  const kept = bands.filter((band) => !regions.some((region) => bandCrosses(band, region, minGap)));
  if (kept.length && kept.length !== bands.length) {
    const again = whitespaceRuns(kept, page.width, minGap);
    if (again.length) {
      bands = kept;
      regions = again;
    }
  }
  const gutters: number[] = [];
  for (const region of regions) {
    const gutter = gutterFromRegion(bands, region, minGap);
    if (gutter == null) continue;
    if (gutters.some((existing) => Math.abs(existing - gutter) < page.width * 0.08)) continue;
    gutters.push(gutter);
  }
  const ordered = gutters.sort((a, b) => a - b);
  if (!ordered.length || !columnsWideEnough(page.width, bands, ordered)) return [];
  return ordered;
}

function overlapsAnyGutter(glyphs: Glyph[], gutters: number[]): boolean {
  return gutters.some((gutter) => glyphs.some((glyph) => glyph.x < gutter && glyph.x + glyph.width > gutter));
}

function splitAtGutters(band: Glyph[], gutters: number[]): Glyph[][] {
  const cells: Glyph[][] = Array.from({ length: gutters.length + 1 }, () => []);
  for (const glyph of band) {
    const center = glyph.x + glyph.width / 2;
    let index = 0;
    while (index < gutters.length && center >= gutters[index]!) index += 1;
    cells[index]!.push(glyph);
  }
  return cells;
}

function isTableCells(cells: Glyph[][]): boolean {
  const groups = cells.map(glyphWords).filter((words) => words.length > 0);
  if (groups.length < 2 || groups.some((words) => words.length > 2)) return false;
  const numeric = (words: string[]) => words.every((word) => /^[\d.,]+$/.test(word));
  if (groups.some(numeric)) return true;
  return groups.length >= 4;
}

export function linesFromPage(page: RawPage): Line[] {
  const glyphs = dropMarkers(page.glyphs);
  const bands = bandGlyphs(glyphs);
  const gutters = columnGutters(page, glyphs);
  if (!gutters.length) {
    return bands.flatMap((band) => {
      const line = lineFromGlyphs(page, band);
      return line ? [line] : [];
    });
  }
  const header: Line[] = [];
  const footer: Line[] = [];
  const tableLike = bands.map((band) => {
    const y = page.height > 0 ? Math.min(...band.map((glyph) => glyph.y)) / page.height : 0;
    if (y <= 0.055 || y >= 0.94) return false;
    const cells = splitAtGutters(band, gutters);
    return !overlapsAnyGutter(band, gutters) && isTableCells(cells);
  });
  const tableRow = new Set<number>();
  let runStart = -1;
  for (let index = 0; index <= tableLike.length; index += 1) {
    if (tableLike[index]) {
      if (runStart < 0) runStart = index;
      continue;
    }
    if (runStart >= 0 && index - runStart >= 2) {
      for (let cursor = runStart; cursor < index; cursor += 1) tableRow.add(cursor);
    }
    runStart = -1;
  }
  type Segment = { full: Line | null; columns: Line[][] };
  const segments: Segment[] = [];
  const blankColumns = (): Line[][] => Array.from({ length: gutters.length + 1 }, () => []);
  let columns = blankColumns();
  const flushColumns = () => {
    if (columns.some((column) => column.length)) {
      segments.push({ full: null, columns });
      columns = blankColumns();
    }
  };
  bands.forEach((band, index) => {
    const y = page.height > 0 ? Math.min(...band.map((glyph) => glyph.y)) / page.height : 0;
    if (y <= 0.055 || y >= 0.94) {
      const line = lineFromGlyphs(page, band);
      if (!line) return;
      if (y <= 0.1) header.push(line);
      else footer.push(line);
      return;
    }
    const cells = splitAtGutters(band, gutters);
    if (overlapsAnyGutter(band, gutters) || tableRow.has(index)) {
      const line = lineFromGlyphs(page, band);
      if (!line) return;
      flushColumns();
      segments.push({ full: line, columns: [] });
      return;
    }
    cells.forEach((cell, cellIndex) => {
      const line = lineFromGlyphs(page, cell);
      if (line) columns[cellIndex]!.push(line);
    });
  });
  flushColumns();
  const ordered = [...header];
  for (const segment of segments) {
    if (segment.full) ordered.push(segment.full);
    for (const column of segment.columns) ordered.push(...column);
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

function columnBodySize(line: Line, lines: Line[]): number {
  const peers = lines.filter(
    (other) => other.page === line.page && Math.abs(other.x - line.x) <= Math.max(18, line.fontSize * 0.8),
  );
  const sample = peers.length >= 3 ? peers : lines.filter((other) => other.page === line.page);
  return commonFontSize((sample.length ? sample : [line]).map((item) => item.fontSize));
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
    const localBody = columnBodySize(buffer[0]!, lines);
    const bold = buffer.every((line) => line.bold) || buffer[0]!.bold;
    const heading =
      words.length > 0 &&
      words.length <= 14 &&
      text.length <= 90 &&
      !/[,:;]$/.test(text) &&
      (fontSize >= localBody * 1.15 || (bold && fontSize >= localBody * 0.98 && words.length <= 12));
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
      (isHeadingLine(line, columnBodySize(line, lines)) || isHeadingLine(previous, columnBodySize(previous, lines))) &&
      !previous.text.endsWith('-');
    if (bigGap || pageBreak || headingBreak || (shortLine && endedSentence)) flush();
    buffer.push(line);
  }
  flush();
  return paragraphs;
}

function isReferencesHeading(paragraph: Paragraph): boolean {
  const text = paragraph.text.trim();
  return REF_HEAD.test(text) && (paragraph.kind === 'heading' || text.length < 48);
}

export function stripReferences(paragraphs: Paragraph[]): Paragraph[] {
  const kept: Paragraph[] = [];
  let skipping = false;
  for (const paragraph of paragraphs) {
    if (isReferencesHeading(paragraph)) {
      skipping = true;
      continue;
    }
    if (skipping && paragraph.kind === 'heading') skipping = false;
    if (!skipping) kept.push(paragraph);
  }
  return kept;
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
