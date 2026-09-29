# Installer Notes sur votre serveur et y accéder depuis partout

Ce guide installe Notes sur un serveur de votre homelab avec Docker, le rend accessible en **HTTPS depuis Internet**, relie vos appareils (ordinateur, téléphone) au même espace, puis partage des pages en **modification en direct**.

**Prérequis** : un serveur Linux (ou un NAS avec Docker : Unraid, TrueNAS SCALE, Synology Container Manager, Proxmox LXC…) avec `git`, Docker et le plugin Docker Compose. Vérifiez :

```bash
docker compose version
```

> Pourquoi HTTPS ? Les invités et votre téléphone passent par Internet : le chiffrement protège vos notes et la clé de votre espace, et le navigateur exige HTTPS pour certaines fonctions (copie de lien, connexion Google).

---

## 1. Installer l’application sur le serveur

```bash
git clone https://github.com/ShinezeoGame/Notes.git   # dépôt public ; sinon voir l’encadré ci-dessous
cd Notes
cp .env.example .env
nano .env
```

> **Dépôt privé** : GitHub refuse les mots de passe pour `git clone`. Le plus simple sur un serveur est une clé de déploiement en lecture seule :
>
> ```bash
> ssh-keygen -t ed25519 -f ~/.ssh/notes_deploy -N "" -C "notes-server"
> cat ~/.ssh/notes_deploy.pub      # copiez toute la ligne affichée
> ```
>
> Collez cette ligne dans GitHub → dépôt Notes → Settings → Deploy keys → Add deploy key (sans cocher « Allow write access »), puis clonez **en SSH** (et non en `https://`) :
>
> ```bash
> GIT_SSH_COMMAND="ssh -i ~/.ssh/notes_deploy" git clone git@github.com:ShinezeoGame/Notes.git
> cd Notes
> git config core.sshCommand "ssh -i ~/.ssh/notes_deploy"
> ```

Dans `.env`, laissez pour l’instant `MAX_WORKSPACES=1` ; `PUBLIC_URL`, `COMPOSE_PROFILES` et le reste se remplissent à l’étape 2.

Vérifiez que le port 3000 est libre ; si la commande suivante affiche une ligne, il est déjà pris par une autre application : mettez `NOTES_PORT=3100` (ou un autre port libre) dans `.env` et utilisez ce port partout où ce guide indique 3000 côté serveur.

```bash
ss -ltn | grep ':3000 '
```

Lancez la construction et le démarrage (quelques minutes la première fois) :

```bash
docker compose up -d --build
sleep 5                                   # laisser l’application démarrer
curl http://localhost:3000/api/health     # ou le port choisi dans NOTES_PORT
```

La réponse `{"ok":true,…}` confirme que le serveur tourne. `curl: (56) Recv failure: Connection reset by peer` signifie seulement que l’application n’écoute pas encore : relancez `curl` quelques secondes plus tard. Si l’erreur persiste, `docker compose logs notes` affiche la cause. **N’ouvrez pas encore l’application dans un navigateur** : le premier appareil qui s’y connecte crée votre espace, et il doit le faire via l’adresse publique définitive (étape 3).

Les données (pages, fichiers importés, liens de partage) sont stockées dans le dossier `Notes/data`.

---

## 2. Rendre l’application accessible depuis Internet

Choisissez **une** des trois options :

- vous avez un nom de domaine → **option A** (Cloudflare Tunnel) ;
- pas de domaine, mais Tailscale est installé sur le serveur → **option C** (Tailscale Funnel), la plus rapide ;
- sinon → **option B** (Caddy) avec un sous‑domaine gratuit DuckDNS.

### Option A — Cloudflare Tunnel (votre nom de domaine)

Aucun port à ouvrir sur la box, fonctionne même sans IP fixe ou derrière un CGNAT, HTTPS automatique. Il faut un nom de domaine géré par Cloudflare (achat ~10 €/an, ou transfert gratuit de la gestion DNS d’un domaine existant).

