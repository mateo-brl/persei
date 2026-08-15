import Foundation

/// Calculs du moteur caméra qui ne dépendent d'aucun matériel : choix des
/// pastilles de zoom, correspondance zoom vers caméra physique, bornes
/// d'exposition. Isolés d'AVFoundation pour être testés sur macOS en CI, là où
/// aucune caméra n'existe. `CameraEngine` ne fait que traduire les objets
/// AVFoundation en ces structures.
enum LensKind {
  case ultraWide
  case wide
  case telephoto
  case other
}

/// Une caméra physique d'un device virtuel.
struct LensSpec {
  let kind: LensKind
  /// `secondaryNativeResolutionZoomFactors` : recadrages de qualité optique
  /// offerts par le capteur (le 2× du 48 MP sur les Pro).
  let secondaryCrops: [Double]

  init(kind: LensKind, secondaryCrops: [Double] = []) {
    self.kind = kind
    self.secondaryCrops = secondaryCrops
  }
}

/// Pastille de zoom : `factor` est affiché, `zoom` est le videoZoomFactor.
struct ZoomPresetSpec: Equatable {
  let factor: Double
  let zoom: Double
}

/// Caméra physique retenue pour un zoom donné, et le zoom à lui appliquer.
struct PhysicalPick: Equatable {
  let index: Int
  let zoom: Double
}

/// Bornes d'exposition d'un format.
struct ExposureLimits: Equatable {
  var minIso: Float
  var maxIso: Float
  var minSeconds: Double
  var maxSeconds: Double
}

enum CameraMath {
  /// Zoom interne correspondant au 1× de l'utilisateur. Sur un device virtuel
  /// avec ultra grand-angle, `videoZoomFactor` compte depuis celui-ci : le 1×
  /// vaut le premier seuil de bascule (2,0 sur un 16 Pro).
  static func wideBaseZoom(constituents: [LensSpec], switchOvers: [Double]) -> Double {
    let hasUltraWide = constituents.contains { $0.kind == .ultraWide }
    guard hasUltraWide else { return 1 }
    return switchOvers.first ?? 2
  }

  /// Pastilles façon app Apple : 0,5× / 1× / 2× / 5× selon le matériel.
  static func zoomPresets(constituents: [LensSpec], switchOvers: [Double]) -> [ZoomPresetSpec] {
    guard constituents.count >= 2 else { return [ZoomPresetSpec(factor: 1, zoom: 1)] }

    let hasUltraWide = constituents.contains { $0.kind == .ultraWide }
    let wideZoom = wideBaseZoom(constituents: constituents, switchOvers: switchOvers)
    var presets: [ZoomPresetSpec] = []

    if hasUltraWide {
      presets.append(ZoomPresetSpec(factor: 0.5, zoom: 1))
    }
    presets.append(ZoomPresetSpec(factor: 1, zoom: wideZoom))

    // Recadrage natif du capteur principal : c'est du 2× optiquement propre,
    // pas du zoom numérique.
    if let wide = constituents.first(where: { $0.kind == .wide }),
       let crop = wide.secondaryCrops.first, crop > 1 {
      presets.append(ZoomPresetSpec(factor: crop, zoom: wideZoom * crop))
    }

    if constituents.contains(where: { $0.kind == .telephoto }) {
      if hasUltraWide, switchOvers.count >= 2, wideZoom > 0 {
        let factor = (switchOvers[1] / wideZoom * 10).rounded() / 10
        presets.append(ZoomPresetSpec(factor: factor, zoom: switchOvers[1]))
      } else if !hasUltraWide, let first = switchOvers.first {
        presets.append(ZoomPresetSpec(factor: first, zoom: first))
      }
    }

    return presets.sorted { $0.factor < $1.factor }
  }

