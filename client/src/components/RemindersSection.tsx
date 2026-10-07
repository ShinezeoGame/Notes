// Réglages → Rappels : échéances des papiers et événements des agendas, notifiés sur cet appareil (moyen selon
// l'appareil : voir lib/reminders.ts). Choix propre à chaque appareil.
import { useState } from 'react';
import { serverBase } from '../lib/api';
import { browserPermission, disableReminders, enableReminders, reminderHelp, reminderSupport, testReminder } from '../lib/reminders';
import { useSettings } from '../lib/settings';
import { Icon } from '../icons/Icon';
import { toast } from './Toast';
import { t } from '../lib/i18n';

export function RemindersSection() {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const support = reminderSupport();
  const on = settings.reminders;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Opération impossible.'));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (checked: boolean) =>
    run(async () => {
      if (!checked) return disableReminders();
      await enableReminders();
      toast(t('Rappels activés sur cet appareil.'));
    });
  const test = () =>
    run(async () => {
      await testReminder();
      toast(t('Rappel d’essai envoyé : il s’affiche dans quelques secondes.'));
    });

  const how =
    settings.remindersMode === 'native'
      ? t('Même quand Ostal est fermé : le téléphone les programme lui-même.')
      : settings.remindersMode === 'push'
        ? t('Même quand Ostal est fermé : le serveur les envoie à ce navigateur.')
        : t('Tant qu’Ostal est ouvert sur cet appareil, même réduit ou en arrière-plan.');

  return (
    <section className="nb-settings-section">
      <h3>{t('Rappels')}</h3>
      <p className="nb-muted rm-intro">
        {t('Échéances de vos papiers (passeport, contrôle technique…) et événements de vos agendas : choisissez le rappel de chaque agenda avec la cloche, dans la section Agenda.')}
      </p>
      {!serverBase() ? (
        <p className="nb-muted">{t('Un serveur Ostal est nécessaire pour les rappels.')}</p>
      ) : !support ? (
        <p className="nb-muted">{reminderHelp()}</p>
      ) : (
        <>
          <label className="nb-check">
            <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
            {t('Recevoir les rappels sur cet appareil')}
          </label>
          {on ? (
            <>
              <p className="nb-muted rm-how">{how}</p>
              {support !== 'native' && browserPermission() === 'denied' ? (
                <div className="nb-error">{t('Notifications bloquées pour Ostal dans ce navigateur : autorisez-les (cadenas à gauche de l’adresse).')}</div>
              ) : null}
              <div>
                <button type="button" className="nb-btn nb-btn--sm" onClick={() => void test()} disabled={busy}>
                  <Icon name="bell" size={14} /> {t('Envoyer un rappel d’essai')}
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
      {error ? <div className="nb-error">{error}</div> : null}
    </section>
  );
}
