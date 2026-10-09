// Auto-test de la chaîne complète dans la vraie webview (développement uniquement).
// Lancé par scripts/selftest.sh : index d'un dossier, recherches, rendu, génération du PDF de drag.
// Rapport écrit dans $APPCACHE/selftest.json.
import { writeFile, stat } from '@tauri-apps/plugin-fs';

const enc = new TextEncoder();
const writeText = (file, text, opts) => writeFile(file, enc.encode(text), opts);
import { appCacheDir, join } from '@tauri-apps/api/path';
import { search } from '@pdfref/core';
import { indexFolder } from './indexer.js';
import { prepareDrag } from './drag.js';

export async function runSelfTest(db, info, dir, refs) {
  const report = { userAgent: navigator.userAgent, info, dir };
  const logFile = await join(await appCacheDir(), 'selftest.log');
  const log = (msg) => writeText(logFile, `${new Date().toISOString()} ${msg}\n`, { append: true }).catch(() => {});
  await writeText(logFile, '');
  try {
    // Fluidité de l'UI pendant l'indexation : plus grand écart entre deux frames.
    let maxGap = 0;
    let last = performance.now();
    let running = true;
    const tick = (t) => {
      maxGap = Math.max(maxGap, t - last);
      last = t;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    let lastFile = '';
    report.index = await indexFolder(db, dir, (p) => {
      if (p.file !== lastFile) log(`index ${p.index + 1}/${p.total} ${(lastFile = p.file)}`);
    });
    log('index terminé');
    running = false;
    report.index.maxFrameGapMs = Math.round(maxGap);

    report.searches = {};
    for (const ref of refs) {
      const t0 = performance.now();
      const res = await search(db, ref, { refMode: info.refMode });
      report.searches[ref] = {
        ms: Math.round(performance.now() - t0),
        results: res.map((r) => `${r.docPath.split('/').pop()} ${r.kind} p${r.pageNum ?? '-'} ${r.match}${r.nameMatch ? ' [nom]' : ''}`),
      };
    }

    // drag : premier résultat de chaque recherche (page générée, ou fichier entier : image / PDF par nom)
    report.drag = {};
    for (const ref of refs) {
      const [first] = await search(db, ref, { refMode: info.refMode });
      if (!first) continue;
      const [file, icon] = await prepareDrag(first, ref);
      report.drag[ref] = { file, size: (await stat(file)).size, iconLength: icon.length };
    }
    report.ok = true;
  } catch (err) {
    report.ok = false;
    report.error = String(err?.stack ?? err);
  }
  await writeText(await join(await appCacheDir(), 'selftest.json'), JSON.stringify(report, null, 2));
  console.log('[selftest]', report);
}