  /// Caméra physique équivalente au zoom courant du device virtuel. Le device
  /// virtuel ne supporte ni exposition custom, ni focus verrouillé, ni gains de
  /// balance des blancs : tout réglage manuel passe par ce choix.
  static func physicalPick(
    constituents: [LensSpec],
    switchOvers: [Double],
    zoom: Double
  ) -> PhysicalPick? {
    guard !constituents.isEmpty else { return nil }
    let safeZoom = zoom.isFinite ? max(zoom, 0.1) : 1

    let ultraWideIndex = constituents.firstIndex { $0.kind == .ultraWide }
    let wideIndex = constituents.firstIndex { $0.kind == .wide }
    let telephotoIndex = constituents.firstIndex { $0.kind == .telephoto }

    if let ultraWideIndex, let firstSwitch = switchOvers.first, safeZoom < firstSwitch {
      return PhysicalPick(index: ultraWideIndex, zoom: safeZoom)
    }
    if let telephotoIndex, switchOvers.count >= 2, safeZoom >= switchOvers[1], switchOvers[1] > 0 {
      return PhysicalPick(index: telephotoIndex, zoom: safeZoom / switchOvers[1])
    }
    guard let wideIndex else {
      return PhysicalPick(index: 0, zoom: safeZoom)
    }
    let base = wideBaseZoom(constituents: constituents, switchOvers: switchOvers)
    return PhysicalPick(index: wideIndex, zoom: max(1, safeZoom / max(base, 0.001)))
  }

  /// Inverse de `physicalPick` : depuis la caméra physique active et son zoom,
  /// retrouve le facteur du device virtuel.
  ///
  /// Les deux repères doivent circuler dans le même sens, sinon l'interface
  /// lit une échelle et en écrit une autre : le pincement repartait de la
  /// valeur physique et faisait sauter d'objectif au premier mouvement.
  static func virtualZoom(
    constituents: [LensSpec],
    switchOvers: [Double],
    index: Int,
    zoom: Double
  ) -> Double {
    guard zoom.isFinite else { return 1 }
    guard constituents.indices.contains(index) else { return zoom }
    switch constituents[index].kind {
    case .ultraWide:
      return zoom
    case .telephoto:
      guard switchOvers.count >= 2, switchOvers[1] > 0 else { return zoom }
      return zoom * switchOvers[1]
    case .wide:
      return zoom * max(wideBaseZoom(constituents: constituents, switchOvers: switchOvers), 0.001)
    case .other:
      return zoom
    }
  }

  /// Bornes réellement applicables : le format du device virtuel annonce des
  /// plages plus larges que celles de la caméra physique active (l'ultra
  /// grand-angle plafonne bien plus bas). Sortir de l'intersection fait lever
  /// une NSException à AVFoundation, donc un crash.
  static func intersect(_ virtual: ExposureLimits, _ active: ExposureLimits?) -> ExposureLimits {
    var result = virtual
    if let active {
      result.minIso = max(virtual.minIso, active.minIso)
      result.maxIso = min(virtual.maxIso, active.maxIso)
      result.minSeconds = max(virtual.minSeconds, active.minSeconds)
      result.maxSeconds = min(virtual.maxSeconds, active.maxSeconds)
    }
    if result.minIso > result.maxIso { result.minIso = result.maxIso }
    if result.minSeconds > result.maxSeconds { result.minSeconds = result.maxSeconds }
    return result
  }

  /// ISO borné, jamais NaN : une valeur non finie viendrait d'un calcul JS raté
  /// et ferait lever AVFoundation.
  static func clampIso(_ iso: Double, in limits: ExposureLimits) -> Float {
    guard iso.isFinite else { return limits.minIso }
    return min(max(Float(iso), limits.minIso), limits.maxIso)
  }

  /// Durée d'exposition bornée, en secondes.
  static func clampSeconds(_ seconds: Double, in limits: ExposureLimits) -> Double {
    guard seconds.isFinite else { return limits.minSeconds }
    return min(max(seconds, limits.minSeconds), limits.maxSeconds)
  }

  /// Durée d'une trame de pose longue : la plus longue que le matériel accepte,
  /// plafonnée à 1 s (au-delà, aucun iPhone ne suit).
  static func poseFrameSeconds(in limits: ExposureLimits) -> Double {
    min(1.0, limits.maxSeconds)
  }

