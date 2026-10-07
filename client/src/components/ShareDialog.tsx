import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { api, canShareLinks, type ShareInfo, type ShareMode } from '../lib/api';
import { isDesktopLocal } from '../lib/desktop';
import { Icon } from '../icons/Icon';
import { copyText, sendLink } from './LinkDevice';
import { t } from '../lib/i18n';

type Props = { pageId: string; pageTitle: string; onClose: () => void; onJoin: () => void };

const canShareSheet = () => typeof (navigator as Navigator & { share?: unknown }).share === 'function';

/**
 * Partager une page : on choisit ce que la personne pourra faire (modifier ou lire), puis on copie ou envoie le lien.
 * Un lien par mode est réutilisé d'une fois sur l'autre ; chacun peut être désactivé.
 */
export function ShareDialog({ pageId, pageTitle, onClose, onJoin }: Props) {
  const [shares, setShares] = useState<ShareInfo[] | null>(null);
  const [mode, setMode] = useState<ShareMode>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shareable = canShareLinks();
  const title = pageTitle || t('Sans titre');

  useEffect(() => {
    if (!shareable) return;
    api.listShares(pageId).then(
      (list) => setShares(list),
      (err: Error) => {
        setError(err.message);
        setShares([]);
      },
    );
  }, [pageId, shareable]);

  const current = shares?.find((s) => s.mode === mode) ?? null;

  /** Lien du mode choisi : celui qui existe déjà, sinon un nouveau. */
  const ensure = async (): Promise<ShareInfo | null> => {
    if (current) return current;
    setBusy(true);
    setError('');
    try {
      const s = await api.createShare(pageId, mode);
      setShares((prev) => [...(prev ?? []), s]);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Lien impossible à créer.'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const s = await ensure();
    if (s) await copyText(s.url, t('Lien copié : envoyez-le à qui vous voulez.'));
  };

  const send = async () => {
    const s = await ensure();
    if (s) await sendLink(s.url, title, t('Voici la page « {title} » sur Ostal :', { title }));
  };

  const revoke = async (token: string) => {
    try {
      await api.deleteShare(token);
      setShares((prev) => (prev ?? []).filter((s) => s.token !== token));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Erreur'));
    }
  };

  return (
    <Modal title={t('Partager « {title} »', { title })} onClose={onClose} width={560}>
      {!shareable ? (
        <div className="nb-notice nb-share-offline">
          <p>
            {isDesktopLocal()
              ? t('Vos pages sont sur cet ordinateur : les autres ne peuvent pas les ouvrir.')
              : t('Ostal fonctionne seul sur cet appareil.')}{' '}
            {t('Pour partager une page, rejoignez un serveur Ostal : le vôtre, ou celui d’une personne qui vous invite.')}
          </p>
          <button type="button" className="nb-btn nb-btn--primary" onClick={onJoin}>
            <Icon name="link" size={15} /> {t('Rejoindre un serveur')}
          </button>
        </div>
      ) : (
        <>
          <p className="nb-muted">
            {t('La personne qui reçoit le lien ouvre cette page et ses sous-pages dans son navigateur, sans compte ni installation.')}
          </p>
          <div className="nb-segmented" role="radiogroup" aria-label={t('Avec le lien, on peut')}>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'edit'}
              className={mode === 'edit' ? 'nb-segmented--on' : ''}
              onClick={() => setMode('edit')}
            >
              <Icon name="pencil" size={15} /> {t('Peut modifier')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'view'}
              className={mode === 'view' ? 'nb-segmented--on' : ''}
              onClick={() => setMode('view')}
            >
              <Icon name="eye" size={15} /> {t('Peut seulement lire')}
            </button>
          </div>
          <p className="nb-muted nb-small nb-share-mode-hint">
            {mode === 'edit'
              ? t('Les modifications s’affichent en direct pour tout le monde, avec le prénom de chacun.')
              : t('La page se met à jour en direct, mais la personne ne peut rien changer.')}
          </p>
          <div className="nb-row nb-gap nb-wrap">
            <button type="button" className="nb-btn nb-btn--primary" disabled={busy || shares === null} onClick={() => void copy()}>
              <Icon name="copy" size={15} /> {t('Copier le lien')}
            </button>
            {canShareSheet() ? (
              <button type="button" className="nb-btn" disabled={busy || shares === null} onClick={() => void send()}>
                <Icon name="share" size={15} /> {t('Envoyer…')}
              </button>
            ) : null}
          </div>
          {error ? <div className="nb-error">{error}</div> : null}
          {shares?.length ? (
            <div className="nb-share-list">
              <h4>{t('Liens actifs')}</h4>
              {shares.map((s) => (
                <div key={s.token} className="nb-share-item">
                  <span className={`nb-badge nb-badge--${s.mode}`}>{s.mode === 'edit' ? t('Modification') : t('Lecture')}</span>
                  <input
                    className="nb-input nb-share-url"
                    readOnly
                    value={s.url}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={t('Lien de partage')}
                  />
                  <button type="button" className="nb-btn nb-btn--sm" onClick={() => void copyText(s.url)}>
                    {t('Copier')}
                  </button>
                  <button
                    type="button"
                    className="nb-btn nb-btn--sm nb-btn--danger"
                    onClick={() => void revoke(s.token)}
                    title={t('Le lien ne fonctionnera plus')}
                  >
                    {t('Désactiver')}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}
