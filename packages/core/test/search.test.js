import { beforeAll, describe, expect, it } from 'vitest';
import { findBestMatch, getStats, initSchema, insertPages, search } from '../src/index.js';
import { openSqlite } from '../../cli/src/sqlite-adapter.js';

describe('findBestMatch', () => {
  const quality = (content, q) => findBestMatch(content, q)?.match;

  it('exact quand la référence est délimitée, même coupée à l’intérieur', () => {
    expect(quality('Réf. 0540010R13 Module', '0540010R13')).toBe('exact');
    expect(quality('modules G3\n0540010R13', '0540010R13')).toBe('exact');
    expect(quality('la grille EF-\n9012-Z ainsi', 'EF9012Z')).toBe('exact');
    expect(quality('0540010R13', '0540010R13')).toBe('exact');
  });

  it('prefix quand la saisie est un début de référence', () => {
    expect(quality('Réf. 0540010R13', '0540010')).toBe('prefix');
  });

  it('partial quand la correspondance est collée à du texte avant', () => {
    expect(quality('modules G3\n0540010R13', '30540')).toBe('partial');
    expect(quality('G30540010R13', '0540010R13')).toBe('partial');
  });

  it('retient la meilleure occurrence de la page', () => {
    const content = 'G30540010R13 … puis plus bas Réf. 0540010R13';
    const m = findBestMatch(content, '0540010R13');
    expect(m.match).toBe('exact');
    expect(content.slice(m.start, m.end)).toBe('0540010R13');
  });
});

describe('search : classement', () => {
  let db;
  beforeAll(async () => {
    db = openSqlite(':memory:');
    await initSchema(db, { log: () => {} });
    const { lastInsertId } = await db.run("INSERT INTO docs (path, hash, page_count, indexed_at) VALUES ('/a.pdf', 'x', 3, 0)");
    await insertPages(db, lastInsertId, [
      { pageNum: 1, text: 'texte collé G30540010R13 6980826' },
      { pageNum: 2, text: 'Réf. 0540010R13X variante' },
      { pageNum: 3, text: 'Nom Enedis 6980826\nRéf. 0540010R13' },
    ]);
  });

  it('ordre fichier/page conservé, les partial en dernier', async () => {
    const res = await search(db, '0540010R13');
    expect(res.map((r) => [r.pageNum, r.match])).toEqual([
      [2, 'prefix'],
      [3, 'exact'],
      [1, 'partial'],
    ]);
  });

  it('aucun résultat perdu', async () => {
    expect(await search(db, '30540')).toHaveLength(1);
  });
});

describe('search : tri par date de création', () => {
  it('les fichiers les plus récents d’abord, sans date à la fin', async () => {
    const db = openSqlite(':memory:');
    await initSchema(db, { log: () => {} });
    const docs = [
      ['/vieux.pdf', Date.UTC(2020, 0, 1)],
      ['/sans-date.pdf', null],
      ['/recent.pdf', Date.UTC(2026, 5, 1)],
      ['/moyen.pdf', Date.UTC(2024, 2, 1)],
    ];
    for (const [path, createdAt] of docs) {
      const { lastInsertId } = await db.run("INSERT INTO docs (path, hash, page_count, indexed_at, created_at) VALUES (?, 'x', 1, 0, ?)", [path, createdAt]);
      await insertPages(db, lastInsertId, [{ pageNum: 1, text: 'Réf. AB-1234-X' }]);
    }
    const res = await search(db, 'AB1234X');
    expect(res.map((r) => r.docPath)).toEqual(['/recent.pdf', '/moyen.pdf', '/vieux.pdf', '/sans-date.pdf']);
    expect(res[0].createdAt).toBe(Date.UTC(2026, 5, 1));
    db.close();
  });
});

describe('search : nom de fichier en premier', () => {
  it('nom de fichier d’abord (même ancien), puis date décroissante ; image et PDF sans page = fichier entier', async () => {
    const { indexImage } = await import('../src/index.js');
    const { nameNorm } = await import('../src/files.js');
    const db = openSqlite(':memory:');
    await initSchema(db, { log: () => {} });
    const addPdf = async (path, createdAt, text) => {
      const { lastInsertId } = await db.run(
        "INSERT INTO docs (path, hash, page_count, indexed_at, created_at, kind, name_norm) VALUES (?, 'x', 1, 0, ?, 'pdf', ?)",
        [path, createdAt, nameNorm(path)],
      );
      await insertPages(db, lastInsertId, [{ pageNum: 1, text }]);
    };
    await addPdf('/catalogue-recent.pdf', 3000, 'Réf. ABC-123');
    await addPdf('/ABC-123.pdf', 1000, 'Notice du coffret ABC-123');
    await addPdf('/notice abc_123.pdf', 2000, 'Notice sans la référence');
    await indexImage(db, { path: '/photos/abc-123.JPG', createdAt: 1500 });
    await indexImage(db, { path: '/photos/autre.png', createdAt: 9000 });

    const res = await search(db, 'ABC123');
    expect(res.map((r) => [r.docPath, r.pageNum, r.nameMatch])).toEqual([
      ['/notice abc_123.pdf', null, true],
      ['/photos/abc-123.JPG', null, true],
      ['/ABC-123.pdf', 1, true],
      ['/catalogue-recent.pdf', 1, false],
    ]);
    expect(res[1]).toMatchObject({ kind: 'image', match: 'filename', snippet: '', nameHighlight: { start: 0, end: 7 } });
    expect(await getStats(db)).toEqual({ docs: 3, images: 2, pages: 3 });
    db.close();
  });
});
