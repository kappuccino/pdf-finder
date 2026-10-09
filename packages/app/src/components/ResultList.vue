<script setup>
import { nextTick, watch } from 'vue';
import { dragOnMove, prepareDrag } from '../lib/drag.js';
import { dirName, fileName, formatDate } from '../lib/paths.js';

const props = defineProps({ results: Array, selected: Object, query: String });
const emit = defineEmits(['select']);

const parts = (r) =>
  r.highlight
    ? [r.snippet.slice(0, r.highlight.start), r.snippet.slice(r.highlight.start, r.highlight.end), r.snippet.slice(r.highlight.end)]
    : [r.snippet, '', ''];

const MATCH_LABEL = { prefix: 'début de réf.', partial: 'approximatif' };

/** Nom du fichier découpé autour de la référence (surlignée quand elle est dans le nom). */
const nameParts = (r) => {
  const name = fileName(r.docPath);
  const h = r.nameHighlight;
  return h ? [name.slice(0, h.start), name.slice(h.start, h.end), name.slice(h.end)] : [name, '', ''];
};

const where = (r) => (r.kind === 'image' ? 'image' : r.pageNum == null ? `fichier entier · ${r.pageCount} p.` : `page ${r.pageNum}`);

watch(
  () => props.selected,
  async () => {
    await nextTick();
    document.querySelector('.result.selected')?.scrollIntoView({ block: 'nearest' });
  },
);
</script>

<template>
  <ul class="results">
    <li
      v-for="r in results"
      :key="r.docPath + '#' + r.pageNum"
      class="result"
      :class="{ selected: selected && selected.docPath === r.docPath && selected.pageNum === r.pageNum }"
      :title="`Cliquer pour l’aperçu · glisser vers une autre application pour déposer ${r.pageNum == null ? 'le fichier' : 'la page en PDF'}`"
      @click="emit('select', r)"
      @mouseenter="prepareDrag(r, query)"
      @mousedown="dragOnMove($event, r, query)"
    >
      <div class="result-head">
        <span class="result-name">{{ nameParts(r)[0] }}<mark>{{ nameParts(r)[1] }}</mark>{{ nameParts(r)[2] }}</span>
        <span class="result-page">{{ where(r) }}</span>
        <span class="result-date" title="Date de création du fichier">{{ formatDate(r.createdAt) }}</span>
      </div>
      <div class="result-path">{{ dirName(r.docPath) }}</div>
      <div class="result-snippet">
        <span v-if="r.nameMatch" class="badge name">nom du fichier</span>
        <template v-if="r.snippet">{{ parts(r)[0] }}<mark>{{ parts(r)[1] }}</mark>{{ parts(r)[2] }}</template>
        <span v-if="MATCH_LABEL[r.match]" class="badge" :class="r.match">{{ MATCH_LABEL[r.match] }}</span>
      </div>
    </li>
  </ul>
</template>
