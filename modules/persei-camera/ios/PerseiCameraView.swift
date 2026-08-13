import AVFoundation
import AVKit
import ExpoModulesCore

/// Live preview of the shared camera session, with tap-to-focus, assist
/// overlays (peaking/zebras), a focus loupe and hardware shutter events.
class PerseiCameraView: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer(session: CameraEngine.shared.session)
  private let assistLayer = CALayer()
  private let loupeLayer = CALayer()

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

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    addGestureRecognizer(tap)

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
    CameraEngine.shared.setPointOfInterest(devicePoint)
  }
}
