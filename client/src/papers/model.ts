// Papiers de la maison : documents importants (identité, véhicules, logement, santé…), avec leurs photos ou PDF, leur
// échéance et leurs rappels. Un texte JSON par papier dans le document de l'espace (map « papers », lue aussi par le
// serveur pour les rappels : server/src/reminders.js) ; fichiers sur le serveur, servis seulement aux appareils de
// l'espace (server/src/papers.js).
import { useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import type { IconName } from '../icons/registry';
import { newId } from '../lib/ids';
import { t } from '../lib/i18n';

export type PaperCategory = 'identity' | 'vehicle' | 'home' | 'health' | 'money' | 'work' | 'school' | 'warranty' | 'other';

/** Fichier d'un papier : nom sur le serveur, nom d'origine, type, taille. */
export type PaperFile = { name: string; label: string; type: string; size: number };

export type Paper = {
  id: string;
  title: string;
  category: PaperCategory;
  /** À qui il appartient (texte libre : « Léa », « Clio »…). */
  person: string;
  /** Numéro du document (facultatif). */
  number: string;
  /** Date d'expiration ou d'échéance (AAAA-MM-JJ), ou ''. */
  expires: string;
  /** Rappels : nombre de jours avant l'échéance (0 : le jour même). */
  remind: number[];
  notes: string;
  files: PaperFile[];
  createdAt: number;
  updatedAt: number;
};

export const CATEGORIES: { id: PaperCategory; label: string; icon: IconName }[] = [
  { id: 'identity', label: t('Identité'), icon: 'idCard' },
  { id: 'vehicle', label: t('Véhicules'), icon: 'car' },
  { id: 'home', label: t('Logement'), icon: 'home' },
  { id: 'health', label: t('Santé'), icon: 'heartPulse' },
  { id: 'money', label: t('Argent et impôts'), icon: 'wallet' },
  { id: 'work', label: t('Travail'), icon: 'briefcase' },
  { id: 'school', label: t('École'), icon: 'graduation' },
  { id: 'warranty', label: t('Garanties et factures'), icon: 'receipt' },
  { id: 'other', label: t('Autres'), icon: 'folder' },
];

export const category = (id: PaperCategory) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

/** Modèles proposés à l'ajout : nom, catégorie, rappels habituels (délais de renouvellement, préavis). */
export const TEMPLATES: { title: string; category: PaperCategory; remind: number[] }[] = [
  { title: t('Carte d’identité'), category: 'identity', remind: [90, 30] },
  { title: t('Passeport'), category: 'identity', remind: [180, 90] },
  { title: t('Permis de conduire'), category: 'identity', remind: [90] },
  { title: t('Titre de séjour'), category: 'identity', remind: [120, 60] },
  { title: t('Carte grise'), category: 'vehicle', remind: [] },
  { title: t('Contrôle technique'), category: 'vehicle', remind: [30, 7] },
  { title: t('Assurance auto'), category: 'vehicle', remind: [60, 30] },
  { title: t('Assurance habitation'), category: 'home', remind: [60, 30] },
  { title: t('Bail ou acte de propriété'), category: 'home', remind: [] },
  { title: t('Contrat d’énergie ou de box'), category: 'home', remind: [30] },
  { title: t('Carte Vitale'), category: 'health', remind: [] },
  { title: t('Mutuelle'), category: 'health', remind: [30] },
  { title: t('Carnet de vaccination'), category: 'health', remind: [] },
  { title: t('Avis d’impôt'), category: 'money', remind: [] },
  { title: t('RIB'), category: 'money', remind: [] },
  { title: t('Contrat de travail'), category: 'work', remind: [] },
  { title: t('Bulletins de salaire'), category: 'work', remind: [] },
  { title: t('Certificat de scolarité'), category: 'school', remind: [] },
  { title: t('Garantie ou facture'), category: 'warranty', remind: [30] },
];

/** Rappels possibles (jours avant l'échéance), du plus tôt au plus tard. */
export const REMIND_CHOICES: { days: number; label: string }[] = [
  { days: 180, label: t('6 mois avant') },
  { days: 90, label: t('3 mois avant') },
  { days: 60, label: t('2 mois avant') },
  { days: 30, label: t('1 mois avant') },
  { days: 7, label: t('1 semaine avant') },
  { days: 0, label: t('Le jour même') },
];

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');

function normalize(id: string, raw: unknown): Paper | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Partial<Paper> | null;
  if (!r || typeof r.title !== 'string') return null;
  return {
    id,
    title: str(r.title, 200),
    category: CATEGORY_IDS.has(r.category as PaperCategory) ? (r.category as PaperCategory) : 'other',
    person: str(r.person, 100),
    number: str(r.number, 100),
    expires: /^\d{4}-\d{2}-\d{2}$/.test(String(r.expires)) ? String(r.expires) : '',
    remind: Array.isArray(r.remind) ? [...new Set(r.remind.filter((n) => Number.isInteger(n) && n >= 0 && n <= 400))].sort((a, b) => b - a) : [],
    notes: str(r.notes, 5000),
    files: Array.isArray(r.files)
      ? r.files
          .filter((f) => f && typeof f.name === 'string')
          .map((f) => ({ name: f.name, label: str(f.label, 200) || f.name, type: str(f.type, 100), size: Number(f.size) || 0 }))
      : [],
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || 0,
  };
}

