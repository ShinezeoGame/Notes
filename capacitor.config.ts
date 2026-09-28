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
};

export default config;
