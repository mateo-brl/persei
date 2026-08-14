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

modele=$(xcrun simctl list devicetypes -j | python3 -c "import json,sys; t=[x['identifier'] for x in json.load(sys.stdin)['devicetypes'] if 'iPhone' in x['name']]; print(t[-1])")
systeme=$(xcrun simctl list runtimes -j | python3 -c "import json,sys; r=[x['identifier'] for x in json.load(sys.stdin)['runtimes'] if x['isAvailable'] and 'iOS' in x['name']]; print(r[-1])")
echo "Simulateur : $modele sur $systeme"

udid=$(xcrun simctl create persei-demarrage "$modele" "$systeme")
nettoyer() {
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid" >/dev/null 2>&1 || true
}
trap nettoyer EXIT

xcrun simctl boot "$udid"
xcrun simctl install "$udid" "$app"

# `launch` rend le pid du processus hôte : disparu vingt secondes plus tard,
# l'app est morte au démarrage.
sortie=$(xcrun simctl launch "$udid" "$bundle")
echo "$sortie"
pid=$(echo "$sortie" | awk -F': ' '{print $2}' | tr -d ' ')
sleep 20

if ! ps -p "$pid" >/dev/null 2>&1; then
  echo "::error::l'app ne survit pas à son lancement (processus $pid disparu)"
  rapport=$(ls -t "$HOME"/Library/Logs/DiagnosticReports/* 2>/dev/null | head -3 || true)
  for fichier in $rapport; do
    echo "--- $fichier"
    head -60 "$fichier"
  done
  exit 1
fi

echo "L'app tourne toujours après vingt secondes."
