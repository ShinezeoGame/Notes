// Premier lancement : prénom et sections utiles (une navigation réduite à ce qui sert), puis présentation de Melo en
// quelques écrans. La présentation se revoit depuis les Réglages.
import { useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { canShareLinks } from '../lib/api';
import { updateAppearance, type Appearance, type SectionId } from '../lib/appearance';
import { isDesktopLocal } from '../lib/desktop';
import { isDefaultUserName, updateSettings, useSettings } from '../lib/settings';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { SECTIONS, groupSections } from './AppNav';
import { Modal } from './Modal';

/** Sections reliées au réseau du serveur (matériel à la maison) : proposées décochées aux nouveaux venus. */
const HOUSE: SectionId[] = ['smarthome', 'cameras', 'homelab'];

type Slide = { icon: IconName; title: string; text: ReactNode };

function slides(visible: (id: SectionId) => boolean, guest: boolean): Slide[] {
  const list: Slide[] = [
    {
      icon: 'dashboard',
      title: 'Votre accueil',
      text: (
        <>
          Des widgets (horloge, météo, tâches, agenda, raccourcis…) à placer où vous voulez : <b>glissez</b> un widget pour le déplacer, <b>tirez un coin</b>{' '}
          pour l’agrandir. <b>Ajouter un widget</b>, en haut à droite, ouvre le catalogue. Sur téléphone : un appui long sur un widget.
        </>
      ),
    },
  ];
  if (visible('notes'))
    list.push({
      icon: 'note',
      title: 'Vos notes',
      text: (
        <>
          Des pages, et des pages dans les pages. Dans une page, tapez <b className="nb-mono">/</b> pour ajouter un titre, une liste de cases à cocher, une image,
          un tableau, des colonnes… Le bouton <b>Partager</b> envoie une page à qui vous voulez, en lecture ou en modification à plusieurs.
        </>
      ),
    });
  if (visible('agenda') || visible('pdf'))
    list.push({
      icon: 'filePdf',
      title: 'Vos outils',
      text: (
        <>
          {visible('pdf') ? (
            <>
              L’<b>atelier PDF</b> signe, remplit, annote et assemble vos PDF, et transforme des photos en PDF.{' '}
            </>
          ) : null}
          {visible('agenda') ? (
            <>
              L’<b>agenda</b> réunit vos agendas Google, Outlook ou iCal.
            </>
          ) : null}
        </>
      ),
    });
  if (!guest && HOUSE.some(visible))
    list.push({
      icon: 'bulb',
      title: 'Votre maison',
      text: (
        <>
          Lumières et prises (avec Home Assistant), caméras de surveillance et homelab : chaque section vous guide pas à pas pour relier votre matériel.
        </>
      ),
    });
  list.push({
    icon: 'smartphone',
    title: 'Sur tous vos appareils',
    text: canShareLinks() ? (
      <>
        <b>Réglages → Relier un autre appareil</b> : scannez le QR code avec votre téléphone pour y retrouver les mêmes pages.
        {guest ? null : (
          <>
            {' '}
            <b>Inviter une personne</b> donne à un proche son propre espace sur votre serveur.
          </>
        )}
      </>
    ) : (
      <>
        Melo fonctionne seul sur {isDesktopLocal() ? 'cet ordinateur' : 'cet appareil'}. Pour le retrouver sur votre téléphone ou partager des pages :{' '}
        <b>Réglages → Rejoindre un serveur</b>, avec le lien ou le code reçu.
      </>
    ),
  });
  list.push({
    icon: 'palette',
    title: 'À votre goût',
    text: (
      <>
        <b>Personnaliser</b> change le thème, la couleur, le fond d’écran et les sections affichées. La barre de gauche se replie avec la petite flèche en haut, et{' '}
        <b className="nb-mono">Ctrl K</b> cherche dans vos pages.
      </>
    ),
  });
  return list;
}

type Props = { doc: Y.Doc; appearance: Appearance; tourOnly: boolean; onClose: () => void };

export function WelcomeDialog({ doc, appearance, tourOnly, onClose }: Props) {
  const settings = useSettings();
  const guest = settings.guest;
  const [step, setStep] = useState(tourOnly ? 0 : -1);
  const [name, setName] = useState(isDefaultUserName(settings.userName) ? '' : settings.userName);
  // Premier lancement : organisation et outils cochés, matériel de la maison décoché.
  const [hidden, setHidden] = useState<SectionId[]>(() => (tourOnly ? appearance.hidden : [...new Set([...appearance.hidden, ...HOUSE])]));
  const shown = (id: SectionId) => !hidden.includes(id) && !(guest && HOUSE.includes(id));
  const list = slides(shown, guest);

  const finish = () => {
    updateSettings({ firstRun: false });
    onClose();
  };

  const confirmSetup = () => {
    if (name.trim()) updateSettings({ userName: name.trim() });
    updateAppearance(doc, () => ({ hidden }));
    setStep(0);
  };

  if (step < 0) {
    const groups = groupSections(appearance.sections).filter((g) => g.id !== 'main');
    return (
      <Modal
        title="Bienvenue !"
        onClose={finish}
        width={560}
        footer={
          <>
            <button type="button" className="nb-btn" onClick={finish}>
              Plus tard
            </button>
            <button type="button" className="nb-btn nb-btn--primary" onClick={confirmSetup}>
              Continuer
            </button>
          </>
        }
      >
        <div className="nb-welcome">
          <label className="nb-field">
            <span>Votre prénom (affiché quand vous modifiez une page à plusieurs)</span>
            <input className="nb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ex. : Camille" autoFocus />
          </label>
          <div className="nb-field">
            <span>Qu’allez-vous utiliser ? Seules ces sections s’affichent ; vous pourrez changer d’avis dans Personnaliser.</span>
            <div className="nb-welcome-sections">
              {groups.map((g) => {
                const ids = g.ids.filter((id) => !(guest && HOUSE.includes(id)));
                if (!ids.length) return null;
                return (
                  <div key={g.id} className="nb-welcome-group" role="group" aria-label={g.label}>
                    <div className="nb-nav-group-label">{g.label}</div>
                    {ids.map((id) => (
                      <label key={id} className={`nb-welcome-section${shown(id) ? ' nb-welcome-section--on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={shown(id)}
                          onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((x) => x !== id) : [...h, id]))}
                        />
                        <Icon name={SECTIONS[id].icon} size={18} />
                        <span>
                          <b>{SECTIONS[id].label}</b>
                          <span className="nb-muted">{SECTIONS[id].hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  const slide = list[Math.min(step, list.length - 1)];
  const last = step >= list.length - 1;
  return (
    <Modal
      title="Découvrir Melo"
      onClose={finish}
      width={520}
      footer={
        <>
          <div className="nb-welcome-dots" aria-label={`Écran ${step + 1} sur ${list.length}`}>
            {list.map((s, i) => (
              <span key={s.title} className={i === step ? 'nb-welcome-dot--on' : ''} />
            ))}
          </div>
          {step > 0 ? (
            <button type="button" className="nb-btn" onClick={() => setStep(step - 1)}>
              Précédent
            </button>
          ) : (
            <button type="button" className="nb-btn" onClick={finish}>
              Passer
            </button>
          )}
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => (last ? finish() : setStep(step + 1))} autoFocus>
            {last ? 'C’est parti !' : 'Suivant'}
          </button>
        </>
      }
    >
      <div className="nb-welcome-slide">
        <span className="nb-welcome-icon">
          <Icon name={slide.icon} size={30} />
        </span>
        <h3>{slide.title}</h3>
        <p>{slide.text}</p>
      </div>
    </Modal>
  );
}
