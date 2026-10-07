# BRIEF — POC « PDF Ref Finder »

## Objectif

Valider qu'une application desktop **100 % offline** peut :

1. indexer des PDF (texte natif, pas de scans) et extraire le texte **page par page** ;
2. stocker ce contenu dans une base **SQLite** embarquée ;
3. rechercher une **référence produit** (ex. `AB-1234-X`) ;
4. afficher la ou les pages trouvées et **exporter la page** correspondante en PDF autonome.

C'est un POC : on vise un résultat fonctionnel et démontrable, pas une app finie. Il faut privilégier la simplicité et la lisibilité du code.

## Déroulé en 2 phases

1. **Phase 1 — CLI Node** : valider l'extraction, la normalisation, la recherche et l'export sur des fixtures. Aucune UI.
2. **Phase 2 — App desktop Tauri 2** : réutiliser le cœur métier tel quel et ajouter l'UI.

Le cœur métier est écrit **une seule fois** et doit fonctionner dans les deux environnements (Node et webview Tauri).

## Contraintes non négociables

- **Aucun appel réseau** au runtime : pas d'API, pas de CDN, pas d'IA.
- Toutes les dépendances sont embarquées.
- Les PDF contiennent du **texte sélectionnable**, donc pas d'OCR.
- La logique est en **TypeScript**. En phase 2, on limite le Rust au strict minimum (enregistrement des plugins + config).

## Structure du repo (monorepo pnpm workspaces)

```
packages/
  core/               # logique métier pure TS — AUCUNE API Node ni Tauri
    src/
      normalize.ts    # normalisation des références
      extract-text.ts # Uint8Array (PDF) -> texte par page (pdfjs-dist)
      indexer.ts      # orchestration : texte -> DbAdapter
      search.ts       # requêtes de recherche
      export-page.ts  # Uint8Array + n° de page -> Uint8Array (pdf-lib)
      schema.ts       # DDL SQL + migrations
      db-adapter.ts   # interface DbAdapter
    test/             # Vitest
  cli/                # Phase 1 : adapter Node + commandes
  app/                # Phase 2 : Tauri 2 + Vue 3
scripts/
  make-fixtures.ts
fixtures/
```

### Règle d'or pour `core`

- Les entrées et sorties sont des `Uint8Array`, des chaînes et des objets. **Jamais** de `fs`, de `path`, de `Buffer` ni d'`invoke`.
- La base de données est accessible uniquement via une interface **asynchrone** (le plugin SQL de Tauri est async) :

```ts
export interface DbAdapter {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<{ lastInsertId?: number; changes: number }>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

- Le SQL est **identique** dans les deux phases. Seul l'adapter change.

## Schéma SQLite

```sql
CREATE TABLE IF NOT EXISTS docs (
  id          INTEGER PRIMARY KEY,
  path        TEXT UNIQUE NOT NULL,
  hash        TEXT NOT NULL,          -- sha1 du fichier, pour réindexation incrémentale
  page_count  INTEGER NOT NULL,
  indexed_at  INTEGER NOT NULL
);

