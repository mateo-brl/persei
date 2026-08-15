import XCTest

@testable import PerseiStack

/// Une pose sortait sans date, sans objectif et sans exposition : illisible dès
/// qu'elle quittait l'app. Ces cas fixent ce que le fichier doit annoncer.
final class PoseMetadataTests: XCTestCase {
  /// Aucun champ EXIF ne sait dire « somme de N trames » : un logiciel de
  /// retouche ne lira que la durée d'une trame et croira à une pose d'une
  /// seconde. La durée cumulée doit donc apparaître en toutes lettres.
  func testSummaryCarriesTheTotalIntegrationTime() {
    let texte = CameraMath.poseSummary(frames: 152, secondsPerFrame: 1, mode: "mean")
    XCTAssertTrue(texte.contains("152 trames"), texte)
    XCTAssertTrue(texte.contains("2 min 32 s cumulées"), texte)
    XCTAssertTrue(texte.contains("moyenne"), texte)
  }

  func testSummaryNamesTheStackingMode() {
    XCTAssertTrue(
      CameraMath.poseSummary(frames: 10, secondsPerFrame: 1, mode: "max").contains("traînées"),
      "le mode max conserve les traînées : c'est l'intention de la prise"
    )
    XCTAssertTrue(
      CameraMath.poseSummary(frames: 10, secondsPerFrame: 1, mode: "both").contains("moyenne et fusion max")
    )
  }

  /// Une pose interrompue avant la première trame ne doit pas écrire de
  /// durée inventée.
  func testSummaryStaysHonestWithoutFrames() {
    let texte = CameraMath.poseSummary(frames: 0, secondsPerFrame: 1, mode: "mean")
    XCTAssertFalse(texte.contains("cumulées"), texte)
    XCTAssertTrue(texte.contains("Persei"), texte)
    XCTAssertFalse(
      CameraMath.poseSummary(frames: 10, secondsPerFrame: .nan, mode: "mean").contains("cumulées")
    )
  }

  func testShortDurationsReadLikeACamera() {
    XCTAssertEqual(CameraMath.dureeCourte(1.0 / 15), "1/15 s")
    XCTAssertEqual(CameraMath.dureeCourte(1), "1,0 s")
    XCTAssertEqual(CameraMath.dureeCourte(90), "1 min 30 s")
    XCTAssertEqual(CameraMath.dureeCourte(120), "2 min")
    XCTAssertEqual(CameraMath.dureeCourte(0), "—")
    XCTAssertEqual(CameraMath.dureeCourte(.infinity), "—")
  }

  /// L'horodatage EXIF a un format imposé, et il ne doit pas suivre la langue
  /// du téléphone : un fichier écrit en arabe ou en thaï serait illisible.
  func testExifTimestampIsLocaleIndependent() {
    var composants = DateComponents()
    composants.year = 2026
    composants.month = 8
    composants.day = 15
    composants.hour = 22
    composants.minute = 4
    composants.second = 7
    var calendrier = Calendar(identifier: .gregorian)
    calendrier.timeZone = TimeZone(identifier: "UTC")!
    let date = calendrier.date(from: composants)!

    let formate = FrameStacker.horodatageExif(date)
    // Le fuseau local décale l'heure, mais la forme doit rester exacte.
    XCTAssertEqual(formate.count, 19, formate)
    XCTAssertTrue(formate.hasPrefix("2026:08:1"), formate)
    XCTAssertEqual(formate.filter { $0 == ":" }.count, 4, "yyyy:MM:dd HH:mm:ss")
  }
}
