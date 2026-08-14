#!/usr/bin/env bash
# Installe l'app compilée dans un simulateur et vérifie qu'elle survit à son
# lancement. C'est le seul moyen d'attraper une app qui se lie correctement
# mais que le système tue au démarrage, typiquement une bibliothèque non
# embarquée après l'ajout d'une extension.
set -euo pipefail

bundle="${1:-com.mateobaril.persei}"
produits="ios/build/Build/Products/Release-iphonesimulator"

app=$(find "$produits" -maxdepth 1 -name '*.app' | head -1)
if [ -z "$app" ]; then
  echo "::error::aucune app compilée dans $produits"
  exit 1
fi
echo "Application : $app"

# Simulateur : le plus récent déjà installé sur la machine (voir le script
# Python, qui explique pourquoi on ne crée pas de paire au hasard).
liste=$(mktemp)
xcrun simctl list devices available -j > "$liste"
udid=$(python3 .github/scripts/pick-simulator.py "$liste")

echo "Identifiant du simulateur : $udid"
nettoyer() {
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
}
trap nettoyer EXIT

xcrun simctl boot "$udid" || true
xcrun simctl install "$udid" "$app"

# `launch` rend le pid du processus hôte : disparu vingt secondes plus tard,
# l'app est morte au démarrage.
sortie=$(xcrun simctl launch "$udid" "$bundle")
echo "$sortie"
pid=$(echo "$sortie" | awk -F': ' '{print $2}' | tr -d ' ')
sleep 20

if ! ps -p "$pid" >/dev/null 2>&1; then
  echo "::error::l'app ne survit pas à son lancement (processus $pid disparu)"
  for fichier in $(ls -t "$HOME"/Library/Logs/DiagnosticReports/* 2>/dev/null | head -3); do
    echo "--- $fichier"
    head -60 "$fichier"
  done
  exit 1
fi

echo "L'app tourne toujours après vingt secondes."
