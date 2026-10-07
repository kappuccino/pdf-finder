// Pages à la volée : rendu (aperçu, vignette de drag) et génération du PDF d'une page.
import { readFile, writeFile, mkdir, remove } from '@tauri-apps/plugin-fs';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { exportFileName, exportPage } from '@pdfref/core';
import { pdfjs, PDFJS_OPTIONS } from './pdfjs.js';

// Petits caches : le dernier fichier lu et les documents pdfjs ouverts.
const bytesCache = new Map();
const docCache = new Map();
const MAX_CACHE = 4;

function remember(map, key, value) {
  map.set(key, value);
  if (map.size > MAX_CACHE) {
    const [oldKey, old] = map.entries().next().value;
    map.delete(oldKey);
    old?.then?.((d) => d.loadingTask?.destroy?.());
  }
  return value;
}

export function getBytes(path) {
  return bytesCache.get(path) ?? remember(bytesCache, path, readFile(path));
}

function getPdf(path) {
  return (
    docCache.get(path) ??
    remember(
      docCache,
      path,
      getBytes(path).then((bytes) => pdfjs.getDocument({ ...PDFJS_OPTIONS, data: bytes.slice() }).promise),
    )
  );
}

/** Rend une page dans un canvas, à la largeur CSS donnée. */
export async function renderPage(canvas, path, pageNum, cssWidth) {
  const doc = await getPdf(path);
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  const task = page.render({ canvas, viewport });
  canvas._renderTask?.cancel();
  canvas._renderTask = task;
  await task.promise;
}

/** Vignette PNG (data URL) d'une page, pour l'icône du drag. */
export async function thumbnailDataUrl(path, pageNum, width = 120) {
  const canvas = document.createElement('canvas');
  await renderPage(canvas, path, pageNum, width / (window.devicePixelRatio || 1));
  return canvas.toDataURL('image/png');
}

/** PDF autonome (Uint8Array) d'une seule page. */
export async function pageBytes(path, pageNum) {
  return exportPage(await getBytes(path), pageNum);
}

let dragDir;
/**
 * Écrit le PDF d'une page dans le cache de l'app (pour le drag & drop vers une autre app).
 * @returns {Promise<string>} chemin absolu du fichier
 */
export async function writeDragFile(path, pageNum, ref) {
  if (!dragDir) {
    dragDir = await join(await appCacheDir(), 'drag');
    // on repart d'un dossier propre à chaque lancement
    await remove(dragDir, { recursive: true }).catch(() => {});
    await mkdir(dragDir, { recursive: true });
  }
  const file = await join(dragDir, exportFileName(path, pageNum, ref));
  await writeFile(file, await pageBytes(path, pageNum));
  return file;
}
