// Liaison d'un nouvel appareil par code à 6 chiffres : un appareil déjà relié demande un code (valable 10 min,
// utilisable une fois), le nouvel appareil le saisit et reçoit l'identifiant et la clé de l'espace.
// Protection contre les essais au hasard : 5 essais par minute et par adresse, et tous les codes en cours
// sont annulés après 10 codes erronés.
import crypto from 'node:crypto';

const TTL = 10 * 60_000;
const MAX_FAILURES = 10;
const ATTEMPTS_PER_MINUTE = 5;

const codes = new Map(); // code -> { wsId, key, expires }
const attempts = new Map(); // adresse IP -> { count, resetAt }
let failures = 0;

function cleanup(now = Date.now()) {
  for (const [code, p] of codes) if (p.expires <= now) codes.delete(code);
  for (const [ip, a] of attempts) if (a.resetAt <= now) attempts.delete(ip);
  if (!codes.size) failures = 0;
}

/** Nouveau code pour l'espace (remplace le précédent). */
export function startPairing(wsId, key) {
  const now = Date.now();
  cleanup(now);
  for (const [code, p] of codes) if (p.wsId === wsId) codes.delete(code);
  let code;
  do code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  while (codes.has(code));
  codes.set(code, { wsId, key, expires: now + TTL });
  return { code, expiresAt: now + TTL };
}

/** Échange un code contre l'espace ; renvoie { status, body } pour la réponse HTTP. */
export function claimPairing(rawCode, ip) {
  const now = Date.now();
  cleanup(now);
  const a = attempts.get(ip);
  if (a && a.count >= ATTEMPTS_PER_MINUTE) return { status: 429, body: { error: 'Trop d’essais : patientez une minute avant de réessayer.' } };
  const code = String(rawCode ?? '').replace(/\D/g, '');
  const p = code.length === 6 ? codes.get(code) : undefined;
  if (!p) {
    const entry = a ?? { count: 0, resetAt: now + 60_000 };
    entry.count++;
    attempts.set(ip, entry);
    if (codes.size && ++failures >= MAX_FAILURES) {
      codes.clear();
      failures = 0;
    }
    return { status: 404, body: { error: 'Code invalide ou expiré. Affichez un nouveau code sur un appareil déjà relié.' } };
  }
  codes.delete(code);
  return { status: 200, body: { wsId: p.wsId, key: p.key } };
}
