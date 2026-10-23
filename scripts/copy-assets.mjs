import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(from, to) {
  if (!(await exists(from))) {
    console.warn('skip missing', path.relative(root, from));
    return;
  }
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
  console.log('copied', path.relative(root, from), '->', path.relative(root, to));
}

async function copyFile(from, to) {
  if (!(await exists(from))) {
    console.warn('skip missing', path.relative(root, from));
    return;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
  console.log('copied', path.relative(root, to));
}

async function download(url, to) {
  if (await exists(to)) {
    console.log('present', path.relative(root, to));
    return;
  }
  await mkdir(path.dirname(to), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url}`);
  await pipeline(res.body, createWriteStream(to));
  console.log('downloaded', path.relative(root, to));
}

const pdfRoot = path.join(nm, 'pdfjs-dist');
await copyDir(path.join(pdfRoot, 'cmaps'), path.join(root, 'public/pdfjs/cmaps'));
await copyDir(path.join(pdfRoot, 'standard_fonts'), path.join(root, 'public/pdfjs/standard_fonts'));
await copyDir(path.join(pdfRoot, 'wasm'), path.join(root, 'public/pdfjs/wasm'));
await copyFile(
  path.join(pdfRoot, 'build/pdf.worker.min.mjs'),
  path.join(root, 'public/pdfjs/pdf.worker.min.mjs'),
);

const tessWorker = path.join(nm, 'tesseract.js/dist/worker.min.js');
await copyFile(tessWorker, path.join(root, 'public/tesseract/worker.min.js'));
for (const name of [
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm',
]) {
  await copyFile(path.join(nm, 'tesseract.js-core', name), path.join(root, 'public/tesseract', name));
}

await copyFile(
  path.join(nm, '@ffmpeg/core/dist/esm/ffmpeg-core.js'),
  path.join(root, 'public/ffmpeg/ffmpeg-core.js'),
);

const onnxDist = path.join(nm, 'onnxruntime-web/dist');
for (const name of [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
]) {
  await copyFile(path.join(onnxDist, name), path.join(root, 'public/onnx', name));
}

const workerOut = path.join(root, 'public/pdfjs/pdf.worker.min.mjs');
const workerSource = await readFile(workerOut, 'utf8');
const polyfill = `if(typeof Promise.try!=="function"){Promise.try=function(fn){var a=Array.prototype.slice.call(arguments,1);return new Promise(function(r,j){try{r(fn.apply(null,a))}catch(e){j(e)}})};}
if(typeof Uint8Array.prototype.toHex!=="function"){Uint8Array.prototype.toHex=function(){var h="";for(var i=0;i<this.length;i++)h+=(this[i]||0).toString(16).padStart(2,"0");return h}}
if(typeof Uint8Array.prototype.toBase64!=="function"){Uint8Array.prototype.toBase64=function(){var s="";var n=32768;for(var i=0;i<this.length;i+=n)s+=String.fromCharCode.apply(null,this.subarray(i,i+n));return btoa(s)}}
if(typeof Uint8Array.fromBase64!=="function"){Uint8Array.fromBase64=function(v){var b=atob(v);var o=new Uint8Array(b.length);for(var i=0;i<b.length;i++)o[i]=b.charCodeAt(i);return o}}
if(typeof Map.prototype.getOrInsertComputed!=="function"){Map.prototype.getOrInsertComputed=function(k,f){if(this.has(k))return this.get(k);var v=f(k);this.set(k,v);return v}}
`;
if (!workerSource.startsWith('if(typeof Promise.try')) {
  await writeFile(workerOut, polyfill + workerSource);
  console.log('patched', path.relative(root, workerOut));
}

const trained = path.join(root, 'public/tessdata/eng.traineddata');
await download(
  'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata',
  trained,
);
