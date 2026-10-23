import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';

const outDir = path.resolve('tests/fixtures');

function addOutline(doc: PDFDocument, items: { title: string; page: PDFPage }[]) {
  const context = doc.context;
  const outlinesRef = context.nextRef();
  const refs = items.map(() => context.nextRef());
  items.forEach((item, index) => {
    const dict = context.obj({});
    dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
    dict.set(PDFName.of('Parent'), outlinesRef);
    dict.set(PDFName.of('Dest'), context.obj([item.page.ref, PDFName.of('Fit')]));
    if (index > 0) dict.set(PDFName.of('Prev'), refs[index - 1] as PDFRef);
    const next = refs[index + 1];
    if (next) dict.set(PDFName.of('Next'), next);
    context.assign(refs[index] as PDFRef, dict);
  });
  const outlines = context.obj({});
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlines.set(PDFName.of('First'), refs[0] as PDFRef);
  outlines.set(PDFName.of('Last'), refs[refs.length - 1] as PDFRef);
  outlines.set(PDFName.of('Count'), PDFNumber.of(items.length));
  context.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}

function chrome(page: PDFPage, font: Awaited<ReturnType<PDFDocument['embedFont']>>, pageNumber: number) {
  const height = page.getHeight();
  page.drawText('Sample Book', { x: 72, y: height - 32, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(String(pageNumber), { x: 300, y: 28, size: 10, font });
}

async function outlinePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Sample Book');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const pages = [0, 1, 2, 3].map(() => doc.addPage([612, 792]));
  pages.forEach((page, index) => chrome(page, font, index + 1));

  const first = pages[0]!;
  first.drawText('Arrival', { x: 72, y: 720, size: 22, font: bold });
  first.drawText('The council recon-', { x: 72, y: 680, size: 12, font });
  first.drawText('sidered the plan after the storm.', { x: 72, y: 662, size: 12, font });
  first.drawText('A footnote marker sits beside the minutes.', { x: 72, y: 630, size: 12, font });
  first.drawText('1 Archived minutes of the council.', { x: 72, y: 48, size: 8, font });

  const second = pages[1]!;
  second.drawText('The river kept its old name.', { x: 72, y: 700, size: 12, font });
  second.drawText('Lanterns were counted twice.', { x: 72, y: 682, size: 12, font });

  const third = pages[2]!;
  third.drawText('Departure', { x: 72, y: 720, size: 22, font: bold });
  third.drawText('They left at dusk with the maps.', { x: 72, y: 680, size: 12, font });

  const fourth = pages[3]!;
  fourth.drawText('References', { x: 72, y: 720, size: 18, font: bold });
  fourth.drawText('Smith, A. A history of maps. 1999.', { x: 72, y: 690, size: 12, font });

  addOutline(doc, [
    { title: 'Arrival', page: first },
    { title: 'Departure', page: third },
  ]);
  return doc.save();
}

async function headingsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Field Guide');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const first = doc.addPage([612, 792]);
  const second = doc.addPage([612, 792]);
  for (const [page, number] of [
    [first, 1],
    [second, 2],
  ] as const) {
    page.drawText('Field Notes', { x: 72, y: page.getHeight() - 32, size: 9, font });
    page.drawText(String(number), { x: 300, y: 28, size: 9, font });
  }
  first.drawText('Gardens', { x: 72, y: 700, size: 22, font: bold });
  first.drawText('The beds were squared before sunrise and the soil was watered by hand.', {
    x: 72,
    y: 660,
    size: 12,
    font,
  });
  second.drawText('Harvest', { x: 72, y: 700, size: 22, font: bold });
  second.drawText('Fruit was carried in wide baskets down to the lane.', { x: 72, y: 660, size: 12, font });
  return doc.save();
}

async function plainPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Long Notes');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const unit = 'ALPHA_MARKER The river carried maps and quiet stories through the valley while the council kept its minutes.';
  const words = Array.from({ length: 250 }, () => unit).join(' ').split(/\s+/);
  words.push('OMEGA_MARKER');
  let page = doc.addPage([612, 792]);
  let y = 740;
  let line = '';
  const flush = () => {
    if (!line) return;
    page.drawText(line, { x: 72, y, size: 12, font });
    y -= 16;
    line = '';
    if (y < 72) {
      page = doc.addPage([612, 792]);
      y = 740;
    }
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, 12) > 460) flush();
    line = line ? `${line} ${word}` : word;
  }
  flush();
  return doc.save();
}

