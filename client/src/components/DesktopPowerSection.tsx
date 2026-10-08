// Application Ostal pour Windows reliée à un serveur : option « Pouvoir éteindre cet ordinateur depuis Ostal ». Ostal
// démarre alors avec Windows, reste dans la zone de notification et attend les ordres du serveur (server/src/power.js) :
// le widget « Allumer un PC » de l'accueil ou du téléphone éteint l'ordinateur d'un appui.
import { useEffect, useState } from 'react';
import { desktop, type DesktopPower } from '../lib/desktop';
import { serverBase } from '../lib/api';
import { getSettings } from '../lib/settings';
import { t } from '../lib/i18n';
import { toast } from './Toast';

/** Serveur et espace où l'application Windows attend les ordres : ceux de cette fenêtre. */
function where() {
  const s = getSettings();
  return { server: desktop()?.serverUrl ?? serverBase() ?? '', wsId: s.workspaceId, key: s.workspaceKey };
}

/** Option offerte : application assez récente, fenêtre reliée à un serveur (l'espace de l'ordinateur ne l'est pas). */
export function desktopPowerAvailable(): boolean {
  const app = desktop();
  return Boolean(app?.setPower && app.power && app.mode === 'server' && serverBase());
}

/** Au démarrage : option active, l'application reprend le serveur et l'espace de cette fenêtre (liaison changée). */
export async function syncDesktopPower(): Promise<void> {
  const app = desktop();
  if (!desktopPowerAvailable() || !app?.power || !app.setPower) return;
  try {
    const p = await app.power();
    if (p?.enabled) await app.setPower(true, where());
  } catch {
    // Ancienne application ou pont indisponible : rien à faire.
  }
}

export function DesktopPowerSection() {
  const app = desktop();
  const [power, setPower] = useState<DesktopPower | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void app
      ?.power?.()
      .then((p) => alive && setPower(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [app]);

  if (!app?.setPower || !power) return null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const p = await app.setPower!(enabled, where());
      if (p) setPower(p);
      toast(enabled ? t('Cet ordinateur peut maintenant être éteint depuis Ostal.') : t('Extinction à distance désactivée.'));
    } catch {
      toast(t('Réglage impossible.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="nb-settings-section">
      <h3>{t('Cet ordinateur')}</h3>
      <label className="nb-check">
        <input type="checkbox" checked={power.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
        {t('Pouvoir éteindre cet ordinateur depuis Ostal (téléphone, accueil)')}
      </label>
      <p className="nb-muted dp-note">
        {t(
          'Sur le widget « Allumer un PC », un appui sur cet ordinateur allumé l’éteint (Windows s’arrête 30 secondes plus tard). Ostal démarre alors avec Windows et reste près de l’horloge, dans la zone de notification : fermer la fenêtre ne le quitte plus (clic droit sur son icône → Quitter).',
        )}
      </p>
      {power.macs.length ? (
        <p className="nb-muted dp-note">
          {t('Adresses MAC de {name} : {macs}. Le widget doit utiliser l’une d’elles.', { name: power.name, macs: power.macs.join(', ') })}
        </p>
      ) : null}
    </section>
  );
}
