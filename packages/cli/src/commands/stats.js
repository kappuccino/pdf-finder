import { getStats } from '@pdfref/core';
import { openIndex } from '../context.js';

export async function statsCommand(opts) {
  const { db, info } = await openIndex(opts.db);
  const { docs, pages } = await getStats(db);
  db.close();
  const ok = (b) => (b ? 'OK' : 'ABSENT');
  console.log(`Base           : ${opts.db}`);
  console.log(`Documents      : ${docs}`);
  console.log(`Pages          : ${pages}`);
  console.log(`SQLite         : ${info.sqliteVersion}`);
  console.log(`FTS5           : ${ok(info.fts5)}`);
  console.log(`Trigram        : ${ok(info.trigram)}`);
  console.log(`Mode recherche : ${info.refMode === 'trigram' ? 'MATCH trigram' : "LIKE '%…%' (repli)"}`);
}
