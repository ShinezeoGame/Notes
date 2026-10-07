# Mode d’emploi d’Ostal

Tout ce que fait Ostal, section par section. Pour une présentation rapide, voir le [README](../README.md) ; pour installer votre propre serveur (partage, synchronisation), voir [INSTALLATION.md](../INSTALLATION.md).

Ostal s’appelait Melo jusqu’en octobre 2026 : même application, nouveau nom. Les applications déjà installées gardent vos données et vos réglages en se mettant à jour.

- [Installer Ostal](#installer-ostal)
- [Premiers pas](#premiers-pas)
- [Partager](#partager)
- [Accueil et widgets](#accueil-et-widgets)
- [Personnaliser](#personnaliser)
- [Notes](#notes)
- [Tableur](#tableur)
- [Agenda](#agenda)
- [Maison connectée](#maison-connectée)
- [Caméras de surveillance](#caméras-de-surveillance)
- [Homelab](#homelab)
- [Allumer un ordinateur](#allumer-un-ordinateur)
- [Atelier PDF](#atelier-pdf)

## Installer Ostal

| Appareil | Fichier | Installation |
| --- | --- | --- |
| **Ordinateur Windows** | [Ostal-Windows.exe](https://github.com/ShinezeoGame/Notes/releases/download/latest/Ostal-Windows.exe) | Ouvrez le fichier. Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires**, puis **Exécuter quand même**. Ostal s’installe tout seul (sans droits d’administrateur) et s’ouvre ; il se retrouve ensuite sur le bureau et dans le menu Démarrer. |
| **Téléphone Android** | [Ostal-Android.apk](https://github.com/ShinezeoGame/Notes/releases/download/latest/Ostal-Android.apk) | Ouvrez le fichier sur le téléphone, autorisez l’installation depuis cette source si on vous le demande, puis **Installer**. |
| **Navigateur** (tout appareil) | aucun | Ouvrez l’adresse d’un serveur Ostal (le vôtre ou celui d’un proche). Sur ordinateur, **Installer l’application** en bas de la barre de gauche en fait une application. |

Toutes les versions, avec ces instructions : **[page de téléchargement](https://github.com/ShinezeoGame/Notes/releases/tag/latest)** (rubrique *Assets*). Une nouvelle version s’installe par‑dessus l’ancienne : vos pages sont gardées.

> **Dépôt privé** : ces liens ne s’ouvrent que pour les personnes qui ont accès au dépôt sur GitHub (connectées à leur compte). Pour donner l’application à quelqu’un : ajoutez‑le au dépôt (**Settings → Collaborators → Add people**), ou rendez le dépôt public (**Settings → General → Danger Zone → Change repository visibility**) pour qu’un simple lien suffise ; l’application Windows se met alors aussi à jour toute seule.

### Application Windows

`Ostal-Windows.exe` installe Ostal pour l’utilisateur de l’ordinateur, sans droits d’administrateur : raccourcis sur le bureau et dans le menu Démarrer, **Ouvrir avec → Ostal** pour les PDF (importés dans l’atelier PDF), désinstallation par *Paramètres Windows → Applications*.

- **Sur cet ordinateur** (**Commencer**) : Ostal embarque son propre serveur, lancé en arrière-plan et joignable de cet ordinateur seulement. Toutes les sections fonctionnent sans serveur ni compte, y compris l’atelier PDF, la maison connectée, le homelab et les caméras (celles-ci demandent [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) dans le PATH, sauf les caméras à images ou MJPEG). Les données sont dans `%APPDATA%\Ostal\data` : c’est ce dossier qu’il faut sauvegarder.
- **Sur un serveur** (**J’ai une invitation ou un code**, ou *Réglages → Rejoindre un serveur*) : la fenêtre affiche le serveur choisi, toujours à jour, comme l’application installée depuis le navigateur. *Réglages → Revenir à l’espace de cet ordinateur* y ramène ; les deux espaces restent séparés. Serveur injoignable au démarrage : une page propose de réessayer ou de revenir à l’espace de l’ordinateur.
- **Mises à jour** : si le dépôt GitHub est public, Ostal télécharge les nouvelles versions en arrière-plan et les installe à la fermeture (bandeau **Redémarrer** pour le faire tout de suite). Sinon, installez la nouvelle version par-dessus l’ancienne : les données sont gardées.

### Application Android

1. Sur le téléphone, téléchargez `Ostal-Android.apk` ([dernière version](https://github.com/ShinezeoGame/Notes/releases/tag/latest)), autorisez l’installation depuis des sources inconnues, installez.
2. Au premier lancement, touchez **Français** en haut de l’écran pour passer Ostal en français, puis choisissez **Commencer** (Ostal sur ce téléphone seul, sans serveur) ou **J’ai une invitation ou un code** : collez le lien reçu (invitation, ou liaison affichée par *Réglages → Relier un autre appareil* sur un appareil déjà relié), ou saisissez l’adresse du serveur puis le **code à 6 chiffres**, pour retrouver exactement les mêmes pages. Une application déjà installée se relie depuis *Réglages → Saisir un lien ou un code*.

**Mises à jour, sans retélécharger l’APK** :

1. Le serveur se met à jour : automatiquement toutes les 15 minutes après `sh scripts/install-auto-update.sh` (une fois), ou à la main avec `git pull && docker compose up -d --build` (voir [INSTALLATION.md](../INSTALLATION.md)).
2. Le téléphone vérifie la version du serveur toutes les heures et affiche la notification **Mise à jour d’Ostal disponible** (autorisation demandée au premier lancement ; option dans *Réglages → Application et mises à jour*).
3. Touchez la notification, ou le bouton **Mettre à jour** du bandeau affiché dans l’application : la nouvelle version (environ 6 Mo) est téléchargée depuis le serveur, vérifiée fichier par fichier (SHA-256), puis l’application redémarre dessus. Vos notes restent sur l’appareil.

Si la nouvelle version ne démarre pas, l’application revient à la précédente au lancement suivant. Seules les évolutions de la partie native Android (rares) demandent d’installer un nouvel APK : l’application le signale alors avec un lien de téléchargement. Dans un navigateur, un bandeau **Recharger** apparaît quand le serveur a été mis à jour.

Quand une version apporte un nouveau type de bloc (les colonnes, les caméras…), un appareil resté sur l’ancienne version ne synchronise plus les pages tant qu’il n’est pas mis à jour (bandeau *Mettre à jour*) : il effacerait sinon les blocs qu’il ne connaît pas. Ses modifications restent sur l’appareil et sont envoyées après la mise à jour.

### Navigateur (Windows, Mac, Linux)

Depuis Edge, Chrome ou Brave, le bouton **Installer l’application** (en bas de la barre des sections) fait d’Ostal une application : fenêtre à part, icône dans le menu Démarrer, ouverture même sans réseau, mises à jour automatiques depuis le serveur.

## Premiers pas

1. Au premier lancement, Ostal s’affiche en anglais : touchez **Français** en haut de l’écran, il redémarre aussitôt en français. Dans l’application : **Commencer**, et Ostal fonctionne tout de suite, sur cet appareil ; vous avez reçu un lien ou un code ? **J’ai une invitation ou un code**. Dans un navigateur, sur un serveur Ostal, la bienvenue s’ouvre directement.
2. Indiquez votre prénom et cochez ce que vous allez utiliser : seules ces sections s’affichent (**Personnaliser → Sections** pour changer d’avis). La maison (objets connectés, caméras, homelab) est décochée d’office : elle sert seulement à qui a ce matériel. Sans serveur Ostal, ce qui en a besoin (maison, atelier PDF) est grisé.
3. Une courte présentation montre l’essentiel (**Passer la visite** pour aller droit au but) ; revoyez‑la quand vous voulez : **Réglages → Revoir la présentation**.
4. Une section pas encore réglée (objets connectés, caméras, homelab, agenda) dit à quoi elle sert, ce qu’il faut pour s’en servir et comment commencer. Elle ne vous sert pas ? **Je n’en ai pas besoin : masquer cette section** la retire de la barre (elle se réaffiche dans **Personnaliser → Sections**), et ses widgets quittent le catalogue.
5. La barre de gauche réunit les sections par usage : **Accueil** ; **Organisation** (Notes, Agenda) ; **Maison** (Objets connectés, Caméras, Homelab) ; **Outils** (Atelier PDF). Sur ordinateur, elle se replie en icônes avec la flèche du haut. Sur téléphone : onglets en bas de l’écran, le reste dans **Plus**.

Tout est stocké sur l’appareil (hors ligne d’abord) et synchronisé dès qu’un serveur est joignable ; plusieurs appareils peuvent être reliés au même espace.

**Langue** (anglais ou français) : propre à chaque appareil, elle se change à tout moment dans **Réglages → Vous → Langue de l’interface**. Dans un navigateur, une petite carte en bas de l’écran la propose à la première visite ; sur une page partagée, **EN / FR** en haut à droite. Une personne qui ouvre un de vos liens (page partagée, invitation, liaison d’un appareil) pour la première fois voit Ostal dans la langue de son navigateur, en français ou en anglais. Une installation d’Ostal d’avant le choix de la langue reste en français. Le contenu (pages, titres, widgets) n’est pas traduit.

## Partager

- **Une page** : bouton **Partager** → **Peut modifier** ou **Peut seulement lire** → **Copier le lien** (ou **Envoyer…**). La personne l’ouvre dans son navigateur, sans compte ni installation, et voit les modifications en direct, avec les curseurs et les prénoms des autres participants ; en modification, elle peut aussi créer des sous-pages. Le lien donne accès à la page et à ses sous‑pages ; **Désactiver** (même fenêtre) coupe l’accès.
- **Vos appareils** (téléphone, autre ordinateur) : **Réglages → Relier un autre appareil** → scannez le QR code avec l’appareil photo du téléphone, ou collez le lien dans l’application (**J’ai une invitation ou un code**). Valable 10 minutes, une seule fois.
- **Une personne** : **Réglages → Inviter une personne** → envoyez le lien (valable 7 jours, pour une personne). Elle obtient son propre espace, privé, sur votre serveur, le retrouve sur tous ses appareils, et vous pouvez vous partager des pages. Elle n’a accès ni à votre maison, ni à vos caméras, ni à votre homelab. **Retirer** (même rubrique) supprime son espace du serveur.

Le partage passe par un serveur Ostal joignable par les autres : le vôtre (**[INSTALLATION.md](../INSTALLATION.md)**), ou celui de la personne qui vous invite. Ostal utilisé seul sur un appareil (application Windows ou Android, sans serveur) garde tout sur cet appareil ; **Réglages → Rejoindre un serveur** le relie plus tard.

## Accueil et widgets

L’accueil s’ouvre au démarrage. Un **accueil de départ** est proposé (horloge, météo, agenda, pages, note rapide, tâches, plus caméras, maison et homelab s’ils sont configurés) ; tout se change :

1. **Déplacer** (souris) : glissez un widget, depuis n’importe quel endroit qui n’est pas un bouton ou une zone de saisie (ou par la petite barre qui apparaît en haut au survol). Les autres widgets se poussent pour lui faire de la place.
2. **Redimensionner** (souris) : au survol, les quatre coins du widget s’allument ; tirez-en un. Tout est enregistré dès que vous relâchez.
3. **Sur téléphone ou tablette** : un appui long sur un widget (ou le bouton **Modifier**, en bas à droite) passe en mode modification ; déplacez le widget avec sa poignée ronde, agrandissez-le par le coin, puis **Terminé**.
4. **Ajouter un widget** : bouton rond **+** en bas à droite de l’accueil (sur téléphone : **Modifier**, puis **Ajouter un widget**). Il ouvre le catalogue. Les widgets qui ont besoin d’un réglage (ville de la météo, page, image, site…) ouvrent aussitôt leurs réglages. *Revenir à l’accueil de départ* (en bas du catalogue) remet l’accueil d’origine.
5. **⚙** sur un widget (au survol, ou en mode modification sur téléphone) : réglages propres au widget, titre, barre de titre affichée ou non, **sans fond** (posé directement sur le fond d’écran). **✕** le retire.
6. **À l’intérieur d’un widget** (appareils de la Maison, caméras, modules du homelab, raccourcis, tâches) : glissez un élément pour changer sa place (sur téléphone : appui long, puis glisser). Le widget, lui, se déplace par sa barre de titre ou un espace vide.

Chaque taille d’écran a sa disposition : la première fois, celle de l’ordinateur est adaptée (un widget par ligne sur téléphone), puis vos changements sur ce type d’écran sont gardés. L’accueil est le même sur tous vos appareils, et le contenu des widgets (note rapide, tâches) est synchronisé en direct.

Widgets : **Horloge** (numérique ou à aiguilles, autre fuseau horaire), **Météo** (Open-Meteo, gratuit et sans compte : l’appareil interroge directement open-meteo.com), **Agenda** (prochains événements ou mois), **Tâches**, **Recherche** (Google, DuckDuckGo, Qwant, Bing, Ecosia, Wikipédia, YouTube ou vos notes), **Note rapide** (couleur de post-it), **Page de notes** (une page modifiable sur l’accueil), **Pages** (récentes ou principales), **Caméras**, **Maison**, **Homelab**, **Allumer un PC** (voir [Allumer un ordinateur](#allumer-un-ordinateur)), **Raccourcis** (sites et pages de notes), **Image** (recadrée au format du widget), **Site web** (les tableaux de bord de votre réseau s’affichent en général, et un lien de vidéo YouTube ou Vimeo devient un lecteur ; les sites qui refusent de s’afficher dans une autre application, comme Google, sont proposés en **Ouvrir le site**. L’application pour Windows affiche tous les sites, y compris en http).

## Personnaliser

Bouton **Personnaliser** (en bas de la barre des sections, ou **Plus** sur téléphone) : un panneau s’ouvre à côté de l’application, chaque réglage s’applique aussitôt et vaut pour tous les appareils reliés. Pour qu’un appareil garde sa propre apparence (un thème clair sur le téléphone, un fond d’écran sur l’ordinateur…), décochez **Appliquer à tous vos appareils** en haut du panneau, sur cet appareil : ses changements ne touchent plus les autres, et les leurs ne le touchent plus. Recochez la case pour reprendre l’apparence commune.

- **Thème** (sombre, noir, bleu nuit, forêt, clair, crème, lavande) et **couleur d’accent** (boutons, liens, élément actif ; « + » pour une couleur libre).
- **Fond d’écran** : dégradé, couleur ou image (envoyée depuis l’appareil ou par son adresse ; une image envoyée se recadre au format de l’écran, et **Recadrer** y revient plus tard), avec **flou** et **voile** pour garder le texte lisible ; « Dans toute l’application » l’affiche aussi derrière les autres sections.
- **Widgets** : opacité du fond, flou derrière, arrondi des coins, espacement.
- **Texte** : taille de l’interface et de l’éditeur (80 à 140 %).
- **Sections** : ordre (flèches, à l’intérieur de chaque groupe) et sections masquées (œil). L’accueil reste toujours affiché ; une section masquée reste accessible par son adresse.
- **Apparence de départ** revient au thème sombre d’origine.

## Notes

- **Éditeur par blocs** (BlockNote) : titres, listes, cases à cocher, citations, code, tableaux, séparateurs, couleurs, emojis… Tapez `/` pour ouvrir le menu de commandes, glissez les blocs avec la poignée `⠿`.
- **Pages dans des pages** (section « Notes ») : bouton `+` en haut de la liste des pages, bouton « Nouvelle sous-page » en bas de chaque page, ou commande `/Sous-page` pour insérer un lien de page dans le contenu. Arborescence réorganisable par glisser‑déposer, fil d’Ariane, recherche (`Ctrl+K`), corbeille avec restauration.
- **Colonnes** : placez des blocs côte à côte (un texte à côté d’une image, une vidéo à côté d’un module homelab…). Glissez un bloc par sa poignée `⠿` contre le bord droit ou gauche d’un autre bloc (une barre verticale apparaît ; à côté d’un module rétréci — agenda, caméras, homelab… — déposez-le dans l’espace libre à sa droite), ou tapez `/2 colonnes` ou `/3 colonnes` ; jusqu’à 4 colonnes par rangée. Largeur des colonnes : tirez la séparation entre deux colonnes, ou menu `⠿` d’un bloc > *Largeur de la colonne* (un quart à trois quarts, parts égales). Sortez le dernier bloc d’une colonne et elle disparaît. Sur téléphone, les colonnes s’affichent l’une sous l’autre.
- **Médias** : images et GIF (`/Image`, glisser‑déposer ou coller), vidéos (`/Vidéo`), audio, fichiers, **PDF avec aperçu intégré** (`/PDF`), **intégrations** YouTube, Vimeo, Dailymotion, Google Drive/Docs, Google Agenda (iframe), Loom, Spotify, Figma… (`/YouTube`).
- **Modules dans une page** : `/tableau` (feuille de calcul façon Excel, voir [Tableur](#tableur)), `/Agenda` (voir [Agenda](#agenda)), `/Maison`, `/Caméra`, `/Homelab`.
- **Collaboration en direct** : chaque page est un document partagé (Yjs). Partagez une page en « modification » ou en « lecture seule » ; les invités voient les curseurs et les prénoms des autres participants.
- **Pleine largeur** : les pages occupent toute la largeur de l’écran ; menu `⋯` d’une page > *Pleine largeur* pour revenir à une colonne centrée (réglage propre à chaque page, également appliqué aux invités d’un lien de partage).
- **Bannières et logos** : bannière en haut de chaque page (bouton *Ajouter une bannière* au survol du titre) avec votre propre image (importée, glissée ou collée, puis recadrée au format de la bannière ; bouton *Recadrer* au survol de la bannière pour y revenir, à partir de l’image d’origine) ou un dégradé, repositionnable en faisant glisser l’image, hauteur réglable avec la poignée sous la bannière (double-clic : hauteur automatique) ; logo de page avec votre image (icône de la page → onglet *Image*), recadré à votre goût avant utilisation (glisser l’image, zoom au curseur, à la molette ou à deux doigts, aperçu en direct ; bouton *Recadrer* pour y revenir plus tard, à partir de l’image d’origine), taille de l’icône réglable (curseur *Taille*, de 32 à 200 px), aussi pour les applications du homelab (logo importé recadré en carré). Les images sont réduites automatiquement avant l’envoi.
- **Recadrer une image de la page** : cliquez sur l’image, puis sur le bouton de recadrage de la barre d’outils ; choisissez le format (d’origine, carré, 4:3, 3:2, 16:9, portrait) et la partie à garder. L’image recadrée remplace l’originale ; Ctrl+Z revient en arrière.
- **Redimensionnement** : taille du texte des paragraphes, titres et listes (menu ⠿ du bloc > *Taille du texte*, ou liste *Normal* de la barre de mise en forme sur une sélection) ; largeur des images et vidéos (poignées latérales, menu ⠿ > *Largeur*, ou liste de la barre d’outils : 25 à 100 %) ; largeur (au pourcent près) et hauteur des blocs PDF, vidéo intégrée, agenda et homelab (poignées à droite et en bas) ; modules du homelab en taille libre (bouton *Disposition*, puis tirer le bord droit, le bord inférieur ou le coin d’un module ; flèches du clavier sur le coin ; double-clic sur le coin pour revenir à la taille automatique). Les modules s’emboîtent sans laisser de trou, un module agrandi affiche plus de statistiques et, sur téléphone, les modules s’empilent.

## Tableur

Dans une page, tapez `/tableau` (ou `/tableur`, `/excel`) : une feuille de calcul façon Excel s’insère, avec ses colonnes A, B, C… et ses lignes 1, 2, 3… Elle s’ouvre aussi dans Excel, LibreOffice ou Google Sheets (export `.xlsx`), et l’inverse.

- **Saisir** : cliquez sur une cellule et tapez. **Entrée** valide et descend, **Tab** passe à droite (après une suite de Tab, Entrée revient à la première colonne de la ligne suivante, comme dans Excel), **Échap** annule, **F2** ou un double-clic modifie le contenu existant, **Alt+Entrée** va à la ligne dans la cellule. Sur téléphone : touchez une cellule pour la choisir, touchez-la une deuxième fois pour écrire. Les nombres (`2,5`), pourcentages (`15 %`), montants (`12,50 €`), dates (`12/03/2025`) et heures (`8:30`) sont reconnus et mis en forme.
- **Formules** : commencez par `=`, avec les noms de fonctions d’Excel dans la langue de l’interface : `=SOMME(B2:B5)`, `=SI(A1>10;"cher";"ok")`, `=RECHERCHEV(…)` en français, `=SUM(B2:B5)` en anglais (le fichier exporté s’ouvre dans un Excel de n’importe quelle langue). Pendant la frappe, une liste propose les fonctions (Tab ou un clic pour choisir). Cliquez ou glissez sur des cellules pendant la saisie pour insérer leur référence (`A1`, `B2:B5`) ; cliquez sur l’onglet d’une autre feuille pour y désigner des cellules. Plus de 100 fonctions : sommes, moyennes et comptages (avec conditions : `SOMME.SI`, `NB.SI.ENS`…), recherches (`RECHERCHEV`, `RECHERCHEX`, `INDEX` et `EQUIV`), texte, dates, logique, arrondis, finances (`VPM`)… Une erreur (`#DIV/0!`, `#NOM?`…) est expliquée dans la barre en bas du tableur quand on choisit la cellule. **Σ** propose la somme des nombres au-dessus (ou à gauche).
- **Sélectionner et se déplacer** : glissez à la souris, Maj+clic ou Maj+flèches pour agrandir la sélection, clic sur une lettre de colonne ou un numéro de ligne pour la prendre entière, Ctrl+flèches pour aller au bout des données, Ctrl+A pour tout sélectionner. La zone d’adresse, à gauche de la barre de formule, montre la sélection et accepte une adresse (`C10`, `A1:D20`). La barre du bas donne la somme, la moyenne et le nombre de cellules sélectionnées.
- **Copier, couper, coller** : Ctrl+C, Ctrl+X, Ctrl+V (ou clic droit, appui long sur téléphone), entre les tableurs d’Ostal (formules et mise en forme gardées) et avec Excel, LibreOffice ou Google Sheets dans les deux sens. Couper-coller déplace les cellules, et les formules qui les citent suivent. Un bloc collé sur une sélection plus grande s’y répète.
- **Poignée de recopie** (petit carré en bas à droite de la sélection) : glissez-la pour prolonger une suite (1, 2, 3… ; dates ; lundi, mardi… ; janvier, février… ; « Semaine 1 », « Semaine 2 »…) ou recopier des formules, vers le bas, le haut, la droite ou la gauche. **Ctrl+D** et **Ctrl+R** recopient vers le bas et vers la droite.
- **Mise en forme** (barre d’outils) : gras, italique, souligné, barré, couleur du texte et du fond, alignement, retour à la ligne automatique, format des nombres (nombre, monnaie, pourcentage, date, heure, texte) et nombre de décimales.
- **Lignes et colonnes** (clic droit sur les cellules ou les en-têtes) : insérer, supprimer, trier de A à Z ou de Z à A (la ligne d’en-tête reste en haut), recopier, effacer le contenu ou la mise en forme. Largeur des colonnes et hauteur des lignes : tirez la bordure de l’en-tête ; double-clic sur la bordure pour l’ajuster au contenu.
- **Feuilles** (onglets en bas) : `+` en ajoute une, double-clic pour la renommer (les formules qui la citent suivent), clic droit pour la dupliquer ou la supprimer.
- **Fichiers** : bouton d’import (flèche vers le haut) pour ouvrir un fichier Excel `.xlsx` ou un `.csv` (un tableur vide prend son contenu ; sinon ses feuilles s’ajoutent aux autres) ; bouton d’export (flèche vers le bas) pour enregistrer le classeur au format Excel `.xlsx` (valeurs, formules, mise en forme, largeurs des colonnes) ou la feuille affichée en `.csv`. L’ancien format `.xls` n’est pas lu : enregistrez d’abord le fichier en `.xlsx` dans Excel.
- **Plein écran** (bouton en haut à droite) : le tableur occupe tout l’écran, pratique sur téléphone ; Échap pour revenir. La hauteur du tableur dans la page se règle avec la poignée sous le bloc, sa largeur avec celle de droite.
- **Annuler** : Ctrl+Z (ou la flèche de la barre d’outils) annule la dernière modification, Ctrl+Y la rétablit.
- **À plusieurs** : comme le reste de la page, le tableur se met à jour en direct chez tout le monde ; les invités d’un lien « lecture seule » peuvent le consulter et copier ses cellules.
- **Limites** : 50 000 cellules remplies par tableur. Pas de graphiques, de cellules fusionnées, de bordures ni de mise en forme conditionnelle : à l’import d’un fichier Excel, elles sont ignorées, mais les valeurs, formules, couleurs et formats sont gardés.

## Agenda

Section **Agenda** : vos agendas Google et adresses iCal (Outlook, Apple, école, travail…) réunis, en vue du mois ou en liste, chacun avec sa couleur, masquable et actualisable ; widget sur l’accueil.

**Ajouter un agenda** (section Agenda), ou dans une page, tapez `/Agenda` (bloc de la page ; **Ajouter à l’Agenda** le reprend ensuite dans la section Agenda), puis :

- **Fichier .ics** : Google Agenda (web) → *Paramètres* → *Importer et exporter* → *Exporter* → décompressez et choisissez l’agenda.
- **Lien iCal** : *Paramètres* → votre agenda → *Intégrer l’agenda* → « Adresse secrète au format iCal ». Le bloc et la section Agenda disposent alors d’un bouton **Actualiser** (nécessite un serveur configuré, qui récupère le flux pour vous) ; la section Agenda relit aussi ces adresses d’elle-même toutes les heures.
- **Compte Google** : renseignez un ID client OAuth dans *Réglages* (console.cloud.google.com → API Google Calendar activée → identifiant OAuth « Application Web » avec l’adresse de l’application comme origine JavaScript autorisée, et votre adresse Gmail dans *Audience → Utilisateurs test*). Cochez ensuite les agendas voulus (ou « Tout sélectionner ») : les événements sont fusionnés, les doublons retirés, et **Actualiser** relit tous les agendas du bloc. La connexion Google n’est pas disponible dans l’application Android (Google bloque sa page de connexion dans les applications) : importez depuis un navigateur, le bloc s’affiche ensuite partout.
- Pour afficher l’agenda Google interactif dans la page, utilisez `/YouTube` (bloc intégration) avec le lien d’intégration fourni par Google Agenda.

Dans une page, les événements s’affichent par jour, avec la mise en avant du jour courant.

## Maison connectée

Lumières (marche/arrêt, luminosité, couleur, température de blanc), prises et interrupteurs, volets, thermostats, serrures, enceintes, aspirateurs, scènes, capteurs (température, humidité, portes, mouvement…) et caméras (image et vidéo en direct), regroupés par pièce, avec favoris et recherche : section **Objets connectés** (groupe Maison), widget **Maison** de l’accueil, ou bloc `/Maison` dans une page. Fonctionne avec Home Assistant, qui prend en charge la plupart des marques (Philips Hue, IKEA, Tapo, Tuya/Smart Life, Shelly, Xiaomi, Netatmo, caméras ONVIF…).

Section **Objets connectés** → **Connecter Home Assistant** :

1. Installez Home Assistant (par exemple l’application « Home Assistant » de la boutique CasaOS) et ajoutez‑y vos appareils : il découvre automatiquement la plupart d’entre eux. Rangez‑les par pièce, Ostal reprend ce classement.
2. Dans Home Assistant : votre nom (en bas à gauche) → onglet **Sécurité** → **Jetons d’accès longue durée** → **Créer un jeton**.
3. Dans Ostal : adresse de Home Assistant vue depuis le serveur Ostal (par ex. `http://192.168.1.10:8123`, jamais `localhost` si les deux tournent en Docker sur la même machine) et jeton → **Tester la connexion** → **Enregistrer**.

Touchez l’icône d’un appareil pour l’allumer ou l’éteindre, son nom pour ouvrir sa fiche (luminosité, couleur, consigne, position, volume, favoris, masquer). Les caméras s’ouvrent en direct. Les états se mettent à jour toutes les quatre secondes.

**Groupes** : **Nouveau groupe** (en haut de la section Objets connectés) → cochez les appareils (lumières, prises, ventilateurs, chauffage, volets ; « Tout cocher » pour toute une pièce), choisissez un nom (proposé d’après les appareils) et une icône. Le groupe apparaît en tête de la section : son interrupteur allume tout, ou éteint tout dès qu’un appareil est allumé ; sa fiche règle la luminosité et la couleur de toutes les lampes, ouvre ou ferme tous les volets, montre chaque appareil, et permet de le modifier, de le supprimer ou de l’ajouter aux favoris (il s’affiche alors aussi dans le widget Maison de l’accueil). Vous pouvez masquer les lampes une à une et ne garder que leur groupe. Les commandes partent en une fois par type d’appareil : les lampes s’allument ensemble.

**Ordre** : glissez un appareil pour changer sa place dans sa pièce, un groupe parmi les groupes, un favori parmi les favoris (sur téléphone : appui long, puis glisser). L’ordre est le même sur tous vos appareils.

Sécurité : l’adresse et le jeton restent sur le serveur Ostal ; seules les commandes courantes sont autorisées (pas de redémarrage de Home Assistant, pas d’automatisations) ; les images des caméras passent par des adresses signées qui expirent ; les invités d’une page partagée n’ont pas accès à la maison.

## Caméras de surveillance

Direct de vos caméras IP et enregistreurs reliés directement au serveur Ostal, sans Home Assistant (Hikvision, Dahua, Reolink, Tapo, Ezviz, Foscam, Uniview, Axis, ou toute caméra avec un flux RTSP ou MJPEG), en grille ou en grand : section **Caméras**, widget de l’accueil, ou bloc `/Caméra` dans une page.

Section **Caméras** → **Ajouter une caméra** :

1. Choisissez la **marque** et indiquez l’**adresse IP** de la caméra (ou celle de l’enregistreur et le numéro de la caméra), son **identifiant** et son **mot de passe**. Autre marque : « Autre caméra ou enregistreur », puis l’adresse du flux RTSP donnée par la notice de la caméra. « Image ou flux MJPEG » accepte une adresse http (MotionEye, ESP32-CAM, anciennes caméras).
2. **Tester** montre une image de la caméra et la définition de ses flux, ou explique le problème : mot de passe refusé, caméra injoignable, flux introuvable…
3. **Enregistrer** : la caméra s’affiche en direct. Touchez-la pour l’agrandir (image la plus nette, bouton *Plein écran*).

Tapez `/Caméra` dans une page pour y placer le direct d’une caméra (ou de toutes), par exemple dans une colonne à côté de vos notes, ou ajoutez le widget **Caméras** sur l’accueil.

- Tapo : créez d’abord un « compte de la caméra » dans l’application Tapo. Ezviz : identifiant « admin », mot de passe = code de vérification inscrit sous la caméra.
- Les miniatures utilisent le flux secondaire de la caméra (plus léger), la vue agrandie le flux principal. La vidéo arrive avec une à deux secondes de décalage, sans le son. Quand Ostal passe derrière une autre fenêtre ou est réduit, le direct continue 30 minutes (1 minute sur téléphone) : au retour, l’image est là tout de suite. Au-delà, ou quand la caméra n’est plus à l’écran depuis 30 secondes, il s’arrête pour ménager le réseau ; pendant la reprise, la dernière image reste affichée.
- Glissez une caméra pour changer sa place (l’ordre est le même dans la section, le widget et les pages).
- Une caméra réglée en H.265 est lue telle quelle par la plupart des téléphones ; pour les autres appareils, le serveur convertit la vidéo, ce qui sollicite son processeur : réglez la caméra en H.264 si possible.
- Sécurité : adresses et mots de passe des caméras restent dans votre espace et sur le serveur ; les navigateurs ne reçoivent que la vidéo, par des adresses signées qui expirent. Les invités d’une page partagée ne voient pas les caméras.

## Homelab

État et statistiques de vos applications (Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, Jellyfin, Emby, Plex, Jellyseerr, Overseerr, qBittorrent, Transmission, Pi-hole, AdGuard Home, Portainer, Home Assistant, Uptime Kuma, Nextcloud, Immich, ou n’importe quelle URL) et de vos appareils (CPU, mémoire, disques, températures, uptime) via Glances, Proxmox VE, Synology DSM, TrueNAS ou l’hôte du serveur Ostal lui-même : section **Homelab**, widget de l’accueil, ou bloc `/Homelab` dans une page. Glissez un module pour changer sa place. Bouton **Disposition** : tirez le bord d’un module pour l’agrandir, et décochez **Ranger par catégorie** pour placer applications et appareils librement, côte à côte (Jellyfin ou qBittorrent à côté du NAS, par exemple) ; cochée, chaque catégorie (Appareils, Médias, Téléchargements…) a sa rubrique.

Pour commencer, trois façons (dans la section vide, ou dans **Configurer**) :

- **Rechercher mes applications** : le serveur Ostal interroge sa machine et les appareils allumés du réseau (une dizaine de secondes), reconnaît les applications ci-dessus à leur page d’accueil et propose aussi les autres sous leur nom (Homepage, Vaultwarden, Paperless…, vérifiées en ligne / hors ligne). Cochez ce que vous voulez suivre, puis **Ajouter**.
- **Importer depuis Homepage** : collez le contenu du fichier `services.yaml` de Homepage (ou choisissez le fichier). Applications, adresses, clés API et identifiants sont repris ; une clé laissée en variable de Homepage (`{{HOMEPAGE_VAR_…}}`) est signalée « Clé à saisir ».
- **Ajouter à la main**, une application ou un appareil à la fois.

Vous avez déjà un tableau de bord (Homepage, Homarr, Dashy…) ? Affichez-le aussi sur l’accueil avec le widget **Site web**.

Section **Homelab** → **Configurer** :

- **Applications** : renseignez la clé API (ou les identifiants) de chacune pour obtenir les statistiques (file d’attente, éléments manquants, lectures en cours, demandes en attente, vitesses de téléchargement, requêtes bloquées, conteneurs actifs…). Sans clé, seule la disponibilité (en ligne / hors ligne, latence) est vérifiée. L’« URL interne » permet d’indiquer une adresse Docker (ex. `http://sonarr:8989`) différente de l’URL ouverte au clic.
- **Appareils** : *Hôte de ce serveur Ostal* (aucune configuration ; en Docker, montez les volumes à surveiller et listez leurs points de montage), *Glances* (`glances -w` ou l’image Docker `nicolargo/glances`, port 61208 : le plus simple pour un NAS ou un serveur Linux), *Proxmox VE* (jeton API), *Synology DSM* (compte sans 2FA), *TrueNAS* (clé API).
- Le bouton **Tester** de chaque formulaire valide la connexion depuis le serveur. Toutes les requêtes sont faites par le serveur Ostal (accès au réseau local sans CORS) ; les secrets ne sont jamais renvoyés au navigateur. L’actualisation est automatique (30 s par défaut).

## Allumer un ordinateur

Le widget **Allumer un PC** (catalogue de l’accueil, groupe Maison) allume à distance un ordinateur de la maison, depuis le téléphone ou de n’importe où : le serveur Ostal envoie sur son réseau le signal de réveil (Wake-on-LAN) que la carte réseau de l’ordinateur guette, même éteint. Le widget montre aussi si l’ordinateur est allumé : après un appui sur le bouton, il suit le démarrage (« Démarrage… 0:42 ») jusqu’à **Allumé**.

**Choisir l’ordinateur** :

1. Allumez l’ordinateur, branché à la même box que le serveur Ostal.
2. Ajoutez le widget (bouton **+** en bas à droite de l’accueil → **Allumer un PC**), puis **Chercher sur le réseau** : les appareils allumés s’affichent, avec leur nom quand il est connu. *Cet appareil* désigne celui sur lequel vous faites la recherche ; la box est à la fin. Choisissez l’ordinateur : son adresse MAC (celle de sa carte réseau) et son adresse IP se remplissent.
3. Absent de la liste ? Saisissez son adresse MAC : sous Windows, **Paramètres → Réseau et Internet → Ethernet** → *Adresse physique (MAC)*, ou `ipconfig /all` dans l’invite de commandes. L’adresse IP (facultative) sert à savoir s’il est allumé.
4. **Titre** (en bas des réglages) : le nom affiché dans le widget, par exemple « PC du bureau ».

**Préparer l’ordinateur** (une seule fois ; rappelé dans les réglages du widget) :

1. Branchez-le par un câble réseau : le réveil par Wi-Fi ne marche presque jamais.
2. Dans le BIOS (touche Suppr ou F2 au démarrage), activez *Wake on LAN* (parfois *Power On by PCI-E*, *Resume by LAN* ou *Remote Wake Up*) et désactivez *ErP* (ou *Deep Sleep*) s’il existe : il coupe la carte réseau quand l’ordinateur est éteint.
3. Sous Windows, **Gestionnaire de périphériques → Cartes réseau →** votre carte Ethernet **→ Propriétés** : onglet *Gestion de l’alimentation*, cochez *Autoriser ce périphérique à sortir l’ordinateur du mode veille* ; onglet *Avancé*, mettez *Wake on Magic Packet* sur *Activé*.
4. Désactivez le démarrage rapide de Windows : **Panneau de configuration → Options d’alimentation → Choisir l’action des boutons d’alimentation → Modifier des paramètres actuellement non disponibles**, puis décochez *Activer le démarrage rapide*. Avec lui, l’ordinateur ne s’éteint pas tout à fait et ne se réveille souvent pas.
5. Éteignez-le normalement (**Démarrer → Arrêter**) et essayez le bouton du widget. Le réveil marche aussi depuis la mise en veille.

**Bon à savoir** :

- Le serveur Ostal, qui envoie le signal, doit rester allumé sur le même réseau que l’ordinateur. Avec l’application Windows (serveur intégré), c’est l’ordinateur où elle tourne qui envoie le signal : il ne peut pas se réveiller lui-même.
- L’état vient de la carte réseau de l’ordinateur, qui répond même pare-feu fermé. Si la box donne son adresse IP à un autre appareil, le widget l’indique : choisissez de nouveau l’ordinateur dans les réglages, ou réservez-lui son adresse dans la box (bail DHCP fixe).
- Serveur installé avec Docker : le signal part d’un petit relais réseau installé avec Ostal (voir [INSTALLATION.md](../INSTALLATION.md#allumer-un-ordinateur-wake-on-lan)). Le widget prévient s’il ne répond pas.
- Les personnes invitées sur votre serveur n’ont pas ce widget : il se sert de votre réseau.

## Atelier PDF

Section **Atelier PDF** (groupe Outils). L’original n’est jamais modifié et vos modifications restent modifiables.

1. **Importer des PDF** (un document par fichier), **Photos → PDF** (une page par photo, dans l’ordre choisi) ou, sur téléphone, **Scanner un document** (appareil photo). Les fichiers peuvent aussi être déposés sur la page. Un PDF protégé par un mot de passe le demande une fois ; il est ensuite gardé sans protection dans votre bibliothèque, sur votre serveur.
2. Vue **Pages** : touchez des pages pour les choisir, puis **Gauche** / **Droite** (rotation), **Déplacer** (touchez ensuite *Avant* ou *Après* une autre page ; à la souris, glissez-déposez), **Extraire** (nouveau PDF avec ces pages), **Supprimer**. **Ajouter PDF ou photos** et **Page blanche** insèrent après la sélection. Dans la bibliothèque, **Assembler des PDF** réunit plusieurs documents dans l’ordre où vous les touchez.
3. Vue **Annoter** : **Texte** (touchez la page puis écrivez), **Surligneur**, **Stylo**, **Masquer** (rectangle blanc, noir ou crème), **Coche** (✓, ✗ ou point), **Signature** (dessinée une fois, gardée pour les fois suivantes), **Image** (tampon, logo), **Gomme**. Outil **Sélection** : déplacez une annotation, agrandissez-la avec sa poignée, changez sa couleur ou sa taille, dupliquez-la, supprimez-la (touche Suppr). Les champs des formulaires (cases à remplir, à cocher, listes) se remplissent directement sur la page. Zoom : boutons, Ctrl + molette, ou deux doigts sur téléphone (le stylo dessine avec un doigt, deux doigts font défiler). **Annuler / Rétablir** (Ctrl+Z / Ctrl+Y) en haut à droite.
4. **Exporter** : nom du fichier, toutes les pages ou seulement la sélection, puis **Enregistrer…** (ordinateur : fenêtre « Enregistrer sous » ; application Android : dossier de votre choix) ou **Partager…** (application Android : WhatsApp, e-mail, Drive…). Les formulaires remplis sont figés dans le PDF exporté ; un formulaire laissé vide reste modifiable.

Sur Android, **Ouvrir avec Ostal** (depuis Gmail, WhatsApp, Fichiers…) et **Partager → Ostal** (PDF ou photos) importent directement dans l’atelier. Sur ordinateur, l’application installée apparaît dans **Ouvrir avec** pour les fichiers PDF.

Bon à savoir : le texte déjà écrit dans un PDF ne se modifie pas (un PDF n’est pas un document Word) ; cachez-le avec **Masquer** et écrivez par-dessus avec **Texte**. Un masque cache à l’affichage et à l’impression, mais le texte couvert reste présent dans le fichier : ne l’utilisez pas pour une information confidentielle. Les signatures dessinées sont gardées dans votre espace (synchronisées sur vos appareils) ; supprimez-les depuis la fenêtre **Signature**.
