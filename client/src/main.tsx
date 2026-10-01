import React from 'react';
import { createRoot } from 'react-dom/client';
import '@blocknote/mantine/style.css';
import './styles.css';
import App from './App';
import { startPwa } from './lib/pwa';
import { styleSystemBars } from './lib/native';
import { startIncoming } from './lib/incoming';
import { applyAppearance, cachedAppearance } from './lib/appearance';
import { getLang } from './lib/i18n';
import { desktop } from './lib/desktop';

// Langue de la page (lecteurs d'écran, césure, correcteur), et des menus de l'application Windows (si son pont le
// permet : une application plus ancienne peut afficher ce client).
document.documentElement.lang = getLang();
desktop()?.setLanguage?.(getLang());
startPwa();
styleSystemBars();
// Couleurs de l'espace dès le démarrage (copie locale), avant la synchronisation.
applyAppearance(cachedAppearance());
startIncoming();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
