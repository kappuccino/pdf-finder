// Adapter tauri-plugin-sql → interface DbAdapter du cœur.
import Database from '@tauri-apps/plugin-sql';
import { initSchema } from '@pdfref/core';

export const DB_URL = 'sqlite:index.db'; // résolu dans le dossier de config de l'app

/** @returns {Promise<import('@pdfref/core/src/db-adapter.js').DbAdapter>} */
async function openAdapter() {
  const db = await Database.load(DB_URL);
  return {
    async exec(sql) {
      await db.execute(sql);
    },
    async run(sql, params = []) {
      const res = await db.execute(sql, params);
      return { lastInsertId: res.lastInsertId, changes: res.rowsAffected };
    },
    all(sql, params = []) {
      return db.select(sql, params);
    },
    // Le plugin utilise un pool de connexions : un BEGIN/COMMIT n'est pas garanti sur la même
    // connexion. Le cœur est écrit pour ne pas en dépendre (hash écrit en dernier).
    transaction(fn) {
      return fn();
    },
  };
}

let opening;
/** Ouvre la base une seule fois, crée le schéma et renvoie { db, info }. */
export function openIndex() {
  opening ??= (async () => {
    const db = await openAdapter();
    const info = await initSchema(db, { log: (msg) => console.warn(msg) });
    if (info.refMode !== 'trigram') console.warn('[pdfref] trigram indisponible : recherche en mode LIKE');
    return { db, info };
  })();
  return opening;
}
