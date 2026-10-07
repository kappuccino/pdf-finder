/**
 * Accès base de données utilisé par tout le cœur métier.
 * Asynchrone pour être compatible avec tauri-plugin-sql (phase 2) ;
 * l'adapter better-sqlite3 (phase 1) l'implémente aussi.
 *
 * @typedef {object} DbAdapter
 * @property {(sql: string) => Promise<void>} exec
 * @property {(sql: string, params?: unknown[]) => Promise<{ lastInsertId?: number, changes: number }>} run
 * @property {<T>(sql: string, params?: unknown[]) => Promise<T[]>} all
 * @property {<T>(fn: () => Promise<T>) => Promise<T>} transaction
 */

export {};
