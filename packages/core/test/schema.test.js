import { describe, expect, it } from 'vitest';
import { BASE_VERSION, MIGRATIONS, SCHEMA_VERSION, initSchema } from '../src/schema.js';
import { openSqlite } from '../../cli/src/sqlite-adapter.js';

const quiet = { log: () => {} };
const version = async (db) => (await db.all('PRAGMA user_version'))[0].user_version;
const docsColumns = async (db) => (await db.all('PRAGMA table_info(docs)')).map((c) => `${c.name}:${c.type}`);

/** Base telle que la créait la v2 (premier schéma migrable), avec un document indexé. */
async function v2Database() {
  const db = openSqlite(':memory:');
  await db.exec(`
    CREATE TABLE docs (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, hash TEXT NOT NULL,
                       page_count INTEGER NOT NULL, indexed_at INTEGER NOT NULL);
    CREATE VIRTUAL TABLE pages_text USING fts5(content, doc_id UNINDEXED, page_num UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE pages_ref USING fts5(ref_norm, doc_id UNINDEXED, page_num UNINDEXED, tokenize = 'trigram');
    INSERT INTO docs VALUES (1, '/a.pdf', 'h', 1, 0);
    INSERT INTO pages_text (rowid, content, doc_id, page_num) VALUES (100001, 'Réf. AB-1234-X', 1, 1);
    INSERT INTO pages_ref (rowid, ref_norm, doc_id, page_num) VALUES (100001, 'REFAB1234X', 1, 1);
    PRAGMA user_version = ${BASE_VERSION};`);
  return db;
}

describe('migrations du schéma', () => {
  it('versions strictement croissantes, la dernière = SCHEMA_VERSION', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions[0]).toBe(BASE_VERSION + 1);
    versions.forEach((v, i) => expect(v).toBe(BASE_VERSION + 1 + i));
    expect(versions.at(-1)).toBe(SCHEMA_VERSION);
  });

  it('base neuve : schéma complet à la dernière version', async () => {
    const db = openSqlite(':memory:');
    await initSchema(db, quiet);
    expect(await version(db)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('base v2 migrée = base neuve, sans perte de données', async () => {
    const fresh = openSqlite(':memory:');
    await initSchema(fresh, quiet);
    const migrated = await v2Database();
    const logs = [];
    await initSchema(migrated, { log: (m) => logs.push(m) });

    expect(await version(migrated)).toBe(SCHEMA_VERSION);
    expect(await docsColumns(migrated)).toEqual(await docsColumns(fresh));
    expect(await migrated.all('SELECT path, created_at FROM docs')).toEqual([{ path: '/a.pdf', created_at: null }]);
    expect(await migrated.all('SELECT COUNT(*) AS n FROM pages_ref')).toEqual([{ n: 1 }]);
    expect(logs.some((m) => /reconstruit/.test(m))).toBe(false);
    fresh.close();
    migrated.close();
  });

  it('idempotent : un second démarrage ne refait rien', async () => {
    const db = await v2Database();
    await initSchema(db, quiet);
    const logs = [];
    await initSchema(db, { log: (m) => logs.push(m) });
    expect(logs).toEqual([]);
    db.close();
  });

  it.each([
    ['trop ancienne (v1)', 1],
    ['plus récente que l’app', SCHEMA_VERSION + 1],
  ])('base %s : reconstruite à la dernière version', async (_, v) => {
    const db = openSqlite(':memory:');
    await db.exec(`CREATE TABLE docs (id INTEGER PRIMARY KEY, path TEXT); INSERT INTO docs VALUES (1, '/x.pdf'); PRAGMA user_version = ${v};`);
    const logs = [];
    await initSchema(db, { log: (m) => logs.push(m) });
    expect(await version(db)).toBe(SCHEMA_VERSION);
    expect(await db.all('SELECT COUNT(*) AS n FROM docs')).toEqual([{ n: 0 }]);
    expect(logs.some((m) => /reconstruit/.test(m))).toBe(true);
    db.close();
  });
});
