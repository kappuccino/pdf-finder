# PDF Ref Finder — POC

Recherche de références produit dans des PDF, 100 % offline. Voir [BRIEF.md](BRIEF.md).

**Phase 1 (CLI Node) : terminée.** **Phase 2 (app Tauri 2) : première version**, voir plus bas.

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

---

# Phase 2 — App desktop (Tauri 2 + Vue 3, JavaScript)

## Lancer / construire

Prérequis : Rust (`rustup`). Sur Windows, ajouter les Build Tools MSVC + WebView2.

```bash
npm run app:dev          # mode développement
npm run app:build        # build release (macOS : .app + .dmg ; Windows : NSIS + MSI)
npm run app:build:mac    # build macOS + signature (voir plus bas)
```

## Taille

macOS (Apple Silicon) : **DMG 4,95 Mo**, `.app` 7,6 Mo. Windows : à relever lors du premier build sur Windows.

## Fonctionnement

- **Réglages** : choix du dossier des PDF (sous-dossiers inclus) et option « mettre à jour l'index au démarrage ». Ils sont stockés dans le dossier utilisateur de l'app, propre à chaque plateforme (plugin-store) :
  - macOS : `~/Library/Application Support/org.kappuccino.pdfref/settings.json`
  - Windows : `%APPDATA%\org.kappuccino.pdfref\settings.json`
  - Linux : `~/.local/share/org.kappuccino.pdfref/settings.json`

  La base `index.db` est dans le dossier de config de l'app (même dossier sur macOS et Windows). Les deux chemins sont affichés dans l'écran Réglages.
- **Accès au dossier** : seul le dossier choisi dans le dialogue est lisible (scope fs dynamique). Il est mémorisé entre deux lancements par `tauri-plugin-persisted-scope`, sans ouvrir `**`.
- **Indexation** : l'analyse des PDF tourne dans le Web Worker de pdfjs (l'UI reste fluide : 23 ms max entre deux frames pendant l'indexation du catalogue) et l'écriture SQL se fait par lots. L'indexation est incrémentale (SHA-1), retire les fichiers supprimés, et affiche sa progression dans la barre d'état. Les fichiers non indexés sont signalés par un bouton rouge, et la liste avec la raison de chaque échec est affichée dans Réglages.
- **Recherche** : saisie au fil de la frappe (délai de 200 ms). Chaque résultat affiche le **nom du fichier**, la **page**, la **date de création du fichier** et le **chemin du dossier**, avec le snippet surligné. Les résultats sont **triés du fichier le plus récent au plus ancien** (date de création sur le disque, ou date de modification si le système ne la fournit pas). Les correspondances « approximatif » passent en fin de liste. Les flèches ↑/↓ naviguent dans les résultats.
- **Aperçu** : rendu canvas pdfjs, avec les boutons « Exporter… » (dialogue d'enregistrement) et « Afficher dans le Finder/l'Explorateur ».
- **Drag & drop vers une autre app** : glisser un résultat (ou le bouton « Glisser la page ») dépose un **PDF d'une seule page**, généré à la volée (`{nomPDF}_p{num}_{REF}.pdf`). Le fichier est préparé au survol dans le cache de l'app (`$APPCACHE/drag`, vidé à chaque lancement), puis glissé comme un vrai fichier via `tauri-plugin-drag`, avec une vignette de la page comme icône.

## Choix techniques

- Rust minimal (`src-tauri/src/lib.rs`) : uniquement l'enregistrement des plugins sql, fs, persisted-scope, dialog, store, opener et drag.
- Le plugin SQL utilise un pool de connexions, où `BEGIN/COMMIT` n'est pas fiable. Le cœur ne dépend donc plus des transactions : les rowids des pages sont déterministes (`docId × 100000 + page`), et le hash du document est écrit en dernier, si bien qu'une indexation interrompue est refaite au passage suivant. Le schéma est passé en v2, et une base v1 est reconstruite automatiquement.
- SQLite embarqué par le plugin : 3.46 (libsqlite3-sys bundled), avec FTS5 et trigram. C'est vérifié au démarrage et visible dans Réglages, avec repli LIKE signalé si besoin.
- **pdfjs : build legacy aussi dans la webview.** Le build standard de pdfjs 6 utilise des API absentes du WebKit de macOS (`Math.sumPrecise`…), d'où l'écart au brief. Un petit polyfill ajoute en plus `for await` sur `ReadableStream`, dans l'UI et dans le worker. Les ressources (worker, cMaps, polices standard, wasm) sont servies localement, sans CDN.
- **Auto-test dans la vraie webview** : `packages/app/scripts/selftest.sh "<dossier>" "REF1,REF2"` lance l'app en dev. Il indexe le dossier, cherche les références, rend une page, génère le PDF de drag, puis écrit un rapport dans `$APPCACHE/selftest.json`. Le dossier n'est autorisé que via un overlay de config temporaire, jamais dans le build.
- Permissions (`src-tauri/capabilities/default.json`) : dialog open/save, store, sql (load/select/execute), opener (révéler dans le dossier uniquement), drag, fs (lecture, écriture, mkdir, remove), avec un scope statique limité à `$APPCACHE`.

## Signature macOS

| Cas | Ce qui se passe |
|---|---|
| Sans certificat (par défaut) | Signature **ad-hoc** (`signingIdentity: "-"`). L'app s'ouvre sans problème sur ce Mac. Copiée sur un autre Mac, Gatekeeper bloque au premier lancement : *Réglages Système → Confidentialité et sécurité → Ouvrir quand même*. |
| DMG | La mise en page de la fenêtre du DMG passe par AppleScript/Finder : macOS demande l'autorisation « Automatisation » au premier build. Sans elle, utiliser `CI=true npm run app:build`. |
| Avec un certificat **Developer ID Application** | `npm run app:build:mac` signe avec le hardened runtime et **notarise** l'app auprès d'Apple. Plus aucun avertissement. |

Pour activer la signature complète (compte Apple Developer à 99 $/an), créer `packages/app/.env.signing` (non versionné) :

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Nom (TEAMID)"
APPLE_ID="vous@exemple.com"
APPLE_PASSWORD="mot-de-passe-d-app"   # appleid.apple.com → mots de passe d'app
APPLE_TEAM_ID="TEAMID"
```

## CI GitHub Actions (`.github/workflows/build.yml`)

- **À chaque push ou PR** : lint, tests et bench (Ubuntu), puis build de l'app sur **macOS (universel Intel + Apple Silicon)** et **Windows** (NSIS + MSI). Les installeurs sont téléchargeables dans les *artifacts* du run, et leur taille est affichée dans le résumé du job.
- **Sur un tag `v*`** (ex. `git tag v0.1.0 && git push --tags`) : une release GitHub est créée en brouillon, avec les installeurs.
- **Signature macOS** : signature ad-hoc par défaut. Pour signer et notariser, ajouter ces secrets au dépôt : `APPLE_CERTIFICATE` (`base64 -i cert.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
