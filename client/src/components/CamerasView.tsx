import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import { cameraVersion, liveUrl, updateCamerasConfig, useCameras, type Camera, type CameraLink } from '../lib/cameras';
import { LivePlayer, type PlayerState } from '../lib/livePlayer';
import { isNative } from '../lib/settings';
import { reorderItems, useSortable } from '../lib/sortable';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { CameraConfigDialog } from './CameraConfigDialog';
import { t, tx } from '../lib/i18n';

const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

const PHONE = isNative() || Boolean(window.matchMedia?.('(pointer: coarse)').matches);
/**
 * Application en arrière-plan (fenêtre réduite ou cachée par une autre, autre onglet, autre application) : le direct
 * continue ce temps-là, et l'image est là tout de suite au retour. Au-delà, il est coupé pour ménager le réseau, la
 * batterie et le serveur (la dernière image reste affichée jusqu'à la reprise).
 */
const HIDDEN_KEEP_MS = PHONE ? 60_000 : 30 * 60_000;
/** Caméra sortie de l'écran en faisant défiler la page : le direct continue encore ce temps-là. */
const OFFSCREEN_KEEP_MS = 30_000;

/** Vrai quand l'élément est (presque) à l'écran et l'application au premier plan, ou ne l'est plus depuis peu. */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') setPageVisible(true);
      else timer = setTimeout(() => setPageVisible(false), HIDDEN_KEEP_MS);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onChange);
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(timer);
        // Coupure différée : un aller-retour en faisant défiler la page ne relance pas la connexion.
        if (entry.isIntersecting) setInView(true);
        else timer = setTimeout(() => setInView(false), OFFSCREEN_KEEP_MS);
      },
      { rootMargin: '150px' },
    );
    io.observe(el);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, [ref]);
  return inView && pageVisible;
}

/** Image ou flux MJPEG (balise <img>), reconnecté après une erreur. */
function MjpegImage({ url, name, onState }: { url: () => string; name: string; onState: (s: PlayerState, message?: string) => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [attempt, setAttempt] = useState(0);
  // Adresse figée entre deux essais : la renouveler (adresse signée) couperait le flux en cours.
  const src = useMemo(() => `${url()}&_=${attempt}`, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const el = img.current;
    return () => {
      clearTimeout(retry.current);
      // Le navigateur garde le flux ouvert si l'image n'est pas vidée explicitement.
      if (el) el.src = BLANK_IMAGE;
    };
  }, []);
  return (
    <img
      ref={img}
      src={src}
      alt={t('{name} en direct', { name })}
      onLoad={() => onState('playing')}
      onError={() => {
        onState('retrying', t('Image indisponible, nouvel essai…'));
        clearTimeout(retry.current);
        retry.current = setTimeout(() => setAttempt((n) => n + 1), 5_000);
      }}
    />
  );
}

type LiveProps = {
  link: CameraLink | undefined;
  name: string;
  /** Empreinte des réglages de la caméra : le direct redémarre quand elle change. */
  version?: string;
  quality: 'sd' | 'hd';
  /** Faux : direct suspendu (vue plein écran ouverte par-dessus…). */
  active?: boolean;
};

