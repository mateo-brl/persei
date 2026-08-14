# Persei

Appareil photo iOS à contrôles manuels complets — ISO, vitesse d'obturation, mise au point, balance des blancs, RAW/ProRAW 48 MP. Né la nuit des Perséides, pensé pour la photo de nuit et d'étoiles filantes.

## Architecture

- **Expo SDK 57** (React Native, TypeScript, expo-router) — toute l'UI est en JS, livrable en OTA.
- **`modules/persei-camera`** — module natif local (Swift, Expo Modules API) qui pilote AVFoundation directement : `setExposureModeCustom` (ISO + durée), `lensPosition`, gains de balance des blancs, capture ProRAW/48 MP. Tout changement ici modifie le fingerprint natif → rebuild TestFlight.
- **CI GitHub Actions** : `checks.yml` (types, style, tests JS), `native-tests.yml` (XCTest du moteur d'empilement et des calculs caméra), `ios-compile.yml` (prebuild + `xcodebuild` réel, sans signature), `ota-update.yml` (push sur main → `eas update`), `build-testflight.yml` (manuel ou tag `v*` → `eas build --local` sur runner macOS → TestFlight, conditionné aux vérifications). Aucun Mac requis.

## Tests

`npm test` lance les tests de la logique pure JS avec le lanceur intégré de Node, sans dépendance ajoutée. `cd native-tests && swift test` (après `bash native-tests/sync-sources.sh`) teste le moteur d'empilement et les calculs caméra sur macOS. Règle du projet : on ne pose un tag de build que sur des tests verts.

## Mise en route (une fois)

1. `npx eas-cli login` puis `eas init` — remplit `extra.eas.projectId` et `updates.url` dans `app.json`.
2. Apple Developer : App ID `com.mateobaril.persei` + app dans App Store Connect. Clé API ASC (.p8, rôle App Manager) enregistrée via `eas credentials`.
3. Remplacer `<ID_APP_STORE_CONNECT>` et `<TEAM_ID>` dans `eas.json`.
4. Secret GitHub `EXPO_TOKEN` (token CI depuis expo.dev).

## Règle OTA vs rebuild

`runtimeVersion: { policy: "fingerprint" }` — vérifier avant publication :
`npx @expo/fingerprint fingerprint:generate --platform ios`. JS/assets → OTA. Natif (module, plugin, permission) → rebuild TestFlight (expiration 90 jours, prévoir un calendrier).

## Feuille de route

- [x] v0.1 : préview live, exposition manuelle (ISO + vitesse), focus manuel, BdB kelvin, RAW/ProRAW, sauvegarde photothèque
- [x] v0.2-0.3 : UI Final Cut Camera (molettes à crans, lecture capteur temps réel), frontale, flash/torche, teinte, Live Photos, profondeur, bracketing, 12/48 MP, aide ⓘ, mises à jour in-app
- [x] v0.4 : device virtuel (zoom continu 0,5×→5×, pastilles matérielles dont crop 2×, macro auto) + **mode POSE LONGUE sans plafond** : empilement de trames 1 s en moyenne (« Lueur ») et/ou fusion max (« Étoiles » — garde les traînées de météores que le mode Nuit d'Apple efface)
- [x] v0.5 : alignement des trames (pose à main levée), focus peaking, histogramme, zebras, loupe, niveau, filtre météores, déclencheur volume et Camera Control
- [x] v0.6-0.7 : presets par scénario, mode nuit automatique, empilement RAW linéaire, pose de jour par trames auto
- [x] v0.8 : **vidéo** (résolutions et cadences lues sur le matériel, HDR 10 bits, Apple Log, ProRes, stabilisation, pause et reprise, photo pendant l'enregistrement, garde-fous disque et surchauffe), définitions photo 12/24/48 MP, lecture des codes QR
- [ ] Écran verrouillé et Centre de contrôle (extensions iOS)
- [ ] Vidéo cinématique (bokeh, iOS 26)
