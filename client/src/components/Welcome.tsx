// Premier lancement : prénom et sections utiles (une navigation réduite à ce qui sert), puis présentation de Melo en
// quelques écrans. La présentation se revoit depuis les Réglages.
import { useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { canShareLinks, serverBase } from '../lib/api';
import { changeAppearance, type Appearance, type SectionId } from '../lib/appearance';
import { isDesktopLocal } from '../lib/desktop';
import { isDefaultUserName, updateSettings, useSettings } from '../lib/settings';
import { Icon } from '../icons/Icon';
import { LanguageSwitch } from './LanguageSwitch';
import type { IconName } from '../icons/registry';
import { SECTIONS, groupSections } from './AppNav';
import { Modal } from './Modal';
import { t, tx } from '../lib/i18n';

/** Sections reliées au réseau du serveur (matériel à la maison) : proposées décochées aux nouveaux venus. */
const HOUSE: SectionId[] = ['smarthome', 'cameras', 'homelab'];

/** Sections qui ne fonctionnent qu'avec un serveur Melo : indisponibles sur un appareil seul. */
export const NEEDS_SERVER: SectionId[] = ['smarthome', 'cameras', 'homelab', 'pdf'];

type Slide = { icon: IconName; title: string; text: ReactNode };

/** Mise en forme des phrases de la présentation : <b>…</b> en gras, <m>…</m> en gras à chasse fixe (touches, « / »). */
const b = (s: string) => <b>{s}</b>;
const m = (s: string) => <b className="nb-mono">{s}</b>;

function slides(visible: (id: SectionId) => boolean, guest: boolean): Slide[] {
  const list: Slide[] = [
    {
      icon: 'dashboard',
      title: t('Votre accueil'),
      text: tx(
        'Des widgets (horloge, météo, tâches, agenda, raccourcis…) à placer où vous voulez : <b>glissez</b> un widget pour le déplacer, <b>tirez un coin</b> pour l’agrandir. Le bouton <b>+</b>, en bas à droite, ouvre le catalogue. Sur téléphone : un appui long sur un widget, ou <b>Modifier</b> en bas à droite.',
        { b },
      ),
    },
  ];
  if (visible('notes'))
    list.push({
      icon: 'note',
      title: t('Vos notes'),
      text: tx(
        'Des pages, et des pages dans les pages. Dans une page, tapez <m>/</m> pour ajouter un titre, une liste de cases à cocher, une image, un tableau, des colonnes… Le bouton <b>Partager</b> envoie une page à qui vous voulez, en lecture ou en modification à plusieurs.',
        { b, m },
      ),
    });
  if (visible('agenda') || visible('pdf'))
    list.push({
      icon: 'filePdf',
      title: t('Vos outils'),
      text: (
        <>
          {visible('pdf') ? (
            <>{tx('L’<b>atelier PDF</b> signe, remplit, annote et assemble vos PDF, et transforme des photos en PDF.', { b })} </>
          ) : null}
          {visible('agenda') ? tx('L’<b>agenda</b> réunit vos agendas Google, Outlook ou iCal.', { b }) : null}
        </>
      ),
    });
  if (!guest && HOUSE.some(visible))
    list.push({
      icon: 'bulb',
      title: t('Votre maison'),
      text: t(
        'Lumières et prises (avec Home Assistant), caméras de surveillance et homelab : chaque section vous guide pas à pas pour relier votre matériel.',
      ),
    });
  list.push({
    icon: 'smartphone',
    title: t('Sur tous vos appareils'),
    text: canShareLinks() ? (
      <>
        {tx('<b>Réglages → Relier un autre appareil</b> : scannez le QR code avec votre téléphone pour y retrouver les mêmes pages.', { b })}
        {guest ? null : <> {tx('<b>Inviter une personne</b> donne à un proche son propre espace sur votre serveur.', { b })}</>}
      </>
    ) : isDesktopLocal() ? (
      tx(
        'Melo fonctionne seul sur cet ordinateur. Pour le retrouver sur votre téléphone ou partager des pages : <b>Réglages → Rejoindre un serveur</b>, avec le lien ou le code reçu.',
        { b },
      )
    ) : (
      tx(
        'Melo fonctionne seul sur cet appareil. Pour le retrouver sur votre téléphone ou partager des pages : <b>Réglages → Rejoindre un serveur</b>, avec le lien ou le code reçu.',
        { b },
      )
    ),
  });
  list.push({
    icon: 'palette',
    title: t('À votre goût'),
    text: tx(
      '<b>Personnaliser</b> change le thème, la couleur, le fond d’écran et les sections affichées. La barre de gauche se replie avec la petite flèche en haut, et <m>Ctrl K</m> cherche dans vos pages.',
      { b, m },
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
  // Appareil seul (sans serveur) : maison, caméras, homelab et atelier PDF ne peuvent pas fonctionner.
  const unavailable = (id: SectionId) => (guest && HOUSE.includes(id)) || (!serverBase() && NEEDS_SERVER.includes(id));
  // Premier lancement : organisation et outils cochés, matériel de la maison décoché.
  const [hidden, setHidden] = useState<SectionId[]>(() =>
    tourOnly ? appearance.hidden : [...new Set([...appearance.hidden, ...HOUSE, ...NEEDS_SERVER.filter(unavailable)])],
  );
  const shown = (id: SectionId) => !hidden.includes(id) && !unavailable(id);
  const list = slides(shown, guest);

  const finish = () => {
    updateSettings({ firstRun: false });
    onClose();
  };

  /** Prénom et sections enregistrés ; puis la présentation, ou rien (« Passer la visite »). */
  const confirmSetup = (tour: boolean) => {
    updateSettings({ langChosen: true, ...(name.trim() ? { userName: name.trim() } : {}) });
    changeAppearance(doc, () => ({ hidden }));
    if (tour) setStep(0);
    else finish();
  };

  if (step < 0) {
    const groups = groupSections(appearance.sections).filter((g) => g.id !== 'main');
    return (
      <Modal
        title={t('Bienvenue !')}
        // Fermée sans répondre : les sections cochées d'office (sans la maison) s'appliquent quand même.
        onClose={() => confirmSetup(false)}
        width={560}
        footer={
          <>
            <button type="button" className="nb-btn" onClick={() => confirmSetup(false)}>
              {t('Passer la visite')}
            </button>
            <button type="button" className="nb-btn nb-btn--primary" onClick={() => confirmSetup(true)}>
              {t('Continuer')}
            </button>
          </>
        }
      >
        <div className="nb-welcome">
          <div className="nb-welcome-lang">
            <LanguageSwitch />
          </div>
          <label className="nb-field">
            <span>{t('Votre prénom (affiché quand vous modifiez une page à plusieurs)')}</span>
            <input
              className="nb-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder={t('Ex. : Camille')}
              autoFocus
            />
          </label>
          <div className="nb-field">
            <span>{t('Qu’allez-vous utiliser ? Seules ces sections s’affichent ; vous pourrez changer d’avis dans Personnaliser.')}</span>
            <div className="nb-welcome-sections">
              {groups.map((g) => {
                const ids = g.ids.filter((id) => !(guest && HOUSE.includes(id)));
                if (!ids.length) return null;
                return (
                  <div key={g.id} className="nb-welcome-group" role="group" aria-label={g.label}>
                    <div className="nb-nav-group-label">{g.label}</div>
                    {g.id === 'house' && ids.some((id) => !unavailable(id)) ? (
                      <p className="nb-welcome-group-note">
                        {t('Pour du matériel chez vous (Home Assistant, caméras, serveur maison) : rien à cocher si vous n’en avez pas.')}
                      </p>
                    ) : null}
                    {ids.map((id) => (
                      <label
                        key={id}
                        className={`nb-welcome-section${shown(id) ? ' nb-welcome-section--on' : ''}${unavailable(id) ? ' nb-welcome-section--off' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={shown(id)}
                          disabled={unavailable(id)}
                          onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((x) => x !== id) : [...h, id]))}
                        />
                        <Icon name={SECTIONS[id].icon} size={18} />
                        <span>
                          <b>{SECTIONS[id].label}</b>
                          <span className="nb-muted">
                            {unavailable(id) ? t('Nécessite un serveur Melo') : SECTIONS[id].hint}
                          </span>
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
      title={t('Découvrir Melo')}
      onClose={finish}
      width={520}
      footer={
        <>
          <div className="nb-welcome-dots" aria-label={t('Écran {n} sur {total}', { n: step + 1, total: list.length })}>
            {list.map((s, i) => (
              <span key={s.title} className={i === step ? 'nb-welcome-dot--on' : ''} />
            ))}
          </div>
          {step > 0 ? (
            <button type="button" className="nb-btn" onClick={() => setStep(step - 1)}>
              {t('Précédent')}
            </button>
          ) : (
            <button type="button" className="nb-btn" onClick={finish}>
              {t('Passer')}
            </button>
          )}
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => (last ? finish() : setStep(step + 1))} autoFocus>
            {last ? t('C’est parti !') : t('Suivant')}
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
