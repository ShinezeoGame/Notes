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

Choisissez **une** des deux options.

### Option A — Cloudflare Tunnel (recommandée)

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

**Vous avez déjà un reverse proxy** (Nginx Proxy Manager, Traefik, SWAG…) qui occupe les ports 80/443 ? Laissez `COMPOSE_PROFILES` vide et créez un hôte `notes.mondomaine.fr` → `http://IP-DU-SERVEUR:3000` (ou le port `NOTES_PORT`) avec **Websockets Support** activé. Pour Nginx Proxy Manager, ajoutez aussi dans l’onglet *Advanced* : `client_max_body_size 200m;` (sinon les fichiers de plus de 1 Mo sont refusés).

**Vérification** : sur votre téléphone, Wi‑Fi coupé, ouvrez `https://notes.mondomaine.fr/api/health`. Vous devez voir `{"ok":true,…}`.

> Accès pour vous seul ? [Tailscale](https://tailscale.com) permet d’y accéder partout sans rien exposer, mais les personnes hors de votre réseau Tailscale ne pourront pas ouvrir les liens de partage.

---

## 3. Première connexion, vos appareils, le partage

### Créer votre espace (une seule fois)

1. Sur votre ordinateur, ouvrez **`https://notes.mondomaine.fr`**. Ce premier navigateur crée **votre** espace de travail. Le point vert à côté de « Mes notes » indique que la synchronisation fonctionne.
2. Ouvrez **Réglages ⚙️** et copiez le lien **« Lier un autre appareil »**. Rangez‑le dans votre gestionnaire de mots de passe : c’est la clé de votre espace, ne le donnez à personne.

Avec `MAX_WORKSPACES=1`, plus personne ne peut créer d’espace sur votre serveur : un inconnu qui ouvre l’adresse ne voit rien de vos notes et ne peut ni téléverser de fichiers ni utiliser le tableau de bord homelab.

### Relier le téléphone et vos autres appareils

- **Application Android** : installez `notes-debug.apk` depuis [la dernière version](https://github.com/ShinezeoGame/Notes/releases/tag/latest), lancez‑la, choisissez **« Se connecter à mon serveur »** et collez le lien « Lier un autre appareil ».
- **Navigateur** (téléphone, autre ordinateur) : ouvrez directement le lien « Lier un autre appareil », puis **« Lier cet appareil »**.

Si un appareil affiche « Ce serveur n’accepte pas de nouvel espace de travail », c’est qu’il n’a pas encore été relié : utilisez le lien. Les pages créées hors ligne sur un appareil avant de le relier ne sont pas transférées.

### Partager une page en modification en direct

1. Ouvrez la page, cliquez sur **Partager** (en haut à droite) → **Lien de modification** (ou **Lien en lecture seule**). Le lien est copié.
2. Envoyez‑le (SMS, WhatsApp, e‑mail…). La personne l’ouvre dans n’importe quel navigateur, **sans compte** : elle voit la page et ses sous‑pages, choisit son nom en haut de l’écran, et vos curseurs et modifications apparaissent instantanément chez chacun.
3. Le même bouton **Partager** liste les liens actifs : **Révoquer** coupe l’accès immédiatement.

Un lien donne accès à la page **et à toutes ses sous‑pages** : partagez une page dédiée plutôt que la racine de vos notes.

### Tableau de bord homelab

Le serveur tournant dans votre homelab, la section **Homelab** peut interroger vos applications avec leurs adresses locales (`http://192.168.1.10:8989`…). Pour afficher l’occupation de vos disques dans la carte « Hôte de ce serveur », ajoutez‑les en lecture seule dans `docker-compose.yml` (section `volumes` du service `notes`, par ex. `- /mnt/media:/mnt/media:ro`), puis listez `/mnt/media` dans les points de montage de l’appareil.

### Entretien

```bash
cd Notes
git pull && docker compose up -d --build     # mettre à jour
docker compose logs -f notes                 # voir les journaux
tar czf ~/notes-$(date +%F).tar.gz data      # sauvegarder toutes les données
```

Restaurer une sauvegarde : arrêtez (`docker compose down`), remplacez le dossier `data` par celui de l’archive, relancez (`docker compose up -d`).
