// Choix de la langue de l'interface (anglais, français) : premier écran, présentation, Réglages, pages partagées et
// proposition du premier passage dans un navigateur. Changer de langue relance l'application.
import { LANGUAGES, getLang, setLang } from '../lib/i18n';
import { isNative, updateSettings, useSettings } from '../lib/settings';
import { isDesktop } from '../lib/desktop';
import { Icon } from '../icons/Icon';

/** `short` : codes de langue (EN, FR) au lieu des noms, pour une barre étroite. */
export function LanguageSwitch({ className, short }: { className?: string; short?: boolean }) {
  const current = getLang();
  return (
    // Libellé dans les deux langues : lisible quelle que soit la langue affichée.
    <div className={`nb-lang${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={'Language / Langue' /* i18n-ignore */}>
      <Icon name="globe" size={15} />
      {LANGUAGES.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          lang={l.id}
          aria-checked={l.id === current}
          aria-label={l.label}
          className={l.id === current ? 'nb-lang--on' : ''}
          onClick={() => setLang(l.id)}
        >
          {short ? l.id.toUpperCase() : l.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Premier passage dans un navigateur (sans écran de bienvenue) : la langue se choisit dès l'ouverture. Les
 * applications Android et Windows la proposent sur leur premier écran.
 */
export function LanguageHint() {
  const settings = useSettings();
  if (settings.langChosen || isNative() || isDesktop() || !settings.onboarded) return null;
  return (
    <div className="nb-lang-hint" role="dialog" aria-label={'Language / Langue' /* i18n-ignore */}>
      <LanguageSwitch />
      <button
        type="button"
        className="nb-icon-btn nb-icon-btn--sm"
        onClick={() => updateSettings({ langChosen: true })}
        aria-label={'OK' /* i18n-ignore */}
        title={'OK' /* i18n-ignore */}
      >
        <Icon name="check" size={15} />
      </button>
    </div>
  );
}
