// Widgets Caméras, Maison et Homelab : les panneaux des sections du même nom, en version compacte.
import { CamerasPanel } from '../../components/CamerasView';
import { SmartHomePanel } from '../../components/SmartHomeView';
import { HomelabPanel } from '../../components/HomelabView';
import { useCamerasConfig } from '../../lib/cameras';
import { cardLayout, cardOrder, configStatusKey, saveCardOrder, saveCardSize, useHomelabConfig } from '../../lib/homelab';
import { navigate } from '../../lib/router';
import { bool, str, type SettingsProps, type WidgetProps } from '../types';
import { t } from '../../lib/i18n';

export function CamerasWidget({ widget, doc }: WidgetProps) {
  return (
    <div className="w-panel w-cameras">
      <CamerasPanel doc={doc} cameraId={str(widget.config.cameraId) || undefined} compact canConfigure={false} />
    </div>
  );
}

export function CamerasSettings({ config, set, doc }: SettingsProps) {
  const cfg = useCamerasConfig(doc);
  return (
    <label className="nb-field">
      <span>{t('Caméras affichées')}</span>
      <select className="nb-input" value={str(config.cameraId)} onChange={(e) => set({ cameraId: e.target.value })}>
        <option value="">{t('Toutes')}</option>
        {cfg.cameras.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SmartHomeWidget({ widget, doc }: WidgetProps) {
  return (
    <div className="w-panel w-smarthome">
      <SmartHomePanel doc={doc} compact favoritesOnly={bool(widget.config.favoritesOnly, true)} canConfigure={false} />
    </div>
  );
}

export function SmartHomeSettings({ config, set }: SettingsProps) {
  return (
    <label className="nb-check">
      <input type="checkbox" checked={bool(config.favoritesOnly, true)} onChange={(e) => set({ favoritesOnly: e.target.checked })} />{' '}
      {t('Favoris seulement (★ dans la section Maison)')}
    </label>
  );
}

export function HomelabWidget({ doc }: WidgetProps) {
  const cfg = useHomelabConfig(doc);
  const configured = cfg.services.length > 0 || cfg.devices.length > 0;
  return (
    <div className="w-panel w-homelab">
      <HomelabPanel
        compact
        configured={configured}
        refreshSeconds={cfg.refreshSeconds}
        layout={cardLayout(cfg)}
        onResize={(id, size) => saveCardSize(doc, id, size)}
        order={cardOrder(cfg)}
        onReorder={(ids) => saveCardOrder(doc, ids)}
        grouped={cfg.grouped}
        onConfigure={() => navigate('#/homelab')}
        refreshKey={configStatusKey(cfg)}
      />
    </div>
  );
}
