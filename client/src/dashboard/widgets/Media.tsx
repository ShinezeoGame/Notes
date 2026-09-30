// Widgets Image (photo envoyée ou adresse d'image) et Site web (page intégrée).
import { useEffect, useRef, useState } from 'react';
import { useAppCtx } from '../../editor/context';
import { normalizeEmbedUrl } from '../../editor/embed';
import { api, serverBase } from '../../lib/api';
import { desktop } from '../../lib/desktop';
import { isImageLink, prepareImage } from '../../lib/images';
import { ImageCropDialog, parseCropSource, renderCropArea, type CropState } from '../../components/ImageCropDialog';
import { getSettings, isNative } from '../../lib/settings';
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

export function ImageSettings({ widgetId, config, set }: SettingsProps) {
  const ctx = useAppCtx();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(str(config.url).startsWith('data:') ? '' : str(config.url));
  // Image recadrée au format du widget avant utilisation ; l'image d'origine est gardée pour recadrer de nouveau.
  const [crop, setCrop] = useState<{ src: string; file?: File; initial: CropState | null; aspect: number } | null>(null);
  const widgetAspect = () => {
    const body = document.querySelector<HTMLElement>(`[data-widget="${widgetId}"] .dash-widget-body`);
    return body && body.clientHeight > 0 ? body.clientWidth / body.clientHeight : 4 / 3;
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Ce fichier n’est pas une image (JPG, PNG, WebP, GIF…).');
      return;
    }
    setCrop({ src: URL.createObjectURL(file), file, initial: null, aspect: widgetAspect() });
  };
  const recrop = () => {
    const source = parseCropSource(config.source);
    if (source) setCrop({ src: source.src, initial: { cx: source.cx, cy: source.cy, zoom: source.zoom }, aspect: widgetAspect() });
    else if (str(config.url)) setCrop({ src: str(config.url), initial: null, aspect: widgetAspect() });
  };
  const closeCrop = () => {
    if (crop?.file) URL.revokeObjectURL(crop.src);
    setCrop(null);
  };
  const finishCrop = async (img: HTMLImageElement, c: CropState | null) => {
    if (!crop) return;
    let original = crop.src;
    if (crop.file) original = await ctx.uploadFile(await prepareImage(crop.file, 2000, 2000, false));
    // Transparence gardée (logo…) : PNG ; photo : JPEG.
    const transparent = crop.file ? crop.file.type !== 'image/jpeg' : /\.(png|webp|gif|svg)(\?|$)/i.test(crop.src);
    const url = c ? await ctx.uploadFile(await renderCropArea(img, c, crop.aspect, 2000, 2000, transparent)) : original;
    set({ url, source: c ? { src: original, ...c } : null });
    closeCrop();
  };
  return (
    <>
      {str(config.url) ? <img className="w-image-preview" src={str(config.url)} alt="" /> : null}
      <div className="nb-field">
        <span>Image</span>
        <div className="nb-row nb-gap">
          <button type="button" className="nb-btn" onClick={() => input.current?.click()}>
            <Icon name="upload" size={15} /> Envoyer une image
          </button>
          {str(config.url) ? (
            <button type="button" className="nb-btn" onClick={recrop}>
              <Icon name="crop" size={15} /> Recadrer
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="nb-row nb-gap">
          <input className="nb-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="… ou adresse d’une image (https://…)" inputMode="url" />
          <button
            type="button"
            className="nb-btn"
            disabled={!draft.trim()}
            onClick={() => {
              if (!isImageLink(draft.trim()) && !/^https?:\/\//i.test(draft.trim())) setError('Adresse d’image invalide.');
              else set({ url: draft.trim(), source: null });
            }}
          >
            Utiliser
          </button>
        </div>
        {error ? <div className="nb-error">{error}</div> : null}
      </div>
      {crop ? (
        <ImageCropDialog
          src={crop.src}
          initial={crop.initial}
          aspect={crop.aspect}
          title="Recadrer l’image"
          animated={crop.file?.type === 'image/gif'}
          onCancel={closeCrop}
          onDone={finishCrop}
        />
      ) : null}
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

/**
 * Affichage du site : « ok » (cadre), ou raison pour laquelle le cadre resterait vide : site qui interdit d'être
 * affiché dans une autre page (« refused »), ou site en http dans Melo ouvert en https (« insecure »).
 */
type FrameState = 'checking' | 'ok' | 'refused' | 'insecure';

function useFrameState(src: string, player: boolean): FrameState {
  const [state, setState] = useState<FrameState>('checking');
  useEffect(() => {
    // Lecteur vidéo (YouTube, Vimeo…) fait pour être intégré ; application Windows : tous les sites s'affichent.
    if (!src || player || desktop()?.embedsAnySite) return setState('ok');
    // L'application Android autorise le http ; un navigateur le bloque dans une page https.
    if (location.protocol === 'https:' && src.startsWith('http:') && !isNative()) return setState('insecure');
    // Le serveur lit les en-têtes du site (réservé à son propriétaire).
    if (!serverBase() || getSettings().guest) return setState('ok');
    let alive = true;
    setState('checking');
    api
      .frameCheck(src)
      .then((r) => alive && setState(r.allowed === false ? 'refused' : 'ok'))
      .catch(() => alive && setState('ok'));
    return () => {
      alive = false;
    };
  }, [src, player]);
  return state;
}

export function WebWidget({ widget, openSettings, editing }: WidgetProps) {
  const url = webUrl(str(widget.config.url));
  const zoom = num(widget.config.zoom, 100) / 100;
  // Lien d'une vidéo (YouTube, Vimeo, Dailymotion…) : son lecteur intégré.
  const embed = url ? normalizeEmbedUrl(url) : null;
  const player = Boolean(embed && embed.kind !== 'generic');
  const src = player && embed ? embed.src : url;
  const state = useFrameState(src, player);
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
  if (state === 'checking') return <div className="w-web w-web--checking" />;
  if (state !== 'ok') {
    const host = new URL(url).host;
    // Application Windows ancienne (pont sans embedsAnySite) : sa mise à jour affiche le site.
    const elsewhere = desktop()
      ? ' La nouvelle version de Melo pour Windows l’affiche ici.'
      : isNative()
        ? ''
        : ' Il s’affiche dans l’application Melo pour Windows.';
    return (
      <div className="w-empty w-web-blocked">
        <Icon name="globe" size={26} />
        <b className="w-web-host">{host}</b>
        <span className="w-muted">
          {state === 'insecure'
            ? `Ce site en http ne peut pas s’afficher dans Melo ouvert en https.${elsewhere}`
            : `Ce site refuse de s’afficher dans une autre application.${elsewhere}`}
        </span>
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => window.open(url, '_blank', 'noopener')} disabled={editing}>
          <Icon name="externalLink" size={14} /> Ouvrir le site
        </button>
      </div>
    );
  }
  return (
    <div className="w-web">
      <iframe
        src={src}
        title={widget.title || url}
        loading="lazy"
        referrerPolicy={player ? 'strict-origin-when-cross-origin' : 'no-referrer'}
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
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
        Tableaux de bord de votre réseau (Jellyfin, Grafana, Home Assistant, routeur…), vidéo YouTube ou Vimeo (collez le lien de la vidéo) : ils
        s’affichent dans le widget. Certains sites (Google, banques…) refusent de s’afficher dans une autre application : Melo propose alors de les
        ouvrir. Dans l’application Melo pour Windows, tous les sites s’affichent.
      </p>
    </>
  );
}
