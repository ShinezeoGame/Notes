# Développer Melo

Construire Melo, le faire tourner, et comment il est organisé. Pour l’utiliser, voir le [mode d’emploi](GUIDE.md) ; pour installer un serveur chez soi, [INSTALLATION.md](../INSTALLATION.md).

## Démarrage rapide (ordinateur)

Prérequis : Node.js 20 ou plus.

```bash
npm install
npm run build     # construit le client web dans client/dist
npm start         # démarre le serveur sur http://localhost:3000
```

Ouvrez http://localhost:3000. Pour le développement avec rechargement à chaud : `npm run dev` (client sur http://localhost:5173, serveur sur le port 3000).

Variables d’environnement du serveur :

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` | Port d’écoute | `3000` |
| `DATA_DIR` | Dossier des données (documents, uploads, liens de partage) | `server/data` |
| `PUBLIC_URL` | Adresse publique (utilisée pour les liens de partage et d’upload derrière un proxy) | déduite de la requête |
| `MAX_UPLOAD_MB` | Taille maximale d’un fichier importé | `200` |
| `MAX_WORKSPACES` | Nombre maximal d’espaces de travail (`0` = illimité), sans compter ceux créés par une invitation. Mettez `1` sur un serveur accessible depuis Internet : les autres personnes passent par une invitation | `0` (Docker : `1`) |

## Déployer le serveur (pour partager et synchroniser)

Le partage de pages et la synchronisation entre appareils nécessitent que le serveur soit joignable par les autres (Internet ou réseau local).

**Guide pas à pas (serveur maison + accès depuis Internet en HTTPS) : [INSTALLATION.md](../INSTALLATION.md).**

- **Docker** : `cp .env.example .env`, adaptez-le, puis `docker compose up -d --build` (données dans le dossier `./data`). Pour l’accès HTTPS depuis Internet : `docker compose --profile tunnel up -d` (Cloudflare Tunnel), `docker compose --profile caddy up -d` (Caddy), ou `sudo tailscale funnel --bg 3000` (Tailscale Funnel, sans nom de domaine).
- **Hébergeurs Node** (Render, Railway, Fly.io, VPS…) : commande de build `npm install && npm run build`, commande de démarrage `npm start`, et un disque persistant monté sur `DATA_DIR`.
- **Réseau local uniquement** : `npm start` sur votre ordinateur, puis utilisez `http://<ip-de-l-ordinateur>:3000` depuis le téléphone (même Wi‑Fi).

## Applications : construction et publication

Le workflow GitHub Actions `Applications (Android, Windows)` (`.github/workflows/apps.yml`) construit les deux applications à chaque push, les essaie (émulateur Android 14 : lancement, liaison au serveur, notification, mise à jour, fichiers de l’atelier PDF ; Windows : installation silencieuse, lancement, PDF ouvert avec Melo, fermeture puis réouverture, désinstallation), puis les publie dans une Release GitHub : `latest` pour la branche principale, pré-release `apk-<branche>` pour les autres. Les fichiers sont aussi disponibles comme artefacts du workflow (onglet **Actions** → dernier run → `notes-apk`, `melo-windows`).

### Android (APK)

Options facultatives (Settings → Secrets and variables → Actions) :

