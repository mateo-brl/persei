"""Choisit le simulateur le plus récent parmi ceux installés.

Créer une paire au hasard donne des combinaisons refusées par simctl (un
iPhone 6s ne tourne pas sous iOS 26) : on ne prend donc que des appareils déjà
créés sur la machine, et parmi eux le plus récent des iPhone sur le plus
récent des iOS.

Usage : pick-simulator.py <fichier json de `simctl list devices available -j`>
"""

import json
import re
import sys


def choisir(donnees):
    meilleur = None
    cle_max = (-1, -1)
    for systeme, liste in donnees.get("devices", {}).items():
        version = re.search(r"iOS[-. ](\d+)[-.](\d+)", systeme)
        if not version:
            continue
        for appareil in liste:
            if appareil.get("isAvailable") is False:
                continue
            modele = re.search(r"iPhone (\d+)", appareil.get("name", ""))
            if not modele:
                continue
            cle = (int(version.group(1)) * 100 + int(version.group(2)), int(modele.group(1)))
            if cle > cle_max:
                cle_max = cle
                meilleur = (appareil["udid"], appareil["name"], systeme)
    return meilleur


def main():
    with open(sys.argv[1], encoding="utf-8") as fichier:
        donnees = json.load(fichier)
    meilleur = choisir(donnees)
    if not meilleur:
        sys.exit("aucun simulateur iPhone disponible")
    print(meilleur[0])
    print(f"Simulateur retenu : {meilleur[1]} sur {meilleur[2]}", file=sys.stderr)


if __name__ == "__main__":
    main()
