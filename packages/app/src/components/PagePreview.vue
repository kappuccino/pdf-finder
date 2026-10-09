<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { exportFileName } from '@pdfref/core';
import { dragOnMove, prepareDrag } from '../lib/drag.js';
import { imageUrl, pageBytes, renderPage } from '../lib/pages.js';
import { dirName, fileManager, fileName, formatDate } from '../lib/paths.js';

const props = defineProps({ result: Object, query: String });
const emit = defineEmits(['notify']);

const canvas = ref(null);
const container = ref(null);
const error = ref('');
const imgSrc = ref('');
let width = 0;

const isImage = () => props.result?.kind === 'image';
const isWhole = () => props.result?.pageNum == null;

async function draw() {
  if (!props.result) return;
  error.value = '';
  if (isImage()) {
    const path = props.result.docPath;
    imgSrc.value = '';
    try {
      const url = await imageUrl(path);
      if (props.result?.docPath === path) imgSrc.value = url;
    } catch (err) {
      error.value = `Aperçu impossible : ${err.message ?? err}`;
    }
    return;
  }
  if (!canvas.value || !width) return;
  try {
    // fichier entier (PDF trouvé par son nom) : aperçu de la première page
    await renderPage(canvas.value, props.result.docPath, props.result.pageNum ?? 1, width);
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') error.value = `Aperçu impossible : ${err.message ?? err}`;
  }
}

async function exportCurrent() {
  const { docPath, pageNum } = props.result;
  if (isWhole()) {
    // image ou PDF trouvé par son nom : copie du fichier d'origine
    const ext = docPath.split('.').pop();
    const target = await save({ defaultPath: fileName(docPath), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!target) return;
    await writeFile(target, await readFile(docPath));
    emit('notify', `Fichier exporté : ${target}`);
    return;
  }
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
watch(() => props.result, draw, { flush: 'post' }); // après le rendu : le canvas peut venir d'apparaître
</script>

<template>
  <section ref="container" class="preview">
    <template v-if="result">
      <header class="preview-head">
        <div class="preview-info">
          <div class="preview-name">
            {{ fileName(result.docPath) }}
            <span class="result-page">{{
              isImage() ? 'image' : isWhole() ? `fichier entier · ${result.pageCount} p. (aperçu page 1)` : `page ${result.pageNum}`
            }}</span>
            <span class="result-date">créé le {{ formatDate(result.createdAt) }}</span>
          </div>
          <div class="preview-path" :title="result.docPath">{{ dirName(result.docPath) }}</div>
        </div>
        <div class="preview-actions">
          <button
            class="drag-button"
            title="Glisser vers une autre application"
            @mouseenter="prepareDrag(result, query)"
            @mousedown="dragOnMove($event, result, query)"
          >
            ⠿ {{ isWhole() ? 'Glisser le fichier' : 'Glisser la page' }}
          </button>
          <button @click="exportCurrent">Exporter…</button>
          <button @click="revealItemInDir(result.docPath)">Afficher dans {{ fileManager }}</button>
        </div>
      </header>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="canvas-wrap">
        <img v-if="isImage()" class="image-preview" :src="imgSrc" alt="" />
        <canvas v-else ref="canvas" />
      </div>
    </template>
    <p v-else class="empty">Sélectionnez un résultat pour afficher la page.</p>
  </section>
</template>