- Variable `DEFAULT_SERVER_URL` : adresse de serveur pré-remplie dans l’APK.
- Variable `GOOGLE_CLIENT_ID` : ID client OAuth Google pré-rempli.
- Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` : produisent en plus un `Melo-Android-signe.apk` signé.

Construction locale (nécessite Android Studio / SDK Android et Java 21) : `npm run android:apk` → `android/app/build/outputs/apk/debug/app-debug.apk`. `npm run android:open` ouvre le projet dans Android Studio.

L’APK debug est signé avec une clé de debug versionnée (`android/app/debug.keystore`) pour que les mises à jour s’installent par‑dessus sans désinstaller.

### Windows

À la main, sous Windows : `npm install && npm run build` à la racine, puis `cd desktop && npm install && npm run dist` → `desktop/dist/Melo-Windows.exe`. Pour l’essayer sans installateur : `cd desktop && npm install && npm start`.

## Architecture

```
client/   React + Vite + BlockNote (éditeur) + Yjs (CRDT) + react-grid-layout (accueil) — thèmes de couleurs
server/   Node.js : Express (API, uploads, proxy iCal, caméras, fichiers statiques) + WebSocket Yjs (synchronisation, droits, persistance)
android/  Projet Capacitor Android (APK)
desktop/  Application Windows (Electron) : fenêtre, serveur Melo intégré, installateur (electron-builder)
docs/     Mode d’emploi, développement, captures d’écran du README
.github/  Workflow de construction de l’APK et de l’installateur Windows, essayés (émulateur Android, Windows) avant publication
CLAUDE.md Repères pour Claude Code, dont la carte du code (graphify) qui lui évite de relire tout le projet
```

- Chaque page est un document Yjs (`pg_<espace>_<page>`) ; l’arborescence (titres, icônes, hiérarchie) est un document Yjs séparé (`ws_<espace>`).
- Accueil (`client/src/dashboard`) : widgets et disposition par taille d’écran dans le document de l’espace (`dashboard`), catalogue des widgets dans `registry.tsx` ; texte des notes rapides (`dash-note:<widget>`) et tâches (`dash-tasks:<widget>`) dans leurs propres types Yjs, pour que plusieurs appareils y écrivent en même temps. Apparence (`appearance`) et agendas de la section Agenda (`agenda`) sont aussi dans le document de l’espace ; les couleurs sont appliquées par des variables CSS (`client/src/lib/appearance.ts`).
- Atelier PDF (`client/src/pdf`) : la bibliothèque (nom, miniature, fichiers utilisés) et les signatures sont dans le document de l’espace ; chaque PDF est un document Yjs (`pdf_<espace>_<pdf>`, réservé au propriétaire) qui décrit les pages (fichier d’origine, page, rotation), les annotations et les valeurs du formulaire. Les fichiers d’origine restent intacts dans `uploads/` ; le PDF final est fabriqué à l’export dans le navigateur (pdf-lib, formulaires remplis par pdf.js, protection retirée à l’import par QPDF compilé en WebAssembly). Supprimer un PDF efface son document et les fichiers qu’il était seul à utiliser.
- Glisser-déposer à l’intérieur des modules (`client/src/lib/sortable.ts`) : aperçu animé pendant le glisser, ordre enregistré au relâchement dans la configuration concernée (ordre et groupes de la Maison dans `smarthome`, caméras, homelab, raccourcis, tâches).
- Caméras (`server/src/cameras.js`) : ffmpeg lit le flux RTSP de chaque caméra et le réemballe sans le réencoder en MP4 fragmenté, partagé entre tous les spectateurs (un seul accès à la caméra) ; le navigateur le lit avec Media Source Extensions. Si l’appareil ne sait pas lire le format de la caméra (H.265), le serveur convertit en H.264, ou en VP9 à défaut.
- Un espace de travail est identifié par un identifiant et protégé par une clé secrète stockée sur l’appareil (première clé présentée = propriétaire). Les invités accèdent uniquement au sous-arbre partagé via un jeton.
- Invitations (`server/src/store.js`) : liens en attente dans `invites.json` (7 jours, une utilisation) ; l’espace créé est marqué `guest` dans `workspaces.json` (avec le prénom et l’espace qui a invité). Les routes qui touchent au réseau du serveur (maison, caméras, homelab) et les invitations elles-mêmes refusent ces espaces (`requireHost`). Liaison d’appareils : code à 6 chiffres (`pairing.js`) présenté aussi en lien `#/pair/<code>` et en QR code ; un lien reçu (invitation, liaison, partage, adresse) est reconnu par `parseMeloLink` (`client/src/lib/pairing.ts`).
- Application Windows (`desktop/`) : `main.cjs` lance le serveur de `server/src` dans un processus Electron (`utilityProcess`, 127.0.0.1:47821, données dans `%APPDATA%\Melo\data`, arrêt propre par message) et affiche son client, ou l’adresse d’un serveur distant retenue dans `melo-ordinateur.json`. Le pont `window.meloDesktop` (`preload.cjs`, typé dans `client/src/lib/desktop.ts`) donne le mode, le choix du serveur, les PDF ouverts avec Melo et les mises à jour (electron-updater, release `latest`). `desktop/scripts/prepare.mjs` copie le serveur et le client construit avant l’empaquetage. Journal de l’application : `%APPDATA%\Melo\melo.log` (et `serveur.log` pour le serveur intégré).
- Les données serveur sont dans `DATA_DIR` : `docs/` (documents), `uploads/` (fichiers), `workspaces.json`, `shares.json`, `invites.json`.
