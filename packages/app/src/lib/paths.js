export const isMac = navigator.userAgent.includes('Mac');
export const fileManager = isMac ? 'Finder' : 'l’Explorateur';

export function fileName(p) {
  return p.split(/[\\/]/).pop();
}

export function dirName(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}
