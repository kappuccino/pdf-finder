import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportFileName, exportPage, exportPages, normalize, search } from '@pdfref/core';
import { openIndex } from '../context.js';

const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');

export async function exportCommand(ref, opts) {
  const { db, info } = await openIndex(opts.db);
  const results = await search(db, ref, { refMode: info.refMode });
  db.close();
  if (results.length === 0) {
    console.error(`Aucun résultat pour « ${ref} ».`);
    process.exitCode = 1;
    return;
  }

  const selected = opts.all ? results : results.slice(0, 1);
  const refName = safe(normalize(ref));
  await mkdir(opts.out, { recursive: true });

  const cache = new Map();
  const load = async (p) => {
    if (!cache.has(p)) cache.set(p, new Uint8Array(await readFile(p)));
    return cache.get(p);
  };

  if (opts.all && opts.merge) {
    const items = [];
    for (const r of selected) items.push({ bytes: await load(r.docPath), pageNum: r.pageNum });
    const file = path.join(opts.out, `${refName}_${selected.length}pages.pdf`);
    await writeFile(file, await exportPages(items));
    console.log(file);
    return;
  }

  for (const r of selected) {
    const file = path.join(opts.out, exportFileName(r.docPath, r.pageNum, ref));
    await writeFile(file, await exportPage(await load(r.docPath), r.pageNum));
    console.log(file);
  }
}
