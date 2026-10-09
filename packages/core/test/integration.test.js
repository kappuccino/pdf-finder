// Fixtures → indexation → recherche → comparaison avec expected.json, + export.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportPage, exportPages, fileKind, indexDocument, indexImage, initSchema, search } from '../src/index.js';
import { makeFixtures } from '../../../scripts/make-fixtures.js';
import { openSqlite } from '../../cli/src/sqlite-adapter.js';
import { createNodeExtractor } from '../../cli/src/pdfjs-node.js';

let dir;
let expected;
const extractor = createNodeExtractor();
async function buildIndex(opts) {
  const db = openSqlite(':memory:');
  const info = await initSchema(db, { log: () => {}, ...opts });
  for (const f of await readdir(dir, { recursive: true })) {
    const p = path.join(dir, f);
    if (fileKind(p) === 'pdf') await indexDocument(db, { path: p, bytes: new Uint8Array(await readFile(p)) }, extractor);
    if (fileKind(p) === 'image') await indexImage(db, { path: p });
  }
  return { db, info };
}

/** Résultats regroupés au format d'expected.json. */
function group(results) {
  const byFile = new Map();
  for (const r of results) {
    const f = path.basename(r.docPath);
    if (!byFile.has(f)) byFile.set(f, []);
    if (r.pageNum != null) byFile.get(f).push(r.pageNum);
  }
  return [...byFile].map(([file, pages]) => ({ file, pages }));
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pdfref-'));
  expected = await makeFixtures(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.each([
  ['trigram', {}],
  ['repli LIKE', { disableTrigram: true }],
])('recherche (%s)', (mode, opts) => {
  let db;
  let info;
  beforeAll(async () => {
    ({ db, info } = await buildIndex(opts));
  });
  afterAll(() => db.close());

  it('utilise le bon mode', () => {
    expect(info.refMode).toBe(opts.disableTrigram ? 'like' : 'trigram');
  });

  it('trouve chaque référence d’expected.json avec les bons fichiers et pages', async () => {
    for (const [ref, want] of Object.entries(expected)) {
      const results = await search(db, ref, { refMode: info.refMode });
      expect(group(results), ref).toEqual(want);
    }
  });

  it('accepte les variantes de saisie', async () => {
    for (const q of ['ab 1234 x', 'ab1234x', 'AB_1234.X']) {
      expect(group(await search(db, q, { refMode: info.refMode }))).toEqual(expected['AB-1234-X']);
    }
  });

  it('met en premier les fichiers dont le nom contient la référence, image comprise', async () => {
    const [first] = await search(db, 'qr 7777 s', { refMode: info.refMode });
    expect(first).toMatchObject({ kind: 'image', pageNum: null, nameMatch: true, match: 'filename' });
    expect(path.basename(first.docPath).slice(first.nameHighlight.start, first.nameHighlight.end)).toBe('QR-7777-S');
  });

  it('renvoie un snippet avec la référence surlignée, même coupée sur deux lignes', async () => {
    const [r] = await search(db, 'EF9012Z', { refMode: info.refMode });
    expect(r.snippet.slice(r.highlight.start, r.highlight.end)).toBe('EF- 9012-Z');
  });

  it('ignore les saisies de moins de 3 caractères', async () => {
    expect(await search(db, 'a-b', { refMode: info.refMode })).toEqual([]);
  });
});

describe('indexation incrémentale', () => {
  it('met à jour la date de création même si le contenu est inchangé', async () => {
    const db = openSqlite(':memory:');
    await initSchema(db, { log: () => {} });
    const p = path.join(dir, 'cut.pdf');
    const bytes = new Uint8Array(await readFile(p));
    await indexDocument(db, { path: p, bytes, createdAt: 1000 }, extractor);
    expect((await indexDocument(db, { path: p, bytes, createdAt: 2000 }, extractor)).status).toBe('skipped');
    const [{ created_at }] = await db.all('SELECT created_at FROM docs');
    expect(created_at).toBe(2000);
    db.close();
  });

  it('ne retraite pas un fichier inchangé', async () => {
    const db = openSqlite(':memory:');
    await initSchema(db, { log: () => {} });
    const p = path.join(dir, 'simple.pdf');
    const bytes = new Uint8Array(await readFile(p));
    expect((await indexDocument(db, { path: p, bytes }, extractor)).status).toBe('added');
    expect((await indexDocument(db, { path: p, bytes }, extractor)).status).toBe('skipped');
    const [{ n }] = await db.all('SELECT COUNT(*) AS n FROM pages_ref');
    expect(n).toBe(5);
    db.close();
  });
});

describe('export', () => {
  it('produit un PDF d’une seule page, identique à l’original', async () => {
    const bytes = new Uint8Array(await readFile(path.join(dir, 'table.pdf')));
    const out = await exportPage(bytes, 2);

    const src = await PDFDocument.load(bytes);
    const exp = await PDFDocument.load(out);
    expect(exp.getPageCount()).toBe(1);
    expect(exp.getPage(0).getMediaBox()).toEqual(src.getPage(1).getMediaBox());

    const [orig] = (await extractor.extractPages(bytes)).pages.slice(1, 2);
    const [copy] = (await extractor.extractPages(out)).pages;
    expect(copy.text).toBe(orig.text);
  });

  it('fusionne plusieurs pages de plusieurs fichiers', async () => {
    const a = new Uint8Array(await readFile(path.join(dir, 'multi-a.pdf')));
    const b = new Uint8Array(await readFile(path.join(dir, 'multi-b.pdf')));
    const out = await exportPages([{ bytes: a, pageNum: 1 }, { bytes: a, pageNum: 4 }, { bytes: b, pageNum: 2 }]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it('refuse un numéro de page hors limites', async () => {
    const bytes = new Uint8Array(await readFile(path.join(dir, 'cut.pdf')));
    await expect(exportPage(bytes, 3)).rejects.toThrow(RangeError);
  });
});
