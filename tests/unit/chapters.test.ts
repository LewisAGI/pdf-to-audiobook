import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cleanPages, type Paragraph } from '../../src/lib/clean';
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
