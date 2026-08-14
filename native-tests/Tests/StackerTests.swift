import CoreImage
import XCTest

@testable import PerseiStack

/// Tests du moteur d'empilement — chaque cas correspond à un bug réel ou à
/// une garantie que l'app vendue ne doit jamais casser.
final class StackerTests: XCTestCase {
  private let context = CIContext()

  /// Écrit une image unie en HEIC temporaire et renvoie son URL.
  private func writeFrame(gray: CGFloat, size: CGSize = CGSize(width: 64, height: 64)) throws -> URL {
    let image = CIImage(color: CIColor(red: gray, green: gray, blue: gray))
      .cropped(to: CGRect(origin: .zero, size: size))
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("test-\(UUID().uuidString).heic")
    try context.writeHEIFRepresentation(
      of: image,
      to: url,
      format: .RGBA8,
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
      options: [:]
    )
    return url
  }

  /// Image noire avec un carré lumineux, pour les tests de max et d'alignement.
  private func writeFrame(dotAt origin: CGPoint, gray: CGFloat = 1.0) throws -> URL {
    let size = CGSize(width: 128, height: 128)
    let dot = CIImage(color: CIColor(red: gray, green: gray, blue: gray))
      .cropped(to: CGRect(origin: origin, size: CGSize(width: 16, height: 16)))
    let background = CIImage(color: CIColor(red: 0, green: 0, blue: 0))
      .cropped(to: CGRect(origin: .zero, size: size))
    let image = dot.composited(over: background)
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("test-\(UUID().uuidString).heic")
    try context.writeHEIFRepresentation(
      of: image,
      to: url,
      format: .RGBA8,
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
      options: [:]
    )
    return url
  }

  private func meanGray(of url: URL, in rect: CGRect) throws -> Double {
    let image = try XCTUnwrap(CIImage(contentsOf: url))
    let averaged = image.applyingFilter("CIAreaAverage", parameters: [
      kCIInputExtentKey: CIVector(cgRect: rect),
    ])
    var pixel = [UInt8](repeating: 0, count: 4)
    context.render(
      averaged,
      toBitmap: &pixel,
      rowBytes: 4,
      bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
      format: .RGBA8,
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)
    )
    return Double(pixel[0]) / 255.0
  }

  private func firstResult(of stacker: FrameStacker) throws -> URL {
    let uris = try stacker.finalize().get()
    let uriString = try XCTUnwrap(uris.first)
    return try XCTUnwrap(URL(string: uriString))
  }

  /// Bug réel du 13 août : l'alpha sommé mais non divisé rendait la moyenne
  /// noire (÷ N²). La moyenne de N images identiques doit rester l'image.
  func testMeanOfIdenticalFramesKeepsBrightness() throws {
    let stacker = FrameStacker(mode: "mean")
    for _ in 0..<4 {
      stacker.add(url: try writeFrame(gray: 0.5))
    }
    let result = try firstResult(of: stacker)
    let gray = try meanGray(of: result, in: CGRect(x: 8, y: 8, width: 48, height: 48))
    XCTAssertGreaterThan(gray, 0.35, "moyenne écrasée : régression du bug de l'alpha")
    XCTAssertLessThan(gray, 0.75, "moyenne sur-amplifiée")
  }

  /// La fusion max doit garder la valeur la plus lumineuse par pixel.
  func testMaxBlendKeepsBrightest() throws {
    let stacker = FrameStacker(mode: "max")
    stacker.add(url: try writeFrame(gray: 0.15))
    stacker.add(url: try writeFrame(gray: 0.6))
    stacker.add(url: try writeFrame(gray: 0.3))
    let result = try firstResult(of: stacker)
    let gray = try meanGray(of: result, in: CGRect(x: 8, y: 8, width: 48, height: 48))
    XCTAssertGreaterThan(gray, 0.5, "le max doit retenir la trame la plus claire")
  }

  /// Une pile sombre doit ressortir éclaircie (étirement automatique) :
  /// c'était le « tout noir » des photos de ciel.
  func testAutoStretchLiftsDarkStack() throws {
    let stacker = FrameStacker(mode: "mean")
    for _ in 0..<4 {
      stacker.add(url: try writeFrame(gray: 0.04))
    }
    let result = try firstResult(of: stacker)
    let gray = try meanGray(of: result, in: CGRect(x: 8, y: 8, width: 48, height: 48))
    XCTAssertGreaterThan(gray, 0.12, "l'étirement doit révéler une scène sombre")
  }

  /// L'alignement doit ramener un point décalé sur la référence : le max
  /// aligné concentre la lumière au lieu de l'étaler en deux points.
  func testAlignmentRecentersShiftedFrame() throws {
    let aligned = FrameStacker(mode: "max", align: true)
    aligned.add(url: try writeFrame(dotAt: CGPoint(x: 40, y: 40)))
    aligned.add(url: try writeFrame(dotAt: CGPoint(x: 52, y: 40)))
    let alignedResult = try firstResult(of: aligned)
    let atReference = try meanGray(
      of: alignedResult,
      in: CGRect(x: 44, y: 42, width: 8, height: 8)
    )
    let atShifted = try meanGray(
      of: alignedResult,
      in: CGRect(x: 56, y: 42, width: 8, height: 8)
    )
    XCTAssertGreaterThan(atReference, 0.5, "le point aligné doit rester sur la référence")
    XCTAssertLessThan(atShifted, atReference, "le point décalé ne doit pas laisser de doublon dominant")
  }

  /// Aucune trame empilée = erreur propre (code P31), jamais un succès vide.
  func testEmptyStackFailsCleanly() {
    let stacker = FrameStacker(mode: "mean")
    switch stacker.finalize() {
    case .success:
      XCTFail("une pile vide ne doit pas produire de résultat")
    case .failure:
      break
    }
  }
}
