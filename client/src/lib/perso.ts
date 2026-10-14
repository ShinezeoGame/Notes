// Section « Perso » : documents HTML et sites externes réservés au propriétaire de l'espace. Rien n'est dans le code
// d'Ostal : tout vit dans le document Yjs de l'espace (sur son serveur, sur ses seuls appareils). Les cases cochées et
// les champs remplis d'un document sont gardés à part (map « perso-state ») et suivent sur tous ses appareils.
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { newId } from './ids';

export type PersoItem = {
  id: string;
  kind: 'doc' | 'site';
  title: string;
  /** Site externe : son adresse. */
  url?: string;
  /** Ajouté ou remplacé (ms). */
  at: number;
};

/** Taille maximale d'un document HTML (il voyage avec l'espace). */
export const MAX_DOC_BYTES = 3 * 1024 * 1024;

const map = (doc: Y.Doc) => doc.getMap('perso');
const stateMap = (doc: Y.Doc) => doc.getMap('perso-state');

export function readPerso(doc: Y.Doc): PersoItem[] {
  try {
    const raw = JSON.parse(String(map(doc).get('items') ?? '[]')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (i): i is PersoItem => Boolean(i) && typeof i.id === 'string' && (i.kind === 'doc' || i.kind === 'site') && typeof i.title === 'string',
    );
  } catch {
    return [];
  }
}

function saveItems(doc: Y.Doc, items: PersoItem[]) {
  map(doc).set('items', JSON.stringify(items));
}

/** Éléments de la section, suivis en direct (autres appareils). */
export function usePerso(doc: Y.Doc | null): PersoItem[] {
  const [items, setItems] = useState<PersoItem[]>(() => (doc ? readPerso(doc) : []));
  useEffect(() => {
    if (!doc) return;
    const m = map(doc);
    const read = () => setItems(readPerso(doc));
    m.observe(read);
    read();
    return () => m.unobserve(read);
  }, [doc]);
  return items;
}

/** Titre d'un document HTML (balise <title>), sinon le nom du fichier. */
export function htmlTitle(html: string, fileName: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = m ? m[1] : fileName.replace(/\.html?$/i, '');
  const text = new DOMParser().parseFromString(raw, 'text/html').documentElement.textContent ?? raw;
  return text.replace(/\s+/g, ' ').trim().slice(0, 120) || fileName;
}

export function addDoc(doc: Y.Doc, title: string, html: string): string {
  const id = newId();
  doc.transact(() => {
    map(doc).set(`html:${id}`, html);
    saveItems(doc, [...readPerso(doc), { id, kind: 'doc', title, at: Date.now() }]);
  });
  return id;
}

/** Nouvelle version d'un document : les cases déjà cochées restent (mêmes identifiants). */
export function replaceDoc(doc: Y.Doc, id: string, html: string) {
  doc.transact(() => {
    map(doc).set(`html:${id}`, html);
    saveItems(
      doc,
      readPerso(doc).map((i) => (i.id === id ? { ...i, at: Date.now() } : i)),
    );
  });
}

export function addSite(doc: Y.Doc, title: string, url: string): string {
  const id = newId();
  saveItems(doc, [...readPerso(doc), { id, kind: 'site', title, url, at: Date.now() }]);
  return id;
}

/** Nouveau nom (et nouvelle adresse pour un site). */
export function renameItem(doc: Y.Doc, id: string, title: string, url?: string) {
  saveItems(
    doc,
    readPerso(doc).map((i) => (i.id === id ? { ...i, title, ...(i.kind === 'site' && url ? { url } : {}) } : i)),
  );
}

export function removeItem(doc: Y.Doc, id: string) {
  doc.transact(() => {
    saveItems(
      doc,
      readPerso(doc).filter((i) => i.id !== id),
    );
    map(doc).delete(`html:${id}`);
    const s = stateMap(doc);
    for (const k of [...s.keys()]) if (k.startsWith(`${id}/`)) s.delete(k);
  });
}

export function docHtml(doc: Y.Doc, id: string): string {
  const v = map(doc).get(`html:${id}`);
  return typeof v === 'string' ? v : '';
}

