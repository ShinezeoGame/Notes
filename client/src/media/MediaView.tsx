// Section « Films et séries » : chercher un film ou une série et le demander à Seerr (qui le fait télécharger par Radarr
// ou Sonarr), suivre ses demandes, voir les tendances. Seerr se règle ici la première fois (ajouté au homelab).
import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import type * as Y from 'yjs';
import { api, serverBase } from '../lib/api';
import { navigate } from '../lib/router';
import { newService, readHomelabConfig, saveHomelabConfig, type ServiceType } from '../lib/homelab';
import {
  SEERR_TYPES,
  mediaStateLabel,
  posterUrl,
  refreshRequests,
  seerrLang,
  stateTone,
  typeLabel,
  useMediaSearch,
  useRecentRequests,
  useRequestMedia,
  useSeerr,
  type MediaDetails,
  type MediaItem,
  type MediaRequest,
  type MediaState,
  type MediaType,
  type RequestState,
} from '../lib/seerr';
import { Icon } from '../icons/Icon';
import { Modal } from '../components/Modal';
import { NeedsServerIntro, SectionIntro, hideSection } from '../components/SectionIntro';
import { toast } from '../components/Toast';
import { AppContext } from '../editor/context';
import { t, tn, tServer } from '../lib/i18n';

/** Dernière liste affichée (recherche ou accueil de la section) : retrouvée en fermant une fiche. */
let lastList = '#/films';

export function MediaView({ doc, query, detail }: { doc: Y.Doc; query: string; detail: { type: MediaType; id: number } | null }) {
  const seerr = useSeerr(doc);
  const ctx = useContext(AppContext);
  useEffect(() => {
    document.title = t('Films et séries – Ostal');
  }, []);
  useEffect(() => {
    if (!detail) lastList = query ? `#/films/chercher/${encodeURIComponent(query)}` : '#/films';
  }, [query, detail]);
  const onHide = () => hideSection(doc, 'media');

  let body;
  if (!serverBase()) {
    body = (
      <NeedsServerIntro icon="film" title={t('Films et séries')} need={t('Un serveur Ostal chez vous, sur le même réseau que Seerr : c’est lui qui lui transmet vos demandes.')} onJoin={ctx?.joinServer} onHide={onHide}>
        {t('Cherchez un film ou une série et demandez-le en un geste : Seerr le fait télécharger, puis il apparaît dans Jellyfin ou Plex.')}
      </NeedsServerIntro>
    );
  } else if (!seerr) {
    body = <MediaSetup doc={doc} onHide={onHide} />;
  } else {
    body = <MediaBrowser query={query} seerrUrl={seerr.url} />;
  }
  return (
    <div className="nb-page hl-page md-page">
      <h1 className="nb-page-title-static">
        <Icon name="film" size={34} /> {t('Films et séries')}
      </h1>
      {body}
      {seerr && detail ? <MediaDetailDialog type={detail.type} id={detail.id} onClose={() => navigate(lastList)} /> : null}
    </div>
  );
}

// ---------- Recherche, demandes récentes, tendances ----------