export function readPapers(doc: Y.Doc): Paper[] {
  const out: Paper[] = [];
  doc.getMap('papers').forEach((raw, id) => {
    try {
      const p = normalize(id, JSON.parse(String(raw)));
      if (p) out.push(p);
    } catch {
      /* papier illisible : ignoré */
    }
  });
  return out;
}

export function newPaper(): Paper {
  return { id: newId(), title: '', category: 'other', person: '', number: '', expires: '', remind: [], notes: '', files: [], createdAt: Date.now(), updatedAt: 0 };
}

export function savePaper(doc: Y.Doc, paper: Paper) {
  const { id, ...data } = paper;
  doc.getMap('papers').set(id, JSON.stringify({ ...data, updatedAt: Date.now() }));
}

export function removePaper(doc: Y.Doc, id: string) {
  doc.getMap('papers').delete(id);
}

/** Papiers de l'espace, suivis en direct. */
export function usePapers(doc: Y.Doc | null): Paper[] {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!doc) return;
    const map = doc.getMap('papers');
    const bump = () => setVersion((v) => v + 1);
    map.observe(bump);
    return () => map.unobserve(bump);
  }, [doc]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (doc ? readPapers(doc) : []), [doc, version]);
}

const DAY = 86_400_000;

/** Jour local AAAA-MM-JJ. */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Jours entre aujourd'hui et une date AAAA-MM-JJ (négatif : passée). */
export function daysUntil(key: string, today = todayKey()): number {
  const [y, m, d] = key.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / DAY);
}

export type PaperStatus = { kind: 'none' | 'ok' | 'soon' | 'expired'; days: number };

/** Échéance : aucune, lointaine, bientôt (dans les 2 mois, ou à l'approche du premier rappel), passée. */
export function paperStatus(p: Paper, today = todayKey()): PaperStatus {
  if (!p.expires) return { kind: 'none', days: 0 };
  const days = daysUntil(p.expires, today);
  if (days < 0) return { kind: 'expired', days };
  return { kind: days <= Math.max(60, ...p.remind) ? 'soon' : 'ok', days };
}

/** Papiers à renouveler (échéance passée ou proche), du plus urgent au moins urgent. */
export function papersToRenew(papers: Paper[], today = todayKey()): Paper[] {
  return papers
    .filter((p) => ['soon', 'expired'].includes(paperStatus(p, today).kind))
    .sort((a, b) => a.expires.localeCompare(b.expires));
}
