// Drag & drop natif vers une autre application (Finder, mail, Teams…) :
// - résultat « page » : le PDF de la page est généré à la volée dans le cache de l'app ;
// - résultat « fichier entier » (image, PDF trouvé par son nom) : le fichier d'origine est glissé tel quel.
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { imageThumbnailDataUrl, thumbnailDataUrl, writeDragFile } from './pages.js';

const prepared = new Map();

/**
 * Prépare (une seule fois) le fichier et la vignette ; appelé au survol pour un drag instantané.
 * @param {import('@pdfref/core/src/search.js').SearchResult} r
 * @param {string} ref
 */
export function prepareDrag(r, ref) {
  const key = `${r.docPath}#${r.pageNum}#${ref}`;
  if (!prepared.has(key)) {
    const job =
      r.pageNum == null
        ? Promise.all([r.docPath, r.kind === 'image' ? imageThumbnailDataUrl(r.docPath) : thumbnailDataUrl(r.docPath, 1)])
        : Promise.all([writeDragFile(r.docPath, r.pageNum, ref), thumbnailDataUrl(r.docPath, r.pageNum)]);
    job.catch(() => prepared.delete(key));
    prepared.set(key, job);
  }
  return prepared.get(key);
}

/**
 * À brancher sur `mousedown` : le drag natif démarre si la souris bouge de quelques pixels
 * (un simple clic reste un clic).
 */
export function dragOnMove(event, r, ref) {
  if (event.button !== 0) return;
  const job = prepareDrag(r, ref);
  const x0 = event.clientX;
  const y0 = event.clientY;
  const onMove = async (e) => {
    if (Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
    cleanup();
    try {
      const [file, icon] = await job;
      await startDrag({ item: [file], icon, mode: 'copy' });
    } catch (err) {
      console.error('[pdfref] drag impossible :', err);
    }
  };
  const cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', cleanup);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', cleanup);
}