  /// Définition photo la plus proche de celle demandée. Les dimensions posées
  /// doivent appartenir à celles du format actif, sinon la capture lève une
  /// exception : on choisit donc toujours dans la liste du matériel.
  /// `target` à 0 ou négatif demande la plus grande.
  static func nearestPhotoSize(_ available: [Double], target: Double) -> Int? {
    guard !available.isEmpty else { return nil }
    if target <= 0 {
      return available.indices.max { available[$0] < available[$1] }
    }
    return available.indices.min { abs(available[$0] - target) < abs(available[$1] - target) }
  }

  /// Une définition demandée à la capture doit satisfaire deux conditions à la
  /// fois : appartenir aux définitions du format ACTIF, et ne pas dépasser le
  /// plafond posé sur la sortie photo. Une seule des deux ne suffit pas, et
  /// AVFoundation sanctionne le manquement par une exception au déclenchement,
  /// jamais par une erreur. D'où cette vérification systématique.
  static func isPhotoSizeAllowed(_ size: PhotoSize, available: [PhotoSize], cap: PhotoSize?) -> Bool {
    guard available.contains(size) else { return false }
    guard let cap else { return true }
    return size.width <= cap.width && size.height <= cap.height
  }

  /// Le plafond de la sortie appartient-il encore au format actif ? Non veut
  /// dire qu'il a été calculé sur un autre format : plus aucune définition
  /// n'est demandable tant qu'il n'est pas recalculé.
  static func isPhotoCapStale(_ cap: PhotoSize, available: [PhotoSize]) -> Bool {
    !available.isEmpty && !available.contains(cap)
  }

  /// Plus grande définition demandable : dans le format actif et sous le
  /// plafond. Rend `nil` quand aucune ne convient ; l'appelant ne pose alors
  /// rien du tout, ce qu'AVFoundation accepte toujours.
  static func usablePhotoSize(available: [PhotoSize], cap: PhotoSize?) -> PhotoSize? {
    available
      .filter { isPhotoSizeAllowed($0, available: available, cap: cap) }
      .max { $0.pixels < $1.pixels }
  }

  /// Plus petite définition acceptable : la pose longue empile des dizaines
  /// d'images en mémoire, elle ne peut pas le faire en 48 MP.
  static func smallestPhotoSize(available: [PhotoSize], cap: PhotoSize?) -> PhotoSize? {
    available
      .filter { isPhotoSizeAllowed($0, available: available, cap: cap) }
      .min { $0.pixels < $1.pixels }
  }
}

/// Ce qu'on demande réellement au capteur pour une photo.
enum RawKind {
  /// RAW Bayer : fichier deux fois plus léger que le ProRAW, mais interdit dès
  /// que le zoom n'est pas exactement 1,0.
  case bayer
  /// Apple ProRAW : accepté à tous les zooms, fichiers très lourds.
  case proRaw
  /// Image développée par l'appareil (HEIC/HEVC).
  case processed
}

extension CameraMath {
  /// Format à demander pour une capture.
  ///
  /// AVFoundation refuse le RAW Bayer à un zoom autre que 1,0 — et le refuse
  /// par une exception au déclenchement, qui tue l'app. C'est le plantage du
  /// 14 août à 22 h 48 : une pose lancée au 2×. Le zoom est donc une condition
  /// de choix du format, pas un détail d'affichage.
  ///
  /// `compact` vise l'empilement de pose : des dizaines d'images en mémoire,
  /// où le ProRAW ne passe pas. Mieux vaut alors du développé que rien.
  static func rawKind(
    wantsRaw: Bool,
    hasBayer: Bool,
    hasProRaw: Bool,
    zoom: Double,
    compact: Bool
  ) -> RawKind {
    guard wantsRaw else { return .processed }
    let zoomNeutre = abs(zoom - 1.0) < 0.001
    if hasBayer, zoomNeutre { return .bayer }
    if hasProRaw, !compact { return .proRaw }
    return .processed
  }

