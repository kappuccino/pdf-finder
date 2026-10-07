// Réglages persistés dans le dossier utilisateur de l'app (plugin-store) :
//   macOS   ~/Library/Application Support/org.kappuccino.pdfref/settings.json
//   Windows %APPDATA%\org.kappuccino.pdfref\settings.json
//   Linux   ~/.local/share/org.kappuccino.pdfref/settings.json
import { load } from '@tauri-apps/plugin-store';

const DEFAULTS = { pdfDir: null, indexOnStartup: true };
let store;

async function getStore() {
  store ??= await load('settings.json', { defaults: DEFAULTS, autoSave: true });
  return store;
}

export async function loadSettings() {
  const s = await getStore();
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = (await s.get(key)) ?? DEFAULTS[key];
  return out;
}

export async function saveSetting(key, value) {
  const s = await getStore();
  await s.set(key, value);
  await s.save();
}
