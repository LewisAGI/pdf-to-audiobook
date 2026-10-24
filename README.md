# pdf-to-audiobook

A phone-first audiobook reader that runs entirely in the browser. Upload a PDF or paste article text. The page is parsed, cleaned, split into chapters, and read aloud on your device. Books, generated audio, and playback position stay in IndexedDB and the origin private file system. There is no application server.

## License

GPL-3.0-or-later. The application bundles eSpeak NG (GPL-3.0), the ffmpeg core (GPL-2.0-or-later), and lamejs (LGPL-3.0). The terms are in `LICENSE`. Third-party notices stay in `public/THIRD_PARTY_NOTICES.txt`.

## What it does

- Reads PDFs with pdf.js, including the document outline, and OCRs pages that have no text layer with tesseract.js.
- Strips repeated running headers and footers, page numbers, footnote markers, and a trailing References or Bibliography section. Line-break hyphens are joined back into words.
- Builds chapters from the PDF outline, then from heading size and weight, then by length.
- Lets you rename, merge, split, or skip chapters, and choose a full reading or a summary for each one.
- Summaries are extractive by default. You can point at an OpenAI-compatible endpoint instead. That API key stays in `localStorage` and is sent only to the endpoint you enter.
- Speaks with Kokoro (WASM, downloaded on first use and kept in Cache Storage) or falls back to the Web Speech API.
- Plays with chapter skip, 15 and 30 second jumps, speed from 0.75× to 2.5×, a sleep timer, per-book resume, and lock-screen controls.
- Installs as a PWA. Export is an M4B with chapter markers, or a zip of one MP3 per chapter.

## Develop

```bash
npm ci
npm run dev
```

`npm test` runs the unit tests. `npm run test:e2e` builds the site and runs Playwright against the preview server, which sends the same security headers as `public/_headers`.

Neural speech is stubbed in the browser tests with `localStorage['pta-tts'] = 'stub'` so they do not download the model. A real Kokoro run is `npm run prove:neural` once the dev server dependencies are in place, or simply play a short chapter in the app.

## Limits

- Kokoro’s quantized weights are fetched from Hugging Face the first time you use a neural voice. That download is large, and long chapters are slow on a phone. Generation continues from the last finished sentence if you leave and come back.
- Web Speech output cannot be exported, and it does not keep a sample-accurate position.
- In-browser summaries are extractive. A generative summary needs your own API endpoint. Extractive chapters are labeled “Automatic summary”; API chapters are labeled “AI-generated summary”.
- M4B audio is AAC from WebCodecs when the browser can encode it. Otherwise ffmpeg.wasm is loaded from jsDelivr. AAC priming can shift chapter markers by a few dozen milliseconds.
- OCR ships English traineddata only. Password-protected PDFs are refused. Pasted URLs are not fetched.
- Threaded WASM needs cross-origin isolation, so the responses send `COOP: same-origin` and `COEP: require-corp`.
- The ffmpeg core is too large for Cloudflare Pages’ per-file limit, so it is not copied into `dist/`.
