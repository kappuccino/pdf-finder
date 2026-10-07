import { PDFDocument } from 'pdf-lib';

/**
 * Copie des pages (éventuellement issues de plusieurs PDF) dans un nouveau PDF autonome.
 * La page est copiée telle quelle (contenu, ressources, dimensions) : mise en page identique.
 *
 * @param {{ bytes: Uint8Array, pageNum: number }[]} items pageNum est 1-based
 * @returns {Promise<Uint8Array>}
 */
export async function exportPages(items) {
  const out = await PDFDocument.create();
  const loaded = new Map();
  for (const { bytes, pageNum } of items) {
    let src = loaded.get(bytes);
    if (!src) {
      src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      loaded.set(bytes, src);
    }
    const count = src.getPageCount();
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > count) {
      throw new RangeError(`Page ${pageNum} hors limites (1..${count})`);
    }
    const [page] = await out.copyPages(src, [pageNum - 1]);
    out.addPage(page);
  }
  return out.save();
}

/**
 * @param {Uint8Array} bytes
 * @param {number} pageNum 1-based
 * @returns {Promise<Uint8Array>}
 */
export function exportPage(bytes, pageNum) {
  return exportPages([{ bytes, pageNum }]);
}
