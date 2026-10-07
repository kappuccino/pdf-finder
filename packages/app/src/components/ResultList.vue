<script setup>
import { nextTick, watch } from 'vue';
import { dragOnMove, prepareDrag } from '../lib/drag.js';
import { dirName, fileName } from '../lib/paths.js';

const props = defineProps({ results: Array, selected: Object, query: String });
const emit = defineEmits(['select']);

const parts = (r) =>
  r.highlight
    ? [r.snippet.slice(0, r.highlight.start), r.snippet.slice(r.highlight.start, r.highlight.end), r.snippet.slice(r.highlight.end)]
    : [r.snippet, '', ''];

const MATCH_LABEL = { prefix: 'début de réf.', partial: 'approximatif' };

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
      title="Cliquer pour l’aperçu · glisser vers une autre application pour déposer la page en PDF"
      @click="emit('select', r)"
      @mouseenter="prepareDrag(r.docPath, r.pageNum, query)"
      @mousedown="dragOnMove($event, r.docPath, r.pageNum, query)"
    >
      <div class="result-head">
        <span class="result-name">{{ fileName(r.docPath) }}</span>
        <span class="result-page">page {{ r.pageNum }}</span>
      </div>
      <div class="result-path">{{ dirName(r.docPath) }}</div>
      <div class="result-snippet">
        {{ parts(r)[0] }}<mark>{{ parts(r)[1] }}</mark>{{ parts(r)[2] }}
        <span v-if="r.match !== 'exact'" class="badge" :class="r.match">{{ MATCH_LABEL[r.match] }}</span>
      </div>
    </li>
  </ul>
</template>
