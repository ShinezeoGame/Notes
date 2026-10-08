// Logo d'Ostal : un « O » (le foyer) sous une flèche en toit, point jaune allumé au centre, sur une tuile en dégradé
// (même dessin que client/public/icon.svg et les icônes de l'application).
import { useId } from 'react';

export function OstalLogo({ size = 24, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3D7BFF" />
          <stop offset="0.55" stopColor="#6C5CFF" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
        <radialGradient id={`${id}h`} cx="0.2" cy="0.1" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${id}g)`} />
      <rect width="512" height="512" rx="116" fill={`url(#${id}h)`} />
      <path d="M138 206L256 112L374 206" fill="none" stroke="#fff" strokeWidth="48" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="256" cy="316" r="92" fill="none" stroke="#fff" strokeWidth="52" />
      <circle cx="256" cy="316" r="30" fill="#FFD166" />
    </svg>
  );
}
