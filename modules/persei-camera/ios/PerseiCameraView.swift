import AVFoundation
import ExpoModulesCore

/// Live preview of the shared camera session, with tap-to-focus.
class PerseiCameraView: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer(session: CameraEngine.shared.session)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    addGestureRecognizer(tap)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
    let layerPoint = recognizer.location(in: self)
    let devicePoint = previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
    CameraEngine.shared.setPointOfInterest(devicePoint)
  }
}
