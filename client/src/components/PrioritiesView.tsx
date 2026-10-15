// « Priorités », en haut de la section Perso : mails (lus par le serveur, voir server/src/mail.js), événements des agendas
// et tâches de l'accueil, classés par urgence (lib/priorities.ts). Une tâche se coche ici ; un mail Gmail s'ouvre dans
// Gmail ; un événement mène à l'agenda.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type * as Y from 'yjs';
import { Icon } from '../icons/Icon';
import { api, type MailState } from '../lib/api';
import { autoRefreshIcs, useAgenda } from '../lib/agenda';
import { formatDay, formatTimeRange } from '../lib/ics';
import { applyWidgetActions, taskLists } from '../lib/phoneWidgets';
import { BUCKETS, prioritize, type Bucket, type Priority } from '../lib/priorities';
import { navigate } from '../lib/router';
import { useAppCtx } from '../editor/context';
import { t, locale, tServer } from '../lib/i18n';

const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : t('Erreur'));
const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' });
const REFRESH_MS = 2 * 60_000;

const BUCKET_LABEL: Record<Bucket, string> = {
  urgent: t('Urgent'),
  today: t('Aujourd’hui'),
  week: t('Cette semaine'),
  later: t('Quand vous pouvez'),
};

/** Listes de tâches de l'accueil, relues à chaque changement de l'espace. */
function useTaskLists(doc: Y.Doc) {
  const [lists, setLists] = useState(() => taskLists(doc));
  useEffect(() => {
    const read = () => setLists(taskLists(doc));
    doc.on('update', read);
    return () => doc.off('update', read);
  }, [doc]);
  return lists;
}

/** Mails lus par le serveur, relus toutes les 2 minutes page ouverte. */
function useMail() {
  const [state, setState] = useState<MailState | null>(null);
  const [error, setError] = useState('');
  const load = (fresh = false) =>
    api.persoMail(fresh).then(
      (s) => {
        setState(s);
        setError('');
      },
      (err) => setError(errorText(err)),
    );
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  return { state, setState, error, reload: () => load(true) };
}

