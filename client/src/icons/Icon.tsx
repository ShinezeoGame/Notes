import type { CSSProperties } from 'react';
import { ICONS, type IconName, type Shape } from './registry';

type Props = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  /** Texte alternatif : sans lui, l'icône est décorative (masquée aux lecteurs d'écran). */
  title?: string;
};

function renderShape(s: Shape, i: number) {
  const fillProps = 'fill' in s && s.fill ? { fill: 'currentColor', stroke: 'none' } : {};
  switch (s.t) {
    case 'path':
      return <path key={i} d={s.d} {...fillProps} />;
    case 'circle':
      return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} {...fillProps} />;
    case 'rect':
      return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...fillProps} />;
    case 'line':
      return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;
    case 'polyline':
      return <polyline key={i} points={s.points} />;
    case 'polygon':
      return <polygon key={i} points={s.points} {...fillProps} />;
    case 'ellipse':
      return <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />;
  }
}

export function Icon({ name, size = 16, strokeWidth, className, style, title }: Props) {
  const shapes: readonly Shape[] = ICONS[name] ?? ICONS.file;
  // Trait un peu plus fin pour les grandes tailles (icône de page), plus appuyé pour les petites.
  const sw = strokeWidth ?? (size >= 40 ? 1.5 : size >= 24 ? 1.65 : 1.8);
  return (
    <svg
      className={`nb-svg-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {shapes.map(renderShape)}
    </svg>
  );
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(155, 155, 155, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Tuile colorée façon icône d'application (tableau de bord homelab). */
export function AppTile({ name, color, size = 32, src }: { name: IconName; color: string; size?: number; src?: string }) {
  const style: CSSProperties = { width: size, height: size, borderRadius: Math.round(size * 0.26), background: hexToRgba(color, 0.16), color };
  return (
    <span className="nb-app-tile" style={style}>
      {src ? <img src={src} alt="" loading="lazy" style={{ width: size * 0.72, height: size * 0.72 }} /> : <Icon name={name} size={Math.round(size * 0.6)} />}
    </span>
  );
}
