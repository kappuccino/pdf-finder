import path from 'node:path';
import { search } from '@pdfref/core';
import { openIndex } from '../context.js';

export async function searchCommand(ref, opts) {
  const { db, info } = await openIndex(opts.db);
  const t0 = performance.now();
  const results = await search(db, ref, { refMode: info.refMode });
  const ms = performance.now() - t0;
  db.close();

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  if (results.length === 0) {
    console.log(`Aucun résultat pour « ${ref} » (${ms.toFixed(1)} ms).`);
    return;
  }
  const color = process.stdout.isTTY;
  for (const r of results) {
    const { snippet, highlight: h } = r;
    const shown = h && color ? snippet.slice(0, h.start) + '\x1b[1;33m' + snippet.slice(h.start, h.end) + '\x1b[0m' + snippet.slice(h.end) : snippet;
    const tag = r.match === 'exact' ? '' : r.match === 'prefix' ? '  [début de réf.]' : '  [≈ approximatif]';
    console.log(`${path.relative(process.cwd(), r.docPath)}  p.${r.pageNum}${tag}\n    ${shown}`);
  }
  console.log(`\n${results.length} résultat(s) en ${ms.toFixed(1)} ms.`);
}
