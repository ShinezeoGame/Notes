import { useMemo, useState } from 'react';
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { useAppCtx } from '../context';
import { dayKey, formatDay, formatTimeRange, parseEventsJson, parseIcs, type CalEvent } from '../../lib/ics';
import { fetchGoogleCalendarsEvents, parseGoogleSource, requestGoogleToken } from '../../lib/google';
import { getSettings } from '../../lib/settings';
import { addCalendar, useAgenda } from '../../lib/agenda';
import { Icon } from '../../icons/Icon';
import { ResizableFrame, normalizeWidth } from '../resize';
import { t, tn, locale } from '../../lib/i18n';

const calendarConfig = {
  type: 'calendar',
  propSchema: {
    title: { default: '' },
    events: { default: '[]' },
    source: { default: '' },
    updatedAt: { default: 0 },
    width: { default: 100 },
    height: { default: 520 },
  },
  content: 'none',
} as const satisfies BlockConfig;

type Props = ReactCustomBlockRenderProps<typeof calendarConfig>;

function groupByDay(events: CalEvent[]) {
  const groups = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const k = dayKey(ev.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(ev);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function CalendarView({ block, editor }: Props) {
  const ctx = useAppCtx();
  const { title, events: eventsJson, source, updatedAt, width, height } = block.props;
  const editable = editor.isEditable;
  const events = useMemo(() => parseEventsJson(eventsJson), [eventsJson]);
  const [showPast, setShowPast] = useState(false);
  const [busy, setBusy] = useState(false);

  const todayKey = dayKey(new Date().toISOString());
  const groups = useMemo(() => groupByDay(events), [events]);
  const past = groups.filter(([k]) => k < todayKey);
  const upcoming = groups.filter(([k]) => k >= todayKey);
  // Légende et pastilles de couleur quand le bloc réunit plusieurs agendas.
  const legend = useMemo(() => {
    const byName = new Map<string, string>();
    for (const ev of events) if (ev.calendar && !byName.has(ev.calendar)) byName.set(ev.calendar, ev.color || '#2383E2');
    return Array.from(byName, ([name, color]) => ({ name, color }));
  }, [events]);
  const multi = legend.length > 1;

  const apply = (res: { title: string; events: CalEvent[]; source: string }) => {
    editor.updateBlock(block, {
      props: { title: res.title, events: JSON.stringify(res.events), source: res.source, updatedAt: Date.now() },
    });
  };

  const isGoogle = source.startsWith('google:');
  const canRefresh = Boolean(source) && (isGoogle || Boolean(ctx.fetchIcs));

  const refresh = async () => {
    if (!canRefresh) return;
    setBusy(true);
    try {
      let events: CalEvent[];
      let name = title;
      let failed: string[] = [];
      if (isGoogle) {
        const clientId = getSettings().googleClientId;
        if (!clientId) throw new Error(t('Renseignez un ID client Google dans les réglages pour actualiser cet agenda.'));
        const token = await requestGoogleToken(clientId);
        ({ events, failed } = await fetchGoogleCalendarsEvents(token, parseGoogleSource(source)));
      } else {
        const text = await ctx.fetchIcs!(source);
        const parsed = parseIcs(text);
        events = parsed.events;
        name = title || parsed.name;
      }
      apply({ title: name, events, source });
      if (failed.length)
        ctx.notify(
          tn(
            events.length,
            'Agenda actualisé : {n} événement. Lecture impossible : {failed}.',
            'Agenda actualisé : {n} événements. Lecture impossible : {failed}.',
            { failed: failed.join(', ') },
          ),
          'error',
        );
      else ctx.notify(tn(events.length, 'Agenda actualisé : {n} événement.', 'Agenda actualisé : {n} événements.'));
    } catch (err) {
      ctx.notify(err instanceof Error ? err.message : t('Actualisation impossible.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // Section Agenda de l'espace : ce bloc peut y être ajouté (propriétaire seulement).
  const agendaDoc = ctx.mode === 'owner' ? (ctx.workspaceDoc ?? null) : null;
  const agenda = useAgenda(agendaDoc);
  const inAgenda = Boolean(source) && agenda.calendars.some((c) => c.source === source);
  const addToAgenda = () => {
    if (!agendaDoc) return;
    addCalendar(agendaDoc, { title: title || t('Agenda'), events, source });
    ctx.notify(t('Agenda ajouté à la section Agenda (et au widget de l’accueil).'));
  };

  const configure = async () => {
    const res = await ctx.importCalendar({ source, title });
    if (res) apply(res);
  };

  if (events.length === 0) {
    return (
      <div className="nb-file-placeholder" contentEditable={false}>
        <button type="button" className="nb-placeholder-btn" onClick={configure} disabled={!editable}>
          <span className="nb-placeholder-icon">
            <Icon name="calendar" size={20} />
          </span>
          {t('Importer un agenda Google')}
        </button>
      </div>
    );
  }

  const renderGroup = ([key, evs]: [string, CalEvent[]]) => (
    <div key={key} className={`nb-cal-day${key === todayKey ? ' nb-cal-day--today' : ''}`}>
      <div className="nb-cal-dayname">
        {formatDay(evs[0].start)}
        {key === todayKey ? <span className="nb-cal-badge">{t('Aujourd’hui')}</span> : null}
      </div>
      {evs.map((ev) => (
        <div key={`${ev.id}|${ev.start}`} className="nb-cal-event">
          <div className="nb-cal-time">{formatTimeRange(ev)}</div>
          <div className="nb-cal-body">
            <div className="nb-cal-title">
              {multi ? <span className="nb-cal-dot" style={{ background: ev.color || '#2383E2' }} title={ev.calendar} /> : null}
              {ev.url ? (
                <a href={ev.url} target="_blank" rel="noopener noreferrer">
                  {ev.title}
                </a>
              ) : (
                ev.title
              )}
            </div>
            {ev.location ? (
              <div className="nb-cal-loc">
                <Icon name="mapPin" size={13} /> {ev.location}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <ResizableFrame
      editable={editable}
      width={normalizeWidth(width)}
      onWidthCommit={(pct) => editor.updateBlock(block, { props: { width: pct } })}
      height={height}
      minHeight={160}
      maxHeight={2000}
      onHeightCommit={(px) => editor.updateBlock(block, { props: { height: px } })}
      className="nb-calendar"
    >
      {(liveHeight) => (
        <div contentEditable={false}>
          <div className="nb-media-toolbar">
            <span className="nb-media-title">
              <Icon name="calendar" size={15} /> {title || t('Agenda')}
              <span className="nb-muted">
                {' '}
                · {tn(events.length, '{n} événement', '{n} événements')}
                {updatedAt ? ` · ${t('mis à jour le {date}', { date: new Date(updatedAt).toLocaleDateString(locale()) })}` : ''}
              </span>
            </span>
            <span className="nb-media-actions">
              {canRefresh && editable ? (
                <button type="button" onClick={() => void refresh()} disabled={busy}>
                  {busy ? t('Actualisation…') : t('Actualiser')}
                </button>
              ) : null}
              {editable ? (
                <button type="button" onClick={() => void configure()}>
                  {t('Modifier')}
                </button>
              ) : null}
              {agendaDoc && editable && !inAgenda ? (
                <button type="button" onClick={addToAgenda} title={t('Afficher aussi cet agenda dans la section Agenda et sur l’accueil')}>
                  {t('Ajouter à l’Agenda')}
                </button>
              ) : null}
            </span>
          </div>
          {multi ? (
            <div className="nb-cal-legend">
              {legend.map((c) => (
                <span key={c.name} className="nb-cal-legend-item">
                  <span className="nb-cal-dot" style={{ background: c.color }} />
                  {c.name}
                </span>
              ))}
            </div>
          ) : null}
          <div className="nb-cal-list" style={{ maxHeight: liveHeight }}>
            {past.length ? (
              <button type="button" className="nb-cal-toggle" onClick={() => setShowPast((v) => !v)}>
                {showPast
                  ? t('Masquer les événements passés ({n})', { n: past.reduce((n, [, e]) => n + e.length, 0) })
                  : t('Afficher les événements passés ({n})', { n: past.reduce((n, [, e]) => n + e.length, 0) })}
              </button>
            ) : null}
            {showPast ? past.map(renderGroup) : null}
            {upcoming.length ? upcoming.map(renderGroup) : <div className="nb-media-status">{t('Aucun événement à venir.')}</div>}
          </div>
        </div>
      )}
    </ResizableFrame>
  );
}

export const CalendarBlock = createReactBlockSpec(calendarConfig, {
  render: (props) => <CalendarView {...props} />,
  toExternalHTML: ({ block }) => {
    const events = parseEventsJson(block.props.events);
    return (
      <ul>
        {events.map((ev) => (
          <li key={`${ev.id}|${ev.start}`}>
            {new Date(ev.start).toLocaleString(locale())} — {ev.title}
          </li>
        ))}
      </ul>
    );
  },
});
