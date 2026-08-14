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

## Phase 1 : socle de tests (prérequis de tout le reste)

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

## Phase 2 : vidéo (le gros morceau)

Découpée en trois livraisons pour que chacune soit testable seule.

### 2a. Vidéo solide (v0.8.0)

Le socle qui doit être irréprochable avant d'ajouter le moindre format exotique.

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

### 2c. Vidéo cinématique (si l'API iOS 26 le permet)

Le bokeh vidéo d'Apple est exposé aux apps tierces depuis iOS 26. À confirmer,
puis à intégrer si le coût est raisonnable.

## Phase 3 : intégration système (v0.9.x)

Le sujet qui décide de l'usage quotidien : si l'app n'est pas lançable en deux
secondes, Apple gagne chaque photo prise sur le vif.

- Extension LockedCameraCapture pour l'écran verrouillé et le bouton Camera
  Control.
- Bouton dans le Centre de contrôle.
- Raccourcis Siri pour lancer un mode directement.

Risque à mesurer d'abord : ajouter une extension à un projet Expo managé sans
ouvrir Xcode. Le compilateur de la phase 1 sert de validation.

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
