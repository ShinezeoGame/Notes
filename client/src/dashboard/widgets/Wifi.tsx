// Widget « Wi-Fi invités » : QR code à scanner avec l'appareil photo d'un téléphone pour rejoindre le réseau, sans
// dicter le mot de passe. Nom du réseau et mot de passe affichés (au choix), copie du mot de passe, affichage en grand.
import { useState } from 'react';
import { QrCode } from '../../components/QrCode';
import { Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import { Icon } from '../../icons/Icon';
import { bool, str, type SettingsProps, type WidgetProps } from '../types';
import { t } from '../../lib/i18n';

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

/** Valeur d'un champ du format WIFI: (caractères spéciaux échappés ; entre guillemets si elle ressemble à de l'hexadécimal). */
function field(value: string): string {
  const escaped = value.replace(/([\\;,:"])/g, '\\$1');
  return /^[0-9A-Fa-f]+$/.test(value) ? `"${escaped}"` : escaped;
}

/** Texte du QR code de connexion (format lu par l'appareil photo d'Android et d'iPhone). */
export function wifiPayload(ssid: string, password: string, security: WifiSecurity, hidden: boolean): string {
  const parts = [`T:${security}`, `S:${field(ssid)}`];
  if (security !== 'nopass') parts.push(`P:${field(password)}`);
  if (hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

const security = (v: unknown): WifiSecurity => (v === 'WEP' || v === 'nopass' ? v : 'WPA');

function readConfig(config: Record<string, unknown>) {
  const sec = security(config.security);
  return {
    ssid: str(config.ssid).trim(),
    password: sec === 'nopass' ? '' : str(config.password),
    security: sec,
    hidden: bool(config.hidden),
    showPassword: bool(config.showPassword, true),
  };
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('Mot de passe copié.'));
  } catch {
    toast(t('Copie impossible : sélectionnez le mot de passe à la main.'), 'error');
  }
}

export function WifiWidget({ widget, editing, openSettings }: WidgetProps) {
  const c = readConfig(widget.config);
  const [big, setBig] = useState(false);
  if (!c.ssid || (c.security !== 'nopass' && !c.password)) {
    return (
      <div className="w-empty">
        <Icon name="wifi" size={22} />
        <span>{t('Indiquez le nom du réseau Wi-Fi et son mot de passe.')}</span>
        <button type="button" className="nb-btn nb-btn--sm" onClick={openSettings} disabled={editing}>
          {t('Configurer')}
        </button>
      </div>
    );
  }
  const payload = wifiPayload(c.ssid, c.password, c.security, c.hidden);
  return (
    <div className="w-wifi">
      <div className="w-wifi-code">
        <button type="button" className="w-wifi-qr" onClick={() => setBig(true)} disabled={editing} title={t('Afficher en grand')} aria-label={t('Afficher en grand')}>
          <QrCode text={payload} size={160} label={t('QR code du Wi-Fi « {name} »', { name: c.ssid })} />
        </button>
      </div>
      <div className="w-wifi-info">
        <span className="w-wifi-hint">{t('Scannez avec l’appareil photo pour vous connecter')}</span>
        <b className="w-wifi-ssid">{c.ssid}</b>
        {c.password && c.showPassword ? (
          <span className="w-wifi-pass">
            <span className="nb-mono">{c.password}</span>
            <button type="button" className="nb-icon-btn nb-icon-btn--sm" onClick={() => void copy(c.password)} title={t('Copier le mot de passe')} disabled={editing}>
              <Icon name="copy" size={13} />
            </button>
          </span>
        ) : null}
      </div>
      {big ? (
        <Modal title={c.ssid} onClose={() => setBig(false)} width={520}>
          <div className="w-wifi-big">
            <QrCode text={payload} size={360} label={t('QR code du Wi-Fi « {name} »', { name: c.ssid })} />
            <p>{t('Ouvrez l’appareil photo du téléphone, visez le code, puis touchez « Se connecter ».')}</p>
            {c.password && c.showPassword ? (
              <div className="w-wifi-big-pass">
                <span className="nb-muted">{t('Mot de passe')}</span>
                <span className="nb-mono">{c.password}</span>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function WifiSettings({ config, set }: SettingsProps) {
  const c = readConfig(config);
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label className="nb-field">
        <span>{t('Nom du réseau (SSID)')}</span>
        <input className="nb-input" value={str(config.ssid)} onChange={(e) => set({ ssid: e.target.value })} maxLength={64} spellCheck={false} />
      </label>
      <label className="nb-field">
        <span>{t('Sécurité')}</span>
        <select className="nb-input" value={c.security} onChange={(e) => set({ security: e.target.value })}>
          <option value="WPA">{t('WPA / WPA2 / WPA3 (le plus courant)')}</option>
          <option value="WEP">{t('WEP (ancien)')}</option>
          <option value="nopass">{t('Aucune (réseau ouvert)')}</option>
        </select>
      </label>
      {c.security !== 'nopass' ? (
        <label className="nb-field">
          <span>{t('Mot de passe')}</span>
          <div className="nb-row nb-gap">
            <input
              className="nb-input"
              type={visible ? 'text' : 'password'}
              value={str(config.password)}
              onChange={(e) => set({ password: e.target.value })}
              maxLength={128}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="nb-icon-btn" onClick={() => setVisible((v) => !v)} title={visible ? t('Masquer') : t('Afficher')}>
              <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
            </button>
          </div>
        </label>
      ) : null}
      <p className="nb-muted w-wifi-help">{t('Le nom et le mot de passe sont souvent écrits sous la box, ou dans son application.')}</p>
      <label className="nb-check">
        <input type="checkbox" checked={c.showPassword} onChange={(e) => set({ showPassword: e.target.checked })} />
        {t('Afficher le mot de passe sous le QR code')}
      </label>
      <label className="nb-check">
        <input type="checkbox" checked={c.hidden} onChange={(e) => set({ hidden: e.target.checked })} />
        {t('Réseau masqué (son nom n’apparaît pas dans la liste des Wi-Fi)')}
      </label>
    </>
  );
}