  /// Durée d'une trame de pose déduite de la mesure automatique.
  ///
  /// La plus longue que le matériel accepte, mais jamais au point d'exiger un
  /// ISO sous le minimum : en plein jour, une trame d'une seconde ne rendrait
  /// que du blanc. La nuit, la limite ne joue pas et on obtient bien la
  /// seconde entière.
  static func poseFrameSeconds(
    currentIso: Double,
    currentSeconds: Double,
    in limits: ExposureLimits
  ) -> Double {
    let plafond = poseFrameSeconds(in: limits)
    guard currentIso.isFinite, currentIso > 0, currentSeconds > 0, limits.minIso > 0 else {
      return plafond
    }
    let sansSurexposition = currentIso * currentSeconds / Double(limits.minIso)
    return clampSeconds(min(plafond, sansSurexposition), in: limits)
  }

  /// ISO à poser quand on allonge la durée d'exposition.
  ///
  /// La lumière reçue double quand la durée double : l'ISO se divise d'autant.
  /// Sans ce report, une pose qui passe de 1/15 s à 1 s en gardant l'ISO que
  /// l'automatique affichait surexpose de presque quatre diaphragmes. Et à
  /// l'inverse, garder la durée courte de l'automatique en pleine nuit donne
  /// exactement ce qu'on reproche à l'app : des images noires et bruitées là
  /// où le mode nuit de l'iPhone sort une photo lisible.
  static func equivalentIso(
    currentIso: Double,
    currentSeconds: Double,
    targetSeconds: Double,
    in limits: ExposureLimits
  ) -> Float {
    guard currentIso.isFinite, currentSeconds > 0, targetSeconds > 0 else {
      return limits.maxIso
    }
    return clampIso(currentIso * currentSeconds / targetSeconds, in: limits)
  }
}

/// Une définition photo en pixels. Doublure testable de `CMVideoDimensions`,
/// que CameraMath n'importe pas pour rester compilable sans matériel.
struct PhotoSize: Equatable {
  let width: Int
  let height: Int

  var pixels: Int { width * height }
  var megapixels: Double { Double(width) * Double(height) / 1_000_000.0 }
}

// MARK: - Vidéo

/// Plage de cadences supportée par un format.
struct FrameRateRange: Equatable {
  let min: Double
  let max: Double

  func contains(_ rate: Double) -> Bool {
    rate >= min - 0.01 && rate <= max + 0.01
  }
}

/// Étendue dynamique demandée pour la vidéo.
enum VideoRange: String {
  /// Rec.709 classique, lisible partout.
  case sdr
  /// HLG BT.2020 10 bits : l'iPhone y écrit du Dolby Vision automatiquement.
  case hdr
  /// Apple Log : image plate destinée à l'étalonnage.
  case log
}

/// Description d'un format vidéo du device, sans dépendance à AVFoundation.
struct VideoFormatSpec {
  let width: Int
  let height: Int
  let frameRateRanges: [FrameRateRange]
  /// Format 10 bits (`x420`), condition du HDR.
  let isTenBit: Bool
  /// Source 4:2:2 10 bits (`x422`), seule à autoriser ProRes.
  let isProResSource: Bool
  let supportsAppleLog: Bool
  let supportsHlg: Bool
  /// Format issu du regroupement de pixels : meilleur en basse lumière, moins
  /// détaillé. AVFoundation en propose souvent un doublon par résolution.
  let isBinned: Bool
  /// Largeur de photo maximale offerte pendant la vidéo.
  let maxPhotoWidth: Int
  /// Flou d'arrière-plan cinématique (iOS 26), réservé à certains formats.
  let supportsCinematic: Bool

  init(
    width: Int,
    height: Int,
    frameRateRanges: [FrameRateRange],
    isTenBit: Bool = false,
    isProResSource: Bool = false,
    supportsAppleLog: Bool = false,
    supportsHlg: Bool = false,
    isBinned: Bool = false,
    maxPhotoWidth: Int = 0,
    supportsCinematic: Bool = false
  ) {
    self.width = width
    self.height = height
    self.frameRateRanges = frameRateRanges
    self.isTenBit = isTenBit
    self.isProResSource = isProResSource
    self.supportsAppleLog = supportsAppleLog
    self.supportsHlg = supportsHlg
    self.isBinned = isBinned
    self.maxPhotoWidth = maxPhotoWidth
    self.supportsCinematic = supportsCinematic
  }

