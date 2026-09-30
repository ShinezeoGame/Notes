// Widget Raccourcis : liens vers des sites ou des pages de notes, en tuiles (icône du site) ou en liste.
import { useState } from 'react';
import { useAppCtx } from '../../editor/context';
import { newId } from '../../lib/ids';
import { useWorkspacePages } from '../../lib/workspace';
import { Icon } from '../../icons/Icon';
import { PageIcon } from '../../icons/pageIcon';
import { pageOptions } from './Page';
import { str, type SettingsProps, type WidgetProps } from '../types';

/** Lien : adresse web, ou page de notes (« page:<id> »). */
type Link = { id: string; label: string; url: string };

function linksOf(v: unknown): Link[] {
  return Array.isArray(v) ? v.filter((l): l is Link => l && typeof l.url === 'string').map((l) => ({ id: String(l.id || newId()), label: String(l.label ?? ''), url: l.url })) : [];
}

/** Adresse complétée (« exemple.fr » → « https://exemple.fr »). */
function fullUrl(url: string): string {
  const u = url.trim();
  if (!u || /^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return `https://${u}`;
}

function hostOf(url: string): string {
  try {
    return new URL(fullUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Icône du site (favicon), remplacée par sa première lettre si elle ne se charge pas. */
function SiteIcon({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);
  let src = '';
  try {
    const u = new URL(fullUrl(url));
    if (/^https?:$/.test(u.protocol)) src = `${u.origin}/favicon.ico`;
  } catch {
    /* adresse invalide */
  }
  if (!src || failed) return <span className="w-link-letter">{(label || hostOf(url)).charAt(0).toUpperCase()}</span>;
  return <img className="w-link-favicon" src={src} alt="" onError={() => setFailed(true)} loading="lazy" referrerPolicy="no-referrer" />;
}

export function LinksWidget({ widget, store, openSettings, editing }: WidgetProps) {
  useWorkspacePages(store);
  const ctx = useAppCtx();
  const links = linksOf(widget.config.links);
  const list = str(widget.config.style) === 'list';
  if (!links.length) {
    return (
      <div className="w-empty">
        <Icon name="link" size={24} />
        <button type="button" className="nb-btn nb-btn--sm" onClick={openSettings} disabled={editing}>
          Ajouter des raccourcis
        </button>
      </div>
    );
  }
  return (
    <div className={list ? 'w-links-list' : 'w-links'}>
      {links.map((l) => {
        if (l.url.startsWith('page:')) {
          const page = store.get(l.url.slice(5));
          const label = l.label || page?.title || 'Page supprimée';
          return (
            <button key={l.id} type="button" className="w-link" onClick={() => page && ctx.openPage(page.id)} title={label}>
              <span className="w-link-icon">
                <PageIcon icon={page?.icon ?? ''} size={list ? 18 : 24} />
              </span>
              <span className="w-link-label">{label}</span>
            </button>
          );
        }
        const label = l.label || hostOf(l.url);
        return (
          <a key={l.id} className="w-link" href={fullUrl(l.url)} target="_blank" rel="noopener noreferrer" title={`${label} (${hostOf(l.url)})`}>
            <span className="w-link-icon">
              <SiteIcon url={l.url} label={label} />
            </span>
            <span className="w-link-label">{label}</span>
          </a>
        );
      })}
    </div>
  );
}

export function LinksSettings({ config, set, store }: SettingsProps) {
  useWorkspacePages(store);
  const links = linksOf(config.links);
  const update = (next: Link[]) => set({ links: next });
  const pages = pageOptions(store);
  return (
    <>
      <label className="nb-field">
        <span>Affichage</span>
        <select className="nb-input" value={str(config.style, 'tiles')} onChange={(e) => set({ style: e.target.value })}>
          <option value="tiles">Tuiles</option>
          <option value="list">Liste</option>
        </select>
      </label>
      <div className="nb-field">
        <span>Raccourcis</span>
        {links.map((l, i) => (
          <div key={l.id} className="w-links-row">
            <input
              className="nb-input"
              value={l.label}
              placeholder="Nom"
              aria-label="Nom du raccourci"
              onChange={(e) => update(links.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)))}
            />
            {l.url.startsWith('page:') ? (
              <select
                className="nb-input"
                value={l.url.slice(5)}
                aria-label="Page"
                onChange={(e) => update(links.map((x) => (x.id === l.id ? { ...x, url: `page:${e.target.value}` } : x)))}
              >
                {pages.map((o) => (
                  <option key={o.id} value={o.id}>
                    {'  '.repeat(o.depth)}
                    {o.title}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="nb-input"
                value={l.url}
                placeholder="exemple.fr"
                aria-label="Adresse"
                inputMode="url"
                onChange={(e) => update(links.map((x) => (x.id === l.id ? { ...x, url: e.target.value } : x)))}
              />
            )}
            <button type="button" className="nb-icon-btn" disabled={i === 0} onClick={() => update([...links.slice(0, i - 1), l, links[i - 1], ...links.slice(i + 1)])} aria-label="Monter">
              <Icon name="arrowUp" size={15} />
            </button>
            <button type="button" className="nb-icon-btn" onClick={() => update(links.filter((x) => x.id !== l.id))} aria-label="Supprimer">
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
        <div className="nb-row nb-gap">
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => update([...links, { id: newId(), label: '', url: '' }])}>
            <Icon name="plus" size={14} /> Site web
          </button>
          {pages.length ? (
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => update([...links, { id: newId(), label: '', url: `page:${pages[0].id}` }])}>
              <Icon name="plus" size={14} /> Page de notes
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
