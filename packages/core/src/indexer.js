import { normalize } from './normalize.js';
import { sha1Hex } from './hash.js';

/** Rowid des pages : docId × PAGE_STRIDE + n° de page (identique dans pages_text et pages_ref). */
export const PAGE_STRIDE = 100_000;
const BATCH = 200;

/**
 * Indexe (ou réindexe si le contenu a changé) un PDF.
 *
 * L'écriture ne dépend pas d'une transaction (le pool du plugin SQL de Tauri ne garantit pas
 * qu'un BEGIN/COMMIT reste sur la même connexion) : le hash est enregistré en dernier,
 * donc une indexation interrompue est simplement refaite au passage suivant.
 *
 * @param {import('./db-adapter.js').DbAdapter} db
 * @param {{ path: string, bytes: Uint8Array }} file
 * @param {{ extractPages: Function }} extractor
 * @param {{ onPage?: (pageNum: number, pageCount: number) => void, force?: boolean }} [opts]
 * @returns {Promise<{ status: 'added' | 'updated' | 'skipped', pageCount: number }>}
 */
export async function indexDocument(db, { path, bytes }, extractor, { onPage, force = false } = {}) {
  const docPath = path.normalize('NFC');
  const hash = await sha1Hex(bytes);
  const [existing] = await db.all('SELECT id, hash, page_count FROM docs WHERE path = ?', [docPath]);
  if (existing && existing.hash === hash && !force) {
    return { status: 'skipped', pageCount: existing.page_count };
  }

  const { pageCount, pages } = await extractor.extractPages(bytes, { onPage });
  if (pageCount >= PAGE_STRIDE) throw new RangeError(`Trop de pages (${pageCount})`);

  await db.transaction(async () => {
    let docId = existing?.id;
    if (docId) {
      await db.run("UPDATE docs SET hash = '' WHERE id = ?", [docId]);
      await deleteDocPages(db, docId);
    } else {
      const res = await db.run("INSERT INTO docs (path, hash, page_count, indexed_at) VALUES (?, '', 0, 0)", [docPath]);
      docId = res.lastInsertId;
    }
    await insertPages(db, docId, pages);
    await db.run('UPDATE docs SET hash = ?, page_count = ?, indexed_at = ? WHERE id = ?', [hash, pageCount, Date.now(), docId]);
  });

  return { status: existing ? 'updated' : 'added', pageCount };
}

/**
 * Insère des pages déjà extraites, par lots multi-lignes.
 * @param {import('./db-adapter.js').DbAdapter} db
 * @param {number} docId
 * @param {{ pageNum: number, text: string }[]} pages
 */
export async function insertPages(db, docId, pages) {
  for (let i = 0; i < pages.length; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);
    const values = batch.map(() => '(?, ?, ?, ?)').join(', ');
    const textParams = [];
    const refParams = [];
    for (const { pageNum, text } of batch) {
      const rowid = docId * PAGE_STRIDE + pageNum;
      textParams.push(rowid, text, docId, pageNum);
      refParams.push(rowid, normalize(text), docId, pageNum);
    }
    await db.run(`INSERT INTO pages_text (rowid, content, doc_id, page_num) VALUES ${values}`, textParams);
    await db.run(`INSERT INTO pages_ref (rowid, ref_norm, doc_id, page_num) VALUES ${values}`, refParams);
  }
}

/** @param {import('./db-adapter.js').DbAdapter} db @param {number} docId */
async function deleteDocPages(db, docId) {
  const range = [docId * PAGE_STRIDE, (docId + 1) * PAGE_STRIDE - 1];
  await db.run('DELETE FROM pages_text WHERE rowid BETWEEN ? AND ?', range);
  await db.run('DELETE FROM pages_ref WHERE rowid BETWEEN ? AND ?', range);
}

/**
 * @param {import('./db-adapter.js').DbAdapter} db
 * @returns {Promise<{ id: number, path: string, hash: string, page_count: number, indexed_at: number }[]>}
 */
export function listDocs(db) {
  return db.all('SELECT id, path, hash, page_count, indexed_at FROM docs ORDER BY path');
}

/** Retire un document de l'index. @param {import('./db-adapter.js').DbAdapter} db @param {number} docId */
export function removeDoc(db, docId) {
  return db.transaction(async () => {
    await deleteDocPages(db, docId);
    await db.run('DELETE FROM docs WHERE id = ?', [docId]);
  });
}

/** @param {import('./db-adapter.js').DbAdapter} db */
export async function getStats(db) {
  const [{ docs }] = await db.all('SELECT COUNT(*) AS docs FROM docs');
  const [{ pages }] = await db.all('SELECT COUNT(*) AS pages FROM pages_ref');
  return { docs, pages };
}
