import { normalize } from './normalize.js';

export const PDF_EXTENSIONS = ['pdf'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];

/** Nom du fichier sans dossier (chemins POSIX ou Windows). */
export function baseName(path) {
  return path.split(/[\\/]/).pop();
}

/** Nom du fichier sans dossier ni extension. */
export function fileStem(path) {
  return baseName(path).replace(/\.[^.]+$/, '');
}

/**
 * Type de fichier indexable d'après l'extension.
 * @returns {'pdf' | 'image' | null}
 */
export function fileKind(path) {
  const ext = baseName(path).split('.').pop().toLowerCase();
  if (PDF_EXTENSIONS.includes(ext)) return 'pdf';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return null;
}

/** Nom normalisé (sans extension), comparé à la référence recherchée. */
export function nameNorm(path) {
  return normalize(fileStem(path));
}
