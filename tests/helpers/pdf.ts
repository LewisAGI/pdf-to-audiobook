import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PdfAssets } from '../../src/lib/pdf';

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('pdfjs-dist/package.json'));

export const pdfAssets: PdfAssets = {
  workerSrc: pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')).href,
  cMapUrl: pathToFileURL(path.join(root, 'cmaps') + path.sep).href,
  standardFontDataUrl: pathToFileURL(path.join(root, 'standard_fonts') + path.sep).href,
  wasmUrl: pathToFileURL(path.join(root, 'wasm') + path.sep).href,
};
