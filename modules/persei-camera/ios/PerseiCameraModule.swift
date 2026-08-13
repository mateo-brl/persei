import AVFoundation
import ExpoModulesCore

public class PerseiCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PerseiCamera")

    View(PerseiCameraView.self) {}

    AsyncFunction("requestPermission") { (promise: Promise) in
      AVCaptureDevice.requestAccess(for: .video) { granted in
        promise.resolve(granted)
      }
    }

    AsyncFunction("start") { (lens: String, promise: Promise) in
      CameraEngine.shared.start(lens: lens) { result in
        switch result {
        case .success(let capabilities):
          promise.resolve(capabilities)
        case .failure(let error):
          promise.reject("ERR_CAMERA_START", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stop") {
      CameraEngine.shared.stop()
    }

    AsyncFunction("setManualExposure") { (iso: Double, shutterSeconds: Double) in
      try CameraEngine.shared.setManualExposure(iso: iso, shutterSeconds: shutterSeconds)
    }

    AsyncFunction("setAutoExposure") {
      try CameraEngine.shared.setAutoExposure()
    }

    AsyncFunction("setExposureBias") { (bias: Double) in
      try CameraEngine.shared.setExposureBias(bias)
    }

    AsyncFunction("setLensPosition") { (position: Double) in
      try CameraEngine.shared.setLensPosition(position)
    }

    AsyncFunction("setAutoFocus") {
      try CameraEngine.shared.setAutoFocus()
    }

    AsyncFunction("setWhiteBalanceKelvin") { (kelvin: Double) in
      try CameraEngine.shared.setWhiteBalanceKelvin(kelvin)
    }

    AsyncFunction("setAutoWhiteBalance") {
      try CameraEngine.shared.setAutoWhiteBalance()
    }

    AsyncFunction("capturePhoto") { (raw: Bool, promise: Promise) in
      CameraEngine.shared.capturePhoto(raw: raw) { result in
        switch result {
        case .success(let uris):
          promise.resolve(uris)
        case .failure(let error):
          promise.reject("ERR_CAMERA_CAPTURE", error.localizedDescription)
        }
      }
    }
  }
}
