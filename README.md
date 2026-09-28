# Notes

Application de prise de notes façon **Notion** : thème gris très foncé, pages imbriquées à volonté, éditeur par blocs (commande `/`), import d’images, GIF, vidéos, PDF, intégrations YouTube, import d’**agenda Google**, et **partage de pages avec modification en direct** par d’autres personnes. Fonctionne sur le web et comme application Android (APK).

## Fonctionnalités

- **Éditeur par blocs** (BlockNote) : titres, listes, cases à cocher, citations, code, tableaux, séparateurs, couleurs, emojis… Tapez `/` pour ouvrir le menu de commandes, glissez les blocs avec la poignée `⠿`.
- **Pages dans des pages** : bouton `+` dans la barre latérale, bouton « Nouvelle sous-page » en bas de chaque page, ou commande `/Sous-page` pour insérer un lien de page dans le contenu. Arborescence réorganisable par glisser‑déposer, fil d’Ariane, recherche (`Ctrl+K`), corbeille avec restauration.
- **Médias** : images et GIF (`/Image`, glisser‑déposer ou coller), vidéos (`/Vidéo`), audio, fichiers, **PDF avec aperçu intégré** (`/PDF`), **intégrations** YouTube, Vimeo, Dailymotion, Google Drive/Docs, Google Agenda (iframe), Loom, Spotify, Figma… (`/YouTube`).
- **Agenda Google** (`/Agenda`) : import d’un fichier `.ics` exporté, d’une **adresse secrète iCal** (bloc actualisable d’un clic), ou directement depuis votre **compte Google** (OAuth, si vous renseignez un ID client). Les événements s’affichent par jour, avec la mise en avant du jour courant.
- **Collaboration en direct** : chaque page est un document CRDT (Yjs). Créez un lien de partage « modification » ou « lecture seule » ; les invités voient les curseurs des autres participants et peuvent créer des sous-pages (mode modification).
- **Hors ligne d’abord** : tout est stocké localement (IndexedDB) et synchronisé dès qu’un serveur est joignable. Plusieurs appareils peuvent être liés au même espace.
- **Tableau de bord homelab** (entrée « Homelab » de la barre latérale, ou bloc `/Homelab` dans une page) : état et statistiques de vos applications (Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, Jellyfin, Emby, Plex, Jellyseerr, Overseerr, qBittorrent, Transmission, Pi-hole, AdGuard Home, Portainer, Home Assistant, Uptime Kuma, Nextcloud, Immich, ou n’importe quelle URL) et de vos appareils (CPU, mémoire, disques, températures, uptime) via Glances, Proxmox VE, Synology DSM, TrueNAS ou l’hôte du serveur Notes lui-même.
- **Android** : application native via Capacitor, APK construit automatiquement par GitHub Actions.

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

### Déployer le serveur (pour partager et synchroniser)

Le partage de pages et la synchronisation entre appareils nécessitent que le serveur soit joignable par les autres (Internet ou réseau local).

- **Docker** : `docker compose up -d` (données persistées dans le volume `notes-data`). Placez‑le derrière un reverse proxy HTTPS (Caddy, Nginx, Traefik) et définissez `PUBLIC_URL=https://notes.mondomaine.fr`.
- **Hébergeurs Node** (Render, Railway, Fly.io, VPS…) : commande de build `npm install && npm run build`, commande de démarrage `npm start`, et un disque persistant monté sur `DATA_DIR`.
- **Réseau local uniquement** : `npm start` sur votre ordinateur, puis utilisez `http://<ip-de-l-ordinateur>:3000` depuis le téléphone (même Wi‑Fi).

## Application Android (APK)

L’APK est construit automatiquement par le workflow GitHub Actions `Android APK` à chaque push. Dernière version : **https://github.com/ShinezeoGame/Notes/releases/tag/latest** (fichier `notes-debug.apk`).

Détail :

1. Onglet **Actions** du dépôt → dernier run → artefact `notes-apk`, **ou** onglet **Releases** : chaque branche publie une pré-release `apk-<branche>` (et `latest` pour la branche principale) contenant `notes-debug.apk`.
2. Sur le téléphone, téléchargez `notes-debug.apk`, autorisez l’installation depuis des sources inconnues, installez.
3. Au premier lancement, choisissez **Utiliser sur cet appareil** (hors ligne) ou **Se connecter à mon serveur** : collez l’adresse du serveur, ou le lien « Lier un appareil » copié depuis *Réglages* de l’application web pour retrouver exactement les mêmes pages.

