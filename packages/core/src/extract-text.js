/** Erreur d'extraction identifiable (PDF protégé, corrompu…). */
export class PdfExtractError extends Error {
  /**
   * @param {'password' | 'invalid' | 'unknown'} code
   * @param {string} message
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'PdfExtractError';
    this.code = code;
  }
}

/**
 * Reconstruit le texte lisible d'une page à partir des fragments positionnés de pdfjs.
 * Saut de ligne si `hasEOL`, si Y change de plus d'une demi-hauteur de police,
 * ou si le fragment repart à gauche du précédent (colonne de tableau) ;
 * espace si l'écart horizontal dépasse 20 % de la hauteur de police.
 *
 * @param {Array<{ str?: string, transform?: number[], width?: number, height?: number, hasEOL?: boolean }>} items
 * @returns {string}
 */
export function itemsToText(items) {
  let out = '';
  let lastY = null;
  let lastEndX = 0;
  let lastH = 0;
  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };

  for (const item of items) {
    if (typeof item.str !== 'string') continue; // marked content
    if (item.str) {
      const [, , c, d, x, y] = item.transform;
      const h = Math.abs(item.height) || Math.hypot(c, d) || 10;
      if (lastY !== null) {
        // Changement de ligne, ou retour nettement à gauche sur la même ligne (autre colonne / cellule)
        if (Math.abs(y - lastY) > 0.5 * Math.max(h, lastH) || x < lastEndX - h) newline();
        else if (x - lastEndX > 0.2 * h && !/\s$/.test(out) && !/^\s/.test(item.str)) out += ' ';
      }
      out += item.str;
      lastY = y;
      lastEndX = x + item.width;
      lastH = h;
    }
    if (item.hasEOL) newline();
  }
  return out.trimEnd();
}

/**
 * Crée un extracteur autour d'une instance pdfjs injectée
 * (build legacy côté Node, build standard côté webview).
 *
 * @param {any} pdfjs module pdfjs-dist déjà initialisé (worker configuré)
 * @param {object} [docOptions] options passées à getDocument (standardFontDataUrl, cMapUrl…)
 */
export function createExtractor(pdfjs, docOptions = {}) {
  return {
    /**
     * @param {Uint8Array} bytes
     * @param {{ onPage?: (pageNum: number, pageCount: number) => void }} [opts]
     * @returns {Promise<{ pageCount: number, pages: { pageNum: number, text: string }[] }>}
     */
    async extractPages(bytes, { onPage } = {}) {
      // pdfjs transfère (détache) le buffer : on lui donne une copie.
      const task = pdfjs.getDocument({ ...docOptions, data: bytes.slice() });
      let doc;
      try {
        doc = await task.promise;
      } catch (err) {
        await task.destroy();
        if (err?.name === 'PasswordException') throw new PdfExtractError('password', 'PDF protégé par mot de passe', err);
        if (err?.name === 'InvalidPDFException') throw new PdfExtractError('invalid', 'PDF invalide ou corrompu', err);
        throw new PdfExtractError('unknown', err?.message ?? String(err), err);
      }
      try {
        const pages = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          pages.push({ pageNum: n, text: itemsToText(content.items) });
          page.cleanup();
          onPage?.(n, doc.numPages);
        }
        return { pageCount: doc.numPages, pages };
      } finally {
        await task.destroy();
      }
    },
  };
}
