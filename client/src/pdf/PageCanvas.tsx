import { useEffect, useRef, useState } from 'react';
import type { PageRef, PdfSource } from './model';
import { drawPage, type SourceCache } from './render';
import { t } from '../lib/i18n';

type Props = {
  cache: SourceCache;
  page: PageRef;
  src: PdfSource | undefined;
  /** Largeur affichée (px), avant la rotation ajoutée par l'utilisateur. */
  cssWidth: number;
  /** Sans les champs de formulaire (affichés par-dessus). */
  forms?: boolean;
  /** Délai avant le rendu (ms) : évite de redessiner à chaque étape d'un zoom. */
  delay?: number;
};

/** Rendu d'une page (PDF, photo ou page blanche) ; l'image précédente reste affichée pendant un nouveau rendu. */
export function PageCanvas({ cache, page, src, cssWidth, forms, delay = 0 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const width = Math.max(1, Math.round(cssWidth));
  const crop = page.crop ? `${page.crop.x},${page.crop.y},${page.crop.w},${page.crop.h}` : '';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let handle: ReturnType<typeof drawPage> | null = null;
    let alive = true;
    const timer = setTimeout(() => {
      handle = drawPage(cache, page, src, canvas, width, { forms });
      handle.promise.then(
        () => alive && setState('ready'),
        (err) => {
          console.warn('PDF : page non affichée', err);
          if (alive) setState('error');
        },
      );
    }, delay);
    return () => {
      alive = false;
      clearTimeout(timer);
      handle?.cancel();
    };
    // Rendu refait seulement si la page, son recadrage ou la taille changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, page.src, page.index, crop, src?.path, width, forms, delay]);

  return (
    <>
      <canvas ref={ref} className={`pdf-canvas${state === 'ready' ? '' : ' pdf-canvas--loading'}`} />
      {state === 'error' ? <span className="pdf-canvas-error">{t('Page illisible')}</span> : null}
    </>
  );
}
