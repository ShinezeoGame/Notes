// Signatures : dessinées au doigt ou à la souris, gardées dans l'espace (synchronisées entre appareils) pour être
// réutilisées. Enregistrées en traits (et non en image) : nettes à toutes les tailles.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { Modal } from '../components/Modal';
import { Icon } from '../icons/Icon';
import { newId } from '../lib/ids';
import { simplifyStroke, strokePath, strokesBounds } from './ink';
import { t } from '../lib/i18n';

export type SavedSignature = {
  id: string;
  /** Traits en fractions du cadre. */
  strokes: number[][];
  /** Largeur / hauteur du cadre. */
  ratio: number;
  /** Épaisseur du trait en fraction de la hauteur du cadre. */
  width: number;
  createdAt: number;
};

const mapOf = (doc: Y.Doc) => doc.getMap<string>('pdfSignatures');

function readAll(doc: Y.Doc): SavedSignature[] {
  const list: SavedSignature[] = [];
  mapOf(doc).forEach((raw, id) => {
    try {
      list.push({ ...(JSON.parse(raw) as SavedSignature), id });
    } catch {
      /* entrée illisible ignorée */
    }
  });
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

const snapshots = new WeakMap<Y.Doc, { version: number; list: SavedSignature[] }>();
const versions = new WeakMap<Y.Doc, number>();

export function useSignatures(doc: Y.Doc): SavedSignature[] {
  const subscribe = useCallback(
    (fn: () => void) => {
      const map = mapOf(doc);
      const onChange = () => {
        versions.set(doc, (versions.get(doc) ?? 0) + 1);
        fn();
      };
      map.observe(onChange);
      return () => map.unobserve(onChange);
    },
    [doc],
  );
  const read = useCallback(() => {
    const version = versions.get(doc) ?? 0;
    const cached = snapshots.get(doc);
    if (cached?.version === version) return cached.list;
    const list = readAll(doc);
    snapshots.set(doc, { version, list });
    return list;
  }, [doc]);
  return useSyncExternalStore(subscribe, read, read);
}

export const SIGNATURE_COLORS = ['#1b2f7a', '#111111'];

/** Aperçu d'une signature (SVG). */
export function SignaturePreview({ sig, color = SIGNATURE_COLORS[0], height = 48 }: { sig: SavedSignature; color?: string; height?: number }) {
  const w = height * sig.ratio;
  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true">
      <g fill="none" stroke={color} strokeWidth={Math.max(1, sig.width * height)} strokeLinecap="round" strokeLinejoin="round">
        {sig.strokes.map((s, i) => (
          <path key={i} d={strokePath(s, (x, y) => [x * w, y * height])} />
        ))}
      </g>
    </svg>
  );
}

const PAD_STROKE = 3;

