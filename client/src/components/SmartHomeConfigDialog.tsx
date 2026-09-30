import { useState } from 'react';
import type * as Y from 'yjs';
import { api } from '../lib/api';
import { toggleInList, updateHomeConfig, useHomeConfig, type HomeEntity } from '../lib/smarthome';
import { Icon } from '../icons/Icon';
import { Modal } from './Modal';
import { toast } from './Toast';

function normalizeUrl(raw: string): string {
  const v = raw.trim().replace(/\/+$/, '');
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `http://${v}`;
}

/** Connexion à Home Assistant (adresse + jeton d'accès longue durée) et appareils masqués. */
export function SmartHomeConfigDialog({ doc, entities, onClose }: { doc: Y.Doc; entities?: HomeEntity[]; onClose: () => void }) {
  const cfg = useHomeConfig(doc);
  const [url, setUrl] = useState(cfg.url);
  const [token, setToken] = useState(cfg.token);
  const [insecure, setInsecure] = useState(cfg.insecure);
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const names = new Map((entities ?? []).map((e) => [e.id, e.name]));
  const canSave = Boolean(normalizeUrl(url) && token.trim());

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.homeTest({ url: normalizeUrl(url), token: token.trim(), insecure }));
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Test impossible.' });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    updateHomeConfig(doc, (c) => ({ ...c, url: normalizeUrl(url), token: token.trim(), insecure }));
    toast('Home Assistant est relié.');
    onClose();
  };

  const disconnect = () => {
    if (!confirm('Déconnecter Home Assistant ? Vos favoris et appareils masqués sont conservés.')) return;
    updateHomeConfig(doc, (c) => ({ ...c, url: '', token: '' }));
    onClose();
  };

  return (
    <Modal
      title="Maison connectée"
      onClose={onClose}
      width={600}
      footer={
        <>
          {cfg.url ? (
            <button type="button" className="nb-btn nb-btn--danger sh-disconnect" onClick={disconnect}>
              Déconnecter
            </button>
          ) : null}
          <button type="button" className="nb-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={save} disabled={!canSave}>
            Enregistrer
          </button>
        </>
      }
    >
      <p className="nb-muted sh-intro">
        Melo pilote vos appareils à travers <b>Home Assistant</b>, qui prend en charge la plupart des marques : Philips Hue, IKEA, Tapo et Kasa, Tuya et Smart
        Life, Shelly, Xiaomi, Sonoff, Netatmo, Somfy, caméras ONVIF et bien d’autres. Les échanges passent par le serveur Melo : le jeton n’est jamais envoyé
        au navigateur.
      </p>

      <label className="nb-field">
        <span>Adresse de Home Assistant, vue depuis le serveur Melo</span>
        <input className="nb-input" placeholder="http://192.168.1.10:8123" value={url} onChange={(ev) => setUrl(ev.target.value)} />
        <span className="nb-muted sh-hint">Même machine que Melo ? Indiquez son adresse IP locale (ex. http://192.168.1.10:8123), pas « localhost ».</span>
      </label>
      <div className="nb-field">
        <span>Jeton d’accès longue durée</span>
        <div className="nb-row nb-gap">
          <input
            className="nb-input"
            type={showToken ? 'text' : 'password'}
            placeholder="eyJhbGciOi…"
            value={token}
            onChange={(ev) => setToken(ev.target.value)}
            autoComplete="off"
            aria-label="Jeton d’accès longue durée"
          />
          <button type="button" className="nb-btn" onClick={() => setShowToken((v) => !v)}>
            {showToken ? 'Masquer' : 'Afficher'}
          </button>
        </div>
      </div>
      <label className="nb-check">
        <input type="checkbox" checked={insecure} onChange={(ev) => setInsecure(ev.target.checked)} /> Ignorer le certificat HTTPS (certificat
        auto-signé)
      </label>
      <div className="nb-row nb-gap">
        <button type="button" className="nb-btn" onClick={() => void test()} disabled={!canSave || testing}>
          {testing ? 'Test…' : 'Tester la connexion'}
        </button>
      </div>
      {result ? (
        <div className={result.ok ? 'nb-success' : 'nb-error'}>
          <Icon name={result.ok ? 'checkCircle' : 'xCircle'} size={15} /> {result.message}
        </div>
      ) : null}

      <details className="sh-help" open={!cfg.url}>
        <summary>Comment obtenir le jeton ?</summary>
        <ol>
          <li>Ouvrez Home Assistant dans un navigateur.</li>
          <li>Cliquez sur votre nom, en bas à gauche, puis sur l’onglet « Sécurité ».</li>
          <li>Tout en bas, dans « Jetons d’accès longue durée », cliquez sur « Créer un jeton » et nommez‑le « Melo ».</li>
          <li>Copiez le jeton affiché (il ne sera plus montré ensuite) et collez‑le ci‑dessus.</li>
        </ol>
        <p className="nb-muted">
          Pas encore de Home Assistant ? Installez l’application « Home Assistant » depuis la boutique de CasaOS, ouvrez‑la (port 8123) et laissez‑la
          découvrir vos appareils. Les pièces définies dans Home Assistant servent à regrouper les appareils ici.
        </p>
      </details>

      {cfg.hidden.length ? (
        <section className="nb-settings-section sh-hidden">
          <h3>Appareils masqués</h3>
          {cfg.hidden.map((id) => (
            <div key={id} className="hl-config-item">
              <span className="hl-config-name">{names.get(id) ?? id}</span>
              <button type="button" className="nb-btn nb-btn--sm" onClick={() => updateHomeConfig(doc, (c) => ({ ...c, hidden: toggleInList(c.hidden, id) }))}>
                <Icon name="eye" size={14} /> Réafficher
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </Modal>
  );
}
