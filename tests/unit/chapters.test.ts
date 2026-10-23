import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cleanPages, linesToParagraphs, type Line, type Paragraph } from '../../src/lib/clean';
import {
  detectByLength,
  detectChapters,
  detectFromHeadings,
  materialize,
  mergeWithNext,
  renameChapter,
  splitChapter,
  toggleSkip,
} from '../../src/lib/chapters';
import { pageNeedsOcr } from '../../src/lib/clean';
import { parsePdf } from '../../src/lib/pdf';
import { pdfAssets } from '../helpers/pdf';

async function parsed(name: string) {
  const data = new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
  const pdf = await parsePdf(data, pdfAssets);
  const paragraphs = cleanPages(pdf.pages);
  return { pdf, paragraphs };
}

function body(text: string, page = 1): Paragraph {
  return { text, page, y: 100, fontSize: 12, bold: false, kind: 'body' };
}

describe('chapter detection', () => {
  it('prefers outline titles over different heading text', () => {
    const paragraphs = [
      { text: 'Body Heading', page: 1, y: 80, fontSize: 22, bold: true, kind: 'heading' as const },
      { text: 'The river kept its name.', page: 1, y: 120, fontSize: 12, bold: false, kind: 'body' as const },
      { text: 'Other Heading', page: 2, y: 80, fontSize: 22, bold: true, kind: 'heading' as const },
      { text: 'They left at dusk.', page: 2, y: 120, fontSize: 12, bold: false, kind: 'body' as const },
    ];
    const chapters = detectChapters(paragraphs, [
      { title: 'Outline Arrival', page: 1, y: null, level: 1 },
      { title: 'Outline Departure', page: 2, y: null, level: 1 },
    ]);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['Outline Arrival', 'Outline Departure']);
  });

  it('uses a real PDF outline before headings', async () => {
    const { pdf, paragraphs } = await parsed('outline.pdf');
    expect(pdf.outline.map((item) => item.title)).toEqual(['Arrival', 'Departure']);
    const chapters = detectChapters(paragraphs, pdf.outline);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['Arrival', 'Departure']);
    expect(chapters[0]?.text).toContain('reconsidered');
    expect(chapters[0]?.text).toContain('river kept its old name');
    expect(chapters[0]?.text).not.toContain('Sample Book');
    expect(chapters[0]?.text).not.toContain('Archived minutes');
    expect(chapters.map((chapter) => chapter.text).join('\n')).not.toContain('Smith');
    expect(chapters[1]?.text).toContain('dusk');
    await pdf.destroy();
  });

  it('detects headings when a PDF has no outline', async () => {
    const { pdf, paragraphs } = await parsed('headings.pdf');
    expect(pdf.outline).toEqual([]);
    const chapters = detectChapters(paragraphs, pdf.outline);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['Gardens', 'Harvest']);
    expect(chapters[0]?.text).toContain('soil');
    expect(chapters[1]?.text).toContain('baskets');
    const joined = chapters.map((chapter) => chapter.text).join('\n');
    expect(joined).not.toContain('Field Notes');
    await pdf.destroy();
  });

  it('falls back to length when a PDF has neither outline nor headings', async () => {
    const { pdf, paragraphs } = await parsed('plain.pdf');
    const chapters = detectChapters(paragraphs, pdf.outline);
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    const joined = chapters.map((chapter) => chapter.text).join('\n');
    expect(joined).toContain('ALPHA_MARKER');
    expect(joined).toContain('OMEGA_MARKER');
    expect(detectFromHeadings(paragraphs)).toBeNull();
    await pdf.destroy();
  });

  it('keeps the chapter after a mid-book references heading', async () => {
    const { pdf, paragraphs } = await parsed('references.pdf');
    const chapters = detectChapters(paragraphs, pdf.outline);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['Opening', 'The Return']);
    expect(chapters.map((chapter) => chapter.text).join('\n')).not.toContain('Smith');
    await pdf.destroy();
  });

  it('reads two columns down the left side first', async () => {
    const { pdf, paragraphs } = await parsed('columns.pdf');
    const chapters = detectChapters(paragraphs, pdf.outline);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['LEFTMARK', 'LEFTEND', 'RIGHTMARK', 'RIGHTEND']);
    await pdf.destroy();
  });

  it('reads a full-width title and caption around two columns', async () => {
    const { pdf, paragraphs } = await parsed('paper.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    const at = (marker: string) => text.indexOf(marker);
    expect(at('TITLEBLOCK')).toBeGreaterThanOrEqual(0);
    expect(at('TITLEBLOCK')).toBeLessThan(at('Abstract'));
    expect(at('Abstract')).toBeLessThan(at('LEFTPAPER'));
    expect(at('LEFTPAPER')).toBeLessThan(at('LEFTPAPEREND'));
    expect(at('LEFTPAPEREND')).toBeLessThan(at('RIGHTPAPER'));
    expect(at('RIGHTPAPER')).toBeLessThan(at('RIGHTPAPEREND'));
    expect(at('RIGHTPAPEREND')).toBeLessThan(at('CAPTIONBLOCK'));
    expect(text).not.toContain('LEFTPAPER RIGHTPAPER');
    await pdf.destroy();
  });

  it('reads a narrow centred title down the left column first', async () => {
    const { pdf, paragraphs } = await parsed('centre-title.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    const at = (marker: string) => text.indexOf(marker);
    expect(at('CENTRETITLE')).toBeGreaterThanOrEqual(0);
    expect(at('CENTRETITLE')).toBeLessThan(at('LEFTCENTRE'));
    expect(at('LEFTCENTRE')).toBeLessThan(at('LEFTCENTREEND'));
    expect(at('LEFTCENTREEND')).toBeLessThan(at('RIGHTCENTRE'));
    expect(at('RIGHTCENTRE')).toBeLessThan(at('RIGHTCENTREEND'));
    expect(text).not.toContain('LEFTCENTRE RIGHTCENTRE');
    await pdf.destroy();
  });

  it('reads around a narrow centred caption', async () => {
    const { pdf, paragraphs } = await parsed('centre-caption.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    const at = (marker: string) => text.indexOf(marker);
    expect(at('LEFTBEFORE')).toBeLessThan(at('RIGHTBEFORE'));
    expect(at('RIGHTBEFORE')).toBeLessThan(at('CENTRECAPTION'));
    expect(at('CENTRECAPTION')).toBeLessThan(at('LEFTAFTER'));
    expect(at('LEFTAFTER')).toBeLessThan(at('RIGHTAFTER'));
    await pdf.destroy();
  });

  it('reads the text beside a one-column figure with the right column', async () => {
    const { pdf, paragraphs } = await parsed('figure-column.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    const at = (marker: string) => text.indexOf(marker);
    expect(at('ABOVELEFT')).toBeLessThan(at('BELOWLEFT'));
    expect(at('BELOWLEFT')).toBeLessThan(at('ABOVERIGHT'));
    expect(at('ABOVERIGHT')).toBeLessThan(at('BESIDEA'));
    expect(at('BESIDEA')).toBeLessThan(at('BESIDEB'));
    expect(at('BESIDEB')).toBeLessThan(at('BELOWRIGHT'));
    await pdf.destroy();
  });

  it('reads an uneven column split down the wide column first', async () => {
    const { pdf, paragraphs } = await parsed('uneven.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    const at = (marker: string) => text.indexOf(marker);
    expect(at('WIDELEFT')).toBeLessThan(at('WIDELEFTEND'));
    expect(at('WIDELEFTEND')).toBeLessThan(at('NARROWRIGHT'));
    expect(at('NARROWRIGHT')).toBeLessThan(at('NARROWRIGHTEND'));
    expect(text).not.toContain('WIDELEFT NARROWRIGHT');
    await pdf.destroy();
  });

  it('reads three columns from left to right', async () => {
    const { pdf, paragraphs } = await parsed('three-columns.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    const at = (marker: string) => text.indexOf(marker);
    expect(at('COL1A')).toBeLessThan(at('COL1B'));
    expect(at('COL1B')).toBeLessThan(at('COL2A'));
    expect(at('COL2A')).toBeLessThan(at('COL2B'));
    expect(at('COL2B')).toBeLessThan(at('COL3A'));
    expect(at('COL3A')).toBeLessThan(at('COL3B'));
    await pdf.destroy();
  });

  it('reads a table with three or more columns across each row', async () => {
    const { pdf, paragraphs } = await parsed('wide-table.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text.indexOf('Mon')).toBeLessThan(text.indexOf('Heron'));
    expect(text.indexOf('Heron')).toBeLessThan(text.indexOf('Plover'));
    expect(text).not.toContain('Species Heron');
    await pdf.destroy();
  });

  it('keeps a code block with aligned equals signs on one line each', async () => {
    for (const name of ['code-spaces.pdf', 'code-tokens.pdf']) {
      const { pdf, paragraphs } = await parsed(name);
      const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
      expect(text, name).toMatch(/herons\s+=\s+12/);
      expect(text, name).toMatch(/plovers\s+=\s+40/);
      expect(text, name).not.toMatch(/herons\s+plovers/);
      expect(text.indexOf('herons')).toBeLessThan(text.indexOf('plovers'));
      await pdf.destroy();
    }
  });

  it('reads narrow gutters down the left column, including an 8pt justified gap', async () => {
    for (const name of ['gutter8.pdf', 'gutter12.pdf', 'just-gutter8.pdf', 'just-gutter14.pdf', 'just-gutter20.pdf']) {
      const { pdf, paragraphs } = await parsed(name);
      const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
      expect(text, name).toContain('walked north');
      expect(text.indexOf('ford.'), name).toBeLessThan(text.indexOf('In the afternoon'));
      expect(text, name).not.toContain('walked In the afternoon');
      await pdf.destroy();
    }
  });

  it('does not turn justified word spacing or rivers into columns', async () => {
    const rivers = await parsed('rivers.pdf');
    const riverText = rivers.paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(riverText).not.toMatch(/Morning\s+shallow/);
    expect(riverText).toMatch(/heron/);
    await rivers.pdf.destroy();

    const justified = await parsed('justified-words.pdf');
    const text = justified.paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text).toContain('dawn and walked north along');
    expect(text).not.toContain('dawn and they');
    expect(text.indexOf('walked north')).toBeLessThan(text.indexOf('they saw'));
    await justified.pdf.destroy();
  });

  it('reads two-line columns and loose gutters down the left side first', async () => {
    for (const name of [
      'short-last-2.pdf',
      'short-intro-2.pdf',
      'left5-right2.pdf',
      'left2-right5.pdf',
      'left3-right3.pdf',
      'loose-w6-g8.pdf',
      'loose-w6-g10.pdf',
      'loose-w4-g8.pdf',
    ]) {
      const { pdf, paragraphs } = await parsed(name);
      const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
      expect(text, name).toContain('walked north');
      expect(text.indexOf('counting'), name).toBeLessThan(text.indexOf('In the afternoon'));
      expect(text, name).not.toContain('walked In the afternoon');
      await pdf.destroy();
    }
  });

  it('reads a sidebar of at least an inch after the main column', async () => {
    for (const name of ['sidebar-80.pdf', 'sidebar-100.pdf', 'sidebar-60.pdf', 'sidebar-70.pdf']) {
      const { pdf, paragraphs } = await parsed(name);
      const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
      expect(text.indexOf('found consistent'), name).toBeLessThan(text.indexOf('Herons nest'));
      expect(text, name).toContain('Herons nest');
      await pdf.destroy();
    }
  });

  it('keeps the line after a monospace table in the same chapter', async () => {
    for (const name of ['ascii-table.pdf', 'ascii-table-num.pdf', 'code-long.pdf', 'code-long-tokens.pdf']) {
      const { pdf, paragraphs } = await parsed(name);
      const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
      const titles = detectChapters(paragraphs, pdf.outline).map((chapter) => chapter.title).join('\n');
      if (name.startsWith('ascii')) {
        expect(text.indexOf('Great egret'), name).toBeLessThan(text.indexOf('Evening counts were lower'));
        expect(titles, name).not.toMatch(/Evening counts were lower/);
      } else {
        expect(text, name).toMatch(/totalHerons\s+=\s+heronsMorning/);
        expect(text.indexOf('grandTotalOfBirds'), name).toBeLessThan(text.indexOf('After that the totals'));
        expect(titles, name).not.toMatch(/After that the totals/);
      }
      await pdf.destroy();
    }
  });

  it('keeps a definition with the term that introduces it', async () => {
    const { pdf, paragraphs } = await parsed('definition-list.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text.indexOf('Heron')).toBeLessThan(text.indexOf('Plover'));
    expect(text.indexOf('Plover')).toBeLessThan(text.indexOf('Spoonbill'));
    expect(text.indexOf('A tall wading bird')).toBeLessThan(text.indexOf('A small shorebird'));
    await pdf.destroy();
  });

  it('sizes a column from its own body, not the other column', () => {
    const line = (text: string, x: number, y: number, fontSize: number, fontName = 'serif'): Line => ({
      text,
      page: 1,
      y,
      yNorm: y / 792,
      x,
      width: 220,
      fontSize,
      fontName,
      bold: false,
      height: fontSize,
      pageWidth: 612,
      pageHeight: 792,
    });
    const lines = [
      line('Left column line one of the field notes.', 72, 100, 10),
      line('Left column line two of the field notes.', 72, 116, 10),
      line('Left column line three of the field notes.', 72, 132, 10),
      line('Left column line four of the field notes.', 72, 148, 10),
      line('Left column line five of the field notes.', 72, 164, 10),
      line('Left column line six of the field notes.', 72, 180, 10),
      line('The afternoon team walked north along the bank.', 320, 100, 13),
      line('They counted spoonbills before the light failed.', 320, 118, 13),
      line('The salt flats were quiet after the boat left.', 320, 136, 13),
      line('Walking Team', 200, 400, 22),
    ];
    const paragraphs = linesToParagraphs(lines);
    const right = paragraphs.filter((paragraph) => /afternoon|spoonbills|salt flats/.test(paragraph.text));
    expect(right.length).toBeGreaterThan(0);
    expect(right.every((paragraph) => paragraph.kind === 'body')).toBe(true);
    expect(paragraphs.some((paragraph) => paragraph.kind === 'heading' && paragraph.text === 'Walking Team')).toBe(true);
  });

  it('keeps a single numeric line ending inside its column', async () => {
    const { pdf, paragraphs } = await parsed('prose-numeric.pdf');
    const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text.indexOf('1890.')).toBeLessThan(text.indexOf('The boat team'));
    expect(text.indexOf('of 40.')).toBeGreaterThan(text.indexOf('reaching a total'));
    expect(text).not.toContain('1890. of 40.');
    await pdf.destroy();
  });

  it('reads a rotated page from the left column with spaces between words', async () => {
    for (const name of ['rotate90.pdf', 'rotate90-landscape.pdf']) {
      const { pdf, paragraphs } = await parsed(name);
      const text = paragraphs.map((paragraph) => paragraph.text).join('\n');
      expect(text, name).toContain('walked north');
      expect(text, name).toContain('took the');
      expect(text, name).not.toContain('walkednorth');
      expect(text, name).not.toContain('tookthe');
      expect(text.indexOf('ford.'), name).toBeLessThan(text.indexOf('In the afternoon'));
      await pdf.destroy();
    }
  });

  it('does not turn a slightly larger column into chapter headings', async () => {
    const mixed = await parsed('mixed-sizes.pdf');
    const text = mixed.paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(text.indexOf('Walking Team')).toBeLessThan(text.indexOf('walked'));
    expect(text.indexOf('ford.')).toBeLessThan(text.indexOf('In the afternoon'));
    expect(mixed.paragraphs.some((paragraph) => paragraph.kind === 'heading' && /afternoon|spoonbills|salt flats/.test(paragraph.text))).toBe(false);
    const chapters = detectChapters(mixed.paragraphs, mixed.pdf.outline);
    expect(chapters.map((chapter) => chapter.title).join('\n')).not.toMatch(/afternoon|spoonbills/);
    await mixed.pdf.destroy();
    const real = await parsed('mixed-real.pdf');
    expect(real.paragraphs.some((paragraph) => paragraph.kind === 'heading' && paragraph.text === 'Return Walk')).toBe(true);
    const realText = real.paragraphs.map((paragraph) => paragraph.text).join('\n');
    expect(realText.indexOf('Return Walk')).toBeLessThan(realText.indexOf('In the afternoon'));
    await real.pdf.destroy();
  });

  it('marks the scanned fixture as an OCR page', async () => {
    const data = new Uint8Array(await readFile(new URL('../fixtures/scanned.pdf', import.meta.url)));
    const pdf = await parsePdf(data, pdfAssets);
    expect(pdf.pages).toHaveLength(1);
    expect(pdf.pages[0] && pageNeedsOcr(pdf.pages[0])).toBe(true);
    await pdf.destroy();
  });

  it('splits long plain text by length and supports edits', () => {
    const paragraphs = Array.from({ length: 40 }, (_, index) =>
      body(`Paragraph ${index} ` + 'word '.repeat(80).trim(), 1),
    );
    const drafts = detectByLength(paragraphs, 400);
    expect(drafts.length).toBeGreaterThan(1);
    let chapters = materialize(drafts);
    chapters = renameChapter(chapters, 0, 'Opening');
    expect(chapters[0]?.title).toBe('Opening');
    const before = chapters.length;
    const left = chapters[0]!;
    const right = chapters[1]!;
    chapters = mergeWithNext(chapters, 0);
    expect(chapters.length).toBe(before - 1);
    expect(chapters[0]?.text).toContain(left.text.slice(0, 24));
    expect(chapters[0]?.text).toContain(right.text.slice(0, 24));
    expect(chapters[0]?.id).not.toBe(left.id);
    expect(chapters[0]?.id).not.toBe(right.id);
    const mergedId = chapters[0]!.id;
    chapters = splitChapter(chapters, 0, 1);
    expect(chapters.length).toBe(before);
    expect(chapters[0]?.id).not.toBe(mergedId);
    expect(chapters[1]?.id).not.toBe(mergedId);
    expect(chapters[0]?.text.length).toBeGreaterThan(0);
    expect(chapters[1]?.text.length).toBeGreaterThan(0);
    chapters = toggleSkip(chapters, 1);
    expect(chapters[1]?.skipped).toBe(true);
  });
});
