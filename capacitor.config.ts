import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shinezeo.notes',
  appName: 'Notes',
  webDir: 'client/dist',
  backgroundColor: '#191919',
  android: {
    // Autorise un serveur en http:// (réseau local) depuis la WebView https://localhost
    allowMixedContent: true,
    backgroundColor: '#191919',
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    // Barre d'état et barre de navigation : icônes claires sur le fond sombre de Notes. L'application dessine
    // sous ces barres et laisse leur place grâce aux marges de sécurité (env(safe-area-inset-*) dans styles.css).
    SystemBars: { style: 'DARK' },
  },
};

export default config;
