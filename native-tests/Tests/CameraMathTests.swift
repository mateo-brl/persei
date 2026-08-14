import XCTest

@testable import PerseiStack

/// Chaque cas correspond à un crash ou à un défaut visible en vrai : mauvaise
/// caméra choisie pour un réglage manuel, bornes d'exposition hors plage
/// (NSException immédiate), pastilles de zoom fausses.
final class CameraMathTests: XCTestCase {
  /// iPhone 16 Pro : ultra grand-angle, principal 48 MP (recadrage 2×), télé 5×.
  private let proLenses = [
    LensSpec(kind: .ultraWide),
    LensSpec(kind: .wide, secondaryCrops: [2]),
    LensSpec(kind: .telephoto),
  ]
  private let proSwitchOvers = [2.0, 10.0]

  // MARK: - Pastilles de zoom

  func testProPresetsMatchApple() {
    let presets = CameraMath.zoomPresets(constituents: proLenses, switchOvers: proSwitchOvers)
    XCTAssertEqual(
      presets,
      [
        ZoomPresetSpec(factor: 0.5, zoom: 1),
        ZoomPresetSpec(factor: 1, zoom: 2),
        ZoomPresetSpec(factor: 2, zoom: 4),
        ZoomPresetSpec(factor: 5, zoom: 10),
      ],
      "les pastilles doivent être 0,5× / 1× / 2× / 5× comme l'app Camera"
    )
  }

  /// Le facteur du télé se lit sur le matériel : 5× sur un 16 Pro, 3× sur un
  /// 14 Pro. Il était codé en dur à 3× et affichait faux.
  func testTelephotoFactorComesFromHardware() {
    let presets = CameraMath.zoomPresets(constituents: proLenses, switchOvers: [2, 6])
    XCTAssertEqual(presets.last, ZoomPresetSpec(factor: 3, zoom: 6))
  }

  func testDualWideHasNoTelephotoPill() {
    let presets = CameraMath.zoomPresets(
      constituents: [LensSpec(kind: .ultraWide), LensSpec(kind: .wide, secondaryCrops: [2])],
      switchOvers: [2]
    )
    XCTAssertEqual(
      presets,
      [
        ZoomPresetSpec(factor: 0.5, zoom: 1),
        ZoomPresetSpec(factor: 1, zoom: 2),
        ZoomPresetSpec(factor: 2, zoom: 4),
      ]
    )
  }

  /// Appareil à deux caméras sans ultra grand-angle : le 1× est le zoom 1.
  func testWidePlusTelephotoStartsAtOne() {
    let presets = CameraMath.zoomPresets(
      constituents: [LensSpec(kind: .wide), LensSpec(kind: .telephoto)],
      switchOvers: [2]
    )
    XCTAssertEqual(presets, [ZoomPresetSpec(factor: 1, zoom: 1), ZoomPresetSpec(factor: 2, zoom: 2)])
  }

  func testSingleCameraHasOnlyOnePill() {
    let presets = CameraMath.zoomPresets(constituents: [LensSpec(kind: .wide)], switchOvers: [])
    XCTAssertEqual(presets, [ZoomPresetSpec(factor: 1, zoom: 1)])
  }

  // MARK: - Choix de la caméra physique

  /// Le device virtuel refuse l'exposition custom : se tromper de caméra ici,
  /// c'est la pose de nuit qui part sur l'ultra grand-angle, deux fois moins
  /// sensible que le capteur principal.
  func testPhysicalPickFollowsZoom() {
    func pick(_ zoom: Double) -> PhysicalPick? {
      CameraMath.physicalPick(constituents: proLenses, switchOvers: proSwitchOvers, zoom: zoom)
    }
    XCTAssertEqual(pick(1), PhysicalPick(index: 0, zoom: 1), "0,5× : ultra grand-angle")
    XCTAssertEqual(pick(1.9), PhysicalPick(index: 0, zoom: 1.9))
    XCTAssertEqual(pick(2), PhysicalPick(index: 1, zoom: 1), "1× : capteur principal")
    XCTAssertEqual(pick(4), PhysicalPick(index: 1, zoom: 2), "2× : recadrage du principal")
    XCTAssertEqual(pick(10), PhysicalPick(index: 2, zoom: 1), "5× : télé")
    XCTAssertEqual(pick(25), PhysicalPick(index: 2, zoom: 2.5), "au-delà : télé recadré")
  }

  func testPhysicalPickNeverGoesBelowOneOnWide() {
    let pick = CameraMath.physicalPick(
      constituents: proLenses,
      switchOvers: proSwitchOvers,
      zoom: 2.0
    )
    XCTAssertEqual(pick?.zoom, 1, "un zoom sous 1 sur une caméra physique est refusé par AVFoundation")
  }

