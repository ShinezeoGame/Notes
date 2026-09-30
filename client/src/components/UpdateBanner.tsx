import { useEffect, useState } from 'react';
import { applyUpdate, dismissUpdate, isUpdateAvailable, needsNewApp, useUpdateState } from '../lib/updates';
import { desktop, type DesktopUpdate } from '../lib/desktop';
import { isNative } from '../lib/settings';
import { Icon } from '../icons/Icon';

/** Application pour ordinateur : nouvelle version téléchargée, à installer en redémarrant. */
function DesktopUpdateBanner() {
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => desktop()?.onUpdate(setUpdate), []);
  if (update?.status !== 'ready' || dismissed) return null;
  return (
    <div className="nb-update" role="status">
      <Icon name="sparkles" size={18} className="nb-update-icon" />
      <span className="nb-update-body">Nouvelle version de Melo pour ordinateur prête : elle s’installe en redémarrant Melo.</span>
      <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={() => desktop()?.installUpdate()}>
        Redémarrer
      </button>
      <button type="button" className="nb-icon-btn" onClick={() => setDismissed(true)} aria-label="Plus tard" title="Plus tard (installée à la fermeture)">
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
          <span>{pct < 100 ? `Téléchargement de la mise à jour… ${pct} %` : 'Installation de la mise à jour…'}</span>
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
        <span className="nb-update-body">La mise à jour a échoué : {s.error}</span>
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => void applyUpdate()}>
          Réessayer
        </button>
        <button type="button" className="nb-icon-btn" onClick={dismissUpdate} aria-label="Fermer">
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
          ? 'Cette mise à jour demande une version plus récente de l’application Android.'
          : native
            ? 'Une mise à jour de Melo est disponible.'
            : 'Une nouvelle version de Melo est disponible.'}
      </span>
      <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={() => void applyUpdate()}>
        {newApp ? 'Télécharger l’APK' : native ? 'Mettre à jour' : 'Recharger'}
      </button>
      <button type="button" className="nb-icon-btn" onClick={dismissUpdate} aria-label="Plus tard" title="Plus tard">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
