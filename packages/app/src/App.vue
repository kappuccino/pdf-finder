<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { getStats, search } from '@pdfref/core';
import PagePreview from './components/PagePreview.vue';
import ResultList from './components/ResultList.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { openIndex } from './lib/db.js';
import { indexFolder } from './lib/indexer.js';
import { fileName } from './lib/paths.js';
import { loadSettings, saveSetting } from './lib/settings.js';

const settings = ref({ pdfDir: null, indexOnStartup: true });
const info = ref(null);
const stats = ref({ docs: 0, images: 0, pages: 0 });
const showSettings = ref(false);

const query = ref('');
const results = ref([]);
const selected = ref(null);
const searchMs = ref(0);

const progress = ref(null); // { index, total, file, pageNum, pageCount }
const notice = ref('');
const indexErrors = ref([]); // fichiers non indexés lors de la dernière passe
const indexing = computed(() => progress.value !== null);

let db;

async function refreshStats() {
  stats.value = await getStats(db);
}

async function runSearch() {
  const q = query.value;
  if (!db) return;
  const t0 = performance.now();
  const res = await search(db, q, { refMode: info.value.refMode });
  if (q !== query.value) return; // une saisie plus récente a pris le relais
  searchMs.value = performance.now() - t0;
  results.value = res;
  selected.value = res[0] ?? null;
}

let timer;
watch(query, () => {
  clearTimeout(timer);
  timer = setTimeout(runSearch, 200);
});

async function reindex() {
  if (!settings.value.pdfDir || indexing.value) return;
  notice.value = '';
  progress.value = { index: 0, total: 0, file: '' };
  try {
    const s = await indexFolder(db, settings.value.pdfDir, (p) => (progress.value = p));
    indexErrors.value = s.errors;
    notice.value =
      `Index à jour : ${s.files - s.images} PDF et ${s.images} images (${s.added} ajoutés, ${s.updated} modifiés, ${s.removed} retirés)` +
      ` · ${s.pages} pages lues en ${s.seconds.toFixed(1)} s`;
  } catch (err) {
    indexErrors.value = [{ file: settings.value.pdfDir, message: err.message ?? String(err) }];
    notice.value = 'Indexation impossible';
  } finally {
    progress.value = null;
    await refreshStats();
    if (query.value) runSearch();
  }
}

async function changeDir(dir) {
  settings.value.pdfDir = dir;
  await saveSetting('pdfDir', dir);
  showSettings.value = false;
  await reindex();
}

async function toggleStartup(value) {
  settings.value.indexOnStartup = value;
  await saveSetting('indexOnStartup', value);
}

function onKey(e) {
  if (!results.value.length || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const i = results.value.indexOf(selected.value);
  const next = e.key === 'ArrowDown' ? Math.min(i + 1, results.value.length - 1) : Math.max(i - 1, 0);
  selected.value = results.value[next];
}

onMounted(async () => {
  ({ db, info: info.value } = await openIndex());
  settings.value = await loadSettings();
  await refreshStats();
  if (import.meta.env.DEV && import.meta.env.VITE_SELFTEST_DIR) {
    const { runSelfTest } = await import('./lib/selftest.js');
    const refs = (import.meta.env.VITE_SELFTEST_REFS ?? '').split(',').filter(Boolean);
    return runSelfTest(db, info.value, import.meta.env.VITE_SELFTEST_DIR, refs).then(refreshStats);
  }
  if (!settings.value.pdfDir) showSettings.value = true;
  else if (settings.value.indexOnStartup) reindex();
});
</script>

<template>
  <div class="app" @keydown="onKey">
    <header class="topbar">
      <input
        v-model="query"
        class="search"
        type="search"
        placeholder="Référence produit (ex. 0540010R13, AB-1234-X)…"
        autofocus
        spellcheck="false"
        autocomplete="off"
      />
      <button class="icon-button" title="Réglages" @click="showSettings = !showSettings">⚙︎ Réglages</button>
    </header>

    <SettingsPanel
      v-if="showSettings"
      :settings="settings"
      :info="info"
      :stats="stats"
      :indexing="indexing"
      :errors="indexErrors"
      @change-dir="changeDir"
      @toggle-startup="toggleStartup"
      @reindex="reindex"
      @close="showSettings = false"
    />

    <main v-else class="main">
      <aside class="list">
        <p v-if="!query" class="empty">Tapez une référence (3 caractères minimum).</p>
        <p v-else-if="!results.length" class="empty">Aucun résultat.</p>
        <template v-else>
          <p class="count">{{ results.length }} page(s) · {{ searchMs.toFixed(0) }} ms</p>
          <ResultList :results="results" :selected="selected" :query="query" @select="selected = $event" />
        </template>
      </aside>
      <PagePreview :result="selected" :query="query" @notify="notice = $event" />
    </main>

    <footer class="statusbar">
      <template v-if="indexing">
        <span>
          Indexation {{ progress.index + 1 }}/{{ progress.total || '…' }} · {{ fileName(progress.file || '') }}
          <template v-if="progress.pageCount"> · page {{ progress.pageNum }}/{{ progress.pageCount }}</template>
        </span>
        <progress :value="progress.index" :max="progress.total || 1" />
      </template>
      <span v-else>{{ notice || `${stats.docs} PDF · ${stats.images} images · ${stats.pages} pages indexées` }}</span>
      <span class="spacer" />
      <button v-if="!indexing && indexErrors.length" class="error-button" @click="showSettings = true">
        ⚠ {{ indexErrors.length }} fichier(s) non indexé(s)
      </button>
      <span v-if="info && info.refMode !== 'trigram'" class="warn">Mode LIKE (trigram absent)</span>
    </footer>
  </div>
</template>
