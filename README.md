# Notes

Application de prise de notes façon **Notion** : thème gris très foncé, pages imbriquées à volonté, éditeur par blocs (commande `/`), import d’images, GIF, vidéos, PDF, intégrations YouTube, import d’**agenda Google**, et **partage de pages avec modification en direct** par d’autres personnes. Fonctionne sur le web et comme application Android (APK).

## Fonctionnalités

- **Éditeur par blocs** (BlockNote) : titres, listes, cases à cocher, citations, code, tableaux, séparateurs, couleurs, emojis… Tapez `/` pour ouvrir le menu de commandes, glissez les blocs avec la poignée `⠿`.
- **Pages dans des pages** : bouton `+` dans la barre latérale, bouton « Nouvelle sous-page » en bas de chaque page, ou commande `/Sous-page` pour insérer un lien de page dans le contenu. Arborescence réorganisable par glisser‑déposer, fil d’Ariane, recherche (`Ctrl+K`), corbeille avec restauration.
- **Médias** : images et GIF (`/Image`, glisser‑déposer ou coller), vidéos (`/Vidéo`), audio, fichiers, **PDF avec aperçu intégré** (`/PDF`), **intégrations** YouTube, Vimeo, Dailymotion, Google Drive/Docs, Google Agenda (iframe), Loom, Spotify, Figma… (`/YouTube`).
- **Agenda Google** (`/Agenda`) : import d’un fichier `.ics` exporté, d’une **adresse secrète iCal** (bloc actualisable d’un clic), ou directement depuis votre **compte Google** (OAuth, si vous renseignez un ID client) : cochez un ou plusieurs agendas, ou « Tout sélectionner », ils sont réunis dans un même bloc avec leurs couleurs. Les événements s’affichent par jour, avec la mise en avant du jour courant.
- **Collaboration en direct** : chaque page est un document CRDT (Yjs). Créez un lien de partage « modification » ou « lecture seule » ; les invités voient les curseurs des autres participants et peuvent créer des sous-pages (mode modification).
- **Hors ligne d’abord** : tout est stocké localement (IndexedDB) et synchronisé dès qu’un serveur est joignable. Plusieurs appareils peuvent être liés au même espace.
- **Pleine largeur** : les pages occupent toute la largeur de l’écran ; menu `⋯` d’une page > *Pleine largeur* pour revenir à une colonne centrée (réglage propre à chaque page, également appliqué aux invités d’un lien de partage).
- **Redimensionnement** : taille du texte des paragraphes, titres et listes (menu ⠿ du bloc > *Taille du texte*, ou liste *Normal* de la barre de mise en forme sur une sélection) ; largeur des images et vidéos (poignées latérales, menu ⠿ > *Largeur*, ou liste de la barre d’outils : 25 à 100 %) ; largeur (au pourcent près) et hauteur des blocs PDF, vidéo intégrée, agenda et homelab (poignées à droite et en bas) ; modules du tableau de bord homelab en taille libre (bouton *Redimensionner*, puis tirer le bord droit, le bord inférieur ou le coin d’un module ; flèches du clavier sur le coin ; double-clic sur le coin pour revenir à la taille automatique). Les modules s’emboîtent sans laisser de trou, un module agrandi affiche plus de statistiques et, sur téléphone, les modules s’empilent.
- **Tableau de bord homelab** (entrée « Homelab » de la barre latérale, ou bloc `/Homelab` dans une page) : état et statistiques de vos applications (Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, Jellyfin, Emby, Plex, Jellyseerr, Overseerr, qBittorrent, Transmission, Pi-hole, AdGuard Home, Portainer, Home Assistant, Uptime Kuma, Nextcloud, Immich, ou n’importe quelle URL) et de vos appareils (CPU, mémoire, disques, températures, uptime) via Glances, Proxmox VE, Synology DSM, TrueNAS ou l’hôte du serveur Notes lui-même.
- **Android** : application native via Capacitor, APK construit automatiquement par GitHub Actions.
- **Mises à jour sans réinstaller** : quand le serveur est mis à jour, l’application Android reçoit une notification « Mise à jour de Notes disponible » et se met à jour d’un geste, en téléchargeant la nouvelle version depuis votre serveur ; les navigateurs ouverts proposent de recharger la page.

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
| `MAX_WORKSPACES` | Nombre maximal d’espaces de travail (`0` = illimité). Mettez `1` sur un serveur accessible depuis Internet | `0` (Docker : `1`) |

