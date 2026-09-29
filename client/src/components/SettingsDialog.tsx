import { useState } from 'react';
import { Modal } from './Modal';
import { getSettings, isNative, normalizeServerUrl, parseJoinLink, resetWorkspace, updateSettings, useSettings } from '../lib/settings';
import { USER_COLORS } from '../lib/ids';
import { clearLocalDocs } from '../lib/yjs';
import { toast } from './Toast';
import { Icon } from '../icons/Icon';
import { LinkWithCodeDialog, PairingCodePanel } from './LinkDevice';
import {
  BUILD,
  applyUpdate,
  checkForUpdate,
  formatBuildDate,
  isUpdateAvailable,
  needsNewApp,
  setUpdateNotifications,
  useUpdateState,
} from '../lib/updates';

/** Version installée, version du serveur, recherche et installation des mises à jour. */
function UpdatesSection() {
  const settings = useSettings();
  const u = useUpdateState();
  const native = isNative();
  const available = isUpdateAvailable(u);
  const busy = u.checking || u.progress !== null;
  let status: string;
  if (!settings.serverUrl) status = 'Les mises à jour sont distribuées par votre serveur Notes : configurez-le ci-dessus.';
  else if (u.checking) status = 'Recherche d’une mise à jour…';
  else if (!u.remote) status = 'Version du serveur inconnue (serveur injoignable ?).';
  else if (!available) status = 'L’application est à jour.';
  else if (needsNewApp(u)) status = 'Une nouvelle version existe, mais elle demande une application Android plus récente (APK).';
  else status = `Nouvelle version disponible : ${u.remote.version}${u.remote.builtAt ? ` (${formatBuildDate(u.remote.builtAt)})` : ''}.`;

  return (
    <section className="nb-settings-section">
      <h3>Application et mises à jour</h3>
      <p className="nb-muted nb-update-version">
        Version {BUILD.id} du {formatBuildDate(BUILD.builtAt)}
        {u.appVersion ? ` · application Android ${u.appVersion}` : ''}
      </p>
      <div className={`nb-update-status${available ? ' nb-update-status--new' : ''}`}>
        <Icon name={available ? 'sparkles' : settings.serverUrl && u.remote ? 'checkCircle' : 'refresh'} size={16} />
        <span>{status}</span>
      </div>
      {settings.serverUrl ? (
        <div className="nb-row nb-gap nb-update-actions">
          {available ? (
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void applyUpdate()} disabled={busy}>
              {needsNewApp(u) ? 'Télécharger l’APK' : native ? 'Mettre à jour maintenant' : 'Recharger la page'}
            </button>
          ) : null}
          <button type="button" className="nb-btn" onClick={() => void checkForUpdate()} disabled={busy}>
            Rechercher une mise à jour
          </button>
        </div>
      ) : null}
      {native ? (
        <label className="nb-check nb-update-notify">
          <input
            type="checkbox"
            checked={settings.updateNotifications !== false}
            onChange={(e) => void setUpdateNotifications(e.target.checked)}
          />
          Me prévenir par une notification quand une mise à jour est disponible
        </label>
      ) : null}
    </section>
  );
}

type Props = { onClose: () => void };

type TestResult = { ok: boolean; text: string; pairable?: boolean };

async function testServer(url: string, wsId: string, key: string): Promise<TestResult> {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { ok: false, text: `Le serveur a répondu ${r.status}.` };
    const c = await fetch(`${url}/api/workspaces/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wsId, key }),
      signal: AbortSignal.timeout(8000),
    });
    if (!c.ok) {
      const data = (await c.json().catch(() => null)) as { error?: string } | null;
      // Espace refusé (serveur qui a déjà son espace) : cet appareil se relie avec un code.
      return { ok: false, text: data?.error || `Le serveur a refusé l’espace de travail (${c.status}).`, pairable: c.status === 403 };
    }
    return { ok: true, text: 'Connexion réussie' };
  } catch {
    return { ok: false, text: 'Serveur injoignable. Vérifiez l’adresse (https://…) et votre connexion.' };
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
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

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
    // Lien « Lier un appareil » collé : on teste l'espace du lien, pas celui de cet appareil.
    const join = parseJoinLink(server);
    const url = join?.serverUrl ?? normalizeServerUrl(server);
    if (!url) {
      setTestResult({ ok: false, text: 'Adresse invalide.' });
      return;
    }
    setTesting(true);
    const result = await testServer(url, join?.workspaceId ?? settings.workspaceId, join?.workspaceKey ?? settings.workspaceKey);
    setTestResult(join && result.ok ? { ok: true, text: 'Lien valide : touchez « Enregistrer » pour relier cet appareil.' } : result);
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
              {testResult.pairable ? (
                <div className="nb-test-action">
                  <button type="button" className="nb-btn nb-btn--primary" onClick={() => setLinkOpen(true)}>
                    Saisir un code
                  </button>
                </div>
              ) : null}
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
            <span>Relier un autre appareil (téléphone, ordinateur) à cet espace</span>
            <PairingCodePanel />
            <details className="nb-join-link">
              <summary>Ou avec un lien</summary>
              <div className="nb-row nb-gap">
                <input className="nb-input" readOnly value={joinLink} onFocus={(e) => e.currentTarget.select()} aria-label="Lien pour lier un autre appareil" />
                <button type="button" className="nb-btn" onClick={() => void copy(joinLink)}>
                  Copier
                </button>
              </div>
            </details>
          </div>
        ) : (
          <p className="nb-muted">Configurez un serveur pour partager des pages et synchroniser plusieurs appareils.</p>
        )}
        <div className="nb-field">
          <span>Cet appareil n’affiche pas vos pages ? Reliez‑le à votre espace</span>
          <div>
            <button type="button" className="nb-btn" onClick={() => setLinkOpen(true)}>
              <Icon name="link" size={15} /> Relier cet appareil avec un code
            </button>
          </div>
        </div>
        {linkOpen ? <LinkWithCodeDialog server={parseJoinLink(server)?.serverUrl ?? normalizeServerUrl(server)} onClose={() => setLinkOpen(false)} /> : null}
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

      <UpdatesSection />

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