export function Priorities({ doc }: { doc: Y.Doc }) {
  const ctx = useAppCtx();
  const { events } = useAgenda(doc);
  useEffect(() => autoRefreshIcs(doc, ctx.fetchIcs), [doc, ctx.fetchIcs]);
  const lists = useTaskLists(doc);
  const mail = useMail();
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const items = useMemo(() => prioritize({ events, mails: mail.state?.messages ?? [], lists, now }), [events, mail.state, lists, now]);

  const s = mail.state;
  return (
    <>
    <div className="pr-mailbar">
      <Icon name="mail" size={15} />
      {s?.configured ? (
        <>
          <span className="pr-mailbar-text">
            {s.email}
            {s.at ? ` · ${t('relus à {time}', { time: timeFmt.format(new Date(s.at)) })}` : ''}
          </span>
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => setEditing(true)}>
            {t('Modifier')}
          </button>
          <button type="button" className="nb-icon-btn nb-icon-btn--sm" onClick={() => void mail.reload()} aria-label={t('Actualiser')} title={t('Actualiser')}>
            <Icon name="refresh" size={15} />
          </button>
        </>
      ) : (
        <span className="pr-mailbar-text">{s ? t('Messagerie pas encore reliée.') : t('Chargement…')}</span>
      )}
    </div>
    {mail.error || s?.error ? <div className="nb-error pr-error">{mail.error || tServer(s?.error ?? '')}</div> : null}
    {s && (!s.configured || editing) ? (
      <MailForm
        current={s}
        onDone={(next) => {
          mail.setState(next);
          setEditing(false);
        }}
        onCancel={s.configured ? () => setEditing(false) : undefined}
      />
    ) : null}
    {items.length ? (
      <div className="pr-columns">
        {BUCKETS.map((bucket) => {
          const list = items.filter((i) => i.bucket === bucket);
          if (!list.length) return null;
          return (
            <section key={bucket} className={`pr-bucket pr-bucket--${bucket}`}>
              <h2>
                {BUCKET_LABEL[bucket]} <span className="pr-count">{list.length}</span>
              </h2>
              <ul className="pr-list">
                {list.map((p) => (
                  <PriorityRow key={p.key} doc={doc} p={p} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    ) : (
      <p className="nb-muted">{t('Rien à traiter pour l’instant.')}</p>
    )}
    </>
  );
}

function PriorityRow({ doc, p }: { doc: Y.Doc; p: Priority }) {
  if (p.kind === 'task') {
    return (
      <li className="pr-item">
        <button
          type="button"
          className="pr-check"
          onClick={() => applyWidgetActions(doc, [{ type: 'done', list: p.list.id, task: p.task.id, done: true, at: Date.now() }])}
          aria-label={t('Marquer « {task} » comme faite', { task: p.task.text })}
          title={t('Fait')}
        >
          <Icon name="check" size={13} />
        </button>
        <span className="pr-body">
          <span className="pr-title">{p.task.text}</span>
          <span className="pr-meta">{p.list.title || t('Tâches')}</span>
        </span>
      </li>
    );
  }
  if (p.kind === 'event') {
    const ev = p.event;
    return (
      <li className="pr-item">
        <button type="button" className="pr-row" onClick={() => navigate('#/agenda')}>
          <Icon name="calendar" size={16} />
          <span className="pr-body">
            <span className="pr-title">{ev.title}</span>
            <span className="pr-meta">
              {formatDay(ev.start)} · {formatTimeRange(ev)}
              {ev.calendar ? ` · ${ev.calendar}` : ''}
            </span>
          </span>
        </button>
      </li>
    );
  }
  const m = p.mail;
  const date = new Date(m.date);
  const when = date.toDateString() === new Date().toDateString() ? timeFmt.format(date) : dayFmt.format(date);
  const body = (
    <>
      <Icon name={m.flagged ? 'star' : 'mail'} size={16} />
      <span className="pr-body">
        <span className={`pr-title${m.unread ? ' pr-title--unread' : ''}`}>{m.subject || t('(sans objet)')}</span>
        <span className="pr-meta">
          {m.from} · {when}
        </span>
      </span>
    </>
  );
  return (
    <li className="pr-item">
      {m.link ? (
        <a className="pr-row" href={m.link} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      ) : (
        <span className="pr-row">{body}</span>
      )}
    </li>
  );
}

/** Relier la messagerie : adresse, mot de passe d'application, serveur IMAP (deviné s'il est laissé vide). */
function MailForm({ current, onDone, onCancel }: { current: MailState; onDone: (s: MailState) => void; onCancel?: () => void }) {
  const [email, setEmail] = useState(current.email ?? '');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState(current.host ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await api.savePersoMail({ email, password, host }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(t('Ne plus lire vos mails ici ? Les identifiants sont effacés du serveur.'))) return;
    onDone(await api.removePersoMail());
  };
  return (
    <form className="pr-form" onSubmit={(e) => void submit(e)}>
      <p className="nb-muted">
        {t(
          'Votre serveur Ostal lit votre boîte de réception (sans rien modifier ni marquer comme lu). Gmail : créez un mot de passe d’application (compte Google → Sécurité → Validation en deux étapes → Mots de passe des applications) et collez-le ici.',
        )}{' '}
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">
          {t('Créer un mot de passe d’application Google')}
        </a>
      </p>
      <label className="nb-field">
        <span>{t('Adresse e-mail')}</span>
        <input className="nb-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
      </label>
      <label className="nb-field">
        <span>{current.configured ? t('Mot de passe d’application (vide : inchangé)') : t('Mot de passe d’application')}</span>
        <input className="nb-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="nb-field">
        <span>{t('Serveur IMAP (facultatif, deviné d’après l’adresse)')}</span>
        <input className="nb-input" value={host} onChange={(e) => setHost(e.target.value)} placeholder={t('imap.gmail.com')} />
      </label>
      {error ? <div className="nb-error">{error}</div> : null}
      <div className="nb-row nb-gap">
        <button type="submit" className="nb-btn nb-btn--primary" disabled={busy || !email.trim()}>
          {busy ? t('Connexion…') : t('Relier')}
        </button>
        {onCancel ? (
          <button type="button" className="nb-btn" onClick={onCancel}>
            {t('Annuler')}
          </button>
        ) : null}
        {current.configured ? (
          <button type="button" className="nb-btn nb-btn--danger" onClick={() => void remove()}>
            {t('Ne plus lire mes mails')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
