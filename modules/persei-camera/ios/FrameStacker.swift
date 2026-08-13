import CoreImage
import Foundation

/// Empile des trames en moyenne (« lueur » : nuit propre, bruit divisé par √N)
/// et/ou en fusion max (« étoiles » : conserve traînées de météores et filés),
/// via des CIImageAccumulator en demi-flottants pour garder la précision.
final class FrameStacker {
  private let wantsMean: Bool
  private let wantsMax: Bool
  private var sumAccumulator: CIImageAccumulator?
  private var maxAccumulator: CIImageAccumulator?
  // Compteurs par accumulateur : si une allocation échoue au début puis
  // réussit plus tard, la moyenne doit diviser par les trames réellement
  // sommées, pas par le total capturé.
  private var sumFrameCount = 0
  private var maxFrameCount = 0
  private let ciContext = CIContext()

  init(mode: String) {
    wantsMean = mode == "mean" || mode == "both"
    wantsMax = mode == "max" || mode == "both"
  }

  func add(url: URL) {
    guard let frame = CIImage(contentsOf: url) else { return }

    if wantsMean {
      if let accumulator = sumAccumulator {
        let summed = frame.applyingFilter(
          "CIAdditionCompositing",
          parameters: [kCIInputBackgroundImageKey: accumulator.image()]
        )
        accumulator.setImage(summed)
        sumFrameCount += 1
      } else if let accumulator = CIImageAccumulator(extent: frame.extent, format: .RGBAh) {
        accumulator.setImage(frame)
        sumAccumulator = accumulator
        sumFrameCount = 1
      }
    }

    if wantsMax {
      if let accumulator = maxAccumulator {
        let maxed = frame.applyingFilter(
          "CILightenBlendMode",
          parameters: [kCIInputBackgroundImageKey: accumulator.image()]
        )
        accumulator.setImage(maxed)
        maxFrameCount += 1
      } else if let accumulator = CIImageAccumulator(extent: frame.extent, format: .RGBAh) {
        accumulator.setImage(frame)
        maxAccumulator = accumulator
        maxFrameCount = 1
      }
    }
  }

  func finalize() -> Result<[String], Error> {
    guard sumFrameCount > 0 || maxFrameCount > 0 else {
      return .failure(CameraEngineError.captureFailed("no frames stacked"))
    }

    var uris: [String] = []
    let colorSpace = CGColorSpace(name: CGColorSpace.displayP3) ?? CGColorSpaceCreateDeviceRGB()

    if let accumulator = sumAccumulator, sumFrameCount > 0 {
      let scale = CGFloat(1) / CGFloat(sumFrameCount)
      let mean = accumulator.image().applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: scale, y: 0, z: 0, w: 0),
        "inputGVector": CIVector(x: 0, y: scale, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: scale, w: 0),
        "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
      ])
      if let uri = write(image: mean, suffix: "lueur", colorSpace: colorSpace) {
        uris.append(uri)
      }
    }

    if let accumulator = maxAccumulator {
      if let uri = write(image: accumulator.image(), suffix: "etoiles", colorSpace: colorSpace) {
        uris.append(uri)
      }
    }

    return uris.isEmpty
      ? .failure(CameraEngineError.captureFailed("stack rendering failed"))
      : .success(uris)
  }

  private func write(image: CIImage, suffix: String, colorSpace: CGColorSpace) -> String? {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("persei-pose-\(suffix)-\(UUID().uuidString).heic")
    do {
      try ciContext.writeHEIFRepresentation(
        of: image,
        to: url,
        format: .RGBA8,
        colorSpace: colorSpace,
        options: [:]
      )
      return url.absoluteString
    } catch {
      return nil
    }
  }
}
