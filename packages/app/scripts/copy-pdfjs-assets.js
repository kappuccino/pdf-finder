// Copie les ressources pdfjs (polices standard, cMaps, wasm) dans public/ : servies localement, sans CDN.
import { cp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const src = path.dirname(require.resolve('pdfjs-dist/package.json'));
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pdfjs');

await rm(dest, { recursive: true, force: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm']) {
  await cp(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
console.log(`pdfjs assets → ${path.relative(process.cwd(), dest)}`);
