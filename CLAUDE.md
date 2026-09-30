# Notes : repères pour Claude Code

Application de notes façon Notion (web + Android) avec collaboration en direct. Code commenté en français ; textes
de l'interface et messages de commit en français. Architecture : section « Architecture » du README.

## Style des réponses (caveman)

Pour économiser des tokens, l'utilisateur a demandé le skill caveman (`.claude/skills/caveman/`, repris de
[JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman), licence MIT) : l'activer au niveau `lite` dès la
première réponse de chaque session, en français. L'utilisateur n'est pas développeur : les étapes qu'il doit suivre
restent complètes et claires. Il change de niveau avec `/caveman full` ou `/caveman ultra` et revient aux réponses
normales avec « stop caveman ».

## Carte du code (graphify)

[graphify](https://github.com/Graphify-Labs/graphify) dresse la carte du code (symboles, fichiers, lignes, qui appelle
quoi) par une analyse locale, sans IA, en quelques secondes. Elle sert à trouver où et comment une chose est faite
sans ouvrir beaucoup de fichiers. Dans une session, avant la première exploration du code :

1. si la commande `graphify` est absente : `uv tool install graphifyy==0.9.72` (à défaut :
   `pip install graphifyy==0.9.72`) ;
2. `graphify update . >/dev/null 2>&1` : construit ou met à jour la carte dans `graphify-out/` (non versionné).

Ensuite :

- `graphify explain "dropBeside"` : un symbole, son fichier, sa ligne et ce qui l'appelle ou qu'il appelle ;
- `graphify affected "columnWidth"` : ce qui dépend d'un symbole (avant de le modifier) ;
- `graphify query "pdf export" --budget 800` : les symboles liés à une question, avec fichiers et lignes ;
- `graphify path "Editor" "columnWidth" --undirected` : ce qui relie deux symboles ;
- `graphify-out/GRAPH_REPORT.md` : vue d'ensemble (points centraux, groupes de fichiers), pour les questions
  d'architecture seulement.

Les noms du code sont en anglais : chercher avec des mots anglais (column, drop, update…). Quand le fichier à ouvrir
est déjà connu, le lire directement. Après de grosses modifications du code, refaire l'étape 2. Si l'installation
échoue, travailler sans.

## À savoir

- Vérifier le client : `npm run build` (TypeScript puis construction). Le serveur (`server/`, JavaScript) n'a pas
  d'étape de construction.
- La branche `claude/notion-like-notes-app-yyrdi7` part en production : le serveur de l'utilisateur s'y met à jour
  tout seul (`scripts/auto-update.sh`) et chaque envoi reconstruit l'APK (`.github/workflows/android.yml` :
  construction, test sur émulateur Android 14, publication dans la release `latest`).
- La version de l'application est une empreinte des sources du client (`client/vite.config.ts`) : modifier le client
  propose une mise à jour aux utilisateurs ; modifier autre chose (serveur, documentation, CLAUDE.md) non.
- Nouveau type de bloc dans l'éditeur : augmenter `DOC_SCHEMA` (`client/src/lib/yjs.ts`) et `MIN_PAGE_SCHEMA`
  (`server/src/ws.js`), sinon une ancienne version de l'application effacerait ces blocs en synchronisant.
- Nouvelle fonction native Android utilisée par le client : augmenter `MIN_NATIVE_API` (`client/vite.config.ts`).
- Accueil : widgets déclarés dans `client/src/dashboard/registry.tsx` (un fichier par widget dans `widgets/`),
  disposition dans `dashboard/model.ts` ; thèmes, fond d'écran et sections dans `client/src/lib/appearance.ts`
  (couleurs en variables CSS : pas de couleur fixe dans `styles.css`).
