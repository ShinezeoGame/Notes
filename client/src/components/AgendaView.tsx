// Section Agenda : agendas Google ou iCal de l'espace, vue du mois (avec le détail du jour choisi) ou liste des
// prochains événements, gestion des agendas (couleur, masquer, actualiser, retirer).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type * as Y from 'yjs';
import { useAppCtx } from '../editor/context';
import {
  CALENDAR_COLORS,
  addCalendar,
  autoRefreshIcs,
  eventsOnDay,
  isGoogleSource,
  monthDays,
  refreshCalendar,
  removeCalendar,
  upcomingByDay,
  updateCalendars,
  useAgenda,
  type AgendaCalendar,
  type AgendaEvent,
} from '../lib/agenda';
import { dayKey, formatDay, formatTimeRange } from '../lib/ics';
import { Icon } from '../icons/Icon';
import { SectionIntro, hideSection } from './SectionIntro';
import { t, tn, tx, locale } from '../lib/i18n';

const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const monthFmt = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' });
const keyOf = (d: Date) => dayKey(d.toISOString());
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function EventLine({ ev, onDay }: { ev: AgendaEvent; onDay?: string }) {
  const startsBefore = onDay && dayKey(ev.start) < onDay;
  return (
    <div className="ag-event">
      <span className="ag-event-bar" style={{ background: ev.color }} />
      <div className="ag-event-body">
        <div className="ag-event-title">
          {ev.url ? (
            <a href={ev.url} target="_blank" rel="noopener noreferrer">
              {ev.title}
            </a>
          ) : (
            ev.title
          )}
        </div>
        <div className="ag-event-meta">
          {startsBefore && !ev.allDay ? t('Jusqu’à {time}', { time: timeFmt.format(new Date(ev.end)) }) : formatTimeRange(ev)}
          {ev.calendar ? <span className="ag-event-cal"> · {ev.calendar}</span> : null}
        </div>
        {ev.location ? (
          <div className="ag-event-meta">
            <Icon name="mapPin" size={12} /> {ev.location}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CalendarRow({ cal, busy, onRefresh, doc }: { cal: AgendaCalendar; busy: boolean; onRefresh: () => void; doc: Y.Doc }) {
  const [colors, setColors] = useState(false);
  const set = (patch: Partial<AgendaCalendar>) => updateCalendars(doc, (list) => list.map((c) => (c.id === cal.id ? { ...c, ...patch } : c)));
  return (
    <div className={`ag-cal${cal.enabled ? '' : ' ag-cal--off'}`}>
      <button
        type="button"
        className="ag-cal-dot"
        style={{ background: cal.color }}
        onClick={() => setColors((v) => !v)}
        aria-label={t('Couleur de {name}', { name: cal.name })}
      />
      <span className="ag-cal-name" title={cal.name}>
        {cal.name}
      </span>
      <button
        type="button"
        className="nb-icon-btn nb-icon-btn--sm"
        onClick={() => set({ enabled: !cal.enabled })}
        title={cal.enabled ? t('Masquer') : t('Afficher')}
      >
        <Icon name={cal.enabled ? 'eye' : 'eyeOff'} size={15} />
      </button>
      <button
        type="button"
        className="nb-icon-btn nb-icon-btn--sm"
        onClick={onRefresh}
        disabled={busy || !cal.source}
        title={cal.source ? t('Actualiser') : t('Importé d’un fichier : pas d’actualisation')}
      >
        <Icon name="refresh" size={15} />
      </button>
      <button
        type="button"
        className="nb-icon-btn nb-icon-btn--sm"
        onClick={() => confirm(t('Retirer l’agenda « {name} » ?', { name: cal.name })) && removeCalendar(doc, cal.id)}
        title={t('Retirer')}
      >
        <Icon name="trash" size={15} />
      </button>
      {colors ? (
        <div className="ag-cal-colors">
          {CALENDAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="ag-cal-dot"
              style={{ background: c }}
              onClick={() => {
                set({ color: c });
                setColors(false);
              }}
              aria-label={c}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AgendaView({ doc }: { doc: Y.Doc }) {
  const ctx = useAppCtx();
  const { calendars, events } = useAgenda(doc);
  const [view, setView] = useState<'month' | 'list'>(() => (window.matchMedia?.('(max-width: 640px)').matches ? 'list' : 'month'));
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const today = keyOf(new Date());
  const [selected, setSelected] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Agenda – Ostal';
    autoRefreshIcs(doc, ctx.fetchIcs);
  }, [doc, ctx.fetchIcs]);

  const days = useMemo(() => monthDays(month), [month]);
  const byDay = useMemo(() => new Map(days.map((d) => [keyOf(d), eventsOnDay(events, keyOf(d))])), [days, events]);
  const selectedEvents = useMemo(() => byDay.get(selected) ?? eventsOnDay(events, selected), [byDay, events, selected]);
  const upcoming = useMemo(() => upcomingByDay(events, 365), [events]);

  const refresh = async (list: AgendaCalendar[]) => {
    for (const cal of list) {
      setBusy(cal.id);
      try {
        const { count, failed } = await refreshCalendar(doc, cal, ctx.fetchIcs);
        ctx.notify(
          failed.length
            ? tn(count, '« {name} » : {n} événement ; illisibles : {failed}.', '« {name} » : {n} événements ; illisibles : {failed}.', {
                name: cal.name,
                failed: failed.join(', '),
              })
            : tn(count, '« {name} » : {n} événement.', '« {name} » : {n} événements.', { name: cal.name }),
          failed.length ? 'error' : 'info',
        );
      } catch (err) {
        ctx.notify(
          t('« {name} » : {error}', { name: cal.name, error: err instanceof Error ? err.message : t('Actualisation impossible.') }),
          'error',
        );
      }
    }
    setBusy(null);
  };

  const add = async () => {
    const res = await ctx.importCalendar();
    if (res) {
      addCalendar(doc, res);
      ctx.notify(
        tn(res.events.length, 'Agenda « {name} » ajouté ({n} événement).', 'Agenda « {name} » ajouté ({n} événements).', {
          name: res.title || t('Agenda'),
        }),
      );
    }
  };

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const goToday = () => {
    setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    setSelected(today);
  };

  if (!calendars.length) {
    return (
      <div className="nb-page ag-page">
        <h1 className="nb-page-title-static">
          <Icon name="calendar" size={34} /> {t('Agenda')}
        </h1>
        <SectionIntro
          icon="calendar"
          title={t('Tous vos agendas au même endroit')}
          needs={[t('Un agenda Google, Outlook, Apple, de l’école ou du travail : son adresse iCal, votre compte Google, ou un fichier .ics.')]}
          actions={
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void add()}>
              <Icon name="plus" size={15} /> {t('Ajouter un agenda')}
            </button>
          }
          onHide={() => hideSection(doc, 'agenda')}
        >
          {tx(
            'Réunissez vos agendas <b>Google</b> et vos adresses <b>iCal</b> (Outlook, Apple, école, travail…) : vue du mois, prochains événements, et widget sur l’accueil.',
            { b: (s) => <b>{s}</b> },
          )}
        </SectionIntro>
      </div>
    );
  }

  return (
    <div className="nb-page ag-page">
      <div className="ag-head">
        <h1 className="nb-page-title-static">
          <Icon name="calendar" size={34} /> {t('Agenda')}
        </h1>
        <div className="ag-toolbar">
          <div className="ag-seg" role="tablist" aria-label={t('Affichage')}>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'month'}
              className={view === 'month' ? 'ag-seg--on' : ''}
              onClick={() => setView('month')}
            >
              {t('Mois')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'list'}
              className={view === 'list' ? 'ag-seg--on' : ''}
              onClick={() => setView('list')}
            >
              {t('Liste')}
            </button>
          </div>
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => void refresh(calendars.filter((c) => c.enabled && c.source))} disabled={Boolean(busy)}>
            <Icon name="refresh" size={14} /> {busy ? t('Actualisation…') : t('Actualiser')}
          </button>
          <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={() => void add()}>
            <Icon name="plus" size={14} /> {t('Ajouter un agenda')}
          </button>
        </div>
      </div>

      <div className="ag-layout">
        <div className="ag-main">
          {view === 'month' ? (
            <>
              <div className="ag-monthbar">
                <button type="button" className="nb-icon-btn" onClick={() => shift(-1)} aria-label={t('Mois précédent')}>
                  <Icon name="chevronLeft" size={18} />
                </button>
                <h2 className="ag-month">{capitalize(monthFmt.format(month))}</h2>
                <button type="button" className="nb-icon-btn" onClick={() => shift(1)} aria-label={t('Mois suivant')}>
                  <Icon name="chevronRight" size={18} />
                </button>
                <button type="button" className="nb-btn nb-btn--sm" onClick={goToday}>
                  {t('Aujourd’hui')}
                </button>
              </div>
              <div className="ag-grid" role="grid" aria-label={t('Mois')}>
                {WEEKDAYS.map((w) => (
                  <div key={w} className="ag-weekday">
                    {w}
                  </div>
                ))}
                {days.map((d) => {
                  const k = keyOf(d);
                  const list = byDay.get(k) ?? [];
                  const cls = [
                    'ag-day',
                    d.getMonth() !== month.getMonth() ? 'ag-day--out' : '',
                    k === today ? 'ag-day--today' : '',
                    k === selected ? 'ag-day--selected' : '',
                  ].join(' ');
                  return (
                    <button key={k} type="button" className={cls} onClick={() => setSelected(k)} aria-label={formatDay(d.toISOString())}>
                      <span className="ag-daynum">{d.getDate()}</span>
                      <span className="ag-chips">
                        {list.slice(0, 3).map((ev) => (
                          <span key={`${ev.id}|${ev.start}`} className="ag-chip" style={{ '--c': ev.color } as CSSProperties}>
                            {ev.allDay ? '' : `${timeFmt.format(new Date(ev.start))} `}
                            {ev.title}
                          </span>
                        ))}
                        {list.length > 3 ? <span className="ag-more">+{list.length - 3}</span> : null}
                      </span>
                      {list.length ? (
                        <span className="ag-dots" aria-hidden="true">
                          {list.slice(0, 4).map((ev) => (
                            <span key={`${ev.id}|${ev.start}`} style={{ background: ev.color }} />
                          ))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <section className="ag-dayview">
                <h3>{formatDay(new Date(`${selected}T12:00:00`).toISOString())}</h3>
                {selectedEvents.length ? (
                  selectedEvents.map((ev) => <EventLine key={`${ev.id}|${ev.start}`} ev={ev} onDay={selected} />)
                ) : (
                  <p className="nb-muted">{t('Aucun événement.')}</p>
                )}
              </section>
            </>
          ) : (
            <div className="ag-list">
              {upcoming.length ? (
                upcoming.map(([k, list]) => (
                  <section key={k} className={`ag-listday${k === today ? ' ag-listday--today' : ''}`}>
                    <h3>
                      {formatDay(new Date(`${k}T12:00:00`).toISOString())}
                      {k === today ? <span className="nb-cal-badge">{t('Aujourd’hui')}</span> : null}
                    </h3>
                    {list.map((ev) => (
                      <EventLine key={`${ev.id}|${ev.start}`} ev={ev} onDay={k} />
                    ))}
                  </section>
                ))
              ) : (
                <p className="nb-muted">{t('Aucun événement à venir.')}</p>
              )}
            </div>
          )}
        </div>
        <aside className="ag-side">
          <h3>{t('Agendas')}</h3>
          {calendars.map((cal) => (
            <CalendarRow key={cal.id} cal={cal} doc={doc} busy={busy === cal.id} onRefresh={() => void refresh([cal])} />
          ))}
          {calendars.some((c) => isGoogleSource(c.source)) ? (
            <p className="nb-muted ag-hint">{t('Agendas Google : « Actualiser » ouvre la connexion à votre compte Google.')}</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
