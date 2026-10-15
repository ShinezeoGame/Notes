// Section « Perso » : documents HTML (feuille de route, fiche…) et sites externes du propriétaire de l'espace, rangés
// dans l'espace (voir lib/perso.ts) et non dans le code d'Ostal. La section n'apparaît dans la navigation qu'une fois
// un premier élément ajouté (adresse #/perso, ou Réglages → Réglages avancés → Espace perso).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type * as Y from 'yjs';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { toast } from './Toast';
import { navigate } from '../lib/router';
import { t } from '../lib/i18n';
import { useFrameState } from '../dashboard/widgets/Media';
import { PrioritiesView } from './PrioritiesView';
import {
  MAX_DOC_BYTES,
  addDoc,
  addSite,
  checkProgress,
  docHtml,
  docState,
  htmlTitle,
  onDocState,
  removeItem,
  renameItem,
  replaceDoc,
  saveField,
  siteUrl,
  useDocHtml,
  usePerso,
  withBridge,
  type FieldValue,
  type PersoItem,
} from '../lib/perso';

type Props = { doc: Y.Doc; itemId: string | null };

/** Fichier HTML choisi, lu en texte ; null (et message) s'il ne convient pas. */
async function readHtmlFile(file: File): Promise<string | null> {
  if (file.size > MAX_DOC_BYTES) {
    toast(t('Document trop lourd ({size} Mo au plus).', { size: MAX_DOC_BYTES / 1024 / 1024 }), 'error');
    return null;
  }
  const text = await file.text();
  if (!/<(html|body|head|div|p|h1|section|table|script|style)\b/i.test(text)) {
    toast(t('Ce fichier n’est pas une page HTML.'), 'error');
    return null;
  }
  return text;
}

/** Bouton « choisir un fichier HTML » (champ de fichier caché). */
function HtmlPicker({
  label,
  icon,
  primary,
  compact,
  onPick,
}: {
  label: string;
  icon: 'upload' | 'refresh';
  primary?: boolean;
  /** Barre d'outils : texte masqué sur un petit écran. */
  compact?: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={`nb-btn nb-btn--sm${primary ? ' nb-btn--primary' : ''}`}
        onClick={() => input.current?.click()}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
      >
        <Icon name={icon} size={15} /> <span className={compact ? 'ps-label' : undefined}>{label}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".html,.htm,text/html"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
    </>
  );
}

