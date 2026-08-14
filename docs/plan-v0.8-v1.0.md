# Plan Persei v0.8 → v1.0 : passer devant l'app Camera d'Apple

État au 14 août 2026. Ce document est la feuille de route d'exécution, pas une
liste d'intentions : chaque phase se termine par des tests verts en CI et une
version installable.

## Où on en est

Déjà au-dessus d'Apple : contrôles manuels complets (ISO, vitesse, focus, balance
des blancs), pose longue sans plafond par empilement, stacking RAW linéaire de
nuit, filtre météores, alignement à main levée, aides de visée (peaking, zebras,
histogramme, loupe, niveau), presets de scène, mode nuit automatique réglable.

Au niveau d'Apple : Deep Fusion et Smart HDR sur les photos automatiques (c'est
le pipeline système, on l'obtient avec `photoQualityPrioritization = .quality`),
48 MP, Live Photos, macro, zooms optiques, ProRAW.

En dessous d'Apple, ou absent :

| Manque | Impact | Phase |
| --- | --- | --- |
| Aucune vidéo | Rédhibitoire, l'app ne remplace pas Camera | 2 |
| Lancement lent (pas d'écran verrouillé, pas de Camera Control) | Perd toutes les photos spontanées | 3 |
| Photos en 12 ou 48 MP, jamais 24 MP | Apple sert du 24 MP par défaut depuis le 15 | 4 |
| Pas de QR dans la préview | Réflexe quotidien | 4 |
| Pas de panorama | Usage occasionnel | 5 |
| Pas de rendu portrait | Hors scope assumé (bokeh système inaccessible) | 5 |

## Principe directeur : rien ne part sans filet

Mateo ne peut pas se permettre une app qui marche une fois sur deux. Trois
niveaux de filet, du moins cher au plus cher :

1. **Logique pure testée** (secondes, gratuit). Tout calcul qui peut vivre sans
   matériel sort du code qui touche AVFoundation : choix de format vidéo,
   mapping zoom vers caméra physique, bornes d'exposition, échelles ISO et
   vitesse, application des presets, détection de scène sombre. Testé sur
   macOS et sur Node, à chaque push.
2. **Compilation réelle** (10 min, gratuit sur repo public). `expo prebuild` +
   `xcodebuild` sur runner macOS à chaque changement natif. C'est ce qui aurait
   attrapé le renommage d'API Apple sans consommer un build EAS.
3. **Terrain** (Mateo, le soir). Réservé à ce qui ne se simule pas : rendu
   réel, ergonomie, tenue thermique.

Règle inchangée : **on ne pose un tag de build que sur des tests verts.**

## Phase 1 : socle de tests (fait le 14 août 2026)

Pas de nouvelle fonctionnalité, uniquement le filet. Sans ça, chaque phase
suivante ajoute du risque sans moyen de le mesurer.

- Extraction de la logique pure JS dans `src/lib/` (échelles, formatage,
  presets, détection nuit, zoom, aide) et tests avec le lanceur intégré de
  Node (zéro dépendance ajoutée, `node --test`).
- Extraction de la logique pure Swift dans `CameraMath.swift` (pastilles de
  zoom, choix de la caméra physique, intersection des bornes d'exposition) et
  tests XCTest sur macOS, même mécanique que `FrameStacker`.
- Nouveaux workflows :
  - `checks.yml` : typecheck, lint, tests JS, sur chaque push et chaque branche.
  - `ios-compile.yml` : prebuild + compilation Swift réelle sur macOS dès qu'un
    fichier natif bouge.
  - `native-tests.yml` : élargi à toutes les branches, plus de cas de test.
  - `build-testflight.yml` : conditionné aux trois précédents (aucun build ne
    part sur du rouge).

Sortie : aucune version utilisateur, uniquement de la CI.

Fait, plus deux corrections que le filet a rendues évidentes : les réglages
manuels sont stockés en valeur et non en index de molette (un index survivant à
un changement de plage pointait dans le vide), et le bandeau de pose lit le
capteur par abonnement au lieu d'une référence figée au rendu.

## Phase 2 : vidéo (le gros morceau)

Découpée en trois livraisons pour que chacune soit testable seule.

### 2a. Vidéo solide (v0.8.0, écrite le 14 août 2026)

Le socle qui doit être irréprochable avant d'ajouter le moindre format exotique.

Contraintes AVFoundation qui ont dicté l'architecture, vérifiées dans les
en-têtes du SDK :

- `sessionPreset` et `activeFormat` s'excluent. La vidéo passe donc par le choix
  explicite du format ; un preset posé après coup reprend la main et donne
  l'écran noir bien connu en 4K120.
- Apple Log désactive la sortie photo (la connexion devient inactive). Il faudra
  griser le déclencheur photo quand le Log est actif.
- Live Photo est impossible tant que la sortie film est dans la session.
- ProRes n'apparaît dans les codecs disponibles qu'avec une source 4:2:2 10 bits,
  et il écrit environ six gigaoctets par minute en 4K.
- Le HDR ne se demande pas : un format 10 bits en HLG BT.2020 est étiqueté Dolby
  Vision par le téléphone lui-même.
- `didFinishRecordingTo` passe une erreur non nulle même quand tout s'est bien
  terminé. Seul `AVErrorRecordingSuccessfullyFinishedKey` dit la vérité.
- Changer d'entrée coupe l'enregistrement : la bascule vers la caméra physique
  pour les réglages manuels se fait avant de lancer, jamais pendant.

- `VideoEngine` : entrée audio, `AVCaptureMovieFileOutput`, bascule propre
  photo ↔ vidéo de la session.
- Résolutions et cadences : 4K et 1080p à 24, 25, 30, 60 images/s, choix du
  codec HEVC ou H.264.
- Contrôles manuels pendant l'enregistrement (exposition, focus, balance des
  blancs, zoom, torche) avec la même bascule vers la caméra physique que la
  photo.
- Stabilisation réglable, orientation correcte, enregistrement dans la
  photothèque.
- Interface : sélecteur PHOTO / POSE / VIDÉO, minuteur d'enregistrement,
  contrôles incompatibles masqués pendant l'enregistrement.
- Garde-fous : espace disque vérifié avant de lancer, surveillance thermique,
  arrêt propre sur appel entrant ou passage en arrière-plan, durée maximale de
  sécurité. Codes d'erreur P4x.

### 2b. Vidéo pro (v0.9.0)

- Apple Log, HDR 10 bits, ProRes selon le matériel, avec avertissement de
  débit et d'espace disque.
- Hautes cadences (4K120 sur 16 Pro) et ralenti.
- Verrouillage de l'angle d'obturation (180°), que l'app d'Apple ne propose
  pas.
- Indicateurs audio et choix du micro si l'API le permet.

### 2c. Vidéo cinématique (faite le 14 août 2026)

L'API iOS 26 est bien ouverte aux apps tierces et le runner compile avec le SDK
26.5. Le mode impose ses conditions, toutes tenues côté code plutôt
qu'espérées : il vit sur la caméra virtuelle et interdit la mise au point
manuelle (activer le cinéma relâche donc tous les réglages manuels, et les
setters refusent d'agir tant qu'il est actif), il exige une liste précise de
types de métadonnées (la lecture des codes QR s'efface le temps du mode), et il
plafonne à 30 images par seconde sans ProRes ni Log (les réglages sont ramenés
avant que la caméra les voie).

## Phase 3 : intégration système (v0.9.x)

Le sujet qui décide de l'usage quotidien : si l'app n'est pas lançable en deux
secondes, Apple gagne chaque photo prise sur le vif. Un ingénieur Apple l'a
confirmé sur les forums : sans extension de capture, l'app n'apparaît même pas
dans la liste du bouton Camera Control.

Ordre imposé par le risque, pas par la valeur :

1. **Canari** (fait le 14 août 2026) : deux boutons de Centre de contrôle dans
   une cible WidgetKit, plus les raccourcis Siri dans la cible de l'app. Le
   démarrage de l'app est désormais vérifié en CI dans un simulateur, ce qui
   teste précisément la régression connue du plugin d'extensions sur React
   Native récent. Reste à vérifier au premier build : la création automatique
   de l'identifiant `com.mateobaril.persei.control` par EAS en mode non
   interactif. Si elle échoue, il faudra une session `eas credentials` avec le
   compte Apple.
2. **Extension LockedCameraCapture** si le canari passe. Cible ExtensionKit,
   `EXExtensionPointIdentifier` à `com.apple.securecapture`, iOS 18 minimum,
   interface SwiftUI dédiée (pas de React Native dedans). Le moteur caméra est
   réutilisable tel quel : `CameraEngine`, `FrameProcessor`, `FrameStacker` et
   `CameraMath` n'importent qu'AVFoundation, Core Image et Vision.
3. **Raccourcis Siri** dans l'app principale, pas dans le module : les App
   Intents doivent être compilés dans la cible de l'app pour être découverts.

Deux pièges notés d'avance : toujours régénérer le projet natif à neuf après un
changement d'extension, et vérifier la version d'exécution après tout Swift
ajouté dans une extension (elle n'entre pas dans l'empreinte, donc une OTA peut
partir vers un binaire incompatible).

## Phase 4 : finitions photo (v0.9.x)

- 24 MP : la dimension existe déjà dans `supportedMaxPhotoDimensions`, il suffit
  de proposer les trois choix au lieu de deux, avec la livraison différée pour
  garder le déclencheur instantané.
- Détection de QR codes et de codes-barres dans la préview.
- Styles maison (looks appliqués au rendu), à la place des Styles
  photographiques d'Apple qui ne sont pas exposés.

## Phase 5 : produit (v1.0)

- Panorama si le temps le permet.
- Sentry avant toute mise en vente.
- Icône App Store, page produit, localisation anglaise.
- Achat unique à 5 €, TestFlight externe, soumission.

## Ce qui reste hors de portée

Aucune API publique ne les expose, ce n'est pas un manque mais une limite :
réglage du pipeline Smart HDR, mode Nuit d'Apple lui-même, intensité du flash,
bokeh photo système, ouverture (le diaphragme est fixe).
