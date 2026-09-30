import { useState } from 'react';
import type * as Y from 'yjs';
import { api } from '../lib/api';
import { BRANDS, brandInfo, updateCamerasConfig, type Camera, type CameraBrand, type CameraTestResult } from '../lib/cameras';
import { newId } from '../lib/ids';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { toast } from './Toast';

const isPreset = (brand: CameraBrand) => brand !== 'rtsp' && brand !== 'image';

/** Ajout ou réglage d'une caméra : marque, adresse, identifiants, puis essai avec un aperçu de l'image. */
export function CameraConfigDialog({ doc, camera, onClose }: { doc: Y.Doc; camera: Camera | null; onClose: () => void }) {
  const [form, setForm] = useState<Camera>(
    () => camera ?? { id: newId(), name: '', brand: 'hikvision', host: '', port: undefined, channel: 1, username: 'admin', password: '' },
  );
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<CameraTestResult | null>(null);
  const brand = brandInfo(form.brand);
  const preset = isPreset(form.brand);

  const set = (patch: Partial<Camera>) => {
    setForm((f) => ({ ...f, ...patch }));
    setResult(null);
  };
  const setBrand = (value: CameraBrand) => {
    const next = brandInfo(value);
    // Identifiant par défaut de la marque, si l'utilisateur n'en a pas saisi d'autre.
    const defaults = BRANDS.map((b) => b.user ?? '');
    set({ brand: value, username: !form.username || defaults.includes(form.username) ? next.user ?? form.username ?? '' : form.username });
  };

  const cleaned = (): Camera => {
    const c: Camera = { id: form.id, name: form.name.trim() || 'Caméra', brand: form.brand, username: form.username?.trim() ?? '', password: form.password ?? '' };
    if (preset) {
      c.host = form.host?.trim() ?? '';
      if (form.port) c.port = form.port;
      if (brand.channel) c.channel = form.channel || 1;
    } else {
      c.url = form.url?.trim() ?? '';
      if (form.brand === 'rtsp' && form.subUrl?.trim()) c.subUrl = form.subUrl.trim();
      if (form.brand === 'image' && form.insecure) c.insecure = true;
    }
    return c;
  };
  const complete = preset ? Boolean(form.host?.trim()) : Boolean(form.url?.trim());

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.cameraTest(cleaned()));
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Test impossible.' });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    const cam = cleaned();
    updateCamerasConfig(doc, (cfg) => {
      const cameras = [...cfg.cameras];
      const i = cameras.findIndex((c) => c.id === cam.id);
      if (i >= 0) cameras[i] = cam;
      else cameras.push(cam);
      return { ...cfg, cameras };
    });
    toast(camera ? `« ${cam.name} » est enregistrée.` : `« ${cam.name} » est ajoutée.`);
    onClose();
  };

  const remove = () => {
    if (!camera || !confirm(`Supprimer la caméra « ${camera.name} » ? Les blocs qui l’affichent dans vos pages resteront vides.`)) return;
    updateCamerasConfig(doc, (cfg) => ({ ...cfg, cameras: cfg.cameras.filter((c) => c.id !== camera.id) }));
    onClose();
  };

  return (
    <Modal
      title={camera ? `Réglages de « ${camera.name} »` : 'Ajouter une caméra'}
      onClose={onClose}
      width={620}
      footer={
        <>
          {camera ? (
            <button type="button" className="nb-btn nb-btn--danger sh-disconnect" onClick={remove}>
              Supprimer
            </button>
          ) : null}
          <button type="button" className="nb-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={save} disabled={!complete}>
            Enregistrer
          </button>
        </>
      }
    >
      <label className="nb-field">
        <span>Nom</span>
        <input className="nb-input" placeholder="Entrée, jardin, garage…" value={form.name} onChange={(ev) => set({ name: ev.target.value })} />
      </label>
      <label className="nb-field">
        <span>Marque</span>
        <select className="nb-input" value={form.brand} onChange={(ev) => setBrand(ev.target.value as CameraBrand)}>
          {BRANDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      {preset ? (
        <div className="cam-form-row">
          <label className="nb-field cam-form-host">
            <span>Adresse IP de la caméra{brand.channel ? ' ou de l’enregistreur' : ''}</span>
            <input className="nb-input" placeholder="192.168.1.20" value={form.host ?? ''} onChange={(ev) => set({ host: ev.target.value })} />
          </label>
          <label className="nb-field cam-form-small">
            <span>Port RTSP</span>
            <input
              className="nb-input"
              type="number"
              min={1}
              max={65535}
              placeholder={String(brand.port ?? 554)}
              value={form.port ?? ''}
              onChange={(ev) => set({ port: Number(ev.target.value) || undefined })}
            />
          </label>
          {brand.channel ? (
            <label className="nb-field cam-form-small">
              <span>Canal</span>
              <input
                className="nb-input"
                type="number"
                min={1}
                max={999}
                value={form.channel ?? 1}
                onChange={(ev) => set({ channel: Number(ev.target.value) || 1 })}
                title="Numéro de la caméra sur l’enregistreur (1 pour une caméra seule)"
              />
            </label>
          ) : null}
        </div>
      ) : form.brand === 'rtsp' ? (
        <>
          <label className="nb-field">
            <span>Adresse du flux vidéo</span>
            <input className="nb-input" placeholder="rtsp://192.168.1.20:554/stream1" value={form.url ?? ''} onChange={(ev) => set({ url: ev.target.value })} />
          </label>
          <label className="nb-field">
            <span>Adresse du flux secondaire, plus léger (facultatif : utilisé pour les miniatures)</span>
            <input className="nb-input" placeholder="rtsp://192.168.1.20:554/stream2" value={form.subUrl ?? ''} onChange={(ev) => set({ subUrl: ev.target.value })} />
          </label>
        </>
      ) : (
        <>
          <label className="nb-field">
            <span>Adresse de l’image ou du flux MJPEG</span>
            <input className="nb-input" placeholder="http://192.168.1.30:8081/" value={form.url ?? ''} onChange={(ev) => set({ url: ev.target.value })} />
          </label>
          {/^https:/i.test(form.url ?? '') ? (
            <label className="nb-check">
              <input type="checkbox" checked={Boolean(form.insecure)} onChange={(ev) => set({ insecure: ev.target.checked })} /> Ignorer le certificat HTTPS
              (certificat auto-signé)
            </label>
          ) : null}
        </>
      )}

      <div className="cam-form-row">
        <label className="nb-field cam-form-half">
          <span>Identifiant{preset ? '' : ' (facultatif)'}</span>
          <input className="nb-input" value={form.username ?? ''} onChange={(ev) => set({ username: ev.target.value })} autoComplete="off" />
        </label>
        <div className="nb-field cam-form-half">
          <span>Mot de passe{preset ? '' : ' (facultatif)'}</span>
          <div className="nb-row nb-gap">
            <input
              className="nb-input"
              type={showPassword ? 'text' : 'password'}
              value={form.password ?? ''}
              onChange={(ev) => set({ password: ev.target.value })}
              autoComplete="new-password"
              aria-label="Mot de passe de la caméra"
            />
            <button type="button" className="nb-btn" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Masquer' : 'Afficher'}
            </button>
          </div>
        </div>
      </div>
      {brand.hint ? <p className="nb-muted cam-hint">{brand.hint}</p> : null}

      <div className="nb-row nb-gap">
        <button type="button" className="nb-btn" onClick={() => void test()} disabled={!complete || testing}>
          {testing ? 'Connexion à la caméra…' : 'Tester'}
        </button>
      </div>
      {result ? (
        <div className={result.ok ? 'nb-success' : 'nb-error'}>
          <Icon name={result.ok ? 'checkCircle' : 'xCircle'} size={15} /> {result.message}
          {result.hevc ? (
            <span className="nb-muted cam-hint-inline">
              {' '}
              Vidéo H.265 : lue telle quelle par la plupart des téléphones, convertie par le serveur pour les autres appareils (plus gourmand ; réglez la
              caméra en H.264 si possible).
            </span>
          ) : null}
        </div>
      ) : null}
      {result?.preview ? <img className="cam-preview" src={result.preview} alt="Aperçu de la caméra" /> : null}

      <details className="sh-help">
        <summary>Où trouver ces informations ?</summary>
        <ul>
          <li>
            <b>Adresse IP</b> : dans l’application de la caméra (informations de l’appareil) ou dans la liste des appareils connectés de votre box. Donnez‑lui
            une adresse fixe dans la box (réservation DHCP) pour qu’elle ne change pas.
          </li>
          <li>
            <b>Identifiant et mot de passe</b> : ceux de la caméra (ou de l’enregistreur), souvent « admin » et le mot de passe choisi à l’installation.
          </li>
          <li>
            Le flux <b>RTSP</b> doit être activé dans les réglages de la caméra (rubrique réseau, parfois « RTSP » ou « ONVIF »). Le serveur Melo doit être
            sur le même réseau que la caméra.
          </li>
          <li>Les miniatures utilisent le flux secondaire de la caméra (plus léger) ; la vue agrandie, le flux principal. La vidéo est transmise sans le son.</li>
        </ul>
        <p className="nb-muted">Les identifiants restent sur votre serveur Melo et vos appareils ; la vidéo passe par le serveur.</p>
      </details>
    </Modal>
  );
}
