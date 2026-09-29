import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatPairingCode, linkWithCode } from '../lib/pairing';
import { isStandaloneWeb, normalizeServerUrl, useSettings } from '../lib/settings';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';

/** Champ de saisie d'un code à 6 chiffres (« 482 913 »), clavier numérique sur téléphone. */
export function PairingCodeInput({ value, onChange, onEnter, autoFocus }: { value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean }) {
  return (
    <input
      className="nb-input nb-input--lg nb-code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123 456"
      aria-label="Code à 6 chiffres"
      value={formatPairingCode(value)}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      autoFocus={autoFocus}
    />
  );
}

/** Appareil déjà relié : affiche un code valable 10 minutes pour relier un autre appareil. */
export function PairingCodePanel() {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      setPairing(await api.pairStart());
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code indisponible.');
    } finally {
      setBusy(false);
    }
  };

  const left = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;
  if (!pairing || left === 0) {
    return (
      <div className="nb-pair">
        <button type="button" className="nb-btn nb-btn--primary" onClick={() => void create()} disabled={busy}>
          <Icon name="smartphone" size={15} /> {pairing ? 'Afficher un nouveau code' : 'Afficher un code de liaison'}
        </button>
        {pairing ? <span className="nb-muted">Le code précédent a expiré.</span> : null}
        {error ? <div className="nb-error">{error}</div> : null}
      </div>
    );
  }
  return (
    <div className="nb-pair nb-pair--shown">
      <div className="nb-pair-code" aria-label={`Code de liaison ${pairing.code.split('').join(' ')}`}>
        {formatPairingCode(pairing.code)}
      </div>
      <div className="nb-muted">
        Valable encore {Math.floor(left / 60)} min {String(left % 60).padStart(2, '0')} s, une seule fois. Sur le nouvel appareil : <b>Réglages → Relier cet
        appareil avec un code</b> (ou, au premier lancement de l’application : <b>Se connecter à mon serveur</b>).
      </div>
    </div>
  );
}

/**
 * Nouvel appareil : saisie de l'adresse du serveur (application) et du code affiché sur un appareil déjà relié.
 * `server` : adresse déjà saisie ailleurs (réglages), à défaut celle enregistrée.
 */
export function LinkWithCodeDialog({ server: initialServer, onClose }: { server?: string | null; onClose: () => void }) {
  const settings = useSettings();
  const web = isStandaloneWeb();
  const [server, setServer] = useState(web ? location.origin : (initialServer || settings.serverUrl || ''));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const serverUrl = web ? location.origin : normalizeServerUrl(server);

  const submit = async () => {
    if (!serverUrl) {
      setError('Adresse du serveur invalide. Exemple : https://notes.mondomaine.fr');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await linkWithCode(serverUrl, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Liaison impossible.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Relier cet appareil"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void submit()} disabled={busy || code.length !== 6 || !serverUrl}>
            {busy ? 'Liaison…' : 'Relier cet appareil'}
          </button>
        </>
      }
    >
      <p className="nb-muted nb-pair-intro">
        Sur un appareil déjà relié, ouvrez <b>Réglages</b> et touchez <b>Afficher un code de liaison</b>, puis saisissez ce code ici.
      </p>
      {web ? null : (
        <label className="nb-field">
          <span>Adresse du serveur</span>
          <input className="nb-input" placeholder="https://notes.mondomaine.fr" value={server} onChange={(e) => setServer(e.target.value)} inputMode="url" />
        </label>
      )}
      <div className="nb-field">
        <span>Code à 6 chiffres</span>
        <PairingCodeInput value={code} onChange={setCode} onEnter={() => code.length === 6 && void submit()} autoFocus />
      </div>
      {error ? <div className="nb-error">{error}</div> : null}
      <p className="nb-muted nb-pair-note">Les pages créées sur cet appareil avant la liaison ne seront plus affichées ici.</p>
    </Modal>
  );
}
