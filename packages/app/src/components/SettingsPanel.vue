<script setup>
import { onMounted, ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { appConfigDir, appDataDir, join } from '@tauri-apps/api/path';

const props = defineProps({ settings: Object, info: Object, stats: Object, indexing: Boolean, errors: Array });
const emit = defineEmits(['change-dir', 'toggle-startup', 'reindex', 'close']);

const settingsFile = ref('');
const dbFile = ref('');

onMounted(async () => {
  settingsFile.value = await join(await appDataDir(), 'settings.json');
  dbFile.value = await join(await appConfigDir(), 'index.db');
});

async function chooseDir() {
  const dir = await open({ directory: true, recursive: true, defaultPath: props.settings.pdfDir ?? undefined, title: 'Dossier contenant les PDF' });
  if (dir) emit('change-dir', dir);
}
</script>

<template>
  <section class="settings">
    <header class="settings-head">
      <h2>Réglages</h2>
      <button v-if="settings.pdfDir" @click="emit('close')">Fermer</button>
    </header>

    <div class="field">
      <label>Dossier des PDF (sous-dossiers inclus)</label>
      <div class="dir-row">
        <code class="dir">{{ settings.pdfDir ?? 'Aucun dossier choisi' }}</code>
        <button class="primary" :disabled="indexing" @click="chooseDir">Choisir…</button>
      </div>
    </div>

    <div class="field">
      <label class="check">
        <input type="checkbox" :checked="settings.indexOnStartup" @change="emit('toggle-startup', $event.target.checked)" />
        Mettre à jour l’index au démarrage (seuls les fichiers nouveaux ou modifiés sont relus)
      </label>
      <button :disabled="indexing || !settings.pdfDir" @click="emit('reindex')">Mettre à jour l’index maintenant</button>
    </div>

    <div v-if="errors?.length" class="field index-errors">
      <label>Fichiers non indexés lors de la dernière mise à jour ({{ errors.length }})</label>
      <ul>
        <li v-for="e in errors" :key="e.file">
          <code>{{ e.file }}</code>
          <span>{{ e.message }}</span>
        </li>
      </ul>
    </div>

    <dl class="infos">
      <dt>Index</dt>
      <dd>{{ stats.docs }} documents · {{ stats.pages }} pages</dd>
      <dt>SQLite</dt>
      <dd>
        {{ info?.sqliteVersion }} · FTS5 {{ info?.fts5 ? 'OK' : 'absent' }} · trigram {{ info?.trigram ? 'OK' : 'absent (repli LIKE)' }}
      </dd>
      <dt>Réglages</dt>
      <dd><code>{{ settingsFile }}</code></dd>
      <dt>Base</dt>
      <dd><code>{{ dbFile }}</code></dd>
    </dl>
  </section>
</template>
