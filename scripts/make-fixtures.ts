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

function drawCentered(
  page: PDFPage,
  text: string,
  y: number,
  size: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - width) / 2, y, size, font });
}

async function centreTitlePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Centred Title');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([612, 792]);
  drawCentered(page, 'CENTRETITLE', 700, 16, bold);
  page.drawText('LEFTCENTRE', { x: 72, y: 620, size: 16, font: bold });
  page.drawText('Left of the centred title.', { x: 72, y: 590, size: 12, font });
  page.drawText('LEFTCENTREEND', { x: 72, y: 550, size: 16, font: bold });
  page.drawText('RIGHTCENTRE', { x: 360, y: 620, size: 16, font: bold });
  page.drawText('Right of the centred title.', { x: 360, y: 590, size: 12, font });
  page.drawText('RIGHTCENTREEND', { x: 360, y: 550, size: 16, font: bold });
  return doc.save();
}

async function centreCaptionPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Centred Caption');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([612, 792]);
  page.drawText('LEFTBEFORE', { x: 72, y: 680, size: 16, font: bold });
  page.drawText('Left before the caption.', { x: 72, y: 650, size: 12, font });
  page.drawText('RIGHTBEFORE', { x: 360, y: 680, size: 16, font: bold });
  page.drawText('Right before the caption.', { x: 360, y: 650, size: 12, font });
  drawCentered(page, 'CENTRECAPTION', 520, 12, font);
  page.drawText('LEFTAFTER', { x: 72, y: 400, size: 16, font: bold });
  page.drawText('Left after the caption.', { x: 72, y: 370, size: 12, font });
  page.drawText('RIGHTAFTER', { x: 360, y: 400, size: 16, font: bold });
  page.drawText('Right after the caption.', { x: 360, y: 370, size: 12, font });
  return doc.save();
}

async function figureColumnPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Figure Column');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 56, y: 430, width: 220, height: 150, color: rgb(0.85, 0.85, 0.85) });
  page.drawText('ABOVELEFT', { x: 72, y: 680, size: 16, font: bold });
  page.drawText('Left above the figure.', { x: 72, y: 650, size: 12, font });
  page.drawText('ABOVERIGHT', { x: 360, y: 680, size: 16, font: bold });
  page.drawText('Right above the figure.', { x: 360, y: 650, size: 12, font });
  page.drawText('BESIDEA', { x: 360, y: 560, size: 16, font: bold });
  page.drawText('Beside the figure.', { x: 360, y: 530, size: 12, font });
  page.drawText('BESIDEB', { x: 360, y: 480, size: 16, font: bold });
  page.drawText('BELOWLEFT', { x: 72, y: 360, size: 16, font: bold });
  page.drawText('Left below the figure.', { x: 72, y: 330, size: 12, font });
  page.drawText('BELOWRIGHT', { x: 360, y: 360, size: 16, font: bold });
  page.drawText('Right below the figure.', { x: 360, y: 330, size: 12, font });
  return doc.save();
}

async function unevenPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Uneven Columns');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([612, 792]);
  page.drawText('WIDELEFT', { x: 48, y: 680, size: 12, font: bold });
  page.drawText('The wide left column keeps its long measure across the estuary.', { x: 48, y: 650, size: 12, font });
  page.drawText('WIDELEFTEND', { x: 48, y: 600, size: 12, font: bold });
  page.drawText('NARROWRIGHT', { x: 470, y: 680, size: 12, font: bold });
  page.drawText('Narrow.', { x: 470, y: 650, size: 12, font });
  page.drawText('NARROWRIGHTEND', { x: 470, y: 600, size: 12, font: bold });
  return doc.save();
}

async function threeColumnsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Three Columns');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([612, 792]);
  for (const [x, mark, body] of [
    [36, 'COL1A', 'Left column of three.'],
    [230, 'COL2A', 'Middle column of three.'],
    [430, 'COL3A', 'Right column of three.'],
  ] as const) {
    page.drawText(mark, { x, y: 680, size: 14, font: bold });
    page.drawText(body, { x, y: 650, size: 11, font });
    page.drawText(mark.replace('A', 'B'), { x, y: 610, size: 14, font: bold });
  }
  return doc.save();
}

async function wideTablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Wide Table');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([612, 792]);
  const rows = [
    ['Species', 'Mon', 'Tue', 'Wed'],
    ['Heron', '14', '12', '9'],
    ['Plover', '40', '38', '41'],
    ['Egret', '2', '4', '5'],
  ];
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, cellIndex) => {
      page.drawText(cell, { x: 72 + cellIndex * 120, y: 640 - rowIndex * 28, size: 12, font });
    });
  });
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
await writeFile(path.join(outDir, 'centre-title.pdf'), await centreTitlePdf());
await writeFile(path.join(outDir, 'centre-caption.pdf'), await centreCaptionPdf());
await writeFile(path.join(outDir, 'figure-column.pdf'), await figureColumnPdf());
await writeFile(path.join(outDir, 'uneven.pdf'), await unevenPdf());
await writeFile(path.join(outDir, 'three-columns.pdf'), await threeColumnsPdf());
await writeFile(path.join(outDir, 'wide-table.pdf'), await wideTablePdf());
console.log('fixtures written');
