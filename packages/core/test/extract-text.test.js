import { describe, expect, it } from 'vitest';
import { itemsToText } from '../src/extract-text.js';

const item = (str, x, y, { w = str.length * 5, h = 8, eol = false } = {}) => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h, hasEOL: eol });

describe('itemsToText', () => {
  it('saut de ligne quand Y change', () => {
    expect(itemsToText([item('AB-', 50, 700), item('1234-X', 50, 685)])).toBe('AB-\n1234-X');
  });

  it('espace quand l’écart horizontal est grand, rien quand les fragments se touchent', () => {
    expect(itemsToText([item('GH-34', 50, 700, { w: 30 }), item('56-W', 80, 700), item('412,00', 200, 700)])).toBe('GH-3456-W 412,00');
  });

  it('saut de ligne quand un fragment repart à gauche sur la même ligne (autre colonne)', () => {
    // cas réel (CIBE.pdf p.7) : fin d'une cellule à droite, puis la référence dans la colonne de gauche
    const items = [item('recevoir des modules G3', 466.4, 590, { w: 85.9 }), item('0540010R13', 146.4, 589.6, { w: 47 })];
    expect(itemsToText(items)).toBe('recevoir des modules G3\n0540010R13');
  });

  it('respecte hasEOL', () => {
    expect(itemsToText([item('ligne 1', 50, 700, { eol: true }), item('', 0, 0, { eol: true }), item('ligne 2', 50, 700)])).toBe('ligne 1\nligne 2');
  });
});