/** Ajout d'un site externe, ou nouveau nom d'un élément. */
function ItemDialog({ item, onSave, onClose }: { item?: PersoItem; onSave: (title: string, url: string) => void; onClose: () => void }) {
  const site = !item || item.kind === 'site';
  const [title, setTitle] = useState(item?.title ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [error, setError] = useState('');
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const clean = site ? siteUrl(url) : '';
    if (site && !clean) return setError(t('Adresse invalide : par exemple https://exemple.fr'));
    const name = title.trim() || (clean ? new URL(clean).host : '');
    if (!name) return setError(t('Donnez-lui un nom.'));
    onSave(name.slice(0, 120), clean);
  };
  return (
    <Modal
      title={item ? t('Renommer') : t('Ajouter un site')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose}>
            {t('Annuler')}
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => submit()}>
            {item ? t('Enregistrer') : t('Ajouter')}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        {site ? (
          <label className="nb-field">
            <span>{t('Adresse du site')}</span>
            <input
              className="nb-input"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError('');
              }}
              placeholder={t('https://…')}
              inputMode="url"
              autoFocus={!item}
            />
          </label>
        ) : null}
        <label className="nb-field">
          <span>{t('Nom')}</span>
          <input
            className="nb-input"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError('');
            }}
            placeholder={site ? t('Nom affiché (facultatif)') : ''}
            maxLength={120}
            autoFocus={Boolean(item)}
          />
        </label>
        {error ? <div className="nb-error">{error}</div> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Page intégrée : mails, agenda et tâches classés par urgence. */
const PRIORITIES = 'priorites';

export function PersoView({ doc, itemId }: Props) {
  const items = usePerso(doc);
  if (itemId === PRIORITIES) return <PrioritiesView doc={doc} />;
  const item = itemId ? items.find((i) => i.id === itemId) : undefined;
  if (itemId && item) return <ItemView key={item.id} doc={doc} item={item} />;
  return <PersoList doc={doc} items={items} missing={Boolean(itemId)} />;
}

function PersoList({ doc, items, missing }: { doc: Y.Doc; items: PersoItem[]; missing: boolean }) {
  const [adding, setAdding] = useState(false);
  const pick = async (file: File) => {
    const html = await readHtmlFile(file);
    if (html === null) return;
    const id = addDoc(doc, htmlTitle(html, file.name), html);
    toast(t('Document ajouté à votre espace perso.'));
    navigate(`#/perso/${id}`);
  };
  return (
    <div className="nb-page hl-page ps-page">
      <h1 className="nb-page-title-static">
        <Icon name="user" size={34} /> {t('Perso')}
      </h1>
      <p className="nb-muted ps-intro">
        {t(
          'Vos documents et vos sites, rien qu’à vous : rangés dans votre espace, sur votre serveur, et affichés sur vos seuls appareils. Les cases cochées dans un document sont retenues et suivent sur tous vos appareils.',
        )}
      </p>
      {missing ? <div className="nb-error ps-missing">{t('Cet élément a été supprimé.')}</div> : null}
      <div className="ps-actions">
        <HtmlPicker label={t('Ajouter un document HTML')} icon="upload" primary onPick={(f) => void pick(f)} />
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => setAdding(true)}>
          <Icon name="globe" size={15} /> {t('Ajouter un site')}
        </button>
      </div>
      <div className="pp-grid ps-grid">
        <button type="button" className="pp-card" onClick={() => navigate(`#/perso/${PRIORITIES}`)}>
          <span className="pp-card-icon">
            <Icon name="flag" size={20} />
          </span>
          <span className="pp-card-body">
            <b className="pp-card-title">{t('Priorités')}</b>
            <span className="pp-card-meta">{t('Mails, agenda et tâches classés par urgence')}</span>
          </span>
          <Icon name="chevronRight" size={16} />
        </button>
        {items.map((i) => (
          <ItemCard key={i.id} doc={doc} item={i} />
        ))}
      </div>
      {adding ? (
        <ItemDialog
          onClose={() => setAdding(false)}
          onSave={(title, url) => {
            const id = addSite(doc, title, url);
            setAdding(false);
            navigate(`#/perso/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

function ItemCard({ doc, item }: { doc: Y.Doc; item: PersoItem }) {
  let meta: string;
  if (item.kind === 'site') {
    meta = t('Site externe · {host}', { host: item.url ? new URL(item.url).host : '' });
  } else {
    const progress = checkProgress(docHtml(doc, item.id), docState(doc, item.id));
    meta = progress ? t('Document · {done} / {total} cochées', progress) : t('Document');
  }
  return (
    <button type="button" className="pp-card" onClick={() => navigate(`#/perso/${item.id}`)}>
      <span className="pp-card-icon">
        <Icon name={item.kind === 'site' ? 'globe' : 'file'} size={20} />
      </span>
      <span className="pp-card-body">
        <b className="pp-card-title">{item.title}</b>
        <span className="pp-card-meta">{meta}</span>
      </span>
      <Icon name="chevronRight" size={16} />
    </button>
  );
}

function ItemView({ doc, item }: { doc: Y.Doc; item: PersoItem }) {
  const [renaming, setRenaming] = useState(false);
  const remove = () => {
    if (!confirm(t('Supprimer « {title} » de votre espace perso ?', { title: item.title }))) return;
    removeItem(doc, item.id);
    navigate('#/perso', { replace: true });
    toast(t('Supprimé.'));
  };
  const replace = async (file: File) => {
    const html = await readHtmlFile(file);
    if (html === null) return;
    replaceDoc(doc, item.id, html);
    toast(t('Nouvelle version enregistrée : les cases déjà cochées sont gardées.'));
  };
  return (
    <div className="ps-view">
      <div className="ps-toolbar">
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => navigate('#/perso')} aria-label={t('Retour à Perso')}>
          <Icon name="chevronLeft" size={15} /> {t('Perso')}
        </button>
        <b className="ps-title" title={item.title}>
          {item.title}
        </b>
        {item.kind === 'site' && item.url ? (
          <a
            className="nb-btn nb-btn--sm"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('Ouvrir dans le navigateur')}
            title={t('Ouvrir dans le navigateur')}
          >
            <Icon name="externalLink" size={15} /> <span className="ps-label">{t('Ouvrir dans le navigateur')}</span>
          </a>
        ) : (
          <HtmlPicker label={t('Nouvelle version')} icon="refresh" compact onPick={(f) => void replace(f)} />
        )}
        <button type="button" className="nb-icon-btn" onClick={() => setRenaming(true)} aria-label={t('Renommer')} title={t('Renommer')}>
          <Icon name="pencil" size={16} />
        </button>
        <button type="button" className="nb-icon-btn" onClick={remove} aria-label={t('Supprimer')} title={t('Supprimer')}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      {item.kind === 'site' && item.url ? <SiteFrame url={item.url} title={item.title} /> : <DocFrame doc={doc} item={item} />}
      {renaming ? (
        <ItemDialog
          item={item}
          onClose={() => setRenaming(false)}
          onSave={(title, url) => {
            renameItem(doc, item.id, title, url);
            setRenaming(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Document affiché dans un cadre isolé (sans accès à Ostal : origine opaque). Le script ajouté (withBridge) reçoit les
 * champs enregistrés et renvoie chaque changement, gardé dans l'espace.
 */
function DocFrame({ doc, item }: { doc: Y.Doc; item: PersoItem }) {
  const html = useDocHtml(doc, item.id);
  const srcDoc = useMemo(() => withBridge(html), [html]);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage({ type: 'ostal-doc-state', state: docState(doc, item.id) }, '*');
    // Textes tapés : enregistrés après une courte pause, pas à chaque lettre.
    const pending = new Map<string, number>();
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const data = e.data as { type?: string; id?: unknown; value?: unknown } | null;
      if (data?.type === 'ostal-doc-ready') send();
      else if (data?.type === 'ostal-doc-save' && typeof data.id === 'string' && data.id) {
        const field = data.id;
        const value = data.value;
        if (typeof value !== 'boolean' && typeof value !== 'string') return;
        window.clearTimeout(pending.get(field));
        if (typeof value === 'boolean') saveField(doc, item.id, field, value);
        else pending.set(field, window.setTimeout(() => saveField(doc, item.id, field, value as FieldValue), 400));
      }
    };
    window.addEventListener('message', onMessage);
    // Coché sur un autre appareil : affiché ici aussitôt.
    const stop = onDocState(doc, item.id, send);
    return () => {
      window.removeEventListener('message', onMessage);
      stop();
      pending.forEach((timer) => window.clearTimeout(timer));
    };
  }, [doc, item.id]);

  if (!html) return <div className="ps-blocked nb-muted">{t('Document vide.')}</div>;
  return (
    <iframe
      ref={frame}
      className="ps-frame"
      title={item.title}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
    />
  );
}

/** Site externe dans Ostal ; s'il refuse d'être affiché dans une autre application, un bouton pour l'ouvrir. */
function SiteFrame({ url, title }: { url: string; title: string }) {
  const state = useFrameState(url, false);
  if (state === 'checking') return <div className="ps-frame ps-frame--checking" />;
  if (state !== 'ok') {
    return (
      <div className="ps-blocked">
        <Icon name="globe" size={30} />
        <b>{new URL(url).host}</b>
        <span className="nb-muted">
          {state === 'insecure'
            ? t('Ce site en http ne peut pas s’afficher dans Ostal ouvert en https.')
            : t('Ce site refuse de s’afficher dans une autre application.')}
        </span>
        <a className="nb-btn nb-btn--primary" href={url} target="_blank" rel="noopener noreferrer">
          <Icon name="externalLink" size={15} /> {t('Ouvrir le site')}
        </a>
      </div>
    );
  }
  return (
    <iframe
      className="ps-frame"
      src={url}
      title={title}
      referrerPolicy="no-referrer"
      allow="clipboard-write; fullscreen"
      allowFullScreen
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
    />
  );
}