### Déployer le serveur (pour partager et synchroniser)

Le partage de pages et la synchronisation entre appareils nécessitent que le serveur soit joignable par les autres (Internet ou réseau local).

**Guide pas à pas (serveur maison + accès depuis Internet en HTTPS) : [INSTALLATION.md](INSTALLATION.md).**

- **Docker** : `cp .env.example .env`, adaptez-le, puis `docker compose up -d --build` (données dans le dossier `./data`). Pour l’accès HTTPS depuis Internet : `docker compose --profile tunnel up -d` (Cloudflare Tunnel), `docker compose --profile caddy up -d` (Caddy), ou `sudo tailscale funnel --bg 3000` (Tailscale Funnel, sans nom de domaine).
- **Hébergeurs Node** (Render, Railway, Fly.io, VPS…) : commande de build `npm install && npm run build`, commande de démarrage `npm start`, et un disque persistant monté sur `DATA_DIR`.
- **Réseau local uniquement** : `npm start` sur votre ordinateur, puis utilisez `http://<ip-de-l-ordinateur>:3000` depuis le téléphone (même Wi‑Fi).

## Application Android (APK)

L’APK est construit automatiquement par le workflow GitHub Actions `Android APK` à chaque push. Dernière version : **https://github.com/ShinezeoGame/Notes/releases/tag/latest** (fichier `notes-debug.apk`).

Détail :

1. Onglet **Actions** du dépôt → dernier run → artefact `notes-apk`, **ou** onglet **Releases** : chaque branche publie une pré-release `apk-<branche>` (et `latest` pour la branche principale) contenant `notes-debug.apk`.
2. Sur le téléphone, téléchargez `notes-debug.apk`, autorisez l’installation depuis des sources inconnues, installez.
3. Au premier lancement, choisissez **Utiliser sur cet appareil** (hors ligne) ou **Se connecter à mon serveur** : collez l’adresse du serveur, ou le lien « Lier un appareil » copié depuis *Réglages* de l’application web pour retrouver exactement les mêmes pages.

### Mises à jour de l’application

Il n’est plus nécessaire de retélécharger l’APK à chaque nouvelle version :

1. Mettez le serveur à jour (`git pull && docker compose up -d --build`, voir [INSTALLATION.md](INSTALLATION.md)).
2. Le téléphone vérifie la version du serveur toutes les heures et affiche la notification **Mise à jour de Notes disponible** (autorisation demandée au premier lancement ; option dans *Réglages → Application et mises à jour*).
3. Touchez la notification, ou le bouton **Mettre à jour** du bandeau affiché dans l’application : la nouvelle version (environ 4 Mo) est téléchargée depuis le serveur, vérifiée fichier par fichier (SHA-256), puis l’application redémarre dessus. Vos notes restent sur l’appareil.

Si la nouvelle version ne démarre pas, l’application revient à la précédente au lancement suivant. Seules les évolutions de la partie native Android (rares) demandent d’installer un nouvel APK : l’application le signale alors avec un lien de téléchargement. Dans un navigateur, un bandeau **Recharger** apparaît quand le serveur a été mis à jour.

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
- **Compte Google** : renseignez un ID client OAuth dans *Réglages* (console.cloud.google.com → API Google Calendar activée → identifiant OAuth « Application Web » avec l’adresse de l’application comme origine JavaScript autorisée, et votre adresse Gmail dans *Audience → Utilisateurs test*). Cochez ensuite les agendas voulus (ou « Tout sélectionner ») : les événements sont fusionnés, les doublons retirés, et **Actualiser** relit tous les agendas du bloc. La connexion Google n’est pas disponible dans l’application Android (Google bloque sa page de connexion dans les applications) : importez depuis un navigateur, le bloc s’affiche ensuite partout.
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