1. Sur [dash.cloudflare.com](https://dash.cloudflare.com), ajoutez votre domaine (offre gratuite) et remplacez les serveurs DNS chez votre registraire par ceux indiqués par Cloudflare.
2. Ouvrez **Zero Trust → Networks → Tunnels** (le menu peut s’appeler *Connectors* selon la version) → **Create a tunnel** → type *Cloudflared* → nommez‑le `notes`.
3. Copiez le **jeton** : c’est la longue chaîne qui suit `--token` dans la commande d’installation affichée. N’exécutez pas cette commande, le conteneur est déjà prévu.
4. Dans l’onglet **Public Hostname** (ou *Published application routes*) : sous‑domaine `notes`, domaine `mondomaine.fr`, service **HTTP**, URL **`notes:3000`**.
5. Dans `.env` :

   ```ini
   COMPOSE_PROFILES=tunnel
   TUNNEL_TOKEN=eyJhIjoi…            # le jeton copié
   PUBLIC_URL=https://notes.mondomaine.fr
   MAX_UPLOAD_MB=100                 # limite de l’offre gratuite Cloudflare
   ```

6. Appliquez :

   ```bash
   docker compose up -d
   ```

Les WebSockets (modification en direct) sont activés par défaut chez Cloudflare.

### Option B — Caddy + ouverture des ports 80/443

Nécessite une IP publique (pas de CGNAT) et un nom de domaine pointant dessus. Sans domaine, un sous‑domaine gratuit [DuckDNS](https://www.duckdns.org) (`monnom.duckdns.org`) convient.

1. Créez un enregistrement DNS `A` `notes.mondomaine.fr` vers votre IP publique (visible sur [ifconfig.me](https://ifconfig.me)). Si votre IP change, activez le DynDNS de votre box ou le client de mise à jour DuckDNS.
2. Sur votre box (Freebox, Livebox, SFR, Bbox…), donnez une IP locale fixe au serveur (bail DHCP statique), puis redirigez les ports **TCP 80 et 443** vers lui.
3. Dans `.env` :

   ```ini
   COMPOSE_PROFILES=caddy
   DOMAIN=notes.mondomaine.fr
   PUBLIC_URL=https://notes.mondomaine.fr
   ```

4. Appliquez :

   ```bash
   docker compose up -d
   ```

   Caddy obtient le certificat HTTPS Let’s Encrypt en une minute environ (`docker compose logs caddy` pour suivre).

### Option C — Tailscale Funnel (sans nom de domaine)

Si le serveur est déjà sur votre réseau Tailscale, Funnel publie l’application sur une adresse HTTPS publique et gratuite du type `https://serveur.tailxxxx.ts.net`, sans domaine ni port à ouvrir. Les invités n’ont pas besoin de Tailscale pour ouvrir vos liens de partage.

1. Vérifiez que Tailscale est en version 1.52 ou plus récente :

   ```bash
   tailscale version
   ```

2. Publiez le port de Notes (3000, ou la valeur de `NOTES_PORT`) :

   ```bash
   sudo tailscale funnel --bg 3000
   ```

   La première fois, la commande affiche un lien `https://login.tailscale.com/…` : ouvrez‑le, connectez‑vous et acceptez l’activation de Funnel (et des certificats HTTPS si c’est demandé). Si la commande s’est arrêtée entre‑temps, relancez‑la. Elle affiche ensuite l’adresse publique après « Available on the internet ». Avec `--bg`, la publication est conservée après un redémarrage.

3. Dans `.env`, laissez `COMPOSE_PROFILES=` vide et indiquez l’adresse affichée, sans `/` final :

   ```ini
   PUBLIC_URL=https://serveur.tailxxxx.ts.net
   ```

4. Appliquez :

   ```bash
   docker compose up -d
   ```

`tailscale funnel status` affiche la publication en cours ; `sudo tailscale funnel --https=443 off` la retire.

> `tailscale` introuvable alors que le serveur est joignable par son adresse Tailscale ? Tailscale tourne alors dans un conteneur qui partage le réseau de l’hôte (app CasaOS, par exemple) : remplacez `sudo tailscale` par `docker exec NOM_DU_CONTENEUR tailscale`, le nom étant visible avec `docker ps`.

**Vous avez déjà un reverse proxy** (Nginx Proxy Manager, Traefik, SWAG…) qui occupe les ports 80/443 ? Laissez `COMPOSE_PROFILES` vide et créez un hôte `notes.mondomaine.fr` → `http://IP-DU-SERVEUR:3000` (ou le port `NOTES_PORT`) avec **Websockets Support** activé. Pour Nginx Proxy Manager, ajoutez aussi dans l’onglet *Advanced* : `client_max_body_size 200m;` (sinon les fichiers de plus de 1 Mo sont refusés).

**Vérification** : sur votre téléphone, Wi‑Fi coupé et Tailscale désactivé, ouvrez `https://VOTRE-ADRESSE/api/health`. Vous devez voir `{"ok":true,…}`. La toute première connexion HTTPS peut prendre quelques secondes, le temps que le certificat soit créé.

> Choisissez l’adresse définitive dès maintenant : les fichiers importés dans vos pages gardent l’adresse publique en vigueur au moment de l’import.

---

## 3. Première connexion, vos appareils, le partage

### Créer votre espace (une seule fois)

1. Sur votre ordinateur, ouvrez **`https://notes.mondomaine.fr`**. Ce premier navigateur crée **votre** espace de travail. Le point vert à côté de « Mes notes » indique que la synchronisation fonctionne.
2. Facultatif : dans les **Réglages** (roue dentée en haut à gauche), le lien caché sous **« Ou avec un lien »** est la clé de secours de votre espace. Rangez‑le dans votre gestionnaire de mots de passe et ne le donnez à personne.

Avec `MAX_WORKSPACES=1`, plus personne ne peut créer d’espace sur votre serveur : un inconnu qui ouvre l’adresse ne voit rien de vos notes et ne peut ni téléverser de fichiers ni utiliser le tableau de bord homelab.

### Relier le téléphone et vos autres appareils

Sur un appareil déjà relié : **Réglages → Afficher un code de liaison**. Un code à 6 chiffres s’affiche, valable 10 minutes et utilisable une seule fois. Puis, sur le nouvel appareil :

- **Application Android** : installez `notes-debug.apk` depuis [la dernière version](https://github.com/ShinezeoGame/Notes/releases/tag/latest), lancez‑la, choisissez **« Se connecter à mon serveur »**, saisissez l’adresse du serveur et le code. Si l’application est déjà installée : **Réglages → Relier cet appareil avec un code**.
- **Navigateur** (autre ordinateur, téléphone) : ouvrez l’adresse du serveur ; le bandeau rouge « Cet appareil n’est pas relié » propose **Saisir un code**.

Les pages créées sur un appareil avant de le relier ne sont pas transférées. Après 5 codes faux, le serveur fait patienter une minute ; après 10, tous les codes en cours sont annulés.

### Installer Notes sur Windows (ou Mac, Linux)

Notes s’installe comme une application depuis **Microsoft Edge**, **Google Chrome** ou **Brave**, sans fichier à télécharger :

1. Ouvrez l’adresse de votre serveur (par exemple `https://pc-nas.tail85eb5c.ts.net`) et reliez cet ordinateur si ce n’est pas déjà fait (bandeau rouge → **Saisir un code**).
2. Cliquez sur **Installer l’application** en bas de la barre latérale (ou **Réglages → Installer Notes sur cet ordinateur**, ou l’icône d’installation à droite de la barre d’adresse), puis sur **Installer**.

Notes s’ouvre alors dans sa propre fenêtre, avec son icône dans le menu Démarrer (épinglez‑la à la barre des tâches si vous le souhaitez ; un clic droit sur l’icône donne accès à **Maison**, **Homelab** et à l’**Atelier PDF**). Dans l’Explorateur, un clic droit sur un fichier PDF → **Ouvrir avec** → **Notes** l’importe directement dans l’atelier PDF. Elle se met à jour toute seule avec le serveur, s’ouvre même quand le serveur est injoignable (vos pages déjà chargées restent consultables et modifiables, la synchronisation reprend au retour du réseau) et se désinstalle comme n’importe quelle application (Paramètres Windows → Applications). L’installation depuis le navigateur demande une adresse en `https://` (comme celle de Tailscale Funnel ou de votre nom de domaine).

### Atelier PDF sur le téléphone

L’atelier PDF (entrée **PDF** du menu) fonctionne dès la mise à jour du serveur. Pour **enregistrer** un PDF exporté dans le dossier de votre choix, le **partager** (WhatsApp, e‑mail, Drive…) et ouvrir dans Notes les PDF reçus (**Ouvrir avec Notes**, **Partager → Notes**), installez **une fois** la dernière version de l’application : https://github.com/ShinezeoGame/Notes/releases/tag/latest (fichier `notes-debug.apk`, installé par‑dessus l’ancien, vos notes sont conservées). Sans cette mise à jour, **Exporter** ouvre le PDF dans le navigateur du téléphone, d’où vous pouvez le télécharger.

Pour scanner un document papier : **PDF** → **Scanner un document** (l’appareil photo s’ouvre), puis, dans la vue **Pages**, **Photo** pour ajouter les pages suivantes.

### Partager une page en modification en direct

1. Ouvrez la page, cliquez sur **Partager** (en haut à droite) → **Lien de modification** (ou **Lien en lecture seule**). Le lien est copié.
2. Envoyez‑le (SMS, WhatsApp, e‑mail…). La personne l’ouvre dans n’importe quel navigateur, **sans compte** : elle voit la page et ses sous‑pages, choisit son nom en haut de l’écran, et vos curseurs et modifications apparaissent instantanément chez chacun.
3. Le même bouton **Partager** liste les liens actifs : **Révoquer** coupe l’accès immédiatement.

Un lien donne accès à la page **et à toutes ses sous‑pages** : partagez une page dédiée plutôt que la racine de vos notes.

### Tableau de bord homelab

Le serveur tournant dans votre homelab, la section **Homelab** peut interroger vos applications avec leurs adresses locales (`http://192.168.1.10:8989`…). Pour afficher l’occupation de vos disques dans la carte « Hôte de ce serveur », montez‑les en lecture seule dans un fichier `docker-compose.override.yml` à côté de `docker-compose.yml` (plutôt que de modifier ce dernier, ce qui bloquerait la mise à jour automatique) :

```yaml
services:
  notes:
    volumes:
      - /mnt/media:/mnt/media:ro
```

Appliquez avec `docker compose up -d`, puis listez `/mnt/media` dans les points de montage de l’appareil.

### Maison connectée (Home Assistant)

La section **Maison** pilote vos lumières, prises, volets, chauffage, caméras… à travers Home Assistant. Si vous ne l’avez pas encore, installez l’application « Home Assistant » depuis la boutique de CasaOS, ouvrez‑la sur le port 8123 et ajoutez vos appareils. Créez ensuite un jeton (votre nom → **Sécurité** → **Jetons d’accès longue durée**) et saisissez‑le dans Notes → **Maison** → **Connecter Home Assistant**, avec l’adresse `http://IP-DU-SERVEUR:8123` (l’adresse IP locale, pas `localhost` : Notes tourne dans son propre conteneur).

### Caméras de surveillance

La section **Caméras** se connecte directement à vos caméras IP et enregistreurs (flux RTSP, images ou flux MJPEG) : rien à installer, le lecteur vidéo (ffmpeg) est inclus dans l’image Docker de Notes. Les caméras doivent être joignables depuis le serveur (même réseau local) : donnez‑leur une adresse IP fixe dans votre box (réservation DHCP), puis ajoutez‑les dans Notes → **Caméras** → **Ajouter une caméra** et cliquez sur **Tester**. Sans Docker, installez ffmpeg sur le serveur (`sudo apt install ffmpeg`).

### Mise à jour automatique (recommandé)

Une seule commande, à lancer une fois dans le dossier `Notes` :

```bash
sh scripts/install-auto-update.sh
```

Toutes les 15 minutes, le serveur regarde si une nouvelle version est publiée sur le dépôt ; si oui, il la récupère et se reconstruit (quelques secondes d’interruption), puis les téléphones reçoivent la notification de mise à jour. Si Docker demande les droits administrateur, le script le détecte et installe la tâche pour root (mot de passe demandé une fois).

- Journal : `tail -n 20 auto-update.log`
- Vérifier tout de suite : `sh scripts/auto-update.sh` (précédé de `sudo` si Docker l'exige ; `--force` pour reconstruire même sans nouveauté)
- Arrêter : `sh scripts/install-auto-update.sh --remove`
- Autre fréquence, par exemple chaque nuit à 4 h : `NOTES_UPDATE_SCHEDULE='0 4 * * *' sh scripts/install-auto-update.sh`

Si une nouvelle version ne se construit pas, l’ancienne continue de fonctionner et le journal indique l’erreur. Ne modifiez pas les fichiers du dépôt sur le serveur : vos réglages vont dans `.env` et `docker-compose.override.yml` (sinon le journal signale une « mise à jour bloquée »).

### Entretien

```bash
cd Notes
git pull && docker compose up -d --build     # mettre à jour à la main
docker compose logs -f notes                 # voir les journaux
tar czf ~/notes-$(date +%F).tar.gz data      # sauvegarder toutes les données
```

Restaurer une sauvegarde : arrêtez (`docker compose down`), remplacez le dossier `data` par celui de l’archive, relancez (`docker compose up -d`).

Après une mise à jour du serveur, l’application Android affiche dans l’heure une notification **Mise à jour de Notes disponible** : touchez‑la pour installer la nouvelle version, sans retélécharger l’APK. Les navigateurs ouverts proposent de recharger la page.
