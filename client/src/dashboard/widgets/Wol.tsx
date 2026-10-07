// Widget « Allumer un PC » : réveille un ordinateur du réseau local (Wake-on-LAN : le serveur Ostal envoie le signal
// sur son réseau) et montre s'il est allumé. Réglages : l'ordinateur choisi parmi les appareils trouvés sur le réseau,
// ou ses adresses saisies.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { isHost, parseMac, relayWarning, type WolDevice, type WolScan, type WolStatus } from '../../lib/wol';
import { Icon } from '../../icons/Icon';
import { str, type SettingsProps, type WidgetProps } from '../types';
import { t, tServer } from '../../lib/i18n';

/** Attente du démarrage après le signal, et rythme des vérifications. */
const BOOT_TIMEOUT = 180_000;
const CHECK_BOOTING = 3_000;
const CHECK_IDLE = 30_000;

const errorText = (err: unknown) => (err instanceof Error ? err.message : t('Erreur'));
const minutes = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type Phase = 'idle' | 'sending' | 'booting' | 'sent' | 'failed';

export function WolWidget({ widget, editing, openSettings }: WidgetProps) {
  const mac = parseMac(str(widget.config.mac));
  // Adresse saisie invalide (signalée dans les réglages) : état inconnu, signal envoyé quand même.
  const typed = str(widget.config.host).trim();
  const host = isHost(typed) ? typed : '';
  const broadcast = str(widget.config.broadcast).trim();
  const name = widget.title?.trim() || str(widget.config.name) || t('Ordinateur');
  const [status, setStatus] = useState<WolStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const check = useCallback(async () => {
    if (!host) return null;
    try {
      const s = await api.wolStatus({ host, mac: mac ?? undefined });
      setStatus(s);
      setError('');
      return s;
    } catch (err) {
      setError(errorText(err));
      return null;
    }
  }, [host, mac]);

  useEffect(() => setStatus(null), [host, mac]);

  // État vérifié régulièrement page visible, et au retour sur la page ; pendant un démarrage, la boucle ci-dessous
  // s'en charge.
  const booting = phase === 'booting';
  useEffect(() => {
    if (!host || booting) return;
    void check();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void check(), CHECK_IDLE);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [host, booting, check]);

  // Démarrage : vérifié toutes les 3 secondes jusqu'à ce que l'ordinateur réponde (3 minutes au plus).
  useEffect(() => {
    if (!booting) return;
    let cancelled = false;
    let timer = 0;
    const loop = async () => {
      const s = await check();
      if (cancelled) return;
      if (s?.online) setPhase('idle');
      else if (Date.now() - startedAt > BOOT_TIMEOUT) setPhase('failed');
      else timer = window.setTimeout(loop, CHECK_BOOTING);
    };
    timer = window.setTimeout(loop, CHECK_BOOTING);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(clock);
    };
  }, [booting, check, startedAt]);

  useEffect(() => {
    if (phase !== 'sent') return;
    const timer = window.setTimeout(() => setPhase('idle'), 6000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (!mac) {
    return (
      <div className="w-empty">
        <Icon name="power" size={26} />
        <button type="button" className="nb-btn nb-btn--sm" onClick={openSettings} disabled={editing}>
          {t('Choisir l’ordinateur')}
        </button>
      </div>
    );
  }

  const wake = async () => {
    if (phase === 'sending' || booting) return;
    setPhase('sending');
    setError('');
    setWarning('');
    try {
      const r = await api.wolWake({ mac, host: host || undefined, broadcast: isHost(broadcast) ? broadcast : undefined });
      setWarning(relayWarning(r));
      if (host) {
        setStartedAt(Date.now());
        setNow(Date.now());
        setPhase('booting');
      } else setPhase('sent');
    } catch (err) {
      setError(errorText(err));
      setPhase('idle');
    }
  };

  const online = Boolean(host && status?.online);
  const busy = phase === 'sending' || booting;
  let tone: 'on' | 'off' | 'busy' | 'warn' | 'unknown' = 'unknown';
  let label = '';
  if (phase === 'sending') [tone, label] = ['busy', t('Envoi du signal…')];
  else if (booting) [tone, label] = ['busy', t('Démarrage… {time}', { time: minutes(now - startedAt) })];
  else if (phase === 'sent') [tone, label] = ['on', t('Signal envoyé')];
  else if (online) [tone, label] = ['on', t('Allumé')];
  else if (phase === 'failed') [tone, label] = ['warn', t('Ne s’est pas allumé')];
  else if (status?.otherDevice) [tone, label] = ['warn', t('Adresse IP prise par un autre appareil')];
  else if (status) [tone, label] = ['off', t('Éteint')];
  else if (host) label = t('Vérification…');
  const hint =
    error ||
    warning ||
    (phase === 'failed' && !online ? t('Toujours éteint après 3 minutes : vérifiez la préparation de l’ordinateur (réglages du widget).') : '') ||
    (status?.otherDevice ? t('Choisissez de nouveau l’ordinateur dans les réglages du widget.') : '') ||
    (status?.error ? tServer(status.error) : '');

  return (
    <div className={`w-wol w-wol--${tone}`}>
      <button
        type="button"
        className={`w-wol-btn${busy ? ' is-busy' : ''}`}
        onClick={() => void wake()}
        disabled={editing || busy || online}
        aria-label={t('Allumer {name}', { name })}
        title={online ? t('Allumé') : t('Allumer')}
      >
        <Icon name="power" size={26} strokeWidth={2.2} />
      </button>
      <div className="w-wol-info" title={[name, label, hint].filter(Boolean).join('\n')}>
        <div className="w-wol-name">{name}</div>
        {label ? (
          <div className="w-wol-state" role="status">
            <span className="w-wol-dot" />
            <span className="w-wol-label">{label}</span>
          </div>
        ) : null}
        {hint ? <div className={`w-wol-hint${error ? ' w-wol-hint--error' : ''}`}>{hint}</div> : null}
      </div>
    </div>
  );
}

function DeviceList({ scan, selected, onChoose }: { scan: WolScan; selected: string | null; onChoose: (d: WolDevice) => void }) {
  const warning = relayWarning(scan);
  if (!scan.devices.length) {
    return (
      <div className="nb-error w-wol-scan-note">
        {warning || t('Aucun appareil trouvé : vérifiez que l’ordinateur est allumé et branché au même réseau que le serveur Ostal.')}
      </div>
    );
  }
  // L'appareil qui fait la recherche d'abord, puis ceux qui ont un nom ; la box à la fin.
  const rank = (d: WolDevice) => (d.you ? 0 : d.router ? 3 : d.name ? 1 : 2);
  const devices = [...scan.devices].sort((a, b) => rank(a) - rank(b));
  return (
    <>
      {warning ? <div className="nb-error w-wol-scan-note">{warning}</div> : null}
      <div className="w-wol-devices">
        {devices.map((d) => (
          <button
            key={d.ip}
            type="button"
            className={`w-wol-device${selected === d.mac ? ' is-selected' : ''}`}
            onClick={() => onChoose(d)}
            aria-pressed={selected === d.mac}
          >
            <Icon name={d.router ? 'globe' : 'monitor'} size={16} />
            <span className="w-wol-device-text">
              <b>{d.name || d.ip}</b>
              <small>{d.name ? `${d.ip} · ${d.mac}` : d.mac}</small>
            </span>
            {d.you ? <span className="w-wol-tag">{t('Cet appareil')}</span> : d.router ? <span className="w-wol-tag">{t('Box')}</span> : null}
            {selected === d.mac ? <Icon name="check" size={16} className="w-wol-check" /> : null}
          </button>
        ))}
      </div>
    </>
  );
}

export function WolSettings({ config, set }: SettingsProps) {
  const [scan, setScan] = useState<WolScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const macText = str(config.mac);
  const hostText = str(config.host);
  const broadcastText = str(config.broadcast);
  const mac = parseMac(macText);
  const search = async () => {
    setScanning(true);
    setScanError('');
    try {
      setScan(await api.wolScan());
    } catch (err) {
      setScanError(errorText(err));
    } finally {
      setScanning(false);
    }
  };
  return (
    <>
      <div className="nb-field">
        <span>{t('Ordinateur à allumer')}</span>
        <p className="w-wol-help">
          {t('Le serveur Ostal envoie le signal de réveil sur son réseau : l’ordinateur doit y être branché. Allumez-le, puis cherchez-le ici.')}
        </p>
        <div>
          <button type="button" className="nb-btn" onClick={() => void search()} disabled={scanning}>
            <Icon name={scanning ? 'refresh' : 'search'} size={15} className={scanning ? 'w-wol-spin' : undefined} />{' '}
            {scanning ? t('Recherche…') : scan ? t('Chercher de nouveau') : t('Chercher sur le réseau')}
          </button>
        </div>
        {scanError ? <div className="nb-error w-wol-scan-note">{scanError}</div> : null}
        {scan && !scanning ? <DeviceList scan={scan} selected={mac} onChoose={(d) => set({ mac: d.mac, host: d.ip, name: d.name })} /> : null}
      </div>
      <label className="nb-field">
        <span>{t('Adresse MAC (adresse physique)')}</span>
        <input
          className="nb-input"
          value={macText}
          onChange={(e) => set({ mac: e.target.value })}
          onBlur={() => mac && mac !== macText && set({ mac })}
          placeholder="AA:BB:CC:DD:EE:FF" // i18n-ignore
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
        />
      </label>
      {macText.trim() && !mac ? (
        <div className="nb-error w-wol-field-error">{t('Adresse MAC invalide : six paires de caractères, par exemple 1C:69:7A:0B:2E:4F.')}</div>
      ) : null}
      <label className="nb-field">
        <span>{t('Adresse IP ou nom (pour savoir s’il est allumé)')}</span>
        <input
          className="nb-input"
          value={hostText}
          onChange={(e) => set({ host: e.target.value })}
          placeholder="192.168.1.20"
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          inputMode="url"
        />
      </label>
      {hostText.trim() && !isHost(hostText.trim()) ? <div className="nb-error w-wol-field-error">{t('Adresse IP ou nom invalide.')}</div> : null}
      <details className="w-wol-details">
        <summary>{t('Préparer l’ordinateur (une seule fois)')}</summary>
        <ol>
          <li>{t('Reliez-le à la box par un câble réseau : le réveil par Wi-Fi ne marche presque jamais.')}</li>
          <li>
            {t(
              'Dans le BIOS (touche Suppr ou F2 au démarrage), activez « Wake on LAN » (parfois « Power On by PCI-E » ou « Resume by LAN ») et désactivez « ErP » s’il existe.',
            )}
          </li>
          <li>
            {t(
              'Sous Windows, Gestionnaire de périphériques › Cartes réseau › votre carte › Propriétés : onglet Gestion de l’alimentation, cochez « Autoriser ce périphérique à sortir l’ordinateur du mode veille » ; onglet Avancé, activez « Wake on Magic Packet ».',
            )}
          </li>
          <li>
            {t(
              'Désactivez le démarrage rapide de Windows : Panneau de configuration › Options d’alimentation › Choisir l’action des boutons d’alimentation › Modifier des paramètres actuellement non disponibles, puis décochez « Activer le démarrage rapide ».',
            )}
          </li>
          <li>{t('Éteignez l’ordinateur normalement (Démarrer › Arrêter), puis essayez le bouton du widget.')}</li>
        </ol>
      </details>
      <details className="w-wol-details">
        <summary>{t('Options avancées')}</summary>
        <label className="nb-field">
          <span>{t('Adresse de diffusion (facultatif)')}</span>
          <input
            className="nb-input"
            value={broadcastText}
            onChange={(e) => set({ broadcast: e.target.value })}
            placeholder="192.168.20.255"
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
          />
        </label>
        {broadcastText.trim() && !isHost(broadcastText.trim()) ? <div className="nb-error w-wol-field-error">{t('Adresse IP ou nom invalide.')}</div> : null}
        <p className="w-wol-help">
          {t('Seulement si l’ordinateur est sur un autre réseau que le serveur Ostal : le signal y est aussi envoyé.')}
        </p>
      </details>
    </>
  );
}
