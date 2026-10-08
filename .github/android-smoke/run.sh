#!/usr/bin/env bash
# Test de l'APK sur un émulateur Android (lancé par .github/workflows/apps.yml) :
# installation, liaison à un serveur Ostal, vérification des mises à jour en arrière-plan,
# notification et mise à jour sans réinstaller, fichiers de l'atelier PDF, rappels, widgets de l'écran d'accueil.
# Échoue si l'application se ferme.
# Usage : run.sh <apk> <dossier du client « nouvelle version »>
set -uo pipefail

APK="$1"
export DIST_V2="$2"
export SMOKE_OUT="${SMOKE_OUT:-smoke-out}"
mkdir -p "$SMOKE_OUT"

# Serveur Ostal du runner, joignable depuis l'émulateur à l'adresse 10.0.2.2
DATA="$(mktemp -d)"
PORT=3000 HOST=0.0.0.0 DATA_DIR="$DATA" node server/src/index.js >"$SMOKE_OUT/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:3000/api/health >/dev/null && break
  sleep 1
done

adb logcat -c || true
adb install -r "$APK" || exit 1
# Autorisation de notification accordée d'avance (Android 13+) : pas de fenêtre système pendant le test.
adb shell pm grant com.shinezeo.notes android.permission.POST_NOTIFICATIONS || true

node .github/android-smoke/check.mjs
STATUS=$?

adb logcat -d >"$SMOKE_OUT/logcat.txt" 2>&1 || true
adb logcat -d -b crash >"$SMOKE_OUT/crash.txt" 2>&1 || true
adb exec-out screencap -p >"$SMOKE_OUT/ecran.png" 2>/dev/null || true
exit $STATUS
