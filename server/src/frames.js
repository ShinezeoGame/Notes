// Widget « Site web » : le site accepte-t-il d'être affiché dans une autre page ? Beaucoup de sites (Google, YouTube,
// banques…) l'interdisent par leurs en-têtes (X-Frame-Options, Content-Security-Policy frame-ancestors) ; le navigateur
// affiche alors un cadre vide, sans rien dire. Le serveur lit ces en-têtes pour que l'application propose plutôt
// d'ouvrir le site.

const TTL = 10 * 60_000;
const MAX_ENTRIES = 500;
/** url -> { allowed, at } */
const cache = new Map();

/** Vrai si les en-têtes de la réponse interdisent l'affichage dans le cadre d'un autre site. */
export function refusesFraming(headers) {
  const csp = headers.get('content-security-policy') || '';
  const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp);
  if (ancestors) {
    // frame-ancestors remplace X-Frame-Options : seul « * » (ou un schéma entier) autorise tout le monde.
    const sources = ancestors[1].trim().toLowerCase().split(/\s+/);
    return !sources.some((s) => s === '*' || s === 'https:' || s === 'http:');
  }
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  return /deny|sameorigin|allow-from/.test(xfo);
}

/** { allowed: true | false | null } ; null : site injoignable depuis le serveur (le cadre est tenté quand même). */
export async function checkFrame(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { allowed: null };
  }
  if (!/^https?:$/.test(url.protocol)) return { allowed: null };
  const key = url.href;
  const hit = cache.get(key);
  // Réponse inconnue (site injoignable) gardée moins longtemps.
  if (hit && Date.now() - hit.at < (hit.allowed === null ? 60_000 : TTL)) return { allowed: hit.allowed };

  let allowed = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(key, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Ostal) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36', accept: 'text/html,*/*' },
    });
    allowed = !refusesFraming(res.headers);
    res.body?.cancel().catch(() => {});
  } catch {
    allowed = null;
  } finally {
    clearTimeout(timer);
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { allowed, at: Date.now() });
  return { allowed };
}
