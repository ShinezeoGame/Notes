// Éteindre un ordinateur à distance. Wake-on-LAN sait seulement allumer : pour éteindre, l'application Ostal pour
// Windows de l'ordinateur (option « Pouvoir éteindre cet ordinateur depuis Ostal ») attend les ordres du serveur par une
// requête longue, avec les adresses MAC de ses cartes réseau ; le téléphone ou l'accueil en envoie un, transmis aussitôt.
// Rien n'est enregistré : un ordinateur est « joignable » tant que son application est revenue chercher ses ordres
// récemment.
import { parseMac } from './wol.js';

/** Ordinateur joignable : son application est revenue dans ce délai. */
const SEEN_TTL = 75_000;
/** Durée d'une requête longue sans ordre. */
const WAIT_MS = 25_000;
/** Ordre non retiré dans ce délai : oublié (l'ordinateur s'est éteint autrement entre-temps). */
const ORDER_TTL = 60_000;

/** `${espace}|${mac}` → { name, seen, waiters: Set<fonction>, order: { id, action, at } | null } */
const agents = new Map();
let seq = 0;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

const key = (wsId, mac) => `${wsId}|${mac}`;

function agent(wsId, mac) {
  let a = agents.get(key(wsId, mac));
  if (!a) {
    // Ordinateurs plus revenus depuis longtemps : oubliés.
    if (agents.size > 200) {
      for (const [k, old] of agents) if (!old.waiters.size && Date.now() - old.seen > 86_400_000) agents.delete(k);
    }
    a = { name: '', seen: 0, waiters: new Set(), order: null };
    agents.set(key(wsId, mac), a);
  }
  return a;
}

/** Adresses MAC valides, sans doublon (au plus 8 cartes réseau). */
export function cleanMacs(list) {
  return [...new Set((Array.isArray(list) ? list : String(list ?? '').split(',')).map((m) => parseMac(String(m))).filter(Boolean))].slice(0, 8);
}

/**
 * Requête longue de l'application Windows : un ordre dès qu'il y en a un pour l'une de ses cartes réseau, sinon
 * { action: null } après WAIT_MS. `done(result)` reçoit la réponse ; renvoie de quoi l'abandonner (connexion fermée).
 */
export function waitOrder(wsId, macs, name, done, waitMs = WAIT_MS) {
  const list = cleanMacs(macs);
  if (!list.length) throw fail(400, 'Adresses MAC manquantes.');
  const now = Date.now();
  for (const mac of list) {
    const a = agent(wsId, mac);
    a.seen = now;
    a.name = String(name ?? '').slice(0, 80);
    if (a.order && now - a.order.at < ORDER_TTL) {
      const order = a.order;
      a.order = null;
      done({ action: order.action, id: order.id, mac });
      return () => {};
    }
    a.order = null;
  }
  let finished = false;
  const finish = (result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const mac of list) agent(wsId, mac).waiters.delete(finish);
    // Ordinateur toujours joignable jusqu'à sa prochaine requête.
    for (const mac of list) agent(wsId, mac).seen = Date.now();
    done(result);
  };
  const timer = setTimeout(() => finish({ action: null }), waitMs);
  for (const mac of list) agent(wsId, mac).waiters.add(finish);
  return () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const mac of list) agent(wsId, mac).waiters.delete(finish);
  };
}

/** Ordinateurs dont l'application attend des ordres (pour proposer « Éteindre »). */
export function agentsOnline(wsId) {
  const now = Date.now();
  const out = [];
  for (const [k, a] of agents) {
    if (!k.startsWith(`${wsId}|`) || now - a.seen > SEEN_TTL) continue;
    out.push({ mac: k.slice(wsId.length + 1), name: a.name });
  }
  return out;
}

/** Ordre d'extinction pour l'ordinateur de cette adresse MAC. */
export function requestOff(wsId, macRaw) {
  const mac = parseMac(String(macRaw ?? ''));
  if (!mac) throw fail(400, 'Adresse MAC invalide.');
  const a = agents.get(key(wsId, mac));
  if (!a || Date.now() - a.seen > SEEN_TTL) {
    throw fail(409, 'Cet ordinateur ne peut pas être éteint à distance : ouvrez-y Ostal pour Windows, avec l’option « Pouvoir éteindre cet ordinateur depuis Ostal ».');
  }
  a.order = { id: `off-${Date.now().toString(36)}-${++seq}`, action: 'off', at: Date.now() };
  for (const waiter of [...a.waiters]) {
    const order = a.order;
    a.order = null;
    waiter({ action: order.action, id: order.id, mac });
    break;
  }
  return { ok: true, name: a.name };
}
