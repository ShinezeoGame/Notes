// Navigation entre les sections de l'application : barre verticale à gauche sur ordinateur, barre d'onglets en bas sur
// téléphone (les sections qui n'y tiennent pas sont dans « Plus »). Ordre et sections masquées : réglages d'apparence.
import { useEffect, useState } from 'react';
import type { SectionId } from '../lib/appearance';
import type { ConnStatus } from '../lib/yjs';
import { promptInstall, useInstallState } from '../lib/pwa';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { useMediaQuery } from '../lib/hooks';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

export const SECTIONS: Record<SectionId, { label: string; icon: IconName; hash: string }> = {
  home: { label: 'Accueil', icon: 'dashboard', hash: '#/' },
  notes: { label: 'Notes', icon: 'note', hash: '#/notes' },
  agenda: { label: 'Agenda', icon: 'calendar', hash: '#/agenda' },
  smarthome: { label: 'Maison', icon: 'bulb', hash: '#/maison' },
  cameras: { label: 'Caméras', icon: 'cctv', hash: '#/cameras' },
  homelab: { label: 'Homelab', icon: 'server', hash: '#/homelab' },
  pdf: { label: 'PDF', icon: 'filePdf', hash: '#/pdf' },
};

export const STATUS_LABEL: Record<ConnStatus, string> = {
  offline: 'Hors ligne (appareil seul)',
  connecting: 'Connexion au serveur…',
  connected: 'Synchronisé',
  disconnected: 'Déconnecté – nouvelle tentative…',
  denied: 'Accès refusé par le serveur',
  outdated: 'Mise à jour de Notes nécessaire',
};

/** Sections affichées sur la barre d'onglets du téléphone, avant « Plus ». */
const MOBILE_TABS = 4;

type Props = {
  active: SectionId;
  sections: SectionId[];
  hidden: SectionId[];
  status: ConnStatus;
  mobile: boolean;
  onNavigate: (section: SectionId) => void;
  onSearch: () => void;
  onSettings: () => void;
  onCustomize: () => void;
};

export function AppNav({ active, sections, hidden, status, mobile, onNavigate, onSearch, onSettings, onCustomize }: Props) {
  const settings = useSettings();
  const install = useInstallState();
  // Proposition d'installation seulement sur ordinateur (tablettes et téléphones ont l'application Android).
  const pointer = useMediaQuery('(pointer: fine)');
  const [moreOpen, setMoreOpen] = useState(false);
  const visible = sections.filter((s) => !hidden.includes(s));
  const collapsed = !mobile && settings.navCollapsed;

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const item = (id: SectionId, extraClass = '') => {
    const s = SECTIONS[id];
    return (
      <button
        key={id}
        type="button"
        className={`nb-nav-item${active === id ? ' nb-nav-item--active' : ''}${extraClass}`}
        onClick={() => {
          setMoreOpen(false);
          onNavigate(id);
        }}
        aria-current={active === id ? 'page' : undefined}
        title={collapsed ? s.label : undefined}
      >
        <Icon name={s.icon} size={mobile ? 22 : 19} />
        <span className="nb-nav-label">{s.label}</span>
      </button>
    );
  };

  if (mobile) {
    const tabs = visible.slice(0, MOBILE_TABS);
    const more = visible.slice(MOBILE_TABS);
    const moreActive = more.includes(active);
    return (
      <>
        <nav className="nb-tabbar" aria-label="Sections">
          {tabs.map((id) => item(id))}
          <button type="button" className={`nb-nav-item${moreActive || moreOpen ? ' nb-nav-item--active' : ''}`} onClick={() => setMoreOpen((v) => !v)}>
            <Icon name="dots" size={22} />
            <span className="nb-nav-label">Plus</span>
          </button>
        </nav>
        {moreOpen ? (
          <div className="nb-sheet-backdrop" onClick={() => setMoreOpen(false)}>
            <div className="nb-sheet" role="dialog" aria-label="Plus" onClick={(e) => e.stopPropagation()}>
              <div className="nb-sheet-grid">
                {more.map((id) => item(id, ' nb-nav-item--tile'))}
                <button type="button" className="nb-nav-item nb-nav-item--tile" onClick={() => (setMoreOpen(false), onSearch())}>
                  <Icon name="search" size={22} />
                  <span className="nb-nav-label">Rechercher</span>
                </button>
                <button type="button" className="nb-nav-item nb-nav-item--tile" onClick={() => (setMoreOpen(false), onCustomize())}>
                  <Icon name="palette" size={22} />
                  <span className="nb-nav-label">Personnaliser</span>
                </button>
                <button type="button" className="nb-nav-item nb-nav-item--tile" onClick={() => (setMoreOpen(false), onSettings())}>
                  <Icon name="settings" size={22} />
                  <span className="nb-nav-label">Réglages</span>
                </button>
              </div>
              <div className="nb-sheet-status">
                <span className={`nb-status nb-status--${status}`} /> {STATUS_LABEL[status]}
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <nav className={`nb-rail${collapsed ? ' nb-rail--collapsed' : ''}`} aria-label="Sections">
      <div className="nb-rail-head">
        <span className="nb-workspace-avatar">N</span>
        <span className="nb-rail-name">Mon espace</span>
        <span className={`nb-status nb-status--${status}`} title={STATUS_LABEL[status]} />
      </div>
      <button type="button" className="nb-nav-item nb-rail-search" onClick={onSearch} title="Rechercher (Ctrl+K)">
        <Icon name="search" size={18} />
        <span className="nb-nav-label">Rechercher</span>
        <kbd className="nb-nav-kbd">Ctrl K</kbd>
      </button>
      <div className="nb-rail-sections">{visible.map((id) => item(id))}</div>
      <div className="nb-rail-foot">
        {install.canInstall && pointer ? (
          <button type="button" className="nb-nav-item" onClick={() => void promptInstall()} title={collapsed ? 'Installer l’application' : undefined}>
            <Icon name="download" size={18} />
            <span className="nb-nav-label">Installer l’application</span>
          </button>
        ) : null}
        <button type="button" className="nb-nav-item" onClick={onCustomize} title={collapsed ? 'Personnaliser' : undefined}>
          <Icon name="palette" size={18} />
          <span className="nb-nav-label">Personnaliser</span>
        </button>
        <button type="button" className="nb-nav-item" onClick={onSettings} title={collapsed ? 'Réglages' : undefined}>
          <Icon name="settings" size={18} />
          <span className="nb-nav-label">Réglages</span>
        </button>
        <button
          type="button"
          className="nb-nav-item nb-rail-collapse"
          onClick={() => updateSettings({ navCollapsed: !getSettings().navCollapsed })}
          title={collapsed ? 'Déplier la barre' : 'Replier la barre'}
          aria-label={collapsed ? 'Déplier la barre' : 'Replier la barre'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={18} />
          <span className="nb-nav-label">Replier</span>
        </button>
      </div>
    </nav>
  );
}