/** Direct d'une caméra : vidéo (MP4 fragmenté) ou image MJPEG, avec l'état de la connexion. */
export function CameraLive({ link, name, version = '', quality, active = true }: LiveProps) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const onScreen = useOnScreen(box);
  const [state, setState] = useState<{ state: PlayerState; message?: string }>({ state: 'connecting' });
  // Une image a déjà été affichée pour ce flux : pendant une reconnexion, elle reste visible avec une simple mention.
  const [shown, setShown] = useState('');
  const url = link ? `${liveUrl(link, quality)}&v=${version}` : '';
  // Adresse signée renouvelée régulièrement : relue à chaque connexion, sans couper le direct en cours.
  const urlRef = useRef(url);
  urlRef.current = url;
  const run = Boolean(url && active && onScreen);
  const kind = link?.kind;
  const stream = `${link?.id}|${quality}|${version}`;

  useEffect(() => {
    if (!run || kind !== 'video' || !video.current) return;
    setState({ state: 'connecting' });
    const player = new LivePlayer(video.current, () => urlRef.current, (s, message) => {
      setState({ state: s, message });
      if (s === 'playing') setShown(stream);
    });
    player.start();
    return () => player.stop();
  }, [run, stream, kind, video]);

  let overlay: string | null = null;
  if (!link) overlay = t('Préparation…');
  else if (!active || !onScreen) overlay = null;
  else if (state.state === 'connecting') overlay = shown === stream ? t('Reconnexion…') : t('Connexion à la caméra…');
  else if (state.state !== 'playing') overlay = state.message ?? t('Vidéo indisponible.');
  // Dernière image affichée : petite mention dans un coin plutôt qu'un voile sur toute l'image.
  const mini = shown === stream && state.state !== 'error';

  return (
    <div ref={box} className="cam-live">
      {kind === 'image' ? (
        run ? (
          <MjpegImage
            key={stream}
            url={() => urlRef.current}
            name={name}
            onState={(s, message) => {
              setState({ state: s, message });
              if (s === 'playing') setShown(stream);
            }}
          />
        ) : null
      ) : (
        <video ref={video} muted playsInline autoPlay disablePictureInPicture aria-label={t('{name} en direct', { name })} />
      )}
      {overlay ? (
        <div className={`cam-overlay${state.state === 'error' ? ' cam-overlay--error' : ''}${mini ? ' cam-overlay--mini' : ''}`}>
          {state.state === 'error' ? <Icon name="alert" size={16} /> : null}
          <span>{overlay}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Une caméra en grand (flux principal), avec passage en plein écran. */
export function CameraModal({ link, camera, onClose, onEdit }: { link: CameraLink | undefined; camera: Camera; onClose: () => void; onEdit?: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const fullscreen = () => {
    const el = stage.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };
  return (
    <Modal title={camera.name} onClose={onClose} width={1280}>
      <div ref={stage} className="cam-stage" onDoubleClick={fullscreen}>
        <CameraLive link={link} name={camera.name} version={cameraVersion(camera)} quality="hd" />
      </div>
      <div className="cam-modal-actions">
        {onEdit ? (
          <button type="button" className="nb-btn nb-btn--sm" onClick={onEdit}>
            <Icon name="settings" size={14} /> {t('Réglages')}
          </button>
        ) : null}
        <button type="button" className="nb-btn nb-btn--sm" onClick={fullscreen}>
          <Icon name="maximize" size={14} /> {t('Plein écran')}
        </button>
      </div>
    </Modal>
  );
}

type PanelProps = {
  doc: Y.Doc | null;
  /** Une seule caméra (bloc d'une page) ; sinon toutes. */
  cameraId?: string;
  compact?: boolean;
  canConfigure?: boolean;
};

/** Grille des caméras en direct (vue « Caméras » et bloc d'une page). */
export function CamerasPanel({ doc, cameraId, compact = false, canConfigure = true }: PanelProps) {
  const { cfg, hasServer, links, ffmpeg, error } = useCameras(doc);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Camera | 'new' | null>(null);
  const cameras = cameraId ? cfg.cameras.filter((c) => c.id === cameraId) : cfg.cameras;
  // Glisser-déposer : ordre des caméras, le même partout (vue Caméras, widget, blocs des pages).
  const { order, itemProps } = useSortable(
    cameras.map((c) => c.id),
    (ids) => doc && updateCamerasConfig(doc, (c) => ({ ...c, cameras: reorderItems(c.cameras, ids) })),
    Boolean(doc && !cameraId),
  );
  const byId = new Map(cameras.map((c) => [c.id, c]));
  const open = openId ? cfg.cameras.find((c) => c.id === openId) ?? null : null;
  const dialog =
    editing && doc ? <CameraConfigDialog doc={doc} camera={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null;

  if (!hasServer) {
    return (
      <div className="nb-notice">
        <p>{t('Les caméras passent par le serveur Melo, qui s’y connecte sur votre réseau local.')}</p>
        <p className="nb-muted">{t('Configurez l’adresse du serveur dans les réglages.')}</p>
      </div>
    );
  }
  if (!cfg.cameras.length) {
    return (
      <div className="nb-notice sh-empty cam-empty">
        <Icon name="cctv" size={28} />
        <p>
          {tx(
            'Ajoutez vos <b>caméras de surveillance</b> (Hikvision, Dahua, Reolink, Tapo, Ezviz… ou toute caméra avec un flux RTSP) pour les regarder en direct ici et dans vos pages.',
            { b: (s) => <b>{s}</b> },
          )}
        </p>
        {canConfigure && doc ? (
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={15} /> {t('Ajouter une caméra')}
          </button>
        ) : null}
        {dialog}
      </div>
    );
  }
  if (cameraId && !cameras.length) {
    return <div className="nb-notice nb-muted">{t('Cette caméra a été supprimée.')}</div>;
  }

  const needsFfmpeg = !ffmpeg && cameras.some((c) => c.brand !== 'image');
  return (
    <div className={`cam-panel${compact ? ' cam-panel--compact' : ''}`}>
      {!cameraId && !compact && canConfigure && doc ? (
        <div className="cam-toolbar">
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} /> {t('Ajouter une caméra')}
          </button>
        </div>
      ) : null}
      {needsFfmpeg ? (
        <div className="nb-error cam-problem">
          <Icon name="alert" size={15} />{' '}
          {t(
            'ffmpeg n’est pas installé sur le serveur Melo : les flux vidéo ne peuvent pas être lus (mettez à jour le serveur Docker, ou installez ffmpeg).',
          )}
        </div>
      ) : null}
      {error ? (
        <div className="nb-error cam-problem">
          <Icon name="alert" size={15} /> {error}
        </div>
      ) : null}
      <div className={`cam-grid${cameras.length === 1 ? ' cam-grid--single' : ''}`}>
        {order
          .map((id) => byId.get(id))
          .filter((c): c is Camera => Boolean(c))
          .map((c) => {
            const sort = itemProps(c.id);
            return (
              <div key={c.id} {...sort} className={`cam-tile${sort.className ? ` ${sort.className}` : ''}`}>
                <button type="button" className="cam-tile-view" onClick={() => setOpenId(c.id)} aria-label={t('Agrandir {name}', { name: c.name })}>
                  <CameraLive link={links.get(c.id)} name={c.name} version={cameraVersion(c)} quality="sd" active={!open} />
                </button>
                <div className="cam-tile-bar">
                  <span className="cam-live-dot" aria-hidden="true" />
                  <span className="cam-tile-name">{c.name}</span>
                  {canConfigure && doc ? (
                    <button
                      type="button"
                      className="nb-icon-btn cam-tile-edit"
                      onClick={() => setEditing(c)}
                      aria-label={t('Réglages de {name}', { name: c.name })}
                    >
                      <Icon name="settings" size={15} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
      </div>
      {open ? (
        <CameraModal
          link={links.get(open.id)}
          camera={open}
          onClose={() => setOpenId(null)}
          onEdit={canConfigure && doc ? () => {
            setOpenId(null);
            setEditing(open);
          } : undefined}
        />
      ) : null}
      {dialog}
    </div>
  );
}

/** Vue « Caméras » (barre latérale). */
export function CamerasView({ doc }: { doc: Y.Doc }) {
  useEffect(() => {
    document.title = t('Caméras – Melo');
  }, []);
  return (
    <div className="nb-page hl-page cam-page">
      <h1 className="nb-page-title-static">
        <Icon name="cctv" size={34} /> {t('Caméras')}
      </h1>
      <CamerasPanel doc={doc} />
    </div>
  );
}
