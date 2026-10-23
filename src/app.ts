import { cleanPages, cleanPlainText, pageNeedsOcr, type RawPage } from './lib/clean';
import {
  detectChapters,
  materialize,
  mergeWithNext,
  renameChapter,
  setChapterMode,
  splitChapter,
  splitParagraphs,
  spokenText,
  toggleSkip,
  type Chapter,
} from './lib/chapters';
import { formatClock, sanitizeResume } from './lib/resume';
import { summarizeExtractive } from './lib/summary';
import { readLlmKey, summarizeWithLlm, writeLlmKey } from './lib/llm';
import { recognizeGlyphs } from './lib/ocr';
import { parsePdf } from './lib/pdf';
import {
  audioKey,
  deleteBook,
  getAudio,
  getBook,
  getChapters,
  getPosition,
  lastBookId,
  listBooks,
  loadAudioPcm,
  loadPreferences,
  rememberBook,
  saveAudio,
  saveBook,
  savePosition,
  savePreferences,
  storageUsage,
  writeSourcePdf,
  type AudioRecord,
  type BookRecord,
  type Preferences,
  type StoredChapter,
} from './lib/storage';
import { SpeechEngine, stubRequested, webSpeechSupported } from './lib/tts';
import { exportM4b, exportMp3Zip } from './lib/export';
import { escapeHtml, iconButton, icons, installTooltips } from './ui';

const VOICES = [
  ['af_heart', 'Heart'],
  ['af_bella', 'Bella'],
  ['af_sarah', 'Sarah'],
  ['af_nicole', 'Nicole'],
  ['am_michael', 'Michael'],
  ['am_adam', 'Adam'],
  ['bf_emma', 'Emma'],
  ['bm_george', 'George'],
] as const;

type Sheet =
  | null
  | { name: 'add' | 'paste' | 'chapters' | 'speed' | 'sleep' | 'voice' | 'more' | 'summary' | 'storage' | 'export' | 'delete' }
  | { name: 'chapter' | 'rename' | 'split'; index: number };

type Busy = { label: string; ratio: number } | null;

export class App {
  private books: BookRecord[] = [];
  private book: BookRecord | null = null;
  private chapters: StoredChapter[] = [];
  private index = 0;
  private sheet: Sheet = null;
  private busy: Busy = null;
  private toast = '';
  private toastTimer = 0;
  private prefs: Preferences = {
    voice: 'af_heart',
    engine: 'kokoro',
    rate: 1,
    summaryEngine: 'extractive',
    llmEndpoint: 'https://api.openai.com/v1',
    llmModel: 'gpt-4o-mini',
  };
  private shownTime = 0;
  private objectUrl: string | null = null;
  private speech = new SpeechEngine();
  private sleep: 'off' | 'chapter' | number = 'off';
  private sleepClock = 0;
  private coverUrl = '';
  private generating = false;
  private fileInput: HTMLInputElement;

