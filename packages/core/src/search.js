import { normalize, normalizeWithMap } from './normalize.js';
import { baseName } from './files.js';

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
 * @property {'pdf' | 'image'} kind
 * @property {number | null} pageNum page trouvée, ou null quand le résultat est le fichier entier
 *   (image, ou PDF trouvé seulement par son nom)
 * @property {number} pageCount nombre de pages du PDF (0 pour une image)
 * @property {number | null} createdAt date de création du fichier (ms)
 * @property {boolean} nameMatch la référence figure dans le nom du fichier
 * @property {{ start: number, end: number } | null} nameHighlight position de la référence dans le nom du fichier
 * @property {MatchQuality | 'filename'} match qualité de la correspondance dans le texte ('filename' : nom seul)
 * @property {string} snippet extrait du texte lisible autour de la correspondance ('' si trouvé par le nom)
 * @property {{ start: number, end: number } | null} highlight position de la référence dans `snippet`
 */

/**
 * Recherche une référence (sous-chaîne, après normalisation) dans le texte des PDF
 * et dans le nom des fichiers (PDF et images).
 *
 * Tri :
 *   1. fichiers dont le NOM contient la référence (ex. `ABC.pdf`, `abc.jpg` pour ABC) ;
 *   2. correspondances 'partial' dans le texte (souvent des faux positifs) en dernier ;
 *   3. fichiers les plus récents d'abord (date de création), puis chemin et page.
 *
 * @param {import('./db-adapter.js').DbAdapter} db
 * @param {string} query
 * @param {{ refMode?: 'trigram' | 'like', limit?: number }} [opts]
 * @returns {Promise<SearchResult[]>}
 */
export async function search(db, query, { refMode = 'trigram', limit = MAX_RESULTS } = {}) {
  const q = normalize(query);
  if (q.length < 3) return [];
  const max = Math.min(limit, MAX_RESULTS);
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;

  // Fichiers trouvés par leur nom (la table docs reste petite : un LIKE suffit)
  const byName = await db.all(
    `SELECT id, path, kind, page_count AS pageCount, created_at AS createdAt
       FROM docs WHERE name_norm LIKE ? ESCAPE '\\' AND hash <> ''
      ORDER BY created_at IS NULL, created_at DESC, path
      LIMIT ?`,
    [like, max],
  );
  const nameIds = new Set(byName.map((d) => d.id));

  // Pages dont le texte contient la référence
  const where = refMode === 'trigram' ? 'r.ref_norm MATCH ?' : "r.ref_norm LIKE ? ESCAPE '\\'";
  const param = refMode === 'trigram' ? `"${q.replaceAll('"', '""')}"` : like;
  const rows = await db.all(
    `SELECT d.id AS docId, d.path AS docPath, d.page_count AS pageCount, d.created_at AS createdAt,
            r.page_num AS pageNum, t.content AS content
       FROM pages_ref r
       JOIN docs d ON d.id = r.doc_id
       JOIN pages_text t ON t.rowid = r.rowid
      WHERE ${where}
      ORDER BY d.created_at IS NULL, d.created_at DESC, d.path, r.page_num
      LIMIT ?`,
    [param, max],
  );

  const nameInfo = (path) => findBestMatch(baseName(path), q);
  const results = rows.map(({ docId, docPath, pageCount, createdAt, pageNum, content }) => {
    const m = findBestMatch(content, q);
    const named = nameIds.has(docId);
    return {
      docPath,
      kind: 'pdf',
      pageNum: Number(pageNum),
      pageCount: Number(pageCount),
      createdAt: createdAt == null ? null : Number(createdAt),
      nameMatch: named,
      nameHighlight: named ? pick(nameInfo(docPath)) : null,
      match: m?.match ?? 'partial',
      ...makeSnippet(content, m),
    };
  });

  // Fichiers trouvés par leur nom mais sans page correspondante (images, PDF) : le fichier entier
  const withPages = new Set(rows.map((r) => r.docId));
  for (const d of byName) {
    if (withPages.has(d.id)) continue;
    results.push({
      docPath: d.path,
      kind: d.kind,
      pageNum: null,
      pageCount: Number(d.pageCount),
      createdAt: d.createdAt == null ? null : Number(d.createdAt),
      nameMatch: true,
      nameHighlight: pick(nameInfo(d.path)),
      match: 'filename',
      snippet: '',
      highlight: null,
    });
  }

  return results.sort(compareResults).slice(0, max);
}

const pick = (m) => (m ? { start: m.start, end: m.end } : null);

/** Nom de fichier d'abord, 'partial' en dernier, puis date décroissante, chemin, page (fichier entier en tête). */
function compareResults(a, b) {
  return (
    b.nameMatch - a.nameMatch ||
    (a.match === 'partial') - (b.match === 'partial') ||
    (a.createdAt == null) - (b.createdAt == null) ||
    (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
    a.docPath.localeCompare(b.docPath) ||
    (a.pageNum ?? 0) - (b.pageNum ?? 0)
  );
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
