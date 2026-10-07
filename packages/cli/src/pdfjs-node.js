// Initialisation de pdfjs côté Node : build legacy + ressources locales (aucun réseau).
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createExtractor } from '@pdfref/core';

const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));

pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(pdfjsDir, 'legacy/build/pdf.worker.mjs')).href;

export function createNodeExtractor() {
  return createExtractor(pdfjs, {
    standardFontDataUrl: path.join(pdfjsDir, 'standard_fonts') + path.sep,
    cMapUrl: path.join(pdfjsDir, 'cmaps') + path.sep,
    cMapPacked: true,
    wasmUrl: path.join(pdfjsDir, 'wasm') + path.sep,
    iccUrl: path.join(pdfjsDir, 'iccs') + path.sep,
    isEvalSupported: false,
    verbosity: 0,
  });
}
