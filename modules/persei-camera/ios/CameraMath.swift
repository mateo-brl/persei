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
}