Options facultatives (Settings → Secrets and variables → Actions) :

- Variable `DEFAULT_SERVER_URL` : adresse de serveur pré-remplie dans l’APK.
- Variable `GOOGLE_CLIENT_ID` : ID client OAuth Google pré-rempli.
- Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` : produisent en plus un `notes-release.apk` signé.

Construction locale (nécessite Android Studio / SDK Android et Java 21) : `npm run android:apk` → `android/app/build/outputs/apk/debug/app-debug.apk`. `npm run android:open` ouvre le projet dans Android Studio.

L’APK debug est signé avec une clé de debug versionnée (`android/app/debug.keystore`) pour que les mises à jour s’installent par‑dessus sans désinstaller.

## Importer un agenda Google

Dans une page, tapez `/Agenda` puis :

- **Fichier .ics** : Google Agenda (web) → *Paramètres* → *Importer et exporter* → *Exporter* → décompressez et choisissez l’agenda.
- **Lien iCal** : *Paramètres* → votre agenda → *Intégrer l’agenda* → « Adresse secrète au format iCal ». Le bloc dispose alors d’un bouton **Actualiser** (nécessite un serveur configuré, qui récupère le flux pour vous).
- **Compte Google** : renseignez un ID client OAuth dans *Réglages* (console.cloud.google.com → API Google Calendar activée → identifiant OAuth « Application Web » avec l’adresse de l’application comme origine JavaScript autorisée).
- Pour afficher l’agenda Google interactif dans la page, utilisez `/YouTube` (bloc intégration) avec le lien d’intégration fourni par Google Agenda.

## Tableau de bord homelab

Barre latérale → **Homelab** → **Configurer**.

- **Applications** : « Ajouter la stack » pré-remplit Jellyfin, Jellyseerr, Sonarr, Radarr, Prowlarr, Bazarr et qBittorrent avec leurs ports par défaut à partir de l’adresse de votre serveur ; renseignez ensuite la clé API (ou les identifiants) de chacune pour obtenir les statistiques (file d’attente, éléments manquants, lectures en cours, demandes en attente, vitesses de téléchargement, requêtes bloquées, conteneurs actifs…). Sans clé, seule la disponibilité (en ligne / hors ligne, latence) est vérifiée. L’« URL interne » permet d’indiquer une adresse Docker (ex. `http://sonarr:8989`) différente de l’URL ouverte au clic.
- **Appareils** : *Hôte de ce serveur Notes* (aucune configuration ; en Docker, montez les volumes à surveiller et listez leurs points de montage), *Glances* (`glances -w` ou l’image Docker `nicolargo/glances`, port 61208 : le plus simple pour un NAS ou un serveur Linux), *Proxmox VE* (jeton API), *Synology DSM* (compte sans 2FA), *TrueNAS* (clé API).
- Le bouton **Tester** de chaque formulaire valide la connexion depuis le serveur. Toutes les requêtes sont faites par le serveur Notes (accès au réseau local sans CORS) ; les secrets ne sont jamais renvoyés au navigateur. L’actualisation est automatique (30 s par défaut).
- Tapez `/Homelab` dans une page pour y intégrer un aperçu du tableau de bord.

## Partager une page

Bouton **Partager** en haut à droite (ou menu `⋯` d’une page dans la barre latérale) → *Lien de modification* ou *Lien en lecture seule*. Le lien est copié automatiquement ; il donne accès à la page et à ses sous-pages. Les liens peuvent être révoqués à tout moment.

## Architecture

```
client/   React + Vite + BlockNote (éditeur) + Yjs (CRDT) — thème sombre
server/   Node.js : Express (API, uploads, proxy iCal, fichiers statiques) + WebSocket Yjs (synchronisation, droits, persistance)
android/  Projet Capacitor Android (APK)
.github/  Workflow de construction de l’APK
```

- Chaque page est un document Yjs (`pg_<espace>_<page>`) ; l’arborescence (titres, icônes, hiérarchie) est un document Yjs séparé (`ws_<espace>`).
- Un espace de travail est identifié par un identifiant et protégé par une clé secrète stockée sur l’appareil (première clé présentée = propriétaire). Les invités accèdent uniquement au sous-arbre partagé via un jeton.
- Les données serveur sont dans `DATA_DIR` : `docs/` (documents), `uploads/` (fichiers), `workspaces.json`, `shares.json`.
