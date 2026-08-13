import CoreImage
import Foundation
import Vision

/// Empile des trames en moyenne (« lueur » : nuit propre, bruit divisé par √N)
/// et/ou en fusion max (« étoiles » : conserve traînées de météores et filés),
/// via des CIImageAccumulator en demi-flottants pour garder la précision.
/// Options : alignement translationnel (pose à main levée, Vision) et filtre
/// météores (seules les trames contenant un transitoire nourrissent le max).
final class FrameStacker {
  private let wantsMean: Bool
  private let wantsMax: Bool
  private let alignEnabled: Bool
  private let meteorFilterEnabled: Bool

  private var sumAccumulator: CIImageAccumulator?
  private var maxAccumulator: CIImageAccumulator?
  // Compteurs par accumulateur : si une allocation échoue au début puis
  // réussit plus tard, la moyenne doit diviser par les trames réellement
  // sommées, pas par le total capturé.
  private var sumFrameCount = 0
  private var maxFrameCount = 0
  private var referenceFrame: CIImage?
  private let ciContext = CIContext()

  init(mode: String, align: Bool = false, meteorFilter: Bool = false) {
    wantsMean = mode == "mean" || mode == "both"
    wantsMax = mode == "max" || mode == "both"
    alignEnabled = align
    // Le filtre météores exige la moyenne courante comme référence : il
    // n'a de sens que pour le max.
    meteorFilterEnabled = meteorFilter
  }

  func add(url: URL) {
    // Charge la trame en mémoire : le fichier temporaire est supprimé par
    // l'appelant juste après, et un CIImage(contentsOf:) paresseux pointerait
    // vers un fichier disparu (crash au rendu, notamment via la référence
    // d'alignement conservée entre les trames).
    guard let data = try? Data(contentsOf: url), var frame = CIImage(data: data) else { return }

    if alignEnabled {
      if let reference = referenceFrame {
        if let transform = translation(aligning: frame, to: reference) {
          frame = frame.transformed(by: transform)
        }
      } else {
        referenceFrame = frame
      }
    }

    var includeInMax = true
    if meteorFilterEnabled, wantsMax, let accumulator = sumAccumulator, sumFrameCount >= 3 {
      includeInMax = containsTransient(frame: frame, sum: accumulator.image(), count: sumFrameCount)
    }

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

    if wantsMax, includeInMax {
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

  /// Translation qui aligne `frame` sur `reference`, estimée en résolution
  /// réduite (×0,25) puis remise à l'échelle. Rotation non corrigée (v1).
  private func translation(aligning frame: CIImage, to reference: CIImage) -> CGAffineTransform? {
    let downscale = CGAffineTransform(scaleX: 0.25, y: 0.25)
    let smallFrame = frame.transformed(by: downscale)
    let smallReference = reference.transformed(by: downscale)

    let request = VNTranslationalImageRegistrationRequest(targetedCIImage: smallFrame)
    let handler = VNImageRequestHandler(ciImage: smallReference)
    try? handler.perform([request])
    guard let observation = request.results?.first else { return nil }
    let transform = observation.alignmentTransform
    return CGAffineTransform(translationX: transform.tx * 4, y: transform.ty * 4)
  }

  /// Détecte un transitoire lumineux (météore, avion, satellite) : écart max
  /// entre la trame et la moyenne courante au-dessus d'un seuil.
  private func containsTransient(frame: CIImage, sum: CIImage, count: Int) -> Bool {
    let scale = CGFloat(1) / CGFloat(count)
    let mean = sum.applyingFilter("CIColorMatrix", parameters: [
      "inputRVector": CIVector(x: scale, y: 0, z: 0, w: 0),
      "inputGVector": CIVector(x: 0, y: scale, z: 0, w: 0),
      "inputBVector": CIVector(x: 0, y: 0, z: scale, w: 0),
      "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
    ])
    let difference = frame.applyingFilter(
      "CIDifferenceBlendMode",
      parameters: [kCIInputBackgroundImageKey: mean]
    )
    guard let peak = CIFilter(
      name: "CIAreaMaximum",
      parameters: [
        kCIInputImageKey: difference,
        kCIInputExtentKey: CIVector(cgRect: difference.extent),
      ]
    )?.outputImage else { return true }

    var pixel = [UInt8](repeating: 0, count: 4)
    ciContext.render(
      peak,
      toBitmap: &pixel,
      rowBytes: 4,
      bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
      format: .RGBA8,
      colorSpace: nil
    )
    let maxChannel = max(pixel[0], pixel[1], pixel[2])
    return maxChannel > 56 // ~22 % d'écart : un vrai transitoire, pas du bruit
  }

  func finalize() -> Result<[String], Error> {
    guard sumFrameCount > 0 || maxFrameCount > 0 else {
      return .failure(CameraEngineError.captureFailed("P31: no frames were stacked (captures all failed)"))
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
      ? .failure(CameraEngineError.captureFailed("P32: stack rendering failed"))
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
