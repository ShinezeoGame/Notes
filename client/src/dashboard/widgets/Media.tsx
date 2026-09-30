// Widgets Image (photo envoyée ou adresse d'image) et Site web (page intégrée).
import { useEffect, useRef, useState } from 'react';
import { useAppCtx } from '../../editor/context';
import { isImageLink, prepareImage } from '../../lib/images';
import { Icon } from '../../icons/Icon';
import { num, str, type SettingsProps, type WidgetProps } from '../types';

export function ImageWidget({ widget, openSettings, editing }: WidgetProps) {
  const url = str(widget.config.url);
  const link = str(widget.config.link).trim();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    return (
      <div className="w-empty">
        <Icon name="image" size={26} />
        {failed ? <span className="w-muted">Image introuvable.</span> : null}
        <button type="button" className="nb-btn nb-btn--sm" onClick={openSettings} disabled={editing}>
          Choisir une image
        </button>
      </div>
    );
  }
  const img = (
    <img
      className="w-image"
      src={url}
      alt={widget.title || ''}
      style={{ objectFit: str(widget.config.fit) === 'contain' ? 'contain' : 'cover' }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
  return link ? (
    <a className="w-image-link" href={/^[a-z][a-z0-9+.-]*:/i.test(link) ? link : `https://${link}`} target="_blank" rel="noopener noreferrer">
      {img}
    </a>
  ) : (
    img
  );
}

export function ImageSettings({ config, set }: SettingsProps) {
  const ctx = useAppCtx();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(str(config.url).startsWith('data:') ? '' : str(config.url));
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      set({ url: await ctx.uploadFile(await prepareImage(file, 2000, 2000, false)) });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Envoi de l’image impossible.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {str(config.url) ? <img className="w-image-preview" src={str(config.url)} alt="" /> : null}
      <div className="nb-field">
        <span>Image</span>
        <div className="nb-row nb-gap">
          <button type="button" className="nb-btn" onClick={() => input.current?.click()} disabled={busy}>
            <Icon name="upload" size={15} /> {busy ? 'Envoi…' : 'Envoyer une image'}
          </button>
        </div>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        <div className="nb-row nb-gap">
          <input className="nb-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="… ou adresse d’une image (https://…)" inputMode="url" />
          <button
            type="button"
            className="nb-btn"
            disabled={!draft.trim()}
            onClick={() => {
              if (!isImageLink(draft.trim()) && !/^https?:\/\//i.test(draft.trim())) setError('Adresse d’image invalide.');
              else set({ url: draft.trim() });
            }}
          >
            Utiliser
          </button>
        </div>
        {error ? <div className="nb-error">{error}</div> : null}
      </div>
      <label className="nb-field">
        <span>Cadrage</span>
        <select className="nb-input" value={str(config.fit, 'cover')} onChange={(e) => set({ fit: e.target.value })}>
          <option value="cover">Remplir le widget (image recadrée)</option>
          <option value="contain">Image entière</option>
        </select>
      </label>
      <label className="nb-field">
        <span>Lien à l’appui (facultatif)</span>
        <input className="nb-input" value={str(config.link)} onChange={(e) => set({ link: e.target.value })} placeholder="https://…" inputMode="url" />
      </label>
    </>
  );
}

/** Adresse complétée et vérifiée (http ou https seulement). */
function webUrl(url: string): string {
  const u = url.trim();
  if (!u) return '';
  const full = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
  try {
    const parsed = new URL(full);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

export function WebWidget({ widget, openSettings, editing }: WidgetProps) {
  const url = webUrl(str(widget.config.url));
  const zoom = num(widget.config.zoom, 100) / 100;
  if (!url) {
    return (
      <div className="w-empty">
        <Icon name="globe" size={26} />
        <button type="button" className="nb-btn nb-btn--sm" onClick={openSettings} disabled={editing}>
          Choisir un site
        </button>
      </div>
    );
  }
  return (
    <div className="w-web">
      <iframe
        src={url}
        title={widget.title || url}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        style={zoom !== 1 ? { width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: '0 0' } : undefined}
      />
    </div>
  );
}

export function WebSettings({ config, set }: SettingsProps) {
  return (
    <>
      <label className="nb-field">
        <span>Adresse du site</span>
        <input className="nb-input" value={str(config.url)} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" inputMode="url" autoFocus />
      </label>
      <label className="nb-field">
        <span>Zoom : {num(config.zoom, 100)} %</span>
        <input type="range" min={40} max={150} step={10} value={num(config.zoom, 100)} onChange={(e) => set({ zoom: Number(e.target.value) })} />
      </label>
      <p className="nb-muted w-settings-hint">
        Certains sites (Google, Facebook, banques…) refusent de s’afficher dans une autre application : ils restent vides ici. Les tableaux de bord
        de votre réseau (Grafana, Home Assistant, routeur…) s’affichent en général sans problème.
      </p>
    </>
  );
}
