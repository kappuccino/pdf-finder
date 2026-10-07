import { PDFDocument } from 'pdf-lib';
import { normalize } from './normalize.js';

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

/**
 * Nom de fichier d'une page exportée : `{nomPDF}_p{num}_{REF}.pdf`.
 * Fonctionne avec des chemins POSIX ou Windows.
 *
 * @param {string} docPath
 * @param {number} pageNum
 * @param {string} ref référence telle que saisie (normalisée ici)
 */
export function exportFileName(docPath, pageNum, ref) {
  const base = docPath.split(/[\\/]/).pop().replace(/\.pdf$/i, '');
  return `${safeName(base)}_p${pageNum}_${safeName(normalize(ref))}.pdf`;
}

const safeName = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
