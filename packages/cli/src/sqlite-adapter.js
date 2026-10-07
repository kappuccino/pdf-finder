import Database from 'better-sqlite3';

/**
 * Enveloppe better-sqlite3 (synchrone) dans l'interface asynchrone DbAdapter du cœur.
 * @param {string} file chemin du fichier .db ou ':memory:'
 */
export function openSqlite(file) {
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  const statements = new Map();
  const prepare = (sql) => {
    let stmt = statements.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      statements.set(sql, stmt);
    }
    return stmt;
  };

  /** @type {import('@pdfref/core/src/db-adapter.js').DbAdapter & { close(): void }} */
  const adapter = {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      const res = prepare(sql).run(...params);
      return { lastInsertId: Number(res.lastInsertRowid), changes: res.changes };
    },
    async all(sql, params = []) {
      return prepare(sql).all(...params);
    },
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close() {
      db.close();
    },
  };
  return adapter;
}