  constructor(
    private root: HTMLElement,
    private audio: HTMLAudioElement,
  ) {
    this.fileInput = document.querySelector('#pdf-file') as HTMLInputElement;
    installTooltips(document);
    this.root.addEventListener('click', (event) => void this.onClick(event));
    this.root.addEventListener('change', (event) => void this.onChange(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeSheet();
    });
    this.fileInput.addEventListener('change', () => void this.onFile());
    this.audio.addEventListener('timeupdate', () => this.onTime());
    this.audio.addEventListener('ended', () => void this.onEnded());
    this.audio.addEventListener('play', () => this.render());
    this.audio.addEventListener('pause', () => this.render());
    window.addEventListener('keydown', (event) => {
      if (event.key !== ' ' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      void this.togglePlay();
    });
    window.addEventListener('pagehide', () => void this.persistPosition());
    document.addEventListener('dragover', (event) => event.preventDefault());
    document.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) void this.importPdf(file);
    });
    this.bindSession();
  }

  async start() {
    this.prefs = await loadPreferences();
    this.books = await listBooks();
    const last = await lastBookId();
    if (last) await this.openBook(last, false);
    else this.render();
  }

  private bindSession() {
    if (!('mediaSession' in navigator)) return;
    const actions: [MediaSessionAction, () => void][] = [
      ['play', () => void this.togglePlay()],
      ['pause', () => this.audio.pause()],
      ['previoustrack', () => void this.skipChapter(-1)],
      ['nexttrack', () => void this.skipChapter(1)],
      ['seekbackward', () => void this.seekBy(-15)],
      ['seekforward', () => void this.seekBy(15)],
    ];
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    }
  }

  private render() {
    const sheet = this.sheetView();
    const main = this.book ? this.playerView() : this.libraryView();
    const toast = this.toast ? `<p class="toast" role="status">${escapeHtml(this.toast)}</p>` : '';
    this.root.innerHTML = `${main}${sheet}${toast}`;
    const elapsed = this.root.querySelector<HTMLElement>('#elapsed');
    if (elapsed) elapsed.dataset.saved = String(this.shownTime);
    const seek = this.root.querySelector<HTMLInputElement>('#seek');
    if (seek && this.audio.duration) {
      seek.value = String((this.audio.currentTime / this.audio.duration) * 1000);
    }
    const dialog = this.root.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    this.syncSession();
  }

  private libraryView(): string {
    const items = this.books
      .map((book) => {
        const count = '';
        return `<li><button class="book" data-action="open" data-id="${book.id}"><strong>${escapeHtml(book.title)}</strong><span>${count}</span></button></li>`;
      })
      .join('');
    return `<main class="shell">
      <header class="top">
        <h1>Library</h1>
        <div class="top-actions">
          ${iconButton('storage', 'Storage', icons.storage)}
          ${iconButton('add', 'Add', icons.add)}
        </div>
      </header>
      <ul class="books">${items}</ul>
    </main>`;
  }

  private playerView(): string {
    const chapter = this.chapters[this.index];
    const title = this.book?.title ?? '';
    const notice =
      chapter?.mode === 'summary'
        ? `<p class="notice">${chapter.summaryKind === 'llm' ? 'AI-generated summary' : 'Automatic summary'}</p>`
        : '';
    const playing = !this.audio.paused && !this.audio.ended;
    const playIcon = this.generating ? `<span class="stat">${Math.round((this.busy?.ratio ?? 0) * 100)}</span>` : playing ? icons.pause : icons.play;
    const playLabel = playing ? 'Pause' : 'Play';
    return `<main class="shell">
      <header class="top">
        ${iconButton('library', 'Library', icons.back)}
        <div class="top-actions">${iconButton('more', 'More', icons.more)}</div>
      </header>
      <section class="stage">
        <h1>${escapeHtml(title)}</h1>
        <p class="chapter-name">${escapeHtml(chapter?.title ?? '')}</p>
        ${notice}
      </section>
      <div class="timeline">
        <span id="elapsed" data-testid="elapsed" data-saved="${this.shownTime}">${formatClock(this.displayTime())}</span>
        <input id="seek" data-action="seek" type="range" min="0" max="1000" value="0" aria-label="Position" />
        <span id="duration">${formatClock(this.audio.duration || 0)}</span>
      </div>
      <div class="transport">
        ${iconButton('back30', 'Back 30 seconds', icons.back30)}
        ${iconButton('back15', 'Back 15 seconds', icons.back15)}
        <button type="button" class="icon-btn play" data-action="toggle" data-tip="${playLabel}" aria-label="${playLabel}">${playIcon}</button>
        ${iconButton('fwd15', 'Forward 15 seconds', icons.fwd15)}
        ${iconButton('fwd30', 'Forward 30 seconds', icons.fwd30)}
      </div>
      <div class="tools">
        ${iconButton('chapters', 'Chapters', icons.chapters)}
        <button type="button" class="icon-btn rate-chip" data-action="speed" data-tip="Speed" aria-label="Speed">${this.rateLabel()}</button>
        ${iconButton('sleep', 'Sleep', icons.sleep, this.sleep === 'off' ? '' : 'aria-pressed="true"')}
      </div>
    </main>`;
  }

  private sheetView(): string {
    if (this.busy && !this.generating) return this.busySheet();
    if (!this.sheet) return '';
    const body = this.sheetBody();
    const title = this.sheetTitle();
    return `<div class="sheet-root">
      <button class="backdrop" data-action="close" aria-label="Close"></button>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header><h2>${escapeHtml(title)}</h2>${iconButton('close', 'Close', icons.close)}</header>
        <div class="sheet-body">${body}</div>
      </div>
    </div>`;
  }

  private busySheet(): string {
    const ratio = Math.round((this.busy?.ratio ?? 0) * 100);
    return `<div class="sheet-root"><div class="sheet" role="dialog" aria-label="${escapeHtml(this.busy?.label ?? 'Working')}">
      <p class="busy-label">${escapeHtml(this.busy?.label ?? '')}</p>
      <div id="busy-bar" class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio}"><span></span></div>
      <p class="stat" id="busy-value">${ratio}%</p>
    </div></div>`;
  }

  private sheetTitle(): string {
    if (!this.sheet) return '';
    if (this.sheet.name === 'chapter') return this.chapters[this.sheet.index]?.title ?? 'Chapter';
    if (this.sheet.name === 'rename') return 'Rename';
    if (this.sheet.name === 'split') return 'Split';
    const titles: Record<string, string> = {
      add: 'Add',
      paste: 'Paste',
      chapters: 'Chapters',
      speed: 'Speed',
      sleep: 'Sleep',
      voice: 'Voice',
      more: 'More',
      summary: 'Summary',
      storage: 'Storage',
      export: 'Export',
      delete: this.book?.title ?? 'Delete',
    };
    return titles[this.sheet.name] ?? '';
  }

  private sheetBody(): string {
    if (!this.sheet) return '';
    if (this.sheet.name === 'add') {
      return `<div class="icon-col">${iconButton('pick-pdf', 'Add PDF', icons.pdf)}${iconButton('paste', 'Paste text', icons.paste)}</div>`;
    }
    if (this.sheet.name === 'paste') {
      return `<textarea id="paste-text" aria-label="Article text"></textarea>${iconButton('save-paste', 'Save', icons.check)}`;
    }
    if (this.sheet.name === 'chapters') {
      return this.chapters
        .map((chapter, index) => {
          const cls = chapter.skipped ? 'chapter-row skipped' : 'chapter-row';
          return `<div class="${cls}">
            <button class="chapter-main" data-action="jump" data-index="${index}" aria-label="${escapeHtml(chapter.title)}">${escapeHtml(chapter.title)}</button>
            ${iconButton('chapter', 'Edit chapter', icons.edit, `data-index="${index}"`)}
          </div>`;
        })
        .join('');
    }
    if (this.sheet.name === 'chapter') {
      const chapter = this.chapters[this.sheet.index];
      if (!chapter) return '';
      return `<div class="icon-col">
        ${iconButton('rename', 'Rename', icons.edit, `data-index="${this.sheet.index}"`)}
        ${iconButton('merge', 'Merge with next', icons.merge, `data-index="${this.sheet.index}"`)}
        ${iconButton('split', 'Split', icons.split, `data-index="${this.sheet.index}"`)}
        ${iconButton('skip', chapter.skipped ? 'Include' : 'Skip', icons.skip, `data-index="${this.sheet.index}"`)}
        ${iconButton('mode-full', 'Full read', icons.book, `data-index="${this.sheet.index}" ${chapter.mode === 'full' ? 'aria-pressed="true"' : ''}`)}
        ${iconButton('mode-summary', 'Summary', icons.spark, `data-index="${this.sheet.index}" ${chapter.mode === 'summary' ? 'aria-pressed="true"' : ''}`)}
      </div>`;
    }
    if (this.sheet.name === 'rename') {
      const chapter = this.chapters[this.sheet.index];
      return `<input class="field" id="rename-input" aria-label="Chapter title" value="${escapeHtml(chapter?.title ?? '')}" />${iconButton('save-rename', 'Save', icons.check, `data-index="${this.sheet.index}"`)}`;
    }
    if (this.sheet.name === 'split') {
      const chapter = this.chapters[this.sheet.index];
      const parts = splitParagraphs(chapter?.text ?? '');
      return parts
        .map((part, index) =>
          index === 0
            ? `<p>${escapeHtml(part)}</p>`
            : `<button class="menu-row" data-action="do-split" data-index="${this.sheet && 'index' in this.sheet ? this.sheet.index : 0}" data-at="${index}">${escapeHtml(part.slice(0, 140))}</button>`,
        )
        .join('');
    }
    if (this.sheet.name === 'speed') {
      return `<p class="stat" id="rate-readout">${this.rateLabel()}</p><input id="rate" data-action="rate" type="range" min="0.75" max="2.5" step="0.05" value="${this.prefs.rate}" aria-label="Speed" />`;
    }
    if (this.sheet.name === 'sleep') {
      return [15, 30, 45, 60]
        .map((minutes) => `<button class="menu-row" data-action="sleep-min" data-min="${minutes}" aria-label="${minutes} minutes">${minutes}</button>`)
        .join('')
        .concat(iconButton('sleep-chapter', 'End of chapter', icons.chapters))
        .concat(iconButton('sleep-off', 'Sleep off', icons.close));
    }
    if (this.sheet.name === 'voice') {
      const rows = VOICES.map(
        ([id, label]) =>
          `<button class="menu-row" data-action="voice" data-voice="${id}" ${this.prefs.voice === id && this.prefs.engine === 'kokoro' ? 'aria-pressed="true"' : ''}>${label}</button>`,
      ).join('');
      return `${rows}${iconButton('system-voice', 'System voice', icons.voice, this.prefs.engine === 'webspeech' ? 'aria-pressed="true"' : '')}`;
    }
    if (this.sheet.name === 'more') {
      return `<div class="icon-col">
        ${iconButton('export', 'Export', icons.download)}
        ${iconButton('voice', 'Voice', icons.voice)}
        ${iconButton('summary', 'Summary', icons.summary)}
        ${iconButton('storage', 'Storage', icons.storage)}
        ${iconButton('delete', 'Delete', icons.trash)}
      </div>`;
    }
    if (this.sheet.name === 'export') {
      return `<div class="icon-col">${iconButton('export-mp3', 'Export MP3', icons.download)}${iconButton('export-m4b', 'Export M4B', icons.book)}</div>`;
    }
    if (this.sheet.name === 'summary') {
      const key = readLlmKey(localStorage);
      return `<div class="icon-col">
        ${iconButton('engine-extractive', 'Automatic summary', icons.spark, this.prefs.summaryEngine === 'extractive' ? 'aria-pressed="true"' : '')}
        ${iconButton('engine-llm', 'API summary', icons.summary, this.prefs.summaryEngine === 'llm' ? 'aria-pressed="true"' : '')}
      </div>
      <input class="field" id="llm-endpoint" aria-label="Endpoint" value="${escapeHtml(this.prefs.llmEndpoint)}" />
      <input class="field" id="llm-model" aria-label="Model" value="${escapeHtml(this.prefs.llmModel)}" />
      <input class="field" id="llm-key" type="password" aria-label="API key" autocomplete="off" value="${escapeHtml(key)}" />
      ${iconButton('save-llm', 'Save', icons.check)}`;
    }
    if (this.sheet.name === 'storage') return `<div id="storage-slot" class="stat">…</div>`;
    if (this.sheet.name === 'delete') return iconButton('confirm-delete', 'Delete', icons.trash);
    return '';
  }

  private async onClick(event: Event) {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action ?? '';
    const index = Number(target.dataset.index ?? -1);
    if (action === 'add') this.openSheet({ name: 'add' });
    else if (action === 'close') this.closeSheet();
    else if (action === 'library') {
      this.audio.pause();
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      await this.persistPosition();
      this.book = null;
      this.sheet = null;
      this.books = await listBooks();
      await rememberBook(null);
      this.render();
    } else if (action === 'pick-pdf') this.fileInput.click();
    else if (action === 'paste') this.openSheet({ name: 'paste' });
    else if (action === 'save-paste') await this.savePaste();
    else if (action === 'open' && target.dataset.id) await this.openBook(target.dataset.id, true);
    else if (action === 'more') this.openSheet({ name: 'more' });
    else if (action === 'chapters') this.openSheet({ name: 'chapters' });
    else if (action === 'chapter') this.openSheet({ name: 'chapter', index });
    else if (action === 'jump') {
      this.closeSheet();
      await this.playChapter(index, 0);
    } else if (action === 'rename') this.openSheet({ name: 'rename', index });
    else if (action === 'save-rename') await this.saveRename(index);
    else if (action === 'merge') await this.edit((chapters) => mergeWithNext(chapters, index));
    else if (action === 'split') this.openSheet({ name: 'split', index });
    else if (action === 'do-split') await this.edit((chapters) => splitChapter(chapters, index, Number(target.dataset.at ?? 0)));
    else if (action === 'skip') await this.edit((chapters) => toggleSkip(chapters, index));
    else if (action === 'mode-full') await this.setMode(index, 'full');
    else if (action === 'mode-summary') await this.setMode(index, 'summary');
    else if (action === 'toggle') await this.togglePlay();
    else if (action === 'back15') await this.seekBy(-15);
    else if (action === 'back30') await this.seekBy(-30);
    else if (action === 'fwd15') await this.seekBy(15);
    else if (action === 'fwd30') await this.seekBy(30);
    else if (action === 'speed') this.openSheet({ name: 'speed' });
    else if (action === 'sleep') this.openSheet({ name: 'sleep' });
    else if (action === 'sleep-min') this.setSleep(Number(target.dataset.min ?? 0));
    else if (action === 'sleep-chapter') this.setSleep('chapter');
    else if (action === 'sleep-off') this.setSleep('off');
    else if (target.dataset.voice) await this.chooseVoice(target.dataset.voice);
    else if (action === 'voice') this.openSheet({ name: 'voice' });
    else if (action === 'system-voice') await this.chooseEngine('webspeech');
    else if (action === 'export') this.openSheet({ name: 'export' });
    else if (action === 'export-mp3') await this.exportZip();
    else if (action === 'export-m4b') await this.exportBook();
    else if (action === 'summary') this.openSheet({ name: 'summary' });
    else if (action === 'engine-extractive') await this.setSummaryEngine('extractive');
    else if (action === 'engine-llm') await this.setSummaryEngine('llm');
    else if (action === 'save-llm') await this.saveLlm();
    else if (action === 'storage') {
      this.openSheet({ name: 'storage' });
      void this.fillStorage();
    } else if (action === 'delete') this.openSheet({ name: 'delete' });
    else if (action === 'confirm-delete' && this.book) {
      const id = this.book.id;
      this.audio.pause();
      await deleteBook(id);
      this.book = null;
      this.chapters = [];
      this.sheet = null;
      this.books = await listBooks();
      await rememberBook(null);
      this.render();
    }
  }

  private onInput(event: Event) {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (target.id === 'rate') {
      this.prefs.rate = clampRate(Number(target.value));
      this.audio.playbackRate = this.prefs.rate;
      const readout = this.root.querySelector('#rate-readout');
      if (readout) readout.textContent = this.rateLabel();
      void savePreferences(this.prefs);
      if (this.book) {
        this.book.rate = this.prefs.rate;
        void saveBook(this.book, this.chapters);
      }
    }
    if (target.id === 'seek') {
      const duration = this.audio.duration;
      if (Number.isFinite(duration) && duration > 0) {
        this.audio.currentTime = (Number(target.value) / 1000) * duration;
        this.shownTime = this.audio.currentTime;
        this.paintTime();
        void this.persistPosition();
      }
    }
  }

  private onChange(event: Event) {
    const target = event.target as HTMLInputElement | null;
    if (target?.id === 'pdf-file') void this.onFile();
  }

  private async onFile() {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (file) await this.importPdf(file);
  }

  private openSheet(sheet: Sheet) {
    this.sheet = sheet;
    this.render();
    if (sheet?.name === 'storage') void this.fillStorage();
  }

  private closeSheet() {
    this.sheet = null;
    this.render();
  }

  private async openBook(id: string, playFromStart: boolean) {
    const book = await getBook(id);
    if (!book) return;
    this.book = book;
    this.chapters = await getChapters(id);
    this.prefs.voice = book.voice || this.prefs.voice;
    this.prefs.engine = book.engine || this.prefs.engine;
    this.prefs.rate = book.rate || this.prefs.rate;
    this.audio.playbackRate = this.prefs.rate;
    const saved = await getPosition(id);
    const point = sanitizeResume(saved, this.chapters, null);
    this.index = point.chapterIndex;
    this.shownTime = playFromStart ? 0 : point.time;
    this.sheet = null;
    await rememberBook(id);
    this.render();
    if (!playFromStart && this.shownTime > 0) await this.cue(this.index, this.shownTime);
  }

  private async importPdf(file: File) {
    this.sheet = null;
    this.setBusy('Reading', 0.02);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parsePdf(bytes, {}, (ratio, label) => this.setBusy(label, ratio));
      const pages: RawPage[] = [];
      for (const page of parsed.pages) {
        if (pageNeedsOcr(page)) {
          this.setBusy('OCR', 0.7);
          const canvas = await parsed.renderPage(page.pageNumber, 2);
          const glyphs = await recognizeGlyphs(canvas, (ratio) => this.setBusy('OCR', 0.7 + ratio * 0.2));
          pages.push({ ...page, width: canvas.width, height: canvas.height, glyphs, hasImages: false });
        } else pages.push(page);
      }
      const paragraphs = cleanPages(pages);
      const drafts = detectChapters(paragraphs, parsed.outline);
      const chapters = materialize(drafts);
      const book = this.makeBook(parsed.title || file.name.replace(/\.pdf$/i, ''), 'pdf');
      await saveBook(book, chapters);
      await writeSourcePdf(book.id, bytes);
      await parsed.destroy();
      this.books = await listBooks();
      this.busy = null;
      await this.openBook(book.id, true);
    } catch (error) {
      this.busy = null;
      this.render();
      const detail = error instanceof Error ? error.message : '';
      this.showToast(/password/i.test(detail) ? "Couldn't open that PDF" : "Couldn't open that PDF");
    }
  }

  private async savePaste() {
    const field = this.root.querySelector<HTMLTextAreaElement>('#paste-text');
    const text = field?.value ?? '';
    if (/^https?:\/\/\S+$/i.test(text.trim())) {
      field?.setAttribute('aria-invalid', 'true');
      this.showToast('No article text');
      return;
    }
    const paragraphs = cleanPlainText(text);
    if (!paragraphs.length) {
      field?.setAttribute('aria-invalid', 'true');
      return;
    }
    const chapters = materialize(detectChapters(paragraphs, null));
    const book = this.makeBook(chapters[0]?.title || 'Pasted article', 'text');
    await saveBook(book, chapters);
    this.books = await listBooks();
    await this.openBook(book.id, true);
  }

  private makeBook(title: string, source: 'pdf' | 'text'): BookRecord {
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      title: title.trim() || 'Untitled',
      createdAt: now,
      updatedAt: now,
      source,
      voice: this.prefs.voice,
      engine: this.prefs.engine,
      rate: this.prefs.rate,
    };
  }

  private async edit(change: (chapters: Chapter[]) => Chapter[]) {
    if (!this.book) return;
    this.chapters = change(this.chapters).map((chapter, index) => ({ ...chapter, bookId: this.book!.id, index }));
    await saveBook({ ...this.book, updatedAt: Date.now() }, this.chapters);
    this.sheet = { name: 'chapters' };
    this.render();
  }

  private async saveRename(index: number) {
    const value = this.root.querySelector<HTMLInputElement>('#rename-input')?.value ?? '';
    await this.edit((chapters) => renameChapter(chapters, index, value));
  }

  private async setMode(index: number, mode: 'full' | 'summary') {
    const chapter = this.chapters[index];
    if (!chapter || !this.book) return;
    if (mode === 'summary' && !chapter.summary.trim()) {
      await this.fillSummary(chapter);
    }
    this.chapters = setChapterMode(this.chapters, index, mode).map((item, cursor) => ({
      ...item,
      bookId: this.book!.id,
      index: cursor,
    }));
    await saveBook(this.book, this.chapters);
    this.sheet = { name: 'chapter', index };
    this.render();
  }

  private async fillSummary(chapter: StoredChapter) {
    if (this.prefs.summaryEngine === 'llm') {
      const apiKey = readLlmKey(localStorage);
      if (!apiKey) {
        chapter.summary = summarizeExtractive(chapter.text);
        chapter.summaryKind = 'extractive';
        this.showToast('No API key');
        return;
      }
      try {
        chapter.summary = await summarizeWithLlm(chapter.text, {
          endpoint: this.prefs.llmEndpoint,
          model: this.prefs.llmModel,
          apiKey,
        });
        chapter.summaryKind = 'llm';
        return;
      } catch {
        this.showToast('Summary failed');
      }
    }
    chapter.summary = summarizeExtractive(chapter.text);
    chapter.summaryKind = 'extractive';
  }

  private async togglePlay() {
    if (!this.book) return;
    if (!this.audio.paused && this.audio.src) {
      this.audio.pause();
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      await this.persistPosition();
      return;
    }
    await this.playChapter(this.index, this.shownTime);
  }

  private async playChapter(index: number, time: number): Promise<void> {
    const chapter = this.chapters[index];
    if (!chapter) return;
    if (chapter.skipped) {
      const next = this.chapters.findIndex((item, cursor) => cursor > index && !item.skipped);
      if (next >= 0) return this.playChapter(next, 0);
      return;
    }
    this.index = index;
    this.shownTime = time;
    if (this.prefs.engine === 'webspeech' && !stubRequested()) {
      this.speak(chapter, time);
      return;
    }
    try {
      const wav = await this.ensureAudio(chapter);
      if (!wav) return;
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      const copy = new Uint8Array(wav.byteLength);
      copy.set(wav);
      const url = URL.createObjectURL(new Blob([copy], { type: 'audio/wav' }));
      this.objectUrl = url;
      this.audio.playbackRate = clampRate(this.prefs.rate);
      await new Promise<void>((resolve) => {
        const done = () => {
          this.audio.removeEventListener('loadedmetadata', done);
          resolve();
        };
        this.audio.addEventListener('loadedmetadata', done);
        this.audio.src = url;
        if (this.audio.readyState >= 1) done();
      });
      const point = sanitizeResume({ chapterIndex: index, time }, this.chapters, this.audio.duration);
      this.audio.currentTime = point.time;
      this.shownTime = point.time;
      await this.audio.play();
      this.render();
    } catch (error) {
      if (webSpeechSupported()) {
        this.prefs.engine = 'webspeech';
        this.showToast('Neural voice unavailable');
        this.speak(chapter, time);
      } else {
        this.showToast(error instanceof Error ? error.message : 'Voice failed');
      }
    }
  }

  private speak(chapter: StoredChapter, time: number) {
    if (!webSpeechSupported()) {
      this.showToast('Voice unavailable');
      return;
    }
    const text = spokenText(chapter);
    const guessed = Math.max(1, text.length / 14);
    const ratio = guessed > 0 ? Math.min(0.98, time / guessed) : 0;
    const start = Math.floor(text.length * ratio);
    if (typeof speechSynthesis === 'undefined') {
      this.showToast('Voice unavailable');
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(start));
    utterance.rate = Math.max(0.5, Math.min(2, this.prefs.rate));
    utterance.onend = () => void this.onEnded();
    speechSynthesis.speak(utterance);
    this.shownTime = time;
    this.render();
    this.syncSession();
  }

  private async cue(index: number, time: number) {
    const chapter = this.chapters[index];
    if (!chapter || this.prefs.engine === 'webspeech') return;
    const record = await getAudio(audioKey(chapter.id, this.prefs.voice, chapter.mode));
    if (!record?.complete) return;
    const pcm = await loadAudioPcm(record);
    if (!pcm) return;
    const { encodeWav } = await import('./lib/audio');
    const wav = encodeWav(pcm.samples, pcm.sampleRate);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    const copy = new Uint8Array(wav.byteLength);
    copy.set(wav);
    this.objectUrl = URL.createObjectURL(new Blob([copy], { type: 'audio/wav' }));
    this.audio.src = this.objectUrl;
    this.audio.onloadedmetadata = () => {
      const point = sanitizeResume({ chapterIndex: index, time }, this.chapters, this.audio.duration);
      this.audio.currentTime = point.time;
      this.shownTime = point.time;
      this.paintTime();
    };
  }

  private async ensureAudio(chapter: StoredChapter): Promise<Uint8Array | null> {
    if (!this.book) return null;
    const key = audioKey(chapter.id, this.prefs.voice, chapter.mode);
    const existing = await getAudio(key);
    if (existing?.complete) {
      const { readAudioBytes } = await import('./lib/storage');
      return readAudioBytes(this.book.id, key);
    }
    this.generating = true;
    this.setBusy('Voice', existing ? existing.sentencesDone / Math.max(1, existing.sentenceCount) : 0.02);
    const prior = existing ? await loadAudioPcm(existing) : null;
    const text = spokenText(chapter);
    const audio = await this.speech.synthesize({
      text,
      voice: this.prefs.voice,
      speed: 1,
      resumeFrom: existing?.sentencesDone ?? 0,
      prior: prior?.samples,
      priorRate: prior?.sampleRate,
      onProgress: (progress) => this.setBusy(progress.phase === 'model' ? 'Voice' : 'Reading', progress.ratio || 0.04),
    });
    const record: AudioRecord = {
      key,
      bookId: this.book.id,
      chapterId: chapter.id,
      voice: this.prefs.voice,
      mode: chapter.mode,
      sampleRate: audio.sampleRate,
      sentencesDone: 1,
      sentenceCount: 1,
      complete: true,
      duration: audio.samples.length / audio.sampleRate,
      bytes: 0,
    };
    await saveAudio(record, audio.samples);
    this.generating = false;
    this.busy = null;
    const { readAudioBytes } = await import('./lib/storage');
    return readAudioBytes(this.book.id, key);
  }

  private async seekBy(delta: number) {
    if (!Number.isFinite(this.audio.duration) || !this.audio.src) {
      this.shownTime = Math.max(0, this.shownTime + delta);
      this.paintTime();
      await this.persistPosition();
      return;
    }
    const end = Math.max(0, this.audio.duration - 0.25);
    this.audio.currentTime = Math.max(0, Math.min(end, this.audio.currentTime + delta));
    this.shownTime = this.audio.currentTime;
    this.paintTime();
    await this.persistPosition();
  }

  private async skipChapter(direction: number) {
    let cursor = this.index + direction;
    while (cursor >= 0 && cursor < this.chapters.length && this.chapters[cursor]?.skipped) cursor += direction;
    if (cursor < 0 || cursor >= this.chapters.length) return;
    await this.playChapter(cursor, 0);
  }

  private async onEnded() {
    if (this.sleep === 'chapter') {
      this.sleep = 'off';
      this.audio.pause();
      this.render();
      return;
    }
    await this.skipChapter(1);
  }

  private onTime() {
    this.shownTime = this.audio.currentTime;
    this.paintTime();
    if (Math.floor(this.audio.currentTime) % 5 === 0) void this.persistPosition();
    this.syncSession();
  }

  private paintTime() {
    const elapsed = this.root.querySelector<HTMLElement>('#elapsed');
    const duration = this.root.querySelector<HTMLElement>('#duration');
    const seek = this.root.querySelector<HTMLInputElement>('#seek');
    if (elapsed) {
      elapsed.textContent = formatClock(this.displayTime());
      elapsed.dataset.saved = String(this.shownTime);
    }
    if (duration) duration.textContent = formatClock(this.audio.duration || 0);
    if (seek && this.audio.duration && document.activeElement !== seek) {
      seek.value = String((this.displayTime() / this.audio.duration) * 1000);
    }
  }

  private displayTime(): number {
    return this.audio.src && Number.isFinite(this.audio.currentTime) && this.audio.currentTime > 0
      ? this.audio.currentTime
      : this.shownTime;
  }

  private async persistPosition() {
    if (!this.book) return;
    const point = sanitizeResume({ chapterIndex: this.index, time: this.displayTime() }, this.chapters, this.audio.duration || null);
    await savePosition({ bookId: this.book.id, chapterIndex: point.chapterIndex, time: point.time, updatedAt: Date.now() });
    const elapsed = this.root.querySelector<HTMLElement>('#elapsed');
    if (elapsed) elapsed.dataset.saved = String(point.time);
  }

  private async chooseVoice(voice: string) {
    this.prefs.voice = voice;
    this.prefs.engine = 'kokoro';
    if (this.book) {
      this.book.voice = voice;
      this.book.engine = 'kokoro';
      await saveBook(this.book, this.chapters);
    }
    await savePreferences(this.prefs);
    this.render();
  }

  private async chooseEngine(engine: 'kokoro' | 'webspeech') {
    this.prefs.engine = engine;
    if (this.book) {
      this.book.engine = engine;
      await saveBook(this.book, this.chapters);
    }
    await savePreferences(this.prefs);
    this.render();
  }

  private async setSummaryEngine(engine: 'extractive' | 'llm') {
    this.prefs.summaryEngine = engine;
    await savePreferences(this.prefs);
    this.render();
  }

  private async saveLlm() {
    this.prefs.llmEndpoint = this.root.querySelector<HTMLInputElement>('#llm-endpoint')?.value.trim() || this.prefs.llmEndpoint;
    this.prefs.llmModel = this.root.querySelector<HTMLInputElement>('#llm-model')?.value.trim() || this.prefs.llmModel;
    writeLlmKey(localStorage, this.root.querySelector<HTMLInputElement>('#llm-key')?.value ?? '');
    await savePreferences(this.prefs);
    this.closeSheet();
  }

  private setSleep(value: number | 'chapter' | 'off') {
    window.clearInterval(this.sleepClock);
    if (value === 'off' || value === 'chapter') this.sleep = value;
    else this.sleep = Date.now() + value * 60_000;
    if (typeof this.sleep === 'number') {
      const until = this.sleep;
      this.sleepClock = window.setInterval(() => {
        if (Date.now() >= until) {
          this.audio.pause();
          if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
          this.sleep = 'off';
          window.clearInterval(this.sleepClock);
          this.render();
        }
      }, 1000);
    }
    this.closeSheet();
  }

  private async exportZip() {
    await this.download(async (chapters) => exportMp3Zip(this.book?.title ?? 'audiobook', chapters));
  }

  private async exportBook() {
    await this.download(async (chapters) => exportM4b(this.book?.title ?? 'audiobook', chapters));
  }

  private async download(build: (chapters: { title: string; samples: Float32Array; sampleRate: number }[]) => Promise<{ blob: Blob; filename: string }>) {
    if (!this.book) return;
    if (this.prefs.engine === 'webspeech' && !stubRequested()) {
      this.showToast("Web Speech audio can't be exported");
      return;
    }
    const selected = this.chapters.filter((chapter) => !chapter.skipped);
    const payload = [];
    for (const chapter of selected) {
      const wav = await this.ensureAudio(chapter);
      if (!wav) continue;
      const { decodeWav } = await import('./lib/audio');
      const decoded = decodeWav(wav);
      payload.push({ title: chapter.title, samples: decoded.samples, sampleRate: decoded.sampleRate });
    }
    if (!payload.length) return;
    const file = await build(payload);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file.blob);
    link.download = file.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  private async fillStorage() {
    const usage = await storageUsage();
    const slot = this.root.querySelector('#storage-slot');
    if (!slot) return;
    const ratio = usage.quota > 0 ? Math.min(1, usage.used / usage.quota) : 0;
    slot.innerHTML = `<div class="meter" role="meter" aria-label="Storage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio * 100)}"><span></span></div><p class="stat">${formatBytes(usage.library)} in this library</p><p class="stat">${formatBytes(usage.used)} used</p>`;
    slot.querySelector('span')?.style.setProperty('--p', ratio.toFixed(3));
  }

  private setBusy(label: string, ratio: number) {
    this.busy = { label, ratio: Math.max(0, Math.min(1, ratio)) };
    const bar = this.root.querySelector<HTMLElement>('#busy-bar');
    const play = this.root.querySelector('.play');
    if (!bar && play && this.generating) {
      play.innerHTML = `<span class="stat">${Math.round(this.busy.ratio * 100)}</span>`;
      return;
    }
    if (!bar) this.render();
    const current = this.root.querySelector<HTMLElement>('#busy-bar');
    if (current) {
      current.setAttribute('aria-valuenow', String(Math.round(this.busy.ratio * 100)));
      current.querySelector('span')?.style.setProperty('--p', this.busy.ratio.toFixed(3));
      const label = this.root.querySelector('#busy-value');
      if (label) label.textContent = `${Math.round(this.busy.ratio * 100)}%`;
    }
  }

  private showToast(message: string) {
    this.toast = message;
    this.render();
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = '';
      const node = this.root.querySelector('.toast');
      node?.remove();
    }, 3200);
  }

  private rateLabel(): string {
    return `${clampRate(this.prefs.rate).toFixed(2)}×`;
  }

  private syncSession() {
    if (!this.book || !('mediaSession' in navigator)) return;
    const chapter = this.chapters[this.index];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapter?.title || this.book.title,
      artist: this.book.title,
      album: 'pdf-to-audiobook',
      artwork: [{ src: this.cover(), sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
    if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.audio.duration,
          playbackRate: this.audio.playbackRate || 1,
          position: Math.min(this.audio.currentTime || 0, this.audio.duration),
        });
      } catch {
        /* position not ready */
      }
    }
  }

  private cover(): string {
    if (this.coverUrl) return this.coverUrl;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.fillStyle = '#1f4d3a';
    context.fillRect(0, 0, 512, 512);
    context.fillStyle = '#f3efe7';
    context.font = '64px Georgia, serif';
    const title = this.book?.title ?? 'Audiobook';
    const words = title.split(/\s+/);
    let line = '';
    let y = 180;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > 420 && line) {
        context.fillText(line, 48, y);
        y += 76;
        line = word;
      } else line = next;
    }
    if (line) context.fillText(line, 48, y);
    this.coverUrl = canvas.toDataURL('image/png');
    return this.coverUrl;
  }
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2.5, Math.max(0.75, rate));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
