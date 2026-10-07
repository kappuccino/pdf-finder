#!/usr/bin/env node
import { Command } from 'commander';
import { DEFAULT_DB } from './context.js';
import { exportCommand } from './commands/export.js';
import { indexCommand } from './commands/index.js';
import { searchCommand } from './commands/search.js';
import { statsCommand } from './commands/stats.js';

const program = new Command('pdfref').description('Recherche de références produit dans des PDF (offline)');

program
  .command('index')
  .argument('<chemins...>', 'dossiers (récursif) ou fichiers PDF')
  .option('--db <fichier>', 'base SQLite', DEFAULT_DB)
  .option('--force', 'réindexer même si le fichier est inchangé')
  .action(indexCommand);

program
  .command('search')
  .argument('<ref>', 'référence recherchée')
  .option('--db <fichier>', 'base SQLite', DEFAULT_DB)
  .option('--json', 'sortie JSON')
  .action(searchCommand);

program
  .command('export')
  .argument('<ref>', 'référence recherchée')
  .option('--db <fichier>', 'base SQLite', DEFAULT_DB)
  .option('--out <dossier>', 'dossier de sortie', './out')
  .option('--all', 'toutes les pages trouvées (sinon la 1re)')
  .option('--merge', 'avec --all : un seul PDF fusionné')
  .action(exportCommand);

program
  .command('stats')
  .option('--db <fichier>', 'base SQLite', DEFAULT_DB)
  .action(statsCommand);

await program.parseAsync();
