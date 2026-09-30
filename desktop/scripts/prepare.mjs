// Prépare l'application pour ordinateur : copie le serveur Melo et le client construit (npm run build à la racine)
// dans desktop/server et desktop/client (dossiers non versionnés), avec la même disposition que dans le dépôt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(app, '..');
const dist = path.join(root, 'client', 'dist');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('Client non construit : lancez d’abord « npm run build » à la racine du dépôt.');
  process.exit(1);
}

// Le serveur tourne avec les dépendances de l'application : mêmes versions que server/package.json.
const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));
const appPkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
const drift = Object.entries(serverPkg.dependencies).filter(([name, version]) => appPkg.dependencies?.[name] !== version);
if (drift.length) {
  console.error('desktop/package.json doit reprendre les dépendances de server/package.json :');
  for (const [name, version] of drift) console.error(`  "${name}": "${version}" (trouvé : ${appPkg.dependencies?.[name] ?? 'absent'})`);
  process.exit(1);
}

for (const dir of ['server', 'client']) fs.rmSync(path.join(app, dir), { recursive: true, force: true });
fs.cpSync(path.join(root, 'server', 'src'), path.join(app, 'server', 'src'), { recursive: true });
fs.writeFileSync(path.join(app, 'server', 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
fs.cpSync(dist, path.join(app, 'client', 'dist'), { recursive: true });

const { version } = JSON.parse(fs.readFileSync(path.join(dist, 'version.json'), 'utf8'));
console.log(`Application pour ordinateur prête : serveur et client ${version}.`);
