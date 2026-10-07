import { normalize } from './normalize.js';
import { sha1Hex } from './hash.js';

/**
 * Indexe (ou réindexe si le contenu a changé) un PDF.
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

  await db.transaction(async () => {
    let docId;
    if (existing) {
      docId = existing.id;
      await deleteDocPages(db, docId);
      await db.run('UPDATE docs SET hash = ?, page_count = ?, indexed_at = ? WHERE id = ?', [hash, pageCount, Date.now(), docId]);
    } else {
      const res = await db.run('INSERT INTO docs (path, hash, page_count, indexed_at) VALUES (?, ?, ?, ?)', [docPath, hash, pageCount, Date.now()]);
      docId = res.lastInsertId;
    }
    await insertPages(db, docId, pages);
  });

  return { status: existing ? 'updated' : 'added', pageCount };
}

/**
 * Insère des pages déjà extraites. pages_text et pages_ref partagent le même rowid.
 * @param {import('./db-adapter.js').DbAdapter} db
 * @param {number} docId
 * @param {{ pageNum: number, text: string }[]} pages
 */
export async function insertPages(db, docId, pages) {
  for (const { pageNum, text } of pages) {
    const { lastInsertId } = await db.run('INSERT INTO pages_text (content, doc_id, page_num) VALUES (?, ?, ?)', [text, docId, pageNum]);
    await db.run('INSERT INTO pages_ref (rowid, ref_norm, doc_id, page_num) VALUES (?, ?, ?, ?)', [lastInsertId, normalize(text), docId, pageNum]);
  }
}

/** @param {import('./db-adapter.js').DbAdapter} db @param {number} docId */
async function deleteDocPages(db, docId) {
  await db.run('DELETE FROM pages_text WHERE doc_id = ?', [docId]);
  await db.run('DELETE FROM pages_ref WHERE doc_id = ?', [docId]);
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
