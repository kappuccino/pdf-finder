// Point d'entrée du worker pdfjs : polyfills, puis le worker officiel (build legacy) (bundlé localement par Vite).
import './polyfills.js';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
