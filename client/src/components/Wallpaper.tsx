// Fond d'écran derrière l'application (accueil seulement, ou toutes les sections) : image, couleur ou dégradé,
// avec flou et voile de la couleur du thème pour garder le texte lisible.
import type { Appearance } from '../lib/appearance';
import { wallpaperCss } from '../lib/appearance';

export function Wallpaper({ appearance }: { appearance: Appearance }) {
  const w = appearance.wallpaper;
  if (w.kind === 'none') return null;
  const blur = w.kind === 'image' ? w.blur : 0;
  return (
    <div className="nb-wallpaper" aria-hidden="true">
      <div className="nb-wallpaper-fill" style={{ background: wallpaperCss(w), filter: blur ? `blur(${blur}px)` : undefined, inset: blur ? -blur * 2 : 0 }} />
      {w.dim ? <div className="nb-wallpaper-veil" style={{ background: `color-mix(in srgb, var(--bg) ${w.dim}%, transparent)` }} /> : null}
    </div>
  );
}
