import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { indexDocument, listDocs, removeDoc } from '@pdfref/core';
import { openIndex } from '../context.js';
import { createNodeExtractor } from '../pdfjs-node.js';

async function collectPdfs(inputs) {
  const files = [];
  const walk = async (p) => {
    const st = await stat(p);
    if (st.isDirectory()) {
      const entries = await readdir(p, { withFileTypes: true });
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name.startsWith('.')) continue;
        await walk(path.join(p, e.name));
      }
    } else if (st.isFile() && p.toLowerCase().endsWith('.pdf')) {
      files.push(path.resolve(p));
    }
  };
  for (const input of inputs) await walk(input);
  return [...new Set(files)];
}

export async function indexCommand(inputs, opts) {
  const t0 = performance.now();
  const { db } = await openIndex(opts.db);
  const extractor = createNodeExtractor();
  const files = await collectPdfs(inputs);
  const tty = process.stderr.isTTY;
  const summary = { added: 0, updated: 0, skipped: 0, errors: 0, removed: 0, pages: 0 };

  for (const [i, file] of files.entries()) {
    const label = `[${i + 1}/${files.length}] ${path.relative(process.cwd(), file)}`;
    try {
      const bytes = new Uint8Array(await readFile(file));
      const st = await stat(file);
      // birthtime peut valoir 0 sur certains systèmes de fichiers : repli sur la date de modification
      const createdAt = Math.round(st.birthtimeMs || st.mtimeMs);
      const res = await indexDocument(db, { path: file, bytes, createdAt }, extractor, {
        force: opts.force,
        onPage: (n, total) => {
          if (tty) process.stderr.write(`\r\x1b[K${label} · page ${n}/${total}`);
        },
      });
      summary[res.status]++;
      if (res.status !== 'skipped') summary.pages += res.pageCount;
      if (tty) process.stderr.write('\r\x1b[K');
      console.error(`${label} · ${res.status === 'skipped' ? 'inchangé' : `${res.pageCount} pages`}`);
    } catch (err) {
      summary.errors++;
      if (tty) process.stderr.write('\r\x1b[K');
      console.error(`${label} · ERREUR (${err.code ?? err.name}) : ${err.message} — ignoré`);
    }
  }

  for (const doc of await listDocs(db)) {
    if (!existsSync(doc.path)) {
      await removeDoc(db, doc.id);
      summary.removed++;
      console.error(`retiré de l'index (fichier supprimé) : ${doc.path}`);
    }
  }
  db.close();

  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n${files.length} fichiers : ${summary.added} ajoutés, ${summary.updated} mis à jour, ${summary.skipped} inchangés, ` +
      `${summary.errors} en erreur, ${summary.removed} retirés · ${summary.pages} pages extraites · ${secs} s`,
  );
}
