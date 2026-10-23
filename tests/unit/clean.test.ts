import { describe, expect, it } from 'vitest';
import {
  cleanPages,
  cleanPlainText,
  dehyphenate,
  joinWrapped,
  linesFromPage,
  linesToParagraphs,
  pageNeedsOcr,
  type Line,
  type RawPage,
} from '../../src/lib/clean';

function page(lines: { text: string; y: number; size?: number; bold?: boolean }[], pageNumber = 1): RawPage {
  return {
    pageNumber,
    width: 612,
    height: 792,
    hasImages: false,
    glyphs: lines.map((line) => ({
      text: line.text,
      x: 72,
      y: line.y,
      width: Math.min(460, line.text.length * (line.size ?? 12) * 0.45),
      height: line.size ?? 12,
      fontSize: line.size ?? 12,
      fontName: line.bold ? 'Times-Bold' : 'Times',
    })),
  };
}

describe('cleaning', () => {
  it('drops repeated headers, footers, and page numbers', () => {
    const pages = [1, 2, 3, 4].map((number) =>
      page(
        [
          { text: 'Sample Book', y: 20, size: 10 },
          { text: 'The river kept its name through the dry season.', y: 120, size: 12 },
          { text: String(number), y: 760, size: 10 },
        ],
        number,
      ),
    );
    const text = cleanPages(pages)
      .map((paragraph) => paragraph.text)
      .join('\n');
    expect(text).toContain('river kept its name');
    expect(text).not.toContain('Sample Book');
    expect(text).not.toMatch(/\b[1-4]\b/);
  });

  it('strips a references section and keeps an appendix', () => {
    const paragraphs = cleanPages([
      page([
        { text: 'Gardens', y: 80, size: 22, bold: true },
        { text: 'Soil was turned before the rain.', y: 130, size: 12 },
        { text: 'References', y: 220, size: 18, bold: true },
        { text: 'Smith, A. A history of maps. 1999.', y: 260, size: 12 },
        { text: 'Appendix', y: 340, size: 18, bold: true },
        { text: 'A table of plantings remains.', y: 390, size: 12 },
      ]),
    ]);
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text).toContain('Soil was turned');
    expect(text).toContain('table of plantings');
    expect(text).not.toContain('Smith');
    expect(text).not.toContain('References');
  });

  it('dehyphenates line-break hyphens and keeps lexical compounds', () => {
    expect(dehyphenate('The council recon-\nsidered the plan.')).toBe('The council reconsidered the plan.');
    expect(joinWrapped('A well-', 'known path')).toBe('A well-known path');
    expect(dehyphenate('state-of-\nthe-art tools')).toContain('state-of-the-art');
  });

  it('joins wrapped lines into paragraphs and drops footnotes', () => {
    const paragraphs = cleanPages([
      page([
        { text: 'The council recon-', y: 140, size: 12 },
        { text: 'sidered the plan after the storm and wrote it down.', y: 158, size: 12 },
        { text: '1 Archived minutes of the council.', y: 740, size: 8 },
      ]),
    ]);
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text).toContain('reconsidered the plan');
    expect(text).not.toContain('Archived minutes');
  });

  it('removes footnote markers and refuses a bare URL paste', () => {
    const marked = cleanPages([
      page([
        { text: 'Minutes', y: 140, size: 12 },
        { text: '1', y: 132, size: 7 },
        { text: 'were revised.', y: 140, size: 12 },
      ]),
    ]);
    expect(marked.map((paragraph) => paragraph.text).join(' ')).not.toMatch(/\b1\b/);
    expect(cleanPlainText('https://example.com/article')).toEqual([]);
    const pasted = cleanPlainText('Arrival\n\nThe council met.\n\nReferences\n\nSmith, A. 1999.');
    expect(pasted.map((paragraph) => paragraph.text).join('\n')).not.toContain('Smith');
    expect(pasted.some((paragraph) => paragraph.kind === 'heading' && paragraph.text === 'Arrival')).toBe(true);
  });

  it('keeps roman numerals, years, and words while dropping numeric page markers', () => {
    const paragraphs = cleanPages([
      page([
        { text: 'I', y: 200, size: 12 },
        { text: 'II', y: 230, size: 12 },
        { text: '1914', y: 260, size: 12 },
        { text: 'Vivid', y: 300, size: 12 },
        { text: 'mild civil mix', y: 340, size: 12 },
        { text: 'The river kept its name.', y: 400, size: 12 },
        { text: '12', y: 760, size: 10 },
        { text: '3', y: 740, size: 10 },
      ]),
    ]);
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text).toContain('I');
    expect(text).toContain('II');
    expect(text).toContain('1914');
    expect(text).toContain('Vivid');
    expect(text).toContain('mild civil mix');
    expect(text).not.toMatch(/(^|\n)12(\n|$)/);
    expect(text).not.toMatch(/(^|\n)3(\n|$)/);
    const pasted = cleanPlainText('I\n\nII\n\n1914\n\nVivid\n\nmild\n\ncivil\n\nmix\n\n12\n\nThe river kept its name.');
    const joined = pasted.map((paragraph) => paragraph.text).join('\n');
    expect(joined).toContain('Vivid');
    expect(joined).toContain('1914');
    expect(joined).toContain('mild');
    expect(joined).toContain('civil');
    expect(joined).toContain('mix');
    expect(joined).not.toMatch(/(^|\n)12(\n|$)/);
  });

  it('drops a mid-book references section and keeps the following chapter', () => {
    const paragraphs = cleanPages([
      page([
        { text: 'Opening', y: 80, size: 22, bold: true },
        { text: 'The river kept its name.', y: 130, size: 12 },
        { text: 'References', y: 220, size: 18, bold: true },
        { text: 'Smith, A. A history of maps. 1999.', y: 260, size: 12 },
        { text: 'The Return', y: 340, size: 18, bold: true },
        { text: 'They came back at dusk.', y: 390, size: 12 },
      ]),
    ]);
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text).toContain('river kept its name');
    expect(text).toContain('came back at dusk');
    expect(text).not.toContain('Smith');
    const pasted = cleanPlainText(
      'Opening\n\nThe river kept its name.\n\nReferences\n\nSmith, A. 1999.\n\nThe Return\n\nThey came back at dusk.',
    );
    const joined = pasted.map((paragraph) => paragraph.text).join('\n');
    expect(joined).toContain('The Return');
    expect(joined).toContain('came back at dusk');
    expect(joined).not.toContain('Smith');
  });

  it('reads a two-column page down the left column before the right', () => {
    const raw: RawPage = {
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        ['LEFT_ALPHA', 72, 180],
        ['RIGHT_ALPHA', 360, 180],
        ['left river kept', 72, 220],
        ['right maps kept', 360, 220],
        ['LEFT_OMEGA', 72, 260],
        ['RIGHT_OMEGA', 360, 260],
      ].map(([text, x, y]) => ({
        text: String(text),
        x: Number(x),
        y: Number(y),
        width: String(text).length * 7,
        height: 14,
        fontSize: 14,
        fontName: 'Times',
      })),
    };
    const lines = linesFromPage(raw).map((line) => line.text);
    expect(lines).toEqual(['LEFT_ALPHA', 'left river kept', 'LEFT_OMEGA', 'RIGHT_ALPHA', 'right maps kept', 'RIGHT_OMEGA']);
  });

  it('keeps a heading on its own paragraph', () => {
    const body: Line = {
      text: 'The river kept its name through the valley.',
      page: 1,
      y: 100,
      yNorm: 100 / 792,
      x: 72,
      width: 400,
      fontSize: 12,
      fontName: 'Times',
      bold: false,
      height: 12,
      pageWidth: 612,
      pageHeight: 792,
    };
    const heading: Line = { ...body, text: 'Harvest', y: 116, yNorm: 116 / 792, width: 80, fontSize: 22, fontName: 'Times-Bold', bold: true, height: 22 };
    const paragraphs = linesToParagraphs([body, heading]);
    expect(paragraphs.map((paragraph) => paragraph.kind)).toEqual(['body', 'heading']);
    expect(paragraphs[1]?.text).toBe('Harvest');
  });

  it('flags image-only pages for OCR', () => {
    expect(pageNeedsOcr({ pageNumber: 1, width: 100, height: 100, glyphs: [], hasImages: true })).toBe(true);
    expect(
      pageNeedsOcr({
        pageNumber: 1,
        width: 100,
        height: 100,
        glyphs: [{ text: 'Plenty of real text here', x: 0, y: 0, width: 10, height: 10, fontSize: 12, fontName: 'Times' }],
        hasImages: true,
      }),
    ).toBe(false);
    expect(pageNeedsOcr({ pageNumber: 1, width: 100, height: 100, glyphs: [], hasImages: false })).toBe(false);
  });
});
