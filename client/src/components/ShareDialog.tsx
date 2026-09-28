import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { api, serverBase, type ShareInfo, type ShareMode } from '../lib/api';
import { toast } from './Toast';
import { Icon } from '../icons/Icon';

type Props = { pageId: string; pageTitle: string; onClose: () => void; onOpenSettings: () => void };

export function ShareDialog({ pageId, pageTitle, onClose, onOpenSettings }: Props) {
  const [shares, setShares] = useState<ShareInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasServer = Boolean(serverBase());

  const load = async () => {
    try {
      setShares(await api.listShares(pageId));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      setShares([]);
    }
  };

  useEffect(() => {
    if (hasServer) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, hasServer]);

  const create = async (mode: ShareMode) => {
    setBusy(true);
    try {
      const s = await api.createShare(pageId, mode);
      setShares((prev) => [...(prev ?? []), s]);
      await copy(s.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    try {
      await api.deleteShare(token);
      setShares((prev) => (prev ?? []).filter((s) => s.token !== token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Lien copié dans le presse-papiers.');
    } catch {
      toast('Copie impossible : sélectionnez le lien manuellement.', 'error');
    }
  };

  return (
    <Modal title={`Partager « ${pageTitle || 'Sans titre'} »`} onClose={onClose}>
      {!hasServer ? (
        <div className="nb-notice">
          <p>Le partage nécessite un serveur de synchronisation.</p>
          <p className="nb-muted">
            Configurez l’adresse de votre serveur dans les réglages, puis revenez ici pour créer un lien.
          </p>
          <button type="button" className="nb-btn nb-btn--primary" onClick={onOpenSettings}>
            Ouvrir les réglages
          </button>
        </div>
      ) : (
        <>
          <p className="nb-muted">
            Toute personne disposant du lien pourra ouvrir cette page et ses sous-pages, et la modifier en direct si vous choisissez le mode
            « Modification ».
          </p>
          <div className="nb-row nb-gap">
            <button type="button" className="nb-btn nb-btn--primary" disabled={busy} onClick={() => void create('edit')}>
              <Icon name="pencil" size={16} /> Lien de modification
            </button>
            <button type="button" className="nb-btn" disabled={busy} onClick={() => void create('view')}>
              <Icon name="eye" size={16} /> Lien en lecture seule
            </button>
          </div>
          {error ? <div className="nb-error">{error}</div> : null}
          <div className="nb-share-list">
            {shares === null ? <div className="nb-muted">Chargement…</div> : null}
            {shares && shares.length === 0 ? <div className="nb-muted">Aucun lien actif pour cette page.</div> : null}
            {shares?.map((s) => (
              <div key={s.token} className="nb-share-item">
                <span className={`nb-badge nb-badge--${s.mode}`}>{s.mode === 'edit' ? 'Modification' : 'Lecture'}</span>
                <input className="nb-input nb-share-url" readOnly value={s.url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="nb-btn" onClick={() => void copy(s.url)}>
                  Copier
                </button>
                <button type="button" className="nb-btn nb-btn--danger" onClick={() => void revoke(s.token)}>
                  Révoquer
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
