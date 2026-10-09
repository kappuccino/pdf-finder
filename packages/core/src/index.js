export { normalize, normalizeWithMap } from './normalize.js';
export { sha1Hex } from './hash.js';
export { createExtractor, itemsToText, PdfExtractError } from './extract-text.js';
export { initSchema, detectCapabilities, SCHEMA_VERSION, BASE_VERSION, MIGRATIONS } from './schema.js';
export { indexDocument, indexImage, insertPages, listDocs, removeDoc, getStats, PAGE_STRIDE } from './indexer.js';
export { baseName, fileStem, fileKind, nameNorm, PDF_EXTENSIONS, IMAGE_EXTENSIONS } from './files.js';
export { search, findBestMatch, makeSnippet, MAX_RESULTS } from './search.js';
export { exportPage, exportPages, exportFileName } from './export-page.js';
