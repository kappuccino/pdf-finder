import { nameNorm } from './files.js';

/**
 * Migrations du schéma, appliquées dans l'ordre à partir de la version de la base (PRAGMA user_version).
 * Pour faire évoluer le schéma :
 *   1. ajouter une entrée { version: N + 1, up: [...] } ici (SQL, ou fonction async (db) => … pour
 *      une reprise de données) ;
 *   2. reporter la modification dans le DDL ci-dessous (utilisé pour une base neuve) ;
 *   3. ajouter un test de migration (packages/core/test/schema.test.js).
 * Une base plus ancienne que BASE_VERSION, ou plus récente que l'app, est reconstruite :
 * l'index n'est qu'un cache des PDF, rien n'est perdu (les réglages sont stockés ailleurs).
 */
export const MIGRATIONS = [
  // v3 : date de création du fichier (ms), renseignée au prochain passage de l'indexation
  { version: 3, up: ['ALTER TABLE docs ADD COLUMN created_at INTEGER'] },
  // v4 : images indexées (chemin seul) + nom de fichier normalisé, pour la recherche par nom
  {
    version: 4,
    up: [
      "ALTER TABLE docs ADD COLUMN kind TEXT NOT NULL DEFAULT 'pdf'",
      'ALTER TABLE docs ADD COLUMN name_norm TEXT',
      async (db) => {
        for (const { id, path } of await db.all('SELECT id, path FROM docs')) {
          await db.run('UPDATE docs SET name_norm = ? WHERE id = ?', [nameNorm(path), id]);
        }
      },
    ],
  },
];

/** v2 : rowids des pages déterministes (docId × PAGE_STRIDE + page) ; avant, l'index est incompatible. */
export const BASE_VERSION = 2;
export const SCHEMA_VERSION = MIGRATIONS.at(-1).version;

const DOCS_DDL = `
CREATE TABLE IF NOT EXISTS docs (
  id          INTEGER PRIMARY KEY,
  path        TEXT UNIQUE NOT NULL,
  hash        TEXT NOT NULL,
  page_count  INTEGER NOT NULL,
  indexed_at  INTEGER NOT NULL,
  created_at  INTEGER,                -- date de création du fichier (ms), pour le tri
  kind        TEXT NOT NULL DEFAULT 'pdf',  -- 'pdf' (texte indexé) ou 'image' (chemin seul)
  name_norm   TEXT                    -- nom de fichier normalisé, sans extension
);`;

const PAGES_TEXT_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS pages_text USING fts5(
  content,
  doc_id UNINDEXED, page_num UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);`;

const PAGES_REF_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS pages_ref USING fts5(
  ref_norm,
  doc_id UNINDEXED, page_num UNINDEXED,
  tokenize = 'trigram'
);`;

// Repli sans FTS5 / sans trigram : tables classiques (id = alias du rowid,
// donc les mêmes INSERT ... (rowid, ...) fonctionnent dans les deux cas).
const PAGES_TEXT_PLAIN = `
CREATE TABLE IF NOT EXISTS pages_text (id INTEGER PRIMARY KEY, content TEXT, doc_id INTEGER, page_num INTEGER);
CREATE INDEX IF NOT EXISTS pages_text_doc ON pages_text(doc_id);`;

const PAGES_REF_PLAIN = `
CREATE TABLE IF NOT EXISTS pages_ref (id INTEGER PRIMARY KEY, ref_norm TEXT, doc_id INTEGER, page_num INTEGER);
CREATE INDEX IF NOT EXISTS pages_ref_doc ON pages_ref(doc_id);`;

/**
 * Teste ce que la build SQLite embarquée sait faire.
 * @param {import('./db-adapter.js').DbAdapter} db
 */
export async function detectCapabilities(db) {
  const [{ v }] = await db.all('SELECT sqlite_version() AS v');
  const probe = async (ddl) => {
    try {
      await db.exec(`CREATE VIRTUAL TABLE temp._probe USING ${ddl}`);
      await db.exec('DROP TABLE temp._probe');
      return true;
    } catch {
      return false;
    }
  };
  const fts5 = await probe('fts5(x)');
  const trigram = fts5 && (await probe("fts5(x, tokenize = 'trigram')"));
  return { sqliteVersion: v, fts5, trigram };
}

/**
 * Crée le schéma si besoin et renvoie les capacités + le mode de recherche effectif.
 * `refMode` vaut 'trigram' (MATCH) ou 'like' (repli LIKE '%…%').
 *
 * @param {import('./db-adapter.js').DbAdapter} db
 * @param {{ log?: (msg: string) => void, disableTrigram?: boolean }} [opts]
 *   disableTrigram force le repli LIKE (utile pour le tester)
 */
export async function initSchema(db, { log = console.warn, disableTrigram = false } = {}) {
  const caps = await detectCapabilities(db);
  if (disableTrigram) caps.trigram = false;

  let [{ user_version: version }] = await db.all('PRAGMA user_version');
  if (version !== 0 && (version < BASE_VERSION || version > SCHEMA_VERSION)) {
    log(`[pdfref] Schéma v${version} non migrable vers v${SCHEMA_VERSION} : l'index est reconstruit.`);
    await db.exec('DROP TABLE IF EXISTS pages_text');
    await db.exec('DROP TABLE IF EXISTS pages_ref');
    await db.exec('DROP TABLE IF EXISTS docs');
    version = 0;
  }

  if (version === 0) {
    await db.exec(DOCS_DDL); // base neuve : schéma complet, aucune migration à appliquer
  } else {
    for (const m of MIGRATIONS.filter((m) => m.version > version)) {
      log(`[pdfref] Migration du schéma v${version} → v${m.version}`);
      for (const step of m.up) await (typeof step === 'function' ? step(db) : db.exec(step));
      // version enregistrée après chaque étape : une migration interrompue reprend à la bonne étape
      await db.exec(`PRAGMA user_version = ${m.version}`);
      version = m.version;
    }
  }

  const existing = await db.all("SELECT name, sql FROM sqlite_master WHERE name IN ('pages_text', 'pages_ref')");
  if (existing.length === 0) {
    if (!caps.fts5) log(`[pdfref] FTS5 indisponible (SQLite ${caps.sqliteVersion}) : repli sur des tables classiques + LIKE.`);
    else if (!caps.trigram) log(`[pdfref] Tokenizer trigram indisponible (SQLite ${caps.sqliteVersion}) : repli sur LIKE '%…%'.`);
    await db.exec(caps.fts5 ? PAGES_TEXT_FTS : PAGES_TEXT_PLAIN);
    await db.exec(caps.trigram ? PAGES_REF_FTS : PAGES_REF_PLAIN);
  }
  await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  const [ref] = await db.all("SELECT sql FROM sqlite_master WHERE name = 'pages_ref'");
  const refMode = /trigram/i.test(ref.sql) ? 'trigram' : 'like';
  return { ...caps, refMode };
}
