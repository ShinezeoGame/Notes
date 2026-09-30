// Écran de bienvenue au premier lancement de l'application (Android, ordinateur) : commencer tout de suite sur cet
// appareil, ou rejoindre un serveur avec le lien ou le code reçu.
import { useState } from 'react';
import { isDesktopLocal } from '../lib/desktop';
import { updateSettings } from '../lib/settings';
import { Icon } from '../icons/Icon';
import { JoinForm } from './LinkDevice';
import { MeloLogo } from './Logo';

export function Onboarding() {
  const [mode, setMode] = useState<'choose' | 'join'>('choose');
  const computer = isDesktopLocal();

  // Ordinateur : le serveur intégré reste le serveur de l'espace ; téléphone : mode hors ligne.
  const start = () => updateSettings({ onboarded: true, firstRun: true, ...(computer ? {} : { serverUrl: null }) });

  return (
    <div className="nb-center nb-onboarding">
      <div className="nb-card">
        <MeloLogo size={48} className="nb-logo" />
        <h1>Bienvenue dans Melo</h1>
        <p className="nb-muted">Votre accueil, vos notes, votre agenda, vos outils PDF et votre maison au même endroit.</p>
        {mode === 'choose' ? (
          <div className="nb-choices">
            <button type="button" className="nb-choice nb-choice--main" onClick={start}>
              <span className="nb-choice-icon">
                <Icon name="sparkles" size={26} />
              </span>
              <span className="nb-choice-title">Commencer</span>
              <span className="nb-muted">
                {computer
                  ? 'Tout reste sur cet ordinateur. Vous pourrez rejoindre un serveur plus tard, pour retrouver Melo sur votre téléphone ou partager des pages.'
                  : 'Tout reste sur cet appareil. Vous pourrez rejoindre un serveur plus tard, pour retrouver Melo ailleurs ou partager des pages.'}
              </span>
            </button>
            <button type="button" className="nb-choice" onClick={() => setMode('join')}>
              <span className="nb-choice-icon">
                <Icon name="link" size={26} />
              </span>
              <span className="nb-choice-title">J’ai une invitation ou un code</span>
              <span className="nb-muted">Rejoindre le serveur Melo d’un proche, ou le vôtre : vos pages sur tous vos appareils, partage en direct.</span>
            </button>
          </div>
        ) : (
          <div className="nb-connect">
            <JoinForm onCancel={() => setMode('choose')} cancelLabel="Retour" initialInput={(import.meta.env.VITE_DEFAULT_SERVER_URL as string | undefined) ?? ''} />
          </div>
        )}
      </div>
    </div>
  );
}
