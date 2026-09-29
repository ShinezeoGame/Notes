import { useEffect, useState } from 'react';

type ToastAction = { label: string; run: () => void };
type Toast = { id: number; message: string; kind: 'info' | 'error'; action?: ToastAction; duration?: number };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;

/** Message temporaire ; `action` ajoute un bouton (ex. « Annuler »), `duration` en millisecondes. */
export function toast(message: string, kind: 'info' | 'error' = 'info', opts: { action?: ToastAction; duration?: number } = {}) {
  const t = { id: ++seq, message, kind, ...opts };
  listeners.forEach((l) => l(t));
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), t.duration ?? (t.kind === 'error' ? 6000 : 3500));
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="nb-toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`nb-toast nb-toast--${t.kind}`}>
          {t.message}
          {t.action ? (
            <button
              type="button"
              className="nb-toast-action"
              onClick={() => {
                t.action?.run();
                setItems((prev) => prev.filter((x) => x.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
