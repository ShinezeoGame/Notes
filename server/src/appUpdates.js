// Mises à jour de l'application : version du client construit (`client/dist/version.json`) et liste de ses
// fichiers avec leur empreinte, que l'application Android télécharge pour se mettre à jour sans nouvel APK.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createAppUpdates(clientDist) {
  const versionFile = path.join(clientDist, 'version.json');
  let cached = null;

  /** Version du client servi, ou null s'il n'est pas construit. */
  function readVersion() {
    try {
      const v = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      if (typeof v.version !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(v.version)) return null;
      return { version: v.version, builtAt: String(v.builtAt || ''), minNative: Number(v.minNative) || 1 };
    } catch {
      return null;
    }
  }

  function listFiles(dir, base = '') {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
      else if (entry.isFile() && !entry.name.endsWith('.map')) out.push(rel);
    }
    return out;
  }

  /** Fichiers du client (chemin, taille, SHA-256), calculés une fois par version. */
  function manifest() {
    const v = readVersion();
    if (!v) return null;
    if (cached?.version === v.version) return cached;
    const files = listFiles(clientDist)
      .sort()
      .map((rel) => {
        const data = fs.readFileSync(path.join(clientDist, rel));
        return { path: rel, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
      });
    cached = { ...v, size: files.reduce((n, f) => n + f.size, 0), files };
    return cached;
  }

  return { readVersion, manifest };
}
