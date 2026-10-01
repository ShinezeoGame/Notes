// Tableur : recopie avec la poignée (petit carré au coin de la sélection), comme Excel : suites de nombres (1, 2, 3…),
// dates (jour suivant), textes numérotés (« Semaine 1 », « Semaine 2 »…), mois et jours de la semaine, formules
// (références relatives décalées), sinon simple répétition.
import type { Lang } from '../lib/i18n';
import { dayNames, monthNames } from './format';
import { isFormula, storeText, textOf, type CellValue } from './values';

export type FillSource = { v: CellValue; s: number; date: boolean };

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.$/, '');

/** Listes connues (mois, jours ; noms longs et courts, français et anglais). */
function lists(): string[][] {
  const out: string[][] = [];
  for (const lang of ['fr', 'en'] as Lang[]) {
    for (const width of ['long', 'short'] as const) {
      out.push(monthNames(lang, width));
      // Jours du lundi au dimanche.
      const days = dayNames(lang, width);
      out.push([...days.slice(1), days[0]]);
    }
  }
  return out;
}

/** Même casse que le modèle (« Lundi », « LUNDI », « lundi »). */
function sameCase(model: string, word: string): string {
  if (model === model.toUpperCase() && model !== model.toLowerCase()) return word.toUpperCase();
  if (model[0] === model[0].toUpperCase() && model[0] !== model[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

/**
 * Valeurs des cellules recopiées : `count` cellules après les `src` (dans le sens de la recopie). `shift(f, k)` :
 * formule `f` décalée de `k` lignes ou colonnes.
 */
export function fillSeries(src: FillSource[], count: number, shift: (formula: string, k: number) => string): { v: CellValue; s: number }[] {
  const n = src.length;
  const out: { v: CellValue; s: number }[] = [];
  if (!n) return out;
  const values = src.map((x) => x.v);
  const numbers = values.every((v) => typeof v === 'number');
  // Suite de nombres : droite des moindres carrés (exacte pour un pas régulier).
  if (numbers && (n >= 2 || src[0].date)) {
    const ys = values as number[];
    let a = ys[0];
    let b = 1;
    if (n >= 2) {
      const mx = (n - 1) / 2;
      const my = ys.reduce((s, y) => s + y, 0) / n;
      let num = 0;
      let den = 0;
      ys.forEach((y, i) => {
        num += (i - mx) * (y - my);
        den += (i - mx) ** 2;
      });
      b = num / den;
      a = my - b * mx;
    }
    for (let k = n; k < n + count; k++) out.push({ v: Number((a + b * k).toPrecision(15)), s: src[k % n].s });
    return out;
  }
  // Texte terminé par un nombre (« Semaine 1 ») : même début, numéro suivant.
  const texts = values.map((v) => (typeof v === 'string' && !isFormula(v) ? textOf(v) : null));
  if (texts.every((s) => s !== null)) {
    const parts = texts.map((s) => /^(.*?)(\d+)$/.exec(s!));
    if (parts.every((m) => m && m[1] === parts[0]![1])) {
      const nums = parts.map((m) => Number(m![2]));
      const step = n >= 2 ? (nums[n - 1] - nums[0]) / (n - 1) : 1;
      const width = parts[0]![2].startsWith('0') ? parts[0]![2].length : 0;
      if (Number.isInteger(step)) {
        for (let k = n; k < n + count; k++) {
          const num = nums[0] + step * k;
          const digits = num < 0 ? String(num) : String(num).padStart(width, '0');
          out.push({ v: storeText(parts[0]![1] + digits), s: src[k % n].s });
        }
        return out;
      }
    }
    // Mois et jours de la semaine.
    for (const list of lists()) {
      const keys = list.map(strip);
      const idx = texts.map((s) => keys.indexOf(strip(s!)));
      if (idx.every((i) => i >= 0)) {
        const step = n >= 2 ? idx[1] - idx[0] || 1 : 1;
        for (let k = n; k < n + count; k++) {
          const i = (((idx[0] + step * k) % list.length) + list.length) % list.length;
          out.push({ v: storeText(sameCase(texts[0]!, list[i])), s: src[k % n].s });
        }
        return out;
      }
    }
  }
  // Répétition (formules décalées).
  for (let k = n; k < n + count; k++) {
    const i = k % n;
    const v = values[i];
    out.push({ v: isFormula(v) ? shift(v, k - i) : v, s: src[i].s });
  }
  return out;
}
