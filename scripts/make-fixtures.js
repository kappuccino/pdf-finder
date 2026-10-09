// Génère les PDF de test (pdf-lib) + expected.json (ref → fichiers/pages attendus).
// Usage : node scripts/make-fixtures.js [dossier]   (défaut : ./fixtures)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const MARGIN = 56;
const SIZE = 11;
const LEADING = 15;

const FILLER = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt.',
  'Coffret de branchement en matériau isolant, degré de protection IP43 et IK10.',
];

async function newDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

/** Ajoute une page de texte courant ; `lines` remplace le début du texte de remplissage. */
function textPage({ doc, font, bold }, title, lines = [], fillerCount = 20) {
  const page = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  page.drawText(title, { x: MARGIN, y, size: 16, font: bold });
  y -= 2 * LEADING;
  for (const line of [...lines, ...Array.from({ length: fillerCount }, (_, i) => FILLER[i % FILLER.length])]) {
    page.drawText(line, { x: MARGIN, y, size: SIZE, font });
    y -= LEADING;
  }
  return page;
}

async function simple() {
  const ctx = await newDoc();
  for (let p = 1; p <= 5; p++) {
    textPage(ctx, `Catalogue simple — page ${p}`, p === 3 ? ['Coffret S15 monophasé : Réf. AB-1234-X (livré sans socle).'] : []);
  }
  return ctx.doc.save();
}

async function multi(name, refPages, variant) {
  const ctx = await newDoc();
  const count = Math.max(...refPages, 3);
  for (let p = 1; p <= count; p++) {
    textPage(ctx, `${name} — page ${p}`, refPages.includes(p) ? [`Panneau de comptage, référence ${variant}.`] : []);
  }
  return ctx.doc.save();
}

async function cut() {
  const ctx = await newDoc();
  textPage(ctx, 'Référence coupée — page 1');
  const page = textPage(ctx, 'Référence coupée — page 2', [], 0);
  const lines = [
    'Pour une installation en façade, il convient de commander la grille EF-',
    '9012-Z ainsi que son kit de fixation, disponible séparément.',
  ];
  let y = A4[1] - MARGIN - 2 * LEADING;
  for (const line of lines) {
    page.drawText(line, { x: MARGIN, y, size: SIZE, font: ctx.font });
    y -= LEADING;
  }
  return ctx.doc.save();
}

async function table() {
  const ctx = await newDoc();
  textPage(ctx, 'Tableau — page 1');
  const page = ctx.doc.addPage(A4);
  page.drawText('Tableau — page 2', { x: MARGIN, y: A4[1] - MARGIN, size: 16, font: ctx.bold });

  const cols = [MARGIN, MARGIN + 220, MARGIN + 380];
  const rows = [
    ['Désignation', 'Réf.', 'Prix HT'],
    ['Coffret extérieur', ['GH-34', '56-W'], '412,00'],
    ['Panneau abonné', ['MN', '-7788-P'], '96,50'],
    ['Socle', 'OP-1100-R', '58,00'],
  ];
  const top = A4[1] - MARGIN - 40;
  const rowH = 22;
  // Les cellules sont dessinées colonne par colonne (et non ligne par ligne),
  // et certaines références en plusieurs fragments, comme dans un vrai tableau généré.
  for (let c = 0; c < cols.length; c++) {
    rows.forEach((row, r) => {
      const y = top - r * rowH;
      const cell = row[c];
      const font = r === 0 ? ctx.bold : ctx.font;
      if (Array.isArray(cell)) {
        let x = cols[c] + 4;
        for (const frag of cell) {
          page.drawText(frag, { x, y, size: SIZE, font });
          x += font.widthOfTextAtSize(frag, SIZE);
        }
      } else {
        page.drawText(cell, { x: cols[c] + 4, y, size: SIZE, font });
      }
    });
  }
  for (let r = 0; r <= rows.length; r++) {
    const y = top + 15 - r * rowH;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 480, y }, thickness: 0.5, color: rgb(0.4, 0.4, 0.4) });
  }
  return ctx.doc.save();
}

async function big(pageCount, refs) {
  const ctx = await newDoc();
  for (let p = 1; p <= pageCount; p++) {
    const lines = Object.entries(refs)
      .filter(([, pages]) => pages.includes(p))
      .map(([ref]) => `Article catalogue : ${ref}.`);
    textPage(ctx, `Gros catalogue — page ${p}`, lines, 30);
  }
  return ctx.doc.save();
}

// PNG 1×1 (gris) : les images ne sont indexées que par leur nom, le contenu importe peu.
const TINY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/** PDF dont le nom porte la référence, mais pas le texte (cas « notice ABC.pdf »). */
async function namedNotice() {
  const ctx = await newDoc();
  textPage(ctx, 'Notice de montage', ['Ce document décrit le montage du coffret (référence dans le nom du fichier).']);
  return ctx.doc.save();
}

/**
 * Génère les fixtures dans `dir` et renvoie l'objet expected.
 * @param {string} dir
 */
export async function makeFixtures(dir) {
  await mkdir(dir, { recursive: true });
  const bigRefs = { 'KL-0001-A': [1, 250, 520], 'QR-7777-S': [137] };
  const files = {
    'simple.pdf': await simple(),
    'multi-a.pdf': await multi('Multi A', [1, 4], 'CD-5678-Y'),
    'multi-b.pdf': await multi('Multi B', [2], 'cd 5678 y'),
    'cut.pdf': await cut(),
    'table.pdf': await table(),
    'big-500.pdf': await big(520, bigRefs),
    'AB-1234-X notice.pdf': await namedNotice(),
    'images/QR-7777-S.png': TINY_PNG,
  };
  await mkdir(path.join(dir, 'images'), { recursive: true });
  for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(dir, name), bytes);

  // Ordre attendu : fichiers dont le NOM contient la référence d'abord (pages: [] = fichier entier).
  const expected = {
    'AB-1234-X': [
      { file: 'AB-1234-X notice.pdf', pages: [] },
      { file: 'simple.pdf', pages: [3] },
    ],
    'CD-5678-Y': [
      { file: 'multi-a.pdf', pages: [1, 4] },
      { file: 'multi-b.pdf', pages: [2] },
    ],
    'EF-9012-Z': [{ file: 'cut.pdf', pages: [2] }],
    'GH-3456-W': [{ file: 'table.pdf', pages: [2] }],
    'MN-7788-P': [{ file: 'table.pdf', pages: [2] }],
    'OP-1100-R': [{ file: 'table.pdf', pages: [2] }],
    'KL-0001-A': [{ file: 'big-500.pdf', pages: bigRefs['KL-0001-A'] }],
    'QR-7777-S': [
      { file: 'QR-7777-S.png', pages: [] },
      { file: 'big-500.pdf', pages: bigRefs['QR-7777-S'] },
    ],
    'ZZ-9999-Z': [],
  };
  await writeFile(path.join(dir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  return expected;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? 'fixtures');
  await makeFixtures(dir);
  console.log(`Fixtures générées dans ${dir}`);
}
