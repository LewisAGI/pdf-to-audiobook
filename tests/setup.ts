import '../src/lib/polyfills';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

const globals = globalThis as unknown as Record<string, unknown>;
if (!globals.DOMMatrix) globals.DOMMatrix = DOMMatrix;
if (!globals.ImageData) globals.ImageData = ImageData;
if (!globals.Path2D) globals.Path2D = Path2D;

await import('pdfjs-dist/build/pdf.worker.mjs');
