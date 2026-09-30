// Fichiers reçus d'autres applications : « Ouvrir avec Melo » et « Partager » sur Android, « Ouvrir avec » de
// Windows pour l'application installée sur l'ordinateur. Ils sont importés dans l'atelier PDF.
import { useSyncExternalStore } from 'react';
import { toast } from '../components/Toast';
import { callNative, hasNativePlugin, onNative } from './native';
import { navigate } from './router';

const NATIVE = 'NotesFiles';
let pending: File[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function receive(files: File[]) {
  if (files.length === 0) return;
  pending = [...pending, ...files];
  notify();
  navigate('#/pdf');
}

/** Fichiers reçus pas encore importés (vidés par l'appel). */
export function takeIncoming(): File[] {
  const files = pending;
  pending = [];
  if (files.length) notify();
  return files;
}

export function useIncomingCount(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => pending.length,
    () => pending.length,
  );
}

type NativeFile = { name: string; mime: string; path: string; size: number };

/** Récupère les fichiers copiés par l'application Android (dossier de l'application, lu par la WebView). */
async function pullNative() {
  const res = await callNative<{ files?: NativeFile[] }>(NATIVE, 'takeIncoming').catch((err) => {
    console.warn('Fichiers reçus indisponibles', err);
    return null;
  });
  const list = res?.files ?? [];
  if (list.length === 0) return;
  const cap = (window as unknown as { Capacitor?: { convertFileSrc?: (p: string) => string } }).Capacitor;
  const files: File[] = [];
  const unreadable: string[] = [];
  for (const f of list) {
    try {
      const r = await fetch(cap?.convertFileSrc ? cap.convertFileSrc(f.path) : f.path);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      files.push(new File([blob], f.name, { type: f.mime || blob.type }));
    } catch (err) {
      console.warn('Fichier reçu illisible', f.name, err);
      unreadable.push(f.name);
    }
  }
  void callNative(NATIVE, 'releaseIncoming', { paths: list.map((f) => f.path) }).catch(() => {});
  if (unreadable.length) toast(`Fichier reçu illisible : ${unreadable.join(', ')}`, 'error');
  receive(files);
}

type LaunchParams = { files?: { getFile: () => Promise<File> }[] };

export function startIncoming() {
  if (hasNativePlugin(NATIVE)) {
    onNative(NATIVE, 'incoming', () => void pullNative());
    void pullNative();
  }
  const queue = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: LaunchParams) => void) => void } }).launchQueue;
  queue?.setConsumer((params) => {
    if (!params.files?.length) return;
    void Promise.all(params.files.map((h) => h.getFile())).then(receive, (err) => console.warn('Fichiers ouverts illisibles', err));
  });
}
