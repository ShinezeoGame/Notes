// Sauvegardes du serveur (Réglages → Sauvegardes, propriétaire du serveur) : état, sauvegarde à la demande,
// réglages (chaque nuit, nombre gardé, dossier, mot de passe), téléchargement, restauration (liste ou fichier).
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, serverBase, type BackupEntry, type BackupStatus, type RestoreResult } from '../lib/api';
import { desktop } from '../lib/desktop';
import { getSettings, updateSettings } from '../lib/settings';
import { forgetLocalCopy } from '../lib/yjs';
import { DOCS_BASE } from '../lib/updates';
import { saveFile } from '../pdf/save';
import { fileSize } from '../lib/format';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { toast } from './Toast';
import { locale, t, tn, tServer } from '../lib/i18n';

const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : t('Erreur'));
const when = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

/** Après une restauration : espace repris (serveur réinstallé), copie locale oubliée, rechargement. */
async function applyRestore(r: RestoreResult) {
  const s = getSettings();
  if (r.wsId && r.wsId !== s.workspaceId) updateSettings({ workspaceId: r.wsId, lastPageId: null, expanded: {} });
  await forgetLocalCopy(r.gen);
}

/** Restauration d'un fichier choisi sur l'appareil (envoyé au serveur). */
async function restoreFile(file: File, password: string): Promise<RestoreResult> {
  const s = getSettings();
  let res: Response;
  try {
    res = await fetch(`${serverBase()}/api/backup/restore-file`, {
      method: 'PUT',
      headers: {
        'x-ws-id': s.workspaceId,
        'x-ws-key': s.workspaceKey,
        'x-backup-password': encodeURIComponent(password),
        'content-type': 'application/octet-stream',
      },
      body: file,
    });
  } catch {
    throw new ApiError(t('Serveur injoignable.'), 0);
  }
  const data = (await res.json().catch(() => null)) as (RestoreResult & { error?: string }) | null;
  if (!res.ok) throw new ApiError(tServer(data?.error ?? '') || t('Erreur {status}', { status: res.status }), res.status);
  return data!;
}

