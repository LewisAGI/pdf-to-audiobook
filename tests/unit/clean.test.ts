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

  it('drops every references heading and keeps the chapters between them', () => {
    const pasted = cleanPlainText(
      'One\n\nThe ferry left.\n\nReferences\n\nSmith, A. 1999.\n\nTwo\n\nThe road held.\n\nBibliography\n\nJones, B. 2001.\n\nThree\n\nThey came home.',
    );
    const joined = pasted.map((paragraph) => paragraph.text).join('\n');
    expect(joined).toContain('The ferry left');
    expect(joined).toContain('The road held');
    expect(joined).toContain('They came home');
    expect(joined).not.toContain('Smith');
    expect(joined).not.toContain('Jones');
  });

  it('reads columns around a full-width title and keeps table rows intact', () => {
    const glyph = (text: string, x: number, y: number, width: number, size = 12): RawPage['glyphs'][number] => ({
      text,
      x,
      y,
      width,
      height: size,
      fontSize: size,
      fontName: size >= 18 ? 'Times-Bold' : 'Times',
    });
    const lines = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        glyph('TITLEBLOCK wide title', 72, 80, 470, 18),
        glyph('Abstract line stays across the whole page.', 72, 120, 470),
        glyph('LEFTPAPER', 72, 200, 90, 20),
        glyph('left column kept reading here.', 72, 230, 180),
        glyph('LEFTPAPEREND', 72, 270, 110, 20),
        glyph('RIGHTPAPER', 360, 200, 100, 20),
        glyph('right column kept reading here.', 360, 230, 190),
        glyph('RIGHTPAPEREND', 360, 270, 120, 20),
        glyph('CAPTIONBLOCK spans the page under both columns.', 72, 420, 470),
        glyph('Heron', 72, 500, 48),
        glyph('14', 360, 500, 20),
        glyph('Plover', 72, 524, 52),
        glyph('40', 360, 524, 20),
      ],
    }).map((line) => line.text);
    expect(lines.map((line) => line.split(' ')[0])).toEqual([
      'TITLEBLOCK',
      'Abstract',
      'LEFTPAPER',
      'left',
      'LEFTPAPEREND',
      'RIGHTPAPER',
      'right',
      'RIGHTPAPEREND',
      'CAPTIONBLOCK',
      'Heron',
      'Plover',
    ]);
    expect(lines[9]).toBe('Heron 14');
    expect(lines[10]).toBe('Plover 40');
    expect(lines.join('\n')).not.toContain('Heron Plover');
  });

  it('keeps single-column quotes, dialogue, and centred poems in line order', () => {
    const glyph = (text: string, x: number, y: number, width: number): RawPage['glyphs'][number] => ({
      text,
      x,
      y,
      width,
      height: 12,
      fontSize: 12,
      fontName: 'Times',
    });
    const quote = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        glyph('The block quote stayed indented.', 140, 180, 220),
        glyph('Its second line stayed with the first.', 140, 200, 240),
        glyph('The third line closed the quotation.', 140, 220, 210),
      ],
    }).map((line) => line.text);
    expect(quote).toEqual([
      'The block quote stayed indented.',
      'Its second line stayed with the first.',
      'The third line closed the quotation.',
    ]);
    const dialogue = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        glyph('Hello.', 72, 180, 36),
        glyph('I stayed by the river.', 96, 210, 150),
        glyph('Did you?', 72, 250, 48),
      ],
    }).map((line) => line.text);
    expect(dialogue).toEqual(['Hello.', 'I stayed by the river.', 'Did you?']);
    const poem = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        glyph('The', 250, 180, 28),
        glyph('moon', 286, 180, 40),
        glyph('was thin', 246, 210, 70),
        glyph('and late.', 250, 240, 64),
      ],
    }).map((line) => line.text);
    expect(poem).toEqual(['The moon', 'was thin', 'and late.']);
  });

  it('reads around a narrow centred title, a centred caption, a one-column figure, and an uneven split', () => {
    const glyph = (text: string, x: number, y: number, width: number, size = 12): RawPage['glyphs'][number] => ({
      text,
      x,
      y,
      width,
      height: size,
      fontSize: size,
      fontName: size >= 16 ? 'Times-Bold' : 'Times',
    });
    const centred = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        glyph('CENTRETITLE', 220, 80, 170, 16),
        glyph('LEFTCENTRE', 72, 180, 140, 16),
        glyph('left of the centred title.', 72, 210, 150),
        glyph('LEFTCENTREEND', 72, 250, 150, 16),
        glyph('RIGHTCENTRE', 400, 180, 140, 16),
        glyph('right of the centred title.', 400, 210, 150),
        glyph('RIGHTCENTREEND', 400, 250, 160, 16),
      ],
    }).map((line) => line.text);
    expect(centred).toEqual([
      'CENTRETITLE',
      'LEFTCENTRE',
      'left of the centred title.',
      'LEFTCENTREEND',
      'RIGHTCENTRE',
      'right of the centred title.',
      'RIGHTCENTREEND',
    ]);
    const caption = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        glyph('LEFTBEFORE', 72, 160, 140, 16),
        glyph('left before the caption.', 72, 190, 150),
        glyph('RIGHTBEFORE', 400, 160, 150, 16),
        glyph('right before the caption.', 400, 190, 160),
        glyph('CENTRECAPTION', 230, 280, 150, 12),
        glyph('LEFTAFTER', 72, 360, 130, 16),
        glyph('left after the caption.', 72, 390, 140),
        glyph('RIGHTAFTER', 400, 360, 140, 16),
        glyph('right after the caption.', 400, 390, 150),
      ],
    }).map((line) => line.text);
    expect(caption.map((line) => line.split(' ')[0])).toEqual([
      'LEFTBEFORE',
      'left',
      'RIGHTBEFORE',
      'right',
      'CENTRECAPTION',
      'LEFTAFTER',
      'left',
      'RIGHTAFTER',
      'right',
    ]);
    const figure = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: true,
      glyphs: [
        glyph('ABOVELEFT', 72, 160, 120, 16),
        glyph('left above the figure.', 72, 190, 140),
        glyph('ABOVERIGHT', 400, 160, 130, 16),
        glyph('right above the figure.', 400, 190, 150),
        glyph('BESIDEA', 400, 250, 90, 16),
        glyph('beside the figure.', 400, 280, 120),
        glyph('BESIDEB', 400, 320, 90, 16),
        glyph('BELOWLEFT', 72, 400, 120, 16),
        glyph('left below the figure.', 72, 430, 140),
        glyph('BELOWRIGHT', 400, 400, 130, 16),
        glyph('right below the figure.', 400, 430, 150),
      ],
    }).map((line) => line.text.split(' ')[0]);
    expect(figure).toEqual([
      'ABOVELEFT',
      'left',
      'BELOWLEFT',
      'left',
      'ABOVERIGHT',
      'right',
      'BESIDEA',
      'beside',
      'BESIDEB',
      'BELOWRIGHT',
      'right',
    ]);
    const uneven = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        glyph('WIDELEFT', 48, 160, 340, 16),
        glyph('The wide left column keeps its long measure.', 48, 200, 330),
        glyph('WIDELEFTEND', 48, 250, 300, 16),
        glyph('NARROWRIGHT', 460, 160, 90, 16),
        glyph('Narrow.', 460, 200, 60),
        glyph('NARROWRIGHTEND', 460, 250, 110, 16),
      ],
    }).map((line) => line.text);
    expect(uneven.map((line) => line.split(' ')[0])).toEqual([
      'WIDELEFT',
      'The',
      'WIDELEFTEND',
      'NARROWRIGHT',
      'Narrow.',
      'NARROWRIGHTEND',
    ]);
    expect(uneven.join('\n')).not.toContain('WIDELEFT NARROWRIGHT');
  });

  it('reads three text columns left to right and a wide table row by row', () => {
    const glyph = (text: string, x: number, y: number, width = text.length * 7): RawPage['glyphs'][number] => ({
      text,
      x,
      y,
      width,
      height: 12,
      fontSize: 12,
      fontName: 'Times',
    });
    const columns = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [180, 210, 250].flatMap((y) => [
        glyph(y === 180 ? 'COL1A' : y === 210 ? 'COL1B' : 'COL1C', 40, y, 110),
        glyph(y === 180 ? 'COL2A' : y === 210 ? 'COL2B' : 'COL2C', 230, y, 110),
        glyph(y === 180 ? 'COL3A' : y === 210 ? 'COL3B' : 'COL3C', 430, y, 110),
      ]),
    }).map((line) => line.text);
    expect(columns).toEqual(['COL1A', 'COL1B', 'COL1C', 'COL2A', 'COL2B', 'COL2C', 'COL3A', 'COL3B', 'COL3C']);
    const table = linesFromPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      hasImages: false,
      glyphs: [
        ['Species', 'Mon', 'Tue', 'Wed', 160],
        ['Heron', '14', '12', '9', 190],
        ['Plover', '40', '38', '41', 220],
        ['Egret', '2', '4', '5', 250],
      ].flatMap(([a, b, c, d, y]) =>
        [a, b, c, d].map((text, index) => glyph(String(text), 72 + index * 130, Number(y), 40)),
      ),
    }).map((line) => line.text);
    expect(table).toEqual(['Species Mon Tue Wed', 'Heron 14 12 9', 'Plover 40 38 41', 'Egret 2 4 5']);
    expect(table.join('\n')).not.toContain('Species Heron');
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