-- Texte lisible, pour les snippets et la recherche "plein texte"
CREATE VIRTUAL TABLE IF NOT EXISTS pages_text USING fts5(
  content,
  doc_id UNINDEXED, page_num UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Texte normalisé, pour la recherche de références en sous-chaîne
CREATE VIRTUAL TABLE IF NOT EXISTS pages_ref USING fts5(
  ref_norm,
  doc_id UNINDEXED, page_num UNINDEXED,
  tokenize = 'trigram'
);
```

Au démarrage, exécuter `SELECT sqlite_version()` et vérifier la présence de FTS5 et du tokenizer `trigram` (≥ 3.34), **dans les deux environnements**. Si `trigram` est indisponible, se rabattre sur `LIKE '%…%'` sur une table classique et le logger clairement.

## Extraction du texte (point critique)

`pdfjs` renvoie des fragments positionnés, pas des lignes propres. Pour chaque page :

1. `page.getTextContent()`.
2. Reconstruire le texte en concaténant `item.str`. Insérer un saut de ligne quand `item.hasEOL` est vrai ou quand la coordonnée Y change significativement. Insérer un espace quand l'écart X entre deux fragments dépasse un seuil.
3. Stocker ce texte dans `pages_text.content`.
4. Calculer `ref_norm = normalize(content)` et le stocker dans `pages_ref`.

Import de pdfjs : utiliser le build legacy (`pdfjs-dist/legacy/build/pdf.mjs`) côté Node et le build standard côté webview. Isoler ce choix dans un petit module d'init (worker pdfjs inclus) injecté dans `core`.

### Normalisation (`core/normalize.ts`)

Une seule fonction est utilisée **à la fois à l'indexation et à la recherche** :

- passage en majuscules ;
- suppression des diacritiques ;
- suppression de **tous** les espaces, sauts de ligne, `-`, `_`, `.`, `/`.

Ainsi, `AB-1234-X`, `ab 1234 x` et `AB-\n1234-X` (référence coupée en fin de ligne) deviennent tous `AB1234X`.

Il faut écrire des tests unitaires (Vitest) pour cette fonction.

## Recherche (`core/search.ts`)

- Normaliser la saisie. Si elle fait moins de 3 caractères, renvoyer une liste vide.
- Requête `MATCH` trigram sur `pages_ref`, avec jointure sur `docs`.
- Retourner `{ docPath, pageNum, snippet }[]`. Le snippet est tiré de `pages_text` (extrait autour de la correspondance, ou `snippet()` FTS5).
- Limite de 200 résultats.

---

# PHASE 1 — CLI

## Stack

- Node 22+, TypeScript, exécution via `tsx`.
- Adapter SQLite : `better-sqlite3` (avec FTS5 et trigram inclus dans les versions récentes ; à vérifier au démarrage), enveloppé dans `DbAdapter`.
- `pdfjs-dist`, `pdf-lib`.
- Parsing des arguments : `commander` (ou `node:util` `parseArgs`).

## Commandes

```bash
pdfref index <dossier|fichiers...> [--db ./index.db]   # récursif, incrémental (hash)
pdfref search <ref> [--db ./index.db] [--json]        # liste fichier / page / snippet
pdfref export <ref> [--out ./out] [--all] [--db ...]  # 1re page trouvée, ou toutes (--all)
pdfref stats [--db ./index.db]                        # nb docs, nb pages, version SQLite, trigram OK ?
```

- `index` affiche la progression (fichier courant, page X/Y) et un résumé final (docs, pages, durée).
- Un PDF corrompu ou protégé est loggé et ignoré, sans faire échouer la commande.
- Les fichiers supprimés du disque sont retirés de l'index.
- `export` nomme les fichiers `{nomPDF}_p{num}_{ref}.pdf`. Avec `--all`, il produit soit un PDF par résultat, soit un seul PDF fusionné (`--merge`).

## Jeu de test

Créer un script `scripts/make-fixtures.ts` qui génère avec `pdf-lib` quelques PDF de test dans `fixtures/`. Les cas à couvrir :

- une référence simple sur une page donnée ;
- la même référence présente sur plusieurs pages et dans plusieurs fichiers ;
- une référence **coupée sur deux lignes** ;
- une référence dans un tableau (fragments positionnés séparément) ;
- un PDF d'au moins 500 pages pour tester les performances.

Le script produit aussi un `fixtures/expected.json` (ref → fichier/pages attendus) utilisé par un test d'intégration.

## Critères d'acceptation — Phase 1

- [ ] `pnpm test` : les tests unitaires (`normalize`) et le test d'intégration (index des fixtures → search → comparaison avec `expected.json`) passent.
- [ ] Toutes les références des fixtures sont trouvées, y compris la coupée et celle du tableau, avec le bon numéro de page.
- [ ] `search` répond en < 100 ms sur environ 10 000 pages indexées (bench simple fourni).
- [ ] Une page exportée s'ouvre correctement, sa mise en page est identique à l'original et elle ne contient qu'une page.
- [ ] `pdfref stats` confirme FTS5 + trigram.
- [ ] Aucun import Node dans `packages/core` (règle ESLint `no-restricted-imports` ou check simple).

**Arrêt ici : faire un point avec moi avant de démarrer la phase 2.** J'apporterai de vrais PDF client pour tester la CLI.

---

# PHASE 2 — App desktop Tauri 2

## Stack

| Rôle | Choix |
|---|---|
| Shell | **Tauri 2** (`create-tauri-app`, template Vue + TS) |
| UI | Vue 3 + TypeScript, CSS maison minimal |
| SQLite | `tauri-plugin-sql` (feature `sqlite`), enveloppé dans `DbAdapter` |
| Fichiers | `@tauri-apps/plugin-fs` (lecture PDF, écriture des exports) |
| Dialogues | `@tauri-apps/plugin-dialog` (choix dossier/fichiers, enregistrement) |
| Extraction / export / rendu | `packages/core` (pdfjs-dist + pdf-lib), réutilisé tel quel |
| Packaging | `tauri build` (MSI/NSIS Windows, DMG macOS) |

## Points d'attention

- **Rust minimal** : `src-tauri/src/lib.rs` ne fait qu'enregistrer les plugins. Pas de logique métier en Rust.
- **Capabilities Tauri 2** : déclarer explicitement les permissions `fs` (scopes limités aux dossiers choisis par l'utilisateur et à `$APPDATA`), `dialog` et `sql`. Ne pas tout ouvrir en `**`.
- **Base de données** : `sqlite:index.db`, qui est résolu dans le dossier app data. Revérifier FTS5 et trigram avec la build SQLite embarquée par le plugin. Si trigram est absent, activer le fallback `LIKE` et me le signaler.
- **Indexation dans un Web Worker** pour ne pas figer l'UI. Le worker lit les fichiers (bytes transmis depuis le thread principal si `plugin-fs` n'est pas accessible dans le worker), extrait le texte et renvoie les pages. Les écritures SQL se font par lots, dans une transaction.
- **Webviews différentes** : WebView2 (Chromium) sur Windows, WKWebView (Safari) sur macOS. Tester le rendu canvas pdfjs et le worker pdfjs sur les deux.
- Le worker pdfjs doit être **bundlé localement** par Vite, sans CDN.

## Fonctionnalités

1. **Indexation** : boutons « Ajouter un dossier » et « Ajouter des fichiers », barre de progression, résumé final, réindexation incrémentale.
2. **Recherche** : champ unique avec recherche *as-you-type* (debounce de 200 ms). Résultats affichant fichier, page et snippet avec la référence surlignée.
3. **Aperçu** : un clic rend la page dans un canvas via pdfjs.
4. **Export** : « Exporter cette page » via la boîte de dialogue d'enregistrement. Bonus : « Exporter toutes les pages trouvées » en un PDF fusionné.

## Critères d'acceptation — Phase 2

- [ ] `pnpm tauri dev` lance l'app, et `pnpm tauri build` produit un installeur fonctionnel (Windows au minimum).
- [ ] L'app fonctionne avec le réseau coupé.
- [ ] Les mêmes fixtures donnent les mêmes résultats que la CLI.
- [ ] L'indexation ne fige jamais l'UI.
- [ ] La taille de l'installeur est relevée et notée dans le README.
- [ ] Les permissions sont limitées au nécessaire.

## Hors périmètre (les deux phases)

OCR, IA ou recherche sémantique, multi-utilisateur, synchronisation, auto-update, signature de code, design soigné.

## Ordre de travail

1. Monorepo + `core/normalize.ts` et ses tests.
2. Script de fixtures + `expected.json`.
3. `core` : extract-text, schema, indexer, search, export-page.
4. CLI + adapter `better-sqlite3`, test d'intégration et bench.
5. **Point d'étape avec moi.**
6. Scaffold Tauri 2 + plugins + capabilities, vérification de SQLite (FTS5/trigram) dans l'app.
7. Adapter `tauri-plugin-sql`, indexation en Web Worker, progression.
8. UI recherche, puis aperçu, puis export.
9. Build + test offline + relevé de la taille.
