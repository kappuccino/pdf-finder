<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { exportFileName } from '@pdfref/core';
import { dragOnMove, prepareDrag } from '../lib/drag.js';
import { pageBytes, renderPage } from '../lib/pages.js';
import { dirName, fileManager, fileName } from '../lib/paths.js';

const props = defineProps({ result: Object, query: String });
const emit = defineEmits(['notify']);

const canvas = ref(null);
const container = ref(null);
const error = ref('');
let width = 0;

async function draw() {
  if (!props.result || !canvas.value || !width) return;
  error.value = '';
  try {
    await renderPage(canvas.value, props.result.docPath, props.result.pageNum, width);
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') error.value = `Aperçu impossible : ${err.message ?? err}`;
  }
}

async function exportCurrent() {
  const { docPath, pageNum } = props.result;
  const target = await save({
    defaultPath: exportFileName(docPath, pageNum, props.query),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!target) return;
  await writeFile(target, await pageBytes(docPath, pageNum));
  emit('notify', `Page exportée : ${target}`);
}

let observer;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    const w = Math.floor(entry.contentRect.width) - 32;
    if (Math.abs(w - width) > 8) {
      width = w;
      draw();
    }
  });
  observer.observe(container.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => props.result, draw);
</script>

<template>
  <section ref="container" class="preview">
    <template v-if="result">
      <header class="preview-head">
        <div class="preview-info">
          <div class="preview-name">{{ fileName(result.docPath) }} <span class="result-page">page {{ result.pageNum }}</span></div>
          <div class="preview-path" :title="result.docPath">{{ dirName(result.docPath) }}</div>
        </div>
        <div class="preview-actions">
          <button
            class="drag-button"
            title="Glisser vers une autre application"
            @mouseenter="prepareDrag(result.docPath, result.pageNum, query)"
            @mousedown="dragOnMove($event, result.docPath, result.pageNum, query)"
          >
            ⠿ Glisser la page
          </button>
          <button @click="exportCurrent">Exporter…</button>
          <button @click="revealItemInDir(result.docPath)">Afficher dans {{ fileManager }}</button>
        </div>
      </header>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="canvas-wrap"><canvas ref="canvas" /></div>
    </template>
    <p v-else class="empty">Sélectionnez un résultat pour afficher la page.</p>
  </section>
</template>
