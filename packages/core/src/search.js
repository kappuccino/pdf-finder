import { normalize, normalizeWithMap } from './normalize.js';

export const MAX_RESULTS = 200;
const SNIPPET_CONTEXT = 60;

/**
 * Qualité d'une correspondance, d'après le texte d'origine autour de la référence :
 * - 'exact'   : début et fin sur une frontière (blanc, ponctuation, début/fin de page) ;
 * - 'prefix'  : seul le début est sur une frontière (saisie incomplète, ex. as-you-type) ;
 * - 'partial' : collée à d'autres lettres/chiffres au début (ex. `G30540010R13` pour `30540`).
 * Les coupures à l'intérieur de la référence (`EF-⏎9012-Z`) n'entrent pas en compte.
 * @typedef {'exact' | 'prefix' | 'partial'} MatchQuality
 */
const RANK = { exact: 0, prefix: 1, partial: 2 };

/**
 * @typedef {object} SearchResult
 * @property {string} docPath
 * @property {number} pageNum
 * @property {number | null} createdAt date de création du fichier (ms)
 * @property {MatchQuality} match
 * @property {string} snippet extrait du texte lisible autour de la correspondance
 * @property {{ start: number, end: number } | null} highlight position de la référence dans `snippet`
 */

/**
 * Recherche une référence (sous-chaîne, après normalisation).
 * Tri : fichiers les plus récents d'abord (date de création), puis chemin et page.
 * Les correspondances 'partial' (souvent des faux positifs) passent en dernier.
 *
 * @param {import('./db-adapter.js').DbAdapter} db
 * @param {string} query
 * @param {{ refMode?: 'trigram' | 'like', limit?: number }} [opts]
 * @returns {Promise<SearchResult[]>}
 */
export async function search(db, query, { refMode = 'trigram', limit = MAX_RESULTS } = {}) {
  const q = normalize(query);
  if (q.length < 3) return [];

  const where = refMode === 'trigram' ? 'r.ref_norm MATCH ?' : "r.ref_norm LIKE ? ESCAPE '\\'";
  const param = refMode === 'trigram' ? `"${q.replaceAll('"', '""')}"` : `%${q.replace(/[\\%_]/g, '\\$&')}%`;

  const rows = await db.all(
    `SELECT d.path AS docPath, d.created_at AS createdAt, r.page_num AS pageNum, t.content AS content
       FROM pages_ref r
       JOIN docs d ON d.id = r.doc_id
       JOIN pages_text t ON t.rowid = r.rowid
      WHERE ${where}
      ORDER BY d.created_at IS NULL, d.created_at DESC, d.path, r.page_num
      LIMIT ?`,
    [param, Math.min(limit, MAX_RESULTS)],
  );

  const results = rows.map(({ docPath, createdAt, pageNum, content }) => {
    const m = findBestMatch(content, q);
    return {
      docPath,
      createdAt: createdAt == null ? null : Number(createdAt),
      pageNum: Number(pageNum),
      match: m?.match ?? 'partial',
      ...makeSnippet(content, m),
    };
  });
  // tri stable : l'ordre date/fichier/page de SQLite est conservé, seuls les 'partial' passent à la fin
  return results.sort((a, b) => (a.match === 'partial') - (b.match === 'partial'));
}

const ALNUM = /[\p{L}\p{N}]/u;

/**
 * Cherche toutes les occurrences de `normQuery` (déjà normalisée) dans `content`
 * et renvoie la meilleure, avec sa position dans le texte d'origine.
 *
 * @param {string} content
 * @param {string} normQuery
 * @returns {{ start: number, end: number, match: MatchQuality } | null}
 */
export function findBestMatch(content, normQuery) {
  const { text, map } = normalizeWithMap(content);
  let best = null;
  for (let idx = text.indexOf(normQuery); idx >= 0; idx = text.indexOf(normQuery, idx + 1)) {
    const start = map[idx];
    const last = map[idx + normQuery.length - 1];
    const end = last + String.fromCodePoint(content.codePointAt(last)).length;
    const startOk = start === 0 || !ALNUM.test(charBefore(content, start));
    const endOk = end >= content.length || !ALNUM.test(String.fromCodePoint(content.codePointAt(end)));
    const match = startOk ? (endOk ? 'exact' : 'prefix') : 'partial';
    if (!best || RANK[match] < RANK[best.match]) best = { start, end, match };
    if (match === 'exact') break;
  }
  return best;
}

/** Caractère (point de code complet) juste avant l'index `i`. */
function charBefore(s, i) {
  const low = s.charCodeAt(i - 1);
  return low >= 0xdc00 && low <= 0xdfff && i >= 2 ? s.slice(i - 2, i) : s[i - 1];
}

/**
 * Extrait le texte autour d'une correspondance (positions dans `content`).
 *
 * @param {string} content
 * @param {{ start: number, end: number } | null} m
 * @returns {{ snippet: string, highlight: { start: number, end: number } | null }}
 */
export function makeSnippet(content, m) {
  if (!m) return { snippet: clean(content.slice(0, 2 * SNIPPET_CONTEXT)), highlight: null };
  const { start, end } = m;
  const from = Math.max(0, start - SNIPPET_CONTEXT);
  const to = Math.min(content.length, end + SNIPPET_CONTEXT);
  const before = (from > 0 ? '…' : '') + clean(content.slice(from, start)).trimStart();
  const match = clean(content.slice(start, end));
  const after = clean(content.slice(end, to)).trimEnd() + (to < content.length ? '…' : '');
  return {
    snippet: before + match + after,
    highlight: { start: before.length, end: before.length + match.length },
  };
}

const clean = (s) => s.replace(/\s+/g, ' ');