  var maxFrameRate: Double { frameRateRanges.map(\.max).max() ?? 0 }
  func supports(frameRate: Double) -> Bool { frameRateRanges.contains { $0.contains(frameRate) } }
}

/// Réglage vidéo demandé par l'utilisateur.
struct VideoRequest: Equatable {
  let height: Int
  let frameRate: Double
  let range: VideoRange
  let wantsProRes: Bool
  /// Flou d'arrière-plan cinématique : format dédié, 30 images/s au plus.
  let wantsCinematic: Bool

  init(
    height: Int,
    frameRate: Double,
    range: VideoRange,
    wantsProRes: Bool,
    wantsCinematic: Bool = false
  ) {
    self.height = height
    self.frameRate = frameRate
    self.range = range
    self.wantsProRes = wantsProRes
    self.wantsCinematic = wantsCinematic
  }
}

extension CameraMath {
  /// Format vidéo à activer, ou nil si le matériel ne sait pas le faire. Le
  /// choix se fait sur `activeFormat` et jamais par `sessionPreset` : les deux
  /// sont exclusifs, et un preset posé après coup reprend la main sur le
  /// format (écran noir en 4K120, c'est le piège classique).
  static func pickVideoFormat(_ formats: [VideoFormatSpec], request: VideoRequest) -> Int? {
    var best: (index: Int, score: Double)?

    for (index, format) in formats.enumerated() {
      guard format.height == request.height,
            format.supports(frameRate: request.frameRate)
      else { continue }

      if request.wantsProRes != format.isProResSource { continue }
      if request.wantsCinematic && !format.supportsCinematic { continue }
      if request.range == .log && !format.supportsAppleLog { continue }
      if request.range == .hdr && !(format.isTenBit && format.supportsHlg) { continue }

      // À égalité de résolution et de cadence, on préfère le format dont la
      // cadence maximale est la plus proche du besoin : prendre un format 240
      // images/s pour filmer à 30 dégrade l'image sans rien apporter.
      var score = 1000.0 - (format.maxFrameRate - request.frameRate)
      if format.isBinned { score -= 50 }
      // Les formats 10 bits sont en HDR permanent : pour une demande SDR on
      // ne les prend qu'à défaut d'autre chose.
      if request.range == .sdr && format.isTenBit { score -= 30 }
      // Un format qui laisse prendre de grandes photos pendant la vidéo est
      // préférable, mais ça pèse moins que la qualité vidéo elle-même.
      score += min(Double(format.maxPhotoWidth) / 1000.0, 10)

      if best == nil || score > best!.score {
        best = (index, score)
      }
    }

    return best?.index
  }

  /// Cadences proposables en cinématique : Apple limite ce mode à 30 images/s.
  static func cinematicFrameRates(
    _ formats: [VideoFormatSpec],
    height: Int
  ) -> [Double] {
    [24.0, 25.0, 30.0].filter { rate in
      formats.contains { $0.supportsCinematic && $0.height == height && $0.supports(frameRate: rate) }
    }
  }

  /// Cadences réellement proposables pour une hauteur donnée, dans l'ordre.
  static func availableFrameRates(
    _ formats: [VideoFormatSpec],
    height: Int,
    candidates: [Double] = [24, 25, 30, 60, 120, 240]
  ) -> [Double] {
    candidates.filter { rate in
      formats.contains { $0.height == height && $0.supports(frameRate: rate) }
    }
  }

  /// Hauteurs proposables, de la plus grande à la plus petite.
  static func availableHeights(
    _ formats: [VideoFormatSpec],
    candidates: [Int] = [2160, 1080, 720]
  ) -> [Int] {
    candidates.filter { height in formats.contains { $0.height == height } }
  }

  /// Marge disque exigée avant de lancer un enregistrement, en octets. ProRes
  /// écrit environ 6 Go par minute en 4K : accepter de démarrer avec 200 Mo
  /// libres, c'est promettre un fichier qui sera coupé au bout de deux
  /// secondes.
  static func requiredFreeBytes(forProRes proRes: Bool) -> Int64 {
    proRes ? 6_000_000_000 : 500_000_000
  }
}
