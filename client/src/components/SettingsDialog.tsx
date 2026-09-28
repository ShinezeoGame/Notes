import { useState } from 'react';
import { Modal } from './Modal';
import { getSettings, isNative, normalizeServerUrl, parseJoinLink, resetWorkspace, updateSettings, useSettings } from '../lib/settings';
import { USER_COLORS } from '../lib/ids';
import { clearLocalDocs } from '../lib/yjs';
import { toast } from './Toast';
import { Icon } from '../icons/Icon';

type Props = { onClose: () => void };

async function testServer(url: string, wsId: string, key: string): Promise<string | null> {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return `Le serveur a répondu ${r.status}.`;
    const c = await fetch(`${url}/api/workspaces/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wsId, key }),
      signal: AbortSignal.timeout(8000),
    });
    if (!c.ok) {
      const data = (await c.json().catch(() => null)) as { error?: string } | null;
      return data?.error || `Le serveur a refusé l’espace de travail (${c.status}).`;
    }
    return null;
  } catch {
    return 'Serveur injoignable. Vérifiez l’adresse (https://…) et votre connexion.';
  }
}

export function SettingsDialog({ onClose }: Props) {
  const settings = useSettings();
  const [name, setName] = useState(settings.userName);
  const [color, setColor] = useState(settings.userColor);
  const [server, setServer] = useState(settings.serverUrl ?? '');
  const [googleId, setGoogleId] = useState(settings.googleClientId);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const joinLink = settings.serverUrl ? `${settings.serverUrl}/#/join/${settings.workspaceId}/${settings.workspaceKey}` : null;

  const save = async () => {
    const trimmed = server.trim();
    let serverUrl: string | null = null;
    if (trimmed) {
      const join = parseJoinLink(trimmed);
      if (join) {
        if (!confirm('Ce lien relie cet appareil à un autre espace de travail. Les pages locales actuelles ne seront plus affichées. Continuer ?')) return;
        await clearLocalDocs();
        updateSettings({ serverUrl: join.serverUrl, workspaceId: join.workspaceId, workspaceKey: join.workspaceKey, lastPageId: null, expanded: {} });
        location.reload();
        return;
      }
      serverUrl = normalizeServerUrl(trimmed);
      if (!serverUrl) {
        toast('Adresse de serveur invalide.', 'error');
        return;
      }
    }
    const serverChanged = serverUrl !== settings.serverUrl;
    updateSettings({ userName: name.trim() || settings.userName, userColor: color, serverUrl, googleClientId: googleId.trim() });
    if (serverChanged) {
      location.reload();
      return;
    }
    toast('Réglages enregistrés.');
    onClose();
  };

  const runTest = async () => {
    const url = normalizeServerUrl(server);
    if (!url) {
      setTestResult({ ok: false, text: 'Adresse invalide.' });
      return;
    }
    setTesting(true);
    const err = await testServer(url, settings.workspaceId, settings.workspaceKey);
    setTestResult(err ? { ok: false, text: err } : { ok: true, text: 'Connexion réussie' });
    setTesting(false);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copié.');
    } catch {
      toast('Copie impossible.', 'error');
    }
  };

  const reset = async () => {
    if (!confirm('Réinitialiser cet appareil ? Les données locales seront effacées et un nouvel espace vide sera créé. Les données déjà synchronisées sur le serveur ne sont pas supprimées.')) return;
    await clearLocalDocs();
    resetWorkspace();
    updateSettings({ onboarded: !isNative() });
    location.reload();
  };

  return (
    <Modal
      title="Réglages"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void save()}>
            Enregistrer
          </button>
        </>
      }
    >
      <section className="nb-settings-section">
        <h3>Profil collaboratif</h3>
        <label className="nb-field">
          <span>Nom affiché aux autres participants</span>
          <input className="nb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <div className="nb-field">
          <span>Couleur du curseur</span>
          <div className="nb-colors">
            {USER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`nb-color${c === color ? ' nb-color--active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="nb-settings-section">
        <h3>Synchronisation & partage</h3>
        <label className="nb-field">
          <span>Adresse du serveur (laisser vide pour rester hors ligne)</span>
          <div className="nb-row nb-gap">
            <input
              className="nb-input"
              placeholder="https://notes.mondomaine.fr ou lien « Lier un appareil »"
              value={server}
              onChange={(e) => {
                setServer(e.target.value);
                setTestResult(null);
              }}
            />
            <button type="button" className="nb-btn" onClick={() => void runTest()} disabled={testing || !server.trim()}>
              {testing ? 'Test…' : 'Tester'}
            </button>
          </div>
          {testResult ? (
            <div className={testResult.ok ? 'nb-success' : 'nb-error'}>
              <Icon name={testResult.ok ? 'checkCircle' : 'xCircle'} size={15} /> {testResult.text}
            </div>
          ) : null}
        </label>
        <div className="nb-field">
          <span>Identifiant de l’espace de travail</span>
          <div className="nb-row nb-gap">
            <input className="nb-input" readOnly value={settings.workspaceId} />
            <button type="button" className="nb-btn" onClick={() => void copy(settings.workspaceId)}>
              Copier
            </button>
          </div>
        </div>
        <div className="nb-field">
          <span>Clé secrète (ne la partagez qu’avec vos propres appareils)</span>
          <div className="nb-row nb-gap">
            <input className="nb-input" readOnly type={showKey ? 'text' : 'password'} value={settings.workspaceKey} />
            <button type="button" className="nb-btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Masquer' : 'Afficher'}
            </button>
          </div>
        </div>
        {joinLink ? (
          <div className="nb-field">
            <span>Lier un autre appareil (téléphone, ordinateur) : collez ce lien dans ses réglages</span>
            <div className="nb-row nb-gap">
              <input className="nb-input" readOnly value={joinLink} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="nb-btn" onClick={() => void copy(joinLink)}>
                Copier
              </button>
            </div>
          </div>
        ) : (
          <p className="nb-muted">Configurez un serveur pour partager des pages et synchroniser plusieurs appareils.</p>
        )}
      </section>

      <section className="nb-settings-section">
        <h3>Google Agenda (optionnel)</h3>
        <label className="nb-field">
          <span>ID client OAuth Google – pour importer directement depuis votre compte Google</span>
          <input className="nb-input" placeholder="xxxxxxxx.apps.googleusercontent.com" value={googleId} onChange={(e) => setGoogleId(e.target.value)} />
        </label>
        <p className="nb-muted">
          Sans ID client, vous pouvez toujours importer un fichier .ics ou l’adresse secrète iCal de votre agenda Google.
        </p>
      </section>

      <section className="nb-settings-section nb-settings-danger">
        <h3>Zone sensible</h3>
        <button type="button" className="nb-btn nb-btn--danger" onClick={() => void reset()}>
          Réinitialiser cet appareil
        </button>
      </section>
      <p className="nb-muted nb-version">Notes · {getSettings().serverUrl ? 'mode synchronisé' : 'mode hors ligne'}</p>
    </Modal>
  );
}
