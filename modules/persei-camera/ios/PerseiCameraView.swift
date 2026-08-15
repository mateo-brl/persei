import AVFoundation
import AVKit
import ExpoModulesCore
import UIKit

/// Live preview of the shared camera session, with tap-to-focus, assist
/// overlays (peaking/zebras), a focus loupe and hardware shutter events.
class PerseiCameraView: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer(session: CameraEngine.shared.session)
  private let assistLayer = CALayer()
  private let loupeLayer = CALayer()
  /// Carré de visée du verrouillage AE/AF.
  private let viseurLayer = CALayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    assistLayer.contentsGravity = .resizeAspectFill
    layer.addSublayer(assistLayer)

    loupeLayer.contentsGravity = .resizeAspectFill
    loupeLayer.cornerRadius = 12
    loupeLayer.masksToBounds = true
    loupeLayer.borderWidth = 1
    loupeLayer.borderColor = UIColor(white: 1, alpha: 0.35).cgColor
    loupeLayer.isHidden = true
    layer.addSublayer(loupeLayer)

    viseurLayer.isHidden = true
    viseurLayer.borderColor = UIColor.systemYellow.cgColor
    viseurLayer.borderWidth = 1.5
    viseurLayer.cornerRadius = 4
    viseurLayer.bounds = CGRect(x: 0, y: 0, width: 84, height: 84)
    layer.addSublayer(viseurLayer)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    addGestureRecognizer(tap)

    // Appui long : verrouille exposition et mise au point sur le point visé.
    let appuiLong = UILongPressGestureRecognizer(
      target: self,
      action: #selector(handleLongPress(_:))
    )
    appuiLong.minimumPressDuration = 0.45
    addGestureRecognizer(appuiLong)

    // Boutons volume + Camera Control comme déclencheur.
    if #available(iOS 17.2, *) {
      let interaction = AVCaptureEventInteraction { event in
        if event.phase == .began {
          CameraEngine.shared.onCaptureButton?()
        }
      }
      addInteraction(interaction)
    }

    CameraEngine.shared.assistView = self
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
    assistLayer.frame = bounds
    loupeLayer.frame = CGRect(x: bounds.midX - 70, y: 90, width: 140, height: 140)
  }

  func setAssistOverlay(_ image: CGImage?) {
    assistLayer.contents = image
  }

  func setLoupe(_ image: CGImage?) {
    loupeLayer.isHidden = image == nil
    loupeLayer.contents = image
  }

  @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
    let layerPoint = recognizer.location(in: self)
    let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
    // Un appui simple relâche le verrou : le carré disparaît avec lui.
    viseurLayer.isHidden = true
    CameraEngine.shared.setPointOfInterest(devicePoint)
  }

  /// Appui long : verrouille l'exposition et la mise au point sur le point
  /// visé, et le montre. Sans repère à l'écran, un verrou invisible est pire
  /// que pas de verrou du tout — on ne sait plus pourquoi l'image ne réagit
  /// plus.
  @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
    guard recognizer.state == .began else { return }
    let layerPoint = recognizer.location(in: self)

    if CameraEngine.shared.aeAfLocked {
      viseurLayer.isHidden = true
      CameraEngine.shared.setAeAfLock(false, at: CGPoint(x: 0.5, y: 0.5))
      return
    }

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    viseurLayer.position = layerPoint
    viseurLayer.isHidden = false
    CATransaction.commit()

    let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
    CameraEngine.shared.setAeAfLock(true, at: devicePoint)
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
  }
}
