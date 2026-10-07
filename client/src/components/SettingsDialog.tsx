import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { LanguageSwitch } from './LanguageSwitch';
import { getSettings, isDefaultUserName, isNative, isStandaloneWeb, normalizeServerUrl, parseJoinLink, resetWorkspace, updateSettings, useSettings } from '../lib/settings';
import { canShareLinks } from '../lib/api';
import { desktop, isDesktopLocal, type DesktopUpdate } from '../lib/desktop';
import { BackupSection } from './BackupDialog';
import { RemindersSection } from './RemindersSection';
import { isInstalledApp, promptInstall, useInstallState } from '../lib/pwa';
import { USER_COLORS } from '../lib/ids';
import { clearLocalDocs } from '../lib/yjs';
import { toast } from './Toast';
import { Icon } from '../icons/Icon';
import { DevicesPanel, InvitePanel, JoinDialog } from './LinkDevice';
import {
  APK_PAGE,
  BUILD,
  applyUpdate,
  checkForUpdate,
  formatBuildDate,
  isUpdateAvailable,
  needsNewApp,
  setUpdateNotifications,
  useUpdateState,
} from '../lib/updates';
import { t, tx, tServer } from '../lib/i18n';

/** Application pour ordinateur sur son propre espace : sa version vient de l'installateur, pas d'un serveur. */
function DesktopUpdates() {
  const app = desktop()!;
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  useEffect(() => app.onUpdate(setUpdate), [app]);
  return (
    <section className="nb-settings-section">
      <h3>{t('Application et mises à jour')}</h3>
      <p className="nb-muted nb-update-version">
        {t('Application Ostal pour ordinateur, version {version} (Ostal {build} du {date})', {
          version: app.version,
          build: BUILD.id,
          date: formatBuildDate(BUILD.builtAt),
        })}
      </p>
      {update?.status === 'ready' ? (
        <div className="nb-row nb-gap nb-update-actions">
          <span className="nb-update-status nb-update-status--new">
            <Icon name="sparkles" size={16} /> {t('Version {version} prête.', { version: update.version })}
          </span>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => app.installUpdate()}>
            {t('Redémarrer pour l’installer')}
          </button>
        </div>
      ) : (
        <p className="nb-muted">
          {t(
            'Ostal cherche lui-même ses nouvelles versions (si le dépôt GitHub d’Ostal est public). Sinon, téléchargez la dernière version et installez-la par-dessus celle-ci : vos pages restent.',
          )}{' '}
          <a href={APK_PAGE} target="_blank" rel="noreferrer">
            {t('Page de téléchargement')}
          </a>
        </p>
      )}
    </section>
  );
}

/** Version installée, version du serveur, recherche et installation des mises à jour. */
function UpdatesSection() {
  const settings = useSettings();
  const u = useUpdateState();
  const native = isNative();
  const app = desktop();
  if (isDesktopLocal()) return <DesktopUpdates />;
  const available = isUpdateAvailable(u);
  const busy = u.checking || u.progress !== null;
  let status: string;
  if (!settings.serverUrl) status = t('Les mises à jour sont distribuées par votre serveur Ostal : configurez-le ci-dessus.');
  else if (u.checking) status = t('Recherche d’une mise à jour…');
  else if (!u.remote) status = t('Version du serveur inconnue (serveur injoignable ?).');
  else if (!available) status = t('L’application est à jour.');
  else if (needsNewApp(u)) status = t('Une nouvelle version existe, mais elle demande une application Android plus récente (APK).');
  else
    status = u.remote.builtAt
      ? t('Nouvelle version disponible : {version} ({date}).', { version: u.remote.version, date: formatBuildDate(u.remote.builtAt) })
      : t('Nouvelle version disponible : {version}.', { version: u.remote.version });

  return (
    <section className="nb-settings-section">
      <h3>{t('Application et mises à jour')}</h3>
      <p className="nb-muted nb-update-version">
        {t('Version {version} du {date}', { version: BUILD.id, date: formatBuildDate(BUILD.builtAt) })}
        {u.appVersion ? t(' · application Android {version}', { version: u.appVersion }) : ''}
      </p>
      <div className={`nb-update-status${available ? ' nb-update-status--new' : ''}`}>
        <Icon name={available ? 'sparkles' : settings.serverUrl && u.remote ? 'checkCircle' : 'refresh'} size={16} />
        <span>{status}</span>
      </div>
      {settings.serverUrl ? (
        <div className="nb-row nb-gap nb-update-actions">
          {available ? (
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void applyUpdate()} disabled={busy}>
              {needsNewApp(u) ? t('Télécharger l’APK') : native ? t('Mettre à jour maintenant') : t('Recharger la page')}
            </button>
          ) : null}
          <button type="button" className="nb-btn" onClick={() => void checkForUpdate()} disabled={busy}>
            {t('Rechercher une mise à jour')}
          </button>
        </div>
      ) : null}
      {native ? (
        <label className="nb-check nb-update-notify">
          <input type="checkbox" checked={settings.updateNotifications !== false} onChange={(e) => void setUpdateNotifications(e.target.checked)} />
          {t('Me prévenir par une notification quand une mise à jour est disponible')}
        </label>
      ) : null}
      {app ? (
        <p className="nb-muted nb-install-note">
          <Icon name="laptop" size={15} /> {t('Application Ostal pour ordinateur, version {version}.', { version: app.version })}
        </p>
      ) : !native && isStandaloneWeb() ? (
        <InstallBlock />
      ) : null}
    </section>
  );
}

