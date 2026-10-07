import { initSchema } from '@pdfref/core';
import { openSqlite } from './sqlite-adapter.js';

export const DEFAULT_DB = './index.db';

/** Ouvre la base, crée le schéma et renvoie { db, info }. */
export async function openIndex(file = DEFAULT_DB) {
  const db = openSqlite(file);
  const info = await initSchema(db, { log: (msg) => console.warn(msg) });
  return { db, info };
}
