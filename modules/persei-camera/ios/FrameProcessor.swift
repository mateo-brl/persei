import AVFoundation
import CoreImage
import Foundation

/// Traite le flux vidéo de préview pour les aides de visée : histogramme,
/// focus peaking, zebras et loupe de mise au point. Une frame sur trois,
/// traitement en résolution réduite pour rester léger.
final class FrameProcessor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  var peakingEnabled = false
  var zebrasEnabled = false
  var histogramEnabled = false
  var loupeEnabled = false

  /// 64 intensités 0-255, ~5 Hz.
  var onHistogram: (([Double]) -> Void)?
  /// Calque d'aides (peaking vert + zebras rouges), nil quand inactif.
  var onOverlayImage: ((CGImage?) -> Void)?
  /// Recadrage central agrandi pour la mise au point, nil quand inactif.
  var onLoupeImage: ((CGImage?) -> Void)?

  private let ciContext = CIContext(options: [.cacheIntermediates: false])
  private var frameIndex = 0
  private var lastHistogram = Date.distantPast
  private var overlayWasActive = false
  private var loupeWasActive = false

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    frameIndex += 1
    guard frameIndex % 3 == 0 else { return }

    let overlayActive = peakingEnabled || zebrasEnabled
    if !overlayActive, overlayWasActive {
      overlayWasActive = false
      onOverlayImage?(nil)
    }
    if !loupeEnabled, loupeWasActive {
      loupeWasActive = false
      onLoupeImage?(nil)
    }
    guard overlayActive || histogramEnabled || loupeEnabled,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
    else { return }

    let fullImage = CIImage(cvPixelBuffer: pixelBuffer)
    let scale = 480.0 / max(fullImage.extent.height, 1)
    let smallImage = fullImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

    if histogramEnabled, Date().timeIntervalSince(lastHistogram) > 0.2 {
      lastHistogram = Date()
      emitHistogram(of: smallImage)
    }

    if overlayActive {
      overlayWasActive = true
      emitOverlay(of: smallImage)
    }

    if loupeEnabled {
      loupeWasActive = true
      emitLoupe(of: fullImage)
    }
  }

  private func emitHistogram(of image: CIImage) {
    guard let output = CIFilter(
      name: "CIAreaHistogram",
      parameters: [
        kCIInputImageKey: image,
        kCIInputExtentKey: CIVector(cgRect: image.extent),
        "inputCount": 64,
        "inputScale": 32.0,
      ]
    )?.outputImage else { return }

    var bitmap = [UInt8](repeating: 0, count: 64 * 4)
    ciContext.render(
      output,
      toBitmap: &bitmap,
      rowBytes: 64 * 4,
      bounds: CGRect(x: 0, y: 0, width: 64, height: 1),
      format: .RGBA8,
      colorSpace: nil
    )
    var bins = [Double](repeating: 0, count: 64)
    for i in 0..<64 {
      bins[i] = (Double(bitmap[i * 4]) + Double(bitmap[i * 4 + 1]) + Double(bitmap[i * 4 + 2])) / 3.0
    }
    onHistogram?(bins)
  }

  private func emitOverlay(of image: CIImage) {
    var layers: [CIImage] = []

    if peakingEnabled {
      // Contours nets → vert translucide.
      let edges = image.applyingFilter("CIEdges", parameters: [kCIInputIntensityKey: 4.0])
      let green = edges.applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: 0, y: 0, z: 0, w: 0),
        "inputGVector": CIVector(x: 0.4, y: 0.4, z: 0.4, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0),
        "inputAVector": CIVector(x: 0.4, y: 0.4, z: 0.4, w: 0),
      ])
      layers.append(green)
    }

    if zebrasEnabled {
      // Hautes lumières (> ~98 %) → rouge translucide.
      let clipped = image.applyingFilter("CIColorThreshold", parameters: ["inputThreshold": 0.97])
      let red = clipped.applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: 0.34, y: 0.33, z: 0.33, w: 0),
        "inputGVector": CIVector(x: 0, y: 0, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: 0, w: 0),
        "inputAVector": CIVector(x: 0.2, y: 0.2, z: 0.2, w: 0),
      ])
      layers.append(red)
    }

    guard var composite = layers.first else {
      onOverlayImage?(nil)
      return
    }
    if layers.count > 1 {
      composite = layers[1].applyingFilter(
        "CISourceOverCompositing",
        parameters: [kCIInputBackgroundImageKey: composite]
      )
    }
    onOverlayImage?(ciContext.createCGImage(composite, from: composite.extent))
  }

  private func emitLoupe(of image: CIImage) {
    // Recadrage central (1/8 de la largeur) = grossissement ~8x à l'écran.
    let extent = image.extent
    let cropSize = extent.width / 8
    let crop = CGRect(
      x: extent.midX - cropSize / 2,
      y: extent.midY - cropSize / 2,
      width: cropSize,
      height: cropSize
    )
    let cropped = image.cropped(to: crop)
    onLoupeImage?(ciContext.createCGImage(cropped, from: cropped.extent))
  }
}
