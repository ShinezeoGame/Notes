// Présentation d'une section pas encore réglée : ce qu'elle apporte, ce qu'il faut pour s'en servir, comment commencer.
// Qui n'en a pas l'usage la masque d'un clic (elle se réaffiche dans Personnaliser).
import type { ReactNode } from 'react';
import type * as Y from 'yjs';
import { changeAppearance, type SectionId } from '../lib/appearance';
import { navigate } from '../lib/router';
import { DOCS_BASE } from '../lib/updates';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { toast } from './Toast';
import { t } from '../lib/i18n';

/** Retire une section de la navigation et revient à l'accueil. */
export function hideSection(doc: Y.Doc, id: SectionId) {
  changeAppearance(doc, (a) => ({ hidden: [...new Set([...a.hidden, id])] }));
  navigate('#/');
  toast(t('Section masquée. Pour la retrouver : Personnaliser → Sections.'));
}

type Props = {
  icon: IconName;
  title: string;
  /** Ce que la section apporte. */
  children: ReactNode;
  /** Ce qu'il faut pour s'en servir. */
  needs?: ReactNode[];
  actions?: ReactNode;
  /** Remarque sous les boutons (limites, autre possibilité). */
  note?: ReactNode;
  /** « Je n'en ai pas besoin » : masque la section (absent dans un widget ou un bloc de page). */
  onHide?: () => void;
};

export function SectionIntro({ icon, title, children, needs, actions, note, onHide }: Props) {
  return (
    <div className="nb-intro">
      <span className="nb-intro-icon">
        <Icon name={icon} size={28} />
      </span>
      <h2>{title}</h2>
      <p className="nb-intro-text">{children}</p>
      {needs?.length ? (
        <div className="nb-intro-needs">
          <b>{t('Ce qu’il vous faut')}</b>
          <ul>
            {needs.map((n, i) => (
              <li key={i}>
                <Icon name="check" size={14} />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {actions ? <div className="nb-intro-actions">{actions}</div> : null}
      {note ? <p className="nb-intro-note">{note}</p> : null}
      {onHide ? (
        <button type="button" className="nb-intro-hide" onClick={onHide}>
          <Icon name="eyeOff" size={14} /> {t('Je n’en ai pas besoin : masquer cette section')}
        </button>
      ) : null}
    </div>
  );
}

/** Section qui passe par un serveur Ostal, sur un appareil qui n'en a pas : ce qu'il faut, et comment en rejoindre un. */
export function NeedsServerIntro({
  icon,
  title,
  need,
  children,
  onJoin,
  onHide,
}: {
  icon: IconName;
  title: string;
  /** Rôle du serveur pour cette section (par défaut : le lien avec le matériel de la maison). */
  need?: string;
  children: ReactNode;
  onJoin?: () => void;
  onHide?: () => void;
}) {
  return (
    <SectionIntro
      icon={icon}
      title={title}
      needs={[
        need ?? t('Un serveur Ostal chez vous, sur le même réseau que votre matériel : c’est lui qui fait le lien, cet appareil ne peut pas le faire seul.'),
      ]}
      actions={
        onJoin ? (
          <button type="button" className="nb-btn nb-btn--primary" onClick={onJoin}>
            <Icon name="link" size={15} /> {t('Rejoindre un serveur')}
          </button>
        ) : null
      }
      note={
        <a href={`${DOCS_BASE}INSTALLATION.md`} target="_blank" rel="noopener noreferrer">
          {t('Installer un serveur Ostal chez vous (guide pas à pas)')}
        </a>
      }
      onHide={onHide}
    >
      {children}
    </SectionIntro>
  );
}
