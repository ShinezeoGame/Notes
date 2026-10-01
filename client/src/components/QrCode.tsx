import { useMemo } from 'react';
import { encode } from 'uqr';
import { t } from '../lib/i18n';

/**
 * QR code d'un lien, à scanner avec l'appareil photo d'un téléphone. Toujours noir sur blanc, quel que soit le thème :
 * les codes inversés ne sont pas lus par tous les téléphones.
 */
export function QrCode({ text, size = 168, label = t('QR code du lien') }: { text: string; size?: number; label?: string }) {
  const { n, d } = useMemo(() => {
    const { data } = encode(text, { ecc: 'M', border: 2 });
    let path = '';
    data.forEach((row, y) => row.forEach((on, x) => (path += on ? `M${x} ${y}h1v1h-1z` : '')));
    return { n: data.length, d: path };
  }, [text]);
  return (
    <svg className="nb-qr" viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