async function download(entry: BackupEntry) {
  const s = getSettings();
  const res = await fetch(`${serverBase()}/api/backup/files/${encodeURIComponent(entry.name)}`, {
    headers: { 'x-ws-id': s.workspaceId, 'x-ws-key': s.workspaceKey },
  });
  if (!res.ok) throw new ApiError(t('Téléchargement impossible.'), res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const kind = entry.encrypted
    ? { mime: 'application/octet-stream', ext: '.ostal', description: t('Sauvegarde d’Ostal') }
    : { mime: 'application/gzip', ext: '.gz', description: t('Sauvegarde d’Ostal') };
  const result = await saveFile(bytes, entry.name, kind);
  if (result === 'saved') toast(t('« {file} » est enregistré.', { file: entry.name }));
  else if (result === 'downloaded') toast(t('« {file} » est dans vos téléchargements.', { file: entry.name }));
}

/** Rubrique des Réglages : dernière sauvegarde et accès à la fenêtre (absente si ce n'est pas le propriétaire). */
export function BackupSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!serverBase() || getSettings().guest) return;
    let alive = true;
    api.backupStatus().then(
      (s) => alive && setStatus(s),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [open]);
  if (!status) return null;
  const last = status.list.find((b) => !b.beforeRestore) ?? status.list[0];
  return (
    <section className="nb-settings-section">
      <h3>{t('Sauvegardes')}</h3>
      <p className="nb-muted bk-summary">
        {last ? t('Dernière sauvegarde : {date}', { date: when(last.createdAt) }) : t('Aucune sauvegarde pour l’instant.')}
        {status.lastError ? <span className="bk-warn"> · {t('Dernière tentative échouée')}</span> : null}
      </p>
      <div>
        <button type="button" className="nb-btn" onClick={() => setOpen(true)}>
          <Icon name="shield" size={15} /> {t('Gérer les sauvegardes')}
        </button>
      </div>
      {open ? <BackupDialog onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

type Restoring = { entry: BackupEntry } | { file: File };

export function BackupDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState<Restoring | null>(null);
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const app = desktop();

  useEffect(() => {
    api.backupStatus().then(setStatus, (err) => setError(errorText(err)));
  }, []);

  /** Opération (bouton occupé, erreur affichée) ; vrai si elle a réussi. */
  const act = async (label: string, fn: () => Promise<void>): Promise<boolean> => {
    setBusy(label);
    setError('');
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy('');
    }
  };

  const change = (patch: Parameters<typeof api.backupSettings>[0]) => act('settings', async () => setStatus(await api.backupSettings(patch)));

  const runNow = () =>
    act('run', async () => {
      const r = await api.backupRun();
      setStatus(r.status);
      if (r.backup) toast(t('Sauvegarde faite : {size}.', { size: fileSize(r.backup.size) }));
    });

  const restore = () =>
    act('restore', async () => {
      if (!restoring) return;
      const r = 'entry' in restoring ? await api.backupRestore(restoring.entry.name, password) : await restoreFile(restoring.file, password);
      toast(t('Restauration terminée : Ostal recharge vos données.'));
      await applyRestore(r);
    });

  const chooseDir = async () => {
    const dir = await app?.chooseFolder?.(t('Dossier des sauvegardes'));
    if (dir) await change({ dir });
  };

  const needsPassword = Boolean(restoring && ('entry' in restoring ? restoring.entry.encrypted : /\.ostal$/i.test(restoring.file.name)));
  const last = status?.list.find((b) => !b.beforeRestore) ?? status?.list[0];

  return (
    <Modal title={t('Sauvegardes')} onClose={() => !busy && onClose()} width={600}>
      <p className="nb-muted bk-intro">
        {t('Tout votre serveur, copié dans une archive : pages, agenda, PDF, papiers, réglages de la maison, espaces des personnes invitées.')}
      </p>
      {!status && !error ? <p className="nb-muted">{t('Chargement…')}</p> : null}
      {status ? (
        <>
          <div className="bk-state">
            <Icon name={status.lastError ? 'alert' : last ? 'checkCircle' : 'shield'} size={18} />
            <div>
              <b>{last ? t('Dernière sauvegarde : {date}', { date: when(last.createdAt) }) : t('Aucune sauvegarde pour l’instant.')}</b>
              {status.lastError ? (
                <small className="bk-warn">
                  {t('Échec le {date} : {message}', { date: when(status.lastError.at), message: tServer(status.lastError.message) })}
                </small>
              ) : null}
            </div>
          </div>
          <div className="nb-row nb-gap bk-actions">
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => void runNow()} disabled={Boolean(busy)}>
              <Icon name={busy === 'run' ? 'refresh' : 'download'} size={15} className={busy === 'run' ? 'hl-spin' : undefined} />{' '}
              {busy === 'run' ? t('Sauvegarde…') : t('Sauvegarder maintenant')}
            </button>
            <button type="button" className="nb-btn" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
              <Icon name="upload" size={15} /> {t('Restaurer depuis un fichier…')}
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".gz,.tgz,.ostal,application/gzip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) {
                  setPassword('');
                  setRestoring({ file: f });
                }
              }}
            />
          </div>

          <div className="bk-settings">
            <label className="bk-check">
              <input type="checkbox" checked={status.auto} disabled={Boolean(busy)} onChange={(e) => void change({ auto: e.target.checked })} />
              <span>
                {status.dirKind === 'local' || status.dirKind === 'custom'
                  ? t('Une sauvegarde par jour, automatiquement (quand Ostal est ouvert)')
                  : t('Une sauvegarde chaque nuit, automatiquement (si quelque chose a changé)')}
              </span>
            </label>
            <label className="bk-row">
              <span>{t('Sauvegardes gardées')}</span>
              <select className="nb-input" value={status.keep} disabled={Boolean(busy)} onChange={(e) => void change({ keep: Number(e.target.value) })}>
                {status.keepChoices.map((n) => (
                  <option key={n} value={n}>
                    {tn(n, 'la dernière', 'les {n} dernières')}
                  </option>
                ))}
              </select>
            </label>
            <div className="bk-row bk-dir">
              <span>{t('Dossier')}</span>
              <div>
                {status.dirKind === 'docker' ? (
                  <p className="nb-muted">
                    {t('« sauvegardes », à côté du dossier « data » d’Ostal sur le serveur. Copiez-le de temps en temps sur un autre disque ;')}{' '}
                    <a href={`${DOCS_BASE}INSTALLATION.md#sauvegardes`} target="_blank" rel="noopener noreferrer">
                      {t('pour un disque USB ou un NAS, voir le guide')}
                    </a>
                    .
                  </p>
                ) : (
                  <p className="nb-mono bk-path">{status.dir}</p>
                )}
                {status.dirChoice && app?.chooseFolder ? (
                  <div className="nb-row nb-gap">
                    <button type="button" className="nb-btn nb-btn--sm" disabled={Boolean(busy)} onClick={() => void chooseDir()}>
                      <Icon name="folder" size={14} /> {t('Choisir un autre dossier…')}
                    </button>
                    {status.dirKind === 'custom' ? (
                      <button type="button" className="nb-btn nb-btn--sm" disabled={Boolean(busy)} onClick={() => void change({ dir: '' })}>
                        {t('Dossier par défaut')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {status.dirChoice ? (
                  <p className="nb-muted bk-hint">{t('Un dossier OneDrive, Google Drive ou Dropbox met aussi les sauvegardes à l’abri en ligne.')}</p>
                ) : null}
              </div>
            </div>
            <div className="bk-row bk-dir">
              <span>{t('Mot de passe')}</span>
              <div>
                {newPassword !== null ? (
                  <form
                    className="nb-row nb-gap"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void change({ password: newPassword }).then((ok) => ok && setNewPassword(null));
                    }}
                  >
                    <input
                      className="nb-input"
                      type="password"
                      autoFocus
                      value={newPassword}
                      minLength={6}
                      onChange={(e) => setNewPassword(e.target.value)}
                      aria-label={t('Nouveau mot de passe des sauvegardes')}
                    />
                    <button type="submit" className="nb-btn nb-btn--sm nb-btn--primary" disabled={newPassword.length < 6 || Boolean(busy)}>
                      {t('Enregistrer')}
                    </button>
                    <button type="button" className="nb-btn nb-btn--sm" onClick={() => setNewPassword(null)}>
                      {t('Annuler')}
                    </button>
                  </form>
                ) : status.encrypted ? (
                  <div className="nb-row nb-gap">
                    <span className="bk-lock">
                      <Icon name="lock" size={14} /> {t('Sauvegardes chiffrées')}
                    </span>
                    <button type="button" className="nb-btn nb-btn--sm" onClick={() => setNewPassword('')}>
                      {t('Changer')}
                    </button>
                    <button type="button" className="nb-btn nb-btn--sm" disabled={Boolean(busy)} onClick={() => void change({ password: null })}>
                      {t('Retirer')}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="nb-btn nb-btn--sm" onClick={() => setNewPassword('')}>
                    <Icon name="lock" size={14} /> {t('Protéger par un mot de passe')}
                  </button>
                )}
                <p className="nb-muted bk-hint">
                  {t('Les sauvegardes sont alors chiffrées : utile hors de chez vous (cloud, clé USB). Notez le mot de passe : sans lui, impossible de restaurer.')}
                </p>
              </div>
            </div>
          </div>

          <h4 className="bk-list-title">{tn(status.list.length, '{n} sauvegarde', '{n} sauvegardes')}</h4>
          {status.list.length ? (
            <ul className="bk-list">
              {status.list.map((b) => (
                <li key={b.name} className="bk-item">
                  <div className="bk-item-text">
                    <b>{when(b.createdAt)}</b>
                    <small>
                      {fileSize(b.size)}
                      {b.encrypted ? ` · ${t('chiffrée')}` : ''}
                      {b.beforeRestore ? ` · ${t('avant une restauration')}` : ''}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="nb-icon-btn"
                    title={t('Télécharger')}
                    aria-label={t('Télécharger la sauvegarde du {date}', { date: when(b.createdAt) })}
                    disabled={Boolean(busy)}
                    onClick={() => void act('download', () => download(b))}
                  >
                    <Icon name="download" size={16} />
                  </button>
                  <button
                    type="button"
                    className="nb-btn nb-btn--sm"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setPassword('');
                      setRestoring({ entry: b });
                    }}
                  >
                    {t('Restaurer')}
                  </button>
                  <button
                    type="button"
                    className="nb-icon-btn"
                    title={t('Supprimer')}
                    aria-label={t('Supprimer la sauvegarde du {date}', { date: when(b.createdAt) })}
                    disabled={Boolean(busy)}
                    onClick={() => void act('delete', async () => setStatus(await api.backupDelete(b.name)))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="nb-muted">{t('Faites la première maintenant : elle ne prend que quelques secondes.')}</p>
          )}
        </>
      ) : null}
      {error && !restoring ? <div className="nb-error">{error}</div> : null}

      {restoring ? (
        <Modal
          title={t('Restaurer cette sauvegarde ?')}
          onClose={() => !busy && setRestoring(null)}
          width={460}
          footer={
            <>
              <button type="button" className="nb-btn" disabled={Boolean(busy)} onClick={() => setRestoring(null)}>
                {t('Annuler')}
              </button>
              <button type="button" className="nb-btn nb-btn--danger" disabled={Boolean(busy) || (needsPassword && !password)} onClick={() => void restore()}>
                {busy === 'restore' ? t('Restauration…') : t('Restaurer')}
              </button>
            </>
          }
        >
          <p>
            {'entry' in restoring
              ? t('Tout revient à l’état du {date}, sur tous vos appareils : ce qui a été fait depuis est remplacé.', { date: when(restoring.entry.createdAt) })
              : t('Tout revient à l’état de « {file} », sur tous vos appareils : ce qui a été fait depuis est remplacé.', { file: restoring.file.name })}
          </p>
          <p className="nb-muted">{t('L’état actuel est d’abord sauvegardé (« avant une restauration ») : vous pourrez y revenir.')}</p>
          {needsPassword || !('entry' in restoring) ? (
            <label className="nb-field">
              <span>{needsPassword ? t('Mot de passe de la sauvegarde') : t('Mot de passe (seulement si la sauvegarde en a un)')}</span>
              <input className="nb-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
          ) : null}
          {error ? <div className="nb-error">{error}</div> : null}
        </Modal>
      ) : null}
    </Modal>
  );
}
