#!/usr/bin/env bash
# Copie les sources testées depuis le module (vérité unique) vers le paquet de
# test. Utilisé par la CI et en local avant `swift test`.
set -euo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$racine/modules/persei-camera/ios"
cible="$racine/native-tests/Sources"

mkdir -p "$cible"
for fichier in FrameStacker.swift CameraMath.swift; do
  cp "$source_dir/$fichier" "$cible/$fichier"
  echo "copié : $fichier"
done
