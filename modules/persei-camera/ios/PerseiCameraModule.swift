import AVFoundation
import ExpoModulesCore

struct CaptureOptions: Record {
  @Field var raw: Bool = false
  /// Écarts d'exposition (EV) pour un bracketing ; vide = photo simple.
  @Field var bracketStops: [Double] = []
}

public class PerseiCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PerseiCamera")

    Events("onExposureUpdate", "onLongExposureProgress", "onHistogram", "onShutterButton")

    OnStartObserving {
      CameraEngine.shared.onExposureUpdate = { [weak self] payload in
        self?.sendEvent("onExposureUpdate", payload)
      }
      CameraEngine.shared.onLongExposureProgress = { [weak self] payload in
        self?.sendEvent("onLongExposureProgress", payload)
      }
      CameraEngine.shared.onHistogram = { [weak self] bins in
        self?.sendEvent("onHistogram", ["bins": bins])
      }
      CameraEngine.shared.onCaptureButton = { [weak self] in
        self?.sendEvent("onShutterButton", [:])
      }
    }

    OnStopObserving {
      CameraEngine.shared.onExposureUpdate = nil
      CameraEngine.shared.onLongExposureProgress = nil
      CameraEngine.shared.onHistogram = nil
      CameraEngine.shared.onCaptureButton = nil
    }

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

    AsyncFunction("setWhiteBalance") { (kelvin: Double, tint: Double) in
      try CameraEngine.shared.setWhiteBalance(kelvin: kelvin, tint: tint)
    }

    AsyncFunction("setAutoWhiteBalance") {
      try CameraEngine.shared.setAutoWhiteBalance()
    }

    AsyncFunction("setZoom") { (factor: Double) in
      try CameraEngine.shared.setZoom(factor)
    }

    AsyncFunction("setFlashMode") { (mode: String) in
      CameraEngine.shared.setFlashMode(mode)
    }

    AsyncFunction("setTorchLevel") { (level: Double) in
      try CameraEngine.shared.setTorchLevel(level)
    }

    AsyncFunction("setQualityPrioritization") { (mode: String) in
      CameraEngine.shared.setQualityPrioritization(mode)
    }

    AsyncFunction("setHighResolution") { (enabled: Bool) in
      CameraEngine.shared.setHighResolution(enabled)
    }

    AsyncFunction("setLivePhotoEnabled") { (enabled: Bool) in
      CameraEngine.shared.setLivePhotoEnabled(enabled)
    }

    AsyncFunction("setDepthEnabled") { (enabled: Bool) in
      CameraEngine.shared.setDepthEnabled(enabled)
    }

    AsyncFunction("setAssistOptions") { (peaking: Bool, zebras: Bool, histogram: Bool) in
      CameraEngine.shared.setAssistOptions(peaking: peaking, zebras: zebras, histogram: histogram)
    }

    AsyncFunction("setLoupeEnabled") { (enabled: Bool) in
      CameraEngine.shared.setLoupeEnabled(enabled)
    }

    AsyncFunction("startLongExposure") { (seconds: Double, iso: Double, mode: String, align: Bool, meteorFilter: Bool, promise: Promise) in
      CameraEngine.shared.startLongExposure(seconds: seconds, iso: iso, mode: mode, align: align, meteorFilter: meteorFilter) { result in
        switch result {
        case .success(let uris):
          promise.resolve(uris)
        case .failure(let error):
          promise.reject("ERR_LONG_EXPOSURE", error.localizedDescription)
        }
      }
    }

    AsyncFunction("cancelLongExposure") {
      CameraEngine.shared.cancelLongExposure()
    }

    AsyncFunction("capturePhoto") { (options: CaptureOptions, promise: Promise) in
      CameraEngine.shared.capturePhoto(raw: options.raw, bracketStops: options.bracketStops) { result in
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
