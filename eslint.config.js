import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', 'fixtures/**', 'out/**', 'packages/app/dist/**', 'packages/app/public/**', 'packages/app/src-tauri/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': 'error', 'no-undef': 'error' },
  },
  {
    files: ['packages/app/src/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    // Règle d'or : le cœur ne dépend d'aucune API Node ni Tauri.
    files: ['packages/core/src/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['fs', 'fs/promises', 'path', 'os', 'crypto', 'url', 'module', 'child_process', 'buffer', 'stream', 'util'],
          patterns: ['node:*', '@tauri-apps/*', 'better-sqlite3', 'pdfjs-dist', 'pdfjs-dist/*'],
        },
      ],
      'no-restricted-globals': ['error', 'Buffer', 'process', 'require', '__dirname', '__filename', 'global'],
    },
  },
];