/** Navigateur : installer Ostal comme une application (menu Démarrer, barre des tâches, fenêtre à part). */
function InstallBlock() {
  const { canInstall, installed } = useInstallState();
  if (isInstalledApp()) {
    return (
      <p className="nb-muted nb-install-note">
        <Icon name="checkCircle" size={15} />{' '}
        {t('Application Ostal installée sur cet ordinateur : elle se met à jour toute seule avec votre serveur.')}
      </p>
    );
  }
  if (canInstall) {
    return (
      <div className="nb-install">
        <button type="button" className="nb-btn nb-btn--primary" onClick={() => void promptInstall()}>
          <Icon name="download" size={15} /> {t('Installer Ostal sur cet ordinateur')}
        </button>
        <span className="nb-muted">{t('Dans sa propre fenêtre, depuis le menu Démarrer ou la barre des tâches, même sans réseau.')}</span>
      </div>
    );
  }
  if (installed) {
    return (
      <p className="nb-muted nb-install-note">
        <Icon name="checkCircle" size={15} /> {t('Ostal est installée : ouvrez-la depuis le menu Démarrer ou la barre des tâches.')}
      </p>
    );
  }
  return (
    <p className="nb-muted nb-install-note">
      {t(
        'Installer Ostal comme une application : dans Microsoft Edge, Google Chrome ou Brave, cliquez sur l’icône d’installation à droite de la barre d’adresse (ou menu ⋯ → Applications → Installer Ostal). Déjà installée ? Ouvrez-la depuis le menu Démarrer.',
      )}
    </p>
  );
}

type Props = { onClose: () => void; onTour: () => void };

type TestResult = { ok: boolean; text: string; pairable?: boolean };

