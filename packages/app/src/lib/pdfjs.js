// pdfjs côté webview : build legacy (le build standard de pdfjs 6 exige des API absentes du WebKit
// de macOS, ex. Math.sumPrecise). Son worker est bundlé localement par Vite (aucun CDN).
import './polyfills.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdf-worker.js', import.meta.url), { type: 'module' });

export const PDFJS_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
  isEvalSupported: false,
};

export { pdfjs };
