# PDF Ref Finder — POC

Recherche de références produit dans des PDF, 100 % offline. Voir [BRIEF.md](BRIEF.md).

**Phase 1 (CLI Node) : terminée.** Phase 2 (Tauri) : pas commencée, on fait d'abord un point d'étape.

Écarts au brief, validés : le code est en **JavaScript (ESM)** et non en TypeScript, et utilise **Node 25 + npm workspaces** au lieu de pnpm.

## Installation

```bash
npm install
npm run fixtures        # génère fixtures/*.pdf + fixtures/expected.json
npm test                # lint (isolation de core) + tests unitaires + test d'intégration
npm run bench           # bench de recherche sur 10 000 pages
```

## CLI

```bash
npx pdfref index <dossier|fichiers...> [--db ./index.db] [--force]
npx pdfref search <ref> [--db ./index.db] [--json]
npx pdfref export <ref> [--out ./out] [--all] [--merge] [--db ./index.db]
npx pdfref stats [--db ./index.db]
```

(équivalent : `node packages/cli/src/main.js …`)

- `index` est récursif et incrémental (SHA-1 du fichier). Un PDF corrompu ou protégé est signalé puis ignoré. Les fichiers supprimés du disque sont retirés de l'index.
- `export` produit `{nomPDF}_p{num}_{REF}.pdf`. Avec `--all --merge`, il produit un seul PDF `{REF}_{n}pages.pdf`.
- Les numéros de page sont ceux du **fichier PDF** (base 1). Ils diffèrent parfois du numéro imprimé en pied de page des catalogues.

## Structure

```
packages/core/   logique métier pure JS — aucune API Node/Tauri (vérifié par ESLint)
  src/normalize.js     normalize() + normalizeWithMap() (positions d'origine, pour snippet/surlignage)
  src/extract-text.js  createExtractor(pdfjs) : pdfjs injecté → texte par page
  src/schema.js        DDL, détection FTS5/trigram, repli LIKE
  src/indexer.js       indexDocument, listDocs, removeDoc, getStats
  src/search.js        search() → { docPath, pageNum, snippet, highlight }[]
  src/export-page.js   exportPage / exportPages (pdf-lib copyPages)
  src/db-adapter.js    interface DbAdapter (JSDoc)
packages/cli/    adapter better-sqlite3, init pdfjs legacy (ressources locales), commandes, bench
scripts/make-fixtures.js
```

Choix techniques notables :

- `pages_text` et `pages_ref` partagent le même `rowid`. La jointure snippet/résultat se fait donc par clé primaire.
- Le snippet est calculé en JS via `normalizeWithMap`, ce qui permet de surligner la référence même quand elle est coupée sur deux lignes (`EF-⏎9012-Z`).
- La normalisation supprime aussi les tirets typographiques (`–`, `—`, `‑`) et les espaces insécables, en plus de ce que liste le brief.
- **Classement des résultats** (`match` dans chaque résultat). On ne filtre jamais, on classe :
  - `exact` : la référence est délimitée dans le texte d'origine (espace, saut de ligne, ponctuation, début/fin de page) ;
  - `prefix` : seul le début est délimité (saisie incomplète) ;
  - `partial` : la référence est collée à du texte avant, par exemple `30540` dans `G30540010R13`. Affiché `[≈ approximatif]` dans la CLI.

  Les coupures à l'intérieur de la référence (`EF-⏎9012-Z`) restent `exact`. Le tri porte sur les 200 résultats max renvoyés par SQLite.
- Extraction : on change de ligne si `hasEOL`, si Y varie, ou si un fragment repart à gauche du précédent sur la même ligne (colonne de tableau). Cette règle est générale, sans réglage par PDF.
- Repli `LIKE` : il s'active automatiquement si `trigram` est absent, avec un message explicite. `initSchema(db, { disableTrigram: true })` permet de le forcer, et le test d'intégration tourne dans les deux modes.

## Résultats (macOS, Node 25.8, better-sqlite3 13.0.3)

| Critère | Résultat |
|---|---|
| `npm test` | 37 tests OK : normalize, extraction, classement, intégration × 2 modes, incrémental, export |
| Références des fixtures (simple, multi-pages/multi-fichiers, coupée, tableau) | toutes trouvées, pages exactes |
| Bench 10 000 pages | p50 5 ms · **p95 31 ms** (cible < 100 ms) |
| Export | 1 page, MediaBox identique, rendu **pixel-identique** à l'original (pdftoppm) |
| `stats` | SQLite 3.53.4 · FTS5 OK · trigram OK |
| Isolation `core` | ESLint `no-restricted-imports` + `no-restricted-globals` |

### Sur les vrais PDF (`CATALOGUE BT 2026/`)

- 59 fichiers, 352 pages, indexés en **1,9 s**, sans erreur. Réindexation sans changement : 0,1 s.
- Exemples trouvés : `0251080` (S15 p.1 et p.3), `0540010R13` (BGV p.1, CIBE p.6/7/10), `E976007`, `06CATD0100` (Catalogue Armoires p.10), `6980079`.
- Points d'attention :
  - **Concaténation** : la normalisation supprime espaces et sauts de ligne, donc `G3⏎0540010R13` devient `G30540010R13` dans l'index, et une recherche partielle peut matcher à cheval sur deux mots. Ces cas ne sont pas supprimés mais classés en dernier (`partial`), grâce au contrôle des frontières dans le texte d'origine. Si un PDF colle réellement les textes dans un seul fragment, le vrai résultat reste trouvé, simplement classé `partial`.
  - `catalogue_irve_2026.pdf` et `catalogue_irve_2026 .pdf` (48 pages chacun) sont deux versions différentes (hash distincts). Les deux sont indexés, donc une référence commune apparaît deux fois.
