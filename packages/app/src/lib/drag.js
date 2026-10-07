// Drag & drop natif d'une page PDF vers une autre application (Finder, mail, Teams…).
// Le PDF de la page est généré à la volée dans le cache de l'app, puis glissé comme un vrai fichier.
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { thumbnailDataUrl, writeDragFile } from './pages.js';

const prepared = new Map();

/** Prépare (une seule fois) le fichier et la vignette ; appelé au survol pour un drag instantané. */
export function prepareDrag(docPath, pageNum, ref) {
  const key = `${docPath}#${pageNum}#${ref}`;
  if (!prepared.has(key)) {
    const job = Promise.all([writeDragFile(docPath, pageNum, ref), thumbnailDataUrl(docPath, pageNum)]);
    job.catch(() => prepared.delete(key));
    prepared.set(key, job);
  }
  return prepared.get(key);
}

/**
 * À brancher sur `mousedown` : le drag natif démarre si la souris bouge de quelques pixels
 * (un simple clic reste un clic).
 */
export function dragOnMove(event, docPath, pageNum, ref) {
  if (event.button !== 0) return;
  const job = prepareDrag(docPath, pageNum, ref);
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