async function testServer(url: string, wsId: string, key: string): Promise<TestResult> {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { ok: false, text: t('Le serveur a répondu {status}.', { status: r.status }) };
    const c = await fetch(`${url}/api/workspaces/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wsId, key }),
      signal: AbortSignal.timeout(8000),
    });
    if (!c.ok) {
      const data = (await c.json().catch(() => null)) as { error?: string } | null;
      // Espace refusé (serveur qui a déjà son espace) : cet appareil se relie avec un code.
      return {
        ok: false,
        text: tServer(data?.error ?? '') || t('Le serveur a refusé l’espace de travail ({status}).', { status: c.status }),
        pairable: c.status === 403,
      };
    }
    return { ok: true, text: t('Connexion réussie') };
  } catch {
    return { ok: false, text: t('Serveur injoignable. Vérifiez l’adresse (https://…) et votre connexion.') };
  }
}

export function SettingsDialog({ onClose, onTour }: Props) {
  const settings = useSettings();
  const [name, setName] = useState(isDefaultUserName(settings.userName) ? '' : settings.userName);
  const [color, setColor] = useState(settings.userColor);
  const [server, setServer] = useState(settings.serverUrl ?? '');
  const [googleId, setGoogleId] = useState(settings.googleClientId);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const app = desktop();

  const joinLink = settings.serverUrl ? `${settings.serverUrl}/#/join/${settings.workspaceId}/${settings.workspaceKey}` : null;

  const save = async () => {
    const trimmed = server.trim();
    let serverUrl: string | null = null;
    if (trimmed) {
      const join = parseJoinLink(trimmed);
      if (join) {
        if (!confirm(t('Ce lien relie cet appareil à un autre espace de travail. Les pages locales actuelles ne seront plus affichées. Continuer ?')))
          return;
        await clearLocalDocs();
        updateSettings({ serverUrl: join.serverUrl, workspaceId: join.workspaceId, workspaceKey: join.workspaceKey, lastPageId: null, expanded: {} });
        location.reload();
        return;
      }
      serverUrl = normalizeServerUrl(trimmed);
      if (!serverUrl) {
        toast(t('Adresse de serveur invalide.'), 'error');
        return;
      }
    }
    const serverChanged = serverUrl !== settings.serverUrl;
    updateSettings({ userName: name.trim() || settings.userName, userColor: color, serverUrl, googleClientId: googleId.trim() });
    if (serverChanged) {
      location.reload();
      return;
    }
    toast(t('Réglages enregistrés.'));
    onClose();
  };

  const runTest = async () => {
    // Lien « Lier un appareil » collé : on teste l'espace du lien, pas celui de cet appareil.
    const join = parseJoinLink(server);
    const url = join?.serverUrl ?? normalizeServerUrl(server);
    if (!url) {
      setTestResult({ ok: false, text: t('Adresse invalide.') });
      return;
    }
    setTesting(true);
    const result = await testServer(url, join?.workspaceId ?? settings.workspaceId, join?.workspaceKey ?? settings.workspaceKey);
    setTestResult(join && result.ok ? { ok: true, text: t('Lien valide : touchez « Enregistrer » pour relier cet appareil.') } : result);
    setTesting(false);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('Copié.'));
    } catch {
      toast(t('Copie impossible.'), 'error');
    }
  };

  const reset = async () => {
    if (
      !confirm(
        t(
          'Réinitialiser cet appareil ? Les données locales seront effacées et un nouvel espace vide sera créé. Les données déjà synchronisées sur le serveur ne sont pas supprimées.',
        ),
      )
    )
      return;
    await clearLocalDocs();
    resetWorkspace();
    updateSettings({ onboarded: !isNative() && !isDesktopLocal() });
    location.reload();
  };

  return (
    <Modal
      title={t('Réglages')}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose}>
            {t('Annuler')}
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void save()}>
            {t('Enregistrer')}
          </button>
        </>
      }
    >
      <section className="nb-settings-section">
        <h3>{t('Vous')}</h3>
        <div className="nb-field">
          <span>{t('Langue de l’interface (sur cet appareil)')}</span>
          <LanguageSwitch />
        </div>
        <label className="nb-field">
          <span>{t('Votre prénom, affiché aux personnes qui modifient une page avec vous')}</span>
          <input className="nb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={settings.userName} />
        </label>
        <div className="nb-field">
          <span>{t('Votre couleur (curseur dans les pages partagées)')}</span>
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
        <h3>{t('Vos appareils')}</h3>
        <DevicesPanel onJoin={() => setJoinOpen(true)} />
        {app?.mode === 'server' ? (
          <div className="nb-devices-join">
            <span className="nb-muted">
              {app.serverUrl
                ? tx(
                    'Cette fenêtre affiche le serveur <m>{host}</m>.',
                    { m: (s) => <span className="nb-mono">{s}</span> },
                    { host: new URL(app.serverUrl).host },
                  )
                : t('Cette fenêtre affiche un serveur distant.')}
            </span>
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => void app.useLocal()}>
              <Icon name="laptop" size={14} /> {t('Revenir à l’espace de cet ordinateur')}
            </button>
          </div>
        ) : null}
      </section>

      {canShareLinks() && !settings.guest ? (
        <section className="nb-settings-section">
          <h3>{t('Inviter une personne')}</h3>
          <InvitePanel />
        </section>
      ) : null}

      <RemindersSection />
      {!settings.guest ? <BackupSection /> : null}

      <UpdatesSection />

      <section className="nb-settings-section">
        <h3>{t('Découvrir Ostal')}</h3>
        <p className="nb-muted">{t('Les sections, l’accueil et les gestes utiles, en quelques écrans.')}</p>
        <div>
          <button type="button" className="nb-btn" onClick={onTour}>
            <Icon name="sparkles" size={15} /> {t('Revoir la présentation')}
          </button>
        </div>
      </section>

      <details className="nb-settings-section nb-settings-advanced">
        <summary>{t('Réglages avancés')}</summary>
        <label className="nb-field">
          <span>{t('Adresse du serveur (laisser vide pour rester hors ligne)')}</span>
          <div className="nb-row nb-gap">
            <input
              className="nb-input"
              placeholder={t('https://notes.mondomaine.fr ou lien « Lier un appareil »')}
              value={server}
              onChange={(e) => {
                setServer(e.target.value);
                setTestResult(null);
              }}
            />
            <button type="button" className="nb-btn" onClick={() => void runTest()} disabled={testing || !server.trim()}>
              {testing ? t('Test…') : t('Tester')}
            </button>
          </div>
          {testResult ? (
            <div className={testResult.ok ? 'nb-success' : 'nb-error'}>
              <Icon name={testResult.ok ? 'checkCircle' : 'xCircle'} size={15} /> {testResult.text}
              {testResult.pairable ? (
                <div className="nb-test-action">
                  <button type="button" className="nb-btn nb-btn--primary" onClick={() => setJoinOpen(true)}>
                    {t('Saisir un code')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </label>
        <div className="nb-field">
          <span>{t('Identifiant de l’espace de travail')}</span>
          <div className="nb-row nb-gap">
            <input className="nb-input" readOnly value={settings.workspaceId} />
            <button type="button" className="nb-btn" onClick={() => void copy(settings.workspaceId)}>
              {t('Copier')}
            </button>
          </div>
        </div>
        <div className="nb-field">
          <span>{t('Clé secrète (ne la partagez qu’avec vos propres appareils)')}</span>
          <div className="nb-row nb-gap">
            <input className="nb-input" readOnly type={showKey ? 'text' : 'password'} value={settings.workspaceKey} />
            <button type="button" className="nb-btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? t('Masquer') : t('Afficher')}
            </button>
          </div>
        </div>
        {joinLink && canShareLinks() ? (
          <div className="nb-field">
            <span>{t('Lien permanent pour relier vos propres appareils (contient la clé : ne le partagez pas)')}</span>
            <div className="nb-row nb-gap">
              <input
                className="nb-input"
                readOnly
                value={joinLink}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={t('Lien pour lier un autre appareil')}
              />
              <button type="button" className="nb-btn" onClick={() => void copy(joinLink)}>
                {t('Copier')}
              </button>
            </div>
          </div>
        ) : null}
        <label className="nb-field">
          <span>{t('Google Agenda : ID client OAuth, pour importer directement depuis votre compte Google (facultatif)')}</span>
          <input
            className="nb-input"
            placeholder={t('xxxxxxxx.apps.googleusercontent.com')}
            value={googleId}
            onChange={(e) => setGoogleId(e.target.value)}
          />
        </label>
        <p className="nb-muted">
          {t('Sans ID client, vous pouvez toujours importer un fichier .ics ou l’adresse secrète iCal de votre agenda Google.')}
        </p>
        <div className="nb-field nb-settings-danger">
          <span>{t('Zone sensible')}</span>
          <div>
            <button type="button" className="nb-btn nb-btn--danger" onClick={() => void reset()}>
              {t('Réinitialiser cet appareil')}
            </button>
          </div>
        </div>
      </details>
      <p className="nb-muted nb-version">
        {t('Ostal ·')} {getSettings().serverUrl ? (isDesktopLocal() ? t('espace de cet ordinateur') : t('mode synchronisé')) : t('mode hors ligne')}
      </p>
      {joinOpen ? (
        <JoinDialog server={testResult?.pairable ? (parseJoinLink(server)?.serverUrl ?? normalizeServerUrl(server)) : undefined} onClose={() => setJoinOpen(false)} />
      ) : null}
    </Modal>
  );
}
