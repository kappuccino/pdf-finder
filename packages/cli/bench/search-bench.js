// Bench de recherche : ~10 000 pages synthétiques réalistes, puis 100 requêtes.
// Usage : node packages/cli/bench/search-bench.js [nbPages]
import { initSchema, insertPages, search } from '@pdfref/core';
import { openSqlite } from '../src/sqlite-adapter.js';

const PAGES = Number(process.argv[2] ?? 10_000);
const PAGES_PER_DOC = 100;
const WORDS = 'coffret panneau grille socle borne armoire fusible disjoncteur colonne liaison isolant protection monophasé triphasé'.split(' ');

// Générateur pseudo-aléatoire déterministe
let seed = 42;
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed % n;
};
const ref = () => `${String.fromCharCode(65 + rand(26), 65 + rand(26))}-${String(rand(10000)).padStart(4, '0')}-${String.fromCharCode(65 + rand(26))}`;

const db = openSqlite(':memory:');
const info = await initSchema(db);

const t0 = performance.now();
const knownRefs = [];
await db.transaction(async () => {
  for (let d = 0; d < PAGES / PAGES_PER_DOC; d++) {
    const { lastInsertId: docId } = await db.run('INSERT INTO docs (path, hash, page_count, indexed_at) VALUES (?, ?, ?, ?)', [`/bench/doc-${d}.pdf`, 'x', PAGES_PER_DOC, Date.now()]);
    const pages = [];
    for (let p = 1; p <= PAGES_PER_DOC; p++) {
      const lines = [];
      for (let l = 0; l < 40; l++) {
        const words = Array.from({ length: 8 }, () => WORDS[rand(WORDS.length)]).join(' ');
        lines.push(l % 4 === 0 ? `${words} Réf. ${ref()}` : words);
      }
      pages.push({ pageNum: p, text: lines.join('\n') });
    }
    knownRefs.push(pages[rand(PAGES_PER_DOC)].text.match(/Réf\. (\S+)/)[1]);
    await insertPages(db, docId, pages);
  }
});
const [{ n }] = await db.all('SELECT COUNT(*) AS n FROM pages_ref');
console.log(`${n} pages indexées en ${((performance.now() - t0) / 1000).toFixed(1)} s (SQLite ${info.sqliteVersion}, mode ${info.refMode})`);

const queries = [];
for (let i = 0; i < 100; i++) {
  // mélange : références existantes, absentes, et préfixes courts (beaucoup de résultats)
  queries.push(i % 3 === 0 ? knownRefs[rand(knownRefs.length)] : i % 3 === 1 ? 'ZZ-9999-Q' : knownRefs[rand(knownRefs.length)].slice(0, 4));
}
await search(db, queries[0], { refMode: info.refMode }); // échauffement

const times = [];
let hits = 0;
for (const q of queries) {
  const t = performance.now();
  hits += (await search(db, q, { refMode: info.refMode })).length;
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))].toFixed(2);
console.log(`100 recherches · p50 ${pct(50)} ms · p95 ${pct(95)} ms · max ${times.at(-1).toFixed(2)} ms · ${hits} résultats au total`);
const ok = Number(pct(95)) < 100;
console.log(ok ? 'OK : p95 < 100 ms' : 'ÉCHEC : p95 ≥ 100 ms');
db.close();
process.exitCode = ok ? 0 : 1;
