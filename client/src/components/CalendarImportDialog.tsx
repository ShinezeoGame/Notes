import { useMemo, useState, type CSSProperties } from 'react';
import { Modal } from './Modal';
import { useAppCtx, type CalendarImportResult } from '../editor/context';
import { parseIcs, type CalEvent } from '../lib/ics';
import { useSettings } from '../lib/settings';
import {
  calendarName,
  calendarsTitle,
  fetchGoogleEvents,
  googleSource,
  listGoogleCalendars,
  mergeCalendarEvents,
  parseGoogleSource,
  requestGoogleToken,
  type GoogleCalendar,
} from '../lib/google';
import { Icon } from '../icons/Icon';
import { t, tn, tx, locale } from '../lib/i18n';

type Props = {
  initial?: { source?: string; title?: string };
  onClose: () => void;
  onResult: (res: CalendarImportResult) => void;
};

type Tab = 'file' | 'url' | 'google';

type Preview = { name: string; events: CalEvent[]; source: string };

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

export function CalendarImportDialog({ initial, onClose, onResult }: Props) {
  const ctx = useAppCtx();
  const settings = useSettings();
  const initialSource = initial?.source ?? '';
  const initialGoogleIds = parseGoogleSource(initialSource);
  const [tab, setTab] = useState<Tab>(initialSource.startsWith('google:') ? 'google' : initialSource ? 'url' : 'file');
  // Le titre suit l'agenda choisi tant que l'utilisateur ne l'a pas modifié.
  const [title, setTitle] = useState(initial?.title ?? '');
  const [titleEdited, setTitleEdited] = useState(Boolean(initial?.title));
  const [url, setUrl] = useState(initialSource.startsWith('google:') ? '' : initialSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [calEvents, setCalEvents] = useState<Record<string, CalEvent[]>>({});
  const [calStatus, setCalStatus] = useState<Record<string, 'loading' | 'error'>>({});

  const picked = useMemo(() => (calendars ?? []).filter((c) => selected.includes(c.id)), [calendars, selected]);
  const googleLoading = picked.some((c) => calStatus[c.id] === 'loading');
  const googlePreview = useMemo<Preview | null>(() => {
    const parts = picked.filter((c) => calEvents[c.id]).map((c) => ({ cal: c, events: calEvents[c.id] }));
    if (!parts.length) return null;
    const cals = parts.map((p) => p.cal);
    return { name: calendarsTitle(cals), events: mergeCalendarEvents(parts), source: googleSource(cals.map((c) => c.id)) };
  }, [picked, calEvents]);

  const current = tab === 'google' ? googlePreview : preview;
  const shownTitle = titleEdited ? title : (current?.name ?? '');
  const calendarCount = tab === 'google' && googlePreview ? picked.filter((c) => calEvents[c.id]).length : 1;

  const finish = () => {
    if (!current) return;
    onResult({ title: shownTitle.trim() || current.name, events: current.events, source: current.source });
    onClose();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const text = await file.text();
      const parsed = parseIcs(text);
      setPreview({ name: parsed.name, events: parsed.events, source: '' });
    } catch {
      setError(t('Ce fichier n’est pas un calendrier iCal valide.'));
    } finally {
      setBusy(false);
    }
  };

  const fetchUrl = async () => {
    if (!ctx.fetchIcs) {
      setError(t('La récupération d’un lien iCal nécessite un serveur configuré (réglages).'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const text = await ctx.fetchIcs(url.trim());
      const parsed = parseIcs(text);
      setPreview({ name: parsed.name, events: parsed.events, source: url.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Récupération impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const loadCalendar = async (t: string, id: string) => {
    setCalStatus((m) => ({ ...m, [id]: 'loading' }));
    try {
      const events = await fetchGoogleEvents(t, id);
      setCalEvents((m) => ({ ...m, [id]: events }));
      setCalStatus((m) => without(m, id));
    } catch {
      setCalStatus((m) => ({ ...m, [id]: 'error' }));
    }
  };

  const ensureLoaded = (ids: string[]) => {
    if (!token) return;
    for (const id of ids) {
      if (!calEvents[id] && calStatus[id] !== 'loading') void loadCalendar(token, id);
    }
  };

  const connectGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      const t = await requestGoogleToken(settings.googleClientId);
      const list = await listGoogleCalendars(t);
      // Reprend les agendas du bloc modifié, sinon l'agenda principal.
      const previous = initialGoogleIds.filter((id) => list.some((c) => c.id === id));
      const primary = list.filter((c) => c.primary).map((c) => c.id);
      const pick = previous.length ? previous : primary.length ? primary : list.slice(0, 1).map((c) => c.id);
      if (previous.length && initial?.title === calendarsTitle(list.filter((c) => previous.includes(c.id)))) setTitleEdited(false);
      setToken(t);
      setCalendars(list);
      setCalEvents({});
      setCalStatus({});
      setSelected(pick);
      for (const id of pick) void loadCalendar(t, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Connexion Google impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleCalendar = (id: string) => {
    if (selected.includes(id)) {
      setSelected(selected.filter((x) => x !== id));
    } else {
      setSelected([...selected, id]);
      ensureLoaded([id]);
    }
  };

  const allSelected = Boolean(calendars?.length) && calendars!.every((c) => selected.includes(c.id));
  const toggleAll = () => {
    if (!calendars) return;
    if (allSelected) {
      setSelected([]);
      return;
    }
    const ids = calendars.map((c) => c.id);
    setSelected(ids);
    ensureLoaded(ids);
  };

  // Aperçu : les prochains événements plutôt que ceux du mois écoulé.
  const previewEvents = useMemo(() => {
    if (!current) return [];
    const now = new Date().toISOString();
    const upcoming = current.events.filter((ev) => ev.end >= now);
    return (upcoming.length ? upcoming : current.events).slice(0, 5);
  }, [current]);
  const dotted = previewEvents.some((ev) => ev.color);
  const waiting = tab === 'google' && googleLoading;

  return (
    <Modal
      title={t('Importer un agenda Google')}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose}>
            {t('Annuler')}
          </button>
          <button type="button" className="nb-btn nb-btn--primary" disabled={!current || waiting} onClick={finish}>
            {waiting ? t('Chargement…') : current ? tn(current.events.length, 'Insérer ({n} événement)', 'Insérer ({n} événements)') : t('Insérer')}
          </button>
        </>
      }
    >
      <div className="nb-tabs">
        <button type="button" className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>
          {t('Fichier .ics')}
        </button>
        <button type="button" className={tab === 'url' ? 'active' : ''} onClick={() => setTab('url')}>
          {t('Lien iCal (synchronisable)')}
        </button>
        <button type="button" className={tab === 'google' ? 'active' : ''} onClick={() => setTab('google')}>
          {t('Compte Google')}
        </button>
      </div>

      {tab === 'file' ? (
        <div className="nb-tab-panel">
          <p className="nb-muted">
            {tx(
              'Dans Google Agenda (ordinateur) : <b>Paramètres → Importer et exporter → Exporter</b>. Décompressez le fichier .zip puis choisissez le fichier <c>.ics</c> de l’agenda voulu.',
              { b: (s) => <b>{s}</b>, c: (s) => <code>{s}</code> },
            )}
          </p>
          <input type="file" accept=".ics,text/calendar" onChange={(e) => void onFile(e.target.files?.[0])} disabled={busy} />
        </div>
      ) : null}

      {tab === 'url' ? (
        <div className="nb-tab-panel">
          <p className="nb-muted">
            {tx(
              'Dans Google Agenda : <b>Paramètres → votre agenda → Intégrer l’agenda → « Adresse secrète au format iCal »</b>. Collez ce lien : le bloc pourra ensuite être actualisé d’un clic.',
              { b: (s) => <b>{s}</b> },
            )}
          </p>
          <div className="nb-row nb-gap">
            <input
              className="nb-input"
              placeholder={t('https://calendar.google.com/calendar/ical/…/basic.ics')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void fetchUrl()}
            />
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void fetchUrl()} disabled={busy || !url.trim()}>
              {busy ? t('Chargement…') : t('Récupérer')}
            </button>
          </div>
          {!ctx.fetchIcs ? <div className="nb-error">{t('Un serveur est nécessaire pour récupérer un lien iCal (voir réglages).')}</div> : null}
        </div>
      ) : null}

      {tab === 'google' ? (
        <div className="nb-tab-panel">
          {!settings.googleClientId ? (
            <div className="nb-notice">
              <p>
                {tx('Pour se connecter directement à Google, renseignez un <b>ID client OAuth Google</b> dans les réglages.', {
                  b: (s) => <b>{s}</b>,
                })}
              </p>
              <p className="nb-muted">
                {t(
                  'Créez-le sur console.cloud.google.com (API Google Calendar activée, identifiant OAuth de type « Application Web », origine JavaScript autorisée = l’adresse de cette application). En attendant, utilisez l’import .ics ou le lien iCal.',
                )}
              </p>
            </div>
          ) : calendars === null ? (
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void connectGoogle()} disabled={busy}>
              {busy ? t('Connexion…') : t('Se connecter avec Google')}
            </button>
          ) : (
            <>
              <div className="nb-cal-pick-head">
                <span className="nb-muted">
                  {selected.length ? tn(selected.length, '{n} agenda sélectionné', '{n} agendas sélectionnés') : t('Cochez les agendas à afficher')}
                </span>
                {calendars.length > 1 ? (
                  <button type="button" className="nb-cal-toggle" onClick={toggleAll}>
                    {allSelected ? t('Tout désélectionner') : t('Tout sélectionner')}
                  </button>
                ) : null}
              </div>
              <div className="nb-list">
                {calendars.map((c) => {
                  const checked = selected.includes(c.id);
                  const status = calStatus[c.id];
                  const count = calEvents[c.id]?.length;
                  const colors = { '--cal': c.backgroundColor || '#2383E2', '--cal-fg': c.foregroundColor || '#fff' } as CSSProperties;
                  return (
                    <label key={c.id} className="nb-list-item nb-cal-pick">
                      <input type="checkbox" className="nb-sr-only" checked={checked} onChange={() => toggleCalendar(c.id)} />
                      <span className="nb-checkbox" style={colors} aria-hidden="true">
                        {checked ? <Icon name="check" size={13} strokeWidth={3} /> : null}
                      </span>
                      <span className="nb-cal-pick-name">
                        {calendarName(c)}
                        {c.primary ? <span className="nb-muted"> {t('· principal')}</span> : null}
                      </span>
                      <span className={`nb-cal-pick-meta${status === 'error' ? ' nb-cal-pick-meta--error' : ''}`}>
                        {status === 'loading'
                          ? t('Chargement…')
                          : status === 'error'
                            ? t('Lecture impossible')
                            : checked && count !== undefined
                              ? tn(count, '{n} événement', '{n} événements')
                              : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : null}

      {error ? <div className="nb-error">{error}</div> : null}

      {current ? (
        <div className="nb-preview">
          <label className="nb-field">
            <span>{t('Titre du bloc')}</span>
            <input
              className="nb-input"
              value={shownTitle}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleEdited(true);
              }}
            />
          </label>
          <div className="nb-muted">
            {calendarCount > 1
              ? tn(
                  current.events.length,
                  '{n} événement trouvé dans {cals} agendas sur la période (30 jours passés → 12 mois à venir).',
                  '{n} événements trouvés dans {cals} agendas sur la période (30 jours passés → 12 mois à venir).',
                  { cals: calendarCount },
                )
              : tn(
                  current.events.length,
                  '{n} événement trouvé sur la période (30 jours passés → 12 mois à venir).',
                  '{n} événements trouvés sur la période (30 jours passés → 12 mois à venir).',
                )}
          </div>
          <ul className={`nb-preview-list${dotted ? ' nb-preview-list--dots' : ''}`}>
            {previewEvents.map((ev) => (
              <li key={`${ev.id}|${ev.start}`}>
                {dotted ? <span className="nb-cal-dot" style={{ background: ev.color }} title={ev.calendar} /> : null}
                {new Date(ev.start).toLocaleDateString(locale())} · {ev.title}
              </li>
            ))}
            {current.events.length > previewEvents.length ? <li className="nb-muted">…</li> : null}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}
