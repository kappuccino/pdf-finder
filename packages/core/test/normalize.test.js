import { describe, expect, it } from 'vitest';
import { normalize, normalizeWithMap } from '../src/normalize.js';

describe('normalize', () => {
  it.each([
    ['AB-1234-X', 'AB1234X'],
    ['ab 1234 x', 'AB1234X'],
    ['AB-\n1234-X', 'AB1234X'],
    ['ab_1234.x', 'AB1234X'],
    ['AB/1234/X', 'AB1234X'],
    ['  AB\t-\r\n1234 -  X  ', 'AB1234X'],
    ['AB–1234—X', 'AB1234X'], // tirets typographiques
    ['AB 1234 X', 'AB1234X'], // espaces insécables
  ])('%j → %s', (input, out) => {
    expect(normalize(input)).toBe(out);
  });

  it('supprime les diacritiques et met en majuscules', () => {
    expect(normalize('Réf. Électrique çà')).toBe('REFELECTRIQUECA');
    expect(normalize('é')).toBe('E'); // é déjà décomposé
  });

  it('chaîne vide ou uniquement des séparateurs', () => {
    expect(normalize('')).toBe('');
    expect(normalize(' -_./\n')).toBe('');
  });

  it('garde les autres caractères', () => {
    expect(normalize('0540010R13 + 6980826')).toBe('0540010R13+6980826');
  });
});

describe('normalizeWithMap', () => {
  it('relie chaque caractère normalisé à sa position d’origine', () => {
    const src = 'Réf. AB-\n12';
    const { text, map } = normalizeWithMap(src);
    expect(text).toBe('REFAB12');
    expect(map).toHaveLength(text.length);
    expect(map.map((i) => src[i])).toEqual(['R', 'é', 'f', 'A', 'B', '1', '2']);
  });

  it('reste aligné avec les caractères hors BMP', () => {
    const src = 'a😀b';
    const { text, map } = normalizeWithMap(src);
    expect(text).toBe('A😀B');
    expect(map).toEqual([0, 1, 1, 3]);
  });
});

describe('exportFileName', async () => {
  const { exportFileName } = await import('../src/export-page.js');
  it('POSIX et Windows', () => {
    expect(exportFileName('/a/b/CIBE .pdf', 7, '0540010-R13')).toBe('CIBE_p7_0540010R13.pdf');
    expect(exportFileName('C:\\PDF\\S15 Panneau.PDF', 1, 'ab 12')).toBe('S15_Panneau_p1_AB12.pdf');
  });
});
