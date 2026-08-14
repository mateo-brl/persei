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

  // MARK: - Définitions photo acceptables

  /// Définitions du 16 Pro en format photo, et celles d'un format vidéo 4K.
  private let photoSizes = [
    PhotoSize(width: 4032, height: 3024),
    PhotoSize(width: 8064, height: 6048),
  ]
  private let quatreK = PhotoSize(width: 3840, height: 2160)

  /// Le plantage du build 31, en une ligne : le plafond de la sortie datait du
  /// format vidéo, il n'appartient pas au format photo redevenu actif, et le
  /// déclenchement levait une exception. Refuser cette taille est donc la
  /// bonne réponse, et il doit rester une taille utilisable à proposer.
  func testStaleVideoSizeIsRefusedAfterReturningToPhoto() {
    XCTAssertFalse(
      CameraMath.isPhotoSizeAllowed(quatreK, available: photoSizes, cap: quatreK),
      "une définition absente du format actif ne doit jamais être demandée"
    )
    XCTAssertTrue(
      CameraMath.isPhotoCapStale(quatreK, available: photoSizes),
      "un plafond hérité de la vidéo doit être reconnu comme périmé"
    )
    // Un plafond périmé ne laisse aucune taille demandable : 4032 et 8064 le
    // dépassent tous les deux. Renoncer ici serait perdre la pleine
    // définition, d'où le recalcul côté moteur avant de demander quoi que ce
    // soit — ce test fixe la raison d'être de ce recalcul.
    XCTAssertNil(
      CameraMath.usablePhotoSize(available: photoSizes, cap: quatreK),
      "tant que le plafond n'est pas recalculé, rien n'est demandable"
    )
    XCTAssertFalse(
      CameraMath.isPhotoCapStale(PhotoSize(width: 4032, height: 3024), available: photoSizes),
      "un plafond recalculé sur le format photo est valide"
    )
  }

  /// Les deux conditions comptent : appartenir au format actif ne suffit pas
  /// si la sortie plafonne plus bas.
  func testCapAndActiveFormatBothApply() {
    let plafond = PhotoSize(width: 4032, height: 3024)
    XCTAssertTrue(CameraMath.isPhotoSizeAllowed(plafond, available: photoSizes, cap: plafond))
    XCTAssertFalse(
      CameraMath.isPhotoSizeAllowed(PhotoSize(width: 8064, height: 6048), available: photoSizes, cap: plafond),
      "48 MP dépasse le plafond de 12 MP posé sur la sortie"
    )
    XCTAssertEqual(
      CameraMath.usablePhotoSize(available: photoSizes, cap: plafond),
      plafond,
      "un plafond valide est repris tel quel"
    )
  }

  /// La pose longue empile en mémoire : elle prend la plus petite, jamais la
  /// première venue (l'ordre de la liste matérielle n'est pas garanti).
  func testPoseTakesTheSmallestNotTheFirst() {
    let desordre = [
      PhotoSize(width: 8064, height: 6048),
      PhotoSize(width: 4032, height: 3024),
    ]
    XCTAssertEqual(
      CameraMath.smallestPhotoSize(available: desordre, cap: nil),
      PhotoSize(width: 4032, height: 3024)
    )
  }

  /// Aucune définition acceptable : ne rien demander, ce qu'AVFoundation
  /// accepte toujours. Poser une valeur inventée serait le plantage.
  func testNoUsableSizeMeansAskForNothing() {
    XCTAssertNil(CameraMath.usablePhotoSize(available: [], cap: quatreK))
    XCTAssertNil(CameraMath.smallestPhotoSize(available: [], cap: nil))
    XCTAssertNil(
      CameraMath.usablePhotoSize(available: photoSizes, cap: PhotoSize(width: 640, height: 480)),
      "plafond plus bas que tout ce que le format offre"
    )
  }

  // MARK: - RAW et zoom

  /// Le plantage du 14 août à 22 h 48, mot pour mot : « When specifying Bayer
  /// raw capture, the videoZoomFactor of the video device must be set to 1.0 ».
  /// Une pose lancée au 2× demandait quand même du Bayer.
  func testBayerRawIsNeverRequestedAwayFromZoomOne() {
    XCTAssertEqual(
      CameraMath.rawKind(wantsRaw: true, hasBayer: true, hasProRaw: false, zoom: 2, compact: true),
      .processed,
      "au 2× sans ProRAW, l'empilement se fait en développé plutôt qu'en plantant"
    )
    XCTAssertEqual(
      CameraMath.rawKind(wantsRaw: true, hasBayer: true, hasProRaw: true, zoom: 2, compact: false),
      .proRaw,
      "hors empilement, le ProRAW prend le relais : lui accepte tous les zooms"
    )
    XCTAssertEqual(
      CameraMath.rawKind(wantsRaw: true, hasBayer: true, hasProRaw: true, zoom: 1, compact: true),
      .bayer,
      "au zoom neutre, le Bayer reste le bon choix pour empiler"
    )
    XCTAssertEqual(
      CameraMath.rawKind(wantsRaw: true, hasBayer: true, hasProRaw: true, zoom: 2, compact: true),
      .processed,
      "empiler du ProRAW ne tient pas en mémoire : développé"
    )
    XCTAssertEqual(
      CameraMath.rawKind(wantsRaw: false, hasBayer: true, hasProRaw: true, zoom: 1, compact: false),
      .processed,
      "sans demande de RAW, on n'en fait pas"
    )
  }

  /// Le zoom vient d'un pincement : il ne vaut jamais exactement 1,0.
  func testZoomComparisonToleratesPinchImprecision() {
    XCTAssertEqual(
      CameraMath.rawKind(wantsRaw: true, hasBayer: true, hasProRaw: false, zoom: 1.0000004, compact: true),
      .bayer
    )
    XCTAssertEqual(
      CameraMath.rawKind(wantsRaw: true, hasBayer: true, hasProRaw: false, zoom: 1.05, compact: true),
      .processed,
      "5 % de zoom suffisent à faire lever AVFoundation"
    )
  }

  // MARK: - Exposition d'une pose en automatique

  /// Ce que voyait Mateo : pose de 30 s en automatique, capteur bloqué à
  /// 1/15 s et ISO 12096, donc image noire et bruitée. En allongeant à 1 s, la
  /// même lumière se rattrape quinze fois, et l'ISO redescend d'autant.
  func testAutoPoseTradesIsoForExposureTime() {
    let bornes = ExposureLimits(minIso: 34, maxIso: 12096, minSeconds: 1 / 8000, maxSeconds: 1)
    let iso = CameraMath.equivalentIso(
      currentIso: 12096,
      currentSeconds: 1.0 / 15.0,
      targetSeconds: CameraMath.poseFrameSeconds(in: bornes),
      in: bornes
    )
    XCTAssertEqual(iso, 806.4, accuracy: 0.1, "12096 ISO en 1/15 s valent 806 ISO en 1 s")
  }

  /// La contrepartie : en plein jour, allonger à 1 s ne rendrait que du blanc.
  /// La durée s'arrête là où l'ISO minimal est atteint.
  func testDaylightPoseKeepsShortFrames() {
    let bornes = ExposureLimits(minIso: 34, maxIso: 12096, minSeconds: 1 / 8000, maxSeconds: 1)
    // Plein jour : ISO 34 au 1/2000 s. Aucune marge, la durée ne bouge pas.
    XCTAssertEqual(
      CameraMath.poseFrameSeconds(currentIso: 34, currentSeconds: 1 / 2000, in: bornes),
      1.0 / 2000,
      accuracy: 1e-9
    )
    // Intérieur : ISO 400 au 1/60 s. On peut allonger d'un facteur 400/34.
    XCTAssertEqual(
      CameraMath.poseFrameSeconds(currentIso: 400, currentSeconds: 1 / 60, in: bornes),
      400.0 / 34 / 60,
      accuracy: 1e-6
    )
    // Nuit noire : la limite ne joue plus, on prend la seconde entière.
    XCTAssertEqual(
      CameraMath.poseFrameSeconds(currentIso: 12096, currentSeconds: 1 / 15, in: bornes),
      1.0,
      accuracy: 1e-9
    )
  }

  /// L'ISO calculé reste dans les bornes du matériel : hors bornes,
  /// `setExposureModeCustom` lève une exception.
  func testEquivalentIsoStaysWithinHardwareBounds() {
    let bornes = ExposureLimits(minIso: 34, maxIso: 3072, minSeconds: 1 / 8000, maxSeconds: 0.5)
    XCTAssertEqual(
      CameraMath.equivalentIso(currentIso: 100, currentSeconds: 1 / 4000, targetSeconds: 0.5, in: bornes),
      34,
      accuracy: 1e-6,
      "une scène très claire tomberait sous l'ISO minimal"
    )
    XCTAssertEqual(
      CameraMath.equivalentIso(currentIso: 12096, currentSeconds: 1, targetSeconds: 0.5, in: bornes),
      3072,
      accuracy: 1e-6,
      "et une scène très sombre dépasserait l'ISO maximal"
    )
    XCTAssertEqual(
      CameraMath.equivalentIso(currentIso: .nan, currentSeconds: 0, targetSeconds: 1, in: bornes),
      3072,
      accuracy: 1e-6,
      "lecture capteur indisponible : on prend le maximum plutôt que rien"
    )
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
