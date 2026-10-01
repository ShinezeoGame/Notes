// Langue de l'interface : anglais ou français, propre à l'appareil (réglages locaux ; anglais pour une nouvelle
// installation). Les textes sont écrits en français dans le code et passés à t('…') ; le dictionnaire anglais
// (src/i18n/en.ts) donne leur traduction, et un texte sans traduction reste en français. La langue est lue au
// démarrage : en changer relance l'application. Vérification : npm run i18n:check (dans client/).
import { Fragment, createElement, type ReactNode } from 'react';
import { EN, EN_PATTERNS } from '../i18n/en';
import { getSettings, updateSettings, type Lang } from './settings';

export type { Lang };

/** Langues proposées, chacune écrite dans sa propre langue. */
export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' }, // i18n-ignore
  { id: 'fr', label: 'Français' }, // i18n-ignore
];

const lang: Lang = (() => {
  try {
    return getSettings().lang === 'fr' ? 'fr' : 'en';
  } catch {
    return 'en';
  }
})();

export const getLang = (): Lang => lang;

/** Langue des dates, heures et nombres (Intl, toLocale…). */
export const locale = (): string => (lang === 'fr' ? 'fr-FR' : 'en-GB');

const fill = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

/** Texte de l'interface dans la langue choisie ; `{nom}` remplacé par `vars.nom`. */
export function t(fr: string, vars?: Record<string, string | number>): string {
  return fill(lang === 'fr' ? fr : (EN[fr] ?? fr), vars);
}

/** Singulier ou pluriel selon `n` (français : 0 et 1 au singulier ; anglais : 1 seulement) ; `{n}` vaut `n`. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  const singular = lang === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1;
  return t(singular ? one : many, { n, ...vars }); // i18n-ignore : textes vérifiés dans les appels de tn()
}

/**
 * Phrase avec des parties mises en forme : chaque <nom>…</nom> du texte traduit est rendu par `parts.nom(contenu)`
 * (gras, lien…), le reste en texte. Exemple : tx('Tapez <b>/</b> pour les commandes', { b: (s) => <b>{s}</b> }).
 */
export function tx(fr: string, parts: Record<string, (content: string) => ReactNode>, vars?: Record<string, string | number>): ReactNode {
  const text = t(fr, vars); // i18n-ignore : textes vérifiés dans les appels de tx()
  const out: ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const render = parts[m[1]];
    out.push(render ? render(m[2]) : m[2]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return createElement(Fragment, null, ...out);
}

/**
 * Message venant du serveur Melo (erreur, état d'un appareil…), écrit en français : traduit par le dictionnaire,
 * ou par un des modèles de EN_PATTERNS pour les messages qui contiennent un nombre ou un nom.
 */
export function tServer(message: string): string {
  if (lang === 'fr' || !message) return message;
  if (EN[message]) return EN[message];
  for (const [re, en] of EN_PATTERNS) {
    const m = re.exec(message);
    if (m) return typeof en === 'string' ? message.replace(re, en) : en(...m.slice(1));
  }
  return message;
}

/** Change la langue de cet appareil ; l'application redémarre dans cette langue. */
export function setLang(next: Lang) {
  updateSettings({ lang: next, langChosen: true });
  if (next !== lang) location.reload();
}
