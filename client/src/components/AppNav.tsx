// Navigation entre les sections de l'application : barre verticale à gauche sur ordinateur, barre d'onglets en bas sur
// téléphone (les sections qui n'y tiennent pas sont dans « Plus »). Les sections sont réunies par usage (Organisation,
// Maison, Outils) ; ordre à l'intérieur d'un groupe et sections masquées : réglages d'apparence.
import { useEffect, useState } from 'react';
import type { SectionId } from '../lib/appearance';
import type { ConnStatus } from '../lib/yjs';
import { promptInstall, useInstallState } from '../lib/pwa';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { useMediaQuery } from '../lib/hooks';
import { isDesktopLocal } from '../lib/desktop';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { MeloLogo } from './Logo';

export type SectionGroupId = 'main' | 'organize' | 'house' | 'tools';

/** Groupes de la navigation, dans leur ordre d'affichage (l'accueil, seul, n'a pas de titre). */
export const SECTION_GROUPS: { id: SectionGroupId; label: string }[] = [
  { id: 'main', label: '' },
  { id: 'organize', label: 'Organisation' },
  { id: 'house', label: 'Maison' },
  { id: 'tools', label: 'Outils' },
];

/** `short` : libellé de la barre d'onglets du téléphone ; `hint` : ce que contient la section, en quelques mots. */
export const SECTIONS: Record<SectionId, { label: string; short: string; icon: IconName; hash: string; group: SectionGroupId; hint: string }> = {
  home: { label: 'Accueil', short: 'Accueil', icon: 'dashboard', hash: '#/', group: 'main', hint: 'Vos widgets : horloge, météo, tâches, raccourcis…' },
  notes: { label: 'Notes', short: 'Notes', icon: 'note', hash: '#/notes', group: 'organize', hint: 'Pages de notes, listes et idées, à partager' },
  agenda: { label: 'Agenda', short: 'Agenda', icon: 'calendar', hash: '#/agenda', group: 'organize', hint: 'Vos agendas Google, Outlook ou iCal réunis' },
  smarthome: { label: 'Objets connectés', short: 'Maison', icon: 'bulb', hash: '#/maison', group: 'house', hint: 'Lumières, prises, volets… avec Home Assistant' },
  cameras: { label: 'Caméras', short: 'Caméras', icon: 'cctv', hash: '#/cameras', group: 'house', hint: 'Le direct de vos caméras de surveillance' },
  homelab: { label: 'Homelab', short: 'Homelab', icon: 'server', hash: '#/homelab', group: 'house', hint: 'L’état de vos serveurs et applications' },
  pdf: { label: 'Atelier PDF', short: 'PDF', icon: 'filePdf', hash: '#/pdf', group: 'tools', hint: 'Signer, remplir, annoter et assembler des PDF' },
};

/** Sections visibles réunies par groupe (groupes vides retirés), dans l'ordre choisi à l'intérieur de chaque groupe. */
export function groupSections(order: SectionId[], hidden: SectionId[] = []): { id: SectionGroupId; label: string; ids: SectionId[] }[] {
  return SECTION_GROUPS.map((g) => ({ ...g, ids: order.filter((id) => SECTIONS[id].group === g.id && !hidden.includes(id)) })).filter((g) => g.ids.length);
}

/** Sections visibles dans l'ordre de la navigation (groupe après groupe). */
export function navOrder(order: SectionId[], hidden: SectionId[] = []): SectionId[] {
  return groupSections(order, hidden).flatMap((g) => g.ids);
}

export const STATUS_LABEL: Record<ConnStatus, string> = {
  offline: 'Hors ligne (appareil seul)',
  connecting: 'Connexion au serveur…',
  connected: 'Synchronisé',
  disconnected: 'Déconnecté – nouvelle tentative…',
  denied: 'Accès refusé par le serveur',
  outdated: 'Mise à jour de Melo nécessaire',
};

/** État de la synchronisation en mots ; l'espace de l'application pour ordinateur reste sur cet ordinateur. */
export function statusLabel(status: ConnStatus): string {
  return status === 'connected' && isDesktopLocal() ? 'Enregistré sur cet ordinateur' : STATUS_LABEL[status];
}

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
  const groups = groupSections(sections, hidden);
  const visible = groups.flatMap((g) => g.ids);
  const collapsed = !mobile && settings.navCollapsed;

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const item = (id: SectionId, extraClass = '', label = SECTIONS[id].label) => {
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
        title={collapsed ? s.label : s.hint}
      >
        <Icon name={s.icon} size={mobile ? 22 : 19} />
        <span className="nb-nav-label">{label}</span>
      </button>
    );
  };

  if (mobile) {
    const tabs = visible.slice(0, MOBILE_TABS);
    const more = visible.slice(MOBILE_TABS);
    const moreActive = more.includes(active);
    // « Plus » : les autres sections, sous le titre de leur groupe.
    const moreGroups = groups.map((g) => ({ ...g, ids: g.ids.filter((id) => more.includes(id)) })).filter((g) => g.ids.length);
    return (
      <>
        <nav className="nb-tabbar" aria-label="Sections">
          {tabs.map((id) => item(id, '', SECTIONS[id].short))}
          <button type="button" className={`nb-nav-item${moreActive || moreOpen ? ' nb-nav-item--active' : ''}`} onClick={() => setMoreOpen((v) => !v)}>
            <Icon name="dots" size={22} />
            <span className="nb-nav-label">Plus</span>
          </button>
        </nav>
        {moreOpen ? (
          <div className="nb-sheet-backdrop" onClick={() => setMoreOpen(false)}>
            <div className="nb-sheet" role="dialog" aria-label="Plus" onClick={(e) => e.stopPropagation()}>
              {moreGroups.map((g) => (
                <div key={g.id} className="nb-sheet-group">
                  {g.label ? <div className="nb-nav-group-label">{g.label}</div> : null}
                  <div className="nb-sheet-grid">{g.ids.map((id) => item(id, ' nb-nav-item--tile'))}</div>
                </div>
              ))}
              <div className="nb-sheet-group">
                <div className="nb-nav-group-label">Melo</div>
                <div className="nb-sheet-grid">
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
              </div>
              <div className="nb-sheet-status">
                <span className={`nb-status nb-status--${status}`} /> {statusLabel(status)}
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
        <MeloLogo size={22} className="nb-workspace-avatar" />
        <span className="nb-rail-name">Melo</span>
        <span className={`nb-status nb-status--${status}`} title={statusLabel(status)} />
        <button
          type="button"
          className="nb-icon-btn nb-icon-btn--sm nb-rail-collapse"
          onClick={() => updateSettings({ navCollapsed: !getSettings().navCollapsed })}
          title={collapsed ? 'Déplier la barre' : 'Replier la barre'}
          aria-label={collapsed ? 'Déplier la barre' : 'Replier la barre'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
        </button>
      </div>
      <button type="button" className="nb-nav-item nb-rail-search" onClick={onSearch} title="Rechercher (Ctrl+K)">
        <Icon name="search" size={18} />
        <span className="nb-nav-label">Rechercher</span>
        <kbd className="nb-nav-kbd">Ctrl K</kbd>
      </button>
      <div className="nb-rail-sections">
        {groups.map((g) => (
          <div key={g.id} className="nb-nav-group" role="group" aria-label={g.label || undefined}>
            {g.label ? <div className="nb-nav-group-label">{g.label}</div> : null}
            {g.ids.map((id) => item(id))}
          </div>
        ))}
      </div>
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
      </div>
    </nav>
  );
}