async function scannedPdf(): Promise<Uint8Array> {
  const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  GlobalFonts.registerFromPath(fontPath, 'DejaVu');
  const canvas = createCanvas(1600, 500);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 1600, 500);
  context.fillStyle = '#000000';
  context.font = '72px DejaVu';
  context.fillText('The council reconvened at dawn.', 80, 220);
  const png = canvas.toBuffer('image/png');
  await writeFile(path.join(outDir, 'scanned-page.png'), png);
  const doc = await PDFDocument.create();
  doc.setTitle('Scanned Minutes');
  const page = doc.addPage([612, 792]);
  const image = await doc.embedPng(png);
  const scaled = image.scale(0.35);
  page.drawImage(image, { x: 36, y: 360, width: scaled.width, height: scaled.height });
  return doc.save();
}

async function referencesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Return Book');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const opening = doc.addPage([612, 792]);
  const references = doc.addPage([612, 792]);
  const returning = doc.addPage([612, 792]);
  opening.drawText('Opening', { x: 72, y: 700, size: 22, font: bold });
  opening.drawText('The river kept its name.', { x: 72, y: 660, size: 12, font });
  references.drawText('References', { x: 72, y: 700, size: 22, font: bold });
  references.drawText('Smith, A. A history of maps.', { x: 72, y: 660, size: 12, font });
  returning.drawText('The Return', { x: 72, y: 700, size: 22, font: bold });
  returning.drawText('They came back at dusk.', { x: 72, y: 660, size: 12, font });
  return doc.save();
}

async function paperPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Wide Paper');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([612, 792]);
  page.drawText('TITLEBLOCK birds of the wide estuary', { x: 72, y: 700, size: 18, font: bold });
  page.drawText('Abstract line stays across the whole page from shore to shore.', { x: 72, y: 660, size: 12, font });
  page.drawText('The abstract keeps one wide measure above the columns.', { x: 72, y: 642, size: 12, font });
  page.drawText('LEFTPAPER', { x: 72, y: 580, size: 20, font: bold });
  page.drawText('Left paper stays.', { x: 72, y: 548, size: 12, font });
  page.drawText('The left paper column kept reading.', { x: 72, y: 530, size: 12, font });
  page.drawText('LEFTPAPEREND', { x: 72, y: 490, size: 20, font: bold });
  page.drawText('RIGHTPAPER', { x: 340, y: 580, size: 20, font: bold });
  page.drawText('Right paper stays.', { x: 340, y: 548, size: 12, font });
  page.drawText('The right paper column kept reading.', { x: 340, y: 530, size: 12, font });
  page.drawText('RIGHTPAPEREND', { x: 340, y: 490, size: 20, font: bold });
  page.drawText('CAPTIONBLOCK spans the page under both columns.', { x: 72, y: 200, size: 12, font });
  return doc.save();
}

async function columnsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Two Columns');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([612, 792]);
  page.drawText('Columns', { x: 72, y: 760, size: 9, font });
  page.drawText('4', { x: 300, y: 28, size: 9, font });
  page.drawText('LEFTMARK', { x: 72, y: 700, size: 20, font: bold });
  page.drawText('Left river stays.', { x: 72, y: 670, size: 12, font });
  page.drawText('The left column kept reading.', { x: 72, y: 650, size: 12, font });
  page.drawText('LEFTEND', { x: 72, y: 610, size: 20, font: bold });
  page.drawText('RIGHTMARK', { x: 340, y: 700, size: 20, font: bold });
  page.drawText('Right maps stay.', { x: 340, y: 670, size: 12, font });
  page.drawText('The right column kept reading.', { x: 340, y: 650, size: 12, font });
  page.drawText('RIGHTEND', { x: 340, y: 610, size: 20, font: bold });
  return doc.save();
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'outline.pdf'), await outlinePdf());
await writeFile(path.join(outDir, 'headings.pdf'), await headingsPdf());
await writeFile(path.join(outDir, 'plain.pdf'), await plainPdf());
await writeFile(path.join(outDir, 'scanned.pdf'), await scannedPdf());
await writeFile(path.join(outDir, 'references.pdf'), await referencesPdf());
await writeFile(path.join(outDir, 'columns.pdf'), await columnsPdf());
await writeFile(path.join(outDir, 'paper.pdf'), await paperPdf());
console.log('fixtures written');
