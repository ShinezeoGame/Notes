// Widget Tâches : liste de choses à faire (cocher, modifier, supprimer, glisser pour changer l'ordre), partagée entre
// les appareils. Chaque tâche est une entrée à part du document de l'espace : deux appareils peuvent cocher ou ajouter
// en même temps.
import { useEffect, useMemo, useState } from 'react';
import { newId } from '../../lib/ids';
import { useSortable, type SortItemProps } from '../../lib/sortable';
import { Icon } from '../../icons/Icon';
import { taskMap } from '../model';
import { bool, type SettingsProps, type WidgetProps } from '../types';

type Task = { id: string; text: string; done: boolean; order: number; doneAt: number };

function readTasks(map: ReturnType<typeof taskMap>): Task[] {
  const list: Task[] = [];
  map.forEach((raw, id) => {
    try {
      const t = JSON.parse(raw) as Partial<Task>;
      list.push({ id, text: String(t.text ?? ''), done: Boolean(t.done), order: Number(t.order) || 0, doneAt: Number(t.doneAt) || 0 });
    } catch {
      /* entrée illisible ignorée */
    }
  });
  return list;
}

export function TasksWidget({ widget, doc, editing }: WidgetProps) {
  const map = taskMap(doc, widget.id);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const hideDone = bool(widget.config.hideDone);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    map.observe(bump);
    return () => map.unobserve(bump);
  }, [map]);

  const tasks = useMemo(() => readTasks(map), [map, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const todo = tasks.filter((t) => !t.done).sort((a, b) => a.order - b.order);
  const done = tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
  const save = (t: Task) => map.set(t.id, JSON.stringify({ text: t.text, done: t.done, order: t.order, doneAt: t.doneAt }));
  // Tâches à faire : glisser une tâche la déplace dans la liste.
  const sortable = useSortable(
    todo.map((t) => t.id),
    (ids) =>
      doc.transact(() => {
        ids.forEach((id, i) => {
          const t = todo.find((x) => x.id === id);
          if (t && t.order !== i + 1) save({ ...t, order: i + 1 });
        });
      }),
    !editing && editId === null,
  );
  const todoById = new Map(todo.map((t) => [t.id, t]));

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const order = tasks.reduce((m, t) => Math.max(m, t.order), 0) + 1;
    save({ id: newId(), text, done: false, order, doneAt: 0 });
    setDraft('');
  };

  const row = (t: Task, sort?: SortItemProps) => (
    <li key={t.id} {...sort} className={`w-task${t.done ? ' w-task--done' : ''}${sort?.className ? ` ${sort.className}` : ''}`}>
      <button
        type="button"
        className="w-task-check"
        role="checkbox"
        aria-checked={t.done}
        aria-label={t.done ? `Marquer « ${t.text} » à faire` : `Marquer « ${t.text} » faite`}
        onClick={() => save({ ...t, done: !t.done, doneAt: t.done ? 0 : Date.now() })}
      >
        {t.done ? <Icon name="check" size={13} strokeWidth={2.6} /> : null}
      </button>
      {editId === t.id ? (
        <input
          className="w-task-edit"
          defaultValue={t.text}
          autoFocus
          onBlur={(e) => {
            const text = e.currentTarget.value.trim();
            if (text && text !== t.text) save({ ...t, text });
            setEditId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditId(null);
          }}
        />
      ) : (
        <span className="w-task-text" onDoubleClick={() => setEditId(t.id)}>
          {t.text}
        </span>
      )}
      <span className="w-task-actions">
        <button type="button" className="nb-icon-btn nb-icon-btn--sm" onClick={() => setEditId(t.id)} aria-label={`Modifier « ${t.text} »`}>
          <Icon name="pencil" size={13} />
        </button>
        <button type="button" className="nb-icon-btn nb-icon-btn--sm" onClick={() => map.delete(t.id)} aria-label={`Supprimer « ${t.text} »`}>
          <Icon name="close" size={14} />
        </button>
      </span>
    </li>
  );

  return (
    <div className="w-tasks">
      <form
        className="w-task-new"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Icon name="plus" size={15} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajouter une tâche…" aria-label="Nouvelle tâche" enterKeyHint="done" />
      </form>
      <ul className="w-task-list">
        {sortable.order.map((id) => {
          const t = todoById.get(id);
          return t ? row(t, sortable.itemProps(id)) : null;
        })}
        {!hideDone ? done.map((t) => row(t)) : null}
      </ul>
      {!tasks.length ? <p className="w-muted w-tasks-empty">Rien à faire pour l’instant.</p> : null}
      {done.length ? (
        <button type="button" className="w-link-btn" onClick={() => doc.transact(() => done.forEach((t) => map.delete(t.id)))}>
          Effacer les tâches faites ({done.length})
        </button>
      ) : null}
    </div>
  );
}

export function TasksSettings({ config, set }: SettingsProps) {
  return (
    <label className="nb-check">
      <input type="checkbox" checked={bool(config.hideDone)} onChange={(e) => set({ hideDone: e.target.checked })} /> Masquer les tâches faites
    </label>
  );
}
