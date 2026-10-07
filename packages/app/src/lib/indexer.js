// Indexation d'un dossier : lecture (plugin-fs) + extraction (worker pdfjs) + écriture SQL (cœur).
import { readDir, readFile, stat } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { createExtractor, indexDocument, listDocs, removeDoc } from '@pdfref/core';
import { pdfjs, PDFJS_OPTIONS } from './pdfjs.js';

// L'analyse des PDF se fait dans le worker de pdfjs (Web Worker) : l'interface reste fluide,
// seul le texte extrait revient sur le thread principal.
const extractor = createExtractor(pdfjs, PDFJS_OPTIONS);

/** Liste récursivement les PDF d'un dossier. */
export async function listPdfs(dir) {
  const out = [];
  const walk = async (d) => {
    const entries = await readDir(d);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = await join(d, e.name);
      if (e.isDirectory) await walk(p);
      else if (e.isFile && e.name.toLowerCase().endsWith('.pdf')) out.push(p);
    }
  };
  await walk(dir);
  return out;
}

/**
 * Indexe (incrémental) tous les PDF du dossier et retire de l'index ce qui n'y est plus.
 * @param {import('@pdfref/core/src/db-adapter.js').DbAdapter} db
 * @param {string} dir
 * @param {(p: { index: number, total: number, file: string, pageNum?: number, pageCount?: number }) => void} onProgress
 */
export async function indexFolder(db, dir, onProgress) {
  const t0 = performance.now();
  const files = await listPdfs(dir);
  const summary = { files: files.length, added: 0, updated: 0, skipped: 0, removed: 0, pages: 0, errors: [] };

  for (const [index, file] of files.entries()) {
    onProgress({ index, total: files.length, file });
    try {
      const bytes = await readFile(file);
      const info = await stat(file);
      // date de création du fichier (repli : date de modification si le système ne la fournit pas)
      const createdAt = (info.birthtime ?? info.mtime)?.getTime() ?? null;
      const res = await indexDocument(db, { path: file, bytes, createdAt }, extractor, {
        onPage: (pageNum, pageCount) => onProgress({ index, total: files.length, file, pageNum, pageCount }),
      });
      summary[res.status]++;
      if (res.status !== 'skipped') summary.pages += res.pageCount;
    } catch (err) {
      summary.errors.push({ file, message: err.message });
      console.warn('[pdfref] ignoré :', file, err);
    }
  }

  const present = new Set(files.map((f) => f.normalize('NFC')));
  for (const doc of await listDocs(db)) {
    if (!present.has(doc.path)) {
      await removeDoc(db, doc.id);
      summary.removed++;
    }
  }
  summary.seconds = (performance.now() - t0) / 1000;
  return summary;
}
