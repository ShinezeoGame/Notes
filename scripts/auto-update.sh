#!/bin/sh
# Mise à jour automatique du serveur Melo, lancée régulièrement par cron (voir scripts/install-auto-update.sh) :
# récupère les nouveautés du dépôt Git et reconstruit le conteneur seulement s'il y en a. Si la construction
# échoue, l'ancienne version continue de tourner et la même version n'est pas retentée.
#
# Lancement manuel : sh scripts/auto-update.sh          (--force : reconstruire même sans nouveauté)
# Journal :          auto-update.log, dans le dossier du dépôt
set -u
PATH="$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
REPO=$(cd "$(dirname "$0")/.." && pwd)
LOG="$REPO/auto-update.log"
STATE="$REPO/.auto-update"
BUILD_OUT="$REPO/.auto-update.build"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

OWNER=$(stat -c %U "$REPO")
IS_ROOT=0
[ "$(id -u)" -eq 0 ] && [ "$OWNER" != root ] && IS_ROOT=1

# Sous cron, tout va dans le journal (limité en taille) ; en lancement manuel, dans le terminal.
INTERACTIVE=0
[ -t 1 ] && INTERACTIVE=1
if [ "$INTERACTIVE" -eq 0 ]; then
  if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 500000 ]; then
    tail -n 300 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
  exec >>"$LOG" 2>&1
fi
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

finish() {
  # Fichiers créés en root : rendus au propriétaire du dépôt.
  [ "$IS_ROOT" -eq 1 ] && chown "$OWNER" "$LOG" "$STATE" "$BUILD_OUT" "$REPO/.auto-update.lock" 2>/dev/null
  exit "$1"
}

# Une seule mise à jour à la fois (une construction peut durer plusieurs minutes).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$REPO/.auto-update.lock"
  flock -n 9 || exit 0
fi

# Git tourne sous le propriétaire du dépôt (sa clé SSH, ses fichiers), même quand le script est lancé en root.
git_() {
  if [ "$IS_ROOT" -eq 1 ]; then
    home=$(getent passwd "$OWNER" | cut -d: -f6)
    if command -v runuser >/dev/null 2>&1; then
      runuser -u "$OWNER" -- env HOME="$home" git -C "$REPO" "$@"
    else
      sudo -H -u "$OWNER" git -C "$REPO" "$@"
    fi
  else
    git -C "$REPO" "$@"
  fi
}

cd "$REPO" || finish 1

if ! out=$(git_ fetch --quiet 2>&1); then
  log "GitHub injoignable ou accès refusé (git fetch) : $out"
  finish 1
fi
if ! upstream=$(git_ rev-parse '@{u}' 2>/dev/null); then
  log "La branche actuelle ne suit aucune branche distante : mise à jour impossible."
  finish 1
fi

if [ "$(git_ rev-parse HEAD)" != "$upstream" ]; then
  if ! out=$(git_ pull --ff-only --quiet 2>&1); then
    log "Mise à jour bloquée (git pull) : $out"
    changed=$(git_ status --porcelain --untracked-files=no | cut -c4- | tr '\n' ' ')
    [ -n "$changed" ] && log "Fichiers modifiés sur le serveur : $changed— gardez vos réglages dans .env ou docker-compose.override.yml, puis annulez ces modifications (git checkout -- <fichier>)."
    finish 1
  fi
fi

head=$(git_ rev-parse HEAD)
short=$(git_ rev-parse --short HEAD)
installed=$(sed -n 's/^installed=//p' "$STATE" 2>/dev/null)
failed=$(sed -n 's/^failed=//p' "$STATE" 2>/dev/null)
if [ "$FORCE" -eq 0 ]; then
  if [ "$head" = "$installed" ]; then
    [ "$INTERACTIVE" -eq 1 ] && log "Déjà à jour (version $short)."
    finish 0
  fi
  # Construction déjà ratée pour cette version : on attend la suivante (ou --force).
  if [ "$head" = "$failed" ]; then
    [ "$INTERACTIVE" -eq 1 ] && log "La version $short n'a pas pu être construite : nouvel essai à la prochaine version (ou : sh scripts/auto-update.sh --force)."
    finish 0
  fi
fi

if ! docker info >/dev/null 2>&1; then
  log "Docker est inaccessible pour l'utilisateur $(id -un) : relancez avec sudo (sudo sh scripts/auto-update.sh)."
  finish 1
fi

log "Installation de la version $(git_ log -1 --format='%h « %s »')…"
if docker compose up -d --build >"$BUILD_OUT" 2>&1; then
  printf 'installed=%s\n' "$head" >"$STATE"
  docker image prune -f >/dev/null 2>&1
  docker builder prune -f --filter until=168h >/dev/null 2>&1
  log "Serveur à jour : les applications seront prévenues de la nouvelle version."
  finish 0
else
  tail -n 25 "$BUILD_OUT"
  printf 'installed=%s\nfailed=%s\n' "$installed" "$head" >"$STATE"
  log "Échec de la construction : l'ancienne version continue de fonctionner."
  finish 1
fi
