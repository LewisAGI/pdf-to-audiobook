import type { Glyph } from './clean';

type OcrWord = {
  text?: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
};

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;

function simdSupported(): boolean {
  try {
    return WebAssembly.validate(
      Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11),
    );
  } catch {
    return false;
  }
}

async function browserWorker(onProgress?: (ratio: number) => void): Promise<import('tesseract.js').Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const core = simdSupported()
        ? '/tesseract/tesseract-core-simd-lstm.wasm.js'
        : '/tesseract/tesseract-core-lstm.wasm.js';
      return createWorker('eng', 1, {
        workerPath: '/tesseract/worker.min.js',
        corePath: core,
        langPath: '/tessdata',
        gzip: false,
        workerBlobURL: false,
        logger: (message) => {
          if (typeof message.progress === 'number') onProgress?.(message.progress);
        },
      });
    })();
  }
  return workerPromise;
}

export async function recognizeGlyphs(
  image: HTMLCanvasElement | Blob,
  onProgress?: (ratio: number) => void,
): Promise<Glyph[]> {
  const worker = await browserWorker(onProgress);
  const result = await worker.recognize(image);
  const words = (result.data.words ?? []) as OcrWord[];
  return words
    .filter((word) => word.text?.trim() && word.bbox)
    .map((word) => {
      const box = word.bbox!;
      const height = Math.max(8, box.y1 - box.y0);
      return {
        text: `${word.text!.trim()} `,
        x: box.x0,
        y: box.y0,
        width: Math.max(1, box.x1 - box.x0),
        height,
        fontSize: height,
        fontName: 'ocr',
      };
    });
}

export async function recognizeText(
  image: Blob | Buffer,
  options?: { langPath?: string },
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const browser = typeof document !== 'undefined';
  const worker = await createWorker('eng', 1, {
    langPath: options?.langPath ?? (browser ? '/tessdata' : options?.langPath),
    gzip: false,
    ...(browser
      ? {
          workerPath: '/tesseract/worker.min.js',
          corePath: simdSupported()
            ? '/tesseract/tesseract-core-simd-lstm.wasm.js'
            : '/tesseract/tesseract-core-lstm.wasm.js',
          workerBlobURL: false,
        }
      : {}),
  });
  try {
    const result = await worker.recognize(image as Blob);
    return result.data.text ?? '';
  } finally {
    await worker.terminate();
  }
}
