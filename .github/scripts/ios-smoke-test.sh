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

# On prend un simulateur déjà présent sur la machine : le plus récent iPhone
# sur le plus récent iOS. Créer un modèle au hasard donne des paires
# incompatibles (un iPhone 6s ne tourne pas sous iOS 26).
udid=$(xcrun simctl list devices available -j | python3 - <<'PYTHON'
import json
import re
import sys

appareils = json.load(sys.stdin)["devices"]
meilleur = None
cle_max = (-1, -1)

for systeme, liste in appareils.items():
    version = re.search(r"iOS-(\d+)-(\d+)", systeme)
    if not version:
        continue
    for appareil in liste:
        if not appareil.get("isAvailable"):
            continue
        modele = re.search(r"iPhone (\d+)", appareil["name"])
        if not modele:
            continue
        cle = (int(version.group(1)) * 100 + int(version.group(2)), int(modele.group(1)))
        if cle > cle_max:
            cle_max = cle
            meilleur = (appareil["udid"], appareil["name"], systeme)

if not meilleur:
    sys.exit("aucun simulateur iPhone disponible")
print(meilleur[0])
print(f"Simulateur : {meilleur[1]} sur {meilleur[2]}", file=sys.stderr)
PYTHON
)

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
