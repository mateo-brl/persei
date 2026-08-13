# Audit API AVFoundation photo (iOS 18 → 26) — août 2026

Source : headers SDK iPhoneOS 26.5 + WWDC 25/26. Sert de référence d'implémentation
pour `modules/persei-camera`. Verdicts : OUI dispo · COND sous conditions · NON pas d'API.

## Impossible publiquement (à ne jamais promettre)

- **Smart HDR / Deep Fusion** : aucun toggle photo. Seul levier indirect :
  `photoQualityPrioritization` (.speed minimise la fusion). Échappatoire : Bayer RAW.
- **Mode Nuit** : aucune API (fusion multi-frame propriétaire, poses 10-30 s) → notre
  mode astro = stacking maison.
- **Intensité du flash photo** (torche oui, flash non), **rendu Portrait/bokeh système**
  (on reçoit depth + mattes, le rendu est à notre charge), **Photographic Styles**,
  **photo spatiale**.

## Sous conditions (implémenté ou implémentable)

- **ZSL / responsive / fast capture** (iOS 17+) : chaîne de dépendance
  ZSL → responsive → fast. ZSL indispo en exposition manuelle et bracketing ;
  le support tombe (KVO) sur changement caméra/format/depth. Configurer avant
  `startRunning`.
- **Bracketing** : `AVCapturePhotoBracketSettings` ; `maxBracketedCapturePhotoCount`
  peut valoir 0, dépassement = exception. Interdits : flash, Live Photo, stab auto.
  RAW possible (count réduit). **48 MP non garanti** (12 MP servis en pratique) —
  ne pas fixer maxPhotoDimensions sur un bracket. Bug connu 16 Pro : ±3 EV+ → images noires.
- **Live Photo** : exige preset .photo ; support tombe à NO en 48 MP ; incompatible
  ProRAW et bracketing. `livePhotoVideoCodecType`, auto-trim ~3 s.
- **Résolution** : `supportedMaxPhotoDimensions` → output → settings (match exact).
  24 MP = .quality + deferred delivery obligatoire ; 48 MP = single-frame
  (.balanced/.quality). ProRAW 48 MP OK (8064×6048).
- **Depth / mattes** : uniquement TrueDepth, devices virtuels (dualWide/triple), LiDAR —
  pas sur un device physique arrière seul. Portrait matte exige depth + personnes.
  Incompatible ProRAW.
- **Macro / bascule constituants** : pas de toggle macro dédié ;
  `setPrimaryConstituentDeviceSwitchingBehavior` (.auto/.restricted/.locked) sur device
  virtuel ; `minimumFocusDistance` pour détecter la capacité (~20 mm UW Pro).
  → cible v0.4 : passer sur `tripleCamera` (zoom continu + macro auto).

## Disponible sans réserve

- Exposition custom (ISO + durée, bornes `activeFormat`), bias EV, focus `lensPosition`,
  **BdB kelvin + tint ∈ [-150, +150]** (iOS 26 : verrouillage direct temp/tint + presets),
  torche `setTorchModeOn(level: 0-1)` (throttling thermique possible),
  flash par capture via `settings.flashMode`.

## À explorer (roadmap)

- **Camera Control / Capture Controls** (iOS 18, iPhone 16+) : `AVCaptureSystemZoomSlider`,
  `AVCaptureSlider`… + `AVCaptureEventInteraction` (déclencheur via boutons volume).
- **Constant Color** (iOS 18, iPhone 14+) : couleurs indépendantes de l'éclairage,
  exige flash, interdit RAW.
- **Son d'obturateur débrayable** (iOS 18, selon région), **GDC** toggle,
  **AF piloté visages** débrayable, `secondaryNativeResolutionZoomFactors` (crop 2x natif),
  deferred delivery (24 MP), aspect ratio dynamique + smart framing + détection
  d'objectif sale (iOS 26).
- Vidéo (chantier dédié) : 4K120, Apple Log (`activeColorSpace`), ProRes,
  Cinematic video API (iOS 26), stabilisation, auto frame rate.
