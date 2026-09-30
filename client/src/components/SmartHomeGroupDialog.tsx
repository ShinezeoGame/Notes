import { useMemo, useState } from 'react';
import type * as Y from 'yjs';
import {
  autoGroupIcon,
  entityIcon,
  formatState,
  groupByArea,
  isGroupable,
  newGroupId,
  suggestGroupName,
  updateHomeConfig,
  useHomeConfig,
  type HomeEntity,
  type HomeGroup,
} from '../lib/smarthome';
import type { IconName } from '../icons/registry';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { toast } from './Toast';

/** Icônes proposées pour un groupe (en plus de « automatique », qui suit les appareils choisis). */
const GROUP_ICONS: [IconName, string][] = [
  ['bulb', 'Ampoule'],
  ['plug', 'Prise'],
  ['power', 'Interrupteur'],
  ['fan', 'Ventilateur'],
  ['blinds', 'Volets'],
  ['thermometer', 'Chauffage'],
  ['sun', 'Jour'],
  ['moon', 'Nuit'],
  ['sparkles', 'Ambiance'],
  ['home', 'Maison'],
  ['tv', 'Télévision'],
  ['speaker', 'Enceinte'],
  ['door', 'Porte'],
  ['grid', 'Groupe'],
];

/** Création ou modification d'un groupe d'appareils : nom, icône et appareils pilotés ensemble. */
export function SmartHomeGroupDialog({ doc, group, entities, onClose }: { doc: Y.Doc; group: HomeGroup | null; entities: HomeEntity[]; onClose: () => void }) {
  const cfg = useHomeConfig(doc);
  const [name, setName] = useState(group?.name ?? '');
  const [nameTouched, setNameTouched] = useState(Boolean(group?.name));
  const [icon, setIcon] = useState(group?.icon ?? '');
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const [query, setQuery] = useState('');

  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  // Appareils masqués compris : on peut masquer les lampes une à une et ne garder que leur groupe.
  const candidates = useMemo(() => entities.filter((e) => isGroupable(e) || members.includes(e.id)), [entities, members]);
  const rooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? candidates.filter((e) => e.name.toLowerCase().includes(q) || e.area.toLowerCase().includes(q)) : candidates;
    return groupByArea(list);
  }, [candidates, query]);
  const chosen = members.map((id) => byId.get(id)).filter((e): e is HomeEntity => Boolean(e));
  const suggested = suggestGroupName(chosen);
  const finalName = (nameTouched ? name : name || suggested).trim();
  const autoIcon = autoGroupIcon(chosen);

  const setChosen = (next: string[]) => {
    setMembers(next);
    if (!nameTouched) setName('');
  };
  const toggle = (id: string) => setChosen(members.includes(id) ? members.filter((m) => m !== id) : [...members, id]);
  const toggleRoom = (list: HomeEntity[]) => {
    const ids = list.map((e) => e.id);
    const all = ids.every((id) => members.includes(id));
    setChosen(all ? members.filter((m) => !ids.includes(m)) : [...members, ...ids.filter((id) => !members.includes(id))]);
  };

  const save = () => {
    if (!finalName || !members.length) return;
    const next: HomeGroup = { id: group?.id ?? newGroupId(), name: finalName, icon, members };
    updateHomeConfig(doc, (c) => ({
      ...c,
      groups: group ? c.groups.map((g) => (g.id === group.id ? next : g)) : [...c.groups, next],
    }));
    toast(group ? `Groupe « ${finalName} » modifié.` : `Groupe « ${finalName} » créé.`);
    onClose();
  };

  return (
    <Modal
      title={group ? 'Modifier le groupe' : 'Nouveau groupe'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <span className="nb-muted sh-group-count">
            {members.length ? `${members.length} appareil${members.length > 1 ? 's' : ''}` : 'Choisissez les appareils du groupe'}
          </span>
          <button type="button" className="nb-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={save} disabled={!finalName || !members.length}>
            {group ? 'Enregistrer' : 'Créer le groupe'}
          </button>
        </>
      }
    >
      <label className="nb-field">
        <span>Nom du groupe</span>
        <input
          className="nb-input"
          value={nameTouched ? name : name || suggested}
          placeholder="Ex. : Lumières du salon"
          onChange={(ev) => {
            setName(ev.target.value);
            setNameTouched(true);
          }}
          autoFocus={!group}
        />
      </label>
      <div className="nb-field">
        <span>Icône</span>
        <div className="sh-icon-choices" role="radiogroup" aria-label="Icône du groupe">
          <button type="button" role="radio" aria-checked={!icon} className={`sh-icon-choice${!icon ? ' sh-icon-choice--on' : ''}`} onClick={() => setIcon('')} title="D’après les appareils du groupe">
            <Icon name={autoIcon} size={18} /> Auto
          </button>
          {GROUP_ICONS.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={icon === key} className={`sh-icon-choice${icon === key ? ' sh-icon-choice--on' : ''}`} onClick={() => setIcon(key)} aria-label={label} title={label}>
              <Icon name={key} size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="nb-field">
        <span>Appareils</span>
        <input className="nb-input nb-input--sm sh-pick-search" placeholder="Rechercher un appareil ou une pièce…" value={query} onChange={(ev) => setQuery(ev.target.value)} aria-label="Rechercher un appareil" />
      </div>
      <div className="sh-pick">
        {rooms.length ? (
          rooms.map(([area, list]) => {
            const all = list.every((e) => members.includes(e.id));
            return (
              <section key={area || '—'} className="sh-pick-room">
                <div className="sh-pick-head">
                  <h3>{area || 'Sans pièce'}</h3>
                  <button type="button" className="sh-pick-all" onClick={() => toggleRoom(list)}>
                    {all ? 'Tout décocher' : 'Tout cocher'}
                  </button>
                </div>
                {list.map((e) => (
                  <label key={e.id} className={`sh-pick-item${members.includes(e.id) ? ' sh-pick-item--on' : ''}`}>
                    <input type="checkbox" checked={members.includes(e.id)} onChange={() => toggle(e.id)} />
                    <Icon name={entityIcon(e)} size={16} />
                    <span className="sh-pick-name">{e.name}</span>
                    {cfg.hidden.includes(e.id) ? <Icon name="eyeOff" size={13} className="sh-pick-hidden" title="Masqué dans la liste" /> : null}
                    <span className="sh-pick-state">{formatState(e)}</span>
                  </label>
                ))}
              </section>
            );
          })
        ) : (
          <p className="nb-muted">{entities.length ? 'Aucun appareil ne correspond.' : 'Appareils en cours de chargement…'}</p>
        )}
      </div>
    </Modal>
  );
}
