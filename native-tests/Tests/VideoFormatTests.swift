import XCTest

@testable import PerseiStack

/// Le choix du format vidéo décide de tout : résolution, cadence, HDR, Log,
/// ProRes. Se tromper ici donne un écran noir (le piège du 4K120) ou une
/// option affichée que le matériel ne sait pas faire.
final class VideoFormatTests: XCTestCase {
  /// Table calquée sur un iPhone 16 Pro : 1080p et 4K en 8 et 10 bits, un
  /// format haute cadence, deux sources ProRes, une variante regroupée.
  private let proFormats: [VideoFormatSpec] = [
    VideoFormatSpec(
      width: 1920, height: 1080,
      frameRateRanges: [FrameRateRange(min: 1, max: 60)],
      maxPhotoWidth: 1920
    ),
    VideoFormatSpec(
      width: 1920, height: 1080,
      frameRateRanges: [FrameRateRange(min: 1, max: 60)],
      isTenBit: true, supportsHlg: true, maxPhotoWidth: 1920
    ),
    VideoFormatSpec(
      width: 1920, height: 1080,
      frameRateRanges: [FrameRateRange(min: 1, max: 240)],
      isBinned: true, maxPhotoWidth: 1920
    ),
    VideoFormatSpec(
      width: 3840, height: 2160,
      frameRateRanges: [FrameRateRange(min: 1, max: 60)],
      maxPhotoWidth: 8064
    ),
    VideoFormatSpec(
      width: 3840, height: 2160,
      frameRateRanges: [FrameRateRange(min: 1, max: 60)],
      isTenBit: true, supportsHlg: true, maxPhotoWidth: 8064
    ),
    VideoFormatSpec(
      width: 3840, height: 2160,
      frameRateRanges: [FrameRateRange(min: 120, max: 120)],
      isTenBit: true, supportsHlg: true, maxPhotoWidth: 3840
    ),
    VideoFormatSpec(
      width: 3840, height: 2160,
      frameRateRanges: [FrameRateRange(min: 1, max: 60)],
      isTenBit: true, isProResSource: true, supportsAppleLog: true, supportsHlg: true,
      maxPhotoWidth: 3840
    ),
    VideoFormatSpec(
      width: 1920, height: 1080,
      frameRateRanges: [FrameRateRange(min: 1, max: 60)],
      isTenBit: true, isProResSource: true, supportsAppleLog: true, supportsHlg: true,
      maxPhotoWidth: 1920
    ),
  ]

  private func pick(_ request: VideoRequest) -> VideoFormatSpec? {
    CameraMath.pickVideoFormat(proFormats, request: request).map { proFormats[$0] }
  }

  func test4KSdrTakesTheStandardFormat() {
    let format = pick(VideoRequest(height: 2160, frameRate: 30, range: .sdr, wantsProRes: false))
    XCTAssertEqual(format?.height, 2160)
    XCTAssertEqual(format?.isTenBit, false, "une demande SDR ne doit pas partir sur du HDR permanent")
    XCTAssertEqual(format?.isProResSource, false)
  }

  func test4KHdrTakesATenBitFormat() {
    let format = pick(VideoRequest(height: 2160, frameRate: 30, range: .hdr, wantsProRes: false))
    XCTAssertEqual(format?.isTenBit, true)
    XCTAssertEqual(format?.supportsHlg, true, "le HDR de l iPhone passe par HLG BT.2020")
  }

  /// Le format 4K120 existe et doit être trouvé : c'est l'argument matériel du
  /// 16 Pro. L'écran noir vient d'un preset de session, pas de son absence.
  func test4K120IsFound() {
    let format = pick(VideoRequest(height: 2160, frameRate: 120, range: .hdr, wantsProRes: false))
    XCTAssertNotNil(format)
    XCTAssertEqual(format?.maxFrameRate, 120)
  }

  /// Filmer à 30 sur un format 240 images/s dégrade l'image pour rien.
  func testLowFrameRateAvoidsHighSpeedFormats() {
    let format = pick(VideoRequest(height: 1080, frameRate: 30, range: .sdr, wantsProRes: false))
    XCTAssertEqual(format?.maxFrameRate, 60)
    XCTAssertEqual(format?.isBinned, false)
  }

  func testSlowMotionUsesTheHighSpeedFormat() {
    let format = pick(VideoRequest(height: 1080, frameRate: 240, range: .sdr, wantsProRes: false))
    XCTAssertEqual(format?.maxFrameRate, 240)
  }

  /// ProRes exige une source 4:2:2 10 bits, sinon les codecs n'apparaissent
  /// même pas dans `availableVideoCodecTypes`.
  func testProResNeedsA422Source() {
    let format = pick(VideoRequest(height: 2160, frameRate: 30, range: .log, wantsProRes: true))
    XCTAssertEqual(format?.isProResSource, true)
    XCTAssertEqual(format?.supportsAppleLog, true)
  }

  func testProResFormatsAreNotUsedForOrdinaryRecording() {
    let format = pick(VideoRequest(height: 2160, frameRate: 30, range: .sdr, wantsProRes: false))
    XCTAssertEqual(format?.isProResSource, false)
  }

  func testImpossibleRequestsReturnNothing() {
    XCTAssertNil(pick(VideoRequest(height: 4320, frameRate: 30, range: .sdr, wantsProRes: false)))
    XCTAssertNil(pick(VideoRequest(height: 2160, frameRate: 240, range: .sdr, wantsProRes: false)))
    XCTAssertNil(pick(VideoRequest(height: 1080, frameRate: 120, range: .log, wantsProRes: true)))
    XCTAssertNil(CameraMath.pickVideoFormat([], request: VideoRequest(height: 1080, frameRate: 30, range: .sdr, wantsProRes: false)))
  }

  /// L'interface ne doit proposer que ce que le matériel sait faire.
  func testOfferedChoicesMatchTheHardware() {
    XCTAssertEqual(CameraMath.availableHeights(proFormats), [2160, 1080])
    XCTAssertEqual(CameraMath.availableFrameRates(proFormats, height: 2160), [24, 25, 30, 60, 120])
    XCTAssertEqual(CameraMath.availableFrameRates(proFormats, height: 1080), [24, 25, 30, 60, 120, 240])
    XCTAssertEqual(CameraMath.availableFrameRates(proFormats, height: 720), [])
  }

  func testProResDemandsRealHeadroom() {
    XCTAssertGreaterThan(CameraMath.requiredFreeBytes(forProRes: true), 5_000_000_000)
    XCTAssertLessThan(CameraMath.requiredFreeBytes(forProRes: false), 1_000_000_000)
  }
}
