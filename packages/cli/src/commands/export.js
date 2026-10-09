import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
    // fusion des pages trouvées ; les fichiers entiers (images, PDF trouvés par leur nom) sont ignorés
    const pages = selected.filter((r) => r.pageNum != null);
    const skipped = selected.length - pages.length;
    if (skipped) console.error(`${skipped} fichier(s) entier(s) (images, PDF trouvés par leur nom) non inclus dans la fusion.`);
    if (!pages.length) return;
    const items = [];
    for (const r of pages) items.push({ bytes: await load(r.docPath), pageNum: r.pageNum });
    const file = path.join(opts.out, `${refName}_${pages.length}pages.pdf`);
    await writeFile(file, await exportPages(items));
    console.log(file);
    return;
  }

  for (const r of selected) {
    if (r.pageNum == null) {
      // fichier entier (image, ou PDF trouvé par son nom) : copie telle quelle
      const file = path.join(opts.out, path.basename(r.docPath));
      await copyFile(r.docPath, file);
      console.log(file);
      continue;
    }
    const file = path.join(opts.out, exportFileName(r.docPath, r.pageNum, ref));
    await writeFile(file, await exportPage(await load(r.docPath), r.pageNum));
    console.log(file);
  }
}
