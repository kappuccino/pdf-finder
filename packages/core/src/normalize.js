// Caractères supprimés : blancs (dont espace insécable), tiret et variantes typographiques, _ . /
const STRIP = /[\s\-‐-―−_./]/u;
const DIACRITIC = /\p{M}/gu;

/**
 * Normalise un texte et garde, pour chaque caractère produit, l'index du caractère
 * d'origine dont il provient (sert à retrouver la correspondance dans le texte brut).
 *
 * @param {string} input
 * @returns {{ text: string, map: number[] }}
 */
export function normalizeWithMap(input) {
  let text = '';
  const map = [];
  let i = 0;
  for (const ch of input) {
    if (!STRIP.test(ch)) {
      const out = ch.normalize('NFD').replace(DIACRITIC, '').toUpperCase();
      for (const c of out) {
        if (STRIP.test(c)) continue;
        text += c;
        for (let k = 0; k < c.length; k++) map.push(i);
      }
    }
    i += ch.length;
  }
  return { text, map };
}

/**
 * Normalisation unique, utilisée à l'indexation ET à la recherche :
 * majuscules, sans diacritiques, sans espaces / sauts de ligne / - _ . /
 * `AB-1234-X`, `ab 1234 x`, `AB-\n1234-X` → `AB1234X`.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalize(input) {
  return normalizeWithMap(input).text;
}
