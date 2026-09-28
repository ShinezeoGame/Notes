import { useState } from 'react';
import { Modal } from './Modal';
import { useAppCtx, type CalendarImportResult } from '../editor/context';
import { parseIcs, type CalEvent } from '../lib/ics';
import { useSettings } from '../lib/settings';
import { fetchGoogleEvents, listGoogleCalendars, requestGoogleToken, type GoogleCalendar } from '../lib/google';

type Props = {
  initial?: { source?: string; title?: string };
  onClose: () => void;
  onResult: (res: CalendarImportResult) => void;
};

type Tab = 'file' | 'url' | 'google';

export function CalendarImportDialog({ initial, onClose, onResult }: Props) {
  const ctx = useAppCtx();
  const settings = useSettings();
  const initialSource = initial?.source ?? '';
  const [tab, setTab] = useState<Tab>(initialSource.startsWith('google:') ? 'google' : initialSource ? 'url' : 'file');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [url, setUrl] = useState(initialSource.startsWith('google:') ? '' : initialSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ name: string; events: CalEvent[]; source: string } | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const finish = () => {
    if (!preview) return;
    onResult({ title: title.trim() || preview.name, events: preview.events, source: preview.source });
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
      if (!title) setTitle(parsed.name);
    } catch {
      setError('Ce fichier n’est pas un calendrier iCal valide.');
    } finally {
      setBusy(false);
    }
  };

  const fetchUrl = async () => {
    if (!ctx.fetchIcs) {
      setError('La récupération d’un lien iCal nécessite un serveur configuré (réglages).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const text = await ctx.fetchIcs(url.trim());
      const parsed = parseIcs(text);
      setPreview({ name: parsed.name, events: parsed.events, source: url.trim() });
      if (!title) setTitle(parsed.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Récupération impossible.');
    } finally {
      setBusy(false);
    }
  };

  const connectGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      const t = await requestGoogleToken(settings.googleClientId);
      setToken(t);
      setCalendars(await listGoogleCalendars(t));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion Google impossible.');
    } finally {
      setBusy(false);
    }
  };

  const pickCalendar = async (cal: GoogleCalendar) => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const events = await fetchGoogleEvents(token, cal.id);
      setPreview({ name: cal.summary, events, source: `google:${cal.id}` });
      if (!title) setTitle(cal.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lecture de l’agenda impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Importer un agenda Google"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" disabled={!preview} onClick={finish}>
            Insérer {preview ? `(${preview.events.length} événements)` : ''}
          </button>
        </>
      }
    >
      <div className="nb-tabs">
        <button type="button" className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>
          Fichier .ics
        </button>
        <button type="button" className={tab === 'url' ? 'active' : ''} onClick={() => setTab('url')}>
          Lien iCal (synchronisable)
        </button>
        <button type="button" className={tab === 'google' ? 'active' : ''} onClick={() => setTab('google')}>
          Compte Google
        </button>
      </div>

      {tab === 'file' ? (
        <div className="nb-tab-panel">
          <p className="nb-muted">
            Dans Google Agenda (ordinateur) : <b>Paramètres → Importer et exporter → Exporter</b>. Décompressez le fichier .zip puis choisissez le
            fichier <code>.ics</code> de l’agenda voulu.
          </p>
          <input type="file" accept=".ics,text/calendar" onChange={(e) => void onFile(e.target.files?.[0])} disabled={busy} />
        </div>
      ) : null}

      {tab === 'url' ? (
        <div className="nb-tab-panel">
          <p className="nb-muted">
            Dans Google Agenda : <b>Paramètres → votre agenda → Intégrer l’agenda → « Adresse secrète au format iCal »</b>. Collez ce lien : le bloc
            pourra ensuite être actualisé d’un clic.
          </p>
          <div className="nb-row nb-gap">
            <input
              className="nb-input"
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void fetchUrl()}
            />
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void fetchUrl()} disabled={busy || !url.trim()}>
              {busy ? 'Chargement…' : 'Récupérer'}
            </button>
          </div>
          {!ctx.fetchIcs ? <div className="nb-error">Un serveur est nécessaire pour récupérer un lien iCal (voir réglages).</div> : null}
        </div>
      ) : null}

      {tab === 'google' ? (
        <div className="nb-tab-panel">
          {!settings.googleClientId ? (
            <div className="nb-notice">
              <p>Pour se connecter directement à Google, renseignez un <b>ID client OAuth Google</b> dans les réglages.</p>
              <p className="nb-muted">
                Créez-le sur console.cloud.google.com (API Google Calendar activée, identifiant OAuth de type « Application Web », origine
                JavaScript autorisée = l’adresse de cette application). En attendant, utilisez l’import .ics ou le lien iCal.
              </p>
            </div>
          ) : calendars === null ? (
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void connectGoogle()} disabled={busy}>
              {busy ? 'Connexion…' : 'Se connecter avec Google'}
            </button>
          ) : (
            <div className="nb-list">
              {calendars.map((c) => (
                <button key={c.id} type="button" className="nb-list-item" onClick={() => void pickCalendar(c)} disabled={busy}>
                  <span className="nb-dot" style={{ background: c.backgroundColor || '#2383E2' }} />
                  {c.summary}
                  {c.primary ? <span className="nb-muted"> · principal</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {error ? <div className="nb-error">{error}</div> : null}

      {preview ? (
        <div className="nb-preview">
          <label className="nb-field">
            <span>Titre du bloc</span>
            <input className="nb-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="nb-muted">
            {preview.events.length} événement(s) trouvé(s) sur la période (30 jours passés → 12 mois à venir).
          </div>
          <ul className="nb-preview-list">
            {preview.events.slice(0, 5).map((ev) => (
              <li key={ev.id}>
                {new Date(ev.start).toLocaleDateString('fr-FR')} · {ev.title}
              </li>
            ))}
            {preview.events.length > 5 ? <li className="nb-muted">…</li> : null}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}
