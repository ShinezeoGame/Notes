// Formats affichés partout dans l'application.
import { getLang, t } from './i18n';

/** Taille d'un fichier : « 640 Ko », « 2,4 Mo ». */
export function fileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return t('{n} Mo', { n: mb.toLocaleString(getLang(), { maximumFractionDigits: 1 }) });
  return t('{n} Ko', { n: Math.max(1, Math.round(bytes / 1024)) });
}
