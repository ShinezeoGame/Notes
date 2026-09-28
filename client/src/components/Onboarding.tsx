import { useState } from 'react';
import { getSettings, normalizeServerUrl, parseJoinLink, updateSettings } from '../lib/settings';
import { clearLocalDocs } from '../lib/yjs';

export function Onboarding() {
  const [mode, setMode] = useState<'choose' | 'connect'>('choose');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const offline = () => updateSettings({ onboarded: true, serverUrl: null });

  const connect = async () => {
    const s = getSettings();
    const join = parseJoinLink(input);
    const serverUrl = join ? join.serverUrl : normalizeServerUrl(input);
    if (!serverUrl) {
      setError('Adresse invalide. Exemple : https://notes.mondomaine.fr');
      return;
    }
    const wsId = join ? join.workspaceId : s.workspaceId;
    const key = join ? join.workspaceKey : s.workspaceKey;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${serverUrl}/api/workspaces/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wsId, key }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Le serveur a répondu ${r.status}.`);
      }
      if (join) await clearLocalDocs();
      updateSettings({ serverUrl, workspaceId: wsId, workspaceKey: key, onboarded: true, lastPageId: join ? null : s.lastPageId });
      location.hash = '#/';
      location.reload();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Serveur injoignable.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nb-center nb-onboarding">
      <div className="nb-card">
        <div className="nb-logo">N</div>
        <h1>Bienvenue dans Notes</h1>
        <p className="nb-muted">Un espace sombre et sobre pour écrire, organiser des pages dans des pages, et collaborer en direct.</p>
        {mode === 'choose' ? (
          <div className="nb-choices">
            <button type="button" className="nb-choice" onClick={offline}>
              <span className="nb-choice-icon">📱</span>
              <span className="nb-choice-title">Utiliser sur cet appareil</span>
              <span className="nb-muted">Tout reste en local. Vous pourrez connecter un serveur plus tard dans les réglages.</span>
            </button>
            <button type="button" className="nb-choice" onClick={() => setMode('connect')}>
              <span className="nb-choice-icon">☁️</span>
              <span className="nb-choice-title">Se connecter à mon serveur</span>
              <span className="nb-muted">Synchronisation entre appareils, partage de pages et modification en direct.</span>
            </button>
          </div>
        ) : (
          <div className="nb-connect">
            <label className="nb-field">
              <span>Adresse du serveur, ou lien « Lier un appareil » copié depuis les réglages d’un autre appareil</span>
              <input
                className="nb-input nb-input--lg"
                placeholder="https://notes.mondomaine.fr"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void connect()}
                autoFocus
              />
            </label>
            {error ? <div className="nb-error">{error}</div> : null}
            <div className="nb-row nb-gap nb-end">
              <button type="button" className="nb-btn" onClick={() => setMode('choose')} disabled={busy}>
                Retour
              </button>
              <button type="button" className="nb-btn nb-btn--primary" onClick={() => void connect()} disabled={busy || !input.trim()}>
                {busy ? 'Connexion…' : 'Se connecter'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
