import type { Chapter } from './chapters';
import { decodeWav, encodeWav } from './audio';

export type EngineName = 'kokoro' | 'webspeech';
export type SummaryEngine = 'extractive' | 'llm';

export type BookRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: 'pdf' | 'text';
  voice: string;
  engine: EngineName;
  rate: number;
};

export type AudioRecord = {
  key: string;
  bookId: string;
  chapterId: string;
  voice: string;
  mode: 'full' | 'summary';
  sampleRate: number;
  sentencesDone: number;
  sentenceCount: number;
  complete: boolean;
  duration: number;
  bytes: number;
};

export type PositionRecord = {
  bookId: string;
  chapterIndex: number;
  time: number;
  updatedAt: number;
};

export type Preferences = {
  voice: string;
  engine: EngineName;
  rate: number;
  summaryEngine: SummaryEngine;
  llmEndpoint: string;
  llmModel: string;
};

const DB_NAME = 'pdf-to-audiobook';
const DB_VERSION = 1;

export const DEFAULT_PREFS: Preferences = {
  voice: 'af_heart',
  engine: 'kokoro',
  rate: 1,
  summaryEngine: 'extractive',
  llmEndpoint: 'https://api.openai.com/v1',
  llmModel: 'gpt-4o-mini',
};

let databasePromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chapters')) {
          const store = db.createObjectStore('chapters', { keyPath: 'id' });
          store.createIndex('bookId', 'bookId');
        }
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('positions')) db.createObjectStore('positions', { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  return databasePromise;
}

async function transaction<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const objectStore = tx.objectStore(store);
    Promise.resolve(run(objectStore))
      .then((result) => {
        if (result && typeof result === 'object' && 'onsuccess' in result) {
          const req = result as IDBRequest<T>;
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } else resolve(result as T);
      })
      .catch(reject);
    tx.onerror = () => reject(tx.error);
  });
}

export type StoredChapter = Chapter & { bookId: string; index: number };

export async function saveBook(book: BookRecord, chapters: Chapter[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['books', 'chapters'], 'readwrite');
    tx.objectStore('books').put(book);
    const chapterStore = tx.objectStore('chapters');
    const index = chapterStore.index('bookId');
    const existing = index.getAll(book.id);
    existing.onsuccess = () => {
      const nextIds = new Set(chapters.map((chapter) => chapter.id));
      for (const row of existing.result as StoredChapter[]) {
        if (!nextIds.has(row.id)) chapterStore.delete(row.id);
      }
      chapters.forEach((chapter, position) => {
        chapterStore.put({ ...chapter, bookId: book.id, index: position });
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listBooks(): Promise<BookRecord[]> {
  const rows = await transaction<BookRecord[]>('books', 'readonly', (store) => store.getAll());
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getBook(id: string): Promise<BookRecord | null> {
  const row = await transaction<BookRecord | undefined>('books', 'readonly', (store) => store.get(id));
  return row ?? null;
}

export async function getChapters(bookId: string): Promise<StoredChapter[]> {
  const rows = await transaction<StoredChapter[]>('chapters', 'readonly', (store) => store.index('bookId').getAll(bookId));
  return rows.sort((a, b) => a.index - b.index);
}

export async function putChapters(bookId: string, chapters: Chapter[]): Promise<void> {
  const book = await getBook(bookId);
  if (!book) return;
  await saveBook({ ...book, updatedAt: Date.now() }, chapters);
}

export function audioKey(chapterId: string, voice: string, mode: 'full' | 'summary'): string {
  return `${chapterId}:${voice}:${mode}`;
}

export class StorageQuotaError extends Error {
  constructor() {
    super('Not enough storage');
    this.name = 'StorageQuotaError';
  }
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) return false;
  const name = String(error.name);
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || name === 'StorageQuotaError';
}

async function ensureRoom(bytes: number): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  const quota = estimate.quota ?? 0;
  const usage = estimate.usage ?? 0;
  if (quota > 0 && usage + bytes > quota) throw new StorageQuotaError();
}

async function opfsFile(bookId: string, name: string, create: boolean): Promise<FileSystemFileHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory();
  const books = await root.getDirectoryHandle('books', { create });
  const book = await books.getDirectoryHandle(bookId, { create });
  const audio = await book.getDirectoryHandle('audio', { create });
  return audio.getFileHandle(name, { create });
}

export async function writeAudioBytes(bookId: string, key: string, bytes: Uint8Array): Promise<void> {
  await ensureRoom(bytes.byteLength);
  let quota = false;
  try {
    const handle = await opfsFile(bookId, `${encodeURIComponent(key)}.wav`, true);
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array(bytes));
      await writable.close();
      return;
    }
  } catch (error) {
    if (isQuotaError(error)) quota = true;
  }
  try {
    await transaction('blobs', 'readwrite', (store) => store.put({ key: `${bookId}:${key}`, bytes }));
  } catch (error) {
    if (quota || isQuotaError(error)) throw new StorageQuotaError();
    throw error;
  }
}

