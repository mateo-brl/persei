# Persei

Appareil photo iOS à contrôles manuels complets — ISO, vitesse d'obturation, mise au point, balance des blancs, RAW/ProRAW 48 MP. Né la nuit des Perséides, pensé pour la photo de nuit et d'étoiles filantes.

## Architecture

- **Expo SDK 57** (React Native, TypeScript, expo-router) — toute l'UI est en JS, livrable en OTA.
- **`modules/persei-camera`** — module natif local (Swift, Expo Modules API) qui pilote AVFoundation directement : `setExposureModeCustom` (ISO + durée), `lensPosition`, gains de balance des blancs, capture ProRAW/48 MP. Tout changement ici modifie le fingerprint natif → rebuild TestFlight.
- **CI GitHub Actions** : `ota-update.yml` (push sur main → `eas update`), `build-testflight.yml` (manuel ou tag `v*` → `eas build --local` sur runner macOS → TestFlight). Aucun Mac requis.

## Mise en route (une fois)

1. `npx eas-cli login` puis `eas init` — remplit `extra.eas.projectId` et `updates.url` dans `app.json`.
2. Apple Developer : App ID `com.mateobaril.persei` + app dans App Store Connect. Clé API ASC (.p8, rôle App Manager) enregistrée via `eas credentials`.
3. Remplacer `<ID_APP_STORE_CONNECT>` et `<TEAM_ID>` dans `eas.json`.
4. Secret GitHub `EXPO_TOKEN` (token CI depuis expo.dev).

## Règle OTA vs rebuild

`runtimeVersion: { policy: "fingerprint" }` — vérifier avant publication :
`npx @expo/fingerprint fingerprint:generate --platform ios`. JS/assets → OTA. Natif (module, plugin, permission) → rebuild TestFlight (expiration 90 jours, prévoir un calendrier).

## Feuille de route

- [x] v0 : préview live, exposition manuelle (ISO + vitesse), focus manuel, BdB kelvin, RAW/ProRAW, choix d'objectif, sauvegarde photothèque
- [ ] Mode astro/météores : capture continue + stacking en fusion max (garde les traînées — ce que le mode Nuit d'Apple efface)
- [ ] Focus peaking, histogramme, zebras
- [ ] Presets par scénario (étoiles, filé d'eau, light trails)
