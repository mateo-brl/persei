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
  /// True dès qu'une trame RAW est empilée : le rendu final applique alors
  /// la conversion linéaire → affichage (gamma) après l'étirement.
  private var stackedLinearRaw = false
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
    guard let data = try? Data(contentsOf: url) else { return }

    var decoded: CIImage?
    if url.absoluteString.lowercased().hasSuffix(".dng") {
      // Trame RAW : décodage linéaire, sans « look » ni réduction de bruit —
      // c'est elle qui gommerait les étoiles faibles avant l'empilement.
      if let rawFilter = CIRAWFilter(imageData: data, identifierHint: nil) {
        rawFilter.boostAmount = 0
        rawFilter.luminanceNoiseReductionAmount = 0
        rawFilter.colorNoiseReductionAmount = 0
        decoded = rawFilter.outputImage
        if decoded != nil {
          stackedLinearRaw = true
        }
      }
    }
    if decoded == nil {
      decoded = CIImage(data: data, options: [.applyOrientationProperty: true])
    }
    // Pas de rendu intermédiaire : l'accumulateur (RGBAh) évalue le graphe
    // RAW en demi-flottants — un CGImage 8 bits ici perdrait le linéaire.
    guard var frame = decoded else { return }

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
    // Alpha divisé comme les couleurs (espace prémultiplié), sinon la
    // comparaison avec la trame se fait sur des échelles différentes.
    let mean = sum.applyingFilter("CIColorMatrix", parameters: [
      "inputRVector": CIVector(x: scale, y: 0, z: 0, w: 0),
      "inputGVector": CIVector(x: 0, y: scale, z: 0, w: 0),
      "inputBVector": CIVector(x: 0, y: 0, z: scale, w: 0),
      "inputAVector": CIVector(x: 0, y: 0, z: 0, w: scale),
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
      // Core Image est prémultiplié : la somme a aussi additionné l'alpha
      // (alpha = N). Il faut diviser l'alpha comme les couleurs, sinon la
      // dé-prémultiplication à l'écriture redivise les couleurs par N et
      // sort une image noire.
      let mean = accumulator.image().applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: scale, y: 0, z: 0, w: 0),
        "inputGVector": CIVector(x: 0, y: scale, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: scale, w: 0),
        "inputAVector": CIVector(x: 0, y: 0, z: 0, w: scale),
      ])
      // La moyenne réduit le bruit mais n'éclaircit pas : étirement
      // automatique de l'exposition pour les scènes sombres (nuit), neutre
      // sur les scènes déjà exposées.
      if let uri = write(image: displayRender(of: mean), suffix: "lueur", colorSpace: colorSpace) {
        uris.append(uri)
      }
    }

    if let accumulator = maxAccumulator {
      if let uri = write(image: displayRender(of: accumulator.image()), suffix: "etoiles", colorSpace: colorSpace) {
        uris.append(uri)
      }
    }

    return uris.isEmpty
      ? .failure(CameraEngineError.captureFailed("P32: stack rendering failed"))
      : .success(uris)
  }

  /// Étirement d'affichage. L'encodage gamma final est fait par write()
  /// (matchedFromWorkingSpace) : ici tout se passe en linéaire.
  private func displayRender(of image: CIImage) -> CIImage {
    autoStretch(image)
  }

  /// Mesure la luminance MOYENNE en linéaire (demi-flottants : les scènes de
  /// nuit ne se quantifient pas à zéro). La moyenne plutôt que le pic : une
  /// étoile brillante ne doit pas empêcher d'étirer un ciel sombre, et une
  /// scène normale ne doit pas être « corrigée ». Seuil 0,03 linéaire ≈ 20 %
  /// affiché ; cible 0,07 ≈ 30 % affiché ; plafond +4 EV.
  private func autoStretch(_ image: CIImage) -> CIImage {
    guard let averageImage = CIFilter(
      name: "CIAreaAverage",
      parameters: [
        kCIInputImageKey: image,
        kCIInputExtentKey: CIVector(cgRect: image.extent),
      ]
    )?.outputImage else { return image }

    var pixel = [Float16](repeating: 0, count: 4)
    pixel.withUnsafeMutableBytes { buffer in
      ciContext.render(
        averageImage,
        toBitmap: buffer.baseAddress!,
        rowBytes: 8,
        bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
        format: .RGBAh,
        colorSpace: nil
      )
    }
    let average = Double(max(pixel[0], max(pixel[1], pixel[2])))
    guard average.isFinite, average > 0.000001, average < 0.03 else { return image }

    let ev = min(4.0, log2(0.07 / average))
    guard ev > 0.2 else { return image }
    return image.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: ev])
  }

  private func write(image: CIImage, suffix: String, colorSpace: CGColorSpace) -> String? {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("persei-pose-\(suffix)-\(UUID().uuidString).heic")
    // Conversion explicite espace de travail (linéaire) → espace d'affichage :
    // sans elle, les octets partent linéaires dans le fichier et l'image
    // paraît écrasée dans les sombres.
    let encoded = image.matchedFromWorkingSpace(to: colorSpace) ?? image
    do {
      try ciContext.writeHEIFRepresentation(
        of: encoded,
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
