// Caméras de surveillance reliées directement au serveur Melo (flux RTSP des caméras IP et enregistreurs, images ou
// flux MJPEG) : configuration dans le document de l'espace, adresses du direct signées par le serveur.
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { api, serverBase } from './api';
import { t } from './i18n';

export type CameraBrand = 'hikvision' | 'dahua' | 'reolink' | 'tapo' | 'ezviz' | 'foscam' | 'uniview' | 'axis' | 'rtsp' | 'image';

export type Camera = {
  id: string;
  name: string;
  brand: CameraBrand;
  /** Marques : adresse IP (ou nom) de la caméra, port RTSP, canal de l'enregistreur. */
  host?: string;
  port?: number;
  channel?: number;
  username?: string;
  password?: string;
  /** « Autre » et « image » : adresse complète du flux principal ; secondaire facultatif. */
  url?: string;
  subUrl?: string;
  /** Image en https avec un certificat auto-signé. */
  insecure?: boolean;
};

export type CamerasConfig = { cameras: Camera[] };

export type BrandInfo = { value: CameraBrand; label: string; port?: number; channel?: boolean; user?: string; hint?: string };

export const BRANDS: BrandInfo[] = [
  { value: 'hikvision', label: 'Hikvision, Annke, HiWatch, Safire', port: 554, channel: true, user: 'admin' }, // i18n-ignore
  { value: 'dahua', label: 'Dahua, Amcrest, Imou, Lorex', port: 554, channel: true, user: 'admin' }, // i18n-ignore
  { value: 'reolink', label: 'Reolink', port: 554, channel: true, user: 'admin' },
  {
    value: 'tapo',
    label: 'TP-Link Tapo, Vigi', // i18n-ignore
    port: 554,
    hint: t(
      'Créez d’abord un « compte de la caméra » dans l’application Tapo (réglages de la caméra → Paramètres avancés → Compte de la caméra) et saisissez-le ici.',
    ),
  },
  {
    value: 'ezviz',
    label: 'Ezviz', // i18n-ignore
    port: 554,
    user: 'admin',
    hint: t(
      'Identifiant « admin » ; mot de passe : le code de vérification à 6 lettres inscrit sous la caméra. Activez le flux RTSP dans l’application Ezviz s’il est proposé.',
    ),
  },
  { value: 'foscam', label: 'Foscam', port: 88, user: 'admin' },
  { value: 'uniview', label: 'Uniview (UNV)', port: 554, channel: true, user: 'admin' },
  { value: 'axis', label: 'Axis', port: 554, user: 'root' },
  {
    value: 'rtsp',
    label: t('Autre caméra ou enregistreur (adresse RTSP)'),
    hint: t(
      'L’adresse du flux figure dans la notice ou les réglages de la caméra (souvent rubrique « Réseau » ou « RTSP »), par exemple rtsp://192.168.1.20:554/stream1.',
    ),
  },
  {
    value: 'image',
    label: t('Image ou flux MJPEG (adresse http)'),
    hint: t('Adresse d’une image (JPEG, actualisée chaque seconde) ou d’un flux MJPEG : MotionEye, ESP32-CAM, anciennes caméras IP…'),
  },
];

export const brandInfo = (brand: CameraBrand): BrandInfo => BRANDS.find((b) => b.value === brand) ?? BRANDS[BRANDS.length - 2];

export function readCamerasConfig(doc: Y.Doc): CamerasConfig {
  try {
    const raw = JSON.parse(String(doc.getMap('cameras').get('config') ?? '{}')) as Partial<CamerasConfig>;
    return { cameras: Array.isArray(raw.cameras) ? raw.cameras.filter((c) => c && typeof c.id === 'string') : [] };
  } catch {
    return { cameras: [] };
  }
}

export function updateCamerasConfig(doc: Y.Doc, change: (cfg: CamerasConfig) => CamerasConfig) {
  doc.getMap('cameras').set('config', JSON.stringify(change(readCamerasConfig(doc))));
}

export function useCamerasConfig(doc: Y.Doc | null): CamerasConfig {
  const [cfg, setCfg] = useState<CamerasConfig>(() => (doc ? readCamerasConfig(doc) : { cameras: [] }));
  useEffect(() => {
    if (!doc) return;
    const map = doc.getMap('cameras');
    const read = () => setCfg(readCamerasConfig(doc));
    map.observe(read);
    read();
    return () => map.unobserve(read);
  }, [doc]);
  return cfg;
}

/** Caméra telle que la décrit le serveur : pas d'identifiants, seulement l'adresse signée du direct. */
export type CameraLink = { id: string; name: string; kind: 'video' | 'image'; live: string };
export type CamerasStatus = { ffmpeg: boolean; cameras: CameraLink[] };
export type CameraTestResult = { ok: boolean; message: string; preview?: string; hevc?: boolean };

/** Adresse absolue du direct d'une caméra (« sd » : flux secondaire, pour les miniatures ; « hd » : flux principal). */
export function liveUrl(link: CameraLink, quality: 'sd' | 'hd'): string {
  return `${serverBase() ?? ''}${link.live}&q=${quality}`;
}

const REFRESH = 20 * 60_000;

/** Événement : le serveur a refusé une adresse du direct (expirée, ou clé du serveur changée) ; les renouveler. */
export const CAMERA_LINKS_EXPIRED = 'melo:camera-links-expired';

/**
 * Configuration et adresses du direct, renouvelées toutes les 20 minutes (elles expirent au bout d'une heure), dès
 * qu'une caméra est ajoutée ou retirée, et dès que le serveur en refuse une.
 */
export function useCameras(doc: Y.Doc | null) {
  const cfg = useCamerasConfig(doc);
  const hasServer = Boolean(serverBase());
  const [status, setStatus] = useState<CamerasStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Triés : réordonner les caméras ne redemande pas leurs adresses au serveur.
  const ids = cfg.cameras.map((c) => c.id).sort().join(',');
  useEffect(() => {
    if (!hasServer || !ids) {
      setStatus(null);
      return;
    }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async (attempt = 0) => {
      try {
        const data = await api.cameras();
        if (!alive) return;
        setStatus(data);
        setError(null);
        // Caméra ajoutée à l'instant sur cet appareil : le serveur ne l'a peut-être pas encore reçue.
        if (ids.split(',').some((id) => !data.cameras.some((c) => c.id === id)) && attempt < 8) {
          retry = setTimeout(() => void load(attempt + 1), 750);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : t('Serveur injoignable.'));
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH);
    // Adresse refusée : nouvelles adresses tout de suite (une demande toutes les 10 s au plus).
    let renewedAt = 0;
    const onExpired = () => {
      if (Date.now() - renewedAt < 10_000) return;
      renewedAt = Date.now();
      void load();
    };
    window.addEventListener(CAMERA_LINKS_EXPIRED, onExpired);
    return () => {
      alive = false;
      clearTimeout(retry);
      clearInterval(timer);
      window.removeEventListener(CAMERA_LINKS_EXPIRED, onExpired);
    };
  }, [hasServer, ids]);
  const links = new Map((status?.cameras ?? []).map((c) => [c.id, c]));
  return { cfg, hasServer, links, ffmpeg: status?.ffmpeg ?? true, error };
}

/** Empreinte des réglages d'une caméra : le direct redémarre quand ils changent (autre adresse, autre flux…). */
export function cameraVersion(c: Camera): string {
  const text = JSON.stringify([c.brand, c.host, c.port, c.channel, c.username, c.password, c.url, c.subUrl, c.insecure]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