function MediaBrowser({ query, seerrUrl }: { query: string; seerrUrl: string }) {
  const [text, setText] = useState(query);
  const input = useRef<HTMLInputElement>(null);
  // Adresse changée ailleurs (widget, retour arrière) : champ mis à jour.
  useEffect(() => setText(query), [query]);
  useEffect(() => {
    // Ouverte pour chercher (widget, raccourci) : prête à taper. Sur ordinateur, toujours.
    if (query || !window.matchMedia?.('(pointer: coarse)').matches) input.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: string) => {
    setText(v);
    navigate(v.trim() ? `#/films/chercher/${encodeURIComponent(v)}` : '#/films', { replace: true });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    input.current?.blur();
  };
  const search = useMediaSearch(text);
  return (
    <>
      <div className="md-toolbar">
        <form className="md-search" role="search" onSubmit={submit}>
          <Icon name="search" size={18} />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            value={text}
            onChange={(e) => change(e.target.value)}
            placeholder={t('Rechercher un film ou une série…')}
            aria-label={t('Rechercher un film ou une série')}
          />
          {text ? (
            <button type="button" className="nb-icon-btn nb-icon-btn--sm" onClick={() => change('')} aria-label={t('Effacer')}>
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </form>
        {seerrUrl ? (
          <a className="nb-btn nb-btn--sm md-open" href={seerrUrl} target="_blank" rel="noopener noreferrer" title={t('Ouvrir Seerr')}>
            <Icon name="externalLink" size={14} /> {t('Seerr')}
          </a>
        ) : null}
      </div>
      {text.trim().length >= 2 ? (
        <SearchResults results={search.results} error={search.error} busy={search.busy} query={text.trim()} />
      ) : (
        <>
          <RecentRequests />
          <Trending />
        </>
      )}
    </>
  );
}

function SearchResults({ results, error, busy, query }: { results: MediaItem[] | null; error: string; busy: boolean; query: string }) {
  if (error) return <div className="nb-error md-error">{error}</div>;
  if (!results || busy) return <p className="nb-muted md-wait">{t('Recherche…')}</p>;
  if (!results.length) return <p className="nb-muted md-wait">{t('Aucun film ni série trouvé pour « {q} ».', { q: query })}</p>;
  return <MediaGrid items={results} />;
}

function Trending() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.seerrTrending(seerrLang()).then(
      (r) => alive && setItems(r.results),
      (err: unknown) => alive && setError(err instanceof Error ? err.message : t('Seerr ne répond pas.')),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <div className="nb-error md-error">{error}</div>;
  if (!items?.length) return null;
  return (
    <section className="md-section">
      <h2>{t('Tendances')}</h2>
      <MediaGrid items={items} />
    </section>
  );
}

function MediaGrid({ items }: { items: MediaItem[] }) {
  const { send, busy } = useRequestMedia();
  // État après une demande faite ici (sans attendre de relire la recherche).
  const [done, setDone] = useState<Record<string, MediaState>>({});
  const request = async (item: MediaItem) => {
    if (item.mediaType === 'tv') return openDetail(item.mediaType, item.id);
    try {
      await send(item);
      setDone((d) => ({ ...d, [`movie:${item.id}`]: 'processing' }));
      toast(t('Demande envoyée : {title}', { title: item.title }));
    } catch (err) {
      toast(err instanceof Error ? err.message : t('Demande impossible.'));
    }
  };
  return (
    <ul className="md-grid">
      {items.map((item) => {
        const key = `${item.mediaType}:${item.id}`;
        const state = done[key] ?? item.state;
        return (
          <li key={key} className="md-card">
            <button type="button" className="md-card-open" onClick={() => openDetail(item.mediaType, item.id)} aria-label={item.title}>
              <Poster path={item.poster} />
              {state ? <span className={`md-chip md-chip--${stateTone(state)}`}>{mediaStateLabel(state)}</span> : null}
            </button>
            <div className="md-card-text">
              <b title={item.title}>{item.title}</b>
              <span className="nb-muted">
                {[item.year, typeLabel(item.mediaType)].filter(Boolean).join(' · ')}
              </span>
            </div>
            {!state || (item.mediaType === 'tv' && state !== 'available') ? (
              <button type="button" className="nb-btn nb-btn--sm nb-btn--primary md-ask" disabled={busy === key} onClick={() => void request(item)}>
                <Icon name="plus" size={14} /> {busy === key ? t('Envoi…') : t('Demander')}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function openDetail(type: MediaType, id: number) {
  navigate(`#/films/${type === 'movie' ? 'film' : 'serie'}/${id}`);
}

export function Poster({ path, size = 'w342' }: { path: string; size?: 'w92' | 'w185' | 'w342' }) {
  const [failed, setFailed] = useState(false);
  const src = posterUrl(path, size);
  if (!src || failed) {
    return (
      <span className="md-poster md-poster--none">
        <Icon name="film" size={size === 'w92' ? 16 : 28} />
      </span>
    );
  }
  return <img className="md-poster" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function seasonsLabel(r: MediaRequest): string {
  if (r.mediaType !== 'tv' || !r.seasons.length) return '';
  return tn(r.seasons.length, 'Saison {list}', 'Saisons {list}', { list: r.seasons.join(', ') });
}

function RecentRequests() {
  const { list, loaded, error } = useRecentRequests(true);
  if (error && !list.length) return <div className="nb-error md-error">{error}</div>;
  if (!loaded || !list.length) return null;
  return (
    <section className="md-section">
      <h2>{t('Demandes récentes')}</h2>
      <RequestList requests={list.slice(0, 12)} />
    </section>
  );
}

/** Demandes : affiche, titre, saisons, état ; ouvre la fiche. Aussi utilisée par le widget de l'accueil. */
export function RequestList({ requests, compact = false, disabled = false }: { requests: MediaRequest[]; compact?: boolean; disabled?: boolean }) {
  return (
    <ul className={`md-requests${compact ? ' md-requests--compact' : ''}`}>
      {requests.map((r) => (
        <li key={r.id}>
          <button type="button" className="md-request" onClick={() => openDetail(r.mediaType, r.tmdbId)} disabled={disabled}>
            <Poster path={r.poster} size="w92" />
            <span className="md-request-text">
              <b>{r.title || typeLabel(r.mediaType)}</b>
              <span className="nb-muted">{[seasonsLabel(r) || r.year, compact ? '' : r.by].filter(Boolean).join(' · ')}</span>
            </span>
            <StateChip state={r.state} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function StateChip({ state }: { state: MediaState | RequestState }) {
  if (!state) return null;
  return <span className={`md-chip md-chip--inline md-chip--${stateTone(state)}`}>{mediaStateLabel(state)}</span>;
}

// ---------- Fiche d'un film ou d'une série ----------

function MediaDetailDialog({ type, id, onClose }: { type: MediaType; id: number; onClose: () => void }) {
  const [data, setData] = useState<MediaDetails | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<number[] | null>(null);
  const { send, busy } = useRequestMedia();
  const load = () =>
    api.seerrMedia(type, id, seerrLang()).then(
      (d) => {
        setData(d);
        setChosen(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : t('Seerr ne répond pas.')),
    );
  useEffect(() => {
    setData(null);
    setError('');
    void load();
  }, [type, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (data?.seasons ?? []).filter((s) => !s.state).map((s) => s.number);
  const selected = chosen ?? open;
  const toggle = (n: number) => setChosen(selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n].sort((a, b) => a - b));
  const canAsk = data ? (type === 'movie' ? !data.state : selected.length > 0) : false;
  const ask = async () => {
    if (!data) return;
    try {
      await send(data, type === 'tv' ? selected : undefined);
      toast(t('Demande envoyée : {title}', { title: data.title }));
      void refreshRequests();
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t('Demande impossible.'));
    }
  };
  const askLabel =
    type === 'movie'
      ? t('Demander le film')
      : selected.length === open.length && open.length > 1
        ? t('Demander toutes les saisons')
        : tn(selected.length, 'Demander {n} saison', 'Demander {n} saisons');

  return (
    <Modal
      title={data?.title ?? typeLabel(type)}
      onClose={onClose}
      width={620}
      footer={
        data && (canAsk || !data.state) ? (
          <>
            <button type="button" className="nb-btn" onClick={onClose}>
              {t('Fermer')}
            </button>
            <button type="button" className="nb-btn nb-btn--primary" disabled={!canAsk || Boolean(busy)} onClick={() => void ask()}>
              <Icon name="plus" size={15} /> {busy ? t('Envoi…') : askLabel}
            </button>
          </>
        ) : undefined
      }
    >
      {error ? <div className="nb-error">{error}</div> : null}
      {!data && !error ? <p className="nb-muted">{t('Chargement…')}</p> : null}
      {data ? (
        <div className="md-detail">
          <Poster path={data.poster} />
          <div className="md-detail-text">
            <p className="nb-muted md-detail-meta">
              {[data.year, typeLabel(type), data.runtime ? t('{n} min', { n: data.runtime }) : '', data.rating ? `★ ${data.rating.toLocaleString()}` : '', ...data.genres]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {data.state ? <StateChip state={data.state} /> : null}
            {data.overview ? <p className="md-overview">{data.overview}</p> : null}
            {type === 'tv' && data.seasons?.length ? (
              <ul className="md-seasons">
                {data.seasons.map((s) => (
                  <li key={s.number}>
                    <label className="nb-check">
                      <input type="checkbox" disabled={Boolean(s.state)} checked={Boolean(s.state) || selected.includes(s.number)} onChange={() => toggle(s.number)} />
                      <span>
                        {s.name || t('Saison {n}', { n: s.number })}
                        <span className="nb-muted"> · {tn(s.episodes, '{n} épisode', '{n} épisodes')}</span>
                      </span>
                    </label>
                    <StateChip state={s.state} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

// ---------- Réglage de Seerr (ajouté au homelab) ----------

function MediaSetup({ doc, onHide }: { doc: Y.Doc; onHide: () => void }) {
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [type, setType] = useState<ServiceType>('seerr');
  const [busy, setBusy] = useState<'' | 'scan' | 'test'>('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Seerr déjà dans le homelab, sans clé : son adresse est reprise.
  useEffect(() => {
    const known = readHomelabConfig(doc).services.find((s) => SEERR_TYPES.includes(s.type));
    if (known) {
      setUrl(known.url);
      setType(known.type);
    }
  }, [doc]);

  const scan = async () => {
    setBusy('scan');
    setMessage(null);
    try {
      const found = (await api.homelabDiscover()).apps.find((a) => a.kind === 'service' && SEERR_TYPES.includes(a.type));
      if (found) {
        setUrl(found.url);
        setType(found.type as ServiceType);
        setMessage({ ok: true, text: t('Trouvé : {name} ({url}). Ajoutez sa clé API.', { name: found.name, url: found.url }) });
      } else setMessage({ ok: false, text: t('Seerr introuvable sur le réseau : saisissez son adresse (par exemple http://192.168.1.20:5055).') });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t('Recherche impossible.') });
    } finally {
      setBusy('');
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('test');
    setMessage(null);
    const clean = url.trim().replace(/\/+$/, '');
    try {
      const r = await api.seerrTest({ url: clean, apiKey: apiKey.trim(), insecure });
      if (!r.ok) {
        setMessage({ ok: false, text: tServer(r.error ?? '') || t('Seerr ne répond pas.') });
        return;
      }
      const cfg = readHomelabConfig(doc);
      const known = cfg.services.find((s) => SEERR_TYPES.includes(s.type));
      const services = known
        ? cfg.services.map((s) => (s.id === known.id ? { ...s, url: clean, apiKey: apiKey.trim(), insecure } : s))
        : [...cfg.services, { ...newService(type), url: clean, apiKey: apiKey.trim(), insecure }];
      saveHomelabConfig(doc, { ...cfg, services });
      toast(t('Seerr est relié.'));
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t('Seerr ne répond pas.') });
    } finally {
      setBusy('');
    }
  };

  return (
    <SectionIntro
      icon="film"
      title={t('Films et séries')}
      needs={[
        t('Seerr (ou Jellyseerr, Overseerr) installé chez vous, relié à Radarr, Sonarr et Jellyfin ou Plex.'),
        t('Sa clé API : dans Seerr, Paramètres → Général → Clé API.'),
      ]}
      actions={
        <form className="md-setup" onSubmit={save}>
          <label className="nb-field">
            <span>{t('Adresse de Seerr')}</span>
            <span className="md-setup-row">
              <input className="nb-input" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:5055" /* i18n-ignore */ />
              <button type="button" className="nb-btn" onClick={() => void scan()} disabled={Boolean(busy)}>
                <Icon name="radar" size={15} /> {busy === 'scan' ? t('Recherche…') : t('Chercher sur le réseau')}
              </button>
            </span>
          </label>
          <label className="nb-field">
            <span>{t('Clé API')}</span>
            <input className="nb-input" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          {/^https:/i.test(url) ? (
            <label className="nb-check">
              <input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} />
              <span>{t('Ignorer le certificat (certificat auto-signé)')}</span>
            </label>
          ) : null}
          {message ? <div className={message.ok ? 'nb-notice md-setup-msg' : 'nb-error md-setup-msg'}>{message.text}</div> : null}
          <button type="submit" className="nb-btn nb-btn--primary" disabled={Boolean(busy)}>
            <Icon name="check" size={15} /> {busy === 'test' ? t('Vérification…') : t('Relier Seerr')}
          </button>
        </form>
      }
      note={t('Seerr est ajouté à votre homelab. Les demandes sont faites au nom de l’administrateur de Seerr : elles partent tout de suite.')}
      onHide={onHide}
    >
      {t('Cherchez un film ou une série et demandez-le en un geste, ici, depuis l’accueil ou l’écran d’accueil du téléphone : Seerr le fait télécharger, puis il apparaît dans Jellyfin ou Plex.')}
    </SectionIntro>
  );
}