export async function readAudioBytes(bookId: string, key: string): Promise<Uint8Array | null> {
  try {
    const handle = await opfsFile(bookId, `${encodeURIComponent(key)}.wav`, false);
    if (handle) {
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
  } catch {
    /* fall through to IndexedDB */
  }
  const row = await transaction<{ bytes?: Uint8Array } | undefined>('blobs', 'readonly', (store) => store.get(`${bookId}:${key}`));
  return row?.bytes ?? null;
}

export async function saveAudio(record: AudioRecord, samples: Float32Array | null): Promise<void> {
  if (samples) {
    const wav = encodeWav(samples, record.sampleRate);
    record.bytes = wav.byteLength;
    record.duration = samples.length / record.sampleRate;
    await writeAudioBytes(record.bookId, record.key, wav);
  }
  await transaction('audio', 'readwrite', (store) => store.put(record));
}

export async function getAudio(key: string): Promise<AudioRecord | null> {
  const row = await transaction<AudioRecord | undefined>('audio', 'readonly', (store) => store.get(key));
  return row ?? null;
}

export async function loadAudioPcm(record: AudioRecord): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const bytes = await readAudioBytes(record.bookId, record.key);
  if (!bytes) return null;
  return decodeWav(bytes);
}

export async function savePosition(position: PositionRecord): Promise<void> {
  await transaction('positions', 'readwrite', (store) => store.put(position));
}

export async function getPosition(bookId: string): Promise<PositionRecord | null> {
  const row = await transaction<PositionRecord | undefined>('positions', 'readonly', (store) => store.get(bookId));
  return row ?? null;
}

export async function rememberBook(id: string | null): Promise<void> {
  await transaction('kv', 'readwrite', (store) => store.put({ key: 'lastBook', value: id }));
}

export async function lastBookId(): Promise<string | null> {
  const row = await transaction<{ value?: string | null } | undefined>('kv', 'readonly', (store) => store.get('lastBook'));
  return row?.value ?? null;
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  const stored: Preferences = {
    voice: prefs.voice,
    engine: prefs.engine,
    rate: prefs.rate,
    summaryEngine: prefs.summaryEngine,
    llmEndpoint: prefs.llmEndpoint,
    llmModel: prefs.llmModel,
  };
  await transaction('kv', 'readwrite', (store) => store.put({ key: 'prefs', value: stored }));
}

export async function loadPreferences(): Promise<Preferences> {
  const row = await transaction<{ value?: Preferences } | undefined>('kv', 'readonly', (store) => store.get('prefs'));
  return { ...DEFAULT_PREFS, ...(row?.value ?? {}) };
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = await openDatabase();
  const chapters = await getChapters(bookId);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['books', 'chapters', 'audio', 'positions', 'blobs'], 'readwrite');
    tx.objectStore('books').delete(bookId);
    tx.objectStore('positions').delete(bookId);
    for (const chapter of chapters) tx.objectStore('chapters').delete(chapter.id);
    const audioStore = tx.objectStore('audio');
    const all = audioStore.getAll();
    all.onsuccess = () => {
      for (const row of all.result as AudioRecord[]) {
        if (row.bookId === bookId) {
          audioStore.delete(row.key);
          tx.objectStore('blobs').delete(`${bookId}:${row.key}`);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const books = await root.getDirectoryHandle('books', { create: false });
      await books.removeEntry(bookId, { recursive: true });
    } catch {
      /* directory may not exist */
    }
  }
}

export async function storageUsage(): Promise<{ used: number; quota: number; library: number }> {
  const estimate =
    typeof navigator !== 'undefined' && navigator.storage?.estimate
      ? await navigator.storage.estimate()
      : { usage: 0, quota: 0 };
  const audio = await transaction<AudioRecord[]>('audio', 'readonly', (store) => store.getAll());
  const library = audio.reduce((sum, row) => sum + (row.bytes || 0), 0);
  return { used: estimate.usage ?? library, quota: estimate.quota ?? 0, library };
}

export async function writeSourcePdf(bookId: string, bytes: Uint8Array): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      const books = await root.getDirectoryHandle('books', { create: true });
      const book = await books.getDirectoryHandle(bookId, { create: true });
      const handle = await book.getFileHandle('source.pdf', { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array(bytes));
      await writable.close();
      return;
    }
  } catch {
    /* IndexedDB holds the file when OPFS is unavailable. */
  }
  await transaction('blobs', 'readwrite', (store) => store.put({ key: `${bookId}:source`, bytes }));
}
