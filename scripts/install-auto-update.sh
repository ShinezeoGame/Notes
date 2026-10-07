#!/bin/sh
# Programme la mise à jour automatique du serveur Ostal : toutes les 15 minutes, le serveur récupère les
# nouveautés du dépôt et se reconstruit s'il y en a (scripts/auto-update.sh).
#
#   sh scripts/install-auto-update.sh            installer (et vérifier une première fois)
#   sh scripts/install-auto-update.sh --remove   arrêter la mise à jour automatique
#
# Fréquence différente : NOTES_UPDATE_SCHEDULE='0 4 * * *' sh scripts/install-auto-update.sh (tous les jours à 4 h)
set -eu
REPO=$(cd "$(dirname "$0")/.." && pwd)
MARK='# notes-auto-update'
SCHEDULE=${NOTES_UPDATE_SCHEDULE:-'*/15 * * * *'}
LINE="$SCHEDULE /bin/sh \"$REPO/scripts/auto-update.sh\" $MARK"

if ! command -v crontab >/dev/null 2>&1; then
  echo "cron n'est pas installé sur ce serveur. Installez-le avec : sudo apt install cron"
  exit 1
fi

# Crontab de l'utilisateur s'il peut utiliser Docker, sinon celle de root.
if docker info >/dev/null 2>&1; then
  CRONTAB="crontab"
  RUN="sh"
  WHO=$(id -un)
else
  echo "Docker demande les droits administrateur : la tâche sera installée pour root (mot de passe demandé)."
  CRONTAB="sudo crontab -u root"
  RUN="sudo sh"
  WHO=root
fi

current=$($CRONTAB -l 2>/dev/null | grep -vF "$MARK" || true)

if [ "${1:-}" = "--remove" ]; then
  printf '%s\n' "$current" | $CRONTAB -
  echo "Mise à jour automatique arrêtée."
  exit 0
fi

{
  [ -n "$current" ] && printf '%s\n' "$current"
  printf '%s\n' "$LINE"
} | $CRONTAB -
echo "✓ Mise à jour automatique programmée ($SCHEDULE, utilisateur $WHO)."

changed=$(git -C "$REPO" status --porcelain --untracked-files=no | cut -c4- | tr '\n' ' ')
if [ -n "$changed" ]; then
  echo
  echo "⚠ Fichiers modifiés sur ce serveur : $changed"
  echo "  Ils peuvent bloquer les mises à jour. Gardez vos réglages dans .env ou docker-compose.override.yml,"
  echo "  puis annulez ces modifications avec : git checkout -- <fichier>"
fi

echo
echo "Première vérification (une construction peut prendre quelques minutes)…"
if $RUN "$REPO/scripts/auto-update.sh"; then
  echo "✓ Terminé. Le journal des mises à jour sera dans $REPO/auto-update.log"
else
  echo "✗ La vérification a échoué : voir les messages ci-dessus."
  exit 1
fi
