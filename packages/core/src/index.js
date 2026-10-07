export { normalize, normalizeWithMap } from './normalize.js';
export { sha1Hex } from './hash.js';
export { createExtractor, itemsToText, PdfExtractError } from './extract-text.js';
export { initSchema, detectCapabilities, SCHEMA_VERSION } from './schema.js';
export { indexDocument, insertPages, listDocs, removeDoc, getStats } from './indexer.js';
export { search, findBestMatch, makeSnippet, MAX_RESULTS } from './search.js';
export { exportPage, exportPages } from './export-page.js';
