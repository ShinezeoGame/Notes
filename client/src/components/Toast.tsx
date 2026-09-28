import { useEffect, useState } from 'react';

type Toast = { id: number; message: string; kind: 'info' | 'error' };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;

export function toast(message: string, kind: 'info' | 'error' = 'info') {
  const t = { id: ++seq, message, kind };
  listeners.forEach((l) => l(t));
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : 3500);
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
        </div>
      ))}
    </div>
  );
}
