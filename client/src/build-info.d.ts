/** Identité de cette version du client, injectée à la construction (voir vite.config.ts). */
declare const __APP_BUILD__: {
  /** Empreinte des sources (12 caractères hexadécimaux). */
  id: string;
  /** Date de construction (ISO 8601). */
  builtAt: string;
  /** Version minimale de l'API native Android requise. */
  minNative: number;
};