  func testPhysicalPickSurvivesGarbage() {
    XCTAssertNil(CameraMath.physicalPick(constituents: [], switchOvers: [], zoom: 2))
    let nan = CameraMath.physicalPick(
      constituents: proLenses,
      switchOvers: proSwitchOvers,
      zoom: Double.nan
    )
    XCTAssertNotNil(nan)
    XCTAssertTrue(nan!.zoom.isFinite, "aucun NaN ne doit atteindre le matériel")
  }

  // MARK: - Bornes d'exposition

  /// Cause du crash du 13 août : le format virtuel annonçait ISO 6400 alors que
  /// la caméra physique active plafonnait bien plus bas.
  func testBoundsIntersectVirtualAndPhysical() {
    let virtual = ExposureLimits(minIso: 22, maxIso: 6336, minSeconds: 1 / 16000, maxSeconds: 1)
    let physical = ExposureLimits(minIso: 34, maxIso: 3072, minSeconds: 1 / 8000, maxSeconds: 0.5)
    let result = CameraMath.intersect(virtual, physical)
    XCTAssertEqual(result.minIso, 34)
    XCTAssertEqual(result.maxIso, 3072)
    XCTAssertEqual(result.minSeconds, 1 / 8000, accuracy: 1e-9)
    XCTAssertEqual(result.maxSeconds, 0.5, accuracy: 1e-9)
  }

  func testBoundsStayCoherentWhenRangesDoNotOverlap() {
    let virtual = ExposureLimits(minIso: 22, maxIso: 100, minSeconds: 0.5, maxSeconds: 1)
    let physical = ExposureLimits(minIso: 400, maxIso: 6400, minSeconds: 1 / 100, maxSeconds: 1 / 60)
    let result = CameraMath.intersect(virtual, physical)
    XCTAssertLessThanOrEqual(result.minIso, result.maxIso)
    XCTAssertLessThanOrEqual(result.minSeconds, result.maxSeconds)
  }

  func testClampsKeepValuesInsideHardware() {
    let limits = ExposureLimits(minIso: 34, maxIso: 3072, minSeconds: 1 / 8000, maxSeconds: 1)
    XCTAssertEqual(CameraMath.clampIso(12800, in: limits), 3072)
    XCTAssertEqual(CameraMath.clampIso(10, in: limits), 34)
    XCTAssertEqual(CameraMath.clampIso(1600, in: limits), 1600)
    XCTAssertEqual(CameraMath.clampIso(Double.nan, in: limits), 34, "NaN ne doit jamais partir au capteur")
    XCTAssertEqual(CameraMath.clampSeconds(30, in: limits), 1, accuracy: 1e-9)
    XCTAssertEqual(CameraMath.clampSeconds(Double.nan, in: limits), 1 / 8000, accuracy: 1e-9)
  }

  // MARK: - Définition photo

  /// Les dimensions posées doivent exister dans le format actif : Apple lève
  /// une exception sinon. On choisit donc toujours dans la liste du matériel.
  func testPhotoSizePicksFromWhatTheHardwareOffers() {
    let sizes = [12.0, 24.0, 48.0]
    XCTAssertEqual(CameraMath.nearestPhotoSize(sizes, target: 0), 2, "0 demande la plus grande")
    XCTAssertEqual(CameraMath.nearestPhotoSize(sizes, target: 24), 1)
    XCTAssertEqual(CameraMath.nearestPhotoSize(sizes, target: 30), 1, "30 MP absent : 24 est le plus proche")
    XCTAssertEqual(CameraMath.nearestPhotoSize(sizes, target: 12), 0)
    XCTAssertEqual(CameraMath.nearestPhotoSize([12.0], target: 48), 0, "un seul choix : celui-là")
    XCTAssertNil(CameraMath.nearestPhotoSize([], target: 12))
  }

  /// Une trame de pose dure au plus 1 s, et moins si la caméra ne suit pas :
  /// dépasser lève une exception, d'où les poses qui « duraient 5 s ».
  func testPoseFrameNeverExceedsHardwareLimit() {
    XCTAssertEqual(
      CameraMath.poseFrameSeconds(in: ExposureLimits(minIso: 34, maxIso: 3072, minSeconds: 1 / 8000, maxSeconds: 1)),
      1,
      accuracy: 1e-9
    )
    XCTAssertEqual(
      CameraMath.poseFrameSeconds(in: ExposureLimits(minIso: 34, maxIso: 3072, minSeconds: 1 / 8000, maxSeconds: 0.5)),
      0.5,
      accuracy: 1e-9
    )
  }
}
