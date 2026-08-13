# Audit caméras iPhone (12 → 2026) — état août 2026

Référence pour le gating des fonctionnalités Persei. Règle d'or : **toujours lire les
capacités au runtime** (`activeFormat.minISO/maxISO`, `supportedMaxPhotoDimensions`,
`isAppleProRAWSupported`…) — ce tableau sert de carte, pas de source de vérité.

| Modèle | Objectifs + ouvertures | 48 MP / ProRAW | Macro | LiDAR | Vidéo pro | Notes |
|---|---|---|---|---|---|---|
| 12 / 12 mini (2020) | W 12 MP ƒ/1.6 OIS ; UW 12 MP ƒ/2.4 ; Front 12 MP ƒ/2.2 | Non / Non | Non | Non | 4K60, DV 4K30 | Night mode toutes caméras ; zoom num. 5x |
| 12 Pro | + Télé 12 MP ƒ/2.0 (2x) | Non / ProRAW 12 MP | Non | Oui | DV 4K60 | Portraits de nuit (LiDAR) |
| 12 Pro Max | W sensor-shift (1er) ; Télé ƒ/2.2 (2.5x) | Non / ProRAW 12 MP | Non | Oui | DV 4K60 | Capteur principal +47 % |
| 13 / 13 mini (2021) | W ƒ/1.6 sensor-shift ; UW ƒ/2.4 ; Front ƒ/2.2 | Non / Non | Non | Non | DV 4K60, Cinématique | Smart HDR 4 |
| 13 Pro / Pro Max | W ƒ/1.5 ; UW ƒ/1.8 AF ; Télé ƒ/2.8 (3x) | Non / ProRAW 12 MP | **Oui** (1er) | Oui | **ProRes** 4K30 | Night mode télé |
| 14 / 14 Plus (2022) | W ƒ/1.5 ; UW ƒ/2.4 ; Front ƒ/1.9 AF | Non / Non | Non | Non | DV 4K60, Action mode | Photonic Engine |
| 14 Pro / Pro Max | **W 48 MP** ƒ/1.78 ; UW ƒ/2.2 AF ; Télé ƒ/2.8 (3x) | **48 MP / ProRAW 48 MP** | Oui | Oui | ProRes 4K30 | Crop 2x qualité optique |
| 15 / 15 Plus (2023) | W 48 MP ƒ/1.6 ; UW ƒ/2.4 ; Front ƒ/1.9 AF | 48 MP HEIF / pas ProRAW | Non | Non | DV 4K60 | 24 MP par défaut |
| 15 Pro | W 48 MP ƒ/1.78 ; UW ƒ/2.2 AF ; Télé 3x | 48 MP / ProRAW 48 MP | Oui | Oui | ProRes 4K60 ext., **Apple Log** | Vidéo spatiale |
| 15 Pro Max | Télé **5x 120 mm tétraprisme** | idem | Oui | Oui | idem | Zoom num. 25x |
| 16 / 16 Plus (2024) | W « Fusion » 48 MP ƒ/1.6 ; UW ƒ/2.2 **AF** ; Front ƒ/1.9 | 48 MP HEIF / pas ProRAW | **Oui** | Non | DV 4K60 | Camera Control ; spatial |
| 16e (2025) | Mono 48 MP ƒ/1.6 OIS simple ; Front ƒ/1.9 | 48 MP HEIF / pas ProRAW | Non | Non | DV 4K60 | Pas d'UW ni Camera Control |
| **16 Pro / Pro Max** (2024) | W 48 MP ƒ/1.78 ; **UW 48 MP** ƒ/2.2 AF ; Télé 12 MP ƒ/2.8 **5x 120 mm** ; Front 12 MP ƒ/1.9 AF | 48 MP / ProRAW 48 MP (+ JPEG-XL) | Oui (48 MP) | Oui | **4K120 DV**, ProRes 4K120 ext., Apple Log, ACES | Détail ci-dessous |
| 17 (2025) | W 48 MP ; UW 48 MP AF ; **Front 18 MP Center Stage** | 48 MP HEIF / pas ProRAW | Oui | Non | DV 4K60, Dual Capture | |
| Air (2025) | Mono 48 MP ; Front 18 MP Center Stage | 48 MP HEIF / pas ProRAW | Non | Non | DV 4K60 | |
| 17 Pro / Pro Max (2025) | **3× 48 MP** (W ; UW ; Télé 4x 100 mm + crop 8x) ; Front 18 MP | 48 MP / ProRAW (avant + arrière) | Oui | Oui | 4K120, **ProRes RAW**, **Log 2**, Genlock | Zoom num. 40x |
| 17e (2026) | Mono 48 MP ; Front 12 MP AF | 48 MP HEIF / pas ProRAW | Non | Non | DV 4K60 | |

## iPhone 16 Pro (téléphone de référence du projet)

- **Principale** : 48 MP quad-Bayer 1/1.28", 24 mm ƒ/1.78, sensor-shift 2e gén.,
  zéro shutter lag y compris en 48 MP et ProRAW.
- **UW** : 48 MP 13 mm ƒ/2.2 AF (macro ~2 cm, y compris 48 MP).
- **Télé** : 12 MP 120 mm ƒ/2.8 tétraprisme (5x), OIS 3D.
- **Frontale** : TrueDepth 12 MP ƒ/1.9 AF.
- ProRAW 48 MP (DNG ~75 Mo) avec option **JPEG-XL** ; 24 MP par défaut ;
  presets focale 24/28/35 mm + crop 2x qualité optique.
- LiDAR, flash True Tone adaptatif, **Camera Control** (API `AVCaptureControl`, iOS 18).
- Vidéo : 4K120 Dolby Vision, ProRes 4K120 (SSD externe), Apple Log, ACES,
  Cinématique, Action mode, vidéo spatiale, Audio Mix 4 micros.

## AVFoundation — points structurants

- Devices : discrets (`builtInWideAngle/UltraWide/Telephoto`) + **virtuels**
  (`dualCamera`, `dualWideCamera`, `tripleCamera`, `trueDepthCamera`).
  Sur `tripleCamera` : `videoZoomFactor` 1.0 = UW, `switchOverVideoZoomFactors = [2, 10]`
  (zoom continu 0,5x→5x avec bascule auto, macro auto). → cible v0.4 de Persei.
- **Exposition custom max ≈ 1 s** sur tous les modèles. Les poses Night mode 10–30 s
  d'Apple = fusion multi-frame propriétaire non exposée. → mode astro Persei = stacking.
- Plages runtime (ordres de grandeur, principale) : ISO ~55 → ~12 000 (16 Pro),
  ISO min plus bas sur télé/UW (~20–34), ISO max frontale/UW bien plus faibles.
  Confirmés dev : 13 Pro min 40 ; 15 Pro 55–12 320 ; durée max ~1 s (14 Pro).
- 48 MP via `maxPhotoDimensions` (8064×6048) sur W **et** UW (16 Pro) ;
  Apple Log via `AVCaptureColorSpace.appleLog` ; deferred processing /
  responsive capture / zero shutter lag : iOS 17+.
