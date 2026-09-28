import { useMemo, useState } from 'react';
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { useAppCtx } from '../context';
import { dayKey, formatDay, formatTimeRange, parseEventsJson, parseIcs, type CalEvent } from '../../lib/ics';
import { fetchGoogleEvents, requestGoogleToken } from '../../lib/google';
import { getSettings } from '../../lib/settings';
import { Icon } from '../../icons/Icon';

const calendarConfig = {
  type: 'calendar',
  propSchema: {
    title: { default: '' },
    events: { default: '[]' },
    source: { default: '' },
    updatedAt: { default: 0 },
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
  const { title, events: eventsJson, source, updatedAt } = block.props;
  const editable = editor.isEditable;
  const events = useMemo(() => parseEventsJson(eventsJson), [eventsJson]);
  const [showPast, setShowPast] = useState(false);
  const [busy, setBusy] = useState(false);

  const todayKey = dayKey(new Date().toISOString());
  const groups = useMemo(() => groupByDay(events), [events]);
  const past = groups.filter(([k]) => k < todayKey);
  const upcoming = groups.filter(([k]) => k >= todayKey);

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
      if (isGoogle) {
        const clientId = getSettings().googleClientId;
        if (!clientId) throw new Error('Renseignez un ID client Google dans les réglages pour actualiser cet agenda.');
        const token = await requestGoogleToken(clientId);
        events = await fetchGoogleEvents(token, source.slice('google:'.length));
      } else {
        const text = await ctx.fetchIcs!(source);
        const parsed = parseIcs(text);
        events = parsed.events;
        name = title || parsed.name;
      }
      apply({ title: name, events, source });
      ctx.notify(`Agenda actualisé : ${events.length} événement(s).`);
    } catch (err) {
      ctx.notify(err instanceof Error ? err.message : 'Actualisation impossible.', 'error');
    } finally {
      setBusy(false);
    }
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
          Importer un agenda Google
        </button>
      </div>
    );
  }

  const renderGroup = ([key, evs]: [string, CalEvent[]]) => (
    <div key={key} className={`nb-cal-day${key === todayKey ? ' nb-cal-day--today' : ''}`}>
      <div className="nb-cal-dayname">
        {formatDay(evs[0].start)}
        {key === todayKey ? <span className="nb-cal-badge">Aujourd’hui</span> : null}
      </div>
      {evs.map((ev) => (
        <div key={ev.id} className="nb-cal-event">
          <div className="nb-cal-time">{formatTimeRange(ev)}</div>
          <div className="nb-cal-body">
            <div className="nb-cal-title">
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
    <div className="nb-calendar" contentEditable={false}>
      <div className="nb-media-toolbar">
        <span className="nb-media-title">
          <Icon name="calendar" size={15} /> {title || 'Agenda'}
          <span className="nb-muted">
            {' '}
            · {events.length} événement{events.length > 1 ? 's' : ''}
            {updatedAt ? ` · mis à jour le ${new Date(updatedAt).toLocaleDateString('fr-FR')}` : ''}
          </span>
        </span>
        <span className="nb-media-actions">
          {canRefresh && editable ? (
            <button type="button" onClick={() => void refresh()} disabled={busy}>
              {busy ? 'Actualisation…' : 'Actualiser'}
            </button>
          ) : null}
          {editable ? (
            <button type="button" onClick={() => void configure()}>
              Modifier
            </button>
          ) : null}
        </span>
      </div>
      <div className="nb-cal-list">
        {past.length ? (
          <button type="button" className="nb-cal-toggle" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Masquer' : 'Afficher'} les événements passés ({past.reduce((n, [, e]) => n + e.length, 0)})
          </button>
        ) : null}
        {showPast ? past.map(renderGroup) : null}
        {upcoming.length ? upcoming.map(renderGroup) : <div className="nb-media-status">Aucun événement à venir.</div>}
      </div>
    </div>
  );
}

export const CalendarBlock = createReactBlockSpec(calendarConfig, {
  render: (props) => <CalendarView {...props} />,
  toExternalHTML: ({ block }) => {
    const events = parseEventsJson(block.props.events);
    return (
      <ul>
        {events.map((ev) => (
          <li key={ev.id}>
            {new Date(ev.start).toLocaleString('fr-FR')} — {ev.title}
          </li>
        ))}
      </ul>
    );
  },
});
