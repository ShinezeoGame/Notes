import { useRef, useState } from 'react';
import type * as Y from 'yjs';
import { Modal } from './Modal';
import { api } from '../lib/api';
import {
  CATEGORIES,
  DEVICE_ICON_CHOICES,
  DEVICE_TYPES,
  SERVICE_ICON_CHOICES,
  SERVICE_TYPES,
  deviceVisual,
  isImageIcon,
  serviceVisual,
  defaultUrl,
  mediaStackPreset,
  newDevice,
  newService,
  saveHomelabConfig,
  useHomelabConfig,
  type Device,
  type DeviceType,
  type HomelabConfig,
  type Service,
  type ServiceType,
} from '../lib/homelab';
import { toast } from './Toast';
import { useAppCtx } from '../editor/context';
import { prepareImage } from '../lib/images';
import { AppTile, Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

type Props = { doc: Y.Doc; onClose: () => void };
type Tab = 'services' | 'devices' | 'general';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function HomelabConfigDialog({ doc, onClose }: Props) {
  const cfg = useHomelabConfig(doc);
  const [tab, setTab] = useState<Tab>('services');
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [presetHost, setPresetHost] = useState(() => hostOf(cfg.services[0]?.url ?? '') || '');
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [testing, setTesting] = useState(false);

  const save = (next: Partial<HomelabConfig>) => saveHomelabConfig(doc, { ...cfg, ...next });

  const upsertService = (s: Service) => {
    const exists = cfg.services.some((x) => x.id === s.id);
    save({ services: exists ? cfg.services.map((x) => (x.id === s.id ? s : x)) : [...cfg.services, s] });
    setEditingService(null);
    setTestResult(null);
  };
  const upsertDevice = (d: Device) => {
    const exists = cfg.devices.some((x) => x.id === d.id);
    save({ devices: exists ? cfg.devices.map((x) => (x.id === d.id ? d : x)) : [...cfg.devices, d] });
    setEditingDevice(null);
    setTestResult(null);
  };
  const move = <T,>(list: T[], index: number, dir: -1 | 1): T[] => {
    const next = [...list];
    const j = index + dir;
    if (j < 0 || j >= next.length) return next;
    [next[index], next[j]] = [next[j], next[index]];
    return next;
  };

  const addPreset = () => {
    const host = presetHost.trim();
    if (!host) return toast('Indiquez l’adresse IP ou le nom d’hôte de votre serveur.', 'error');
    const existing = new Set(cfg.services.map((s) => s.type));
    const added = mediaStackPreset(host).filter((s) => !existing.has(s.type));
    if (!added.length) return toast('Toutes les applications de la stack sont déjà présentes.');
    save({ services: [...cfg.services, ...added] });
    toast(`${added.length} application(s) ajoutée(s). Renseignez leurs clés API pour afficher les statistiques.`);
  };

  const runTest = async (payload: { service?: Service; device?: Device }) => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.homelabTest(payload);
      if (r.ok) {
        const details = 'stats' in r && Array.isArray(r.stats) && r.stats.length ? ` — ${r.stats.map((s) => `${s.label} : ${s.value}`).join(', ')}` : '';
        setTestResult({ ok: true, text: `Connexion réussie${'latency' in r && r.latency != null ? ` (${r.latency} ms)` : ''}${details}${r.error ? ` — ${r.error}` : ''}` });
      } else setTestResult({ ok: false, text: r.error || 'Échec' });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : 'Échec' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal title="Configurer le homelab" onClose={onClose} width={720}>
      <div className="nb-tabs">
        <button type="button" className={tab === 'services' ? 'active' : ''} onClick={() => setTab('services')}>
          Applications ({cfg.services.length})
        </button>
        <button type="button" className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>
          Appareils ({cfg.devices.length})
        </button>
        <button type="button" className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
          Général
        </button>
      </div>

      {tab === 'services' && !editingService ? (
        <div className="nb-tab-panel">
          <div className="hl-preset">
            <span className="nb-muted">Ajouter rapidement la stack multimédia (Jellyfin, Jellyseerr, Sonarr, Radarr, Prowlarr, Bazarr, qBittorrent) :</span>
            <div className="nb-row nb-gap">
              <input className="nb-input" placeholder="IP ou nom d’hôte, ex. 192.168.1.10" value={presetHost} onChange={(e) => setPresetHost(e.target.value)} />
              <button type="button" className="nb-btn" onClick={addPreset}>
                Ajouter la stack
              </button>
            </div>
          </div>
          <div className="hl-config-list">
            {cfg.services.length === 0 ? <div className="nb-muted">Aucune application.</div> : null}
            {cfg.services.map((s, i) => (
              <div key={s.id} className="hl-config-item">
                <VisualTile v={serviceVisual(s)} />
                <span className="hl-config-name">
                  {s.name || SERVICE_TYPES[s.type]?.label}
                  <span className="nb-muted"> · {SERVICE_TYPES[s.type]?.label ?? s.type} · {s.url}</span>
                </span>
                <button type="button" className="nb-icon-btn nb-icon-btn--sm" title="Monter" aria-label="Monter" onClick={() => save({ services: move(cfg.services, i, -1) })}>
                  <Icon name="arrowUp" size={14} />
                </button>
                <button type="button" className="nb-icon-btn nb-icon-btn--sm" title="Descendre" aria-label="Descendre" onClick={() => save({ services: move(cfg.services, i, 1) })}>
                  <Icon name="arrowDown" size={14} />
                </button>
                <button type="button" className="nb-btn nb-btn--sm" onClick={() => setEditingService({ ...s })}>Modifier</button>
                <button type="button" className="nb-btn nb-btn--sm nb-btn--danger" title="Supprimer" aria-label="Supprimer" onClick={() => confirm(`Supprimer « ${s.name} » ?`) && save({ services: cfg.services.filter((x) => x.id !== s.id) })}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => setEditingService(newService('sonarr'))}>
            <Icon name="plus" size={16} /> Ajouter une application
          </button>
        </div>
      ) : null}

      {tab === 'services' && editingService ? (
        <ServiceForm
          value={editingService}
          onChange={setEditingService}
          onCancel={() => {
            setEditingService(null);
            setTestResult(null);
          }}
          onSave={() => upsertService(editingService)}
          onTest={() => void runTest({ service: editingService })}
          testing={testing}
          testResult={testResult}
        />
      ) : null}

      {tab === 'devices' && !editingDevice ? (
        <div className="nb-tab-panel">
          <p className="nb-muted">
            Statistiques CPU, mémoire, disques et températures de vos machines (NAS, serveur…). Le plus universel : Glances en mode web sur chaque machine.
          </p>
          <div className="hl-config-list">
            {cfg.devices.length === 0 ? <div className="nb-muted">Aucun appareil.</div> : null}
            {cfg.devices.map((d, i) => (
              <div key={d.id} className="hl-config-item">
                <VisualTile v={deviceVisual(d)} />
                <span className="hl-config-name">
                  {d.name || DEVICE_TYPES[d.type]?.label}
                  <span className="nb-muted"> · {DEVICE_TYPES[d.type]?.label}{d.url ? ` · ${d.url}` : ''}</span>
                </span>
                <button type="button" className="nb-icon-btn nb-icon-btn--sm" title="Monter" aria-label="Monter" onClick={() => save({ devices: move(cfg.devices, i, -1) })}>
                  <Icon name="arrowUp" size={14} />
                </button>
                <button type="button" className="nb-icon-btn nb-icon-btn--sm" title="Descendre" aria-label="Descendre" onClick={() => save({ devices: move(cfg.devices, i, 1) })}>
                  <Icon name="arrowDown" size={14} />
                </button>
                <button type="button" className="nb-btn nb-btn--sm" onClick={() => setEditingDevice({ ...d })}>Modifier</button>
                <button type="button" className="nb-btn nb-btn--sm nb-btn--danger" title="Supprimer" aria-label="Supprimer" onClick={() => confirm(`Supprimer « ${d.name} » ?`) && save({ devices: cfg.devices.filter((x) => x.id !== d.id) })}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="nb-row nb-gap">
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => setEditingDevice(newDevice('glances'))}>
              <Icon name="plus" size={16} /> Ajouter un appareil
            </button>
            {!cfg.devices.some((d) => d.type === 'local') ? (
              <button type="button" className="nb-btn" onClick={() => upsertDevice(newDevice('local'))}>
                <Icon name="plus" size={16} /> Ajouter l’hôte de ce serveur
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'devices' && editingDevice ? (
        <DeviceForm
          value={editingDevice}
          onChange={setEditingDevice}
          onCancel={() => {
            setEditingDevice(null);
            setTestResult(null);
          }}
          onSave={() => upsertDevice(editingDevice)}
          onTest={() => void runTest({ device: editingDevice })}
          testing={testing}
          testResult={testResult}
        />
      ) : null}

      {tab === 'general' ? (
        <div className="nb-tab-panel">
          <label className="nb-field">
            <span>Intervalle d’actualisation (secondes)</span>
            <input
              className="nb-input"
              type="number"
              min={10}
              max={600}
              value={cfg.refreshSeconds}
              onChange={(e) => save({ refreshSeconds: Math.max(10, Math.min(600, Number(e.target.value) || 30)) })}
            />
          </label>
          <p className="nb-muted">
            Les clés API et mots de passe sont enregistrés dans votre espace de travail (synchronisé sur vos appareils et lu par le serveur). Ils ne sont jamais renvoyés au navigateur ni exposés aux pages partagées.
          </p>
          <p className="nb-muted">
            Astuce : tapez <code>/Homelab</code> dans une page pour y intégrer un aperçu du tableau de bord.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

type TestResult = { ok: boolean; text: string } | null;
type FormProps<T> = { value: T; onChange: (v: T) => void; onCancel: () => void; onSave: () => void; onTest: () => void; testing: boolean; testResult: TestResult };

function VisualTile({ v }: { v: { name: IconName; src?: string; color: string } }) {
  return <AppTile name={v.name} color={v.color} src={v.src} size={26} />;
}

function TestMessage({ result }: { result: TestResult }) {
  if (!result) return null;
  return (
    <div className={result.ok ? 'nb-success' : 'nb-error'}>
      <Icon name={result.ok ? 'checkCircle' : 'xCircle'} size={15} /> {result.text}
    </div>
  );
}

/** Choix de l'icône : icône du type par défaut, une icône du jeu, ou l'URL d'une image. */
function IconChoiceField({ value, choices, visual, onChange }: { value: string; choices: IconName[]; visual: { name: IconName; color: string }; onChange: (icon: string) => void }) {
  const [url, setUrl] = useState(isImageIcon(value) ? value : '');
  const app = useAppCtx();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Logo personnel : réduit à 256 px, transparence conservée.
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const src = await app.uploadFile(await prepareImage(file, 256, 256, false));
      setUrl(src);
      onChange(src);
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Envoi de l’image impossible.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nb-field hl-span2">
      <span>Icône</span>
      <div className="hl-icon-choices">
        <button type="button" className={`hl-icon-choice${!value ? ' hl-icon-choice--active' : ''}`} title="Icône par défaut" aria-label="Icône par défaut" onClick={() => { setUrl(''); onChange(''); }}>
          <AppTile name={visual.name} color={visual.color} size={26} />
        </button>
        {choices.map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            aria-label={name}
            className={`hl-icon-choice${value === name ? ' hl-icon-choice--active' : ''}`}
            style={{ color: visual.color }}
            onClick={() => {
              setUrl('');
              onChange(name);
            }}
          >
            <Icon name={name} size={18} />
          </button>
        ))}
      </div>
      <div className="nb-row nb-gap">
        <input
          className="nb-input"
          placeholder="…ou l’URL d’une image, par exemple https://…/logo.png"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            onChange(e.target.value.trim());
          }}
        />
        <button type="button" className="nb-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="upload" size={15} /> {busy ? 'Envoi…' : 'Importer une image'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          aria-label="Image de l’icône"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
    </div>
  );
}

function ServiceForm({ value, onChange, onCancel, onSave, onTest, testing, testResult }: FormProps<Service>) {
  const meta = SERVICE_TYPES[value.type];
  const set = (patch: Partial<Service>) => onChange({ ...value, ...patch });
  const changeType = (type: ServiceType) => {
    const m = SERVICE_TYPES[type];
    const host = hostOf(value.url);
    set({
      type,
      name: !value.name || value.name === meta.label ? (type === 'generic' ? '' : m.label) : value.name,
      icon: value.icon && value.icon !== meta.icon ? value.icon : '',
      category: value.category === meta.category || !value.category ? m.category : value.category,
      url: host && (!value.url || value.url === defaultUrl(value.type, host, 'service')) ? defaultUrl(type, host, 'service') : value.url,
    });
  };
  const canSave = Boolean(value.url.trim()) && Boolean(value.name.trim() || meta.label);
  return (
    <div className="nb-tab-panel hl-form">
      <div className="hl-form-grid">
        <label className="nb-field">
          <span>Type</span>
          <select className="nb-input" value={value.type} onChange={(e) => changeType(e.target.value as ServiceType)}>
            {(Object.keys(SERVICE_TYPES) as ServiceType[]).map((t) => (
              <option key={t} value={t}>
                {SERVICE_TYPES[t].label}
              </option>
            ))}
          </select>
        </label>
        <label className="nb-field">
          <span>Nom affiché</span>
          <input className="nb-input" value={value.name} placeholder={meta.label} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="nb-field hl-span2">
          <span>URL (ouverte au clic, et utilisée pour la vérification)</span>
          <input className="nb-input" placeholder={defaultUrl(value.type, '192.168.1.10', 'service') || 'https://…'} value={value.url} onChange={(e) => set({ url: e.target.value })} />
        </label>
        <label className="nb-field hl-span2">
          <span>URL interne (optionnel : adresse vue par le serveur Notes si différente, ex. http://sonarr:8989)</span>
          <input className="nb-input" value={value.internalUrl ?? ''} onChange={(e) => set({ internalUrl: e.target.value || undefined })} />
        </label>
        {meta.auth === 'apiKey' || meta.auth === 'token' ? (
          <label className="nb-field hl-span2">
            <span>{meta.auth === 'token' ? 'Jeton d’accès' : 'Clé API'}{meta.help ? ` — ${meta.help}` : ''}</span>
            <input className="nb-input" type="password" autoComplete="off" value={value.apiKey ?? ''} onChange={(e) => set({ apiKey: e.target.value })} />
          </label>
        ) : null}
        {meta.auth === 'password' ? (
          <label className="nb-field hl-span2">
            <span>Mot de passe / jeton{meta.help ? ` — ${meta.help}` : ''}</span>
            <input className="nb-input" type="password" autoComplete="off" value={value.password ?? ''} onChange={(e) => set({ password: e.target.value })} />
          </label>
        ) : null}
        {meta.auth === 'userpass' || meta.auth === 'userpass-optional' ? (
          <>
            <label className="nb-field">
              <span>Utilisateur{meta.auth === 'userpass-optional' ? ' (optionnel)' : ''}</span>
              <input className="nb-input" autoComplete="off" value={value.username ?? ''} onChange={(e) => set({ username: e.target.value })} />
            </label>
            <label className="nb-field">
              <span>Mot de passe{meta.help ? ` — ${meta.help}` : ''}</span>
              <input className="nb-input" type="password" autoComplete="off" value={value.password ?? ''} onChange={(e) => set({ password: e.target.value })} />
            </label>
          </>
        ) : null}
        <label className="nb-field">
          <span>Catégorie</span>
          <select className="nb-input" value={value.category} onChange={(e) => set({ category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <IconChoiceField value={value.icon} choices={SERVICE_ICON_CHOICES} visual={{ name: meta.icon, color: meta.color }} onChange={(icon) => set({ icon })} />
        <label className="nb-check hl-span2">
          <input type="checkbox" checked={Boolean(value.insecure)} onChange={(e) => set({ insecure: e.target.checked })} /> Ignorer le certificat TLS (auto-signé)
        </label>
      </div>
      <TestMessage result={testResult} />
      <div className="nb-row nb-gap nb-end hl-form-actions">
        <button type="button" className="nb-btn" onClick={onTest} disabled={testing || !value.url.trim()}>
          {testing ? 'Test…' : 'Tester'}
        </button>
        <button type="button" className="nb-btn" onClick={onCancel}>
          Annuler
        </button>
        <button type="button" className="nb-btn nb-btn--primary" onClick={onSave} disabled={!canSave}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}

function DeviceForm({ value, onChange, onCancel, onSave, onTest, testing, testResult }: FormProps<Device>) {
  const meta = DEVICE_TYPES[value.type];
  const set = (patch: Partial<Device>) => onChange({ ...value, ...patch });
  const changeType = (type: DeviceType) => {
    set({ type, icon: value.icon && value.icon !== meta.icon ? value.icon : '', insecure: type === 'proxmox' ? true : value.insecure, name: value.name || (type === 'local' ? 'Serveur' : '') });
  };
  const needsUrl = value.type !== 'local';
  const canSave = Boolean(value.name.trim()) && (!needsUrl || Boolean(value.url?.trim()));
  return (
    <div className="nb-tab-panel hl-form">
      <div className="hl-form-grid">
        <label className="nb-field">
          <span>Type</span>
          <select className="nb-input" value={value.type} onChange={(e) => changeType(e.target.value as DeviceType)}>
            {(Object.keys(DEVICE_TYPES) as DeviceType[]).map((t) => (
              <option key={t} value={t}>
                {DEVICE_TYPES[t].label}
              </option>
            ))}
          </select>
        </label>
        <label className="nb-field">
          <span>Nom affiché (ex. NAS, Serveur)</span>
          <input className="nb-input" value={value.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <p className="nb-muted hl-span2">{meta.help}</p>
        {needsUrl ? (
          <label className="nb-field hl-span2">
            <span>URL</span>
            <input className="nb-input" placeholder={defaultUrl(value.type, '192.168.1.20', 'device')} value={value.url ?? ''} onChange={(e) => set({ url: e.target.value })} />
          </label>
        ) : null}
        {value.type === 'local' ? (
          <label className="nb-field hl-span2">
            <span>Points de montage à surveiller (séparés par des virgules)</span>
            <input className="nb-input" placeholder="/, /data, /mnt/media" value={value.mounts ?? ''} onChange={(e) => set({ mounts: e.target.value })} />
          </label>
        ) : null}
        {meta.auth === 'userpass' || meta.auth === 'userpass-optional' ? (
          <>
            <label className="nb-field">
              <span>Utilisateur{meta.auth === 'userpass-optional' ? ' (optionnel)' : ''}</span>
              <input className="nb-input" autoComplete="off" value={value.username ?? ''} onChange={(e) => set({ username: e.target.value })} />
            </label>
            <label className="nb-field">
              <span>Mot de passe</span>
              <input className="nb-input" type="password" autoComplete="off" value={value.password ?? ''} onChange={(e) => set({ password: e.target.value })} />
            </label>
          </>
        ) : null}
        {meta.auth === 'pve-token' ? (
          <>
            <label className="nb-field">
              <span>Identifiant du jeton (utilisateur@pam!nom)</span>
              <input className="nb-input" placeholder="root@pam!notes" autoComplete="off" value={value.username ?? ''} onChange={(e) => set({ username: e.target.value })} />
            </label>
            <label className="nb-field">
              <span>Secret du jeton</span>
              <input className="nb-input" type="password" autoComplete="off" value={value.token ?? ''} onChange={(e) => set({ token: e.target.value })} />
            </label>
            <label className="nb-field">
              <span>Nœud (optionnel, premier nœud par défaut)</span>
              <input className="nb-input" value={value.node ?? ''} onChange={(e) => set({ node: e.target.value || undefined })} />
            </label>
          </>
        ) : null}
        {meta.auth === 'token' ? (
          <label className="nb-field hl-span2">
            <span>Clé API</span>
            <input className="nb-input" type="password" autoComplete="off" value={value.token ?? ''} onChange={(e) => set({ token: e.target.value })} />
          </label>
        ) : null}
        <IconChoiceField value={value.icon ?? ''} choices={DEVICE_ICON_CHOICES} visual={{ name: meta.icon, color: meta.color }} onChange={(icon) => set({ icon })} />
        {needsUrl ? (
          <label className="nb-check">
            <input type="checkbox" checked={Boolean(value.insecure)} onChange={(e) => set({ insecure: e.target.checked })} /> Ignorer le certificat TLS
          </label>
        ) : null}
      </div>
      <TestMessage result={testResult} />
      <div className="nb-row nb-gap nb-end hl-form-actions">
        <button type="button" className="nb-btn" onClick={onTest} disabled={testing || (needsUrl && !value.url?.trim())}>
          {testing ? 'Test…' : 'Tester'}
        </button>
        <button type="button" className="nb-btn" onClick={onCancel}>
          Annuler
        </button>
        <button type="button" className="nb-btn nb-btn--primary" onClick={onSave} disabled={!canSave}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
