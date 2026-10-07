import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Version de l'API native (plugin Android « AppUpdate ») dont ce client a besoin. À augmenter quand le client
 * se met à utiliser une nouvelle fonction native : une application Android plus ancienne ne téléchargera pas
 * cette version et proposera d'installer le nouvel APK.
 */
const MIN_NATIVE_API = 2;

/** Empreinte des sources : identique pour un même code, quelle que soit la machine qui construit (serveur, GitHub). */
function sourceHash(): string {
  const hash = createHash('sha256');
  const add = (file: string) => {
    hash.update(path.relative(root, file).replace(/\\/g, '/')).update('\0').update(readFileSync(file)).update('\0');
  };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else add(full);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'public'));
  for (const file of ['index.html', 'package.json', 'vite.config.ts', '../package-lock.json']) {
    try {
      add(path.join(root, file));
    } catch {
      /* fichier absent (construction partielle) */
    }
  }
  return hash.digest('hex').slice(0, 12);
}

const BUILD = { id: sourceHash(), builtAt: new Date().toISOString(), minNative: MIN_NATIVE_API };

/** Publie `version.json`, lu par le serveur pour annoncer les mises à jour aux applications. */
function versionFile(): Plugin {
  return {
    name: 'notes-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: BUILD.id, builtAt: BUILD.builtAt, minNative: BUILD.minNative }, null, 2)}\n`,
      });
    },
  };
}

/**
 * Publie `sw.js` (modèle `src/sw.js`) avec la version et les fichiers de cette construction : l'application
 * installée sur un ordinateur s'ouvre alors même sans réseau. Chaque construction donne un nouveau `sw.js`, que
 * le navigateur installe à la visite suivante (et qui efface les fichiers de la version précédente).
 */
function serviceWorker(): Plugin {
  return {
    name: 'notes-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const publicDir = path.join(root, 'public');
      const files = new Set(Object.keys(bundle));
      const walk = (dir: string) => {
        for (const name of readdirSync(dir).sort()) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.add(path.relative(publicDir, full).replace(/\\/g, '/'));
        }
      };
      walk(publicDir);
      const list = [...files].filter((f) => !f.endsWith('.map') && !['index.html', 'sw.js', 'version.json'].includes(f)).sort();
      const source = readFileSync(path.join(root, 'src/sw.js'), 'utf8')
        .split('__NOTES_VERSION__')
        .join(JSON.stringify(BUILD.id))
        .split('__NOTES_FILES__')
        .join(JSON.stringify(list));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// En développement, l'API et le WebSocket du serveur Node (port 3000) sont proxifiés
// afin que le client se comporte comme en production (même origine).
export default defineConfig({
  plugins: [react(), versionFile(), serviceWorker()],
  base: './',
  define: {
    __APP_BUILD__: JSON.stringify(BUILD),
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
  },
  // Worker de pdf.js (editor/pdf-worker.ts) en module, comme pdf.js le démarre.
  worker: {
    format: 'es',
  },
});
