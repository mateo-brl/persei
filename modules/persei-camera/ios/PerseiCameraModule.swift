import AVFoundation
import ExpoModulesCore

struct CaptureOptions: Record {
  @Field var raw: Bool = false
  /// Écarts d'exposition (EV) pour un bracketing ; vide = photo simple.
  @Field var bracketStops: [Double] = []
}

struct VideoOptions: Record {
  /// Hauteur de l'image : 2160 (4K), 1080, 720.
  @Field var height: Int = 1080
  @Field var frameRate: Double = 30
  /// « sdr », « hdr » (HLG 10 bits, Dolby Vision) ou « log » (Apple Log).
  @Field var range: String = "sdr"
  /// « hevc », « h264 » ou « prores ».
  @Field var codec: String = "hevc"
  /// « off », « standard », « cinematic », « cinematicExtended »,
  /// « lowLatency », « auto ».
  @Field var stabilization: String = "auto"
  @Field var audioEnabled: Bool = true
  @Field var windNoiseRemoval: Bool = true
  /// Flou d'arrière-plan cinématique (iOS 26).
  @Field var cinematic: Bool = false
  /// Ouverture simulée ; 0 laisse la valeur par défaut du format.
  @Field var simulatedAperture: Double = 0
}

public class PerseiCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PerseiCamera")

    Events(
      "onExposureUpdate",
      "onLongExposureProgress",
      "onHistogram",
      "onShutterButton",
      "onRecordingProgress",
      "onRecordingStopped",
      "onSystemPressure",
      "onCodeDetected",
      "onCapabilities"
    )

    OnStartObserving {
      CameraEngine.shared.onRecordingProgress = { [weak self] payload in
        self?.sendEvent("onRecordingProgress", payload)
      }
      CameraEngine.shared.onRecordingStopped = { [weak self] payload in
        self?.sendEvent("onRecordingStopped", payload)
      }
      CameraEngine.shared.onSystemPressure = { [weak self] payload in
        self?.sendEvent("onSystemPressure", payload)
      }
      CameraEngine.shared.onCodeDetected = { [weak self] payload in
        self?.sendEvent("onCodeDetected", payload)
      }
      CameraEngine.shared.onCapabilities = { [weak self] payload in
        self?.sendEvent("onCapabilities", payload)
      }
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
      CameraEngine.shared.onRecordingProgress = nil
      CameraEngine.shared.onRecordingStopped = nil
      CameraEngine.shared.onSystemPressure = nil
      CameraEngine.shared.onCodeDetected = nil
      CameraEngine.shared.onCapabilities = nil
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

    AsyncFunction("setPhotoResolution") { (megapixels: Double) in
      CameraEngine.shared.setPhotoResolution(megapixels)
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

    AsyncFunction("startLongExposure") { (seconds: Double, iso: Double, mode: String, align: Bool, meteorFilter: Bool, manualExposure: Bool, promise: Promise) in
      CameraEngine.shared.startLongExposure(seconds: seconds, iso: iso, mode: mode, align: align, meteorFilter: meteorFilter, manualExposure: manualExposure) { result in
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

    /// Rend l'espace disque d'une prise déjà copiée dans la photothèque.
    AsyncFunction("discardTempFile") { (uri: String) in
      CameraEngine.discardTempFile(uri)
    }

    // MARK: Vidéo

    AsyncFunction("requestMicrophonePermission") { (promise: Promise) in
      AVCaptureDevice.requestAccess(for: .audio) { granted in
        promise.resolve(granted)
      }
    }

    /// Mode réclamé par un raccourci Siri avant l'ouverture de l'app. La clé
    /// est écrite par PerseiIntents.swift, compilé dans la cible de l'app :
    /// ce module vit dans un pod séparé, d'où la chaîne recopiée.
    AsyncFunction("consumeLaunchMode") { () -> String? in
      let cle = "persei.launchMode"
      let reglages = UserDefaults.standard
      let mode = reglages.string(forKey: cle)
      if mode != nil { reglages.removeObject(forKey: cle) }
      return mode
    }

    /// Trace du dernier plantage, lue une seule fois au démarrage.
    AsyncFunction("consumeLastCrash") { () -> String? in
      CrashLog.consume()
    }

    AsyncFunction("setVideoMode") { (enabled: Bool, promise: Promise) in
      CameraEngine.shared.setVideoMode(enabled) { result in
        switch result {
        case .success(let capabilities):
          promise.resolve(capabilities)
        case .failure(let error):
          promise.reject("ERR_VIDEO_MODE", error.localizedDescription)
        }
      }
    }

    AsyncFunction("configureVideo") { (options: VideoOptions, promise: Promise) in
      CameraEngine.shared.configureVideo(
        height: options.height,
        frameRate: options.frameRate,
        range: options.range,
        codec: options.codec,
        stabilization: options.stabilization,
        audioEnabled: options.audioEnabled,
        windNoiseRemoval: options.windNoiseRemoval,
        cinematic: options.cinematic,
        simulatedAperture: options.simulatedAperture
      ) { result in
        switch result {
        case .success(let capabilities):
          promise.resolve(capabilities)
        case .failure(let error):
          promise.reject("ERR_VIDEO_CONFIG", error.localizedDescription)
        }
      }
    }

    AsyncFunction("startRecording") { (promise: Promise) in
      CameraEngine.shared.startRecording { result in
        switch result {
        case .success:
          promise.resolve(nil)
        case .failure(let error):
          promise.reject("ERR_RECORDING_START", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stopRecording") { (promise: Promise) in
      CameraEngine.shared.stopRecording { result in
        switch result {
        case .success(let uri):
          promise.resolve(uri)
        case .failure(let error):
          promise.reject("ERR_RECORDING_STOP", error.localizedDescription)
        }
      }
    }

    AsyncFunction("pauseRecording") {
      if #available(iOS 18.0, *) {
        CameraEngine.shared.pauseRecording()
      }
    }

    AsyncFunction("resumeRecording") {
      if #available(iOS 18.0, *) {
        CameraEngine.shared.resumeRecording()
      }
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
