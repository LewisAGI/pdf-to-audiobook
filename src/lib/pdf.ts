import type { Glyph, RawPage } from './clean';
import type { OutlineItem } from './chapters';

export type PdfAssets = {
  workerSrc?: string;
  cMapUrl?: string;
  standardFontDataUrl?: string;
  wasmUrl?: string;
};

export type ParsedPdf = {
  title: string;
  pages: RawPage[];
  outline: OutlineItem[];
  renderPage: (pageNumber: number, scale?: number) => Promise<HTMLCanvasElement>;
  destroy: () => Promise<void>;
};

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
};

type OutlineNode = {
  title?: string;
  dest?: unknown;
  items?: OutlineNode[];
  bold?: boolean;
};

function isTextItem(item: unknown): item is TextItem {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  return typeof record.str === 'string' && Array.isArray(record.transform);
}

function multiplyMatrix(left: number[], right: number[]): number[] {
  return [
    left[0]! * right[0]! + left[2]! * right[1]!,
    left[1]! * right[0]! + left[3]! * right[1]!,
    left[0]! * right[2]! + left[2]! * right[3]!,
    left[1]! * right[2]! + left[3]! * right[3]!,
    left[0]! * right[4]! + left[2]! * right[5]! + left[4]!,
    left[1]! * right[4]! + left[3]! * right[5]! + left[5]!,
  ];
}

function glyphPlacement(
  item: TextItem,
  viewport: { transform: number[]; width: number; height: number },
): { x: number; y: number; width: number; height: number; fontSize: number } {
  const tx = multiplyMatrix(viewport.transform, item.transform);
  const baseX = tx[0] ?? 0;
  const baseY = tx[1] ?? 0;
  const vertX = tx[2] ?? 0;
  const vertY = tx[3] ?? 0;
  const originX = tx[4] ?? 0;
  const originY = tx[5] ?? 0;
  const baseLen = Math.hypot(baseX, baseY) || 1;
  const rawBase = Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0) || 1;
  const fontSize = Math.hypot(vertX, vertY) || item.height || baseLen || 12;
  const advance =
    (item.width > 0 ? item.width : Math.max(1, item.str.length * fontSize * 0.45)) * (baseLen / rawBase);
  const ux = baseX / baseLen;
  const uy = baseY / baseLen;
  if (Math.abs(ux) >= Math.abs(uy)) {
    const endX = originX + ux * advance;
    const top = Math.min(originY, originY + vertY, originY + uy * advance, originY + uy * advance + vertY);
    return {
      x: Math.min(originX, endX),
      y: top,
      width: Math.max(1, Math.abs(endX - originX)),
      height: fontSize,
      fontSize,
    };
  }
  const readingX = uy >= 0 ? originY : viewport.height - originY;
  const readingY = uy >= 0 ? viewport.width - originX : originX;
  return {
    x: readingX,
    y: readingY,
    width: Math.max(1, advance),
    height: fontSize,
    fontSize,
  };
}

function destName(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && 'name' in value && typeof (value as { name: unknown }).name === 'string') {
    return (value as { name: string }).name;
  }
  return '';
}

async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  return import('pdfjs-dist');
}

export async function parsePdf(
  data: Uint8Array,
  assets: PdfAssets = {},
  onProgress?: (ratio: number, label: string) => void,
): Promise<ParsedPdf> {
  const pdfjs = await loadPdfjs();
  pdfjs.GlobalWorkerOptions.workerSrc = assets.workerSrc ?? '/pdfjs/pdf.worker.min.mjs';
  const bytes = new Uint8Array(data);
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: assets.cMapUrl ?? '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assets.standardFontDataUrl ?? '/pdfjs/standard_fonts/',
    wasmUrl: assets.wasmUrl ?? '/pdfjs/wasm/',
    useSystemFonts: true,
    verbosity: 0,
  });
  task.onProgress = (progress: { loaded: number; total: number }) => {
    if (progress.total > 0) onProgress?.(Math.min(0.2, (progress.loaded / progress.total) * 0.2), 'Reading');
  };
  const doc = await task.promise;
  let title = '';
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: string };
    title = typeof info.Title === 'string' ? info.Title.trim() : '';
  } catch {
    title = '';
  }

  const imageOps = new Set(
    [
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageXObjectRepeat,
      pdfjs.OPS.paintImageMaskXObject,
      pdfjs.OPS.paintSolidColorImageMask,
    ].filter((op) => typeof op === 'number'),
  );

  const pages: RawPage[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles ?? {};
    const glyphs: Glyph[] = [];
    for (const item of content.items) {
      if (!isTextItem(item) || !item.str) continue;
      const placed = glyphPlacement(item, viewport);
      const style = styles[item.fontName];
      const family = style && 'fontFamily' in style ? String(style.fontFamily) : '';
      glyphs.push({
        text: item.str,
        x: placed.x,
        y: Math.max(0, placed.y),
        width: placed.width,
        height: placed.height,
        fontSize: placed.fontSize,
        fontName: `${item.fontName} ${family}`.trim(),
      });
    }
    let hasImages = false;
    try {
      const operators = await page.getOperatorList();
      hasImages = operators.fnArray.some((fn) => imageOps.has(fn));
    } catch {
      hasImages = false;
    }
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      glyphs,
      hasImages,
    });
    onProgress?.(0.2 + (pageNumber / doc.numPages) * 0.5, 'Reading');
  }

  const outline = await readOutline({
    getOutline: () => doc.getOutline(),
    getDestination: (dest) => doc.getDestination(dest),
    getPageIndex: (ref) => doc.getPageIndex(ref as never),
    getPage: (pageNumber) => doc.getPage(pageNumber),
  });
  return {
    title,
    pages,
    outline,
    renderPage: async (pageNumber: number, scale = 2) => {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      return canvas;
    },
    destroy: async () => {
      await doc.destroy();
    },
  };
}

async function readOutline(doc: {
  getOutline: () => Promise<OutlineNode[] | null>;
  getDestination: (dest: string) => Promise<unknown>;
  getPageIndex: (ref: unknown) => Promise<number>;
  getPage: (n: number) => Promise<{ getViewport: (opts: { scale: number }) => { height: number } }>;
}): Promise<OutlineItem[]> {
  const tree = await doc.getOutline();
  if (!tree?.length) return [];
  const flat: OutlineItem[] = [];
  const visit = async (nodes: OutlineNode[], level: number) => {
    for (const node of nodes) {
      const resolved = await resolveDest(doc, node.dest);
      if (resolved && node.title?.trim()) {
        flat.push({ title: node.title.trim(), page: resolved.page, y: resolved.y, level });
      }
      if (node.items?.length) await visit(node.items, level + 1);
    }
  };
  await visit(tree, 1);
  return flat;
}

async function resolveDest(
  doc: {
    getDestination: (dest: string) => Promise<unknown>;
    getPageIndex: (ref: unknown) => Promise<number>;
    getPage: (n: number) => Promise<{ getViewport: (opts: { scale: number }) => { height: number } }>;
  },
  dest: unknown,
): Promise<{ page: number; y: number | null } | null> {
  try {
    let explicit = dest;
    if (typeof dest === 'string') explicit = await doc.getDestination(dest);
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const pageIndex = await doc.getPageIndex(explicit[0]);
    const page = pageIndex + 1;
    const kind = destName(explicit[1]);
    let y: number | null = null;
    if (kind === 'XYZ' && typeof explicit[3] === 'number') {
      const viewport = (await doc.getPage(page)).getViewport({ scale: 1 });
      y = Math.max(0, viewport.height - explicit[3]);
    }
    return { page, y };
  } catch {
    return null;
  }
}