/** Zone de dessin d'une nouvelle signature ; renvoie les traits en pixels de la zone. */
function SignaturePad({ strokes, onChange, color }: { strokes: number[][]; onChange: (s: number[][]) => void; color: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const current = useRef<{ id: number; points: number[] } | null>(null);
  const [live, setLive] = useState<number[] | null>(null);

  const point = (e: React.PointerEvent | PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  return (
    <svg
      ref={ref}
      className="pdf-sigpad"
      role="img"
      aria-label={t('Zone de signature : signez ici avec le doigt ou la souris')}
      onPointerDown={(e) => {
        if (current.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        current.current = { id: e.pointerId, points: point(e) };
        setLive(current.current.points.slice());
      }}
      onPointerMove={(e) => {
        const c = current.current;
        if (!c || c.id !== e.pointerId) return;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        for (const ev of events.length ? events : [e.nativeEvent]) c.points.push(...point(ev));
        setLive(c.points.slice());
      }}
      onPointerUp={(e) => {
        const c = current.current;
        if (!c || c.id !== e.pointerId) return;
        current.current = null;
        setLive(null);
        onChange([...strokes, simplifyStroke(c.points, 1.2)]);
      }}
      onPointerCancel={() => {
        current.current = null;
        setLive(null);
      }}
    >
      <line className="pdf-sigpad-line" x1="8%" x2="92%" y1="78%" y2="78%" />
      <g fill="none" stroke={color} strokeWidth={PAD_STROKE} strokeLinecap="round" strokeLinejoin="round">
        {strokes.map((s, i) => (
          <path key={i} d={strokePath(s)} />
        ))}
        {live ? <path d={strokePath(live)} /> : null}
      </g>
    </svg>
  );
}

/** Traits du cadre de dessin → signature (fractions de son cadre, marges comprises). */
function normalize(strokes: number[][]): Omit<SavedSignature, 'id' | 'createdAt'> | null {
  const [x, y, w, h] = strokesBounds(strokes);
  if (strokes.length === 0 || (w < 8 && h < 8)) return null;
  const pad = PAD_STROKE;
  const bx = x - pad;
  const by = y - pad;
  const bw = Math.max(1, w + 2 * pad);
  const bh = Math.max(1, h + 2 * pad);
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {
    strokes: strokes.map((s) => s.map((v, i) => round(i % 2 ? (v - by) / bh : (v - bx) / bw))),
    ratio: bw / bh,
    width: PAD_STROKE / bh,
  };
}

type Props = {
  /** Document de l'espace (signatures gardées). */
  doc: Y.Doc;
  onPick: (sig: SavedSignature, color: string) => void;
  onClose: () => void;
};

/** Choisir une signature gardée ou en dessiner une nouvelle. */
export function SignatureDialog({ doc, onPick, onClose }: Props) {
  const saved = useSignatures(doc);
  const [drawing, setDrawing] = useState(saved.length === 0);
  const [strokes, setStrokes] = useState<number[][]>([]);
  const [keep, setKeep] = useState(true);
  const [color, setColor] = useState(SIGNATURE_COLORS[0]);

  useEffect(() => {
    if (saved.length === 0) setDrawing(true);
  }, [saved.length]);

  const use = () => {
    const sig = normalize(strokes);
    if (!sig) return;
    const full: SavedSignature = { ...sig, id: newId(), createdAt: Date.now() };
    if (keep) mapOf(doc).set(full.id, JSON.stringify({ ...sig, createdAt: full.createdAt }));
    onPick(full, color);
  };

  const colors = (
    <div className="pdf-sig-colors" role="radiogroup" aria-label={t('Couleur de l’encre')}>
      {SIGNATURE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={color === c}
          aria-label={c === SIGNATURE_COLORS[0] ? t('Encre bleue') : t('Encre noire')}
          className={`pdf-swatch${color === c ? ' pdf-swatch--active' : ''}`}
          style={{ background: c }}
          onClick={() => setColor(c)}
        />
      ))}
    </div>
  );

  return (
    <Modal
      title={t('Signature')}
      onClose={onClose}
      width={560}
      footer={
        drawing ? (
          <>
            {saved.length ? (
              <button type="button" className="nb-btn" onClick={() => setDrawing(false)}>
                {t('Retour')}
              </button>
            ) : (
              <button type="button" className="nb-btn" onClick={onClose}>
                {t('Annuler')}
              </button>
            )}
            <button type="button" className="nb-btn nb-btn--primary" onClick={use} disabled={!normalize(strokes)}>
              {t('Placer la signature')}
            </button>
          </>
        ) : (
          <button type="button" className="nb-btn" onClick={onClose}>
            {t('Fermer')}
          </button>
        )
      }
    >
      {drawing ? (
        <>
          <p className="nb-muted pdf-sig-help">{t('Signez dans le cadre avec le doigt ou la souris.')}</p>
          <SignaturePad strokes={strokes} onChange={setStrokes} color={color} />
          <div className="pdf-sig-row">
            {colors}
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => setStrokes([])} disabled={strokes.length === 0}>
              <Icon name="eraser" size={14} /> {t('Effacer')}
            </button>
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={strokes.length === 0}>
              <Icon name="undo" size={14} /> {t('Dernier trait')}
            </button>
          </div>
          <label className="pdf-check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> {t('Garder cette signature pour la prochaine fois')}
          </label>
        </>
      ) : (
        <>
          <p className="nb-muted pdf-sig-help">{t('Touchez une signature pour la placer sur la page affichée.')}</p>
          {colors}
          <ul className="pdf-sig-list">
            {saved.map((sig) => (
              <li key={sig.id}>
                <button type="button" className="pdf-sig-item" onClick={() => onPick(sig, color)} aria-label={t('Placer cette signature')}>
                  <SignaturePreview sig={sig} color={color} height={56} />
                </button>
                <button
                  type="button"
                  className="nb-icon-btn"
                  aria-label={t('Supprimer cette signature')}
                  title={t('Supprimer cette signature')}
                  onClick={() => mapOf(doc).delete(sig.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="nb-btn"
            onClick={() => {
              setStrokes([]);
              setDrawing(true);
            }}
          >
            <Icon name="plus" size={15} /> {t('Nouvelle signature')}
          </button>
        </>
      )}
    </Modal>
  );
}
