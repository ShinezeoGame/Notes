// Textes ajoutés aux PDF : police Helvetica (police standard des PDF, sans fichier à intégrer), mêmes retours à la
// ligne à l'écran et dans le fichier exporté.
import type { PDFFont } from '@cantoo/pdf-lib';

/** Hauteur de ligne et position de la ligne de base, en multiples de la taille du texte. */
export const LINE_HEIGHT = 1.2;
export const BASELINE = 0.945;
export const TEXT_FONT = 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", Roboto, sans-serif';

/** Caractères de la table Windows-1252 (codes 0x80 à 0x9F) disponibles dans les polices standard des PDF. */
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACE: Record<string, string> = {
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '‐': '-',
  '‑': '-',
  '−': '-',
  '′': "'",
  '″': '"',
  '→': '->',
  '←': '<-',
  '≤': '<=',
  '≥': '>=',
  '\t': '    ',
};

/** Texte limité aux caractères des polices standard des PDF (accents français compris) ; les autres deviennent « ? ». */
export function toPdfText(text: string): string {
  let out = '';
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '\n' || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRA.has(ch)) out += ch;
    else if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    // Caractères invisibles (sélecteurs de variante des émojis, espaces sans chasse) : ignorés.
    else if ((cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200b || cp === 0x200d || cp === 0xfeff) continue;
    else out += '?';
  }
  return out;
}

/** Découpe en lignes d'au plus `maxWidth` (mêmes mesures que la police du PDF). */
export function wrapLines(text: string, maxWidth: number, widthOf: (s: string) => number): string[] {
  const lines: string[] = [];
  const breakWord = (word: string): string => {
    // Mot plus long que la ligne : coupé entre deux lettres ; renvoie le dernier morceau.
    let chunk = '';
    for (const ch of word) {
      if (chunk && widthOf(chunk + ch) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    return chunk;
  };
  for (const para of text.split('\n')) {
    let line = '';
    for (const token of para.split(/(\s+)/)) {
      if (!token) continue;
      const space = /^\s+$/.test(token);
      if (widthOf(line + token) <= maxWidth) {
        line += token;
      } else if (space) {
        lines.push(line);
        line = '';
      } else if (line.trim()) {
        lines.push(line.replace(/\s+$/, ''));
        line = widthOf(token) > maxWidth ? breakWord(token) : token;
      } else {
        line = breakWord(line + token);
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

let helvetica: Promise<PDFFont> | null = null;

/** Police Helvetica (mesure des textes à l'écran et écriture dans le PDF). */
export function loadHelvetica(): Promise<PDFFont> {
  helvetica ??= (async () => {
    const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    return doc.embedFont(StandardFonts.Helvetica);
  })();
  return helvetica;
}

/** Lignes d'une zone de texte (largeur maximale `width`, taille `size`). */
export function layoutText(font: PDFFont, text: string, width: number, size: number): { lines: string[]; width: number; height: number } {
  const clean = toPdfText(text);
  const widthOf = (s: string) => font.widthOfTextAtSize(s, size);
  const lines = wrapLines(clean, Math.max(size, width), widthOf);
  const widest = lines.reduce((m, l) => Math.max(m, widthOf(l)), 0);
  return { lines, width: widest, height: Math.max(1, lines.length) * size * LINE_HEIGHT };
}
