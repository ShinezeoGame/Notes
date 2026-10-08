// Réglages → Widgets du téléphone (application Android) : ajouter les widgets à l'écran d'accueil (tâches, allumer
// l'ordinateur, raccourcis), choisir les raccourcis et la liste de tâches affichée, poser un raccourci seul (icône
// « Atelier PDF »…). Choix propres à ce téléphone.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { serverBase } from '../lib/api';
import {
  LAUNCHER_SHORTCUTS,
  MAX_PHONE_SHORTCUTS,
  chosenShortcuts,
  computers,
  phoneShortcuts,
  pinShortcut,
  pinWidget,
  taskLists,
  widgetsInfo,
  type PhoneShortcut,
  type WidgetKind,
  type WidgetsInfo,
} from '../lib/phoneWidgets';
import { updateSettings, useSettings } from '../lib/settings';
import { useSeerr } from '../lib/seerr';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { toast } from './Toast';
import { t, tn } from '../lib/i18n';

export function PhoneWidgetsSection({ doc }: { doc: Y.Doc }) {
  const settings = useSettings();
  const [info, setInfo] = useState<WidgetsInfo | null>(null);
  const [error, setError] = useState('');
  const lists = useMemo(() => taskLists(doc), [doc]);
  const pcs = useMemo(() => computers(doc), [doc]);
  const hasServer = Boolean(serverBase());
  const seerr = useSeerr(doc);

  const refresh = useCallback(() => void widgetsInfo().then(setInfo, () => setInfo(null)), []);
  useEffect(() => {
    refresh();
    // Retour de la fenêtre du lanceur (« Ajouter à l'écran d'accueil ») : widgets posés recomptés.
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : t('Opération impossible.'));
  const manual = t('Sur ce téléphone : appui long sur l’écran d’accueil → Widgets → Ostal, puis faites glisser le widget.');
  const addWidget = async (kind: WidgetKind) => {
    setError('');
    try {
      if (!(await pinWidget(kind))) setError(manual);
    } catch (err) {
      fail(err);
    }
  };
  const addIcon = async (s: PhoneShortcut) => {
    setError('');
    try {
      if (!(await pinShortcut(s))) setError(t('Ce téléphone ne permet pas de poser une icône depuis Ostal : appui long sur l’icône d’Ostal, puis faites glisser le raccourci.'));
    } catch (err) {
      fail(err);
    }
  };

  const chosen = chosenShortcuts().map((s) => s.id);
  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    if (!next.length) return;
    if (next.length > MAX_PHONE_SHORTCUTS) {
      toast(t('{n} raccourcis au plus : décochez-en un d’abord.', { n: MAX_PHONE_SHORTCUTS }));
      return;
    }
    updateSettings({ phoneShortcuts: next });
  };

  const widgets: { kind: WidgetKind; icon: IconName; title: string; text: string }[] = [
    { kind: 'tasks', icon: 'checkSquare', title: t('Tâches'), text: t('Cochez une tâche ou ajoutez-en une sans ouvrir Ostal.') },
    { kind: 'wake', icon: 'power', title: t('Allumer l’ordinateur'), text: t('Un bouton pour allumer le PC de la maison, même à distance.') },
    { kind: 'shortcuts', icon: 'grid', title: t('Raccourcis'), text: t('Une section ou une nouvelle page d’un geste.') },
  ];
  // Application Android assez récente, et serveur : barre de recherche de films et séries (Seerr).
  if (info?.placed.seerr !== undefined && hasServer) {
    widgets.push({ kind: 'seerr', icon: 'film', title: t('Films et séries'), text: t('Une barre de recherche pour demander un film ou une série à Seerr, micro compris.') });
  }

  return (
    <section className="nb-settings-section">
      <h3>{t('Widgets du téléphone')}</h3>
      <p className="nb-muted pw-intro">{t('Mettez Ostal sur l’écran d’accueil du téléphone : vos tâches à cocher, un bouton pour allumer l’ordinateur, vos raccourcis.')}</p>
      <ul className="pw-widgets">
        {widgets.map((w) => {
          const placed = info?.placed[w.kind as keyof WidgetsInfo['placed']] ?? 0;
          return (
            <li key={w.kind} className="pw-widget">
              <span className="pw-widget-icon">
                <Icon name={w.icon} size={20} />
              </span>
              <span className="pw-widget-text">
                <b>{w.title}</b>
                <span className="nb-muted">{placed ? tn(placed, 'Sur l’écran d’accueil', 'Sur l’écran d’accueil ({n} fois)') : w.text}</span>
              </span>
              {info?.pinWidgets ? (
                <button type="button" className="nb-btn nb-btn--sm" onClick={() => void addWidget(w.kind)}>
                  <Icon name="plus" size={14} /> {t('Ajouter')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {info && !info.pinWidgets ? <p className="nb-muted pw-hint">{manual}</p> : null}

      {!lists.length ? (
        <p className="nb-muted pw-hint">{t('Pour le widget Tâches : ajoutez d’abord une liste « Tâches » à l’accueil d’Ostal.')}</p>
      ) : lists.length > 1 ? (
        <label className="nb-field pw-list">
          <span>{t('Liste affichée par le widget Tâches')}</span>
          <select className="nb-input" value={settings.phoneTaskList || lists[0].id} onChange={(e) => updateSettings({ phoneTaskList: e.target.value })}>
            {lists.map((l, i) => (
              <option key={l.id} value={l.id}>
                {l.title || (i ? `${t('Tâches')} ${i + 1}` : t('Tâches'))}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!hasServer ? (
        <p className="nb-muted pw-hint">{t('Sans serveur Ostal, les tâches cochées sur le widget sont enregistrées à la prochaine ouverture d’Ostal, et le widget « Allumer l’ordinateur » ne fonctionne pas.')}</p>
      ) : !pcs.length ? (
        <p className="nb-muted pw-hint">{t('Pour le widget « Allumer l’ordinateur » : réglez d’abord le widget « Allumer un PC » de l’accueil d’Ostal.')}</p>
      ) : null}
      {info?.placed.seerr !== undefined && hasServer && !seerr ? (
        <p className="nb-muted pw-hint">{t('Pour le widget « Films et séries » : reliez d’abord Seerr, dans la section Films et séries.')}</p>
      ) : null}

      <h4 className="pw-sub">{t('Raccourcis')}</h4>
      <p className="nb-muted pw-intro">
        {t('Cochez ceux du widget Raccourcis ({max} au plus) ; les {launcher} premiers apparaissent aussi en appui long sur l’icône d’Ostal.', {
          max: MAX_PHONE_SHORTCUTS,
          launcher: LAUNCHER_SHORTCUTS,
        })}
      </p>
      <ul className="pw-shortcuts">
        {phoneShortcuts()
          .filter((s) => !s.needsServer || hasServer)
          .map((s) => {
            const rank = chosen.indexOf(s.id);
            return (
              <li key={s.id} className="pw-shortcut">
                <label className="nb-check">
                  <input type="checkbox" checked={rank >= 0} onChange={() => toggle(s.id)} />
                  <Icon name={s.appIcon} size={16} />
                  <span>{s.label}</span>
                  {rank >= 0 ? <span className="pw-rank">{rank + 1}</span> : null}
                </label>
                {info?.pinShortcuts ? (
                  <button type="button" className="nb-btn nb-btn--sm" onClick={() => void addIcon(s)} title={t('Poser cette icône sur l’écran d’accueil')}>
                    <Icon name="smartphone" size={14} /> {t('Icône')}
                  </button>
                ) : null}
              </li>
            );
          })}
      </ul>
      {error ? <div className="nb-error">{error}</div> : null}
    </section>
  );
}
