import { beforeAll, describe, expect, it } from 'vitest';
import { findBestMatch, initSchema, insertPages, search } from '../src/index.js';
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

  it('exact, puis prefix, puis partial', async () => {
    const res = await search(db, '0540010R13');
    expect(res.map((r) => [r.pageNum, r.match])).toEqual([
      [3, 'exact'],
      [2, 'prefix'],
      [1, 'partial'],
    ]);
  });

  it('aucun résultat perdu', async () => {
    expect(await search(db, '30540')).toHaveLength(1);
  });
});
