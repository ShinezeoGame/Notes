// Widget Agenda : prochains événements des agendas de l'espace (liste par jour), ou mois en miniature.
import { useEffect, useMemo, useState } from 'react';
import { useAppCtx } from '../../editor/context';
import { addCalendar, autoRefreshIcs, eventsOnDay, monthDays, upcomingByDay, useAgenda } from '../../lib/agenda';
import { dayKey, formatDay } from '../../lib/ics';
import { navigate } from '../../lib/router';
import { EventLine } from '../../components/AgendaView';
import { Icon } from '../../icons/Icon';
import { num, str, type SettingsProps, type WidgetProps } from '../types';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const keyOf = (d: Date) => dayKey(d.toISOString());

function MiniMonth({ events }: { events: ReturnType<typeof useAgenda>['events'] }) {
  const today = keyOf(new Date());
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const days = useMemo(() => monthDays(month), [month]);
  const byDay = useMemo(() => new Map(days.map((d) => [keyOf(d), eventsOnDay(events, keyOf(d))])), [days, events]);
  const list = byDay.get(selected) ?? eventsOnDay(events, selected);
  const label = monthFmt.format(month);
  return (
    <div className="w-month">
      <div className="w-month-bar">
        <button type="button" className="nb-icon-btn nb-icon-btn--sm" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} aria-label="Mois précédent">
          <Icon name="chevronLeft" size={15} />
        </button>
        <span>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
        <button type="button" className="nb-icon-btn nb-icon-btn--sm" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} aria-label="Mois suivant">
          <Icon name="chevronRight" size={15} />
        </button>
      </div>
      <div className="w-month-grid">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="w-month-wd">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const k = keyOf(d);
          const evs = byDay.get(k) ?? [];
          return (
            <button
              key={k}
              type="button"
              className={`w-month-day${d.getMonth() !== month.getMonth() ? ' w-month-day--out' : ''}${k === today ? ' w-month-day--today' : ''}${k === selected ? ' w-month-day--selected' : ''}`}
              onClick={() => setSelected(k)}
              aria-label={formatDay(d.toISOString())}
            >
              {d.getDate()}
              {evs.length ? <span className="w-month-dot" style={{ background: evs[0].color }} /> : null}
            </button>
          );
        })}
      </div>
      <div className="w-month-events">
        {list.length ? list.map((ev) => <EventLine key={`${ev.id}|${ev.start}`} ev={ev} onDay={selected} />) : <p className="w-muted">Aucun événement ce jour-là.</p>}
      </div>
    </div>
  );
}

export function AgendaWidget({ widget, doc, editing }: WidgetProps) {
  const ctx = useAppCtx();
  const { calendars, events } = useAgenda(doc);
  const days = num(widget.config.days, 14);
  const view = str(widget.config.view, 'list');
  const today = keyOf(new Date());
  const upcoming = useMemo(() => upcomingByDay(events, days), [events, days]);

  useEffect(() => autoRefreshIcs(doc, ctx.fetchIcs), [doc, ctx.fetchIcs]);

  if (!calendars.length) {
    const add = async () => {
      const res = await ctx.importCalendar();
      if (res) addCalendar(doc, res);
    };
    return (
      <div className="w-empty">
        <Icon name="calendar" size={26} />
        <span className="w-muted">Affichez ici vos agendas Google ou iCal.</span>
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => void add()} disabled={editing}>
          Ajouter un agenda
        </button>
      </div>
    );
  }
  if (view === 'month') return <MiniMonth events={events} />;
  return (
    <div className="w-agenda">
      {upcoming.length ? (
        upcoming.map(([k, list]) => (
          <section key={k} className="w-agenda-day">
            <h4>
              {k === today ? 'Aujourd’hui' : formatDay(new Date(`${k}T12:00:00`).toISOString())}
            </h4>
            {list.map((ev) => (
              <EventLine key={`${ev.id}|${ev.start}`} ev={ev} onDay={k} />
            ))}
          </section>
        ))
      ) : (
        <p className="w-muted">Aucun événement dans les {days} prochains jours.</p>
      )}
      <button type="button" className="w-link-btn" onClick={() => navigate('#/agenda')}>
        Ouvrir l’agenda <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );
}

export function AgendaSettings({ config, set }: SettingsProps) {
  return (
    <>
      <label className="nb-field">
        <span>Affichage</span>
        <select className="nb-input" value={str(config.view, 'list')} onChange={(e) => set({ view: e.target.value })}>
          <option value="list">Prochains événements</option>
          <option value="month">Mois</option>
        </select>
      </label>
      {str(config.view, 'list') === 'list' ? (
        <label className="nb-field">
          <span>Période</span>
          <select className="nb-input" value={num(config.days, 14)} onChange={(e) => set({ days: Number(e.target.value) })}>
            <option value={1}>Aujourd’hui</option>
            <option value={7}>7 jours</option>
            <option value={14}>14 jours</option>
            <option value={31}>1 mois</option>
            <option value={92}>3 mois</option>
          </select>
        </label>
      ) : null}
      <p className="nb-muted w-settings-hint">Les agendas se gèrent dans la section Agenda.</p>
    </>
  );
}
