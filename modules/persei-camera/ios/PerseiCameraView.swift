import AVFoundation
import ExpoModulesCore

/// Live preview of the shared camera session.
class PerseiCameraView: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer(session: CameraEngine.shared.session)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }
}
