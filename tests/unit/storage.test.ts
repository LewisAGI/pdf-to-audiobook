import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { materialize } from '../../src/lib/chapters';
import { tone } from '../../src/lib/audio';
import {
  DEFAULT_PREFS,
  deleteBook,
  getAudio,
  getChapters,
  getPosition,
  loadPreferences,
  saveAudio,
  saveBook,
  savePosition,
  savePreferences,
  audioKey,
  writeAudioBytes,
  StorageQuotaError,
  type BookRecord,
} from '../../src/lib/storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('library storage', () => {
  it('round-trips books, resume positions, and audio without an API key field', async () => {
    const book: BookRecord = {
      id: 'book-1',
      title: 'Sample',
      createdAt: 1,
      updatedAt: 1,
      source: 'text',
      voice: 'af_heart',
      engine: 'kokoro',
      rate: 1,
    };
    const chapters = materialize([{ title: 'Arrival', text: 'Hello there.', pageStart: 1, pageEnd: 1 }]).map(
      (chapter, index) => ({ ...chapter, id: `c-${index}`, bookId: book.id, index }),
    );
    await saveBook(book, chapters);
    await savePosition({ bookId: book.id, chapterIndex: 0, time: 4.5, updatedAt: 2 });
    const key = audioKey(chapters[0]!.id, 'af_heart', 'full');
    await saveAudio(
      {
        key,
        bookId: book.id,
        chapterId: chapters[0]!.id,
        voice: 'af_heart',
        mode: 'full',
        sampleRate: 16000,
        sentencesDone: 1,
        sentenceCount: 1,
        complete: true,
        duration: 0.2,
        bytes: 0,
      },
      tone(16000, 0.2),
    );
    await savePreferences({ ...DEFAULT_PREFS, llmModel: 'local-model' });
    expect((await getChapters(book.id)).map((chapter) => chapter.title)).toEqual(['Arrival']);
    expect((await getPosition(book.id))?.time).toBe(4.5);
    expect((await getAudio(key))?.complete).toBe(true);
    const prefs = await loadPreferences();
    expect(prefs.llmModel).toBe('local-model');
    expect(JSON.stringify(prefs)).not.toContain('apiKey');
    await deleteBook(book.id);
    expect(await getChapters(book.id)).toEqual([]);
    expect(await getAudio(key)).toBeNull();
  });

  it('throws when the storage ceiling is smaller than the audio', async () => {
    const memory = new Map<string, string>([['pta-quota', '0']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    });
    await expect(writeAudioBytes('book', 'clip', new Uint8Array(32))).rejects.toBeInstanceOf(StorageQuotaError);
  });
});