/** HTML d'un document, suivi en direct (nouvelle version envoyée d'un autre appareil). */
export function useDocHtml(doc: Y.Doc, id: string): string {
  const [html, setHtml] = useState(() => docHtml(doc, id));
  useEffect(() => {
    const m = map(doc);
    const read = (e?: Y.YMapEvent<unknown>) => {
      if (!e || e.keysChanged.has(`html:${id}`)) setHtml(docHtml(doc, id));
    };
    m.observe(read);
    read();
    return () => m.unobserve(read);
  }, [doc, id]);
  return html;
}

export type FieldValue = boolean | string;

/** Cases et champs enregistrés d'un document : identifiant du champ → valeur. */
export function docState(doc: Y.Doc, id: string): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  const prefix = `${id}/`;
  stateMap(doc).forEach((v, k) => {
    if (k.startsWith(prefix) && (typeof v === 'boolean' || typeof v === 'string')) out[k.slice(prefix.length)] = v;
  });
  return out;
}

export function saveField(doc: Y.Doc, id: string, field: string, value: FieldValue) {
  const key = `${id}/${field.slice(0, 200)}`;
  const v = typeof value === 'string' ? value.slice(0, 20_000) : value;
  if (stateMap(doc).get(key) !== v) stateMap(doc).set(key, v);
}

/** Changements des champs enregistrés d'un document (autres appareils). */
export function onDocState(doc: Y.Doc, id: string, fn: () => void): () => void {
  const s = stateMap(doc);
  const prefix = `${id}/`;
  const listener = (e: Y.YMapEvent<unknown>) => {
    if ([...e.keysChanged].some((k) => k.startsWith(prefix))) fn();
  };
  s.observe(listener);
  return () => s.unobserve(listener);
}

/** Cases cochées sur le total (avancement affiché sur la carte du document). */
export function checkProgress(html: string, state: Record<string, FieldValue>): { done: number; total: number } | null {
  const ids = [...html.matchAll(/<input\b[^>]*\btype\s*=\s*["']?checkbox["']?[^>]*>/gi)]
    .map((m) => /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(m[0])?.[1])
    .filter((x): x is string => Boolean(x));
  if (!ids.length) return null;
  return { done: ids.filter((i) => state[i] === true).length, total: ids.length };
}

/**
 * Script ajouté au document affiché : il reçoit les champs enregistrés (« ostal-doc-state ») et signale chaque
 * changement (« ostal-doc-save ») à Ostal, la page qui l'affiche. Le document tourne dans un cadre isolé (origine
 * opaque) : il ne lit ni la clé de l'espace ni rien d'autre d'Ostal.
 */
const BRIDGE = /* i18n-ignore : script, pas un texte affiché */ `<script>(function(){
var applying=false;
function fields(){return Array.prototype.slice.call(document.querySelectorAll('input[id],textarea[id],select[id]'));}
function skip(el){return el.type==='password'||el.type==='file'||el.type==='hidden';}
function value(el){return el.type==='checkbox'||el.type==='radio'?el.checked:el.value;}
window.addEventListener('message',function(e){
if(e.source!==parent||!e.data||e.data.type!=='ostal-doc-state')return;
var s=e.data.state||{};applying=true;
fields().forEach(function(el){
if(skip(el)||!Object.prototype.hasOwnProperty.call(s,el.id))return;var v=s[el.id];
if(el.type==='checkbox'||el.type==='radio'){if(el.checked!==!!v){el.checked=!!v;el.dispatchEvent(new Event('change',{bubbles:true}));}}
else if(el.value!==String(v)){el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
});
applying=false;
});
function save(e){var el=e.target;if(applying||!el||!el.id||!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)||skip(el))return;
parent.postMessage({type:'ostal-doc-save',id:el.id,value:value(el)},'*');}
document.addEventListener('change',save,true);document.addEventListener('input',save,true);
document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
if(a&&/^https?:/i.test(a.getAttribute('href')||'')){a.target='_blank';a.rel='noopener';}},true);
parent.postMessage({type:'ostal-doc-ready'},'*');
})();</script>`;

/** Document prêt à afficher : script de liaison ajouté à la fin du corps. */
export function withBridge(html: string): string {
  const at = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  return at >= 0 ? html.slice(0, at) + BRIDGE + html.slice(at) : html + BRIDGE;
}

/** Adresse d'un site saisie (« exemple.fr » → https://exemple.fr/), ou '' si invalide. */
export function siteUrl(input: string): string {
  const u = input.trim();
  if (!u) return '';
  const full = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
  try {
    const parsed = new URL(full);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes('.') ? parsed.href : '';
  } catch {
    return '';
  }
}
