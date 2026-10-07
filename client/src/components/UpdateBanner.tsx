import { useEffect, useState } from 'react';
import { applyUpdate, dismissUpdate, isUpdateAvailable, needsNewApp, useUpdateState } from '../lib/updates';
import { desktop, type DesktopUpdate } from '../lib/desktop';
import { isNative } from '../lib/settings';
import { Icon } from '../icons/Icon';
import { t } from '../lib/i18n';

/** Application pour ordinateur : nouvelle version téléchargée, à installer en redémarrant. */
function DesktopUpdateBanner() {
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => desktop()?.onUpdate(setUpdate), []);
  if (update?.status !== 'ready' || dismissed) return null;
  return (
    <div className="nb-update" role="status">
      <Icon name="sparkles" size={18} className="nb-update-icon" />
      <span className="nb-update-body">{t('Nouvelle version d’Ostal pour ordinateur prête : elle s’installe en redémarrant Ostal.')}</span>
      <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={() => desktop()?.installUpdate()}>
        {t('Redémarrer')}
      </button>
      <button
        type="button"
        className="nb-icon-btn"
        onClick={() => setDismissed(true)}
        aria-label={t('Plus tard')}
        title={t('Plus tard (installée à la fermeture)')}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/** Bandeau « mise à jour disponible », progression du téléchargement et erreurs éventuelles. */
export function UpdateBanner() {
  const s = useUpdateState();

  if (s.progress !== null) {
    const pct = Math.round(s.progress * 100);
    return (
      <div className="nb-update" role="status">
        <Icon name="download" size={18} className="nb-update-icon" />
        <div className="nb-update-body">
          <span>{pct < 100 ? t('Téléchargement de la mise à jour… {pct} %', { pct }) : t('Installation de la mise à jour…')}</span>
          <div className="nb-update-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    );
  }

  if (s.error) {
    return (
      <div className="nb-update nb-update--error" role="alert">
        <Icon name="alert" size={18} className="nb-update-icon" />
        <span className="nb-update-body">
          {t('La mise à jour a échoué :')} {s.error}
        </span>
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => void applyUpdate()}>
          {t('Réessayer')}
        </button>
        <button type="button" className="nb-icon-btn" onClick={dismissUpdate} aria-label={t('Fermer')}>
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }

  if (!isUpdateAvailable(s) || s.dismissed === s.remote?.version) return <DesktopUpdateBanner />;
  const newApp = needsNewApp(s);
  const native = isNative();
  return (
    <div className="nb-update" role="status">
      <Icon name={newApp ? 'smartphone' : 'sparkles'} size={18} className="nb-update-icon" />
      <span className="nb-update-body">
        {newApp
          ? t('Cette mise à jour demande une version plus récente de l’application Android.')
          : native
            ? t('Une mise à jour d’Ostal est disponible.')
            : t('Une nouvelle version d’Ostal est disponible.')}
      </span>
      <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={() => void applyUpdate()}>
        {newApp ? t('Télécharger l’APK') : native ? t('Mettre à jour') : t('Recharger')}
      </button>
      <button type="button" className="nb-icon-btn" onClick={dismissUpdate} aria-label={t('Plus tard')} title={t('Plus tard')}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
